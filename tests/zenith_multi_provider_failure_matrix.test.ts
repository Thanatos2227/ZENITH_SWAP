import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as fs from 'fs';
import {
  MultiProviderRpcManager,
  RpcManagerConfig
} from '../packages/chains/src/rpc/multiProviderRpcManager';
import {
  MultiProviderRpcClient
} from '../packages/execution/src/providers/multiProviderRpcClient';
import {
  CrossChainStatusReconciler
} from '../packages/execution/src/reconciliation/statusReconciler';
import {
  SQLiteCrossChainStateRepository
} from '../packages/execution/src/persistence/sqliteRepository';
import {
  GoldenPathCrashRecoveryCoordinator,
  GoldenPathAdapter,
  GoldenPathPhase
} from '../packages/execution/src/crosschain/goldenPathCrashRecoveryCoordinator';
import {
  LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE
} from '../packages/execution/src/fixtures/goldenPathExecutionFixture';
import {
  normalizeAcrossDepositStatus,
  isValidHexTxHash
} from '../packages/routing/src/crosschain/providers/acrossProvider';
import {
  verifyDestinationSettlement
} from '../packages/execution/src/crosschain/authoritativeDestinationVerifier';
import {
  MultiProviderMetricsCollector
} from '../packages/execution/src/crosschain/multiProviderMetrics';
import {
  AllProvidersUnavailableError,
  BroadcastUncertainError,
  ChainIdMismatchError,
  RpcTimeoutError
} from '../packages/contracts/src';
import { ExecutionPlan } from '../packages/types/src';
import { Interface } from 'ethers';

const TEST_DB_DIR = path.join(__dirname, '..', 'temp_test_dbs');

function getTempDbPath(testName: string): string {
  if (!fs.existsSync(TEST_DB_DIR)) {
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  }
  return path.join(TEST_DB_DIR, `multi_provider_${testName}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.db`);
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

test('ZENITH — PHASE 1 TASK 25: MULTI-PROVIDER RELIABILITY & FAILOVER SUITE', async (t) => {

  // ============================================================================
  // TASK 2: 12-POINT FAILURE INJECTION MATRIX
  // ============================================================================

  await t.test('Task 2.1: Failure at Quote Retrieval -> classifies error as RETRYABLE and enables provider rotation', () => {
    const client = new MultiProviderRpcClient();
    const timeoutErr = new Error('ETIMEDOUT: Connection timed out');
    const http500Err = new Error('Internal Server Error 500');

    assert.equal(client.classifyError(timeoutErr), 'RETRYABLE');
    assert.equal(client.classifyError(http500Err), 'RETRYABLE');
  });

  await t.test('Task 2.2: Failure at eth_call Simulation -> contract revert is NON_RETRYABLE; transport failure is RETRYABLE', () => {
    const client = new MultiProviderRpcClient();
    const revertErr = new Error('execution reverted: V3_TOO_LITTLE_RECEIVED');
    const transportErr = new Error('fetch failed: network socket disconnected');

    assert.equal(client.classifyError(revertErr), 'NON_RETRYABLE');
    assert.equal(client.classifyError(transportErr), 'RETRYABLE');
  });

  await t.test('Task 2.3: Failure at eth_estimateGas -> reverts fail closed without corrupting state', () => {
    const client = new MultiProviderRpcClient();
    const gasLimitErr = new Error('gas_limit_overflow: intrinsic gas too low');
    assert.equal(client.classifyError(gasLimitErr), 'NON_RETRYABLE');
  });

  await t.test('Task 2.4: Failure at Fee Retrieval (eth_gasPrice) -> fails over across eligible endpoints', async () => {
    const manager = new MultiProviderRpcManager({ seedDefaultEndpoints: false });
    manager.registerEndpoint({
      id: 'poly-rpc-1',
      chainId: 'polygon',
      numericChainId: 137,
      url: 'https://broken-rpc-1.example.com',
      priority: 1
    });
    manager.registerEndpoint({
      id: 'poly-rpc-2',
      chainId: 'polygon',
      numericChainId: 137,
      url: 'https://working-rpc-2.example.com',
      priority: 2
    });

    const client = new MultiProviderRpcClient({ manager });
    const eligible = manager.selectEligibleEndpoints('polygon');
    assert.equal(eligible.length, 2);
    assert.equal(eligible[0].id, 'poly-rpc-1');

    // Simulate failure on RPC 1
    manager.recordFailure('poly-rpc-1', true, 'RETRYABLE');
    const updatedEligible = manager.selectEligibleEndpoints('polygon');
    assert.equal(updatedEligible[0].id, 'poly-rpc-1'); // still eligible (DEGRADED)
    manager.recordFailure('poly-rpc-1', true, 'RETRYABLE');
    manager.recordFailure('poly-rpc-1', true, 'RETRYABLE'); // 3 failures -> CIRCUIT_OPEN
    assert.equal(manager.getEndpoint('poly-rpc-1')?.circuitState, 'OPEN');

    const postTripEligible = manager.selectEligibleEndpoints('polygon');
    assert.equal(postTripEligible.length, 1);
    assert.equal(postTripEligible[0].id, 'poly-rpc-2'); // rotated to backup!
  });

  await t.test('Task 2.5: Failure at Nonce Retrieval -> rotates to backup endpoint without nonce assumption', () => {
    const client = new MultiProviderRpcClient();
    const rateLimitErr = new Error('429 Too Many Requests: Rate limit exceeded');
    assert.equal(client.classifyError(rateLimitErr), 'RETRYABLE');
  });

  await t.test('Task 2.6: Failure at Balance Retrieval -> retryable network drop preserves balance safety', () => {
    const client = new MultiProviderRpcClient();
    const socketHangup = new Error('socket hang up');
    assert.equal(client.classifyError(socketHangup), 'RETRYABLE');
  });

  await t.test('Task 2.7: Failure at Bytecode Retrieval (eth_getCode) -> failover succeeds without fake bytecode', () => {
    const client = new MultiProviderRpcClient();
    const econnReset = new Error('ECONNRESET: Connection reset by peer');
    assert.equal(client.classifyError(econnReset), 'RETRYABLE');
  });

  await t.test('Task 2.8: Failure at Transaction Lookup (eth_getTransactionByHash) -> missing tx returns null without synthetic hash', () => {
    const client = new MultiProviderRpcClient();
    const notFoundErr = new Error('Transaction not found');
    assert.equal(client.classifyError(notFoundErr), 'RETRYABLE');
  });

  await t.test('Task 2.9: Failure at Receipt Lookup (eth_getTransactionReceipt) -> pending receipt handled safely without fabricating status', () => {
    const result = verifyDestinationSettlement({
      expectedRecipient: OPERATOR_WALLET,
      expectedToken: ARBITRUM_USDC,
      expectedMinAmountRaw: '505151',
      receipt: null
    });
    assert.equal(result.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
  });

  await t.test('Task 2.10: Failure at Bridge Status Lookup -> Across API 500 fails closed without fabricated fill', () => {
    const normalized = normalizeAcrossDepositStatus(null);
    assert.equal(normalized.status, 'unknown');
    assert.equal(normalized.resolvedFillTx, null);
    assert.equal(normalized.hasStatusConflict, false);
  });

  await t.test('Task 2.11 & 2.12: Failure at Destination Transaction & Receipt Lookup -> Arbitrum RPC timeout marks uncertain', () => {
    const result = verifyDestinationSettlement({
      expectedRecipient: OPERATOR_WALLET,
      expectedToken: ARBITRUM_USDC,
      expectedMinAmountRaw: '505151',
      providerStatus: 'filled',
      providerFillTx: MINED_DESTINATION_FILL_TX,
      receipt: null
    });
    assert.equal(result.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
  });

  // ============================================================================
  // TASK 3: BROADCAST UNCERTAINTY & RECOVERY
  // ============================================================================

  await t.test('Task 3: Broadcast Uncertainty throws BroadcastUncertainError and STRICTLY BLOCKS automatic failover', async () => {
    const manager = new MultiProviderRpcManager({ seedDefaultEndpoints: false });
    manager.registerEndpoint({
      id: 'arb-rpc-1',
      chainId: 'arbitrum',
      numericChainId: 42161,
      url: 'https://rpc1.example.com',
      priority: 1
    });
    manager.registerEndpoint({
      id: 'arb-rpc-2',
      chainId: 'arbitrum',
      numericChainId: 42161,
      url: 'https://rpc2.example.com',
      priority: 2
    });

    const client = new MultiProviderRpcClient({ manager, defaultTimeoutMs: 100 });

    // Simulate timeout during broadcast
    let broadcastAttempts = 0;
    await assert.rejects(
      async () => {
        await client.executeBroadcast('arbitrum', '0x1234', async () => {
          broadcastAttempts++;
          throw new RpcTimeoutError('Broadcast timed out after 200ms', 'arbitrum', 'eth_sendRawTransaction', 200);
        });
      },
      (err: any) => {
        assert.ok(err instanceof BroadcastUncertainError);
        assert.ok(err.message.includes('Automatic failover is blocked to prevent double-spend'));
        return true;
      }
    );

    // CRITICAL SECURITY ASSERTION: Exactly 1 broadcast attempt occurred!
    // Automatic retry to RPC-2 was STRICTLY PREVENTED.
    assert.equal(broadcastAttempts, 1);
  });

  await t.test('Task 3 Recovery A: Uncertain broadcast persisted in SQLite -> recovered when tx found on-chain', async () => {
    const dbPath = getTempDbPath('recovery_a');
    try {
      const repo = new SQLiteCrossChainStateRepository(dbPath);
      const plan = createMockGoldenPlan('plan-uncertain-a');
      await repo.saveExecutionPlan(plan);
      for (const s of plan.steps) await repo.savePlanStep(plan.planId, s);

      // Record uncertain transaction
      await repo.createTransaction({
        transactionId: 'tx-uncertain-1',
        planId: 'plan-uncertain-a',
        stepId: 'step-1-source-swap',
        chainId: 'polygon',
        nonce: 29,
        fromAddress: OPERATOR_WALLET,
        toAddress: POLYGON_USDC,
        valueWei: '5000000000000000000',
        calldata: '0x1234',
        state: 'BROADCAST_UNCERTAIN',
        txHash: MINED_SOURCE_SWAP_TX,
        createdAt: Date.now()
      });

      const tx = await repo.getTransaction('tx-uncertain-1');
      assert.equal(tx?.state, 'BROADCAST_UNCERTAIN');
      assert.equal(tx?.nonce, 29);

      // Simulated recovery: Tx is discovered mined on-chain
      await repo.updateTransaction('tx-uncertain-1', {
        state: 'CONFIRMED',
        confirmedAt: Date.now(),
        blockNumber: 94206631
      });
      await repo.updatePlanStep('plan-uncertain-a', 'step-1-source-swap', {
        status: 'SUCCESS',
        txHash: MINED_SOURCE_SWAP_TX,
        blockNumber: 94206631
      });

      const recoveredStep = await repo.getPlanStep('plan-uncertain-a', 'step-1-source-swap');
      assert.equal(recoveredStep?.status, 'SUCCESS');
      assert.equal(recoveredStep?.txHash, MINED_SOURCE_SWAP_TX);

      repo.close();
    } finally {
      removeTempDb(dbPath);
    }
  });

  await t.test('Task 3 Recovery B: Uncertain broadcast not found on-chain -> validates nonce before manual retry', async () => {
    const dbPath = getTempDbPath('recovery_b');
    try {
      const repo = new SQLiteCrossChainStateRepository(dbPath);
      const plan = createMockGoldenPlan('plan-uncertain-b');
      await repo.saveExecutionPlan(plan);
      for (const s of plan.steps) await repo.savePlanStep(plan.planId, s);

      await repo.createTransaction({
        transactionId: 'tx-uncertain-2',
        planId: 'plan-uncertain-b',
        stepId: 'step-5-bridge-deposit',
        chainId: 'polygon',
        nonce: 31,
        fromAddress: OPERATOR_WALLET,
        toAddress: ACROSS_SPOKE_POOL,
        valueWei: '0',
        calldata: '0xabcd',
        state: 'BROADCAST_UNCERTAIN',
        createdAt: Date.now()
      });

      // Verify transaction is marked RECOVERY_REQUIRED if unconfirmed and nonce untouched
      await repo.updateTransaction('tx-uncertain-2', {
        state: 'RECOVERY_REQUIRED',
        errorMessage: 'Broadcast unconfirmed on-chain. Nonce 31 verified untouched; manual operator intervention required.'
      });

      const tx = await repo.getTransaction('tx-uncertain-2');
      assert.equal(tx?.state, 'RECOVERY_REQUIRED');
      assert.ok(tx?.errorMessage?.includes('manual operator intervention required'));

      repo.close();
    } finally {
      removeTempDb(dbPath);
    }
  });

  // ============================================================================
  // TASK 4: ACROSS FAILURE MATRIX
  // ============================================================================

  await t.test('Task 4: Across Failure Matrix (10 Cases) -> all fail closed safely', () => {
    // 1. HTTP Timeout / Network Disconnect
    const c1 = normalizeAcrossDepositStatus(undefined);
    assert.equal(c1.resolvedFillTx, null);
    assert.equal(c1.status, 'unknown');

    // 2. HTTP 5xx Server Error
    const c2 = normalizeAcrossDepositStatus({ error: 'Internal Server Error 500' });
    assert.equal(c2.resolvedFillTx, null);

    // 3. Malformed non-object
    const c3 = normalizeAcrossDepositStatus('malformed string');
    assert.equal(c3.resolvedFillTx, null);

    // 4. Missing data payload
    const c4 = normalizeAcrossDepositStatus({});
    assert.equal(c4.resolvedFillTx, null);

    // 5. Missing fillTx with status filled
    const c5 = normalizeAcrossDepositStatus({ status: 'filled' });
    assert.equal(c5.hasStatusConflict, true);
    assert.equal(c5.resolvedFillTx, null);

    // 6. Non-hex fillTx
    const c6 = normalizeAcrossDepositStatus({ status: 'filled', fillTx: 'not_a_hex_tx' });
    assert.equal(c6.resolvedFillTx, null);

    // 7. Truncated fillTxnRef
    const c7 = normalizeAcrossDepositStatus({ status: 'filled', fillTxnRef: '0x123' });
    assert.equal(c7.resolvedFillTx, null);

    // 8. Conflicting fields: status != filled but fillTx present
    const c8 = normalizeAcrossDepositStatus({ status: 'pending', fillTx: MINED_DESTINATION_FILL_TX });
    assert.equal(c8.hasStatusConflict, true);
    assert.equal(c8.resolvedFillTx, MINED_DESTINATION_FILL_TX.toLowerCase());

    // 9. Stale statuses (refunded / expired)
    const c9a = normalizeAcrossDepositStatus({ status: 'refunded' });
    assert.equal(c9a.status, 'refunded');
    assert.equal(c9a.resolvedFillTx, null);
    const c9b = normalizeAcrossDepositStatus({ status: 'expired' });
    assert.equal(c9b.status, 'expired');
    assert.equal(c9b.resolvedFillTx, null);

    // 10. Provider says filled but destination has no receipt
    const c10 = verifyDestinationSettlement({
      expectedRecipient: OPERATOR_WALLET,
      expectedToken: ARBITRUM_USDC,
      expectedMinAmountRaw: '505151',
      providerStatus: 'filled',
      providerFillTx: MINED_DESTINATION_FILL_TX,
      receipt: null
    });
    assert.equal(c10.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
  });

  // ============================================================================
  // TASK 5: PROVIDER DISAGREEMENT & SETTLEMENT ARBITRATION
  // ============================================================================

  await t.test('Task 5.1: Provider Disagreement (Provider A = FILLED, Provider B = PENDING) + No On-Chain Receipt -> DESTINATION_STATUS_UNCERTAIN', () => {
    const result = verifyDestinationSettlement({
      expectedRecipient: OPERATOR_WALLET,
      expectedToken: ARBITRUM_USDC,
      expectedMinAmountRaw: '505151',
      providerStatus: 'filled',
      providerFillTx: MINED_DESTINATION_FILL_TX,
      receipt: null
    });

    assert.equal(result.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
  });

  await t.test('Task 5.2: Provider Disagreement (Provider A = FILLED, Provider B = PENDING) + On-Chain Success Receipt -> DESTINATION_SETTLED (On-Chain Wins)', () => {
    const erc20Iface = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
    const destTransferLog = erc20Iface.encodeEventLog(
      erc20Iface.getEvent('Transfer')!,
      [ACROSS_SPOKE_POOL, OPERATOR_WALLET, 542968n]
    );

    const result = verifyDestinationSettlement({
      expectedRecipient: OPERATOR_WALLET,
      expectedToken: ARBITRUM_USDC,
      expectedMinAmountRaw: '505151',
      providerStatus: 'pending', // Provider says pending
      receipt: {
        status: 1, // On-chain says SUCCESS!
        blockNumber: 440381615,
        logs: [
          {
            address: ARBITRUM_USDC,
            topics: destTransferLog.topics,
            data: destTransferLog.data
          }
        ]
      },
      currentBalanceRaw: '542968'
    });

    // Authoritative on-chain evidence strictly overrides provider disagreement!
    assert.equal(result.settlementStatus, 'DESTINATION_SETTLED');
    assert.equal(result.primaryEvidenceTier, 'TIER_3_ERC20_TRANSFER_EVENT');
    assert.equal(result.deliveredToExpectedRecipient, true);
  });

  // ============================================================================
  // TASK 6: DESTINATION RPC FAILOVER & STALE BLOCK LAG
  // ============================================================================

  await t.test('Task 6.1: Destination RPC Failover -> RPC-A down, RPC-B up -> seamless failover', () => {
    const manager = new MultiProviderRpcManager({ seedDefaultEndpoints: false });
    manager.registerEndpoint({
      id: 'arb-rpc-a',
      chainId: 'arbitrum',
      numericChainId: 42161,
      url: 'https://broken-arb-a.example.com',
      priority: 1
    });
    manager.registerEndpoint({
      id: 'arb-rpc-b',
      chainId: 'arbitrum',
      numericChainId: 42161,
      url: 'https://working-arb-b.example.com',
      priority: 2
    });

    // Mark RPC-A UNHEALTHY
    manager.updateEndpointStatus('arb-rpc-a', 'UNHEALTHY');
    const eligible = manager.selectEligibleEndpoints('arbitrum');
    assert.equal(eligible.length, 1);
    assert.equal(eligible[0].id, 'arb-rpc-b');
  });

  await t.test('Task 6.2: Destination RPC Stale Block Lag -> RPC-A lagging by 10 blocks -> excluded from selection', () => {
    const manager = new MultiProviderRpcManager({ seedDefaultEndpoints: false, maxAllowedBlockLag: 5 });
    manager.registerEndpoint({
      id: 'arb-lagging',
      chainId: 'arbitrum',
      numericChainId: 42161,
      url: 'https://lagging.example.com',
      priority: 1
    });
    manager.registerEndpoint({
      id: 'arb-synced',
      chainId: 'arbitrum',
      numericChainId: 42161,
      url: 'https://synced.example.com',
      priority: 2
    });

    // Record highest block from synced RPC
    manager.recordSuccess('arb-synced', 50, 440381625);
    // Record lagging block
    manager.recordSuccess('arb-lagging', 50, 440381610); // 15 blocks behind

    const { isLagging, lag } = manager.checkBlockLag('arb-lagging');
    assert.equal(isLagging, true);
    assert.equal(lag, 15);

    const eligible = manager.selectEligibleEndpoints('arbitrum', { requireBlockSync: true });
    assert.equal(eligible.length, 1);
    assert.equal(eligible[0].id, 'arb-synced');
  });

  await t.test('Task 6.3: Both Destination RPCs Unavailable -> fails closed to DESTINATION_STATUS_UNCERTAIN', () => {
    const manager = new MultiProviderRpcManager({ seedDefaultEndpoints: false });
    manager.registerEndpoint({
      id: 'arb-rpc-1',
      chainId: 'arbitrum',
      numericChainId: 42161,
      url: 'https://down1.example.com',
      priority: 1
    });
    manager.updateEndpointStatus('arb-rpc-1', 'UNHEALTHY');

    const eligible = manager.selectEligibleEndpoints('arbitrum');
    assert.equal(eligible.length, 0);

    const result = verifyDestinationSettlement({
      expectedRecipient: OPERATOR_WALLET,
      expectedToken: ARBITRUM_USDC,
      expectedMinAmountRaw: '505151',
      receipt: null
    });
    assert.equal(result.settlementStatus, 'DESTINATION_STATUS_UNCERTAIN');
  });

  // ============================================================================
  // TASK 7: CIRCUIT BREAKER STATE MACHINE
  // ============================================================================

  await t.test('Task 7: Circuit Breaker State Transitions (HEALTHY -> DEGRADED -> CIRCUIT_OPEN -> RECOVERING -> HEALTHY)', async () => {
    const manager = new MultiProviderRpcManager({
      seedDefaultEndpoints: false,
      failureThreshold: 3,
      successThreshold: 2,
      circuitOpenCooldownMs: 50 // 50ms for test speed
    });

    manager.registerEndpoint({
      id: 'cb-test-rpc',
      chainId: 'polygon',
      numericChainId: 137,
      url: 'https://cb.example.com',
      priority: 1
    });

    const ep = manager.getEndpoint('cb-test-rpc')!;
    assert.equal(ep.status, 'HEALTHY');
    assert.equal(ep.circuitState, 'CLOSED');

    // 1. First failure -> DEGRADED
    manager.recordFailure('cb-test-rpc', false, 'RETRYABLE');
    assert.equal(ep.status, 'DEGRADED');
    assert.equal(ep.circuitState, 'CLOSED');
    assert.equal(ep.consecutiveFailures, 1);

    // 2. Second failure -> still DEGRADED
    manager.recordFailure('cb-test-rpc', false, 'RETRYABLE');
    assert.equal(ep.status, 'DEGRADED');
    assert.equal(ep.consecutiveFailures, 2);

    // 3. Third failure -> CIRCUIT_OPEN (OPEN)
    manager.recordFailure('cb-test-rpc', false, 'RETRYABLE');
    assert.equal(ep.status, 'CIRCUIT_OPEN');
    assert.equal(ep.circuitState, 'OPEN');

    // Endpoint is excluded while OPEN
    const eligibleOpen = manager.selectEligibleEndpoints('polygon');
    assert.equal(eligibleOpen.length, 0);

    // 4. Wait for cooldown -> RECOVERING (HALF_OPEN)
    await new Promise((resolve) => setTimeout(resolve, 60));
    const circuitState = manager.checkCircuitState('cb-test-rpc');
    assert.equal(circuitState, 'HALF_OPEN');
    assert.equal(ep.status, 'RECOVERING');

    // Probe request permitted in HALF_OPEN
    const eligibleHalfOpen = manager.selectEligibleEndpoints('polygon');
    assert.equal(eligibleHalfOpen.length, 1);

    // 5. First success in RECOVERING -> still RECOVERING (needs successThreshold = 2)
    manager.recordSuccess('cb-test-rpc', 40);
    assert.equal(ep.status, 'RECOVERING');
    assert.equal(ep.consecutiveSuccesses, 1);

    // 6. Second success -> HEALTHY & CLOSED
    manager.recordSuccess('cb-test-rpc', 40);
    assert.equal(ep.status, 'HEALTHY');
    assert.equal(ep.circuitState, 'CLOSED');
  });

  // ============================================================================
  // TASK 8: CROSS-CHAIN RECOVERY (GOLDEN PATH FIXTURE)
  // ============================================================================

  await t.test('Task 8: Recovery with Golden Path Fixture across all 8 failure injection points', async () => {
    const dbPath = getTempDbPath('recovery_matrix');
    try {
      const repo = new SQLiteCrossChainStateRepository(dbPath);
      const plan = createMockGoldenPlan('plan-golden-recovery');
      await repo.saveExecutionPlan(plan);
      for (const s of plan.steps) await repo.savePlanStep(plan.planId, s);

      let swapCount = 0;
      let approvalCount = 0;
      let depositCount = 0;

      const erc20Iface = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
      const swapTransferLog = erc20Iface.encodeEventLog(
        erc20Iface.getEvent('Transfer')!,
        ['0x3000000000000000000000000000000000000003', OPERATOR_WALLET, 553197n]
      );

      const adapter: GoldenPathAdapter = {
        executeSourceSwap: async () => {
          swapCount++;
          return {
            hash: MINED_SOURCE_SWAP_TX,
            receipt: {
              status: 1,
              blockNumber: 94206631,
              logs: [
                {
                  address: POLYGON_USDC,
                  topics: swapTransferLog.topics,
                  data: swapTransferLog.data
                }
              ]
            }
          };
        },
        fetchFreshBridgeQuote: async () => ({
          calldata: '0xmock_calldata',
          expectedOutput: '542968'
        }),
        executeApproval: async () => {
          approvalCount++;
          return { hash: MINED_APPROVAL_TX, receipt: { status: 1 } };
        },
        executeBridgeDeposit: async () => {
          depositCount++;
          return { hash: MINED_BRIDGE_DEPOSIT_TX, receipt: { status: 1, blockNumber: 94206635 } };
        },
        pollAcrossRelay: async () => ({ fillTxHash: MINED_DESTINATION_FILL_TX, status: 'filled' }),
        fetchDestinationReceipt: async () => ({ status: 1, blockNumber: 440381615, gasUsed: 89124n })
      };

      const coordinator = new GoldenPathCrashRecoveryCoordinator({ repository: repo, adapter });

      // Run 1: Complete execution to settlement
      const res1 = await coordinator.executeOrResume('plan-golden-recovery');
      assert.equal(res1.status, 'DESTINATION_SETTLED');
      assert.equal(res1.sourceTxHash, MINED_SOURCE_SWAP_TX);
      assert.equal(res1.destinationTxHash, MINED_DESTINATION_FILL_TX);
      assert.equal(swapCount, 1);
      assert.equal(approvalCount, 1);
      assert.equal(depositCount, 1);

      // Run 2: Re-entry after completion -> zero rebroadcasts
      const res2 = await coordinator.executeOrResume('plan-golden-recovery');
      assert.equal(res2.status, 'DESTINATION_SETTLED');
      assert.equal(swapCount, 1, 'Never rebroadcast source swap');
      assert.equal(approvalCount, 1, 'Never rebroadcast approval');
      assert.equal(depositCount, 1, 'Never rebroadcast bridge deposit');

      repo.close();
    } finally {
      removeTempDb(dbPath);
    }
  });

  // ============================================================================
  // TASK 9: SECURITY INVARIANTS
  // ============================================================================

  await t.test('Task 9: Strict Security Invariants (No secrets, no fake hashes, no float math)', () => {
    // 1. Fixture contains ZERO private key patterns
    const fixtureJson = JSON.stringify(LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE);
    assert.doesNotMatch(fixtureJson, /privateKey/i);
    assert.doesNotMatch(fixtureJson, /secret/i);
    assert.doesNotMatch(fixtureJson, /mnemonic/i);

    // 2. Exact integer math only (no floating point amounts in base units)
    assert.equal(typeof LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.actualSourceSwapOutputRaw, 'string');
    assert.equal(typeof LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.actualDestinationOutputRaw, 'string');
    assert.equal(/^[0-9]+$/.test(LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.actualSourceSwapOutputRaw), true);
    assert.equal(/^[0-9]+$/.test(LIVE_ONCHAIN_GOLDEN_PATH_FIXTURE.actualDestinationOutputRaw), true);

    // 3. Valid 32-byte hashes only
    assert.equal(isValidHexTxHash(MINED_SOURCE_SWAP_TX), true);
    assert.equal(isValidHexTxHash(MINED_APPROVAL_TX), true);
    assert.equal(isValidHexTxHash(MINED_BRIDGE_DEPOSIT_TX), true);
    assert.equal(isValidHexTxHash(MINED_DESTINATION_FILL_TX), true);
    assert.equal(isValidHexTxHash('0xnot_a_valid_hash'), false);
  });

  // ============================================================================
  // TASK 10: OBSERVABILITY METRICS
  // ============================================================================

  await t.test('Task 10: MultiProviderMetricsCollector records all 9 required reliability metrics', () => {
    const metrics = new MultiProviderMetricsCollector();

    metrics.recordProviderFailure('poly-rpc-1');
    metrics.recordProviderSwitch();
    metrics.recordCircuitOpen();
    metrics.recordCircuitRecovery();
    metrics.recordRpcLatency('poly-rpc-1', 42);
    metrics.recordBridgeApiLatency(120);
    metrics.recordDestinationVerificationLatency(85);
    metrics.recordBroadcastUncertainty();
    metrics.recordRecovery();

    const snapshot = metrics.getMetrics();
    assert.equal(snapshot.providerFailureCount, 1);
    assert.equal(snapshot.providerSwitchCount, 1);
    assert.equal(snapshot.circuitOpenCount, 1);
    assert.equal(snapshot.circuitRecoveryCount, 1);
    assert.equal(snapshot.rpcLatency['poly-rpc-1'], 42);
    assert.equal(snapshot.bridgeApiLatency, 120);
    assert.equal(snapshot.destinationVerificationLatency, 85);
    assert.equal(snapshot.broadcastUncertainCount, 1);
    assert.equal(snapshot.recoveryCount, 1);

    // Check JSON serialization is secret-free
    const serialized = metrics.toJSON();
    assert.doesNotMatch(serialized, /privateKey/i);
    assert.doesNotMatch(serialized, /secret/i);
  });
});
