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

    function test_protocolFeeBounds() public {
        assertEq(feeController.protocolFeeBps(), 5);

        vm.prank(governance);
        feeController.setProtocolFeeBps(30);
        assertEq(feeController.protocolFeeBps(), 30);

        vm.prank(governance);
        vm.expectRevert(abi.encodeWithSelector(IZenithFeeController.FeeExceedsMaxCeiling.selector, 31, 30));
        feeController.setProtocolFeeBps(31);
    }

    function test_crossChainFeeBounds() public {
        assertEq(feeController.crossChainFeeBps(), 5);

        vm.prank(governance);
        feeController.setCrossChainFeeBps(25);
        assertEq(feeController.crossChainFeeBps(), 25);

        vm.prank(governance);
        vm.expectRevert(abi.encodeWithSelector(IZenithFeeController.FeeExceedsMaxCeiling.selector, 35, 30));
        feeController.setCrossChainFeeBps(35);
    }

    function test_v2FeeTierConfiguration() public {
        assertTrue(feeController.isV2FeeTierAllowed(5));
        assertTrue(feeController.isV2FeeTierAllowed(30));
        assertTrue(feeController.isV2FeeTierAllowed(100));
        assertFalse(feeController.isV2FeeTierAllowed(50));

        vm.prank(governance);
        feeController.configureV2FeeTier(50, true);
        assertTrue(feeController.isV2FeeTierAllowed(50));

        vm.prank(governance);
        feeController.configureV2FeeTier(50, false);
        assertFalse(feeController.isV2FeeTierAllowed(50));

        vm.prank(governance);
        vm.expectRevert(abi.encodeWithSelector(IZenithFeeController.FeeExceedsMaxCeiling.selector, 501, 500));
        feeController.configureV2FeeTier(501, true);
    }

    function test_v3FeeTierAndTickSpacingConfiguration() public {
        assertTrue(feeController.isV3FeeTierAllowed(100));
        assertEq(feeController.v3TickSpacings(100), 1);

        assertTrue(feeController.isV3FeeTierAllowed(500));
        assertEq(feeController.v3TickSpacings(500), 10);

        assertTrue(feeController.isV3FeeTierAllowed(3000));
        assertEq(feeController.v3TickSpacings(3000), 60);

        assertTrue(feeController.isV3FeeTierAllowed(10000));
        assertEq(feeController.v3TickSpacings(10000), 200);

        vm.prank(governance);
        feeController.configureV3FeeTier(200, 4, true);
        assertTrue(feeController.isV3FeeTierAllowed(200));
        assertEq(feeController.v3TickSpacings(200), 4);

        vm.prank(governance);
        vm.expectRevert(abi.encodeWithSelector(IZenithFeeController.InvalidTickSpacing.selector, 0));
        feeController.configureV3FeeTier(250, 0, true);
    }

    function test_treasuryAddressConfiguration() public {
        assertEq(feeController.treasury(), treasuryAddr);

        address newTreasury = address(0x9999);
        vm.prank(governance);
        feeController.setTreasury(newTreasury);
        assertEq(feeController.treasury(), newTreasury);

        vm.prank(governance);
        vm.expectRevert(IZenithFeeController.ZeroAddress.selector);
        feeController.setTreasury(address(0));
    }

    function test_collectorAuthorization() public {
        assertFalse(feeController.isFeeCollector(collector));

        vm.prank(governance);
        feeController.setFeeCollector(collector, true);
        assertTrue(feeController.isFeeCollector(collector));

        vm.prank(governance);
        feeController.setFeeCollector(collector, false);
        assertFalse(feeController.isFeeCollector(collector));
    }

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

    function test_feeCalculations() public view {
        uint256 grossAmount = 100_000 ether;

        assertEq(feeController.calculateProtocolFee(grossAmount), 50 ether);
        assertEq(feeController.calculateCrossChainFee(grossAmount), 50 ether);
    }
}
