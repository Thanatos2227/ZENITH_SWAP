// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/ZenithCircuitBreaker.sol";
import "../src/treasury/ZenithTreasury.sol";
import "../src/treasury/ZenithFeeController.sol";
import "../src/ZenithCrossChainRouter.sol";
import "../src/interfaces/IERC20.sol";

contract MockUSDT is IERC20 {
    string public name = "Mock USDT";
    string public symbol = "USDT";
    uint8 public decimals = 6;
    uint256 public override totalSupply;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        require(balanceOf[msg.sender] >= amount, "ERC20: Insufficient balance");
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
        require(balanceOf[from] >= amount, "ERC20: Insufficient balance");
        if (allowance[from][msg.sender] != type(uint256).max) {
            require(allowance[from][msg.sender] >= amount, "ERC20: Insufficient allowance");
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract ZenithCrossChainRouterTest is Test {
    ZenithCircuitBreaker public circuitBreaker;
    ZenithTreasury public treasury;
    ZenithFeeController public feeController;
    ZenithCrossChainRouter public crossChainRouter;
    MockUSDT public mockUsdt;

    address public governance = address(0x1000);
    address public guardian = address(0x2000);
    address public user = address(0x4000);
    address public solver = address(0x5000);
    address public recipient = address(0x6000);

    function setUp() public {
        circuitBreaker = new ZenithCircuitBreaker(governance, guardian);
        treasury = new ZenithTreasury(governance);
        feeController = new ZenithFeeController(governance, address(treasury));

        crossChainRouter = new ZenithCrossChainRouter(
            address(treasury),
            address(feeController),
            address(circuitBreaker),
            address(0)
        );

        vm.prank(governance);
        treasury.setFeeCollector(address(crossChainRouter), true);

        mockUsdt = new MockUSDT();
        mockUsdt.mint(user, 1000 * 10**6);
        mockUsdt.mint(solver, 1000 * 10**6);
        vm.deal(user, 100 ether);
        vm.deal(solver, 100 ether);
    }

    function testInitiateNativeCrossChainSwap() public {
        vm.startPrank(user);
        uint256 amountIn = 1 ether;
        uint256 minOut = 950 * 10**6;
        uint256 deadline = block.timestamp + 3600;
        uint256 nonce = 1;

        IZenithCrossChainRouter.InitiateCrossChainParams memory params = IZenithCrossChainRouter.InitiateCrossChainParams({
            destinationChain: "ethereum",
            sourceToken: address(0),
            destinationToken: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
            amountIn: amountIn,
            minAmountOut: minOut,
            recipient: recipient,
            deadline: deadline,
            nonce: nonce
        });

        bytes32 orderId = crossChainRouter.initiateCrossChainSwap{value: amountIn}(params);
        vm.stopPrank();

        assertTrue(orderId != bytes32(0));
        IZenithCrossChainRouter.CrossChainOrder memory order = crossChainRouter.getOrder(orderId);
        assertEq(order.user, user);
        assertEq(order.recipient, recipient);
        assertEq(order.amountIn, amountIn - order.feePaid);
        assertEq(address(treasury).balance, order.feePaid);
    }

    function testInitiateERC20CrossChainSwap() public {
        vm.startPrank(user);
        uint256 amountIn = 100 * 10**6;
        uint256 minOut = 99 * 10**6;
        uint256 deadline = block.timestamp + 3600;
        uint256 nonce = 2;

        mockUsdt.approve(address(crossChainRouter), amountIn);

        IZenithCrossChainRouter.InitiateCrossChainParams memory params = IZenithCrossChainRouter.InitiateCrossChainParams({
            destinationChain: "ethereum",
            sourceToken: address(mockUsdt),
            destinationToken: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
            amountIn: amountIn,
            minAmountOut: minOut,
            recipient: recipient,
            deadline: deadline,
            nonce: nonce
        });

        bytes32 orderId = crossChainRouter.initiateCrossChainSwap(params);
        vm.stopPrank();

        assertTrue(orderId != bytes32(0));
        IZenithCrossChainRouter.CrossChainOrder memory order = crossChainRouter.getOrder(orderId);
        assertEq(order.sourceToken, address(mockUsdt));
        assertEq(order.user, user);
        assertEq(mockUsdt.balanceOf(address(treasury)), order.feePaid);
    }

    function testFulfillCrossChainOrder() public {
        bytes32 mockOrderId = keccak256("ORDER_123");
        uint256 fillAmount = 99 * 10**6;

        vm.startPrank(solver);
        mockUsdt.approve(address(crossChainRouter), fillAmount);

        crossChainRouter.fulfillCrossChainOrder(
            IZenithCrossChainRouter.FulfillCrossChainParams({
                orderId: mockOrderId,
                recipient: recipient,
                outputToken: address(mockUsdt),
                outputAmount: fillAmount
            })
        );
        vm.stopPrank();

        assertTrue(crossChainRouter.isOrderFulfilled(mockOrderId));
        assertEq(mockUsdt.balanceOf(recipient), fillAmount);
    }

    function testRefundExpiredOrder() public {
        vm.startPrank(user);
        uint256 amountIn = 50 * 10**6;
        mockUsdt.approve(address(crossChainRouter), amountIn);

        uint256 deadline = block.timestamp + 100;
        IZenithCrossChainRouter.InitiateCrossChainParams memory params = IZenithCrossChainRouter.InitiateCrossChainParams({
            destinationChain: "ethereum",
            sourceToken: address(mockUsdt),
            destinationToken: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
            amountIn: amountIn,
            minAmountOut: 49 * 10**6,
            recipient: recipient,
            deadline: deadline,
            nonce: 99
        });

        bytes32 orderId = crossChainRouter.initiateCrossChainSwap(params);
        vm.stopPrank();

        // Warp time past deadline
        vm.warp(block.timestamp + 200);

        uint256 userBalBefore = mockUsdt.balanceOf(user);
        crossChainRouter.refundExpiredOrder(orderId);
        uint256 userBalAfter = mockUsdt.balanceOf(user);

        assertTrue(crossChainRouter.isOrderRefunded(orderId));
        assertTrue(userBalAfter > userBalBefore);
    }
}
