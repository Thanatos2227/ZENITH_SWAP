/**
 * @file authoritativeNetworkRegistry.ts
 * @package @zenith/chains
 *
 * Authoritative Canonical Network Registry for ZENITH.
 * Serves as the single authoritative source of truth for network identities,
 * chain namespaces, environments, gas models, finality, and explorer metadata.
 * Guarantees collision-free lookup and deep-cloned immutability.
 */

import {
  AuthoritativeNetworkIdentity,
  AuthoritativeNativeAsset,
  AuthoritativeGasModelConfig,
  AuthoritativeFinalityConfig,
  AuthoritativeRpcMetadata,
  AuthoritativeExplorerMetadata,
  NetworkEnvironment,
  buildNetworkIdentityKey
} from './networkIdentity.types';
import {
  NetworkFamily,
  NetworkOnboardingState,
  NetworkCapabilityProfile
} from '../capabilities/networkCapabilityTypes';
import { ZENITH_AUTHORITATIVE_NETWORKS } from './networkRegistry.data';
import { NetworkRegistryValidationEngine } from './networkRegistryValidation';

function deepClone<T>(obj: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
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

  /**
   * Registers an AuthoritativeNetworkIdentity record into memory.
   */
  public registerNetwork(network: AuthoritativeNetworkIdentity, skipValidation = false): void {
    if (!skipValidation) {
      NetworkRegistryValidationEngine.validateRegistry({ [network.networkId]: network });
    }

    const canonicalId = network.networkId.toLowerCase().trim();
    const cloned = deepClone(network);

    this.networks.set(canonicalId, cloned);

    // Index composite identity key
    const key = cloned.networkIdentityKey.toLowerCase();
    this.identityKeyToNetworkId.set(key, canonicalId);

    // Index EVM numeric chain ID
    if (cloned.family === 'EVM' && typeof cloned.numericChainId === 'number') {
      this.evmChainIdToNetworkId.set(cloned.numericChainId, canonicalId);
    }

    // Index aliases
    if (Array.isArray(cloned.aliases)) {
      for (const alias of cloned.aliases) {
        const lowerAlias = alias.toLowerCase().trim();
        if (lowerAlias) {
          this.aliasToNetworkId.set(lowerAlias, canonicalId);
        }
      }
    }
  }

  /**
   * Resolves an arbitrary input (networkId, alias, composite key, or numeric EVM chain ID)
   * to a canonical networkId.
   */
  public resolveNetworkIdentity(input: string | number): string | undefined {
    if (typeof input === 'number') {
      return this.evmChainIdToNetworkId.get(input);
    }

    if (!input || typeof input !== 'string') return undefined;

    const lower = input.toLowerCase().trim();

    // 1. Direct networkId match
    if (this.networks.has(lower)) {
      return lower;
    }

    // 2. Composite key match (e.g. "evm:eip155:1")
    if (this.identityKeyToNetworkId.has(lower)) {
      return this.identityKeyToNetworkId.get(lower);
    }

    // 3. Numeric string match (e.g. "137")
    const num = Number(lower);
    if (!isNaN(num) && this.evmChainIdToNetworkId.has(num)) {
      return this.evmChainIdToNetworkId.get(num);
    }

    // 4. Alias match
    if (this.aliasToNetworkId.has(lower)) {
      return this.aliasToNetworkId.get(lower);
    }

    return undefined;
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
    return net ? deepClone(net) : undefined;
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
    return this.getNetwork(canonicalId);
  }

  /**
   * Retrieves a network by alias.
   */
  public getNetworkByAlias(alias: string): AuthoritativeNetworkIdentity | undefined {
    const lower = alias.toLowerCase().trim();
    const canonicalId = this.aliasToNetworkId.get(lower);
    if (!canonicalId) return undefined;
    return this.getNetwork(canonicalId);
  }

  /**
   * Returns all registered networks (deep-cloned).
   */
  public getNetworks(): AuthoritativeNetworkIdentity[] {
    return Array.from(this.networks.values()).map((net) => deepClone(net));
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
    const net = this.getNetwork(networkId);
    return net ? deepClone(net.nativeAsset) : undefined;
  }

  /**
   * Retrieves the authoritative gas model configuration for a network.
   */
  public getGasModel(networkId: string | number): AuthoritativeGasModelConfig | undefined {
    const net = this.getNetwork(networkId);
    return net ? deepClone(net.gasModel) : undefined;
  }

  /**
   * Retrieves the authoritative finality configuration for a network.
   */
  public getFinalityModel(networkId: string | number): AuthoritativeFinalityConfig | undefined {
    const net = this.getNetwork(networkId);
    return net ? deepClone(net.finality) : undefined;
  }

  /**
   * Retrieves the authoritative RPC metadata for a network.
   */
  public getRpcMetadata(networkId: string | number): AuthoritativeRpcMetadata[] {
    const net = this.getNetwork(networkId);
    return net ? deepClone(net.rpcEndpoints) : [];
  }

  /**
   * Retrieves the authoritative explorer configuration for a network.
   */
  public getExplorerMetadata(networkId: string | number): AuthoritativeExplorerMetadata | undefined {
    const net = this.getNetwork(networkId);
    return net ? deepClone(net.explorer) : undefined;
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
    const net = this.getNetwork(networkId);
    return net ? net.isMainnet : false;
  }

  /**
   * Checks whether a network is testnet.
   */
  public isTestnet(networkId: string | number): boolean {
    const net = this.getNetwork(networkId);
    return net ? net.isTestnet : false;
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
    const net = this.getNetwork(networkId);
    return net ? net.onboardingState : undefined;
  }
}

/**
 * Singleton instance of the Authoritative Network Registry.
 */
export const defaultAuthoritativeNetworkRegistry = new AuthoritativeNetworkRegistry();
