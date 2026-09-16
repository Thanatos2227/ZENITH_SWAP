import { UnsupportedProtocolError } from '../errors';

export const CAMELOT_V2_ROUTER = '0xc873fEcbd354f5A56E00E710B90EF4201db2448d';
export const CAMELOT_V3_ROUTER = '0x1F721E2E82F6676FCE4eA07A5958cF098D339e18';

export const CAMELOT_V3_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice)) external payable returns (uint256 amountOut)',
  'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)'
];

export const CAMELOT_V2_ROUTER_ABI = [
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, address referrer, uint256 deadline) external',
  'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)'
];

export function getCamelotRouter(chainId: number): string {
  if (chainId === 42161) {
    return CAMELOT_V3_ROUTER;
  }
  throw new UnsupportedProtocolError('CAMELOT', chainId);
}
