pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/treasury/ZenithTreasury.sol";
import "../src/interfaces/IERC20.sol";

contract TestERC20 is IERC20 {
    string public name = "Test Token";
    string public symbol = "TEST";
    uint8 public decimals = 18;
    uint256 public override totalSupply;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        require(balanceOf[msg.sender] >= amount, "INSUFFICIENT_BALANCE");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        require(balanceOf[from] >= amount, "INSUFFICIENT_BALANCE");
        if (allowance[from][msg.sender] != type(uint256).max) {
            require(allowance[from][msg.sender] >= amount, "INSUFFICIENT_ALLOWANCE");
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract ZenithTreasuryTest is Test {
    ZenithTreasury public treasury;
    TestERC20 public token;

    address public governance = address(0x1111);
    address public pendingGov = address(0x2222);
    address public collector = address(0x3333);
    address public user = address(0x4444);
    address public recipient = address(0x5555);

    function setUp() public {
        treasury = new ZenithTreasury(governance);
        token = new TestERC20();
        token.mint(collector, 1_000_000 ether);

        vm.prank(governance);
        treasury.setFeeCollector(collector, true);
    }

    function test_treasuryDeployment() public view {
        assertEq(treasury.governance(), governance);
        assertEq(treasury.pendingGovernance(), address(0));
        assertFalse(treasury.isEmergencyPaused());
        assertTrue(treasury.authorizedCollector(collector));
    }

    function test_rejectZeroGovernance() public {
        vm.expectRevert(IZenithTreasury.ZeroAddress.selector);
        new ZenithTreasury(address(0));
    }

    function test_depositERC20Fee_authorized() public {
        uint256 feeAmount = 100 ether;

        vm.startPrank(collector);
        token.approve(address(treasury), feeAmount);
        treasury.depositERC20Fee(address(token), feeAmount);
        vm.stopPrank();

        assertEq(treasury.getTreasuryBalance(address(token)), feeAmount);
        assertEq(treasury.getCollectedFees(address(token)), feeAmount);
        assertEq(token.balanceOf(address(treasury)), feeAmount);
    }

    function test_depositERC20Fee_unauthorized_reverts() public {
        token.mint(user, 100 ether);

        vm.startPrank(user);
        token.approve(address(treasury), 50 ether);
        vm.expectRevert(abi.encodeWithSelector(IZenithTreasury.UnauthorizedCollector.selector, user));
        treasury.depositERC20Fee(address(token), 50 ether);
        vm.stopPrank();
    }

    function test_depositNativeFee_authorized() public {
        vm.deal(collector, 10 ether);

        vm.prank(collector);
        treasury.depositNativeFee{value: 2 ether}();

        assertEq(treasury.getTreasuryBalance(address(0)), 2 ether);
        assertEq(treasury.getCollectedFees(address(0)), 2 ether);
        assertEq(address(treasury).balance, 2 ether);
    }

    function test_depositNativeFee_unauthorized_reverts() public {
        vm.deal(user, 10 ether);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(IZenithTreasury.UnauthorizedCollector.selector, user));
        treasury.depositNativeFee{value: 1 ether}();
    }

    function test_directNativeTransfer_doesNotIncrementFees() public {
        vm.deal(user, 10 ether);

        vm.prank(user);
        (bool ok, ) = address(treasury).call{value: 3 ether}("");
        assertTrue(ok);

        assertEq(address(treasury).balance, 3 ether);
        assertEq(treasury.getTreasuryBalance(address(0)), 3 ether);

        assertEq(treasury.getCollectedFees(address(0)), 0);
    }

    function test_treasuryBalanceAccounting() public {
        assertEq(treasury.getTreasuryBalance(address(token)), 0);
        assertEq(treasury.getTreasuryBalance(address(0)), 0);

        vm.startPrank(collector);
        token.approve(address(treasury), 500 ether);
        treasury.depositERC20Fee(address(token), 500 ether);
        vm.stopPrank();

        assertEq(treasury.getTreasuryBalance(address(token)), 500 ether);
    }

    function test_historicalFeeAccounting_persistsAfterWithdrawal() public {
        vm.startPrank(collector);
        token.approve(address(treasury), 500 ether);
        treasury.depositERC20Fee(address(token), 500 ether);
        vm.stopPrank();

        assertEq(treasury.getCollectedFees(address(token)), 500 ether);

        vm.prank(governance);
        treasury.withdraw(address(token), payable(recipient), 300 ether);

        assertEq(treasury.getTreasuryBalance(address(token)), 200 ether);

        assertEq(treasury.getCollectedFees(address(token)), 500 ether);
    }

    function test_withdraw_governance() public {
        vm.startPrank(collector);
        token.approve(address(treasury), 100 ether);
        treasury.depositERC20Fee(address(token), 100 ether);
        vm.stopPrank();

        vm.prank(governance);
        treasury.withdraw(address(token), payable(recipient), 60 ether);

        assertEq(token.balanceOf(recipient), 60 ether);
        assertEq(treasury.getTreasuryBalance(address(token)), 40 ether);
    }

    function test_withdraw_unauthorized_reverts() public {
        vm.startPrank(collector);
        token.approve(address(treasury), 100 ether);
        treasury.depositERC20Fee(address(token), 100 ether);
        vm.stopPrank();

        vm.prank(user);
        vm.expectRevert(IZenithTreasury.OnlyGovernance.selector);
        treasury.withdraw(address(token), payable(recipient), 50 ether);
    }

    function test_twoStepGovernanceTransfer() public {
        vm.prank(governance);
        treasury.transferGovernance(pendingGov);

        assertEq(treasury.governance(), governance);
        assertEq(treasury.pendingGovernance(), pendingGov);

        vm.prank(pendingGov);
        treasury.acceptGovernance();

        assertEq(treasury.governance(), pendingGov);
        assertEq(treasury.pendingGovernance(), address(0));
    }

    function test_unauthorizedGovernanceTransfer_reverts() public {
        vm.prank(user);
        vm.expectRevert(IZenithTreasury.OnlyGovernance.selector);
        treasury.transferGovernance(user);

        vm.prank(governance);
        treasury.transferGovernance(pendingGov);

        vm.prank(user);
        vm.expectRevert(IZenithTreasury.NotPendingGovernance.selector);
        treasury.acceptGovernance();
    }

    function test_emergencyPause() public {
        vm.prank(governance);
        treasury.setEmergencyPause(true);
        assertTrue(treasury.isEmergencyPaused());

        vm.prank(governance);
        treasury.setEmergencyPause(false);
        assertFalse(treasury.isEmergencyPaused());
    }

    function test_operationsWhilePaused_revert() public {
        vm.prank(governance);
        treasury.setEmergencyPause(true);

        vm.startPrank(collector);
        token.approve(address(treasury), 100 ether);
        vm.expectRevert(IZenithTreasury.ProtocolPaused.selector);
        treasury.depositERC20Fee(address(token), 100 ether);
        vm.stopPrank();

        vm.prank(governance);
        vm.expectRevert(IZenithTreasury.ProtocolPaused.selector);
        treasury.withdraw(address(token), payable(recipient), 10 ether);
    }

    function test_rescueToken() public {
        token.mint(address(treasury), 250 ether);

        vm.prank(governance);
        treasury.rescueToken(address(token), payable(recipient), 250 ether);

        assertEq(token.balanceOf(recipient), 250 ether);
    }
}
