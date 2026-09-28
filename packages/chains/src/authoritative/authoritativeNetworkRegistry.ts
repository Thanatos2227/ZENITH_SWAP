import { AuthoritativeNetworkIdentity, AuthoritativeNativeAsset, AuthoritativeGasModelConfig, AuthoritativeFinalityConfig, AuthoritativeRpcMetadata, AuthoritativeExplorerMetadata, NetworkEnvironment, buildNetworkIdentityKey } from './networkIdentity.types';
import { NetworkFamily, NetworkOnboardingState, NetworkCapabilityProfile } from '../capabilities/networkCapabilityTypes';
import { ZENITH_AUTHORITATIVE_NETWORKS } from './networkRegistry.data';
import { NetworkRegistryValidationEngine } from './networkRegistryValidation';
function cloneNativeAsset(asset: AuthoritativeNativeAsset): AuthoritativeNativeAsset {
    return { ...asset };
}
function cloneGasModel(gas: AuthoritativeGasModelConfig): AuthoritativeGasModelConfig {
  return {
    ...gas,
    l2FeeComponents: gas.l2FeeComponents ? { ...gas.l2FeeComponents } : undefined
  };
}
function cloneFinalityModel(fin: AuthoritativeFinalityConfig): AuthoritativeFinalityConfig {
    return { ...fin };
}

function cloneRpcMetadata(rpcs: AuthoritativeRpcMetadata[]): AuthoritativeRpcMetadata[] {
  return rpcs ? rpcs.map((r) => ({ ...r })) : [];
}
function cloneExplorerMetadata(exp: AuthoritativeExplorerMetadata): AuthoritativeExplorerMetadata {
    return { ...exp };
}
function cloneNetworkIdentity(net: AuthoritativeNetworkIdentity): AuthoritativeNetworkIdentity {
  return {
    ...net,
    nativeAsset: cloneNativeAsset(net.nativeAsset),
    gasModel: cloneGasModel(net.gasModel),
    finality: cloneFinalityModel(net.finality),
    rpcEndpoints: cloneRpcMetadata(net.rpcEndpoints),
    explorer: cloneExplorerMetadata(net.explorer),
    aliases: net.aliases ? [...net.aliases] : [],
    dexRegistryReferences: net.dexRegistryReferences ? [...net.dexRegistryReferences] : undefined,
    bridgeRegistryReferences: net.bridgeRegistryReferences ? [...net.bridgeRegistryReferences] : undefined,
    tokenRegistryReferences: net.tokenRegistryReferences ? [...net.tokenRegistryReferences] : undefined
  };
}
export class AuthoritativeNetworkRegistry {
  private networks: Map<string, AuthoritativeNetworkIdentity> = new Map();
  private identityKeyToNetworkId: Map<string, string> = new Map();
  private evmChainIdToNetworkId: Map<number, string> = new Map();
  private aliasToNetworkId: Map<string, string> = new Map();
  private nativeAssets: Map<string, AuthoritativeNativeAsset> = new Map();
  private gasModels: Map<string, AuthoritativeGasModelConfig> = new Map();
  private finalityModels: Map<string, AuthoritativeFinalityConfig> = new Map();
  private rpcMetadata: Map<string, AuthoritativeRpcMetadata[]> = new Map();
  private explorerMetadata: Map<string, AuthoritativeExplorerMetadata> = new Map();
  private networkFamilies: Map<string, NetworkFamily> = new Map();

  constructor(customNetworks?: Record<string, AuthoritativeNetworkIdentity>, skipValidation = false) {
    const initial = customNetworks || ZENITH_AUTHORITATIVE_NETWORKS;

    if (!skipValidation) {
      NetworkRegistryValidationEngine.validateRegistry(initial);
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

    const canonicalId = network.networkId.toLowerCase().trim();
    const cloned = cloneNetworkIdentity(network);

    this.networks.set(canonicalId, cloned);
    this.networkFamilies.set(canonicalId, cloned.family);
    this.nativeAssets.set(canonicalId, cloned.nativeAsset);
    this.gasModels.set(canonicalId, cloned.gasModel);
    this.finalityModels.set(canonicalId, cloned.finality);
    this.rpcMetadata.set(canonicalId, cloned.rpcEndpoints);
    if (cloned.explorer) {
      this.explorerMetadata.set(canonicalId, cloned.explorer);
    }

    // Index composite identity key
    const key = cloned.networkIdentityKey.toLowerCase();
    this.identityKeyToNetworkId.set(key, canonicalId);

    // Index EVM numeric chain ID
    if (cloned.family === 'EVM' && typeof cloned.numericChainId === 'number') {
      this.evmChainIdToNetworkId.set(cloned.numericChainId, canonicalId);
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

    // 2. Composite key match (e.g. "evm:eip155:1")
    const fromKey = this.identityKeyToNetworkId.get(lower);
    if (fromKey) {
      return fromKey;
    }

    // 3. Numeric string match (e.g. "137")
    const num = Number(lower);
    if (!isNaN(num)) {
      const fromEvm = this.evmChainIdToNetworkId.get(num);
      if (fromEvm) return fromEvm;
    }

    // 4. Alias match
    return this.aliasToNetworkId.get(lower);
  }

  /**
   * Validates whether an input represents a known, registered network.
   */
  public validateNetworkIdentity(input: string | number): boolean {
    return this.resolveNetworkIdentity(input) !== undefined;
  }

  /**
   * Retrieves a deep-cloned AuthoritativeNetworkIdentity by networkId or alias.
   */
  public getNetwork(networkIdOrAlias: string | number): AuthoritativeNetworkIdentity | undefined {
    const canonicalId = this.resolveNetworkIdentity(networkIdOrAlias);
    if (!canonicalId) return undefined;
    const net = this.networks.get(canonicalId);
    return net ? cloneNetworkIdentity(net) : undefined;
  }

  /**
   * Retrieves a network by explicit family, namespace, and chainId.
   */
  public getNetworkByChainIdentity(
    family: NetworkFamily,
    namespace: string,
    chainId: string | number
  ): AuthoritativeNetworkIdentity | undefined {
    const key = buildNetworkIdentityKey(family, namespace, chainId).toLowerCase();
    const canonicalId = this.identityKeyToNetworkId.get(key);
    if (!canonicalId) return undefined;
    const net = this.networks.get(canonicalId);
    return net ? cloneNetworkIdentity(net) : undefined;
  }

  /**
   * Retrieves a network by alias.
   */
  public getNetworkByAlias(alias: string): AuthoritativeNetworkIdentity | undefined {
    const lower = alias.toLowerCase().trim();
    const canonicalId = this.aliasToNetworkId.get(lower);
    if (!canonicalId) return undefined;
    const net = this.networks.get(canonicalId);
    return net ? cloneNetworkIdentity(net) : undefined;
  }

  /**
   * Returns all registered networks (deep-cloned).
   */
  public getNetworks(): AuthoritativeNetworkIdentity[] {
    return Array.from(this.networks.values()).map((net) => cloneNetworkIdentity(net));
  }

  /**
   * Returns all networks for a specific family.
   */
  public getNetworksByFamily(family: NetworkFamily): AuthoritativeNetworkIdentity[] {
    return this.getNetworks().filter((net) => net.family === family);
  }

  /**
   * Returns all networks for a specific environment.
   */
  public getNetworksByEnvironment(environment: NetworkEnvironment): AuthoritativeNetworkIdentity[] {
    return this.getNetworks().filter((net) => net.environment === environment);
  }

  /**
   * Returns all mainnet networks.
   */
  public getMainnets(): AuthoritativeNetworkIdentity[] {
    return this.getNetworks().filter((net) => net.isMainnet);
  }

  /**
   * Returns all testnet networks.
   */
  public getTestnets(): AuthoritativeNetworkIdentity[] {
    return this.getNetworks().filter((net) => net.isTestnet);
  }

  /**
   * Retrieves the authoritative native asset metadata for a network.
   */
  public getNativeAsset(networkId: string | number): AuthoritativeNativeAsset | undefined {
    const canonicalId = this.resolveNetworkIdentity(networkId);
    if (!canonicalId) return undefined;
    const asset = this.nativeAssets.get(canonicalId);
    return asset ? cloneNativeAsset(asset) : undefined;
  }

  /**
   * Retrieves the authoritative gas model configuration for a network.
   */
  public getGasModel(networkId: string | number): AuthoritativeGasModelConfig | undefined {
    const canonicalId = this.resolveNetworkIdentity(networkId);
    if (!canonicalId) return undefined;
    const gas = this.gasModels.get(canonicalId);
    return gas ? cloneGasModel(gas) : undefined;
  }

  /**
   * Retrieves the authoritative finality configuration for a network.
   */
  public getFinalityModel(networkId: string | number): AuthoritativeFinalityConfig | undefined {
    const canonicalId = this.resolveNetworkIdentity(networkId);
    if (!canonicalId) return undefined;
    const finality = this.finalityModels.get(canonicalId);
    return finality ? cloneFinalityModel(finality) : undefined;
  }

  /**
   * Retrieves the authoritative RPC metadata for a network.
   */
  public getRpcMetadata(networkId: string | number): AuthoritativeRpcMetadata[] {
    const canonicalId = this.resolveNetworkIdentity(networkId);
    if (!canonicalId) return [];
    const rpcs = this.rpcMetadata.get(canonicalId);
    return rpcs ? cloneRpcMetadata(rpcs) : [];
  }

  /**
   * Retrieves the authoritative explorer configuration for a network.
   */
  public getExplorerMetadata(networkId: string | number): AuthoritativeExplorerMetadata | undefined {
    const canonicalId = this.resolveNetworkIdentity(networkId);
    if (!canonicalId) return undefined;
    const exp = this.explorerMetadata.get(canonicalId);
    return exp ? cloneExplorerMetadata(exp) : undefined;
  }

  /**
   * Retrieves the network family for a registered network.
   */
  public getNetworkFamily(networkIdOrAlias: string | number): NetworkFamily | undefined {
    const canonicalId = this.resolveNetworkIdentity(networkIdOrAlias);
    if (!canonicalId) return undefined;
    return this.networkFamilies.get(canonicalId);
  }

  /**
   * Checks whether a network is registered.
   */
  public isNetworkRegistered(networkId: string | number): boolean {
    return this.resolveNetworkIdentity(networkId) !== undefined;
  }

  /**
   * Checks whether a network is mainnet.
   */
  public isMainnet(networkId: string | number): boolean {
    const canonicalId = this.resolveNetworkIdentity(networkId);
    if (!canonicalId) return false;
    return this.networks.get(canonicalId)?.isMainnet ?? false;
  }

  /**
   * Checks whether a network is testnet.
   */
  public isTestnet(networkId: string | number): boolean {
    const canonicalId = this.resolveNetworkIdentity(networkId);
    if (!canonicalId) return false;
    return this.networks.get(canonicalId)?.isTestnet ?? false;
  }

  /**
   * Links to Phase 2 Task 36 capability profile.
   */
  public getCapabilityProfile(networkId: string | number): NetworkCapabilityProfile | undefined {
    const canonicalId = this.resolveNetworkIdentity(networkId);
    if (!canonicalId) return undefined;
    // Lazy access to defaultNetworkCapabilityRegistry to prevent circular module evaluation
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { defaultNetworkCapabilityRegistry } = require('../capabilities/networkCapabilityRegistry');
      return defaultNetworkCapabilityRegistry.getNetworkCapability(canonicalId);
    } catch {
      return undefined;
    }
  }

  /**
   * Retrieves the onboarding state for a network.
   */
  public getOnboardingState(networkId: string | number): NetworkOnboardingState | undefined {
    const canonicalId = this.resolveNetworkIdentity(networkId);
    if (!canonicalId) return undefined;
    return this.networks.get(canonicalId)?.onboardingState;
  }
}
export const defaultAuthoritativeNetworkRegistry = new AuthoritativeNetworkRegistry();
