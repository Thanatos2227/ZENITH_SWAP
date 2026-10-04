pragma solidity 0.8.24;

import "./interfaces/IERC20.sol";
import "./interfaces/IZenithCrossChainRouter.sol";
import "./interfaces/IPermit2.sol";
import "./treasury/ZenithTreasury.sol";
import "./treasury/ZenithFeeController.sol";
import "./ZenithCircuitBreaker.sol";

contract ZenithCrossChainRouter is IZenithCrossChainRouter {
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "CrossChainOrder(address user,address sourceToken,uint256 amountIn,string destinationChain,string destinationToken,uint256 minAmountOut,address recipient,uint256 nonce,uint256 deadline)"
    );

    ZenithTreasury public immutable treasury;
    ZenithFeeController public immutable feeController;
    ZenithCircuitBreaker public immutable circuitBreaker;
    IPermit2 public immutable permit2;
    address public immutable owner;

    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    mapping(bytes32 => CrossChainOrder) private _orders;
    mapping(address => mapping(uint256 => bool)) public executedNonces;
    mapping(bytes32 => bool) public fulfilledOrders;
    mapping(bytes32 => bool) public refundedOrders;
    mapping(address => bool) public authorizedSolvers;

    event SolverAuthorizationUpdated(address indexed solver, bool isAuthorized);

    modifier nonReentrant() {
        require(_status != _ENTERED, "ZenithCrossChainRouter: Reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    modifier whenNotPaused() {
        if (address(circuitBreaker) != address(0)) {
            require(!circuitBreaker.isPaused(), "ZenithCrossChainRouter: Circuit breaker active");
        }
        _;
    }

    modifier checkDeadline(uint256 deadline) {
        require(block.timestamp <= deadline, "ZenithCrossChainRouter: Order deadline expired");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "ZenithCrossChainRouter: Only owner");
        _;
    }

    constructor(
        address _owner,
        address _treasury,
        address _feeController,
        address _circuitBreaker,
        address _permit2
    ) {
        require(_owner != address(0), "ZenithCrossChainRouter: Zero owner");
        owner = _owner;
        treasury = _treasury != address(0) ? ZenithTreasury(payable(_treasury)) : ZenithTreasury(payable(address(0)));
        feeController = _feeController != address(0) ? ZenithFeeController(_feeController) : ZenithFeeController(address(0));
        circuitBreaker = _circuitBreaker != address(0) ? ZenithCircuitBreaker(_circuitBreaker) : ZenithCircuitBreaker(address(0));
        permit2 = IPermit2(_permit2);
        _status = _NOT_ENTERED;
    }

    receive() external payable {}

    function setSolverAuthorization(address solver, bool isAuthorized) external onlyOwner {
        require(solver != address(0), "ZenithCrossChainRouter: Zero solver");
        authorizedSolvers[solver] = isAuthorized;
        emit SolverAuthorizationUpdated(solver, isAuthorized);
    }

    function _safeTransfer(address token, address to, uint256 value) internal {
        require(token != address(0), "ZenithCrossChainRouter: Zero token");
        require(to != address(0), "ZenithCrossChainRouter: Zero recipient");
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithCrossChainRouter: Transfer failed");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) internal {
        require(token != address(0), "ZenithCrossChainRouter: Zero token");
        require(from != address(0), "ZenithCrossChainRouter: Zero sender");
        require(to != address(0), "ZenithCrossChainRouter: Zero recipient");
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithCrossChainRouter: TransferFrom failed");
    }

    function _safeApprove(address token, address spender, uint256 value) internal {
        require(token != address(0), "ZenithCrossChainRouter: Zero token");
        require(spender != address(0), "ZenithCrossChainRouter: Zero spender");
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.approve.selector, spender, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithCrossChainRouter: Approve failed");
    }

    function _parseAddress(string memory str) internal pure returns (bool success, address parsed) {
        bytes memory b = bytes(str);
        if (b.length != 42 || b[0] != "0" || (b[1] != "x" && b[1] != "X")) {
            return (false, address(0));
        }
        uint160 res = 0;
        for (uint256 i = 2; i < 42; i++) {
            uint8 c = uint8(b[i]);
            uint8 val;
            if (c >= 48 && c <= 57) {
                val = c - 48;
            } else if (c >= 65 && c <= 70) {
                val = c - 65 + 10;
            } else if (c >= 97 && c <= 102) {
                val = c - 97 + 10;
            } else {
                return (false, address(0));
            }
            res = (res << 4) | val;
        }
        return (true, address(res));
    }

    function _validateDestinationToken(string memory expectedToken, address actualToken) internal pure returns (bool) {
        (bool isAddress, address parsedAddr) = _parseAddress(expectedToken);
        if (isAddress) {
            if (actualToken == address(0)) {
                return (parsedAddr == address(0) || parsedAddr == address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE));
            }
            return parsedAddr == actualToken;
        }
        bytes32 expectedHash = keccak256(bytes(expectedToken));
        if (actualToken == address(0)) {
            return (
                expectedHash == keccak256(bytes("ETH")) ||
                expectedHash == keccak256(bytes("POL")) ||
                expectedHash == keccak256(bytes("MATIC")) ||
                expectedHash == keccak256(bytes("AVAX")) ||
                expectedHash == keccak256(bytes("BNB")) ||
                expectedHash == keccak256(bytes("NATIVE"))
            );
        }
        return false;
    }

    function hashOrder(
        address user,
        address sourceToken,
        uint256 amountIn,
        string memory destinationChain,
        string memory destinationToken,
        uint256 minAmountOut,
        address recipient,
        uint256 nonce,
        uint256 deadline
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                user,
                sourceToken,
                amountIn,
                keccak256(bytes(destinationChain)),
                keccak256(bytes(destinationToken)),
                minAmountOut,
                recipient,
                nonce,
                deadline
            )
        );
    }

    function initiateCrossChainSwap(InitiateCrossChainParams calldata params)
        external
        payable
        override
        nonReentrant
        whenNotPaused
        checkDeadline(params.deadline)
        returns (bytes32 orderId)
    {
        require(params.amountIn > 0, "ZenithCrossChainRouter: Zero input amount");
        require(params.recipient != address(0), "ZenithCrossChainRouter: Zero recipient");
        require(!executedNonces[msg.sender][params.nonce], "ZenithCrossChainRouter: Nonce already used");

        orderId = hashOrder(
            msg.sender,
            params.sourceToken,
            params.amountIn,
            params.destinationChain,
            params.destinationToken,
            params.minAmountOut,
            params.recipient,
            params.nonce,
            params.deadline
        );

        require(_orders[orderId].orderId == bytes32(0), "ZenithCrossChainRouter: Order already exists");

        executedNonces[msg.sender][params.nonce] = true;

        (uint256 protocolFee, uint256 netDeposit) = _handleDeposit(params.sourceToken, params.amountIn);

        _storeCrossChainOrder(orderId, msg.sender, params, netDeposit, protocolFee);

        _emitCrossChainOrderInitiated(orderId, msg.sender, params, protocolFee);
    }

    function _handleDeposit(
        address sourceToken,
        uint256 amountIn
    ) private returns (uint256 protocolFee, uint256 netDeposit) {
        if (address(feeController) != address(0)) {
            protocolFee = feeController.calculateCrossChainFee(amountIn);
        }
        netDeposit = amountIn - protocolFee;

        if (sourceToken == address(0)) {
            require(msg.value == amountIn, "ZenithCrossChainRouter: Mismatched msg.value");
            if (protocolFee > 0 && address(treasury) != address(0)) {
                treasury.depositNativeFee{value: protocolFee}();
            }
        } else {
            _safeTransferFrom(sourceToken, msg.sender, address(this), amountIn);
            if (protocolFee > 0 && address(treasury) != address(0)) {
                _safeApprove(sourceToken, address(treasury), protocolFee);
                treasury.depositERC20Fee(sourceToken, protocolFee);
            }
        }
    }

    function _storeCrossChainOrder(
        bytes32 orderId,
        address user,
        InitiateCrossChainParams calldata params,
        uint256 netDeposit,
        uint256 protocolFee
    ) private {
        _orders[orderId] = CrossChainOrder({
            orderId: orderId,
            user: user,
            sourceToken: params.sourceToken,
            amountIn: netDeposit,
            destinationChain: params.destinationChain,
            destinationToken: params.destinationToken,
            minAmountOut: params.minAmountOut,
            recipient: params.recipient,
            nonce: params.nonce,
            deadline: params.deadline,
            feePaid: protocolFee,
            timestamp: block.timestamp
        });
    }

    function _emitCrossChainOrderInitiated(
        bytes32 orderId,
        address user,
        InitiateCrossChainParams calldata params,
        uint256 protocolFee
    ) private {
        emit CrossChainOrderInitiated(
            orderId,
            user,
            params.destinationChain,
            params.sourceToken,
            params.destinationToken,
            params.amountIn,
            params.minAmountOut,
            params.recipient,
            params.nonce,
            params.deadline,
            protocolFee
        );
    }

    function fulfillCrossChainOrder(FulfillCrossChainParams calldata params)
        external
        payable
        override
        nonReentrant
        whenNotPaused
    {
        require(authorizedSolvers[msg.sender], "ZenithCrossChainRouter: Unauthorized solver");

        CrossChainOrder storage order = _orders[params.orderId];
        require(order.orderId != bytes32(0), "ZenithCrossChainRouter: Order does not exist");
        require(!fulfilledOrders[params.orderId], "ZenithCrossChainRouter: Order already fulfilled");
        require(!refundedOrders[params.orderId], "ZenithCrossChainRouter: Order already refunded");
        require(block.timestamp <= order.deadline, "ZenithCrossChainRouter: Order deadline expired");

        require(params.recipient != address(0), "ZenithCrossChainRouter: Zero recipient");
        require(params.recipient == order.recipient, "ZenithCrossChainRouter: Recipient mismatch");

        require(params.outputAmount > 0, "ZenithCrossChainRouter: Zero output amount");
        require(params.outputAmount >= order.minAmountOut, "ZenithCrossChainRouter: Output below minimum");

        require(
            _validateDestinationToken(order.destinationToken, params.outputToken),
            "ZenithCrossChainRouter: Destination token mismatch"
        );

        fulfilledOrders[params.orderId] = true;

        if (params.outputToken == address(0)) {
            require(msg.value == params.outputAmount, "ZenithCrossChainRouter: ETH value mismatch");
            (bool success, ) = params.recipient.call{value: params.outputAmount}("");
            require(success, "ZenithCrossChainRouter: Native payout failed");
        } else {
            require(msg.value == 0, "ZenithCrossChainRouter: Unexpected ETH value");
            _safeTransferFrom(params.outputToken, msg.sender, params.recipient, params.outputAmount);
        }

        emit CrossChainOrderFulfilled(
            params.orderId,
            msg.sender,
            params.recipient,
            params.outputToken,
            params.outputAmount
        );
    }

    function refundExpiredOrder(bytes32 orderId)
        external
        override
        nonReentrant
        whenNotPaused
    {
        CrossChainOrder storage order = _orders[orderId];
        require(order.orderId != bytes32(0), "ZenithCrossChainRouter: Order not found");
        require(!fulfilledOrders[orderId], "ZenithCrossChainRouter: Order already fulfilled");
        require(!refundedOrders[orderId], "ZenithCrossChainRouter: Order already refunded");
        require(block.timestamp > order.deadline, "ZenithCrossChainRouter: Deadline not passed");

        refundedOrders[orderId] = true;

        if (order.sourceToken == address(0)) {
            (bool success, ) = order.user.call{value: order.amountIn}("");
            require(success, "ZenithCrossChainRouter: Native refund failed");
        } else {
            _safeTransfer(order.sourceToken, order.user, order.amountIn);
        }

        emit CrossChainOrderRefunded(orderId, order.user, order.sourceToken, order.amountIn);
    }

    function getOrder(bytes32 orderId) external view override returns (CrossChainOrder memory) {
        return _orders[orderId];
    }

    function isOrderFulfilled(bytes32 orderId) external view override returns (bool) {
        return fulfilledOrders[orderId];
    }

    function isOrderRefunded(bytes32 orderId) external view override returns (bool) {
        return refundedOrders[orderId];
    }
}
