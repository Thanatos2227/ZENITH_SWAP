/**
 * @file dexRoutingIntegration.ts
 * @package @zenith/routing
 *
 * Routing & Arbitration Integration for Authoritative DEXes.
 * Normalizes DEX quotes into canonical routes, applies deterministic 10-gate capability filtering,
 * and preserves exact integer economic scoring.
 */

import { sha256, toUtf8Bytes } from 'ethers';
import type {
  NormalizedRoute,
  QuoteRequest,
  CapabilityLevel,
  ProviderCapabilityLevel
} from '@zenith/types';
import type { AuthoritativeDexQuote } from '@zenith/types';
import {
  AuthoritativeDexRegistry,
  defaultAuthoritativeDexRegistry
} from './authoritativeDexRegistry';
import { getDexCapabilityRank } from './dexCapability.matrix';
import { getTokenAddress } from './dexIdentity.types';

export class DexRoutingIntegration {
  /**
   * Generates a deterministic route ID for a DEX route.
   */
  public static buildDexRouteId(
    dexId: string,
    sourceChainId: string | number,
    tokenInAddr: string,
    tokenOutAddr: string,
    feeTierBps: number = 30
  ): string {
    const raw = `${dexId.toLowerCase()}:${String(sourceChainId).toLowerCase()}:${tokenInAddr.toLowerCase()}:${tokenOutAddr.toLowerCase()}:${feeTierBps}`;
    const hash = sha256(toUtf8Bytes(raw)).slice(2, 10);
    return `route-dex-${dexId.replace(/[^a-zA-Z0-9-]/g, '_')}-${hash}`;
  }

  /**
   * Normalizes an AuthoritativeDexQuote into a NormalizedRoute for arbitration.
   */
  public static normalizeDexQuote(
    quote: AuthoritativeDexQuote,
    request: QuoteRequest,
    registry: AuthoritativeDexRegistry = defaultAuthoritativeDexRegistry
  ): NormalizedRoute {
    const dex = registry.getDex(quote.dexId);
    const capabilityLevel: CapabilityLevel = dex ? dex.capabilityLevel : quote.capabilityLevel;
    const isExec =
      quote.executable &&
      (capabilityLevel === 'EXECUTION_AVAILABLE' || capabilityLevel === 'LIVE_VERIFIED');

    const inAddr = getTokenAddress(quote.tokenIn);
    const outAddr = getTokenAddress(quote.tokenOut);

    const routeId = this.buildDexRouteId(
      quote.dexId,
      request.sourceChainId,
      inAddr,
      outAddr,
      quote.feeTierBps || 30
    );

    return {
      routeId,
      sourceChainId: request.sourceChainId,
      destinationChainId: request.destinationChainId,
      sourceToken: request.tokenIn,
      destinationToken: request.tokenOut,
      inputAmountRaw: quote.amountIn.toString(),
      expectedOutputRaw: quote.expectedAmountOut.toString(),
      minimumOutputRaw: quote.minimumAmountOut.toString(),
      totalFeeRaw: quote.fee.toString(),
      feeToken: request.tokenIn,
      estimatedGasRaw: quote.gasEstimate.toString(),
      estimatedGasCostRaw: '0',
      sourceDex: quote.dexId,
      quotedAt: quote.quoteTimestamp,
      expiresAt: quote.expiration,
      capabilityLevel: capabilityLevel as ProviderCapabilityLevel,
      isExecutable: isExec,
      routeType: 'SAME_CHAIN',
      unexecutableReason: !isExec
        ? `DEX_CAPABILITY_INSUFFICIENT: DEX "${quote.dexId}" capability level is "${capabilityLevel}"`
        : undefined,
      calldata: quote.calldata,
      executionTarget: quote.executionTarget,
      approvalTarget: quote.approvalTarget,
      valueWei: quote.value || '0'
    };
  }

  /**
   * Evaluates DEX capability requirements against execution mode.
   */
  public static evaluateDexExecutionGate(
    dexId: string,
    mode: string,
    registry: AuthoritativeDexRegistry = defaultAuthoritativeDexRegistry
  ): { passed: boolean; reason?: string } {
    const dex = registry.getDex(dexId);
    if (!dex) {
      return {
        passed: false,
        reason: `DEX_UNREGISTERED: DEX "${dexId}" is not present in AuthoritativeDexRegistry`
      };
    }

    if (dex.status === 'DISABLED' || dex.status === 'DEPRECATED') {
      return {
        passed: false,
        reason: `DEX_STATUS_INACTIVE: DEX "${dexId}" status is ${dex.status}`
      };
    }

    const rank = getDexCapabilityRank(dex.capabilityLevel);

    if (mode === 'LIVE_EXECUTION' || mode === 'LIVE_ONCHAIN') {
      const minRank = getDexCapabilityRank('EXECUTION_AVAILABLE');
      if (rank < minRank) {
        return {
          passed: false,
          reason: `DEX_CAPABILITY_MISMATCH: DEX "${dexId}" level "${dex.capabilityLevel}" is below EXECUTION_AVAILABLE for live mode`
        };
      }
    } else if (mode === 'PREFLIGHT_ONLY') {
      const minRank = getDexCapabilityRank('EXECUTION_AVAILABLE');
      if (rank < minRank) {
        return {
          passed: false,
          reason: `DEX_CAPABILITY_MISMATCH: DEX "${dexId}" level "${dex.capabilityLevel}" is below EXECUTION_AVAILABLE for preflight mode`
        };
      }
    } else if (mode === 'SIMULATION') {
      const minRank = getDexCapabilityRank('CONFIGURED');
      if (rank < minRank) {
        return {
          passed: false,
          reason: `DEX_CAPABILITY_MISMATCH: DEX "${dexId}" level "${dex.capabilityLevel}" is below CONFIGURED for simulation mode`
        };
      }
    }

    return { passed: true };
  }
}

export const buildDexRouteId = DexRoutingIntegration.buildDexRouteId;
export const normalizeDexQuote = DexRoutingIntegration.normalizeDexQuote;
export const normalizeDexQuoteToRoute = (
  quote: AuthoritativeDexQuote,
  registry: AuthoritativeDexRegistry = defaultAuthoritativeDexRegistry
): NormalizedRoute => {
  const req: QuoteRequest = {
    sourceChainId: quote.networkId,
    destinationChainId: quote.networkId,
    tokenIn: quote.tokenIn as any,
    tokenOut: quote.tokenOut as any,
    amountInRaw: quote.amountIn.toString(),
    slippageTolerancePercent: 0.5
  };
  return DexRoutingIntegration.normalizeDexQuote(quote, req, registry);
};

export const checkDexCapabilityGate = (
  dexId: string,
  _network: any,
  requiredCapability: CapabilityLevel,
  registry: AuthoritativeDexRegistry = defaultAuthoritativeDexRegistry
): { passed: boolean; reason?: string } => {
  const dex = registry.getDex(dexId);
  if (!dex) {
    return { passed: false, reason: `DEX_UNREGISTERED: DEX "${dexId}" is not present in registry` };
  }
  const rank = getDexCapabilityRank(dex.capabilityLevel);
  const reqRank = getDexCapabilityRank(requiredCapability);
  if (rank < reqRank) {
    return {
      passed: false,
      reason: `DEX_CAPABILITY_GATE_FAILED: DEX "${dexId}" capability ${dex.capabilityLevel} < ${requiredCapability}`
    };
  }
  return { passed: true };
};
