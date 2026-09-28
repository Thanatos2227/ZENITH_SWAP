import type { DexIdentity, DexProtocolTaxonomy, DexPoolDiscoveryMethod, DexStatus, DexVerificationStatus, DexOnboardingState, DexAddressRole, QuoteFreshnessState, AuthoritativeDexQuote, DexSwapTransaction, DexCapabilities, DexPairValidationResult, DexPoolDiscoveryResult, DexPoolState, DexLiquidityState, DexDeploymentVerificationResult, DexSimulationResult, DexConflictCategory, DexConflictType, DexConflictEvaluation, DexResolutionInput, DexResolutionResult, DexValidationResult, NetworkFamily, Token, TokenIdentity } from '@zenith/types';
export type { DexIdentity, DexProtocolTaxonomy, DexPoolDiscoveryMethod, DexStatus, DexVerificationStatus, DexOnboardingState, DexAddressRole, QuoteFreshnessState, AuthoritativeDexQuote, DexSwapTransaction, DexCapabilities, DexPairValidationResult, DexPoolDiscoveryResult, DexPoolState, DexLiquidityState, DexDeploymentVerificationResult, DexSimulationResult, DexConflictCategory, DexConflictType, DexConflictEvaluation, DexResolutionInput, DexResolutionResult, DexValidationResult };
export function buildDexIdentityKey(networkIdentityKey: string, protocol: string, version: string, deploymentId: string): string {
    if (!networkIdentityKey || typeof networkIdentityKey !== 'string') {
        throw new Error('buildDexIdentityKey: networkIdentityKey must be a non-empty string');
    }
    if (!protocol || typeof protocol !== 'string') {
        throw new Error('buildDexIdentityKey: protocol must be a non-empty string');
    }
    if (!version || typeof version !== 'string') {
        throw new Error('buildDexIdentityKey: version must be a non-empty string');
    }
    if (!deploymentId || typeof deploymentId !== 'string') {
        throw new Error('buildDexIdentityKey: deploymentId must be a non-empty string');
    }
    const cleanNetKey = networkIdentityKey.trim();
    const cleanProtocol = protocol.trim().toUpperCase();
    const cleanVersion = version.trim().toUpperCase();
    const cleanDeploymentId = deploymentId.trim().toLowerCase();
    return `${cleanNetKey}:${cleanProtocol}:${cleanVersion}:${cleanDeploymentId}`;
}
export function parseDexIdentityKey(key: string): {
    networkIdentityKey: string;
    family: NetworkFamily;
    namespace: string;
    chainId: string;
    protocol: string;
    version: string;
    deploymentId: string;
} {
    if (!key || typeof key !== 'string') {
        throw new Error('parseDexIdentityKey: key must be a non-empty string');
    }
    const parts = key.trim().split(':');
    if (parts.length < 6) {
        throw new Error(`parseDexIdentityKey: Malformed DEX identity key format "${key}". Expected at least 6 segments (FAMILY:namespace:chainId:PROTOCOL:VERSION:deploymentId)`);
    }
    const family = parts[0].toUpperCase() as NetworkFamily;
    const namespace = parts[1].toLowerCase();
    const chainId = parts[2];
    const networkIdentityKey = `${family}:${namespace}:${chainId}`;
    const protocol = parts[3];
    const version = parts[4];
    const deploymentId = parts.slice(5).join(':');
    return {
        networkIdentityKey,
        family,
        namespace,
        chainId,
        protocol,
        version,
        deploymentId
    };
}
export function buildDexId(networkId: string, protocol: string, version: string): string {
    if (!networkId || !protocol || !version) {
        throw new Error('buildDexId: networkId, protocol, and version are all required');
    }
    const cleanNet = networkId.trim().toLowerCase();
    const cleanProt = protocol.trim().toLowerCase();
    const cleanVer = version.trim().toLowerCase();
    return `${cleanNet}:${cleanProt}-${cleanVer}`;
}
export function getTokenAddress(token: TokenIdentity | Token): string {
    if (!token)
        return '';
    return token.address || (token as any).normalizedAddress || '';
}
export function toLegacyToken(token: TokenIdentity | Token, chainId?: string | number): Token {
    if ('chainId' in token && typeof (token as any).verificationTier === 'string') {
        return token as Token;
    }
    const addr = getTokenAddress(token);
    return {
        address: addr,
        chainId: String(chainId || (token as any).networkId || '1'),
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        isNative: Boolean((token as any).isNative || (token as any).standard === 'NATIVE'),
        wrappedAddress: (token as any).wrappedAddress,
        verificationTier: ((token as any).verificationTier || 'VERIFIED') as any
    };
}
