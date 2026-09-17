import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ZenithSDK, zenithSDK } from '../packages/sdk/src/zenithSdk';
import { registerZenithDeployment } from '@zenith/contracts';
import { Token } from '@zenith/types';

describe('ZENITH SWAP — Sovereign TypeScript SDK Suite', () => {

  registerZenithDeployment(137, {
    v1Router: '0x1111111111111111111111111111111111111111',
    v2Router: '0x2222222222222222222222222222222222222222',
    v3Router: '0x3333333333333333333333333333333333333333',
    v3PositionManager: '0x4444444444444444444444444444444444444444'
  });

  const tokenIn: Token = {
    address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    chainId: 137,
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    isNative: false,
    priceUSD: 1.0
  };

  const tokenOut: Token = {
    address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    chainId: 137,
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    isNative: false,
    priceUSD: 3000.0
  };

  describe('1. SDK Initialization & Configuration', () => {
    it('instantiates ZenithSDK with defaults and custom options', () => {
      const sdk = new ZenithSDK({
        defaultSlippageBps: 100,
        referralAddress: '0x1234567890123456789012345678901234567890'
      });
      assert.ok(sdk, 'SDK must be initialized');
    });

    it('exports singleton instance zenithSDK', () => {
      assert.ok(zenithSDK, 'zenithSDK singleton must exist');
    });
  });

  describe('2. Quote & Routing Engine', () => {
    it('generates a full ZenithQuoteResult with sovereign fee breakdown', async () => {
      const quote = await zenithSDK.getQuote({
        chainId: 137,
        tokenIn,
        tokenOut,
        amountIn: 1000n * 10n ** 6n,
        slippageToleranceBps: 50,
        reserveIn: 1_000_000n * 10n ** 6n,
        reserveOut: 1_000n * 10n ** 18n
      } as any);

      assert.ok(quote, 'Quote result must be returned');
      assert.strictEqual(quote.sourceChainId, 137);
      assert.strictEqual(quote.tokenIn.symbol, 'USDC');
      assert.strictEqual(quote.tokenOut.symbol, 'WETH');
      assert.ok(quote.amountOut > 0n, 'amountOut must be greater than 0');
      assert.ok(quote.minimumReceived > 0n, 'minimumReceived must be calculated');
      assert.ok(quote.minimumReceived < quote.amountOut, 'minimumReceived must be less than expected amountOut due to slippage');
      assert.strictEqual(quote.protocolFeeBps, 5);
      assert.ok(quote.protocolFeeAmount > 0n, 'Protocol fee amount must be calculated');
    });

    it('retrieves multiple alternative routes via getRoutes()', async () => {
      const routes = await zenithSDK.getRoutes({
        chainId: 137,
        tokenIn,
        tokenOut,
        amountIn: 500n * 10n ** 6n,
        reserveIn: 1_000_000n * 10n ** 6n,
        reserveOut: 1_000n * 10n ** 18n
      } as any);

      assert.ok(Array.isArray(routes), 'getRoutes must return an array');
      assert.ok(routes.length > 0, 'Must return at least 1 route');
      for (const route of routes) {
        assert.ok(route.protocol, 'Route must have a protocol');
        assert.ok(route.amountOut > 0n, 'Route must have positive amountOut');
        assert.ok(route.executionTarget, 'Route must have an execution target');
      }
    });
  });

  describe('3. Transaction Building', () => {
    it('builds an unsigned swap transaction from a quote', async () => {
      const quote = await zenithSDK.getQuote({
        chainId: 137,
        tokenIn,
        tokenOut,
        amountIn: 100n * 10n ** 6n,
        reserveIn: 1_000_000n * 10n ** 6n,
        reserveOut: 1_000n * 10n ** 18n
      } as any);

      const tx = await zenithSDK.buildSwapTransaction(quote, {
        userAddress: '0x1234567890123456789012345678901234567890'
      });

      assert.ok(tx, 'Transaction must be built');
      assert.ok(tx.to && tx.to.startsWith('0x'), 'tx.to must be a valid address');
      assert.ok(tx.data && tx.data.startsWith('0x'), 'tx.data must be valid bytecode');
      assert.strictEqual(tx.chainId, 137);
    });

    it('builds a V1 add liquidity transaction', async () => {
      const tx = await zenithSDK.buildLiquidityTransaction({
        protocol: 'ZENITH_V1',
        chainId: 137,
        tokenA: tokenIn.address,
        tokenB: tokenOut.address,
        amountADesired: 100n * 10n ** 6n,
        amountBDesired: 1n * 10n ** 18n,
        amountAMin: 99n * 10n ** 6n,
        amountBMin: 99n * 10n ** 16n,
        to: '0x1234567890123456789012345678901234567890',
        deadline: Math.floor(Date.now() / 1000) + 1200
      });

      assert.ok(tx, 'Liquidity transaction must be built');
      assert.ok(tx.to.startsWith('0x'));
      assert.ok(tx.data.startsWith('0x'));
      assert.strictEqual(tx.chainId, 137);
    });

    it('builds a V2 add liquidity transaction', async () => {
      const tx = await zenithSDK.buildLiquidityTransaction({
        protocol: 'ZENITH_V2',
        chainId: 137,
        tokenA: tokenIn.address,
        tokenB: tokenOut.address,
        feeBps: 30,
        amountADesired: 100n * 10n ** 6n,
        amountBDesired: 1n * 10n ** 18n,
        amountAMin: 99n * 10n ** 6n,
        amountBMin: 99n * 10n ** 16n,
        to: '0x1234567890123456789012345678901234567890',
        deadline: Math.floor(Date.now() / 1000) + 1200
      });

      assert.ok(tx, 'V2 liquidity transaction must be built');
      assert.ok(tx.to.startsWith('0x'));
      assert.ok(tx.data.startsWith('0x'));
    });

    it('builds a V3 mint position transaction', async () => {
      const tx = await zenithSDK.buildLiquidityTransaction({
        protocol: 'ZENITH_V3',
        chainId: 137,
        token0: tokenIn.address,
        token1: tokenOut.address,
        feeBps: 3000,
        tickLower: -887220,
        tickUpper: 887220,
        amount0Desired: 100n * 10n ** 6n,
        amount1Desired: 1n * 10n ** 18n,
        amount0Min: 95n * 10n ** 6n,
        amount1Min: 95n * 10n ** 16n,
        recipient: '0x1234567890123456789012345678901234567890',
        deadline: Math.floor(Date.now() / 1000) + 1200
      });

      assert.ok(tx, 'V3 mint position transaction must be built');
      assert.ok(tx.to.startsWith('0x'));
      assert.ok(tx.data.startsWith('0x'));
    });
  });
});
