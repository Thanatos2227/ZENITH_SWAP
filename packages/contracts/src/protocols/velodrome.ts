import { UnsupportedProtocolError } from '../errors';

export const VELODROME_ROUTER = '0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858';
export const VELODROME_UNIVERSAL_ROUTER = '0xCCD5d625D8D9EcB8a6A0d885D577c2B9612eB581';

export const VELODROME_ROUTER_ABI = [
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] calldata routes, address to, uint256 deadline) external returns (uint256[] memory amounts)',
  'function swapExactETHForTokens(uint256 amountOutMin, (address from, address to, bool stable, address factory)[] calldata routes, address to, uint256 deadline) external payable returns (uint256[] memory amounts)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] calldata routes, address to, uint256 deadline) external returns (uint256[] memory amounts)',
  'function getAmountsOut(uint256 amountIn, (address from, address to, bool stable, address factory)[] calldata routes) external view returns (uint256[] memory amounts)'
];

export function getVelodromeRouter(chainId: number): string {
  if (chainId === 10) {
    return VELODROME_ROUTER;
  }
  throw new UnsupportedProtocolError('VELODROME', chainId);
}
