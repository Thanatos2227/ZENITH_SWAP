import { DEXProtocol, Token, QuoteResponse } from '@zenith/types';
import { Provider } from 'ethers';
export interface ZenithSDKConfig {
    rpcUrls?: Record<number, string>;
    providers?: Record<number, Provider>;
    defaultSlippageBps?: number;
    referralAddress?: string;
}
export interface ZenithQuoteParams {
    chainId: number;
    tokenIn: Token | string;
    tokenOut: Token | string;
    amountIn: bigint | string;
    slippageToleranceBps?: number;
    recipient?: string;
    destinationChainId?: number;
    allowedProtocols?: DEXProtocol[];
}
export interface ZenithQuoteResult {
    sourceChainId: number;
    destinationChainId: number;
    tokenIn: Token;
    tokenOut: Token;
    amountIn: bigint;
    amountOut: bigint;
    minimumReceived: bigint;
    executionPrice: number;
    priceImpact: number;
    protocol: DEXProtocol;
    routePath: string[];
    protocolFeeBps: number;
    protocolFeeAmount: bigint;
    treasuryAddress: string;
    estimatedGas: bigint;
    rawQuote: QuoteResponse;
}
export interface ZenithRouteParams {
    chainId: number;
    tokenIn: Token | string;
    tokenOut: Token | string;
    amountIn: bigint | string;
    destinationChainId?: number;
}
export interface ZenithRoute {
    protocol: DEXProtocol;
    tokenIn: Token;
    tokenOut: Token;
    amountIn: bigint;
    amountOut: bigint;
    priceImpact: number;
    gasCostEstimateWei: bigint;
    path: string[];
    executionTarget: string;
}
export interface ZenithPoolInfo {
    protocol: DEXProtocol;
    chainId: number;
    address: string;
    token0: Token;
    token1: Token;
    feeBps: number;
    reserve0?: bigint;
    reserve1?: bigint;
    sqrtPriceX96?: bigint;
    tick?: number;
    liquidity?: bigint;
    totalLpSupply?: bigint;
}
export interface AddLiquidityV1Params {
    protocol: 'ZENITH_V1';
    chainId: number;
    tokenA: string;
    tokenB: string;
    amountADesired: bigint;
    amountBDesired: bigint;
    amountAMin: bigint;
    amountBMin: bigint;
    to: string;
    deadline: number;
}
export interface RemoveLiquidityV1Params {
    protocol: 'ZENITH_V1';
    chainId: number;
    tokenA: string;
    tokenB: string;
    liquidity: bigint;
    amountAMin: bigint;
    amountBMin: bigint;
    to: string;
    deadline: number;
}
export interface AddLiquidityV2Params {
    protocol: 'ZENITH_V2';
    chainId: number;
    tokenA: string;
    tokenB: string;
    feeBps: number;
    amountADesired: bigint;
    amountBDesired: bigint;
    amountAMin: bigint;
    amountBMin: bigint;
    to: string;
    deadline: number;
}
export interface MintPositionV3Params {
    protocol: 'ZENITH_V3';
    chainId: number;
    token0: string;
    token1: string;
    feeBps: number;
    tickLower: number;
    tickUpper: number;
    amount0Desired: bigint;
    amount1Desired: bigint;
    amount0Min: bigint;
    amount1Min: bigint;
    recipient: string;
    deadline: number;
}
export interface IncreaseLiquidityV3Params {
    protocol: 'ZENITH_V3';
    chainId: number;
    tokenId: bigint;
    amount0Desired: bigint;
    amount1Desired: bigint;
    amount0Min: bigint;
    amount1Min: bigint;
    deadline: number;
}
export interface DecreaseLiquidityV3Params {
    protocol: 'ZENITH_V3';
    chainId: number;
    tokenId: bigint;
    liquidity: bigint;
    amount0Min: bigint;
    amount1Min: bigint;
    deadline: number;
}
export interface CollectV3FeesParams {
    protocol: 'ZENITH_V3';
    chainId: number;
    tokenId: bigint;
    recipient: string;
    amount0Max: bigint;
    amount1Max: bigint;
}
export type LiquidityParams = AddLiquidityV1Params | RemoveLiquidityV1Params | AddLiquidityV2Params | MintPositionV3Params | IncreaseLiquidityV3Params | DecreaseLiquidityV3Params | CollectV3FeesParams;
export interface ZenithV3PositionInfo {
    tokenId: bigint;
    nonce: bigint;
    operator: string;
    token0: string;
    token1: string;
    fee: number;
    tickLower: number;
    tickUpper: number;
    liquidity: bigint;
    feeGrowthInside0LastX128: bigint;
    feeGrowthInside1LastX128: bigint;
    tokensOwed0: bigint;
    tokensOwed1: bigint;
}
export interface ZenithTreasuryInfo {
    chainId: number;
    treasuryAddress: string;
    feeControllerAddress: string;
    defaultFeeBps: number;
    owner: string;
    accumulatedFees?: Record<string, bigint>;
}
export interface UnsignedTransaction {
    to: string;
    data: string;
    value: bigint;
    chainId: number;
    gasLimit?: bigint;
}
export interface SwapExecutionOptions {
    userAddress: string;
    recipient?: string;
    deadlineSeconds?: number;
}
