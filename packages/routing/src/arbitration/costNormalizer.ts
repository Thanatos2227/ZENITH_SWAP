import { CostNormalizationResult, Token } from '@zenith/types';

export interface TokenPriceEvidence {
  priceUSD?: number;
  priceRaw?: string; // Price in fixed-point 1e18 format (e.g., 1 USD = 1e18)
  priceSource: string;
  timestamp: number;
  maxAgeMs?: number; // Default 300,000ms (5 minutes)
}

export interface NormalizeCostParams {
  sourceSwapFeeRaw?: string;
  bridgeFeeRaw?: string;
  destSwapFeeRaw?: string;
  gasCostRaw?: string;
  protocolFeeRaw?: string;
  feeToken: Token | string;
  feeTokenDecimals?: number;
  currentTime?: number;
  priceEvidence?: TokenPriceEvidence;
}

export const DEFAULT_PRICE_MAX_AGE_MS = 300_000; // 5 minutes

export class CostNormalizer {
  /**
   * Normalizes route costs into exact raw integer values and converts to common USD value
   * ONLY when safe and verified price evidence exists.
   *
   * Security Invariant: Zero JavaScript floating-point arithmetic on token amounts.
   * If price evidence is missing or stale, returns ROUTE_COST_UNAVAILABLE. Never invents a value.
   */
  public static normalize(params: NormalizeCostParams): CostNormalizationResult {
    const srcFeeBig = BigInt(params.sourceSwapFeeRaw || '0');
    const bridgeFeeBig = BigInt(params.bridgeFeeRaw || '0');
    const dstFeeBig = BigInt(params.destSwapFeeRaw || '0');
    const gasCostBig = BigInt(params.gasCostRaw || '0');
    const protocolFeeBig = BigInt(params.protocolFeeRaw || '0');

    const totalCostBig = srcFeeBig + bridgeFeeBig + dstFeeBig + gasCostBig + protocolFeeBig;
    const totalCostRaw = totalCostBig.toString();

    const result: CostNormalizationResult = {
      sourceSwapFeeRaw: srcFeeBig.toString(),
      bridgeFeeRaw: bridgeFeeBig.toString(),
      destSwapFeeRaw: dstFeeBig.toString(),
      gasCostRaw: gasCostBig.toString(),
      protocolFeeRaw: protocolFeeBig.toString(),
      totalCostRaw,
      commonFeeToken: params.feeToken,
      isAvailable: true
    };

    // If conversion to USD is requested via priceEvidence
    if (params.priceEvidence) {
      const now = params.currentTime ?? Date.now();
      const ev = params.priceEvidence;
      const maxAge = ev.maxAgeMs ?? DEFAULT_PRICE_MAX_AGE_MS;
      const ageMs = Math.max(0, now - ev.timestamp);

      // Check price expiration
      if (ageMs > maxAge) {
        return {
          ...result,
          isAvailable: false,
          unavailableReason: 'ROUTE_COST_UNAVAILABLE'
        };
      }

      // Check price existence
      if ((!ev.priceUSD || ev.priceUSD <= 0) && (!ev.priceRaw || BigInt(ev.priceRaw) <= 0n)) {
        return {
          ...result,
          isAvailable: false,
          unavailableReason: 'ROUTE_COST_UNAVAILABLE'
        };
      }

      const decimals = params.feeTokenDecimals ?? (typeof params.feeToken === 'object' ? params.feeToken.decimals ?? 18 : 18);

      // Exact integer math: price in 1e6 fixed point (USD micro-cents)
      let priceScaled: bigint;
      if (ev.priceRaw) {
        // Assume priceRaw is 1e18 fixed point
        priceScaled = (BigInt(ev.priceRaw) * 1_000_000n) / 10n ** 18n;
      } else {
        // Safe integer conversion of priceUSD to 1e6 micro-cents
        priceScaled = BigInt(Math.round((ev.priceUSD as number) * 1_000_000));
      }

      // Cost in USD micro-units = (totalCostRaw * priceScaled) / 10^decimals
      const costMicroUSD = (totalCostBig * priceScaled) / (10n ** BigInt(decimals));
      const dollars = costMicroUSD / 1_000_000n;
      const microRemainder = costMicroUSD % 1_000_000n;
      const normalizedCostUSD = `${dollars}.${microRemainder.toString().padStart(6, '0')}`;

      return {
        ...result,
        normalizedCostUSD,
        priceSource: ev.priceSource,
        priceTimestamp: ev.timestamp,
        isAvailable: true
      };
    }

    return result;
  }
}
