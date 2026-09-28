import { NetworkCapabilityProfile, NetworkCapabilityLevel, NETWORK_CAPABILITY_HIERARCHY, NetworkOnboardingState, ONBOARDING_PROGRESSION, NetworkOperationalStatus, NetworkFamily, NetworkFinalityModel, NetworkGasModelType, NetworkHealthStatus, NetworkExecutionReadiness } from './networkCapabilityTypes';
import { ZENITH_NETWORK_PROFILES } from './networkProfiles.data';
import { isValidAddressForFamily } from './networkFamilies';
import { INetworkExecutionAdapter, EvmExecutionAdapter, UnsupportedExecutionAdapter } from './networkExecutionAdapter';
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
    public registerProfile(key: string, profile: NetworkCapabilityProfile): void {
        const canonicalKey = key.toLowerCase();
        const clonedProfile: NetworkCapabilityProfile = typeof structuredClone === 'function'
            ? structuredClone(profile)
            : JSON.parse(JSON.stringify(profile));
        if (this.profiles.has(canonicalKey)) {
            const existing = this.profiles.get(canonicalKey)!;
            if (existing.networkId !== clonedProfile.networkId) {
                throw new Error(`Network identity collision: Key "${canonicalKey}" already bound to "${existing.networkId}"`);
            }
        }
        if (clonedProfile.family === 'EVM' && clonedProfile.numericChainId !== undefined) {
            const existingOwner = this.chainIdToNetworkId.get(clonedProfile.numericChainId);
            if (existingOwner && existingOwner !== clonedProfile.networkId) {
                throw new Error(`Chain ID collision: EVM Chain ID ${clonedProfile.numericChainId} is already registered to "${existingOwner}". Cannot register "${clonedProfile.networkId}".`);
            }
            this.chainIdToNetworkId.set(clonedProfile.numericChainId, clonedProfile.networkId);
        }
        this.profiles.set(canonicalKey, clonedProfile);
        if (profile.family === 'EVM' && profile.numericChainId) {
            this.adapters.set(canonicalKey, new EvmExecutionAdapter(canonicalKey, profile.numericChainId));
        }
        else {
            this.adapters.set(canonicalKey, new UnsupportedExecutionAdapter(canonicalKey, profile.family));
        }
    }
    public getNetworkCapability(networkIdOrChainId: string | number): NetworkCapabilityProfile | undefined {
        if (typeof networkIdOrChainId === 'number') {
            const key = this.chainIdToNetworkId.get(networkIdOrChainId);
            return key ? this.profiles.get(key) : undefined;
        }
        const key = networkIdOrChainId.toLowerCase();
        const profile = this.profiles.get(key);
        if (profile)
            return profile;
        const num = Number(networkIdOrChainId);
        if (!isNaN(num) && num > 0) {
            const byNum = this.chainIdToNetworkId.get(num);
            if (byNum)
                return this.profiles.get(byNum);
        }
        try {
            const { defaultAuthoritativeNetworkRegistry } = require('../authoritative/authoritativeNetworkRegistry');
            const resolved = defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity(networkIdOrChainId);
            if (resolved && this.profiles.has(resolved)) {
                return this.profiles.get(resolved);
            }
        }
        catch {
        }
        return undefined;
    }
    public getExecutionCapability(networkId: string | number): NetworkCapabilityLevel {
        const profile = this.getNetworkCapability(networkId);
        return profile ? profile.overallCapabilityLevel : 'UNSUPPORTED';
    }
    public getBridgeCapability(networkId: string | number, providerId: string): NetworkCapabilityLevel {
        const profile = this.getNetworkCapability(networkId);
        if (!profile)
            return 'UNSUPPORTED';
        const pId = providerId.toLowerCase();
        const corridor = profile.bridgeCorridors.find((c) => c.providerId.toLowerCase() === pId);
        if (corridor) {
            return corridor.capabilityLevel;
        }
        return 'UNSUPPORTED';
    }
    public getDexCapability(networkId: string | number, dexId: string): NetworkCapabilityLevel {
        const profile = this.getNetworkCapability(networkId);
        if (!profile)
            return 'UNSUPPORTED';
        const dex = profile.dexCapabilities[dexId.toLowerCase()];
        if (dex) {
            return dex.executionCapability;
        }
        return 'UNSUPPORTED';
    }
    public getTokenCapability(networkId: string | number, tokenAddress: string): {
        supported: boolean;
        standard?: string;
        reason?: string;
    } {
        const profile = this.getNetworkCapability(networkId);
        if (!profile) {
            return { supported: false, reason: 'Network not registered' };
        }
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
    public isExecutable(networkId: string | number, executionMode: 'READ_ONLY' | 'PREFLIGHT_ONLY' | 'LIVE_EXECUTION' | 'LIVE_ONCHAIN' | 'SIMULATION' | 'DIAGNOSTIC' = 'LIVE_EXECUTION'): NetworkExecutionReadiness {
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
        const currentRank = profile.capabilityRank;
        if (executionMode === 'LIVE_EXECUTION' || executionMode === 'LIVE_ONCHAIN') {
            const requiredRank = NETWORK_CAPABILITY_HIERARCHY.LIVE_VERIFIED;
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
        }
        else if (executionMode === 'PREFLIGHT_ONLY' || executionMode === 'SIMULATION') {
            const requiredRank = NETWORK_CAPABILITY_HIERARCHY.EXECUTION_AVAILABLE;
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
        }
        else if (executionMode === 'READ_ONLY') {
            const requiredRank = NETWORK_CAPABILITY_HIERARCHY.CONFIGURED;
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
    public getFinalityModel(networkId: string | number): NetworkFinalityModel {
        const profile = this.getNetworkCapability(networkId);
        return profile ? profile.finality.model : 'FINALITY_UNKNOWN';
    }
    public getGasModel(networkId: string | number): NetworkGasModelType {
        const profile = this.getNetworkCapability(networkId);
        return profile ? profile.gas.modelType : 'CHAIN_SPECIFIC';
    }
    public validateNetworkIdentity(networkId: string | number, claimedNumericChainId?: number, rpcReportedChainId?: number): boolean {
        const profile = this.getNetworkCapability(networkId);
        if (!profile)
            return false;
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
    public canTransition(current: NetworkOnboardingState, next: NetworkOnboardingState): boolean {
        if (next === 'DISABLED' || next === 'DEPRECATED')
            return true;
        if (current === 'DISABLED')
            return false;
        const currIdx = ONBOARDING_PROGRESSION.indexOf(current);
        const nextIdx = ONBOARDING_PROGRESSION.indexOf(next);
        if (currIdx === -1 || nextIdx === -1)
            return false;
        return nextIdx >= currIdx;
    }
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
    public getNetworkHealth(networkId: string): NetworkHealthStatus {
        if (this.rpcManager) {
            const endpoints = this.rpcManager.getEndpoints(networkId);
            if (endpoints.length === 0)
                return 'HEALTHY';
            const hasHealthy = endpoints.some((e) => e.status === 'HEALTHY' && e.circuitState === 'CLOSED');
            const allCircuitOpen = endpoints.every((e) => e.circuitState === 'OPEN');
            const allUnhealthy = endpoints.every((e) => e.status === 'UNHEALTHY' || e.circuitState === 'OPEN');
            if (allCircuitOpen)
                return 'CIRCUIT_OPEN';
            if (allUnhealthy)
                return 'UNHEALTHY';
            if (!hasHealthy)
                return 'DEGRADED';
            return 'HEALTHY';
        }
        return 'HEALTHY';
    }
    public getAdapter(networkId: string | number): INetworkExecutionAdapter {
        const profile = this.getNetworkCapability(networkId);
        if (!profile) {
            return new UnsupportedExecutionAdapter(String(networkId), 'EVM');
        }
        const adapter = this.adapters.get(profile.networkId);
        return adapter || new UnsupportedExecutionAdapter(profile.networkId, profile.family);
    }
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
export const defaultNetworkCapabilityRegistry = new NetworkCapabilityRegistry();
