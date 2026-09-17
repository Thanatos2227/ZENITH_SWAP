import { Token } from '@zenith/types';
import {
  simulateV3Swap,
  TickMath,
  TickInfo
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

export function calculateDEXLiquidityOutput(params: {
  chainId: number;
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  reserveIn: bigint;
  reserveOut: bigint;
  feeTierBps?: number;
  slippageToleranceBps: number;
}): {
  amountOut: bigint;
  minimumAmountOut: bigint;
  feeAmount: bigint;
  feeTierBps: number;
  priceImpactPercent: number;
} | null {
  const { amountIn, reserveIn, reserveOut, feeTierBps, slippageToleranceBps } = params;

  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return null;

  const effectiveFeeBps = feeTierBps !== undefined ? feeTierBps : 30;

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

export function calculateV3ConcentratedOutput(params: {
  chainId: number;
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  liquidity: bigint;
  sqrtPriceX96: bigint;
  currentTick?: number;
  feeTierBps?: number;
  tickSpacing?: number;
  slippageToleranceBps: number;
  initializedTicks?: TickInfo[];
  reserveIn?: bigint;
  reserveOut?: bigint;
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
    liquidity,
    sqrtPriceX96,
    currentTick: customCurrentTick,
    feeTierBps,
    tickSpacing: customTickSpacing,
    slippageToleranceBps,
    initializedTicks,
    reserveIn,
    reserveOut
  } = params;

  if (amountIn <= 0n || liquidity <= 0n || sqrtPriceX96 <= 0n) return null;

  const inNorm = resolvePoolTokenAddress(tokenIn, chainId).toLowerCase();
  const outNorm = resolvePoolTokenAddress(tokenOut, chainId).toLowerCase();
  const zeroForOne = inNorm < outNorm;

  const effectiveFeeBps = feeTierBps !== undefined ? feeTierBps : 30;
  const feePips = effectiveFeeBps * 100;
  const tickSpacing = customTickSpacing !== undefined
    ? customTickSpacing
    : (feePips === 100 ? 1 : (feePips === 500 ? 10 : (feePips === 3000 ? 60 : (feePips === 10000 ? 200 : 60))));

  const currentTick = customCurrentTick !== undefined
    ? customCurrentTick
    : TickMath.getTickAtSqrtRatio(sqrtPriceX96);

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

  let priceImpactPercent = 0.01;
  if (reserveIn !== undefined && reserveOut !== undefined && reserveIn > 0n && reserveOut > 0n) {
    priceImpactPercent = calculatePriceImpactPercent(
      amountIn,
      simResult.amountOut,
      reserveIn,
      reserveOut
    );
  }

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
