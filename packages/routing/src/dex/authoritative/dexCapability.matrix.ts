/**
 * @file dexCapability.matrix.ts
 * @package @zenith/routing
 *
 * DEX Capability Hierarchy & Bounds Enforcement.
 * Preserves the invariant:
 * DEX capability <= network capability + token capability + RPC capability + DEX verification evidence.
 */

import type { CapabilityLevel, DexVerificationStatus } from '@zenith/types';

export const DEX_CAPABILITY_RANK: Record<CapabilityLevel, number> = {
  UNSUPPORTED: 0,
  UNIT_TESTED: 1,
  CONFIGURED: 2,
  QUOTE_AVAILABLE: 3,
  EXECUTION_AVAILABLE: 4,
  LIVE_VERIFIED: 5
};

export const RANK_TO_DEX_CAPABILITY: Record<number, CapabilityLevel> = {
  0: 'UNSUPPORTED',
  1: 'UNIT_TESTED',
  2: 'CONFIGURED',
  3: 'QUOTE_AVAILABLE',
  4: 'EXECUTION_AVAILABLE',
  5: 'LIVE_VERIFIED'
};

/**
 * Returns numeric rank for capability comparison.
 */
export function getDexCapabilityRank(cap: CapabilityLevel): number {
  return DEX_CAPABILITY_RANK[cap] ?? 0;
}

/**
 * Returns true if current capability is at least required capability.
 */
export function isDexCapabilityAtLeast(current: CapabilityLevel, minimum: CapabilityLevel): boolean {
  return getDexCapabilityRank(current) >= getDexCapabilityRank(minimum);
}

export function compareCapabilityLevels(a: CapabilityLevel, b: CapabilityLevel): number {
  return getDexCapabilityRank(a) - getDexCapabilityRank(b);
}

export function isCapabilityAtLeast(current: CapabilityLevel, minimum: CapabilityLevel): boolean {
  return isDexCapabilityAtLeast(current, minimum);
}

/**
 * Enforces the critical rule:
 * DEX capability must NEVER exceed:
 * network capability + token capability + RPC capability + DEX verification evidence.
 *
 * A configured router address does not equal EXECUTION_AVAILABLE.
 */
export function computeBoundedDexCapability(params: {
  declaredDexCapability?: CapabilityLevel;
  dexCapability?: CapabilityLevel;
  networkCapability: CapabilityLevel;
  tokenInCapability: CapabilityLevel;
  tokenOutCapability: CapabilityLevel;
  rpcCapability?: CapabilityLevel;
  verificationStatus?: DexVerificationStatus;
  isAddressVerified?: boolean;
}): CapabilityLevel {
  const declared = params.declaredDexCapability || params.dexCapability || 'UNSUPPORTED';
  const dexRank = getDexCapabilityRank(declared);
  const netRank = getDexCapabilityRank(params.networkCapability);
  const tokenInRank = getDexCapabilityRank(params.tokenInCapability);
  const tokenOutRank = getDexCapabilityRank(params.tokenOutCapability);
  const rpcRank = params.rpcCapability ? getDexCapabilityRank(params.rpcCapability) : 5;

  // Maximum capability allowed by verification status evidence:
  let maxVerificationRank = 2; // UNVERIFIED or ADDRESS_EXISTS can never exceed CONFIGURED
  if (params.verificationStatus === 'CONTRACT_PRESENT') {
    maxVerificationRank = 3; // QUOTE_AVAILABLE
  } else if (params.verificationStatus === 'EXPECTED_INTERFACE') {
    maxVerificationRank = 4; // EXECUTION_AVAILABLE
  } else if (params.verificationStatus === 'VERIFIED_DEPLOYMENT') {
    maxVerificationRank = 5; // LIVE_VERIFIED
  } else if (params.isAddressVerified === true) {
    maxVerificationRank = 5;
  } else if (params.isAddressVerified === false) {
    maxVerificationRank = 2;
  }

  // Capability bounded by the minimum of all required dimensions
  const effectiveRank = Math.min(
    dexRank,
    netRank,
    tokenInRank,
    tokenOutRank,
    rpcRank,
    maxVerificationRank
  );

  return RANK_TO_DEX_CAPABILITY[effectiveRank] || 'UNSUPPORTED';
}
