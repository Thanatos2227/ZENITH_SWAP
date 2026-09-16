pragma solidity 0.8.24;

import "./interfaces/IERC20.sol";
import "./interfaces/IWETH9.sol";
import "./interfaces/IZenithRouter.sol";
import "./interfaces/IPermit2.sol";
import "./ZenithFeeManager.sol";
import "./ZenithCircuitBreaker.sol";
import "./ZenithPoolManager.sol";

contract ZenithRouter is IZenithRouter {
    ZenithFeeManager public immutable feeManager;
    ZenithCircuitBreaker public immutable circuitBreaker;
    ZenithPoolManager public poolManager;
    address public immutable WETH9;
    IPermit2 public immutable permit2;

    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    event PoolManagerUpdated(address indexed previousPoolManager, address indexed newPoolManager);

    modifier nonReentrant() {
        require(_status != _ENTERED, "ZenithRouter: Reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    modifier whenNotPaused() {
        require(!circuitBreaker.isPaused(), "ZenithRouter: Circuit breaker active");
        _;
    }

    modifier checkDeadline(uint256 deadline) {
        require(block.timestamp <= deadline, "ZenithRouter: Transaction expired");
        _;
    }

    constructor(
        address _feeManager,
        address _circuitBreaker,
        address _weth9,
        address _permit2,
        address _poolManager
    ) {
        require(_feeManager != address(0), "ZenithRouter: Zero fee manager");
        require(_circuitBreaker != address(0), "ZenithRouter: Zero circuit breaker");
        feeManager = ZenithFeeManager(_feeManager);
        circuitBreaker = ZenithCircuitBreaker(_circuitBreaker);
        WETH9 = _weth9;
        permit2 = IPermit2(_permit2);
        poolManager = ZenithPoolManager(_poolManager);
        _status = _NOT_ENTERED;
    }

    receive() external payable {}

    function setPoolManager(address _poolManager) external {
        require(msg.sender == feeManager.governance(), "ZenithRouter: Only governance");
        require(_poolManager != address(0), "ZenithRouter: Zero pool manager");
        emit PoolManagerUpdated(address(poolManager), _poolManager);
        poolManager = ZenithPoolManager(_poolManager);
    }

    function _safeTransfer(address token, address to, uint256 value) internal {
        require(token != address(0), "ZenithRouter: Zero token address");
        require(to != address(0), "ZenithRouter: Zero recipient address");
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithRouter: Transfer failed");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) internal {
        require(token != address(0), "ZenithRouter: Zero token address");
        require(from != address(0), "ZenithRouter: Zero sender address");
        require(to != address(0), "ZenithRouter: Zero recipient address");
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithRouter: TransferFrom failed");
    }

    function _safeApprove(address token, address spender, uint256 value) internal {
        require(token != address(0), "ZenithRouter: Zero token address");
        require(spender != address(0), "ZenithRouter: Zero spender address");
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.approve.selector, spender, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithRouter: Approve failed");
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        override
        nonReentrant
        whenNotPaused
        checkDeadline(params.deadline)
        returns (uint256 amountOut)
    {
        require(params.amountIn > 0, "ZenithRouter: Zero amountIn");
        require(params.recipient != address(0), "ZenithRouter: Zero recipient");

        uint256 protocolFee = feeManager.calculateUserFee(msg.sender, params.amountIn);
        uint256 netAmountIn = params.amountIn - protocolFee;

        if (params.tokenIn == address(0)) {
            require(msg.value == params.amountIn, "ZenithRouter: ETH value mismatch");
            if (protocolFee > 0) {
                (bool feeOk, ) = feeManager.treasury().call{value: protocolFee}("");
                require(feeOk, "ZenithRouter: Fee transfer failed");
            }
            if (WETH9 != address(0)) {
                IWETH9(WETH9).deposit{value: netAmountIn}();
            }
        } else {
            if (protocolFee > 0) {
                _safeTransferFrom(params.tokenIn, msg.sender, feeManager.treasury(), protocolFee);
            }
            _safeTransferFrom(params.tokenIn, msg.sender, address(this), netAmountIn);
        }

        if (address(poolManager) != address(0) && params.tokenIn != address(0) && params.tokenOut != address(0)) {
            bool zeroForOne = params.tokenIn < params.tokenOut;
            address c0 = zeroForOne ? params.tokenIn : params.tokenOut;
            address c1 = zeroForOne ? params.tokenOut : params.tokenIn;

            _safeApprove(params.tokenIn, address(poolManager), netAmountIn);

            ZenithPoolManager.BalanceDelta memory delta = poolManager.swap(
                ZenithPoolManager.SwapParams({
                    key: ZenithPoolManager.PoolKey({
                        currency0: c0,
                        currency1: c1,
                        feeBps: uint24(params.fee > 0 ? params.fee : 30),
                        tickSpacing: 60,
                        hook: IZenithHook(address(0))
                    }),
                    zeroForOne: zeroForOne,
                    amountSpecified: int256(netAmountIn),
                    sqrtPriceLimitX96: params.sqrtPriceLimitX96 != 0
                        ? params.sqrtPriceLimitX96
                        : (zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1),
                    hookData: ""
                })
            );

            amountOut = zeroForOne ? (delta.amount1 < 0 ? uint256(-delta.amount1) : uint256(delta.amount1))
                                   : (delta.amount0 < 0 ? uint256(-delta.amount0) : uint256(delta.amount0));
        } else {
            amountOut = netAmountIn;
        }

        require(amountOut >= params.amountOutMinimum, "ZenithRouter: Slippage limit exceeded");

        if (params.tokenOut == address(0)) {
            (bool sendOk, ) = params.recipient.call{value: amountOut}("");
            require(sendOk, "ZenithRouter: ETH transfer failed");
        } else {
            _safeTransfer(params.tokenOut, params.recipient, amountOut);
        }

        emit SwapExecuted(
            msg.sender,
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            amountOut,
            protocolFee,
            params.recipient
        );
    }

    function exactInput(ExactInputParams calldata params)
        external
        payable
        override
        nonReentrant
        whenNotPaused
        checkDeadline(params.deadline)
        returns (uint256 amountOut)
    {
        require(params.amountIn > 0, "ZenithRouter: Zero amountIn");
        require(params.recipient != address(0), "ZenithRouter: Zero recipient");

        uint256 protocolFee = feeManager.calculateUserFee(msg.sender, params.amountIn);
        uint256 netAmountIn = params.amountIn - protocolFee;

        amountOut = netAmountIn;
        require(amountOut >= params.amountOutMinimum, "ZenithRouter: Slippage limit exceeded");

        emit SwapExecuted(
            msg.sender,
            address(0),
            address(0),
            params.amountIn,
            amountOut,
            protocolFee,
            params.recipient
        );
    }

    function exactOutputSingle(ExactOutputSingleParams calldata params)
        external
        payable
        override
        nonReentrant
        whenNotPaused
        checkDeadline(params.deadline)
        returns (uint256 amountIn)
    {
        require(params.amountOut > 0, "ZenithRouter: Zero amountOut");
        require(params.recipient != address(0), "ZenithRouter: Zero recipient");

        amountIn = params.amountOut;
        require(amountIn <= params.amountInMaximum, "ZenithRouter: Maximum input exceeded");

        uint256 protocolFee = feeManager.calculateUserFee(msg.sender, amountIn);

        emit SwapExecuted(
            msg.sender,
            params.tokenIn,
            params.tokenOut,
            amountIn,
            params.amountOut,
            protocolFee,
            params.recipient
        );
    }

    function exactOutput(ExactOutputParams calldata params)
        external
        payable
        override
        nonReentrant
        whenNotPaused
        checkDeadline(params.deadline)
        returns (uint256 amountIn)
    {
        require(params.amountOut > 0, "ZenithRouter: Zero amountOut");
        require(params.recipient != address(0), "ZenithRouter: Zero recipient");

        amountIn = params.amountOut;
        require(amountIn <= params.amountInMaximum, "ZenithRouter: Maximum input exceeded");

        uint256 protocolFee = feeManager.calculateUserFee(msg.sender, amountIn);

        emit SwapExecuted(
            msg.sender,
            address(0),
            address(0),
            amountIn,
            params.amountOut,
            protocolFee,
            params.recipient
        );
    }

    function executeSwap(GenericSwapParams calldata params)
        external
        payable
        override
        nonReentrant
        whenNotPaused
        checkDeadline(params.deadline)
        returns (uint256 amountOut)
    {
        require(params.amountIn > 0, "ZenithRouter: Zero input amount");
        require(params.recipient != address(0), "ZenithRouter: Zero recipient address");

        uint256 protocolFee = feeManager.calculateUserFee(msg.sender, params.amountIn);
        uint256 netAmountIn = params.amountIn - protocolFee;

        if (params.tokenIn == address(0)) {
            require(msg.value == params.amountIn, "ZenithRouter: Mismatched msg.value");
            if (protocolFee > 0) {
                (bool feeSuccess, ) = feeManager.treasury().call{value: protocolFee}("");
                require(feeSuccess, "ZenithRouter: Fee transfer failed");
            }
        } else {
            if (protocolFee > 0) {
                _safeTransferFrom(params.tokenIn, msg.sender, feeManager.treasury(), protocolFee);
            }
            _safeTransferFrom(params.tokenIn, msg.sender, address(this), netAmountIn);
        }

        uint256 currentBalanceBefore = params.tokenOut == address(0)
            ? address(this).balance
            : IERC20(params.tokenOut).balanceOf(address(this));

        for (uint256 i = 0; i < params.hops.length; i++) {
            Hop calldata hop = params.hops[i];
            require(hop.pool != address(0), "ZenithRouter: Invalid pool");

            if (hop.tokenIn != address(0)) {
                _safeApprove(hop.tokenIn, hop.pool, type(uint256).max);
            }

            (bool success, ) = hop.pool.call(hop.callData);
            require(success, "ZenithRouter: Hop execution failed");
        }

        uint256 currentBalanceAfter = params.tokenOut == address(0)
            ? address(this).balance
            : IERC20(params.tokenOut).balanceOf(address(this));

        amountOut = currentBalanceAfter > currentBalanceBefore
            ? currentBalanceAfter - currentBalanceBefore
            : netAmountIn;

        require(amountOut >= params.minAmountOut, "ZenithRouter: Insufficient output amount");

        if (params.tokenOut == address(0)) {
            (bool payoutSuccess, ) = params.recipient.call{value: amountOut}("");
            require(payoutSuccess, "ZenithRouter: Payout failed");
        } else {
            _safeTransfer(params.tokenOut, params.recipient, amountOut);
        }

        emit SwapExecuted(
            msg.sender,
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            amountOut,
            protocolFee,
            params.recipient
        );
    }

    function unwrapWETH9(uint256 amountMinimum, address recipient) external payable override nonReentrant whenNotPaused {
        require(recipient != address(0), "ZenithRouter: Zero recipient");
        require(WETH9 != address(0), "ZenithRouter: WETH9 not configured");
        uint256 wethBalance = IERC20(WETH9).balanceOf(address(this));
        require(wethBalance >= amountMinimum, "ZenithRouter: Insufficient WETH9");
        if (wethBalance > 0) {
            IWETH9(WETH9).withdraw(wethBalance);
            (bool success, ) = recipient.call{value: wethBalance}("");
            require(success, "ZenithRouter: ETH transfer failed");
        }
    }

    function refundETH() external payable override nonReentrant whenNotPaused {
        if (address(this).balance > 0) {
            uint256 refundAmount = address(this).balance;
            (bool success, ) = msg.sender.call{value: refundAmount}("");
            require(success, "ZenithRouter: Refund failed");
            emit RefundInitiated(msg.sender, refundAmount);
        }
    }
}
