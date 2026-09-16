// SPDX-License-Identifier: MIT

import { getZenithDeployment } from '../deployments';

export const ZENITH_V2_FACTORY_ABI = [
  'function feeController() external view returns (address)',
  'function treasury() external view returns (address)',
  'function governance() external view returns (address)',
  'function getPool(address tokenA, address tokenB, uint24 feeBps) external view returns (address pool)',
  'function allPools(uint256) external view returns (address pool)',
  'function allPoolsLength() external view returns (uint256)',
  'function createPool(address tokenA, address tokenB, uint24 feeBps) external returns (address pool)',
  'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed feeBps, address pool, uint256)'
];

export const ZENITH_V2_POOL_ABI = [
  'function name() external view returns (string memory)',
  'function symbol() external view returns (string memory)',
  'function decimals() external pure returns (uint8)',
  'function totalSupply() external view returns (uint256)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 value) external returns (bool)',
  'function transfer(address to, uint256 value) external returns (bool)',
  'function transferFrom(address from, address to, uint256 value) external returns (bool)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function feeBps() external view returns (uint24)',
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function price0CumulativeLast() external view returns (uint256)',
  'function price1CumulativeLast() external view returns (uint256)',
  'function mint(address to) external returns (uint256 liquidity)',
  'function burn(address to) external returns (uint256 amount0, uint256 amount1)',
  'function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external',
  'function sync() external',
  'event Mint(address indexed sender, uint256 amount0, uint256 amount1)',
  'event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)',
  'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
  'event Sync(uint112 reserve0, uint112 reserve1)'
];

export const ZENITH_V2_ROUTER_ABI = [
  'function factory() external view returns (address)',
  'function WETH() external view returns (address)',
  'function addLiquidity(address tokenA, address tokenB, uint24 feeBps, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB, uint256 liquidity)',
  'function removeLiquidity(address tokenA, address tokenB, uint24 feeBps, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, uint24[] calldata feeBpsPath, address to, uint256 deadline) external returns (uint256[] memory amounts)',
  'function getAmountsOut(address factory, uint256 amountIn, address[] memory path, uint24[] memory feeBpsPath) external view returns (uint256[] memory amounts)'
];

export function getZenithV2Factory(chainId: number): string | undefined {
  const deployment = getZenithDeployment(chainId);
  return deployment?.v2Factory || undefined;
}

export function getZenithV2Router(chainId: number): string | undefined {
  const deployment = getZenithDeployment(chainId);
  return deployment?.v2Router || undefined;
}
