pragma solidity 0.8.24;

interface IZenithTreasury {

    error OnlyGovernance();
    error ProtocolPaused();
    error UnauthorizedCollector(address caller);
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance(uint256 available, uint256 requested);
    error TransferFailed();
    error NotPendingGovernance();

    event FeeReceived(address indexed token, address indexed collector, uint256 amount);
    event DirectNativeReceived(address indexed from, uint256 amount);
    event TreasuryWithdrawal(address indexed token, address indexed recipient, uint256 amount);
    event EmergencyPaused(address indexed actor);
    event EmergencyUnpaused(address indexed actor);
    event EmergencyTokenRescue(address indexed token, address indexed recipient, uint256 amount);
    event FeeCollectorUpdated(address indexed collector, bool authorized);
    event GovernanceTransferInitiated(address indexed currentGovernance, address indexed pendingGovernance);
    event GovernanceTransferred(address indexed oldGovernance, address indexed newGovernance);

    function governance() external view returns (address);
    function pendingGovernance() external view returns (address);
    function isEmergencyPaused() external view returns (bool);
    function authorizedCollector(address collector) external view returns (bool);
    function isAuthorizedCollector(address collector) external view returns (bool);
    function cumulativeFeesCollected(address token) external view returns (uint256);
    function getTreasuryBalance(address token) external view returns (uint256);
    function getCollectedFees(address token) external view returns (uint256);

    function depositERC20Fee(address token, uint256 amount) external;
    function depositNativeFee() external payable;
    function withdraw(address token, address payable recipient, uint256 amount) external;
    function setFeeCollector(address collector, bool authorized) external;
    function setEmergencyPause(bool paused) external;
    function rescueToken(address token, address payable recipient, uint256 amount) external;
    function transferGovernance(address newGovernance) external;
    function acceptGovernance() external;
}
