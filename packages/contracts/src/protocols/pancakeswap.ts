import { UnsupportedProtocolError } from '../errors';

export const PANCAKESWAP_V3_ROUTERS: Record<number, string> = {
  56: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
  1: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
  8453: '0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86',
  42161: '0x1b81D678ffb9C0263b24A97847620C99d213eB14'
};

export const PANCAKESWAP_V3_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  'function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)',
  'function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)'
];

export function getPancakeSwapRouter(chainId: number): string {
  const router = PANCAKESWAP_V3_ROUTERS[chainId];
  if (!router) {
    throw new UnsupportedProtocolError('PANCAKESWAP', chainId);
  }
  return router;
}
