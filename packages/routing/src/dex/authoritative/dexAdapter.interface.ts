/**
 * @file dexAdapter.interface.ts
 * @package @zenith/routing
 *
 * Canonical IDexAdapter Interface.
 * Defines the standard lifecycle, quote, pool discovery, simulation, and execution
 * contract for all authoritative DEX integrations.
 */

import type {
  DexIdentity,
  DexCapabilities,
  DexPairValidationResult,
  DexPoolDiscoveryResult,
  AuthoritativeDexQuote,
  DexSwapTransaction,
  DexSimulationResult,
  DexPoolState,
  DexDeploymentVerificationResult,
  DexLiquidityState,
  TokenIdentity,
  Token
} from '@zenith/types';

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

  /**
   * Retrieves the immutable identity metadata for this DEX.
   */
  getDexIdentity(): DexIdentity;

  /**
   * Retrieves the current capability profile for this DEX.
   */
  getCapabilities(): DexCapabilities;

  /**
   * Validates whether a token pair can be traded on this DEX.
   */
  validateTokenPair(
    tokenIn: TokenIdentity | Token,
    tokenOut: TokenIdentity | Token
  ): DexPairValidationResult;

  /**
   * Discovers the liquidity pool address and state for a pair.
   */
  discoverPool(
    tokenIn: TokenIdentity | Token,
    tokenOut: TokenIdentity | Token,
    feeTierBps?: number
  ): Promise<DexPoolDiscoveryResult>;

  /**
   * Computes an authoritative swap quote.
   */
  getQuote(params: DexQuoteParams): Promise<AuthoritativeDexQuote | null>;

  /**
   * Constructs a deterministic, executable swap transaction.
   */
  buildSwapTransaction(
    quote: AuthoritativeDexQuote,
    userAddress: string,
    recipientAddress?: string,
    deadline?: number
  ): Promise<DexSwapTransaction>;

  /**
   * Simulates the swap transaction via eth_call and preflight checks.
   */
  simulateSwap(
    swapTx: DexSwapTransaction,
    rpcProvider?: any
  ): Promise<DexSimulationResult>;

  /**
   * Reads on-chain pool state (reserves, slot0, tick, liquidity).
   */
  getPoolState(
    poolAddress: string,
    rpcProvider?: any
  ): Promise<DexPoolState | null>;

  /**
   * Verifies the DEX contract deployment on-chain.
   */
  verifyDeployment(rpcProvider?: any): Promise<DexDeploymentVerificationResult>;

  /**
   * Inspects available pool liquidity.
   */
  getLiquidityState(
    poolAddress: string,
    rpcProvider?: any
  ): Promise<DexLiquidityState | null>;

  /**
   * Computes price impact or returns null (PRICE_IMPACT_UNKNOWN) without fabrication.
   */
  getPriceImpact(
    amountIn: bigint,
    poolAddress: string,
    rpcProvider?: any
  ): Promise<number | null>;
}
