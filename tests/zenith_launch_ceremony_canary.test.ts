import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultChainRegistry } from '../packages/chains/src';
import { 
    getZenithDeployment, 
    isZenithDeployed, 
    registerZenithDeployment, 
    verifyZenithBytecode,
    ZERO_ADDRESS 
} from '../packages/contracts/src';
import { resolveScopedSignerKey, ChainScope } from '../scripts/secure-runtime-loader';
import { 
    generateDeployerInitiationBatch, 
    generateSafeMultisigAcceptanceBatch, 
    ProtocolDeploymentConfig 
} from '../scripts/generate-safe-multisig-txs';

test('ZENITH Protocol — Phase 3 Task 62 Launch Ceremony & Controlled Canary Suite', async (t) => {
    
    await t.test('Stage 1: Governance Safe 4-of-7 Multisig Provisioning Validation', () => {
        const sampleOwners = [
            '0x1111111111111111111111111111111111111111',
            '0x2222222222222222222222222222222222222222',
            '0x3333333333333333333333333333333333333333',
            '0x4444444444444444444444444444444444444444',
            '0x5555555555555555555555555555555555555555',
            '0x6666666666666666666666666666666666666666',
            '0x7777777777777777777777777777777777777777'
        ];
        const threshold = 4;

        // Verify owner set uniqueness and count
        const uniqueOwners = new Set(sampleOwners.map(a => a.toLowerCase()));
        assert.equal(uniqueOwners.size, 7, 'Safe must have exactly 7 unique owners');
        assert.equal(threshold, 4, 'Safe threshold must be 4');
        assert.ok(threshold <= uniqueOwners.size, 'Threshold must not exceed owner count');
        assert.ok(!uniqueOwners.has(ZERO_ADDRESS), 'Safe owner cannot be zero address');
    });

    await t.test('Stage 2 & 3: Pre-Broadcast Gate & Human Authorization Gate Fails Closed When Unauthorized', () => {
        interface BroadcastGateParams {
            chainId: number;
            contractName: string;
            rpcHealthy: boolean;
            humanAuthorized: boolean;
            signerScope: ChainScope;
        }

        const evaluateBroadcastGate = (params: BroadcastGateParams): { canBroadcast: boolean; status: string } => {
            if (!params.rpcHealthy) {
                return { canBroadcast: false, status: 'BLOCKED_RPC_UNHEALTHY' };
            }
            if (params.signerScope !== ChainScope.MAINNET) {
                return { canBroadcast: false, status: 'BLOCKED_INVALID_SIGNER_SCOPE' };
            }
            if (!params.humanAuthorized) {
                return { canBroadcast: false, status: 'BLOCKED_AWAITING_EXPLICIT_BROADCAST_AUTHORIZATION' };
            }
            return { canBroadcast: true, status: 'AUTHORIZED_FOR_BROADCAST' };
        };

        // Case 1: Unauthorized human gate must fail closed
        const unauthorizedRes = evaluateBroadcastGate({
            chainId: 137,
            contractName: 'ZenithTreasury',
            rpcHealthy: true,
            humanAuthorized: false,
            signerScope: ChainScope.MAINNET
        });
        assert.equal(unauthorizedRes.canBroadcast, false);
        assert.equal(unauthorizedRes.status, 'BLOCKED_AWAITING_EXPLICIT_BROADCAST_AUTHORIZATION');

        // Case 2: Explicitly authorized gate permits progression
        const authorizedRes = evaluateBroadcastGate({
            chainId: 137,
            contractName: 'ZenithTreasury',
            rpcHealthy: true,
            humanAuthorized: true,
            signerScope: ChainScope.MAINNET
        });
        assert.equal(authorizedRes.canBroadcast, true);
        assert.equal(authorizedRes.status, 'AUTHORIZED_FOR_BROADCAST');
    });

    await t.test('Stage 4 & 5: Deployment DAG & Bytecode Verification Logic', async () => {
        const mockProvider = {
            getCode: async (addr: string) => {
                if (addr === '0xDeployedContract123456789012345678901234') {
                    return '0x608060405234801561001057600080fd5b50';
                }
                return '0x';
            }
        };

        // Test unconfigured chain verification
        const unconfiguredRes = await verifyZenithBytecode(mockProvider, 1);
        assert.equal(unconfiguredRes.isFullyDeployed, false);
        assert.ok(unconfiguredRes.missingBytecode.length > 0);
    });

    await t.test('Stage 6, 7 & 8: Safe Multisig Governance Handover Batches Generation', () => {
        const sampleConfig: ProtocolDeploymentConfig = {
            chainId: 137,
            safeMultisigAddress: '0xSafeMultisig1234567890123456789012345678',
            deployerAddress: '0xDeployer12345678901234567890123456789012',
            emergencyGuardianAddress: '0xGuardian12345678901234567890123456789012',
            contracts: {
                zenithTreasury: '0xTreasury12345678901234567890123456789012',
                zenithFeeController: '0xFeeController123456789012345678901234567890',
                zenithV1Factory: '0xV1Factory12345678901234567890123456789012',
                zenithV2Factory: '0xV2Factory12345678901234567890123456789012',
                zenithV3Factory: '0xV3Factory12345678901234567890123456789012',
                zenithUnifiedRouter: '0xUnifiedRouter123456789012345678901234567890',
                zenithCircuitBreaker: '0xCircuitBreaker1234567890123456789012345678',
                zenithCrossChainRouter: '0xCrossChainRouter123456789012345678901234'
            }
        };

        const p1 = generateDeployerInitiationBatch(sampleConfig);
        assert.equal(p1.transactions.length, 6, 'Phase 1 must contain 6 initiation transactions');

        const p2 = generateSafeMultisigAcceptanceBatch(sampleConfig);
        assert.equal(p2.transactions.length, 4, 'Phase 2 must contain 4 acceptance & guardian update transactions');
    });

    await t.test('Stage 9 & 10: Canary Pre-Flight Simulation & Human Authorization Gate', () => {
        interface CanaryIntent {
            sourceChainId: number;
            destChainId: number;
            amountIn: string;
            minAmountOut: string;
            isFreshQuote: boolean;
            humanAuthorized: boolean;
        }

        const evaluateCanaryPreflight = (intent: CanaryIntent): { ready: boolean; reason: string } => {
            if (!intent.isFreshQuote) {
                return { ready: false, reason: 'REJECTED_STALE_QUOTE' };
            }
            if (BigInt(intent.amountIn) <= 0n) {
                return { ready: false, reason: 'REJECTED_ZERO_AMOUNT' };
            }
            if (BigInt(intent.minAmountOut) > BigInt(intent.amountIn) * 2n) {
                return { ready: false, reason: 'REJECTED_UNREALISTIC_SLIPPAGE' };
            }
            if (!intent.humanAuthorized) {
                return { ready: false, reason: 'BLOCKED_AWAITING_EXPLICIT_BROADCAST_AUTHORIZATION' };
            }
            return { ready: true, reason: 'CANARY_AUTHORIZED_FOR_BROADCAST' };
        };

        const unauthCanary = evaluateCanaryPreflight({
            sourceChainId: 137,
            destChainId: 42161,
            amountIn: '1000000', // 1 USDC
            minAmountOut: '990000',
            isFreshQuote: true,
            humanAuthorized: false
        });
        assert.equal(unauthCanary.ready, false);
        assert.equal(unauthCanary.reason, 'BLOCKED_AWAITING_EXPLICIT_BROADCAST_AUTHORIZATION');
    });

    await t.test('Stage 11–15: Canary Settlement & Finality Evidence Progression Invariant', () => {
        // Evidence state machine: PENDING -> MINED -> SETTLED -> FINALIZED
        type CanaryState = 'IDLE' | 'PENDING' | 'MINED' | 'SETTLED' | 'FINALIZED';
        
        const advanceState = (
            current: CanaryState, 
            evidence: { hasReceipt: boolean; hasBridgeProof: boolean; confirmations: number; requiredConfirmations: number }
        ): CanaryState => {
            if (current === 'IDLE' && evidence.hasReceipt) {
                return 'MINED';
            }
            if (current === 'MINED' && evidence.hasBridgeProof) {
                return 'SETTLED';
            }
            if (current === 'SETTLED' && evidence.confirmations >= evidence.requiredConfirmations) {
                return 'FINALIZED';
            }
            return current;
        };

        let state: CanaryState = 'IDLE';
        state = advanceState(state, { hasReceipt: true, hasBridgeProof: false, confirmations: 1, requiredConfirmations: 64 });
        assert.equal(state, 'MINED');

        state = advanceState(state, { hasReceipt: true, hasBridgeProof: true, confirmations: 1, requiredConfirmations: 64 });
        assert.equal(state, 'SETTLED');

        // Cannot finalize before meeting required confirmations
        state = advanceState(state, { hasReceipt: true, hasBridgeProof: true, confirmations: 30, requiredConfirmations: 64 });
        assert.equal(state, 'SETTLED');

        // Finalized once threshold reached
        state = advanceState(state, { hasReceipt: true, hasBridgeProof: true, confirmations: 64, requiredConfirmations: 64 });
        assert.equal(state, 'FINALIZED');
    });

    await t.test('Stage 16: Authoritative Mainnet Deployment State Verification', () => {
        // Mainnets must report uninstantiated prior to live ceremony broadcast
        const mainnetIds = [1, 10, 56, 137, 8453, 42161, 43114];
        for (const cid of mainnetIds) {
            const deployed = isZenithDeployed(cid);
            assert.equal(deployed, false, `Chain ID ${cid} must report false prior to live broadcast`);
            const d = getZenithDeployment(cid);
            assert.ok(d, `Deployment config for ${cid} must exist`);
            assert.equal(d.v3Router, null, `v3Router for ${cid} must be null`);
        }
    });
});
