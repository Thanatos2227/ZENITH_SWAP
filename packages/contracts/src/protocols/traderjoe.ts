import { UnsupportedProtocolError } from '../errors';

export const TRADER_JOE_LB_ROUTERS: Record<number, string> = {
  43114: '0xB4310e7de3e0f14172488457B1a97140ecc94B77',
  42161: '0xB4310e7de3e0f14172488457B1a97140ecc94B77'
};

export const TRADER_JOE_ROUTER_ABI = [
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) calldata path, address to, uint256 deadline) external returns (uint256 amountOut)',
  'function swapExactNATIVEForTokens(uint256 amountOutMin, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) calldata path, address to, uint256 deadline) external payable returns (uint256 amountOut)',
  'function swapExactTokensForNATIVE(uint256 amountIn, uint256 amountOutMinNATIVE, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) calldata path, address payable to, uint256 deadline) external returns (uint256 amountOut)'
];

export function getTraderJoeRouter(chainId: number): string {
  const router = TRADER_JOE_LB_ROUTERS[chainId];
  if (!router) {
    throw new UnsupportedProtocolError('TRADER_JOE', chainId);
  }
  return router;
}
