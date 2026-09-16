pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/v1/ZenithV1Factory.sol";
import "../src/v1/ZenithV1Pair.sol";
import "../src/v1/ZenithV1Router.sol";
import "../src/treasury/ZenithTreasury.sol";
import "../src/interfaces/IERC20.sol";
import "../src/interfaces/IWETH9.sol";

contract MockERC20 is IERC20 {
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

contract MockWETH is IWETH9, MockERC20 {
    constructor() MockERC20("Wrapped Ether", "WETH", 18) {}

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

contract ZenithV1Test is Test {
    ZenithTreasury public treasury;
    ZenithV1Factory public factory;
    ZenithV1Router public router;
    MockWETH public weth;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockERC20 public tokenC;

    address public governance = address(0x1000);
    address public alice = address(0x2000);
    address public bob = address(0x3000);

    function setUp() public {
        treasury = new ZenithTreasury(governance);
        factory = new ZenithV1Factory(governance, address(treasury));
        weth = new MockWETH();
        router = new ZenithV1Router(address(factory), address(weth));

        tokenA = new MockERC20("Token A", "TKNA", 18);
        tokenB = new MockERC20("Token B", "TKNB", 18);
        tokenC = new MockERC20("Token C", "TKNC", 18);

        tokenA.mint(alice, 1_000_000 ether);
        tokenB.mint(alice, 1_000_000 ether);
        tokenC.mint(alice, 1_000_000 ether);
        tokenA.mint(bob, 10_000 ether);
    }

    function test_CreatePair() public {
        address pair = factory.createPair(address(tokenA), address(tokenB));
        assertFalse(pair == address(0));
        assertEq(factory.getPair(address(tokenA), address(tokenB)), pair);
        assertEq(factory.getPair(address(tokenB), address(tokenA)), pair);
        assertEq(factory.allPairsLength(), 1);
    }

    function test_AddLiquidityAndMintLP() public {
        vm.startPrank(alice);
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);

        (uint256 amountA, uint256 amountB, uint256 liquidity) = router.addLiquidity(
            address(tokenA),
            address(tokenB),
            100_000 ether,
            200_000 ether,
            90_000 ether,
            190_000 ether,
            alice,
            block.timestamp + 1 hours
        );
        vm.stopPrank();

        assertEq(amountA, 100_000 ether);
        assertEq(amountB, 200_000 ether);
        assertTrue(liquidity > 0);

        address pair = factory.getPair(address(tokenA), address(tokenB));
        (uint112 r0, uint112 r1, ) = ZenithV1Pair(pair).getReserves();
        assertTrue(r0 > 0 && r1 > 0);
    }

    function test_SwapExactTokensForTokens() public {
        vm.startPrank(alice);
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);
        router.addLiquidity(
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
        tokenA.approve(address(router), type(uint256).max);
        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        uint256 bobBBefore = tokenB.balanceOf(bob);
        uint256[] memory amounts = router.swapExactTokensForTokens(
            1_000 ether,
            0,
            path,
            bob,
            block.timestamp + 1 hours
        );
        vm.stopPrank();

        uint256 bobBAfter = tokenB.balanceOf(bob);
        assertEq(bobBAfter - bobBBefore, amounts[1]);
        assertTrue(amounts[1] > 0);
        assertTrue(amounts[1] < 1_000 ether);
    }

    function test_MultiHopSwap() public {
        vm.startPrank(alice);
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);
        tokenC.approve(address(router), type(uint256).max);

        router.addLiquidity(address(tokenA), address(tokenB), 100_000 ether, 100_000 ether, 0, 0, alice, block.timestamp + 1 hours);
        router.addLiquidity(address(tokenB), address(tokenC), 100_000 ether, 100_000 ether, 0, 0, alice, block.timestamp + 1 hours);
        vm.stopPrank();

        vm.startPrank(bob);
        tokenA.approve(address(router), type(uint256).max);
        address[] memory path = new address[](3);
        path[0] = address(tokenA);
        path[1] = address(tokenB);
        path[2] = address(tokenC);

        uint256[] memory amounts = router.swapExactTokensForTokens(
            1_000 ether,
            0,
            path,
            bob,
            block.timestamp + 1 hours
        );
        vm.stopPrank();

        assertEq(tokenC.balanceOf(bob), amounts[2]);
        assertTrue(amounts[2] > 0);
    }

    function test_RemoveLiquidity() public {
        vm.startPrank(alice);
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);

        (, , uint256 liquidity) = router.addLiquidity(
            address(tokenA),
            address(tokenB),
            10_000 ether,
            10_000 ether,
            0,
            0,
            alice,
            block.timestamp + 1 hours
        );

        address pair = factory.getPair(address(tokenA), address(tokenB));
        ZenithV1Pair(pair).approve(address(router), liquidity);

        (uint256 amountA, uint256 amountB) = router.removeLiquidity(
            address(tokenA),
            address(tokenB),
            liquidity,
            0,
            0,
            alice,
            block.timestamp + 1 hours
        );
        vm.stopPrank();

        assertTrue(amountA > 0);
        assertTrue(amountB > 0);
    }
}
