pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/v2/ZenithV2Factory.sol";
import "../src/v2/ZenithV2Pool.sol";
import "../src/v2/ZenithV2Router.sol";
import "../src/treasury/ZenithTreasury.sol";
import "../src/treasury/ZenithFeeController.sol";
import "../src/interfaces/IERC20.sol";
import "../src/interfaces/IWETH9.sol";

contract MockERC20V2 is IERC20 {
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

contract MockWETHV2 is IWETH9, MockERC20V2 {
    constructor() MockERC20V2("Wrapped Ether", "WETH", 18) {}

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

contract ZenithV2Test is Test {
    ZenithTreasury public treasury;
    ZenithFeeController public feeController;
    ZenithV2Factory public factory;
    ZenithV2Router public router;
    MockWETHV2 public weth;
    MockERC20V2 public tokenA;
    MockERC20V2 public tokenB;

    address public governance = address(0x1000);
    address public alice = address(0x2000);
    address public bob = address(0x3000);

    function setUp() public {
        treasury = new ZenithTreasury(governance);
        feeController = new ZenithFeeController(governance, address(treasury));
        factory = new ZenithV2Factory(governance, address(feeController), address(treasury));
        weth = new MockWETHV2();
        router = new ZenithV2Router(address(factory), address(weth));

        tokenA = new MockERC20V2("Token A", "TKNA", 18);
        tokenB = new MockERC20V2("Token B", "TKNB", 18);

        tokenA.mint(alice, 1_000_000 ether);
        tokenB.mint(alice, 1_000_000 ether);
        tokenA.mint(bob, 10_000 ether);
    }

    function test_CreatePoolWithTiers() public {
        address pool5 = factory.createPool(address(tokenA), address(tokenB), 5);
        address pool30 = factory.createPool(address(tokenA), address(tokenB), 30);
        address pool100 = factory.createPool(address(tokenA), address(tokenB), 100);

        assertTrue(pool5 != address(0));
        assertTrue(pool30 != address(0));
        assertTrue(pool100 != address(0));
        assertTrue(pool5 != pool30 && pool30 != pool100);

        assertEq(ZenithV2Pool(pool5).fee(), 5);
        assertEq(ZenithV2Pool(pool30).fee(), 30);
        assertEq(ZenithV2Pool(pool100).fee(), 100);
    }

    function test_V2SwapExecution() public {
        factory.createPool(address(tokenA), address(tokenB), 30);

        vm.startPrank(alice);
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);
        router.addLiquidity(
            address(tokenA),
            address(tokenB),
            30,
            100_000 ether,
            100_000 ether,
            0,
            0,
            alice,
            block.timestamp + 1 hours
        );
        vm.stopPrank();

        vm.startPrank(bob);
        tokenA.approve(address(router), type(uint256).max);
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);
        uint24[] memory feePath = new uint24[](1);
        feePath[0] = 30;

        uint256 bobBBefore = tokenB.balanceOf(bob);
        uint256[] memory amounts = router.swapExactTokensForTokens(
            1_000 ether,
            0,
            path,
            feePath,
            bob,
            block.timestamp + 1 hours
        );
        vm.stopPrank();

        uint256 bobBAfter = tokenB.balanceOf(bob);
        assertEq(bobBAfter - bobBBefore, amounts[1]);
        assertTrue(amounts[1] > 0);
    }
}
