export const Q96 = 2n ** 96n;
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
export const MIN_SQRT_RATIO = 4295128739n;
export const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

export class FullMath {
  public static mulDiv(a: bigint, b: bigint, denominator: bigint): bigint {
    if (denominator === 0n) throw new Error('FullMath: DIVISION_BY_ZERO');
    return (a * b) / denominator;
  }

  public static mulDivRoundingUp(a: bigint, b: bigint, denominator: bigint): bigint {
    if (denominator === 0n) throw new Error('FullMath: DIVISION_BY_ZERO');
    const result = (a * b) / denominator;
    if ((a * b) % denominator > 0n) {
      return result + 1n;
    }
    return result;
  }
}

export class TickMath {
  public static getSqrtRatioAtTick(tick: number): bigint {
    if (tick < MIN_TICK || tick > MAX_TICK) {
      throw new Error('TickMath: T_BOUND');
    }
    const absTick = BigInt(Math.abs(tick));

    let ratio = (absTick & 0x1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
    if ((absTick & 0x2n) !== 0n) ratio = (ratio * 0xfff97272373d413259a46990570e21b7n) >> 128n;
    if ((absTick & 0x4n) !== 0n) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n;
    if ((absTick & 0x8n) !== 0n) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n;
    if ((absTick & 0x10n) !== 0n) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n;
    if ((absTick & 0x20n) !== 0n) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n;
    if ((absTick & 0x40n) !== 0n) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n;
    if ((absTick & 0x80n) !== 0n) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n;
    if ((absTick & 0x100n) !== 0n) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n;
    if ((absTick & 0x200n) !== 0n) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n;
    if ((absTick & 0x400n) !== 0n) ratio = (ratio * 0xf3392b08373b12369547b125a0b0fe16n) >> 128n;
    if ((absTick & 0x800n) !== 0n) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n;
    if ((absTick & 0x1000n) !== 0n) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n;
    if ((absTick & 0x2000n) !== 0n) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n;
    if ((absTick & 0x4000n) !== 0n) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n;
    if ((absTick & 0x8000n) !== 0n) ratio = (ratio * 0x31be135b97d08fd981231505542fcfa6n) >> 128n;
    if ((absTick & 0x10000n) !== 0n) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f0099bc8n) >> 128n;
    if ((absTick & 0x20000n) !== 0n) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n;
    if ((absTick & 0x40000n) !== 0n) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n;
    if ((absTick & 0x80000n) !== 0n) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n;

    const UINT256_MAX = 2n ** 256n - 1n;
    if (tick > 0) {
      ratio = UINT256_MAX / ratio;
    }

    const sqrtPriceX96 = (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
    return sqrtPriceX96;
  }

  public static getTickAtSqrtRatio(sqrtPriceX96: bigint): number {
    if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO) {
      throw new Error('TickMath: R_BOUND');
    }

    let low = MIN_TICK;
    let high = MAX_TICK;

    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2);
      const ratio = this.getSqrtRatioAtTick(mid);
      if (ratio <= sqrtPriceX96) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low;
  }
}

export class SqrtPriceMath {
  public static getAmount0Delta(
    sqrtRatioAX96: bigint,
    sqrtRatioBX96: bigint,
    liquidity: bigint,
    roundUp: boolean = false
  ): bigint {
    let [a, b] = [sqrtRatioAX96, sqrtRatioBX96];
    if (a > b) [a, b] = [b, a];
    if (a <= 0n) throw new Error('SqrtPriceMath: ZERO_RATIO');

    const numerator1 = liquidity << 96n;
    const numerator2 = b - a;

    if (roundUp) {
      return FullMath.mulDivRoundingUp(
        FullMath.mulDivRoundingUp(numerator1, numerator2, b),
        1n,
        a
      );
    }
    return FullMath.mulDiv(numerator1, numerator2, b) / a;
  }

  public static getAmount1Delta(
    sqrtRatioAX96: bigint,
    sqrtRatioBX96: bigint,
    liquidity: bigint,
    roundUp: boolean = false
  ): bigint {
    let [a, b] = [sqrtRatioAX96, sqrtRatioBX96];
    if (a > b) [a, b] = [b, a];

    if (roundUp) {
      return FullMath.mulDivRoundingUp(liquidity, b - a, Q96);
    }
    return FullMath.mulDiv(liquidity, b - a, Q96);
  }

  public static getNextSqrtPriceFromAmount0RoundingUp(
    sqrtPX96: bigint,
    liquidity: bigint,
    amount: bigint,
    add: boolean
  ): bigint {
    if (amount === 0n) return sqrtPX96;
    const numerator1 = liquidity << 96n;

    if (add) {
      const product = amount * sqrtPX96;
      if (product / amount === sqrtPX96) {
        const denominator = numerator1 + product;
        if (denominator >= numerator1) {
          return FullMath.mulDivRoundingUp(numerator1, sqrtPX96, denominator);
        }
      }
      return FullMath.mulDivRoundingUp(numerator1, 1n, (numerator1 / sqrtPX96) + amount);
    } else {
      const product = amount * sqrtPX96;
      if (product / amount !== sqrtPX96 || numerator1 <= product) {
        throw new Error('SqrtPriceMath: UNDERFLOW');
      }
      const denominator = numerator1 - product;
      return FullMath.mulDivRoundingUp(numerator1, sqrtPX96, denominator);
    }
  }

  public static getNextSqrtPriceFromAmount1RoundingDown(
    sqrtPX96: bigint,
    liquidity: bigint,
    amount: bigint,
    add: boolean
  ): bigint {
    if (add) {
      const quotient = (amount << 96n) / liquidity;
      return sqrtPX96 + quotient;
    } else {
      const quotient = FullMath.mulDivRoundingUp(amount, Q96, liquidity);
      if (sqrtPX96 <= quotient) throw new Error('SqrtPriceMath: UNDERFLOW');
      return sqrtPX96 - quotient;
    }
  }

  public static getNextSqrtPriceFromInput(
    sqrtPX96: bigint,
    liquidity: bigint,
    amountIn: bigint,
    zeroForOne: boolean
  ): bigint {
    if (sqrtPX96 <= 0n) throw new Error('SqrtPriceMath: ZERO_SQRT_P');
    if (liquidity <= 0n) throw new Error('SqrtPriceMath: ZERO_LIQ');

    return zeroForOne
      ? this.getNextSqrtPriceFromAmount0RoundingUp(sqrtPX96, liquidity, amountIn, true)
      : this.getNextSqrtPriceFromAmount1RoundingDown(sqrtPX96, liquidity, amountIn, true);
  }

  public static getNextSqrtPriceFromOutput(
    sqrtPX96: bigint,
    liquidity: bigint,
    amountOut: bigint,
    zeroForOne: boolean
  ): bigint {
    if (sqrtPX96 <= 0n) throw new Error('SqrtPriceMath: ZERO_SQRT_P');
    if (liquidity <= 0n) throw new Error('SqrtPriceMath: ZERO_LIQ');

    return zeroForOne
      ? this.getNextSqrtPriceFromAmount1RoundingDown(sqrtPX96, liquidity, amountOut, false)
      : this.getNextSqrtPriceFromAmount0RoundingUp(sqrtPX96, liquidity, amountOut, false);
  }
}

export class SwapMath {
  public static computeSwapStep(
    sqrtRatioCurrentX96: bigint,
    sqrtRatioTargetX96: bigint,
    liquidity: bigint,
    amountRemaining: bigint,
    feePips: number
  ): {
    sqrtRatioNextX96: bigint;
    amountIn: bigint;
    amountOut: bigint;
    feeAmount: bigint;
  } {
    const zeroForOne = sqrtRatioCurrentX96 >= sqrtRatioTargetX96;
    const exactIn = amountRemaining >= 0n;

    let sqrtRatioNextX96 = sqrtRatioTargetX96;
    let amountIn = 0n;
    let amountOut = 0n;
    let feeAmount = 0n;

    const feePipsBig = BigInt(feePips);

    if (exactIn) {
      const amountRemainingLessFee = FullMath.mulDiv(
        amountRemaining,
        1000000n - feePipsBig,
        1000000n
      );
      amountIn = zeroForOne
        ? SqrtPriceMath.getAmount0Delta(sqrtRatioTargetX96, sqrtRatioCurrentX96, liquidity, true)
        : SqrtPriceMath.getAmount1Delta(sqrtRatioCurrentX96, sqrtRatioTargetX96, liquidity, true);

      if (amountRemainingLessFee >= amountIn) {
        sqrtRatioNextX96 = sqrtRatioTargetX96;
      } else {
        sqrtRatioNextX96 = SqrtPriceMath.getNextSqrtPriceFromInput(
          sqrtRatioCurrentX96,
          liquidity,
          amountRemainingLessFee,
          zeroForOne
        );
      }
    } else {
      amountOut = zeroForOne
        ? SqrtPriceMath.getAmount1Delta(sqrtRatioTargetX96, sqrtRatioCurrentX96, liquidity, false)
        : SqrtPriceMath.getAmount0Delta(sqrtRatioCurrentX96, sqrtRatioTargetX96, liquidity, false);

      const targetAmount = -amountRemaining;
      if (targetAmount >= amountOut) {
        sqrtRatioNextX96 = sqrtRatioTargetX96;
      } else {
        sqrtRatioNextX96 = SqrtPriceMath.getNextSqrtPriceFromOutput(
          sqrtRatioCurrentX96,
          liquidity,
          targetAmount,
          zeroForOne
        );
      }
    }

    const max = sqrtRatioTargetX96 === sqrtRatioNextX96;

    if (zeroForOne) {
      amountIn = max && exactIn
        ? amountIn
        : SqrtPriceMath.getAmount0Delta(sqrtRatioNextX96, sqrtRatioCurrentX96, liquidity, true);
      amountOut = max && !exactIn
        ? amountOut
        : SqrtPriceMath.getAmount1Delta(sqrtRatioNextX96, sqrtRatioCurrentX96, liquidity, false);
    } else {
      amountIn = max && exactIn
        ? amountIn
        : SqrtPriceMath.getAmount1Delta(sqrtRatioCurrentX96, sqrtRatioNextX96, liquidity, true);
      amountOut = max && !exactIn
        ? amountOut
        : SqrtPriceMath.getAmount0Delta(sqrtRatioCurrentX96, sqrtRatioNextX96, liquidity, false);
    }

    if (!exactIn && amountOut > -amountRemaining) {
      amountOut = -amountRemaining;
    }

    if (exactIn && sqrtRatioNextX96 !== sqrtRatioTargetX96) {
      feeAmount = amountRemaining - amountIn;
    } else {
      feeAmount = FullMath.mulDivRoundingUp(amountIn, feePipsBig, 1000000n - feePipsBig);
    }

    return { sqrtRatioNextX96, amountIn, amountOut, feeAmount };
  }
}

export interface TickInfo {
  tick: number;
  liquidityNet: bigint;
}

export interface SimulateSwapParams {
  amountIn: bigint;
  zeroForOne: boolean;
  sqrtPriceX96: bigint;
  currentTick: number;
  liquidity: bigint;
  feePips: number;
  tickSpacing: number;
  initializedTicks?: TickInfo[];
  sqrtPriceLimitX96?: bigint;
}

export interface SimulateSwapResult {
  amountInUsed: bigint;
  amountOut: bigint;
  feeAmount: bigint;
  finalSqrtPriceX96: bigint;
  finalTick: number;
  finalLiquidity: bigint;
  ticksCrossed: number[];
}

export function simulateV3Swap(params: SimulateSwapParams): SimulateSwapResult {
  const {
    amountIn,
    zeroForOne,
    feePips,
    tickSpacing: _tickSpacing
  } = params;

  if (amountIn <= 0n) {
    throw new Error('simulateV3Swap: Amount in must be positive');
  }

  const sqrtPriceLimitX96 = params.sqrtPriceLimitX96 && params.sqrtPriceLimitX96 !== 0n
    ? params.sqrtPriceLimitX96
    : (zeroForOne ? MIN_SQRT_RATIO + 1n : MAX_SQRT_RATIO - 1n);

  let stateAmountSpecifiedRemaining = amountIn;
  let stateAmountCalculated = 0n;
  let stateSqrtPriceX96 = params.sqrtPriceX96;
  let stateTick = params.currentTick;
  let stateLiquidity = params.liquidity;
  let totalFeeAmount = 0n;
  const ticksCrossed: number[] = [];

  const sortedTicks = (params.initializedTicks || []).slice().sort((a, b) => a.tick - b.tick);

  while (stateAmountSpecifiedRemaining > 0n && stateSqrtPriceX96 !== sqrtPriceLimitX96) {
    const sqrtPriceStartX96 = stateSqrtPriceX96;

    // Find next initialized tick in direction of trade
    let nextTick: number;
    let nextInitialized = false;
    let nextLiquidityNet = 0n;

    if (zeroForOne) {
      const candidates = sortedTicks.filter(t => t.tick <= stateTick);
      if (candidates.length > 0) {
        const target = candidates[candidates.length - 1];
        nextTick = target.tick;
        nextInitialized = true;
        nextLiquidityNet = target.liquidityNet;
      } else {
        nextTick = MIN_TICK;
      }
    } else {
      const candidates = sortedTicks.filter(t => t.tick > stateTick);
      if (candidates.length > 0) {
        const target = candidates[0];
        nextTick = target.tick;
        nextInitialized = true;
        nextLiquidityNet = target.liquidityNet;
      } else {
        nextTick = MAX_TICK;
      }
    }

    if (nextTick < MIN_TICK) nextTick = MIN_TICK;
    if (nextTick > MAX_TICK) nextTick = MAX_TICK;

    const sqrtPriceNextTickX96 = TickMath.getSqrtRatioAtTick(nextTick);

    const targetSqrtPrice = zeroForOne
      ? (sqrtPriceNextTickX96 < sqrtPriceLimitX96 ? sqrtPriceLimitX96 : sqrtPriceNextTickX96)
      : (sqrtPriceNextTickX96 > sqrtPriceLimitX96 ? sqrtPriceLimitX96 : sqrtPriceNextTickX96);

    const step = SwapMath.computeSwapStep(
      stateSqrtPriceX96,
      targetSqrtPrice,
      stateLiquidity,
      stateAmountSpecifiedRemaining,
      feePips
    );

    stateAmountSpecifiedRemaining -= (step.amountIn + step.feeAmount);
    stateAmountCalculated += step.amountOut;
    totalFeeAmount += step.feeAmount;
    stateSqrtPriceX96 = step.sqrtRatioNextX96;

    if (stateSqrtPriceX96 === sqrtPriceNextTickX96) {
      if (nextInitialized) {
        ticksCrossed.push(nextTick);
        const netDelta = zeroForOne ? -nextLiquidityNet : nextLiquidityNet;
        if (netDelta < 0n) {
          stateLiquidity = stateLiquidity - (-netDelta);
        } else {
          stateLiquidity = stateLiquidity + netDelta;
        }
      }
      stateTick = zeroForOne ? nextTick - 1 : nextTick;
    } else if (stateSqrtPriceX96 !== sqrtPriceStartX96) {
      stateTick = TickMath.getTickAtSqrtRatio(stateSqrtPriceX96);
    }
  }

  return {
    amountInUsed: amountIn - stateAmountSpecifiedRemaining,
    amountOut: stateAmountCalculated,
    feeAmount: totalFeeAmount,
    finalSqrtPriceX96: stateSqrtPriceX96,
    finalTick: stateTick,
    finalLiquidity: stateLiquidity,
    ticksCrossed
  };
}
