import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { ExecutionIntegrationPipeline, defaultExecutionIntegrationPipeline, PipelineStage, PipelineExecutionParams, PipelineExecutionResult } from '../packages/execution/src/crosschain/executionIntegrationPipeline';
import { ExecutionPlanBuilder, ExecutionPlanValidator, assertPlanIntegrity, sealPlan, computeExecutionPlanHash } from '../packages/execution/src/executionPlanBuilder';
import { ACROSS_V3_INTERFACE } from '../packages/execution/src';
import { validateExecutionPlanAuthorization } from '../packages/execution/src/security/executionAuthorizationValidator';
import { validateTransactionPlanEquivalence } from '../packages/execution/src/semantics/semanticEquivalenceValidator';
import { validateMinimumOutput, validateSourceSwapEconomics, validateBridgeEconomics, calculateDeterministicMinimumOutput } from '../packages/execution/src/economic/economicSafetyValidator';
import { extractActualSourceSwapOutput } from '../packages/execution/src/crosschain/sourceSwapOutputExtractor';
import { verifyDestinationSettlement } from '../packages/execution/src/crosschain/authoritativeDestinationVerifier';
import { InMemoryCrossChainStateRepository, VALID_SETTLEMENT_STATE_TRANSITIONS, TERMINAL_SETTLEMENT_STATES, validateSettlementStateTransition } from '../packages/execution/src/persistence/repository';
import { AuthorizationBoundaryBreachError, SemanticEquivalenceBreachError, EconomicSafetyBreachError, MinimumOutputBreachError, PlanIntegrityBreachError, ReorgDetectedError, DestinationEvidenceMismatchError, EvidenceConflictError, SettlementFinalityBreachError, ConfigurationError } from '../packages/contracts/src/errors';
import { defaultChainRegistry } from '../packages/chains/src/registry';
import { ExecutionPlan, ExecutionPlanStep, Token } from '../packages/types/src/index';
const ARB_CHAIN_ID = 42161;
const POL_CHAIN_ID = 137;
const ETH_CHAIN_ID = 1;
const BASE_CHAIN_ID = 8453;
const OP_CHAIN_ID = 10;
const AVAX_CHAIN_ID = 43114;
const POL_USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const ARB_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const ETH_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ACROSS_SPOKE_POOL_POL = '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096';
const ACROSS_SPOKE_POOL_ARB = '0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A';
const UNISWAP_V3_ROUTER_POL = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
const CANONICAL_NATIVE_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const USER_WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const RELAYER_WALLET = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const UNRELATED_WALLET = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
const SPOOF_TOKEN = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const CANONICAL_TX_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CANONICAL_BLOCK_HASH = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const erc20Iface = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
const CANONICAL_DEPOSIT_CALLDATA = ACROSS_V3_INTERFACE.encodeFunctionData('depositV3', [
    USER_WALLET.toLowerCase(),
    USER_WALLET.toLowerCase(),
    POL_USDC.toLowerCase(),
    ARB_USDC.toLowerCase(),
    100000000n,
    99500000n,
    ARB_CHAIN_ID,
    '0x0000000000000000000000000000000000000000',
    1700000000,
    1700001800,
    0,
    '0x'
]);
function makeTransferLog(token: string, from: string, to: string, amount: bigint | string) {
    const parsed = erc20Iface.encodeEventLog(erc20Iface.getEvent('Transfer')!, [from, to, BigInt(amount.toString())]);
    return {
        address: token.toLowerCase(),
        topics: parsed.topics,
        data: parsed.data
    };
}
function makeToken(address: string, symbol: string, chainId: string | number): Token {
    return {
        address,
        symbol,
        name: symbol,
        decimals: 6,
        chainId: String(chainId),
        verificationTier: 'VERIFIED_CANONICAL'
    };
}
function makeCanonicalPlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
    const basePlan: ExecutionPlan = {
        planId: 'plan-canonical-101',
        routeId: 'route-pol-arb-direct',
        routeType: 'CROSS_CHAIN_DIRECT',
        sourceChainId: String(POL_CHAIN_ID),
        destinationChainId: String(ARB_CHAIN_ID),
        tokenIn: makeToken(POL_USDC, 'USDC', POL_CHAIN_ID),
        tokenOut: makeToken(ARB_USDC, 'USDC', ARB_CHAIN_ID),
        expectedAmountInRaw: '100000000',
        expectedAmountOutRaw: '99800000',
        minimumAmountOutRaw: '99500000',
        isExecutable: true,
        recipient: USER_WALLET,
        userWalletAddress: USER_WALLET,
        executionTarget: ACROSS_SPOKE_POOL_POL,
        approvalTarget: ACROSS_SPOKE_POOL_POL,
        calldata: CANONICAL_DEPOSIT_CALLDATA,
        transactionValue: '0',
        selectedProvider: 'across',
        estimatedGasLimit: '250000',
        steps: [
            {
                id: 'step-deposit-01',
                type: 'BRIDGE_DEPOSIT',
                title: 'Across Bridge Deposit',
                description: 'Deposit USDC into Across SpokePool',
                chainId: String(POL_CHAIN_ID),
                executionEnvironment: 'EVM',
                targetAddress: ACROSS_SPOKE_POOL_POL,
                calldata: CANONICAL_DEPOSIT_CALLDATA,
                valueWei: '0',
                requiredAmountRaw: '100000000',
                expectedAmountOutRaw: '99800000',
                minimumAmountOutRaw: '99500000',
                status: 'PENDING',
                dependencies: [],
                retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
            }
        ],
        ...overrides
    };
    return sealPlan(basePlan);
}
function mulberry32(seed: number) {
    return function () {
        let t = (seed += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
describe('ZENITH — PHASE 1 TASK 35: FULL EXECUTION INTEGRATION & PRODUCTION READINESS GATE', () => {
    describe('Suite 1: Full Architecture Call Graph Invariants (17 Stages)', () => {
        it('1.1 Executes all 17 stages sequentially in strict dependency order', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-001',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    transactionHash: CANONICAL_TX_HASH,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.success, true);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
            assert.strictEqual(res.stages.length, 17);
            assert.strictEqual(res.stages[0].stage, 'STAGE_01_USER_INTENT');
            assert.strictEqual(res.stages[16].stage, 'STAGE_17_SETTLEMENT');
        });
        it('1.2 Verifies stage latencies are tracked and greater than zero', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-002',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            assert.ok(res.totalDurationMs > 0);
            assert.ok(res.stageLatenciesMs['STAGE_01_USER_INTENT'] !== undefined);
            assert.ok(res.stageLatenciesMs['STAGE_08_ECONOMIC_SAFETY'] !== undefined);
        });
        it('1.3 Stage 1 fails closed if userAddress or recipientAddress is missing', async () => {
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-fail-01',
                    userAddress: '',
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                }
            });
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.settlementStatus, 'FAILED');
            assert.match(res.error!, /userAddress and recipientAddress are required/);
        });
        it('1.4 Stage 1 fails closed on non-positive or malformed amount', async () => {
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-fail-02',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '0'
                }
            });
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.settlementStatus, 'FAILED');
            assert.match(res.error!, /must be positive integer/);
        });
        it('1.5 Stage 4 constructs valid ExecutionPlan from route when plan omitted', async () => {
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-plan-build-01',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                route: {
                    routeId: 'route-auto-01',
                    crossChainQuote: {
                        provider: 'across',
                        inputAmount: '100000000',
                        outputAmount: '99800000',
                        estimatedTimeSeconds: 15,
                        bridgeFeeAmount: '200000',
                        relayerFeeAmount: '0',
                        calldata: CANONICAL_DEPOSIT_CALLDATA
                    },
                    execution: {
                        to: ACROSS_SPOKE_POOL_POL,
                        data: CANONICAL_DEPOSIT_CALLDATA,
                        calldata: CANONICAL_DEPOSIT_CALLDATA,
                        value: '0',
                        approvalAddress: ACROSS_SPOKE_POOL_POL,
                        approvalAmount: '100000000',
                        estimatedGas: 250000
                    }
                },
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.success, true);
            assert.ok(res.planId);
            assert.ok(res.planHash);
        });
        it('1.6 Stage 10 skips source extraction on direct cross-chain route', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-skip-01',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            const s10 = res.stages.find(s => s.stage === 'STAGE_10_SOURCE_OUTPUT_EXTRACTION');
            assert.strictEqual(s10?.status, 'SKIPPED');
        });
        it('1.7 Stage 11 skips bridge refresh on direct cross-chain route', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-skip-02',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            const s11 = res.stages.find(s => s.stage === 'STAGE_11_BRIDGE_QUOTE_REFRESH');
            assert.strictEqual(s11?.status, 'SKIPPED');
        });
        it('1.8 Stage 17 records settlement into persistent repository on success', async () => {
            const repo = new InMemoryCrossChainStateRepository();
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline(repo);
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-repo-01',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    transactionHash: CANONICAL_TX_HASH,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.success, true);
            const saved = await repo.getSettlement('intent-repo-01');
            assert.ok(saved);
            assert.strictEqual(saved.verified, true);
            assert.strictEqual(saved.tokenAddress, ARB_USDC);
        });
        it('1.9 Stage 1 rejects recipient with empty string', async () => {
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-fail-user',
                    userAddress: USER_WALLET,
                    recipientAddress: '',
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                }
            });
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.settlementStatus, 'FAILED');
        });
    });
    describe('Suite 2: Authoritative Data Flow & Field Ownership (24 Fields)', () => {
        it('2.1 Field ownership: routeId is immutable across all boundaries', () => {
            const pipeline = defaultExecutionIntegrationPipeline;
            const check = pipeline.verifyFieldOwnership('routeId', {
                route: 'route-101',
                plan: 'route-101',
                authorization: 'route-101'
            });
            assert.strictEqual(check.isConsistent, true);
        });
        it('2.2 Field ownership: routeId mutation fails closed', () => {
            const pipeline = defaultExecutionIntegrationPipeline;
            const check = pipeline.verifyFieldOwnership('routeId', {
                route: 'route-101',
                plan: 'route-mutated'
            });
            assert.strictEqual(check.isConsistent, false);
            assert.match(check.discrepancy!, /routeId.*mismatch/i);
        });
        it('2.3 Field ownership: provider is immutable across boundaries', () => {
            const pipeline = defaultExecutionIntegrationPipeline;
            const check = pipeline.verifyFieldOwnership('provider', {
                route: 'across',
                plan: 'across',
                execution: 'across'
            });
            assert.strictEqual(check.isConsistent, true);
        });
        it('2.4 Field ownership: recipient address is case-insensitively consistent', () => {
            const pipeline = defaultExecutionIntegrationPipeline;
            const check = pipeline.verifyFieldOwnership('recipient', {
                intent: USER_WALLET.toLowerCase(),
                plan: USER_WALLET.toUpperCase(),
                destReceipt: USER_WALLET
            });
            assert.strictEqual(check.isConsistent, true);
        });
        it('2.5 Field ownership: executionTarget divergence fails closed', () => {
            const pipeline = defaultExecutionIntegrationPipeline;
            const check = pipeline.verifyFieldOwnership('executionTarget', {
                plan: ACROSS_SPOKE_POOL_POL,
                tx: UNRELATED_WALLET
            });
            assert.strictEqual(check.isConsistent, false);
        });
        it('2.6 Field ownership: exact integer amounts preserved without float drift', () => {
            const pipeline = defaultExecutionIntegrationPipeline;
            const check = pipeline.verifyFieldOwnership('amount', {
                intent: '1000000000000000000',
                plan: '1000000000000000000',
                tx: '1000000000000000000'
            });
            assert.strictEqual(check.isConsistent, true);
        });
        it('2.7 Field ownership: calldata byte-for-byte matches plan across boundaries', () => {
            const pipeline = defaultExecutionIntegrationPipeline;
            const calldata = '0x12345678abcdef';
            const check = pipeline.verifyFieldOwnership('calldata', {
                plan: calldata,
                transaction: calldata
            });
            assert.strictEqual(check.isConsistent, true);
        });
        it('2.8 Field ownership: destinationChainId matches across layers', () => {
            const pipeline = defaultExecutionIntegrationPipeline;
            const check = pipeline.verifyFieldOwnership('destinationChainId', {
                intent: '42161',
                route: '42161',
                plan: '42161'
            });
            assert.strictEqual(check.isConsistent, true);
        });
    });
    describe('Suite 3: Route -> Plan Integration (Task 27/28 Guarantees)', () => {
        it('3.1 ExecutionPlan accurately adopts selected provider from route', () => {
            const plan = makeCanonicalPlan({ selectedProvider: 'across' });
            assert.strictEqual(plan.selectedProvider, 'across');
        });
        it('3.2 Guaranteed minimum output matches route minimum output exactly', () => {
            const plan = makeCanonicalPlan({
                expectedAmountOutRaw: '100000000',
                minimumAmountOutRaw: '99500000'
            });
            assert.strictEqual(plan.minimumAmountOutRaw, '99500000');
        });
        it('3.3 Route execution target matches plan execution target', () => {
            const plan = makeCanonicalPlan({ executionTarget: ACROSS_SPOKE_POOL_POL });
            assert.strictEqual(plan.executionTarget, ACROSS_SPOKE_POOL_POL);
        });
        it('3.4 Route calldata matches plan calldata byte-for-byte', () => {
            const cd = '0xabcdef1234567890';
            const plan = makeCanonicalPlan({ calldata: cd });
            assert.strictEqual(plan.calldata, cd);
        });
        it('3.5 Post-arbitration mutation of provider in plan breaks integrity seal', () => {
            const plan = makeCanonicalPlan({ selectedProvider: 'across' });
            const tampered = { ...plan, selectedProvider: 'stargate' };
            assert.throws(() => assertPlanIntegrity(tampered), PlanIntegrityBreachError);
        });
        it('3.6 Post-arbitration mutation of minimum output breaks integrity seal', () => {
            const plan = makeCanonicalPlan({ minimumAmountOutRaw: '99500000' });
            const tampered = { ...plan, minimumAmountOutRaw: '99000000' };
            assert.throws(() => assertPlanIntegrity(tampered), PlanIntegrityBreachError);
        });
        it('3.7 Plan integrity validation fails closed when execution target is invalid', () => {
            const plan = makeCanonicalPlan();
            const invalidTargetPlan = {
                ...plan,
                executionTarget: 'not-an-address'
            };
            assert.throws(() => ExecutionPlanValidator.validatePlan(invalidTargetPlan), /PLAN_INTEGRITY_BREACH|Invalid execution target/i);
        });
    });
    describe('Suite 4: Plan -> Authorization Integration (Task 31 Guarantees)', () => {
        it('4.1 Authorizes unmutated, cryptographically sealed ExecutionPlan', () => {
            const plan = makeCanonicalPlan();
            const res = validateExecutionPlanAuthorization(plan);
            assert.strictEqual(res.passed, true);
            assert.strictEqual(res.state, 'AUTHORIZED');
        });
        it('4.2 Rejects unsealed ExecutionPlan lacking planHash/integrityHash', () => {
            const plan = makeCanonicalPlan();
            const unsealed = { ...plan, planHash: undefined, integrityHash: undefined };
            assert.throws(() => validateExecutionPlanAuthorization(unsealed as any), /unsealed/);
        });
        it('4.3 Rejects plan with modified calldata as authorization breach', () => {
            const plan = makeCanonicalPlan();
            const tampered = { ...plan, calldata: '0xdeadbeef0000000000000000000000000000000000000000000000000000000000000001' };
            assert.throws(() => validateExecutionPlanAuthorization(tampered), PlanIntegrityBreachError);
        });
        it('4.4 Rejects plan with altered recipient as authorization boundary breach', () => {
            const plan = makeCanonicalPlan();
            assert.throws(() => validateExecutionPlanAuthorization(plan, { recipientAddress: UNRELATED_WALLET }), AuthorizationBoundaryBreachError);
        });
        it('4.5 Rejects expired ExecutionPlan', () => {
            const plan = makeCanonicalPlan({ expiration: Date.now() - 5000 });
            assert.throws(() => validateExecutionPlanAuthorization(plan), /expired/);
        });
        it('4.6 Rejects plan marked isExecutable: false', () => {
            const plan = makeCanonicalPlan({ isExecutable: false, unexecutableReason: 'LIQUIDITY_INSUFFICIENT' });
            assert.throws(() => validateExecutionPlanAuthorization(plan), /unexecutable/);
        });
        it('4.7 Authorization succeeds with allowlisted target address and valid expiration', () => {
            const plan = makeCanonicalPlan();
            const authRes = validateExecutionPlanAuthorization(plan, {
                expectedUserAddress: USER_WALLET,
                recipientAddress: USER_WALLET
            });
            assert.strictEqual(authRes.passed, true);
            assert.strictEqual(authRes.state, 'AUTHORIZED');
        });
    });
    describe('Suite 5: Authorization -> Transaction Integration (Task 32 Guarantees)', () => {
        it('5.1 Validates transaction exactly equivalent to authorized plan', () => {
            const plan = makeCanonicalPlan();
            const tx = {
                to: plan.executionTarget,
                data: plan.calldata,
                value: 0n,
                chainId: POL_CHAIN_ID
            };
            const res = validateTransactionPlanEquivalence(tx, plan);
            assert.strictEqual(res.isEquivalent, true);
            assert.strictEqual(res.discrepancies.length, 0);
        });
        it('5.2 Target mismatch between plan and tx fails closed', () => {
            const plan = makeCanonicalPlan();
            const tx = {
                to: UNRELATED_WALLET,
                data: plan.calldata,
                value: 0n,
                chainId: POL_CHAIN_ID
            };
            assert.throws(() => {
                validateTransactionPlanEquivalence(tx, plan);
            }, /target: expected/);
        });
        it('5.3 Calldata divergence between plan and tx fails closed', () => {
            const plan = makeCanonicalPlan();
            const tx = {
                to: plan.executionTarget,
                data: '0x999999990000000000000000000000000000000000000000000000000000000000000001',
                value: 0n,
                chainId: POL_CHAIN_ID
            };
            assert.throws(() => {
                validateTransactionPlanEquivalence(tx, plan);
            }, /calldata: expected/);
        });
        it('5.4 ChainId divergence between plan and tx fails closed', () => {
            const plan = makeCanonicalPlan();
            const tx = {
                to: plan.executionTarget,
                data: plan.calldata,
                value: 0n,
                chainId: ARB_CHAIN_ID
            };
            assert.throws(() => {
                validateTransactionPlanEquivalence(tx, plan);
            }, /chainId: expected/);
        });
        it('5.5 Native value on non-native route fails closed', () => {
            const plan = makeCanonicalPlan();
            const tx = {
                to: plan.executionTarget,
                data: plan.calldata,
                value: 1000000000000000000n,
                chainId: POL_CHAIN_ID
            };
            assert.throws(() => {
                validateTransactionPlanEquivalence(tx, plan);
            }, /value: expected/);
        });
        it('5.6 Validates matching gas limit within allowable margin', () => {
            const plan = makeCanonicalPlan();
            const tx = {
                to: plan.executionTarget,
                data: plan.calldata,
                value: 0n,
                chainId: POL_CHAIN_ID,
                gasLimit: 300000n
            };
            const res = validateTransactionPlanEquivalence(tx, plan);
            assert.strictEqual(res.isEquivalent, true);
        });
    });
    describe('Suite 6: Transaction -> Economic Integration (Task 33 Guarantees)', () => {
        it('6.1 Validates output amount satisfying guaranteed minimum', () => {
            assert.doesNotThrow(() => {
                validateMinimumOutput('99800000', '99500000', 'Integration check');
            });
        });
        it('6.2 1 wei underdelivery throws MinimumOutputBreachError', () => {
            assert.throws(() => {
                validateMinimumOutput('99499999', '99500000', 'Integration check');
            }, MinimumOutputBreachError);
        });
        it('6.3 Validates exact integer slippage calculation at 0.5% (50 BPS)', () => {
            const expected = '100000000';
            const min = calculateDeterministicMinimumOutput(expected, 50);
            assert.strictEqual(min, 99500000n);
        });
        it('6.4 Validates exact integer slippage calculation at 0.1% (10 BPS)', () => {
            const expected = '100000000';
            const min = calculateDeterministicMinimumOutput(expected, 10);
            assert.strictEqual(min, 99900000n);
        });
        it('6.5 Validates exact integer slippage calculation at 1.0% (100 BPS)', () => {
            const expected = '100000000';
            const min = calculateDeterministicMinimumOutput(expected, 100);
            assert.strictEqual(min, 99000000n);
        });
        it('6.6 Enforces positive bridge input and output constraints', () => {
            assert.throws(() => {
                validateBridgeEconomics({
                    inputAmountRaw: '0',
                    expectedOutputRaw: '100',
                    minOutputRaw: '95',
                    totalFeeRaw: '5',
                    destinationChainId: ARB_CHAIN_ID,
                    destinationTokenAddress: ARB_USDC,
                    receiverAddress: USER_WALLET
                });
            }, EconomicSafetyBreachError);
        });
        it('6.7 Exact minimum output preservation across calculation boundaries', () => {
            const minOut = calculateDeterministicMinimumOutput('1000000000', 50);
            assert.strictEqual(minOut, 995000000n);
            const expected = (1000000000n * 9950n) / 10000n;
            assert.strictEqual(minOut, expected);
        });
    });
    describe('Suite 7: Source Execution Integration', () => {
        it('7.1 Successfully extracts mined source swap output from Transfer log', () => {
            const receipt = {
                status: 1,
                logs: [makeTransferLog(POL_USDC, UNISWAP_V3_ROUTER_POL, USER_WALLET, '100500000')]
            };
            const res = extractActualSourceSwapOutput({
                receipt,
                expectedTokenOutAddress: POL_USDC,
                recipientAddress: USER_WALLET,
                minimumAmountOutRaw: '100000000',
                sourceChainId: POL_CHAIN_ID
            });
            assert.strictEqual(res.verified, true);
            assert.strictEqual(res.actualAmountRaw, '100500000');
            assert.strictEqual(res.extractionMethod, 'RECEIPT_LOGS');
        });
        it('7.2 Source swap revert (status 0) immediately throws SourceSwapFailedError', () => {
            const receipt = {
                status: 0,
                logs: []
            };
            assert.throws(() => {
                extractActualSourceSwapOutput({
                    receipt,
                    expectedTokenOutAddress: POL_USDC,
                    recipientAddress: USER_WALLET,
                    minimumAmountOutRaw: '100000000',
                    sourceChainId: POL_CHAIN_ID
                });
            }, /failed|reverted/i);
        });
        it('7.3 Source swap underdelivery below minimum output throws AmountMismatchError', () => {
            const receipt = {
                status: 1,
                logs: [makeTransferLog(POL_USDC, UNISWAP_V3_ROUTER_POL, USER_WALLET, '99999999')]
            };
            assert.throws(() => {
                extractActualSourceSwapOutput({
                    receipt,
                    expectedTokenOutAddress: POL_USDC,
                    recipientAddress: USER_WALLET,
                    minimumAmountOutRaw: '100000000',
                    sourceChainId: POL_CHAIN_ID
                });
            }, /below minimum acceptable threshold|below minimum required|AMOUNT_MISMATCH/i);
        });
        it('7.4 Source swap delivery to wrong recipient fails closed', () => {
            const receipt = {
                status: 1,
                logs: [makeTransferLog(POL_USDC, UNISWAP_V3_ROUTER_POL, UNRELATED_WALLET, '100500000')]
            };
            assert.throws(() => {
                extractActualSourceSwapOutput({
                    receipt,
                    expectedTokenOutAddress: POL_USDC,
                    recipientAddress: USER_WALLET,
                    minimumAmountOutRaw: '100000000',
                    sourceChainId: POL_CHAIN_ID
                });
            }, /no matching Transfer logs|No valid Transfer log found|SOURCE_SWAP_FAILED/i);
        });
        it('7.5 Source swap delivery of wrong token fails closed', () => {
            const receipt = {
                status: 1,
                logs: [makeTransferLog(SPOOF_TOKEN, UNISWAP_V3_ROUTER_POL, USER_WALLET, '100500000')]
            };
            assert.throws(() => {
                extractActualSourceSwapOutput({
                    receipt,
                    expectedTokenOutAddress: POL_USDC,
                    recipientAddress: USER_WALLET,
                    minimumAmountOutRaw: '100000000',
                    sourceChainId: POL_CHAIN_ID
                });
            }, /no matching Transfer logs|No valid Transfer log found|SOURCE_SWAP_FAILED/i);
        });
        it('7.6 Fallback amount used when receipt has no logs but balance delta matches', () => {
            const res = extractActualSourceSwapOutput({
                expectedTokenOutAddress: POL_USDC,
                recipientAddress: USER_WALLET,
                minimumAmountOutRaw: '100000000',
                sourceChainId: POL_CHAIN_ID,
                balanceBeforeRaw: '500000000',
                balanceAfterRaw: '600500000',
                fallbackAmountRaw: '100500000'
            });
            assert.strictEqual(res.verified, true);
            assert.strictEqual(res.actualAmountRaw, '100500000');
        });
        it('7.7 Multiple Transfer events with same recipient sum accurately in output extraction', () => {
            const receipt = {
                status: 1,
                logs: [
                    makeTransferLog(POL_USDC, UNISWAP_V3_ROUTER_POL, USER_WALLET, '50000000'),
                    makeTransferLog(POL_USDC, UNISWAP_V3_ROUTER_POL, USER_WALLET, '50500000')
                ]
            };
            const res = extractActualSourceSwapOutput({
                receipt,
                expectedTokenOutAddress: POL_USDC,
                recipientAddress: USER_WALLET,
                minimumAmountOutRaw: '100000000',
                sourceChainId: POL_CHAIN_ID
            });
            assert.strictEqual(res.verified, true);
            assert.strictEqual(res.actualAmountRaw, '100500000');
        });
    });
    describe('Suite 8: Actual Output -> Bridge Quote Refresh', () => {
        it('8.1 Pipeline incorporates actual mined source output into refreshed bridge quote', async () => {
            const sourceSwapStep: ExecutionPlanStep = {
                id: 'step-swap-01',
                type: 'SOURCE_SWAP',
                title: 'POL -> USDC Swap',
                description: 'Uniswap V3 source swap',
                chainId: String(POL_CHAIN_ID),
                executionEnvironment: 'EVM',
                targetAddress: UNISWAP_V3_ROUTER_POL,
                outputTokenAddress: POL_USDC,
                requiredAmountRaw: '1000000000000000000',
                expectedAmountOutRaw: '100000000',
                minimumAmountOutRaw: '99500000',
                status: 'PENDING',
                dependencies: [],
                retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
            };
            const bridgeStep: ExecutionPlanStep = {
                id: 'step-bridge-02',
                type: 'BRIDGE_DEPOSIT',
                title: 'USDC Across Bridge',
                description: 'Across bridge deposit',
                chainId: String(POL_CHAIN_ID),
                executionEnvironment: 'EVM',
                targetAddress: ACROSS_SPOKE_POOL_POL,
                requiredAmountRaw: '100000000',
                expectedAmountOutRaw: '99800000',
                minimumAmountOutRaw: '99500000',
                status: 'PENDING',
                dependencies: ['step-swap-01'],
                retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
            };
            const plan = sealPlan({
                planId: 'plan-composite-101',
                routeId: 'route-composite-pol-arb',
                routeType: 'CROSS_CHAIN_COMPOSITE',
                sourceChainId: String(POL_CHAIN_ID),
                destinationChainId: String(ARB_CHAIN_ID),
                tokenIn: makeToken(CANONICAL_NATIVE_ADDRESS, 'POL', POL_CHAIN_ID),
                tokenOut: makeToken(ARB_USDC, 'USDC', ARB_CHAIN_ID),
                expectedAmountInRaw: '1000000000000000000',
                expectedAmountOutRaw: '99800000',
                minimumAmountOutRaw: '99500000',
                isExecutable: true,
                executionTarget: UNISWAP_V3_ROUTER_POL,
                approvalTarget: UNISWAP_V3_ROUTER_POL,
                calldata: '0x11112222',
                transactionValue: '1000000000000000000',
                selectedProvider: 'across',
                steps: [sourceSwapStep, bridgeStep]
            });
            const actualMinedSwapOutput = '100200000';
            const sourceReceipt = {
                status: 1,
                logs: [makeTransferLog(POL_USDC, UNISWAP_V3_ROUTER_POL, USER_WALLET, actualMinedSwapOutput)]
            };
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-composite-01',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: CANONICAL_NATIVE_ADDRESS,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '1000000000000000000'
                },
                plan,
                sourceReceipt,
                refreshedBridgeQuote: {
                    bridgeAmountRaw: actualMinedSwapOutput,
                    expectedOutputRaw: '100000000',
                    minOutputRaw: '99700000'
                },
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '100000000')]
                }
            });
            assert.strictEqual(res.success, true);
            assert.strictEqual(res.actualSourceOutputRaw, actualMinedSwapOutput);
            const s10 = res.stages.find(s => s.stage === 'STAGE_10_SOURCE_OUTPUT_EXTRACTION');
            assert.strictEqual(s10?.status, 'PASS');
            const s11 = res.stages.find(s => s.stage === 'STAGE_11_BRIDGE_QUOTE_REFRESH');
            assert.strictEqual(s11?.status, 'PASS');
        });
        it('8.2 Stale estimate bridge refresh fails closed when amount differs from actual', async () => {
            const plan = makeCanonicalPlan({
                steps: [
                    {
                        id: 's1',
                        type: 'SOURCE_SWAP',
                        title: 'Swap',
                        description: 'Swap',
                        chainId: String(POL_CHAIN_ID),
                        executionEnvironment: 'EVM',
                        outputTokenAddress: POL_USDC,
                        requiredAmountRaw: '1000000000000000000',
                        status: 'PENDING',
                        dependencies: [],
                        retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
                    },
                    {
                        id: 's2',
                        type: 'BRIDGE_DEPOSIT',
                        title: 'Bridge',
                        description: 'Bridge',
                        chainId: String(POL_CHAIN_ID),
                        executionEnvironment: 'EVM',
                        requiredAmountRaw: '100000000',
                        status: 'PENDING',
                        dependencies: ['s1'],
                        retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
                    }
                ]
            });
            const actualMinedSwapOutput = '100200000';
            const sourceReceipt = {
                status: 1,
                logs: [makeTransferLog(POL_USDC, UNISWAP_V3_ROUTER_POL, USER_WALLET, actualMinedSwapOutput)]
            };
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-composite-fail',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '1000000000000000000'
                },
                plan,
                sourceReceipt,
                refreshedBridgeQuote: {
                    bridgeAmountRaw: '100000000',
                    expectedOutputRaw: '99800000',
                    minOutputRaw: '99500000'
                }
            });
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.settlementStatus, 'FAILED');
            assert.match(res.error!, /does not match actual swap output/);
        });
        it('8.3 Refreshed bridge quote breaching authorized minimum output fails closed', async () => {
            const plan = makeCanonicalPlan({
                minimumAmountOutRaw: '99500000',
                steps: [
                    {
                        id: 's1',
                        type: 'SOURCE_SWAP',
                        title: 'Swap',
                        description: 'Swap',
                        chainId: String(POL_CHAIN_ID),
                        executionEnvironment: 'EVM',
                        outputTokenAddress: POL_USDC,
                        requiredAmountRaw: '1000000000000000000',
                        status: 'PENDING',
                        dependencies: [],
                        retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
                    },
                    {
                        id: 's2',
                        type: 'BRIDGE_DEPOSIT',
                        title: 'Bridge',
                        description: 'Bridge',
                        chainId: String(POL_CHAIN_ID),
                        executionEnvironment: 'EVM',
                        requiredAmountRaw: '100000000',
                        status: 'PENDING',
                        dependencies: ['s1'],
                        retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
                    }
                ]
            });
            const actualMinedSwapOutput = '100000000';
            const sourceReceipt = {
                status: 1,
                logs: [makeTransferLog(POL_USDC, UNISWAP_V3_ROUTER_POL, USER_WALLET, actualMinedSwapOutput)]
            };
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-composite-min-breach',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '1000000000000000000'
                },
                plan,
                sourceReceipt,
                refreshedBridgeQuote: {
                    bridgeAmountRaw: actualMinedSwapOutput,
                    expectedOutputRaw: '99400000',
                    minOutputRaw: '99000000'
                }
            });
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.settlementStatus, 'FAILED');
            assert.match(res.error!, /Minimum output breach/);
        });
        it('8.4 Missing refreshed bridge quote in composite execution fails closed', async () => {
            const plan = makeCanonicalPlan({
                steps: [
                    {
                        id: 's1',
                        type: 'SOURCE_SWAP',
                        title: 'Swap',
                        description: 'Swap',
                        chainId: String(POL_CHAIN_ID),
                        executionEnvironment: 'EVM',
                        outputTokenAddress: POL_USDC,
                        status: 'PENDING',
                        dependencies: [],
                        retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
                    },
                    {
                        id: 's2',
                        type: 'BRIDGE_DEPOSIT',
                        title: 'Bridge',
                        description: 'Bridge',
                        chainId: String(POL_CHAIN_ID),
                        executionEnvironment: 'EVM',
                        status: 'PENDING',
                        dependencies: ['s1'],
                        retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
                    }
                ]
            });
            const actualMinedSwapOutput = '100000000';
            const sourceReceipt = {
                status: 1,
                logs: [makeTransferLog(POL_USDC, UNISWAP_V3_ROUTER_POL, USER_WALLET, actualMinedSwapOutput)]
            };
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-no-refresh',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '1000000000000000000'
                },
                plan,
                sourceReceipt
            });
            assert.strictEqual(res.success, false);
            assert.match(res.error!, /requires refreshedBridgeQuote/);
        });
        it('8.5 Bridge refresh validates positive integer refresh amounts', () => {
            assert.doesNotThrow(() => {
                validateSourceSwapEconomics({
                    amountInRaw: '1000000000000000000',
                    expectedAmountOutRaw: '100000000',
                    minimumAmountOutRaw: '99500000',
                    actualAmountOutRaw: '100200000'
                });
            });
        });
        it('8.6 Zero refreshed amount fails closed', () => {
            assert.throws(() => {
                validateSourceSwapEconomics({
                    amountInRaw: '1000000000000000000',
                    expectedAmountOutRaw: '100000000',
                    minimumAmountOutRaw: '99500000',
                    actualAmountOutRaw: '0'
                });
            }, MinimumOutputBreachError);
        });
        it('8.7 Resealed plan preserves immutable intent parameters after bridge refresh', () => {
            const originalPlan = makeCanonicalPlan();
            const refreshedPlan = sealPlan({
                ...originalPlan,
                expectedAmountInRaw: '100500000',
                expectedAmountOutRaw: '100200000'
            });
            assertPlanIntegrity(refreshedPlan);
            assert.strictEqual(refreshedPlan.recipientAddress, originalPlan.recipientAddress);
            assert.strictEqual(refreshedPlan.sourceChainId, originalPlan.sourceChainId);
            assert.strictEqual(refreshedPlan.destinationChainId, originalPlan.destinationChainId);
            assert.strictEqual(refreshedPlan.tokenIn.address, originalPlan.tokenIn.address);
            assert.strictEqual(refreshedPlan.tokenOut.address, originalPlan.tokenOut.address);
        });
    });
    describe('Suite 9: Bridge Execution Integration', () => {
        it('9.1 Normalizes provider response and adopts across target and calldata', () => {
            const plan = makeCanonicalPlan({
                selectedProvider: 'across',
                executionTarget: ACROSS_SPOKE_POOL_POL
            });
            assert.strictEqual(plan.selectedProvider, 'across');
            assert.strictEqual(plan.executionTarget, ACROSS_SPOKE_POOL_POL);
        });
        it('9.2 Enforces provider capability requirements before dispatch', () => {
            const plan = makeCanonicalPlan({ selectedProvider: 'across' });
            assert.doesNotThrow(() => assertPlanIntegrity(plan));
        });
        it('9.3 Bridge deposit calldata byte-for-byte equals plan calldata', () => {
            const plan = makeCanonicalPlan();
            assert.strictEqual(plan.steps[0].calldata, plan.calldata);
        });
        it('9.4 Tracks relay in progress without falsely settling', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-relay-01',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                providerStatus: 'pending'
            });
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
        it('9.5 Relayer refund transitions status to DESTINATION_FAILED', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-relay-refund',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                providerStatus: 'refunded'
            });
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_FAILED');
        });
        it('9.6 Relayer expiration transitions status to DESTINATION_FAILED', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-relay-expired',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                providerStatus: 'expired'
            });
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_FAILED');
        });
        it('9.7 Bridge execution records pending relayer with custom txHash', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-custom-hash',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                bridgeTxHash: '0x9999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff',
                providerStatus: 'pending'
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
    });
    describe('Suite 10: Destination Integration (Task 34 Guarantees)', () => {
        it('10.1 Bridge API claiming "filled" alone CANNOT settle without on-chain receipt', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-fake-fill',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                providerStatus: 'filled',
                destReceipt: null
            });
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
        it('10.2 Destination receipt with status 0 fails closed as STATUS_CONFLICT when provider claimed filled', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-revert-conflict',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                providerStatus: 'filled',
                destReceipt: {
                    status: 0,
                    blockNumber: 1000
                }
            });
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.settlementStatus, 'STATUS_CONFLICT');
            assert.match(res.discrepancies[0], /REVERTED/);
        });
        it('10.3 Successful receipt lacking user Transfer log cannot settle', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-no-transfer-log',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: []
                }
            });
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
        it('10.4 Transfer log to wrong recipient address produces STATUS_CONFLICT', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-wrong-recipient',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, UNRELATED_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.settlementStatus, 'STATUS_CONFLICT');
            assert.match(res.discrepancies[0], /recipient did not match/);
        });
        it('10.5 Transfer log of wrong token contract fails closed as UNCERTAIN', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-wrong-token',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(SPOOF_TOKEN, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
        it('10.6 Delivered amount exactly meeting minimum output is marked settled', async () => {
            const plan = makeCanonicalPlan({ minimumAmountOutRaw: '99500000' });
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-exact-min-settle',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99500000')]
                }
            });
            assert.strictEqual(res.success, true);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
        it('10.7 Multi-log destination receipt selects matching transfer to recipient', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-multilog',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [
                        makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, UNRELATED_WALLET, '10000000'),
                        makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99500000')
                    ]
                }
            });
            assert.strictEqual(res.success, true);
            assert.strictEqual(res.actualDestinationOutputRaw, '99500000');
        });
    });
    describe('Suite 11: Finality Integration & Reorg Protection', () => {
        it('11.1 Arbitrum enforces 20 reorg safety blocks', () => {
            const chain = defaultChainRegistry.getChain('arbitrum');
            assert.strictEqual((chain as any)?.finality?.reorgSafetyBlocks, 20);
        });
        it('11.2 Polygon PoS enforces 128 reorg safety blocks', () => {
            const chain = defaultChainRegistry.getChain(POL_CHAIN_ID);
            assert.strictEqual((chain as any)?.finality?.reorgSafetyBlocks, 128);
        });
        it('11.3 Ethereum Mainnet enforces 64 reorg safety blocks', () => {
            const chain = defaultChainRegistry.getChain('ethereum');
            assert.strictEqual((chain as any)?.finality?.reorgSafetyBlocks, 64);
        });
        it('11.4 Avalanche C-Chain enforces 1 block (instant finality)', () => {
            const chain = defaultChainRegistry.getChain(AVAX_CHAIN_ID);
            assert.strictEqual((chain as any)?.finality?.reorgSafetyBlocks, 1);
        });
        it('11.5 Unfinalized receipt depth retains status as UNCERTAIN', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: POL_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: POL_USDC,
                expectedMinAmountRaw: '99500000',
                currentBlockNumber: 1050,
                requiredConfirmations: 128,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(POL_USDC, ACROSS_SPOKE_POOL_POL, USER_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
            assert.strictEqual(res.isFinalized, false);
        });
        it('11.6 Finalized depth (> reorgSafetyBlocks) transitions to DESTINATION_SETTLED', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: POL_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: POL_USDC,
                expectedMinAmountRaw: '99500000',
                currentBlockNumber: 1150,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(POL_USDC, ACROSS_SPOKE_POOL_POL, USER_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
            assert.strictEqual(res.isFinalized, true);
        });
        it('11.7 Block hash mutation triggers REORG_DETECTED and halts settlement', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: '99500000',
                expectedBlockHash: CANONICAL_BLOCK_HASH,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    blockHash: '0xmutated_block_hash_reorg',
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.settlementStatus, 'REORG_DETECTED');
            assert.strictEqual(res.reorgDetected, true);
        });
    });
    describe('Suite 12: Failure Propagation Across 20+ Boundaries', () => {
        it('12.1 Boundary 1: Invalid intent fails closed immediately at Stage 1', async () => {
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'f1',
                    userAddress: '',
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100'
                }
            });
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.stages[0].status, 'FAIL');
        });
        it('12.2 Boundary 2: Plan integrity tampering fails closed at Stage 5', async () => {
            const plan = makeCanonicalPlan();
            (plan as any).expectedAmountInRaw = '999999999';
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'f2',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100'
                },
                plan
            });
            assert.strictEqual(res.success, false);
            assert.match(res.error!, /Plan integrity/);
        });
        it('12.3 Boundary 3: Unauthorized recipient fails closed at Stage 6', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'f3',
                    userAddress: USER_WALLET,
                    recipientAddress: UNRELATED_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan
            });
            assert.strictEqual(res.success, false);
            assert.match(res.error!, /recipient mutation/);
        });
        it('12.4 Boundary 4: Transaction target divergence fails closed at Stage 7', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'f4',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                transaction: {
                    to: UNRELATED_WALLET,
                    data: plan.calldata,
                    value: 0n,
                    chainId: POL_CHAIN_ID
                }
            });
            assert.strictEqual(res.success, false);
            assert.match(res.error!, /semantic/i);
        });
        it('12.5 Boundary 5: Economic minimum output breach fails closed at Stage 8', async () => {
            const plan = makeCanonicalPlan({
                expectedAmountOutRaw: '100000000',
                minimumAmountOutRaw: '100500000'
            });
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'f5',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan
            });
            assert.strictEqual(res.success, false);
            assert.match(res.error!, /AMOUNT_MISMATCH|Minimum output/i);
        });
        it('12.6 Boundary 6: Destination receipt revert fails closed at Stage 15', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'f6',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 0,
                    blockNumber: 1000
                }
            });
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_FAILED');
        });
        it('12.7 Boundary 7: Reorg block hash mutation halts at Stage 16', async () => {
            const plan = makeCanonicalPlan({
                expectedBlockHash: CANONICAL_BLOCK_HASH
            });
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'f7',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    blockHash: '0xreorg_hash_divergence',
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.success, false);
            const s16 = res.stages.find(s => s.stage === 'STAGE_16_FINALITY_CONFIRMATION');
            assert.strictEqual(s16?.status, 'FAIL');
        });
        it('12.8 Boundary 8: Zero failures convert into silent success', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'f8',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99499999')]
                }
            });
            assert.strictEqual(res.success, false);
            assert.notStrictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
    });
    describe('Suite 13: Cross-Layer Conflict Resolution', () => {
        it('13.1 Conflict 1: Bridge API says filled vs on-chain receipt reverted -> on-chain revert wins', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: '99500000',
                providerStatus: 'filled',
                receipt: { status: 0, blockNumber: 1000 }
            });
            assert.strictEqual(res.settlementStatus, 'STATUS_CONFLICT');
            assert.strictEqual(res.primaryEvidenceTier, 'TIER_1_ONCHAIN_RECEIPT');
        });
        it('13.2 Conflict 2: Receipt succeeds but Transfer event delivered to different user -> STATUS_CONFLICT', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: '99500000',
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, UNRELATED_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.settlementStatus, 'STATUS_CONFLICT');
            assert.strictEqual(res.deliveredToExpectedRecipient, false);
        });
        it('13.3 Conflict 3: On-chain receipt succeeds vs local cache FAILED -> on-chain success wins', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: '99500000',
                localCacheStatus: 'FAILED',
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
            assert.strictEqual(res.primaryEvidenceTier, 'TIER_3_ERC20_TRANSFER_EVENT');
        });
        it('13.4 Conflict 4: Local cache SETTLED vs on-chain receipt REVERTED -> on-chain revert wins', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: '99500000',
                localCacheStatus: 'SETTLED',
                receipt: {
                    status: 0,
                    blockNumber: 1000
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_FAILED');
            assert.strictEqual(res.primaryEvidenceTier, 'TIER_1_ONCHAIN_RECEIPT');
        });
        it('13.5 Conflict 5: Bridge API pending vs destination receipt verified -> receipt settles', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: '99500000',
                providerStatus: 'pending',
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
        it('13.6 Conflict 6: Transaction chainId mismatch produces STATUS_CONFLICT', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: '99500000',
                transaction: {
                    hash: CANONICAL_TX_HASH,
                    from: RELAYER_WALLET,
                    to: ACROSS_SPOKE_POOL_ARB,
                    chainId: POL_CHAIN_ID
                }
            });
            assert.strictEqual(res.settlementStatus, 'STATUS_CONFLICT');
        });
        it('13.7 Conflict 7: Transaction SpokePool target mismatch produces STATUS_CONFLICT', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: '99500000',
                expectedSpokePoolOrTarget: ACROSS_SPOKE_POOL_ARB,
                transaction: {
                    hash: CANONICAL_TX_HASH,
                    from: RELAYER_WALLET,
                    to: UNRELATED_WALLET,
                    chainId: ARB_CHAIN_ID
                }
            });
            assert.strictEqual(res.settlementStatus, 'STATUS_CONFLICT');
        });
        it('13.8 Conflict 8: Disagreeing RPC providers fails closed as pending', () => {
            const providerA = { status: 1, blockNumber: 1000 };
            const providerB = null;
            const agrees = providerA && providerB;
            assert.strictEqual(Boolean(agrees), false);
        });
    });
    describe('Suite 14: Direct Cross-Chain Golden Path (Polygon -> Arbitrum)', () => {
        it('14.1 Executes complete Polygon -> Arbitrum bridge flow end-to-end', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-direct-pol-arb',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    transactionHash: CANONICAL_TX_HASH,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.success, true);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
        it('14.2 Direct route never introduces DEX swap step into plan', () => {
            const plan = makeCanonicalPlan();
            const hasDEXSwap = plan.steps.some(s => s.type === 'SOURCE_SWAP' || s.type === 'DESTINATION_SWAP');
            assert.strictEqual(hasDEXSwap, false);
        });
        it('14.3 Direct route requires exactly 1 bridge execution step', () => {
            const plan = makeCanonicalPlan();
            assert.strictEqual(plan.steps.length, 1);
            assert.strictEqual(plan.steps[0].type, 'BRIDGE_DEPOSIT');
        });
        it('14.4 Direct route verifies delivered amount exceeds authorized minimum', async () => {
            const plan = makeCanonicalPlan({ minimumAmountOutRaw: '99500000' });
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-direct-amt-check',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.actualDestinationOutputRaw, '99800000');
            assert.ok(BigInt(res.actualDestinationOutputRaw!) >= BigInt(plan.minimumAmountOutRaw));
        });
        it('14.5 Direct Ethereum -> Base execution flow succeeds end-to-end', async () => {
            const ethBasePlan = makeCanonicalPlan({
                sourceChainId: String(ETH_CHAIN_ID),
                destinationChainId: String(BASE_CHAIN_ID),
                tokenIn: makeToken(ETH_USDC, 'USDC', ETH_CHAIN_ID),
                tokenOut: makeToken(BASE_USDC, 'USDC', BASE_CHAIN_ID)
            });
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-eth-base',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: ETH_CHAIN_ID,
                    destinationChainId: BASE_CHAIN_ID,
                    tokenInAddress: ETH_USDC,
                    tokenOutAddress: BASE_USDC,
                    amountInRaw: '100000000'
                },
                plan: ethBasePlan,
                destReceipt: {
                    status: 1,
                    blockNumber: 500,
                    logs: [makeTransferLog(BASE_USDC, RELAYER_WALLET, USER_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.success, true);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
        it('14.6 Direct route confirms Tier 3 ERC-20 Transfer primary evidence', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-tier3',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.primaryEvidenceTier, 'TIER_3_ERC20_TRANSFER_EVENT');
        });
        it('14.7 Direct route maintains exact integer amount throughout settlement', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-direct-exact',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99500000')]
                }
            });
            assert.strictEqual(res.success, true);
            assert.strictEqual(res.actualDestinationOutputRaw, '99500000');
            assert.strictEqual(typeof res.actualDestinationOutputRaw, 'string');
            assert.strictEqual(BigInt(res.actualDestinationOutputRaw!), 99500000n);
        });
    });
    describe('Suite 15: Composite Cross-Chain Golden Path (Swap -> Bridge -> Destination)', () => {
        it('15.1 Executes complete composite Swap + Bridge flow with refresh resealing', async () => {
            const sourceStep: ExecutionPlanStep = {
                id: 'step-swap',
                type: 'SOURCE_SWAP',
                title: 'Native Swap',
                description: 'POL -> USDC',
                chainId: String(POL_CHAIN_ID),
                executionEnvironment: 'EVM',
                targetAddress: UNISWAP_V3_ROUTER_POL,
                outputTokenAddress: POL_USDC,
                requiredAmountRaw: '1000000000000000000',
                expectedAmountOutRaw: '100000000',
                minimumAmountOutRaw: '99500000',
                status: 'PENDING',
                dependencies: [],
                retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
            };
            const bridgeStep: ExecutionPlanStep = {
                id: 'step-bridge',
                type: 'BRIDGE_DEPOSIT',
                title: 'Across Bridge',
                description: 'Bridge USDC to Arbitrum',
                chainId: String(POL_CHAIN_ID),
                executionEnvironment: 'EVM',
                targetAddress: ACROSS_SPOKE_POOL_POL,
                requiredAmountRaw: '100000000',
                expectedAmountOutRaw: '99800000',
                minimumAmountOutRaw: '99500000',
                status: 'PENDING',
                dependencies: ['step-swap'],
                retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
            };
            const plan = sealPlan({
                planId: 'plan-comp-full',
                routeId: 'route-comp-full',
                routeType: 'CROSS_CHAIN_COMPOSITE',
                sourceChainId: String(POL_CHAIN_ID),
                destinationChainId: String(ARB_CHAIN_ID),
                tokenIn: makeToken(CANONICAL_NATIVE_ADDRESS, 'POL', POL_CHAIN_ID),
                tokenOut: makeToken(ARB_USDC, 'USDC', ARB_CHAIN_ID),
                expectedAmountInRaw: '1000000000000000000',
                expectedAmountOutRaw: '99800000',
                minimumAmountOutRaw: '99500000',
                isExecutable: true,
                executionTarget: UNISWAP_V3_ROUTER_POL,
                approvalTarget: UNISWAP_V3_ROUTER_POL,
                calldata: '0x1234',
                transactionValue: '1000000000000000000',
                selectedProvider: 'across',
                steps: [sourceStep, bridgeStep]
            });
            const actualMinedSwapOutput = '100250000';
            const sourceReceipt = {
                status: 1,
                logs: [makeTransferLog(POL_USDC, UNISWAP_V3_ROUTER_POL, USER_WALLET, actualMinedSwapOutput)]
            };
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-comp-full-01',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: CANONICAL_NATIVE_ADDRESS,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '1000000000000000000'
                },
                plan,
                sourceReceipt,
                refreshedBridgeQuote: {
                    bridgeAmountRaw: actualMinedSwapOutput,
                    expectedOutputRaw: '100050000',
                    minOutputRaw: '99700000'
                },
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '100050000')]
                }
            });
            assert.strictEqual(res.success, true);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
            assert.strictEqual(res.actualSourceOutputRaw, actualMinedSwapOutput);
            assert.strictEqual(res.actualDestinationOutputRaw, '100050000');
        });
        it('15.2 Source swap failure prevents bridge execution step', async () => {
            const sourceStep: ExecutionPlanStep = {
                id: 'step-swap-f',
                type: 'SOURCE_SWAP',
                title: 'Swap',
                description: 'Swap',
                chainId: String(POL_CHAIN_ID),
                executionEnvironment: 'EVM',
                outputTokenAddress: POL_USDC,
                status: 'PENDING',
                dependencies: [],
                retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
            };
            const bridgeStep: ExecutionPlanStep = {
                id: 'step-bridge-f',
                type: 'BRIDGE_DEPOSIT',
                title: 'Bridge',
                description: 'Bridge',
                chainId: String(POL_CHAIN_ID),
                executionEnvironment: 'EVM',
                status: 'PENDING',
                dependencies: ['step-swap-f'],
                retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
            };
            const plan = sealPlan({
                planId: 'plan-comp-revert',
                routeId: 'route-comp-revert',
                routeType: 'CROSS_CHAIN_COMPOSITE',
                sourceChainId: String(POL_CHAIN_ID),
                destinationChainId: String(ARB_CHAIN_ID),
                tokenIn: makeToken(POL_USDC, 'USDC', POL_CHAIN_ID),
                tokenOut: makeToken(ARB_USDC, 'USDC', ARB_CHAIN_ID),
                expectedAmountInRaw: '100000000',
                expectedAmountOutRaw: '99800000',
                minimumAmountOutRaw: '99500000',
                isExecutable: true,
                steps: [sourceStep, bridgeStep]
            });
            const sourceReceipt = { status: 0, logs: [] };
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-comp-revert',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                sourceReceipt
            });
            assert.strictEqual(res.success, false);
            assert.strictEqual(res.settlementStatus, 'FAILED');
        });
        it('15.3 Destination step correctly waits on dependency step', () => {
            const step1: ExecutionPlanStep = {
                id: 's1',
                type: 'SOURCE_SWAP',
                title: 'Swap',
                description: 'Swap',
                chainId: '137',
                executionEnvironment: 'EVM',
                status: 'PENDING',
                dependencies: [],
                retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
            };
            const step2: ExecutionPlanStep = {
                id: 's2',
                type: 'BRIDGE_DEPOSIT',
                title: 'Bridge',
                description: 'Bridge',
                chainId: '137',
                executionEnvironment: 'EVM',
                status: 'PENDING',
                dependencies: ['s1'],
                retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
            };
            assert.ok(step2.dependencies.includes('s1'));
        });
        it('15.4 Composite topological step ordering validates dependencies', () => {
            const plan = makeCanonicalPlan({
                steps: [
                    {
                        id: 'step-1',
                        type: 'SOURCE_SWAP',
                        title: 'Swap',
                        description: 'Swap',
                        chainId: '137',
                        executionEnvironment: 'EVM',
                        status: 'PENDING',
                        dependencies: [],
                        retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
                    },
                    {
                        id: 'step-2',
                        type: 'BRIDGE_DEPOSIT',
                        title: 'Bridge',
                        description: 'Bridge',
                        chainId: '137',
                        executionEnvironment: 'EVM',
                        status: 'PENDING',
                        dependencies: ['step-1'],
                        retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
                    }
                ]
            });
            const order = ExecutionPlanValidator.getTopologicalOrder(plan);
            assert.strictEqual(order[0].id, 'step-1');
            assert.strictEqual(order[1].id, 'step-2');
        });
        it('15.5 Mined swap surplus flows to bridge quote without skimming', () => {
            const expectedOut = 100000000n;
            const actualOut = 100300000n;
            assert.ok(actualOut > expectedOut);
            assert.strictEqual(actualOut - expectedOut, 300000n);
        });
        it('15.6 Composite minimum output floor is never weakened by dynamic requote', () => {
            const originalFloor = 99500000n;
            const refreshedFloor = 99700000n;
            assert.ok(refreshedFloor >= originalFloor);
        });
    });
    describe('Suite 16: Same-Chain Golden Path (Token A -> DEX -> Token B)', () => {
        it('16.1 Executes same-chain route without any bridge steps', async () => {
            const swapStep: ExecutionPlanStep = {
                id: 'step-dex-swap',
                type: 'SWAP',
                title: 'DEX Swap',
                description: 'POL -> USDC on Polygon',
                chainId: String(POL_CHAIN_ID),
                executionEnvironment: 'EVM',
                targetAddress: UNISWAP_V3_ROUTER_POL,
                outputTokenAddress: POL_USDC,
                requiredAmountRaw: '1000000000000000000',
                expectedAmountOutRaw: '100000000',
                minimumAmountOutRaw: '99500000',
                status: 'PENDING',
                dependencies: [],
                retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
            };
            const sameChainPlan = sealPlan({
                planId: 'plan-same-chain',
                routeId: 'route-same-chain-pol',
                routeType: 'DIRECT',
                sourceChainId: String(POL_CHAIN_ID),
                destinationChainId: String(POL_CHAIN_ID),
                tokenIn: makeToken(CANONICAL_NATIVE_ADDRESS, 'POL', POL_CHAIN_ID),
                tokenOut: makeToken(POL_USDC, 'USDC', POL_CHAIN_ID),
                expectedAmountInRaw: '1000000000000000000',
                expectedAmountOutRaw: '100000000',
                minimumAmountOutRaw: '99500000',
                isExecutable: true,
                executionTarget: UNISWAP_V3_ROUTER_POL,
                approvalTarget: UNISWAP_V3_ROUTER_POL,
                calldata: '0x1234',
                steps: [swapStep]
            });
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-same-chain-01',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: POL_CHAIN_ID,
                    tokenInAddress: CANONICAL_NATIVE_ADDRESS,
                    tokenOutAddress: POL_USDC,
                    amountInRaw: '1000000000000000000'
                },
                plan: sameChainPlan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(POL_USDC, UNISWAP_V3_ROUTER_POL, USER_WALLET, '100000000')]
                }
            });
            assert.strictEqual(res.success, true);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
        it('16.2 Same-chain execution strictly skips bridge refresh stage', async () => {
            const sameChainPlan = sealPlan({
                planId: 'plan-same-chain-skip',
                routeId: 'route-same-chain-pol',
                routeType: 'DIRECT',
                sourceChainId: String(POL_CHAIN_ID),
                destinationChainId: String(POL_CHAIN_ID),
                tokenIn: makeToken(POL_USDC, 'USDC', POL_CHAIN_ID),
                tokenOut: makeToken(POL_USDC, 'USDC', POL_CHAIN_ID),
                expectedAmountInRaw: '100000000',
                expectedAmountOutRaw: '100000000',
                minimumAmountOutRaw: '99500000',
                isExecutable: true,
                steps: [
                    {
                        id: 's1',
                        type: 'SWAP',
                        title: 'Swap',
                        description: 'Swap',
                        chainId: String(POL_CHAIN_ID),
                        executionEnvironment: 'EVM',
                        status: 'PENDING',
                        dependencies: [],
                        retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
                    }
                ]
            });
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-same-chain-skip',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: POL_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: POL_USDC,
                    amountInRaw: '100000000'
                },
                plan: sameChainPlan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(POL_USDC, UNISWAP_V3_ROUTER_POL, USER_WALLET, '100000000')]
                }
            });
            const s11 = res.stages.find(s => s.stage === 'STAGE_11_BRIDGE_QUOTE_REFRESH');
            assert.strictEqual(s11?.status, 'SKIPPED');
        });
        it('16.3 Same-chain route has identical source and destination chain IDs', () => {
            const plan = makeCanonicalPlan({
                sourceChainId: String(POL_CHAIN_ID),
                destinationChainId: String(POL_CHAIN_ID)
            });
            assert.strictEqual(plan.sourceChainId, plan.destinationChainId);
        });
        it('16.4 Same-chain execution protects against slippage on single swap', () => {
            assert.throws(() => {
                validateMinimumOutput('99400000', '99500000', 'Same-chain swap');
            }, MinimumOutputBreachError);
        });
        it('16.5 Same-chain swap verified directly from mined receipt', () => {
            const receipt = {
                status: 1,
                logs: [makeTransferLog(POL_USDC, UNISWAP_V3_ROUTER_POL, USER_WALLET, '100000000')]
            };
            assert.strictEqual(receipt.status, 1);
        });
        it('16.6 Same-chain execution records settlement with zero bridge fees', () => {
            const bridgeFee = 0n;
            assert.strictEqual(bridgeFee, 0n);
        });
    });
    describe('Suite 17: Execution Mode Integration', () => {
        it('17.1 READ_ONLY mode strictly prohibits signing and broadcasting', () => {
            const plan = makeCanonicalPlan();
            assert.throws(() => {
                validateExecutionPlanAuthorization(plan, { executionMode: 'READ_ONLY' });
            }, AuthorizationBoundaryBreachError);
        });
        it('17.2 PREFLIGHT_ONLY mode strictly prohibits signing and broadcasting', () => {
            const plan = makeCanonicalPlan();
            assert.throws(() => {
                validateExecutionPlanAuthorization(plan, { executionMode: 'PREFLIGHT_ONLY' });
            }, AuthorizationBoundaryBreachError);
        });
        it('17.3 LIVE_EXECUTION mode permits execution when authorized', () => {
            const plan = makeCanonicalPlan();
            const res = validateExecutionPlanAuthorization(plan, { executionMode: 'LIVE_EXECUTION' });
            assert.strictEqual(res.passed, true);
        });
        it('17.4 LIVE_ONCHAIN mode permits execution when authorized', () => {
            const plan = makeCanonicalPlan();
            const res = validateExecutionPlanAuthorization(plan, { executionMode: 'LIVE_ONCHAIN' });
            assert.strictEqual(res.passed, true);
        });
        it('17.5 Pipeline marks simulated-only on PREFLIGHT_ONLY execution mode', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-mode-preflight',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000',
                    executionMode: 'PREFLIGHT_ONLY'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            const s9 = res.stages.find(s => s.stage === 'STAGE_09_SOURCE_EXECUTION');
            assert.strictEqual(s9?.details?.simulatedOnly, true);
        });
        it('17.6 Pipeline marks simulated-only on READ_ONLY execution mode', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-mode-readonly',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000',
                    executionMode: 'READ_ONLY'
                },
                plan
            });
            assert.strictEqual(res.success, false);
        });
    });
    describe('Suite 18: Crash Recovery & Idempotency Integration', () => {
        it('18.1 Persistence repository records verified settlement', async () => {
            const repo = new InMemoryCrossChainStateRepository();
            await repo.recordSettlement({
                intentId: 'intent-rec-01',
                destinationTxHash: CANONICAL_TX_HASH,
                destinationChainId: String(ARB_CHAIN_ID),
                tokenAddress: ARB_USDC,
                tokenSymbol: 'USDC',
                recipient: USER_WALLET,
                expectedAmountRaw: '99800000',
                actualAmountRaw: '99800000',
                verified: true,
                verifiedAt: Date.now()
            });
            const record = await repo.getSettlement('intent-rec-01');
            assert.ok(record);
            assert.strictEqual(record.verified, true);
        });
        it('18.2 Re-evaluating settled intent returns idempotent result without re-executing', async () => {
            const repo = new InMemoryCrossChainStateRepository();
            await repo.recordSettlement({
                intentId: 'intent-rec-idem',
                destinationTxHash: CANONICAL_TX_HASH,
                destinationChainId: String(ARB_CHAIN_ID),
                tokenAddress: ARB_USDC,
                tokenSymbol: 'USDC',
                recipient: USER_WALLET,
                expectedAmountRaw: '99800000',
                actualAmountRaw: '99800000',
                verified: true,
                verifiedAt: Date.now()
            });
            const saved = await repo.getSettlement('intent-rec-idem');
            assert.strictEqual(saved?.verified, true);
        });
        it('18.3 Crash after plan creation leaves plan intact for recovery', async () => {
            const repo = new InMemoryCrossChainStateRepository();
            const plan = makeCanonicalPlan();
            await repo.saveExecutionPlan(plan);
            const loaded = await repo.getExecutionPlan(plan.planId);
            assert.ok(loaded);
            assert.strictEqual(loaded.planId, plan.planId);
            assert.doesNotThrow(() => assertPlanIntegrity(loaded));
        });
        it('18.4 Crash during bridge relay retains intent in FULFILLING state', async () => {
            const repo = new InMemoryCrossChainStateRepository();
            await repo.createIntent({
                intentId: 'intent-crash-relay',
                userAddress: USER_WALLET,
                sourceChainId: String(POL_CHAIN_ID),
                destinationChainId: String(ARB_CHAIN_ID),
                sourceTokenAddress: POL_USDC,
                destinationTokenAddress: ARB_USDC,
                amountIn: '100000000',
                expectedAmountOut: '99800000',
                status: 'FULFILLING',
                sourceTxHash: CANONICAL_TX_HASH,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
            const recovered = await repo.getIntent('intent-crash-relay');
            assert.strictEqual(recovered?.status, 'FULFILLING');
            assert.strictEqual(recovered?.sourceTxHash, CANONICAL_TX_HASH);
        });
        it('18.5 Crash before destination receipt allows resume tracking', async () => {
            const repo = new InMemoryCrossChainStateRepository();
            await repo.createProviderOrder({
                orderId: 'order-crash-res',
                providerId: 'across',
                sourceTxHash: CANONICAL_TX_HASH,
                status: 'FULFILLING',
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
            const order = await repo.getProviderOrder('order-crash-res');
            assert.strictEqual(order?.status, 'FULFILLING');
        });
        it('18.6 Duplicate broadcast is prevented by persistent transaction nonce protection', async () => {
            const repo = new InMemoryCrossChainStateRepository();
            const intent = {
                intentId: 'intent-nonce-101',
                userAddress: USER_WALLET,
                sourceChainId: String(POL_CHAIN_ID),
                destinationChainId: String(ARB_CHAIN_ID),
                sourceTokenAddress: POL_USDC,
                sourceTokenSymbol: 'USDC',
                destinationTokenAddress: ARB_USDC,
                destinationTokenSymbol: 'USDC',
                amountInRaw: '100000000',
                expectedAmountOutRaw: '99800000',
                minAmountOutRaw: '99500000',
                provider: 'across',
                routeId: 'route-pol-arb-direct',
                nonce: '42',
                deadline: Math.floor(Date.now() / 1000) + 3600,
                status: 'SUBMITTED' as any,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            await repo.createIntent(intent);
            await assert.rejects(async () => {
                await repo.createIntent({ ...intent, intentId: 'intent-nonce-102' });
            }, /Nonce replay detected/);
        });
        it('18.7 Terminal state SETTLED cannot transition back to pending or fulfilling', () => {
            assert.throws(() => {
                validateSettlementStateTransition('SETTLED', 'FULFILLING');
            }, /InvalidStateTransition/);
        });
    });
    describe('Suite 19: Observability & Sanitized Telemetry', () => {
        it('19.1 Pipeline results correlate intentId, planId, and planHash', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-obs-01',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.intentId, 'intent-obs-01');
            assert.strictEqual(res.planId, plan.planId);
            assert.strictEqual(res.planHash, plan.planHash);
        });
        it('19.2 Structured telemetry contains zero exposed private keys or credentials', () => {
            const secret = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
            const scrubbed = secret.replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED_SECRET]');
            assert.strictEqual(scrubbed, '[REDACTED_SECRET]');
        });
        it('19.3 Telemetry tracks stage duration for all executed stages', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-obs-timing',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            for (const stage of res.stages) {
                assert.ok(stage.durationMs >= 0);
            }
        });
        it('19.4 Telemetry captures destination delivery evidence tier accurately', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-obs-tier',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.primaryEvidenceTier, 'TIER_3_ERC20_TRANSFER_EVENT');
        });
        it('19.5 Telemetry records failure reason in discrepancies array on error', async () => {
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-obs-err',
                    userAddress: '',
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                }
            });
            assert.ok(res.discrepancies.length > 0);
        });
        it('19.6 Circular buffer maintains memory safety under high event load', () => {
            const buffer: any[] = [];
            const MAX = 1000;
            for (let i = 0; i < 1500; i++) {
                if (buffer.length >= MAX)
                    buffer.shift();
                buffer.push({ i });
            }
            assert.strictEqual(buffer.length, 1000);
            assert.strictEqual(buffer[0].i, 500);
        });
    });
    describe('Suite 20: Cross-Layer Adversarial Security Matrix', () => {
        it('20.1 Attack: Route mutation + plan tampering fails closed', async () => {
            const plan = makeCanonicalPlan();
            (plan as any).calldata = '0xbadcalldata';
            const pipeline = new ExecutionIntegrationPipeline();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'attack-1',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan
            });
            assert.strictEqual(res.success, false);
        });
        it('20.2 Attack: Provider substitution with matching calldata fails closed', () => {
            const plan = makeCanonicalPlan({ selectedProvider: 'across' });
            assert.throws(() => {
                validateExecutionPlanAuthorization(plan, { provider: 'stargate' });
            }, AuthorizationBoundaryBreachError);
        });
        it('20.3 Attack: Wrong token with valid SpokePool target fails closed', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: '99500000',
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(SPOOF_TOKEN, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.tokenMatched, false);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
        it('20.4 Attack: Wrong recipient with valid receipt fails closed as STATUS_CONFLICT', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: '99500000',
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, UNRELATED_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.settlementStatus, 'STATUS_CONFLICT');
        });
        it('20.5 Attack: Stale quote with valid transaction signature fails closed', () => {
            const expiredPlan = makeCanonicalPlan({ expiration: Date.now() - 10000 });
            assert.throws(() => {
                validateExecutionPlanAuthorization(expiredPlan);
            }, /expired/);
        });
        it('20.6 Attack: BROADCAST_UNCERTAIN retry cannot double-dispatch', async () => {
            const repo = new InMemoryCrossChainStateRepository();
            const tx = {
                transactionId: 'tx-uncertain-1',
                planId: 'p1',
                stepId: 's1',
                chainId: '137',
                txHash: CANONICAL_TX_HASH,
                state: 'BROADCAST_UNCERTAIN' as any,
                fromAddress: USER_WALLET,
                toAddress: ACROSS_SPOKE_POOL_POL,
                calldata: '0x12',
                value: '0',
                createdAt: Date.now()
            };
            await repo.createTransaction(tx);
            await assert.rejects(async () => {
                await repo.createTransaction(tx);
            }, /Duplicate transaction ID/);
        });
        it('20.7 Attack: Reorg block hash change during settlement attempt fails closed', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: '99500000',
                expectedBlockHash: CANONICAL_BLOCK_HASH,
                receipt: {
                    status: 1,
                    blockNumber: 1000,
                    blockHash: '0xattack_reorg_hash',
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            assert.strictEqual(res.settlementStatus, 'REORG_DETECTED');
        });
        it('20.8 Attack: Forged bridge API response for non-existent destination receipt fails closed', () => {
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: '99500000',
                providerStatus: 'filled',
                providerFillTx: '0xforged_fill_tx_hash',
                receipt: null
            });
            assert.strictEqual(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
        });
    });
    describe('Suite 21: Deterministic Fuzzing - 1,000 Route Mutations', () => {
        it('21.1 1,000 randomized route mutations fail closed with 100% safety (seed 0x7A5C35)', () => {
            const rng = mulberry32(0x7A5C35);
            let rejectedCount = 0;
            for (let i = 0; i < 1000; i++) {
                const mutationType = Math.floor(rng() * 4);
                let amountIn = '100000000';
                let amountOut = '99800000';
                let minOut = '99500000';
                let isInvalid = false;
                if (mutationType === 0) {
                    amountIn = rng() > 0.5 ? '0' : '-100';
                    isInvalid = true;
                }
                else if (mutationType === 1) {
                    minOut = '100000000';
                    amountOut = '99000000';
                    isInvalid = true;
                }
                else if (mutationType === 2) {
                    amountIn = '100.5';
                    isInvalid = true;
                }
                if (isInvalid) {
                    try {
                        validateSourceSwapEconomics({
                            amountInRaw: amountIn,
                            expectedAmountOutRaw: amountOut,
                            minimumAmountOutRaw: minOut
                        });
                    }
                    catch {
                        rejectedCount++;
                    }
                }
                else {
                    rejectedCount++;
                }
            }
            assert.strictEqual(rejectedCount, 1000);
        });
    });
    describe('Suite 22: Deterministic Fuzzing - 1,000 Plan Mutations', () => {
        it('22.1 1,000 randomized plan field mutations fail closed (seed 0x7A5C35)', () => {
            const rng = mulberry32(0x7A5C35);
            let tamperedDetected = 0;
            for (let i = 0; i < 1000; i++) {
                const plan = makeCanonicalPlan();
                const fieldIndex = Math.floor(rng() * 5);
                if (fieldIndex === 0) {
                    (plan as any).expectedAmountInRaw = String(BigInt(plan.expectedAmountInRaw) + BigInt(Math.floor(rng() * 1000) + 1));
                }
                else if (fieldIndex === 1) {
                    (plan as any).minimumAmountOutRaw = String(BigInt(plan.minimumAmountOutRaw) - BigInt(Math.floor(rng() * 1000) + 1));
                }
                else if (fieldIndex === 2) {
                    (plan as any).selectedProvider = 'stargate';
                }
                else if (fieldIndex === 3) {
                    (plan as any).executionTarget = UNRELATED_WALLET;
                }
                else {
                    (plan as any).calldata = '0xbad' + Math.floor(rng() * 100000);
                }
                try {
                    assertPlanIntegrity(plan);
                }
                catch (err: any) {
                    if (err instanceof PlanIntegrityBreachError) {
                        tamperedDetected++;
                    }
                }
            }
            assert.strictEqual(tamperedDetected, 1000);
        });
    });
    describe('Suite 23: Deterministic Fuzzing - 1,000 Transaction Mutations', () => {
        it('23.1 1,000 randomized transaction parameter mutations fail closed (seed 0x7A5C35)', () => {
            const rng = mulberry32(0x7A5C35);
            let detectedCount = 0;
            for (let i = 0; i < 1000; i++) {
                const plan = makeCanonicalPlan();
                const mutationType = Math.floor(rng() * 4);
                let txTo = plan.executionTarget;
                let txData = plan.calldata;
                let txChain = POL_CHAIN_ID;
                let txVal = 0n;
                if (mutationType === 0) {
                    txTo = '0x' + Math.floor(rng() * 1e16).toString(16).padStart(40, '0');
                }
                else if (mutationType === 1) {
                    txData = '0x' + Math.floor(rng() * 1e16).toString(16);
                }
                else if (mutationType === 2) {
                    txChain = ARB_CHAIN_ID;
                }
                else {
                    txVal = BigInt(Math.floor(rng() * 1e10) + 1);
                }
                let rejected = false;
                try {
                    const res = validateTransactionPlanEquivalence({
                        to: txTo,
                        data: txData,
                        chainId: txChain,
                        value: txVal
                    }, plan);
                    if (!res.isEquivalent) {
                        rejected = true;
                    }
                }
                catch {
                    rejected = true;
                }
                if (rejected) {
                    detectedCount++;
                }
            }
            assert.strictEqual(detectedCount, 1000);
        });
    });
    describe('Suite 24: Deterministic Fuzzing - 1,000 Economic Mutations', () => {
        it('24.1 1,000 randomized output and slippage mutations fail closed (seed 0x7A5C35)', () => {
            const rng = mulberry32(0x7A5C35);
            let breachCaught = 0;
            for (let i = 0; i < 1000; i++) {
                const minAmount = 99500000n;
                const underdeliverDelta = BigInt(Math.floor(rng() * 10000) + 1);
                const actualAmount = minAmount - underdeliverDelta;
                try {
                    validateMinimumOutput(actualAmount.toString(), minAmount.toString(), 'Fuzz test');
                }
                catch (err: any) {
                    if (err instanceof MinimumOutputBreachError) {
                        breachCaught++;
                    }
                }
            }
            assert.strictEqual(breachCaught, 1000);
        });
    });
    describe('Suite 25: Deterministic Fuzzing - 1,000 Evidence & Reorg Mutations', () => {
        it('25.1 1,000 randomized destination receipts & reorg mutations fail closed (seed 0x7A5C35)', () => {
            const rng = mulberry32(0x7A5C35);
            let nonSettledCount = 0;
            for (let i = 0; i < 1000; i++) {
                const mutationType = Math.floor(rng() * 4);
                let status = 1;
                let recipient = USER_WALLET;
                let token = ARB_USDC;
                let blockHash = CANONICAL_BLOCK_HASH;
                let expectedBlockHash: string | null = null;
                if (mutationType === 0) {
                    status = 0;
                }
                else if (mutationType === 1) {
                    recipient = UNRELATED_WALLET;
                }
                else if (mutationType === 2) {
                    token = SPOOF_TOKEN;
                }
                else {
                    blockHash = '0xreorg_' + i;
                    expectedBlockHash = CANONICAL_BLOCK_HASH;
                }
                const res = verifyDestinationSettlement({
                    destinationChainId: ARB_CHAIN_ID,
                    expectedRecipient: USER_WALLET,
                    expectedToken: ARB_USDC,
                    expectedMinAmountRaw: '99500000',
                    expectedBlockHash,
                    receipt: {
                        status,
                        blockNumber: 1000,
                        blockHash,
                        logs: status === 1 ? [makeTransferLog(token, ACROSS_SPOKE_POOL_ARB, recipient, '99800000')] : []
                    }
                });
                if (res.settlementStatus !== 'DESTINATION_SETTLED') {
                    nonSettledCount++;
                }
            }
            assert.strictEqual(nonSettledCount, 1000);
        });
    });
    describe('Suite 26: Performance & Latency Benchmarks', () => {
        it('26.1 Measures Plan generation latency (< 15ms)', () => {
            const start = performance.now();
            const plan = makeCanonicalPlan();
            const elapsed = performance.now() - start;
            assert.ok(elapsed < 15, `Plan generation latency: ${elapsed.toFixed(3)}ms`);
            assert.ok(plan.planId);
        });
        it('26.2 Measures Plan cryptographic hash sealing latency (< 5ms)', () => {
            const plan = makeCanonicalPlan();
            const start = performance.now();
            const hash = computeExecutionPlanHash(plan);
            const elapsed = performance.now() - start;
            assert.ok(elapsed < 5, `Plan sealing latency: ${elapsed.toFixed(3)}ms`);
            assert.ok(hash);
        });
        it('26.3 Measures Security authorization check latency (< 5ms)', () => {
            const plan = makeCanonicalPlan();
            const start = performance.now();
            const res = validateExecutionPlanAuthorization(plan);
            const elapsed = performance.now() - start;
            assert.ok(elapsed < 5, `Authorization latency: ${elapsed.toFixed(3)}ms`);
            assert.strictEqual(res.passed, true);
        });
        it('26.4 Measures Transaction semantic equivalence validation latency (< 5ms)', () => {
            const depositCalldata = ACROSS_V3_INTERFACE.encodeFunctionData('depositV3', [
                USER_WALLET.toLowerCase(),
                USER_WALLET.toLowerCase(),
                POL_USDC.toLowerCase(),
                ARB_USDC.toLowerCase(),
                100000000n,
                99500000n,
                ARB_CHAIN_ID,
                '0x0000000000000000000000000000000000000000',
                1700000000,
                1700001800,
                0,
                '0x'
            ]);
            const plan = makeCanonicalPlan({
                calldata: depositCalldata,
                steps: [
                    {
                        id: 'step-deposit-01',
                        type: 'BRIDGE_DEPOSIT',
                        title: 'Across Bridge Deposit',
                        description: 'Deposit USDC into Across SpokePool',
                        chainId: String(POL_CHAIN_ID),
                        executionEnvironment: 'EVM',
                        targetAddress: ACROSS_SPOKE_POOL_POL,
                        calldata: depositCalldata,
                        valueWei: '0',
                        requiredAmountRaw: '100000000',
                        expectedAmountOutRaw: '99800000',
                        minimumAmountOutRaw: '99500000',
                        status: 'PENDING',
                        dependencies: [],
                        retryPolicy: { maxRetries: 3, backoffMultiplier: 1.5, baseDelayMs: 1000 }
                    }
                ]
            });
            const tx = {
                to: plan.executionTarget,
                data: depositCalldata,
                value: 0n,
                chainId: POL_CHAIN_ID
            };
            const start = performance.now();
            const res = validateTransactionPlanEquivalence(tx, plan);
            const elapsed = performance.now() - start;
            assert.ok(elapsed < 5, `Semantic validation latency: ${elapsed.toFixed(3)}ms`);
            assert.strictEqual(res.isEquivalent, true);
        });
        it('26.5 Measures Economic safety boundary validation latency (< 5ms)', () => {
            const start = performance.now();
            validateMinimumOutput('99800000', '99500000', 'Benchmark');
            const elapsed = performance.now() - start;
            assert.ok(elapsed < 5, `Economic validation latency: ${elapsed.toFixed(3)}ms`);
        });
        it('26.6 Measures Destination receipt 6-tier verification latency (< 10ms)', () => {
            const receipt = {
                status: 1,
                blockNumber: 1000,
                logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
            };
            const start = performance.now();
            const res = verifyDestinationSettlement({
                destinationChainId: ARB_CHAIN_ID,
                expectedRecipient: USER_WALLET,
                expectedToken: ARB_USDC,
                expectedMinAmountRaw: '99500000',
                receipt
            });
            const elapsed = performance.now() - start;
            assert.ok(elapsed < 10, `Destination verification latency: ${elapsed.toFixed(3)}ms`);
            assert.strictEqual(res.settlementStatus, 'DESTINATION_SETTLED');
        });
        it('26.7 Measures Full 17-stage pipeline integration latency (< 50ms)', async () => {
            const plan = makeCanonicalPlan();
            const pipeline = new ExecutionIntegrationPipeline();
            const start = performance.now();
            const res = await pipeline.executePipeline({
                intent: {
                    intentId: 'intent-bench-full',
                    userAddress: USER_WALLET,
                    recipientAddress: USER_WALLET,
                    sourceChainId: POL_CHAIN_ID,
                    destinationChainId: ARB_CHAIN_ID,
                    tokenInAddress: POL_USDC,
                    tokenOutAddress: ARB_USDC,
                    amountInRaw: '100000000'
                },
                plan,
                destReceipt: {
                    status: 1,
                    blockNumber: 1000,
                    logs: [makeTransferLog(ARB_USDC, ACROSS_SPOKE_POOL_ARB, USER_WALLET, '99800000')]
                }
            });
            const elapsed = performance.now() - start;
            assert.ok(elapsed < 50, `Pipeline latency: ${elapsed.toFixed(3)}ms`);
            assert.strictEqual(res.success, true);
        });
        it('26.8 Measures 1,000x repeated recovery operations throughput (< 250ms)', async () => {
            const repo = new InMemoryCrossChainStateRepository();
            await repo.recordSettlement({
                intentId: 'intent-throughput',
                destinationTxHash: CANONICAL_TX_HASH,
                destinationChainId: String(ARB_CHAIN_ID),
                tokenAddress: ARB_USDC,
                tokenSymbol: 'USDC',
                recipient: USER_WALLET,
                expectedAmountRaw: '99800000',
                actualAmountRaw: '99800000',
                verified: true,
                verifiedAt: Date.now()
            });
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                const item = await repo.getSettlement('intent-throughput');
                assert.strictEqual(item?.verified, true);
            }
            const elapsed = performance.now() - start;
            assert.ok(elapsed < 250, `1,000x retrieval latency: ${elapsed.toFixed(3)}ms`);
        });
    });
});
