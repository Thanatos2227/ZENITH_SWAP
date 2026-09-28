import { NetworkFamily, NetworkEnvironment, AuthoritativeNetworkIdentity, AuthoritativeNativeAsset, AuthoritativeGasModelConfig, AuthoritativeFinalityConfig, AuthoritativeRpcMetadata, AuthoritativeExplorerMetadata, MetadataCompletenessStatus } from '@zenith/types';
export type { NetworkEnvironment, MetadataCompletenessStatus, AuthoritativeNativeAsset, AuthoritativeGasModelConfig, AuthoritativeFinalityConfig, AuthoritativeRpcMetadata, AuthoritativeExplorerMetadata, AuthoritativeNetworkIdentity };
export function buildNetworkIdentityKey(family: NetworkFamily, namespace: string, chainId: string | number): string {
    const normFamily = family.toUpperCase();
    const normNamespace = namespace.toLowerCase().trim();
    const normChainId = String(chainId).toLowerCase().trim();
    return `${normFamily}:${normNamespace}:${normChainId}`;
}
export function parseNetworkIdentityKey(key: string): {
    family: NetworkFamily;
    namespace: string;
    chainId: string;
} {
    const parts = key.split(':');
    if (parts.length < 3) {
        throw new Error(`Invalid NetworkIdentityKey format "${key}". Expected "family:namespace:chainId"`);
    }
    const family = parts[0].toUpperCase() as NetworkFamily;
    const namespace = parts[1].toLowerCase();
    const chainId = parts.slice(2).join(':');
    return { family, namespace, chainId };
}
