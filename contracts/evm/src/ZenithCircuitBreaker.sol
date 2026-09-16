pragma solidity 0.8.24;

contract ZenithCircuitBreaker {
    address public immutable governance;
    address public emergencyGuardian;

    bool public isPaused;
    uint256 public lastPausedTimestamp;
    string public lastPauseReason;

    event EmergencyPaused(address indexed triggeredBy, string reason, uint256 timestamp);
    event Resumed(address indexed triggeredBy, uint256 timestamp);
    event EmergencyGuardianUpdated(address indexed previousGuardian, address indexed newGuardian);

    modifier onlyAuthorized() {
        require(msg.sender == governance || msg.sender == emergencyGuardian, "ZenithCB: Unauthorized");
        _;
    }

    modifier onlyGovernance() {
        require(msg.sender == governance, "ZenithCB: Only governance");
        _;
    }

    constructor(address _governance, address _emergencyGuardian) {
        require(_governance != address(0), "ZenithCB: Zero governance address");
        require(_emergencyGuardian != address(0), "ZenithCB: Zero guardian address");
        governance = _governance;
        emergencyGuardian = _emergencyGuardian;
    }

    function emergencyPause(string calldata reason) external onlyAuthorized {
        require(!isPaused, "ZenithCB: Already paused");
        isPaused = true;
        lastPausedTimestamp = block.timestamp;
        lastPauseReason = reason;
        emit EmergencyPaused(msg.sender, reason, block.timestamp);
    }

    function resume() external onlyGovernance {
        require(isPaused, "ZenithCB: Not paused");
        isPaused = false;
        lastPauseReason = "";
        emit Resumed(msg.sender, block.timestamp);
    }

    function updateGuardian(address newGuardian) external onlyGovernance {
        require(newGuardian != address(0), "ZenithCB: Zero guardian");
        emit EmergencyGuardianUpdated(emergencyGuardian, newGuardian);
        emergencyGuardian = newGuardian;
    }
}
