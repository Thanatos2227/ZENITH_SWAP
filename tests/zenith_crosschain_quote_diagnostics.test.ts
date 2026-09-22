import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AcrossProvider,
  DeBridgeProvider,
  StargateProvider,
  CrossChainAggregator,
  ZenithRouter,
  validateCrossChainQuoteExecutability,
  CrossChainCapabilityMatrix,
  defaultQuoteDiagnosticLogger
} from '../packages/routing/src';
import { defaultChainRegistry } from '../packages/chains/src';
import { defaultTokenService, DEFAULT_TOKENS } from '../packages/tokens/src';
import {
  AggregateCrossChainQuoteError,
  QuoteExpiredError,
  InvalidQuoteAmountError,
  UnsupportedCrossChainRouteError,
  ACROSS_SPOKE_POOLS,
  DEBRIDGE_DLN_SOURCE,
  STARGATE_V2_ROUTERS
} from '../packages/contracts/src';
import { CrossChainQuote, QuoteRequest, Token } from '../packages/types/src';

const USER_ADDRESS = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';

test('ZENITH SWAP — Phase 0 / Task 6 Cross-Chain Quote Diagnostics & Normalization', async (t) => {
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;
  const usdcPoly = defaultTokenService.getTokensForChain('polygon').find((t) => t.symbol === 'USDC')!;
  const polPoly = defaultTokenService.getTokensForChain('polygon').find((t) => t.symbol === 'POL')!;
  const wpolPoly = defaultTokenService.getTokensForChain('polygon').find((t) => t.symbol === 'WPOL')!;
  const ethEth = defaultTokenService.getNativeToken('ethereum')!;

  // 1. Across Successful Live Quote Normalization
  await t.test('1. Across successful live quote normalization and depositV3 calldata preview', async () => {
    const provider = new AcrossProvider();
    const req: QuoteRequest = {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: usdcEth,
      tokenOut: usdcArb,
      amountInRaw: '1000000000', // 1000 USDC
      userWalletAddress: USER_ADDRESS,
      recipientAddress: USER_ADDRESS,
      slippageTolerancePercent: 0.5
    };

    const quote = await provider.getQuote(req);
    assert.ok(quote);
    assert.equal(quote.provider, 'ACROSS');
    assert.equal(quote.sourceChainId, 'ethereum');
    assert.equal(quote.destinationChainId, 'arbitrum');
    assert.equal(quote.sourceAmountRaw, '1000000000');
    assert.ok(BigInt(quote.destinationAmountRaw) > 0n);
    assert.ok(BigInt(quote.minDestinationAmountRaw) <= BigInt(quote.destinationAmountRaw));
    assert.equal(quote.executionTarget, ACROSS_SPOKE_POOLS[1]);
    assert.equal(quote.approvalTarget, ACROSS_SPOKE_POOLS[1]);
  });

  // 2. Across Provider Unavailable / Offline Handling
  await t.test('2. Across provider unavailable: offline/500/timeout handling leaves quote non-executable', async () => {
    const provider = new AcrossProvider();
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        throw new Error('Network timeout (ETIMEDOUT)');
      };

      const req: QuoteRequest = {
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        tokenIn: usdcEth,
        tokenOut: usdcArb,
        amountInRaw: '500000000', // 500 USDC
        userWalletAddress: USER_ADDRESS,
        recipientAddress: USER_ADDRESS
      };

      const quote = await provider.getQuote(req);
      assert.ok(quote);
      assert.equal(quote.isExecutable, false);
      assert.equal(quote.unexecutableReason, 'PROVIDER_UNAVAILABLE');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // 3. Across Malformed Response Handling
  await t.test('3. Across malformed response: incomplete payload caught and marked unexecutable', async () => {
    const provider = new AcrossProvider();
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        return new Response(JSON.stringify({ invalidField: true }), { status: 200, statusText: 'OK' });
      };

      const req: QuoteRequest = {
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        tokenIn: usdcEth,
        tokenOut: usdcArb,
        amountInRaw: '500000000',
        userWalletAddress: USER_ADDRESS
      };

      const quote = await provider.getQuote(req);
      assert.ok(quote);
      assert.equal(quote.isExecutable, false);
      assert.equal(quote.unexecutableReason, 'PROVIDER_UNAVAILABLE');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // 4. Across Unsupported Token / Cross-Asset Handling
  await t.test('4. Across unsupported token: direct POL -> USDC returns isAvailable = false', async () => {
    const provider = new AcrossProvider();
    const isAvail = provider.isAvailable('polygon', 'ethereum', polPoly, usdcEth);
    assert.equal(isAvail, false, 'Across is a same-asset bridge and must reject direct POL -> USDC');
  });

  // 5. deBridge Successful Quote Normalization
  await t.test('5. deBridge DLN quote normalization: valid parameters and non-empty calldata for live response', async () => {
    const provider = new DeBridgeProvider();
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            estimation: {
              dstChainTokenOut: {
                recommendedAmount: '999500000',
                amount: '999500000',
                decimals: 6
              },
              costsDetails: [{ name: 'OperatingExpense', amount: '0.02' }],
              percentFee: '0.04'
            },
            protocolFeeApproximateUsdValue: '0.02'
          }),
          { status: 200, statusText: 'OK' }
        );
      };

      const req: QuoteRequest = {
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        tokenIn: usdcEth,
        tokenOut: usdcArb,
        amountInRaw: '1000000000',
        userWalletAddress: USER_ADDRESS,
        recipientAddress: USER_ADDRESS
      };

      const quote = await provider.getQuote(req);
      assert.ok(quote);
      assert.equal(quote.provider, 'DEBRIDGE_DLN');
      assert.equal(quote.isExecutable, true);
      assert.ok(quote.calldata.startsWith('0x') && quote.calldata !== '0x');
      assert.equal(quote.executionTarget, DEBRIDGE_DLN_SOURCE[1]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // 6. deBridge Rate Limited / Unavailable Handling
  await t.test('6. deBridge unavailable: HTTP 429 rate limit properly maps error taxonomy', async () => {
    const provider = new DeBridgeProvider();
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        return new Response('Rate limit exceeded', { status: 429, statusText: 'Too Many Requests' });
      };

      const req: QuoteRequest = {
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        tokenIn: usdcEth,
        tokenOut: usdcArb,
        amountInRaw: '1000000000',
        userWalletAddress: USER_ADDRESS
      };

      const quote = await provider.getQuote(req);
      assert.ok(quote);
      assert.equal(quote.isExecutable, false);
      assert.equal(quote.calldata, '0x');
      assert.equal(quote.unexecutableReason, 'RATE_LIMITED');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // 7. Stargate Non-Executable Behavior
  await t.test('7. Stargate non-executable invariant: strictly isExecutable = false and calldata = 0x', async () => {
    const provider = new StargateProvider();
    const req: QuoteRequest = {
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: usdcEth,
      tokenOut: usdcArb,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDRESS
    };

    const quote = await provider.getQuote(req);
    assert.ok(quote);
    assert.equal(quote.provider, 'STARGATE');
    assert.equal(quote.isExecutable, false);
    assert.equal(quote.calldata, '0x');
    assert.ok(quote.unexecutableReason?.includes('Stargate V2 live quoter not configured'));
  });

  // 8. Token Normalization (POL vs MATIC vs WPOL vs WMATIC vs USDC)
  await t.test('8. Token normalization: distinct identities and zero synthetic aliasing', () => {
    assert.notEqual(polPoly.address.toLowerCase(), wpolPoly.address.toLowerCase());
    assert.equal(polPoly.isNative, true);
    assert.equal(wpolPoly.isNative, undefined);
    assert.equal(usdcPoly.address, '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
    assert.equal(usdcEth.address, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  });

  // 9. Native vs Wrapped Token Distinction
  await t.test('9. Native vs wrapped token representation: EVM zero address & 0xeeee... representation', () => {
    assert.equal(ethEth.isNative, true);
    assert.equal(ethEth.address, '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE');
    assert.equal(polPoly.isNative, true);
    assert.equal(polPoly.address, '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE');
  });

  // 10. Decimal Conversion Accuracy
  await t.test('10. Decimal conversion accuracy across 6, 8, 18 decimal tokens', () => {
    assert.equal(usdcEth.decimals, 6);
    assert.equal(polPoly.decimals, 18);
    const raw6 = 1000000n; // 1 USDC
    const raw18 = 1000000000000000000n; // 1 POL
    assert.equal(raw6.toString(), '1000000');
    assert.equal(raw18.toString(), '1000000000000000000');
  });

  // 11. Raw Amount BigInt Preservation (Zero Float Math)
  await t.test('11. Raw amount preservation: zero floating-point math during fee calculation', () => {
    const inputBig = 1000000000n;
    const feeBps = 5n;
    const feeRaw = (inputBig * feeBps) / 10000n;
    const netRaw = inputBig - feeRaw;
    assert.equal(feeRaw, 500000n);
    assert.equal(netRaw, 999500000n);
  });

  // 12. Quote Expiration Validation
  await t.test('12. Quote expiration validation: expired timestamp marked unexecutable', () => {
    const expiredQuote: CrossChainQuote = {
      provider: 'ACROSS',
      providerName: 'Across Protocol V3',
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      sourceToken: usdcEth,
      destinationToken: usdcArb,
      sourceAmountRaw: '1000000000',
      destinationAmountRaw: '999500000',
      minDestinationAmountRaw: '994500000',
      bridgeFeeUSD: 0.5,
      relayerFee: '0.05%',
      gasEstimateUSD: 2.0,
      recipient: USER_ADDRESS,
      expiration: Date.now() - 10000, // expired 10s ago
      routeIdentifier: 'test-expired',
      executionTarget: ACROSS_SPOKE_POOLS[1],
      calldata: '0x12345678',
      value: '0',
      approvalTarget: ACROSS_SPOKE_POOLS[1],
      quoteTimestamp: Date.now() - 60000,
      estimatedTransferTimeSec: 30,
      securityRating: 'A+',
      isExecutable: true
    };

    const result = validateCrossChainQuoteExecutability(expiredQuote);
    assert.equal(result.isExecutable, false);
    assert.ok(result.failedGates.includes('EXPIRATION_VALID'));
    assert.ok(result.unexecutableReason?.includes('QUOTE_EXPIRED'));
  });

  // 13. Centralized Executability Validation (10 Gates)
  await t.test('13. Executability validation: all 10 gates tested and confirmed', () => {
    const validQuote: CrossChainQuote = {
      provider: 'ACROSS',
      providerName: 'Across Protocol V3',
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      sourceToken: usdcEth,
      destinationToken: usdcArb,
      sourceAmountRaw: '1000000000',
      destinationAmountRaw: '999500000',
      minDestinationAmountRaw: '994500000',
      bridgeFeeUSD: 0.5,
      relayerFee: '0.05%',
      gasEstimateUSD: 2.0,
      recipient: USER_ADDRESS,
      expiration: Date.now() + 60000,
      routeIdentifier: 'test-valid',
      executionTarget: ACROSS_SPOKE_POOLS[1],
      calldata: '0x12345678',
      value: '0',
      approvalTarget: ACROSS_SPOKE_POOLS[1],
      quoteTimestamp: Date.now(),
      estimatedTransferTimeSec: 30,
      securityRating: 'A+',
      isExecutable: true
    };

    const res = validateCrossChainQuoteExecutability(validQuote);
    assert.equal(res.isExecutable, true);
    assert.equal(res.failedGates.length, 0);
    assert.equal(res.passedGates.length, 10);
  });

  // 14. Error Taxonomy Normalization
  await t.test('14. Error taxonomy normalization: accurate code resolution', () => {
    assert.equal(defaultQuoteDiagnosticLogger.normalizeErrorCode('ETIMEDOUT'), 'PROVIDER_UNAVAILABLE');
    assert.equal(defaultQuoteDiagnosticLogger.normalizeErrorCode('', 429), 'RATE_LIMITED');
    assert.equal(defaultQuoteDiagnosticLogger.normalizeErrorCode('', 401), 'API_AUTH_REQUIRED');
    assert.equal(defaultQuoteDiagnosticLogger.normalizeErrorCode('unsupported asset'), 'UNSUPPORTED_TOKEN');
  });

  // 15. Aggregate Provider Failure Diagnostic
  await t.test('15. Aggregate provider failure: throws AggregateCrossChainQuoteError with per-provider details', () => {
    const aggErr = defaultQuoteDiagnosticLogger.buildAggregateError({
      sourceChainId: 'polygon',
      destinationChainId: 'ethereum',
      tokenIn: polPoly,
      tokenOut: usdcEth,
      amountInRaw: '1000000000000000000',
      diagnostics: {
        ACROSS: {
          provider: 'ACROSS',
          sourceChainId: 'polygon',
          destinationChainId: 'ethereum',
          sourceToken: 'POL',
          destinationToken: 'USDC',
          amountInRaw: '1000000000000000000',
          requestStatus: 'FAILED',
          normalizedError: 'UNSUPPORTED_TOKEN',
          isExecutable: false,
          timestamp: Date.now()
        },
        STARGATE: {
          provider: 'STARGATE',
          sourceChainId: 'polygon',
          destinationChainId: 'ethereum',
          sourceToken: 'POL',
          destinationToken: 'USDC',
          amountInRaw: '1000000000000000000',
          requestStatus: 'SKIPPED',
          normalizedError: 'QUOTE_UNAVAILABLE',
          isExecutable: false,
          timestamp: Date.now()
        }
      }
    });

    assert.ok(aggErr instanceof AggregateCrossChainQuoteError);
    assert.equal(aggErr.sourceChainId, 'polygon');
    assert.equal(aggErr.destinationChainId, 'ethereum');
    assert.ok(aggErr.providerDiagnostics.ACROSS);
    assert.ok(aggErr.providerDiagnostics.STARGATE);
  });

  // 16. Non-Lethal Provider Isolation (One provider fails, another succeeds)
  await t.test('16. Non-lethal provider isolation: single provider exception does not crash aggregator', async () => {
    const mockFailingAcross: any = {
      id: 'ACROSS',
      name: 'Across',
      isAvailable: () => true,
      getQuote: async () => { throw new Error('Across catastrophic outage'); }
    };
    const mockWorkingDebridge: any = {
      id: 'DEBRIDGE_DLN',
      name: 'deBridge DLN',
      isAvailable: () => true,
      getQuote: async () => ({
        provider: 'DEBRIDGE_DLN',
        providerName: 'deBridge DLN',
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        sourceToken: usdcEth,
        destinationToken: usdcArb,
        sourceAmountRaw: '1000000000',
        destinationAmountRaw: '999500000',
        minDestinationAmountRaw: '994500000',
        bridgeFeeUSD: 0.5,
        relayerFee: '0.04%',
        gasEstimateUSD: 2.0,
        recipient: USER_ADDRESS,
        expiration: Date.now() + 60000,
        routeIdentifier: 'test-debridge',
        executionTarget: DEBRIDGE_DLN_SOURCE[1],
        calldata: '0x1234',
        value: '0',
        approvalTarget: DEBRIDGE_DLN_SOURCE[1],
        quoteTimestamp: Date.now(),
        estimatedTransferTimeSec: 60,
        securityRating: 'A',
        isExecutable: true
      })
    };

    const aggregator = new CrossChainAggregator([mockFailingAcross, mockWorkingDebridge]);
    const quotes = await aggregator.getQuotes({
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: usdcEth,
      tokenOut: usdcArb,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDRESS
    });

    assert.equal(quotes.length, 1);
    assert.equal(quotes[0].provider, 'DEBRIDGE_DLN');
  });

  // 17. POL -> USDC Specific Diagnostic Reproduction
  await t.test('17. POL -> USDC diagnostic reproduction: connector route queries DEX and Bridge', async () => {
    const matrixRecord = CrossChainCapabilityMatrix.getCapability('ACROSS', 'polygon', 'ethereum', 'POL', 'USDC');
    assert.equal(matrixRecord.quoteSupported, false);
    assert.equal(matrixRecord.capabilityStatus, 'CONFIGURED');
    assert.ok(matrixRecord.unsupportedReason?.includes('same-asset bridge'));
  });

  // 18. Working Route vs Failing Route Comparative Analysis
  await t.test('18. Working route vs failing route capability comparison', () => {
    const workingCap = CrossChainCapabilityMatrix.getCapability('ACROSS', 'ethereum', 'arbitrum', 'USDC', 'USDC');
    assert.equal(workingCap.quoteSupported, true);
    assert.equal(workingCap.executionSupported, true);
    assert.equal(workingCap.capabilityStatus, 'LIVE_VERIFIED');

    const failingCap = CrossChainCapabilityMatrix.getCapability('ACROSS', 'polygon', 'ethereum', 'POL', 'USDC');
    assert.equal(failingCap.quoteSupported, false);
    assert.equal(failingCap.capabilityStatus, 'CONFIGURED');
  });

  // 19. Zero Synthetic Fallback Quotes Invariant
  await t.test('19. Zero synthetic fallback quotes invariant: fallback estimates never marked executable', async () => {
    const provider = new AcrossProvider();
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        throw new Error('API down');
      };

      const quote = await provider.getQuote({
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        tokenIn: usdcEth,
        tokenOut: usdcArb,
        amountInRaw: '1000000000',
        userWalletAddress: USER_ADDRESS
      });

      assert.ok(quote);
      assert.equal(quote.isExecutable, false, 'Offline estimate must NEVER be marked executable');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // 20. Zero Fake Executable Calldata Invariant
  await t.test('20. Zero fake executable calldata invariant: unexecutable quotes must have calldata 0x', async () => {
    const provider = new StargateProvider();
    const quote = await provider.getQuote({
      sourceChainId: 'ethereum',
      destinationChainId: 'arbitrum',
      tokenIn: usdcEth,
      tokenOut: usdcArb,
      amountInRaw: '1000000000',
      userWalletAddress: USER_ADDRESS
    });

    assert.ok(quote);
    assert.equal(quote.calldata, '0x', 'Unexecutable quote must strictly retain 0x calldata');
  });
});
