pragma solidity 0.8.24;

import "./interfaces/IERC20.sol";
import "./interfaces/IZenithHook.sol";
import "./libraries/TickMath.sol";
import "./libraries/FullMath.sol";
import "./libraries/SqrtPriceMath.sol";
import "./ZenithCircuitBreaker.sol";

contract ZenithPoolManager {
    using FullMath for uint256;

    struct PoolKey {
        address currency0;
        address currency1;
        uint24 feeBps;
        int24 tickSpacing;
        IZenithHook hook;
    }

    struct TickInfo {
        uint128 liquidityGross;
        int128 liquidityNet;
        uint256 feeGrowthOutside0X128;
        uint256 feeGrowthOutside1X128;
        bool initialized;
    }

    struct PositionInfo {
        uint128 liquidity;
        uint256 feeGrowthInside0LastX128;
        uint256 feeGrowthInside1LastX128;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
    }

    struct PoolState {
        uint160 sqrtPriceX96;
        int24 tick;
        uint128 liquidity;
        uint24 feeBps;
        uint256 feeGrowthGlobal0X128;
        uint256 feeGrowthGlobal1X128;
        uint256 reserve0;
        uint256 reserve1;
        bool initialized;
    }

    struct ModifyLiquidityParams {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        int256 liquidityDelta;
        bytes hookData;
    }

    struct SwapParams {
        PoolKey key;
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
        bytes hookData;
    }

    struct BalanceDelta {
        int256 amount0;
        int256 amount1;
    }

    address public immutable owner;
    ZenithCircuitBreaker public immutable circuitBreaker;

    mapping(bytes32 => PoolState) public pools;
    mapping(bytes32 => mapping(int24 => TickInfo)) public ticks;
    mapping(bytes32 => mapping(bytes32 => PositionInfo)) public positions;

    uint256 private _locked;
    mapping(address => int256) public currencyDelta;

    event PoolInitialized(
        bytes32 indexed poolId,
        address indexed currency0,
        address indexed currency1,
        uint24 feeBps,
        int24 tickSpacing,
        address hook,
        uint160 sqrtPriceX96,
        int24 tick
    );

    event LiquidityModified(
        bytes32 indexed poolId,
        address indexed sender,
        int24 tickLower,
        int24 tickUpper,
        int256 liquidityDelta,
        uint256 amount0,
        uint256 amount1
    );

    event Swap(
        bytes32 indexed poolId,
        address indexed sender,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceX96,
        uint128 liquidity,
        int24 tick,
        uint256 feeAmount
    );

    modifier onlyWhenNotPaused() {
        if (address(circuitBreaker) != address(0)) {
            require(!circuitBreaker.isPaused(), "ZenithPoolManager: PAUSED");
        }
        _;
    }

    modifier nonReentrant() {
        require(_locked == 0, "ZenithPoolManager: REENTRANT");
        _locked = 1;
        _;
        _locked = 0;
    }

    constructor(address _circuitBreaker) {
        require(_circuitBreaker != address(0), "ZenithPoolManager: ZERO_CIRCUIT_BREAKER");
        owner = msg.sender;
        circuitBreaker = ZenithCircuitBreaker(_circuitBreaker);
    }

    function toPoolId(PoolKey memory key) public pure returns (bytes32) {
        return keccak256(abi.encode(key.currency0, key.currency1, key.feeBps, key.tickSpacing, address(key.hook)));
    }

    function toPositionId(address ownerAddress, int24 tickLower, int24 tickUpper) public pure returns (bytes32) {
        require(ownerAddress != address(0), "ZenithPoolManager: ZERO_OWNER");
        return keccak256(abi.encodePacked(ownerAddress, tickLower, tickUpper));
    }

    function initialize(
        PoolKey calldata key,
        uint160 sqrtPriceX96,
        bytes calldata hookData
    ) external onlyWhenNotPaused returns (int24 tick) {
        require(key.currency0 != address(0) && key.currency1 != address(0), "ZenithPoolManager: ZERO_CURRENCY");
        require(key.currency0 < key.currency1, "ZenithPoolManager: CURRENCY_ORDER");
        require(key.tickSpacing > 0, "ZenithPoolManager: INVALID_SPACING");
        require(
            sqrtPriceX96 >= TickMath.MIN_SQRT_RATIO && sqrtPriceX96 < TickMath.MAX_SQRT_RATIO,
            "ZenithPoolManager: RATIO_BOUNDS"
        );

        bytes32 poolId = toPoolId(key);
        require(!pools[poolId].initialized, "ZenithPoolManager: ALREADY_INITIALIZED");

        if (address(key.hook) != address(0)) {
            bytes4 selector = key.hook.beforeInitialize(msg.sender, poolId, sqrtPriceX96, hookData);
            require(selector == IZenithHook.beforeInitialize.selector, "ZenithPoolManager: HOOK_REVERT");
        }

        tick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);

        pools[poolId] = PoolState({
            sqrtPriceX96: sqrtPriceX96,
            tick: tick,
            liquidity: 0,
            feeBps: key.feeBps,
            feeGrowthGlobal0X128: 0,
            feeGrowthGlobal1X128: 0,
            reserve0: 0,
            reserve1: 0,
            initialized: true
        });

        if (address(key.hook) != address(0)) {
            bytes4 selector = key.hook.afterInitialize(msg.sender, poolId, sqrtPriceX96, tick, hookData);
            require(selector == IZenithHook.afterInitialize.selector, "ZenithPoolManager: HOOK_REVERT");
        }

        emit PoolInitialized(
            poolId,
            key.currency0,
            key.currency1,
            key.feeBps,
            key.tickSpacing,
            address(key.hook),
            sqrtPriceX96,
            tick
        );
    }

    function modifyLiquidity(
        ModifyLiquidityParams calldata params
    ) external nonReentrant onlyWhenNotPaused returns (BalanceDelta memory delta) {
        bytes32 poolId = toPoolId(params.key);
        PoolState storage pool = pools[poolId];
        require(pool.initialized, "ZenithPoolManager: NOT_INITIALIZED");
        require(params.tickLower < params.tickUpper, "ZenithPoolManager: INVALID_TICKS");
        require(params.tickLower >= TickMath.MIN_TICK && params.tickUpper <= TickMath.MAX_TICK, "ZenithPoolManager: TICK_BOUNDS");
        require(params.tickLower % params.key.tickSpacing == 0 && params.tickUpper % params.key.tickSpacing == 0, "ZenithPoolManager: TICK_SPACING");

        if (address(params.key.hook) != address(0)) {
            bytes4 selector = params.key.hook.beforeAddLiquidity(
                msg.sender,
                poolId,
                params.tickLower,
                params.tickUpper,
                params.liquidityDelta > 0 ? uint128(uint256(params.liquidityDelta)) : 0,
                params.hookData
            );
            require(selector == IZenithHook.beforeAddLiquidity.selector, "ZenithPoolManager: HOOK_REVERT");
        }

        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(params.tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(params.tickUpper);

        uint256 amount0 = 0;
        uint256 amount1 = 0;

        if (params.liquidityDelta > 0) {
            uint128 liq = uint128(uint256(params.liquidityDelta));

            if (pool.tick < params.tickLower) {
                amount0 = SqrtPriceMath.getAmount0Delta(sqrtRatioAX96, sqrtRatioBX96, liq, true);
            } else if (pool.tick < params.tickUpper) {
                amount0 = SqrtPriceMath.getAmount0Delta(pool.sqrtPriceX96, sqrtRatioBX96, liq, true);
                amount1 = SqrtPriceMath.getAmount1Delta(sqrtRatioAX96, pool.sqrtPriceX96, liq, true);
                pool.liquidity += liq;
            } else {
                amount1 = SqrtPriceMath.getAmount1Delta(sqrtRatioAX96, sqrtRatioBX96, liq, true);
            }

            pool.reserve0 += amount0;
            pool.reserve1 += amount1;

            bytes32 positionId = toPositionId(msg.sender, params.tickLower, params.tickUpper);
            positions[poolId][positionId].liquidity += liq;

            if (amount0 > 0) {
                _safeTransferFrom(params.key.currency0, msg.sender, address(this), amount0);
            }
            if (amount1 > 0) {
                _safeTransferFrom(params.key.currency1, msg.sender, address(this), amount1);
            }

            delta = BalanceDelta({amount0: int256(amount0), amount1: int256(amount1)});
        }

        if (address(params.key.hook) != address(0)) {
            bytes4 selector = params.key.hook.afterAddLiquidity(
                msg.sender,
                poolId,
                params.tickLower,
                params.tickUpper,
                params.liquidityDelta > 0 ? uint128(uint256(params.liquidityDelta)) : 0,
                amount0,
                amount1,
                params.hookData
            );
            require(selector == IZenithHook.afterAddLiquidity.selector, "ZenithPoolManager: HOOK_REVERT");
        }

        emit LiquidityModified(
            poolId,
            msg.sender,
            params.tickLower,
            params.tickUpper,
            params.liquidityDelta,
            amount0,
            amount1
        );
    }

    function swap(
        SwapParams calldata params
    ) external nonReentrant onlyWhenNotPaused returns (BalanceDelta memory delta) {
        bytes32 poolId = toPoolId(params.key);
        PoolState storage pool = pools[poolId];
        require(pool.initialized, "ZenithPoolManager: NOT_INITIALIZED");
        require(params.amountSpecified != 0, "ZenithPoolManager: ZERO_AMOUNT");

        uint24 feeBps = pool.feeBps;

        if (address(params.key.hook) != address(0)) {
            (bytes4 selector, uint24 dynamicFee) = params.key.hook.beforeSwap(
                msg.sender,
                poolId,
                params.zeroForOne,
                params.amountSpecified,
                params.sqrtPriceLimitX96,
                params.hookData
            );
            require(selector == IZenithHook.beforeSwap.selector, "ZenithPoolManager: HOOK_REVERT");
            if (dynamicFee > 0) feeBps = dynamicFee;
        }

        uint256 amountIn = params.amountSpecified > 0 ? uint256(params.amountSpecified) : uint256(-params.amountSpecified);
        uint256 feeAmount = (amountIn * feeBps) / 10000;
        uint256 netAmountIn = amountIn - feeAmount;

        uint256 amountOut;
        uint160 nextSqrtPriceX96;

        if (pool.liquidity > 0) {
            nextSqrtPriceX96 = SqrtPriceMath.getNextSqrtPriceFromInput(
                pool.sqrtPriceX96,
                pool.liquidity,
                netAmountIn,
                params.zeroForOne
            );

            if (params.zeroForOne) {
                amountOut = SqrtPriceMath.getAmount1Delta(nextSqrtPriceX96, pool.sqrtPriceX96, pool.liquidity, false);
            } else {
                amountOut = SqrtPriceMath.getAmount0Delta(pool.sqrtPriceX96, nextSqrtPriceX96, pool.liquidity, false);
            }
        } else {
            if (params.zeroForOne) {
                require(pool.reserve0 > 0 && pool.reserve1 > 0, "ZenithPoolManager: INSUFFICIENT_LIQUIDITY");
                amountOut = (netAmountIn * pool.reserve1) / (pool.reserve0 + netAmountIn);
            } else {
                require(pool.reserve0 > 0 && pool.reserve1 > 0, "ZenithPoolManager: INSUFFICIENT_LIQUIDITY");
                amountOut = (netAmountIn * pool.reserve0) / (pool.reserve1 + netAmountIn);
            }
            nextSqrtPriceX96 = pool.sqrtPriceX96;
        }

        if (params.zeroForOne) {
            pool.reserve0 += amountIn;
            require(pool.reserve1 >= amountOut, "ZenithPoolManager: RESERVE_UNDERFLOW");
            pool.reserve1 -= amountOut;
            _safeTransferFrom(params.key.currency0, msg.sender, address(this), amountIn);
            _safeTransfer(params.key.currency1, msg.sender, amountOut);
            delta = BalanceDelta({amount0: int256(amountIn), amount1: -int256(amountOut)});
        } else {
            pool.reserve1 += amountIn;
            require(pool.reserve0 >= amountOut, "ZenithPoolManager: RESERVE_UNDERFLOW");
            pool.reserve0 -= amountOut;
            _safeTransferFrom(params.key.currency1, msg.sender, address(this), amountIn);
            _safeTransfer(params.key.currency0, msg.sender, amountOut);
            delta = BalanceDelta({amount0: -int256(amountOut), amount1: int256(amountIn)});
        }

        pool.sqrtPriceX96 = nextSqrtPriceX96;
        pool.tick = TickMath.getTickAtSqrtRatio(nextSqrtPriceX96);

        if (address(params.key.hook) != address(0)) {
            bytes4 selector = params.key.hook.afterSwap(
                msg.sender,
                poolId,
                params.zeroForOne,
                params.amountSpecified,
                amountOut,
                params.hookData
            );
            require(selector == IZenithHook.afterSwap.selector, "ZenithPoolManager: HOOK_REVERT");
        }

        emit Swap(
            poolId,
            msg.sender,
            params.zeroForOne,
            params.amountSpecified,
            pool.sqrtPriceX96,
            pool.liquidity,
            pool.tick,
            feeAmount
        );
    }

    function _safeTransfer(address token, address to, uint256 value) internal {
        require(token != address(0), "ZenithPoolManager: ZERO_TOKEN");
        require(to != address(0), "ZenithPoolManager: ZERO_RECIPIENT");
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithPoolManager: TRANSFER_FAILED");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) internal {
        require(token != address(0), "ZenithPoolManager: ZERO_TOKEN");
        require(from != address(0), "ZenithPoolManager: ZERO_SENDER");
        require(to != address(0), "ZenithPoolManager: ZERO_RECIPIENT");
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithPoolManager: TRANSFER_FROM_FAILED");
    }
}
