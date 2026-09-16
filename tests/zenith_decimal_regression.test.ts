import { describe, it } from 'node:test';
import assert from 'node:assert';
import { defaultZenithRouter, parseTokenUnits, formatTokenUnits } from '@zenith/routing';
import { Token, QuoteRequest } from '@zenith/types';

describe('ZENITH — Decimal Normalization & POL → USDT Quote Regression Suite', () => {
  const polToken: Token = {
    address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    chainId: 'polygon',
    name: 'Polygon Ecosystem Token',
    symbol: 'POL',
    decimals: 18,
    isNative: true,
    priceUSD: 0.09787,
    verificationTier: 'VERIFIED_CANONICAL'
  };

  const usdtToken: Token = {
    address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    chainId: 'polygon',
    name: 'Tether USD',
    symbol: 'USDT',
    decimals: 6,
    isNative: false,
    priceUSD: 1.0,
    verificationTier: 'VERIFIED_CANONICAL'
  };

  describe('1. Bi-Directional Unit Conversions (human <-> raw)', () => {
    it('accurately converts POL (18 decimals) between human and raw units', () => {

      const raw01 = parseTokenUnits('0.1', 18);
      assert.strictEqual(raw01, '100000000000000000', '0.1 POL must equal 10^17 raw units');
      assert.strictEqual(formatTokenUnits(raw01, 18), '0.1', '10^17 raw units must format back to 0.1 POL');

      const raw1 = parseTokenUnits('1.0', 18);
      assert.strictEqual(raw1, '1000000000000000000', '1.0 POL must equal 10^18 raw units');
      assert.strictEqual(formatTokenUnits(raw1, 18), '1.0', '10^18 raw units must format back to 1.0 POL');

      const raw1Plain = parseTokenUnits('1', 18);
      assert.strictEqual(raw1Plain, '1000000000000000000', '"1" POL must equal 10^18 raw units');

      const raw2 = parseTokenUnits('2.0', 18);
      assert.strictEqual(raw2, '2000000000000000000', '2.0 POL must equal 2 * 10^18 raw units');
      assert.strictEqual(formatTokenUnits(raw2, 18), '2.0', '2 * 10^18 raw units must format back to 2.0 POL');
    });

    it('accurately converts USDT (6 decimals) between human and raw units', () => {

      const rawUsdt1 = parseTokenUnits('1.0', 6);
      assert.strictEqual(rawUsdt1, '1000000', '1.0 USDT must equal 1,000,000 raw units');
      assert.strictEqual(formatTokenUnits(rawUsdt1, 6), '1.0', '1,000,000 raw units must format back to 1.0 USDT');

      const rawUsdtExpected = parseTokenUnits('0.09787', 6);
      assert.strictEqual(rawUsdtExpected, '97870', '0.09787 USDT must equal 97,870 raw units');
      assert.strictEqual(formatTokenUnits(rawUsdtExpected, 6), '0.09787', '97,870 raw units must format back to 0.09787 USDT');
    });
  });

  describe('2. POL → USDT Executable Quote Sanity (1.0 POL Input)', () => {
    it('produces ~0.0975 USDT output for 1.0 POL and strictly NOT a 10^12 magnified value', async () => {
      const rawAmountIn = parseTokenUnits('1.0', 18);
      const quote = await defaultZenithRouter.getQuote({
        sourceChainId: 'polygon',
        destinationChainId: 'polygon',
        tokenIn: polToken,
        tokenOut: usdtToken,
        amountInRaw: rawAmountIn,
        slippageTolerancePercent: 0.5
      });

      assert.ok(quote, 'Quote must be successfully generated');
      assert.strictEqual(quote.amountInRaw, '1000000000000000000', 'amountInRaw must be 10^18');

      const outNum = parseFloat(quote.amountOutFormatted.replace(/,/g, ''));
      const rawOutBig = BigInt(quote.amountOutRaw);

      assert.ok(outNum >= 0.095 && outNum <= 0.105, `Expected ~0.099 USDT, got ${outNum}`);
      assert.ok(outNum < 1.0, `Output ${outNum} MUST NOT exceed 1.0 USDT for 1.0 POL`);
      assert.ok(rawOutBig >= 95000n && rawOutBig <= 105000n, `Raw out ${rawOutBig} must be in 6-decimal range (95,000 to 105,000)`);

      assert.ok(quote.executionPrice >= 0.095 && quote.executionPrice <= 0.105, `executionPrice must be ~0.099, got ${quote.executionPrice}`);
      assert.strictEqual(quote.referencePrice, 0.09787, 'referencePrice must match market ratio');

      const minReceivedBig = BigInt(quote.minimumReceivedRaw);
      assert.ok(minReceivedBig < rawOutBig, 'minReceived must be strictly less than amountOutRaw with positive slippage');
      assert.ok(minReceivedBig > 0n, 'minReceived must be positive');
      assert.ok(minReceivedBig < 1000000n, 'minReceived must be in 6-decimal range (< 1 USDT)');

      assert.strictEqual(quote.bestRoute.routeType !== 'CROSS_CHAIN', true, 'Same-chain trade must use DEX routing, not bridge');
      assert.ok(quote.bestRoute.hops.length > 0, 'DEX route must have hops on Polygon');
    });
  });

  describe('3. Magnitude & Scale Consistency (0.1, 1.0, 2.0 POL)', () => {
    it('scales linearly and consistently across 0.1 POL, 1.0 POL, and 2.0 POL', async () => {
      const quote01 = await defaultZenithRouter.getQuote({
        sourceChainId: 'polygon',
        destinationChainId: 'polygon',
        tokenIn: polToken,
        tokenOut: usdtToken,
        amountInRaw: parseTokenUnits('0.1', 18),
        slippageTolerancePercent: 0.5
      });

      const quote1 = await defaultZenithRouter.getQuote({
        sourceChainId: 'polygon',
        destinationChainId: 'polygon',
        tokenIn: polToken,
        tokenOut: usdtToken,
        amountInRaw: parseTokenUnits('1.0', 18),
        slippageTolerancePercent: 0.5
      });

      const quote2 = await defaultZenithRouter.getQuote({
        sourceChainId: 'polygon',
        destinationChainId: 'polygon',
        tokenIn: polToken,
        tokenOut: usdtToken,
        amountInRaw: parseTokenUnits('2.0', 18),
        slippageTolerancePercent: 0.5
      });

      const num01 = parseFloat(quote01.amountOutFormatted.replace(/,/g, ''));
      const num1 = parseFloat(quote1.amountOutFormatted.replace(/,/g, ''));
      const num2 = parseFloat(quote2.amountOutFormatted.replace(/,/g, ''));

      assert.ok(num01 >= 0.0095 && num01 <= 0.0105, `0.1 POL output must be ~0.0099, got ${num01}`);
      assert.ok(num1 >= 0.095 && num1 <= 0.105, `1.0 POL output must be ~0.099, got ${num1}`);
      assert.ok(num2 >= 0.190 && num2 <= 0.205, `2.0 POL output must be ~0.199, got ${num2}`);

      const ratio2to1 = num2 / num1;
      assert.ok(Math.abs(ratio2to1 - 2.0) < 0.01, `2 POL to 1 POL ratio must be ~2.0, got ${ratio2to1}`);

      const ratio1to01 = num1 / num01;
      assert.ok(Math.abs(ratio1to01 - 10.0) < 0.05, `1 POL to 0.1 POL ratio must be ~10.0, got ${ratio1to01}`);
    });
  });

  describe('4. Quote Sanity Invariant Checker', () => {
    it('rejects cross-chain quotes if a bridge provider returns an impossible rate (e.g. 99 Billion USDT for 1 POL)', async () => {
      const { CrossChainAggregator } = await import('@zenith/routing');
      const { ZenithRouter } = await import('@zenith/routing');

      const corruptedBridgeProvider = {
        id: 'ACROSS' as const,
        name: 'Corrupted Test Bridge',
        isAvailable: () => true,
        getQuote: async () => ({
          provider: 'ACROSS' as const,
          providerName: 'Corrupted Test Bridge',
          sourceChainId: 'polygon',
          destinationChainId: 'base',
          sourceToken: polToken,
          destinationToken: usdtToken,
          sourceAmountRaw: '1000000000000000000',
          destinationAmountRaw: '99960000000000000',
          minDestinationAmountRaw: '99460200000000000',
          estimatedTransferTimeSec: 20,
          bridgeFeeUSD: 0.10,
          gasEstimateUSD: 0.05,
          securityRating: 95
        }),
        buildExecution: async () => ({
          targetContract: '0x0000000000000000000000000000000000000001',
          calldata: '0x',
          value: '0',
          chainId: 137
        }),
        trackStatus: async () => ({ status: 'COMPLETED' as const, steps: [] })
      };

      const customAggregator = new CrossChainAggregator([corruptedBridgeProvider as any]);
      const customRouter = new ZenithRouter(undefined, customAggregator);

      await assert.rejects(
        async () => {
          await customRouter.getQuote({
            sourceChainId: 'polygon',
            destinationChainId: 'base',
            tokenIn: polToken,
            tokenOut: usdtToken,
            amountInRaw: parseTokenUnits('1.0', 18),
            slippageTolerancePercent: 0.5
          });
        },
        (err: any) => {
          return err.message.includes('QUOTE_INVALID') || err.code === 'QUOTE_INVALID';
        },
        'Router must reject quote with QUOTE_INVALID when provider returns an impossible rate'
      );
    });
  });
});
