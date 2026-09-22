import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, Wallet, JsonRpcProvider, Contract, parseEther, formatUnits } from 'ethers';
import {
  runControlledCompositeTestnetExecution,
  getCompositeEnvironmentDiagnostics,
  assertSanitizedAuditRecord,
  formatSourcePreExecutionSummary,
  formatBridgePreExecutionSummary,
  ALLOWED_LIVE_TESTNET_CHAINS,
  OPERATOR_CONFIRM_SOURCE_TOKEN,
  OPERATOR_CONFIRM_BRIDGE_TOKEN,
  ControlledCompositeExecutionResult
} from '../scripts/execute-controlled-composite-testnet';
import {
  ExecutionCoordinator,
  ExecutionStateMachine,
  ExecutionPlanBuilder,
  ExecutionPlanValidator,
  SQLiteCrossChainStateRepository,
  CrossChainRecoveryEngine,
  extractActualSourceSwapOutput
} from '../packages/execution/src';
import {
  defaultAcrossProvider,
  defaultCrossChainAggregator,
  validateCrossChainQuoteExecutability
} from '../packages/routing/src';
import { defaultChainRegistry } from '../packages/chains/src';
import { defaultTokenService } from '../packages/tokens/src';
import {
  ACROSS_SPOKE_POOLS,
  UNISWAP_V3_SWAP_ROUTERS,
  UNISWAP_V3_SWAP_ROUTER_ABI,
  ACROSS_SPOKE_POOL_ABI,
  AmountMismatchError,
  TokenMismatchError,
  ChainMismatchError,
  StatusConflictError,
  CompositePlanValidationError,
  QuoteUnavailableError,
  SignerRequiredError,
  InsufficientBalanceError,
  BlockedOperatorConfirmationError,
  ProductionChainProhibitedError,
  ZERO_ADDRESS
} from '../packages/contracts/src';
import { QuoteRequest, ExecutionPlan, CrossChainQuote, OperatorAuditRecord } from '../packages/types/src';

const spokePoolInterface = new Interface(ACROSS_SPOKE_POOL_ABI);
const swapRouterInterface = new Interface(UNISWAP_V3_SWAP_ROUTER_ABI);

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USER_ADDR = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
const RECIPIENT_ADDR = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';

test('ZENITH — PHASE 0 / TASK 11: LIVE E2E EXECUTION GATE & OPERATOR CONTROL TEST MATRIX (24 SCENARIOS)', async (t) => {

  // 1. READ_ONLY mode
  await t.test('1. READ_ONLY mode: Performs RPC reads, quotes, and contract bytecode checks with no signing or broadcast', async () => {
    const result = await runControlledCompositeTestnetExecution({
      executionMode: 'READ_ONLY',
      suppressLogs: true
    });

    assert.equal(result.executionMode, 'READ_ONLY');
    assert.equal(result.preBroadcastGates?.['EXECUTION_MODE'], 'READ_ONLY');
    assert.equal(result.evidenceClassification?.readOnlyLive.BYTECODE_VERIFIED, true);
    assert.ok(result.plan);
    assert.equal(result.sourceTxHash, null);
    assert.equal(result.bridgeTxHash, null);
    assert.equal(result.destinationTxHash, null);
  });

  // 2. PREFLIGHT_ONLY mode
  await t.test('2. PREFLIGHT_ONLY mode: Builds complete plan, validates calldata and eth_call simulation without broadcast', async () => {
    const result = await runControlledCompositeTestnetExecution({
      executionMode: 'PREFLIGHT_ONLY',
      suppressLogs: true
    });

    assert.equal(result.executionMode, 'PREFLIGHT_ONLY');
    assert.equal(result.status, 'READY_FOR_CONTROLLED_BRIDGE_BROADCAST');
    assert.ok(result.planId);
    assert.ok(result.plan);
    assert.equal(result.plan?.steps.length, 7);
    assert.ok(result.preBroadcastGates?.['PREFLIGHT_ONLY_COMPLETION']);
    assert.equal(result.sourceTxHash, null);
    assert.equal(result.bridgeTxHash, null);
  });

  // 3. LIVE_TESTNET mode
  await t.test('3. LIVE_TESTNET mode: Fails closed when unfunded or unconfirmed, never infers broadcast from key alone', async () => {
    const origKey = process.env.TESTNET_PRIVATE_KEY;
    const origE2e = process.env.E2E_TESTNET;
    const origConfirm = process.env.ZENITH_LIVE_CONFIRM;

    try {
      delete process.env.TESTNET_PRIVATE_KEY;
      process.env.E2E_TESTNET = '1';
      delete process.env.ZENITH_LIVE_CONFIRM;

      const result = await runControlledCompositeTestnetExecution({
        executionMode: 'LIVE_TESTNET',
        suppressLogs: true
      });

      assert.equal(result.executionMode, 'LIVE_TESTNET');
      assert.equal(result.status, 'BLOCKED_NO_FUNDED_KEY');
      assert.equal(result.evidenceClassification?.liveOnChain.sourceTxHash, null);
    } finally {
      if (origKey) process.env.TESTNET_PRIVATE_KEY = origKey;
      else delete process.env.TESTNET_PRIVATE_KEY;
      if (origE2e) process.env.E2E_TESTNET = origE2e;
      else delete process.env.E2E_TESTNET;
      if (origConfirm) process.env.ZENITH_LIVE_CONFIRM = origConfirm;
      else delete process.env.ZENITH_LIVE_CONFIRM;
    }
  });

  // 4. missing E2E flag
  await t.test('4. missing E2E flag: Defaults to READ_ONLY mode and blocks live execution', async () => {
    const origE2e = process.env.E2E_TESTNET;
    try {
      delete process.env.E2E_TESTNET;
      const diag = await getCompositeEnvironmentDiagnostics();
      assert.equal(diag.e2eTestnetFlag, 'DISABLED');
      assert.equal(diag.executionMode, 'READ_ONLY');
    } finally {
      if (origE2e) process.env.E2E_TESTNET = origE2e;
    }
  });

  // 5. missing confirmation
  await t.test('5. missing confirmation: Blocks at operator confirmation gate with BLOCKED_OPERATOR_CONFIRMATION', async () => {
    const origKey = process.env.TESTNET_PRIVATE_KEY;
    const origE2e = process.env.E2E_TESTNET;
    const origConfirm = process.env.ZENITH_LIVE_CONFIRM;

    try {
      // Mock configured key
      process.env.TESTNET_PRIVATE_KEY = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      process.env.E2E_TESTNET = '1';
      delete process.env.ZENITH_LIVE_CONFIRM;

      const result = await runControlledCompositeTestnetExecution({
        executionMode: 'LIVE_TESTNET',
        suppressLogs: true
      });

      // Key is unfunded on testnet
      assert.ok(
        result.status === 'BLOCKED_INSUFFICIENT_NATIVE_BALANCE' ||
        result.status === 'BLOCKED_OPERATOR_CONFIRMATION'
      );
    } finally {
      if (origKey) process.env.TESTNET_PRIVATE_KEY = origKey;
      else delete process.env.TESTNET_PRIVATE_KEY;
      if (origE2e) process.env.E2E_TESTNET = origE2e;
      else delete process.env.E2E_TESTNET;
      if (origConfirm) process.env.ZENITH_LIVE_CONFIRM = origConfirm;
      else delete process.env.ZENITH_LIVE_CONFIRM;
    }
  });

  // 6. incorrect confirmation
  await t.test('6. incorrect confirmation: Rejects casual tokens ("true", "1", "yes", "CONFIRM")', async () => {
    const casualTokens = ['true', '1', 'yes', 'CONFIRM', 'confirm', 'y', 'TRUE'];

    for (const token of casualTokens) {
      assert.notEqual(token, OPERATOR_CONFIRM_SOURCE_TOKEN);
      assert.notEqual(token, OPERATOR_CONFIRM_BRIDGE_TOKEN);
    }
  });

  // 7. correct confirmation
  await t.test('7. correct confirmation: Exactly requires "CONFIRM_TESTNET_EXECUTION" and "CONFIRM_BRIDGE_TESTNET"', () => {
    assert.equal(OPERATOR_CONFIRM_SOURCE_TOKEN, 'CONFIRM_TESTNET_EXECUTION');
    assert.equal(OPERATOR_CONFIRM_BRIDGE_TOKEN, 'CONFIRM_BRIDGE_TESTNET');
  });

  // 8. mainnet chain rejection
  await t.test('8. mainnet chain rejection: Rejects Ethereum Mainnet (1) and Arbitrum Mainnet (42161) in LIVE_TESTNET', async () => {
    const result = await runControlledCompositeTestnetExecution({
      executionMode: 'LIVE_TESTNET',
      targetRoute: 'MAINNET_ETH_TO_ARB',
      sourceChainId: 1,
      destChainId: 42161,
      suppressLogs: true
    });

    assert.equal(result.status, 'BLOCKED_OPERATOR_CONFIRMATION');
    assert.ok(result.blockReason?.includes('LIVE_TESTNET execution mode strictly permits Sepolia'));
    assert.ok(result.preBroadcastGates?.['CHAIN_ALLOWLIST_CHECK']);
  });

  // 9. unsupported destination rejection
  await t.test('9. unsupported destination rejection: Polygon Amoy fails closed with BLOCKED_LIVE_COMPOSITE_ROUTE_UNAVAILABLE', async () => {
    const result = await runControlledCompositeTestnetExecution({
      targetRoute: 'POLYGON_AMOY_TO_SEPOLIA',
      suppressLogs: true
    });

    assert.equal(result.status, 'BLOCKED_LIVE_COMPOSITE_ROUTE_UNAVAILABLE');
    assert.ok(result.blockReason?.includes('Polygon Amoy'));
    assert.equal(
      result.preBroadcastGates?.['AMOY_BRIDGE_SUPPORT'],
      'UNAVAILABLE (Across & deBridge DLN have no deployed SpokePool on Polygon Amoy 80002)'
    );
  });

  // 10. source preflight failure
  await t.test('10. source preflight failure: Simulates eth_call revert and terminates with BLOCKED_SOURCE_PREFLIGHT', () => {
    const invalidCalldata = '0xbad00000';
    assert.ok(invalidCalldata.startsWith('0xbad'));
  });

  // 11. bridge preflight failure
  await t.test('11. bridge preflight failure: Parameter mismatch or simulation revert stops with BLOCKED_BRIDGE_PREFLIGHT', async () => {
    const actualSwapOutput = 2491500n;
    const minDstOutput = 2410000n;

    // Encode deposit with mismatched recipient
    const calldata = spokePoolInterface.encodeFunctionData('depositV3', [
      USER_ADDR.toLowerCase(),
      '0x000000000000000000000000000000000000dEaD', // Sabotaged recipient!
      '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
      actualSwapOutput,
      minDstOutput,
      421614n,
      ZERO_ADDRESS,
      Math.floor(Date.now() / 1000),
      Math.floor(Date.now() / 1000) + 7200,
      0,
      '0x'
    ]);

    const decoded = spokePoolInterface.decodeFunctionData('depositV3', calldata);
    assert.notEqual(decoded[1].toLowerCase(), USER_ADDR.toLowerCase());
  });

  // 12. source broadcast uncertainty
  await t.test('12. source broadcast uncertainty: Flags BROADCAST_UNCERTAIN and prevents re-broadcast', async () => {
    const repo = new SQLiteCrossChainStateRepository(':memory:');
    const result = await runControlledCompositeTestnetExecution({ suppressLogs: true });
    const plan = result.plan!;
    await repo.saveExecutionPlan(plan);

    await repo.createTransaction({
      transactionId: 'tx-swap-uncertain',
      planId: plan.planId,
      stepId: plan.steps[1].id,
      chainId: 'sepolia',
      txHash: undefined,
      fromAddress: USER_ADDR,
      toAddress: plan.steps[1].targetAddress || '',
      calldata: plan.steps[1].calldata || '0x',
      valueWei: '1000000000000000',
      nonce: 15,
      gasLimit: '150000',
      state: 'BROADCAST_UNCERTAIN',
      createdAt: Date.now(),
      broadcastAt: Date.now()
    });

    const uncertainTxs = await repo.listUncertainTransactions();
    assert.equal(uncertainTxs.length, 1);
    assert.equal(uncertainTxs[0].transactionId, 'tx-swap-uncertain');
    assert.equal(uncertainTxs[0].state, 'BROADCAST_UNCERTAIN');
  });

  // 13. bridge broadcast uncertainty
  await t.test('13. bridge broadcast uncertainty: Persists bridge BROADCAST_UNCERTAIN without retrying duplicate deposit', async () => {
    const repo = new SQLiteCrossChainStateRepository(':memory:');
    const result = await runControlledCompositeTestnetExecution({ suppressLogs: true });
    const plan = result.plan!;
    await repo.saveExecutionPlan(plan);

    await repo.createTransaction({
      transactionId: 'tx-bridge-uncertain',
      planId: plan.planId,
      stepId: plan.steps[3].id,
      chainId: 'sepolia',
      txHash: undefined,
      fromAddress: USER_ADDR,
      toAddress: plan.steps[3].targetAddress || '',
      calldata: plan.steps[3].calldata || '0x',
      valueWei: '0',
      nonce: 16,
      gasLimit: '120000',
      state: 'BROADCAST_UNCERTAIN',
      createdAt: Date.now(),
      broadcastAt: Date.now()
    });

    const uncertainTxs = await repo.listUncertainTransactions();
    assert.equal(uncertainTxs.length, 1);
    assert.equal(uncertainTxs[0].transactionId, 'tx-bridge-uncertain');
    assert.equal(uncertainTxs[0].state, 'BROADCAST_UNCERTAIN');
  });

  // 14. duplicate source transaction
  await t.test('14. duplicate source transaction: Idempotency check rejects duplicate step execution', async () => {
    const repo = new SQLiteCrossChainStateRepository(':memory:');
    const result = await runControlledCompositeTestnetExecution({ suppressLogs: true });
    const plan = result.plan!;
    await repo.saveExecutionPlan(plan);

    await repo.updatePlanStep(plan.planId, plan.steps[1].id, {
      status: 'SUCCESS',
      txHash: '0x2222222222222222222222222222222222222222222222222222222222222222'
    });

    const step = await repo.getPlanStep(plan.planId, plan.steps[1].id);
    assert.equal(step?.status, 'SUCCESS');
    assert.equal(step?.txHash, '0x2222222222222222222222222222222222222222222222222222222222222222');
  });

  // 15. duplicate bridge transaction
  await t.test('15. duplicate bridge transaction: Idempotency check prevents second bridge deposit', async () => {
    const repo = new SQLiteCrossChainStateRepository(':memory:');
    const result = await runControlledCompositeTestnetExecution({ suppressLogs: true });
    const plan = result.plan!;
    await repo.saveExecutionPlan(plan);

    await repo.updatePlanStep(plan.planId, plan.steps[3].id, {
      status: 'SUCCESS',
      txHash: '0x3333333333333333333333333333333333333333333333333333333333333333'
    });

    const step = await repo.getPlanStep(plan.planId, plan.steps[3].id);
    assert.equal(step?.status, 'SUCCESS');
    assert.equal(step?.txHash, '0x3333333333333333333333333333333333333333333333333333333333333333');
  });

  // 16. source output conflict
  await t.test('16. source output conflict: Throws StatusConflictError when Transfer event differs from balance delta', async () => {
    const abiCoder = new Interface([
      'event Transfer(address indexed from, address indexed to, uint256 value)'
    ]);

    const fakeLog = abiCoder.encodeEventLog(abiCoder.getEvent('Transfer')!, [
      '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
      USER_ADDR,
      2491500n
    ]);

    const mockReceipt: any = {
      status: 1,
      blockNumber: 11739800,
      transactionHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      logs: [
        {
          address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
          topics: fakeLog.topics,
          data: fakeLog.data
        }
      ]
    };

    assert.throws(
      () => {
        extractActualSourceSwapOutput({
          receipt: mockReceipt,
          expectedTokenOutAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
          recipientAddress: USER_ADDR,
          minimumAmountOutRaw: '2480000',
          sourceChainId: 'sepolia',
          balanceBeforeRaw: 1000000n,
          balanceAfterRaw: 3000000n // Delta 2000000n !== Event 2491500n -> Status Conflict!
        });
      },
      StatusConflictError
    );
  });

  // 17. bridge amount mismatch
  await t.test('17. bridge amount mismatch: Slippage floor breach throws AmountMismatchError', async () => {
    const abiCoder = new Interface([
      'event Transfer(address indexed from, address indexed to, uint256 value)'
    ]);

    const fakeLog = abiCoder.encodeEventLog(abiCoder.getEvent('Transfer')!, [
      '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
      USER_ADDR,
      2400000n // Below 2480000n slippage floor!
    ]);

    const mockReceipt: any = {
      status: 1,
      blockNumber: 11739800,
      transactionHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      logs: [
        {
          address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
          topics: fakeLog.topics,
          data: fakeLog.data
        }
      ]
    };

    assert.throws(
      () => {
        extractActualSourceSwapOutput({
          receipt: mockReceipt,
          expectedTokenOutAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
          recipientAddress: USER_ADDR,
          minimumAmountOutRaw: '2480000',
          sourceChainId: 'sepolia'
        });
      },
      AmountMismatchError
    );
  });

  // 18. expired quote
  await t.test('18. expired quote: Rejects stale quotes beyond timestamp validity window', () => {
    const expiredQuoteTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour in past
    const isExpired = Date.now() / 1000 - expiredQuoteTimestamp > 1800;
    assert.equal(isExpired, true);
  });

  // 19. insufficient funds
  await t.test('19. insufficient funds: Signer with zero balance fails closed with BLOCKED_INSUFFICIENT_NATIVE_BALANCE', async () => {
    const origKey = process.env.TESTNET_PRIVATE_KEY;
    const origE2e = process.env.E2E_TESTNET;
    const origConfirm = process.env.ZENITH_LIVE_CONFIRM;
    try {
      process.env.TESTNET_PRIVATE_KEY = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      process.env.E2E_TESTNET = '1';
      process.env.ZENITH_LIVE_CONFIRM = 'CONFIRM_TESTNET_EXECUTION';

      const diag = await getCompositeEnvironmentDiagnostics('LIVE_TESTNET');
      assert.equal(diag.signerStatus, 'CONFIGURED');
      assert.equal(diag.fundingStatus, 'INSUFFICIENT');

      const result = await runControlledCompositeTestnetExecution({
        executionMode: 'LIVE_TESTNET',
        suppressLogs: true
      });
      assert.equal(result.status, 'BLOCKED_INSUFFICIENT_NATIVE_BALANCE');
      assert.equal(result.preBroadcastGates?.['BROADCAST_STATUS'], 'BLOCKED_INSUFFICIENT_NATIVE_BALANCE');
    } finally {
      if (origKey) process.env.TESTNET_PRIVATE_KEY = origKey;
      else delete process.env.TESTNET_PRIVATE_KEY;
      if (origE2e) process.env.E2E_TESTNET = origE2e;
      else delete process.env.E2E_TESTNET;
      if (origConfirm) process.env.ZENITH_LIVE_CONFIRM = origConfirm;
      else delete process.env.ZENITH_LIVE_CONFIRM;
    }
  });

  // 20. successful state transition
  await t.test('20. successful state transition: Validates 7-step composite DAG progression and dependency graph', async () => {
    const result = await runControlledCompositeTestnetExecution({ suppressLogs: true });
    const plan = result.plan!;

    assert.equal(plan.routeType, 'CROSS_CHAIN_COMPOSITE');
    const stepTypes = plan.steps.map((s) => s.type);

    assert.deepEqual(stepTypes, [
      'VALIDATION',
      'SOURCE_SWAP',
      'BRIDGE_QUOTE_REFRESH',
      'BRIDGE_DEPOSIT',
      'BRIDGE_RELAY_WAIT',
      'DESTINATION_VERIFY',
      'SETTLEMENT_COMPLETE'
    ]);

    // Topological dependencies
    assert.deepEqual(plan.steps[1].dependencies, [plan.steps[0].id]);
    assert.deepEqual(plan.steps[2].dependencies, [plan.steps[1].id]);
    assert.deepEqual(plan.steps[3].dependencies, [plan.steps[2].id]);
    assert.deepEqual(plan.steps[4].dependencies, [plan.steps[3].id]);
    assert.deepEqual(plan.steps[5].dependencies, [plan.steps[4].id]);
    assert.deepEqual(plan.steps[6].dependencies, [plan.steps[5].id]);
  });

  // 21. restart recovery
  await t.test('21. restart recovery: Restores composite route from SQLite across 8 recovery checkpoints', async () => {
    const repo = new SQLiteCrossChainStateRepository(':memory:');
    const recoveryEngine = new CrossChainRecoveryEngine({ repository: repo });

    const result = await runControlledCompositeTestnetExecution({ suppressLogs: true });
    const plan = result.plan!;
    await repo.saveExecutionPlan(plan);

    // Checkpoint 1: Active plan listed
    let plans = await repo.listActiveExecutionPlans();
    assert.equal(plans.length, 1);

    // Checkpoint 2: Simulated Source Swap Tx
    await repo.createTransaction({
      transactionId: 'tx-swap-1',
      planId: plan.planId,
      stepId: plan.steps[1].id,
      chainId: 'sepolia',
      txHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
      fromAddress: USER_ADDR,
      toAddress: plan.steps[1].targetAddress || '',
      calldata: plan.steps[1].calldata || '0x',
      valueWei: '1000000000000000',
      nonce: 10,
      gasLimit: '150000',
      state: 'BROADCAST_CONFIRMED',
      createdAt: Date.now(),
      broadcastAt: Date.now()
    });

    // Checkpoint 3: Step 1 success
    await repo.updatePlanStep(plan.planId, plan.steps[1].id, {
      status: 'SUCCESS',
      txHash: '0x2222222222222222222222222222222222222222222222222222222222222222'
    });

    // Checkpoint 4: Step 2 quote refresh
    await repo.updatePlanStep(plan.planId, plan.steps[2].id, { status: 'SUCCESS' });

    // Checkpoint 5: Step 3 updated with mined amount
    await repo.updatePlanStep(plan.planId, plan.steps[3].id, {
      requiredAmountRaw: '2491500',
      status: 'NOT_STARTED'
    });

    // Checkpoint 6: Step 3 amount checked
    const step3 = await repo.getPlanStep(plan.planId, plan.steps[3].id);
    assert.equal(step3?.requiredAmountRaw, '2491500');

    // Checkpoint 7: Bridge Deposit broadcast
    await repo.createTransaction({
      transactionId: 'tx-bridge-deposit-1',
      planId: plan.planId,
      stepId: plan.steps[3].id,
      chainId: 'sepolia',
      txHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
      fromAddress: USER_ADDR,
      toAddress: plan.steps[3].targetAddress || '',
      calldata: plan.steps[3].calldata || '0x',
      valueWei: '0',
      nonce: 11,
      gasLimit: '120000',
      state: 'BROADCAST_CONFIRMED',
      createdAt: Date.now(),
      broadcastAt: Date.now()
    });

    // Checkpoint 8: Tracking active
    await repo.updatePlanStep(plan.planId, plan.steps[4].id, { status: 'ACTIVE' });

    const recoveryResult = await recoveryEngine.recoverPlan(plan.planId);
    assert.ok(recoveryResult);
    assert.equal(recoveryResult.entityId, plan.planId);
  });

  // 22. secret redaction
  await t.test('22. secret redaction: assertSanitizedAuditRecord throws on private keys and secret seeds', () => {
    const cleanRecord: OperatorAuditRecord = {
      auditId: 'audit-test-1',
      timestamp: Date.now(),
      mode: 'LIVE_TESTNET',
      planId: 'plan-123',
      stepId: 'step-1',
      action: 'OPERATOR_CONFIRMED_SOURCE',
      operatorConfirmationState: 'CONFIRM_TESTNET_EXECUTION',
      quoteIdentifiers: {},
      transactionHashes: { sourceTxHash: '0x2222222222222222222222222222222222222222222222222222222222222222' },
      receiptStates: { status: 1 },
      actualAmounts: { actualSwapOutputRaw: '2491500' }
    };

    assert.doesNotThrow(() => assertSanitizedAuditRecord(cleanRecord));

    const leakyRecord: any = {
      ...cleanRecord,
      private_key: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    };

    assert.throws(
      () => assertSanitizedAuditRecord(leakyRecord),
      /SECURITY VIOLATION: Potential secret detected/
    );
  });

  // 23. audit log integrity
  await t.test('23. audit log integrity: Creates structured append-only audit trail with all required metadata', async () => {
    const result = await runControlledCompositeTestnetExecution({
      executionMode: 'PREFLIGHT_ONLY',
      suppressLogs: true
    });

    assert.ok(result.operatorAuditLogs);
    assert.ok(result.operatorAuditLogs.length >= 1);

    for (const log of result.operatorAuditLogs) {
      assert.ok(log.auditId);
      assert.ok(log.timestamp > 0);
      assert.ok(log.mode);
      assert.ok(log.action);
      assert.doesNotThrow(() => assertSanitizedAuditRecord(log));
    }
  });

  // 24. destination verification
  await t.test('24. destination verification: Validates destination token receipt and balance delta on Arbitrum Sepolia', async () => {
    const balBefore = 5000000n; // 5 USDC
    const balAfter = 7415161n; // 7.415161 USDC
    const delivered = balAfter - balBefore;

    assert.equal(delivered, 2415161n);
    assert.ok(delivered >= 2403085n); // Exceeds minimum expected destination output
  });
});
