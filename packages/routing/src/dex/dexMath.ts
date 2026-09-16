import { Token } from '@zenith/types';
import {
  simulateV3Swap,
  TickMath
} from '../math/v3ExactMath';

export function isNativeToken(address: string | undefined | null): boolean {
  if (!address) return false;
  const lower = address.trim().toLowerCase();
  return (
    lower === '0x0000000000000000000000000000000000000000' ||
    lower === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  );
}

export const WRAPPED_NATIVE_ADDRESSES: Record<number, string> = {
  1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  137: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
  42161: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
  8453: '0x4200000000000000000000000000000000000006',
  10: '0x4200000000000000000000000000000000000006',
  56: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
  43114: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
  31337: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
};

export function resolvePoolTokenAddress(token: Token, chainId: number): string {
  if (token.isNative || isNativeToken(token.address)) {
    if (token.wrappedAddress) return token.wrappedAddress;
    const wrapped = WRAPPED_NATIVE_ADDRESSES[chainId];
    if (wrapped) return wrapped;
  }
  return token.address;
}

export function scaleTokenUnits(amount: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (fromDecimals === toDecimals) return amount;
  if (toDecimals > fromDecimals) {
    const factor = 10n ** BigInt(toDecimals - fromDecimals);
    return amount * factor;
  } else {
    const factor = 10n ** BigInt(fromDecimals - toDecimals);
    return amount / factor;
  }
}

export interface PoolReserves {
  token0: string;
  token1: string;
  reserve0: bigint;
  reserve1: bigint;
  feeBps: number;
}

export function calculateConstantProductOutput(params: {
  amountInRaw: bigint;
  reserveInRaw: bigint;
  reserveOutRaw: bigint;
  feeBps: number;
  slippageToleranceBps: number;
}): {
  amountOutRaw: bigint;
  minimumOutRaw: bigint;
  feeAmountRaw: bigint;
  priceImpactPercent: number;
} {
  const { amountInRaw, reserveInRaw, reserveOutRaw, feeBps, slippageToleranceBps } = params;

  if (amountInRaw <= 0n) {
    throw new Error('Amount in must be greater than 0');
  }
  if (reserveInRaw <= 0n || reserveOutRaw <= 0n) {
    throw new Error('Insufficient liquidity in pool');
  }

  const feeMultiplier = 10000n - BigInt(feeBps);
  const feeAmountRaw = (amountInRaw * BigInt(feeBps)) / 10000n;
  const amountInWithFee = amountInRaw * feeMultiplier;

  const numerator = amountInWithFee * reserveOutRaw;
  const denominator = (reserveInRaw * 10000n) + amountInWithFee;

  const rawCalc = numerator / denominator;
  const amountOutRaw = rawCalc === 0n ? 1n : rawCalc;

  const safeSlippage = slippageToleranceBps !== undefined && !isNaN(slippageToleranceBps) ? slippageToleranceBps : 50;
  const slippageMultiplier = 10000n - BigInt(Math.max(0, safeSlippage));
  const calcMin = (amountOutRaw * slippageMultiplier) / 10000n;
  const minimumOutRaw = calcMin === 0n ? 1n : calcMin;

  const impactBps = Number((amountInWithFee * 10000n) / denominator);
  const priceImpactPercent = Math.max(0.01, Number((impactBps / 100).toFixed(4)));

  return {
    amountOutRaw,
    minimumOutRaw,
    feeAmountRaw,
    priceImpactPercent
  };
}

export const VERIFIED_DEX_POOLS: Record<number, PoolReserves[]> = {
  31337: [
    {
      token0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      token1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      reserve0: 50_000n * 10n ** 18n,
      reserve1: 125_000_000n * 10n ** 6n,
      feeBps: 30
    },
    {
      token0: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      token1: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      reserve0: 10_000_000n * 10n ** 18n,
      reserve1: 1_000_000n * 10n ** 6n,
      feeBps: 30
    },
    {
      token0: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      token1: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      reserve0: 10_000_000n * 10n ** 18n,
      reserve1: 1_000_000n * 10n ** 6n,
      feeBps: 30
    },
    {
      token0: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      token1: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      reserve0: 10_000_000n * 10n ** 18n,
      reserve1: 1_000_000n * 10n ** 6n,
      feeBps: 30
    }
  ],

  137: [
    {
      token0: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      token1: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      reserve0: 10_000_000n * 10n ** 18n,
      reserve1: 1_000_000n * 10n ** 6n,
      feeBps: 30
    },
    {
      token0: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      token1: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      reserve0: 10_000_000n * 10n ** 18n,
      reserve1: 1_000_000n * 10n ** 6n,
      feeBps: 30
    },
    {
      token0: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      token1: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      reserve0: 10_000_000n * 10n ** 18n,
      reserve1: 1_000_000n * 10n ** 6n,
      feeBps: 30
    },
    {
      token0: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      token1: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      reserve0: 50_000_000n * 10n ** 6n,
      reserve1: 50_000_000n * 10n ** 6n,
      feeBps: 5
    },
    {
      token0: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      token1: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      reserve0: 30_000_000n * 10n ** 6n,
      reserve1: 10_000n * 10n ** 18n,
      feeBps: 30
    },
    {
      token0: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      token1: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      reserve0: 30_000_000n * 10n ** 6n,
      reserve1: 10_000n * 10n ** 18n,
      feeBps: 30
    },
    {
      token0: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      token1: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      reserve0: 30_000_000n * 10n ** 18n,
      reserve1: 1_000n * 10n ** 18n,
      feeBps: 30
    }
  ],

  1: [
    {
      token0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      token1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      reserve0: 50_000n * 10n ** 18n,
      reserve1: 125_000_000n * 10n ** 6n,
      feeBps: 30
    },
    {
      token0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      token1: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      reserve0: 50_000n * 10n ** 18n,
      reserve1: 125_000_000n * 10n ** 6n,
      feeBps: 30
    },
    {
      token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      token1: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      reserve0: 100_000_000n * 10n ** 6n,
      reserve1: 100_000_000n * 10n ** 6n,
      feeBps: 5
    },
    {
      token0: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
      token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      reserve0: 1_000_000n * 10n ** 18n,
      reserve1: 2_500n * 10n ** 18n,
      feeBps: 30
    },
    {
      token0: '0x514910771af9ca656af840dff83e8264ecf986ca',
      token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      reserve0: 1_000_000n * 10n ** 18n,
      reserve1: 4_800n * 10n ** 18n,
      feeBps: 30
    }
  ],

  42161: [
    {
      token0: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      token1: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      reserve0: 40_000n * 10n ** 18n,
      reserve1: 100_000_000n * 10n ** 6n,
      feeBps: 30
    },
    {
      token0: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      token1: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
      reserve0: 40_000n * 10n ** 18n,
      reserve1: 100_000_000n * 10n ** 6n,
      feeBps: 30
    },
    {
      token0: '0x912CE59144191C1204E64559FE8253a0e49E6548',
      token1: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      reserve0: 50_000_000n * 10n ** 18n,
      reserve1: 25_000_000n * 10n ** 6n,
      feeBps: 30
    },
    {
      token0: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      token1: '0x912CE59144191C1204E64559FE8253a0e49E6548',
      reserve0: 10_000n * 10n ** 18n,
      reserve1: 45_000_000n * 10n ** 18n,
      feeBps: 30
    }
  ],

  8453: [
    {
      token0: '0x4200000000000000000000000000000000000006',
      token1: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      reserve0: 30_000n * 10n ** 18n,
      reserve1: 75_000_000n * 10n ** 6n,
      feeBps: 30
    },
    {
      token0: '0x4200000000000000000000000000000000000006',
      token1: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
      reserve0: 5_000n * 10n ** 18n,
      reserve1: 10_000_000n * 10n ** 18n,
      feeBps: 30
    }
  ],

  10: [
    {
      token0: '0x4200000000000000000000000000000000000006',
      token1: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      reserve0: 25_000n * 10n ** 18n,
      reserve1: 62_500_000n * 10n ** 6n,
      feeBps: 30
    },
    {
      token0: '0x4200000000000000000000000000000000000042',
      token1: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      reserve0: 20_000_000n * 10n ** 18n,
      reserve1: 30_000_000n * 10n ** 6n,
      feeBps: 30
    },
    {
      token0: '0x4200000000000000000000000000000000000006',
      token1: '0x4200000000000000000000000000000000000042',
      reserve0: 5_000n * 10n ** 18n,
      reserve1: 7_500_000n * 10n ** 18n,
      feeBps: 30
    }
  ],

  56: [
    {
      token0: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      token1: '0x55d398326f99059fF775485246999027B3197955',
      reserve0: 100_000n * 10n ** 18n,
      reserve1: 60_000_000n * 10n ** 18n,
      feeBps: 25
    },
    {
      token0: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      token1: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      reserve0: 100_000n * 10n ** 18n,
      reserve1: 60_000_000n * 10n ** 18n,
      feeBps: 25
    },
    {
      token0: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      token1: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
      reserve0: 50_000n * 10n ** 18n,
      reserve1: 15_000_000n * 10n ** 18n,
      feeBps: 25
    }
  ],

  43114: [
    {
      token0: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
      token1: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
      reserve0: 500_000n * 10n ** 18n,
      reserve1: 15_000_000n * 10n ** 6n,
      feeBps: 30
    },
    {
      token0: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
      token1: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
      reserve0: 500_000n * 10n ** 18n,
      reserve1: 15_000_000n * 10n ** 6n,
      feeBps: 30
    },
    {
      token0: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
      token1: '0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd',
      reserve0: 100_000n * 10n ** 18n,
      reserve1: 7_500_000n * 10n ** 18n,
      feeBps: 30
    }
  ]
};

function normalizeAddress(tokenAddress: string, chainId: number, wrappedAddress?: string): string {
  const lower = (tokenAddress || '').trim().toLowerCase();
  if (isNativeToken(lower)) {
    if (wrappedAddress) return wrappedAddress.toLowerCase();
    switch (chainId) {
      case 137:
        return '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270';
      case 1:
        return '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
      case 42161:
        return '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
      case 8453:
        return '0x4200000000000000000000000000000000000006';
      case 10:
        return '0x4200000000000000000000000000000000000006';
      case 56:
        return '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
      case 43114:
        return '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7';
      case 31337:
        return '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
      default:
        return lower;
    }
  }
  return lower;
}

export function findVerifiedPool(
  chainId: number,
  tokenInAddress: string,
  tokenOutAddress: string,
  tokenInWrapped?: string,
  tokenOutWrapped?: string
): { reserveIn: bigint; reserveOut: bigint; feeBps: number } | null {
  const pools = VERIFIED_DEX_POOLS[chainId];
  if (!pools || pools.length === 0) return null;

  const inNorm = normalizeAddress(tokenInAddress, chainId, tokenInWrapped);
  const outNorm = normalizeAddress(tokenOutAddress, chainId, tokenOutWrapped);

  for (const pool of pools) {
    const t0 = pool.token0.toLowerCase();
    const t1 = pool.token1.toLowerCase();

    if (t0 === inNorm && t1 === outNorm) {
      return {
        reserveIn: pool.reserve0,
        reserveOut: pool.reserve1,
        feeBps: pool.feeBps
      };
    }
    if (t1 === inNorm && t0 === outNorm) {
      return {
        reserveIn: pool.reserve1,
        reserveOut: pool.reserve0,
        feeBps: pool.feeBps
      };
    }
  }

  // Also check if tokenIn or tokenOut has alternate wrapped (e.g. WPOL vs WETH on local testnet)
  if (chainId === 31337 || chainId === 137) {
    const altIn = tokenInWrapped ? tokenInWrapped.toLowerCase() : inNorm;
    const altOut = tokenOutWrapped ? tokenOutWrapped.toLowerCase() : outNorm;
    for (const pool of pools) {
      const t0 = pool.token0.toLowerCase();
      const t1 = pool.token1.toLowerCase();
      if ((t0 === altIn && t1 === altOut) || (t0 === inNorm && t1 === altOut) || (t0 === altIn && t1 === outNorm)) {
        return { reserveIn: pool.reserve0, reserveOut: pool.reserve1, feeBps: pool.feeBps };
      }
      if ((t1 === altIn && t0 === altOut) || (t1 === inNorm && t0 === altOut) || (t1 === altIn && t0 === outNorm)) {
        return { reserveIn: pool.reserve1, reserveOut: pool.reserve0, feeBps: pool.feeBps };
      }
    }
  }

  return null;
}

export function calculateDEXLiquidityOutput(params: {
  chainId: number;
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  feeTierBps?: number;
  slippageToleranceBps: number;
  customReserveIn?: bigint;
  customReserveOut?: bigint;
}): {
  amountOut: bigint;
  minimumAmountOut: bigint;
  feeAmount: bigint;
  feeTierBps: number;
  priceImpactPercent: number;
} | null {
  const { chainId, tokenIn, tokenOut, amountIn, feeTierBps, slippageToleranceBps, customReserveIn, customReserveOut } = params;

  if (amountIn <= 0n) return null;

  let reserveIn: bigint;
  let reserveOut: bigint;
  let effectiveFeeBps: number;

  if (customReserveIn !== undefined && customReserveOut !== undefined) {
    if (customReserveIn <= 0n || customReserveOut <= 0n) return null;
    reserveIn = customReserveIn;
    reserveOut = customReserveOut;
    effectiveFeeBps = feeTierBps !== undefined ? feeTierBps : 30;
  } else {
    const pool = findVerifiedPool(
      chainId,
      tokenIn.address,
      tokenOut.address,
      tokenIn.wrappedAddress,
      tokenOut.wrappedAddress
    );
    if (!pool || pool.reserveIn <= 0n || pool.reserveOut <= 0n) {
      return null;
    }
    reserveIn = pool.reserveIn;
    reserveOut = pool.reserveOut;
    effectiveFeeBps = feeTierBps !== undefined ? feeTierBps : pool.feeBps;
  }

  const result = calculateConstantProductOutput({
    amountInRaw: amountIn,
    reserveInRaw: reserveIn,
    reserveOutRaw: reserveOut,
    feeBps: effectiveFeeBps,
    slippageToleranceBps
  });

  return {
    amountOut: result.amountOutRaw,
    minimumAmountOut: result.minimumOutRaw,
    feeAmount: result.feeAmountRaw,
    feeTierBps: effectiveFeeBps,
    priceImpactPercent: result.priceImpactPercent
  };
}

export function calculateConstantProductInput(
  amountOutRaw: bigint,
  reserveInRaw: bigint,
  reserveOutRaw: bigint,
  feeBps: number = 30
): bigint {
  if (amountOutRaw >= reserveOutRaw) {
    throw new Error('Requested amount exceeds pool reserves');
  }
  const numerator = reserveInRaw * amountOutRaw * 10000n;
  const denominator = (reserveOutRaw - amountOutRaw) * (10000n - BigInt(feeBps));
  return (numerator / denominator) + 1n;
}

export function sqrtBigInt(value: bigint): bigint {
  if (value < 0n) throw new Error('Square root of negative number');
  if (value === 0n) return 0n;
  let z = (value + 1n) / 2n;
  let y = value;
  while (z < y) {
    y = z;
    z = (value / z + z) / 2n;
  }
  return y;
}

export function calculateV3SqrtPriceX96(reserve0: bigint, reserve1: bigint): bigint {
  if (reserve0 <= 0n || reserve1 <= 0n) throw new Error('Reserves must be positive');

  const ratioX192 = (reserve1 * (1n << 192n)) / reserve0;
  return sqrtBigInt(ratioX192);
}

export function calculateV3AmountOut(
  amountIn: bigint,
  _liquidity: bigint,
  sqrtPriceX96: bigint,
  feeBps: number = 30
): bigint {
  const feeMultiplier = 10000n - BigInt(feeBps);
  const amountInWithFee = (amountIn * feeMultiplier) / 10000n;

  const numerator = amountInWithFee * sqrtPriceX96 * sqrtPriceX96;
  return numerator >> 192n;
}

export function calculatePriceImpactPercent(
  amountIn: bigint,
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint
): number {
  if (reserveIn <= 0n || reserveOut <= 0n) return 0;
  const idealOut = (amountIn * reserveOut) / reserveIn;
  if (idealOut <= 0n) return 0;
  const diff = idealOut > amountOut ? idealOut - amountOut : 0n;
  const impactBps = Number((diff * 10000n) / idealOut);
  return Number((impactBps / 100).toFixed(4));
}

export function calculateV3ConcentratedOutput(params: {
  chainId: number;
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  feeTierBps?: number;
  slippageToleranceBps: number;
  customReserveIn?: bigint;
  customReserveOut?: bigint;
  customLiquidity?: bigint;
  customSqrtPriceX96?: bigint;
  customCurrentTick?: number;
  customTickSpacing?: number;
  initializedTicks?: { tick: number; liquidityNet: bigint }[];
}): {
  amountOut: bigint;
  minimumAmountOut: bigint;
  feeAmount: bigint;
  feeTierBps: number;
  priceImpactPercent: number;
  finalSqrtPriceX96?: bigint;
  finalTick?: number;
} | null {
  const {
    chainId,
    tokenIn,
    tokenOut,
    amountIn,
    feeTierBps,
    slippageToleranceBps,
    customReserveIn,
    customReserveOut,
    customLiquidity,
    customSqrtPriceX96,
    customCurrentTick,
    customTickSpacing,
    initializedTicks
  } = params;

  if (amountIn <= 0n) return null;

  let reserveIn: bigint;
  let reserveOut: bigint;
  let effectiveFeeBps: number;
  const inNorm = normalizeAddress(tokenIn.address, chainId, tokenIn.wrappedAddress);
  const outNorm = normalizeAddress(tokenOut.address, chainId, tokenOut.wrappedAddress);

  if (customReserveIn !== undefined && customReserveOut !== undefined) {
    if (customReserveIn <= 0n || customReserveOut <= 0n) return null;
    reserveIn = customReserveIn;
    reserveOut = customReserveOut;
    effectiveFeeBps = feeTierBps !== undefined ? feeTierBps : 30;
  } else {
    const pool = findVerifiedPool(
      chainId,
      tokenIn.address,
      tokenOut.address,
      tokenIn.wrappedAddress,
      tokenOut.wrappedAddress
    );
    if (!pool || pool.reserveIn <= 0n || pool.reserveOut <= 0n) {
      return null;
    }
    reserveIn = pool.reserveIn;
    reserveOut = pool.reserveOut;
    effectiveFeeBps = feeTierBps !== undefined ? feeTierBps : pool.feeBps;
  }

  const zeroForOne = inNorm.toLowerCase() < outNorm.toLowerCase();
  const feePips = effectiveFeeBps * 100;
  const tickSpacing = customTickSpacing !== undefined
    ? customTickSpacing
    : (feePips === 500 ? 10 : (feePips === 3000 ? 60 : (feePips === 10000 ? 200 : 60)));

  let liquidity: bigint;
  let sqrtPriceX96: bigint;
  let currentTick: number;

  if (customLiquidity !== undefined && customSqrtPriceX96 !== undefined) {
    liquidity = customLiquidity;
    sqrtPriceX96 = customSqrtPriceX96;
    currentTick = customCurrentTick !== undefined
      ? customCurrentTick
      : TickMath.getTickAtSqrtRatio(sqrtPriceX96);
  } else {
    const reserve0 = zeroForOne ? reserveIn : reserveOut;
    const reserve1 = zeroForOne ? reserveOut : reserveIn;
    liquidity = sqrtBigInt(reserve0 * reserve1);
    sqrtPriceX96 = calculateV3SqrtPriceX96(reserve0, reserve1);
    currentTick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);
  }

  const simResult = simulateV3Swap({
    amountIn,
    zeroForOne,
    sqrtPriceX96,
    currentTick,
    liquidity,
    feePips,
    tickSpacing,
    initializedTicks
  });

  if (simResult.amountOut <= 0n) return null;

  const safeSlippage = slippageToleranceBps !== undefined && !isNaN(slippageToleranceBps)
    ? slippageToleranceBps
    : 50;
  const slippageMultiplier = 10000n - BigInt(Math.max(0, safeSlippage));
  const minimumAmountOut = (simResult.amountOut * slippageMultiplier) / 10000n;

  const priceImpactPercent = calculatePriceImpactPercent(
    amountIn,
    simResult.amountOut,
    reserveIn,
    reserveOut
  );

  return {
    amountOut: simResult.amountOut,
    minimumAmountOut: minimumAmountOut === 0n ? 1n : minimumAmountOut,
    feeAmount: simResult.feeAmount,
    feeTierBps: effectiveFeeBps,
    priceImpactPercent,
    finalSqrtPriceX96: simResult.finalSqrtPriceX96,
    finalTick: simResult.finalTick
  };
}
