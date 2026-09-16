pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/ZenithCircuitBreaker.sol";
import "../src/ZenithFeeManager.sol";
import "../src/ZenithRouter.sol";

contract ZenithRouterTest is Test {
    ZenithCircuitBreaker public circuitBreaker;
    ZenithFeeManager public feeManager;
    ZenithRouter public router;

    address public governance = address(0x1000);
    address public guardian = address(0x2000);
    address public treasury = address(0x3000);

    function setUp() public {
        circuitBreaker = new ZenithCircuitBreaker(governance, guardian);
        feeManager = new ZenithFeeManager(governance, treasury);
        router = new ZenithRouter(
            address(feeManager),
            address(circuitBreaker),
            address(0),
            address(0),
            address(0)
        );
    }

    function testFeeCalculation() public view {
        uint256 amount = 10000;
        uint256 fee = feeManager.calculateFee(amount);
        assertEq(fee, 5, "Fee calculation mismatch");
    }

    function testCircuitBreakerPause() public view {
        assertTrue(!circuitBreaker.isPaused(), "Should not be paused initially");
    }

    function testUserDiscountFeeCalculation() public {
        address vipUser = address(0x9999);
        vm.prank(governance);
        feeManager.setUserDiscount(vipUser, 5000);

        uint256 amount = 10000;
        uint256 discountedFee = feeManager.calculateUserFee(vipUser, amount);
        assertEq(discountedFee, 2, "Discounted fee calculation mismatch");
    }
}
