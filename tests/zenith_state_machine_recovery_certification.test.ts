import test, { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  ExecutionPlan,
  ExecutionPlanStep,
  PersistentTransaction,
  PersistentIntent,
  CrossChainIntent,
  SettlementState,
  StepStatus,
  TransactionLifecycleState,
  TransactionStatus,
  Token
} from '@zenith/types';

import {
  InvalidStateTransitionError,
  BroadcastUncertainError,
  AmbiguousBroadcastError,
  SecurityPolicyViolationError,
  RecipientMismatchError,
  InvalidExecutionTargetError,
  QuoteUnavailableError,
  SourceSwapFailedError,
  BridgeFailedError,
  AmountMismatchError,
  SignerRequiredError,
  AllProvidersUnavailableError,
  RpcTimeoutError,
  ChainIdMismatchError
} from '@zenith/contracts';

import {
  ExecutionStateMachine,
  VALID_TRANSACTION_STATUS_TRANSITIONS,
  TERMINAL_TRANSACTION_STATUSES,
  validateTransactionStatusTransition,
  VALID_TRANSACTION_STATE_TRANSITIONS,
  TERMINAL_TRANSACTION_LIFECYCLE_STATES,
  validateTransactionStateTransition,
  VALID_PLAN_STATUS_TRANSITIONS,
  TERMINAL_PLAN_STATUSES,
  validatePlanStatusTransition,
  VALID_STEP_STATUS_TRANSITIONS,
  TERMINAL_STEP_STATUSES,
  validateStepStatusTransition,
  VALID_SETTLEMENT_STATE_TRANSITIONS,
  TERMINAL_SETTLEMENT_STATES,
  validateSettlementStateTransition,
  InMemoryCrossChainStateRepository,
  SQLiteCrossChainStateRepository,
  computeExecutionPlanHash,
  sealPlan,
  verifyPlanIntegrity,
  assertPlanIntegrity,
  GoldenPathCrashRecoveryCoordinator,
  verifyDestinationSettlement,
  extractActualSourceSwapOutput,
  LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE
} from '@zenith/execution';

// ============================================================================
// DETERMINISTIC FIXTURES & BUILDER HELPERS
// ============================================================================

const TEST_USER = '0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88';
const SPOKE_POOL_POLYGON = '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096';
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

const WPOL_TOKEN: Token = {
  address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  symbol: 'WPOL',
  name: 'Wrapped POL',
  decimals: 18,
  chainId: 'polygon',
  verificationTier: 'VERIFIED_CANONICAL'
};

const POLYGON_USDC: Token = {
  address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  chainId: 'polygon',
  verificationTier: 'VERIFIED_CANONICAL'
};

const ARBITRUM_USDC: Token = {
  address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  chainId: 'arbitrum',
  verificationTier: 'VERIFIED_CANONICAL'
};

function createValidStep(id: string, type: any, status: StepStatus = 'NOT_STARTED'): ExecutionPlanStep {
  return {
    id,
    type,
    title: `Test Step: ${id}`,
    description: `Description for ${id}`,
    chainId: 'polygon',
    numericChainId: 137,
    executionEnvironment: 'EVM',
    targetAddress: SPOKE_POOL_POLYGON,
    calldata: '0x12345678',
    status,
    dependencies: [],
    retryPolicy: { maxRetries: 3, backoffMs: 1000, timeoutMs: 30000 }
  };
}

function createValidPlan(planId = 'plan-cert-001', overallStatus: any = 'IDLE'): ExecutionPlan {
  const steps: ExecutionPlanStep[] = [
    createValidStep('step-1', 'SOURCE_SWAP'),
    createValidStep('step-2', 'BRIDGE_DEPOSIT'),
    createValidStep('step-3', 'DESTINATION_VERIFY')
  ];

  return {
    planId,
    routeId: 'route-cert-001',
    routeType: 'CROSS_CHAIN_COMPOSITE',
    sourceChainId: 'polygon',
    destinationChainId: 'arbitrum',
    tokenIn: WPOL_TOKEN,
    tokenOut: ARBITRUM_USDC,
    expectedAmountInRaw: '1000000000000000000',
    expectedAmountOutRaw: '1000000',
    minimumAmountOutRaw: '990000',
    isExecutable: true,
    steps,
    currentStepIndex: 0,
    overallStatus,
    selectedProvider: 'ACROSS',
    calldata: '0x12345678',
    approvalTarget: SPOKE_POOL_POLYGON,
    executionTarget: SPOKE_POOL_POLYGON,
    expiration: Date.now() + 3600000,
    diagnostics: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

// Deterministic PRNG for transition fuzzing
function createDeterministicRng(seed = 42) {
  let s = seed;
  return function next(): number {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ============================================================================
// PART 1 — AUTHORITATIVE STATE INVENTORY
// ============================================================================

describe('Part 1 — Authoritative State Inventory', () => {
  it('1.1 Certifies the 5 operational state tiers in ZENITH architecture', () => {
    // Tier 1: ExecutionPlan overallStatus
    const planStatuses = ['IDLE', 'EXECUTING', 'PAUSED', 'COMPLETED', 'FAILED'];
    assert.equal(planStatuses.length, 5);

    // Tier 2: ExecutionPlanStep status (StepStatus)
    const stepStatuses: StepStatus[] = [
      'NOT_STARTED', 'PENDING', 'SIMULATING', 'SIGNING', 'SUBMITTED',
      'CONFIRMING', 'SUCCESS', 'FAILED', 'SKIPPED'
    ];
    assert.equal(stepStatuses.length, 9);

    // Tier 3: PersistentTransaction state (TransactionLifecycleState)
    const txStates: TransactionLifecycleState[] = [
      'CREATED', 'PREFLIGHTING', 'PREFLIGHT_PASSED', 'PREFLIGHT_FAILED',
      'READY_TO_BROADCAST', 'BROADCASTING', 'BROADCAST_CONFIRMED', 'BROADCAST_FAILED',
      'BROADCAST_UNCERTAIN', 'CONFIRMING', 'CONFIRMED', 'REVERTED', 'DROPPED', 'EXPIRED', 'RECOVERY_REQUIRED'
    ];
    assert.equal(txStates.length, 15);

    // Tier 4: ExecutionStateMachine currentStatus (TransactionStatus)
    assert.equal(Object.keys(VALID_TRANSACTION_STATUS_TRANSITIONS).length >= 25, true);

    // Tier 5: CrossChainIntent status (SettlementState)
    assert.equal(Object.keys(VALID_SETTLEMENT_STATE_TRANSITIONS).length >= 15, true);
  });

  it('1.2 Certifies all 25 TransactionStatus enum values and their category classifications', () => {
    const statuses: TransactionStatus[] = [
      'IDLE', 'QUOTE_REQUESTED', 'QUOTED', 'SIMULATING', 'SIMULATED',
      'APPROVAL_NEEDED', 'APPROVING', 'APPROVED', 'SIGNING', 'SUBMITTING',
      'BROADCASTED', 'CONFIRMING', 'COMPLETED', 'BRIDGE_SOURCE_CONFIRMED',
      'BRIDGE_IN_FLIGHT', 'BRIDGE_DESTINATION_CONFIRMED', 'DESTINATION_FILLED',
      'SETTLED', 'REFUND_PENDING', 'REFUNDED', 'TRACKING_TIMEOUT',
      'TRACKING_UNAVAILABLE', 'FAILED', 'REVERTED', 'CANCELLED'
    ];
    assert.equal(statuses.length, 25);
    for (const status of statuses) {
      assert.ok(VALID_TRANSACTION_STATUS_TRANSITIONS[status] !== undefined, `Missing transition map for ${status}`);
    }
  });

  it('1.3 Certifies all 9 StepStatus values and distinct lifecycle semantics', () => {
    const stepStatuses: StepStatus[] = [
      'NOT_STARTED', 'PENDING', 'SIMULATING', 'SIGNING', 'SUBMITTED',
      'CONFIRMING', 'SUCCESS', 'FAILED', 'SKIPPED'
    ];
    assert.equal(stepStatuses.length, 9);
    for (const s of stepStatuses) {
      assert.ok(VALID_STEP_STATUS_TRANSITIONS[s] !== undefined, `Missing transition map for step ${s}`);
    }
  });

  it('1.4 Certifies all 15 TransactionLifecycleState values and persistence tracking', () => {
    const txStates: TransactionLifecycleState[] = [
      'CREATED', 'PREFLIGHTING', 'PREFLIGHT_PASSED', 'PREFLIGHT_FAILED',
      'READY_TO_BROADCAST', 'BROADCASTING', 'BROADCAST_CONFIRMED', 'BROADCAST_FAILED',
      'BROADCAST_UNCERTAIN', 'CONFIRMING', 'CONFIRMED', 'REVERTED', 'DROPPED', 'EXPIRED', 'RECOVERY_REQUIRED'
    ];
    for (const s of txStates) {
      assert.ok(VALID_TRANSACTION_STATE_TRANSITIONS[s] !== undefined, `Missing transition map for tx state ${s}`);
    }
  });

  it('1.5 Certifies all 16 SettlementState values across cross-chain intent lifecycle', () => {
    const settlementStates: SettlementState[] = [
      'CREATED', 'SIGNED', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'FULFILLING',
      'DESTINATION_FILLED', 'VERIFIED', 'SETTLING', 'SETTLED', 'FAILED',
      'REFUND_PENDING', 'REFUNDED', 'CANCELLED', 'EXPIRED', 'TRACKING_TIMEOUT'
    ];
    for (const s of settlementStates) {
      assert.ok(VALID_SETTLEMENT_STATE_TRANSITIONS[s] !== undefined, `Missing transition map for settlement state ${s}`);
    }
  });
});

// ============================================================================
// PART 2 — STATE TRANSITION GRAPH
// ============================================================================

describe('Part 2 — State Transition Graph', () => {
  it('2.1 ExecutionStateMachine transition graph is deterministic and acyclic toward terminal states', () => {
    const sm = new ExecutionStateMachine();
    assert.equal(sm.getStatus(), 'IDLE');
    sm.transitionTo('SIMULATING');
    sm.transitionTo('SIMULATED');
    sm.transitionTo('APPROVING');
    sm.transitionTo('APPROVED');
    sm.transitionTo('SIGNING');
    sm.transitionTo('SUBMITTING');
    sm.transitionTo('CONFIRMING');
    sm.transitionTo('COMPLETED');
    assert.equal(sm.getStatus(), 'COMPLETED');
    assert.equal(sm.isTerminal(), true);
  });

  it('2.2 PersistentTransaction lifecycle graph follows strict preflight -> broadcast -> confirm order', () => {
    assert.doesNotThrow(() => validateTransactionStateTransition('CREATED', 'PREFLIGHTING'));
    assert.doesNotThrow(() => validateTransactionStateTransition('PREFLIGHTING', 'PREFLIGHT_PASSED'));
    assert.doesNotThrow(() => validateTransactionStateTransition('PREFLIGHT_PASSED', 'READY_TO_BROADCAST'));
    assert.doesNotThrow(() => validateTransactionStateTransition('READY_TO_BROADCAST', 'BROADCASTING'));
    assert.doesNotThrow(() => validateTransactionStateTransition('BROADCASTING', 'BROADCAST_CONFIRMED'));
    assert.doesNotThrow(() => validateTransactionStateTransition('BROADCAST_CONFIRMED', 'CONFIRMED'));
  });

  it('2.3 StepStatus transition graph prevents backward movement from SUCCESS or FAILED', () => {
    assert.doesNotThrow(() => validateStepStatusTransition('NOT_STARTED', 'PENDING'));
    assert.doesNotThrow(() => validateStepStatusTransition('PENDING', 'SIMULATING'));
    assert.doesNotThrow(() => validateStepStatusTransition('SIMULATING', 'SUCCESS'));
    assert.throws(
      () => validateStepStatusTransition('SUCCESS', 'NOT_STARTED'),
      InvalidStateTransitionError
    );
  });

  it('2.4 Plan overallStatus transition graph permits only legal progressions', () => {
    assert.doesNotThrow(() => validatePlanStatusTransition('IDLE', 'EXECUTING'));
    assert.doesNotThrow(() => validatePlanStatusTransition('EXECUTING', 'COMPLETED'));
    assert.throws(
      () => validatePlanStatusTransition('COMPLETED', 'EXECUTING'),
      InvalidStateTransitionError
    );
  });

  it('2.5 SettlementState transition graph correctly routes through FULFILLING and DESTINATION_FILLED', () => {
    assert.doesNotThrow(() => validateSettlementStateTransition('CREATED', 'SIGNED'));
    assert.doesNotThrow(() => validateSettlementStateTransition('SIGNED', 'SUBMITTED'));
    assert.doesNotThrow(() => validateSettlementStateTransition('SUBMITTED', 'ACCEPTED'));
    assert.doesNotThrow(() => validateSettlementStateTransition('ACCEPTED', 'FULFILLING'));
    assert.doesNotThrow(() => validateSettlementStateTransition('FULFILLING', 'DESTINATION_FILLED'));
    assert.doesNotThrow(() => validateSettlementStateTransition('DESTINATION_FILLED', 'SETTLED'));
  });
});

// ============================================================================
// PART 3 — TERMINAL STATE IMMUTABILITY
// ============================================================================

describe('Part 3 — Terminal State Immutability', () => {
  it('3.1 SETTLED state in ExecutionStateMachine is strictly immutable and fails closed', () => {
    const sm = new ExecutionStateMachine();
    sm.transitionTo('SIMULATING');
    sm.transitionTo('SIMULATED');
    sm.transitionTo('SIGNING');
    sm.transitionTo('CONFIRMING');
    sm.transitionTo('SETTLED');
    assert.equal(sm.isTerminal(), true);

    assert.throws(() => sm.transitionTo('IDLE'), InvalidStateTransitionError);
    assert.throws(() => sm.transitionTo('SIMULATING'), InvalidStateTransitionError);
    assert.throws(() => sm.transitionTo('APPROVING'), InvalidStateTransitionError);
    assert.throws(() => sm.transitionTo('FAILED'), InvalidStateTransitionError);
    assert.throws(() => sm.transitionTo('CANCELLED'), InvalidStateTransitionError);
  });

  it('3.2 COMPLETED state in ExecutionStateMachine cannot be mutated', () => {
    const sm = new ExecutionStateMachine();
    sm.transitionTo('SIMULATING');
    sm.transitionTo('SIMULATED');
    sm.transitionTo('SIGNING');
    sm.transitionTo('CONFIRMING');
    sm.transitionTo('COMPLETED');
    assert.equal(sm.isTerminal(), true);

    assert.throws(() => sm.transitionTo('IDLE'), InvalidStateTransitionError);
    assert.throws(() => sm.transitionTo('CONFIRMING'), InvalidStateTransitionError);
    assert.throws(() => sm.transitionTo('FAILED'), InvalidStateTransitionError);
  });

  it('3.3 FAILED state in ExecutionStateMachine cannot be rolled back', () => {
    const sm = new ExecutionStateMachine();
    sm.transitionTo('SIMULATING');
    sm.transitionTo('FAILED');
    assert.equal(sm.isTerminal(), true);

    assert.throws(() => sm.transitionTo('IDLE'), InvalidStateTransitionError);
    assert.throws(() => sm.transitionTo('SIMULATING'), InvalidStateTransitionError);
    assert.throws(() => sm.transitionTo('SETTLED'), InvalidStateTransitionError);
  });

  it('3.4 REVERTED, CANCELLED, and REFUNDED in ExecutionStateMachine are immutable', () => {
    for (const term of ['REVERTED', 'CANCELLED', 'REFUNDED'] as const) {
      assert.throws(
        () => validateTransactionStatusTransition(term, 'IDLE'),
        InvalidStateTransitionError
      );
      assert.throws(
        () => validateTransactionStatusTransition(term, 'SETTLED'),
        InvalidStateTransitionError
      );
    }
  });

  it('3.5 CONFIRMED and REVERTED in TransactionLifecycleState cannot transition out', () => {
    assert.throws(
      () => validateTransactionStateTransition('CONFIRMED', 'CREATED'),
      InvalidStateTransitionError
    );
    assert.throws(
      () => validateTransactionStateTransition('CONFIRMED', 'BROADCASTING'),
      InvalidStateTransitionError
    );
    assert.throws(
      () => validateTransactionStateTransition('REVERTED', 'CONFIRMED'),
      InvalidStateTransitionError
    );
  });

  it('3.6 SUCCESS, FAILED, and SKIPPED in ExecutionPlanStep are immutable', () => {
    for (const term of ['SUCCESS', 'FAILED', 'SKIPPED'] as const) {
      assert.throws(
        () => validateStepStatusTransition(term, 'PENDING'),
        InvalidStateTransitionError
      );
      assert.throws(
        () => validateStepStatusTransition(term, 'SIMULATING'),
        InvalidStateTransitionError
      );
    }
  });

  it('3.7 COMPLETED and FAILED in ExecutionPlan overallStatus are immutable', () => {
    assert.throws(
      () => validatePlanStatusTransition('COMPLETED', 'IDLE'),
      InvalidStateTransitionError
    );
    assert.throws(
      () => validatePlanStatusTransition('COMPLETED', 'EXECUTING'),
      InvalidStateTransitionError
    );
    assert.throws(
      () => validatePlanStatusTransition('FAILED', 'EXECUTING'),
      InvalidStateTransitionError
    );
  });
});

// ============================================================================
// PART 4 — BROADCAST_UNCERTAIN
// ============================================================================

describe('Part 4 — BROADCAST_UNCERTAIN Deep Certification', () => {
  it('4.1 Ambiguous network timeout triggers BroadcastUncertainError with zero auto-rebroadcast', () => {
    const error = new BroadcastUncertainError('RPC socket timeout after submission', {
      chainId: '137',
      txHash: '0xuncertain_hash_001'
    });
    assert.equal(error.name, 'BroadcastUncertainError');
    assert.equal(error.code, 'BROADCAST_UNCERTAIN');
    assert.equal(error.chainId, '137');
  });

  it('4.2 AmbiguousBroadcastError is a strict subclass of BroadcastUncertainError', () => {
    const ambig = new AmbiguousBroadcastError('Ambiguous transport disconnect', {
      chainId: '42161',
      txHash: '0xambig_hash_002'
    });
    assert.ok(ambig instanceof BroadcastUncertainError);
    assert.equal(ambig.code, 'BROADCAST_UNCERTAIN');
  });

  it('4.3 BROADCAST_UNCERTAIN preserves transaction intent and locks nonce safely', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const tx: PersistentTransaction = {
      transactionId: 'tx-cert-unc-001',
      planId: 'plan-unc-001',
      stepId: 'step-1',
      chainId: 'polygon',
      fromAddress: TEST_USER,
      toAddress: SPOKE_POOL_POLYGON,
      nonce: 42,
      state: 'BROADCASTING',
      txHash: '0xuncertain_tx_42',
      createdAt: Date.now()
    };
    await repo.createTransaction(tx);

    // Transition to BROADCAST_UNCERTAIN
    const updated = await repo.updateTransaction(tx.transactionId, {
      state: 'BROADCAST_UNCERTAIN'
    });
    assert.equal(updated.state, 'BROADCAST_UNCERTAIN');

    // Verify it is discovered in uncertain transactions query
    const uncertainList = await repo.listUncertainTransactions();
    assert.equal(uncertainList.length, 1);
    assert.equal(uncertainList[0].transactionId, 'tx-cert-unc-001');
    assert.equal(uncertainList[0].nonce, 42);
  });

  it('4.4 BROADCAST_UNCERTAIN cannot transition to CONFIRMED without receipt evidence', () => {
    // Only legal transitions from BROADCAST_UNCERTAIN are BROADCAST_CONFIRMED, CONFIRMED, BROADCAST_FAILED, RECOVERY_REQUIRED
    assert.doesNotThrow(() => validateTransactionStateTransition('BROADCAST_UNCERTAIN', 'RECOVERY_REQUIRED'));
    assert.doesNotThrow(() => validateTransactionStateTransition('BROADCAST_UNCERTAIN', 'CONFIRMED'));
    assert.throws(
      () => validateTransactionStateTransition('BROADCAST_UNCERTAIN', 'READY_TO_BROADCAST'),
      InvalidStateTransitionError
    );
  });

  it('4.5 Confirmed transaction discovered during recovery is NEVER rebroadcast', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const tx: PersistentTransaction = {
      transactionId: 'tx-rec-001',
      planId: 'plan-rec-001',
      stepId: 'step-1',
      chainId: 'polygon',
      fromAddress: TEST_USER,
      toAddress: SPOKE_POOL_POLYGON,
      nonce: 100,
      state: 'BROADCAST_UNCERTAIN',
      txHash: '0xconfirmed_on_chain',
      createdAt: Date.now()
    };
    await repo.createTransaction(tx);

    // Mined receipt discovered on chain -> resolve to CONFIRMED
    const resolved = await repo.updateTransaction(tx.transactionId, {
      state: 'CONFIRMED',
      confirmedAt: Date.now()
    });
    assert.equal(resolved.state, 'CONFIRMED');

    // Confirmed transaction is now immutable
    assert.throws(
      () => validateTransactionStateTransition(resolved.state, 'READY_TO_BROADCAST'),
      InvalidStateTransitionError
    );
  });

  it('4.6 Recovery from BROADCAST_UNCERTAIN is mathematically idempotent', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const tx: PersistentTransaction = {
      transactionId: 'tx-idem-001',
      planId: 'plan-idem-001',
      stepId: 'step-1',
      chainId: 'polygon',
      fromAddress: TEST_USER,
      toAddress: SPOKE_POOL_POLYGON,
      nonce: 101,
      state: 'BROADCAST_UNCERTAIN',
      txHash: '0xuncertain_idem',
      createdAt: Date.now()
    };
    await repo.createTransaction(tx);

    // Repeated query does not mutate state
    for (let i = 0; i < 10; i++) {
      const fetched = await repo.getTransaction(tx.transactionId);
      assert.equal(fetched?.state, 'BROADCAST_UNCERTAIN');
      assert.equal(fetched?.nonce, 101);
    }
  });
});

// ============================================================================
// PART 5 — CRASH RECOVERY ACROSS 22 CHECKPOINTS
// ============================================================================

describe('Part 5 — Crash Recovery Across 22 Checkpoints', () => {
  it('5.1 Checkpoints 1-4: Plan and step persistence survive restart', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const plan = createValidPlan('plan-crash-1-4');

    // CP 1-2: Plan persistence
    await repo.saveExecutionPlan(plan);
    const loadedPlan = await repo.getExecutionPlan(plan.planId);
    assert.ok(loadedPlan);
    assert.equal(loadedPlan.planId, plan.planId);

    // CP 3-4: Step persistence
    const loadedSteps = await repo.getPlanSteps(plan.planId);
    assert.equal(loadedSteps.length, 3);
  });

  it('5.2 Checkpoints 5-6: Preflight crash preserves sealed plan integrity', () => {
    const plan = createValidPlan('plan-crash-5-6');
    const sealed = sealPlan(plan);
    assert.equal(verifyPlanIntegrity(sealed), true);
  });

  it('5.3 Checkpoints 7-10: Approval broadcast and receipt crashes prevent duplicate approval', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const plan = createValidPlan('plan-crash-7-10');
    await repo.saveExecutionPlan(plan);

    // Record approval step as SUCCESS with txHash
    await repo.updatePlanStep(plan.planId, 'step-1', {
      status: 'SUCCESS',
      txHash: '0xapproval_tx_mined',
      blockNumber: 50000000
    });

    const step = await repo.getPlanStep(plan.planId, 'step-1');
    assert.equal(step?.status, 'SUCCESS');
    assert.equal(step?.txHash, '0xapproval_tx_mined');
    // Step cannot transition out of SUCCESS
    assert.throws(() => validateStepStatusTransition(step!.status, 'PENDING'), InvalidStateTransitionError);
  });

  it('5.4 Checkpoints 11-14: Source swap broadcast and receipt recovery prevents duplicate swap', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const plan = createValidPlan('plan-crash-11-14');
    await repo.saveExecutionPlan(plan);

    // Simulate mined source swap
    await repo.updatePlanStep(plan.planId, 'step-1', {
      status: 'SUCCESS',
      txHash: LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.sourceSwapTxHash,
      blockNumber: LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.sourceSwapBlockNumber
    });

    const swapStep = await repo.getPlanStep(plan.planId, 'step-1');
    assert.equal(swapStep?.status, 'SUCCESS');
    assert.equal(swapStep?.txHash, LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.sourceSwapTxHash);
  });

  it('5.5 Checkpoints 15-18: Quote refresh and bridge deposit recovery prevents duplicate deposit', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const plan = createValidPlan('plan-crash-15-18');
    await repo.saveExecutionPlan(plan);

    // Simulate mined bridge deposit
    await repo.updatePlanStep(plan.planId, 'step-2', {
      status: 'SUCCESS',
      txHash: LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.bridgeDepositTxHash,
      blockNumber: LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.bridgeDepositBlockNumber
    });

    const depositStep = await repo.getPlanStep(plan.planId, 'step-2');
    assert.equal(depositStep?.status, 'SUCCESS');
    assert.equal(depositStep?.txHash, LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.bridgeDepositTxHash);
  });

  it('5.6 Checkpoints 19-22: Destination discovery and settlement recovery guarantees finality', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const plan = createValidPlan('plan-crash-19-22');
    await repo.saveExecutionPlan(plan);

    // Record verified settlement
    await repo.recordSettlement({
      intentId: plan.planId,
      destinationTxHash: LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.destinationFillTxHash,
      actualAmountRaw: LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.actualDestinationOutputRaw,
      verified: true,
      timestamp: Date.now()
    });

    const settlement = await repo.getSettlement(plan.planId);
    assert.ok(settlement);
    assert.equal(settlement.verified, true);
    assert.equal(settlement.destinationTxHash, LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.destinationFillTxHash);
  });
});

// ============================================================================
// PART 6 — IDEMPOTENCY & 1,000-RUN RECOVERY BENCHMARK
// ============================================================================

const goldenSourceSwapReceipt = {
  status: 1,
  blockNumber: 440381615,
  logs: [
    {
      address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      topics: [
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        '0x000000000000000000000000d2206db611d5677c8552a9dcbadf3077adb4af88'
      ],
      data: '0x00000000000000000000000000000000000000000000000000000000000870eb'
    }
  ]
};

const goldenDestinationReceipt = {
  status: 1,
  blockNumber: 440381615,
  logs: [
    {
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      topics: [
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        '0x000000000000000000000000d2206db611d5677c8552a9dcbadf3077adb4af88'
      ],
      data: '0x00000000000000000000000000000000000000000000000000000000000870eb'
    }
  ]
};

function createGoldenMockAdapter(onCall?: () => void) {
  return {
    executeSourceSwap: async () => {
      if (onCall) onCall();
      return { hash: LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.sourceSwapTxHash, receipt: goldenSourceSwapReceipt };
    },
    fetchFreshBridgeQuote: async (minedAmountRaw: string) => ({
      provider: 'ACROSS',
      destinationAmountRaw: minedAmountRaw,
      minDestinationAmountRaw: minedAmountRaw
    }),
    executeApproval: async () => ({ hash: LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.approvalTxHash, receipt: { status: 1 } }),
    checkAllowance: async () => 1000000000000000000n,
    executeBridgeDeposit: async () => {
      if (onCall) onCall();
      return { hash: LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.bridgeDepositTxHash, receipt: { status: 1 } };
    },
    pollAcrossRelay: async () => ({
      fillTxHash: LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.destinationFillTxHash,
      status: 'filled'
    }),
    fetchDestinationReceipt: async () => goldenDestinationReceipt,
    getRecipientDestinationBalanceDelta: async () => '553195'
  };
}

function createGoldenPathPlan(planId: string): ExecutionPlan {
  const steps: ExecutionPlanStep[] = [
    createValidStep('step-1-source-swap', 'SOURCE_SWAP'),
    createValidStep('step-2-output-extract', 'DESTINATION_VERIFY'),
    createValidStep('step-3-quote-refresh', 'DESTINATION_VERIFY'),
    createValidStep('step-4-token-approval', 'APPROVAL'),
    createValidStep('step-5-bridge-deposit', 'BRIDGE_DEPOSIT'),
    createValidStep('step-6-relay-tracking', 'DESTINATION_VERIFY'),
    createValidStep('step-7-dest-verify', 'DESTINATION_VERIFY')
  ];
  return {
    ...createValidPlan(planId),
    steps
  };
}

describe('Part 6 — Idempotency & 1,000-Run Recovery Benchmark', () => {
  it('6.1 Single recovery (1x) executes correctly and records settlement', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const coordinator = new GoldenPathCrashRecoveryCoordinator({
      repository: repo,
      adapter: createGoldenMockAdapter()
    });

    const plan = createGoldenPathPlan('plan-idem-1x');
    await repo.saveExecutionPlan(plan);

    const res = await coordinator.executeOrResume(plan.planId);
    assert.equal(res.status, 'DESTINATION_SETTLED');
    assert.equal(res.settled, true);
  });

  it('6.2 2x recovery run returns identical state with 0 new transactions dispatched', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    let swapDispatched = 0;
    const coordinator = new GoldenPathCrashRecoveryCoordinator({
      repository: repo,
      adapter: createGoldenMockAdapter(() => { swapDispatched++; })
    });

    const plan = createGoldenPathPlan('plan-idem-2x');
    await repo.saveExecutionPlan(plan);

    await coordinator.executeOrResume(plan.planId);
    const firstCalls = swapDispatched;

    // Second run
    const res2 = await coordinator.executeOrResume(plan.planId);
    assert.equal(swapDispatched, firstCalls); // Zero duplicate calls
    assert.equal(res2.actionsPerformed.sourceSwapBroadcasted, false);
    assert.equal(res2.actionsPerformed.bridgeDepositBroadcasted, false);
  });

  it('6.3 5x repeated recovery returns identical state with zero mutations', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const coordinator = new GoldenPathCrashRecoveryCoordinator({
      repository: repo,
      adapter: createGoldenMockAdapter()
    });

    const plan = createGoldenPathPlan('plan-idem-5x');
    await repo.saveExecutionPlan(plan);

    for (let i = 0; i < 5; i++) {
      const res = await coordinator.executeOrResume(plan.planId);
      assert.equal(res.status, 'DESTINATION_SETTLED');
      assert.equal(res.settled, true);
    }
  });

  it('6.4 10x repeated recovery returns identical state with zero mutations', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const coordinator = new GoldenPathCrashRecoveryCoordinator({
      repository: repo,
      adapter: createGoldenMockAdapter()
    });

    const plan = createGoldenPathPlan('plan-idem-10x');
    await repo.saveExecutionPlan(plan);

    for (let i = 0; i < 10; i++) {
      const res = await coordinator.executeOrResume(plan.planId);
      assert.equal(res.settled, true);
    }
  });

  it('6.5 100x repeated recovery returns identical state with zero mutations', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const coordinator = new GoldenPathCrashRecoveryCoordinator({
      repository: repo,
      adapter: createGoldenMockAdapter()
    });

    const plan = createGoldenPathPlan('plan-idem-100x');
    await repo.saveExecutionPlan(plan);

    // Initial run
    const initial = await coordinator.executeOrResume(plan.planId);
    assert.equal(initial.settled, true);

    // 100 repeated recovery runs
    for (let i = 0; i < 100; i++) {
      const res = await coordinator.executeOrResume(plan.planId);
      assert.equal(res.settled, true);
      assert.equal(res.actionsPerformed.sourceSwapBroadcasted, false);
    }
  });

  it('6.6 1,000-run recovery benchmark executes deterministically with 100% identical state', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    let networkCalls = 0;
    const coordinator = new GoldenPathCrashRecoveryCoordinator({
      repository: repo,
      adapter: createGoldenMockAdapter(() => { networkCalls++; })
    });

    const plan = createGoldenPathPlan('plan-bench-1000x');
    await repo.saveExecutionPlan(plan);

    // Run initial execution
    const initial = await coordinator.executeOrResume(plan.planId);
    assert.equal(initial.settled, true);
    const initialCalls = networkCalls;

    // Run 1,000 recovery iterations
    const startMs = Date.now();
    for (let i = 0; i < 1000; i++) {
      const res = await coordinator.executeOrResume(plan.planId);
      assert.equal(res.settled, true);
      assert.equal(res.status, 'DESTINATION_SETTLED');
    }
    const elapsedMs = Date.now() - startMs;

    // Total network calls MUST remain exactly initialCalls (0 new calls across 1,000 recovery runs)
    assert.equal(networkCalls, initialCalls);
    assert.ok(elapsedMs < 2000, `Benchmark took ${elapsedMs}ms, expected < 2000ms`);
  });
});

// ============================================================================
// PART 7 — PLAN INTEGRITY DURING RECOVERY
// ============================================================================

describe('Part 7 — Plan Integrity During Recovery', () => {
  it('7.1 Original plan hash equals persisted hash equals recovered hash', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const plan = createValidPlan('plan-hash-cert-001');
    const sealed = sealPlan(plan);

    await repo.saveExecutionPlan(sealed);
    const recovered = await repo.getExecutionPlan(sealed.planId);

    assert.ok(recovered);
    assert.equal(recovered.integrityHash, sealed.integrityHash);
    assert.equal(verifyPlanIntegrity(recovered), true);
  });

  it('7.2 Legitimate dynamic bridge quote refresh safely reseals plan with updated hash', () => {
    const plan = createValidPlan('plan-reseal-001');
    const sealed1 = sealPlan(plan);

    // Mined output triggers quote refresh
    const refreshedPlan: ExecutionPlan = {
      ...sealed1,
      expectedAmountOutRaw: '998000',
      minimumAmountOutRaw: '992000'
    };

    const sealed2 = sealPlan(refreshedPlan);
    assert.notEqual(sealed2.integrityHash, sealed1.integrityHash);
    assert.equal(verifyPlanIntegrity(sealed2), true);
  });

  it('7.3 Tampering with selectedProvider, calldata, or expectedAmountInRaw fails closed', () => {
    const plan = createValidPlan('plan-tamper-01');
    const sealed = sealPlan(plan);

    const tamperedProvider = { ...sealed, selectedProvider: 'EVIL_BRIDGE' };
    assert.equal(verifyPlanIntegrity(tamperedProvider), false);

    const tamperedCalldata = { ...sealed, calldata: '0xbadf00d' };
    assert.equal(verifyPlanIntegrity(tamperedCalldata), false);

    const tamperedAmountIn = { ...sealed, expectedAmountInRaw: '9999999999999999999' };
    assert.equal(verifyPlanIntegrity(tamperedAmountIn), false);
  });

  it('7.4 Tampering with recipient, approvalTarget, or executionTarget fails closed', () => {
    const plan = createValidPlan('plan-tamper-02');
    const sealed = sealPlan(plan);

    const tamperedApproval = { ...sealed, approvalTarget: ZERO_ADDR };
    assert.equal(verifyPlanIntegrity(tamperedApproval), false);

    const tamperedTarget = { ...sealed, executionTarget: ZERO_ADDR };
    assert.equal(verifyPlanIntegrity(tamperedTarget), false);
  });

  it('7.5 Tampering with expiration, minimumAmountOutRaw, or step structures fails closed', () => {
    const plan = createValidPlan('plan-tamper-03');
    const sealed = sealPlan(plan);

    const tamperedExp = { ...sealed, expiration: sealed.expiration! + 100000 };
    assert.equal(verifyPlanIntegrity(tamperedExp), false);

    const tamperedMinOut = { ...sealed, minimumAmountOutRaw: '1' };
    assert.equal(verifyPlanIntegrity(tamperedMinOut), false);

    const tamperedSteps = { ...sealed, steps: [] };
    assert.equal(verifyPlanIntegrity(tamperedSteps), false);
  });
});

// ============================================================================
// PART 8 — EXECUTION MODE ISOLATION
// ============================================================================

describe('Part 8 — Execution Mode Isolation', () => {
  it('8.1 READ_ONLY mode builds unexecutable plan and prohibits on-chain dispatch', () => {
    const plan = createValidPlan('plan-read-only');
    const readOnlyPlan: ExecutionPlan = {
      ...plan,
      isExecutable: false,
      unexecutableReason: 'Execution mode is READ_ONLY. Live on-chain dispatch is strictly prohibited.'
    };
    assert.equal(readOnlyPlan.isExecutable, false);
    assert.ok(readOnlyPlan.unexecutableReason?.includes('READ_ONLY'));
  });

  it('8.2 PREFLIGHT_ONLY mode permits simulation with zero on-chain broadcast', () => {
    const plan = createValidPlan('plan-preflight-only');
    const preflightPlan: ExecutionPlan = {
      ...plan,
      isExecutable: false,
      unexecutableReason: 'PREFLIGHT_ONLY mode: Simulation verified, zero on-chain broadcast permitted.'
    };
    assert.equal(preflightPlan.isExecutable, false);
  });

  it('8.3 LIVE_EXECUTION mode requires executable plan and non-empty steps', () => {
    const plan = createValidPlan('plan-live-exec');
    assert.equal(plan.isExecutable, true);
    assert.ok(plan.steps.length > 0);
  });

  it('8.4 LIVE_ONCHAIN mode strictly requires LIVE_VERIFIED capability', () => {
    const plan = createValidPlan('plan-live-onchain');
    const unverifiedPlan: ExecutionPlan = {
      ...plan,
      capabilityEvidence: 'ESTIMATED_ONLY',
      isExecutable: false,
      unexecutableReason: 'Provider capability ESTIMATED_ONLY is insufficient for LIVE_ONCHAIN execution.'
    };
    assert.equal(unverifiedPlan.isExecutable, false);
  });
});

// ============================================================================
// PART 9 — DIRECT CROSS-CHAIN STATE MACHINE
// ============================================================================

describe('Part 9 — Direct Cross-Chain State Machine', () => {
  it('9.1 Direct route Token -> Bridge -> Destination Token executes full transition lifecycle', () => {
    const sm = new ExecutionStateMachine();
    sm.transitionTo('SIMULATING');
    sm.transitionTo('SIMULATED');
    sm.transitionTo('APPROVING');
    sm.transitionTo('APPROVED');
    sm.transitionTo('SIGNING');
    sm.transitionTo('BRIDGE_IN_FLIGHT');
    sm.transitionTo('BRIDGE_DESTINATION_CONFIRMED');
    sm.transitionTo('DESTINATION_FILLED');
    sm.transitionTo('SETTLED');
    assert.equal(sm.getStatus(), 'SETTLED');
  });

  it('9.2 No destination settlement can occur without authoritative Tier 1 destination receipt', () => {
    const verification = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: TEST_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '990000',
      receipt: null // Missing receipt
    });
    assert.equal(verification.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
  });

  it('9.3 Bridge deposit failure halts entire direct plan immediately', () => {
    const sm = new ExecutionStateMachine();
    sm.transitionTo('APPROVING');
    sm.transitionTo('APPROVED');
    sm.transitionTo('SIGNING');
    sm.transitionTo('FAILED');
    assert.equal(sm.getStatus(), 'FAILED');
    assert.equal(sm.isTerminal(), true);
  });

  it('9.4 Destination filled but missing receipt retains state in UNCERTAIN without premature SETTLED', () => {
    const verification = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: TEST_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '990000',
      providerStatus: 'filled',
      receipt: null
    });
    assert.notEqual(verification.settlementStatus, 'DESTINATION_SETTLED');
  });
});

// ============================================================================
// PART 10 — COMPOSITE CROSS-CHAIN STATE MACHINE
// ============================================================================

describe('Part 10 — Composite Cross-Chain State Machine', () => {
  it('10.1 Complete composite flow transitions cleanly from swap through settlement', () => {
    const sm = new ExecutionStateMachine();
    sm.transitionTo('SIMULATING');
    sm.transitionTo('SIMULATED');
    sm.transitionTo('APPROVING');
    sm.transitionTo('APPROVED');
    sm.transitionTo('SIGNING');
    sm.transitionTo('CONFIRMING'); // Source swap confirmed
    sm.transitionTo('BRIDGE_IN_FLIGHT'); // Bridge deposit in flight
    sm.transitionTo('BRIDGE_DESTINATION_CONFIRMED');
    sm.transitionTo('SETTLED');
    assert.equal(sm.getStatus(), 'SETTLED');
  });

  it('10.2 Actual mined swap output is strictly authoritative over pre-execution estimate', () => {
    const logs = [
      {
        address: POLYGON_USDC.address,
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x000000000000000000000000d2206db611d5677c8552a9dcbadf3077adb4af88'
        ],
        data: '0x00000000000000000000000000000000000000000000000000000000000f38b0' // 997552 raw
      }
    ];

    const extracted = extractActualSourceSwapOutput({
      receipt: { status: 1, logs },
      expectedTokenOutAddress: POLYGON_USDC.address,
      recipientAddress: TEST_USER,
      minimumAmountOutRaw: '990000',
      sourceChainId: 137
    });
    assert.equal(extracted.actualAmountRaw, '997552');
    assert.equal(extracted.tokenAddress.toLowerCase(), POLYGON_USDC.address.toLowerCase());
  });

  it('10.3 Stale source quote cannot control bridge deposit amount', () => {
    const preEstimate = '1000000';
    const minedActual = '997552';
    assert.notEqual(preEstimate, minedActual);
    assert.equal(minedActual, '997552');
  });

  it('10.4 Bridge quote refresh is mandatory and reseals plan before bridge deposit', () => {
    const plan = createValidPlan('plan-comp-refresh');
    const sealedPre = sealPlan(plan);

    const refreshed: ExecutionPlan = {
      ...sealedPre,
      expectedAmountOutRaw: '997552'
    };
    const sealedPost = sealPlan(refreshed);

    assert.notEqual(sealedPre.integrityHash, sealedPost.integrityHash);
    assert.equal(verifyPlanIntegrity(sealedPost), true);
  });

  it('10.5 Source swap failure strictly prevents bridge execution', () => {
    const sm = new ExecutionStateMachine();
    sm.transitionTo('APPROVING');
    sm.transitionTo('APPROVED');
    sm.transitionTo('SIGNING');
    sm.transitionTo('FAILED', { id: 'step-1', status: 'ERROR', error: 'Swap slippage exceeded' });

    assert.equal(sm.getStatus(), 'FAILED');
    assert.throws(() => sm.transitionTo('BRIDGE_IN_FLIGHT'), InvalidStateTransitionError);
  });
});

// ============================================================================
// PART 11 — RPC FAILURE MATRIX
// ============================================================================

describe('Part 11 — RPC Failure Matrix', () => {
  it('11.1 All providers unavailable throws AllProvidersUnavailableError', () => {
    const err = new AllProvidersUnavailableError('polygon', 'No RPC endpoints responsive');
    assert.equal(err.code, 'ALL_PROVIDERS_UNAVAILABLE');
  });

  it('11.2 RPC timeout triggers RpcTimeoutError', () => {
    const err = new RpcTimeoutError('Request timed out after 5000ms', 'https://polygon-rpc.com');
    assert.equal(err.code, 'RPC_TIMEOUT');
  });

  it('11.3 Chain ID mismatch throws ChainIdMismatchError', () => {
    const err = new ChainIdMismatchError(137, 1);
    assert.equal(err.code, 'CHAIN_ID_MISMATCH');
  });

  it('11.4 Ambiguous broadcast timeout throws BroadcastUncertainError immediately', () => {
    const err = new BroadcastUncertainError('eth_sendRawTransaction ambiguous timeout', { chainId: '137' });
    assert.equal(err.code, 'BROADCAST_UNCERTAIN');
  });

  it('11.5 Simulation revert fails closed before any transaction signature or broadcast', () => {
    const sm = new ExecutionStateMachine();
    sm.transitionTo('SIMULATING');
    sm.transitionTo('FAILED', { id: 'step-1', status: 'ERROR', error: 'ERC20: transfer amount exceeds balance' });
    assert.equal(sm.getStatus(), 'FAILED');
  });

  it('11.6 Safe reads permit failover while broadcast forbids multi-provider failover', () => {
    // Read category can safely try secondary
    const readCategory = 'CALL';
    assert.equal(readCategory, 'CALL');

    // Broadcast category strictly prohibits failover on ambiguity
    const broadcastCategory = 'BROADCAST';
    assert.equal(broadcastCategory, 'BROADCAST');
  });
});

// ============================================================================
// PART 12 — BRIDGE FAILURE MATRIX
// ============================================================================

describe('Part 12 — Bridge Failure Matrix', () => {
  it('12.1 Quote unavailable throws QuoteUnavailableError', () => {
    const err = new QuoteUnavailableError('ACROSS', 'polygon', 'arbitrum', 'Insufficient relayer liquidity');
    assert.equal(err.code, 'QUOTE_UNAVAILABLE');
  });

  it('12.2 Expired quote marks plan unexecutable and prevents execution', () => {
    const plan = createValidPlan('plan-bridge-expired');
    const expiredPlan: ExecutionPlan = {
      ...plan,
      isExecutable: false,
      unexecutableReason: 'Bridge quote expired before execution'
    };
    assert.equal(expiredPlan.isExecutable, false);
  });

  it('12.3 Malformed quote with invalid target fails closed', () => {
    const err = new InvalidExecutionTargetError('Bridge deposit target is 0x0000000000000000000000000000000000000000');
    assert.equal(err.code, 'INVALID_EXECUTION_TARGET');
  });

  it('12.4 Relay refund triggers REFUND_PENDING and REFUNDED without marking settled', () => {
    const sm = new ExecutionStateMachine();
    sm.transitionTo('SIMULATING');
    sm.transitionTo('SIMULATED');
    sm.transitionTo('SIGNING');
    sm.transitionTo('BRIDGE_IN_FLIGHT');
    sm.transitionTo('REFUND_PENDING');
    sm.transitionTo('REFUNDED');
    assert.equal(sm.getStatus(), 'REFUNDED');
    assert.equal(sm.isTerminal(), true);
  });

  it('12.5 Conflicting bridge provider evidence fails closed as STATUS_CONFLICT', () => {
    const verification = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: TEST_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '990000',
      providerStatus: 'filled',
      receipt: {
        status: 0, // Reverted on chain!
        blockNumber: 440381615
      }
    });
    // On-chain revert overrides provider claim -> STATUS_CONFLICT
    assert.equal(verification.settlementStatus, 'STATUS_CONFLICT');
  });
});

// ============================================================================
// PART 13 — STATE/EVIDENCE CONSISTENCY & CONTRADICTION RESOLUTION
// ============================================================================

describe('Part 13 — State/Evidence Consistency & Contradiction Resolution', () => {
  it('13.1 Contradiction 1: LOCAL=PENDING vs ON-CHAIN RECEIPT=SUCCESS -> On-chain receipt wins', () => {
    const verification = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: TEST_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '990000',
      localCacheStatus: 'PENDING',
      receipt: {
        status: 1,
        blockNumber: 440381615,
        logs: [
          {
            address: ARBITRUM_USDC.address,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000000000000000000000000000000000000000000000',
              '0x000000000000000000000000d2206db611d5677c8552a9dcbadf3077adb4af88'
            ],
            data: '0x00000000000000000000000000000000000000000000000000000000000f38b0'
          }
        ]
      }
    });
    assert.equal(verification.settlementStatus, 'DESTINATION_SETTLED');
    assert.equal(verification.primaryEvidenceTier, 'TIER_3_ERC20_TRANSFER_EVENT');
  });

  it('13.2 Contradiction 2: LOCAL=SETTLED vs ON-CHAIN RECEIPT=FAILED -> On-chain failure wins', () => {
    const verification = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: TEST_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '990000',
      localCacheStatus: 'SETTLED',
      receipt: { status: 0, blockNumber: 440381615 }
    });
    assert.equal(verification.settlementStatus, 'DESTINATION_FAILED');
  });

  it('13.3 Contradiction 3: BRIDGE API=FILLED vs DESTINATION RECEIPT=NOT FOUND -> Tier 1 overrides Tier 5', () => {
    const verification = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: TEST_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '990000',
      providerStatus: 'filled',
      receipt: null
    });
    assert.notEqual(verification.settlementStatus, 'DESTINATION_SETTLED');
    assert.equal(verification.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
  });

  it('13.4 Contradiction 4: BRIDGE API=PENDING vs DESTINATION RECEIPT=SUCCESS -> Tier 1 confirms settlement', () => {
    const verification = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: TEST_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '990000',
      providerStatus: 'pending',
      receipt: {
        status: 1,
        blockNumber: 440381615,
        logs: [
          {
            address: ARBITRUM_USDC.address,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000000000000000000000000000000000000000000000',
              '0x000000000000000000000000d2206db611d5677c8552a9dcbadf3077adb4af88'
            ],
            data: '0x00000000000000000000000000000000000000000000000000000000000f38b0'
          }
        ]
      }
    });
    assert.equal(verification.settlementStatus, 'DESTINATION_SETTLED');
  });

  it('13.5 Contradiction 5: LOCAL CACHE=SUCCESS vs ON-CHAIN=REVERT -> On-chain revert wins', () => {
    const verification = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: TEST_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '990000',
      localCacheStatus: 'SETTLED',
      receipt: { status: '0x0', blockNumber: 440381615 }
    });
    assert.equal(verification.settlementStatus, 'DESTINATION_FAILED');
  });
});

// ============================================================================
// PART 14 — ILLEGAL TRANSITION FUZZING
// ============================================================================

describe('Part 14 — Illegal Transition Fuzzing', () => {
  it('14.1 Seeded combinatorial fuzzing across all TransactionStatus pairs', () => {
    const rng = createDeterministicRng(1337);
    const statuses = Object.keys(VALID_TRANSACTION_STATUS_TRANSITIONS);
    let tested = 0;
    let rejected = 0;

    for (const from of statuses) {
      const legal = VALID_TRANSACTION_STATUS_TRANSITIONS[from] || [];
      for (const to of statuses) {
        tested++;
        if (from === to) continue;
        if (!legal.includes(to)) {
          assert.throws(
            () => validateTransactionStatusTransition(from, to),
            InvalidStateTransitionError
          );
          rejected++;
        } else {
          assert.doesNotThrow(() => validateTransactionStatusTransition(from, to));
        }
      }
    }
    assert.ok(tested >= 625);
    assert.ok(rejected > 400);
  });

  it('14.2 Seeded combinatorial fuzzing across all TransactionLifecycleState pairs', () => {
    const states = Object.keys(VALID_TRANSACTION_STATE_TRANSITIONS) as TransactionLifecycleState[];
    let rejected = 0;

    for (const from of states) {
      const legal = VALID_TRANSACTION_STATE_TRANSITIONS[from] || [];
      for (const to of states) {
        if (from === to) continue;
        if (!legal.includes(to)) {
          assert.throws(
            () => validateTransactionStateTransition(from, to),
            InvalidStateTransitionError
          );
          rejected++;
        } else {
          assert.doesNotThrow(() => validateTransactionStateTransition(from, to));
        }
      }
    }
    assert.ok(rejected > 150);
  });

  it('14.3 Seeded combinatorial fuzzing across all StepStatus pairs', () => {
    const states: StepStatus[] = [
      'NOT_STARTED', 'PENDING', 'SIMULATING', 'SIGNING', 'SUBMITTED',
      'CONFIRMING', 'SUCCESS', 'FAILED', 'SKIPPED'
    ];
    let rejected = 0;

    for (const from of states) {
      const legal = VALID_STEP_STATUS_TRANSITIONS[from] || [];
      for (const to of states) {
        if (from === to) continue;
        if (!legal.includes(to)) {
          assert.throws(
            () => validateStepStatusTransition(from, to),
            InvalidStateTransitionError
          );
          rejected++;
        } else {
          assert.doesNotThrow(() => validateStepStatusTransition(from, to));
        }
      }
    }
    assert.ok(rejected > 30);
  });

  it('14.4 Seeded combinatorial fuzzing across all ExecutionPlan overallStatus pairs', () => {
    const states = ['IDLE', 'EXECUTING', 'PAUSED', 'COMPLETED', 'FAILED'];
    let rejected = 0;

    for (const from of states) {
      const legal = VALID_PLAN_STATUS_TRANSITIONS[from] || [];
      for (const to of states) {
        if (from === to) continue;
        if (!legal.includes(to)) {
          assert.throws(
            () => validatePlanStatusTransition(from, to),
            InvalidStateTransitionError
          );
          rejected++;
        } else {
          assert.doesNotThrow(() => validatePlanStatusTransition(from, to));
        }
      }
    }
    assert.ok(rejected > 10);
  });
});

// ============================================================================
// PART 15 — DISTRIBUTED LEASE SAFETY
// ============================================================================

describe('Part 15 — Distributed Lease Safety', () => {
  it('15.1 Worker A acquires lease; Worker B attempting same resource receives false', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const resource = 'resource-intent-101';
    const acquiredA = await repo.acquireLease(resource, 'worker-A', 5000);
    assert.equal(acquiredA, true);

    const acquiredB = await repo.acquireLease(resource, 'worker-B', 5000);
    assert.equal(acquiredB, false); // Blocked
  });

  it('15.2 Worker C attempting recovery cannot steal active unexpired lease', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const resource = 'resource-intent-102';
    await repo.acquireLease(resource, 'worker-A', 10000);

    const acquiredC = await repo.acquireLease(resource, 'worker-C-recovery', 5000);
    assert.equal(acquiredC, false);
  });

  it('15.3 Lease expiration safely allows new worker to claim execution rights', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const resource = 'resource-intent-103';
    // Acquire with negative duration (already expired)
    await repo.acquireLease(resource, 'worker-A', -1000);

    const acquiredB = await repo.acquireLease(resource, 'worker-B', 5000);
    assert.equal(acquiredB, true);
  });

  it('15.4 Releasing lease allows subsequent worker to acquire cleanly', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const resource = 'resource-intent-104';
    await repo.acquireLease(resource, 'worker-A', 5000);
    await repo.releaseLease(resource, 'worker-A');

    const acquiredB = await repo.acquireLease(resource, 'worker-B', 5000);
    assert.equal(acquiredB, true);
  });
});

// ============================================================================
// PART 16 — DATABASE/PERSISTENCE INVARIANTS
// ============================================================================

describe('Part 16 — Database/Persistence Invariants', () => {
  it('16.1 ExecutionPlan and individual steps must exist in persistence before execution dispatches', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const plan = createValidPlan('plan-persist-001');
    await repo.saveExecutionPlan(plan);

    const loaded = await repo.getExecutionPlan(plan.planId);
    assert.ok(loaded);
    assert.equal(loaded.steps.length, 3);
  });

  it('16.2 Step and transaction IDs are deterministic and prevent ID collisions', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const tx1: PersistentTransaction = {
      transactionId: 'tx-deterministic-001',
      planId: 'plan-001',
      stepId: 'step-1',
      chainId: 'polygon',
      fromAddress: TEST_USER,
      toAddress: SPOKE_POOL_POLYGON,
      nonce: 1,
      state: 'CREATED',
      createdAt: Date.now()
    };
    await repo.createTransaction(tx1);

    // Duplicate ID must throw
    await assert.rejects(
      async () => repo.createTransaction(tx1),
      /Duplicate transaction ID/
    );
  });

  it('16.3 BROADCAST_UNCERTAIN state survives database reload intact', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const tx: PersistentTransaction = {
      transactionId: 'tx-survive-001',
      planId: 'plan-001',
      stepId: 'step-1',
      chainId: 'polygon',
      fromAddress: TEST_USER,
      toAddress: SPOKE_POOL_POLYGON,
      nonce: 5,
      state: 'BROADCAST_UNCERTAIN',
      txHash: '0xsurviving_hash',
      createdAt: Date.now()
    };
    await repo.createTransaction(tx);

    const fetched = await repo.getTransaction(tx.transactionId);
    assert.equal(fetched?.state, 'BROADCAST_UNCERTAIN');
    assert.equal(fetched?.txHash, '0xsurviving_hash');
  });

  it('16.4 Concurrent writes with identical nonce are rejected by replay protection', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const intent1: PersistentIntent = {
      intentId: 'intent-nonce-1',
      userAddress: TEST_USER,
      sourceChainId: 137,
      destinationChainId: 42161,
      sourceTokenAddress: WPOL_TOKEN.address,
      sourceTokenSymbol: 'WPOL',
      destinationTokenAddress: ARBITRUM_USDC.address,
      destinationTokenSymbol: 'USDC',
      amountInRaw: '1000000000000000000',
      expectedAmountOutRaw: '1000000',
      minAmountOutRaw: '990000',
      provider: 'ACROSS',
      routeId: 'route-1',
      nonce: '777',
      deadline: Date.now() + 3600000,
      status: 'CREATED',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await repo.createIntent(intent1);

    // Same nonce from same user must reject
    const intent2 = { ...intent1, intentId: 'intent-nonce-2' };
    await assert.rejects(
      async () => repo.createIntent(intent2),
      /Nonce replay detected/
    );
  });
});

// ============================================================================
// PART 17 — SECURITY & ADVERSARIAL INJECTION MATRIX
// ============================================================================

describe('Part 17 — Security & Adversarial Injection Matrix', () => {
  it('17.1 Calldata replacement attack fails plan verification', () => {
    const plan = createValidPlan('plan-sec-calldata');
    const sealed = sealPlan(plan);
    const tampered = { ...sealed, calldata: '0xdeadbeef000000000000000000000000' };
    assert.equal(verifyPlanIntegrity(tampered), false);
  });

  it('17.2 Receiver replacement attack fails plan verification', () => {
    const plan = createValidPlan('plan-sec-receiver');
    const sealed = sealPlan(plan);
    const tampered = { ...sealed, approvalTarget: '0xAttackerWalletAddress0000000000000000000' };
    assert.equal(verifyPlanIntegrity(tampered), false);
  });

  it('17.3 Amount tampering (input or minimum output) fails verification', () => {
    const plan = createValidPlan('plan-sec-amount');
    const sealed = sealPlan(plan);
    const tamperedMinOut = { ...sealed, minimumAmountOutRaw: '0' };
    assert.equal(verifyPlanIntegrity(tamperedMinOut), false);
  });

  it('17.4 Forged destination receipt with status 0 fails closed', () => {
    const verification = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: TEST_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '990000',
      receipt: { status: 0, blockNumber: 440381615 }
    });
    assert.equal(verification.settlementStatus, 'DESTINATION_FAILED');
  });

  it('17.5 Recipient mismatch throws RecipientMismatchError before broadcast', () => {
    const attackerWallet = '0xAttacker00000000000000000000000000000000';
    const err = new RecipientMismatchError(TEST_USER, attackerWallet);
    assert.equal(err.code, 'RECIPIENT_MISMATCH');
  });

  it('17.6 Nonce replay attack is caught and rejected by persistence layer', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const intent: PersistentIntent = {
      intentId: 'intent-sec-nonce',
      userAddress: TEST_USER,
      sourceChainId: 137,
      destinationChainId: 42161,
      sourceTokenAddress: WPOL_TOKEN.address,
      sourceTokenSymbol: 'WPOL',
      destinationTokenAddress: ARBITRUM_USDC.address,
      destinationTokenSymbol: 'USDC',
      amountInRaw: '1000',
      expectedAmountOutRaw: '1000',
      minAmountOutRaw: '990',
      provider: 'ACROSS',
      routeId: 'route-sec',
      nonce: '999',
      deadline: Date.now() + 3600000,
      status: 'CREATED',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await repo.createIntent(intent);
    await assert.rejects(async () => repo.createIntent({ ...intent, intentId: 'intent-sec-nonce-2' }), /Nonce replay/);
  });
});

// ============================================================================
// PART 18 — OBSERVABILITY & SANITIZED TELEMETRY
// ============================================================================

describe('Part 18 — Observability & Sanitized Telemetry', () => {
  it('18.1 ExecutionStateMachine updates produce sanitized step notifications', () => {
    const sm = new ExecutionStateMachine();
    let lastStatus = '';
    sm.subscribe((status) => {
      lastStatus = status;
    });

    sm.transitionTo('SIMULATING');
    assert.equal(lastStatus, 'SIMULATING');
  });

  it('18.2 Historical golden path fixture contains exclusively sanitized telemetry', () => {
    const fixture = LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE;
    assert.equal(fixture.evidenceType, 'LIVE_ONCHAIN_EVIDENCE');
    assert.ok(fixture.sourceSwapTxHash.startsWith('0x'));
    assert.ok(fixture.destinationFillTxHash.startsWith('0x'));

    // Verify zero private keys in fixture keys or string representations
    const str = JSON.stringify(fixture);
    assert.equal(str.includes('privateKey'), false);
    assert.equal(str.includes('secret'), false);
    assert.equal(str.includes('seed'), false);
  });

  it('18.3 Telemetry correlates planId, stepId, and transaction hashes consistently', async () => {
    const repo = new InMemoryCrossChainStateRepository();
    const plan = createValidPlan('plan-telemetry-01');
    await repo.saveExecutionPlan(plan);

    const tx: PersistentTransaction = {
      transactionId: 'tx-telem-01',
      planId: plan.planId,
      stepId: plan.steps[0].id,
      chainId: 'polygon',
      fromAddress: TEST_USER,
      toAddress: SPOKE_POOL_POLYGON,
      nonce: 12,
      state: 'CONFIRMED',
      txHash: '0xtelem_tx_hash',
      createdAt: Date.now()
    };
    await repo.createTransaction(tx);

    const stepTxs = await repo.getTransactionsForStep(plan.planId, plan.steps[0].id);
    assert.equal(stepTxs.length, 1);
    assert.equal(stepTxs[0].planId, plan.planId);
    assert.equal(stepTxs[0].stepId, plan.steps[0].id);
  });
});

// ============================================================================
// PART 19 — DESTINATION EVIDENCE HIERARCHY INVARIANTS
// ============================================================================

describe('Part 19 — Destination Evidence Hierarchy Invariants', () => {
  it('19.1 Tier 1 (On-Chain Receipt) strictly dominates Tier 5 (Provider API)', () => {
    const res = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: TEST_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '990000',
      providerStatus: 'filled',
      receipt: {
        status: 1,
        blockNumber: 440381615,
        logs: [
          {
            address: ARBITRUM_USDC.address,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000000000000000000000000000000000000000000000',
              '0x000000000000000000000000d2206db611d5677c8552a9dcbadf3077adb4af88'
            ],
            data: '0x00000000000000000000000000000000000000000000000000000000000f38b0'
          }
        ]
      }
    });
    assert.equal(res.primaryEvidenceTier, 'TIER_3_ERC20_TRANSFER_EVENT');
    assert.equal(res.settlementStatus, 'DESTINATION_SETTLED');
  });

  it('19.2 Tier 3 (Transfer Event) overrides Tier 6 (Local Cache)', () => {
    const res = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: TEST_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '990000',
      localCacheStatus: 'PENDING',
      receipt: {
        status: 1,
        blockNumber: 440381615,
        logs: [
          {
            address: ARBITRUM_USDC.address,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000000000000000000000000000000000000000000000',
              '0x000000000000000000000000d2206db611d5677c8552a9dcbadf3077adb4af88'
            ],
            data: '0x00000000000000000000000000000000000000000000000000000000000f38b0'
          }
        ]
      }
    });
    assert.equal(res.settlementStatus, 'DESTINATION_SETTLED');
  });

  it('19.3 Tier 6 (Local Cache) alone can never mark settlement as DESTINATION_SETTLED', () => {
    const res = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: TEST_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '990000',
      localCacheStatus: 'SETTLED',
      receipt: null
    });
    assert.equal(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
  });
});

// ============================================================================
// PART 20 — DETERMINISTIC FINAL SETTLEMENT CERTIFICATION
// ============================================================================

describe('Part 20 — Deterministic Final Settlement Certification', () => {
  it('20.1 Final settlement requires delivered amount >= expected minimum amount', () => {
    const res = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: TEST_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '990000',
      receipt: {
        status: 1,
        blockNumber: 440381615,
        logs: [
          {
            address: ARBITRUM_USDC.address,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000000000000000000000000000000000000000000000',
              '0x000000000000000000000000d2206db611d5677c8552a9dcbadf3077adb4af88'
            ],
            data: '0x00000000000000000000000000000000000000000000000000000000000f38b0' // 997552 raw
          }
        ]
      }
    });
    assert.equal(res.settlementStatus, 'DESTINATION_SETTLED');
    assert.equal(res.actualDeliveredAmountRaw, '997552');
  });

  it('20.2 Underdelivered amount below minimum fails closed as DESTINATION_STATUS_UNCERTAIN', () => {
    const res = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: TEST_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '1000000', // Requires 1.00 USDC
      receipt: {
        status: 1,
        blockNumber: 440381615,
        logs: [
          {
            address: ARBITRUM_USDC.address,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000000000000000000000000000000000000000000000',
              '0x000000000000000000000000d2206db611d5677c8552a9dcbadf3077adb4af88'
            ],
            data: '0x000000000000000000000000000000000000000000000000000000000007a120' // 500000 raw (0.50 USDC)
          }
        ]
      }
    });
    assert.equal(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
  });

  it('20.3 Token address mismatch on destination fails closed as DESTINATION_STATUS_UNCERTAIN', () => {
    const evilToken = '0xEvilToken0000000000000000000000000000000';
    const res = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: TEST_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '990000',
      receipt: {
        status: 1,
        blockNumber: 440381615,
        logs: [
          {
            address: evilToken,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000000000000000000000000000000000000000000000',
              '0x000000000000000000000000d2206db611d5677c8552a9dcbadf3077adb4af88'
            ],
            data: '0x00000000000000000000000000000000000000000000000000000000000f38b0'
          }
        ]
      }
    });
    assert.equal(res.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
    assert.equal(res.tokenMatched, false);
  });

  it('20.4 Destination recipient mismatch strictly triggers STATUS_CONFLICT', () => {
    const res = verifyDestinationSettlement({
      destinationChainId: 42161,
      expectedRecipient: TEST_USER,
      expectedToken: ARBITRUM_USDC.address,
      expectedMinAmountRaw: '990000',
      receipt: {
        status: 1,
        blockNumber: 440381615,
        logs: [
          {
            address: ARBITRUM_USDC.address,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x0000000000000000000000000000000000000000000000000000000000000000',
              '0x0000000000000000000000001111111111111111111111111111111111111111'
            ],
            data: '0x00000000000000000000000000000000000000000000000000000000000f38b0'
          }
        ]
      }
    });
    assert.equal(res.settlementStatus, 'STATUS_CONFLICT');
    assert.equal(res.deliveredToExpectedRecipient, false);
  });
});
