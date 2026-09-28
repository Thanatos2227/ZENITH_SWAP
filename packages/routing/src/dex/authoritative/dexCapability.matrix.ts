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
export function getDexCapabilityRank(cap: CapabilityLevel): number {
    return DEX_CAPABILITY_RANK[cap] ?? 0;
}
export function isDexCapabilityAtLeast(current: CapabilityLevel, minimum: CapabilityLevel): boolean {
    return getDexCapabilityRank(current) >= getDexCapabilityRank(minimum);
}
export function compareCapabilityLevels(a: CapabilityLevel, b: CapabilityLevel): number {
    return getDexCapabilityRank(a) - getDexCapabilityRank(b);
}
export function isCapabilityAtLeast(current: CapabilityLevel, minimum: CapabilityLevel): boolean {
    return isDexCapabilityAtLeast(current, minimum);
}
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
    let maxVerificationRank = 2;
    if (params.verificationStatus === 'CONTRACT_PRESENT') {
        maxVerificationRank = 3;
    }
    else if (params.verificationStatus === 'EXPECTED_INTERFACE') {
        maxVerificationRank = 4;
    }
    else if (params.verificationStatus === 'VERIFIED_DEPLOYMENT') {
        maxVerificationRank = 5;
    }
    else if (params.isAddressVerified === true) {
        maxVerificationRank = 5;
    }
    else if (params.isAddressVerified === false) {
        maxVerificationRank = 2;
    }
    const effectiveRank = Math.min(dexRank, netRank, tokenInRank, tokenOutRank, rpcRank, maxVerificationRank);
    return RANK_TO_DEX_CAPABILITY[effectiveRank] || 'UNSUPPORTED';
}
