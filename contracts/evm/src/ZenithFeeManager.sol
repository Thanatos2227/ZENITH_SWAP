pragma solidity 0.8.24;

import "./interfaces/IERC20.sol";

contract ZenithFeeManager {
    address public immutable governance;
    address public treasury;
    address public stakingDistributor;

    uint256 public constant MAX_FEE_BPS = 30;
    uint256 public defaultFeeBps = 5;

    uint256 public stakingShareBps = 6000;
    mapping(address => uint256) public userFeeDiscountBps;

    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event StakingDistributorUpdated(address indexed previousDistributor, address indexed newDistributor);
    event StakingShareUpdated(uint256 previousShare, uint256 newShare);
    event DefaultFeeBpsUpdated(uint256 previousBps, uint256 newBps);
    event UserDiscountUpdated(address indexed user, uint256 discountBps);
    event FeeCollected(address indexed token, address indexed from, uint256 amount, address indexed treasury);
    event StakingFeeDistributed(address indexed token, uint256 amount, address indexed distributor);

    modifier onlyGovernance() {
        require(msg.sender == governance, "ZenithFee: Only governance");
        _;
    }

    constructor(address _governance, address _treasury) {
        require(_governance != address(0), "ZenithFee: Zero governance");
        require(_treasury != address(0), "ZenithFee: Zero treasury");
        governance = _governance;
        treasury = _treasury;
    }

    function setTreasury(address _newTreasury) external onlyGovernance {
        require(_newTreasury != address(0), "ZenithFee: Zero treasury");
        emit TreasuryUpdated(treasury, _newTreasury);
        treasury = _newTreasury;
    }

    function setStakingDistributor(address _newDistributor) external onlyGovernance {
        require(_newDistributor != address(0), "ZenithFee: Zero distributor");
        emit StakingDistributorUpdated(stakingDistributor, _newDistributor);
        stakingDistributor = _newDistributor;
    }

    function setStakingShareBps(uint256 _newShareBps) external onlyGovernance {
        require(_newShareBps <= 10000, "ZenithFee: Exceeds 100%");
        emit StakingShareUpdated(stakingShareBps, _newShareBps);
        stakingShareBps = _newShareBps;
    }

    function setDefaultFeeBps(uint256 _newBps) external onlyGovernance {
        require(_newBps <= MAX_FEE_BPS, "ZenithFee: Exceeds MAX_FEE_BPS");
        emit DefaultFeeBpsUpdated(defaultFeeBps, _newBps);
        defaultFeeBps = _newBps;
    }

    function setUserDiscount(address user, uint256 discountBps) external onlyGovernance {
        require(user != address(0), "ZenithFee: Zero user address");
        require(discountBps <= 10000, "ZenithFee: Exceeds 100%");
        userFeeDiscountBps[user] = discountBps;
        emit UserDiscountUpdated(user, discountBps);
    }

    function calculateFee(uint256 amount) public view returns (uint256 feeAmount) {
        return (amount * defaultFeeBps) / 10000;
    }

    function calculateUserFee(address user, uint256 amount) public view returns (uint256 feeAmount) {
        uint256 baseFee = calculateFee(amount);
        if (user == address(0)) {
            return baseFee;
        }
        uint256 discount = userFeeDiscountBps[user];
        if (discount > 0) {
            return baseFee - ((baseFee * discount) / 10000);
        }
        return baseFee;
    }

    function collectFee(address token, address from, uint256 amount) external returns (uint256 feeAmount) {
        require(from != address(0), "ZenithFee: Zero from address");
        feeAmount = calculateUserFee(from, amount);
        if (feeAmount > 0) {
            uint256 stakingPart = (stakingDistributor != address(0)) ? (feeAmount * stakingShareBps) / 10000 : 0;
            uint256 treasuryPart = feeAmount - stakingPart;

            if (token == address(0)) {
                require(address(this).balance >= feeAmount, "ZenithFee: Insufficient ETH");
                if (treasuryPart > 0) {
                    (bool successTreasury, ) = treasury.call{value: treasuryPart}("");
                    require(successTreasury, "ZenithFee: ETH transfer to treasury failed");
                }
                if (stakingPart > 0) {
                    (bool successStaking, ) = stakingDistributor.call{value: stakingPart}("");
                    require(successStaking, "ZenithFee: ETH transfer to staking failed");
                }
            } else {
                if (treasuryPart > 0) {
                    bool okTreasury = IERC20(token).transferFrom(from, treasury, treasuryPart);
                    require(okTreasury, "ZenithFee: Token transfer to treasury failed");
                }
                if (stakingPart > 0) {
                    bool okStaking = IERC20(token).transferFrom(from, stakingDistributor, stakingPart);
                    require(okStaking, "ZenithFee: Token transfer to staking failed");
                }
            }
            emit FeeCollected(token, from, treasuryPart, treasury);
            if (stakingPart > 0) {
                emit StakingFeeDistributed(token, stakingPart, stakingDistributor);
            }
        }
    }
}
