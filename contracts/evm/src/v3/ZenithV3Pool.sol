pragma solidity 0.8.24;

import "../interfaces/IERC20.sol";
import "../../libraries/FullMath.sol";
import "../../libraries/SqrtPriceMath.sol";
import "../../libraries/TickMath.sol";
import "./libraries/SwapMath.sol";
import "./libraries/TickBitmap.sol";
import "./libraries/LiquidityMath.sol";

interface IZenithV3MintCallback {
    function zenithV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata data) external;
}

interface IZenithV3SwapCallback {
    function zenithV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

contract ZenithV3Pool {
    using TickBitmap for mapping(int16 => uint256);

    address public immutable factory;
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;

    uint128 public constant maxLiquidityPerTick = type(uint128).max / 1000;

    struct Slot0 {
        uint160 sqrtPriceX96;
        int24 tick;
        bool unlocked;
    }
    Slot0 public slot0;

    uint256 public feeGrowthGlobal0X128;
    uint256 public feeGrowthGlobal1X128;
    uint128 public liquidity;

    struct Info {
        uint128 liquidityGross;
        int128 liquidityNet;
        uint256 feeGrowthOutside0X128;
        uint256 feeGrowthOutside1X128;
        bool initialized;
    }
    mapping(int24 => Info) public ticks;
    mapping(int16 => uint256) public tickBitmap;

    struct PositionInfo {
        uint128 liquidity;
        uint256 feeGrowthInside0LastX128;
        uint256 feeGrowthInside1LastX128;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
    }
    mapping(bytes32 => PositionInfo) public positions;

    modifier lock() {
        require(slot0.unlocked, "ZenithV3Pool: LOCKED");
        slot0.unlocked = false;
        _;
        slot0.unlocked = true;
    }

    event Initialize(uint160 sqrtPriceX96, int24 tick);
    event Mint(
        address sender,
        address indexed owner,
        int24 indexed tickLower,
        int24 indexed tickUpper,
        uint128 amount,
        uint256 amount0,
        uint256 amount1
    );
    event Collect(
        address indexed owner,
        address recipient,
        int24 indexed tickLower,
        int24 indexed tickUpper,
        uint128 amount0,
        uint128 amount1
    );
    event Burn(
        address indexed owner,
        int24 indexed tickLower,
        int24 indexed tickUpper,
        uint128 amount,
        uint256 amount0,
        uint256 amount1
    );
    event Swap(
        address indexed sender,
        address indexed recipient,
        int256 amount0,
        int256 amount1,
        uint160 sqrtPriceX96,
        uint128 liquidity,
        int24 tick
    );

    constructor() {
        factory = msg.sender;
        (token0, token1, fee, tickSpacing) = (address(0), address(0), 0, 0);
    }

    function initializePool(address _token0, address _token1, uint24 _fee, int24 _tickSpacing) external {
        require(msg.sender == factory, "ZenithV3Pool: FORBIDDEN");
        assembly {
            sstore(token0.slot, _token0)
            sstore(token1.slot, _token1)
            sstore(fee.slot, _fee)
            sstore(tickSpacing.slot, _tickSpacing)
        }
    }

    function initialize(uint160 sqrtPriceX96) external {
        require(slot0.sqrtPriceX96 == 0, "ZenithV3Pool: ALREADY_INITIALIZED");
        int24 tick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);
        slot0 = Slot0({
            sqrtPriceX96: sqrtPriceX96,
            tick: tick,
            unlocked: true
        });
        emit Initialize(sqrtPriceX96, tick);
    }

    function _checkTicks(int24 tickLower, int24 tickUpper) private view {
        require(tickLower < tickUpper, "ZenithV3Pool: TL_TU");
        require(tickLower >= TickMath.MIN_TICK, "ZenithV3Pool: TL_BOUND");
        require(tickUpper <= TickMath.MAX_TICK, "ZenithV3Pool: TU_BOUND");
        require(tickLower % tickSpacing == 0, "ZenithV3Pool: TL_MOD");
        require(tickUpper % tickSpacing == 0, "ZenithV3Pool: TU_MOD");
    }

    function _modifyPosition(
        address owner,
        int24 tickLower,
        int24 tickUpper,
        int128 liquidityDelta
    ) private returns (PositionInfo storage position, int256 amount0, int256 amount1) {
        _checkTicks(tickLower, tickUpper);
        Slot0 memory _slot0 = slot0;

        bytes32 positionKey = keccak256(abi.encodePacked(owner, tickLower, tickUpper));
        position = positions[positionKey];

        if (liquidityDelta != 0) {
            if (_slot0.tick < tickLower) {
                amount0 = SqrtPriceMath.getAmount0Delta(
                    TickMath.getSqrtRatioAtTick(tickLower),
                    TickMath.getSqrtRatioAtTick(tickUpper),
                    liquidityDelta
                );
            } else if (_slot0.tick < tickUpper) {
                amount0 = SqrtPriceMath.getAmount0Delta(
                    _slot0.sqrtPriceX96,
                    TickMath.getSqrtRatioAtTick(tickUpper),
                    liquidityDelta
                );
                amount1 = SqrtPriceMath.getAmount1Delta(
                    TickMath.getSqrtRatioAtTick(tickLower),
                    _slot0.sqrtPriceX96,
                    liquidityDelta
                );
                liquidity = LiquidityMath.addDelta(liquidity, liquidityDelta);
            } else {
                amount1 = SqrtPriceMath.getAmount1Delta(
                    TickMath.getSqrtRatioAtTick(tickLower),
                    TickMath.getSqrtRatioAtTick(tickUpper),
                    liquidityDelta
                );
            }

            position.liquidity = LiquidityMath.addDelta(position.liquidity, liquidityDelta);
        }
    }

    function mint(
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount,
        bytes calldata data
    ) external lock returns (uint256 amount0, uint256 amount1) {
        require(amount > 0, "ZenithV3Pool: ZERO_AMOUNT");
        (, int256 amount0Int, int256 amount1Int) = _modifyPosition(
            recipient,
            tickLower,
            tickUpper,
            int128(amount)
        );

        amount0 = uint256(amount0Int);
        amount1 = uint256(amount1Int);

        uint256 balance0Before = 0;
        uint256 balance1Before = 0;
        if (amount0 > 0) balance0Before = IERC20(token0).balanceOf(address(this));
        if (amount1 > 0) balance1Before = IERC20(token1).balanceOf(address(this));

        IZenithV3MintCallback(msg.sender).zenithV3MintCallback(amount0, amount1, data);

        if (amount0 > 0) require(balance0Before + amount0 <= IERC20(token0).balanceOf(address(this)), "ZenithV3Pool: M0");
        if (amount1 > 0) require(balance1Before + amount1 <= IERC20(token1).balanceOf(address(this)), "ZenithV3Pool: M1");

        emit Mint(msg.sender, recipient, tickLower, tickUpper, amount, amount0, amount1);
    }

    function collect(
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount0Requested,
        uint128 amount1Requested
    ) external lock returns (uint128 amount0, uint128 amount1) {
        bytes32 positionKey = keccak256(abi.encodePacked(msg.sender, tickLower, tickUpper));
        PositionInfo storage position = positions[positionKey];

        amount0 = amount0Requested > position.tokensOwed0 ? position.tokensOwed0 : amount0Requested;
        amount1 = amount1Requested > position.tokensOwed1 ? position.tokensOwed1 : amount1Requested;

        if (amount0 > 0) {
            position.tokensOwed0 -= amount0;
            _safeTransfer(token0, recipient, amount0);
        }
        if (amount1 > 0) {
            position.tokensOwed1 -= amount1;
            _safeTransfer(token1, recipient, amount1);
        }

        emit Collect(msg.sender, recipient, tickLower, tickUpper, amount0, amount1);
    }

    function burn(
        int24 tickLower,
        int24 tickUpper,
        uint128 amount
    ) external lock returns (uint256 amount0, uint256 amount1) {
        (PositionInfo storage position, int256 amount0Int, int256 amount1Int) = _modifyPosition(
            msg.sender,
            tickLower,
            tickUpper,
            -int128(amount)
        );

        amount0 = uint256(-amount0Int);
        amount1 = uint256(-amount1Int);

        if (amount0 > 0 || amount1 > 0) {
            position.tokensOwed0 += uint128(amount0);
            position.tokensOwed1 += uint128(amount1);
        }

        emit Burn(msg.sender, tickLower, tickUpper, amount, amount0, amount1);
    }

    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external lock returns (int256 amount0, int256 amount1) {
        require(amountSpecified != 0, "ZenithV3Pool: ZERO_SPECIFIED");
        Slot0 memory _slot0 = slot0;

        require(
            zeroForOne
                ? sqrtPriceLimitX96 < _slot0.sqrtPriceX96 && sqrtPriceLimitX96 > TickMath.MIN_SQRT_RATIO
                : sqrtPriceLimitX96 > _slot0.sqrtPriceX96 && sqrtPriceLimitX96 < TickMath.MAX_SQRT_RATIO,
            "ZenithV3Pool: LIMIT_BOUND"
        );

        uint128 stateLiquidity = liquidity;
        (uint160 sqrtPriceNextX96, uint256 stepAmountIn, uint256 stepAmountOut, ) = SwapMath.computeSwapStep(
            _slot0.sqrtPriceX96,
            sqrtPriceLimitX96,
            stateLiquidity,
            amountSpecified,
            fee
        );

        if (zeroForOne) {
            amount0 = int256(stepAmountIn);
            amount1 = -int256(stepAmountOut);
        } else {
            amount0 = -int256(stepAmountOut);
            amount1 = int256(stepAmountIn);
        }

        slot0.sqrtPriceX96 = sqrtPriceNextX96;
        slot0.tick = TickMath.getTickAtSqrtRatio(sqrtPriceNextX96);

        if (zeroForOne) {
            if (stepAmountOut > 0) _safeTransfer(token1, recipient, stepAmountOut);
            uint256 balance0Before = IERC20(token0).balanceOf(address(this));
            IZenithV3SwapCallback(msg.sender).zenithV3SwapCallback(amount0, amount1, data);
            require(balance0Before + stepAmountIn <= IERC20(token0).balanceOf(address(this)), "ZenithV3Pool: SWAP0");
        } else {
            if (stepAmountOut > 0) _safeTransfer(token0, recipient, stepAmountOut);
            uint256 balance1Before = IERC20(token1).balanceOf(address(this));
            IZenithV3SwapCallback(msg.sender).zenithV3SwapCallback(amount0, amount1, data);
            require(balance1Before + stepAmountIn <= IERC20(token1).balanceOf(address(this)), "ZenithV3Pool: SWAP1");
        }

        emit Swap(msg.sender, recipient, amount0, amount1, slot0.sqrtPriceX96, stateLiquidity, slot0.tick);
    }

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithV3Pool: TF");
    }
}
