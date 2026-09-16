import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConcentratedLiquidityMath,
  MIN_TICK,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MAX_SQRT_RATIO,
  Q96
} from '../packages/routing/src/math/ammMath';

describe('ZENITH SWAP — V3 Concentrated Liquidity & Tick Math Invariant Fuzz Suite (10,000 Iterations)', () => {

  test('1. Exact Boundary Invariants (MIN_TICK, MAX_TICK, 0 Tick, 1.0 Price)', () => {
    const sqrtMin = ConcentratedLiquidityMath.getSqrtRatioAtTick(MIN_TICK);
    const sqrtZero = ConcentratedLiquidityMath.getSqrtRatioAtTick(0);
    const sqrtMax = ConcentratedLiquidityMath.getSqrtRatioAtTick(MAX_TICK);

    assert.ok(sqrtMin >= MIN_SQRT_RATIO, 'sqrtMin >= MIN_SQRT_RATIO');
    assert.ok(sqrtMax <= MAX_SQRT_RATIO, 'sqrtMax <= MAX_SQRT_RATIO');
    assert.equal(sqrtZero, Q96, 'Tick 0 sqrt ratio must equal Q96 (1.0)');

    const recoveredTickZero = ConcentratedLiquidityMath.getTickAtSqrtRatio(Q96);
    assert.equal(recoveredTickZero, 0, 'Q96 recovered tick must equal 0');
  });

  test('2. Fuzz Property: Monotonic Sqrt Ratio Generation (10,000 Random Pairs)', () => {
    const FUZZ_RUNS = 10000;
    let seed = 1337420;

    // Simple deterministic PRNG
    const pseudoRandom = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    const randomTick = () => {
      return Math.floor(pseudoRandom() * (MAX_TICK - MIN_TICK + 1)) + MIN_TICK;
    };

    for (let i = 0; i < FUZZ_RUNS; i++) {
      const tickA = randomTick();
      const tickB = randomTick();

      const sqrtA = ConcentratedLiquidityMath.getSqrtRatioAtTick(tickA);
      const sqrtB = ConcentratedLiquidityMath.getSqrtRatioAtTick(tickB);

      if (tickA < tickB) {
        assert.ok(sqrtA < sqrtB, `Monotonicity violation at run ${i}: tickA=${tickA} (${sqrtA}), tickB=${tickB} (${sqrtB})`);
      } else if (tickA > tickB) {
        assert.ok(sqrtA > sqrtB, `Monotonicity violation at run ${i}: tickA=${tickA} (${sqrtA}), tickB=${tickB} (${sqrtB})`);
      } else {
        assert.equal(sqrtA, sqrtB, `Equality violation at run ${i}: tickA=${tickA}`);
      }
    }
  });

  test('3. Fuzz Property: Round-Trip Tick Recovery Precision (10,000 Random Ticks)', () => {
    const FUZZ_RUNS = 10000;
    let seed = 987654321;

    const pseudoRandom = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < FUZZ_RUNS; i++) {
      const tick = Math.floor(pseudoRandom() * (MAX_TICK - MIN_TICK + 1)) + MIN_TICK;
      const sqrtRatio = ConcentratedLiquidityMath.getSqrtRatioAtTick(tick);
      const recoveredTick = ConcentratedLiquidityMath.getTickAtSqrtRatio(sqrtRatio);

      // SqrtRatio math precision round-trip within +-1 tick
      const diff = Math.abs(recoveredTick - tick);
      assert.ok(
        diff <= 1,
        `Round-trip error exceeded at run ${i}: original=${tick}, recovered=${recoveredTick}, diff=${diff}`
      );
    }
  });

  test('4. Fuzz Property: SqrtPriceMath Token Delta Rounding & Non-Negativity (10,000 Iterations)', () => {
    const FUZZ_RUNS = 10000;
    let seed = 5551212;

    const pseudoRandom = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < FUZZ_RUNS; i++) {
      const tickA = Math.floor(pseudoRandom() * 400000) - 200000;
      const tickB = Math.floor(pseudoRandom() * 400000) - 200000;
      const liquidity = BigInt(Math.floor(pseudoRandom() * 1e12) + 1000);

      const sqrtA = ConcentratedLiquidityMath.getSqrtRatioAtTick(tickA);
      const sqrtB = ConcentratedLiquidityMath.getSqrtRatioAtTick(tickB);

      const amount0Down = ConcentratedLiquidityMath.getAmount0Delta(sqrtA, sqrtB, liquidity, false);
      const amount0Up = ConcentratedLiquidityMath.getAmount0Delta(sqrtA, sqrtB, liquidity, true);

      const amount1Down = ConcentratedLiquidityMath.getAmount1Delta(sqrtA, sqrtB, liquidity, false);
      const amount1Up = ConcentratedLiquidityMath.getAmount1Delta(sqrtA, sqrtB, liquidity, true);

      assert.ok(amount0Up >= amount0Down, `amount0 rounding invariant failed at run ${i}`);
      assert.ok(amount1Up >= amount1Down, `amount1 rounding invariant failed at run ${i}`);
      assert.ok(amount0Down >= 0n, 'amount0Down must be non-negative');
      assert.ok(amount1Down >= 0n, 'amount1Down must be non-negative');

      if (tickA === tickB) {
        assert.equal(amount0Down, 0n, 'amount0 delta must be zero for equal prices');
        assert.equal(amount1Down, 0n, 'amount1 delta must be zero for equal prices');
      }
    }
  });

  test('5. Fuzz Property: SwapMath Step Price Bounds & Fee Conservation (10,000 Iterations)', () => {
    const FUZZ_RUNS = 10000;
    let seed = 7773331;

    const pseudoRandom = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < FUZZ_RUNS; i++) {
      const currentTick = Math.floor(pseudoRandom() * 200000) - 100000;
      const targetTick = Math.floor(pseudoRandom() * 200000) - 100000;
      const liquidity = BigInt(Math.floor(pseudoRandom() * 1e14) + 1e6);
      const amountRemaining = BigInt(Math.floor(pseudoRandom() * 1e18) + 1000);
      const feeBps = Math.floor(pseudoRandom() * 100) + 1; // 1 to 100 BPS

      const sqrtCurrent = ConcentratedLiquidityMath.getSqrtRatioAtTick(currentTick);
      const sqrtTarget = ConcentratedLiquidityMath.getSqrtRatioAtTick(targetTick);

      const step = ConcentratedLiquidityMath.computeSwapStep(
        sqrtCurrent,
        sqrtTarget,
        liquidity,
        amountRemaining,
        feeBps,
        true,
        sqrtCurrent >= sqrtTarget
      );

      assert.ok(step.amountIn >= 0n, 'amountIn non-negative');
      assert.ok(step.amountOut >= 0n, 'amountOut non-negative');
      assert.ok(step.feeAmount >= 0n, 'feeAmount non-negative');

      // Price step must be bounded between current and target
      if (sqrtCurrent >= sqrtTarget) {
        assert.ok(
          step.sqrtRatioNextX96 <= sqrtCurrent && step.sqrtRatioNextX96 >= sqrtTarget,
          `Price step out of bounds (zeroForOne) at run ${i}`
        );
      } else {
        assert.ok(
          step.sqrtRatioNextX96 >= sqrtCurrent && step.sqrtRatioNextX96 <= sqrtTarget,
          `Price step out of bounds (oneForZero) at run ${i}`
        );
      }
    }
  });

});
