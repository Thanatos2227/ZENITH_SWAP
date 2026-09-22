import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as fs from 'fs';
import {
  SQLiteCrossChainStateRepository
} from '../packages/execution/src/persistence/sqliteRepository';
import {
  GoldenPathCrashRecoveryCoordinator,
  GoldenPathAdapter,
  GoldenPathPhase
} from '../packages/execution/src/crosschain/goldenPathCrashRecoveryCoordinator';
import { ExecutionPlan } from '../packages/types/src';
import { Interface } from 'ethers';

const TEST_DB_DIR = path.join(__dirname, '..', 'temp_test_dbs');

function getTempDbPath(testName: string): string {
  if (!fs.existsSync(TEST_DB_DIR)) {
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  }
  return path.join(TEST_DB_DIR, `crash_recovery_${testName}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.db`);
}

function removeTempDb(dbPath: string): void {
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  } catch {}
}

const OPERATOR_WALLET = '0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88';
const POLYGON_USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const ARBITRUM_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const ACROSS_SPOKE_POOL = '0xFD03AbCAdaF3F930fA4E37Eb2f6ea3A44a41b7F0';

const MINED_SOURCE_SWAP_TX = '0xbeaa1d786b82b5639bc89f0357dd00fd4f6ef801385a30f2a0e916e2f6bc60c0';
const MINED_APPROVAL_TX = '0x49247a7d4a59df80339c283406855d9ac6faa2e0ca1cc6cb61f19263e6b66c69';
const MINED_BRIDGE_DEPOSIT_TX = '0x6cdc877e7a12b0cefb05c480d507115456fef3a339908cf67484aa65103c99c8';
const MINED_DESTINATION_FILL_TX = '0xc3f73e3f169d66bfa29af744725e0b4eb3f9f321e29e144a5845eab074e0f3b5';

function createMockGoldenPlan(planId: string): ExecutionPlan {
  return {
    planId,
    routeId: 'route-polygon-arbitrum-golden-path',
    routeType: 'CROSS_CHAIN_COMPOSITE',
    sourceChainId: 'polygon',
    destinationChainId: 'arbitrum',
    tokenIn: {
      address: '0x0000000000000000000000000000000000001010',
      symbol: 'POL',
      decimals: 18,
      chainId: 'polygon'
    },
    tokenOut: {
      address: ARBITRUM_USDC,
      symbol: 'USDC',
      decimals: 6,
      chainId: 'arbitrum'
    },
    expectedAmountInRaw: '5000000000000000000',
    expectedAmountOutRaw: '542968',
    minimumAmountOutRaw: '505151',
    isExecutable: true,
    diagnostics: [],
    steps: [
      {
        id: 'step-1-source-swap',
        type: 'SOURCE_SWAP',
        title: 'Polygon POL -> USDC Swap',
        description: 'Swap 5.0 POL for USDC on Uniswap V3',
        chainId: 'polygon',
        numericChainId: 137,
        executionEnvironment: 'EVM',
        status: 'IDLE',
        dependencies: [],
        retryPolicy: { maxAttempts: 1, initialDelayMs: 1000, maxDelayMs: 2000, backoffFactor: 1.5 }
      },
      {
        id: 'step-2-output-extract',
        type: 'VALIDATION',
        title: 'Extract Mined Output',
        description: 'Extract exact USDC mined from transfer event',
        chainId: 'polygon',
        numericChainId: 137,
        executionEnvironment: 'OFF_CHAIN',
        status: 'IDLE',
        dependencies: ['step-1-source-swap'],
        retryPolicy: { maxAttempts: 1, initialDelayMs: 1000, maxDelayMs: 2000, backoffFactor: 1.5 }
      },
      {
        id: 'step-3-quote-refresh',
        type: 'BRIDGE_QUOTE_REFRESH',
        title: 'Refresh Across Bridge Quote',
        description: 'Fetch fresh bridge quote with exact mined amount',
        chainId: 'polygon',
        numericChainId: 137,
        executionEnvironment: 'OFF_CHAIN',
        status: 'IDLE',
        dependencies: ['step-2-output-extract'],
        retryPolicy: { maxAttempts: 1, initialDelayMs: 1000, maxDelayMs: 2000, backoffFactor: 1.5 }
      },
      {
        id: 'step-4-token-approval',
        type: 'APPROVAL',
        title: 'Approve USDC to Across SpokePool',
        description: 'Bounded approval for exact mined USDC',
        chainId: 'polygon',
        numericChainId: 137,
        executionEnvironment: 'EVM',
        status: 'IDLE',
        dependencies: ['step-3-quote-refresh'],
        retryPolicy: { maxAttempts: 1, initialDelayMs: 1000, maxDelayMs: 2000, backoffFactor: 1.5 }
      },
      {
        id: 'step-5-bridge-deposit',
        type: 'BRIDGE_DEPOSIT',
        title: 'Across V3 Deposit',
        description: 'Deposit USDC into Across SpokePool for Arbitrum relay',
        chainId: 'polygon',
        numericChainId: 137,
        executionEnvironment: 'EVM',
        status: 'IDLE',
        dependencies: ['step-4-token-approval'],
        retryPolicy: { maxAttempts: 1, initialDelayMs: 1000, maxDelayMs: 2000, backoffFactor: 1.5 }
      },
      {
        id: 'step-6-relay-tracking',
        type: 'BRIDGE_RELAY_WAIT',
        title: 'Across Relay Wait',
        description: 'Poll Across API for fill transaction on Arbitrum One',
        chainId: 'arbitrum',
        numericChainId: 42161,
        executionEnvironment: 'OFF_CHAIN',
        status: 'IDLE',
        dependencies: ['step-5-bridge-deposit'],
        retryPolicy: { maxAttempts: 1, initialDelayMs: 1000, maxDelayMs: 2000, backoffFactor: 1.5 }
      },
      {
        id: 'step-7-dest-verify',
        type: 'DESTINATION_VERIFY',
        title: 'Destination On-Chain Verification',
        description: 'Authoritatively verify fill receipt on Arbitrum One',
        chainId: 'arbitrum',
        numericChainId: 42161,
        executionEnvironment: 'EVM',
        status: 'IDLE',
        dependencies: ['step-6-relay-tracking'],
        retryPolicy: { maxAttempts: 1, initialDelayMs: 1000, maxDelayMs: 2000, backoffFactor: 1.5 }
      }
    ],
    currentStepIndex: 0,
    overallStatus: 'IDLE',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function createMockAdapter(counts: {
  swapCalls: number;
  quoteCalls: number;
  approvalCalls: number;
  depositCalls: number;
  relayCalls: number;
  verifyCalls: number;
}): GoldenPathAdapter {
  const erc20Iface = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
  const transferLog = erc20Iface.encodeEventLog(
    erc20Iface.getEvent('Transfer')!,
    ['0x3000000000000000000000000000000000000003', OPERATOR_WALLET, 553197n]
  );

  return {
    executeSourceSwap: async () => {
      counts.swapCalls++;
      return {
        hash: MINED_SOURCE_SWAP_TX,
        receipt: {
          status: 1,
          blockNumber: 94206631,
          logs: [
            {
              address: POLYGON_USDC,
              topics: transferLog.topics,
              data: transferLog.data
            }
          ]
        }
      };
    },
    fetchFreshBridgeQuote: async (minedAmountRaw: string) => {
      counts.quoteCalls++;
      return {
        calldata: '0xmock_across_deposit_calldata_fresh',
        expectedOutput: '542968'
      };
    },
    executeApproval: async (spender: string, amount: bigint) => {
      counts.approvalCalls++;
      return {
        hash: MINED_APPROVAL_TX,
        receipt: { status: 1, blockNumber: 94206633 }
      };
    },
    checkAllowance: async (spender: string) => {
      return 0n; // requires approval
    },
    executeBridgeDeposit: async (calldata: string) => {
      counts.depositCalls++;
      return {
        hash: MINED_BRIDGE_DEPOSIT_TX,
        receipt: { status: 1, blockNumber: 94206635 }
      };
    },
    pollAcrossRelay: async (depositTxHash: string) => {
      counts.relayCalls++;
      return {
        fillTxHash: MINED_DESTINATION_FILL_TX,
        status: 'filled'
      };
    },
    fetchDestinationReceipt: async (fillTxHash: string) => {
      counts.verifyCalls++;
      return {
        status: 1,
        blockNumber: 440381615,
        gasUsed: 89124n
      };
    }
  };
}

test('ZENITH — PHASE 1 TASK 24: CRASH RECOVERY & SETTLEMENT IDEMPOTENCY SUITE', async (t) => {

  // ============================================================================
  // TASK 6: 8-POINT CRASH RECOVERY RE-ENTRY SUITE
  // ============================================================================

  await t.test('1. Phase 1 Crash Recovery: Crashed after source swap mined -> restart recovers and NEVER rebroadcasts swap', async () => {
    const dbPath = getTempDbPath('phase_1');
    try {
      const counts = { swapCalls: 0, quoteCalls: 0, approvalCalls: 0, depositCalls: 0, relayCalls: 0, verifyCalls: 0 };
      const adapter = createMockAdapter(counts);

      // Session 1: Crashes after Phase 1 (source swap mined)
      const repo1 = new SQLiteCrossChainStateRepository(dbPath);
      const plan = createMockGoldenPlan('plan-phase-1');
      await repo1.saveExecutionPlan(plan);
      for (const s of plan.steps) await repo1.savePlanStep(plan.planId, s);

      const coord1 = new GoldenPathCrashRecoveryCoordinator({ repository: repo1, adapter });
      const res1 = await coord1.executeOrResume('plan-phase-1', { stopAfterPhase: 'PHASE_1_SOURCE_SWAP_MINED' });

      assert.equal(res1.phase, 'PHASE_1_SOURCE_SWAP_MINED');
      assert.equal(res1.sourceTxHash, MINED_SOURCE_SWAP_TX);
      assert.equal(res1.actionsPerformed.sourceSwapBroadcasted, true);
      assert.equal(counts.swapCalls, 1);
      repo1.close();

      // Session 2: Process restarts (fresh coordinator instance on same SQLite DB)
      const repo2 = new SQLiteCrossChainStateRepository(dbPath);
      const coord2 = new GoldenPathCrashRecoveryCoordinator({ repository: repo2, adapter });
      const res2 = await coord2.executeOrResume('plan-phase-1');

      assert.equal(res2.status, 'DESTINATION_SETTLED');
      assert.equal(res2.phase, 'PHASE_8_SETTLEMENT_COMPLETED');
      assert.equal(res2.sourceTxHash, MINED_SOURCE_SWAP_TX);
      assert.equal(res2.destinationTxHash, MINED_DESTINATION_FILL_TX);
      assert.equal(res2.actionsPerformed.sourceSwapBroadcasted, false); // ZERO REBROADCAST!
      assert.equal(counts.swapCalls, 1); // Exact count remains 1!
      assert.equal(counts.depositCalls, 1);
      repo2.close();
    } finally {
      removeTempDb(dbPath);
    }
  });

  await t.test('2. Phase 2 Crash Recovery: Crashed after output extracted -> restart preserves mined output and proceeds', async () => {
    const dbPath = getTempDbPath('phase_2');
    try {
      const counts = { swapCalls: 0, quoteCalls: 0, approvalCalls: 0, depositCalls: 0, relayCalls: 0, verifyCalls: 0 };
      const adapter = createMockAdapter(counts);

      // Session 1: Crashes after Phase 2 (output extracted)
      const repo1 = new SQLiteCrossChainStateRepository(dbPath);
      const plan = createMockGoldenPlan('plan-phase-2');
      await repo1.saveExecutionPlan(plan);
      for (const s of plan.steps) await repo1.savePlanStep(plan.planId, s);

      const coord1 = new GoldenPathCrashRecoveryCoordinator({ repository: repo1, adapter });
      const res1 = await coord1.executeOrResume('plan-phase-2', { stopAfterPhase: 'PHASE_2_OUTPUT_EXTRACTED' });

      assert.equal(res1.phase, 'PHASE_2_OUTPUT_EXTRACTED');
      assert.equal(res1.actualMinedOutputRaw, '553197');
      repo1.close();

      // Session 2: Restart
      const repo2 = new SQLiteCrossChainStateRepository(dbPath);
      const coord2 = new GoldenPathCrashRecoveryCoordinator({ repository: repo2, adapter });
      const res2 = await coord2.executeOrResume('plan-phase-2');

      assert.equal(res2.status, 'DESTINATION_SETTLED');
      assert.equal(res2.actionsPerformed.sourceSwapBroadcasted, false); // No swap rebroadcast
      assert.equal(counts.swapCalls, 1);
      assert.equal(res2.destinationTxHash, MINED_DESTINATION_FILL_TX);
      repo2.close();
    } finally {
      removeTempDb(dbPath);
    }
  });

  await t.test('3. Phase 3 Crash Recovery: Crashed after bridge quote refreshed -> restart reuses refreshed quote', async () => {
    const dbPath = getTempDbPath('phase_3');
    try {
      const counts = { swapCalls: 0, quoteCalls: 0, approvalCalls: 0, depositCalls: 0, relayCalls: 0, verifyCalls: 0 };
      const adapter = createMockAdapter(counts);

      // Session 1: Crashes after Phase 3 (quote refreshed)
      const repo1 = new SQLiteCrossChainStateRepository(dbPath);
      const plan = createMockGoldenPlan('plan-phase-3');
      await repo1.saveExecutionPlan(plan);
      for (const s of plan.steps) await repo1.savePlanStep(plan.planId, s);

      const coord1 = new GoldenPathCrashRecoveryCoordinator({ repository: repo1, adapter });
      const res1 = await coord1.executeOrResume('plan-phase-3', { stopAfterPhase: 'PHASE_3_QUOTE_REFRESHED' });

      assert.equal(res1.phase, 'PHASE_3_QUOTE_REFRESHED');
      assert.equal(counts.quoteCalls, 1);
      repo1.close();

      // Session 2: Restart
      const repo2 = new SQLiteCrossChainStateRepository(dbPath);
      const coord2 = new GoldenPathCrashRecoveryCoordinator({ repository: repo2, adapter });
      const res2 = await coord2.executeOrResume('plan-phase-3');

      assert.equal(res2.status, 'DESTINATION_SETTLED');
      assert.equal(res2.actionsPerformed.sourceSwapBroadcasted, false);
      assert.equal(res2.actionsPerformed.bridgeQuoteRefreshed, false); // Quote reused from DB!
      assert.equal(counts.quoteCalls, 1);
      repo2.close();
    } finally {
      removeTempDb(dbPath);
    }
  });

  await t.test('4. Phase 4 Crash Recovery: Crashed after token approval mined -> restart NEVER rebroadcasts approval', async () => {
    const dbPath = getTempDbPath('phase_4');
    try {
      const counts = { swapCalls: 0, quoteCalls: 0, approvalCalls: 0, depositCalls: 0, relayCalls: 0, verifyCalls: 0 };
      const adapter = createMockAdapter(counts);

      // Session 1: Crashes after Phase 4 (approval mined)
      const repo1 = new SQLiteCrossChainStateRepository(dbPath);
      const plan = createMockGoldenPlan('plan-phase-4');
      await repo1.saveExecutionPlan(plan);
      for (const s of plan.steps) await repo1.savePlanStep(plan.planId, s);

      const coord1 = new GoldenPathCrashRecoveryCoordinator({ repository: repo1, adapter });
      const res1 = await coord1.executeOrResume('plan-phase-4', { stopAfterPhase: 'PHASE_4_APPROVAL_MINED' });

      assert.equal(res1.phase, 'PHASE_4_APPROVAL_MINED');
      assert.equal(res1.approvalTxHash, MINED_APPROVAL_TX);
      assert.equal(counts.approvalCalls, 1);
      repo1.close();

      // Session 2: Restart
      const repo2 = new SQLiteCrossChainStateRepository(dbPath);
      const coord2 = new GoldenPathCrashRecoveryCoordinator({ repository: repo2, adapter });
      const res2 = await coord2.executeOrResume('plan-phase-4');

      assert.equal(res2.status, 'DESTINATION_SETTLED');
      assert.equal(res2.actionsPerformed.approvalBroadcasted, false); // ZERO DUPLICATE APPROVAL!
      assert.equal(counts.approvalCalls, 1);
      assert.equal(counts.depositCalls, 1);
      repo2.close();
    } finally {
      removeTempDb(dbPath);
    }
  });

  await t.test('5. Phase 5 Crash Recovery: Crashed after Across deposit mined -> restart NEVER rebroadcasts deposit', async () => {
    const dbPath = getTempDbPath('phase_5');
    try {
      const counts = { swapCalls: 0, quoteCalls: 0, approvalCalls: 0, depositCalls: 0, relayCalls: 0, verifyCalls: 0 };
      const adapter = createMockAdapter(counts);

      // Session 1: Crashes after Phase 5 (Across deposit mined)
      const repo1 = new SQLiteCrossChainStateRepository(dbPath);
      const plan = createMockGoldenPlan('plan-phase-5');
      await repo1.saveExecutionPlan(plan);
      for (const s of plan.steps) await repo1.savePlanStep(plan.planId, s);

      const coord1 = new GoldenPathCrashRecoveryCoordinator({ repository: repo1, adapter });
      const res1 = await coord1.executeOrResume('plan-phase-5', { stopAfterPhase: 'PHASE_5_DEPOSIT_MINED' });

      assert.equal(res1.phase, 'PHASE_5_DEPOSIT_MINED');
      assert.equal(res1.bridgeTxHash, MINED_BRIDGE_DEPOSIT_TX);
      assert.equal(counts.depositCalls, 1);
      repo1.close();

      // Session 2: Restart
      const repo2 = new SQLiteCrossChainStateRepository(dbPath);
      const coord2 = new GoldenPathCrashRecoveryCoordinator({ repository: repo2, adapter });
      const res2 = await coord2.executeOrResume('plan-phase-5');

      assert.equal(res2.status, 'DESTINATION_SETTLED');
      assert.equal(res2.actionsPerformed.bridgeDepositBroadcasted, false); // ZERO DUPLICATE DEPOSIT!
      assert.equal(counts.depositCalls, 1);
      assert.equal(res2.destinationTxHash, MINED_DESTINATION_FILL_TX);
      repo2.close();
    } finally {
      removeTempDb(dbPath);
    }
  });

  await t.test('6. Phase 6 Crash Recovery: Crashed while waiting for Across relay -> restart resumes tracking and verifies destination', async () => {
    const dbPath = getTempDbPath('phase_6');
    try {
      const counts = { swapCalls: 0, quoteCalls: 0, approvalCalls: 0, depositCalls: 0, relayCalls: 0, verifyCalls: 0 };
      const adapter = createMockAdapter(counts);

      // Session 1: Crashes after Phase 6 (relay tracked)
      const repo1 = new SQLiteCrossChainStateRepository(dbPath);
      const plan = createMockGoldenPlan('plan-phase-6');
      await repo1.saveExecutionPlan(plan);
      for (const s of plan.steps) await repo1.savePlanStep(plan.planId, s);

      const coord1 = new GoldenPathCrashRecoveryCoordinator({ repository: repo1, adapter });
      const res1 = await coord1.executeOrResume('plan-phase-6', { stopAfterPhase: 'PHASE_6_RELAY_WAITING' });

      assert.equal(res1.phase, 'PHASE_6_RELAY_WAITING');
      assert.equal(res1.destinationTxHash, MINED_DESTINATION_FILL_TX);
      repo1.close();

      // Session 2: Restart
      const repo2 = new SQLiteCrossChainStateRepository(dbPath);
      const coord2 = new GoldenPathCrashRecoveryCoordinator({ repository: repo2, adapter });
      const res2 = await coord2.executeOrResume('plan-phase-6');

      assert.equal(res2.status, 'DESTINATION_SETTLED');
      assert.equal(res2.actionsPerformed.bridgeDepositBroadcasted, false);
      assert.equal(res2.actionsPerformed.destinationReceiptVerified, true);
      assert.equal(res2.destinationTxHash, MINED_DESTINATION_FILL_TX);
      repo2.close();
    } finally {
      removeTempDb(dbPath);
    }
  });

  await t.test('7. Phase 7 Crash Recovery: Crashed after destination receipt fetched -> restart completes settlement recording', async () => {
    const dbPath = getTempDbPath('phase_7');
    try {
      const counts = { swapCalls: 0, quoteCalls: 0, approvalCalls: 0, depositCalls: 0, relayCalls: 0, verifyCalls: 0 };
      const adapter = createMockAdapter(counts);

      // Session 1: Crashes after Phase 7 (destination receipt fetched)
      const repo1 = new SQLiteCrossChainStateRepository(dbPath);
      const plan = createMockGoldenPlan('plan-phase-7');
      await repo1.saveExecutionPlan(plan);
      for (const s of plan.steps) await repo1.savePlanStep(plan.planId, s);

      const coord1 = new GoldenPathCrashRecoveryCoordinator({ repository: repo1, adapter });
      const res1 = await coord1.executeOrResume('plan-phase-7', { stopAfterPhase: 'PHASE_7_DESTINATION_VERIFIED' });

      assert.equal(res1.phase, 'PHASE_7_DESTINATION_VERIFIED');
      assert.equal(res1.destinationBlockNumber, 440381615);
      repo1.close();

      // Session 2: Restart
      const repo2 = new SQLiteCrossChainStateRepository(dbPath);
      const coord2 = new GoldenPathCrashRecoveryCoordinator({ repository: repo2, adapter });
      const res2 = await coord2.executeOrResume('plan-phase-7');

      assert.equal(res2.status, 'DESTINATION_SETTLED');
      assert.equal(res2.actionsPerformed.settlementRecorded, true);
      assert.equal(res2.settled, true);

      // Verify settlement in SQLite
      const settlement = await repo2.getSettlement('plan-phase-7');
      assert.ok(settlement);
      assert.equal(settlement?.verified, true);
      assert.equal(settlement?.destinationTxHash, MINED_DESTINATION_FILL_TX);
      repo2.close();
    } finally {
      removeTempDb(dbPath);
    }
  });

  await t.test('8. Phase 8 Crash Recovery: Process terminates after settlement -> restart immediately returns settled', async () => {
    const dbPath = getTempDbPath('phase_8');
    try {
      const counts = { swapCalls: 0, quoteCalls: 0, approvalCalls: 0, depositCalls: 0, relayCalls: 0, verifyCalls: 0 };
      const adapter = createMockAdapter(counts);

      const repo1 = new SQLiteCrossChainStateRepository(dbPath);
      const plan = createMockGoldenPlan('plan-phase-8');
      await repo1.saveExecutionPlan(plan);
      for (const s of plan.steps) await repo1.savePlanStep(plan.planId, s);

      const coord1 = new GoldenPathCrashRecoveryCoordinator({ repository: repo1, adapter });
      const res1 = await coord1.executeOrResume('plan-phase-8');
      assert.equal(res1.status, 'DESTINATION_SETTLED');
      repo1.close();

      // Restart
      const repo2 = new SQLiteCrossChainStateRepository(dbPath);
      const coord2 = new GoldenPathCrashRecoveryCoordinator({ repository: repo2, adapter });
      const res2 = await coord2.executeOrResume('plan-phase-8');

      assert.equal(res2.status, 'DESTINATION_SETTLED');
      assert.equal(res2.settled, true);
      assert.equal(res2.actionsPerformed.sourceSwapBroadcasted, false);
      assert.equal(res2.actionsPerformed.approvalBroadcasted, false);
      assert.equal(res2.actionsPerformed.bridgeDepositBroadcasted, false);
      assert.equal(counts.swapCalls, 1);
      assert.equal(counts.depositCalls, 1);
      repo2.close();
    } finally {
      removeTempDb(dbPath);
    }
  });

  // ============================================================================
  // TASK 7: SETTLEMENT IDEMPOTENCY TEST
  // ============================================================================

  await t.test('9. Settlement Idempotency: Calling reconciliation/settlement multiple times produces identical result with 0 duplicate transactions', async () => {
    const dbPath = getTempDbPath('idempotency');
    try {
      const counts = { swapCalls: 0, quoteCalls: 0, approvalCalls: 0, depositCalls: 0, relayCalls: 0, verifyCalls: 0 };
      const adapter = createMockAdapter(counts);

      const repo = new SQLiteCrossChainStateRepository(dbPath);
      const plan = createMockGoldenPlan('plan-idempotency');
      await repo.saveExecutionPlan(plan);
      for (const s of plan.steps) await repo.savePlanStep(plan.planId, s);

      const coord = new GoldenPathCrashRecoveryCoordinator({ repository: repo, adapter });

      // Run 1: Normal execution to completion
      const run1 = await coord.executeOrResume('plan-idempotency');
      assert.equal(run1.status, 'DESTINATION_SETTLED');
      assert.equal(run1.settled, true);
      assert.equal(counts.swapCalls, 1);
      assert.equal(counts.approvalCalls, 1);
      assert.equal(counts.depositCalls, 1);

      // Run 2: Re-invoked on settled plan
      const run2 = await coord.executeOrResume('plan-idempotency');
      assert.equal(run2.status, 'DESTINATION_SETTLED');
      assert.equal(run2.settled, true);
      assert.equal(run2.destinationTxHash, run1.destinationTxHash);
      assert.equal(run2.sourceTxHash, run1.sourceTxHash);
      assert.equal(run2.bridgeTxHash, run1.bridgeTxHash);

      // Assert ZERO new transactions, ZERO calls
      assert.equal(counts.swapCalls, 1, 'No additional swap calls on second invocation');
      assert.equal(counts.approvalCalls, 1, 'No additional approval calls on second invocation');
      assert.equal(counts.depositCalls, 1, 'No additional deposit calls on second invocation');
      assert.equal(run2.actionsPerformed.sourceSwapBroadcasted, false);
      assert.equal(run2.actionsPerformed.approvalBroadcasted, false);
      assert.equal(run2.actionsPerformed.bridgeDepositBroadcasted, false);
      assert.equal(run2.actionsPerformed.destinationReceiptVerified, false);

      // Run 3: Third invocation
      const run3 = await coord.executeOrResume('plan-idempotency');
      assert.equal(run3.status, 'DESTINATION_SETTLED');
      assert.equal(counts.swapCalls, 1);
      assert.equal(counts.approvalCalls, 1);
      assert.equal(counts.depositCalls, 1);

      // Verify persistent settlement record untouched
      const settlement = await repo.getSettlement('plan-idempotency');
      assert.ok(settlement);
      assert.equal(settlement?.verified, true);
      assert.equal(settlement?.destinationTxHash, MINED_DESTINATION_FILL_TX);
      assert.equal(settlement?.actualAmountRaw, '542968');

      repo.close();
    } finally {
      removeTempDb(dbPath);
    }
  });

  await t.test('10. Fail-Closed Invariant: Missing adapter capability prevents corrupted execution state', async () => {
    const dbPath = getTempDbPath('fail_closed');
    try {
      const repo = new SQLiteCrossChainStateRepository(dbPath);
      const plan = createMockGoldenPlan('plan-fail-closed');
      await repo.saveExecutionPlan(plan);
      for (const s of plan.steps) await repo.savePlanStep(plan.planId, s);

      // Defective adapter missing executeSourceSwap
      const defectiveAdapter: GoldenPathAdapter = {};
      const coord = new GoldenPathCrashRecoveryCoordinator({ repository: repo, adapter: defectiveAdapter });

      await assert.rejects(
        async () => {
          await coord.executeOrResume('plan-fail-closed');
        },
        /Adapter missing executeSourceSwap capability/
      );

      // Verify plan state is not corrupted into COMPLETED
      const storedPlan = await repo.getExecutionPlan('plan-fail-closed');
      assert.notEqual(storedPlan?.overallStatus, 'COMPLETED');
      assert.equal(storedPlan?.overallStatus, 'IDLE');

      repo.close();
    } finally {
      removeTempDb(dbPath);
    }
  });
});
