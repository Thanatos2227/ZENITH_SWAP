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

contract MockMaliciousToken is IERC20 {
    function totalSupply() external pure override returns (uint256) { return 1000000; }
    function balanceOf(address) external pure override returns (uint256) { return 1000000; }
    function allowance(address, address) external pure override returns (uint256) { return type(uint256).max; }
    function approve(address, uint256) external pure override returns (bool) { return true; }
    function transfer(address, uint256) external pure override returns (bool) { return false; }
    function transferFrom(address, address, uint256) external pure override returns (bool) { return false; }
}

contract ZenithCrossChainRouterTest is Test {
    ZenithCircuitBreaker public circuitBreaker;
    ZenithTreasury public treasury;
    ZenithFeeController public feeController;
    ZenithCrossChainRouter public crossChainRouter;
    MockUSDT public mockUsdt;
    MockMaliciousToken public maliciousToken;

    address public governance = address(0x1000);
    address public guardian = address(0x2000);
    address public user = address(0x4000);
    address public solver = address(0x5000);
    address public recipient = address(0x6000);
    address public attacker = address(0x9999);

    function setUp() public {
        circuitBreaker = new ZenithCircuitBreaker(governance, guardian);
        treasury = new ZenithTreasury(governance);
        feeController = new ZenithFeeController(governance, address(treasury));

        crossChainRouter = new ZenithCrossChainRouter(
            governance,
            address(treasury),
            address(feeController),
            address(circuitBreaker),
            address(0)
        );

        vm.startPrank(governance);
        treasury.setFeeCollector(address(crossChainRouter), true);
        crossChainRouter.setSolverAuthorization(solver, true);
        vm.stopPrank();

        mockUsdt = new MockUSDT();
        maliciousToken = new MockMaliciousToken();
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

    function testFulfillCrossChainOrderLegitimate() public {
        vm.startPrank(user);
        uint256 amountIn = 100 * 10**6;
        uint256 minOut = 99 * 10**6;
        uint256 deadline = block.timestamp + 3600;
        uint256 nonce = 10;

        mockUsdt.approve(address(crossChainRouter), amountIn);

        bytes32 orderId = crossChainRouter.initiateCrossChainSwap(
            IZenithCrossChainRouter.InitiateCrossChainParams({
                destinationChain: "ethereum",
                sourceToken: address(mockUsdt),
                destinationToken: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
                amountIn: amountIn,
                minAmountOut: minOut,
                recipient: recipient,
                deadline: deadline,
                nonce: nonce
            })
        );
        vm.stopPrank();

        uint256 fillAmount = 99 * 10**6;
        vm.startPrank(solver);
        mockUsdt.approve(address(crossChainRouter), fillAmount);

        crossChainRouter.fulfillCrossChainOrder(
            IZenithCrossChainRouter.FulfillCrossChainParams({
                orderId: orderId,
                recipient: recipient,
                outputToken: address(0xdAC17F958D2ee523a2206206994597C13D831ec7),
                outputAmount: fillAmount
            })
        );
        vm.stopPrank();

        assertTrue(crossChainRouter.isOrderFulfilled(orderId));
    }

    function testCannotFulfillNonExistentOrder() public {
        bytes32 fakeOrderId = keccak256("NON_EXISTENT_ORDER");
        vm.startPrank(solver);
        mockUsdt.approve(address(crossChainRouter), 100);

        vm.expectRevert("ZenithCrossChainRouter: Order does not exist");
        crossChainRouter.fulfillCrossChainOrder(
            IZenithCrossChainRouter.FulfillCrossChainParams({
                orderId: fakeOrderId,
                recipient: recipient,
                outputToken: address(mockUsdt),
                outputAmount: 100
            })
        );
        vm.stopPrank();
    }

    function testCannotFulfillUnauthorizedSolver() public {
        vm.startPrank(user);
        bytes32 orderId = crossChainRouter.initiateCrossChainSwap{value: 1 ether}(
            IZenithCrossChainRouter.InitiateCrossChainParams({
                destinationChain: "ethereum",
                sourceToken: address(0),
                destinationToken: "ETH",
                amountIn: 1 ether,
                minAmountOut: 0.99 ether,
                recipient: recipient,
                deadline: block.timestamp + 3600,
                nonce: 20
            })
        );
        vm.stopPrank();

        vm.deal(attacker, 1 ether);
        vm.startPrank(attacker);
        vm.expectRevert("ZenithCrossChainRouter: Unauthorized solver");
        crossChainRouter.fulfillCrossChainOrder{value: 0.99 ether}(
            IZenithCrossChainRouter.FulfillCrossChainParams({
                orderId: orderId,
                recipient: recipient,
                outputToken: address(0),
                outputAmount: 0.99 ether
            })
        );
        vm.stopPrank();
    }

    function testRevokeSolverAuthorization() public {
        vm.prank(governance);
        crossChainRouter.setSolverAuthorization(solver, false);

        vm.startPrank(user);
        bytes32 orderId = crossChainRouter.initiateCrossChainSwap{value: 1 ether}(
            IZenithCrossChainRouter.InitiateCrossChainParams({
                destinationChain: "ethereum",
                sourceToken: address(0),
                destinationToken: "ETH",
                amountIn: 1 ether,
                minAmountOut: 0.99 ether,
                recipient: recipient,
                deadline: block.timestamp + 3600,
                nonce: 21
            })
        );
        vm.stopPrank();

        vm.startPrank(solver);
        vm.expectRevert("ZenithCrossChainRouter: Unauthorized solver");
        crossChainRouter.fulfillCrossChainOrder{value: 0.99 ether}(
            IZenithCrossChainRouter.FulfillCrossChainParams({
                orderId: orderId,
                recipient: recipient,
                outputToken: address(0),
                outputAmount: 0.99 ether
            })
        );
        vm.stopPrank();
    }

    function testCannotFulfillWithWrongRecipient() public {
        vm.startPrank(user);
        bytes32 orderId = crossChainRouter.initiateCrossChainSwap{value: 1 ether}(
            IZenithCrossChainRouter.InitiateCrossChainParams({
                destinationChain: "ethereum",
                sourceToken: address(0),
                destinationToken: "ETH",
                amountIn: 1 ether,
                minAmountOut: 0.99 ether,
                recipient: recipient,
                deadline: block.timestamp + 3600,
                nonce: 30
            })
        );
        vm.stopPrank();

        vm.startPrank(solver);
        vm.expectRevert("ZenithCrossChainRouter: Recipient mismatch");
        crossChainRouter.fulfillCrossChainOrder{value: 0.99 ether}(
            IZenithCrossChainRouter.FulfillCrossChainParams({
                orderId: orderId,
                recipient: attacker,
                outputToken: address(0),
                outputAmount: 0.99 ether
            })
        );
        vm.stopPrank();
    }

    function testCannotFulfillBelowMinAmountOut() public {
        vm.startPrank(user);
        bytes32 orderId = crossChainRouter.initiateCrossChainSwap{value: 1 ether}(
            IZenithCrossChainRouter.InitiateCrossChainParams({
                destinationChain: "ethereum",
                sourceToken: address(0),
                destinationToken: "ETH",
                amountIn: 1 ether,
                minAmountOut: 0.99 ether,
                recipient: recipient,
                deadline: block.timestamp + 3600,
                nonce: 40
            })
        );
        vm.stopPrank();

        vm.startPrank(solver);
        vm.expectRevert("ZenithCrossChainRouter: Output below minimum");
        crossChainRouter.fulfillCrossChainOrder{value: 0.5 ether}(
            IZenithCrossChainRouter.FulfillCrossChainParams({
                orderId: orderId,
                recipient: recipient,
                outputToken: address(0),
                outputAmount: 0.5 ether
            })
        );
        vm.stopPrank();
    }

    function testCannotFulfillWithWrongDestinationToken() public {
        vm.startPrank(user);
        bytes32 orderId = crossChainRouter.initiateCrossChainSwap{value: 1 ether}(
            IZenithCrossChainRouter.InitiateCrossChainParams({
                destinationChain: "ethereum",
                sourceToken: address(0),
                destinationToken: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
                amountIn: 1 ether,
                minAmountOut: 1000 * 10**6,
                recipient: recipient,
                deadline: block.timestamp + 3600,
                nonce: 50
            })
        );
        vm.stopPrank();

        vm.startPrank(solver);
        vm.expectRevert("ZenithCrossChainRouter: Destination token mismatch");
        crossChainRouter.fulfillCrossChainOrder(
            IZenithCrossChainRouter.FulfillCrossChainParams({
                orderId: orderId,
                recipient: recipient,
                outputToken: address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48), // USDC instead of USDT
                outputAmount: 1000 * 10**6
            })
        );
        vm.stopPrank();
    }

    function testCannotFulfillTwice() public {
        vm.startPrank(user);
        bytes32 orderId = crossChainRouter.initiateCrossChainSwap{value: 1 ether}(
            IZenithCrossChainRouter.InitiateCrossChainParams({
                destinationChain: "ethereum",
                sourceToken: address(0),
                destinationToken: "ETH",
                amountIn: 1 ether,
                minAmountOut: 0.99 ether,
                recipient: recipient,
                deadline: block.timestamp + 3600,
                nonce: 60
            })
        );
        vm.stopPrank();

        vm.startPrank(solver);
        crossChainRouter.fulfillCrossChainOrder{value: 0.99 ether}(
            IZenithCrossChainRouter.FulfillCrossChainParams({
                orderId: orderId,
                recipient: recipient,
                outputToken: address(0),
                outputAmount: 0.99 ether
            })
        );

        vm.expectRevert("ZenithCrossChainRouter: Order already fulfilled");
        crossChainRouter.fulfillCrossChainOrder{value: 0.99 ether}(
            IZenithCrossChainRouter.FulfillCrossChainParams({
                orderId: orderId,
                recipient: recipient,
                outputToken: address(0),
                outputAmount: 0.99 ether
            })
        );
        vm.stopPrank();
    }

    function testCannotRefundFulfilledOrder() public {
        vm.startPrank(user);
        bytes32 orderId = crossChainRouter.initiateCrossChainSwap{value: 1 ether}(
            IZenithCrossChainRouter.InitiateCrossChainParams({
                destinationChain: "ethereum",
                sourceToken: address(0),
                destinationToken: "ETH",
                amountIn: 1 ether,
                minAmountOut: 0.99 ether,
                recipient: recipient,
                deadline: block.timestamp + 100,
                nonce: 70
            })
        );
        vm.stopPrank();

        vm.prank(solver);
        crossChainRouter.fulfillCrossChainOrder{value: 0.99 ether}(
            IZenithCrossChainRouter.FulfillCrossChainParams({
                orderId: orderId,
                recipient: recipient,
                outputToken: address(0),
                outputAmount: 0.99 ether
            })
        );

        vm.warp(block.timestamp + 200);

        vm.expectRevert("ZenithCrossChainRouter: Order already fulfilled");
        crossChainRouter.refundExpiredOrder(orderId);
    }

    function testCannotFulfillExpiredOrder() public {
        vm.startPrank(user);
        bytes32 orderId = crossChainRouter.initiateCrossChainSwap{value: 1 ether}(
            IZenithCrossChainRouter.InitiateCrossChainParams({
                destinationChain: "ethereum",
                sourceToken: address(0),
                destinationToken: "ETH",
                amountIn: 1 ether,
                minAmountOut: 0.99 ether,
                recipient: recipient,
                deadline: block.timestamp + 100,
                nonce: 80
            })
        );
        vm.stopPrank();

        vm.warp(block.timestamp + 200);

        vm.startPrank(solver);
        vm.expectRevert("ZenithCrossChainRouter: Order deadline expired");
        crossChainRouter.fulfillCrossChainOrder{value: 0.99 ether}(
            IZenithCrossChainRouter.FulfillCrossChainParams({
                orderId: orderId,
                recipient: recipient,
                outputToken: address(0),
                outputAmount: 0.99 ether
            })
        );
        vm.stopPrank();
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

        vm.warp(block.timestamp + 200);

        uint256 userBalBefore = mockUsdt.balanceOf(user);
        crossChainRouter.refundExpiredOrder(orderId);
        uint256 userBalAfter = mockUsdt.balanceOf(user);

        assertTrue(crossChainRouter.isOrderRefunded(orderId));
        assertTrue(userBalAfter > userBalBefore);
    }

    function testCannotRefundBeforeDeadline() public {
        vm.startPrank(user);
        bytes32 orderId = crossChainRouter.initiateCrossChainSwap{value: 1 ether}(
            IZenithCrossChainRouter.InitiateCrossChainParams({
                destinationChain: "ethereum",
                sourceToken: address(0),
                destinationToken: "ETH",
                amountIn: 1 ether,
                minAmountOut: 0.99 ether,
                recipient: recipient,
                deadline: block.timestamp + 3600,
                nonce: 100
            })
        );
        vm.stopPrank();

        vm.expectRevert("ZenithCrossChainRouter: Deadline not passed");
        crossChainRouter.refundExpiredOrder(orderId);
    }

    function testCannotReuseNonce() public {
        vm.startPrank(user);
        crossChainRouter.initiateCrossChainSwap{value: 1 ether}(
            IZenithCrossChainRouter.InitiateCrossChainParams({
                destinationChain: "ethereum",
                sourceToken: address(0),
                destinationToken: "ETH",
                amountIn: 1 ether,
                minAmountOut: 0.99 ether,
                recipient: recipient,
                deadline: block.timestamp + 3600,
                nonce: 101
            })
        );

        vm.expectRevert("ZenithCrossChainRouter: Nonce already used");
        crossChainRouter.initiateCrossChainSwap{value: 1 ether}(
            IZenithCrossChainRouter.InitiateCrossChainParams({
                destinationChain: "ethereum",
                sourceToken: address(0),
                destinationToken: "ETH",
                amountIn: 1 ether,
                minAmountOut: 0.99 ether,
                recipient: recipient,
                deadline: block.timestamp + 3600,
                nonce: 101
            })
        );
        vm.stopPrank();
    }

    function testDifferentUserSameNonceAllowed() public {
        vm.prank(user);
        bytes32 order1 = crossChainRouter.initiateCrossChainSwap{value: 1 ether}(
            IZenithCrossChainRouter.InitiateCrossChainParams({
                destinationChain: "ethereum",
                sourceToken: address(0),
                destinationToken: "ETH",
                amountIn: 1 ether,
                minAmountOut: 0.99 ether,
                recipient: recipient,
                deadline: block.timestamp + 3600,
                nonce: 102
            })
        );

        vm.deal(attacker, 10 ether);
        vm.prank(attacker);
        bytes32 order2 = crossChainRouter.initiateCrossChainSwap{value: 1 ether}(
            IZenithCrossChainRouter.InitiateCrossChainParams({
                destinationChain: "arbitrum",
                sourceToken: address(0),
                destinationToken: "ETH",
                amountIn: 1 ether,
                minAmountOut: 0.99 ether,
                recipient: recipient,
                deadline: block.timestamp + 3600,
                nonce: 102
            })
        );

        assertTrue(order1 != order2);
    }
}
