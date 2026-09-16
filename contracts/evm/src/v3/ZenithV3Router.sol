pragma solidity 0.8.24;

import "./ZenithV3Pool.sol";
import "./ZenithV3Factory.sol";
import "../interfaces/IERC20.sol";
import "../interfaces/IWETH9.sol";

contract ZenithV3Router is IZenithV3SwapCallback {
    address public immutable factory;
    address public immutable WETH9;

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountOut;
        uint256 amountInMaximum;
        uint160 sqrtPriceLimitX96;
    }

    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "ZenithV3Router: EXPIRED");
        _;
    }

    constructor(address _factory, address _weth9) {
        require(_factory != address(0), "ZenithV3Router: Zero factory");
        require(_weth9 != address(0), "ZenithV3Router: Zero WETH");
        factory = _factory;
        WETH9 = _weth9;
    }

    receive() external payable {
        require(msg.sender == WETH9, "ZenithV3Router: NOT_WETH9");
    }

    function zenithV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external override {
        require(amount0Delta > 0 || amount1Delta > 0, "ZenithV3Router: CALLBACK_INVALID");
        (address tokenIn, address payer) = abi.decode(data, (address, address));

        uint256 amountToPay = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        if (payer == address(this)) {
            _safeTransfer(tokenIn, msg.sender, amountToPay);
        } else {
            _safeTransferFrom(tokenIn, payer, msg.sender, amountToPay);
        }
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        ensure(params.deadline)
        returns (uint256 amountOut)
    {
        bool zeroForOne = params.tokenIn < params.tokenOut;
        address pool = ZenithV3Factory(factory).getPool(params.tokenIn, params.tokenOut, params.fee);
        require(pool != address(0), "ZenithV3Router: POOL_NOT_FOUND");

        uint160 sqrtPriceLimitX96 = params.sqrtPriceLimitX96 == 0
            ? (zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1)
            : params.sqrtPriceLimitX96;

        (int256 amount0, int256 amount1) = ZenithV3Pool(pool).swap(
            params.recipient,
            zeroForOne,
            int256(params.amountIn),
            sqrtPriceLimitX96,
            abi.encode(params.tokenIn, msg.sender)
        );

        amountOut = uint256(-(zeroForOne ? amount1 : amount0));
        require(amountOut >= params.amountOutMinimum, "ZenithV3Router: SLIPPAGE");
    }

    function multicall(bytes[] calldata data) external payable returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            (bool success, bytes memory result) = address(this).delegatecall(data[i]);
            require(success, "ZenithV3Router: MULTICALL_FAILED");
            results[i] = result;
        }
    }

    function unwrapWETH9(uint256 amountMinimum, address recipient) external payable {
        uint256 balanceWETH9 = IWETH9(WETH9).balanceOf(address(this));
        require(balanceWETH9 >= amountMinimum, "ZenithV3Router: INSUFFICIENT_WETH9");

        if (balanceWETH9 > 0) {
            IWETH9(WETH9).withdraw(balanceWETH9);
            _safeTransferETH(recipient, balanceWETH9);
        }
    }

    function refundETH() external payable {
        if (address(this).balance > 0) {
            _safeTransferETH(msg.sender, address(this).balance);
        }
    }

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithV3Router: TF_FAILED");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithV3Router: TFROM_FAILED");
    }

    function _safeTransferETH(address to, uint256 value) private {
        (bool success, ) = to.call{value: value}("");
        require(success, "ZenithV3Router: ETH_TF_FAILED");
    }
}
