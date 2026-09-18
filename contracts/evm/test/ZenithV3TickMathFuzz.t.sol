// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/libraries/TickMath.sol";
import "../src/libraries/FullMath.sol";
import "../src/libraries/SqrtPriceMath.sol";
import "../src/v3/libraries/SwapMath.sol";

/**
 * @title ZenithV3TickMathFuzzTest
 * @notice Comprehensive property-based fuzz and invariant test suite for Zenith V3 Math libraries
 * @dev Designed for >= 10,000 runs to test all extreme edge cases, tick boundaries, and rounding invariants
 */
contract ZenithV3TickMathFuzzTest is Test {
    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    function setUp() public {}

    // ==========================================
    // 1. BOUNDARY & EXACT CONSTANT TESTS
    // ==========================================
    function callGetSqrtRatioAtTick(int24 tick) external pure returns (uint160) {
        return TickMath.getSqrtRatioAtTick(tick);
    }

    function callGetTickAtSqrtRatio(
            uint160 sqrtPrice
        ) external pure returns (int24) {
        return TickMath.getTickAtSqrtRatio(sqrtPrice);
    }
    function test_boundary_minMaxTicksExact() public pure {
        uint160 sqrtAtMin = TickMath.getSqrtRatioAtTick(MIN_TICK);
        uint160 sqrtAtZero = TickMath.getSqrtRatioAtTick(0);
        uint160 sqrtAtMax = TickMath.getSqrtRatioAtTick(MAX_TICK);

        assertEq(sqrtAtMin, MIN_SQRT_RATIO, "MIN_TICK must equal MIN_SQRT_RATIO");
        assertEq(sqrtAtZero, 1 << 96, "Tick 0 must equal 2^96");
        assertEq(sqrtAtMax, MAX_SQRT_RATIO, "MAX_TICK must equal MAX_SQRT_RATIO");

        assertEq(TickMath.getTickAtSqrtRatio(MIN_SQRT_RATIO), MIN_TICK, "MIN_SQRT_RATIO recovers MIN_TICK");
        assertEq(TickMath.getTickAtSqrtRatio(1 << 96), 0, "2^96 recovers tick 0");
        assertEq(TickMath.getTickAtSqrtRatio(MAX_SQRT_RATIO - 1), MAX_TICK - 1, "MAX_SQRT_RATIO - 1 recovers MAX_TICK - 1");
    }

    /// @notice Invariant: For any tick in [MIN_TICK, MAX_TICK], getSqrtRatioAtTick produces ratio in [MIN_SQRT_RATIO, MAX_SQRT_RATIO]
    function testFuzz_getSqrtRatioAtTick_inBounds(int24 tick) public pure {
        tick = int24(bound(int256(tick), int256(MIN_TICK), int256(MAX_TICK)));
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(tick);

        assertTrue(sqrtPriceX96 >= MIN_SQRT_RATIO, "sqrtPriceX96 below MIN_SQRT_RATIO");
        assertTrue(sqrtPriceX96 <= MAX_SQRT_RATIO, "sqrtPriceX96 above MAX_SQRT_RATIO");
    }

    /// @notice Invariant: Monotonicity - tickA < tickB ==> sqrtRatio(tickA) < sqrtRatio(tickB)
    function testFuzz_getSqrtRatioAtTick_monotonic(int24 tickA, int24 tickB) public pure {
        tickA = int24(bound(int256(tickA), int256(MIN_TICK), int256(MAX_TICK)));
        tickB = int24(bound(int256(tickB), int256(MIN_TICK), int256(MAX_TICK)));

        if (tickA < tickB) {
            uint160 ratioA = TickMath.getSqrtRatioAtTick(tickA);
            uint160 ratioB = TickMath.getSqrtRatioAtTick(tickB);
            assertTrue(ratioA < ratioB, "Monotonicity violated for tickA < tickB");
        } else if (tickA > tickB) {
            uint160 ratioA = TickMath.getSqrtRatioAtTick(tickA);
            uint160 ratioB = TickMath.getSqrtRatioAtTick(tickB);
            assertTrue(ratioA > ratioB, "Monotonicity violated for tickA > tickB");
        }
    }

    /// @notice Invariant: Round-trip consistency getTickAtSqrtRatio(getSqrtRatioAtTick(tick)) == tick
    function testFuzz_roundTrip_tickToSqrtRatioToTick(int24 tick) public pure {
        tick = int24(bound(int256(tick), int256(MIN_TICK), int256(MAX_TICK-1)));

        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(tick);
        int24 recoveredTick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);

        assertEq(recoveredTick, tick, "Recovered tick must equal original tick");
    }

    /// @notice Invariant: For any sqrtRatioX96 in [MIN, MAX), the recovered tick t satisfies:
    /// sqrtRatioAtTick(t) <= sqrtPriceX96 < sqrtRatioAtTick(t + 1)
    function testFuzz_getTickAtSqrtRatio_bracketInvariant(uint160 sqrtPriceX96) public pure {
        sqrtPriceX96 = uint160(bound(uint256(sqrtPriceX96), uint256(MIN_SQRT_RATIO), uint256(MAX_SQRT_RATIO - 1)));

        int24 tick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);

        assertTrue(tick >= MIN_TICK && tick <= MAX_TICK, "Tick out of bounds");

        uint160 lowerBound = TickMath.getSqrtRatioAtTick(tick);
        assertTrue(lowerBound <= sqrtPriceX96, "sqrtPriceX96 is strictly less than lower bound");

        if (tick < MAX_TICK) {
            uint160 upperBound = TickMath.getSqrtRatioAtTick(tick + 1);
            assertTrue(sqrtPriceX96 < upperBound, "sqrtPriceX96 exceeds or equals upper bound");
        }
    }

    /// @notice Invariant: Ticks out of bound [-887272, 887272] MUST revert
    function testFuzz_getSqrtRatioAtTick_outOfBounds_reverts(int256 rawTick) public {
        vm.assume(rawTick < int256(MIN_TICK) || rawTick > int256(MAX_TICK));

        if (rawTick >= type(int24).min && rawTick <= type(int24).max) {
            int24 tick = int24(rawTick);
            vm.expectRevert("TickMath: T_BOUND");
            this.callGetSqrtRatioAtTick(tick);
        }
    }

    /// @notice Invariant: Sqrt ratios out of bound [MIN_SQRT_RATIO, MAX_SQRT_RATIO) MUST revert
    function testFuzz_getTickAtSqrtRatio_outOfBounds_reverts(uint256 rawSqrtPrice) public {
        vm.assume(rawSqrtPrice < uint256(MIN_SQRT_RATIO) || rawSqrtPrice >= uint256(MAX_SQRT_RATIO));

        if (rawSqrtPrice <= type(uint160).max) {
            uint160 sqrtPrice = uint160(rawSqrtPrice);
            vm.expectRevert("TickMath: R_BOUND");
            this.callGetTickAtSqrtRatio(sqrtPrice);
        }
    }

    // ==========================================
    // 3. SQRTPRICEMATH FUZZ & INVARIANT TESTS
    // ==========================================

    /// @notice Invariant: getAmount0Delta rounding up >= rounding down, and 0 delta for identical prices
    function testFuzz_SqrtPriceMath_getAmount0Delta_monotonicity(
        uint160 sqrtA,
        uint160 sqrtB,
        uint128 liquidity
    ) public pure {
        sqrtA = uint160(bound(uint256(sqrtA), uint256(MIN_SQRT_RATIO), uint256(MAX_SQRT_RATIO)));
        sqrtB = uint160(bound(uint256(sqrtB), uint256(MIN_SQRT_RATIO), uint256(MAX_SQRT_RATIO)));
        liquidity = uint128(bound(uint256(liquidity), 0, 1e28));

        uint256 amount0Down = SqrtPriceMath.getAmount0Delta(sqrtA, sqrtB, liquidity, false);
        uint256 amount0Up = SqrtPriceMath.getAmount0Delta(sqrtA, sqrtB, liquidity, true);

        assertTrue(amount0Up >= amount0Down, "Round-up must be >= round-down for amount0");

        if (sqrtA == sqrtB || liquidity == 0) {
            assertEq(amount0Down, 0, "Zero delta on equal prices or zero liquidity");
            assertEq(amount0Up, 0, "Zero delta on equal prices or zero liquidity");
        }
    }

    /// @notice Invariant: getAmount1Delta rounding up >= rounding down, and 0 delta for identical prices
    function testFuzz_SqrtPriceMath_getAmount1Delta_monotonicity(
        uint160 sqrtA,
        uint160 sqrtB,
        uint128 liquidity
    ) public pure {
        sqrtA = uint160(bound(uint256(sqrtA), uint256(MIN_SQRT_RATIO), uint256(MAX_SQRT_RATIO)));
        sqrtB = uint160(bound(uint256(sqrtB), uint256(MIN_SQRT_RATIO), uint256(MAX_SQRT_RATIO)));
        liquidity = uint128(bound(uint256(liquidity), 0, 1e28));

        uint256 amount1Down = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtB, liquidity, false);
        uint256 amount1Up = SqrtPriceMath.getAmount1Delta(sqrtA, sqrtB, liquidity, true);

        assertTrue(amount1Up >= amount1Down, "Round-up must be >= round-down for amount1");

        if (sqrtA == sqrtB || liquidity == 0) {
            assertEq(amount1Down, 0, "Zero delta on equal prices or zero liquidity");
            assertEq(amount1Up, 0, "Zero delta on equal prices or zero liquidity");
        }
    }

    /// @notice Invariant: getNextSqrtPriceFromInput moves price monotonically in expected direction
    function testFuzz_getNextSqrtPriceFromInput_direction(
        uint160 sqrtP,
        uint128 liquidity,
        uint256 amountIn,
        bool zeroForOne
    ) public pure {
        sqrtP = uint160(bound(uint256(sqrtP), uint256(MIN_SQRT_RATIO) + 1000, uint256(MAX_SQRT_RATIO) - 1000));
        liquidity = uint128(bound(uint256(liquidity), 1e8, 1e26));
        amountIn = bound(amountIn, 1, 1e24);

        uint160 nextSqrtP = SqrtPriceMath.getNextSqrtPriceFromInput(sqrtP, liquidity, amountIn, zeroForOne);

        if (zeroForOne) {
            assertTrue(nextSqrtP <= sqrtP, "zeroForOne swap must not increase sqrtPrice");
        } else {
            assertTrue(nextSqrtP >= sqrtP, "oneForZero swap must not decrease sqrtPrice");
        }
    }


    /// @notice Invariant: SwapMath step never exceeds target sqrt price and conserves fee bounds
    function testFuzz_SwapMath_computeSwapStep_invariants(
        uint160 sqrtCurrent,
        uint160 sqrtTarget,
        uint128 liquidity,
        uint256 amountRemainingRaw,
        uint24 feePips
    ) public pure {
        sqrtCurrent = uint160(bound(uint256(sqrtCurrent), uint256(MIN_SQRT_RATIO) + 100, uint256(MAX_SQRT_RATIO) - 100));
        sqrtTarget = uint160(bound(uint256(sqrtTarget), uint256(MIN_SQRT_RATIO) + 100, uint256(MAX_SQRT_RATIO) - 100));
        liquidity = uint128(bound(uint256(liquidity), 1e10, 1e24));
        int256 amountRemaining = int256(bound(amountRemainingRaw, 1, 1e22));
        feePips = uint24(bound(uint256(feePips), 100, 10000)); // 1 BPS to 100 BPS

        (
            uint160 sqrtRatioNextX96,
            uint256 amountIn,
            uint256 amountOut,
            uint256 feeAmount
        ) = SwapMath.computeSwapStep(sqrtCurrent, sqrtTarget, liquidity, amountRemaining, feePips);

        if (sqrtCurrent >= sqrtTarget) {
            assertTrue(sqrtRatioNextX96 <= sqrtCurrent && sqrtRatioNextX96 >= sqrtTarget, "Price step bounded");
        } else {
            assertTrue(sqrtRatioNextX96 >= sqrtCurrent && sqrtRatioNextX96 <= sqrtTarget, "Price step bounded");
        }

        assertTrue(amountIn + feeAmount <= uint256(amountRemaining), "Total spent <= amountRemaining");
        assertTrue(amountOut >= 0, "amountOut non-negative");
    }
}
