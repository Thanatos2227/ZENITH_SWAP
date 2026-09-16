// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../interfaces/IERC20.sol";
import "./interfaces/IZenithTreasury.sol";

/**
 * @title ZenithTreasury
 * @notice Sovereign Protocol Revenue Treasury Vault for ZENITH SWAP.
 * @dev Non-custodial for users: receives strictly protocol-owned fee revenue from authorized collectors.
 *      Does NOT custody normal user swap principal. Protected by two-step governance access control,
 *      reentrancy guards, explicit fee collector authorization, and emergency controls.
 */
contract ZenithTreasury is IZenithTreasury {
    address public override governance;
    address public override pendingGovernance;
    bool public override isEmergencyPaused;

    // Authorized Fee Collectors Mapping
    mapping(address => bool) public override authorizedCollector;

    // Historical Cumulative Accounting (Token -> Total Raw Fees Received)
    mapping(address => uint256) public override cumulativeFeesCollected;

    // Reentrancy Guard
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

    /**
     * @notice Allows direct native transfers without falsifying cumulative protocol fee accounting.
     */
    receive() external payable {
        if (msg.value > 0) {
            emit DirectNativeReceived(msg.sender, msg.value);
        }
    }

    /**
     * @notice Deposit ERC20 protocol fees into the treasury.
     * @dev Only callable by governance-authorized protocol collectors (e.g. ZenithRouters).
     * @param token Address of the ERC20 token to deposit.
     * @param amount Token amount to transfer into the treasury.
     */
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

    /**
     * @notice Deposit native gas token protocol fees into the treasury.
     * @dev Only callable by governance-authorized protocol collectors.
     */
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

    /**
     * @notice Withdraws protocol revenue to a governance-approved recipient.
     * @param token Token address (address(0) for native asset).
     * @param recipient Target address to receive the withdrawn funds.
     * @param amount Quantity of tokens/native currency to withdraw.
     */
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

    /**
     * @notice Authorizes or deauthorizes a protocol contract to deposit fees.
     * @param collector Address of the collector (e.g. ZenithRouter, ZenithCrossChainRouter).
     * @param authorized True to authorize, false to revoke.
     */
    function setFeeCollector(address collector, bool authorized) external override onlyGovernance {
        if (collector == address(0)) revert ZeroAddress();
        authorizedCollector[collector] = authorized;
        emit FeeCollectorUpdated(collector, authorized);
    }

    /**
     * @notice Helper to check collector authorization status.
     */
    function isAuthorizedCollector(address collector) external view override returns (bool) {
        return authorizedCollector[collector];
    }

    /**
     * @notice Returns active on-chain balance for a specified token (address(0) for native).
     */
    function getTreasuryBalance(address token) external view override returns (uint256) {
        if (token == address(0)) {
            return address(this).balance;
        }
        return IERC20(token).balanceOf(address(this));
    }

    /**
     * @notice Returns lifetime cumulative fees received by the treasury for a token.
     */
    function getCollectedFees(address token) external view override returns (uint256) {
        return cumulativeFeesCollected[token];
    }

    /**
     * @notice Emergency pause for fee deposits and normal treasury withdrawals.
     */
    function setEmergencyPause(bool _paused) external override onlyGovernance {
        isEmergencyPaused = _paused;
        if (_paused) {
            emit EmergencyPaused(msg.sender);
        } else {
            emit EmergencyUnpaused(msg.sender);
        }
    }

    /**
     * @notice Emergency token rescue for non-protocol tokens mistakenly transferred to the contract.
     */
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

    /**
     * @notice Initiates two-step governance transfer.
     */
    function transferGovernance(address _newGovernance) external override onlyGovernance {
        if (_newGovernance == address(0)) revert ZeroAddress();
        pendingGovernance = _newGovernance;
        emit GovernanceTransferInitiated(governance, _newGovernance);
    }

    /**
     * @notice Accepts pending governance transfer.
     */
    function acceptGovernance() external override {
        if (msg.sender != pendingGovernance) revert NotPendingGovernance();
        emit GovernanceTransferred(governance, pendingGovernance);
        governance = pendingGovernance;
        pendingGovernance = address(0);
    }

    // --- Internal Safe Transfer Helpers ---

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
