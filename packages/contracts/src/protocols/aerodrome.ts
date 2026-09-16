import { UnsupportedProtocolError } from '../errors';

export const AERODROME_ROUTER = '0xcF77a3Ba9A5CA399B7c97c74856154990ED379bC';
export const AERODROME_SLIPSTREAM_ROUTER = '0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5';
export const AERODROME_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';

export const AERODROME_ROUTER_ABI = [
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] calldata routes, address to, uint256 deadline) external returns (uint256[] memory amounts)',
  'function swapExactETHForTokens(uint256 amountOutMin, (address from, address to, bool stable, address factory)[] calldata routes, address to, uint256 deadline) external payable returns (uint256[] memory amounts)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] calldata routes, address to, uint256 deadline) external returns (uint256[] memory amounts)',
  'function getAmountsOut(uint256 amountIn, (address from, address to, bool stable, address factory)[] calldata routes) external view returns (uint256[] memory amounts)'
];

export function getAerodromeRouter(chainId: number): string {
  if (chainId === 8453) {
    return AERODROME_ROUTER;
  }
  throw new UnsupportedProtocolError('AERODROME', chainId);
}
