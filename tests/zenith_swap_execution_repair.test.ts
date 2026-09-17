import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Token } from '@zenith/types';
import {
  UniswapV3Provider,
  CamelotProvider,
  VelodromeProvider,
  PancakeSwapProvider,
  TraderJoeProvider,
  QuickSwapProvider,
  ZenithV1Provider,
  ZenithV2Provider,
  ZenithV3Provider,
  resolvePoolTokenAddress,
  WRAPPED_NATIVE_ADDRESSES
} from '../packages/routing/src/dex';
import { defaultEVMAdapter } from '../packages/execution/src/adapters/evmAdapter';
import { defaultExecutionCoordinator } from '../packages/execution/src/executionCoordinator';
import { ExecutionStateMachine } from '../packages/execution/src/stateMachine';

const MOCK_USER = '0x1111111111111111111111111111111111111111';
const MOCK_RECIPIENT = '0x2222222222222222222222222222222222222222';

const NATIVE_ETH: Token = {
  address: '0x0000000000000000000000000000000000000000',
  name: 'Ethereum',
  symbol: 'ETH',
  decimals: 18,
  chainId: 'ethereum',
  isNative: true
};

const USDC_ETH: Token = {
  address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  chainId: 'ethereum',
  isNative: false
};

const NATIVE_ARB_ETH: Token = {
  address: '0x0000000000000000000000000000000000000000',
  name: 'Arbitrum ETH',
  symbol: 'ETH',
  decimals: 18,
  chainId: 'arbitrum',
  isNative: true
};

const USDC_ARB: Token = {
  address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  chainId: 'arbitrum',
  isNative: false
};

const NATIVE_OP_ETH: Token = {
  address: '0x0000000000000000000000000000000000000000',
  name: 'Optimism ETH',
  symbol: 'ETH',
  decimals: 18,
  chainId: 'optimism',
  isNative: true
};

const USDC_OP: Token = {
  address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  chainId: 'optimism',
  isNative: false
};

const NATIVE_AVAX: Token = {
  address: '0x0000000000000000000000000000000000000000',
  name: 'Avalanche',
  symbol: 'AVAX',
  decimals: 18,
  chainId: 'avalanche',
  isNative: true
};

const USDC_AVAX: Token = {
  address: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  chainId: 'avalanche',
  isNative: false
};

const NATIVE_POL: Token = {
  address: '0x0000000000000000000000000000000000000000',
  name: 'Polygon Ecosystem Token',
  symbol: 'POL',
  decimals: 18,
  chainId: 'polygon',
  isNative: true
};

const USDC_POL: Token = {
  address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  chainId: 'polygon',
  isNative: false
};

describe('ZENITH SWAP — Swap Execution Pipeline & Provider Repair Suite', () => {

  describe('1. Address Resolution for AMM Pools', () => {
    test('resolves native ETH to WETH on Arbitrum', () => {
      const resolved = resolvePoolTokenAddress(NATIVE_ARB_ETH, 42161);
      assert.equal(resolved.toLowerCase(), WRAPPED_NATIVE_ADDRESSES[42161].toLowerCase());
    });

    test('resolves native ETH to WETH on Optimism', () => {
      const resolved = resolvePoolTokenAddress(NATIVE_OP_ETH, 10);
      assert.equal(resolved.toLowerCase(), WRAPPED_NATIVE_ADDRESSES[10].toLowerCase());
    });

    test('resolves native AVAX to WAVAX on Avalanche', () => {
      const resolved = resolvePoolTokenAddress(NATIVE_AVAX, 43114);
      assert.equal(resolved.toLowerCase(), WRAPPED_NATIVE_ADDRESSES[43114].toLowerCase());
    });

    test('preserves ERC20 contract address without modification', () => {
      const resolved = resolvePoolTokenAddress(USDC_ETH, 1);
      assert.equal(resolved.toLowerCase(), USDC_ETH.address.toLowerCase());
    });
  });

  describe('2. Uniswap V3 Provider Calldata Generation', () => {
    const uniProvider = new UniswapV3Provider();

    test('generates valid SwapRouter02 calldata on Ethereum Mainnet (Chain 1)', async () => {
      const quote = await uniProvider.getQuote({
        chainId: 1,
        tokenIn: NATIVE_ETH,
        tokenOut: USDC_ETH,
        amountIn: 1000000000000000000n,
        slippageToleranceBps: 50,
        reserveIn: 1000n * 10n ** 18n,
        reserveOut: 1000000n * 10n ** 6n
      } as any);

      assert.ok(quote, 'Quote should be generated');
      const execution = await uniProvider.buildExecution(quote, MOCK_USER, MOCK_RECIPIENT);
      assert.ok(execution.data, 'Execution calldata must be present');
      assert.ok(execution.data.startsWith('0x'), 'Calldata must start with 0x');
      assert.equal(execution.value, '1000000000000000000', 'Native swap must have exact amountIn as value');
    });

    test('generates valid SwapRouter01 calldata with 8-param tuple on non-SwapRouter02 chains (Avalanche Chain 43114)', async () => {
      const quote = await uniProvider.getQuote({
        chainId: 43114,
        tokenIn: NATIVE_AVAX,
        tokenOut: USDC_AVAX,
        amountIn: 10000000000000000000n,
        slippageToleranceBps: 50,
        reserveIn: 1000n * 10n ** 18n,
        reserveOut: 1000000n * 10n ** 6n
      } as any);

      assert.ok(quote, 'Quote should be generated');
      const execution = await uniProvider.buildExecution(quote, MOCK_USER, MOCK_RECIPIENT);
      assert.ok(execution.data, 'Execution calldata must be present');
      assert.ok(execution.data.length > 10, 'Calldata must be encoded successfully without parameter count mismatch');
    });
  });

  describe('3. Camelot DEX Provider Calldata Generation', () => {
    const camelot = new CamelotProvider();

    test('builds valid execution with resolved pool addresses on Arbitrum', async () => {
      const quote = await camelot.getQuote({
        chainId: 42161,
        tokenIn: NATIVE_ARB_ETH,
        tokenOut: USDC_ARB,
        amountIn: 1000000000000000000n,
        slippageToleranceBps: 50,
        reserveIn: 1000n * 10n ** 18n,
        reserveOut: 1000000n * 10n ** 6n
      } as any);

      assert.ok(quote);
      const execution = await camelot.buildExecution(quote, MOCK_USER, MOCK_RECIPIENT);
      assert.ok(execution.data);
      assert.ok(execution.data.startsWith('0x'));
      assert.equal(execution.to.toLowerCase(), '0x1F721E2E82F6676FCE4eA07A5958cF098D339e18'.toLowerCase());
    });
  });

  describe('4. Velodrome Finance Provider Calldata Generation', () => {
    const velo = new VelodromeProvider();

    test('builds valid execution with resolved pool addresses on Optimism', async () => {
      const quote = await velo.getQuote({
        chainId: 10,
        tokenIn: NATIVE_OP_ETH,
        tokenOut: USDC_OP,
        amountIn: 1000000000000000000n,
        slippageToleranceBps: 50,
        reserveIn: 1000n * 10n ** 18n,
        reserveOut: 1000000n * 10n ** 6n
      } as any);

      assert.ok(quote);
      const execution = await velo.buildExecution(quote, MOCK_USER, MOCK_RECIPIENT);
      assert.ok(execution.data);
      assert.equal(execution.value, '1000000000000000000');
    });
  });

  describe('5. PancakeSwap V3 Provider Calldata Generation', () => {
    const pancake = new PancakeSwapProvider();

    test('builds valid execution on BSC (Chain 56)', async () => {
      const bscTokenIn: Token = {
        address: '0x0000000000000000000000000000000000000000',
        name: 'BNB',
        symbol: 'BNB',
        decimals: 18,
        chainId: 'binance-smart-chain',
        isNative: true
      };
      const bscUsdt: Token = {
        address: '0x55d398326f99059fF775485246999027B3197955',
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 18,
        chainId: 'binance-smart-chain',
        isNative: false
      };

      const quote = await pancake.getQuote({
        chainId: 56,
        tokenIn: bscTokenIn,
        tokenOut: bscUsdt,
        amountIn: 1000000000000000000n,
        slippageToleranceBps: 50,
        reserveIn: 1000n * 10n ** 18n,
        reserveOut: 1000000n * 10n ** 18n
      } as any);

      assert.ok(quote);
      const execution = await pancake.buildExecution(quote, MOCK_USER, MOCK_RECIPIENT);
      assert.ok(execution.data);
      assert.equal(execution.value, '1000000000000000000');
    });
  });

  describe('6. Trader Joe Provider Calldata Generation', () => {
    const traderJoe = new TraderJoeProvider();

    test('builds valid execution on Avalanche (Chain 43114)', async () => {
      const quote = await traderJoe.getQuote({
        chainId: 43114,
        tokenIn: NATIVE_AVAX,
        tokenOut: USDC_AVAX,
        amountIn: 5000000000000000000n,
        slippageToleranceBps: 50,
        reserveIn: 1000n * 10n ** 18n,
        reserveOut: 1000000n * 10n ** 6n
      } as any);

      assert.ok(quote);
      const execution = await traderJoe.buildExecution(quote, MOCK_USER, MOCK_RECIPIENT);
      assert.ok(execution.data);
      assert.equal(execution.value, '5000000000000000000');
    });
  });

  describe('7. QuickSwap Provider Calldata Generation', () => {
    const quick = new QuickSwapProvider();

    test('builds valid execution on Polygon (Chain 137)', async () => {
      const quote = await quick.getQuote({
        chainId: 137,
        tokenIn: NATIVE_POL,
        tokenOut: USDC_POL,
        amountIn: 10000000000000000000n,
        slippageToleranceBps: 50,
        reserveIn: 1000n * 10n ** 18n,
        reserveOut: 1000000n * 10n ** 6n
      } as any);

      assert.ok(quote);
      const execution = await quick.buildExecution(quote, MOCK_USER, MOCK_RECIPIENT);
      assert.ok(execution.data);
      assert.equal(execution.value, '10000000000000000000');
    });
  });

  describe('8. Sovereign Zenith AMMs (V1, V2, V3) Calldata Generation', () => {
    const v1 = new ZenithV1Provider();
    const v2 = new ZenithV2Provider();
    const v3 = new ZenithV3Provider();

    test('Zenith V1 builds valid execution', async () => {
      const quote = await v1.getQuote({
        chainId: 31337,
        tokenIn: NATIVE_ETH,
        tokenOut: USDC_ETH,
        amountIn: 1000000000000000000n,
        slippageToleranceBps: 50,
        reserveIn: 1000n * 10n ** 18n,
        reserveOut: 1000000n * 10n ** 6n
      } as any);
      assert.ok(quote);
      const execution = await v1.buildExecution(quote, MOCK_USER, MOCK_RECIPIENT);
      assert.ok(execution.data);
      assert.equal(execution.value, '1000000000000000000');
    });

    test('Zenith V2 builds valid execution', async () => {
      const quote = await v2.getQuote({
        chainId: 31337,
        tokenIn: USDC_ETH,
        tokenOut: NATIVE_ETH,
        amountIn: 1000000000n,
        slippageToleranceBps: 50,
        reserveIn: 1000000n * 10n ** 6n,
        reserveOut: 1000n * 10n ** 18n
      } as any);
      assert.ok(quote);
      const execution = await v2.buildExecution(quote, MOCK_USER, MOCK_RECIPIENT);
      assert.ok(execution.data);
      assert.equal(execution.value, '0');
    });

    test('Zenith V3 builds valid exactInputSingle execution', async () => {
      const quote = await v3.getQuote({
        chainId: 31337,
        tokenIn: NATIVE_ETH,
        tokenOut: USDC_ETH,
        amountIn: 1000000000000000000n,
        slippageToleranceBps: 50,
        liquidity: 1000000000000000000n,
        sqrtPriceX96: 79228162514264337593543950336n,
        currentTick: 0,
        tickSpacing: 60,
        feeTierBps: 30
      } as any);
      assert.ok(quote);
      const execution = await v3.buildExecution(quote, MOCK_USER, MOCK_RECIPIENT);
      assert.ok(execution.data);
      assert.equal(execution.value, '1000000000000000000');
    });
  });

  describe('9. EVM Execution Adapter Allowance & State Transitions', () => {
    test('checkAllowance returns max uint256 for native tokens without calling RPC', async () => {
      const allowance = await defaultEVMAdapter.checkAllowance({
        tokenAddress: NATIVE_ETH.address,
        ownerAddress: MOCK_USER,
        spenderAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        signer: null
      });

      assert.equal(allowance, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'));
    });

    test('checkAllowance returns 0n gracefully when signer is disconnected', async () => {
      const allowance = await defaultEVMAdapter.checkAllowance({
        tokenAddress: USDC_ETH.address,
        ownerAddress: MOCK_USER,
        spenderAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        signer: null
      });

      assert.equal(allowance, 0n);
    });
  });
});
