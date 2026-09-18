pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/router/ZenithRouter.sol";
import "../src/treasury/ZenithTreasury.sol";
import "../src/treasury/ZenithFeeController.sol";
import "../src/v1/ZenithV1Factory.sol";
import "../src/v1/ZenithV1Router.sol";
import "../src/v2/ZenithV2Factory.sol";
import "../src/v2/ZenithV2Router.sol";
import "../src/v3/ZenithV3Factory.sol";
import "../src/v3/ZenithV3PositionManager.sol";
import "../src/v3/ZenithV3Router.sol";
import "../src/interfaces/IERC20.sol";
import "../src/interfaces/IWETH9.sol";

contract MockERC20Router is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public override totalSupply;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

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

contract MockWETHRouter is IWETH9, MockERC20Router {
    constructor() MockERC20Router("Wrapped Ether", "WETH", 18) {}

    function deposit() external payable override {
        totalSupply += msg.value;
        balanceOf[msg.sender] += msg.value;
        emit Transfer(address(0), msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external override {
        require(balanceOf[msg.sender] >= amount, "WETH: Insufficient balance");
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "WETH: ETH transfer failed");
    }
}

contract ZenithRouterTest is Test {
    ZenithTreasury public treasury;
    ZenithFeeController public feeController;
    ZenithV1Factory public v1Factory;
    ZenithV1Router public v1Router;
    ZenithV2Factory public v2Factory;
    ZenithV2Router public v2Router;
    ZenithV3Factory public v3Factory;
    ZenithV3Router public v3Router;
    ZenithV3PositionManager public v3PositionManager;
    ZenithRouter public unifiedRouter;

    MockWETHRouter public weth;
    MockERC20Router public tokenA;
    MockERC20Router public tokenB;

    address public governance = address(0x1000);
    address public alice = address(0x2000);
    address public bob = address(0x3000);

    function setUp() public {
        weth = new MockWETHRouter();
        treasury = new ZenithTreasury(governance);
        feeController = new ZenithFeeController(governance, address(treasury));

        v1Factory = new ZenithV1Factory(governance, address(treasury));
        v1Router = new ZenithV1Router(address(v1Factory), address(weth));

        v2Factory = new ZenithV2Factory(governance, address(feeController), address(treasury));
        v2Router = new ZenithV2Router(address(v2Factory), address(weth));

        v3Factory = new ZenithV3Factory(governance);
        v3Router = new ZenithV3Router(address(v3Factory), address(weth));
        v3PositionManager = new ZenithV3PositionManager(address(v3Factory), address(weth));

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
        treasury.setAuthorizedCollector(address(unifiedRouter), true);

        tokenA = new MockERC20Router("Token A", "TKNA", 18);
        tokenB = new MockERC20Router("Token B", "TKNB", 18);

        tokenA.mint(alice, 1_000_000 ether);
        tokenB.mint(alice, 1_000_000 ether);
        tokenA.mint(bob, 10_000 ether);
    }

    function test_UnifiedRouterSwapV1() public {
        vm.startPrank(alice);
        tokenA.approve(address(v1Router), type(uint256).max);
        tokenB.approve(address(v1Router), type(uint256).max);
        v1Router.addLiquidity(
            address(tokenA),
            address(tokenB),
            100_000 ether,
            100_000 ether,
            0,
            0,
            alice,
            block.timestamp + 1 hours
        );
        vm.stopPrank();

        vm.startPrank(bob);
        tokenA.approve(address(unifiedRouter), type(uint256).max);

        uint256 bobBBefore = tokenB.balanceOf(bob);
        uint256 amountOut = unifiedRouter.swap(
            ZenithRouter.SwapParams({
                protocol: ZenithRouter.ProtocolTier.ZENITH_V1,
                tokenIn: address(tokenA),
                tokenOut: address(tokenB),
                feeTier: 0,
                amountIn: 1_000 ether,
                amountOutMinimum: 0,
                recipient: bob,
                deadline: block.timestamp + 1 hours
            })
        );
        vm.stopPrank();

        uint256 bobBAfter = tokenB.balanceOf(bob);
        assertEq(bobBAfter - bobBBefore, amountOut);
        assertTrue(amountOut > 0);

        uint256 treasuryFeeBalance = tokenA.balanceOf(address(treasury));
        assertTrue(treasuryFeeBalance > 0);
    }
}
