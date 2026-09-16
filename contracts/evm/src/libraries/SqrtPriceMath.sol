pragma solidity 0.8.24;

import "./FullMath.sol";

library SqrtPriceMath {
    function getAmount0Delta(
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        uint128 liquidity,
        bool roundUp
    ) internal pure returns (uint256 amount0) {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);

        require(sqrtRatioAX96 > 0, "SqrtPriceMath: ZERO_RATIO");

        uint256 numerator1 = uint256(liquidity) << 96;
        uint256 numerator2 = sqrtRatioBX96 - sqrtRatioAX96;

        return
            roundUp
                ? FullMath.mulDivRoundingUp(
                    FullMath.mulDivRoundingUp(numerator1, numerator2, sqrtRatioBX96),
                    1,
                    sqrtRatioAX96
                )
                : FullMath.mulDiv(numerator1, numerator2, sqrtRatioBX96) / sqrtRatioAX96;
    }

    function getAmount1Delta(
        uint160 sqrtRatioAX96,
        uint160 sqrtRatioBX96,
        uint128 liquidity,
        bool roundUp
    ) internal pure returns (uint256 amount1) {
        if (sqrtRatioAX96 > sqrtRatioBX96) (sqrtRatioAX96, sqrtRatioBX96) = (sqrtRatioBX96, sqrtRatioAX96);

        return
            roundUp
                ? FullMath.mulDivRoundingUp(liquidity, sqrtRatioBX96 - sqrtRatioAX96, 1 << 96)
                : FullMath.mulDiv(liquidity, sqrtRatioBX96 - sqrtRatioAX96, 1 << 96);
    }

    function getNextSqrtPriceFromInput(
        uint160 sqrtPX96,
        uint128 liquidity,
        uint256 amountIn,
        bool zeroForOne
    ) internal pure returns (uint160 sqrtQX96) {
        require(sqrtPX96 > 0, "SqrtPriceMath: ZERO_SQRT_P");
        require(liquidity > 0, "SqrtPriceMath: ZERO_LIQ");

        if (zeroForOne) {
            uint256 quotient = FullMath.mulDiv(amountIn, sqrtPX96, (uint256(liquidity) << 96) + (amountIn * sqrtPX96));
            return uint160(sqrtPX96 - quotient);
        } else {
            uint256 quotient = FullMath.mulDiv(amountIn, 1 << 96, liquidity);
            return uint160(uint256(sqrtPX96) + quotient);
        }
    }
}
