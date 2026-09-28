import { CostNormalizationResult, Token } from '@zenith/types';
export interface TokenPriceEvidence {
    priceUSD?: number;
    priceRaw?: string;
    priceSource: string;
    timestamp: number;
    maxAgeMs?: number;
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
export const DEFAULT_PRICE_MAX_AGE_MS = 300000;
export class CostNormalizer {
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
        if (params.priceEvidence) {
            const now = params.currentTime ?? Date.now();
            const ev = params.priceEvidence;
            const maxAge = ev.maxAgeMs ?? DEFAULT_PRICE_MAX_AGE_MS;
            const ageMs = Math.max(0, now - ev.timestamp);
            if (ageMs > maxAge) {
                return {
                    ...result,
                    isAvailable: false,
                    unavailableReason: 'ROUTE_COST_UNAVAILABLE'
                };
            }
            if ((!ev.priceUSD || ev.priceUSD <= 0) && (!ev.priceRaw || BigInt(ev.priceRaw) <= 0n)) {
                return {
                    ...result,
                    isAvailable: false,
                    unavailableReason: 'ROUTE_COST_UNAVAILABLE'
                };
            }
            const decimals = params.feeTokenDecimals ?? (typeof params.feeToken === 'object' ? params.feeToken.decimals ?? 18 : 18);
            let priceScaled: bigint;
            if (ev.priceRaw) {
                priceScaled = (BigInt(ev.priceRaw) * 1000000n) / 10n ** 18n;
            }
            else {
                priceScaled = BigInt(Math.round((ev.priceUSD as number) * 1000000));
            }
            const costMicroUSD = (totalCostBig * priceScaled) / (10n ** BigInt(decimals));
            const dollars = costMicroUSD / 1000000n;
            const microRemainder = costMicroUSD % 1000000n;
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
