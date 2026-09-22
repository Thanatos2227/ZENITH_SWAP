import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  Token,
  DestinationExecutionRequest,
  PersistentIntent
} from '@zenith/types';
import {
  SolverEngine,
  DestinationExecutionEngine,
  InMemoryCrossChainStateRepository,
  SQLiteCrossChainStateRepository,
  CrossChainRecoveryEngine
} from '../packages/execution/src';
import { DEXAggregator, UniswapV3Provider } from '../packages/routing/src';
import {
  DestinationExecutionFailedError,
  IntentExpiredError,
  SolverLiquidityUnavailableError,
  ExecutionUnavailableError,
  InvalidExecutionTargetError,
  InvalidRecipientAddressError
} from '../packages/contracts/src';

const USER_ADDR = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';

const usdcArb: Token = {
  symbol: 'USDC',
  name: 'USD Coin',
  address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  decimals: 6,
  chainId: 'arbitrum',
  verified: true,
  priceUSD: 1,
  tags: ['stablecoin']
};

const wethArb: Token = {
  symbol: 'WETH',
  name: 'Wrapped Ether',
  address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  decimals: 18,
  chainId: 'arbitrum',
  verified: true,
  priceUSD: 3000
};

test('Test 1: Bridge destination arrives -> Destination Execution Prepared (DESTINATION_EXECUTION_READY)', async () => {
  const solver = new SolverEngine();
  const request: DestinationExecutionRequest = {
    intentId: 'intent-test-1',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    recipient: USER_ADDR,
    inputToken: usdcArb,
    inputAmountActual: '1000000000', // 1,000 USDC
    outputToken: wethArb,
    minimumOutputAmount: '300000000000000000', // ~0.3 WETH
    deadline: Date.now() + 600000,
    bridgeProvider: 'ACROSS',
    providerOrderId: 'order-1'
  };

  const plan = await solver.prepareDestinationExecution(request);
  assert.ok(plan, 'Plan must be constructed');
  assert.equal(plan.intentId, 'intent-test-1');
  assert.equal(plan.mode, 'SOLVER');
  assert.equal(plan.destinationChainId, 'arbitrum');
  assert.ok(plan.amountIn > 0n);
  assert.ok(plan.expectedAmountOut > 0n);
  assert.ok(plan.calldata.startsWith('0x') && plan.calldata.length > 20);
});

test('Test 2: Destination DEX quote generated from actual bridge amount', async () => {
  const solver = new SolverEngine();
  // 500 USDC arrived (different from hypothetical 1,000 USDC quote)
  const request: DestinationExecutionRequest = {
    intentId: 'intent-test-2',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    recipient: USER_ADDR,
    inputToken: usdcArb,
    inputAmountActual: '500000000', // 500 USDC actual
    outputToken: wethArb,
    minimumOutputAmount: '150000000000000000', // 0.15 WETH
    deadline: Date.now() + 600000,
    bridgeProvider: 'ACROSS',
    providerOrderId: 'order-2'
  };

  const plan = await solver.prepareDestinationExecution(request);
  assert.equal(plan.amountIn, 500000000n, 'Destination swap must use exact actual bridge amount');
  assert.ok(plan.expectedAmountOut > 0n);
});

test('Test 3: Destination calldata generated correctly with authoritative router', async () => {
  const solver = new SolverEngine();
  const request: DestinationExecutionRequest = {
    intentId: 'intent-test-3',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    recipient: USER_ADDR,
    inputToken: usdcArb,
    inputAmountActual: '1000000000',
    outputToken: wethArb,
    minimumOutputAmount: '300000000000000000',
    deadline: Date.now() + 600000,
    bridgeProvider: 'ACROSS',
    providerOrderId: 'order-3'
  };

  const plan = await solver.prepareDestinationExecution(request);
  assert.ok(plan.targetAddress.startsWith('0x'));
  assert.equal(plan.targetAddress.length, 42);
  assert.notEqual(plan.targetAddress, '0x0000000000000000000000000000000000000000');
  assert.ok(plan.calldata.startsWith('0x'));
});

test('Test 4: Destination eth_call simulation fails -> DESTINATION_EXECUTION_FAILED and no submission', async () => {
  const mockFailingRpc = {
    call: async () => {
      throw new Error('STF: transferFrom failed in destination swap simulation');
    },
    estimateGas: async () => 250000n
  };

  const solver = new SolverEngine({
    rpcProviders: {
      arbitrum: mockFailingRpc
    }
  });

  const request: DestinationExecutionRequest = {
    intentId: 'intent-test-4',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    recipient: USER_ADDR,
    inputToken: usdcArb,
    inputAmountActual: '1000000000',
    outputToken: wethArb,
    minimumOutputAmount: '300000000000000000',
    deadline: Date.now() + 600000,
    bridgeProvider: 'ACROSS',
    providerOrderId: 'order-4'
  };

  const plan = await solver.prepareDestinationExecution(request);

  await assert.rejects(async () => {
    await solver.submitDestinationExecution(plan);
  }, (err: any) => {
    return err instanceof DestinationExecutionFailedError && err.message.includes('DESTINATION_SIMULATION_FAILED');
  });
});

test('Test 5: Destination gas estimation fails -> no submission', async () => {
  const mockGasFailRpc = {
    call: async () => '0x',
    estimateGas: async () => {
      throw new Error('UNPREDICTABLE_GAS_LIMIT: out of gas');
    }
  };

  const solver = new SolverEngine({
    rpcProviders: {
      arbitrum: mockGasFailRpc
    }
  });

  const request: DestinationExecutionRequest = {
    intentId: 'intent-test-5',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    recipient: USER_ADDR,
    inputToken: usdcArb,
    inputAmountActual: '1000000000',
    outputToken: wethArb,
    minimumOutputAmount: '300000000000000000',
    deadline: Date.now() + 600000,
    bridgeProvider: 'ACROSS',
    providerOrderId: 'order-5'
  };

  const plan = await solver.prepareDestinationExecution(request);

  await assert.rejects(async () => {
    await solver.submitDestinationExecution(plan);
  }, (err: any) => {
    return err instanceof DestinationExecutionFailedError && err.message.includes('DESTINATION_GAS_ESTIMATION_FAILED');
  });
});

test('Test 6: Destination transaction succeeds -> Move to DESTINATION_CONFIRMED', async () => {
  const mockSigner = {
    sendTransaction: async (tx: any) => ({
      hash: '0xd1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    })
  };

  const solver = new SolverEngine();
  const request: DestinationExecutionRequest = {
    intentId: 'intent-test-6',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    recipient: USER_ADDR,
    inputToken: usdcArb,
    inputAmountActual: '1000000000',
    outputToken: wethArb,
    minimumOutputAmount: '300000000000000000',
    deadline: Date.now() + 600000,
    bridgeProvider: 'ACROSS',
    providerOrderId: 'order-6'
  };

  const plan = await solver.prepareDestinationExecution(request);
  const result = await solver.submitDestinationExecution(plan, mockSigner);

  assert.equal(result.status, 'CONFIRMED');
  assert.equal(result.destinationTxHash, '0xd1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
});

test('Test 7: Destination token amount verified -> Move to DESTINATION_VERIFIED', async () => {
  const solver = new SolverEngine();
  const verification = await solver.verifyDestinationExecution(
    '0xd1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    USER_ADDR,
    'WETH',
    300000000000000000n
  );

  assert.equal(verification.isVerified, true);
  assert.equal(verification.recipient, USER_ADDR);
  assert.equal(verification.expectedToken, 'WETH');
});

test('Test 8: Wrong recipient -> Fails closed / rejected', async () => {
  const solver = new SolverEngine();
  const request: DestinationExecutionRequest = {
    intentId: 'intent-test-8',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    recipient: '0x0000000000000000000000000000000000000000', // Zero address
    inputToken: usdcArb,
    inputAmountActual: '1000000000',
    outputToken: wethArb,
    minimumOutputAmount: '300000000000000000',
    deadline: Date.now() + 600000,
    bridgeProvider: 'ACROSS',
    providerOrderId: 'order-8'
  };

  await assert.rejects(async () => {
    await solver.prepareDestinationExecution(request);
  }, /Invalid recipient address/);
});

test('Test 9: Wrong destination token -> Fails closed / rejected', async () => {
  const solver = new SolverEngine();
  const invalidToken: Token = {
    symbol: 'BAD',
    name: 'Bad Token',
    address: '0x0000000000000000000000000000000000000000',
    decimals: 18,
    chainId: 'arbitrum'
  };

  const request: DestinationExecutionRequest = {
    intentId: 'intent-test-9',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    recipient: USER_ADDR,
    inputToken: usdcArb,
    inputAmountActual: '1000000000',
    outputToken: invalidToken,
    minimumOutputAmount: '1000000000000000000',
    deadline: Date.now() + 600000,
    bridgeProvider: 'ACROSS',
    providerOrderId: 'order-9'
  };

  await assert.rejects(async () => {
    await solver.prepareDestinationExecution(request);
  }, /Invalid or unrecognized token address/);
});

test('Test 10: Output below minimum -> Fails closed / rejected', async () => {
  const solver = new SolverEngine();
  // Asking for 1,000 WETH output for 1,000 USDC (unrealistic output)
  const request: DestinationExecutionRequest = {
    intentId: 'intent-test-10',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    recipient: USER_ADDR,
    inputToken: usdcArb,
    inputAmountActual: '1000000000', // 1,000 USDC
    outputToken: wethArb,
    minimumOutputAmount: '1000000000000000000000', // 1,000 WETH minimum required
    deadline: Date.now() + 600000,
    bridgeProvider: 'ACROSS',
    providerOrderId: 'order-10'
  };

  await assert.rejects(async () => {
    await solver.prepareDestinationExecution(request);
  }, /DESTINATION_SLIPPAGE_EXCEEDED/);
});

test('Test 11: Solver liquidity insufficient -> SOLVER_LIQUIDITY_UNAVAILABLE', async () => {
  // Solver with small liquidity capacity ($100 USD)
  const solver = new SolverEngine({
    profile: {
      availableLiquidityUSD: 100
    }
  });

  const request: DestinationExecutionRequest = {
    intentId: 'intent-test-11',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    recipient: USER_ADDR,
    inputToken: usdcArb,
    inputAmountActual: '5000000000', // $5,000 USDC
    outputToken: wethArb,
    minimumOutputAmount: '1000000000000000000',
    deadline: Date.now() + 600000,
    bridgeProvider: 'ACROSS',
    providerOrderId: 'order-11'
  };

  await assert.rejects(async () => {
    await solver.prepareDestinationExecution(request);
  }, (err: any) => {
    return err instanceof SolverLiquidityUnavailableError;
  });
});

test('Test 12: Solver A claims order -> Solver B cannot claim simultaneously', async () => {
  const repo = new InMemoryCrossChainStateRepository();
  const solverA = new SolverEngine({ profile: { id: 'solver-a' }, repository: repo });
  const solverB = new SolverEngine({ profile: { id: 'solver-b' }, repository: repo });

  const intent: PersistentIntent = {
    intentId: 'intent-test-12',
    userAddress: USER_ADDR,
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTokenAddress: usdcArb.address,
    sourceTokenSymbol: 'USDC',
    destinationTokenAddress: wethArb.address,
    destinationTokenSymbol: 'WETH',
    amountInRaw: '1000000000',
    expectedAmountOutRaw: '333000000000000000',
    minAmountOutRaw: '300000000000000000',
    provider: 'ACROSS',
    routeId: 'route-12',
    nonce: '12',
    deadline: Date.now() + 600000,
    status: 'FULFILLING',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await repo.createIntent(intent);

  const request: DestinationExecutionRequest = {
    intentId: 'intent-test-12',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    recipient: USER_ADDR,
    inputToken: usdcArb,
    inputAmountActual: '1000000000',
    outputToken: wethArb,
    minimumOutputAmount: '300000000000000000',
    deadline: Date.now() + 600000,
    bridgeProvider: 'ACROSS',
    providerOrderId: 'order-12'
  };

  const mockSigner = {
    sendTransaction: async () => ({ hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' })
  };

  const planA = await solverA.prepareDestinationExecution(request);
  await solverA.submitDestinationExecution(planA, undefined, mockSigner);

  const planB = await solverB.prepareDestinationExecution(request);
  await assert.rejects(async () => {
    await solverB.submitDestinationExecution(planB, undefined, mockSigner);
  }, /SOLVER_CLAIM_COLLISION/);
});

test('Test 13: Solver A lease expires -> Solver B may recover order', async () => {
  const repo = new InMemoryCrossChainStateRepository();
  const solverB = new SolverEngine({ profile: { id: 'solver-b' }, repository: repo });

  const intent: PersistentIntent = {
    intentId: 'intent-test-13',
    userAddress: USER_ADDR,
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTokenAddress: usdcArb.address,
    sourceTokenSymbol: 'USDC',
    destinationTokenAddress: wethArb.address,
    destinationTokenSymbol: 'WETH',
    amountInRaw: '1000000000',
    expectedAmountOutRaw: '333000000000000000',
    minAmountOutRaw: '300000000000000000',
    provider: 'ACROSS',
    routeId: 'route-13',
    nonce: '13',
    deadline: Date.now() + 600000,
    status: 'FULFILLING',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await repo.createIntent(intent);

  // Solver A claims with short lease (40ms) and crashes
  await repo.claimIntentLease('intent-test-13', 'solver-a', 40);

  // Wait 60ms for expiration
  await new Promise((r) => setTimeout(r, 60));

  const request: DestinationExecutionRequest = {
    intentId: 'intent-test-13',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    recipient: USER_ADDR,
    inputToken: usdcArb,
    inputAmountActual: '1000000000',
    outputToken: wethArb,
    minimumOutputAmount: '300000000000000000',
    deadline: Date.now() + 600000,
    bridgeProvider: 'ACROSS',
    providerOrderId: 'order-13'
  };

  const mockSigner = {
    sendTransaction: async () => ({ hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' })
  };

  const planB = await solverB.prepareDestinationExecution(request);
  const resultB = await solverB.submitDestinationExecution(planB, undefined, mockSigner);
  assert.equal(resultB.status, 'CONFIRMED');
});

test('Test 14: Destination tx already exists -> No duplicate execution', async () => {
  const solver = new SolverEngine();
  const request: DestinationExecutionRequest = {
    intentId: 'intent-test-14',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    recipient: USER_ADDR,
    inputToken: usdcArb,
    inputAmountActual: '1000000000',
    outputToken: wethArb,
    minimumOutputAmount: '300000000000000000',
    deadline: Date.now() + 600000,
    bridgeProvider: 'ACROSS',
    providerOrderId: 'order-14'
  };

  const mockSigner = {
    sendTransaction: async () => ({ hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' })
  };

  const plan = await solver.prepareDestinationExecution(request);
  const res1 = await solver.submitDestinationExecution(plan, undefined, mockSigner);
  const res2 = await solver.submitDestinationExecution(plan, undefined, mockSigner);

  assert.equal(res1.destinationTxHash, res2.destinationTxHash, 'Subsequent submissions must return existing txHash without duplicate dispatch');
});

test('Test 15: Process restart during destination execution -> Recovery resumes safely', async () => {
  const repo = new InMemoryCrossChainStateRepository();

  const intent: PersistentIntent = {
    intentId: 'intent-test-15',
    userAddress: USER_ADDR,
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTokenAddress: usdcArb.address,
    sourceTokenSymbol: 'USDC',
    destinationTokenAddress: wethArb.address,
    destinationTokenSymbol: 'WETH',
    amountInRaw: '1000000000',
    expectedAmountOutRaw: '333000000000000000',
    minAmountOutRaw: '300000000000000000',
    provider: 'ACROSS',
    routeId: 'route-15',
    nonce: '15',
    deadline: Date.now() + 600000,
    status: 'FULFILLING',
    destinationTxHash: '0x9999888877776666555544443333222211110000aaaaabbbbbcccccdddddeeeee',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await repo.createIntent(intent);

  const mockRpc = {
    getTransactionReceipt: async () => ({ status: 1, blockNumber: 12345 })
  };

  const recoveryEngine = new CrossChainRecoveryEngine({
    repository: repo,
    rpcProviders: {
      arbitrum: mockRpc
    }
  });

  const recoveryResult = await recoveryEngine.recoverIntent('intent-test-15');
  assert.equal(recoveryResult.reconciledStatus, 'SETTLED');

  const settled = await repo.getIntent('intent-test-15');
  assert.equal(settled?.status, 'SETTLED');
});

test('Test 16: Expired deadline -> Destination execution rejected (INTENT_EXPIRED)', async () => {
  const solver = new SolverEngine();
  const request: DestinationExecutionRequest = {
    intentId: 'intent-test-16',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    recipient: USER_ADDR,
    inputToken: usdcArb,
    inputAmountActual: '1000000000',
    outputToken: wethArb,
    minimumOutputAmount: '300000000000000000',
    deadline: Date.now() - 5000, // Expired 5 seconds ago
    bridgeProvider: 'ACROSS',
    providerOrderId: 'order-16'
  };

  await assert.rejects(async () => {
    await solver.prepareDestinationExecution(request);
  }, (err: any) => {
    return err instanceof IntentExpiredError;
  });
});

test('Test 17: Replay nonce -> Rejected atomically by repository', async () => {
  const repo = new InMemoryCrossChainStateRepository();
  const intent1: PersistentIntent = {
    intentId: 'intent-nonce-1',
    userAddress: USER_ADDR,
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTokenAddress: usdcArb.address,
    sourceTokenSymbol: 'USDC',
    destinationTokenAddress: wethArb.address,
    destinationTokenSymbol: 'WETH',
    amountInRaw: '1000000000',
    expectedAmountOutRaw: '333000000000000000',
    minAmountOutRaw: '300000000000000000',
    provider: 'ACROSS',
    routeId: 'route-17',
    nonce: 'nonce-17',
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

test('Test 18: Destination transaction succeeds but reverted on-chain -> DESTINATION_VERIFICATION_FAILED', async () => {
  const mockRevertedRpc = {
    getTransactionReceipt: async () => ({
      status: 0, // Reverted on-chain
      blockNumber: 12345
    })
  };

  const solver = new SolverEngine({
    rpcProviders: {
      arbitrum: mockRevertedRpc
    }
  });

  const verification = await solver.verifyDestinationExecution(
    '0xreverted_tx_hash',
    USER_ADDR,
    'WETH',
    300000000000000000n
  );

  assert.equal(verification.isVerified, false);
  assert.ok(verification.reason?.includes('reverted'));
});

test('Test 19: Destination execution succeeds and exact amount is verified -> SETTLED', async () => {
  const engine = new DestinationExecutionEngine();
  const request: DestinationExecutionRequest = {
    intentId: 'intent-test-19',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    recipient: USER_ADDR,
    inputToken: usdcArb,
    inputAmountActual: '1000000000',
    outputToken: wethArb,
    minimumOutputAmount: '300000000000000000',
    deadline: Date.now() + 600000,
    bridgeProvider: 'ACROSS',
    providerOrderId: 'order-19'
  };

  const mockSigner = {
    sendTransaction: async () => ({ hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' })
  };

  const plan = await engine.prepareExecution(request);
  const result = await engine.executeDestinationSwap({ plan, provider: mockSigner });
  assert.equal(result.status, 'CONFIRMED');

  const verification = await engine.verifySettlement({
    executionId: plan.executionId,
    expectedRecipient: USER_ADDR,
    expectedToken: 'WETH',
    minAmount: 300000000000000000n
  });

  assert.equal(verification.isVerified, true);
  assert.equal(verification.recipient, USER_ADDR);
});
