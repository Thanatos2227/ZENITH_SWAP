import { getZenithDeployment } from '../deployments';

export const ZENITH_V3_FACTORY_ABI = [
  'function owner() external view returns (address)',
  'function feeAmountTickSpacing(uint24) external view returns (int24)',
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
  'function allPools(uint256) external view returns (address pool)',
  'function allPoolsLength() external view returns (uint256)',
  'function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool)',
  'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)'
];

export const ZENITH_V3_POOL_ABI = [
  'function factory() external view returns (address)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
  'function tickSpacing() external view returns (int24)',
  'function liquidity() external view returns (uint128)',
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, bool unlocked)',
  'function tickBitmap(int16 wordPosition) external view returns (uint256)',
  'function ticks(int24 tick) external view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, bool initialized)',
  'function initialize(uint160 sqrtPriceX96) external',
  'function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data) external returns (uint256 amount0, uint256 amount1)',
  'function collect(address recipient, int24 tickLower, int24 tickUpper, uint128 amount0Requested, uint128 amount1Requested) external returns (uint128 amount0, uint128 amount1)',
  'function burn(int24 tickLower, int24 tickUpper, uint128 amount) external returns (uint256 amount0, uint256 amount1)',
  'function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data) external returns (int256 amount0, int256 amount1)',
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)'
];

export const ZENITH_V3_ROUTER_ABI = [
  'error V3TooLittleReceived()',
  'function factory() external view returns (address)',
  'function WETH9() external view returns (address)',
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  'function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) external payable',
  'function refundETH() external payable'
];

export const ZENITH_V3_POSITION_MANAGER_ABI = [
  'function name() external pure returns (string memory)',
  'function symbol() external pure returns (string memory)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function positions(uint256 tokenId) external view returns (address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint128 tokensOwed0, uint128 tokensOwed1)',
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function decreaseLiquidity(uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) external returns (uint256 amount0, uint256 amount1)',
  'function collect(uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) external returns (uint256 amount0, uint256 amount1)'
];

export function getZenithV3Factory(chainId: number): string | undefined {
  const deployment = getZenithDeployment(chainId);
  return deployment?.v3Factory || undefined;
}

export function getZenithV3Router(chainId: number): string | undefined {
  const deployment = getZenithDeployment(chainId);
  return deployment?.v3Router || undefined;
}

export function getZenithV3PositionManager(chainId: number): string | undefined {
  const deployment = getZenithDeployment(chainId);
  return deployment?.v3PositionManager || undefined;
}
