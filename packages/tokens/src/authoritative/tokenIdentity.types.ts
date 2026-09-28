import type { TokenIdentity, TokenStandard, TokenAssetType, TokenVerificationState, TokenVerificationDimensions, TokenMetadataStatus, TokenOnboardingState, TokenMetadata, NativeAssetIdentity, TokenResolutionInput, TokenResolutionResult, TokenResolutionStatus, TokenConflictCategory, TokenConflictType, TokenConflictEvaluation, CapabilityLevel, NetworkFamily } from '@zenith/types';
export type { TokenIdentity, TokenStandard, TokenAssetType, TokenVerificationState, TokenVerificationDimensions, TokenMetadataStatus, TokenOnboardingState, TokenMetadata, NativeAssetIdentity, TokenResolutionInput, TokenResolutionResult, TokenResolutionStatus, TokenConflictCategory, TokenConflictType, TokenConflictEvaluation, CapabilityLevel, NetworkFamily };
export function buildTokenIdentityKey(networkIdentityKey: string, standard: TokenStandard, identifier: string): string {
    if (!networkIdentityKey || typeof networkIdentityKey !== 'string') {
        throw new Error('buildTokenIdentityKey: networkIdentityKey must be a non-empty string');
    }
    if (!standard || typeof standard !== 'string') {
        throw new Error('buildTokenIdentityKey: standard must be a non-empty TokenStandard');
    }
    if (!identifier || typeof identifier !== 'string') {
        throw new Error('buildTokenIdentityKey: identifier must be a non-empty string');
    }
    const cleanNetKey = networkIdentityKey.trim();
    const cleanStandard = standard.trim();
    const cleanId = standard === 'NATIVE' ? identifier.trim().toUpperCase() : identifier.trim().toLowerCase();
    return `${cleanNetKey}:${cleanStandard}:${cleanId}`;
}
export function parseTokenIdentityKey(key: string): {
    networkIdentityKey: string;
    standard: TokenStandard;
    identifier: string;
} {
    if (!key || typeof key !== 'string') {
        throw new Error('parseTokenIdentityKey: key must be a non-empty string');
    }
    const parts = key.trim().split(':');
    if (parts.length < 5) {
        throw new Error(`parseTokenIdentityKey: Invalid token identity key format "${key}". Expected at least 5 segments (FAMILY:namespace:chainId:standard:identifier)`);
    }
    const networkIdentityKey = `${parts[0]}:${parts[1]}:${parts[2]}`;
    const standard = parts[3] as TokenStandard;
    const identifier = parts.slice(4).join(':');
    return {
        networkIdentityKey,
        standard,
        identifier
    };
}
export function buildTokenId(networkId: string, standard: TokenStandard, identifier: string): string {
    if (!networkId || !standard || !identifier) {
        throw new Error('buildTokenId: networkId, standard, and identifier are all required');
    }
    const cleanNet = networkId.trim().toLowerCase();
    const cleanStandard = standard.trim().toLowerCase();
    const cleanId = identifier.trim().toLowerCase();
    return `${cleanNet}:${cleanStandard}:${cleanId}`;
}
