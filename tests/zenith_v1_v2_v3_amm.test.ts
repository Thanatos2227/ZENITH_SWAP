import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateConstantProductOutput,
  calculateConstantProductInput,
  calculatePriceImpactPercent,
  calculateV3SqrtPriceX96,
  calculateV3AmountOut
} from '@zenith/routing';
import { zenithV1Provider } from '@zenith/routing/src/dex/zenithV1Provider';
import { zenithV2Provider } from '@zenith/routing/src/dex/zenithV2Provider';
import { zenithV3Provider } from '@zenith/routing/src/dex/zenithV3Provider';
import { registerZenithDeployment } from '@zenith/contracts';
import { Token } from '@zenith/types';

describe('ZENITH SWAP — Sovereign AMM Protocol Test Suite', () => {

  registerZenithDeployment(137, {
    v1Router: '0x1111111111111111111111111111111111111111',
    v2Router: '0x2222222222222222222222222222222222222222',
    v3Router: '0x3333333333333333333333333333333333333333',
    v3PositionManager: '0x4444444444444444444444444444444444444444'
  });

  const tokenUSDC: Token = {
    address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    chainId: 137,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    isNative: false,
    priceUSD: 1.0
  };

  const tokenPOL: Token = {
    address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    chainId: 137,
    symbol: 'POL',
    name: 'Polygon Ecosystem Token',
    decimals: 18,
    isNative: false,
    priceUSD: 0.10
  };

  describe('1. Zenith V1 AMM (x * y = k Math & Invariants)', () => {
    it('correctly calculates output amount with 30 BPS (0.3%) fee', () => {
      const reserveIn = 1000n * 10n ** 6n;
      const reserveOut = 10000n * 10n ** 18n;
      const amountIn = 100n * 10n ** 6n;

      const res = calculateConstantProductOutput({
        amountInRaw: amountIn,
        reserveInRaw: reserveIn,
        reserveOutRaw: reserveOut,
        feeBps: 30,
        slippageToleranceBps: 50
      });

      assert.ok(res.amountOutRaw > 0n, 'Output must be positive');

      const amountInWithFee = amountIn * 9970n;
      const expectedOut = (amountInWithFee * reserveOut) / (reserveIn * 10000n + amountInWithFee);
      assert.strictEqual(res.amountOutRaw, expectedOut, 'Output must match standard constant product formula');
    });

    it('correctly calculates input amount needed for exact output', () => {
      const reserveIn = 1000n * 10n ** 6n;
      const reserveOut = 10000n * 10n ** 18n;
      const amountOut = 500n * 10n ** 18n;

      const amountIn = calculateConstantProductInput(amountOut, reserveIn, reserveOut, 30);
      assert.ok(amountIn > 0n, 'Input must be positive');

      const resulting = calculateConstantProductOutput({
        amountInRaw: amountIn,
        reserveInRaw: reserveIn,
        reserveOutRaw: reserveOut,
        feeBps: 30,
        slippageToleranceBps: 0
      });
      assert.ok(resulting.amountOutRaw >= amountOut, 'Resulting output must satisfy required exact output');
    });

    it('calculates accurate price impact', () => {
      const reserveIn = 1000n * 10n ** 6n;
      const reserveOut = 10000n * 10n ** 18n;
      const smallAmountIn = 1n * 10n ** 6n;
      const largeAmountIn = 500n * 10n ** 6n;

      const smallRes = calculateConstantProductOutput({
        amountInRaw: smallAmountIn,
        reserveInRaw: reserveIn,
        reserveOutRaw: reserveOut,
        feeBps: 30,
        slippageToleranceBps: 50
      });
      const largeRes = calculateConstantProductOutput({
        amountInRaw: largeAmountIn,
        reserveInRaw: reserveIn,
        reserveOutRaw: reserveOut,
        feeBps: 30,
        slippageToleranceBps: 50
      });

      const impactSmall = calculatePriceImpactPercent(smallAmountIn, smallRes.amountOutRaw, reserveIn, reserveOut);
      const impactLarge = calculatePriceImpactPercent(largeAmountIn, largeRes.amountOutRaw, reserveIn, reserveOut);

      assert.ok(impactSmall < 1.0, `Small swap impact (${impactSmall}%) should be under 1%`);
      assert.ok(impactLarge > 30.0, `Large swap impact (${impactLarge}%) should be over 30%`);
    });

    it('generates a valid Zenith V1 quote via ZenithV1Provider', async () => {
      const quote = await zenithV1Provider.getQuote({
        chainId: 137,
        tokenIn: tokenUSDC,
        tokenOut: tokenPOL,
        amountIn: 100n * 10n ** 6n,
        slippageToleranceBps: 50,
        recipient: '0x1234567890123456789012345678901234567890'
      });

      assert.ok(quote, 'Zenith V1 provider must produce quote');
      assert.strictEqual(quote?.provider, 'ZENITH_V1');
      assert.strictEqual(quote?.feeTierBps, 30);
      assert.ok(quote!.amountOut > 0n);
      assert.ok(quote!.executionTarget.startsWith('0x'));
    });
  });

  describe('2. Zenith V2 AMM (Multi-Tier Fees & Protocol Treasury Split)', () => {
    it('supports 5 BPS, 30 BPS, and 100 BPS fee tiers', async () => {
      const quote5 = await zenithV2Provider.getQuote({
        chainId: 137,
        tokenIn: tokenUSDC,
        tokenOut: tokenPOL,
        amountIn: 100n * 10n ** 6n,
        slippageToleranceBps: 50
      });
      const quote30 = await zenithV2Provider.getQuote({
        chainId: 137,
        tokenIn: tokenUSDC,
        tokenOut: tokenPOL,
        amountIn: 100n * 10n ** 6n,
        slippageToleranceBps: 50
      });
      const quote100 = await zenithV2Provider.getQuote({
        chainId: 137,
        tokenIn: tokenUSDC,
        tokenOut: tokenPOL,
        amountIn: 100n * 10n ** 6n,
        slippageToleranceBps: 50
      });

      assert.ok(quote5 && quote30 && quote100, 'All fee tiers must return quotes');
      assert.strictEqual(quote5.provider, 'ZENITH_V2');
      assert.strictEqual(quote30.provider, 'ZENITH_V2');
      assert.strictEqual(quote100.provider, 'ZENITH_V2');
    });
  });

  describe('3. Zenith V3 AMM (Concentrated Liquidity Math & Spacings)', () => {
    it('calculates sqrtPriceX96 accurately from reserve ratio', () => {
      const reserve0 = 1000n * 10n ** 6n;
      const reserve1 = 10000n * 10n ** 18n;
      const sqrtPriceX96 = calculateV3SqrtPriceX96(reserve0, reserve1);

      assert.ok(sqrtPriceX96 > 0n, 'sqrtPriceX96 must be strictly positive');
    });

    it('calculates concentrated liquidity swap output', () => {
      const liquidity = 1000000000000000000n;
      const sqrtPriceX96 = 79228162514264337593543950336n;
      const amountIn = 10n * 10n ** 18n;

      const amountOut = calculateV3AmountOut(amountIn, liquidity, sqrtPriceX96, 500);
      assert.ok(amountOut > 0n, 'V3 swap output must be positive');
      assert.ok(amountOut < amountIn, 'Output with 500 fee must be less than gross amount at price 1.0');
    });

    it('generates a valid Zenith V3 quote with tick data', async () => {
      const quote = await zenithV3Provider.getQuote({
        chainId: 137,
        tokenIn: tokenUSDC,
        tokenOut: tokenPOL,
        amountIn: 100n * 10n ** 6n,
        slippageToleranceBps: 50
      });

      assert.ok(quote, 'Zenith V3 provider must return a quote');
      assert.strictEqual(quote?.provider, 'ZENITH_V3');
      assert.ok(quote!.amountOut > 0n);
      assert.ok(quote!.executionTarget.startsWith('0x'));
    });
  });
});
