import { describe, it } from 'node:test';
import assert from 'node:assert';
import { 
    KmsSignerProvider, 
    ISecureSignerProvider, 
    SignerPolicy, 
    KmsSigningRequest 
} from '../packages/execution/src/signer';
import { resolveScopedSignerKey, resolveSecureSignerKey } from '../scripts/secure-runtime-loader';
import { AuthorizationBoundaryBreachError, SecurityPolicyViolationError, ChainIdMismatchError } from '../packages/contracts/src';

describe('ZENITH SWAP — Phase 3 Task 55 Production Infrastructure & KMS Test Suite', () => {

    describe('1. Secure Runtime Loader & Environment Scoping', () => {
        it('resolves scoped signer key for TESTNET without contaminating other unconfigured scopes', () => {
            const originalTestnet = process.env.TESTNET_PRIVATE_KEY;
            const originalLocal = process.env.ZENITH_LOCAL_PRIVATE_KEY;
            const isolatedDir = 'E:\\APEX\\ZENITH\\scratch\\test_nonexistent';
            
            try {
                delete process.env.ZENITH_LOCAL_PRIVATE_KEY;
                process.env.TESTNET_PRIVATE_KEY = '0x1111111111111111111111111111111111111111111111111111111111111111';

                const testnetRes = resolveScopedSignerKey('TESTNET', isolatedDir);
                assert.strictEqual(testnetRes.runtimeSource, 'PROCESS_ENV');
                assert.strictEqual(testnetRes.rawKey, '0x1111111111111111111111111111111111111111111111111111111111111111');

                const localRes = resolveScopedSignerKey('LOCAL', isolatedDir);
                assert.strictEqual(localRes.rawKey, null);
                assert.strictEqual(localRes.runtimeSource, 'NONE_AVAILABLE');
            } finally {
                if (originalLocal) process.env.ZENITH_LOCAL_PRIVATE_KEY = originalLocal;
                else delete process.env.ZENITH_LOCAL_PRIVATE_KEY;
                if (originalTestnet) process.env.TESTNET_PRIVATE_KEY = originalTestnet;
                else delete process.env.TESTNET_PRIVATE_KEY;
            }
        });


        it('resolves scoped signer key for MAINNET strictly when configured', () => {
            const originalMainnet = process.env.ZENITH_MAINNET_PRIVATE_KEY;
            const isolatedDir = 'E:\\APEX\\ZENITH\\scratch\\test_nonexistent';
            try {
                process.env.ZENITH_MAINNET_PRIVATE_KEY = '0x2222222222222222222222222222222222222222222222222222222222222222';
                const mainnetRes = resolveScopedSignerKey('MAINNET', isolatedDir);
                assert.strictEqual(mainnetRes.runtimeSource, 'PROCESS_ENV');
                assert.strictEqual(mainnetRes.rawKey, '0x2222222222222222222222222222222222222222222222222222222222222222');
            } finally {
                if (originalMainnet) process.env.ZENITH_MAINNET_PRIVATE_KEY = originalMainnet;
                else delete process.env.ZENITH_MAINNET_PRIVATE_KEY;
            }
        });
    });

    describe('2. KMS Signer Provider Policy Invariants', () => {
        const mockAddress = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
        const mockSpokePool = '0x6f26Bf09B1C792e3228e5467807a900A503c0281';
        const unallowlistedAddress = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';

        const productionPolicy: SignerPolicy = {
            allowedChainIds: [1, 137, 42161],
            maxTransactionValueWei: 1000000000000000000n, // 1.0 ETH/POL max
            destinationAllowlist: [mockSpokePool],
            requireOperatorConfirmation: true,
            allowUnboundedApprovals: false
        };

        const createMockKmsProvider = (policy: SignerPolicy = productionPolicy): ISecureSignerProvider => {
            return new KmsSignerProvider({
                environment: 'PRODUCTION',
                keyId: 'arn:aws:kms:us-east-1:123456789012:key/zenith-prod-signer-01',
                providerType: 'AWS_KMS',
                policy,
                addressResolver: async () => mockAddress,
                signatureDelegate: async () => ({
                    r: '1111111111111111111111111111111111111111111111111111111111111111',
                    s: '2222222222222222222222222222222222222222222222222222222222222222',
                    v: 27
                })
            });
        };

        it('returns resolved address and validates address format', async () => {
            const provider = createMockKmsProvider();
            const address = await provider.getAddress();
            assert.strictEqual(address, mockAddress);
        });

        it('rejects transactions to unallowlisted destination', async () => {
            const provider = createMockKmsProvider();
            const req: KmsSigningRequest = {
                chainId: 137,
                to: unallowlistedAddress,
                value: 0n,
                data: '0x'
            };

            assert.throws(() => {
                provider.validatePolicy(req);
            }, (err: any) => err instanceof AuthorizationBoundaryBreachError);
        });


        it('rejects transactions exceeding value limit', async () => {
            const provider = createMockKmsProvider();
            const req: KmsSigningRequest = {
                chainId: 137,
                to: mockSpokePool,
                value: 2000000000000000000n, // 2 ETH > 1 ETH limit
                data: '0x'
            };

            assert.throws(() => {
                provider.validatePolicy(req);
            }, (err: any) => err instanceof SecurityPolicyViolationError);
        });

        it('rejects transactions on unauthorized chainId', async () => {
            const provider = createMockKmsProvider();
            const req: KmsSigningRequest = {
                chainId: 56, // BSC not in allowedChainIds
                to: mockSpokePool,
                value: 0n,
                data: '0x'
            };

            assert.throws(() => {
                provider.validatePolicy(req);
            }, (err: any) => err instanceof ChainIdMismatchError);
        });

        it('rejects unbounded token approvals when policy prohibits them', async () => {
            const provider = createMockKmsProvider();
            const req: KmsSigningRequest = {
                chainId: 137,
                to: mockSpokePool,
                value: 0n,
                data: '0x095ea7b30000000000000000000000006f26bf09b1c792e3228e5467807a900a503c0281ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
            };

            assert.throws(() => {
                provider.validatePolicy(req);
            }, (err: any) => err instanceof SecurityPolicyViolationError);
        });

        it('signs transaction successfully with valid confirmation token', async () => {
            const provider = createMockKmsProvider();
            const req: KmsSigningRequest = {
                chainId: 137,
                to: mockSpokePool,
                value: 100000000000000000n,
                data: '0x12345678'
            };

            const signed = await provider.signTransaction(req, 'CONFIRM_POLYGON_ARBITRUM_MAINNET');
            assert.ok(signed.transactionHash.startsWith('0x'));
            assert.strictEqual(signed.providerType, 'AWS_KMS');
            assert.strictEqual(signed.keyId, 'arn:aws:kms:us-east-1:123456789012:key/zenith-prod-signer-01');
        });

        it('fails closed when operator confirmation token is missing', async () => {
            const provider = createMockKmsProvider();
            const req: KmsSigningRequest = {
                chainId: 137,
                to: mockSpokePool,
                value: 100000000000000000n,
                data: '0x12345678'
            };

            await assert.rejects(async () => {
                await provider.signTransaction(req);
            }, (err: any) => err instanceof AuthorizationBoundaryBreachError);
        });
    });

    describe('3. Production Deployment Invariant Validation', () => {
        it('validates that 8 deployment manifests exist and maintain strict zero-fabrication', () => {
            const fs = require('fs');
            const path = require('path');
            const targetChains = [1, 10, 56, 137, 8453, 42161, 43114, 31337];

            for (const chainId of targetChains) {
                const manifestPath = path.resolve(process.cwd(), 'deployments', `${chainId}.json`);
                assert.ok(fs.existsSync(manifestPath), `Manifest for chain ${chainId} must exist`);
                const content = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                assert.strictEqual(content.chainId, chainId);

                if (chainId !== 31337) {
                    assert.strictEqual(content.treasury, null, `Mainnet chain ${chainId} treasury must be null`);
                    assert.strictEqual(content.v3Router, null, `Mainnet chain ${chainId} v3Router must be null`);
                }
            }
        });
    });
});
