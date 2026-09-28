import { AuthoritativeNetworkIdentity, AuthoritativeNativeAsset, AuthoritativeGasModelConfig, AuthoritativeFinalityConfig, AuthoritativeRpcMetadata, AuthoritativeExplorerMetadata, NetworkEnvironment, buildNetworkIdentityKey } from './networkIdentity.types';
import { NetworkFamily, NetworkOnboardingState, NetworkCapabilityProfile } from '../capabilities/networkCapabilityTypes';
import { ZENITH_AUTHORITATIVE_NETWORKS } from './networkRegistry.data';
import { NetworkRegistryValidationEngine } from './networkRegistryValidation';
function cloneNativeAsset(asset: AuthoritativeNativeAsset): AuthoritativeNativeAsset {
    return { ...asset };
}
function cloneGasModel(gas: AuthoritativeGasModelConfig): AuthoritativeGasModelConfig {
    return { ...gas };
}
function cloneFinalityModel(fin: AuthoritativeFinalityConfig): AuthoritativeFinalityConfig {
    return { ...fin };
}
function cloneRpcMetadata(rpc: AuthoritativeRpcMetadata): AuthoritativeRpcMetadata {
    return { ...rpc };
}
function cloneExplorerMetadata(exp: AuthoritativeExplorerMetadata): AuthoritativeExplorerMetadata {
    return { ...exp };
}
function cloneNetworkIdentity(net: AuthoritativeNetworkIdentity): AuthoritativeNetworkIdentity {
    return {
        ...net,
        aliases: net.aliases ? [...net.aliases] : [],
        nativeAsset: cloneNativeAsset(net.nativeAsset),
        gasModel: cloneGasModel(net.gasModel),
        finality: cloneFinalityModel(net.finality),
        rpcEndpoints: net.rpcEndpoints ? net.rpcEndpoints.map(cloneRpcMetadata) : [],
        explorer: cloneExplorerMetadata(net.explorer)
    };
}
export class AuthoritativeNetworkRegistry {
    private networks: Map<string, AuthoritativeNetworkIdentity> = new Map();
    private identityKeyToNetworkId: Map<string, string> = new Map();
    private evmChainIdToNetworkId: Map<number, string> = new Map();
    private aliasToNetworkId: Map<string, string> = new Map();
    constructor(customNetworks?: Record<string, AuthoritativeNetworkIdentity>, skipValidation = false) {
        const initial = customNetworks || ZENITH_AUTHORITATIVE_NETWORKS;
        if (!skipValidation) {
            NetworkRegistryValidationEngine.validateRegistry(initial);
        }
        for (const net of Object.values(initial)) {
            this.registerNetwork(net, true);
        }
    }
    public registerNetwork(network: AuthoritativeNetworkIdentity, skipValidation = false): void {
        if (!skipValidation) {
            NetworkRegistryValidationEngine.validateRegistry({ [network.networkId]: network });
        }
        const canonicalId = network.networkId.toLowerCase().trim();
        const cloned = cloneNetworkIdentity(network);
        this.networks.set(canonicalId, cloned);
        const key = cloned.networkIdentityKey.toLowerCase();
        this.identityKeyToNetworkId.set(key, canonicalId);
        if (cloned.family === 'EVM' && typeof cloned.numericChainId === 'number') {
            this.evmChainIdToNetworkId.set(cloned.numericChainId, canonicalId);
        }
        if (Array.isArray(cloned.aliases)) {
            for (const alias of cloned.aliases) {
                const lowerAlias = alias.toLowerCase().trim();
                if (lowerAlias) {
                    this.aliasToNetworkId.set(lowerAlias, canonicalId);
                }
            }
        }
    }
    public resolveNetworkIdentity(input: string | number): string | undefined {
        if (typeof input === 'number') {
            return this.evmChainIdToNetworkId.get(input);
        }
        if (!input || typeof input !== 'string')
            return undefined;
        const lower = input.toLowerCase().trim();
        if (this.networks.has(lower)) {
            return lower;
        }
        if (this.identityKeyToNetworkId.has(lower)) {
            return this.identityKeyToNetworkId.get(lower);
        }
        const num = Number(lower);
        if (!isNaN(num) && this.evmChainIdToNetworkId.has(num)) {
            return this.evmChainIdToNetworkId.get(num);
        }
        if (this.aliasToNetworkId.has(lower)) {
            return this.aliasToNetworkId.get(lower);
        }
        return undefined;
    }
    public validateNetworkIdentity(input: string | number): boolean {
        return this.resolveNetworkIdentity(input) !== undefined;
    }
    public getNetworkFamily(networkIdOrAlias: string | number): NetworkFamily | undefined {
        const canonicalId = this.resolveNetworkIdentity(networkIdOrAlias);
        if (!canonicalId)
            return undefined;
        return this.networks.get(canonicalId)?.family;
    }
    public getNetwork(networkIdOrAlias: string | number): AuthoritativeNetworkIdentity | undefined {
        const canonicalId = this.resolveNetworkIdentity(networkIdOrAlias);
        if (!canonicalId)
            return undefined;
        const net = this.networks.get(canonicalId);
        return net ? cloneNetworkIdentity(net) : undefined;
    }
    public getNetworkByChainIdentity(family: NetworkFamily, namespace: string, chainId: string | number): AuthoritativeNetworkIdentity | undefined {
        const key = buildNetworkIdentityKey(family, namespace, chainId).toLowerCase();
        const canonicalId = this.identityKeyToNetworkId.get(key);
        if (!canonicalId)
            return undefined;
        const net = this.networks.get(canonicalId);
        return net ? cloneNetworkIdentity(net) : undefined;
    }
    public getNetworkByAlias(alias: string): AuthoritativeNetworkIdentity | undefined {
        const lower = alias.toLowerCase().trim();
        const canonicalId = this.aliasToNetworkId.get(lower);
        if (!canonicalId)
            return undefined;
        const net = this.networks.get(canonicalId);
        return net ? cloneNetworkIdentity(net) : undefined;
    }
    public getNetworks(): AuthoritativeNetworkIdentity[] {
        return Array.from(this.networks.values()).map((net) => cloneNetworkIdentity(net));
    }
    public getNetworksByFamily(family: NetworkFamily): AuthoritativeNetworkIdentity[] {
        return this.getNetworks().filter((net) => net.family === family);
    }
    public getNetworksByEnvironment(environment: NetworkEnvironment): AuthoritativeNetworkIdentity[] {
        return this.getNetworks().filter((net) => net.environment === environment);
    }
    public getMainnets(): AuthoritativeNetworkIdentity[] {
        return this.getNetworks().filter((net) => net.isMainnet);
    }
    public getTestnets(): AuthoritativeNetworkIdentity[] {
        return this.getNetworks().filter((net) => net.isTestnet);
    }
    public getNativeAsset(networkId: string | number): AuthoritativeNativeAsset | undefined {
        const canonicalId = this.resolveNetworkIdentity(networkId);
        if (!canonicalId)
            return undefined;
        const net = this.networks.get(canonicalId);
        return net ? cloneNativeAsset(net.nativeAsset) : undefined;
    }
    public getGasModel(networkId: string | number): AuthoritativeGasModelConfig | undefined {
        const canonicalId = this.resolveNetworkIdentity(networkId);
        if (!canonicalId)
            return undefined;
        const net = this.networks.get(canonicalId);
        return net ? cloneGasModel(net.gasModel) : undefined;
    }
    public getFinalityModel(networkId: string | number): AuthoritativeFinalityConfig | undefined {
        const canonicalId = this.resolveNetworkIdentity(networkId);
        if (!canonicalId)
            return undefined;
        const net = this.networks.get(canonicalId);
        return net ? cloneFinalityModel(net.finality) : undefined;
    }
    public getRpcMetadata(networkId: string | number): AuthoritativeRpcMetadata[] {
        const canonicalId = this.resolveNetworkIdentity(networkId);
        if (!canonicalId)
            return [];
        const net = this.networks.get(canonicalId);
        return net && net.rpcEndpoints ? net.rpcEndpoints.map(cloneRpcMetadata) : [];
    }
    public getExplorerMetadata(networkId: string | number): AuthoritativeExplorerMetadata | undefined {
        const canonicalId = this.resolveNetworkIdentity(networkId);
        if (!canonicalId)
            return undefined;
        const net = this.networks.get(canonicalId);
        return net ? cloneExplorerMetadata(net.explorer) : undefined;
    }
    public isNetworkRegistered(networkId: string | number): boolean {
        return this.resolveNetworkIdentity(networkId) !== undefined;
    }
    public isMainnet(networkId: string | number): boolean {
        const net = this.getNetwork(networkId);
        return net ? net.isMainnet : false;
    }
    public isTestnet(networkId: string | number): boolean {
        const net = this.getNetwork(networkId);
        return net ? net.isTestnet : false;
    }
    public getCapabilityProfile(networkId: string | number): NetworkCapabilityProfile | undefined {
        const canonicalId = this.resolveNetworkIdentity(networkId);
        if (!canonicalId)
            return undefined;
        try {
            const { defaultNetworkCapabilityRegistry } = require('../capabilities/networkCapabilityRegistry');
            return defaultNetworkCapabilityRegistry.getNetworkCapability(canonicalId);
        }
        catch {
            return undefined;
        }
    }
    public getOnboardingState(networkId: string | number): NetworkOnboardingState | undefined {
        const net = this.getNetwork(networkId);
        return net ? net.onboardingState : undefined;
    }
}
export const defaultAuthoritativeNetworkRegistry = new AuthoritativeNetworkRegistry();
