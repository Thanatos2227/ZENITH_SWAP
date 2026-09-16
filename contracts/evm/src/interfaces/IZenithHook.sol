pragma solidity 0.8.24;

interface IZenithHook {
    struct HookPermissions {
        bool beforeInitialize;
        bool afterInitialize;
        bool beforeAddLiquidity;
        bool afterAddLiquidity;
        bool beforeRemoveLiquidity;
        bool afterRemoveLiquidity;
        bool beforeSwap;
        bool afterSwap;
    }

    function getPermissions() external view returns (HookPermissions memory);

    function beforeInitialize(
        address sender,
        bytes32 poolId,
        uint160 sqrtPriceX96,
        bytes calldata hookData
    ) external returns (bytes4);

    function afterInitialize(
        address sender,
        bytes32 poolId,
        uint160 sqrtPriceX96,
        int24 tick,
        bytes calldata hookData
    ) external returns (bytes4);

    function beforeAddLiquidity(
        address sender,
        bytes32 poolId,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        bytes calldata hookData
    ) external returns (bytes4);

    function afterAddLiquidity(
        address sender,
        bytes32 poolId,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1,
        bytes calldata hookData
    ) external returns (bytes4);

    function beforeSwap(
        address sender,
        bytes32 poolId,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata hookData
    ) external returns (bytes4, uint24 dynamicFeeBps);

    function afterSwap(
        address sender,
        bytes32 poolId,
        bool zeroForOne,
        int256 amountSpecified,
        uint256 amountCalculated,
        bytes calldata hookData
    ) external returns (bytes4);
}
