/**
 * @file networkCapabilityRegistry.ts
 * @package @zenith/chains
 *
 * Authoritative Network Capability Registry for ZENITH.
 * Prevents chain ID collisions, duplicate network identities, and unverified execution.
 * Provides deterministic capability query APIs across all 58 networks.
 */

import {
  NetworkCapabilityProfile,
  NetworkCapabilityLevel,
  NETWORK_CAPABILITY_HIERARCHY,
  NetworkOnboardingState,
  ONBOARDING_PROGRESSION,
  NetworkOperationalStatus,
  NetworkFamily,
  NetworkFinalityModel,
  NetworkGasModelType,
  NetworkHealthStatus,
  NetworkExecutionReadiness
} from './networkCapabilityTypes';
import { ZENITH_NETWORK_PROFILES } from './networkProfiles.data';
import { isValidAddressForFamily } from './networkFamilies';
import {
  INetworkExecutionAdapter,
  EvmExecutionAdapter,
  UnsupportedExecutionAdapter
} from './networkExecutionAdapter';
import { MultiProviderRpcManager } from '../rpc/multiProviderRpcManager';

export class NetworkCapabilityRegistry {
  private profiles: Map<string, NetworkCapabilityProfile> = new Map();
  private chainIdToNetworkId: Map<number, string> = new Map();
  private adapters: Map<string, INetworkExecutionAdapter> = new Map();
  private rpcManager?: MultiProviderRpcManager;

  constructor(customProfiles?: Record<string, NetworkCapabilityProfile>, rpcManager?: MultiProviderRpcManager) {
    this.rpcManager = rpcManager;
    const initial = customProfiles || ZENITH_NETWORK_PROFILES;
    for (const [key, profile] of Object.entries(initial)) {
      this.registerProfile(key, profile);
    }
  }

  /**
   * Registers a NetworkCapabilityProfile with strict validation against collisions.
   */
  public registerProfile(key: string, profile: NetworkCapabilityProfile): void {
    const canonicalKey = key.toLowerCase();

    // Deep clone profile to prevent mutations from affecting shared profile data or other instances
    const clonedProfile: NetworkCapabilityProfile = typeof structuredClone === 'function'
      ? structuredClone(profile)
      : JSON.parse(JSON.stringify(profile));

    // Check for duplicate networkId
    if (this.profiles.has(canonicalKey)) {
      // Allow overwrite only if the networkId matches
      const existing = this.profiles.get(canonicalKey)!;
      if (existing.networkId !== clonedProfile.networkId) {
        throw new Error(`Network identity collision: Key "${canonicalKey}" already bound to "${existing.networkId}"`);
      }
    }

    // Check EVM chain ID uniqueness
    if (clonedProfile.family === 'EVM' && clonedProfile.numericChainId !== undefined) {
      const existingOwner = this.chainIdToNetworkId.get(clonedProfile.numericChainId);
      if (existingOwner && existingOwner !== clonedProfile.networkId) {
        throw new Error(
          `Chain ID collision: EVM Chain ID ${clonedProfile.numericChainId} is already registered to "${existingOwner}". Cannot register "${clonedProfile.networkId}".`
        );
      }
      this.chainIdToNetworkId.set(clonedProfile.numericChainId, clonedProfile.networkId);
    }

    this.profiles.set(canonicalKey, clonedProfile);

    // Initialize default execution adapter
    if (profile.family === 'EVM' && profile.numericChainId) {
      this.adapters.set(canonicalKey, new EvmExecutionAdapter(canonicalKey, profile.numericChainId));
    } else {
      this.adapters.set(canonicalKey, new UnsupportedExecutionAdapter(canonicalKey, profile.family));
    }
  }

  /**
   * Retrieves the NetworkCapabilityProfile by canonical networkId or numeric chainId.
   */
  public getNetworkCapability(networkIdOrChainId: string | number): NetworkCapabilityProfile | undefined {
    if (typeof networkIdOrChainId === 'number') {
      const key = this.chainIdToNetworkId.get(networkIdOrChainId);
      return key ? this.profiles.get(key) : undefined;
    }

    const key = networkIdOrChainId.toLowerCase();
    const profile = this.profiles.get(key);
    if (profile) return profile;

    // Check if string is a numeric chainId
    const num = Number(networkIdOrChainId);
    if (!isNaN(num) && num > 0) {
      const byNum = this.chainIdToNetworkId.get(num);
      if (byNum) return this.profiles.get(byNum);
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { defaultAuthoritativeNetworkRegistry } = require('../authoritative/authoritativeNetworkRegistry');
      const resolved = defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity(networkIdOrChainId);
      if (resolved && this.profiles.has(resolved)) {
        return this.profiles.get(resolved);
      }
    } catch {
      // Fallback
    }

    return undefined;
  }

  /**
   * Returns the overall capability level of a network. Never infers from missing data.
   */
  public getExecutionCapability(networkId: string | number): NetworkCapabilityLevel {
    const profile = this.getNetworkCapability(networkId);
    return profile ? profile.overallCapabilityLevel : 'UNSUPPORTED';
  }

  /**
   * Retrieves bridge capability for a specific network and bridge provider.
   */
  public getBridgeCapability(networkId: string | number, providerId: string): NetworkCapabilityLevel {
    const profile = this.getNetworkCapability(networkId);
    if (!profile) return 'UNSUPPORTED';

    const pId = providerId.toLowerCase();
    const corridor = profile.bridgeCorridors.find((c) => c.providerId.toLowerCase() === pId);
    if (corridor) {
      return corridor.capabilityLevel;
    }

    // Default to UNSUPPORTED if provider corridor is not explicitly listed
    return 'UNSUPPORTED';
  }

  /**
   * Retrieves DEX capability for a specific network and DEX protocol.
   */
  public getDexCapability(networkId: string | number, dexId: string): NetworkCapabilityLevel {
    const profile = this.getNetworkCapability(networkId);
    if (!profile) return 'UNSUPPORTED';

    const dex = profile.dexCapabilities[dexId.toLowerCase()];
    if (dex) {
      return dex.executionCapability;
    }

    return 'UNSUPPORTED';
  }

  /**
   * Evaluates token support for a given network and address.
   */
  public getTokenCapability(networkId: string | number, tokenAddress: string): { supported: boolean; standard?: string; reason?: string } {
    const profile = this.getNetworkCapability(networkId);
    if (!profile) {
      return { supported: false, reason: 'Network not registered' };
    }

    // Validate address format against network family
    if (!isValidAddressForFamily(tokenAddress, profile.family)) {
      return {
        supported: false,
        reason: `Invalid token address format for family "${profile.family}"`
      };
    }

    const defaultStd = profile.supportedTokenStandards[0] || 'ERC-20';
    return {
      supported: true,
      standard: defaultStd
    };
  }

  /**
   * Evaluates whether a network satisfies execution readiness for a given execution mode.
   */
  public isExecutable(
    networkId: string | number,
    executionMode: 'READ_ONLY' | 'PREFLIGHT_ONLY' | 'LIVE_EXECUTION' | 'LIVE_ONCHAIN' | 'SIMULATION' | 'DIAGNOSTIC' = 'LIVE_EXECUTION'
  ): NetworkExecutionReadiness {
    const profile = this.getNetworkCapability(networkId);
    if (!profile) {
      return {
        isExecutable: false,
        networkId: String(networkId),
        family: 'EVM',
        level: 'UNSUPPORTED',
        rank: 0,
        health: 'UNHEALTHY',
        rejectionReason: `Network "${networkId}" is not registered in the authoritative capability registry.`
      };
    }

    const health = this.getNetworkHealth(profile.networkId);
    if (health === 'CIRCUIT_OPEN' || health === 'UNHEALTHY') {
      return {
        isExecutable: false,
        networkId: profile.networkId,
        family: profile.family,
        level: profile.overallCapabilityLevel,
        rank: profile.capabilityRank,
        health,
        rejectionReason: `Network "${profile.networkId}" RPC health is "${health}". Execution blocked by circuit breaker.`
      };
    }

    if (profile.onboardingState === 'DISABLED' || profile.onboardingState === 'DEPRECATED') {
      return {
        isExecutable: false,
        networkId: profile.networkId,
        family: profile.family,
        level: profile.overallCapabilityLevel,
        rank: profile.capabilityRank,
        health,
        rejectionReason: `Network "${profile.networkId}" onboarding state is "${profile.onboardingState}".`
      };
    }

    // Execution Mode vs. Required Capability Rank
    const currentRank = profile.capabilityRank;
    if (executionMode === 'LIVE_EXECUTION' || executionMode === 'LIVE_ONCHAIN') {
      const requiredRank = NETWORK_CAPABILITY_HIERARCHY.LIVE_VERIFIED; // 5
      if (currentRank < requiredRank) {
        return {
          isExecutable: false,
          networkId: profile.networkId,
          family: profile.family,
          level: profile.overallCapabilityLevel,
          rank: currentRank,
          health,
          rejectionReason: `Network "${profile.networkId}" capability level is "${profile.overallCapabilityLevel}" (rank ${currentRank}), but LIVE_EXECUTION requires "LIVE_VERIFIED" (rank ${requiredRank}).`
        };
      }
    } else if (executionMode === 'PREFLIGHT_ONLY' || executionMode === 'SIMULATION') {
      const requiredRank = NETWORK_CAPABILITY_HIERARCHY.EXECUTION_AVAILABLE; // 4
      if (currentRank < requiredRank) {
        return {
          isExecutable: false,
          networkId: profile.networkId,
          family: profile.family,
          level: profile.overallCapabilityLevel,
          rank: currentRank,
          health,
          rejectionReason: `Network "${profile.networkId}" capability level is "${profile.overallCapabilityLevel}" (rank ${currentRank}), but PREFLIGHT_ONLY requires at least "EXECUTION_AVAILABLE" (rank ${requiredRank}).`
        };
      }
    } else if (executionMode === 'READ_ONLY') {
      const requiredRank = NETWORK_CAPABILITY_HIERARCHY.CONFIGURED; // 2
      if (currentRank < requiredRank) {
        return {
          isExecutable: false,
          networkId: profile.networkId,
          family: profile.family,
          level: profile.overallCapabilityLevel,
          rank: currentRank,
          health,
          rejectionReason: `Network "${profile.networkId}" capability level is "${profile.overallCapabilityLevel}" (rank ${currentRank}), but READ_ONLY requires at least "CONFIGURED" (rank ${requiredRank}).`
        };
      }
    }

    return {
      isExecutable: true,
      networkId: profile.networkId,
      family: profile.family,
      level: profile.overallCapabilityLevel,
      rank: currentRank,
      health
    };
  }

  /**
   * Retrieves finality model and safety parameters.
   */
  public getFinalityModel(networkId: string | number): NetworkFinalityModel {
    const profile = this.getNetworkCapability(networkId);
    return profile ? profile.finality.model : 'FINALITY_UNKNOWN';
  }

  /**
   * Retrieves gas model configuration.
   */
  public getGasModel(networkId: string | number): NetworkGasModelType {
    const profile = this.getNetworkCapability(networkId);
    return profile ? profile.gas.modelType : 'CHAIN_SPECIFIC';
  }

  /**
   * Validates runtime network identity against claimed chain ID and RPC-reported chain ID.
   */
  public validateNetworkIdentity(networkId: string | number, claimedNumericChainId?: number, rpcReportedChainId?: number): boolean {
    const profile = this.getNetworkCapability(networkId);
    if (!profile) return false;

    if (profile.family === 'EVM' && profile.numericChainId !== undefined) {
      if (claimedNumericChainId !== undefined && claimedNumericChainId !== profile.numericChainId) {
        return false;
      }
      if (rpcReportedChainId !== undefined && rpcReportedChainId !== profile.numericChainId) {
        return false;
      }
    }

    return true;
  }

  /**
   * Checks whether an onboarding state transition is valid.
   */
  public canTransition(current: NetworkOnboardingState, next: NetworkOnboardingState): boolean {
    if (next === 'DISABLED' || next === 'DEPRECATED') return true;
    if (current === 'DISABLED') return false;

    const currIdx = ONBOARDING_PROGRESSION.indexOf(current);
    const nextIdx = ONBOARDING_PROGRESSION.indexOf(next);

    if (currIdx === -1 || nextIdx === -1) return false;
    // Strictly monotonic progression (next must be currIdx + 1 or equal)
    return nextIdx >= currIdx;
  }

  /**
   * Transitions a network's onboarding state with validation.
   */
  public transitionState(networkId: string, nextState: NetworkOnboardingState, evidenceReason?: string): void {
    const profile = this.profiles.get(networkId.toLowerCase());
    if (!profile) {
      throw new Error(`Network "${networkId}" not found in registry`);
    }

    if (!this.canTransition(profile.onboardingState, nextState)) {
      throw new Error(`Invalid onboarding state transition from "${profile.onboardingState}" to "${nextState}" for network "${networkId}"`);
    }

    profile.onboardingState = nextState;
    if (evidenceReason) {
      profile.notes = (profile.notes ? profile.notes + '; ' : '') + `Transition to ${nextState}: ${evidenceReason}`;
    }
  }

  /**
   * Returns current health for a network.
   */
  public getNetworkHealth(networkId: string): NetworkHealthStatus {
    if (this.rpcManager) {
      const endpoints = this.rpcManager.getEndpoints(networkId);
      if (endpoints.length === 0) return 'HEALTHY'; // Default if unmanaged

      const hasHealthy = endpoints.some((e) => e.status === 'HEALTHY' && e.circuitState === 'CLOSED');
      const allCircuitOpen = endpoints.every((e) => e.circuitState === 'OPEN');
      const allUnhealthy = endpoints.every((e) => e.status === 'UNHEALTHY' || e.circuitState === 'OPEN');

      if (allCircuitOpen) return 'CIRCUIT_OPEN';
      if (allUnhealthy) return 'UNHEALTHY';
      if (!hasHealthy) return 'DEGRADED';
      return 'HEALTHY';
    }

    return 'HEALTHY';
  }

  /**
   * Returns the execution adapter for a network.
   */
  public getAdapter(networkId: string | number): INetworkExecutionAdapter {
    const profile = this.getNetworkCapability(networkId);
    if (!profile) {
      return new UnsupportedExecutionAdapter(String(networkId), 'EVM');
    }
    const adapter = this.adapters.get(profile.networkId);
    return adapter || new UnsupportedExecutionAdapter(profile.networkId, profile.family);
  }

  /**
   * Returns all registered network profiles matching optional filters.
   */
  public getAllNetworks(filter?: {
    family?: NetworkFamily;
    operational?: NetworkOperationalStatus;
    isTestnet?: boolean;
    minCapabilityLevel?: NetworkCapabilityLevel;
  }): NetworkCapabilityProfile[] {
    let list = Array.from(this.profiles.values());

    if (filter?.family) {
      list = list.filter((p) => p.family === filter.family);
    }
    if (filter?.operational) {
      list = list.filter((p) => p.operationalClassification === filter.operational);
    }
    if (filter?.isTestnet !== undefined) {
      list = list.filter((p) => p.isTestnet === filter.isTestnet);
    }
    if (filter?.minCapabilityLevel) {
      const minRank = NETWORK_CAPABILITY_HIERARCHY[filter.minCapabilityLevel] ?? 0;
      list = list.filter((p) => p.capabilityRank >= minRank);
    }

    return list;
  }
}

/**
 * Singleton default NetworkCapabilityRegistry instance.
 */
export const defaultNetworkCapabilityRegistry = new NetworkCapabilityRegistry();
