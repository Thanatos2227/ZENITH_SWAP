pragma solidity 0.8.24;

library LiquidityMath {
    function addDelta(uint128 x, int128 y) internal pure returns (uint128 z) {
        if (y < 0) {
            require((z = x - uint128(-y)) < x, "LiquidityMath: UNDERFLOW");
        } else {
            require((z = x + uint128(y)) >= x, "LiquidityMath: OVERFLOW");
        }
    }
}
