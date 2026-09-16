pragma solidity 0.8.24;

import "./interfaces/IZenithFeeController.sol";

contract ZenithFeeController is IZenithFeeController {
    address public override governance;
    address public override pendingGovernance;
    address public override treasury;

    uint256 public constant MAX_PROTOCOL_FEE_BPS = 30;
    uint256 public constant MAX_CROSS_CHAIN_FEE_BPS = 30;

    uint256 public override protocolFeeBps = 5;
    uint256 public override crossChainFeeBps = 5;
    uint256 public override v1TotalFeeBps = 30;

    mapping(uint24 => bool) public override isV2FeeTierAllowed;

    mapping(uint24 => bool) public override isV3FeeTierAllowed;
    mapping(uint24 => int24) public override v3TickSpacings;

    mapping(address => bool) public override isFeeCollector;

    modifier onlyGovernance() {
        if (msg.sender != governance) revert OnlyGovernance();
        _;
    }

    constructor(address _governance, address _treasury) {
        if (_governance == address(0)) revert ZeroAddress();
        if (_treasury == address(0)) revert ZeroAddress();

        governance = _governance;
        treasury = _treasury;

        isV2FeeTierAllowed[5] = true;
        isV2FeeTierAllowed[30] = true;
        isV2FeeTierAllowed[100] = true;

        _enableV3FeeTier(100, 1);
        _enableV3FeeTier(500, 10);
        _enableV3FeeTier(3000, 60);
        _enableV3FeeTier(10000, 200);
    }

    function _enableV3FeeTier(uint24 feeTier, int24 tickSpacing) internal {
        isV3FeeTierAllowed[feeTier] = true;
        v3TickSpacings[feeTier] = tickSpacing;
        emit V3FeeTierConfigured(feeTier, tickSpacing, true);
    }

    function calculateProtocolFee(uint256 amount) public view override returns (uint256 feeAmount) {
        return (amount * protocolFeeBps) / 10000;
    }

    function calculateCrossChainFee(uint256 amount) public view override returns (uint256 feeAmount) {
        return (amount * crossChainFeeBps) / 10000;
    }

    function setProtocolFeeBps(uint256 _newFeeBps) external override onlyGovernance {
        if (_newFeeBps > MAX_PROTOCOL_FEE_BPS) revert FeeExceedsMaxCeiling(_newFeeBps, MAX_PROTOCOL_FEE_BPS);
        emit ProtocolFeeUpdated(protocolFeeBps, _newFeeBps);
        protocolFeeBps = _newFeeBps;
    }

    function setCrossChainFeeBps(uint256 _newFeeBps) external override onlyGovernance {
        if (_newFeeBps > MAX_CROSS_CHAIN_FEE_BPS) revert FeeExceedsMaxCeiling(_newFeeBps, MAX_CROSS_CHAIN_FEE_BPS);
        emit CrossChainFeeUpdated(crossChainFeeBps, _newFeeBps);
        crossChainFeeBps = _newFeeBps;
    }

    function setV1TotalFeeBps(uint256 _newFeeBps) external override onlyGovernance {
        if (_newFeeBps > 1000) revert FeeExceedsMaxCeiling(_newFeeBps, 1000);
        emit V1TotalFeeUpdated(v1TotalFeeBps, _newFeeBps);
        v1TotalFeeBps = _newFeeBps;
    }

    function setTreasury(address _newTreasury) external override onlyGovernance {
        if (_newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, _newTreasury);
        treasury = _newTreasury;
    }

    function setFeeCollector(address collector, bool authorized) external override onlyGovernance {
        if (collector == address(0)) revert ZeroAddress();
        isFeeCollector[collector] = authorized;
        emit FeeCollectorUpdated(collector, authorized);
    }

    function configureV2FeeTier(uint24 feeTierBps, bool allowed) external override onlyGovernance {
        if (feeTierBps > 500) revert FeeExceedsMaxCeiling(feeTierBps, 500);
        isV2FeeTierAllowed[feeTierBps] = allowed;
        emit V2FeeTierConfigured(feeTierBps, allowed);
    }

    function configureV3FeeTier(uint24 feeTier, int24 tickSpacing, bool allowed) external override onlyGovernance {
        if (feeTier > 20000) revert FeeExceedsMaxCeiling(feeTier, 20000);
        if (allowed && (tickSpacing <= 0 || tickSpacing > 16384)) revert InvalidTickSpacing(tickSpacing);
        isV3FeeTierAllowed[feeTier] = allowed;
        if (allowed) {
            v3TickSpacings[feeTier] = tickSpacing;
        }
        emit V3FeeTierConfigured(feeTier, tickSpacing, allowed);
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
}
