import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  PersistentIntent,
  PersistentExecutionStep,
  PersistentProviderOrder,
  PersistentSettlement,
  CrossChainQuote,
  CrossChainProvider
} from '@zenith/types';
import {
  InMemoryCrossChainStateRepository,
  SQLiteCrossChainStateRepository,
  CrossChainRecoveryEngine,
  CrossChainTracker,
  ActiveCrossChainOrder
} from '../packages/execution/src';
import { CrossChainAggregator } from '../packages/routing/src';

function getTempDbPath(testName: string): string {
  const dbPath = path.join(process.cwd(), `temp_test_zenith_recovery_${testName}.sqlite`);
  try {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  } catch {
    // Ignore cleanup error
  }
  return dbPath;
}

function removeTempDb(dbPath: string): void {
  try {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  } catch {
    // Ignore cleanup error
  }
}

const mockQuote: CrossChainQuote = {
  provider: 'ACROSS',
  providerName: 'Across Protocol V3',
  sourceChainId: 'ethereum',
  destinationChainId: 'arbitrum',
  sourceToken: {
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    decimals: 6,
    chainId: 'ethereum',
    verified: true,
    tags: ['stablecoin']
  },
  destinationToken: {
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    decimals: 6,
    chainId: 'arbitrum',
    verified: true,
    tags: ['stablecoin']
  },
  sourceAmountRaw: '1000000000',
  destinationAmountRaw: '999500000',
  minDestinationAmountRaw: '994502500',
  bridgeFeeUSD: 0.5,
  relayerFee: '0.05%',
  gasEstimateUSD: 5,
  recipient: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
  expiration: Date.now() + 300000,
  routeIdentifier: 'across-eth-arb-recovery',
  executionTarget: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
  calldata: '0x1234'
};

test('Test 1: Create intent -> restart -> recover intent', async () => {
  const dbPath = getTempDbPath('test1');
  const repo1 = new SQLiteCrossChainStateRepository(dbPath);

  const intent: PersistentIntent = {
    intentId: 'intent-test-1',
    userAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    sourceTokenSymbol: 'USDC',
    destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    destinationTokenSymbol: 'USDC',
    amountInRaw: '1000000000',
    expectedAmountOutRaw: '999500000',
    minAmountOutRaw: '994502500',
    provider: 'ACROSS',
    routeId: 'route-test-1',
    nonce: '10001',
    deadline: Date.now() + 600000,
    status: 'CREATED',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await repo1.createIntent(intent);

  // Simulate process restart by opening fresh repo instance on same SQLite file
  const repo2 = new SQLiteCrossChainStateRepository(dbPath);
  const recovered = await repo2.getIntent('intent-test-1');

  assert.ok(recovered, 'Intent should be recovered from persistent database after restart');
  assert.equal(recovered?.intentId, 'intent-test-1');
  assert.equal(recovered?.status, 'CREATED');
  assert.equal(recovered?.amountInRaw, '1000000000');
  assert.equal(recovered?.userAddress, '0x8ba1f109551bD432803012645Ac136ddd64DBA72');

  const pending = await repo2.listPendingIntents();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].intentId, 'intent-test-1');

  removeTempDb(dbPath);
});

test('Test 2: Source tx submitted -> restart -> recover source tx', async () => {
  const dbPath = getTempDbPath('test2');
  const repo1 = new SQLiteCrossChainStateRepository(dbPath);

  const intent: PersistentIntent = {
    intentId: 'intent-test-2',
    userAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    sourceTokenSymbol: 'USDC',
    destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    destinationTokenSymbol: 'USDC',
    amountInRaw: '1000000000',
    expectedAmountOutRaw: '999500000',
    minAmountOutRaw: '994502500',
    provider: 'ACROSS',
    routeId: 'route-test-2',
    nonce: '10002',
    deadline: Date.now() + 600000,
    status: 'FULFILLING',
    sourceTxHash: '0x9999888877776666555544443333222211110000aaaaabbbbbcccccdddddeeeee',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const step: PersistentExecutionStep = {
    stepId: 'step-deposit-2',
    intentId: 'intent-test-2',
    stepIndex: 1,
    type: 'BRIDGE_DEPOSIT',
    chainId: 'ethereum',
    status: 'ACTIVE',
    dependsOn: [],
    txHash: '0x9999888877776666555544443333222211110000aaaaabbbbbcccccdddddeeeee',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await repo1.createIntent(intent);
  await repo1.createStep(step);

  // Restart
  const repo2 = new SQLiteCrossChainStateRepository(dbPath);
  const recoveredIntent = await repo2.getIntent('intent-test-2');
  const recoveredStep = await repo2.getStep('step-deposit-2');

  assert.equal(recoveredIntent?.sourceTxHash, '0x9999888877776666555544443333222211110000aaaaabbbbbcccccdddddeeeee');
  assert.equal(recoveredStep?.txHash, '0x9999888877776666555544443333222211110000aaaaabbbbbcccccdddddeeeee');
  assert.equal(recoveredStep?.status, 'ACTIVE');

  removeTempDb(dbPath);
});

test('Test 3: Bridge submitted -> restart -> recover provider order', async () => {
  const dbPath = getTempDbPath('test3');
  const repo1 = new SQLiteCrossChainStateRepository(dbPath);

  const intent: PersistentIntent = {
    intentId: 'intent-test-3',
    userAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    sourceTokenSymbol: 'USDC',
    destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    destinationTokenSymbol: 'USDC',
    amountInRaw: '1000000000',
    expectedAmountOutRaw: '999500000',
    minAmountOutRaw: '994502500',
    provider: 'ACROSS',
    routeId: 'route-test-3',
    nonce: '10003',
    deadline: Date.now() + 600000,
    status: 'FULFILLING',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const order: PersistentProviderOrder = {
    orderId: 'across-order-3',
    intentId: 'intent-test-3',
    provider: 'ACROSS',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTxHash: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
    recipient: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    quoteJson: JSON.stringify(mockQuote),
    status: 'FULFILLING',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await repo1.createIntent(intent);
  await repo1.createProviderOrder(order);

  // Restart
  const repo2 = new SQLiteCrossChainStateRepository(dbPath);
  const recoveredOrder = await repo2.getProviderOrder('across-order-3');
  const recoveredByTx = await repo2.getProviderOrderBySourceTx('0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff');

  assert.ok(recoveredOrder, 'Provider order should be recovered');
  assert.equal(recoveredOrder?.orderId, 'across-order-3');
  assert.equal(recoveredOrder?.provider, 'ACROSS');
  assert.equal(recoveredByTx?.orderId, 'across-order-3');

  removeTempDb(dbPath);
});

test('Test 4: Provider reports destination filled -> restart -> verify settlement', async () => {
  const dbPath = getTempDbPath('test4');
  const repo = new SQLiteCrossChainStateRepository(dbPath);

  const intent: PersistentIntent = {
    intentId: 'intent-test-4',
    userAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    sourceTokenSymbol: 'USDC',
    destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    destinationTokenSymbol: 'USDC',
    amountInRaw: '1000000000',
    expectedAmountOutRaw: '999500000',
    minAmountOutRaw: '994502500',
    provider: 'ACROSS',
    routeId: 'route-test-4',
    nonce: '10004',
    deadline: Date.now() + 600000,
    status: 'FULFILLING',
    sourceTxHash: '0x4444555566667777888899990000111122223333444455556666777788889999',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const order: PersistentProviderOrder = {
    orderId: 'intent-test-4',
    intentId: 'intent-test-4',
    provider: 'ACROSS',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTxHash: '0x4444555566667777888899990000111122223333444455556666777788889999',
    recipient: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    quoteJson: JSON.stringify(mockQuote),
    status: 'FULFILLING',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await repo.createIntent(intent);
  await repo.createProviderOrder(order);

  const mockProviderAdapter: CrossChainProvider = {
    id: 'ACROSS',
    name: 'Across Protocol V3',
    supportedSourceChains: ['ethereum'],
    supportedDestinationChains: ['arbitrum'],
    isAvailable: () => true,
    getQuote: async () => mockQuote,
    buildExecution: async () => ({ to: '0x1', data: '0x', value: '0', chainId: 'ethereum' }),
    getStatus: async () => ({
      state: 'DESTINATION_FILLED',
      destinationTxHash: '0xd000d000d000d000d000d000d000d000d000d000d000d000d000d000d000d000'
    })
  };

  const mockDestRpc = {
    getTransactionReceipt: async () => ({
      status: 1, // Destination confirmed on-chain
      blockNumber: 12345
    })
  };

  const mockAggregator = new CrossChainAggregator([mockProviderAdapter]);
  const recoveryEngine = new CrossChainRecoveryEngine({
    repository: repo,
    aggregator: mockAggregator,
    rpcProviders: {
      arbitrum: mockDestRpc
    }
  });

  const recoveryResult = await recoveryEngine.recoverIntent('intent-test-4');

  assert.equal(recoveryResult.reconciledStatus, 'SETTLED');
  assert.equal(recoveryResult.destinationTxHash, '0xd000d000d000d000d000d000d000d000d000d000d000d000d000d000d000d000');

  const settledIntent = await repo.getIntent('intent-test-4');
  assert.equal(settledIntent?.status, 'SETTLED');
  assert.equal(settledIntent?.destinationTxHash, '0xd000d000d000d000d000d000d000d000d000d000d000d000d000d000d000d000');

  const settlement = await repo.getSettlement('intent-test-4');
  assert.ok(settlement, 'PersistentSettlement must be recorded');
  assert.equal(settlement?.verified, true);
  assert.equal(settlement?.destinationTxHash, '0xd000d000d000d000d000d000d000d000d000d000d000d000d000d000d000d000');

  removeTempDb(dbPath);
});

test('Test 5: Database says pending/created but blockchain says confirmed -> reconciled to confirmed', async () => {
  const repo = new InMemoryCrossChainStateRepository();

  const intent: PersistentIntent = {
    intentId: 'intent-test-5',
    userAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    sourceTokenSymbol: 'USDC',
    destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    destinationTokenSymbol: 'USDC',
    amountInRaw: '1000000000',
    expectedAmountOutRaw: '999500000',
    minAmountOutRaw: '994502500',
    provider: 'ACROSS',
    routeId: 'route-test-5',
    nonce: '10005',
    deadline: Date.now() + 600000,
    status: 'CREATED',
    sourceTxHash: '0x5555555555555555555555555555555555555555555555555555555555555555',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await repo.createIntent(intent);

  const mockRpcProvider = {
    getTransactionReceipt: async (hash: string) => ({
      status: 1,
      blockNumber: 19500000,
      hash
    })
  };

  const recoveryEngine = new CrossChainRecoveryEngine({
    repository: repo,
    rpcProviders: {
      ethereum: mockRpcProvider
    }
  });

  await recoveryEngine.recoverIntent('intent-test-5');
  const reconciled = await repo.getIntent('intent-test-5');
  assert.equal(reconciled?.status, 'FULFILLING', 'Should reconcile from CREATED to FULFILLING after on-chain receipt confirmation');
});

test('Test 6: Database says submitted but transaction reverted on-chain -> reconciled to FAILED', async () => {
  const repo = new InMemoryCrossChainStateRepository();

  const intent: PersistentIntent = {
    intentId: 'intent-test-6',
    userAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    sourceTokenSymbol: 'USDC',
    destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    destinationTokenSymbol: 'USDC',
    amountInRaw: '1000000000',
    expectedAmountOutRaw: '999500000',
    minAmountOutRaw: '994502500',
    provider: 'ACROSS',
    routeId: 'route-test-6',
    nonce: '10006',
    deadline: Date.now() + 600000,
    status: 'FULFILLING',
    sourceTxHash: '0x6666666666666666666666666666666666666666666666666666666666666666',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const step: PersistentExecutionStep = {
    stepId: 'step-test-6',
    intentId: 'intent-test-6',
    stepIndex: 0,
    type: 'BRIDGE_DEPOSIT',
    chainId: 'ethereum',
    status: 'ACTIVE',
    dependsOn: [],
    txHash: '0x6666666666666666666666666666666666666666666666666666666666666666',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await repo.createIntent(intent);
  await repo.createStep(step);

  const mockRpcProvider = {
    getTransactionReceipt: async () => ({
      status: 0, // Reverted on-chain
      blockNumber: 19500001
    })
  };

  const recoveryEngine = new CrossChainRecoveryEngine({
    repository: repo,
    rpcProviders: {
      ethereum: mockRpcProvider
    }
  });

  const result = await recoveryEngine.recoverIntent('intent-test-6');
  assert.equal(result.reconciledStatus, 'FAILED');
  assert.equal(result.actionTaken, 'RECONCILED_SOURCE_REVERT');

  const finalIntent = await repo.getIntent('intent-test-6');
  const finalStep = await repo.getStep('step-test-6');

  assert.equal(finalIntent?.status, 'FAILED');
  assert.equal(finalStep?.status, 'FAILED');
});

test('Test 7: Transaction hash exists -> recovery does NOT submit duplicate transaction', async () => {
  const repo = new InMemoryCrossChainStateRepository();
  let submissionCount = 0;

  const intent: PersistentIntent = {
    intentId: 'intent-test-7',
    userAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    sourceTokenSymbol: 'USDC',
    destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    destinationTokenSymbol: 'USDC',
    amountInRaw: '1000000000',
    expectedAmountOutRaw: '999500000',
    minAmountOutRaw: '994502500',
    provider: 'ACROSS',
    routeId: 'route-test-7',
    nonce: '10007',
    deadline: Date.now() + 600000,
    status: 'FULFILLING',
    sourceTxHash: '0x7777777777777777777777777777777777777777777777777777777777777777',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await repo.createIntent(intent);

  const mockProvider: CrossChainProvider = {
    id: 'ACROSS',
    name: 'Across Protocol V3',
    supportedSourceChains: ['ethereum'],
    supportedDestinationChains: ['arbitrum'],
    isAvailable: () => true,
    getQuote: async () => mockQuote,
    buildExecution: async () => {
      submissionCount++;
      return { to: '0x1', data: '0x', value: '0', chainId: 'ethereum' };
    },
    getStatus: async () => ({
      state: 'FULFILLING'
    })
  };

  const recoveryEngine = new CrossChainRecoveryEngine({
    repository: repo,
    aggregator: new CrossChainAggregator([mockProvider])
  });

  await recoveryEngine.recoverIntent('intent-test-7');

  assert.equal(submissionCount, 0, 'Recovery must NEVER call buildExecution or re-broadcast transaction when txHash exists');
});

test('Test 8: Two recovery workers attempt same intent -> only one may claim the recovery lease', async () => {
  const repo = new InMemoryCrossChainStateRepository();

  const intent: PersistentIntent = {
    intentId: 'intent-test-8',
    userAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    sourceTokenSymbol: 'USDC',
    destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    destinationTokenSymbol: 'USDC',
    amountInRaw: '1000000000',
    expectedAmountOutRaw: '999500000',
    minAmountOutRaw: '994502500',
    provider: 'ACROSS',
    routeId: 'route-test-8',
    nonce: '10008',
    deadline: Date.now() + 600000,
    status: 'FULFILLING',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await repo.createIntent(intent);

  // Worker 1 claims lease for 30s
  const claimed1 = await repo.claimIntentLease('intent-test-8', 'worker-node-1', 30000);
  assert.equal(claimed1, true);

  // Worker 2 attempts to claim lease on the same intent
  const claimed2 = await repo.claimIntentLease('intent-test-8', 'worker-node-2', 30000);
  assert.equal(claimed2, false, 'Second worker must fail to claim active lease');

  const recoveryEngine2 = new CrossChainRecoveryEngine({
    repository: repo,
    workerId: 'worker-node-2'
  });

  const res2 = await recoveryEngine2.recoverIntent('intent-test-8');
  assert.equal(res2.actionTaken, 'LEASE_LOCKED_BY_OTHER_WORKER');
});

test('Test 9: Recovery worker crashes while holding lease -> lease expires and another worker can recover', async () => {
  const repo = new InMemoryCrossChainStateRepository();

  const intent: PersistentIntent = {
    intentId: 'intent-test-9',
    userAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    sourceTokenSymbol: 'USDC',
    destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    destinationTokenSymbol: 'USDC',
    amountInRaw: '1000000000',
    expectedAmountOutRaw: '999500000',
    minAmountOutRaw: '994502500',
    provider: 'ACROSS',
    routeId: 'route-test-9',
    nonce: '10009',
    deadline: Date.now() + 600000,
    status: 'FULFILLING',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await repo.createIntent(intent);

  // Worker 1 claims lease for only 40ms and then crashes (no release)
  await repo.claimIntentLease('intent-test-9', 'crashed-worker-1', 40);

  // Wait 60ms for lease timeout
  await new Promise((r) => setTimeout(r, 60));

  // Worker 2 attempts claim
  const claimedByWorker2 = await repo.claimIntentLease('intent-test-9', 'surviving-worker-2', 30000);
  assert.equal(claimedByWorker2, true, 'Surviving worker should successfully acquire lease after lease expiration timeout');
});

test('Test 10: Destination transaction exists but reverted on destination -> DESTINATION_VERIFICATION_FAILED', async () => {
  const repo = new InMemoryCrossChainStateRepository();

  const intent: PersistentIntent = {
    intentId: 'intent-test-10',
    userAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    sourceTokenSymbol: 'USDC',
    destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    destinationTokenSymbol: 'USDC',
    amountInRaw: '1000000000',
    expectedAmountOutRaw: '999500000',
    minAmountOutRaw: '994502500',
    provider: 'ACROSS',
    routeId: 'route-test-10',
    nonce: '10010',
    deadline: Date.now() + 600000,
    status: 'FULFILLING',
    sourceTxHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const order: PersistentProviderOrder = {
    orderId: 'intent-test-10',
    intentId: 'intent-test-10',
    provider: 'ACROSS',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTxHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    recipient: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    quoteJson: JSON.stringify(mockQuote),
    status: 'FULFILLING',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await repo.createIntent(intent);
  await repo.createProviderOrder(order);

  const mockProvider: CrossChainProvider = {
    id: 'ACROSS',
    name: 'Across Protocol V3',
    supportedSourceChains: ['ethereum'],
    supportedDestinationChains: ['arbitrum'],
    isAvailable: () => true,
    getQuote: async () => mockQuote,
    buildExecution: async () => ({ to: '0x1', data: '0x', value: '0', chainId: 'ethereum' }),
    getStatus: async () => ({
      state: 'DESTINATION_FILLED',
      destinationTxHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    })
  };

  // Mock destination RPC returning reverted transaction receipt
  const mockDestRpc = {
    getTransactionReceipt: async () => ({
      status: 0, // Reverted
      blockNumber: 12345
    })
  };

  const recoveryEngine = new CrossChainRecoveryEngine({
    repository: repo,
    aggregator: new CrossChainAggregator([mockProvider]),
    rpcProviders: {
      arbitrum: mockDestRpc
    }
  });

  const result = await recoveryEngine.recoverIntent('intent-test-10');
  assert.equal(result.reconciledStatus, 'FAILED');
  assert.equal(result.actionTaken, 'DESTINATION_VERIFICATION_FAILED');

  const failedIntent = await repo.getIntent('intent-test-10');
  assert.equal(failedIntent?.status, 'FAILED');
  assert.ok(failedIntent?.errorMessage?.includes('reverted'));
});

test('Test 11: Provider tracking API temporarily unavailable -> TRACKING_UNAVAILABLE and retry later', async () => {
  const repo = new InMemoryCrossChainStateRepository();

  const intent: PersistentIntent = {
    intentId: 'intent-test-11',
    userAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    sourceTokenSymbol: 'USDC',
    destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    destinationTokenSymbol: 'USDC',
    amountInRaw: '1000000000',
    expectedAmountOutRaw: '999500000',
    minAmountOutRaw: '994502500',
    provider: 'ACROSS',
    routeId: 'route-test-11',
    nonce: '10011',
    deadline: Date.now() + 600000,
    status: 'FULFILLING',
    sourceTxHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const order: PersistentProviderOrder = {
    orderId: 'intent-test-11',
    intentId: 'intent-test-11',
    provider: 'ACROSS',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTxHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    recipient: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    quoteJson: JSON.stringify(mockQuote),
    status: 'FULFILLING',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await repo.createIntent(intent);
  await repo.createProviderOrder(order);

  const mockFailingProvider: CrossChainProvider = {
    id: 'ACROSS',
    name: 'Across Protocol V3',
    supportedSourceChains: ['ethereum'],
    supportedDestinationChains: ['arbitrum'],
    isAvailable: () => true,
    getQuote: async () => mockQuote,
    buildExecution: async () => ({ to: '0x1', data: '0x', value: '0', chainId: 'ethereum' }),
    getStatus: async () => {
      throw new Error('503 Service Unavailable: Across Indexer Gateway Timeout');
    }
  };

  const recoveryEngine = new CrossChainRecoveryEngine({
    repository: repo,
    aggregator: new CrossChainAggregator([mockFailingProvider])
  });

  const result = await recoveryEngine.recoverIntent('intent-test-11');
  assert.equal(result.actionTaken, 'TRACKING_UNAVAILABLE');
  assert.equal(result.reconciledStatus, 'FULFILLING', 'Intent must remain in FULFILLING state for subsequent retry');

  const currentIntent = await repo.getIntent('intent-test-11');
  assert.equal(currentIntent?.status, 'FULFILLING');
});

test('Test 12: Application restart during BRIDGE_IN_FLIGHT -> resumes tracking until settled', async () => {
  const dbPath = getTempDbPath('test12');
  const repo = new SQLiteCrossChainStateRepository(dbPath);

  const intent: PersistentIntent = {
    intentId: 'intent-test-12',
    userAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    sourceTokenSymbol: 'USDC',
    destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    destinationTokenSymbol: 'USDC',
    amountInRaw: '1000000000',
    expectedAmountOutRaw: '999500000',
    minAmountOutRaw: '994502500',
    provider: 'ACROSS',
    routeId: 'route-test-12',
    nonce: '10012',
    deadline: Date.now() + 600000,
    status: 'FULFILLING',
    sourceTxHash: '0x1212121212121212121212121212121212121212121212121212121212121212',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const order: PersistentProviderOrder = {
    orderId: 'intent-test-12',
    intentId: 'intent-test-12',
    provider: 'ACROSS',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTxHash: '0x1212121212121212121212121212121212121212121212121212121212121212',
    recipient: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    quoteJson: JSON.stringify(mockQuote),
    status: 'FULFILLING',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await repo.createIntent(intent);
  await repo.createProviderOrder(order);

  // Application reboots: discover recoverable intents from DB
  const recoverable = await repo.listRecoverableIntents();
  assert.equal(recoverable.length, 1);
  assert.equal(recoverable[0].intentId, 'intent-test-12');

  let pollCount = 0;
  const mockProvider: CrossChainProvider = {
    id: 'ACROSS',
    name: 'Across Protocol V3',
    supportedSourceChains: ['ethereum'],
    supportedDestinationChains: ['arbitrum'],
    isAvailable: () => true,
    getQuote: async () => mockQuote,
    buildExecution: async () => ({ to: '0x1', data: '0x', value: '0', chainId: 'ethereum' }),
    getStatus: async () => {
      pollCount++;
      if (pollCount === 1) {
        return { state: 'FULFILLING' };
      }
      return {
        state: 'DESTINATION_FILLED',
        destinationTxHash: '0x9999999999999999999999999999999999999999999999999999999999999999'
      };
    }
  };

  const tracker = new CrossChainTracker(new CrossChainAggregator([mockProvider]), repo);
  const activeOrder: ActiveCrossChainOrder = {
    orderId: recoverable[0].intentId,
    sourceChainId: recoverable[0].sourceChainId,
    destinationChainId: recoverable[0].destinationChainId,
    sourceTxHash: recoverable[0].sourceTxHash!,
    provider: recoverable[0].provider,
    recipient: recoverable[0].userAddress,
    quote: mockQuote,
    status: recoverable[0].status,
    createdAt: recoverable[0].createdAt,
    lastUpdated: recoverable[0].updatedAt
  };

  tracker.registerOrder(activeOrder);

  const mockDestRpc = {
    getTransactionReceipt: async () => ({
      status: 1,
      blockNumber: 12347
    })
  };

  // Tracker resumes tracking until settled
  const trackingResult = await tracker.trackUntilSettled({
    order: activeOrder,
    pollIntervalMs: 10,
    maxPollDurationMs: 1000,
    destRpcProvider: mockDestRpc
  });

  assert.equal(trackingResult.isSuccess, true);
  assert.equal(trackingResult.destinationTxHash, '0x9999999999999999999999999999999999999999999999999999999999999999');

  const finalSettled = await repo.getIntent('intent-test-12');
  assert.equal(finalSettled?.status, 'SETTLED');

  const settlement = await repo.getSettlement('intent-test-12');
  assert.ok(settlement);
  assert.equal(settlement?.verified, true);

  removeTempDb(dbPath);
});

test('Invariant: Terminal states cannot transition back to pending / recoverable', async () => {
  const repo = new InMemoryCrossChainStateRepository();

  const intent: PersistentIntent = {
    intentId: 'intent-terminal-1',
    userAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    sourceTokenSymbol: 'USDC',
    destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    destinationTokenSymbol: 'USDC',
    amountInRaw: '1000000000',
    expectedAmountOutRaw: '999500000',
    minAmountOutRaw: '994502500',
    provider: 'ACROSS',
    routeId: 'route-terminal-1',
    nonce: '99999',
    deadline: Date.now() + 600000,
    status: 'SETTLED',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await repo.createIntent(intent);

  const recoverable = await repo.listRecoverableIntents();
  assert.equal(recoverable.length, 0, 'SETTLED intent must not be returned in recoverable list');
});

test('Invariant: Nonce replay is strictly rejected', async () => {
  const repo = new InMemoryCrossChainStateRepository();

  const intent1: PersistentIntent = {
    intentId: 'intent-nonce-1',
    userAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    sourceTokenSymbol: 'USDC',
    destinationTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    destinationTokenSymbol: 'USDC',
    amountInRaw: '1000000000',
    expectedAmountOutRaw: '999500000',
    minAmountOutRaw: '994502500',
    provider: 'ACROSS',
    routeId: 'route-nonce-1',
    nonce: '42',
    deadline: Date.now() + 600000,
    status: 'CREATED',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await repo.createIntent(intent1);

  const intent2: PersistentIntent = {
    ...intent1,
    intentId: 'intent-nonce-2'
  };

  await assert.rejects(async () => {
    await repo.createIntent(intent2);
  }, /Nonce replay detected/);
});
