pragma solidity 0.8.24;

import "./ZenithV3Pool.sol";
import "./ZenithV3Factory.sol";
import "../interfaces/IERC20.sol";
import "../interfaces/IWETH9.sol";

contract ZenithV3PositionManager is IZenithV3MintCallback {
    string public constant name = "ZENITH V3 LP Positions";
    string public constant symbol = "ZTH-V3-POS";

    address public immutable factory;
    address public immutable WETH9;

    struct Position {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
    }

    uint256 private _nextId = 1;
    mapping(uint256 => Position) public positions;
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1);

    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "ZenithV3PositionManager: EXPIRED");
        _;
    }

    constructor(address _factory, address _weth9) {
        require(_factory != address(0), "ZenithV3PositionManager: Zero factory");
        require(_weth9 != address(0), "ZenithV3PositionManager: Zero WETH");
        factory = _factory;
        WETH9 = _weth9;
    }

    function zenithV3MintCallback(
        uint256 amount0Owed,
        uint256 amount1Owed,
        bytes calldata data
    ) external override {
        (address token0, address token1, uint24 fee, address payer) = abi.decode(
            data,
            (address, address, uint24, address)
        );
        require(msg.sender == ZenithV3Factory(factory).getPool(token0, token1, fee), "ZenithV3PositionManager: CALLBACK_CALLER");

        if (amount0Owed > 0) _safeTransferFrom(token0, payer, msg.sender, amount0Owed);
        if (amount1Owed > 0) _safeTransferFrom(token1, payer, msg.sender, amount1Owed);
    }

    function mint(MintParams calldata params)
        external
        payable
        ensure(params.deadline)
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        address pool = ZenithV3Factory(factory).getPool(params.token0, params.token1, params.fee);
        require(pool != address(0), "ZenithV3PositionManager: POOL_NOT_FOUND");

        (uint160 sqrtPriceX96, , ) = ZenithV3Pool(pool).slot0();
        require(sqrtPriceX96 > 0, "ZenithV3PositionManager: UNINITIALIZED_POOL");

        uint128 liquidityDesired = uint128(
            (params.amount0Desired > params.amount1Desired ? params.amount0Desired : params.amount1Desired) / 2
        );
        if (liquidityDesired == 0) liquidityDesired = 1000;

        (amount0, amount1) = ZenithV3Pool(pool).mint(
            address(this),
            params.tickLower,
            params.tickUpper,
            liquidityDesired,
            abi.encode(params.token0, params.token1, params.fee, msg.sender)
        );

        require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, "ZenithV3PositionManager: SLIPPAGE");

        tokenId = _nextId++;
        positions[tokenId] = Position({
            token0: params.token0,
            token1: params.token1,
            fee: params.fee,
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            liquidity: liquidityDesired,
            tokensOwed0: 0,
            tokensOwed1: 0
        });

        _mintNFT(params.recipient, tokenId);
        liquidity = liquidityDesired;
        emit IncreaseLiquidity(tokenId, liquidity, amount0, amount1);
    }

    function decreaseLiquidity(
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amount0, uint256 amount1) {
        require(ownerOf[tokenId] == msg.sender, "ZenithV3PositionManager: NOT_OWNER");
        Position storage pos = positions[tokenId];
        require(pos.liquidity >= liquidity, "ZenithV3PositionManager: INSUFFICIENT_LIQUIDITY");

        address pool = ZenithV3Factory(factory).getPool(pos.token0, pos.token1, pos.fee);
        (amount0, amount1) = ZenithV3Pool(pool).burn(pos.tickLower, pos.tickUpper, liquidity);
        require(amount0 >= amount0Min && amount1 >= amount1Min, "ZenithV3PositionManager: SLIPPAGE");

        pos.liquidity -= liquidity;
        pos.tokensOwed0 += uint128(amount0);
        pos.tokensOwed1 += uint128(amount1);

        emit DecreaseLiquidity(tokenId, liquidity, amount0, amount1);
    }

    function collect(
        uint256 tokenId,
        address recipient,
        uint128 amount0Max,
        uint128 amount1Max
    ) external returns (uint256 amount0, uint256 amount1) {
        require(ownerOf[tokenId] == msg.sender, "ZenithV3PositionManager: NOT_OWNER");
        Position storage pos = positions[tokenId];
        address pool = ZenithV3Factory(factory).getPool(pos.token0, pos.token1, pos.fee);

        (uint128 collected0, uint128 collected1) = ZenithV3Pool(pool).collect(
            recipient,
            pos.tickLower,
            pos.tickUpper,
            amount0Max,
            amount1Max
        );

        pos.tokensOwed0 -= collected0;
        pos.tokensOwed1 -= collected1;
        amount0 = collected0;
        amount1 = collected1;

        emit Collect(tokenId, recipient, amount0, amount1);
    }

    function _mintNFT(address to, uint256 tokenId) internal {
        require(to != address(0), "ZenithV3PositionManager: ZERO_RECIPIENT");
        balanceOf[to] += 1;
        ownerOf[tokenId] = to;
        emit Transfer(address(0), to, tokenId);
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithV3PositionManager: TF_FAILED");
    }
}
