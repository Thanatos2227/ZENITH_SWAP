pragma solidity 0.8.24;

import "../interfaces/IERC20.sol";
import "./interfaces/IZenithTreasury.sol";

contract ZenithTreasury is IZenithTreasury {
    address public override governance;
    address public override pendingGovernance;
    bool public override isEmergencyPaused;

    mapping(address => bool) public override authorizedCollector;

    mapping(address => uint256) public override cumulativeFeesCollected;

    uint256 private _status = 1;
    modifier nonReentrant() {
        if (_status != 1) revert("ZenithTreasury: REENTRANCY");
        _status = 2;
        _;
        _status = 1;
    }

    modifier onlyGovernance() {
        if (msg.sender != governance) revert OnlyGovernance();
        _;
    }

    modifier whenNotPaused() {
        if (isEmergencyPaused) revert ProtocolPaused();
        _;
    }

    modifier onlyAuthorizedCollector() {
        if (!authorizedCollector[msg.sender]) revert UnauthorizedCollector(msg.sender);
        _;
    }

    constructor(address _governance) {
        if (_governance == address(0)) revert ZeroAddress();
        governance = _governance;
    }

    receive() external payable {
        if (msg.value > 0) {
            emit DirectNativeReceived(msg.sender, msg.value);
        }
    }

    function depositERC20Fee(address token, uint256 amount)
        external
        override
        nonReentrant
        whenNotPaused
        onlyAuthorizedCollector
    {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        cumulativeFeesCollected[token] += amount;
        emit FeeReceived(token, msg.sender, amount);

        _safeTransferFrom(token, msg.sender, address(this), amount);
    }

    function depositNativeFee()
        external
        payable
        override
        nonReentrant
        whenNotPaused
        onlyAuthorizedCollector
    {
        if (msg.value == 0) revert ZeroAmount();

        cumulativeFeesCollected[address(0)] += msg.value;
        emit FeeReceived(address(0), msg.sender, msg.value);
    }

    function withdraw(
        address token,
        address payable recipient,
        uint256 amount
    ) external override onlyGovernance whenNotPaused nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        if (token == address(0)) {
            uint256 nativeBalance = address(this).balance;
            if (nativeBalance < amount) revert InsufficientBalance(nativeBalance, amount);
            emit TreasuryWithdrawal(address(0), recipient, amount);

            (bool success, ) = recipient.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            uint256 tokenBalance = IERC20(token).balanceOf(address(this));
            if (tokenBalance < amount) revert InsufficientBalance(tokenBalance, amount);
            emit TreasuryWithdrawal(token, recipient, amount);

            _safeTransfer(token, recipient, amount);
        }
    }

    function setFeeCollector(address collector, bool authorized) external override onlyGovernance {
        if (collector == address(0)) revert ZeroAddress();
        authorizedCollector[collector] = authorized;
        emit FeeCollectorUpdated(collector, authorized);
    }

    function isAuthorizedCollector(address collector) external view override returns (bool) {
        return authorizedCollector[collector];
    }

    function getTreasuryBalance(address token) external view override returns (uint256) {
        if (token == address(0)) {
            return address(this).balance;
        }
        return IERC20(token).balanceOf(address(this));
    }

    function getCollectedFees(address token) external view override returns (uint256) {
        return cumulativeFeesCollected[token];
    }

    function setEmergencyPause(bool _paused) external override onlyGovernance {
        isEmergencyPaused = _paused;
        if (_paused) {
            emit EmergencyPaused(msg.sender);
        } else {
            emit EmergencyUnpaused(msg.sender);
        }
    }

    function rescueToken(
        address token,
        address payable recipient,
        uint256 amount
    ) external override onlyGovernance nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        emit EmergencyTokenRescue(token, recipient, amount);

        if (token == address(0)) {
            uint256 nativeBalance = address(this).balance;
            if (nativeBalance < amount) revert InsufficientBalance(nativeBalance, amount);
            (bool success, ) = recipient.call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            uint256 tokenBalance = IERC20(token).balanceOf(address(this));
            if (tokenBalance < amount) revert InsufficientBalance(tokenBalance, amount);
            _safeTransfer(token, recipient, amount);
        }
    }

    function transferGovernance(address _newGovernance) external override onlyGovernance {
        if (_newGovernance == address(0)) revert ZeroAddress();
        pendingGovernance = _newGovernance;
        emit GovernanceTransferInitiated(governance, _newGovernance);
    }

    function acceptGovernance() external override {
        if (msg.sender != pendingGovernance) revert NotPendingGovernance();
        emit GovernanceTransferred(governance, pendingGovernance);
        governance = pendingGovernance;
        pendingGovernance = address(0);
    }

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, value)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }
}
