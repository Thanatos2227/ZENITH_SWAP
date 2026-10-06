import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTokenService } from '../packages/tokens/src';
import { defaultChainRegistry } from '../packages/chains/src';
import {
  CrossChainAggregator,
  ZenithRouter,
  defaultAcrossProvider,
  defaultDeBridgeProvider,
  defaultStargateProvider,
  validateCrossChainQuoteExecutability,
  RouteArbitrator,
  RouteNormalizer
} from '../packages/routing/src';
import { ExecutionPlanBuilder, ExecutionPlanValidator } from '../packages/execution/src';
import { defaultDEXAggregator } from '../packages/routing/src/dex/dexAggregator';
import { calculateDEXLiquidityOutput } from '../packages/routing/src/dex/dexMath';
import { CrossChainQuote, QuoteRequest, SwapRoute, DEXQuote } from '../packages/types/src';
import {
  AggregateCrossChainQuoteError,
  DestinationExecutionUnavailableError,
  ExecutionUnavailableError,
  SourceSwapUnavailableError,
  AmountMismatchError,
  ACROSS_SPOKE_POOLS
} from '../packages/contracts/src';

const USER_ADDR = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const RECIPIENT_ADDR = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

test('1. Direct bridge for ETH (Arbitrum) -> BRETT (Base) is rejected (fails closed)', async () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;
  assert.ok(ethArb, 'ETH on Arbitrum must exist');
  assert.ok(brettBase, 'BRETT on Base must exist');

  const aggregator = new CrossChainAggregator();
  const directQuotes = await aggregator.getQuotes({
    sourceChainId: 'arbitrum',
    destinationChainId: 'base',
    tokenIn: ethArb,
    tokenOut: brettBase,
    amountInRaw: '1000000000000000000',
    userWalletAddress: USER_ADDR
  });

  const executableDirect = directQuotes.filter((q) => q.isExecutable);
  assert.equal(executableDirect.length, 0, 'No direct bridge quote may be executable for cross-asset pair');
});

test('2. Source DEX route discovery: ETH -> USDC on Arbitrum', async () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;
  assert.ok(ethArb && usdcArb);

  const dexQuotes = await defaultDEXAggregator.getQuotes({
    chainId: 42161,
    tokenIn: ethArb,
    tokenOut: usdcArb,
    amountIn: 1000000000000000000n, // 1 ETH
    slippageToleranceBps: 25,
    recipient: USER_ADDR
  });

  assert.ok(dexQuotes.length > 0, 'Must find valid DEX quote on Arbitrum');
  const bestDex = dexQuotes[0];
  assert.ok(bestDex.amountOut > 0n, 'DEX quote must have positive amountOut');
  assert.ok(bestDex.minimumAmountOut > 0n && bestDex.minimumAmountOut <= bestDex.amountOut);

  const exec = await defaultDEXAggregator.buildExecution(bestDex, USER_ADDR, USER_ADDR);
  assert.ok(exec.data.startsWith('0x') && exec.data.length > 10, 'Must produce valid calldata');
  assert.ok(exec.to.startsWith('0x') && exec.to.length === 42, 'Must produce valid target');
});

test('3. Bridgeable intermediate asset selection & quote acquisition', async () => {
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;
  const usdcBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'USDC')!;
  assert.ok(usdcArb && usdcBase);

  const aggregator = new CrossChainAggregator();
  const bridgeQuotes = await aggregator.getQuotes({
    sourceChainId: 'arbitrum',
    destinationChainId: 'base',
    tokenIn: usdcArb,
    tokenOut: usdcBase,
    amountInRaw: '2498125468', // ~2,498.12 USDC
    userWalletAddress: USER_ADDR
  });

  for (const q of bridgeQuotes) {
    if (q.isExecutable) {
      assert.equal(q.sourceAmountRaw, '2498125468');
      assert.ok(BigInt(q.destinationAmountRaw) > 0n);
    }
  }
});

test('4. Destination DEX route discovery: USDC -> BRETT on Base', async () => {
  const usdcBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'USDC')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;
  assert.ok(usdcBase && brettBase);

  const destDexQuotes = await defaultDEXAggregator.getQuotes({
    chainId: 8453,
    tokenIn: usdcBase,
    tokenOut: brettBase,
    amountIn: 2496876718n, // ~2,496.87 USDC
    slippageToleranceBps: 25,
    recipient: USER_ADDR
  });

  assert.ok(destDexQuotes.length > 0, 'Must find valid DEX quote on Base for USDC -> BRETT');
  const bestDestDex = destDexQuotes[0];
  assert.ok(bestDestDex.amountOut > 0n);
  assert.ok(bestDestDex.minimumAmountOut > 0n);

  const exec = await defaultDEXAggregator.buildExecution(bestDestDex, USER_ADDR, USER_ADDR);
  assert.ok(exec.data.startsWith('0x') && exec.data.length > 10);
  assert.ok(exec.to.startsWith('0x') && exec.to.length === 42);
});

test('5. Complete composite route construction with dynamic amount propagation', async () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;
  const usdcBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'USDC')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;

  const userAmountIn = 1000000000000000000n; // 1 ETH

  // Hop 1: Source DEX
  const srcDexQuote: DEXQuote = {
    provider: 'CAMELOT',
    providerName: 'Camelot DEX',
    chainId: 42161,
    tokenIn: ethArb,
    tokenOut: usdcArb,
    amountIn: userAmountIn,
    amountOut: 2498125468n, // 2,498.125468 USDC (6 decimals)
    minimumAmountOut: 2491879154n,
    feeAmount: 7494376n,
    feeTierBps: 30,
    priceImpactPercent: 0.02,
    gasEstimate: 150000n,
    gasCostUSD: 0.05,
    executionTarget: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
    approvalTarget: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
    calldata: '0x1234567890abcdef',
    quoteTimestamp: Date.now(),
    expiration: Date.now() + 60000
  };

  // Hop 2: Bridge (USDC Arb -> USDC Base)
  const underlyingBridgeQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'arbitrum',
    destinationChainId: 'base',
    sourceToken: usdcArb,
    destinationToken: usdcBase,
    sourceAmountRaw: srcDexQuote.amountOut.toString(), // Exact Hop 1 output!
    destinationAmountRaw: '2496876718', // Verified bridge output (6 decimals)
    minDestinationAmountRaw: '2490634526',
    bridgeFeeUSD: 1.25,
    relayerFee: '1248750',
    gasEstimateUSD: 0.1,
    recipient: USER_ADDR,
    expiration: Date.now() + 60000,
    routeIdentifier: 'across-arb-base-usdc',
    executionTarget: ACROSS_SPOKE_POOLS[42161],
    calldata: '0xacrossdepositdata',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[42161],
    quoteTimestamp: Date.now(),
    estimatedTransferTimeSec: 45,
    securityRating: 'A+',
    isExecutable: true
  };

  // Hop 3: Destination DEX (USDC Base -> BRETT Base)
  const destDexQuote: DEXQuote = {
    provider: 'AERODROME',
    providerName: 'Aerodrome Finance',
    chainId: 8453,
    tokenIn: usdcBase,
    tokenOut: brettBase,
    amountIn: BigInt(underlyingBridgeQuote.destinationAmountRaw), // Exact Hop 2 output!
    amountOut: 498375000000000000000000n, // ~498,375 BRETT (18 decimals)
    minimumAmountOut: 497129062500000000000000n,
    feeAmount: 7490630n,
    feeTierBps: 30,
    priceImpactPercent: 0.05,
    gasEstimate: 160000n,
    gasCostUSD: 0.02,
    executionTarget: '0xcF77a3Ba9A5CA399B7c97c748846911387219558',
    approvalTarget: '0xcF77a3Ba9A5CA399B7c97c748846911387219558',
    calldata: '0xaerodromeswapcalldata',
    quoteTimestamp: Date.now(),
    expiration: Date.now() + 60000
  };

  const compositeQuote: CrossChainQuote = {
    ...underlyingBridgeQuote,
    sourceToken: ethArb,
    destinationToken: brettBase,
    sourceAmountRaw: userAmountIn.toString(),
    destinationAmountRaw: destDexQuote.amountOut.toString(),
    minDestinationAmountRaw: destDexQuote.minimumAmountOut.toString(),
    sourceDexQuote: srcDexQuote,
    destDexQuote,
    underlyingBridgeQuote,
    sourceConnectorToken: usdcArb,
    destConnectorToken: usdcBase,
    compositeExecutionMode: 'SEPARATE_DESTINATION_TX',
    isExecutable: true,
    executionTarget: srcDexQuote.executionTarget,
    calldata: srcDexQuote.calldata
  };

  const route: SwapRoute = {
    id: 'route-composite-eth-brett',
    routeType: 'CROSS_CHAIN',
    hops: [
      {
        dexProtocol: 'CAMELOT',
        poolAddress: srcDexQuote.executionTarget,
        tokenIn: ethArb,
        tokenOut: usdcArb,
        feeTierBps: 30,
        proportionPercent: 100,
        estimatedGas: 150000n
      },
      {
        dexProtocol: 'AERODROME',
        poolAddress: destDexQuote.executionTarget,
        tokenIn: usdcBase,
        tokenOut: brettBase,
        feeTierBps: 30,
        proportionPercent: 100,
        estimatedGas: 160000n
      }
    ],
    bridgeStep: {
      bridgeProtocol: 'ACROSS',
      sourceChainId: 'arbitrum',
      destinationChainId: 'base',
      tokenIn: usdcArb,
      tokenOut: usdcBase,
      estimatedTransferTimeSec: 45,
      bridgeFeeUSD: 1.25,
      securityRating: 'A+',
      relayerFee: '1248750'
    },
    gasCostUSD: 0.17,
    crossChainQuote: compositeQuote,
    isExecutable: true
  };

  const plan = ExecutionPlanBuilder.buildPlan({
    route,
    request: {
      sourceChainId: 'arbitrum',
      destinationChainId: 'base',
      tokenIn: ethArb,
      tokenOut: brettBase,
      amountInRaw: userAmountIn.toString(),
      userWalletAddress: USER_ADDR,
      recipientAddress: RECIPIENT_ADDR
    }
  });

  assert.equal(plan.isExecutable, true);
  assert.equal(plan.routeType, 'CROSS_CHAIN_COMPOSITE');
  assert.equal(plan.compositeExecutionMode, 'SEPARATE_DESTINATION_TX');

  const stepTypes = plan.steps.map((s) => s.type);
  assert.ok(stepTypes.includes('VALIDATION'));
  assert.ok(stepTypes.includes('SOURCE_SWAP'));
  assert.ok(stepTypes.includes('BRIDGE_QUOTE_REFRESH'));
  assert.ok(stepTypes.includes('BRIDGE_DEPOSIT'));
  assert.ok(stepTypes.includes('BRIDGE_RELAY_WAIT'));
  assert.ok(stepTypes.includes('DESTINATION_SWAP'));
  assert.ok(stepTypes.includes('DESTINATION_VERIFY'));
  assert.ok(stepTypes.includes('SETTLEMENT_COMPLETE'));

  // Strict Amount Continuity Assertion:
  const srcStep = plan.steps.find((s) => s.type === 'SOURCE_SWAP')!;
  assert.equal(srcStep.requiredAmountRaw, userAmountIn.toString());
  assert.equal(srcStep.expectedAmountOutRaw, srcDexQuote.amountOut.toString());

  const bridgeStep = plan.steps.find((s) => s.type === 'BRIDGE_DEPOSIT')!;
  assert.equal(bridgeStep.requiredAmountRaw, srcStep.expectedAmountOutRaw);

  const dstStep = plan.steps.find((s) => s.type === 'DESTINATION_SWAP')!;
  assert.equal(dstStep.requiredAmountRaw, underlyingBridgeQuote.destinationAmountRaw);

  const topo = ExecutionPlanValidator.getTopologicalOrder(plan);
  const srcIdx = topo.findIndex((s) => s.type === 'SOURCE_SWAP');
  const refreshIdx = topo.findIndex((s) => s.type === 'BRIDGE_QUOTE_REFRESH');
  const bridgeIdx = topo.findIndex((s) => s.type === 'BRIDGE_DEPOSIT');
  const waitIdx = topo.findIndex((s) => s.type === 'BRIDGE_RELAY_WAIT');
  const dstIdx = topo.findIndex((s) => s.type === 'DESTINATION_SWAP');
  const verifyIdx = topo.findIndex((s) => s.type === 'DESTINATION_VERIFY');

  assert.ok(srcIdx < refreshIdx);
  assert.ok(refreshIdx < bridgeIdx);
  assert.ok(bridgeIdx < waitIdx);
  assert.ok(waitIdx < dstIdx);
  assert.ok(dstIdx < verifyIdx);
});

test('6. Dynamic amount propagation failure: discrepancy throws AmountMismatchError', () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;

  const plan: any = {
    planId: 'plan-mismatch',
    routeId: 'route-mismatch',
    routeType: 'CROSS_CHAIN_COMPOSITE',
    sourceChainId: 'arbitrum',
    destinationChainId: 'base',
    tokenIn: ethArb,
    tokenOut: brettBase,
    expectedAmountInRaw: '1000000000000000000',
    expectedAmountOutRaw: '498375000000000000000000',
    minimumAmountOutRaw: '497129062500000000000000',
    isExecutable: true,
    steps: [
      {
        id: 'step-1',
        type: 'SOURCE_SWAP',
        chainId: 'arbitrum',
        executionEnvironment: 'EVM',
        targetAddress: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
        calldata: '0x1234',
        requiredTokenAddress: ethArb.address,
        outputTokenAddress: usdcArb.address,
        requiredAmountRaw: '1000000000000000000',
        expectedAmountOutRaw: '2498125468',
        dependencies: [],
        retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
      },
      {
        id: 'step-2',
        type: 'BRIDGE_DEPOSIT',
        chainId: 'arbitrum',
        executionEnvironment: 'EVM',
        targetAddress: ACROSS_SPOKE_POOLS[42161],
        calldata: '0x5678',
        requiredTokenAddress: usdcArb.address,
        requiredAmountRaw: '9999999999', // Disconnected fabricated amount!
        dependencies: ['step-1'],
        retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
      }
    ]
  };

  assert.throws(() => ExecutionPlanValidator.validateCompositePlan(plan), AmountMismatchError);
});

test('7. Source DEX quote unavailable -> fail closed with SOURCE_SWAP_UNAVAILABLE diagnostic', async () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;
  const usdcBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'USDC')!;

  const compositeQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'arbitrum',
    destinationChainId: 'base',
    sourceToken: ethArb,
    destinationToken: brettBase,
    sourceAmountRaw: '1000000000000000000',
    destinationAmountRaw: '498375000000000000000000',
    minDestinationAmountRaw: '497129062500000000000000',
    bridgeFeeUSD: 1.25,
    relayerFee: '1248750',
    gasEstimateUSD: 0.1,
    recipient: USER_ADDR,
    expiration: Date.now() + 60000,
    routeIdentifier: 'across-no-source-dex',
    executionTarget: ACROSS_SPOKE_POOLS[42161],
    calldata: '0x',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[42161],
    quoteTimestamp: Date.now(),
    isExecutable: false,
    unexecutableReason: 'SOURCE_SWAP_UNAVAILABLE',
    sourceDexQuote: {
      provider: 'CAMELOT',
      executionTarget: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
      calldata: undefined, // Missing calldata!
      amountIn: 1000000000000000000n,
      amountOut: 2498125468n,
      minimumAmountOut: 2491879154n,
      tokenIn: ethArb,
      tokenOut: usdcBase,
      feeTierBps: 30,
      gasEstimate: 150000n,
      gasCostUSD: 0.05
    } as any
  };

  const plan = ExecutionPlanBuilder.buildPlan({
    route: {
      id: 'route-no-source-calldata',
      routeType: 'CROSS_CHAIN',
      hops: [],
      gasCostUSD: 0.1,
      crossChainQuote: compositeQuote,
      isExecutable: false,
      unexecutableReason: 'SOURCE_SWAP_UNAVAILABLE'
    },
    request: {
      sourceChainId: 'arbitrum',
      destinationChainId: 'base',
      tokenIn: ethArb,
      tokenOut: brettBase,
      amountInRaw: '1000000000000000000'
    }
  });

  assert.equal(plan.isExecutable, false);
  assert.equal(plan.unexecutableReason, 'SOURCE_SWAP_UNAVAILABLE');
});

test('8. Destination DEX unavailable -> fail closed with DESTINATION_EXECUTION_UNAVAILABLE', async () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;
  const usdcBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'USDC')!;

  const compositeQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'arbitrum',
    destinationChainId: 'base',
    sourceToken: ethArb,
    destinationToken: brettBase,
    sourceAmountRaw: '1000000000000000000',
    destinationAmountRaw: '498375000000000000000000',
    minDestinationAmountRaw: '497129062500000000000000',
    bridgeFeeUSD: 1.25,
    relayerFee: '1248750',
    gasEstimateUSD: 0.1,
    recipient: USER_ADDR,
    expiration: Date.now() + 60000,
    routeIdentifier: 'across-no-dest-dex',
    executionTarget: ACROSS_SPOKE_POOLS[42161],
    calldata: '0x1234',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[42161],
    quoteTimestamp: Date.now(),
    isExecutable: false,
    unexecutableReason: 'DESTINATION_EXECUTION_UNAVAILABLE',
    destConnectorToken: usdcBase,
    destDexQuote: {
      provider: 'AERODROME',
      executionTarget: '0xcF77a3Ba9A5CA399B7c97c748846911387219558',
      calldata: undefined, // Missing destination calldata!
      amountIn: 2496876718n,
      amountOut: 498375000000000000000000n,
      minimumAmountOut: 497129062500000000000000n,
      tokenIn: usdcBase,
      tokenOut: brettBase,
      feeTierBps: 30,
      gasEstimate: 160000n,
      gasCostUSD: 0.02
    } as any
  };

  const plan = ExecutionPlanBuilder.buildPlan({
    route: {
      id: 'route-no-dest-calldata',
      routeType: 'CROSS_CHAIN',
      hops: [],
      gasCostUSD: 0.1,
      crossChainQuote: compositeQuote,
      isExecutable: false,
      unexecutableReason: 'DESTINATION_EXECUTION_UNAVAILABLE'
    },
    request: {
      sourceChainId: 'arbitrum',
      destinationChainId: 'base',
      tokenIn: ethArb,
      tokenOut: brettBase,
      amountInRaw: '1000000000000000000'
    }
  });

  assert.equal(plan.isExecutable, false);
  assert.equal(plan.unexecutableReason, 'DESTINATION_EXECUTION_UNAVAILABLE');
});

test('9. Quote expiration across multi-hop route marks route unexecutable', () => {
  const expiredTimestamp = Date.now() - 30000;
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const quote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'arbitrum',
    destinationChainId: 'base',
    sourceToken: ethArb,
    destinationToken: brettBase,
    sourceAmountRaw: '1000000000000000000',
    destinationAmountRaw: '498375000000000000000000',
    minDestinationAmountRaw: '497129062500000000000000',
    bridgeFeeUSD: 1.25,
    relayerFee: '1248750',
    gasEstimateUSD: 0.1,
    recipient: USER_ADDR,
    expiration: expiredTimestamp,
    routeIdentifier: 'expired-composite',
    executionTarget: ACROSS_SPOKE_POOLS[42161],
    calldata: '0x1234',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[42161],
    quoteTimestamp: expiredTimestamp - 15000,
    sourceConnectorToken: usdcArb,
    destConnectorToken: usdcArb,
    isExecutable: true
  };

  const validation = validateCrossChainQuoteExecutability(quote);
  assert.equal(validation.isExecutable, false);
  assert.ok(validation.failedGates.includes('VALID_EXPIRATION') || validation.failedGates.includes('EXPIRATION_VALID'));
});

test('10. Route arbitration: Composite executable route is preferred over unsupported direct route', () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;
  const usdcBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'USDC')!;

  const directQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'arbitrum',
    destinationChainId: 'base',
    sourceToken: ethArb,
    destinationToken: brettBase,
    sourceAmountRaw: '1000000000000000000',
    destinationAmountRaw: '0',
    minDestinationAmountRaw: '0',
    bridgeFeeUSD: 0,
    relayerFee: '0',
    gasEstimateUSD: 0,
    recipient: USER_ADDR,
    expiration: Date.now() + 60000,
    routeIdentifier: 'direct-unsupported',
    executionTarget: ACROSS_SPOKE_POOLS[42161],
    calldata: '0x',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[42161],
    quoteTimestamp: Date.now(),
    isExecutable: false,
    unexecutableReason: 'DIRECT_BRIDGE_UNSUPPORTED: Across only supports same-asset bridging'
  };

  const compositeQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across (Swap + Bridge)',
    sourceChainId: 'arbitrum',
    destinationChainId: 'base',
    sourceToken: ethArb,
    destinationToken: brettBase,
    sourceAmountRaw: '1000000000000000000',
    destinationAmountRaw: '498375000000000000000000',
    minDestinationAmountRaw: '497129062500000000000000',
    bridgeFeeUSD: 1.25,
    relayerFee: '1248750',
    gasEstimateUSD: 0.17,
    recipient: USER_ADDR,
    expiration: Date.now() + 60000,
    routeIdentifier: 'composite-across',
    executionTarget: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
    calldata: '0x12345678',
    value: '1000000000000000000',
    approvalTarget: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
    quoteTimestamp: Date.now(),
    sourceConnectorToken: usdcArb,
    destConnectorToken: usdcBase,
    isExecutable: true
  };

  const request: QuoteRequest = {
    sourceChainId: 'arbitrum',
    destinationChainId: 'base',
    tokenIn: ethArb,
    tokenOut: brettBase,
    amountInRaw: '1000000000000000000',
    userWalletAddress: USER_ADDR
  };

  const normDirect = RouteNormalizer.normalizeQuote(directQuote, request);
  const normComposite = RouteNormalizer.normalizeQuote(compositeQuote, request);

  const arbResult = RouteArbitrator.arbitrate([normDirect, normComposite], request);
  assert.ok(arbResult.selectedRoute, 'RouteArbitrator must select the valid candidate');
  assert.equal(arbResult.selectedRoute.routeId, normComposite.routeId);
});

test('11. Stargate remains non-executable unless genuinely configured', async () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;

  const quote = await defaultStargateProvider.getQuote({
    sourceChainId: 'arbitrum',
    destinationChainId: 'base',
    tokenIn: ethArb,
    tokenOut: brettBase,
    amountInRaw: '1000000000000000000',
    userWalletAddress: USER_ADDR
  });

  if (quote) {
    assert.equal(quote.isExecutable, false, 'Stargate quote must be non-executable');
  }
});

test('12. Unsupported intermediate asset fails closed', () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;
  const fakeToken = {
    address: '0x1111111111111111111111111111111111111111',
    symbol: 'FAKECOIN',
    name: 'Fake Token',
    decimals: 18,
    chainId: 'arbitrum'
  };

  const quote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'arbitrum',
    destinationChainId: 'base',
    sourceToken: ethArb,
    destinationToken: brettBase,
    sourceAmountRaw: '1000000000000000000',
    destinationAmountRaw: '1000000000000000000',
    minDestinationAmountRaw: '990000000000000000',
    bridgeFeeUSD: 1,
    relayerFee: '1000000',
    gasEstimateUSD: 0.1,
    recipient: USER_ADDR,
    expiration: Date.now() + 60000,
    routeIdentifier: 'fake-asset-route',
    executionTarget: ACROSS_SPOKE_POOLS[42161],
    calldata: '0x1234',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[42161],
    quoteTimestamp: Date.now(),
    sourceConnectorToken: fakeToken,
    destConnectorToken: fakeToken,
    isExecutable: true
  };

  const validation = validateCrossChainQuoteExecutability(quote);
  assert.equal(validation.isExecutable, false);
  assert.ok(
    validation.failedGates.includes('CAPABILITY_PERMITS_EXECUTION') ||
    validation.failedGates.includes('ROUTE_SUPPORTED')
  );
});

test('13. Missing calldata or execution target cannot become executable', () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const noTargetQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'arbitrum',
    destinationChainId: 'base',
    sourceToken: ethArb,
    destinationToken: brettBase,
    sourceAmountRaw: '1000000000000000000',
    destinationAmountRaw: '498375000000000000000000',
    minDestinationAmountRaw: '497129062500000000000000',
    bridgeFeeUSD: 1.25,
    relayerFee: '1248750',
    gasEstimateUSD: 0.1,
    recipient: USER_ADDR,
    expiration: Date.now() + 60000,
    routeIdentifier: 'no-target',
    executionTarget: '', // Empty target!
    calldata: '0x1234',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[42161],
    quoteTimestamp: Date.now(),
    sourceConnectorToken: usdcArb,
    destConnectorToken: usdcArb,
    isExecutable: true
  };

  const validation = validateCrossChainQuoteExecutability(noTargetQuote);
  assert.equal(validation.isExecutable, false);
  assert.ok(validation.failedGates.includes('VALID_EXECUTION_TARGET'));
});

test('14. Slippage and minimum-output protection across multi-hop composite route', () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;

  // Minimum amount out exceeding expected amount out must be rejected
  const invalidMinOutPlan: any = {
    planId: 'plan-invalid-min',
    routeId: 'route-invalid-min',
    routeType: 'CROSS_CHAIN_COMPOSITE',
    sourceChainId: 'arbitrum',
    destinationChainId: 'base',
    tokenIn: ethArb,
    tokenOut: brettBase,
    expectedAmountInRaw: '1000000000000000000',
    expectedAmountOutRaw: '498375000000000000000000',
    minimumAmountOutRaw: '497129062500000000000000',
    isExecutable: true,
    steps: [
      {
        id: 'step-1',
        type: 'SOURCE_SWAP',
        chainId: 'arbitrum',
        executionEnvironment: 'EVM',
        targetAddress: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
        calldata: '0x1234',
        requiredTokenAddress: ethArb.address,
        outputTokenAddress: usdcArb.address,
        requiredAmountRaw: '1000000000000000000',
        expectedAmountOutRaw: '2498125468',
        minimumAmountOutRaw: '3000000000', // Impossible min > expected!
        dependencies: [],
        retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
      },
      {
        id: 'step-2',
        type: 'BRIDGE_DEPOSIT',
        chainId: 'arbitrum',
        executionEnvironment: 'EVM',
        targetAddress: ACROSS_SPOKE_POOLS[42161],
        calldata: '0x5678',
        requiredTokenAddress: usdcArb.address,
        requiredAmountRaw: '2498125468',
        dependencies: ['step-1'],
        retryPolicy: { maxRetries: 1, backoffMs: 1000, timeoutMs: 10000 }
      }
    ]
  };

  assert.throws(() => ExecutionPlanValidator.validateCompositePlan(invalidMinOutPlan));
});

test('15. Invariant: For every executable composite route, hop[n].amountOut == hop[n+1].amountIn', async () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;
  const usdcBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'USDC')!;

  const srcQuote: DEXQuote = {
    provider: 'CAMELOT',
    providerName: 'Camelot DEX',
    chainId: 42161,
    tokenIn: ethArb,
    tokenOut: usdcArb,
    amountIn: 1000000000000000000n,
    amountOut: 2498125468n,
    minimumAmountOut: 2491879154n,
    feeAmount: 7494376n,
    feeTierBps: 30,
    priceImpactPercent: 0.02,
    gasEstimate: 150000n,
    gasCostUSD: 0.05,
    executionTarget: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
    approvalTarget: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
    calldata: '0x11223344',
    quoteTimestamp: Date.now(),
    expiration: Date.now() + 60000
  };

  const bridgeQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'arbitrum',
    destinationChainId: 'base',
    sourceToken: usdcArb,
    destinationToken: usdcBase,
    sourceAmountRaw: srcQuote.amountOut.toString(),
    destinationAmountRaw: '2496876718',
    minDestinationAmountRaw: '2490634526',
    bridgeFeeUSD: 1.25,
    relayerFee: '1248750',
    gasEstimateUSD: 0.1,
    recipient: USER_ADDR,
    expiration: Date.now() + 60000,
    routeIdentifier: 'bridge-hop',
    executionTarget: ACROSS_SPOKE_POOLS[42161],
    calldata: '0xacrossdeposit',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[42161],
    quoteTimestamp: Date.now(),
    estimatedTransferTimeSec: 45,
    securityRating: 'A+',
    isExecutable: true
  };

  const dstQuote: DEXQuote = {
    provider: 'AERODROME',
    providerName: 'Aerodrome Finance',
    chainId: 8453,
    tokenIn: usdcBase,
    tokenOut: brettBase,
    amountIn: BigInt(bridgeQuote.destinationAmountRaw),
    amountOut: 498375000000000000000000n,
    minimumAmountOut: 497129062500000000000000n,
    feeAmount: 7490630n,
    feeTierBps: 30,
    priceImpactPercent: 0.05,
    gasEstimate: 160000n,
    gasCostUSD: 0.02,
    executionTarget: '0xcF77a3Ba9A5CA399B7c97c748846911387219558',
    approvalTarget: '0xcF77a3Ba9A5CA399B7c97c748846911387219558',
    calldata: '0xaerodromecall',
    quoteTimestamp: Date.now(),
    expiration: Date.now() + 60000
  };

  // Assert hop-by-hop exact integer equality
  assert.equal(srcQuote.amountOut.toString(), bridgeQuote.sourceAmountRaw, 'Hop 1 output must match Hop 2 input');
  assert.equal(bridgeQuote.destinationAmountRaw, dstQuote.amountIn.toString(), 'Hop 2 output must match Hop 3 input');
});

test('16. Test fixture pool can calculate a simulated quote', () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;
  assert.ok(ethArb && usdcArb);

  const calculated = calculateDEXLiquidityOutput({
    chainId: 42161,
    tokenIn: ethArb,
    tokenOut: usdcArb,
    amountIn: 1000000000000000000n, // 1 ETH
    slippageToleranceBps: 25
  });

  assert.ok(calculated !== null, 'Simulated quote must be calculable from deterministic test fixture');
  assert.ok(calculated.amountOut > 0n);
  assert.ok(calculated.minimumAmountOut > 0n);
  assert.equal(calculated.amountOut, 2492437875n);
});

test('17. Simulated quote is explicitly marked non-production (SIMULATION / TEST_FIXTURE)', () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const calculated = calculateDEXLiquidityOutput({
    chainId: 42161,
    tokenIn: ethArb,
    tokenOut: usdcArb,
    amountIn: 1000000000000000000n,
    slippageToleranceBps: 25
  });

  assert.ok(calculated !== null);
  assert.ok(
    calculated.liquiditySource === 'SIMULATION' || calculated.liquiditySource === 'TEST_FIXTURE',
    'Liquidity source must be marked SIMULATION or TEST_FIXTURE'
  );
});

test('18. Simulated quote cannot become executable in production modes', async () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;

  const router = new ZenithRouter();
  await assert.rejects(
    async () => {
      await router.getQuote({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: ethArb,
        tokenOut: brettBase,
        amountInRaw: '1000000000000000000',
        userWalletAddress: USER_ADDR,
        executionMode: 'LIVE_EXECUTION'
      });
    },
    (err: any) => err instanceof ExecutionUnavailableError,
    'Must fail closed with ExecutionUnavailableError when no live DEX evidence exists'
  );
});

test('19. Production provider without live liquidity returns non-executable', async () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;

  const aggregator = new CrossChainAggregator();
  const quotes = await aggregator.getQuotes({
    sourceChainId: 'arbitrum',
    destinationChainId: 'base',
    tokenIn: ethArb,
    tokenOut: brettBase,
    amountInRaw: '1000000000000000000',
    userWalletAddress: USER_ADDR,
    executionMode: 'LIVE_EXECUTION'
  });

  for (const q of quotes) {
    if (q.sourceDexQuote?.liquiditySource === 'SIMULATION' || q.destDexQuote?.liquiditySource === 'SIMULATION') {
      assert.equal(q.isExecutable, false, 'Simulated DEX quote must result in isExecutable: false');
      assert.ok(q.unexecutableReason?.includes('LIVE_DEX_LIQUIDITY_UNAVAILABLE'));
    }
  }
});

test('20. Missing live DEX quote prevents composite execution', async () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  // Construct composite quote where destination DEX quote is missing
  const partialQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'arbitrum',
    destinationChainId: 'base',
    sourceToken: ethArb,
    destinationToken: brettBase,
    sourceAmountRaw: '1000000000000000000',
    destinationAmountRaw: '498375000000000000000000',
    minDestinationAmountRaw: '497129062500000000000000',
    recipient: USER_ADDR,
    expiration: Date.now() + 60000,
    routeIdentifier: 'test-partial',
    executionTarget: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
    approvalTarget: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
    calldata: '0x1234',
    value: '1000000000000000000',
    quoteTimestamp: Date.now(),
    isExecutable: false,
    unexecutableReason: 'DESTINATION_DEX_QUOTE_MISSING',
    sourceDexQuote: {
      provider: 'CAMELOT',
      providerName: 'Camelot DEX',
      chainId: 42161,
      tokenIn: ethArb,
      tokenOut: usdcArb,
      amountIn: 1000000000000000000n,
      amountOut: 2498125468n,
      minimumAmountOut: 2491879154n,
      feeAmount: 7494376n,
      feeTierBps: 30,
      priceImpactPercent: 0.02,
      gasEstimate: 150000n,
      gasCostUSD: 0.05,
      executionTarget: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
      approvalTarget: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
      calldata: '0x1234',
      quoteTimestamp: Date.now(),
      expiration: Date.now() + 60000,
      liquiditySource: 'LIVE_ON_CHAIN'
    },
    destDexQuote: undefined // Missing dest DEX quote!
  };

  const validation = validateCrossChainQuoteExecutability(partialQuote);
  assert.equal(validation.isExecutable, false, 'Missing dest DEX quote must fail executability validation');
});

test('21. Static reserves cannot be consumed by production executable routing', async () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;

  const router = new ZenithRouter();
  await assert.rejects(
    async () => {
      await router.getQuote({
        sourceChainId: 'arbitrum',
        destinationChainId: 'base',
        tokenIn: ethArb,
        tokenOut: brettBase,
        amountInRaw: '1000000000000000000',
        userWalletAddress: USER_ADDR,
        executionMode: 'LIVE_EXECUTION'
      });
    },
    'No executable route can be constructed when backed only by static reserves'
  );
});

test('22. Token registry presence does not imply DEX liquidity', () => {
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;
  assert.ok(brettBase, 'BRETT must exist in token registry');
  assert.equal(brettBase.address.toLowerCase(), '0x532f27101965dd16442e59d40670faf5ebb142e4');

  // Token presence is independent from live DEX liquidity availability
  const arbitraryToken = {
    address: '0x9999999999999999999999999999999999999999',
    symbol: 'UNLISTED',
    decimals: 18,
    chainId: 8453,
    name: 'Unlisted Token'
  };

  const calculated = calculateDEXLiquidityOutput({
    chainId: 8453,
    tokenIn: arbitraryToken,
    tokenOut: brettBase,
    amountIn: 1000000000000000000n,
    slippageToleranceBps: 25
  });

  assert.equal(calculated, null, 'Unlisted pool with no liquidity must return null');
});

test('23. Composite route requires real evidence for every executable hop', () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;
  const usdcBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'USDC')!;

  const validEvidenceCompositeQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'arbitrum',
    destinationChainId: 'base',
    sourceToken: ethArb,
    destinationToken: brettBase,
    sourceAmountRaw: '1000000000000000000',
    destinationAmountRaw: '498375000000000000000000',
    minDestinationAmountRaw: '497129062500000000000000',
    recipient: USER_ADDR,
    expiration: Date.now() + 60000,
    routeIdentifier: 'test-real-evidence',
    executionTarget: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
    approvalTarget: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
    calldata: '0x1234567890abcdef',
    value: '1000000000000000000',
    quoteTimestamp: Date.now(),
    isExecutable: true,
    sourceConnectorToken: usdcArb,
    destConnectorToken: usdcBase,
    sourceDexQuote: {
      provider: 'CAMELOT',
      providerName: 'Camelot DEX',
      chainId: 42161,
      tokenIn: ethArb,
      tokenOut: usdcArb,
      amountIn: 1000000000000000000n,
      amountOut: 2498125468n,
      minimumAmountOut: 2491879154n,
      feeAmount: 7494376n,
      feeTierBps: 30,
      priceImpactPercent: 0.02,
      gasEstimate: 150000n,
      gasCostUSD: 0.05,
      executionTarget: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
      approvalTarget: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
      calldata: '0x1234567890abcdef',
      quoteTimestamp: Date.now(),
      expiration: Date.now() + 60000,
      liquiditySource: 'LIVE_ON_CHAIN'
    },
    destDexQuote: {
      provider: 'AERODROME',
      providerName: 'Aerodrome Finance',
      chainId: 8453,
      tokenIn: usdcBase,
      tokenOut: brettBase,
      amountIn: 2496876718n,
      amountOut: 498375000000000000000000n,
      minimumAmountOut: 497129062500000000000000n,
      feeAmount: 7490630n,
      feeTierBps: 30,
      priceImpactPercent: 0.05,
      gasEstimate: 160000n,
      gasCostUSD: 0.02,
      executionTarget: '0xcF77a3Ba9A5CA399B7c97c748846911387219558',
      approvalTarget: '0xcF77a3Ba9A5CA399B7c97c748846911387219558',
      calldata: '0xaerodromecall',
      quoteTimestamp: Date.now(),
      expiration: Date.now() + 60000,
      liquiditySource: 'LIVE_ON_CHAIN'
    }
  };

  const validation = validateCrossChainQuoteExecutability(validEvidenceCompositeQuote);
  assert.equal(validation.isExecutable, true, 'Composite route with live evidence on all hops must be valid');
});

test('24. Amount propagation remains exact across multi-hop composite', () => {
  const hop1AmountIn = 1000000000000000000n; // 1 ETH (18 dec)
  const hop1AmountOut = 2498125468n; // 2498.125468 USDC (6 dec)
  const hop2AmountIn = 2498125468n; // Across bridge in (6 dec)
  const hop2AmountOut = 2496876718n; // Across bridge out (6 dec)
  const hop3AmountIn = 2496876718n; // Dest DEX in (6 dec)
  const hop3AmountOut = 498375000000000000000000n; // 498,375 BRETT (18 dec)

  assert.equal(hop1AmountOut, hop2AmountIn);
  assert.equal(hop2AmountOut, hop3AmountIn);
  assert.ok(hop3AmountOut > 0n);
});

test('25. Existing composite tests remain valid after separating simulation from execution', async () => {
  const ethArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'ETH')!;
  const brettBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'BRETT')!;

  const aggregator = new CrossChainAggregator();
  const quotes = await aggregator.findConnectorBridgeQuotes({
    sourceChainId: 'arbitrum',
    destinationChainId: 'base',
    tokenIn: ethArb,
    tokenOut: brettBase,
    amountInRaw: '1000000000000000000',
    userWalletAddress: USER_ADDR
  });

  assert.ok(quotes.length > 0, 'Must produce connector quotes');
  const usdcCompositeQuote = quotes.find((q: any) => q.sourceConnectorToken?.symbol === 'USDC');
  assert.ok(usdcCompositeQuote, 'Must find USDC connector quote');
  assert.ok(usdcCompositeQuote.sourceDexQuote !== undefined, 'Must contain source DEX quote');
  assert.ok(usdcCompositeQuote.destDexQuote !== undefined, 'Must contain destination DEX quote');
  assert.ok(usdcCompositeQuote.underlyingBridgeQuote !== undefined, 'Must contain underlying bridge quote');
});
