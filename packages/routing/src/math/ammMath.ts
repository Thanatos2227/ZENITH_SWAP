export const Q96 = 2n ** 96n;
export const BPS_DIVISOR = 10000n;
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
export const MIN_SQRT_RATIO = 4295128739n;
export const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

export class ConstantProductMath {

  public static getAmountOut(
    amountIn: bigint,
    reserveIn: bigint,
    reserveOut: bigint,
    feeBps: number = 30
  ): bigint {
    if (amountIn <= 0n) return 0n;
    if (reserveIn <= 0n || reserveOut <= 0n) return 0n;

    const feeMultiplier = BPS_DIVISOR - BigInt(feeBps);
    const amountInWithFee = amountIn * feeMultiplier;
    const numerator = amountInWithFee * reserveOut;
    const denominator = (reserveIn * BPS_DIVISOR) + amountInWithFee;

    if (denominator === 0n) return 0n;
    return numerator / denominator;
  }

  public static getAmountIn(
    amountOut: bigint,
    reserveIn: bigint,
    reserveOut: bigint,
    feeBps: number = 30
  ): bigint {
    if (amountOut <= 0n) return 0n;
    if (reserveIn <= 0n || reserveOut <= 0n) return 0n;
    if (amountOut >= reserveOut) {
      throw new Error('[ConstantProductMath] Insufficient pool liquidity for requested output');
    }

    const feeMultiplier = BPS_DIVISOR - BigInt(feeBps);
    const numerator = reserveIn * amountOut * BPS_DIVISOR;
    const denominator = (reserveOut - amountOut) * feeMultiplier;

    if (denominator === 0n) {
      throw new Error('[ConstantProductMath] Division by zero in getAmountIn');
    }

    return (numerator / denominator) + 1n;
  }

  public static verifyInvariant(
    reserveIn: bigint,
    reserveOut: bigint,
    amountIn: bigint,
    amountOut: bigint,
    feeBps: number = 30
  ): boolean {
    const feeMultiplier = BPS_DIVISOR - BigInt(feeBps);
    const amountInWithFee = (amountIn * feeMultiplier) / BPS_DIVISOR;
    const newReserveIn = reserveIn + amountInWithFee;
    const newReserveOut = reserveOut - amountOut;

    return (newReserveIn * newReserveOut) >= (reserveIn * reserveOut);
  }

  public static calculateSpotPrice(
    reserve0: bigint,
    reserve1: bigint,
    decimals0: number,
    decimals1: number
  ): number {
    if (reserve0 <= 0n || reserve1 <= 0n) return 0;
    const r0 = Number(reserve0) / (10 ** decimals0);
    const r1 = Number(reserve1) / (10 ** decimals1);
    if (r0 <= 0) return 0;
    return r1 / r0;
  }

  public static calculatePriceImpact(
    spotPrice: number,
    executionPrice: number
  ): number {
    if (spotPrice <= 0 || executionPrice <= 0) return 0;
    const diff = Math.max(0, spotPrice - executionPrice);
    const impactPercent = (diff / spotPrice) * 100;
    return Math.min(Math.max(impactPercent, 0), 100);
  }
}

export class ConcentratedLiquidityMath {

  public static priceToSqrtRatioX96(price: number): bigint {
    if (price <= 0) return MIN_SQRT_RATIO;
    const sqrtPrice = Math.sqrt(price);
    const intPart = BigInt(Math.floor(sqrtPrice));
    const fracPart = BigInt(Math.floor((sqrtPrice - Math.floor(sqrtPrice)) * Number(Q96)));
    return (intPart * Q96) + fracPart;
  }

  public static sqrtRatioX96ToPrice(sqrtRatioX96: bigint): number {
    if (sqrtRatioX96 <= 0n) return 0;
    const sqrtRatioNum = Number(sqrtRatioX96) / Number(Q96);
    return sqrtRatioNum * sqrtRatioNum;
  }

  public static getSqrtRatioAtTick(tick: number): bigint {
    const clampedTick = Math.max(MIN_TICK, Math.min(MAX_TICK, tick));
    const priceRatio = Math.pow(1.0001, clampedTick);
    const sqrtPrice = Math.sqrt(priceRatio);

    const intPart = BigInt(Math.floor(sqrtPrice));
    const fracPart = BigInt(Math.floor((sqrtPrice - Math.floor(sqrtPrice)) * Number(Q96)));
    return (intPart * Q96) + fracPart;
  }

  public static getTickAtSqrtRatio(sqrtPriceX96: bigint): number {
    if (sqrtPriceX96 <= 0n) return MIN_TICK;
    const sqrtRatioNum = Number(sqrtPriceX96) / Number(Q96);
    const price = sqrtRatioNum * sqrtRatioNum;
    if (price <= 0) return MIN_TICK;
    const tick = Math.round(Math.log(price) / Math.log(1.0001));
    return Math.max(MIN_TICK, Math.min(MAX_TICK, tick));
  }

  public static getAmount0Delta(
    sqrtRatioAX96: bigint,
    sqrtRatioBX96: bigint,
    liquidity: bigint,
    roundUp: boolean = false
  ): bigint {
    if (sqrtRatioAX96 > sqrtRatioBX96) {
      [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
    }
    if (sqrtRatioAX96 <= 0n || liquidity <= 0n) return 0n;

    const numerator1 = liquidity * Q96;
    const numerator2 = sqrtRatioBX96 - sqrtRatioAX96;

    const numerator = numerator1 * numerator2;
    const denominator = sqrtRatioAX96 * sqrtRatioBX96;

    if (denominator === 0n) return 0n;

    if (roundUp) {
      return (numerator + denominator - 1n) / denominator;
    }
    return numerator / denominator;
  }

  public static getAmount1Delta(
    sqrtRatioAX96: bigint,
    sqrtRatioBX96: bigint,
    liquidity: bigint,
    roundUp: boolean = false
  ): bigint {
    if (sqrtRatioAX96 > sqrtRatioBX96) {
      [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
    }
    if (liquidity <= 0n) return 0n;

    const numerator = liquidity * (sqrtRatioBX96 - sqrtRatioAX96);
    if (roundUp) {
      return (numerator + Q96 - 1n) / Q96;
    }
    return numerator / Q96;
  }

  public static computeSwapStep(
    sqrtRatioCurrentX96: bigint,
    sqrtRatioTargetX96: bigint,
    liquidity: bigint,
    amountRemaining: bigint,
    feeBps: number = 30,
    isExactInput: boolean = true,
    isZeroForOne: boolean = true
  ): {
    sqrtRatioNextX96: bigint;
    amountIn: bigint;
    amountOut: bigint;
    feeAmount: bigint;
  } {
    const feeMultiplier = BPS_DIVISOR - BigInt(feeBps);

    if (isExactInput) {
      const amountRemainingLessFee = (amountRemaining * feeMultiplier) / BPS_DIVISOR;
      const amountInMax = isZeroForOne
        ? this.getAmount0Delta(sqrtRatioTargetX96, sqrtRatioCurrentX96, liquidity, true)
        : this.getAmount1Delta(sqrtRatioCurrentX96, sqrtRatioTargetX96, liquidity, true);

      let sqrtRatioNextX96 = sqrtRatioTargetX96;
      let amountIn = amountInMax;

      if (amountRemainingLessFee < amountInMax) {

        if (isZeroForOne) {

          const numerator = liquidity * Q96;
          const denominator = (liquidity * Q96 / sqrtRatioCurrentX96) + amountRemainingLessFee;
          sqrtRatioNextX96 = denominator > 0n ? numerator / denominator : sqrtRatioTargetX96;
        } else {

          sqrtRatioNextX96 = sqrtRatioCurrentX96 + (amountRemainingLessFee * Q96 / liquidity);
        }
        amountIn = amountRemainingLessFee;
      }

      const amountOut = isZeroForOne
        ? this.getAmount1Delta(sqrtRatioNextX96, sqrtRatioCurrentX96, liquidity, false)
        : this.getAmount0Delta(sqrtRatioCurrentX96, sqrtRatioNextX96, liquidity, false);

      const feeAmount = (amountIn * BigInt(feeBps)) / feeMultiplier;

      return { sqrtRatioNextX96, amountIn, amountOut, feeAmount };
    } else {

      const amountOutMax = isZeroForOne
        ? this.getAmount1Delta(sqrtRatioTargetX96, sqrtRatioCurrentX96, liquidity, false)
        : this.getAmount0Delta(sqrtRatioCurrentX96, sqrtRatioTargetX96, liquidity, false);

      let sqrtRatioNextX96 = sqrtRatioTargetX96;
      let amountOut = amountOutMax;

      if (amountRemaining < amountOutMax) {
        if (isZeroForOne) {
          sqrtRatioNextX96 = sqrtRatioCurrentX96 - (amountRemaining * Q96 / liquidity);
        } else {
          const numerator = liquidity * Q96;
          const denominator = (liquidity * Q96 / sqrtRatioCurrentX96) - amountRemaining;
          sqrtRatioNextX96 = denominator > 0n ? numerator / denominator : sqrtRatioTargetX96;
        }
        amountOut = amountRemaining;
      }

      const amountIn = isZeroForOne
        ? this.getAmount0Delta(sqrtRatioNextX96, sqrtRatioCurrentX96, liquidity, true)
        : this.getAmount1Delta(sqrtRatioCurrentX96, sqrtRatioNextX96, liquidity, true);

      const feeAmount = (amountIn * BigInt(feeBps)) / feeMultiplier;

      return { sqrtRatioNextX96, amountIn, amountOut, feeAmount };
    }
  }
}
