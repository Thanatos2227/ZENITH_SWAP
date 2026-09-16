// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./interfaces/IZenithFeeController.sol";

/**
 * @title ZenithFeeController
 * @notice Centralized, auditable protocol fee and pool tier configuration for ZENITH SWAP (V1, V2, V3, and Cross-Chain).
 * @dev Enforces strict protocol fee ceilings (max 30 BPS / 0.30%) to prevent governance fee manipulation.
 *      Does NOT custody any protocol revenue; solely manages configuration and authorized collector roles.
 */
contract ZenithFeeController is IZenithFeeController {
    address public override governance;
    address public override pendingGovernance;
    address public override treasury;

    // Protocol Fee Ceilings (in Basis Points, 1 BPS = 0.01%)
    uint256 public constant MAX_PROTOCOL_FEE_BPS = 30; // Max 0.30%
    uint256 public constant MAX_CROSS_CHAIN_FEE_BPS = 30; // Max 0.30%

    uint256 public override protocolFeeBps = 5;      // Default 0.05%
    uint256 public override crossChainFeeBps = 5;    // Default 0.05%
    uint256 public override v1TotalFeeBps = 30;      // Default 0.30%

    // V2 Allowed Fee Tiers (in BPS)
    mapping(uint24 => bool) public override isV2FeeTierAllowed;

    // V3 Allowed Fee Tiers (in hundredths of a pip) & Tick Spacings
    mapping(uint24 => bool) public override isV3FeeTierAllowed;
    mapping(uint24 => int24) public override v3TickSpacings;

    // Authorized Protocol Fee Collectors
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

        // Initialize standard V2 fee tiers
        isV2FeeTierAllowed[5] = true;   // 0.05%
        isV2FeeTierAllowed[30] = true;  // 0.30%
        isV2FeeTierAllowed[100] = true; // 1.00%

        // Initialize standard V3 fee tiers and corresponding tick spacings
        _enableV3FeeTier(100, 1);    // 0.01% - Tick spacing 1 (stable pairs)
        _enableV3FeeTier(500, 10);   // 0.05% - Tick spacing 10 (correlated pairs)
        _enableV3FeeTier(3000, 60);  // 0.30% - Tick spacing 60 (standard pairs)
        _enableV3FeeTier(10000, 200);// 1.00% - Tick spacing 200 (volatile/exotic pairs)
    }

    function _enableV3FeeTier(uint24 feeTier, int24 tickSpacing) internal {
        isV3FeeTierAllowed[feeTier] = true;
        v3TickSpacings[feeTier] = tickSpacing;
        emit V3FeeTierConfigured(feeTier, tickSpacing, true);
    }

    /**
     * @notice Computes sovereign protocol fee from gross swap input.
     */
    function calculateProtocolFee(uint256 amount) public view override returns (uint256 feeAmount) {
        return (amount * protocolFeeBps) / 10000;
    }

    /**
     * @notice Computes sovereign cross-chain protocol fee from gross bridge amount.
     */
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

    // Two-Step Safe Governance Handover
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
