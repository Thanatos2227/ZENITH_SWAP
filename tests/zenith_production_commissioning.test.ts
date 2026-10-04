import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, Wallet } from 'ethers';
import {
    defaultAuthoritativeNetworkRegistry,
    defaultChainRegistry,
    ZENITH_AUTHORITATIVE_NETWORKS
} from '../packages/chains/src';
import {
    resolveScopedSignerKey,
    resolveSecureSignerKey
} from '../scripts/secure-runtime-loader';
import {
    validateNetworkRegistry
} from '../scripts/validate-networks';
import {
    ExecutionPlanBuilder,
    sealPlan,
    computeExecutionPlanHash,
    validateExecutionPlanAuthorization,
    validateTransactionPlanEquivalence,
    verifyDestinationSettlement,
    SQLiteCrossChainStateRepository,
    ExecutionIntegrationPipeline
} from '../packages/execution/src';
import {
    ZERO_ADDRESS,
    ACROSS_SPOKE_POOLS,
    ACROSS_SPOKE_POOL_ABI
} from '../packages/contracts/src';
import { ExecutionPlan, Token } from '../packages/types/src';

const USER_ADDR = '0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88';
const SEPOLIA_USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const ARB_SEPOLIA_USDC = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d';
const ACROSS_SEPOLIA_SPOKE = '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5';

const spokePoolIface = new Interface(ACROSS_SPOKE_POOL_ABI);

function createSampleTestnetPlan(): ExecutionPlan {
    const tokenIn: Token = {
        address: SEPOLIA_USDC,
        chainId: '11155111',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL'
    };
    const tokenOut: Token = {
        address: ARB_SEPOLIA_USDC,
        chainId: '421614',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        verificationTier: 'VERIFIED_CANONICAL'
    };

    const depositCalldata = spokePoolIface.encodeFunctionData('depositV3', [
        USER_ADDR,
        USER_ADDR,
        SEPOLIA_USDC,
        ARB_SEPOLIA_USDC,
        100000000n,
        99500000n,
        421614n,
        ZERO_ADDRESS,
        Math.floor(Date.now() / 1000) - 60,
        Math.floor(Date.now() / 1000) + 1800,
        0,
        '0x'
    ]);

    const plan: ExecutionPlan = {
        planId: 'plan-testnet-comm-001',
        routeId: 'route-across-sepolia-arbsepolia',
        routeType: 'CROSS_CHAIN_DIRECT',
        sourceChainId: '11155111',
        destinationChainId: '421614',
        tokenIn,
        tokenOut,
        expectedAmountInRaw: '100000000',
        expectedAmountOutRaw: '99800000',
        minimumAmountOutRaw: '99500000',
        isExecutable: true,
        selectedProvider: 'across',
        selectedDex: 'uniswap_v3',
        executionTarget: ACROSS_SEPOLIA_SPOKE,
        approvalTarget: ACROSS_SEPOLIA_SPOKE,
        calldata: depositCalldata,
        expiration: Date.now() + 3600000,
        totalFeeRaw: '200000',
        currentStepIndex: 0,
        overallStatus: 'IDLE',
        diagnostics: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        steps: [
            {
                id: 'step-01-deposit',
                type: 'BRIDGE_DEPOSIT',
                title: 'Deposit to Across Sepolia',
                description: 'Call depositV3 on Across Sepolia SpokePool',
                chainId: '11155111',
                numericChainId: 11155111,
                executionEnvironment: 'EVM',
                targetAddress: ACROSS_SEPOLIA_SPOKE,
                calldata: depositCalldata,
                requiredAmountRaw: '100000000',
                outputTokenAddress: ARB_SEPOLIA_USDC,
                expectedAmountOutRaw: '99800000',
                minimumAmountOutRaw: '99500000',
                status: 'IDLE',
                dependencies: [],
                retryPolicy: { maxRetries: 2, backoffMs: 2000, timeoutMs: 60000 }
            }
        ]
    };

    (plan as any).recipient = USER_ADDR;
    (plan as any).userWalletAddress = USER_ADDR;
    return sealPlan(plan);
}

test('ZENITH — PRODUCTION COMMISSIONING & DEPLOYMENT INTEGRITY SUITE', async (t) => {
    // ------------------------------------------------------------------------
    // 1. Secret Isolation & Scoped Signer Gating
    // ------------------------------------------------------------------------
    await t.test('1.1 Scoped Signer: TESTNET scope does NOT read MAINNET private key', () => {
        const origMainnet = process.env.ZENITH_MAINNET_PRIVATE_KEY;
        const origTestnet = process.env.TESTNET_PRIVATE_KEY;

        try {
            process.env.ZENITH_MAINNET_PRIVATE_KEY = '0x1111111111111111111111111111111111111111111111111111111111111111';
            delete process.env.TESTNET_PRIVATE_KEY;
            delete process.env.ZENITH_TESTNET_PRIVATE_KEY;

            const res = resolveScopedSignerKey('TESTNET');
            assert.notEqual(res.rawKey, '0x1111111111111111111111111111111111111111111111111111111111111111', 'TESTNET scope must never read MAINNET key');
        } finally {
            if (origMainnet) process.env.ZENITH_MAINNET_PRIVATE_KEY = origMainnet;
            else delete process.env.ZENITH_MAINNET_PRIVATE_KEY;
            if (origTestnet) process.env.TESTNET_PRIVATE_KEY = origTestnet;
            else delete process.env.TESTNET_PRIVATE_KEY;
        }
    });

    await t.test('1.2 Scoped Signer: MAINNET scope does NOT read TESTNET private key', () => {
        const origMainnet = process.env.ZENITH_MAINNET_PRIVATE_KEY;
        const origTestnet = process.env.TESTNET_PRIVATE_KEY;

        try {
            delete process.env.ZENITH_MAINNET_PRIVATE_KEY;
            process.env.TESTNET_PRIVATE_KEY = '0x2222222222222222222222222222222222222222222222222222222222222222';

            const res = resolveScopedSignerKey('MAINNET');
            assert.notEqual(res.rawKey, '0x2222222222222222222222222222222222222222222222222222222222222222', 'MAINNET scope must never read TESTNET key');
        } finally {
            if (origMainnet) process.env.ZENITH_MAINNET_PRIVATE_KEY = origMainnet;
            else delete process.env.ZENITH_MAINNET_PRIVATE_KEY;
            if (origTestnet) process.env.TESTNET_PRIVATE_KEY = origTestnet;
            else delete process.env.TESTNET_PRIVATE_KEY;
        }
    });

    // ------------------------------------------------------------------------
    // 2. Network Registry Validation Invariants
    // ------------------------------------------------------------------------
    await t.test('2.1 Network Registry: Complete validation suite passes with zero errors', () => {
        const errors = validateNetworkRegistry();
        assert.equal(errors.length, 0, `Network validation reported unexpected errors: ${JSON.stringify(errors)}`);
    });

    await t.test('2.2 Network Registry: Required testnets (Sepolia, Arb Sepolia, Amoy, Base Sepolia) exist', () => {
        const sepolia = defaultAuthoritativeNetworkRegistry.getNetwork('sepolia');
        const arbSepolia = defaultAuthoritativeNetworkRegistry.getNetwork('arbitrum_sepolia');
        const amoy = defaultAuthoritativeNetworkRegistry.getNetwork('polygon_amoy');
        const baseSepolia = defaultAuthoritativeNetworkRegistry.getNetwork('base_sepolia');

        assert.ok(sepolia, 'Sepolia testnet must be registered');
        assert.equal(sepolia.numericChainId, 11155111);
        assert.ok(arbSepolia, 'Arbitrum Sepolia must be registered');
        assert.equal(arbSepolia.numericChainId, 421614);
        assert.ok(amoy, 'Polygon Amoy must be registered');
        assert.equal(amoy.numericChainId, 80002);
        assert.ok(baseSepolia, 'Base Sepolia must be registered');
        assert.equal(baseSepolia.numericChainId, 84532);
    });

    // ------------------------------------------------------------------------
    // 3. Pre-Broadcast Gating & Transaction Semantics
    // ------------------------------------------------------------------------
    await t.test('3.1 Pre-Broadcast: Valid testnet execution plan passes semantic equivalence', () => {
        const plan = createSampleTestnetPlan();
        const tx = {
            chainId: 11155111,
            to: plan.executionTarget!,
            data: plan.calldata!,
            value: '0'
        };

        const result = validateTransactionPlanEquivalence(tx, plan);
        assert.equal(result.isEquivalent, true);
    });

    await t.test('3.2 Pre-Broadcast: Wrong chain ID is rejected before broadcast', () => {
        const plan = createSampleTestnetPlan();
        const tx = {
            chainId: 1, // Mainnet chain ID passed to testnet plan
            to: plan.executionTarget!,
            data: plan.calldata!,
            value: '0'
        };

        assert.throws(() => validateTransactionPlanEquivalence(tx, plan), /chainId/);
    });

    // ------------------------------------------------------------------------
    // 4. Destination Verification & Finality Gating
    // ------------------------------------------------------------------------
    await t.test('4.1 Destination: Reconciles testnet ERC20 Transfer event with required depth', () => {
        const receipt = {
            status: 1,
            blockNumber: 500000,
            transactionHash: '0xarb_sepolia_verified_dest_tx',
            gasUsed: 54000n,
            logs: [
                {
                    address: ARB_SEPOLIA_USDC,
                    topics: [
                        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                        '0x000000000000000000000000' + ACROSS_SEPOLIA_SPOKE.slice(2),
                        '0x000000000000000000000000' + USER_ADDR.slice(2)
                    ],
                    data: '0x0000000000000000000000000000000000000000000000000000000005f5e100' // 100 USDC
                }
            ]
        };

        const result = verifyDestinationSettlement({
            destinationChainId: 421614,
            destinationTxHash: '0xarb_sepolia_verified_dest_tx',
            expectedRecipient: USER_ADDR,
            expectedToken: ARB_SEPOLIA_USDC,
            expectedMinAmountRaw: '99500000',
            receipt: receipt as any,
            currentBlockNumber: 500020, // 21 confirmations >= 12 required
            requiredConfirmations: 12
        });

        assert.equal(result.settlementStatus, 'DESTINATION_SETTLED');
        assert.equal(result.isFinalized, true);
        assert.equal(result.deliveredToExpectedRecipient, true);
        assert.equal(result.tokenMatched, true);
    });

    // ------------------------------------------------------------------------
    // 5. Crash Recovery & Replay Protection
    // ------------------------------------------------------------------------
    await t.test('5.1 Replay Protection: Duplicate intent registration with same nonce is rejected', async () => {
        const repo = new SQLiteCrossChainStateRepository(':memory:');
        const plan = createSampleTestnetPlan();

        const intent = {
            intentId: plan.planId,
            userAddress: USER_ADDR,
            recipientAddress: USER_ADDR,
            sourceChainId: 11155111,
            destinationChainId: 421614,
            sourceTokenAddress: SEPOLIA_USDC,
            sourceTokenSymbol: 'USDC',
            destinationTokenAddress: ARB_SEPOLIA_USDC,
            destinationTokenSymbol: 'USDC',
            amountInRaw: '100000000',
            expectedAmountOutRaw: '99800000',
            minAmountOutRaw: '99500000',
            provider: 'across',
            routeId: plan.routeId,
            deadline: Date.now() + 3600000,
            slippageBps: 50,
            nonce: 100,
            status: 'PENDING' as const,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        await repo.createIntent(intent);

        // Second intent with identical (userAddress, sourceChain, destChain, nonce)
        const duplicateIntent = {
            ...intent,
            intentId: 'plan-testnet-comm-002'
        };

        await assert.rejects(async () => {
            await repo.createIntent(duplicateIntent);
        }, /Nonce replay detected/);
    });
});
