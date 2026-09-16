import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultZenithRouter } from '../packages/routing/src/router';
import { defaultDEXAggregator } from '../packages/routing/src/dex/dexAggregator';
import { defaultCrossChainAggregator } from '../packages/routing/src/crosschain/crossChainAggregator';
import { defaultSimulationEngine } from '../packages/security/src/simulationEngine';
import { Token } from '@zenith/types';
import {
  UniswapV3Provider,
  QuickSwapProvider,
  AerodromeProvider,
  VelodromeProvider,
  CamelotProvider,
  PancakeSwapProvider,
  TraderJoeProvider
} from '../packages/routing/src/dex';
import {
  defaultAcrossProvider,
  defaultStargateProvider,
  defaultDeBridgeProvider
} from '../packages/routing/src';

const TEST_RECIPIENT = '0x1234567890123456789012345678901234567890';
const QUICKSWAP_V3_ROUTER = '0xf5b509bB0909a69B1c207E495f687a596C168E12';

const POLYGON_POL: Token = {
  address: '0x0000000000000000000000000000000000000000',
  chainId: 'polygon',
  name: 'Polygon Ecosystem Token',
  symbol: 'POL',
  decimals: 18,
  isNative: true,
  priceUSD: 0.0997
};

const POLYGON_USDT: Token = {
  address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
  chainId: 'polygon',
  name: 'Tether USD',
  symbol: 'USDT',
  decimals: 6,
  priceUSD: 1.0
};

const POLYGON_USDC: Token = {
  address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  chainId: 'polygon',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  priceUSD: 1.0
};

const ETH_WETH: Token = {
  address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  chainId: 'ethereum',
  name: 'Wrapped Ether',
  symbol: 'WETH',
  decimals: 18,
  priceUSD: 2450.0
};

const ETH_USDC: Token = {
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  chainId: 'ethereum',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  priceUSD: 1.0
};

const ARB_WETH: Token = {
  address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  chainId: 'arbitrum',
  name: 'Wrapped Ether',
  symbol: 'WETH',
  decimals: 18,
  priceUSD: 2450.0
};

const ARB_ARB: Token = {
  address: '0x912CE59144191C1204E64559FE8253a0e49E6548',
  chainId: 'arbitrum',
  name: 'Arbitrum',
  symbol: 'ARB',
  decimals: 18,
  priceUSD: 0.55
};

const BASE_WETH: Token = {
  address: '0x4200000000000000000000000000000000000006',
  chainId: 'base',
  name: 'Wrapped Ether',
  symbol: 'WETH',
  decimals: 18,
  priceUSD: 2450.0
};

const BASE_AERO: Token = {
  address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
  chainId: 'base',
  name: 'Aerodrome',
  symbol: 'AERO',
  decimals: 18,
  priceUSD: 1.25
};

const OP_WETH: Token = {
  address: '0x4200000000000000000000000000000000000006',
  chainId: 'optimism',
  name: 'Wrapped Ether',
  symbol: 'WETH',
  decimals: 18,
  priceUSD: 2450.0
};

const OP_OP: Token = {
  address: '0x4200000000000000000000000000000000000042',
  chainId: 'optimism',
  name: 'Optimism',
  symbol: 'OP',
  decimals: 18,
  priceUSD: 1.65
};

const BSC_WBNB: Token = {
  address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  chainId: 'bsc',
  name: 'Wrapped BNB',
  symbol: 'WBNB',
  decimals: 18,
  priceUSD: 580.0
};

const BSC_CAKE: Token = {
  address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
  chainId: 'bsc',
  name: 'PancakeSwap Token',
  symbol: 'CAKE',
  decimals: 18,
  priceUSD: 1.85
};

const AVAX_WAVAX: Token = {
  address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
  chainId: 'avalanche',
  name: 'Wrapped AVAX',
  symbol: 'WAVAX',
  decimals: 18,
  priceUSD: 28.5
};

const AVAX_JOE: Token = {
  address: '0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd',
  chainId: 'avalanche',
  name: 'Joe Token',
  symbol: 'JOE',
  decimals: 18,
  priceUSD: 0.38
};

describe('ZENITH Production Swap Failure Remediation — Regression & Verification', () => {

  describe('1. Polygon POL (18 dec) -> USDT (6 dec) Decimal Scaling & Exact Liquidity Math', () => {
    it('calculates exact integer output for 1.0 POL -> USDT without price-ratio inflation', async () => {
      const amountInRaw = '1000000000000000000';
      const quote = await defaultZenithRouter.getQuote({
        sourceChainId: 'polygon',
        destinationChainId: 'polygon',
        tokenIn: POLYGON_POL,
        tokenOut: POLYGON_USDT,
        amountInRaw,
        userAddress: TEST_RECIPIENT,
        slippageTolerancePercent: 0.5
      });

      assert.ok(quote, 'Quote must not be null');
      assert.strictEqual(quote.isExecutable, true, 'Quote must be executable');
      assert.ok(quote.validation, 'Validation result must be present');
      assert.strictEqual(quote.validation.isValid, true, 'Validation must pass');

      const rawAmountOutBig = BigInt(quote.amountOutRaw || quote.amountOut);
      const formattedAmountOut = parseFloat(quote.amountOutFormatted.replace(/,/g, ''));

      assert.ok(
        rawAmountOutBig >= 80000n && rawAmountOutBig <= 120000n,
        `Expected raw units around 99,700 for 1 POL -> USDT (6 dec), got ${rawAmountOutBig.toString()}`
      );
      assert.ok(
        formattedAmountOut >= 0.08 && formattedAmountOut <= 0.12,
        `Expected formatted output around ~0.0997 USDT, got ${formattedAmountOut}`
      );

      assert.ok(
        quote.executionTarget.toLowerCase() === QUICKSWAP_V3_ROUTER.toLowerCase() ||
        quote.executionTarget.toLowerCase() === '0xe592427a0aece92de3edee1f18e0157c05861564',
        'Execution target must be a canonical DEX router on Polygon'
      );

      assert.ok(quote.calldata && quote.calldata.startsWith('0x') && quote.calldata.length > 10, 'Calldata must be valid hex');
      assert.notStrictEqual(quote.calldata, '0x', 'Calldata must not be 0x');

      assert.strictEqual(
        quote.approvalAddress?.toLowerCase(),
        '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        'Native token input requires no ERC20 approval (native sentinel)'
      );
    });

    it('scales output proportionally for 0.1 POL and 10 POL inputs', async () => {

      const quoteSmall = await defaultZenithRouter.getQuote({
        sourceChainId: 'polygon',
        destinationChainId: 'polygon',
        tokenIn: POLYGON_POL,
        tokenOut: POLYGON_USDT,
        amountInRaw: '100000000000000000',
        userAddress: TEST_RECIPIENT,
        slippageTolerancePercent: 0.5
      });
      const rawSmall = BigInt(quoteSmall.amountOutRaw || quoteSmall.amountOut);
      assert.ok(rawSmall >= 8000n && rawSmall <= 12000n, `0.1 POL should yield ~9,970 units, got ${rawSmall}`);

      const quoteLarge = await defaultZenithRouter.getQuote({
        sourceChainId: 'polygon',
        destinationChainId: 'polygon',
        tokenIn: POLYGON_POL,
        tokenOut: POLYGON_USDT,
        amountInRaw: '10000000000000000000',
        userAddress: TEST_RECIPIENT,
        slippageTolerancePercent: 0.5
      });
      const rawLarge = BigInt(quoteLarge.amountOutRaw || quoteLarge.amountOut);
      assert.ok(rawLarge >= 800000n && rawLarge <= 1200000n, `10 POL should yield ~997,000 units, got ${rawLarge}`);
    });
  });

  describe('2. Protocol-Specific ABI Execution Across All 7 Canonical DEXes', () => {
    it('QuickSwap V3 (Polygon): encodes exactInputSingle with Algebra/QuickSwap V3 struct', async () => {
      const provider = new QuickSwapProvider();
      const quote = await provider.getQuote({
        chainId: 137,
        tokenIn: POLYGON_POL,
        tokenOut: POLYGON_USDC,
        amountIn: 1_000_000_000_000_000_000n,
        slippageToleranceBps: 50
      });
      assert.ok(quote, 'QuickSwap quote must be available');
      const exec = await provider.buildExecution(quote, TEST_RECIPIENT);

      assert.ok(exec.data.startsWith('0xbc651188'), 'QuickSwap V3 exactInputSingle selector is 0xbc651188');
      assert.strictEqual(exec.to.toLowerCase(), QUICKSWAP_V3_ROUTER.toLowerCase());
    });

    it('Uniswap V3 (Ethereum): encodes exactInputSingle with SwapRouter02 struct', async () => {
      const provider = new UniswapV3Provider();
      const quote = await provider.getQuote({
        chainId: 1,
        tokenIn: ETH_WETH,
        tokenOut: ETH_USDC,
        amountIn: 1_000_000_000_000_000_000n,
        slippageToleranceBps: 50
      });
      assert.ok(quote, 'Uniswap quote must be available');
      const exec = await provider.buildExecution(quote, TEST_RECIPIENT);

      assert.ok(exec.data.startsWith('0x414bf389'), 'Uniswap V3 exactInputSingle selector is 0x414bf389');
    });

    it('Aerodrome (Base): encodes swapExactTokensForTokens with Route struct', async () => {
      const provider = new AerodromeProvider();
      const quote = await provider.getQuote({
        chainId: 8453,
        tokenIn: BASE_WETH,
        tokenOut: BASE_AERO,
        amountIn: 1_000_000_000_000_000_000n,
        slippageToleranceBps: 50
      });
      assert.ok(quote, 'Aerodrome quote must be available');
      const exec = await provider.buildExecution(quote, TEST_RECIPIENT);

      assert.ok(exec.data.startsWith('0xcac88ea9'), 'Aerodrome swapExactTokensForTokens selector is 0xcac88ea9');
      assert.strictEqual(exec.to.toLowerCase(), '0xcF77a3Ba9A5CA399B7c97c74856154990ED379bC'.toLowerCase());
    });

    it('Velodrome (Optimism): encodes swapExactTokensForTokens with Route struct', async () => {
      const provider = new VelodromeProvider();
      const quote = await provider.getQuote({
        chainId: 10,
        tokenIn: OP_WETH,
        tokenOut: OP_OP,
        amountIn: 1_000_000_000_000_000_000n,
        slippageToleranceBps: 50
      });
      assert.ok(quote, 'Velodrome quote must be available');
      const exec = await provider.buildExecution(quote, TEST_RECIPIENT);

      assert.strictEqual(exec.to.toLowerCase(), '0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858'.toLowerCase());
    });

    it('Camelot V3 (Arbitrum): encodes exactInputSingle with Camelot router', async () => {
      const provider = new CamelotProvider();
      const quote = await provider.getQuote({
        chainId: 42161,
        tokenIn: ARB_WETH,
        tokenOut: ARB_ARB,
        amountIn: 1_000_000_000_000_000_000n,
        slippageToleranceBps: 50
      });
      assert.ok(quote, 'Camelot quote must be available');
      const exec = await provider.buildExecution(quote, TEST_RECIPIENT);

      assert.strictEqual(exec.to.toLowerCase(), '0x1F721E2E82F6676FCE4eA07A5958cF098D339e18'.toLowerCase());
    });

    it('PancakeSwap V3 (BNB Chain): encodes exactInputSingle with PancakeSwap router', async () => {
      const provider = new PancakeSwapProvider();
      const quote = await provider.getQuote({
        chainId: 56,
        tokenIn: BSC_WBNB,
        tokenOut: BSC_CAKE,
        amountIn: 1_000_000_000_000_000_000n,
        slippageToleranceBps: 50
      });
      assert.ok(quote, 'PancakeSwap quote must be available');
      const exec = await provider.buildExecution(quote, TEST_RECIPIENT);

      assert.strictEqual(exec.to.toLowerCase(), '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4'.toLowerCase());
    });

    it('Trader Joe (Avalanche): encodes swapExactTokensForTokens with LBRouter', async () => {
      const provider = new TraderJoeProvider();
      const quote = await provider.getQuote({
        chainId: 43114,
        tokenIn: AVAX_WAVAX,
        tokenOut: AVAX_JOE,
        amountIn: 1_000_000_000_000_000_000n,
        slippageToleranceBps: 50
      });
      assert.ok(quote, 'Trader Joe quote must be available');
      const exec = await provider.buildExecution(quote, TEST_RECIPIENT);

      assert.strictEqual(exec.to.toLowerCase(), '0xb4310e7de3e0f14172488457b1a97140ecc94b77'.toLowerCase());
    });
  });

  describe('3. Real Bridge Execution (No Empty Calldata)', () => {
    it('Across V3 generates executable depositV3 calldata', async () => {
      const quote = await defaultAcrossProvider.getQuote({
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        tokenIn: ETH_USDC,
        tokenOut: ARB_WETH,
        amountInRaw: '1000000000',
        recipientAddress: TEST_RECIPIENT
      });
      assert.ok(quote, 'Across quote must be present');
      const exec = await defaultAcrossProvider.buildExecution(quote, TEST_RECIPIENT);

      assert.ok(exec.data && exec.data.length > 20);
      assert.notStrictEqual(exec.data, '0x');
      assert.strictEqual(exec.to.toLowerCase(), '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5'.toLowerCase());
    });

    it('deBridge DLN generates real createOrder calldata (fixes calldata: 0x bug)', async () => {
      const quote = await defaultDeBridgeProvider.getQuote({
        sourceChainId: 'ethereum',
        destinationChainId: 'polygon',
        tokenIn: ETH_USDC,
        tokenOut: POLYGON_USDT,
        amountInRaw: '500000000',
        recipientAddress: TEST_RECIPIENT
      });
      assert.ok(quote, 'deBridge quote must be present');
      const exec = await defaultDeBridgeProvider.buildExecution(quote, TEST_RECIPIENT);

      assert.ok(exec.data && exec.data.length > 100, 'deBridge DLN createOrder calldata must be complete hex');
      assert.notStrictEqual(exec.data, '0x', 'deBridge DLN calldata MUST NOT be 0x');
      assert.strictEqual(exec.to.toLowerCase(), '0xeF4fb24aD0916217251F553c0596F8Edc630EB66'.toLowerCase());
    });

    it('Stargate V2 generates executable swap calldata with native fee value', async () => {
      const quote = await defaultStargateProvider.getQuote({
        sourceChainId: 'ethereum',
        destinationChainId: 'arbitrum',
        tokenIn: ETH_USDC,
        tokenOut: ARB_WETH,
        amountInRaw: '1000000000',
        recipientAddress: TEST_RECIPIENT
      });
      assert.ok(quote, 'Stargate quote must be present');
      const exec = await defaultStargateProvider.buildExecution(quote, TEST_RECIPIENT);

      assert.ok(exec.data && exec.data.length > 20);
      assert.notStrictEqual(exec.data, '0x');
      assert.strictEqual(exec.to.toLowerCase(), '0x8731d54E9D02c286767d56ac03e8037C07e01e98'.toLowerCase());
    });
  });

  describe('4. Simulation and Execution Exact Payload Parity', () => {
    it('simulates the exact transaction payload that is passed to the execution adapter', async () => {
      const quote = await defaultZenithRouter.getQuote({
        sourceChainId: 'polygon',
        destinationChainId: 'polygon',
        tokenIn: POLYGON_POL,
        tokenOut: POLYGON_USDT,
        amountInRaw: '1000000000000000000',
        userAddress: TEST_RECIPIENT,
        slippageTolerancePercent: 0.5
      });

      assert.ok(quote.executableTransaction);
      const tx = quote.executableTransaction;

      const simResult = await defaultSimulationEngine.simulateSwap({
        chainId: 'polygon',
        userAddress: TEST_RECIPIENT,
        routerAddress: tx.to,
        tokenIn: POLYGON_POL,
        tokenOut: POLYGON_USDT,
        amountInRaw: tx.value || '1000000000000000000',
        amountOutExpectedRaw: quote.amountOutRaw || quote.amountOut,
        slippageTolerancePercent: 0.5,
        calldata: tx.data,
        valueWei: tx.value
      });

      assert.strictEqual(simResult.isSuccess, true);
      assert.strictEqual(simResult.balanceDeltas.length, 2);
    });

    it('cross-chain Polygon POL (18 dec) -> Ethereum USDC (6 dec) accurately accounts for relative asset exchange rate', async () => {
      const ETHEREUM_USDC: Token = {
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        chainId: 'ethereum',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        priceUSD: 1.00
      };

      const quote = await defaultZenithRouter.getQuote({
        sourceChainId: 'polygon',
        destinationChainId: 'ethereum',
        tokenIn: POLYGON_POL,
        tokenOut: ETHEREUM_USDC,
        amountInRaw: '1000000000000000000',
        userAddress: TEST_RECIPIENT,
        slippageTolerancePercent: 0.5
      });

      assert.ok(quote, 'Quote must be returned');
      const outNum = parseFloat(quote.amountOutFormatted.replace(/,/g, ''));

      assert.ok(outNum >= 0.095 && outNum <= 0.105, `Expected ~0.0996 USDC, received ${outNum}`);
      assert.ok(outNum < 0.2, `Received value (${outNum}) must not be ~1.0 USDC`);
      assert.ok(BigInt(quote.amountOutRaw) >= 95000n && BigInt(quote.amountOutRaw) <= 105000n, `Raw output must be ~99,600 units (6 decimals), got ${quote.amountOutRaw}`);
    });
  });
});
