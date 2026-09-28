import { RouteFreshnessState } from '@zenith/types';
export interface FreshnessValidationOptions {
    currentTime?: number;
    maxStalenessMs?: number;
    expiringSoonThresholdMs?: number;
    maxAllowedClockSkewMs?: number;
}
export interface FreshnessValidationResult {
    state: RouteFreshnessState;
    isFresh: boolean;
    isExecutable: boolean;
    ageMs: number;
    remainingMs: number;
    reason?: string;
}
export const DEFAULT_MAX_STALENESS_MS = 60000;
export const DEFAULT_EXPIRING_SOON_THRESHOLD_MS = 15000;
export const DEFAULT_MAX_CLOCK_SKEW_MS = 5000;
export class RouteFreshnessValidator {
    public static validate(quotedAt: number | undefined | null, expiresAt: number | undefined | null, options?: FreshnessValidationOptions): FreshnessValidationResult {
        const now = options?.currentTime ?? Date.now();
        const maxStalenessMs = options?.maxStalenessMs ?? DEFAULT_MAX_STALENESS_MS;
        const expiringSoonThresholdMs = options?.expiringSoonThresholdMs ?? DEFAULT_EXPIRING_SOON_THRESHOLD_MS;
        const maxClockSkewMs = options?.maxAllowedClockSkewMs ?? DEFAULT_MAX_CLOCK_SKEW_MS;
        if (!quotedAt || quotedAt <= 0 || !expiresAt || expiresAt <= 0) {
            return {
                state: 'UNKNOWN',
                isFresh: false,
                isExecutable: false,
                ageMs: 0,
                remainingMs: 0,
                reason: 'FRESHNESS_UNKNOWN: Missing or invalid quotedAt or expiresAt timestamp.'
            };
        }
        if (quotedAt > now + maxClockSkewMs) {
            return {
                state: 'UNKNOWN',
                isFresh: false,
                isExecutable: false,
                ageMs: quotedAt - now,
                remainingMs: 0,
                reason: `FRESHNESS_INVALID_FUTURE: Quote timestamp (${quotedAt}) is ${quotedAt - now}ms in the future.`
            };
        }
        const ageMs = Math.max(0, now - quotedAt);
        const remainingMs = expiresAt - now;
        if (remainingMs <= 0) {
            return {
                state: 'EXPIRED',
                isFresh: false,
                isExecutable: false,
                ageMs,
                remainingMs,
                reason: `QUOTE_EXPIRED: Route expired ${Math.abs(remainingMs)}ms ago (expiresAt: ${expiresAt}, currentTime: ${now}).`
            };
        }
        if (ageMs > maxStalenessMs) {
            return {
                state: 'EXPIRED',
                isFresh: false,
                isExecutable: false,
                ageMs,
                remainingMs,
                reason: `QUOTE_STALE: Route age of ${ageMs}ms exceeds maximum staleness threshold of ${maxStalenessMs}ms.`
            };
        }
        if (remainingMs < expiringSoonThresholdMs) {
            return {
                state: 'EXPIRING_SOON',
                isFresh: true,
                isExecutable: true,
                ageMs,
                remainingMs,
                reason: `EXPIRING_SOON: Quote expires in ${remainingMs}ms (below warning threshold of ${expiringSoonThresholdMs}ms).`
            };
        }
        return {
            state: 'FRESH',
            isFresh: true,
            isExecutable: true,
            ageMs,
            remainingMs
        };
    }
}
