import { RouteFreshnessState } from '@zenith/types';

export interface FreshnessValidationOptions {
  currentTime?: number;
  maxStalenessMs?: number;          // Default 60,000ms (1 minute)
  expiringSoonThresholdMs?: number; // Default 15,000ms (15 seconds)
  maxAllowedClockSkewMs?: number;   // Default 5,000ms (5 seconds into future)
}

export interface FreshnessValidationResult {
  state: RouteFreshnessState;
  isFresh: boolean;
  isExecutable: boolean;
  ageMs: number;
  remainingMs: number;
  reason?: string;
}

export const DEFAULT_MAX_STALENESS_MS = 60_000;
export const DEFAULT_EXPIRING_SOON_THRESHOLD_MS = 15_000;
export const DEFAULT_MAX_CLOCK_SKEW_MS = 5_000;

export class RouteFreshnessValidator {
  /**
   * Evaluates the temporal freshness of a quote or route.
   * Fails closed: Missing or invalid timestamps are classified as UNKNOWN and rejected.
   */
  public static validate(
    quotedAt: number | undefined | null,
    expiresAt: number | undefined | null,
    options?: FreshnessValidationOptions
  ): FreshnessValidationResult {
    const now = options?.currentTime ?? Date.now();
    const maxStalenessMs = options?.maxStalenessMs ?? DEFAULT_MAX_STALENESS_MS;
    const expiringSoonThresholdMs = options?.expiringSoonThresholdMs ?? DEFAULT_EXPIRING_SOON_THRESHOLD_MS;
    const maxClockSkewMs = options?.maxAllowedClockSkewMs ?? DEFAULT_MAX_CLOCK_SKEW_MS;

    // 1. Missing timestamp check
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

    // 2. Future-dated invalid timestamp check (clock skew violation)
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

    // 3. Expired check
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

    // 4. Stale quote check (exceeds max age threshold even if expiration timestamp is distant)
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

    // 5. Expiring soon check
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

    // 6. Healthy fresh quote
    return {
      state: 'FRESH',
      isFresh: true,
      isExecutable: true,
      ageMs,
      remainingMs
    };
  }
}
