import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import {
  CrossChainAggregator,
  AcrossProvider,
  StargateProvider,
  DeBridgeProvider,
  defaultCrossChainAggregator,
  RouteFreshnessValidator,
  RouteNormalizer
} from '../packages/routing/src';
import {
  ExecutionCoordinator,
  CrossChainTracker,
  assertByteForByteEquivalence
} from '../packages/execution/src';
import {
  RecipientMismatchError,
  SignerRequiredError,
  ACROSS_SPOKE_POOLS,
  ACROSS_SPOKE_POOL_ABI,
  STARGATE_V2_ROUTERS,
  DEBRIDGE_DLN_SOURCE,
  getZenithTreasuryAddress,
  getUniswapV3Router,
  getPermit2Address
} from '../packages/contracts/src';
import { DEFAULT_TOKENS } from '../packages/tokens/src';
import { CrossChainIntent, SwapRoute, CrossChainQuote } from '../packages/types/src';

test('Contracts Registry: Across, Stargate, deBridge, and Fail-Closed Treasury', () => {

  assert.equal(ACROSS_SPOKE_POOLS[1], '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5');
  assert.equal(ACROSS_SPOKE_POOLS[42161], '0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A');
  assert.equal(ACROSS_SPOKE_POOLS[10], '0x6f26Bf09B1C792e3228e5467807a900A503c0281');
  assert.equal(ACROSS_SPOKE_POOLS[8453], '0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64');

  assert.equal(STARGATE_V2_ROUTERS[1], '0x8731d54E9D02c286767d56ac03e8037C07e01e98');
  assert.equal(STARGATE_V2_ROUTERS[42161], '0x53Bf833A5d6c4ddA888F69c22C88C9f356a41614');

  assert.equal(DEBRIDGE_DLN_SOURCE[1], '0xeF4fB24aD0916217251F553c0596F8Edc630EB66');

  assert.equal(getPermit2Address(1), '0x000000000022D473030F116dDEE9F6B43aC78BA3');
  assert.equal(getPermit2Address(42161), '0x000000000022D473030F116dDEE9F6B43aC78BA3');

  assert.equal(getUniswapV3Router(1), '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45');
  assert.equal(getUniswapV3Router(8453), '0x2626664c2603336E57B271c5C0b26F421741e481');

  assert.throws(() => {
    getZenithTreasuryAddress(1);
  }, /ZENITH Treasury address is not configured/);

  assert.throws(() => {
    getZenithTreasuryAddress(42161);
  }, /ZENITH Treasury address is not configured/);
});

test('Across V3 Provider: Quote Generation and Exact swapTx Execution', async () => {
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'arbitrum' && t.symbol === 'USDC')!;
  const user = '0x1234567890123456789012345678901234567890';

  assert.ok(tokenIn && tokenOut);

  const mockFetch = async () => {
    return new Response(JSON.stringify({
      swapTx: {
        to: ACROSS_SPOKE_POOLS[1],
        data: '0x7b9392320000000000000000000000001234567890123456789012345678901234567890',
        value: '0',
        chainId: 1
      },
      outputAmount: '999500000',
      quoteExpiryTimestamp: Math.floor(Date.now() / 1000) + 300,
      fees: { total: { amount: '500000', pct: '0.0005' } }
    }), { status: 200, statusText: 'OK' });
  };

  const provider = new AcrossProvider({
    apiKey: 'test_key',
    integratorId: '0x0001',
    fetchFn: mockFetch as any
  });

  const quote = await provider.getQuote({
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    tokenIn,
    tokenOut,
    amountInRaw: '1000000000',
    userWalletAddress: user,
    recipientAddress: user,
    slippageTolerancePercent: 0.5
  });

  assert.ok(quote);
  assert.equal(quote.provider, 'ACROSS');
  assert.equal(quote.executionTarget.toLowerCase(), ACROSS_SPOKE_POOLS[1].toLowerCase());
  assert.ok(BigInt(quote.destinationAmountRaw) > 0n);
  assert.ok(quote.calldata.startsWith('0x'));
  assert.equal(quote.calldata, '0x7b9392320000000000000000000000001234567890123456789012345678901234567890');

  const sampleQuote: CrossChainQuote = {
    provider: 'ACROSS',
    providerName: 'Across Protocol V3',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: tokenIn,
    destinationToken: tokenOut,
    sourceAmountRaw: '1000000000',
    destinationAmountRaw: '999500000',
    minDestinationAmountRaw: '994502500',
    bridgeFeeUSD: 0.5,
    relayerFee: '0.05%',
    gasEstimateUSD: 5,
    recipient: user,
    expiration: Date.now() + 300000,
    routeIdentifier: 'across-eth-arb',
    executionTarget: ACROSS_SPOKE_POOLS[1],
    calldata: '0x7b9392320000000000000000000000001234567890123456789012345678901234567890',
    value: '0',
    approvalTarget: ACROSS_SPOKE_POOLS[1],
    quoteTimestamp: Date.now(),
    estimatedTransferTimeSec: 30,
    securityRating: 'A+',
    isExecutable: true
  };

  const execution = await provider.buildExecution(sampleQuote, user, user);
  assert.equal(execution.to.toLowerCase(), ACROSS_SPOKE_POOLS[1].toLowerCase());
  assert.equal(execution.approvalTarget?.toLowerCase(), ACROSS_SPOKE_POOLS[1].toLowerCase());
  assert.ok(execution.data.startsWith('0x'));
});

test('Across V3 Provider: Timestamp Semantics (Protocol Snapshot vs ZENITH Ingestion Freshness)', async () => {
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'arbitrum' && t.symbol === 'USDC')!;
  const user = '0x1234567890123456789012345678901234567890';

  assert.ok(tokenIn && tokenOut);

  const nowMs = Date.now();
  const protocolTimestampSec = Math.floor(nowMs / 1000) - 10;
  const quoteExpiryTimestamp = protocolTimestampSec + 300;

  const mockFetch = async () => {
    return new Response(
      JSON.stringify({
        swapTx: {
          to: ACROSS_SPOKE_POOLS[1],
          data: '0x7b9392320000000000000000000000001234567890123456789012345678901234567890',
          value: '0',
          chainId: 1
        },
        outputAmount: '999500000',
        quoteExpiryTimestamp,
        timestamp: protocolTimestampSec.toString(),
        fees: { total: { amount: '500000', pct: '0.0005' } }
      }),
      { status: 200, statusText: 'OK' }
    );
  };

  const provider = new AcrossProvider({
    apiKey: 'test_key',
    integratorId: '0x0001',
    fetchFn: mockFetch as any
  });

  const beforeIngestion = Date.now();
  const req = {
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    tokenIn,
    tokenOut,
    amountInRaw: '1000000000',
    userWalletAddress: user,
    recipientAddress: user,
    slippageTolerancePercent: 0.5
  };
  const quote = await provider.getQuote(req);
  const afterIngestion = Date.now();

  assert.ok(quote);
  assert.equal(quote.provider, 'ACROSS');
  assert.equal(quote.isExecutable, true);

  // Requirement 1: Across protocol timestamp is preserved
  assert.strictEqual(quote.protocolTimestampSec, protocolTimestampSec);

  // Requirement 2: ZENITH quoteTimestamp represents ingestion time (~Date.now()), NOT T * 1000
  assert.ok(quote.quoteTimestamp >= beforeIngestion && quote.quoteTimestamp <= afterIngestion);
  assert.notStrictEqual(quote.quoteTimestamp, protocolTimestampSec * 1000);
  assert.ok(Math.abs(quote.quoteTimestamp - Date.now()) < 5000);

  // Requirement 4: buildExecution() produces valid swapTx execution payload
  const execution = await provider.buildExecution(quote, user, user);
  assert.equal(execution.to.toLowerCase(), ACROSS_SPOKE_POOLS[1].toLowerCase());
  assert.equal(execution.data, '0x7b9392320000000000000000000000001234567890123456789012345678901234567890');
  assert.equal(execution.approvalTarget?.toLowerCase(), ACROSS_SPOKE_POOLS[1].toLowerCase());
  assert.strictEqual(quote.calldata.toLowerCase(), execution.data.toLowerCase());

  // Requirement 5: Freshness validator validates freshly quoted route
  const normalized = RouteNormalizer.normalizeQuote(quote, req);
  const freshness = RouteFreshnessValidator.validate(normalized.quotedAt, normalized.expiresAt);
  assert.strictEqual(freshness.isExecutable, true);
  assert.strictEqual(freshness.isFresh, true);
  assert.strictEqual(freshness.state, 'FRESH');

  // Requirement 6: The existing 60-second freshness boundary remains strictly enforced on stale ingestion age
  const staleIngestionTime = Date.now() - 65000; // 65 seconds ago
  const staleFreshness = RouteFreshnessValidator.validate(staleIngestionTime, Date.now() + 60000);
  assert.strictEqual(staleFreshness.isExecutable, false);
  assert.strictEqual(staleFreshness.isFresh, false);
  assert.match(staleFreshness.reason || '', /QUOTE_STALE/);
});

test('Stargate V2 Provider: Quote Generation & Calldata Encoding', async () => {
  const provider = new StargateProvider();
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDT')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'arbitrum' && t.symbol === 'USDT')!;
  const user = '0x1234567890123456789012345678901234567890';

  const quote = await provider.getQuote({
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    tokenIn,
    tokenOut,
    amountInRaw: '500000000',
    recipient: user,
    slippageTolerancePercent: 0.5
  });

  assert.ok(quote);
  assert.equal(quote.provider, 'STARGATE');
  assert.equal(quote.executionTarget, STARGATE_V2_ROUTERS[1]);
  assert.ok(BigInt(quote.destinationAmountRaw) > 0n);
  assert.ok(quote.calldata.startsWith('0x'));
});

test('deBridge DLN Provider: Quote Generation & Calldata Encoding', async () => {
  const provider = new DeBridgeProvider();
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'polygon' && t.symbol === 'USDC')!;
  const user = '0x1234567890123456789012345678901234567890';

  const quote = await provider.getQuote({
    sourceChainId: 'ethereum',
    destinationChainId: 'polygon',
    tokenIn,
    tokenOut,
    amountInRaw: '200000000',
    recipient: user,
    slippageTolerancePercent: 0.5
  });

  if (quote) {
    assert.equal(quote.provider, 'DEBRIDGE_DLN');
    assert.equal(quote.executionTarget, DEBRIDGE_DLN_SOURCE[1]);
    assert.ok(BigInt(quote.destinationAmountRaw) > 0n);
    assert.ok(quote.calldata.startsWith('0x'));
  }

  const sampleQuote: CrossChainQuote = {
    provider: 'DEBRIDGE_DLN',
    providerName: 'deBridge DLN',
    sourceChainId: 'ethereum',
    destinationChainId: 'polygon',
    sourceToken: tokenIn,
    destinationToken: tokenOut,
    sourceAmountRaw: '200000000',
    destinationAmountRaw: '199840000',
    minDestinationAmountRaw: '198840800',
    bridgeFeeUSD: 0.2,
    relayerFee: '0.04%',
    gasEstimateUSD: 4,
    recipient: user,
    expiration: Date.now() + 300000,
    routeIdentifier: 'debridge-eth-poly',
    executionTarget: DEBRIDGE_DLN_SOURCE[1],
    calldata: '0x',
    value: '0',
    approvalTarget: DEBRIDGE_DLN_SOURCE[1],
    quoteTimestamp: Date.now(),
    estimatedTransferTimeSec: 15,
    securityRating: 'A'
  };

  const execution = await provider.buildExecution(sampleQuote, user, user);
  assert.equal(execution.to.toLowerCase(), DEBRIDGE_DLN_SOURCE[1].toLowerCase());
  assert.equal(execution.approvalTarget?.toLowerCase(), DEBRIDGE_DLN_SOURCE[1].toLowerCase());
  assert.ok(execution.data.startsWith('0x'));
});

test('CrossChainAggregator: Multi-Provider Quote Ranking and Fallback', async () => {
  const aggregator = defaultCrossChainAggregator;
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'arbitrum' && t.symbol === 'USDC')!;
  const user = '0x1234567890123456789012345678901234567890';

  const quotes = await aggregator.getQuotes({
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    tokenIn,
    tokenOut,
    amountInRaw: '1000000000',
    recipient: user,
    slippageTolerancePercent: 0.5
  });

  assert.ok(quotes.length >= 1, 'Should return available bridge quotes');
  assert.ok(quotes[0].destinationAmountRaw, 'Best quote should have destination amount');

  for (let i = 0; i < quotes.length - 1; i++) {
    assert.ok(
      BigInt(quotes[i].destinationAmountRaw) >= BigInt(quotes[i + 1].destinationAmountRaw),
      'Quotes must be ranked with highest destination amount first'
    );
  }

  const bestQuote = await aggregator.getBestQuote({
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    tokenIn,
    tokenOut,
    amountInRaw: '1000000000',
    recipient: user,
    slippageTolerancePercent: 0.5
  });

  assert.ok(bestQuote);
  assert.ok(BigInt(bestQuote.destinationAmountRaw) > 0n);
});

test('Security Invariant: Recipient Mismatch Must Fail Closed with RecipientMismatchError', async () => {
  const connectedUser = '0x1234567890123456789012345678901234567890';
  const attackerAddress = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'arbitrum' && t.symbol === 'USDC')!;

  const bestQuote = await defaultCrossChainAggregator.getBestQuote({
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    tokenIn,
    tokenOut,
    amountInRaw: '100000000',
    recipient: connectedUser,
    slippageTolerancePercent: 0.5
  });

  assert.ok(bestQuote);

  const intent: CrossChainIntent = {
    orderId: 'intent-tampered-01',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: tokenIn,
    destinationToken: tokenOut,
    sourceAmountRaw: '100000000',
    minDestinationAmountRaw: bestQuote.destinationAmountRaw,
    recipient: attackerAddress,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    nonce: 1,
    solverId: bestQuote.provider,
    status: 'CREATED',
    createdAt: Date.now()
  };

  const dummyRoute: SwapRoute = {
    id: 'route-tampered-recipient',
    routeType: 'CROSS_CHAIN',
    hops: [],
    estimatedGasUnits: 150000n,
    dexKey: 'ACROSS_V3',
    dexName: 'Across V3',
    path: [tokenIn, tokenOut],
    pools: [],
    amountInRaw: '100000000',
    amountInFormatted: '100 USDC',
    amountOutRaw: bestQuote.destinationAmountRaw,
    amountOutFormatted: '99.9 USDC',
    priceImpact: { percentage: 0.1, priceImpactUSD: 0.1, severity: 'LOW' },
    gasCostUSD: 5,
    effectiveExecutionScore: 98,
    crossChainQuote: bestQuote
  };

  const quoteResponse = {
    requestId: 'quote-tampered-recipient',
    request: {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn,
      tokenOut,
      amountInRaw: '100000000',
      slippageTolerancePercent: 0.5,
      recipientAddress: attackerAddress
    },
    tradeType: 'EXACT_INPUT' as const,
    routes: [dummyRoute],
    bestRoute: dummyRoute,
    amountInRaw: '100000000',
    amountInFormatted: '100',
    amountOutRaw: bestQuote.destinationAmountRaw,
    amountOutFormatted: '99.9',
    minimumReceivedRaw: bestQuote.destinationAmountRaw,
    minimumReceivedFormatted: '99.9',
    executionPrice: 0.999,
    priceImpact: { percentage: 0.1, priceImpactUSD: 0.1, severity: 'LOW' as const },
    protocolFee: { feeBps: 0, feeAmountRaw: '0', feeAmountFormatted: '0', feeUSD: 0 },
    swapFee: { feeBps: 10, feeAmountRaw: '100000', feeAmountFormatted: '0.1', feeUSD: 0.1 },
    effectiveExecutionScore: 98,
    quoteTimestamp: Date.now(),
    expiresAt: Date.now() + 60000,
    deadline: Date.now() + 1200000,
    freshnessSeconds: 15,
    intent
  };

  const coordinator = new ExecutionCoordinator();

  await assert.rejects(
    async () => {
      await coordinator.executeTrade({
        quote: quoteResponse,
        userAddress: connectedUser
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof RecipientMismatchError);
      return true;
    }
  );
});

test('Execution Invariant: Signer Required for Real EVM Execution', async () => {
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'arbitrum' && t.symbol === 'USDC')!;
  const user = '0x1234567890123456789012345678901234567890';

  const bestQuote = await defaultCrossChainAggregator.getBestQuote({
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    tokenIn,
    tokenOut,
    amountInRaw: '100000000',
    recipient: user,
    slippageTolerancePercent: 0.5
  });

  assert.ok(bestQuote);

  const intent: CrossChainIntent = {
    orderId: 'intent-signer-test-' + Date.now(),
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceToken: tokenIn,
    destinationToken: tokenOut,
    sourceAmountRaw: '100000000',
    minDestinationAmountRaw: bestQuote.destinationAmountRaw,
    recipient: user,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    nonce: Date.now() + 5000,
    solverId: bestQuote.provider,
    status: 'CREATED',
    createdAt: Date.now()
  };

  const dummyRoute: SwapRoute = {
    id: 'route-signer-test',
    routeType: 'CROSS_CHAIN',
    hops: [],
    estimatedGasUnits: 150000n,
    dexKey: 'ACROSS_V3',
    dexName: 'Across V3',
    path: [tokenIn, tokenOut],
    pools: [],
    amountInRaw: '100000000',
    amountInFormatted: '100 USDC',
    amountOutRaw: bestQuote.destinationAmountRaw,
    amountOutFormatted: '99.9 USDC',
    priceImpact: { percentage: 0.1, priceImpactUSD: 0.1, severity: 'LOW' },
    gasCostUSD: 5,
    effectiveExecutionScore: 98,
    crossChainQuote: bestQuote
  };

  const quoteResponse = {
    requestId: 'quote-signer-test',
    request: {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn,
      tokenOut,
      amountInRaw: '100000000',
      slippageTolerancePercent: 0.5,
      recipientAddress: user
    },
    tradeType: 'EXACT_INPUT' as const,
    routes: [dummyRoute],
    bestRoute: dummyRoute,
    amountInRaw: '100000000',
    amountInFormatted: '100',
    amountOutRaw: bestQuote.destinationAmountRaw,
    amountOutFormatted: '99.9',
    minimumReceivedRaw: bestQuote.destinationAmountRaw,
    minimumReceivedFormatted: '99.9',
    executionPrice: 0.999,
    priceImpact: { percentage: 0.1, priceImpactUSD: 0.1, severity: 'LOW' as const },
    protocolFee: { feeBps: 0, feeAmountRaw: '0', feeAmountFormatted: '0', feeUSD: 0 },
    swapFee: { feeBps: 10, feeAmountRaw: '100000', feeAmountFormatted: '0.1', feeUSD: 0.1 },
    effectiveExecutionScore: 98,
    quoteTimestamp: Date.now(),
    expiresAt: Date.now() + 60000,
    deadline: Date.now() + 1200000,
    freshnessSeconds: 15,
    intent
  };

  const coordinator = new ExecutionCoordinator();

  await assert.rejects(
    async () => {
      await coordinator.executeTrade({
        quote: quoteResponse,
        userAddress: user

      });
    },
    (err: any) => {
      assert.ok(
        err instanceof SignerRequiredError ||
        err?.name === 'SignerRequiredError' ||
        err?.code === 'SIGNER_REQUIRED' ||
        (err?.message && err.message.includes('Wallet signer is required'))
      );
      return true;
    }
  );
});

test('CrossChainTracker: Order Lifecycle Tracking and Destination RPC Verification', async () => {
  const tracker = new CrossChainTracker();
  const tokenIn = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC')!;
  const tokenOut = DEFAULT_TOKENS.find((t) => t.chainId === 'arbitrum' && t.symbol === 'USDC')!;
  const user = '0x1234567890123456789012345678901234567890';

  const orderId = 'test-order-' + Date.now();
  tracker.registerOrder({
    orderId,
    provider: 'ACROSS',
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    sourceTxHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    recipient: user,
    quote: {
      provider: 'ACROSS',
      providerName: 'Across V3',
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      sourceToken: tokenIn,
      destinationToken: tokenOut,
      sourceAmountRaw: '100000000',
      destinationAmountRaw: '99900000',
      minDestinationAmountRaw: '99500000',
      bridgeFeeUSD: 0.1,
      relayerFee: '0',
      gasEstimateUSD: 5,
      recipient: user,
      expiration: Math.floor(Date.now() / 1000) + 3600,
      routeIdentifier: 'across-eth-arb',
      estimatedTransferTimeSec: 120,
      executionTarget: ACROSS_SPOKE_POOLS[1],
      calldata: '0x',
      value: '0',
      approvalTarget: ACROSS_SPOKE_POOLS[1],
      quoteTimestamp: Math.floor(Date.now() / 1000),
      securityRating: 'A+'
    },
    status: 'SUBMITTED',
    createdAt: Date.now(),
    lastUpdated: Date.now()
  });

  assert.equal(tracker.getAllActiveOrders().length, 1);
  const order = tracker.getOrder(orderId);
  assert.ok(order);
  assert.equal(order.status, 'SUBMITTED');

  const verification = await tracker.verifyDestinationSettlement({
    destinationChainId: 'arbitrum',
    destinationTxHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
    expectedRecipient: user
  });
  assert.ok(typeof verification.isVerified === 'boolean');
});
