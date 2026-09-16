// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/treasury/ZenithFeeController.sol";

contract ZenithFeeControllerTest is Test {
    ZenithFeeController public feeController;

    address public governance = address(0x1111);
    address public pendingGov = address(0x2222);
    address public treasuryAddr = address(0x3333);
    address public user = address(0x4444);
    address public collector = address(0x5555);

    function setUp() public {
        feeController = new ZenithFeeController(governance, treasuryAddr);
    }

    // TEST 16: Protocol fee bounds (max 30 bps = 0.30%)
    function test_protocolFeeBounds() public {
        assertEq(feeController.protocolFeeBps(), 5);

        vm.prank(governance);
        feeController.setProtocolFeeBps(30);
        assertEq(feeController.protocolFeeBps(), 30);

        // Exceeding MAX_PROTOCOL_FEE_BPS (30) must revert
        vm.prank(governance);
        vm.expectRevert(abi.encodeWithSelector(IZenithFeeController.FeeExceedsMaxCeiling.selector, 31, 30));
        feeController.setProtocolFeeBps(31);
    }

    // TEST 17: Cross-chain fee bounds (max 30 bps)
    function test_crossChainFeeBounds() public {
        assertEq(feeController.crossChainFeeBps(), 5);

        vm.prank(governance);
        feeController.setCrossChainFeeBps(25);
        assertEq(feeController.crossChainFeeBps(), 25);

        // Exceeding MAX_CROSS_CHAIN_FEE_BPS (30) must revert
        vm.prank(governance);
        vm.expectRevert(abi.encodeWithSelector(IZenithFeeController.FeeExceedsMaxCeiling.selector, 35, 30));
        feeController.setCrossChainFeeBps(35);
    }

    // TEST 18: V2 fee-tier configuration (default 5, 30, 100 allowed)
    function test_v2FeeTierConfiguration() public {
        assertTrue(feeController.isV2FeeTierAllowed(5));
        assertTrue(feeController.isV2FeeTierAllowed(30));
        assertTrue(feeController.isV2FeeTierAllowed(100));
        assertFalse(feeController.isV2FeeTierAllowed(50));

        // Governance configures new tier
        vm.prank(governance);
        feeController.configureV2FeeTier(50, true);
        assertTrue(feeController.isV2FeeTierAllowed(50));

        // Disable tier
        vm.prank(governance);
        feeController.configureV2FeeTier(50, false);
        assertFalse(feeController.isV2FeeTierAllowed(50));

        // Reject excessive fee tier (> 500 bps / 5%)
        vm.prank(governance);
        vm.expectRevert(abi.encodeWithSelector(IZenithFeeController.FeeExceedsMaxCeiling.selector, 501, 500));
        feeController.configureV2FeeTier(501, true);
    }

    // TEST 19 & 20: V3 fee-tier and tick-spacing configuration
    function test_v3FeeTierAndTickSpacingConfiguration() public {
        assertTrue(feeController.isV3FeeTierAllowed(100));
        assertEq(feeController.v3TickSpacings(100), 1);

        assertTrue(feeController.isV3FeeTierAllowed(500));
        assertEq(feeController.v3TickSpacings(500), 10);

        assertTrue(feeController.isV3FeeTierAllowed(3000));
        assertEq(feeController.v3TickSpacings(3000), 60);

        assertTrue(feeController.isV3FeeTierAllowed(10000));
        assertEq(feeController.v3TickSpacings(10000), 200);

        // Configure custom V3 tier (e.g. 200 fee tier with tick spacing 4)
        vm.prank(governance);
        feeController.configureV3FeeTier(200, 4, true);
        assertTrue(feeController.isV3FeeTierAllowed(200));
        assertEq(feeController.v3TickSpacings(200), 4);

        // Reject invalid tick spacing
        vm.prank(governance);
        vm.expectRevert(abi.encodeWithSelector(IZenithFeeController.InvalidTickSpacing.selector, 0));
        feeController.configureV3FeeTier(250, 0, true);
    }

    // TEST 21: Treasury address configuration
    function test_treasuryAddressConfiguration() public {
        assertEq(feeController.treasury(), treasuryAddr);

        address newTreasury = address(0x9999);
        vm.prank(governance);
        feeController.setTreasury(newTreasury);
        assertEq(feeController.treasury(), newTreasury);

        // Reject zero address
        vm.prank(governance);
        vm.expectRevert(IZenithFeeController.ZeroAddress.selector);
        feeController.setTreasury(address(0));
    }

    // TEST 22: Collector authorization
    function test_collectorAuthorization() public {
        assertFalse(feeController.isFeeCollector(collector));

        vm.prank(governance);
        feeController.setFeeCollector(collector, true);
        assertTrue(feeController.isFeeCollector(collector));

        vm.prank(governance);
        feeController.setFeeCollector(collector, false);
        assertFalse(feeController.isFeeCollector(collector));
    }

    // TEST 23: Unauthorized modifications must revert
    function test_unauthorizedModifications_revert() public {
        vm.prank(user);
        vm.expectRevert(IZenithFeeController.OnlyGovernance.selector);
        feeController.setProtocolFeeBps(10);

        vm.prank(user);
        vm.expectRevert(IZenithFeeController.OnlyGovernance.selector);
        feeController.setCrossChainFeeBps(10);

        vm.prank(user);
        vm.expectRevert(IZenithFeeController.OnlyGovernance.selector);
        feeController.setTreasury(user);

        vm.prank(user);
        vm.expectRevert(IZenithFeeController.OnlyGovernance.selector);
        feeController.setFeeCollector(user, true);
    }

    // Protocol Fee calculation helper
    function test_feeCalculations() public view {
        uint256 grossAmount = 100_000 ether;
        // 5 BPS = 0.05% -> 50 ether
        assertEq(feeController.calculateProtocolFee(grossAmount), 50 ether);
        assertEq(feeController.calculateCrossChainFee(grossAmount), 50 ether);
    }
}
