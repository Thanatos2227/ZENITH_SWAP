import { UnsupportedProtocolError } from '../errors';

export const UNISWAP_V3_SWAP_ROUTERS: Record<number, string> = {
  1: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  10: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  56: '0xB9714879f3842923608032F71Fc48e3006863d23',
  137: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  8453: '0x2626664c2603336E57B271c5C0b26F421741e481',
  42161: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  43114: '0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE',
  324: '0x39E098A15B62B322210777B0e650e24021C612e3',
  59144: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  534352: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  81457: '0x337D4F504e094C85D68a90BC29130465E455B662',
  34443: '0xC962DF3068F69b5De101e4a6E355d40f0f84fE9B',
  11155111: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
  421614: '0x101F443B4d1b059569D643917553c771E1b9663E',
  84532: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
  11155420: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4'
};

export const UNISWAP_V3_QUOTER_V2: Record<number, string> = {
  1: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  10: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  56: '0x78D78E420dA98AD378D7799bE8f241d19F297614',
  137: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  8453: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
  42161: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  43114: '0xbe0243716483E82245b78b66804B9034E571f185'
};

export const UNISWAP_V3_FACTORY: Record<number, string> = {
  1: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  10: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  56: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
  137: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  8453: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  42161: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  43114: '0x740b1c1de25031C31FF4fC9A62f554A55cdC1baD'
};

export const UNISWAP_V3_SWAP_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  'function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)',
  'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)',
  'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountIn)',
  'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountIn)',
  'function exactOutput((bytes path, address recipient, uint256 amountOut, uint256 amountInMaximum)) external payable returns (uint256 amountIn)',
  'function exactOutput((bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum)) external payable returns (uint256 amountIn)',
  'function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)',
  'function multicall(uint256 deadline, bytes[] calldata data) external payable returns (bytes[] memory results)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) external payable',
  'function refundETH() external payable'
];

export const UNISWAP_V3_QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)'
];

export const UNISWAP_UNIVERSAL_ROUTERS: Record<number, string> = {
  1: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
  10: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
  56: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
  137: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
  8453: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
  42161: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
  43114: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD'
};

export const UNISWAP_UNIVERSAL_ROUTER_ABI = [
  'function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable',
  'function execute(bytes calldata commands, bytes[] calldata inputs) external payable'
];

export function getUniswapUniversalRouter(chainId: number): string | undefined {
  return UNISWAP_UNIVERSAL_ROUTERS[chainId];
}

export function getUniswapV3Router(chainId: number): string {
  const router = UNISWAP_V3_SWAP_ROUTERS[chainId];
  if (!router) {
    throw new UnsupportedProtocolError('UNISWAP_V3', chainId);
  }
  return router;
}

export function getUniswapV3Quoter(chainId: number): string | undefined {
  return UNISWAP_V3_QUOTER_V2[chainId];
}

export function getUniswapV3Factory(chainId: number): string | undefined {
  return UNISWAP_V3_FACTORY[chainId];
}
