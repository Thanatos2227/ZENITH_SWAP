pragma solidity 0.8.24;

import "./ZenithPoolManager.sol";

contract ZenithPositionNFT {
    string public name = "ZENITH Concentrated LP Position";
    string public symbol = "ZENITH-POS";

    ZenithPoolManager public immutable poolManager;

    struct Position {
        uint256 nonce;
        address operator;
        ZenithPoolManager.PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 feeGrowthInside0LastX128;
        uint256 feeGrowthInside1LastX128;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
    }

    struct MintParams {
        ZenithPoolManager.PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 amount0Max;
        uint256 amount1Max;
        address recipient;
        uint256 deadline;
    }

    struct IncreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Max;
        uint256 amount1Max;
        uint256 deadline;
    }

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    uint256 private _nextId = 1;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    mapping(uint256 => Position) public positions;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1);

    modifier checkDeadline(uint256 deadline) {
        require(block.timestamp <= deadline, "ZenithPositionNFT: EXPIRED");
        _;
    }

    modifier isAuthorizedForToken(uint256 tokenId) {
        address tokenOwner = _owners[tokenId];
        require(
            msg.sender == tokenOwner ||
            _tokenApprovals[tokenId] == msg.sender ||
            _operatorApprovals[tokenOwner][msg.sender],
            "ZenithPositionNFT: NOT_AUTHORIZED"
        );
        _;
    }

    constructor(address _poolManager) {
        require(_poolManager != address(0), "ZenithPositionNFT: ZERO_POOL_MANAGER");
        poolManager = ZenithPoolManager(_poolManager);
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address tokenOwner = _owners[tokenId];
        require(tokenOwner != address(0), "ZenithPositionNFT: NONEXISTENT_TOKEN");
        return tokenOwner;
    }

    function balanceOf(address tokenOwner) public view returns (uint256) {
        require(tokenOwner != address(0), "ZenithPositionNFT: ZERO_ADDRESS");
        return _balances[tokenOwner];
    }

    function mint(MintParams calldata params)
        external
        checkDeadline(params.deadline)
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        require(params.recipient != address(0), "ZenithPositionNFT: ZERO_RECIPIENT");
        tokenId = _nextId++;

        _owners[tokenId] = params.recipient;
        _balances[params.recipient]++;
        emit Transfer(address(0), params.recipient, tokenId);

        _safeApprove(params.poolKey.currency0, address(poolManager), type(uint256).max);
        _safeApprove(params.poolKey.currency1, address(poolManager), type(uint256).max);

        if (params.amount0Max > 0) {
            _safeTransferFrom(params.poolKey.currency0, msg.sender, address(this), params.amount0Max);
        }
        if (params.amount1Max > 0) {
            _safeTransferFrom(params.poolKey.currency1, msg.sender, address(this), params.amount1Max);
        }

        ZenithPoolManager.BalanceDelta memory delta = poolManager.modifyLiquidity(
            ZenithPoolManager.ModifyLiquidityParams({
                key: params.poolKey,
                tickLower: params.tickLower,
                tickUpper: params.tickUpper,
                liquidityDelta: int256(uint256(params.liquidity)),
                hookData: ""
            })
        );

        amount0 = delta.amount0 > 0 ? uint256(delta.amount0) : 0;
        amount1 = delta.amount1 > 0 ? uint256(delta.amount1) : 0;

        require(amount0 <= params.amount0Max, "ZenithPositionNFT: SLIPPAGE_0");
        require(amount1 <= params.amount1Max, "ZenithPositionNFT: SLIPPAGE_1");

        if (params.amount0Max > amount0) {
            _safeTransfer(params.poolKey.currency0, msg.sender, params.amount0Max - amount0);
        }
        if (params.amount1Max > amount1) {
            _safeTransfer(params.poolKey.currency1, msg.sender, params.amount1Max - amount1);
        }

        positions[tokenId] = Position({
            nonce: 0,
            operator: address(0),
            poolKey: params.poolKey,
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            liquidity: params.liquidity,
            feeGrowthInside0LastX128: 0,
            feeGrowthInside1LastX128: 0,
            tokensOwed0: 0,
            tokensOwed1: 0
        });

        liquidity = params.liquidity;
        emit IncreaseLiquidity(tokenId, liquidity, amount0, amount1);
    }

    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        isAuthorizedForToken(params.tokenId)
        checkDeadline(params.deadline)
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage position = positions[params.tokenId];
        require(position.liquidity >= params.liquidity, "ZenithPositionNFT: INSUFFICIENT_LIQUIDITY");

        ZenithPoolManager.BalanceDelta memory delta = poolManager.modifyLiquidity(
            ZenithPoolManager.ModifyLiquidityParams({
                key: position.poolKey,
                tickLower: position.tickLower,
                tickUpper: position.tickUpper,
                liquidityDelta: -int256(uint256(params.liquidity)),
                hookData: ""
            })
        );

        position.liquidity -= params.liquidity;
        amount0 = delta.amount0 < 0 ? uint256(-delta.amount0) : 0;
        amount1 = delta.amount1 < 0 ? uint256(-delta.amount1) : 0;

        require(amount0 >= params.amount0Min, "ZenithPositionNFT: SLIPPAGE_0");
        require(amount1 >= params.amount1Min, "ZenithPositionNFT: SLIPPAGE_1");

        position.tokensOwed0 += uint128(amount0);
        position.tokensOwed1 += uint128(amount1);

        emit DecreaseLiquidity(params.tokenId, params.liquidity, amount0, amount1);
    }

    function collect(CollectParams calldata params)
        external
        isAuthorizedForToken(params.tokenId)
        returns (uint256 amount0, uint256 amount1)
    {
        require(params.recipient != address(0), "ZenithPositionNFT: ZERO_RECIPIENT");
        Position storage position = positions[params.tokenId];
        amount0 = params.amount0Max > position.tokensOwed0 ? position.tokensOwed0 : params.amount0Max;
        amount1 = params.amount1Max > position.tokensOwed1 ? position.tokensOwed1 : params.amount1Max;

        if (amount0 > 0) {
            position.tokensOwed0 -= uint128(amount0);
            _safeTransfer(position.poolKey.currency0, params.recipient, amount0);
        }
        if (amount1 > 0) {
            position.tokensOwed1 -= uint128(amount1);
            _safeTransfer(position.poolKey.currency1, params.recipient, amount1);
        }

        emit Collect(params.tokenId, params.recipient, amount0, amount1);
    }

    function burn(uint256 tokenId) external isAuthorizedForToken(tokenId) {
        Position storage position = positions[tokenId];
        require(position.liquidity == 0 && position.tokensOwed0 == 0 && position.tokensOwed1 == 0, "ZenithPositionNFT: NOT_EMPTY");

        address tokenOwner = _owners[tokenId];
        delete _tokenApprovals[tokenId];
        delete positions[tokenId];
        _balances[tokenOwner]--;
        delete _owners[tokenId];

        emit Transfer(tokenOwner, address(0), tokenId);
    }

    function _safeTransfer(address token, address to, uint256 value) internal {
        require(token != address(0), "ZenithPositionNFT: ZERO_TOKEN");
        require(to != address(0), "ZenithPositionNFT: ZERO_RECIPIENT");
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithPositionNFT: TRANSFER_FAILED");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) internal {
        require(token != address(0), "ZenithPositionNFT: ZERO_TOKEN");
        require(from != address(0), "ZenithPositionNFT: ZERO_SENDER");
        require(to != address(0), "ZenithPositionNFT: ZERO_RECIPIENT");
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithPositionNFT: TRANSFER_FROM_FAILED");
    }

    function _safeApprove(address token, address spender, uint256 value) internal {
        require(token != address(0), "ZenithPositionNFT: ZERO_TOKEN");
        require(spender != address(0), "ZenithPositionNFT: ZERO_SPENDER");
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.approve.selector, spender, value)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithPositionNFT: APPROVE_FAILED");
    }
}
