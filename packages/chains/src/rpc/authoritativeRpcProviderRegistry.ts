import type {
  ProviderHealthStatus,
  RpcCapabilityType,
  RpcErrorType,
  RpcProviderProfile,
  RpcMetricsSnapshot
} from '@zenith/types';
import { ZENITH_AUTHORITATIVE_NETWORKS } from '../authoritative/networkRegistry.data';
import { defaultAuthoritativeNetworkRegistry } from '../authoritative/authoritativeNetworkRegistry';

function deepClone<T>(obj: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
}

export interface ProviderRegistryConfig {
  failureThreshold?: number;
  successThreshold?: number;
  circuitOpenCooldownMs?: number;
  maxAllowedBlockLag?: number;
  defaultTimeoutMs?: number;
  seedFromAuthoritativeRegistry?: boolean;
}

export class AuthoritativeRpcProviderRegistry {
  private providers: Map<string, RpcProviderProfile> = new Map();
  private networkToProviderIds: Map<string, Set<string>> = new Map();
  private maxObservedBlockPerNetwork: Map<string, number> = new Map();
  private circuitCooldownUntil: Map<string, number> = new Map();
  private consecutiveFailures: Map<string, number> = new Map();
  private consecutiveSuccesses: Map<string, number> = new Map();
  private providerLatencies: Map<string, number> = new Map();
  private providerErrorCounts: Map<string, number> = new Map();
  private providerTimeoutCounts: Map<string, number> = new Map();
  private providerRateLimitCounts: Map<string, number> = new Map();
  private providerLastBlockChecked: Map<string, number> = new Map();

  // Metrics Counters
  private metricRequests: Map<string, number> = new Map();
  private metricSuccesses: Map<string, number> = new Map();
  private metricFailures: Map<string, number> = new Map();
  private metricTimeouts: Map<string, number> = new Map();
  private metricRateLimits: Map<string, number> = new Map();
  private metricSwitches: Map<string, number> = new Map();
  private metricIdentityMismatches: Map<string, number> = new Map();
  private metricDisagreements: Map<string, number> = new Map();
  private metricCircuitOpens: Map<string, number> = new Map();
  private metricCircuitRecoveries: Map<string, number> = new Map();
  private metricStaleHeads: Map<string, number> = new Map();
  private readFailoverTotal = 0;
  private preflightFailoverTotal = 0;
  private broadcastUncertainTotal = 0;

  public readonly failureThreshold: number;
  public readonly successThreshold: number;
  public readonly circuitOpenCooldownMs: number;
  public readonly maxAllowedBlockLag: number;
  public readonly defaultTimeoutMs: number;

  constructor(config: ProviderRegistryConfig = {}) {
    this.failureThreshold = config.failureThreshold ?? 3;
    this.successThreshold = config.successThreshold ?? 2;
    this.circuitOpenCooldownMs = config.circuitOpenCooldownMs ?? 15000;
    this.maxAllowedBlockLag = config.maxAllowedBlockLag ?? 5;
    this.defaultTimeoutMs = config.defaultTimeoutMs ?? 5000;

    if (config.seedFromAuthoritativeRegistry !== false) {
      this.seedFromAuthoritativeNetworks();
    }
  }

  /**
   * Seeds the provider registry from the 58 Task 37 authoritative network profiles.
   */
  public seedFromAuthoritativeNetworks(): void {
    for (const net of Object.values(ZENITH_AUTHORITATIVE_NETWORKS)) {
      if (!net.rpcEndpoints || net.rpcEndpoints.length === 0) continue;

      for (const rpc of net.rpcEndpoints) {
        const transport = rpc.url.startsWith('https://')
          ? 'HTTPS'
          : rpc.url.startsWith('http://')
            ? 'HTTP'
            : rpc.url.startsWith('wss://')
              ? 'WSS'
              : 'WS';

        const profile: RpcProviderProfile = {
          providerId: rpc.providerId,
          providerName: `${net.displayName} Public RPC`,
          networkId: net.networkId,
          family: net.family,
          namespace: net.namespace,
          environment: net.environment,
          endpointClass: rpc.endpointClass === 'PUBLIC' ? 'PUBLIC' : 'MANAGED',
          endpoint: rpc.url,
          transport,
          readCapability: rpc.readCapability,
          preflightCapability: rpc.preflightCapability,
          broadcastCapability: rpc.broadcastCapability,
          websocketCapability: rpc.websocketCapability,
          priority: rpc.priority,
          timeoutMs: this.defaultTimeoutMs,
          healthState: rpc.healthState === 'HEALTHY' ? 'HEALTHY' : 'DEGRADED',
          expectedChainIdentity: {
            family: net.family,
            namespace: net.namespace,
            chainId: net.chainId,
            numericChainId: net.numericChainId
          },
          verificationStatus: 'CONFIGURED',
          rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
          retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
          lastVerifiedAt: null
        };

        this.registerProvider(profile);
      }
    }
  }

  /**
   * Registers a provider profile into memory.
   */
  public registerProvider(profile: RpcProviderProfile): void {
    if (!profile.providerId || typeof profile.providerId !== 'string') {
      throw new Error('Provider ID must be a non-empty string');
    }
    if (!profile.networkId) {
      throw new Error(`Provider ${profile.providerId} must declare a non-empty networkId`);
    }

    const canonicalNetworkId = defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity(profile.networkId);
    if (!canonicalNetworkId) {
      throw new Error(`Provider ${profile.providerId} attached to unknown or uncertified network: "${profile.networkId}"`);
    }

    const cloned = deepClone(profile);
    cloned.networkId = canonicalNetworkId;

    this.providers.set(cloned.providerId, cloned);

    if (!this.networkToProviderIds.has(canonicalNetworkId)) {
      this.networkToProviderIds.set(canonicalNetworkId, new Set());
    }
    this.networkToProviderIds.get(canonicalNetworkId)!.add(cloned.providerId);
  }

  /**
   * Removes a provider from the registry.
   */
  public removeProvider(providerId: string): boolean {
    const p = this.providers.get(providerId);
    if (!p) return false;

    this.providers.delete(providerId);
    const set = this.networkToProviderIds.get(p.networkId);
    if (set) {
      set.delete(providerId);
    }
    this.circuitCooldownUntil.delete(providerId);
    this.consecutiveFailures.delete(providerId);
    this.consecutiveSuccesses.delete(providerId);
    this.providerLatencies.delete(providerId);
    this.providerErrorCounts.delete(providerId);
    this.providerTimeoutCounts.delete(providerId);
    this.providerRateLimitCounts.delete(providerId);
    this.providerLastBlockChecked.delete(providerId);
    return true;
  }

  /**
   * Retrieves a deep-cloned provider profile by ID.
   */
  public getProvider(providerId: string): RpcProviderProfile | undefined {
    const p = this.providers.get(providerId);
    return p ? deepClone(p) : undefined;
  }

  /**
   * Retrieves all providers for a given networkId or alias (deep-cloned).
   */
  public getProviders(networkIdOrAlias: string | number): RpcProviderProfile[] {
    const canonicalId = defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity(networkIdOrAlias);
    if (!canonicalId) return [];

    const ids = this.networkToProviderIds.get(canonicalId);
    if (!ids) return [];

    const result: RpcProviderProfile[] = [];
    for (const id of ids) {
      const p = this.providers.get(id);
      if (p) result.push(deepClone(p));
    }
    return result;
  }

  /**
   * Retrieves all healthy or recovering providers for a network.
   */
  public getHealthyProviders(networkIdOrAlias: string | number): RpcProviderProfile[] {
    const all = this.getProviders(networkIdOrAlias);
    const now = Date.now();

    return all.filter((p) => {
      if (p.healthState === 'CIRCUIT_OPEN') {
        const cooldown = this.circuitCooldownUntil.get(p.providerId) || 0;
        if (now >= cooldown) {
          // Cooldown expired, allowed to probe as RECOVERING
          p.healthState = 'RECOVERING';
          return true;
        }
        return false;
      }
      return p.healthState === 'HEALTHY' || p.healthState === 'DEGRADED' || p.healthState === 'RECOVERING';
    });
  }

  /**
   * Deterministically selects the best provider for an operation.
   * Selection hierarchy:
   * 1. Identity validity
   * 2. Operation capability match (READ_ONLY, PREFLIGHT, BROADCAST)
   * 3. Circuit breaker state (exclude CIRCUIT_OPEN)
   * 4. Priority ascending (1 > 2 > 3)
   * 5. Health status rank (HEALTHY > DEGRADED > RECOVERING)
   * 6. Latency ascending
   * 7. Error count ascending
   * 8. Deterministic string tie-break on providerId
   */
  public getBestProvider(
    networkIdOrAlias: string | number,
    operation: RpcCapabilityType
  ): RpcProviderProfile | undefined {
    const canonicalId = defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity(networkIdOrAlias);
    if (!canonicalId) return undefined;

    const available = this.getHealthyProviders(canonicalId);
    if (available.length === 0) return undefined;

    const capable = available.filter((p) => {
      if (operation === 'READ_ONLY') return p.readCapability;
      if (operation === 'PREFLIGHT') return p.preflightCapability;
      if (operation === 'BROADCAST') return p.broadcastCapability;
      return false;
    });

    if (capable.length === 0) return undefined;

    const healthRank: Record<ProviderHealthStatus, number> = {
      HEALTHY: 1,
      DEGRADED: 2,
      RECOVERING: 3,
      UNHEALTHY: 4,
      CIRCUIT_OPEN: 5
    };

    capable.sort((a, b) => {
      // 1. Priority ascending
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }

      // 2. Health status rank ascending
      const rankA = healthRank[a.healthState] || 99;
      const rankB = healthRank[b.healthState] || 99;
      if (rankA !== rankB) {
        return rankA - rankB;
      }

      // 3. Latency ascending
      const latA = this.providerLatencies.get(a.providerId) || 0;
      const latB = this.providerLatencies.get(b.providerId) || 0;
      if (latA !== latB && latA > 0 && latB > 0) {
        return latA - latB;
      }

      // 4. Error count ascending
      const errA = this.providerErrorCounts.get(a.providerId) || 0;
      const errB = this.providerErrorCounts.get(b.providerId) || 0;
      if (errA !== errB) {
        return errA - errB;
      }

      // 5. Deterministic tie-break by providerId
      return a.providerId.localeCompare(b.providerId);
    });

    return capable[0];
  }

  /**
   * Verifies that an RPC endpoint matches its authoritative network identity.
   * Throws RPC_NETWORK_IDENTITY_MISMATCH and locks the circuit if there is a conflict.
   */
  public async verifyProviderIdentity(
    providerId: string,
    probeFn: () => Promise<string | number>
  ): Promise<boolean> {
    const p = this.providers.get(providerId);
    if (!p) {
      throw new Error(`Provider "${providerId}" not found in registry`);
    }

    try {
      const returnedIdentity = await probeFn();
      const expected = p.expectedChainIdentity;

      let matches = false;
      if (p.family === 'EVM') {
        const expectedNumeric = expected.numericChainId || Number(expected.chainId);
        matches = Number(returnedIdentity) === expectedNumeric;
      } else {
        matches = String(returnedIdentity).toLowerCase().trim() === String(expected.chainId).toLowerCase().trim();
      }

      if (!matches) {
        this.openCircuit(providerId, 'RPC_NETWORK_IDENTITY_MISMATCH', 86400000); // 24h lockout
        p.verificationStatus = 'DISABLED';
        this.incrementMetric(this.metricIdentityMismatches, providerId);
        throw new Error(
          `RPC_NETWORK_IDENTITY_MISMATCH: Provider ${providerId} returned identity "${returnedIdentity}", expected "${expected.chainId}" on network "${p.networkId}"`
        );
      }

      p.verificationStatus = 'IDENTITY_VERIFIED';
      p.lastVerifiedAt = Date.now();
      return true;
    } catch (err) {
      if (err instanceof Error && err.message.includes('RPC_NETWORK_IDENTITY_MISMATCH')) {
        throw err;
      }
      this.markProviderFailure(providerId, 'CONNECTION_ERROR');
      return false;
    }
  }

  /**
   * Records a successful operation for a provider.
   */
  public recordSuccess(providerId: string, latencyMs: number, blockNumber?: number): void {
    const p = this.providers.get(providerId);
    if (!p) return;

    this.incrementMetric(this.metricRequests, providerId);
    this.incrementMetric(this.metricSuccesses, providerId);

    this.consecutiveFailures.set(providerId, 0);
    const succ = (this.consecutiveSuccesses.get(providerId) || 0) + 1;
    this.consecutiveSuccesses.set(providerId, succ);
    this.providerLatencies.set(providerId, latencyMs);

    if (blockNumber !== undefined && blockNumber > 0) {
      this.providerLastBlockChecked.set(providerId, blockNumber);
      const currentMax = this.maxObservedBlockPerNetwork.get(p.networkId) || 0;
      if (blockNumber > currentMax) {
        this.maxObservedBlockPerNetwork.set(p.networkId, blockNumber);
      }
    }

    if (p.healthState === 'RECOVERING' || p.healthState === 'DEGRADED') {
      if (succ >= this.successThreshold) {
        p.healthState = 'HEALTHY';
        p.verificationStatus = 'HEALTH_CHECKED';
        this.circuitCooldownUntil.delete(providerId);
        this.incrementMetric(this.metricCircuitRecoveries, providerId);
      }
    } else if (p.healthState === 'UNHEALTHY' && succ >= 1) {
      p.healthState = 'DEGRADED';
    }
  }

  /**
   * Records an operation failure for a provider.
   */
  public recordFailure(
    providerId: string,
    errorType: RpcErrorType = 'UNKNOWN',
    isTimeout = false
  ): void {
    const p = this.providers.get(providerId);
    if (!p) return;

    this.incrementMetric(this.metricRequests, providerId);
    this.incrementMetric(this.metricFailures, providerId);

    if (errorType === 'TIMEOUT' || isTimeout) {
      this.incrementMetric(this.metricTimeouts, providerId);
      const timeouts = (this.providerTimeoutCounts.get(providerId) || 0) + 1;
      this.providerTimeoutCounts.set(providerId, timeouts);
    }

    if (errorType === 'RATE_LIMITED') {
      this.incrementMetric(this.metricRateLimits, providerId);
      const limits = (this.providerRateLimitCounts.get(providerId) || 0) + 1;
      this.providerRateLimitCounts.set(providerId, limits);
    }

    this.consecutiveSuccesses.set(providerId, 0);
    const failures = (this.consecutiveFailures.get(providerId) || 0) + 1;
    this.consecutiveFailures.set(providerId, failures);

    const totalErrors = (this.providerErrorCounts.get(providerId) || 0) + 1;
    this.providerErrorCounts.set(providerId, totalErrors);

    if (failures >= this.failureThreshold || p.healthState === 'RECOVERING') {
      this.openCircuit(providerId, `Exceeded consecutive failure threshold (${failures})`, this.circuitOpenCooldownMs);
    } else if (p.healthState === 'HEALTHY') {
      p.healthState = 'DEGRADED';
    }
  }

  /**
   * Alias for recordSuccess to support standard API.
   */
  public markProviderSuccess(providerId: string, latencyMs: number, blockNumber?: number): void {
    this.recordSuccess(providerId, latencyMs, blockNumber);
  }

  /**
   * Alias for recordFailure to support standard API.
   */
  public markProviderFailure(
    providerId: string,
    errorType: RpcErrorType = 'UNKNOWN',
    isTimeout = false
  ): void {
    this.recordFailure(providerId, errorType, isTimeout);
  }

  /**
   * Retrieves provider health status.
   */
  public getProviderHealth(providerId: string): ProviderHealthStatus | undefined {
    const p = this.providers.get(providerId);
    return p ? p.healthState : undefined;
  }

  /**
   * Retrieves provider capability flags.
   */
  public getProviderCapabilities(
    providerId: string
  ): { read: boolean; preflight: boolean; broadcast: boolean; websocket: boolean } | undefined {
    const p = this.providers.get(providerId);
    if (!p) return undefined;
    return {
      read: p.readCapability,
      preflight: p.preflightCapability,
      broadcast: p.broadcastCapability,
      websocket: p.websocketCapability
    };
  }

  /**
   * Immediately opens the circuit breaker for a provider.
   */
  public openCircuit(providerId: string, _reason?: string, cooldownMs?: number): void {
    const p = this.providers.get(providerId);
    if (!p) return;

    const cooldown = cooldownMs || this.circuitOpenCooldownMs;
    p.healthState = 'CIRCUIT_OPEN';
    this.circuitCooldownUntil.set(providerId, Date.now() + cooldown);
    this.incrementMetric(this.metricCircuitOpens, providerId);
  }

  /**
   * Checks whether a provider can transition from CIRCUIT_OPEN to RECOVERING.
   */
  public attemptRecovery(providerId: string): boolean {
    const p = this.providers.get(providerId);
    if (!p || p.healthState !== 'CIRCUIT_OPEN') return false;

    const cooldownUntil = this.circuitCooldownUntil.get(providerId) || 0;
    if (Date.now() >= cooldownUntil) {
      p.healthState = 'RECOVERING';
      this.consecutiveSuccesses.set(providerId, 0);
      return true;
    }
    return false;
  }

  /**
   * Checks block lag for a provider relative to other providers on the same network.
   */
  public checkStaleHead(
    providerId: string,
    currentBlock?: number
  ): { isLagging: boolean; lag: number; maxObservedBlock: number } {
    const p = this.providers.get(providerId);
    if (!p) return { isLagging: false, lag: 0, maxObservedBlock: 0 };

    const maxBlock = this.maxObservedBlockPerNetwork.get(p.networkId) || 0;
    const blockToCheck = currentBlock !== undefined ? currentBlock : (this.providerLastBlockChecked.get(providerId) || 0);

    if (blockToCheck === 0 || maxBlock === 0) {
      return { isLagging: false, lag: 0, maxObservedBlock: maxBlock };
    }

    const lag = maxBlock - blockToCheck;
    const isLagging = lag > this.maxAllowedBlockLag;

    if (isLagging) {
      this.incrementMetric(this.metricStaleHeads, providerId);
      if (p.healthState === 'HEALTHY') {
        p.healthState = 'DEGRADED';
      }
    }

    return { isLagging, lag, maxObservedBlock: maxBlock };
  }

  /**
   * Increments failover metric counters.
   */
  public recordFailover(type: 'READ' | 'PREFLIGHT' | 'BROADCAST_UNCERTAIN', providerId?: string): void {
    if (type === 'READ') this.readFailoverTotal += 1;
    if (type === 'PREFLIGHT') this.preflightFailoverTotal += 1;
    if (type === 'BROADCAST_UNCERTAIN') this.broadcastUncertainTotal += 1;
    if (providerId) {
      this.incrementMetric(this.metricSwitches, providerId);
    }
  }

  /**
   * Increments disagreement metric counter.
   */
  public recordDisagreement(providerId: string): void {
    this.incrementMetric(this.metricDisagreements, providerId);
  }

  /**
   * Returns a sanitized snapshot of telemetry and performance metrics.
   * Contains zero private keys, secrets, or sensitive headers.
   */
  public getMetrics(): RpcMetricsSnapshot {
    return {
      providerRequestCount: Object.fromEntries(this.metricRequests),
      providerSuccessCount: Object.fromEntries(this.metricSuccesses),
      providerFailureCount: Object.fromEntries(this.metricFailures),
      providerTimeoutCount: Object.fromEntries(this.metricTimeouts),
      providerRateLimitCount: Object.fromEntries(this.metricRateLimits),
      providerSwitchCount: Object.fromEntries(this.metricSwitches),
      providerIdentityMismatchCount: Object.fromEntries(this.metricIdentityMismatches),
      providerDisagreementCount: Object.fromEntries(this.metricDisagreements),
      providerCircuitOpenCount: Object.fromEntries(this.metricCircuitOpens),
      providerCircuitRecoveryCount: Object.fromEntries(this.metricCircuitRecoveries),
      providerLatency: Object.fromEntries(this.providerLatencies),
      providerStaleHeadCount: Object.fromEntries(this.metricStaleHeads),
      readFailoverCount: this.readFailoverTotal,
      preflightFailoverCount: this.preflightFailoverTotal,
      broadcastUncertainCount: this.broadcastUncertainTotal
    };
  }

  private incrementMetric(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) || 0) + 1);
  }
}

/**
 * Singleton instance of the Authoritative RPC Provider Registry.
 */
export const defaultAuthoritativeRpcProviderRegistry = new AuthoritativeRpcProviderRegistry();
