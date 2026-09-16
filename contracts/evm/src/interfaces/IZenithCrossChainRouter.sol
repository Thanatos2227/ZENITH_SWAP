pragma solidity 0.8.24;

interface IZenithCrossChainRouter {
    struct CrossChainOrder {
        bytes32 orderId;
        address user;
        address sourceToken;
        uint256 amountIn;
        string destinationChain;
        string destinationToken;
        uint256 minAmountOut;
        address recipient;
        uint256 nonce;
        uint256 deadline;
        uint256 feePaid;
        uint256 timestamp;
    }

    struct InitiateCrossChainParams {
        string destinationChain;
        address sourceToken;
        string destinationToken;
        uint256 amountIn;
        uint256 minAmountOut;
        address recipient;
        uint256 deadline;
        uint256 nonce;
    }

    struct FulfillCrossChainParams {
        bytes32 orderId;
        address recipient;
        address outputToken;
        uint256 outputAmount;
    }

    event CrossChainOrderInitiated(
        bytes32 indexed orderId,
        address indexed user,
        string destinationChain,
        address sourceToken,
        string destinationToken,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        uint256 nonce,
        uint256 deadline,
        uint256 feePaid
    );

    event CrossChainOrderFulfilled(
        bytes32 indexed orderId,
        address indexed solver,
        address indexed recipient,
        address outputToken,
        uint256 outputAmount
    );

    event CrossChainOrderRefunded(
        bytes32 indexed orderId,
        address indexed user,
        address token,
        uint256 amount
    );

    function initiateCrossChainSwap(InitiateCrossChainParams calldata params)
        external
        payable
        returns (bytes32 orderId);

    function fulfillCrossChainOrder(FulfillCrossChainParams calldata params)
        external
        payable;

    function refundExpiredOrder(bytes32 orderId) external;

    function getOrder(bytes32 orderId) external view returns (CrossChainOrder memory);

    function isOrderFulfilled(bytes32 orderId) external view returns (bool);

    function isOrderRefunded(bytes32 orderId) external view returns (bool);
}
