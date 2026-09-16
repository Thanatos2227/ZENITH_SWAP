pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/v3/ZenithV3Factory.sol";
import "../src/v3/ZenithV3Pool.sol";
import "../src/v3/ZenithV3PositionManager.sol";
import "../src/v3/ZenithV3Router.sol";
import "../src/treasury/ZenithTreasury.sol";
import "../src/treasury/ZenithFeeController.sol";
import "../src/libraries/TickMath.sol";
import "../src/interfaces/IERC20.sol";
import "../src/interfaces/IWETH9.sol";

contract MockERC20V3 is IERC20 {
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

contract MockWETHV3 is IWETH9, MockERC20V3 {
    constructor() MockERC20V3("Wrapped Ether", "WETH", 18) {}

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

contract ZenithV3Test is Test {
    ZenithTreasury public treasury;
    ZenithFeeController public feeController;
    ZenithV3Factory public factory;
    ZenithV3PositionManager public positionManager;
    ZenithV3Router public router;
    MockWETHV3 public weth;
    MockERC20V3 public token0;
    MockERC20V3 public token1;

    address public governance = address(0x1000);
    address public alice = address(0x2000);
    address public bob = address(0x3000);

    function setUp() public {
        treasury = new ZenithTreasury(governance);
        feeController = new ZenithFeeController(governance, address(treasury));
        factory = new ZenithV3Factory(governance, address(feeController));
        weth = new MockWETHV3();
        positionManager = new ZenithV3PositionManager(address(factory), address(weth));
        router = new ZenithV3Router(address(factory), address(weth));

        MockERC20V3 tokenA = new MockERC20V3("Token A", "TKNA", 18);
        MockERC20V3 tokenB = new MockERC20V3("Token B", "TKNB", 18);

        if (address(tokenA) < address(tokenB)) {
            token0 = tokenA;
            token1 = tokenB;
        } else {
            token0 = tokenB;
            token1 = tokenA;
        }

        token0.mint(alice, 1_000_000 ether);
        token1.mint(alice, 1_000_000 ether);
        token0.mint(bob, 10_000 ether);
    }

    function test_CreateAndInitializeV3Pool() public {
        address pool = factory.createPool(address(token0), address(token1), 3000);
        assertTrue(pool != address(0));

        uint160 initialSqrtPriceX96 = 79228162514264337593543950336; // 1:1 price
        ZenithV3Pool(pool).initialize(initialSqrtPriceX96);

        (uint160 sqrtPriceX96, int24 tick, ) = ZenithV3Pool(pool).slot0();
        assertEq(sqrtPriceX96, initialSqrtPriceX96);
        assertEq(tick, 0);
    }

    function test_MintConcentratedLiquidity() public {
        address pool = factory.createPool(address(token0), address(token1), 3000);
        uint160 initialSqrtPriceX96 = 79228162514264337593543950336;
        ZenithV3Pool(pool).initialize(initialSqrtPriceX96);

        vm.startPrank(alice);
        token0.approve(address(positionManager), type(uint256).max);
        token1.approve(address(positionManager), type(uint256).max);

        (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1) = positionManager.mint(
            ZenithV3PositionManager.MintParams({
                token0: address(token0),
                token1: address(token1),
                fee: 3000,
                tickLower: -600,
                tickUpper: 600,
                amount0Desired: 10_000 ether,
                amount1Desired: 10_000 ether,
                amount0Min: 0,
                amount1Min: 0,
                recipient: alice,
                deadline: block.timestamp + 1 hours
            })
        );
        vm.stopPrank();

        assertEq(tokenId, 1);
        assertTrue(liquidity > 0);
        assertTrue(amount0 > 0);
        assertTrue(amount1 > 0);
    }

    function test_V3SwapWithinAndAcrossTicks() public {
        address pool = factory.createPool(address(token0), address(token1), 3000);
        uint160 initialSqrtPriceX96 = 79228162514264337593543950336;
        ZenithV3Pool(pool).initialize(initialSqrtPriceX96);

        vm.startPrank(alice);
        token0.approve(address(positionManager), type(uint256).max);
        token1.approve(address(positionManager), type(uint256).max);

        positionManager.mint(
            ZenithV3PositionManager.MintParams({
                token0: address(token0),
                token1: address(token1),
                fee: 3000,
                tickLower: -600,
                tickUpper: 600,
                amount0Desired: 100_000 ether,
                amount1Desired: 100_000 ether,
                amount0Min: 0,
                amount1Min: 0,
                recipient: alice,
                deadline: block.timestamp + 1 hours
            })
        );
        vm.stopPrank();

        vm.startPrank(bob);
        token0.approve(address(router), type(uint256).max);

        uint256 amountOut = router.exactInputSingle(
            ZenithV3Router.ExactInputSingleParams({
                tokenIn: address(token0),
                tokenOut: address(token1),
                fee: 3000,
                recipient: bob,
                deadline: block.timestamp + 1 hours,
                amountIn: 100 ether,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
        vm.stopPrank();

        assertTrue(amountOut > 0);
        assertEq(token1.balanceOf(bob), amountOut);
    }
}
