pragma solidity 0.8.24;

import "./interfaces/IERC20.sol";
import "./interfaces/IPermit2.sol";
import "./ZenithCircuitBreaker.sol";

contract ZenithReactor {
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "DutchAuctionOrder(address user,address inputToken,address outputToken,uint256 inputAmount,uint256 startOutputAmount,uint256 endOutputAmount,uint256 decayStartTime,uint256 decayEndTime,address recipient,uint256 nonce)"
    );

    struct DutchAuctionOrder {
        address user;
        address inputToken;
        address outputToken;
        uint256 inputAmount;
        uint256 startOutputAmount;
        uint256 endOutputAmount;
        uint256 decayStartTime;
        uint256 decayEndTime;
        address recipient;
        uint256 nonce;
    }

    struct SignedOrder {
        DutchAuctionOrder order;
        bytes signature;
    }

    address public immutable owner;
    IPermit2 public immutable permit2;
    ZenithCircuitBreaker public immutable circuitBreaker;

    mapping(address => mapping(uint256 => bool)) public executedNonces;

    event OrderFilled(
        bytes32 indexed orderHash,
        address indexed user,
        address indexed filler,
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 outputAmount,
        address recipient
    );

    event OrderCancelled(address indexed user, uint256 indexed nonce);

    modifier onlyWhenNotPaused() {
        if (address(circuitBreaker) != address(0)) {
            require(!circuitBreaker.isPaused(), "ZenithReactor: PAUSED");
        }
        _;
    }

    constructor(address _permit2, address _circuitBreaker) {
        owner = msg.sender;
        permit2 = IPermit2(_permit2);
        circuitBreaker = ZenithCircuitBreaker(_circuitBreaker);
    }

    function hashOrder(DutchAuctionOrder memory order) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                order.user,
                order.inputToken,
                order.outputToken,
                order.inputAmount,
                order.startOutputAmount,
                order.endOutputAmount,
                order.decayStartTime,
                order.decayEndTime,
                order.recipient,
                order.nonce
            )
        );
    }

    function getRequiredOutput(DutchAuctionOrder memory order) public view returns (uint256) {
        if (block.timestamp <= order.decayStartTime) {
            return order.startOutputAmount;
        }
        if (block.timestamp >= order.decayEndTime) {
            return order.endOutputAmount;
        }

        uint256 elapsed = block.timestamp - order.decayStartTime;
        uint256 duration = order.decayEndTime - order.decayStartTime;
        uint256 decayTotal = order.startOutputAmount - order.endOutputAmount;

        return order.startOutputAmount - ((decayTotal * elapsed) / duration);
    }

    function execute(SignedOrder calldata signedOrder) external onlyWhenNotPaused returns (uint256 outputAmount) {
        DutchAuctionOrder memory order = signedOrder.order;
        bytes32 orderHash = hashOrder(order);

        require(!executedNonces[order.user][order.nonce], "ZenithReactor: NONCE_ALREADY_USED");
        require(block.timestamp <= order.decayEndTime, "ZenithReactor: ORDER_EXPIRED");
        require(order.recipient != address(0), "ZenithReactor: ZERO_RECIPIENT");

        outputAmount = getRequiredOutput(order);
        executedNonces[order.user][order.nonce] = true;

        _safeTransferFrom(order.outputToken, msg.sender, order.recipient, outputAmount);

        if (address(permit2) != address(0)) {
            permit2.permitTransferFrom(
                IPermit2.PermitTransferFrom({
                    permitted: IPermit2.TokenPermissions({
                        token: order.inputToken,
                        amount: order.inputAmount
                    }),
                    nonce: order.nonce,
                    deadline: order.decayEndTime
                }),
                IPermit2.SignatureTransferDetails({
                    to: msg.sender,
                    requestedAmount: order.inputAmount
                }),
                order.user,
                signedOrder.signature
            );
        } else {
            _safeTransferFrom(order.inputToken, order.user, msg.sender, order.inputAmount);
        }

        emit OrderFilled(
            orderHash,
            order.user,
            msg.sender,
            order.inputToken,
            order.outputToken,
            order.inputAmount,
            outputAmount,
            order.recipient
        );
    }

    function executeBatch(SignedOrder[] calldata signedOrders) external onlyWhenNotPaused {
        for (uint256 i = 0; i < signedOrders.length; i++) {
            this.execute(signedOrders[i]);
        }
    }

    function cancelOrder(uint256 nonce) external {
        executedNonces[msg.sender][nonce] = true;
        emit OrderCancelled(msg.sender, nonce);
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) internal {
        require(token != address(0), "ZenithReactor: ZERO_TOKEN");
        require(from != address(0), "ZenithReactor: ZERO_SENDER");
        require(to != address(0), "ZenithReactor: ZERO_RECIPIENT");
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithReactor: TRANSFER_FROM_FAILED");
    }
}
