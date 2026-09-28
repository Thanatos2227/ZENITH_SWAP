import type { DexIdentity, DexCapabilities, DexPairValidationResult, DexPoolDiscoveryResult, AuthoritativeDexQuote, DexSwapTransaction, DexSimulationResult, DexPoolState, DexDeploymentVerificationResult, DexLiquidityState, TokenIdentity, Token } from '@zenith/types';
export interface DexQuoteParams {
    chainId: number | string;
    tokenIn: TokenIdentity | Token;
    tokenOut: TokenIdentity | Token;
    amountIn: bigint;
    slippageToleranceBps: number;
    feeTierBps?: number;
    recipient?: string;
    provider?: any;
    deadline?: number;
}
export interface IDexAdapter {
    readonly dexId: string;
    getDexIdentity(): DexIdentity;
    getCapabilities(): DexCapabilities;
    validateTokenPair(tokenIn: TokenIdentity | Token, tokenOut: TokenIdentity | Token): DexPairValidationResult;
    discoverPool(tokenIn: TokenIdentity | Token, tokenOut: TokenIdentity | Token, feeTierBps?: number): Promise<DexPoolDiscoveryResult>;
    getQuote(params: DexQuoteParams): Promise<AuthoritativeDexQuote | null>;
    buildSwapTransaction(quote: AuthoritativeDexQuote, userAddress: string, recipientAddress?: string, deadline?: number): Promise<DexSwapTransaction>;
    simulateSwap(swapTx: DexSwapTransaction, rpcProvider?: any): Promise<DexSimulationResult>;
    getPoolState(poolAddress: string, rpcProvider?: any): Promise<DexPoolState | null>;
    verifyDeployment(rpcProvider?: any): Promise<DexDeploymentVerificationResult>;
    getLiquidityState(poolAddress: string, rpcProvider?: any): Promise<DexLiquidityState | null>;
    getPriceImpact(amountIn: bigint, poolAddress: string, rpcProvider?: any): Promise<number | null>;
}
