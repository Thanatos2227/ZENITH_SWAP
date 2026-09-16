import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultZenithRouter, ZenithRouter, parseTokenUnits, formatTokenUnits } from '@zenith/routing';
import { defaultChainRegistry } from '@zenith/chains';
import { DEFAULT_TOKENS, defaultTokenService } from '@zenith/tokens';
import {
  UniswapV3Provider,
  QuickSwapProvider,
  AerodromeProvider,
  VelodromeProvider,
  CamelotProvider,
  PancakeSwapProvider,
  TraderJoeProvider,
  defaultDEXAggregator
} from '@zenith/routing';
import {
  defaultAcrossProvider,
  defaultStargateProvider,
  defaultDeBridgeProvider
} from '@zenith/routing';

const USER_ADDR = '0x1234567890123456789012345678901234567890';

test('1. Real DEX Provider Execution Calldata Encoding', async () => {
  const polygon = defaultChainRegistry.getChain('polygon')!;
  const polToken = defaultTokenService.getNativeToken('polygon') || {
    address: '0x0000000000000000000000000000000000000000',
    chainId: 'polygon',
    name: 'Polygon Ecosystem Token',
    symbol: 'POL',
    decimals: 18,
    isNative: true,
    priceUSD: 0.09784
  };
  const usdtPolygon = defaultTokenService.getTokensForChain('polygon').find((t) => t.symbol === 'USDT') || {
    address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
    chainId: 'polygon',
    name: 'Tether USD',
    symbol: 'USDT',
    decimals: 6,
    priceUSD: 1.0
  };

  const qsProvider = new QuickSwapProvider();
  const quote = await qsProvider.getQuote({
    chainId: polygon.chainId!,
    tokenIn: polToken,
    tokenOut: usdtPolygon,
    amountIn: 1_000_000_000_000_000_000n,
    slippageToleranceBps: 50
  });

  assert.ok(quote, 'QuickSwap quote should be generated');
  assert.equal(quote.provider, 'QUICKSWAP');
  assert.ok(quote.amountOut > 0n, 'Amount out must be positive');
  assert.ok(quote.amountOut < 1_000_000n, '1 POL must yield ~0.0975 USDT (97,546 units), NOT 99 billion units');
  assert.equal(quote.executionTarget.toLowerCase(), '0xf5b509bB0909a69B1c207E495f687a596C168E12'.toLowerCase());

  const execution = await qsProvider.buildExecution(quote, USER_ADDR);
  assert.ok(execution.data.startsWith('0x'), 'Calldata must start with 0x');
  assert.ok(execution.data.length > 10, 'Calldata must be valid ABI encoded function');
  assert.equal(execution.to.toLowerCase(), '0xf5b509bB0909a69B1c207E495f687a596C168E12'.toLowerCase());
});

test('2. Aerodrome Provider on Base produces valid swapExactETHForTokens calldata', async () => {
  const baseChain = defaultChainRegistry.getChain('base')!;
  const ethToken = defaultTokenService.getNativeToken('base') || {
    address: '0x0000000000000000000000000000000000000000',
    chainId: 'base',
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
    isNative: true,
    priceUSD: 2500
  };
  const usdcBase = defaultTokenService.getTokensForChain('base').find((t) => t.symbol === 'USDC') || {
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    chainId: 'base',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    priceUSD: 1.0
  };

  const aeroProvider = new AerodromeProvider();
  const quote = await aeroProvider.getQuote({
    chainId: baseChain.chainId!,
    tokenIn: ethToken,
    tokenOut: usdcBase,
    amountIn: 1_000_000_000_000_000_000n,
    slippageToleranceBps: 50
  });

  assert.ok(quote, 'Aerodrome quote must exist');
  assert.equal(quote.provider, 'AERODROME');
  assert.equal(quote.executionTarget.toLowerCase(), '0xcF77a3Ba9A5CA399B7c97c74856154990ED379bC'.toLowerCase());

  const exec = await aeroProvider.buildExecution(quote, USER_ADDR);
  assert.ok(exec.data.startsWith('0x'));
  assert.ok(exec.data.length > 50, 'Aerodrome calldata must be non-empty function call');
  assert.equal(exec.value, '1000000000000000000');
});

test('3. Velodrome Provider on Optimism produces valid calldata', async () => {
  const opChain = defaultChainRegistry.getChain('optimism')!;
  const ethToken = defaultTokenService.getNativeToken('optimism')!;
  const usdcOp = defaultTokenService.getTokensForChain('optimism').find((t) => t.symbol === 'USDC')!;

  const veloProvider = new VelodromeProvider();
  const quote = await veloProvider.getQuote({
    chainId: opChain.chainId!,
    tokenIn: ethToken,
    tokenOut: usdcOp,
    amountIn: 1_000_000_000_000_000_000n,
    slippageToleranceBps: 50
  });

  assert.ok(quote);
  assert.equal(quote.provider, 'VELODROME');
  assert.equal(quote.executionTarget.toLowerCase(), '0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858'.toLowerCase());

  const exec = await veloProvider.buildExecution(quote, USER_ADDR);
  assert.ok(exec.data.startsWith('0x'));
  assert.ok(exec.data.length > 50);
});

test('4. Across Bridge Provider produces valid depositV3 calldata', async () => {
  const eth = defaultTokenService.getNativeToken('ethereum')!;
  const ethArb = defaultTokenService.getNativeToken('arbitrum')!;

  const quote = await defaultAcrossProvider.getQuote({
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    tokenIn: eth,
    tokenOut: ethArb,
    amountInRaw: '1000000000000000000',
    slippageTolerancePercent: 0.5,
    userWalletAddress: USER_ADDR
  });

  assert.ok(quote);
  assert.equal(quote.provider, 'ACROSS');
  assert.ok(quote.calldata.startsWith('0x') && quote.calldata.length > 20, 'Across quote preview calldata must be valid');

  const exec = await defaultAcrossProvider.buildExecution(quote, USER_ADDR);
  assert.ok(exec.data.startsWith('0x') && exec.data.length > 20);
  assert.equal(exec.to.toLowerCase(), '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5'.toLowerCase());
});

test('5. deBridge DLN Provider produces valid createOrder calldata', async () => {
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcPoly = defaultTokenService.getTokensForChain('polygon').find((t) => t.symbol === 'USDC')!;

  const quote = await defaultDeBridgeProvider.getQuote({
    sourceChainId: 'ethereum',
    destinationChainId: 'polygon',
    tokenIn: usdcEth,
    tokenOut: usdcPoly,
    amountInRaw: '1000000',
    slippageTolerancePercent: 0.5,
    userWalletAddress: USER_ADDR
  });

  assert.ok(quote);
  assert.equal(quote.provider, 'DEBRIDGE_DLN');
  assert.ok(quote.calldata.startsWith('0x') && quote.calldata.length > 20, 'deBridge quote preview calldata must be valid');

  const exec = await defaultDeBridgeProvider.buildExecution(quote, USER_ADDR);
  assert.ok(exec.data.startsWith('0x') && exec.data.length > 20);
  assert.equal(exec.to.toLowerCase(), '0xeF4fB24aD0916217251F553c0596F8Edc630EB66'.toLowerCase());
});

test('6. Stargate Provider produces valid LayerZero swap calldata', async () => {
  const usdcEth = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;
  const usdcArb = defaultTokenService.getTokensForChain('arbitrum').find((t) => t.symbol === 'USDC')!;

  const quote = await defaultStargateProvider.getQuote({
    sourceChainId: 'ethereum',
    destinationChainId: 'arbitrum',
    tokenIn: usdcEth,
    tokenOut: usdcArb,
    amountInRaw: '1000000',
    slippageTolerancePercent: 0.5,
    userWalletAddress: USER_ADDR
  });

  assert.ok(quote);
  assert.equal(quote.provider, 'STARGATE');
  assert.ok(quote.calldata.startsWith('0x') && quote.calldata.length > 20, 'Stargate preview calldata must be valid');

  const exec = await defaultStargateProvider.buildExecution(quote, USER_ADDR);
  assert.ok(exec.data.startsWith('0x') && exec.data.length > 20);
  assert.equal(exec.to.toLowerCase(), '0x8731d54E9D02c286767d56ac03e8037C07e01e98'.toLowerCase());
});

test('7. ZenithRouter end-to-end executable quote on Polygon (POL -> USDT)', async () => {
  const polToken = defaultTokenService.getNativeToken('polygon') || {
    address: '0x0000000000000000000000000000000000000000',
    chainId: 'polygon',
    name: 'Polygon Ecosystem Token',
    symbol: 'POL',
    decimals: 18,
    isNative: true,
    priceUSD: 0.09784
  };
  const usdtPolygon = defaultTokenService.getTokensForChain('polygon').find((t) => t.symbol === 'USDT') || {
    address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
    chainId: 'polygon',
    name: 'Tether USD',
    symbol: 'USDT',
    decimals: 6,
    priceUSD: 1.0
  };

  const quoteResp = await defaultZenithRouter.getQuote({
    sourceChainId: 'polygon',
    destinationChainId: 'polygon',
    tokenIn: polToken,
    tokenOut: usdtPolygon,
    amountInRaw: '1000000000000000000',
    slippageTolerancePercent: 0.5,
    userWalletAddress: USER_ADDR
  });

  assert.ok(quoteResp);
  assert.equal(quoteResp.isExecutable, true, 'Quote must be executable when user wallet is provided');
  assert.ok(quoteResp.executableTransaction, 'ExecutableTransaction must be present');
  assert.equal(quoteResp.executableTransaction!.from, USER_ADDR);
  assert.ok(quoteResp.executableTransaction!.data.length > 10, 'Calldata must be non-empty');
  assert.equal(quoteResp.validation.isValid, true);
  assert.equal(quoteResp.validation.isExecutable, true);

  const outBig = BigInt(quoteResp.amountOutRaw);
  assert.ok(outBig > 80_000n && outBig < 120_000n, `1 POL ($0.0978) -> ~0.0975 USDT (97,546 raw units). Got ${outBig}`);
  assert.ok(!quoteResp.amountOutFormatted.includes('99,960,000,000'), 'Catastrophic decimal bug must NOT exist');
});

test('8. ZenithRouter informational quote without wallet is NOT marked executable', async () => {
  const eth = defaultTokenService.getNativeToken('ethereum')!;
  const usdc = defaultTokenService.getTokensForChain('ethereum').find((t) => t.symbol === 'USDC')!;

  const quoteResp = await defaultZenithRouter.getQuote({
    sourceChainId: 'ethereum',
    destinationChainId: 'ethereum',
    tokenIn: eth,
    tokenOut: usdc,
    amountInRaw: '1000000000000000000',
    slippageTolerancePercent: 0.5
  });

  assert.ok(quoteResp);
  assert.equal(quoteResp.isExecutable, false, 'Without wallet connected, quote is informational only');
  assert.equal(quoteResp.validation.isExecutable, false);
  assert.ok(quoteResp.validation.warnings.length > 0);
});
