import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionPlanBuilder } from '@zenith/execution';
import {
  defaultZenithRouter,
  defaultAcrossProvider,
  defaultStargateProvider,
  defaultDeBridgeProvider,
  defaultCrossChainAggregator,
  defaultDEXAggregator,
  UniswapV3Provider,
  QuickSwapProvider
} from '@zenith/routing';
import { defaultTokenService } from '@zenith/tokens';
import { defaultChainRegistry } from '@zenith/chains';
import { QuoteRequest, SwapRoute, Token, DEXQuote, CrossChainQuote } from '@zenith/types';
import {
  DestinationExecutionUnavailableError,
  ExecutionUnavailableError
} from '@zenith/contracts';

const USER_ADDR = '0x1234567890123456789012345678901234567890';

test('1. Same-chain swap execution plan contains VALIDATION, APPROVAL, SOURCE_SWAP, DESTINATION_VERIFY and NO bridge step', async () => {
  const polygon = defaultChainRegistry.getChain('polygon')!;
  const usdc = defaultTokenService.getTokensForChain('polygon').find((t) => t.symbol === 'USDC')!;
  const usdt = defaultTokenService.getTokensForChain('polygon').find((t) => t.symbol === 'USDT')!;

  const request: QuoteRequest = {
    sourceChainId: 'polygon',
    destinationChainId: 'polygon',
    tokenIn: usdc,
    tokenOut: usdt,
    amountInRaw: '1000000',
    slippageTolerancePercent: 0.5,
    userWalletAddress: USER_ADDR
  };

  const quoteResp = await defaultZenithRouter.getQuote(request);
  assert.ok(quoteResp);
  assert.ok(quoteResp.bestRoute);

  const plan = ExecutionPlanBuilder.buildPlan({
    route: quoteResp.bestRoute,
    request,
    options: { userAddress: USER_ADDR }
  });

  assert.ok(plan);
  assert.equal(plan.isExecutable, true);
  assert.equal(plan.routeType, 'DIRECT');
  assert.equal(plan.steps.length, 4);

  const stepTypes = plan.steps.map((s) => s.type);
  assert.deepEqual(stepTypes, ['VALIDATION', 'APPROVAL', 'SOURCE_SWAP', 'DESTINATION_VERIFY']);

  // Assert NO bridge steps
  assert.ok(!stepTypes.includes('BRIDGE_DEPOSIT'));
  assert.ok(!stepTypes.includes('BRIDGE_RELAY_WAIT'));
  assert.ok(!stepTypes.includes('DESTINATION_SWAP'));
  assert.ok(!stepTypes.includes('SETTLEMENT_COMPLETE'));

  // Assert deterministic step IDs
  assert.equal(plan.steps[0].id, 'validation');
  assert.equal(plan.steps[1].id, 'approval:source:USDC');
  assert.ok(plan.steps[2].id.startsWith('source-swap:'));
  assert.equal(plan.steps[3].id, 'destination-verification:polygon');
});

test('2. Direct cross-chain plan contains VALIDATION, APPROVAL, BRIDGE_DEPOSIT, BRIDGE_RELAY_WAIT, DESTINATION_VERIFY, SETTLEMENT', async () => {
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const request: QuoteRequest = {
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    tokenIn: usdcEth,
    tokenOut: usdcArb,
    amountInRaw: '1000000000', // 1000 USDC
    slippageTolerancePercent: 0.5,
    userWalletAddress: USER_ADDR
  };

  const quoteResp = await defaultZenithRouter.getQuote(request);
  assert.ok(quoteResp);

  const directBridgeRoute = quoteResp.routes.find((r) => r.crossChainQuote && !r.crossChainQuote.destDexQuote);
  assert.ok(directBridgeRoute, 'Must find a direct bridge route');

  const plan = ExecutionPlanBuilder.buildPlan({
    route: directBridgeRoute,
    request,
    options: { userAddress: USER_ADDR }
  });

  assert.ok(plan);
  assert.equal(plan.routeType, 'CROSS_CHAIN_DIRECT');

  const stepTypes = plan.steps.map((s) => s.type);
  assert.deepEqual(stepTypes, [
    'VALIDATION',
    'APPROVAL',
    'BRIDGE_DEPOSIT',
    'BRIDGE_RELAY_WAIT',
    'DESTINATION_VERIFY',
    'SETTLEMENT_COMPLETE'
  ]);

  // Assert deterministic step IDs
  assert.equal(plan.steps[0].id, 'validation');
  assert.equal(plan.steps[1].id, 'approval:source:USDC');
  assert.ok(plan.steps[2].id.startsWith('bridge:'));
  assert.ok(plan.steps[3].id.startsWith('bridge-relay-wait:'));
  assert.equal(plan.steps[4].id, 'destination-verification:arbitrum');
  assert.equal(plan.steps[5].id, 'settlement');
});

test('3. Composite cross-chain route with missing destination execution is flagged non-executable', async () => {
  const wethPolygon = defaultTokenService.getTokensForChain('polygon').find((t) => t.symbol === 'WETH')!;
  const uniArbitrum = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'UNI') || {
    address: '0xFa7F8980b0f1E64A12f279fcf256070a7b475630',
    chainId: 'arbitrum',
    name: 'Uniswap',
    symbol: 'UNI',
    decimals: 18,
    priceUSD: 8.5
  };

  const request: QuoteRequest = {
    sourceChainId: 'polygon',
    destinationChainId: 'arbitrum',
    tokenIn: wethPolygon,
    tokenOut: uniArbitrum,
    amountInRaw: '1000000000000000000', // 1 WETH
    slippageTolerancePercent: 0.5,
    userWalletAddress: USER_ADDR
  };

  const compositeQuotes = await defaultCrossChainAggregator.findConnectorBridgeQuotes(request);
  if (compositeQuotes.length > 0) {
    const compQuote = compositeQuotes[0];
    assert.equal(compQuote.isExecutable, false, 'Composite quote without destination execution must have isExecutable = false');
    assert.equal(compQuote.calldata, '0x', 'Composite quote must not contain executable calldata for omitted destination swap');
    assert.ok(compQuote.unexecutableReason?.includes('DESTINATION_EXECUTION_UNAVAILABLE') || compQuote.unexecutableReason?.includes('COMPOSITE'));
  }
});

test('4. CrossChainAggregator.buildExecution rejects composite routes missing destination solver', async () => {
  const mockCompositeQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across (Swap + Bridge)',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: { address: '0x1111111111111111111111111111111111111111', chainId: 'ethereum', name: 'TokenA', symbol: 'TKNA', decimals: 18, verificationTier: 'VERIFIED_CANONICAL' },
    destinationToken: { address: '0x2222222222222222222222222222222222222222', chainId: 'arbitrum', name: 'TokenB', symbol: 'TKNB', decimals: 18, verificationTier: 'VERIFIED_CANONICAL' },
    sourceAmountRaw: '1000000000000000000',
    destinationAmountRaw: '2000000000000000000',
    minDestinationAmountRaw: '1980000000000000000',
    bridgeFeeUSD: 2.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 5.0,
    recipient: USER_ADDR,
    expiration: Date.now() + 300000,
    routeIdentifier: 'test-composite-route',
    executionTarget: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
    calldata: '0x',
    value: '0',
    approvalTarget: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
    quoteTimestamp: Date.now(),
    estimatedTransferTimeSec: 60,
    securityRating: 'A+',
    isExecutable: false,
    destDexQuote: {
      provider: 'UNISWAP_V3',
      providerName: 'Uniswap V3',
      chainId: 42161,
      tokenIn: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', chainId: 'arbitrum', name: 'USD Coin', symbol: 'USDC', decimals: 6, verificationTier: 'VERIFIED_CANONICAL' },
      tokenOut: { address: '0x2222222222222222222222222222222222222222', chainId: 'arbitrum', name: 'TokenB', symbol: 'TKNB', decimals: 18, verificationTier: 'VERIFIED_CANONICAL' },
      amountIn: 1000000000n,
      amountOut: 2000000000000000000n,
      minimumAmountOut: 1980000000000000000n,
      feeAmount: 3000000n,
      feeTierBps: 30,
      priceImpactPercent: 0.05,
      gasEstimate: 150000n,
      gasCostUSD: 0.1,
      executionTarget: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      approvalTarget: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      quoteTimestamp: Date.now(),
      expiration: Date.now() + 60000
    }
  };

  await assert.rejects(
    async () => {
      await defaultCrossChainAggregator.buildExecution(mockCompositeQuote, USER_ADDR);
    },
    (err: any) => {
      assert.ok(
        err instanceof DestinationExecutionUnavailableError ||
        err.message.includes('DESTINATION_EXECUTION_UNAVAILABLE'),
        `Must throw DestinationExecutionUnavailableError, got: ${err.message}`
      );
      return true;
    }
  );
});

test('5. Provider API failure emits structured diagnostics and does NOT produce executable calldata', async () => {
  // Stargate V2 lacks a configured live quoter in TypeScript
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const quote = await defaultStargateProvider.getQuote({
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    tokenIn: usdcEth,
    tokenOut: usdcArb,
    amountInRaw: '1000000000',
    slippageTolerancePercent: 0.5,
    userWalletAddress: USER_ADDR
  });

  assert.ok(quote);
  assert.equal(quote.isExecutable, false, 'Unverified Stargate quote must be marked isExecutable = false');
  assert.equal(quote.calldata, '0x', 'Unverified Stargate quote must have empty calldata ("0x")');
  assert.ok(quote.diagnostics && quote.diagnostics.length > 0, 'Diagnostics must be recorded');
  assert.equal(quote.diagnostics![0].code, 'QUOTE_UNAVAILABLE');

  // Attempting buildExecution on unexecutable quote must throw
  await assert.rejects(
    async () => {
      await defaultStargateProvider.buildExecution(quote, USER_ADDR);
    },
    (err: any) => {
      assert.ok(err.message.includes('Cannot build execution for unexecutable quote'));
      return true;
    }
  );
});

test('6. Explicit dependency order in ExecutionPlan DAG', async () => {
  const baseChain = defaultChainRegistry.getChain('base')!;
  const usdcBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'USDC')!;
  const wethBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'WETH')!;

  const request: QuoteRequest = {
    sourceChainId: 'base',
    destinationChainId: 'base',
    tokenIn: usdcBase,
    tokenOut: wethBase,
    amountInRaw: '100000000', // 100 USDC
    slippageTolerancePercent: 0.5,
    userWalletAddress: USER_ADDR
  };

  const quoteResp = await defaultZenithRouter.getQuote(request);
  assert.ok(quoteResp);

  const plan = ExecutionPlanBuilder.buildPlan({
    route: quoteResp.bestRoute,
    request,
    options: { userAddress: USER_ADDR }
  });

  // Check DAG dependencies
  const validationStep = plan.steps.find((s) => s.type === 'VALIDATION')!;
  const approvalStep = plan.steps.find((s) => s.type === 'APPROVAL')!;
  const swapStep = plan.steps.find((s) => s.type === 'SOURCE_SWAP')!;
  const verifyStep = plan.steps.find((s) => s.type === 'DESTINATION_VERIFY')!;

  assert.deepEqual(validationStep.dependencies, []);
  assert.deepEqual(approvalStep.dependencies, [validationStep.id]);
  assert.deepEqual(swapStep.dependencies, [approvalStep.id]);
  assert.deepEqual(verifyStep.dependencies, [swapStep.id]);
});

test('7. Invalid or zero execution target address is rejected during plan construction', () => {
  const invalidRoute: SwapRoute = {
    id: 'route-invalid-target',
    routeType: 'DIRECT',
    hops: [],
    dexQuote: {
      provider: 'UNISWAP_V3',
      providerName: 'Uniswap V3',
      chainId: 1,
      tokenIn: { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', chainId: 'ethereum', name: 'USDC', symbol: 'USDC', decimals: 6, verificationTier: 'VERIFIED_CANONICAL' },
      tokenOut: { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', chainId: 'ethereum', name: 'WETH', symbol: 'WETH', decimals: 18, verificationTier: 'VERIFIED_CANONICAL' },
      amountIn: 1000000n,
      amountOut: 400000000000000n,
      minimumAmountOut: 398000000000000n,
      feeAmount: 3000n,
      feeTierBps: 30,
      priceImpactPercent: 0.01,
      gasEstimate: 120000n,
      gasCostUSD: 0.5,
      executionTarget: '0x0000000000000000000000000000000000000000', // Zero address
      approvalTarget: '0x0000000000000000000000000000000000000000',
      calldata: '0x',
      quoteTimestamp: Date.now(),
      expiration: Date.now() + 60000
    },
    gasCostUSD: 0.5,
    estimatedGasUnits: 120000n
  };

  const plan = ExecutionPlanBuilder.buildPlan({
    route: invalidRoute,
    request: {
      sourceChainId: 'ethereum',
      destinationChainId: 'ethereum',
      tokenIn: invalidRoute.dexQuote!.tokenIn,
      tokenOut: invalidRoute.dexQuote!.tokenOut,
      amountInRaw: '1000000',
      slippageTolerancePercent: 0.5,
      userWalletAddress: USER_ADDR
    },
    options: { userAddress: USER_ADDR }
  });

  assert.equal(plan.isExecutable, false);
  assert.ok(plan.unexecutableReason?.includes('INVALID_EXECUTION_TARGET'));
});

test('8. Existing same-chain EVM simulation and execution safeguards remain intact', async () => {
  const polygon = defaultChainRegistry.getChain('polygon')!;
  const pol = defaultTokenService.getNativeToken('polygon')!;
  const usdc = defaultTokenService.getTokensForChain('polygon').find((t) => t.symbol === 'USDC')!;

  const quoteResp = await defaultZenithRouter.getQuote({
    sourceChainId: 'polygon',
    destinationChainId: 'polygon',
    tokenIn: pol,
    tokenOut: usdc,
    amountInRaw: '1000000000000000000', // 1 POL
    slippageTolerancePercent: 0.5,
    userWalletAddress: USER_ADDR
  });

  assert.ok(quoteResp);
  assert.equal(quoteResp.isExecutable, true);
  assert.ok(quoteResp.executableTransaction);
  assert.ok(quoteResp.executableTransaction!.data.length > 10);
  assert.equal(quoteResp.validation?.isValid, true);
  assert.equal(quoteResp.validation?.isExecutable, true);
});
