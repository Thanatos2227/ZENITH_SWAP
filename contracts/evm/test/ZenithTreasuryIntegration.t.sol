pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/treasury/ZenithTreasury.sol";
import "../src/treasury/ZenithFeeController.sol";
import "../src/v1/ZenithV1Factory.sol";
import "../src/v1/ZenithV1Router.sol";
import "../src/v2/ZenithV2Factory.sol";
import "../src/v2/ZenithV2Router.sol";
import "../src/v3/ZenithV3Factory.sol";
import "../src/v3/ZenithV3Router.sol";
import "../src/router/ZenithRouter.sol";
import "../src/interfaces/IERC20.sol";
import "../src/interfaces/IWETH9.sol";

contract MockWETH is IWETH9 {
    string public name = "Wrapped Ether";
    string public symbol = "WETH";
    uint8 public decimals = 18;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    function deposit() public payable override {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) public override {
        require(balanceOf[msg.sender] >= amount, "INSUFFICIENT_WETH");
        balanceOf[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "ETH_TRANSFER_FAILED");
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        require(balanceOf[msg.sender] >= amount, "INSUFFICIENT_BALANCE");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) public override returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        require(balanceOf[from] >= amount, "INSUFFICIENT_BALANCE");
        if (allowance[from][msg.sender] != type(uint256).max) {
            require(allowance[from][msg.sender] >= amount, "INSUFFICIENT_ALLOWANCE");
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract IntegrationMockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public override totalSupply;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

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

contract ZenithTreasuryIntegrationTest is Test {
    ZenithTreasury public treasury;
    ZenithFeeController public feeController;

    MockWETH public weth;
    IntegrationMockERC20 public tokenA;
    IntegrationMockERC20 public tokenB;

    ZenithV1Factory public v1Factory;
    ZenithV1Router public v1Router;

    ZenithV2Factory public v2Factory;
    ZenithV2Router public v2Router;

    ZenithV3Factory public v3Factory;
    ZenithV3Router public v3Router;

    ZenithRouter public unifiedRouter;

    address public governance = address(0x1111);
    address public alice = address(0xAAAA);
    address public bob = address(0xBBBB);

    function setUp() public {
        weth = new MockWETH();
        tokenA = new IntegrationMockERC20("Token A", "TKNA");
        tokenB = new IntegrationMockERC20("Token B", "TKNB");

        treasury = new ZenithTreasury(governance);

        feeController = new ZenithFeeController(governance, address(treasury));

        v1Factory = new ZenithV1Factory(governance, address(treasury));
        v1Router = new ZenithV1Router(address(v1Factory), address(weth));

        v2Factory = new ZenithV2Factory(governance, address(feeController), address(treasury));
        v2Router = new ZenithV2Router(address(v2Factory), address(weth));

        v3Factory = new ZenithV3Factory(governance, address(feeController));
        v3Router = new ZenithV3Router(address(v3Factory), address(weth));

        unifiedRouter = new ZenithRouter(
            governance,
            address(weth),
            address(treasury),
            address(feeController),
            address(v1Router),
            address(v2Router),
            address(v3Router)
        );

        vm.prank(governance);
        treasury.setFeeCollector(address(unifiedRouter), true);

        tokenA.mint(address(this), 1_000_000 ether);
        tokenB.mint(address(this), 1_000_000 ether);
        tokenA.approve(address(v1Router), type(uint256).max);
        tokenB.approve(address(v1Router), type(uint256).max);

        v1Router.addLiquidity(
            address(tokenA),
            address(tokenB),
            100_000 ether,
            100_000 ether,
            0,
            0,
            address(this),
            block.timestamp + 1000
        );

        tokenA.mint(alice, 10_000 ether);
    }

    function test_unifiedRouter_swap_collectsProtocolFeeToTreasury() public {
        uint256 swapIn = 1_000 ether;
        uint256 protocolFeeBps = feeController.protocolFeeBps();
        uint256 expectedProtocolFee = (swapIn * protocolFeeBps) / 10000;

        vm.startPrank(alice);
        tokenA.approve(address(unifiedRouter), swapIn);

        uint256 amountOut = unifiedRouter.swap(
            ZenithRouter.SwapParams({
                protocol: ZenithRouter.ProtocolTier.ZENITH_V1,
                tokenIn: address(tokenA),
                tokenOut: address(tokenB),
                feeTier: 30,
                amountIn: swapIn,
                amountOutMinimum: 1 ether,
                recipient: alice,
                deadline: block.timestamp + 100
            })
        );
        vm.stopPrank();

        assertTrue(amountOut > 0, "Alice must receive output tokenB");
        assertEq(tokenB.balanceOf(alice), amountOut);

        assertEq(tokenA.balanceOf(address(treasury)), expectedProtocolFee, "Treasury balance must equal protocol fee");
        assertEq(treasury.getCollectedFees(address(tokenA)), expectedProtocolFee, "Treasury cumulative accounting updated");

        assertEq(tokenA.balanceOf(alice), 10_000 ether - swapIn);
    }

    function test_userSwapPrincipal_notCustodiedInTreasury() public {
        uint256 swapIn = 5_000 ether;
        uint256 protocolFee = (swapIn * 5) / 10000;

        vm.startPrank(alice);
        tokenA.approve(address(unifiedRouter), swapIn);
        unifiedRouter.swap(
            ZenithRouter.SwapParams({
                protocol: ZenithRouter.ProtocolTier.ZENITH_V1,
                tokenIn: address(tokenA),
                tokenOut: address(tokenB),
                feeTier: 30,
                amountIn: swapIn,
                amountOutMinimum: 1 ether,
                recipient: alice,
                deadline: block.timestamp + 100
            })
        );
        vm.stopPrank();

        assertEq(tokenA.balanceOf(address(treasury)), protocolFee);
        assertTrue(tokenA.balanceOf(address(treasury)) < swapIn);
    }

    function test_slippageProtection_reverts() public {
        uint256 swapIn = 1_000 ether;

        vm.startPrank(alice);
        tokenA.approve(address(unifiedRouter), swapIn);

        vm.expectRevert();
        unifiedRouter.swap(
            ZenithRouter.SwapParams({
                protocol: ZenithRouter.ProtocolTier.ZENITH_V1,
                tokenIn: address(tokenA),
                tokenOut: address(tokenB),
                feeTier: 30,
                amountIn: swapIn,
                amountOutMinimum: 50_000 ether,
                recipient: alice,
                deadline: block.timestamp + 100
            })
        );
        vm.stopPrank();
    }

    function test_expiredDeadline_reverts() public {
        vm.startPrank(alice);
        tokenA.approve(address(unifiedRouter), 100 ether);

        vm.warp(block.timestamp + 500);

        vm.expectRevert("ZenithRouter: EXPIRED");
        unifiedRouter.swap(
            ZenithRouter.SwapParams({
                protocol: ZenithRouter.ProtocolTier.ZENITH_V1,
                tokenIn: address(tokenA),
                tokenOut: address(tokenB),
                feeTier: 30,
                amountIn: 100 ether,
                amountOutMinimum: 1 ether,
                recipient: alice,
                deadline: block.timestamp - 1
            })
        );
        vm.stopPrank();
    }

    function test_zeroAmountAndRecipient_revert() public {
        vm.startPrank(alice);
        vm.expectRevert("ZenithRouter: ZERO_AMOUNT_IN");
        unifiedRouter.swap(
            ZenithRouter.SwapParams({
                protocol: ZenithRouter.ProtocolTier.ZENITH_V1,
                tokenIn: address(tokenA),
                tokenOut: address(tokenB),
                feeTier: 30,
                amountIn: 0,
                amountOutMinimum: 0,
                recipient: alice,
                deadline: block.timestamp + 100
            })
        );

        vm.expectRevert("ZenithRouter: ZERO_RECIPIENT");
        unifiedRouter.swap(
            ZenithRouter.SwapParams({
                protocol: ZenithRouter.ProtocolTier.ZENITH_V1,
                tokenIn: address(tokenA),
                tokenOut: address(tokenB),
                feeTier: 30,
                amountIn: 100 ether,
                amountOutMinimum: 1 ether,
                recipient: address(0),
                deadline: block.timestamp + 100
            })
        );
        vm.stopPrank();
    }
}
