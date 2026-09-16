pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/ZenithCircuitBreaker.sol";
import "../src/ZenithFeeManager.sol";
import "../src/ZenithPoolManager.sol";
import "../src/ZenithPositionNFT.sol";
import "../src/ZenithReactor.sol";
import "../src/ZenithRouter.sol";
import "../src/hooks/DynamicFeeHook.sol";
import "../src/libraries/TickMath.sol";

contract MockERC20 is IERC20 {
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
        require(to != address(0), "MockERC20: ZERO_ADDRESS");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        require(to != address(0), "MockERC20: ZERO_ADDRESS");
        require(balanceOf[msg.sender] >= amount, "MockERC20: INSUFFICIENT_BALANCE");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        require(spender != address(0), "MockERC20: ZERO_ADDRESS");
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        require(from != address(0) && to != address(0), "MockERC20: ZERO_ADDRESS");
        require(balanceOf[from] >= amount, "MockERC20: INSUFFICIENT_BALANCE");
        if (allowance[from][msg.sender] != type(uint256).max) {
            require(allowance[from][msg.sender] >= amount, "MockERC20: INSUFFICIENT_ALLOWANCE");
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract ZenithProtocolTest is Test {
    ZenithCircuitBreaker public circuitBreaker;
    ZenithFeeManager public feeManager;
    ZenithPoolManager public poolManager;
    ZenithPositionNFT public positionNFT;
    ZenithReactor public reactor;
    ZenithRouter public router;
    DynamicFeeHook public dynamicHook;

    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockERC20 public token0;
    MockERC20 public token1;

    address public governance = address(0x1000);
    address public guardian = address(0x2000);
    address public treasury = address(0x3000);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);

    function setUp() public {
        circuitBreaker = new ZenithCircuitBreaker(governance, guardian);
        feeManager = new ZenithFeeManager(governance, treasury);
        poolManager = new ZenithPoolManager(address(circuitBreaker));
        positionNFT = new ZenithPositionNFT(address(poolManager));
        reactor = new ZenithReactor(address(0), address(circuitBreaker));
        router = new ZenithRouter(
            address(feeManager),
            address(circuitBreaker),
            address(0),
            address(0),
            address(poolManager)
        );

        dynamicHook = new DynamicFeeHook(30, 100);

        tokenA = new MockERC20("Token A", "TKNA");
        tokenB = new MockERC20("Token B", "TKNB");

        if (address(tokenA) < address(tokenB)) {
            token0 = tokenA;
            token1 = tokenB;
        } else {
            token0 = tokenB;
            token1 = tokenA;
        }

        token0.mint(alice, 1000000 ether);
        token1.mint(alice, 1000000 ether);
        token0.mint(bob, 1000000 ether);
        token1.mint(bob, 1000000 ether);
    }

    function testPoolInitializationAndLiquidity() public {
        ZenithPoolManager.PoolKey memory key = ZenithPoolManager.PoolKey({
            currency0: address(token0),
            currency1: address(token1),
            feeBps: 30,
            tickSpacing: 60,
            hook: IZenithHook(address(0))
        });

        uint160 sqrtPriceX96 = 79228162514264337593543950336;
        int24 tick = poolManager.initialize(key, sqrtPriceX96, "");
        assertEq(tick, 0);

        vm.startPrank(alice);
        token0.approve(address(positionNFT), 10000 ether);
        token1.approve(address(positionNFT), 10000 ether);

        (uint256 tokenId, uint128 liq, uint256 amt0, uint256 amt1) = positionNFT.mint(
            ZenithPositionNFT.MintParams({
                poolKey: key,
                tickLower: -600,
                tickUpper: 600,
                liquidity: 1000 ether,
                amount0Max: 10000 ether,
                amount1Max: 10000 ether,
                recipient: alice,
                deadline: block.timestamp + 300
            })
        );
        vm.stopPrank();

        assertEq(tokenId, 1);
        assertGt(liq, 0);
        assertGt(amt0, 0);
        assertGt(amt1, 0);
        assertEq(positionNFT.ownerOf(1), alice);

        vm.startPrank(alice);
        (uint256 dec0, uint256 dec1) = positionNFT.decreaseLiquidity(
            ZenithPositionNFT.DecreaseLiquidityParams({
                tokenId: tokenId,
                liquidity: 500 ether,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp + 300
            })
        );
        assertGt(dec0 + dec1, 0);

        (uint256 col0, uint256 col1) = positionNFT.collect(
            ZenithPositionNFT.CollectParams({
                tokenId: tokenId,
                recipient: alice,
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        assertEq(col0, dec0);
        assertEq(col1, dec1);
        vm.stopPrank();
    }

    function testDutchAuctionReactorFill() public {
        uint256 startAmount = 1000 ether;
        uint256 endAmount = 900 ether;

        ZenithReactor.DutchAuctionOrder memory order = ZenithReactor.DutchAuctionOrder({
            user: alice,
            inputToken: address(token0),
            outputToken: address(token1),
            inputAmount: 100 ether,
            startOutputAmount: startAmount,
            endOutputAmount: endAmount,
            decayStartTime: block.timestamp,
            decayEndTime: block.timestamp + 600,
            recipient: alice,
            nonce: 1
        });

        vm.prank(alice);
        token0.approve(address(reactor), 100 ether);

        vm.warp(block.timestamp + 300);
        uint256 expectedOutput = reactor.getRequiredOutput(order);
        assertEq(expectedOutput, 950 ether);

        vm.startPrank(bob);
        token1.approve(address(reactor), expectedOutput);
        uint256 filledOutput = reactor.execute(
            ZenithReactor.SignedOrder({
                order: order,
                signature: ""
            })
        );
        vm.stopPrank();

        assertEq(filledOutput, 950 ether);
        assertEq(token0.balanceOf(bob), 1000100 ether);
    }

    function testDynamicFeeHook() public {
        ZenithPoolManager.PoolKey memory key = ZenithPoolManager.PoolKey({
            currency0: address(token0),
            currency1: address(token1),
            feeBps: 30,
            tickSpacing: 60,
            hook: IZenithHook(address(dynamicHook))
        });

        uint160 sqrtPriceX96 = 79228162514264337593543950336;
        poolManager.initialize(key, sqrtPriceX96, "");

        (bytes4 selector, uint24 feeBps) = dynamicHook.beforeSwap(
            alice,
            poolManager.toPoolId(key),
            true,
            1 ether,
            0,
            ""
        );

        assertEq(selector, dynamicHook.beforeSwap.selector);
        assertEq(feeBps, 30);
    }
}
