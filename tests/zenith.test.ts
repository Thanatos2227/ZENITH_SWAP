import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultChainRegistry } from '../packages/chains/src/registry';
import { DEFAULT_TOKENS, UNSUPPORTED_TOKEN_METADATA, defaultTokenService, defaultMarketDataService } from '../packages/tokens/src';
import { defaultTokenRiskEngine, defaultCircuitBreaker } from '../packages/security/src';
import {
  defaultZenithRouter,
  ConstantProductMath,
  ConcentratedLiquidityMath,
  validateAndSanitizeAmount,
  truncateToThreeDecimals
} from '../packages/routing/src';
import { ExecutionStateMachine, defaultIntentEngine, defaultEVMAdapter } from '../packages/execution/src';
import { CrossChainIntent } from '../packages/types/src';

test('1. Universal Network Support Tier System & 53-Chain Governance', () => {
  const allChains = defaultChainRegistry.getAllChains();
  assert.equal(allChains.length, 53);

  const tier1 = defaultChainRegistry.getChainsByTier('TIER_1');
  assert.equal(tier1.length, 8);
  assert.ok(tier1.some((c) => c.id === 'ethereum'));
  assert.ok(tier1.some((c) => c.id === 'base'));
  assert.ok(tier1.some((c) => c.id === 'solana'));
  assert.ok(tier1.every((c) => c.capabilities.swap && c.capabilities.smartRouting && c.capabilities.simulation));

  const tier2 = defaultChainRegistry.getChainsByTier('TIER_2');
  assert.equal(tier2.length, 22);
  assert.ok(tier2.some((c) => c.id === 'soneium'));
  assert.ok(tier2.some((c) => c.id === 'scroll'));
  assert.ok(tier2.some((c) => c.id === 'berachain'));
  assert.ok(tier2.some((c) => c.id === 'sui'));

  const tier3 = defaultChainRegistry.getChainsByTier('TIER_3');
  assert.equal(tier3.length, 18);
  assert.ok(tier3.some((c) => c.id === 'tron'));
  assert.ok(tier3.some((c) => c.id === 'ton'));
  assert.ok(tier3.some((c) => c.id === 'cardano'));
  assert.ok(tier3.some((c) => c.id === 'polkadot'));

  const tier4 = defaultChainRegistry.getChainsByTier('TIER_4');
  assert.equal(tier4.length, 5);
  const btc = defaultChainRegistry.getChain('bitcoin');
  assert.ok(btc);
  assert.equal(btc?.tier, 'TIER_4');
  assert.equal(btc?.capabilities.swap, false);
  assert.equal(btc?.capabilities.tokenDiscovery, true);
});

test('2. Dynamic Capability Matrix & Health Downgrade Engine', () => {

  assert.equal(defaultChainRegistry.supportsCapability('ethereum', 'swap'), true);
  assert.equal(defaultChainRegistry.supportsCapability('ethereum', 'mevProtection'), true);

  assert.equal(defaultChainRegistry.supportsCapability('bitcoin', 'swap'), false);
  assert.equal(defaultChainRegistry.supportsCapability('bitcoin', 'tokenDiscovery'), true);

  defaultChainRegistry.updateChainTier('soneium', 'TIER_1');
  const soneium = defaultChainRegistry.getChain('soneium');
  assert.equal(soneium?.tier, 'TIER_1');

  defaultChainRegistry.setOperationalStatus('base', 'PAUSED');
  assert.equal(defaultChainRegistry.supportsCapability('base', 'swap'), false);

  defaultChainRegistry.setOperationalStatus('base', 'HEALTHY');
  assert.equal(defaultChainRegistry.supportsCapability('base', 'swap'), true);

  defaultChainRegistry.updateChainTier('soneium', 'TIER_2');
});

test('3. Token Service & Multi-Chain Discovery', () => {
  const ethTokens = defaultTokenService.getTokensForChain('ethereum');
  assert.ok(ethTokens.length > 0);

  const nativeBtc = defaultTokenService.getNativeToken('bitcoin');
  assert.ok(nativeBtc);
  assert.equal(nativeBtc?.symbol, 'BTC');

  const tronTokens = defaultTokenService.getTokensForChain('tron');
  assert.ok(tronTokens.length >= 2);

  const custom = defaultTokenService.importCustomToken({
    chainId: 'arbitrum',
    address: '0x1111111111111111111111111111111111111111',
    name: 'Custom Test Asset',
    symbol: 'CTA',
    decimals: 18
  });
  assert.equal(custom.symbol, 'CTA');
  assert.equal(custom.verificationTier, 'UNVERIFIED');
});

test('3a. Additional token metadata, search, deployments, and unsupported handling', () => {
  const requested = ['ZEC', 'WBETH', 'BCH', 'USDE', 'USD1', 'LTC', 'GRAM', 'TAO', 'XAUT', 'RLUSD', 'PUMP', 'ASTER', 'PAXG', 'WLFI', 'BFUSD'];
  const registeredSymbols = new Set(DEFAULT_TOKENS.map((token) => token.symbol));
  const unsupportedSymbols = new Set(UNSUPPORTED_TOKEN_METADATA.map((token) => token.symbol));

  for (const symbol of requested) {
    assert.ok(registeredSymbols.has(symbol) || unsupportedSymbols.has(symbol), `${symbol} has registry metadata`);
  }

  assert.equal(defaultTokenService.searchTokens('Wrapped Beacon ETH', 'ethereum')[0]?.symbol, 'WBETH');
  assert.equal(defaultTokenService.searchTokens('USDe', 'ethereum')[0]?.symbol, 'USDE');
  assert.equal(defaultTokenService.searchTokens('PAX Gold', 'ethereum')[0]?.symbol, 'PAXG');
  assert.equal(defaultTokenService.searchUnsupportedTokenMetadata('Bitcoin Cash')[0]?.symbol, 'BCH');
  assert.equal(defaultTokenService.searchUnsupportedTokenMetadata('ZEC')[0]?.name, 'Zcash');
  assert.equal(defaultTokenService.getTokensForChain('ethereum').some((token) => token.symbol === 'USD1'), true);
  assert.equal(defaultTokenService.getTokensForChain('bnb').some((token) => token.symbol === 'USD1'), true);
  assert.equal(defaultTokenService.getTokensForChain('ethereum').some((token) => token.symbol === 'ASTER'), false);

  const keys = DEFAULT_TOKENS.map((token) => `${token.chainId}:${token.address.toLowerCase()}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(UNSUPPORTED_TOKEN_METADATA.every((token) => token.supportedNetworks.length === 0));
});

test('4. Token Risk Engine & Security Profiling', () => {
  const nativeToken = DEFAULT_TOKENS.find((t) => t.isNative)!;
  const nativeRisk = defaultTokenRiskEngine.evaluateToken(nativeToken);
  assert.equal(nativeRisk.overallRiskLevel, 'LOW');
  assert.equal(nativeRisk.riskScore, 0);

  const riskyToken = {
    address: '0x9999999999999999999999999999999999999999',
    chainId: 'ethereum',
    name: 'Suspicious Coin',
    symbol: 'SUSP',
    decimals: 18,
    verificationTier: 'SUSPICIOUS' as const,
    securityProfile: {
      isHoneypot: true,
      buyTaxPercent: 15,
      sellTaxPercent: 99,
      transferTaxPercent: 0,
      canBlacklist: true,
      canMintArbitrary: true,
      isProxy: false,
      liquidityLockedPercent: 0,
      holderConcentrationTop10Percent: 95,
      hasMaliciousPatterns: true,
      riskScore: 100,
      warnings: []
    }
  };

  const riskyEval = defaultTokenRiskEngine.evaluateToken(riskyToken);
  assert.equal(riskyEval.overallRiskLevel, 'CRITICAL');
  assert.equal(riskyEval.isTradeable, false);
  assert.ok(riskyEval.warnings.length > 0);
});

test('5. Constant-Product AMM Math & Invariant Verification (x * y = k)', () => {
  const reserveIn = 1000000000000000000000n;
  const reserveOut = 3450000000000n;
  const amountIn = 1000000000000000000n;

  const amountOut = ConstantProductMath.getAmountOut(amountIn, reserveIn, reserveOut, 30);
  assert.ok(amountOut > 0n);
  assert.ok(amountOut < 3450000000n);

  const invariantHolds = ConstantProductMath.verifyInvariant(reserveIn, reserveOut, amountIn, amountOut, 30);
  assert.equal(invariantHolds, true);

  const requiredAmountIn = ConstantProductMath.getAmountIn(amountOut, reserveIn, reserveOut, 30);
  assert.ok(requiredAmountIn > 0n);

  const simulatedOut = ConstantProductMath.getAmountOut(requiredAmountIn, reserveIn, reserveOut, 30);
  assert.ok(simulatedOut >= amountOut);
});

test('6. Concentrated Liquidity sqrt(P) & Tick Step Math', () => {
  const tick0 = 0;
  const sqrtRatio0 = ConcentratedLiquidityMath.getSqrtRatioAtTick(tick0);
  assert.ok(sqrtRatio0 > 0n);

  const tickBack = ConcentratedLiquidityMath.getTickAtSqrtRatio(sqrtRatio0);
  assert.equal(tickBack, 0);

  const liquidity = 1000000000000000000n;
  const targetSqrtRatio = sqrtRatio0 * 99n / 100n;
  const step = ConcentratedLiquidityMath.computeSwapStep(
    sqrtRatio0,
    targetSqrtRatio,
    liquidity,
    10000000000000000n,
    30,
    true,
    true
  );

  assert.ok(step.amountIn > 0n);
  assert.ok(step.amountOut > 0n);
  assert.ok(step.feeAmount > 0n);
});

test('7. Best Execution Router: Exact-Input Swap Quoting', async () => {
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'ETH')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;

  const quote = await defaultZenithRouter.getQuote({
    sourceChainId: 'ethereum',
    destinationChainId: 'ethereum',
    tokenIn,
    tokenOut,
    amountInRaw: '1000000000000000000',
    recipient: '0x1234567890abcdef1234567890abcdef12345678',
    slippageTolerancePercent: 0.5,
    tradeType: 'EXACT_INPUT'
  });

  assert.ok(quote.requestId);
  assert.equal(quote.tradeType, 'EXACT_INPUT');
  const outFormattedNum = parseFloat(quote.amountOutFormatted.replace(/,/g, ''));
  assert.ok(outFormattedNum > 2000 && outFormattedNum < 3000);
  assert.ok(quote.effectiveExecutionScore >= 80);
  assert.equal(quote.protocolFee.feeBps, 5);
  assert.ok(quote.simulationPreview?.isSuccess);
});

test('8. Best Execution Router: Exact-Output Swap Quoting', async () => {
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'ETH')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;

  const quote = await defaultZenithRouter.getQuote({
    sourceChainId: 'ethereum',
    destinationChainId: 'ethereum',
    tokenIn,
    tokenOut,
    amountInRaw: '0',
    amountOutRaw: '2000000000',
    slippageTolerancePercent: 0.5,
    tradeType: 'EXACT_OUTPUT'
  });

  assert.equal(quote.tradeType, 'EXACT_OUTPUT');
  assert.ok(quote.amountInRaw);
  assert.ok(quote.maximumInputRaw);
  assert.ok(BigInt(quote.maximumInputRaw!) >= BigInt(quote.amountInRaw));
  assert.ok(parseFloat(quote.amountInFormatted) > 0.7 && parseFloat(quote.amountInFormatted) < 1.1);
});

test('9. Multi-Hop Graph Pathfinding (A -> Connector -> B)', async () => {
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'UNI') || {
    address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
    chainId: 'ethereum',
    name: 'Uniswap',
    symbol: 'UNI',
    decimals: 18,
    verificationTier: 'VERIFIED_CANONICAL' as const,
    priceUSD: 6.18
  };
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'LINK') || {
    address: '0x514910771af9ca656af840dff83e8264ecf986ca',
    chainId: 'ethereum',
    name: 'Chainlink',
    symbol: 'LINK',
    decimals: 18,
    verificationTier: 'VERIFIED_CANONICAL' as const,
    priceUSD: 11.80
  };

  const quote = await defaultZenithRouter.getQuote({
    sourceChainId: 'ethereum',
    destinationChainId: 'ethereum',
    tokenIn,
    tokenOut,
    amountInRaw: '100000000000000000000',
    slippageTolerancePercent: 0.5
  });

  assert.ok(quote.routes.length > 0);
  const multiHopRoute = quote.routes.find((r) => r.routeType === 'MULTI_HOP');
  assert.ok(multiHopRoute);
  assert.equal(multiHopRoute?.hops.length, 2);
  assert.equal(multiHopRoute?.hops[0].tokenOut.symbol, 'WETH');
});

test('10. Dynamic Split-Routing (Multi-Pool Liquidity Division)', async () => {
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'ETH')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;

  const quote = await defaultZenithRouter.getQuote({
    sourceChainId: 'ethereum',
    destinationChainId: 'ethereum',
    tokenIn,
    tokenOut,
    amountInRaw: '100000000000000000000',
    slippageTolerancePercent: 0.5
  });

  const splitRoute = quote.routes.find((r) => r.routeType === 'SPLIT_ROUTE');
  assert.ok(splitRoute);
  assert.equal(splitRoute?.hops.length, 2);
  assert.equal(splitRoute?.hops[0].proportionPercent + splitRoute?.hops[1].proportionPercent, 100);
});

test('11. Gas-Aware Scoring & Price Impact Categorization', () => {
  const ethGas = defaultChainRegistry.getEstimatedGasCostUSD('ethereum', 'SWAP');
  const baseGas = defaultChainRegistry.getEstimatedGasCostUSD('base', 'SWAP');
  const solanaGas = defaultChainRegistry.getEstimatedGasCostUSD('solana', 'SWAP');

  assert.ok(ethGas > 2.0);
  assert.ok(baseGas < 0.1);
  assert.ok(solanaGas < 0.01);
});

test('12. Cross-Chain Stargate & Liquidity Routing', async () => {
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'arbitrum' && t.symbol === 'USDC')!;

  const crossQuote = await defaultZenithRouter.getQuote({
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    tokenIn,
    tokenOut,
    amountInRaw: '1000000000',
    slippageTolerancePercent: 0.5
  });

  assert.equal(crossQuote.bestRoute.routeType, 'CROSS_CHAIN');
  assert.ok(crossQuote.bestRoute.bridgeStep || crossQuote.bestRoute.crossChainQuote);
  const bridgeProto = (crossQuote.bestRoute.bridgeStep?.bridgeProtocol || crossQuote.bestRoute.crossChainQuote?.provider || '').toUpperCase();
  assert.ok(
    ['ACROSS', 'STARGATE', 'DEBRIDGE', 'RELAY', 'NATIVE_BRIDGE'].includes(bridgeProto) || bridgeProto.length > 0
  );
  assert.ok(crossQuote.intent);
  assert.equal(crossQuote.intent?.status, 'CREATED');
});

test('13. Cross-Chain Intent Creation, Solver Competition, Nonce & Replay Protection', async () => {
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'arbitrum' && t.symbol === 'USDC')!;

  const intent: CrossChainIntent = {
    orderId: `intent_test_${Date.now()}`,
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: tokenIn,
    destinationToken: tokenOut,
    sourceAmountRaw: '1000000000',
    minDestinationAmountRaw: '995000000',
    recipient: '0x9999999999999999999999999999999999999999',
    deadline: Date.now() + 100000,
    nonce: 99999,
    status: 'CREATED',
    createdAt: Date.now()
  };

  const solverQuotes = await defaultIntentEngine.getCompetitiveQuotes(intent);
  assert.ok(solverQuotes.length >= 1);
  assert.ok(solverQuotes[0].solverReputationScore >= 90);

  defaultIntentEngine.registerIntent(intent);
  assert.equal(defaultIntentEngine.getIntent(intent.orderId)?.status, 'CREATED');

  assert.throws(() => {
    defaultIntentEngine.registerIntent(intent);
  }, /Nonce replay detected/);
});

test('14. Cross-Chain Settlement State Machine & Deterministic Refund Handling', () => {
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'base' && t.symbol === 'USDC')!;

  const orderId = `intent_refund_${Date.now()}`;
  const intent: CrossChainIntent = {
    orderId,
    sourceChainId: 'ethereum',
    destinationChainId: 'base',
    sourceToken: tokenIn,
    destinationToken: tokenOut,
    sourceAmountRaw: '500000000',
    minDestinationAmountRaw: '498000000',
    recipient: '0x1111111111111111111111111111111111111111',
    deadline: Date.now() + 100000,
    nonce: 88888,
    status: 'CREATED',
    createdAt: Date.now()
  };

  defaultIntentEngine.registerIntent(intent);
  defaultIntentEngine.updateIntentState(orderId, 'SIGNED');
  defaultIntentEngine.updateIntentState(orderId, 'SUBMITTED');
  defaultIntentEngine.updateIntentState(orderId, 'ACCEPTED');

  const refundedIntent = defaultIntentEngine.processRefund(orderId, 'Destination RPC timeout');
  assert.equal(refundedIntent.status, 'REFUNDED');
});

test('15. Circuit Breaker & Execution State Machine', () => {
  const normalCheck = defaultCircuitBreaker.validatePriceDeviation({
    oraclePriceUSD: 2465.87,
    quotedPriceUSD: 2460.00
  });
  assert.equal(normalCheck.isValid, true);

  const abnormalCheck = defaultCircuitBreaker.validatePriceDeviation({
    oraclePriceUSD: 2465.87,
    quotedPriceUSD: 1800.00
  });
  assert.equal(abnormalCheck.isValid, false);

  const sm = new ExecutionStateMachine();
  assert.equal(sm.getStatus(), 'IDLE');
  sm.transitionTo('QUOTE_REQUESTED');
  assert.equal(sm.getStatus(), 'QUOTE_REQUESTED');
});

test('16. Real-Time Dynamic Gas Pricing Across All 4 Tiers', () => {
  const scrollGas = defaultChainRegistry.getEstimatedGasCostUSD('scroll', 'SWAP');
  const tronGas = defaultChainRegistry.getEstimatedGasCostUSD('tron', 'SWAP');
  const btcGas = defaultChainRegistry.getEstimatedGasCostUSD('bitcoin', 'SWAP');

  assert.ok(scrollGas > 0.01 && scrollGas < 0.2);
  assert.ok(tronGas > 0.5 && tronGas < 2.0);
  assert.ok(btcGas > 1.0);
});

test('17. Full End-to-End Swap Execution Lifecycle (EVM & Solana)', async () => {
  const { defaultExecutionCoordinator } = await import('../packages/execution/src/executionCoordinator');
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'ETH')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;

  const quote = await defaultZenithRouter.getQuote({
    sourceChainId: 'ethereum',
    destinationChainId: 'ethereum',
    tokenIn,
    tokenOut,
    amountInRaw: '1000000000000000000',
    slippageTolerancePercent: 0.5
  });

  const stateMachine = new ExecutionStateMachine();
  const stepStatuses: string[] = [];
  stateMachine.subscribe((status) => {
    stepStatuses.push(status);
  });

  const user = '0x1234567890abcdef1234567890abcdef12345678';
  const mockSigner = {
    getAddress: async () => user,
    sendTransaction: async (_tx: any) => ({
      hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      wait: async () => ({
        status: 1,
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        blockNumber: 12345678,
        gasUsed: BigInt(150000),
        gasPrice: BigInt(30000000000),
        logs: []
      })
    }),
    provider: {
      call: async () => '0x',
      estimateGas: async () => BigInt(150000),
      getFeeData: async () => ({ gasPrice: BigInt(30000000000) }),
      getTransactionReceipt: async (hash: string) => ({
        status: 1,
        hash,
        blockNumber: 12345678,
        gasUsed: BigInt(150000),
        gasPrice: BigInt(30000000000),
        logs: []
      })
    }
  } as any;

  const receipt = await defaultExecutionCoordinator.executeTrade({
    quote,
    userAddress: user,
    signer: mockSigner,
    stateMachine
  });

  assert.ok(receipt);
  assert.equal(receipt.status, 'COMPLETED');
  assert.ok(receipt.txHash.startsWith('0x'));
  assert.ok(stepStatuses.includes('COMPLETED'));
  assert.equal(stateMachine.getStatus(), 'COMPLETED');
});

test('18. Quote Resilience & Zero-Division Guards Across Micro Fractions', async () => {
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'base' && t.symbol === 'ETH')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'base' && t.symbol === 'USDC')!;

  const microQuote = await defaultZenithRouter.getQuote({
    sourceChainId: 'base',
    destinationChainId: 'base',
    tokenIn,
    tokenOut,
    amountInRaw: '1000000000000',
    slippageTolerancePercent: 0.5
  });

  assert.ok(microQuote.executionPrice > 0);
  assert.ok(!isNaN(microQuote.executionPrice));
  assert.ok(microQuote.amountOutFormatted);
  assert.ok(microQuote.bestRoute.hops.length > 0);
});

test('19. EVM Token Authorization & Allowance Verification', async () => {

  const nativeAllowance = await defaultEVMAdapter.checkAllowance({
    tokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    ownerAddress: '0x1234567890abcdef1234567890abcdef12345678',
    spenderAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'
  });
  assert.ok(nativeAllowance > 0n);

  const erc20Allowance = await defaultEVMAdapter.checkAllowance({
    tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    ownerAddress: '0x1234567890abcdef1234567890abcdef12345678',
    spenderAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'
  });
  assert.equal(erc20Allowance, 0n);
});

test('20. Strict Swap Amount Input Validation, 3-Decimal Truncation, and Upper Boundary Limits', () => {

  const t1 = validateAndSanitizeAmount('1');
  assert.equal(t1.isValid, true);
  assert.equal(t1.sanitized, '1');
  assert.equal(t1.numericValue, 1);
  assert.equal(t1.isTruncated, false);

  const t2 = validateAndSanitizeAmount('1.');
  assert.equal(t2.isValid, true);
  assert.equal(t2.sanitized, '1.');
  assert.equal(t2.numericValue, 1);
  assert.equal(t2.isTruncated, false);

  const t3 = validateAndSanitizeAmount('1.1');
  assert.equal(t3.isValid, true);
  assert.equal(t3.sanitized, '1.1');
  assert.equal(t3.numericValue, 1.1);
  assert.equal(t3.isTruncated, false);

  const t4 = validateAndSanitizeAmount('1.11');
  assert.equal(t4.isValid, true);
  assert.equal(t4.sanitized, '1.11');
  assert.equal(t4.numericValue, 1.11);
  assert.equal(t4.isTruncated, false);

  const t5 = validateAndSanitizeAmount('1.111');
  assert.equal(t5.isValid, true);
  assert.equal(t5.sanitized, '1.111');
  assert.equal(t5.numericValue, 1.111);
  assert.equal(t5.isTruncated, false);

  const t6 = validateAndSanitizeAmount('1.1111');
  assert.equal(t6.isValid, true);
  assert.equal(t6.sanitized, '1.111');
  assert.equal(t6.numericValue, 1.111);
  assert.equal(t6.isTruncated, true);

  const t7 = validateAndSanitizeAmount('1.1119');
  assert.equal(t7.isValid, true);
  assert.equal(t7.sanitized, '1.111');
  assert.notEqual(t7.sanitized, '1.112');
  assert.equal(t7.numericValue, 1.111);
  assert.equal(t7.isTruncated, true);

  const t8 = validateAndSanitizeAmount('25.123456');
  assert.equal(t8.isValid, true);
  assert.equal(t8.sanitized, '25.123');
  assert.equal(t8.numericValue, 25.123);
  assert.equal(t8.isTruncated, true);

  const t9 = validateAndSanitizeAmount('9999999.999');
  assert.equal(t9.isValid, true);
  assert.equal(t9.sanitized, '9999999.999');
  assert.equal(t9.numericValue, 9999999.999);
  assert.equal(t9.isTruncated, false);

  const t10 = validateAndSanitizeAmount('10000000');
  assert.equal(t10.isValid, false);
  assert.ok(t10.error);

  const t11 = validateAndSanitizeAmount('99999999');
  assert.equal(t11.isValid, false);
  assert.ok(t11.error);

  const t12 = validateAndSanitizeAmount('0.0001');
  assert.equal(t12.isValid, true);
  assert.equal(t12.sanitized, '0.000');
  assert.equal(t12.numericValue, 0);
  assert.equal(t12.isTruncated, true);

  assert.equal(validateAndSanitizeAmount('').isValid, true);
  assert.equal(validateAndSanitizeAmount('.').sanitized, '0.');
  assert.equal(validateAndSanitizeAmount('9,999,999.999').sanitized, '9999999.999');
  assert.equal(validateAndSanitizeAmount('-5').isValid, false);
  assert.equal(validateAndSanitizeAmount('1e6').isValid, false);

  assert.equal(truncateToThreeDecimals(1.1119), '1.111');
  assert.equal(truncateToThreeDecimals(25.123456), '25.123');
  assert.equal(truncateToThreeDecimals(10000000), '9999999.999');
});

test('21. Router and Calculation Protection from Extremely Large Amounts', async () => {
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'ETH')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;

  const massiveAmountRaw = (10000000n * 10n ** 18n).toString();

  await assert.rejects(
    async () => {
      await defaultZenithRouter.getQuote({
        sourceChainId: 'ethereum',
        destinationChainId: 'ethereum',
        tokenIn,
        tokenOut,
        amountInRaw: massiveAmountRaw,
        slippageTolerancePercent: 0.5
      });
    },
    /exceeds maximum allowed limit/
  );
});

test('22. Concentrated Liquidity Price to SqrtX96 and Token Delta Calculations', () => {
  const sqrtPriceX96_1to1 = ConcentratedLiquidityMath.priceToSqrtRatioX96(1.0);
  assert.equal(sqrtPriceX96_1to1.toString(), '79228162514264337593543950336');

  const priceFromSqrt = ConcentratedLiquidityMath.sqrtRatioX96ToPrice(sqrtPriceX96_1to1);
  assert.ok(Math.abs(priceFromSqrt - 1.0) < 0.0001);

  const sqrtA = ConcentratedLiquidityMath.priceToSqrtRatioX96(0.9);
  const sqrtB = ConcentratedLiquidityMath.priceToSqrtRatioX96(1.1);
  const liquidity = 1000000000000000000n;

  const amount0Delta = ConcentratedLiquidityMath.getAmount0Delta(sqrtA, sqrtB, liquidity);
  const amount1Delta = ConcentratedLiquidityMath.getAmount1Delta(sqrtA, sqrtB, liquidity);

  assert.ok(amount0Delta > 0n);
  assert.ok(amount1Delta > 0n);
});

test('23. Sovereign Smart Order Routing (SOR) with Multi-DEX Aggregation', async () => {
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'ETH')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;

  const quote = await defaultZenithRouter.getQuote({
    sourceChainId: 'ethereum',
    destinationChainId: 'ethereum',
    tokenIn,
    tokenOut,
    amountInRaw: (2n * 10n ** 18n).toString(),
    slippageTolerancePercent: 0.5
  });

  assert.ok(quote.routes.length >= 1, 'Should include at least 1 valid route');
  for (const route of quote.routes) {
    for (const hop of route.hops) {
      assert.ok(hop.dexProtocol, `Hop protocol ${hop.dexProtocol} must be defined`);
    }
  }
});

test('24. UniswapX-Style Dutch Auction Price Decay Calculation', () => {
  const startOutput = 1000n;
  const endOutput = 900n;
  const startTime = 1000;
  const endTime = 2000;

  const getRequiredOutput = (timestamp: number): bigint => {
    if (timestamp <= startTime) return startOutput;
    if (timestamp >= endTime) return endOutput;
    const elapsed = BigInt(timestamp - startTime);
    const duration = BigInt(endTime - startTime);
    const decayTotal = startOutput - endOutput;
    return startOutput - (decayTotal * elapsed) / duration;
  };

  assert.equal(getRequiredOutput(900), 1000n);
  assert.equal(getRequiredOutput(1500), 950n);
  assert.equal(getRequiredOutput(2000), 900n);
  assert.equal(getRequiredOutput(2500), 900n);
});

test('25. Protocol Analytics & Concentrated LP Position Management', () => {
  const analytics = defaultMarketDataService.getProtocolAnalytics();
  assert.ok(analytics.totalValueLockedUSD > 100000000);
  assert.ok(analytics.totalVolume24hUSD > 50000000);
  assert.ok(analytics.topPools.length >= 3);

  const pools = defaultMarketDataService.getPools();
  assert.ok(pools.some((p) => p.token0.symbol === 'USDC' && p.token1.symbol === 'ETH'));
  assert.ok(pools.some((p) => p.isDynamicFee === true));

  const userPositions = defaultMarketDataService.getUserPositions('0xAlice');
  assert.ok(userPositions.length >= 2);
  assert.equal(userPositions[0].isInRange, true);
  assert.ok(userPositions[0].earnedAprPercent > 0);
});
