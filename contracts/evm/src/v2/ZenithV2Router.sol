pragma solidity 0.8.24;

import "./ZenithV2Pool.sol";
import "./ZenithV2Factory.sol";
import "../interfaces/IERC20.sol";
import "../interfaces/IWETH9.sol";

contract ZenithV2Router {
    address public immutable factory;
    address public immutable WETH;

    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "ZenithV2Router: EXPIRED");
        _;
    }

    constructor(address _factory, address _weth) {
        require(_factory != address(0), "ZenithV2Router: Zero factory");
        require(_weth != address(0), "ZenithV2Router: Zero WETH");
        factory = _factory;
        WETH = _weth;
    }

    receive() external payable {
        require(msg.sender == WETH, "ZenithV2Router: NOT_WETH");
    }

    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint24 feeBps,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) internal virtual returns (uint256 amountA, uint256 amountB) {
        if (ZenithV2Factory(factory).getPool(tokenA, tokenB, feeBps) == address(0)) {
            ZenithV2Factory(factory).createPool(tokenA, tokenB, feeBps);
        }
        (uint256 reserveA, uint256 reserveB) = getReserves(factory, tokenA, tokenB, feeBps);
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint256 amountBOptimal = quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, "ZenithV2Router: INSUFFICIENT_B_AMOUNT");
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint256 amountAOptimal = quote(amountBDesired, reserveB, reserveA);
                assert(amountAOptimal <= amountADesired);
                require(amountAOptimal >= amountAMin, "ZenithV2Router: INSUFFICIENT_A_AMOUNT");
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint24 feeBps,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external virtual ensure(deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        (amountA, amountB) = _addLiquidity(tokenA, tokenB, feeBps, amountADesired, amountBDesired, amountAMin, amountBMin);
        address pool = poolFor(factory, tokenA, tokenB, feeBps);
        _safeTransferFrom(tokenA, msg.sender, pool, amountA);
        _safeTransferFrom(tokenB, msg.sender, pool, amountB);
        liquidity = ZenithV2Pool(pool).mint(to);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint24 feeBps,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) public virtual ensure(deadline) returns (uint256 amountA, uint256 amountB) {
        address pool = poolFor(factory, tokenA, tokenB, feeBps);
        ZenithV2Pool(pool).transferFrom(msg.sender, pool, liquidity);
        (uint256 amount0, uint256 amount1) = ZenithV2Pool(pool).burn(to);
        (address token0,) = sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountA >= amountAMin, "ZenithV2Router: INSUFFICIENT_A_AMOUNT");
        require(amountB >= amountBMin, "ZenithV2Router: INSUFFICIENT_B_AMOUNT");
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        uint24[] calldata feeBpsPath,
        address to,
        uint256 deadline
    ) external virtual ensure(deadline) returns (uint256[] memory amounts) {
        require(path.length == feeBpsPath.length + 1, "ZenithV2Router: INVALID_PATH_LENGTHS");
        amounts = getAmountsOut(factory, amountIn, path, feeBpsPath);
        require(amounts[amounts.length - 1] >= amountOutMin, "ZenithV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
        _safeTransferFrom(path[0], msg.sender, poolFor(factory, path[0], path[1], feeBpsPath[0]), amounts[0]);
        _swap(amounts, path, feeBpsPath, to);
    }

    function _swap(uint256[] memory amounts, address[] memory path, uint24[] memory feeBpsPath, address _to) internal virtual {
        for (uint256 i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = sortTokens(input, output);
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) = input == token0 ? (uint256(0), amountOut) : (amountOut, uint256(0));
            address to = i < path.length - 2 ? poolFor(factory, output, path[i + 2], feeBpsPath[i + 1]) : _to;
            ZenithV2Pool(poolFor(factory, input, output, feeBpsPath[i])).swap(amount0Out, amount1Out, to, new bytes(0));
        }
    }

    function sortTokens(address tokenA, address tokenB) internal pure returns (address token0, address token1) {
        require(tokenA != tokenB, "ZenithV2Router: IDENTICAL_ADDRESSES");
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "ZenithV2Router: ZERO_ADDRESS");
    }

    function poolFor(address _factory, address tokenA, address tokenB, uint24 feeBps) internal view returns (address pool) {
        pool = ZenithV2Factory(_factory).getPool(tokenA, tokenB, feeBps);
        require(pool != address(0), "ZenithV2Router: POOL_NOT_FOUND");
    }

    function getReserves(address _factory, address tokenA, address tokenB, uint24 feeBps) internal view returns (uint256 reserveA, uint256 reserveB) {
        (address token0,) = sortTokens(tokenA, tokenB);
        address pool = poolFor(_factory, tokenA, tokenB, feeBps);
        (uint112 reserve0, uint112 reserve1,) = ZenithV2Pool(pool).getReserves();
        (reserveA, reserveB) = tokenA == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) public pure returns (uint256 amountB) {
        require(amountA > 0, "ZenithV2Router: INSUFFICIENT_AMOUNT");
        require(reserveA > 0 && reserveB > 0, "ZenithV2Router: INSUFFICIENT_LIQUIDITY");
        amountB = (amountA * reserveB) / reserveA;
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut, uint24 feeBps) public pure returns (uint256 amountOut) {
        require(amountIn > 0, "ZenithV2Router: INSUFFICIENT_INPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "ZenithV2Router: INSUFFICIENT_LIQUIDITY");
        uint256 multiplier = 10000 - feeBps;
        uint256 amountInWithFee = amountIn * multiplier;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 10000) + amountInWithFee;
        amountOut = numerator / denominator;
    }

    function getAmountsOut(address _factory, uint256 amountIn, address[] memory path, uint24[] memory feeBpsPath) public view returns (uint256[] memory amounts) {
        require(path.length >= 2, "ZenithV2Router: INVALID_PATH");
        require(path.length == feeBpsPath.length + 1, "ZenithV2Router: INVALID_FEE_LENGTH");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i < path.length - 1; i++) {
            (uint256 reserveIn, uint256 reserveOut) = getReserves(_factory, path[i], path[i + 1], feeBpsPath[i]);
            amounts[i + 1] = getAmountOut(amounts[i], reserveIn, reserveOut, feeBpsPath[i]);
        }
    }

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithV2Router: TRANSFER_FAILED");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "ZenithV2Router: TRANSFER_FROM_FAILED");
    }
}
