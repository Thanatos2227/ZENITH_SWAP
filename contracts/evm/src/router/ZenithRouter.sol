// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../interfaces/IERC20.sol";
import "../interfaces/IWETH9.sol";
import "../treasury/ZenithTreasury.sol";
import "../treasury/ZenithFeeController.sol";
import "../v1/ZenithV1Router.sol";
import "../v2/ZenithV2Router.sol";
import "../v3/ZenithV3Router.sol";

/**
 * @title ZenithRouter
 * @notice Unified Aggregating Router for ZENITH SWAP.
 * @dev Aggregates sovereign Zenith V1, Zenith V2, and Zenith V3 AMM tiers, routes swaps,
 *      and transparently deposits configured protocol fees to ZenithTreasury.
 */
contract ZenithRouter {
    enum ProtocolTier { AUTO, ZENITH_V1, ZENITH_V2, ZENITH_V3 }

    address public immutable governance;
    address public immutable WETH9;
    ZenithTreasury public immutable treasury;
    ZenithFeeController public immutable feeController;

    ZenithV1Router public v1Router;
    ZenithV2Router public v2Router;
    ZenithV3Router public v3Router;

    uint256 private _unlocked = 1;
    modifier nonReentrant() {
        require(_unlocked == 1, "ZenithRouter: REENTRANT");
        _unlocked = 0;
        _;
        _unlocked = 1;
    }

    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "ZenithRouter: EXPIRED");
        _;
    }

    struct SwapParams {
        ProtocolTier protocol;
        address tokenIn;
        address tokenOut;
        uint24 feeTier; // For V2 (in BPS) or V3 (in hundredths of a pip)
        uint256 amountIn;
        uint256 amountOutMinimum;
        address recipient;
        uint256 deadline;
    }

    event ProtocolSwap(
        address indexed sender,
        address indexed recipient,
        address indexed tokenIn,
        address tokenOut,
        ProtocolTier protocol,
        uint256 amountIn,
        uint256 amountOut,
        uint256 protocolFee
    );

    constructor(
        address _governance,
        address _weth9,
        address _treasury,
        address _feeController,
        address _v1Router,
        address _v2Router,
        address _v3Router
    ) {
        require(_governance != address(0), "ZenithRouter: Zero governance");
        require(_weth9 != address(0), "ZenithRouter: Zero WETH");
        require(_treasury != address(0), "ZenithRouter: Zero treasury");
        require(_feeController != address(0), "ZenithRouter: Zero feeController");

        governance = _governance;
        WETH9 = _weth9;
        treasury = ZenithTreasury(payable(_treasury));
        feeController = ZenithFeeController(_feeController);

        v1Router = ZenithV1Router(payable(_v1Router));
        v2Router = ZenithV2Router(payable(_v2Router));
        v3Router = ZenithV3Router(payable(_v3Router));
    }

    receive() external payable {}

    function setRouters(address _v1, address _v2, address _v3) external {
        require(msg.sender == governance, "ZenithRouter: ONLY_GOVERNANCE");
        if (_v1 != address(0)) v1Router = ZenithV1Router(payable(_v1));
        if (_v2 != address(0)) v2Router = ZenithV2Router(payable(_v2));
        if (_v3 != address(0)) v3Router = ZenithV3Router(payable(_v3));
    }

    function swap(SwapParams calldata params)
        external
        payable
        nonReentrant
        ensure(params.deadline)
        returns (uint256 amountOut)
    {
        require(params.amountIn > 0, "ZenithRouter: ZERO_AMOUNT_IN");
        require(params.recipient != address(0), "ZenithRouter: ZERO_RECIPIENT");

        bool isNativeIn = msg.value > 0;
        if (isNativeIn) {
            require(msg.value == params.amountIn, "ZenithRouter: VALUE_MISMATCH");
            IWETH9(WETH9).deposit{value: msg.value}();
        } else {
            _safeTransferFrom(params.tokenIn, msg.sender, address(this), params.amountIn);
        }

        // Calculate and forward protocol fee share to ZenithTreasury
        uint256 feeBps = feeController.protocolFeeBps();
        uint256 protocolFee = (params.amountIn * feeBps) / 10000;
        uint256 swapAmountIn = params.amountIn - protocolFee;

        address actualTokenIn = isNativeIn ? WETH9 : params.tokenIn;

        if (protocolFee > 0) {
            _safeApprove(actualTokenIn, address(treasury), protocolFee);
            treasury.depositERC20Fee(actualTokenIn, protocolFee);
        }

        // Route to the designated Zenith AMM tier
        if (params.protocol == ProtocolTier.ZENITH_V1 || (params.protocol == ProtocolTier.AUTO && address(v1Router) != address(0))) {
            _safeApprove(actualTokenIn, address(v1Router), swapAmountIn);
            address[] memory path = new address[](2);
            path[0] = actualTokenIn;
            path[1] = params.tokenOut;
            uint256[] memory amounts = v1Router.swapExactTokensForTokens(
                swapAmountIn,
                params.amountOutMinimum,
                path,
                params.recipient,
                params.deadline
            );
            amountOut = amounts[1];
        } else if (params.protocol == ProtocolTier.ZENITH_V2) {
            _safeApprove(actualTokenIn, address(v2Router), swapAmountIn);
            address[] memory path = new address[](2);
            path[0] = actualTokenIn;
            path[1] = params.tokenOut;
            uint24[] memory feePath = new uint24[](1);
            feePath[0] = params.feeTier > 0 ? params.feeTier : 30;
            uint256[] memory amounts = v2Router.swapExactTokensForTokens(
                swapAmountIn,
                params.amountOutMinimum,
                path,
                feePath,
                params.recipient,
                params.deadline
            );
            amountOut = amounts[1];
        } else if (params.protocol == ProtocolTier.ZENITH_V3) {
            _safeApprove(actualTokenIn, address(v3Router), swapAmountIn);
            amountOut = v3Router.exactInputSingle(
                ZenithV3Router.ExactInputSingleParams({
                    tokenIn: actualTokenIn,
                    tokenOut: params.tokenOut,
                    fee: params.feeTier > 0 ? params.feeTier : 3000,
                    recipient: params.recipient,
                    deadline: params.deadline,
                    amountIn: swapAmountIn,
                    amountOutMinimum: params.amountOutMinimum,
                    sqrtPriceLimitX96: 0
                })
            );
        } else {
            revert("ZenithRouter: UNSUPPORTED_PROTOCOL");
        }

        require(amountOut >= params.amountOutMinimum, "ZenithRouter: INSUFFICIENT_OUTPUT_AMOUNT");

        emit ProtocolSwap(
            msg.sender,
            params.recipient,
            params.tokenIn,
            params.tokenOut,
            params.protocol,
            params.amountIn,
            amountOut,
            protocolFee
        );
    }

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithRouter: TF_FAILED");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithRouter: TFROM_FAILED");
    }

    function _safeApprove(address token, address spender, uint256 value) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithRouter: APPR_FAILED");
    }
}
