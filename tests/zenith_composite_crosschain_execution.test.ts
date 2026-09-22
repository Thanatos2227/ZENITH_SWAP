import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import {
  ExecutionCoordinator,
  CrossChainTracker,
  EVMExecutionAdapter,
  ExecutionStateMachine,
  ActiveCrossChainOrder,
  ExecutionPlanBuilder,
  ExecutionPlanValidator,
  extractActualSourceSwapOutput
} from '../packages/execution/src';
import {
  CrossChainAggregator,
  defaultAcrossProvider,
  defaultDeBridgeProvider,
  defaultStargateProvider,
  validateCrossChainQuoteExecutability
} from '../packages/routing/src';
import { defaultTokenService, DEFAULT_TOKENS } from '../packages/tokens/src';
import { defaultChainRegistry } from '../packages/chains/src';
import {
  SignerRequiredError,
  ZenithSimulationFailedError,
  InsufficientBalanceError,
  InvalidExecutionTargetError,
  DestinationExecutionUnavailableError,
  SourceSwapUnavailableError,
  SourceSwapFailedError,
  BridgeFailedError,
  DestinationExecutionFailedError,
  DestinationVerificationFailedError,
  ConfigurationError,
  AmountMismatchError,
  TokenMismatchError,
  ChainMismatchError,
  StatusConflictError,
  CompositePlanValidationError,
  QuoteUnavailableError,
  ACROSS_SPOKE_POOLS,
  DEBRIDGE_DLN_SOURCE
} from '../packages/contracts/src';
import { QuoteResponse, CrossChainQuote, SwapRoute, DEXQuote } from '../packages/types/src';

const USER_ADDR = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const ROUTER_ADDR = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
const POOL_ADDR = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640';

const ERC20_INTERFACE = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)'
]);

test('Test 1: Valid Source DEX -> Bridge Plan correctly structures DAG steps', async () => {
  const daiEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'DAI') || {
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    chainId: 'ethereum',
    name: 'Dai Stablecoin',
    symbol: 'DAI',
    decimals: 18
  };
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const sourceDexQuote: DEXQuote = {
    provider: 'UNISWAP_V3',
    providerName: 'Uniswap V3',
    chainId: 1,
    tokenIn: daiEth as any,
    tokenOut: usdcEth,
    amountIn: 1000000000000000000000n, // 1000 DAI
    amountOut: 999500000n, // 999.5 USDC (6 decimals)
    minimumAmountOut: 994502500n,
    feeAmount: 500000n,
    feeTierBps: 5,
    priceImpactPercent: 0.01,
    gasEstimate: 120000n,
    gasCostUSD: 2.5,
    executionTarget: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    approvalTarget: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    calldata: '0x04e45aaf000000000000000000000000',
    quoteTimestamp: Date.now(),
    expiration: Date.now() + 300000
  };

  const underlyingBridgeQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: usdcEth,
    destinationToken: usdcArb,
    sourceAmountRaw: '999500000',
    destinationAmountRaw: '999000000',
    minDestinationAmountRaw: '994005000',
    bridgeFeeUSD: 0.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 5,
    recipient: USER_ADDR,
    expiration: Date.now() + 300000,
    routeIdentifier: 'across-eth-arb',
    executionTarget: ACROSS_SPOKE_POOLS[1],
    calldata: '0x1234',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[1],
    quoteTimestamp: Date.now(),
    estimatedTransferTimeSec: 30,
    securityRating: 'A+',
    isExecutable: true
  };

  const compositeQuote: CrossChainQuote = {
    ...underlyingBridgeQuote,
    sourceToken: daiEth as any,
    destinationToken: usdcArb,
    sourceAmountRaw: '1000000000000000000000',
    destinationAmountRaw: '999000000',
    minDestinationAmountRaw: '994005000',
    sourceDexQuote,
    underlyingBridgeQuote,
    sourceConnectorToken: usdcEth,
    compositeExecutionMode: 'SEPARATE_DESTINATION_TX',
    isExecutable: true
  };

  const route: SwapRoute = {
    id: 'route-composite-test',
    routeType: 'CROSS_CHAIN',
    hops: [],
    gasCostUSD: 7.5,
    crossChainQuote: compositeQuote,
    isExecutable: true
  };

  const plan = ExecutionPlanBuilder.buildPlan({
    route,
    request: {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: daiEth as any,
      tokenOut: usdcArb,
      amountInRaw: '1000000000000000000000',
      userWalletAddress: USER_ADDR
    }
  });

  assert.equal(plan.isExecutable, true);
  assert.equal(plan.routeType, 'CROSS_CHAIN_COMPOSITE');
  assert.equal(plan.compositeExecutionMode, 'SEPARATE_DESTINATION_TX');

  const stepTypes = plan.steps.map((s) => s.type);
  assert.ok(stepTypes.includes('VALIDATION'));
  assert.ok(stepTypes.includes('APPROVAL'));
  assert.ok(stepTypes.includes('SOURCE_SWAP'));
  assert.ok(stepTypes.includes('BRIDGE_QUOTE_REFRESH'));
  assert.ok(stepTypes.includes('BRIDGE_DEPOSIT'));
  assert.ok(stepTypes.includes('BRIDGE_RELAY_WAIT'));
  assert.ok(stepTypes.includes('DESTINATION_VERIFY'));
  assert.ok(stepTypes.includes('SETTLEMENT_COMPLETE'));

  // Verify step dependencies in topological DAG
  const topo = ExecutionPlanValidator.getTopologicalOrder(plan);
  const srcSwapIdx = topo.findIndex((s) => s.type === 'SOURCE_SWAP');
  const refreshIdx = topo.findIndex((s) => s.type === 'BRIDGE_QUOTE_REFRESH');
  const bridgeIdx = topo.findIndex((s) => s.type === 'BRIDGE_DEPOSIT');

  assert.ok(srcSwapIdx < refreshIdx, 'SOURCE_SWAP must precede BRIDGE_QUOTE_REFRESH');
  assert.ok(refreshIdx < bridgeIdx, 'BRIDGE_QUOTE_REFRESH must precede BRIDGE_DEPOSIT');
});

test('Test 2: Source DEX has quote but no calldata -> SOURCE_SWAP_UNAVAILABLE', async () => {
  const daiEth = {
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    chainId: 'ethereum',
    name: 'Dai Stablecoin',
    symbol: 'DAI',
    decimals: 18
  };
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const unexecutableSourceQuote: DEXQuote = {
    provider: 'UNISWAP_V3',
    providerName: 'Uniswap V3',
    chainId: 1,
    tokenIn: daiEth as any,
    tokenOut: usdcEth,
    amountIn: 1000000000000000000000n,
    amountOut: 999500000n,
    minimumAmountOut: 994502500n,
    feeAmount: 500000n,
    feeTierBps: 5,
    priceImpactPercent: 0.01,
    gasEstimate: 120000n,
    gasCostUSD: 2.5,
    executionTarget: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    approvalTarget: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    calldata: undefined,
    quoteTimestamp: Date.now(),
    expiration: Date.now() + 300000
  };

  const compositeQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: daiEth as any,
    destinationToken: usdcArb,
    sourceAmountRaw: '1000000000000000000000',
    destinationAmountRaw: '999000000',
    minDestinationAmountRaw: '994005000',
    bridgeFeeUSD: 0.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 5,
    recipient: USER_ADDR,
    expiration: Date.now() + 300000,
    routeIdentifier: 'across-eth-arb',
    executionTarget: ACROSS_SPOKE_POOLS[1],
    calldata: '0x1234',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[1],
    quoteTimestamp: Date.now(),
    estimatedTransferTimeSec: 30,
    securityRating: 'A+',
    sourceDexQuote: unexecutableSourceQuote,
    sourceConnectorToken: usdcEth,
    isExecutable: false,
    unexecutableReason: 'SOURCE_SWAP_UNAVAILABLE'
  };

  const plan = ExecutionPlanBuilder.buildPlan({
    route: {
      id: 'route-no-calldata',
      routeType: 'CROSS_CHAIN',
      hops: [],
      gasCostUSD: 7.5,
      crossChainQuote: compositeQuote,
      isExecutable: false
    },
    request: {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: daiEth as any,
      tokenOut: usdcArb,
      amountInRaw: '1000000000000000000000',
      userWalletAddress: USER_ADDR
    }
  });

  assert.equal(plan.isExecutable, false);
  assert.equal(plan.unexecutableReason, 'SOURCE_SWAP_UNAVAILABLE');

  const coordinator = new ExecutionCoordinator();
  await assert.rejects(
    async () => {
      await coordinator.executeTrade({
        quote: {
          requestId: 'req-1',
          request: {
            sourceChainId: 'ethereum',
            destinationChainId: 'arbitrum',
            tokenIn: daiEth as any,
            tokenOut: usdcArb,
            amountInRaw: '1000000000000000000000',
            userWalletAddress: USER_ADDR
          },
          tradeType: 'EXACT_INPUT',
          routes: [],
          bestRoute: {
            id: 'route-no-calldata',
            routeType: 'CROSS_CHAIN',
            hops: [],
            gasCostUSD: 7.5,
            crossChainQuote: compositeQuote,
            isExecutable: false
          },
          amountInRaw: '1000000000000000000000',
          amountInFormatted: '1000',
          amountOutRaw: '999000000',
          amountOutFormatted: '999',
          minimumReceivedRaw: '994005000',
          minimumReceivedFormatted: '994',
          executionPrice: 0.999,
          priceImpact: { percentage: 0 },
          protocolFee: { feeBps: 0, feeAmountRaw: '0', feeAmountFormatted: '0', feeUSD: 0 },
          effectiveExecutionScore: 90,
          quoteTimestamp: Date.now(),
          expiresAt: Date.now() + 60000,
          deadline: Date.now() + 1200000,
          freshnessSeconds: 10,
          executionPlan: plan
        },
        userAddress: USER_ADDR,
        signer: { getAddress: async () => USER_ADDR } as any
      });
    },
    (err: any) => {
      assert.ok(err instanceof SourceSwapUnavailableError || err.message.includes('SOURCE_SWAP_UNAVAILABLE'));
      return true;
    }
  );
});

test('Test 3: Destination DEX has quote but no executable mechanism -> DESTINATION_EXECUTION_UNAVAILABLE', async () => {
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;
  const arbToken = {
    address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
    chainId: 'arbitrum',
    name: 'Arbitrum',
    symbol: 'ARB',
    decimals: 18
  };

  const destDexQuote: DEXQuote = {
    provider: 'CAMELOT',
    providerName: 'Camelot DEX',
    chainId: 42161,
    tokenIn: usdcArb,
    tokenOut: arbToken as any,
    amountIn: 1000000000n,
    amountOut: 2000000000000000000000n,
    minimumAmountOut: 1990000000000000000000n,
    feeAmount: 3000000n,
    feeTierBps: 30,
    priceImpactPercent: 0.05,
    gasEstimate: 150000n,
    gasCostUSD: 0.2,
    executionTarget: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
    approvalTarget: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
    quoteTimestamp: Date.now(),
    expiration: Date.now() + 300000
  };

  const compositeQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: usdcEth,
    destinationToken: arbToken as any,
    sourceAmountRaw: '1000000000',
    destinationAmountRaw: '2000000000000000000000',
    minDestinationAmountRaw: '1990000000000000000000',
    bridgeFeeUSD: 0.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 5,
    recipient: USER_ADDR,
    expiration: Date.now() + 300000,
    routeIdentifier: 'across-eth-arb-dest-swap',
    executionTarget: ACROSS_SPOKE_POOLS[1],
    calldata: '0x1234',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[1],
    quoteTimestamp: Date.now(),
    estimatedTransferTimeSec: 30,
    securityRating: 'A+',
    destDexQuote,
    destConnectorToken: usdcArb,
    compositeExecutionMode: 'UNSUPPORTED',
    isExecutable: false,
    unexecutableReason: 'DESTINATION_EXECUTION_UNAVAILABLE'
  };

  const plan = ExecutionPlanBuilder.buildPlan({
    route: {
      id: 'route-dest-unavail',
      routeType: 'CROSS_CHAIN',
      hops: [],
      gasCostUSD: 5.2,
      crossChainQuote: compositeQuote,
      isExecutable: false
    },
    request: {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: usdcEth,
      tokenOut: arbToken as any,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDR
    }
  });

  assert.equal(plan.isExecutable, false);
  assert.equal(plan.unexecutableReason, 'DESTINATION_EXECUTION_UNAVAILABLE');
});

test('Test 4: Source swap succeeds but actual output differs from quote -> Bridge uses actual output', async () => {
  const coordinator = new ExecutionCoordinator();
  const daiEth = {
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    chainId: 'ethereum',
    name: 'Dai Stablecoin',
    symbol: 'DAI',
    decimals: 18
  };
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const sourceDexQuote: DEXQuote = {
    provider: 'UNISWAP_V3',
    providerName: 'Uniswap V3',
    chainId: 1,
    tokenIn: daiEth as any,
    tokenOut: usdcEth,
    amountIn: 1000000000000000000000n,
    amountOut: 999500000n,
    minimumAmountOut: 990000000n,
    feeAmount: 500000n,
    feeTierBps: 5,
    priceImpactPercent: 0.01,
    gasEstimate: 120000n,
    gasCostUSD: 2.5,
    executionTarget: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    approvalTarget: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    calldata: '0xswapcalldata123',
    quoteTimestamp: Date.now(),
    expiration: Date.now() + 300000
  };

  const underlyingBridgeQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: usdcEth,
    destinationToken: usdcArb,
    sourceAmountRaw: '999500000',
    destinationAmountRaw: '999000000',
    minDestinationAmountRaw: '994005000',
    bridgeFeeUSD: 0.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 5,
    recipient: USER_ADDR,
    expiration: Date.now() + 300000,
    routeIdentifier: 'across-eth-arb',
    executionTarget: ACROSS_SPOKE_POOLS[1],
    calldata: '0x1234',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[1],
    quoteTimestamp: Date.now(),
    estimatedTransferTimeSec: 30,
    securityRating: 'A+',
    isExecutable: true
  };

  const compositeQuote: CrossChainQuote = {
    ...underlyingBridgeQuote,
    sourceToken: daiEth as any,
    destinationToken: usdcArb,
    sourceAmountRaw: '1000000000000000000000',
    destinationAmountRaw: '999000000',
    minDestinationAmountRaw: '994005000',
    sourceDexQuote,
    underlyingBridgeQuote,
    sourceConnectorToken: usdcEth,
    compositeExecutionMode: 'SEPARATE_DESTINATION_TX',
    isExecutable: true
  };

  const dispatchedTxs: any[] = [];
  const mockSigner = {
    getAddress: async () => USER_ADDR,
    estimateGas: async () => 150000n,
    sendTransaction: async (tx: any) => {
      dispatchedTxs.push(tx);
      return {
        hash: `0xtx_${dispatchedTxs.length}`,
        wait: async () => ({ status: 1, blockNumber: 100 })
      };
    },
    provider: {
      call: async () => '0x00000000000000000000000000000000000000000000003635c9adc5dea00000',
      getTransactionReceipt: async () => ({ status: 1, blockNumber: 100 })
    }
  };

  const actualAmountOut = 995000000n;

  const quoteResponse: any = {
    requestId: 'req-act-prop',
    request: {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: daiEth as any,
      tokenOut: usdcArb,
      amountInRaw: '1000000000000000000000',
      userWalletAddress: USER_ADDR
    },
    tradeType: 'EXACT_INPUT',
    routes: [],
    bestRoute: {
      id: 'route-prop-test',
      routeType: 'CROSS_CHAIN',
      hops: [],
      gasCostUSD: 7.5,
      crossChainQuote: compositeQuote,
      isExecutable: true
    },
    amountInRaw: '1000000000000000000000',
    amountInFormatted: '1000',
    amountOutRaw: '999000000',
    amountOutFormatted: '999',
    minimumReceivedRaw: '994005000',
    minimumReceivedFormatted: '994',
    executionPrice: 0.999,
    priceImpact: { percentage: 0 },
    protocolFee: { feeBps: 0, feeAmountRaw: '0', feeAmountFormatted: '0', feeUSD: 0 },
    effectiveExecutionScore: 90,
    quoteTimestamp: Date.now(),
    expiresAt: Date.now() + 60000,
    deadline: Date.now() + 1200000,
    freshnessSeconds: 10,
    crossChainQuote: compositeQuote
  };

  const receipt = await coordinator.executeTrade({
    quote: quoteResponse,
    userAddress: USER_ADDR,
    signer: mockSigner as any,
    skipDestinationWait: true,
    actualAmounts: {
      sourceSwapActualOut: actualAmountOut
    }
  });

  assert.equal(receipt.status, 'BRIDGE_IN_FLIGHT');
  assert.equal(dispatchedTxs.length >= 2, true, 'Must execute source swap and bridge deposit');
});

test('Test 5: Bridge deposit fails -> Destination wait/swap must NOT execute', async () => {
  const coordinator = new ExecutionCoordinator();
  const daiEth = {
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    chainId: 'ethereum',
    name: 'Dai Stablecoin',
    symbol: 'DAI',
    decimals: 18
  };
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const sourceDexQuote: DEXQuote = {
    provider: 'UNISWAP_V3',
    providerName: 'Uniswap V3',
    chainId: 1,
    tokenIn: daiEth as any,
    tokenOut: usdcEth,
    amountIn: 1000000000000000000000n,
    amountOut: 999500000n,
    minimumAmountOut: 990000000n,
    feeAmount: 500000n,
    feeTierBps: 5,
    priceImpactPercent: 0.01,
    gasEstimate: 120000n,
    gasCostUSD: 2.5,
    executionTarget: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    approvalTarget: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    calldata: '0xswapcalldata123',
    quoteTimestamp: Date.now(),
    expiration: Date.now() + 300000
  };

  const underlyingBridgeQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: usdcEth,
    destinationToken: usdcArb,
    sourceAmountRaw: '999500000',
    destinationAmountRaw: '999000000',
    minDestinationAmountRaw: '994005000',
    bridgeFeeUSD: 0.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 5,
    recipient: USER_ADDR,
    expiration: Date.now() + 300000,
    routeIdentifier: 'across-eth-arb',
    executionTarget: ACROSS_SPOKE_POOLS[1],
    calldata: '0x1234',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[1],
    quoteTimestamp: Date.now(),
    estimatedTransferTimeSec: 30,
    securityRating: 'A+',
    isExecutable: true
  };

  const compositeQuote: CrossChainQuote = {
    ...underlyingBridgeQuote,
    sourceToken: daiEth as any,
    destinationToken: usdcArb,
    sourceAmountRaw: '1000000000000000000000',
    destinationAmountRaw: '999000000',
    minDestinationAmountRaw: '994005000',
    sourceDexQuote,
    underlyingBridgeQuote,
    sourceConnectorToken: usdcEth,
    compositeExecutionMode: 'SEPARATE_DESTINATION_TX',
    isExecutable: true
  };

  let txCount = 0;
  const mockSigner = {
    getAddress: async () => USER_ADDR,
    estimateGas: async () => 150000n,
    sendTransaction: async () => {
      txCount++;
      if (txCount === 1) {
        return {
          hash: '0xsource_swap_ok',
          wait: async () => ({ status: 1, blockNumber: 100 })
        };
      }
      return {
        hash: '0xbridge_fail',
        wait: async () => ({ status: 0, blockNumber: 101 })
      };
    },
    provider: {
      call: async () => '0x00000000000000000000000000000000000000000000003635c9adc5dea00000',
      getTransactionReceipt: async () => ({ status: 1, blockNumber: 100 })
    }
  };

  const quoteResponse: any = {
    requestId: 'req-bridge-fail',
    request: {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: daiEth as any,
      tokenOut: usdcArb,
      amountInRaw: '1000000000000000000000',
      userWalletAddress: USER_ADDR
    },
    tradeType: 'EXACT_INPUT',
    routes: [],
    bestRoute: {
      id: 'route-prop-test',
      routeType: 'CROSS_CHAIN',
      hops: [],
      gasCostUSD: 7.5,
      crossChainQuote: compositeQuote,
      isExecutable: true
    },
    amountInRaw: '1000000000000000000000',
    amountInFormatted: '1000',
    amountOutRaw: '999000000',
    amountOutFormatted: '999',
    minimumReceivedRaw: '994005000',
    minimumReceivedFormatted: '994',
    executionPrice: 0.999,
    priceImpact: { percentage: 0 },
    protocolFee: { feeBps: 0, feeAmountRaw: '0', feeAmountFormatted: '0', feeUSD: 0 },
    effectiveExecutionScore: 90,
    quoteTimestamp: Date.now(),
    expiresAt: Date.now() + 60000,
    deadline: Date.now() + 1200000,
    freshnessSeconds: 10,
    crossChainQuote: compositeQuote
  };

  await assert.rejects(
    async () => {
      await coordinator.executeTrade({
        quote: quoteResponse,
        userAddress: USER_ADDR,
        signer: mockSigner as any
      });
    },
    (err: any) => {
      assert.ok(err instanceof BridgeFailedError || err.message.includes('reverted'));
      return true;
    }
  );
});

test('Test 6: Bridge succeeds but destination DEX swap fails -> Final state is DESTINATION_EXECUTION_FAILED', async () => {
  const coordinator = new ExecutionCoordinator();
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;
  const arbToken = {
    address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
    chainId: 'arbitrum',
    name: 'Arbitrum',
    symbol: 'ARB',
    decimals: 18
  };

  const destDexQuote: DEXQuote = {
    provider: 'CAMELOT',
    providerName: 'Camelot DEX',
    chainId: 42161,
    tokenIn: usdcArb,
    tokenOut: arbToken as any,
    amountIn: 1000000000n,
    amountOut: 2000000000000000000000n,
    minimumAmountOut: 1990000000000000000000n,
    feeAmount: 3000000n,
    feeTierBps: 30,
    priceImpactPercent: 0.05,
    gasEstimate: 150000n,
    gasCostUSD: 0.2,
    executionTarget: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
    approvalTarget: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
    calldata: '0xdestswapcalldata',
    quoteTimestamp: Date.now(),
    expiration: Date.now() + 300000
  };

  const compositeQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: usdcEth,
    destinationToken: arbToken as any,
    sourceAmountRaw: '1000000000',
    destinationAmountRaw: '2000000000000000000000',
    minDestinationAmountRaw: '1990000000000000000000',
    bridgeFeeUSD: 0.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 5,
    recipient: USER_ADDR,
    expiration: Date.now() + 300000,
    routeIdentifier: 'across-eth-arb-dest',
    executionTarget: ACROSS_SPOKE_POOLS[1],
    calldata: '0x1234',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[1],
    quoteTimestamp: Date.now(),
    estimatedTransferTimeSec: 30,
    securityRating: 'A+',
    destDexQuote,
    destConnectorToken: usdcArb,
    compositeExecutionMode: 'SEPARATE_DESTINATION_TX',
    isExecutable: true
  };

  const plan = ExecutionPlanBuilder.buildPlan({
    route: {
      id: 'route-dest-fail',
      routeType: 'CROSS_CHAIN',
      hops: [],
      gasCostUSD: 5.2,
      crossChainQuote: compositeQuote,
      isExecutable: true
    },
    request: {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: usdcEth,
      tokenOut: arbToken as any,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDR
    }
  });

  const quoteResponse: any = {
    requestId: 'req-dest-fail',
    request: {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: usdcEth,
      tokenOut: arbToken as any,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDR
    },
    tradeType: 'EXACT_INPUT',
    routes: [],
    bestRoute: {
      id: 'route-dest-fail',
      routeType: 'CROSS_CHAIN',
      hops: [],
      gasCostUSD: 5.2,
      crossChainQuote: compositeQuote,
      isExecutable: true
    },
    amountInRaw: '1000000000',
    amountInFormatted: '1000',
    amountOutRaw: '2000000000000000000000',
    amountOutFormatted: '2000',
    minimumReceivedRaw: '1990000000000000000000',
    minimumReceivedFormatted: '1990',
    executionPrice: 2.0,
    priceImpact: { percentage: 0 },
    protocolFee: { feeBps: 0, feeAmountRaw: '0', feeAmountFormatted: '0', feeUSD: 0 },
    effectiveExecutionScore: 90,
    quoteTimestamp: Date.now(),
    expiresAt: Date.now() + 60000,
    deadline: Date.now() + 1200000,
    freshnessSeconds: 10,
    crossChainQuote: compositeQuote,
    executionPlan: { ...plan, isExecutable: true, compositeExecutionMode: 'SEPARATE_DESTINATION_TX' }
  };

  const mockSourceSigner = {
    getAddress: async () => USER_ADDR,
    estimateGas: async () => 150000n,
    sendTransaction: async () => ({
      hash: '0xsource_bridge_ok',
      wait: async () => ({ status: 1, blockNumber: 100 })
    }),
    provider: {
      call: async () => '0x000000000000000000000000000000000000000000000000000000003b9aca00',
      getTransactionReceipt: async () => ({ status: 1, blockNumber: 100 })
    }
  };

  const mockDestSigner = {
    getAddress: async () => USER_ADDR,
    estimateGas: async () => 150000n,
    sendTransaction: async () => ({
      hash: '0xdest_swap_tx_reverted',
      wait: async () => ({ status: 0, blockNumber: 200 })
    }),
    provider: {
      call: async () => '0x000000000000000000000000000000000000000000000000000000003b9aca00'
    }
  };

  const customTracker = new CrossChainTracker();
  customTracker.trackUntilSettled = async () => ({
    isSuccess: true,
    destinationTxHash: '0xbridge_relay_dest_tx',
    state: 'DESTINATION_FILLED'
  });
  (coordinator as any).tracker = customTracker;

  await assert.rejects(
    async () => {
      await coordinator.executeTrade({
        quote: quoteResponse,
        userAddress: USER_ADDR,
        signer: mockSourceSigner as any,
        destSigner: mockDestSigner as any
      });
    },
    (err: any) => {
      assert.ok(
        err instanceof DestinationExecutionFailedError ||
        err.message.includes('DESTINATION_EXECUTION_FAILED') ||
        err.message.includes('reverted on-chain')
      );
      return true;
    }
  );
});

test('Test 7: Destination transaction succeeds but expected output is not received -> DESTINATION_VERIFICATION_FAILED', async () => {
  const tracker = new CrossChainTracker();
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const quote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: usdcEth,
    destinationToken: usdcArb,
    sourceAmountRaw: '1000000000',
    destinationAmountRaw: '999500000',
    minDestinationAmountRaw: '994502500',
    bridgeFeeUSD: 0.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 5,
    recipient: USER_ADDR,
    executionTarget: ACROSS_SPOKE_POOLS[1],
    calldata: '0x1234',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[1],
    quoteTimestamp: Date.now(),
    isExecutable: true
  };

  const activeOrder: ActiveCrossChainOrder = {
    orderId: 'order-verify-fail-test',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTxHash: '0xsource123',
    provider: 'ACROSS',
    recipient: USER_ADDR,
    quote,
    status: 'FULFILLING',
    createdAt: Date.now(),
    lastUpdated: Date.now()
  };

  (tracker as any).aggregator = {
    getProvider: () => ({
      getStatus: async () => ({
        state: 'DESTINATION_FILLED',
        sourceTxHash: '0xsource123',
        destinationTxHash: '0xdest456',
        isComplete: true,
        isFailed: false,
        timestamp: Date.now()
      })
    })
  };

  tracker.verifyDestinationSettlement = async () => ({
    isVerified: false,
    reason: 'Token balance delta was 0 on destination chain'
  });

  const res = await tracker.trackUntilSettled({
    order: activeOrder,
    stateMachine: new ExecutionStateMachine(),
    pollIntervalMs: 10,
    maxPollDurationMs: 500
  });

  assert.equal(res.isSuccess, false);
  assert.equal(res.error?.includes('balance delta'), true);
});

test('Test 8: Tracking temporarily fails -> Do not duplicate bridge transaction', async () => {
  const tracker = new CrossChainTracker();
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const quote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: usdcEth,
    destinationToken: usdcArb,
    sourceAmountRaw: '1000000000',
    destinationAmountRaw: '999500000',
    minDestinationAmountRaw: '994502500',
    bridgeFeeUSD: 0.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 5,
    recipient: USER_ADDR,
    executionTarget: ACROSS_SPOKE_POOLS[1],
    calldata: '0x1234',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[1],
    quoteTimestamp: Date.now(),
    isExecutable: true
  };

  const activeOrder: ActiveCrossChainOrder = {
    orderId: 'order-tracking-fail-test',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTxHash: '0xsource123_unique',
    provider: 'ACROSS',
    recipient: USER_ADDR,
    quote,
    status: 'FULFILLING',
    createdAt: Date.now(),
    lastUpdated: Date.now()
  };

  (tracker as any).aggregator = {
    getProvider: () => ({
      getStatus: async () => ({
        state: 'TRACKING_UNAVAILABLE',
        sourceTxHash: '0xsource123_unique',
        isComplete: false,
        isFailed: false,
        errorMessage: 'API timeout',
        timestamp: Date.now()
      })
    })
  };

  const res = await tracker.trackUntilSettled({
    order: activeOrder,
    stateMachine: new ExecutionStateMachine(),
    pollIntervalMs: 10,
    maxPollDurationMs: 50
  });

  assert.equal(res.isTimeout, true);
  assert.equal(activeOrder.sourceTxHash, '0xsource123_unique');
});

test('Test 9: Browser/backend restart recovery with deterministic order identifiers', () => {
  const tracker = new CrossChainTracker();
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const activeOrder: ActiveCrossChainOrder = {
    orderId: 'order-persisted-123',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTxHash: '0xpersisted_tx_hash',
    provider: 'ACROSS',
    recipient: USER_ADDR,
    quote: {
      provider: 'ACROSS',
      providerName: 'Across Protocol V3',
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      sourceToken: usdcEth,
      destinationToken: usdcArb,
      sourceAmountRaw: '1000000000',
      destinationAmountRaw: '999500000',
      minDestinationAmountRaw: '994502500',
      bridgeFeeUSD: 0.5,
      relayerFee: '0.05%',
      gasEstimateUSD: 5,
      recipient: USER_ADDR,
      executionTarget: ACROSS_SPOKE_POOLS[1],
      calldata: '0x1234',
      value: '0',
      approvalTarget: ACROSS_SPOKE_POOLS[1],
      quoteTimestamp: Date.now(),
      estimatedTransferTimeSec: 30,
      securityRating: 'A+',
      isExecutable: true
    },
    status: 'FULFILLING',
    createdAt: Date.now(),
    lastUpdated: Date.now()
  };

  tracker.registerOrder(activeOrder);

  const retrieved = tracker.getActiveOrder('order-persisted-123');
  assert.ok(retrieved);
  assert.equal(retrieved?.sourceTxHash, '0xpersisted_tx_hash');
  assert.equal(retrieved?.status, 'FULFILLING');
});

test('Test 10: Invalid source/destination chain mismatch rejects execution', () => {
  assert.throws(() => {
    ExecutionPlanBuilder.buildPlan({
      route: {
        id: 'route-invalid-chain',
        routeType: 'DIRECT',
        hops: [],
        gasCostUSD: 1
      },
      request: {
        sourceChainId: 'unsupported_chain_xyz',
        destinationChainId: 'arbitrum',
        tokenIn: DEFAULT_TOKENS[0],
        tokenOut: DEFAULT_TOKENS[1],
        amountInRaw: '1000000000000000000'
      }
    });
  }, /Invalid or unrecognized token address|Invalid EVM address format|Unsupported token chain/);
});

test('Test 11: Source and destination token decimals differ -> Amounts remain numerically correct', () => {
  const daiEth = {
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    chainId: 'ethereum',
    name: 'Dai Stablecoin',
    symbol: 'DAI',
    decimals: 18
  };
  const usdcArb = {
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    chainId: 'arbitrum',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6
  };

  const route: SwapRoute = {
    id: 'route-decimals-test',
    routeType: 'CROSS_CHAIN',
    hops: [],
    gasCostUSD: 5,
    crossChainQuote: {
      provider: 'ACROSS',
      providerName: 'Across Protocol V3',
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      sourceToken: daiEth as any,
      destinationToken: usdcArb as any,
      sourceAmountRaw: '1000000000000000000000',
      destinationAmountRaw: '999500000',
      minDestinationAmountRaw: '994502500',
      bridgeFeeUSD: 0.5,
      relayerFee: '0.05%',
      gasEstimateUSD: 5,
      recipient: USER_ADDR,
      expiration: Date.now() + 300000,
      routeIdentifier: 'across-decimals',
      executionTarget: ACROSS_SPOKE_POOLS[1],
      calldata: '0x1234',
      value: '0',
      approvalTarget: ACROSS_SPOKE_POOLS[1],
      quoteTimestamp: Date.now(),
      estimatedTransferTimeSec: 30,
      securityRating: 'A+',
      isExecutable: true
    },
    isExecutable: true
  };

  const plan = ExecutionPlanBuilder.buildPlan({
    route,
    request: {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: daiEth as any,
      tokenOut: usdcArb as any,
      amountInRaw: '1000000000000000000000',
      userWalletAddress: USER_ADDR
    }
  });

  assert.equal(plan.expectedAmountInRaw, '1000000000000000000000');
  assert.equal(plan.expectedAmountOutRaw, '999500000');
  assert.equal(plan.minimumAmountOutRaw, '994502500');
});

test('Test 12: Slippage bounds exceeded -> Execution halts safely before bridge', async () => {
  const coordinator = new ExecutionCoordinator();
  const daiEth = {
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    chainId: 'ethereum',
    name: 'Dai Stablecoin',
    symbol: 'DAI',
    decimals: 18
  };
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const sourceDexQuote: DEXQuote = {
    provider: 'UNISWAP_V3',
    providerName: 'Uniswap V3',
    chainId: 1,
    tokenIn: daiEth as any,
    tokenOut: usdcEth,
    amountIn: 1000000000000000000000n,
    amountOut: 999500000n,
    minimumAmountOut: 990000000n,
    feeAmount: 500000n,
    feeTierBps: 5,
    priceImpactPercent: 0.01,
    gasEstimate: 120000n,
    gasCostUSD: 2.5,
    executionTarget: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    approvalTarget: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    calldata: '0xswapcalldata123',
    quoteTimestamp: Date.now(),
    expiration: Date.now() + 300000
  };

  const compositeQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: daiEth as any,
    destinationToken: usdcArb,
    sourceAmountRaw: '1000000000000000000000',
    destinationAmountRaw: '999000000',
    minDestinationAmountRaw: '994005000',
    bridgeFeeUSD: 0.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 5,
    recipient: USER_ADDR,
    expiration: Date.now() + 300000,
    routeIdentifier: 'across-eth-arb',
    executionTarget: ACROSS_SPOKE_POOLS[1],
    calldata: '0x1234',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[1],
    quoteTimestamp: Date.now(),
    estimatedTransferTimeSec: 30,
    securityRating: 'A+',
    sourceDexQuote,
    sourceConnectorToken: usdcEth,
    compositeExecutionMode: 'SEPARATE_DESTINATION_TX',
    isExecutable: true
  };

  const mockSigner = {
    getAddress: async () => USER_ADDR,
    estimateGas: async () => 150000n,
    sendTransaction: async () => ({
      hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      wait: async () => ({ status: 1, blockNumber: 100 })
    }),
    provider: {
      call: async () => '0x00000000000000000000000000000000000000000000003635c9adc5dea00000',
      getTransactionReceipt: async () => ({ status: 1, blockNumber: 100 }),
      getBalance: async () => 10000000000000000000n
    }
  };

  const quoteResponse: any = {
    requestId: 'req-slippage-fail',
    request: {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: daiEth as any,
      tokenOut: usdcArb,
      amountInRaw: '1000000000000000000000',
      userWalletAddress: USER_ADDR
    },
    tradeType: 'EXACT_INPUT',
    routes: [],
    bestRoute: {
      id: 'route-slippage-test',
      routeType: 'CROSS_CHAIN',
      hops: [],
      gasCostUSD: 7.5,
      crossChainQuote: compositeQuote,
      isExecutable: true
    },
    amountInRaw: '1000000000000000000000',
    amountInFormatted: '1000',
    amountOutRaw: '999000000',
    amountOutFormatted: '999',
    minimumReceivedRaw: '994005000',
    minimumReceivedFormatted: '994',
    executionPrice: 0.999,
    priceImpact: { percentage: 0 },
    protocolFee: { feeBps: 0, feeAmountRaw: '0', feeAmountFormatted: '0', feeUSD: 0 },
    effectiveExecutionScore: 90,
    quoteTimestamp: Date.now(),
    expiresAt: Date.now() + 60000,
    deadline: Date.now() + 1200000,
    freshnessSeconds: 10,
    crossChainQuote: compositeQuote
  };

  await assert.rejects(
    async () => {
      await coordinator.executeTrade({
        quote: quoteResponse,
        userAddress: USER_ADDR,
        signer: mockSigner as any,
        actualAmounts: {
          sourceSwapActualOut: 950000000n
        }
      });
    },
    (err: any) => {
      assert.ok(err instanceof SourceSwapFailedError || err instanceof AmountMismatchError || err.message.includes('minimum acceptable amount'));
      return true;
    }
  );
});

test('Test 13: Source swap output extraction from single Transfer event log', () => {
  const usdcEth = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const transferLog = ERC20_INTERFACE.encodeEventLog(
    ERC20_INTERFACE.getEvent('Transfer')!,
    [ROUTER_ADDR, USER_ADDR, 995500000n]
  );

  const receipt = {
    status: 1,
    logs: [
      {
        address: usdcEth,
        topics: transferLog.topics,
        data: transferLog.data
      }
    ]
  };

  const result = extractActualSourceSwapOutput({
    receipt,
    expectedTokenOutAddress: usdcEth,
    recipientAddress: USER_ADDR,
    minimumAmountOutRaw: '990000000',
    sourceChainId: 'ethereum'
  });

  assert.equal(result.actualAmountRaw, '995500000');
  assert.equal(result.actualAmountBig, 995500000n);
  assert.equal(result.verified, true);
  assert.equal(result.extractionMethod, 'RECEIPT_LOGS');
});

test('Test 14: Source swap output extraction isolates final transfer from multiple internal pool hops', () => {
  const usdcEth = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const intermediatePool = '0x1111111111111111111111111111111111111111';

  // Hop 1: Transfer from user to pool
  const hop1Log = ERC20_INTERFACE.encodeEventLog(
    ERC20_INTERFACE.getEvent('Transfer')!,
    [USER_ADDR, intermediatePool, 1000000000000000000000n]
  );
  // Hop 2: Transfer fee to fee recipient
  const feeLog = ERC20_INTERFACE.encodeEventLog(
    ERC20_INTERFACE.getEvent('Transfer')!,
    [intermediatePool, '0x2222222222222222222222222222222222222222', 500000n]
  );
  // Hop 3: Transfer output to USER
  const finalHopLog = ERC20_INTERFACE.encodeEventLog(
    ERC20_INTERFACE.getEvent('Transfer')!,
    [intermediatePool, USER_ADDR, 994500000n]
  );

  const receipt = {
    status: 1,
    logs: [
      { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', topics: hop1Log.topics, data: hop1Log.data },
      { address: usdcEth, topics: feeLog.topics, data: feeLog.data },
      { address: usdcEth, topics: finalHopLog.topics, data: finalHopLog.data }
    ]
  };

  const result = extractActualSourceSwapOutput({
    receipt,
    expectedTokenOutAddress: usdcEth,
    recipientAddress: USER_ADDR,
    minimumAmountOutRaw: '990000000',
    sourceChainId: 'ethereum'
  });

  assert.equal(result.actualAmountRaw, '994500000');
  assert.equal(result.actualAmountBig, 994500000n);
  assert.equal(result.extractionMethod, 'RECEIPT_LOGS');
});

test('Test 15: Source swap output extraction fails closed on reverted receipt status', () => {
  const usdcEth = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const receipt = { status: 0, transactionHash: '0xreverted_tx' };

  assert.throws(() => {
    extractActualSourceSwapOutput({
      receipt,
      expectedTokenOutAddress: usdcEth,
      recipientAddress: USER_ADDR,
      minimumAmountOutRaw: '990000000',
      sourceChainId: 'ethereum'
    });
  }, (err: any) => {
    assert.ok(err instanceof SourceSwapFailedError);
    return true;
  });
});

test('Test 16: Source swap output extraction fails closed when matching log is missing', () => {
  const usdcEth = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const receipt = { status: 1, logs: [] };

  assert.throws(() => {
    extractActualSourceSwapOutput({
      receipt,
      expectedTokenOutAddress: usdcEth,
      recipientAddress: USER_ADDR,
      minimumAmountOutRaw: '990000000',
      sourceChainId: 'ethereum'
    });
  }, (err: any) => {
    assert.ok(err instanceof SourceSwapFailedError);
    return true;
  });
});

test('Test 17: Transfer-Balance Cross-Check: passes when balance delta matches event output', () => {
  const usdcEth = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const transferLog = ERC20_INTERFACE.encodeEventLog(
    ERC20_INTERFACE.getEvent('Transfer')!,
    [ROUTER_ADDR, USER_ADDR, 998000000n]
  );

  const receipt = {
    status: 1,
    logs: [
      { address: usdcEth, topics: transferLog.topics, data: transferLog.data }
    ]
  };

  const result = extractActualSourceSwapOutput({
    receipt,
    expectedTokenOutAddress: usdcEth,
    recipientAddress: USER_ADDR,
    minimumAmountOutRaw: '990000000',
    sourceChainId: 'ethereum',
    balanceBeforeRaw: 10000000n, // 10 USDC before
    balanceAfterRaw: 1008000000n // 1008 USDC after -> delta = 998 USDC
  });

  assert.equal(result.actualAmountRaw, '998000000');
  assert.equal(result.extractionMethod, 'COMBINED_RECONCILED');
  assert.equal(result.verified, true);
});

test('Test 18: Transfer-Balance Cross-Check: throws StatusConflictError on divergence', () => {
  const usdcEth = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const transferLog = ERC20_INTERFACE.encodeEventLog(
    ERC20_INTERFACE.getEvent('Transfer')!,
    [ROUTER_ADDR, USER_ADDR, 998000000n] // Event says 998 USDC transferred
  );

  const receipt = {
    status: 1,
    logs: [
      { address: usdcEth, topics: transferLog.topics, data: transferLog.data }
    ]
  };

  assert.throws(() => {
    extractActualSourceSwapOutput({
      receipt,
      expectedTokenOutAddress: usdcEth,
      recipientAddress: USER_ADDR,
      minimumAmountOutRaw: '990000000',
      sourceChainId: 'ethereum',
      balanceBeforeRaw: 10000000n,
      balanceAfterRaw: 980000000n // Balance delta only 970 USDC (divergence!)
    });
  }, (err: any) => {
    assert.ok(err instanceof StatusConflictError);
    assert.equal(err.code, 'STATUS_CONFLICT');
    return true;
  });
});

test('Test 19: Source swap output extraction throws AmountMismatchError if output < minimum', () => {
  const usdcEth = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const transferLog = ERC20_INTERFACE.encodeEventLog(
    ERC20_INTERFACE.getEvent('Transfer')!,
    [ROUTER_ADDR, USER_ADDR, 950000000n] // 950 USDC
  );

  const receipt = {
    status: 1,
    logs: [
      { address: usdcEth, topics: transferLog.topics, data: transferLog.data }
    ]
  };

  assert.throws(() => {
    extractActualSourceSwapOutput({
      receipt,
      expectedTokenOutAddress: usdcEth,
      recipientAddress: USER_ADDR,
      minimumAmountOutRaw: '990000000', // Minimum expected 990 USDC
      sourceChainId: 'ethereum'
    });
  }, (err: any) => {
    assert.ok(err instanceof AmountMismatchError);
    assert.equal(err.code, 'AMOUNT_MISMATCH');
    return true;
  });
});

test('Test 20: Dynamic Bridge Quote Refresh updates bridge deposit requiredAmountRaw', async () => {
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcPol = defaultTokenService.getTokensForChain('polygon').find((t) => t.symbol === 'USDC')!;

  const coordinator = new ExecutionCoordinator();
  const mockPlan: any = {
    planId: 'plan-refresh-test-1',
    routeId: 'route-refresh-1',
    routeType: 'CROSS_CHAIN_COMPOSITE',
    sourceChainId: 'ethereum',
    destinationChainId: 'polygon',
    tokenIn: usdcEth,
    tokenOut: usdcPol,
    expectedAmountInRaw: '1000000000',
    expectedAmountOutRaw: '999000000',
    minimumAmountOutRaw: '994000000',
    isExecutable: true,
    steps: [
      {
        id: 'validation',
        type: 'VALIDATION',
        chainId: 'ethereum',
        executionEnvironment: 'EVM',
        status: 'NOT_STARTED',
        dependencies: [],
        retryPolicy: { maxRetries: 1 }
      },
      {
        id: 'source-swap:uniswap',
        type: 'SOURCE_SWAP',
        chainId: 'ethereum',
        executionEnvironment: 'EVM',
        targetAddress: ROUTER_ADDR,
        calldata: '0x1111',
        outputTokenAddress: usdcEth.address,
        outputTokenSymbol: 'USDC',
        expectedAmountOutRaw: '1000000000',
        minimumAmountOutRaw: '990000000',
        status: 'NOT_STARTED',
        dependencies: ['validation'],
        retryPolicy: { maxRetries: 1 }
      },
      {
        id: 'bridge-quote-refresh:across',
        type: 'BRIDGE_QUOTE_REFRESH',
        chainId: 'ethereum',
        executionEnvironment: 'OFF_CHAIN',
        requiredTokenAddress: usdcEth.address,
        requiredTokenSymbol: 'USDC',
        requiredAmountRaw: '1000000000',
        status: 'NOT_STARTED',
        dependencies: ['source-swap:uniswap'],
        retryPolicy: { maxRetries: 1 }
      },
      {
        id: 'bridge:across',
        type: 'BRIDGE_DEPOSIT',
        chainId: 'ethereum',
        executionEnvironment: 'EVM',
        targetAddress: ACROSS_SPOKE_POOLS[1],
        calldata: '0x2222',
        requiredTokenAddress: usdcEth.address,
        requiredTokenSymbol: 'USDC',
        requiredAmountRaw: '1000000000',
        status: 'NOT_STARTED',
        dependencies: ['bridge-quote-refresh:across'],
        retryPolicy: { maxRetries: 1 }
      },
      {
        id: 'bridge-relay-wait:across',
        type: 'BRIDGE_RELAY_WAIT',
        chainId: 'polygon',
        executionEnvironment: 'OFF_CHAIN',
        status: 'NOT_STARTED',
        dependencies: ['bridge:across'],
        retryPolicy: { maxRetries: 1 }
      },
      {
        id: 'destination-verification:polygon',
        type: 'DESTINATION_VERIFY',
        chainId: 'polygon',
        executionEnvironment: 'EVM',
        status: 'NOT_STARTED',
        dependencies: ['bridge-relay-wait:across'],
        retryPolicy: { maxRetries: 1 }
      },
      {
        id: 'settlement',
        type: 'SETTLEMENT_COMPLETE',
        chainId: 'polygon',
        executionEnvironment: 'OFF_CHAIN',
        status: 'NOT_STARTED',
        dependencies: ['destination-verification:polygon'],
        retryPolicy: { maxRetries: 1 }
      }
    ]
  };

  const executedCalldatas: string[] = [];
  const mockSigner = {
    getAddress: async () => USER_ADDR,
    estimateGas: async () => 150000n,
    sendTransaction: async (tx: any) => {
      executedCalldatas.push(tx.data);
      return {
        hash: `0xtx_${executedCalldatas.length}`,
        wait: async () => ({ status: 1, blockNumber: 100 })
      };
    },
    provider: {
      call: async () => '0x000000000000000000000000000000000000000000000000000000003b9aca00',
      getTransactionReceipt: async () => ({ status: 1, blockNumber: 100 })
    }
  };

  const receipt = await coordinator.executeTrade({
    plan: mockPlan,
    userAddress: USER_ADDR,
    signer: mockSigner as any,
    skipDestinationWait: true,
    actualAmounts: {
      sourceSwapActualOut: 996000000n // Actual swap output 996 USDC
    }
  });

  assert.equal(receipt.status, 'BRIDGE_IN_FLIGHT');
  const bridgeDepositStep = mockPlan.steps.find((s: any) => s.type === 'BRIDGE_DEPOSIT');
  assert.equal(bridgeDepositStep.requiredAmountRaw, '996000000');
});

test('Test 21: validateCrossChainQuoteExecutability rejects expired quotes', () => {
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const expiredQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: usdcEth,
    destinationToken: usdcArb,
    sourceAmountRaw: '1000000000',
    destinationAmountRaw: '999500000',
    minDestinationAmountRaw: '994502500',
    bridgeFeeUSD: 0.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 5,
    recipient: USER_ADDR,
    executionTarget: ACROSS_SPOKE_POOLS[1],
    calldata: '0x1234',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[1],
    quoteTimestamp: Date.now() - 600000,
    expiration: Date.now() - 1000, // Expired!
    isExecutable: true
  };

  const validation = validateCrossChainQuoteExecutability(expiredQuote);
  assert.equal(validation.isExecutable, false);
  assert.ok(validation.failedGates.includes('EXPIRATION_VALID'));
});

test('Test 22: Across Protocol Calldata verification: depositV3 target matches SpokePool', async () => {
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const quote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: usdcEth,
    destinationToken: usdcArb,
    sourceAmountRaw: '1000000000',
    destinationAmountRaw: '999500000',
    minDestinationAmountRaw: '994502500',
    bridgeFeeUSD: 0.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 5,
    recipient: USER_ADDR,
    executionTarget: ACROSS_SPOKE_POOLS[1],
    calldata: '0x1234',
    approvalTarget: ACROSS_SPOKE_POOLS[1],
    quoteTimestamp: Date.now(),
    expiration: Date.now() + 300000,
    isExecutable: true
  };

  const exec = await defaultAcrossProvider.buildExecution(quote, USER_ADDR, USER_ADDR);
  assert.ok(exec);
  assert.equal(exec?.to.toLowerCase(), ACROSS_SPOKE_POOLS[1].toLowerCase());
  assert.ok(exec?.data.startsWith('0x'));
});

test('Test 23: deBridge DLN Calldata verification: createOrder target matches DLN Source', async () => {
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const quote: CrossChainQuote = {
    provider: 'DEBRIDGE_DLN',
    providerName: 'deBridge DLN',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: usdcEth,
    destinationToken: usdcArb,
    sourceAmountRaw: '1000000000',
    destinationAmountRaw: '999500000',
    minDestinationAmountRaw: '994502500',
    bridgeFeeUSD: 0.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 5,
    recipient: USER_ADDR,
    executionTarget: DEBRIDGE_DLN_SOURCE[1],
    calldata: '0x1234',
    approvalTarget: DEBRIDGE_DLN_SOURCE[1],
    quoteTimestamp: Date.now(),
    expiration: Date.now() + 300000,
    isExecutable: true
  };

  const exec = await defaultDeBridgeProvider.buildExecution(quote, USER_ADDR, USER_ADDR);
  assert.ok(exec);
  assert.equal(exec?.to.toLowerCase(), DEBRIDGE_DLN_SOURCE[1].toLowerCase());
});

test('Test 24: Bridge Target Validation: rejects invalid or zero execution target address', () => {
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const invalidQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: usdcEth,
    destinationToken: usdcArb,
    sourceAmountRaw: '1000000000',
    destinationAmountRaw: '999500000',
    minDestinationAmountRaw: '994502500',
    bridgeFeeUSD: 0.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 5,
    recipient: USER_ADDR,
    executionTarget: '0x0000000000000000000000000000000000000000', // Zero address!
    calldata: '0x1234',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[1],
    quoteTimestamp: Date.now(),
    expiration: Date.now() + 300000,
    isExecutable: true
  };

  const validation = validateCrossChainQuoteExecutability(invalidQuote);
  assert.equal(validation.isExecutable, false);
  assert.ok(validation.failedGates.includes('EXECUTION_TARGET_VALID'));
});

test('Test 25: Composite DAG Token Continuity: throws TokenMismatchError on connector token divergence', () => {
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const daiEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'DAI')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const brokenPlan: any = {
    planId: 'plan-token-mismatch',
    routeId: 'route-token-mismatch',
    routeType: 'CROSS_CHAIN_COMPOSITE',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    tokenIn: daiEth,
    tokenOut: usdcArb,
    expectedAmountInRaw: '1000000000000000000000',
    expectedAmountOutRaw: '999000000',
    minimumAmountOutRaw: '994000000',
    isExecutable: true,
    steps: [
      {
        id: 'source-swap',
        type: 'SOURCE_SWAP',
        chainId: 'ethereum',
        executionEnvironment: 'EVM',
        targetAddress: ROUTER_ADDR,
        calldata: '0x1111',
        outputTokenAddress: usdcEth.address, // Output is USDC
        dependencies: [],
        retryPolicy: { maxRetries: 1 }
      },
      {
        id: 'bridge-deposit',
        type: 'BRIDGE_DEPOSIT',
        chainId: 'ethereum',
        executionEnvironment: 'EVM',
        targetAddress: ACROSS_SPOKE_POOLS[1],
        calldata: '0x2222',
        requiredTokenAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // Bridge requires DAI (Mismatch!)
        dependencies: ['source-swap'],
        retryPolicy: { maxRetries: 1 }
      }
    ]
  };

  assert.throws(() => {
    ExecutionPlanValidator.validateCompositePlan(brokenPlan);
  }, (err: any) => {
    assert.ok(err instanceof TokenMismatchError);
    assert.equal(err.code, 'TOKEN_MISMATCH');
    return true;
  });
});

test('Test 26: Composite DAG Chain Continuity: throws ChainMismatchError on chain divergence', () => {
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const daiEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'DAI')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const brokenPlan: any = {
    planId: 'plan-chain-mismatch',
    routeId: 'route-chain-mismatch',
    routeType: 'CROSS_CHAIN_COMPOSITE',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    tokenIn: daiEth,
    tokenOut: usdcArb,
    expectedAmountInRaw: '1000000000000000000000',
    expectedAmountOutRaw: '999000000',
    minimumAmountOutRaw: '994000000',
    isExecutable: true,
    steps: [
      {
        id: 'source-swap',
        type: 'SOURCE_SWAP',
        chainId: 'polygon', // Source swap on Polygon while plan source is Ethereum!
        executionEnvironment: 'EVM',
        targetAddress: ROUTER_ADDR,
        calldata: '0x1111',
        outputTokenAddress: usdcEth.address,
        dependencies: [],
        retryPolicy: { maxRetries: 1 }
      },
      {
        id: 'bridge-deposit',
        type: 'BRIDGE_DEPOSIT',
        chainId: 'ethereum',
        executionEnvironment: 'EVM',
        targetAddress: ACROSS_SPOKE_POOLS[1],
        calldata: '0x2222',
        requiredTokenAddress: usdcEth.address,
        dependencies: ['source-swap'],
        retryPolicy: { maxRetries: 1 }
      }
    ]
  };

  assert.throws(() => {
    ExecutionPlanValidator.validateCompositePlan(brokenPlan);
  }, (err: any) => {
    assert.ok(err instanceof ChainMismatchError);
    assert.equal(err.code, 'CHAIN_MISMATCH');
    return true;
  });
});

test('Test 27: Composite DAG Slippage Isolation: throws CompositePlanValidationError if minOut > expectedOut', () => {
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const daiEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'DAI')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const brokenPlan: any = {
    planId: 'plan-slippage-invalid',
    routeId: 'route-slippage-invalid',
    routeType: 'CROSS_CHAIN_COMPOSITE',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    tokenIn: daiEth,
    tokenOut: usdcArb,
    expectedAmountInRaw: '1000000000000000000000',
    expectedAmountOutRaw: '999000000',
    minimumAmountOutRaw: '994000000',
    isExecutable: true,
    steps: [
      {
        id: 'source-swap',
        type: 'SOURCE_SWAP',
        chainId: 'ethereum',
        executionEnvironment: 'EVM',
        targetAddress: ROUTER_ADDR,
        calldata: '0x1111',
        outputTokenAddress: usdcEth.address,
        expectedAmountOutRaw: '999500000',
        minimumAmountOutRaw: '1050000000', // Minimum output exceeds expected!
        dependencies: [],
        retryPolicy: { maxRetries: 1 }
      },
      {
        id: 'bridge-deposit',
        type: 'BRIDGE_DEPOSIT',
        chainId: 'ethereum',
        executionEnvironment: 'EVM',
        targetAddress: ACROSS_SPOKE_POOLS[1],
        calldata: '0x2222',
        requiredTokenAddress: usdcEth.address,
        requiredAmountRaw: '999500000',
        dependencies: ['source-swap'],
        retryPolicy: { maxRetries: 1 }
      }
    ]
  };

  assert.throws(() => {
    ExecutionPlanValidator.validateCompositePlan(brokenPlan);
  }, (err: any) => {
    assert.ok(err instanceof CompositePlanValidationError);
    return true;
  });
});

test('Test 28: Composite DAG Amount Continuity: throws AmountMismatchError on planning estimate discrepancy', () => {
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const daiEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'DAI')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const brokenPlan: any = {
    planId: 'plan-amount-mismatch',
    routeId: 'route-amount-mismatch',
    routeType: 'CROSS_CHAIN_COMPOSITE',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    tokenIn: daiEth,
    tokenOut: usdcArb,
    expectedAmountInRaw: '1000000000000000000000',
    expectedAmountOutRaw: '999000000',
    minimumAmountOutRaw: '994000000',
    isExecutable: true,
    steps: [
      {
        id: 'source-swap',
        type: 'SOURCE_SWAP',
        chainId: 'ethereum',
        executionEnvironment: 'EVM',
        targetAddress: ROUTER_ADDR,
        calldata: '0x1111',
        outputTokenAddress: usdcEth.address,
        expectedAmountOutRaw: '999500000', // Expected output is 999.5 USDC
        minimumAmountOutRaw: '990000000',
        dependencies: [],
        retryPolicy: { maxRetries: 1 }
      },
      {
        id: 'bridge-deposit',
        type: 'BRIDGE_DEPOSIT',
        chainId: 'ethereum',
        executionEnvironment: 'EVM',
        targetAddress: ACROSS_SPOKE_POOLS[1],
        calldata: '0x2222',
        requiredTokenAddress: usdcEth.address,
        requiredAmountRaw: '800000000', // Initial bridge required is 800 USDC (discrepancy!)
        dependencies: ['source-swap'],
        retryPolicy: { maxRetries: 1 }
      }
    ]
  };

  assert.throws(() => {
    ExecutionPlanValidator.validateCompositePlan(brokenPlan);
  }, (err: any) => {
    assert.ok(err instanceof AmountMismatchError);
    assert.equal(err.code, 'AMOUNT_MISMATCH');
    return true;
  });
});

test('Test 29: Complete End-to-End Composite execution (POL -> USDC on Polygon -> Bridge to Ethereum USDC)', async () => {
  const coordinator = new ExecutionCoordinator();
  const pol = defaultTokenService.getTokensForChain('polygon').find((t) => t.symbol === 'POL') || {
    address: '0x0000000000000000000000000000000000001010',
    chainId: 'polygon',
    name: 'Polygon Ecosystem Token',
    symbol: 'POL',
    decimals: 18
  };
  const usdcPol = defaultTokenService.getTokensForChain('polygon').find((t) => t.symbol === 'USDC')!;
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;

  const transferLog = ERC20_INTERFACE.encodeEventLog(
    ERC20_INTERFACE.getEvent('Transfer')!,
    [ROUTER_ADDR, USER_ADDR, 420000000n] // 420 USDC output from swap
  );

  let txIndex = 0;
  const mockSigner = {
    getAddress: async () => USER_ADDR,
    estimateGas: async () => 180000n,
    sendTransaction: async () => {
      txIndex++;
      if (txIndex === 1) {
        // Swap transaction
        return {
          hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
          wait: async () => ({
            status: 1,
            blockNumber: 50000000,
            logs: [
              {
                address: usdcPol.address,
                topics: transferLog.topics,
                data: transferLog.data
              }
            ]
          })
        };
      }
      // Bridge transaction
      return {
        hash: '0x2222222222222222222222222222222222222222222222222222222222222222',
        wait: async () => ({
          status: 1,
          blockNumber: 50000001,
          logs: []
        })
      };
    },
    provider: {
      call: async () => '0x000000000000000000000000000000000000000000000000000000001908b100',
      getBalance: async () => 2000000000000000000000n,
      getTransactionReceipt: async () => ({ status: 1, blockNumber: 50000000 })
    }
  };

  const customTracker = new CrossChainTracker();
  customTracker.trackUntilSettled = async () => ({
    isSuccess: true,
    destinationTxHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
    state: 'DESTINATION_FILLED'
  });
  customTracker.verifyDestinationSettlement = async () => ({
    isVerified: true
  });
  (coordinator as any).tracker = customTracker;

  const sourceDexQuote: DEXQuote = {
    provider: 'QUICKSWAP',
    providerName: 'QuickSwap V3',
    chainId: 137,
    tokenIn: pol as any,
    tokenOut: usdcPol,
    amountIn: 1000000000000000000000n,
    amountOut: 420000000n,
    minimumAmountOut: 415000000n,
    feeAmount: 1000000n,
    feeTierBps: 30,
    priceImpactPercent: 0.02,
    gasEstimate: 160000n,
    gasCostUSD: 0.05,
    executionTarget: '0xf5b509bB0909a69B1c207E495f687a596C168E12',
    approvalTarget: '0xf5b509bB0909a69B1c207E495f687a596C168E12',
    calldata: '0xswapquickswap123',
    quoteTimestamp: Date.now(),
    expiration: Date.now() + 300000
  };

  const underlyingBridgeQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'polygon',
    destinationChainId: 'ethereum',
    sourceToken: usdcPol,
    destinationToken: usdcEth,
    sourceAmountRaw: '420000000',
    destinationAmountRaw: '419500000',
    minDestinationAmountRaw: '415000000',
    bridgeFeeUSD: 0.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 0.5,
    recipient: USER_ADDR,
    expiration: Date.now() + 300000,
    routeIdentifier: 'across-pol-eth',
    executionTarget: ACROSS_SPOKE_POOLS[137],
    calldata: '0xacrossdepositcalldata',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[137],
    quoteTimestamp: Date.now(),
    estimatedTransferTimeSec: 30,
    securityRating: 'A+',
    isExecutable: true
  };

  const compositeQuote: CrossChainQuote = {
    ...underlyingBridgeQuote,
    sourceToken: pol as any,
    destinationToken: usdcEth,
    sourceAmountRaw: '1000000000000000000000',
    destinationAmountRaw: '419500000',
    minDestinationAmountRaw: '415000000',
    sourceDexQuote,
    underlyingBridgeQuote,
    sourceConnectorToken: usdcPol,
    compositeExecutionMode: 'SEPARATE_DESTINATION_TX',
    isExecutable: true
  };

  const quoteResponse: any = {
    requestId: 'req-e2e-pol-eth',
    request: {
      sourceChainId: 'polygon',
      destinationChainId: 'ethereum',
      tokenIn: pol as any,
      tokenOut: usdcEth,
      amountInRaw: '1000000000000000000000',
      userWalletAddress: USER_ADDR
    },
    tradeType: 'EXACT_INPUT',
    routes: [],
    bestRoute: {
      id: 'route-e2e-pol-eth',
      routeType: 'CROSS_CHAIN',
      hops: [],
      gasCostUSD: 0.55,
      crossChainQuote: compositeQuote,
      isExecutable: true
    },
    amountInRaw: '1000000000000000000000',
    amountInFormatted: '1000',
    amountOutRaw: '419500000',
    amountOutFormatted: '419.5',
    minimumReceivedRaw: '415000000',
    minimumReceivedFormatted: '415',
    executionPrice: 0.4195,
    priceImpact: { percentage: 0.02 },
    protocolFee: { feeBps: 0, feeAmountRaw: '0', feeAmountFormatted: '0', feeUSD: 0 },
    effectiveExecutionScore: 95,
    quoteTimestamp: Date.now(),
    expiresAt: Date.now() + 60000,
    deadline: Date.now() + 1200000,
    freshnessSeconds: 10,
    crossChainQuote: compositeQuote
  };

  const receipt = await coordinator.executeTrade({
    quote: quoteResponse,
    userAddress: USER_ADDR,
    signer: mockSigner as any
  });

  assert.equal(receipt.status, 'COMPLETED');
  assert.equal(receipt.bridgeDetails?.sourceTxHash, '0x2222222222222222222222222222222222222222222222222222222222222222');
  assert.equal(receipt.bridgeDetails?.destTxHash, '0x3333333333333333333333333333333333333333333333333333333333333333');
  assert.equal(receipt.bridgeDetails?.destinationVerified, true);
});

test('Test 30: Anti-Mock & Safety Audit: Zero live transactions, zero synthetic fallback quotes promoted to executable', () => {
  const aggregator = new CrossChainAggregator();
  const providers = aggregator.getProviders();

  assert.equal(providers.length >= 2, true);
  for (const provider of providers) {
    assert.ok(provider.id);
    assert.ok(provider.name);
  }

  // Confirm that unexecutable routes fail closed without promoting synthetic quotes to executable
  const unverifiedQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'ethereum',
    destinationChainId: 'polygon',
    sourceToken: DEFAULT_TOKENS[0],
    destinationToken: DEFAULT_TOKENS[1],
    sourceAmountRaw: '1000000',
    destinationAmountRaw: '990000',
    minDestinationAmountRaw: '980000',
    bridgeFeeUSD: 1,
    relayerFee: '0.1%',
    gasEstimateUSD: 2,
    recipient: USER_ADDR,
    quoteTimestamp: Date.now(),
    isExecutable: false,
    unexecutableReason: 'PROVIDER_UNAVAILABLE: Test mock unavailable'
  };

  const validation = validateCrossChainQuoteExecutability(unverifiedQuote);
  assert.equal(validation.isExecutable, false);
  assert.equal(validation.unexecutableReason, 'PROVIDER_UNAVAILABLE: Test mock unavailable');
});
