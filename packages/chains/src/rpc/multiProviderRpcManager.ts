import {
  ProviderEndpointConfig,
  ProviderEndpointHealth,
  ProviderHealthStatus,
  RpcCircuitBreakerState,
  TelemetryEvent,
  ErrorCategory
} from '@zenith/types';
import {
  ChainIdMismatchError,
  AllProvidersUnavailableError
} from '@zenith/contracts';
import { defaultChainRegistry } from '../registry';


export interface RpcManagerConfig {
  failureThreshold?: number;
  successThreshold?: number;
  circuitOpenCooldownMs?: number;
  maxAllowedBlockLag?: number;
  requestTimeoutMs?: number;
  seedDefaultEndpoints?: boolean;
}

export class MultiProviderRpcManager {
  private endpoints: Map<string, Map<string, ProviderEndpointHealth>> = new Map();
  private endpointById: Map<string, ProviderEndpointHealth> = new Map();
  private maxObservedBlocks: Map<string, number> = new Map();
  private circuitResetTimers: Map<string, number> = new Map();
  private telemetrySinks: ((event: TelemetryEvent) => void)[] = [];

  public readonly failureThreshold: number;
  public readonly successThreshold: number;
  public readonly circuitOpenCooldownMs: number;
  public readonly maxAllowedBlockLag: number;
  public readonly requestTimeoutMs: number;

  constructor(config: RpcManagerConfig = {}) {
    this.failureThreshold = config.failureThreshold ?? 3;
    this.successThreshold = config.successThreshold ?? 2;
    this.circuitOpenCooldownMs = config.circuitOpenCooldownMs ?? 15000;
    this.maxAllowedBlockLag = config.maxAllowedBlockLag ?? 5;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 5000;

    if (config.seedDefaultEndpoints !== false) {
      this.seedFromRegistry();
    }
  }

  public clearEndpoints(chainId?: string): void {
    if (chainId) {
      const chainKey = chainId.toLowerCase();
      const eps = this.endpoints.get(chainKey);
      if (eps) {
        for (const epId of eps.keys()) {
          this.endpointById.delete(epId);
        }
        this.endpoints.delete(chainKey);
      }
    } else {
      this.endpoints.clear();
      this.endpointById.clear();
      this.maxObservedBlocks.clear();
      this.circuitResetTimers.clear();
    }
  }


  public seedFromRegistry(): void {
    const allChains = defaultChainRegistry.getAllChains(true, true);
    for (const chain of allChains) {
      if (!chain.rpcEndpoints || chain.rpcEndpoints.length === 0) continue;
      const chainKey = chain.id.toLowerCase();
      const numericChainId = chain.chainId || 1;

      chain.rpcEndpoints.forEach((rpc, idx) => {
        const providerId = `${chainKey}-rpc-${idx + 1}`;
        this.registerEndpoint({
          id: providerId,
          chainId: chainKey,
          numericChainId,
          url: rpc.url,
          priority: rpc.priority ?? idx + 1,
          weight: rpc.weight ?? 1,
          supportsSimulation: rpc.supportsSimulation ?? true,
          isPrivate: rpc.isPrivate ?? false
        });
      });
    }
  }

  public registerEndpoint(config: ProviderEndpointConfig): ProviderEndpointHealth {
    const chainKey = config.chainId.toLowerCase();
    if (!this.endpoints.has(chainKey)) {
      this.endpoints.set(chainKey, new Map());
    }

    const health: ProviderEndpointHealth = {
      id: config.id,
      chainId: chainKey,
      numericChainId: config.numericChainId,
      url: config.url,
      priority: config.priority,
      weight: config.weight ?? 1,
      status: 'HEALTHY',
      circuitState: 'CLOSED',
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastFailureTimestamp: null,
      lastSuccessTimestamp: null,
      latencyMs: 0,
      timeoutCount: 0,
      errorCount: 0,
      lastCheckedBlockNumber: null,
      lastCheckedAt: null
    };

    this.endpoints.get(chainKey)!.set(config.id, health);
    this.endpointById.set(config.id, health);
    return health;
  }

  public registerEndpoints(configs: ProviderEndpointConfig[]): ProviderEndpointHealth[] {
    return configs.map((c) => this.registerEndpoint(c));
  }

  public getEndpoint(providerId: string): ProviderEndpointHealth | undefined {
    return this.endpointById.get(providerId);
  }

  public getEndpoints(chainId: string | number): ProviderEndpointHealth[] {
    const chainKey = typeof chainId === 'number'
      ? (defaultChainRegistry.getChain(chainId)?.id || String(chainId)).toLowerCase()
      : chainId.toLowerCase();

    const map = this.endpoints.get(chainKey);
    return map ? Array.from(map.values()) : [];
  }

  public updateEndpointStatus(providerId: string, status: ProviderHealthStatus): void {
    const ep = this.endpointById.get(providerId);
    if (!ep) return;
    ep.status = status;
    if (status === 'CIRCUIT_OPEN') {
      ep.circuitState = 'OPEN';
      this.circuitResetTimers.set(providerId, Date.now() + this.circuitOpenCooldownMs);
    } else if (status === 'HEALTHY') {
      ep.circuitState = 'CLOSED';
      ep.consecutiveFailures = 0;
      this.circuitResetTimers.delete(providerId);
    }
  }

  public recordSuccess(providerId: string, latencyMs: number, blockNumber?: number): void {
    const ep = this.endpointById.get(providerId);
    if (!ep) return;

    const now = Date.now();
    ep.lastSuccessTimestamp = now;
    ep.lastCheckedAt = now;
    ep.latencyMs = latencyMs;
    ep.consecutiveFailures = 0;
    ep.consecutiveSuccesses += 1;

    if (blockNumber !== undefined && blockNumber > 0) {
      ep.lastCheckedBlockNumber = blockNumber;
      const currentMax = this.maxObservedBlocks.get(ep.chainId) || 0;
      if (blockNumber > currentMax) {
        this.maxObservedBlocks.set(ep.chainId, blockNumber);
      }
    }

    if (ep.circuitState === 'HALF_OPEN' || ep.status === 'RECOVERING' || ep.status === 'DEGRADED') {
      if (ep.consecutiveSuccesses >= this.successThreshold) {
        ep.status = 'HEALTHY';
        ep.circuitState = 'CLOSED';
        this.circuitResetTimers.delete(providerId);
      }
    } else if (ep.status === 'UNHEALTHY' && ep.consecutiveSuccesses >= 1) {
      ep.status = 'DEGRADED';
    }
  }

  public recordFailure(
    providerId: string,
    isTimeout: boolean = false,
    errorCategory: ErrorCategory = 'RETRYABLE'
  ): void {
    const ep = this.endpointById.get(providerId);
    if (!ep) return;

    const now = Date.now();
    ep.lastFailureTimestamp = now;
    ep.lastCheckedAt = now;
    ep.consecutiveSuccesses = 0;
    ep.consecutiveFailures += 1;
    ep.errorCount += 1;
    if (isTimeout) {
      ep.timeoutCount += 1;
    }

    if (errorCategory === 'NON_RETRYABLE') {
      // Non-retryable contract reverts or deterministic execution errors don't necessarily mean RPC endpoint is dead
      return;
    }

    if (ep.consecutiveFailures >= this.failureThreshold || ep.circuitState === 'HALF_OPEN') {
      ep.status = 'CIRCUIT_OPEN';
      ep.circuitState = 'OPEN';
      this.circuitResetTimers.set(providerId, now + this.circuitOpenCooldownMs);
    } else if (ep.status === 'HEALTHY') {
      ep.status = 'DEGRADED';
    }
  }

  public checkCircuitState(providerId: string): RpcCircuitBreakerState {
    const ep = this.endpointById.get(providerId);
    if (!ep) return 'CLOSED';

    if (ep.circuitState === 'OPEN') {
      const resetAt = this.circuitResetTimers.get(providerId) || 0;
      if (Date.now() >= resetAt) {
        ep.circuitState = 'HALF_OPEN';
        ep.status = 'RECOVERING';
        return 'HALF_OPEN';
      }
      return 'OPEN';
    }

    return ep.circuitState;
  }

  public checkBlockLag(
    providerId: string,
    currentBlock?: number
  ): { isLagging: boolean; lag: number; maxObservedBlock: number } {
    const ep = this.endpointById.get(providerId);
    if (!ep) return { isLagging: false, lag: 0, maxObservedBlock: 0 };

    const maxBlock = this.maxObservedBlocks.get(ep.chainId) || 0;
    const blockToCheck = currentBlock !== undefined ? currentBlock : ep.lastCheckedBlockNumber;

    if (blockToCheck === null || blockToCheck === undefined || maxBlock === 0) {
      return { isLagging: false, lag: 0, maxObservedBlock: maxBlock };
    }

    const lag = maxBlock - blockToCheck;
    const isLagging = lag > this.maxAllowedBlockLag;
    return { isLagging, lag, maxObservedBlock: maxBlock };
  }

  public async validateChainIdentity(
    providerId: string,
    fetchChainIdFn?: () => Promise<number>
  ): Promise<boolean> {
    const ep = this.endpointById.get(providerId);
    if (!ep) return false;

    try {
      let returnedChainId: number;
      if (fetchChainIdFn) {
        returnedChainId = await fetchChainIdFn();
      } else {
        const res = await fetch(ep.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
          signal: AbortSignal.timeout(this.requestTimeoutMs)
        });
        if (!res.ok) {
          this.recordFailure(providerId, false, 'RETRYABLE');
          return false;
        }
        const json = await res.json();
        returnedChainId = parseInt(json.result || '0x0', 16);
      }


      if (returnedChainId !== ep.numericChainId) {
        ep.status = 'UNHEALTHY';
        ep.circuitState = 'OPEN';
        this.circuitResetTimers.set(providerId, Date.now() + 86400000); // 24h lockout
        throw new ChainIdMismatchError(providerId, ep.numericChainId, returnedChainId);
      }

      return true;
    } catch (err) {
      if (err instanceof ChainIdMismatchError) {
        throw err;
      }
      this.recordFailure(providerId, false, 'RETRYABLE');
      return false;
    }
  }

  public selectEligibleEndpoints(
    chainId: string | number,
    options?: { requireBlockSync?: boolean }
  ): ProviderEndpointHealth[] {
    const endpoints = this.getEndpoints(chainId);
    if (endpoints.length === 0) return [];

    const now = Date.now();
    const eligible: ProviderEndpointHealth[] = [];

    for (const ep of endpoints) {
      // Check if circuit breaker cooldown has elapsed
      if (ep.circuitState === 'OPEN') {
        const resetAt = this.circuitResetTimers.get(ep.id) || 0;
        if (now >= resetAt) {
          ep.circuitState = 'HALF_OPEN';
          ep.status = 'RECOVERING';
        } else {
          continue; // Circuit is still OPEN, skip
        }
      }

      if (ep.status === 'UNHEALTHY') {
        continue;
      }

      if (options?.requireBlockSync) {
        const { isLagging } = this.checkBlockLag(ep.id);
        if (isLagging) {
          continue;
        }
      }

      eligible.push(ep);
    }

    // Sort deterministically:
    // 1. Priority ascending (lower number = higher priority)
    // 2. Health status (HEALTHY > DEGRADED > RECOVERING)
    // 3. Latency ascending
    // 4. Error count ascending
    const statusRank: Record<ProviderHealthStatus, number> = {
      HEALTHY: 1,
      DEGRADED: 2,
      RECOVERING: 3,
      UNHEALTHY: 4,
      CIRCUIT_OPEN: 5
    };

    eligible.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      const rankA = statusRank[a.status] || 99;
      const rankB = statusRank[b.status] || 99;
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      if (a.latencyMs !== b.latencyMs && a.latencyMs > 0 && b.latencyMs > 0) {
        return a.latencyMs - b.latencyMs;
      }
      return a.errorCount - b.errorCount;
    });

    return eligible;
  }

  public getHealthyEndpoint(chainId: string | number): ProviderEndpointHealth {
    const eligible = this.selectEligibleEndpoints(chainId);
    if (eligible.length === 0) {
      throw new AllProvidersUnavailableError(chainId);
    }
    return eligible[0];
  }

  public getHealthyRpcUrl(chainId: string | number): string {
    return this.getHealthyEndpoint(chainId).url;
  }

  public addTelemetrySink(sink: (event: TelemetryEvent) => void): void {
    this.telemetrySinks.push(sink);
  }

  public recordTelemetry(event: TelemetryEvent): void {
    // Sanitize metadata to never log private keys, passwords, or secrets
    const sanitizedMetadata = this.sanitizeMetadata(event.metadata);
    const sanitizedEvent: TelemetryEvent = {
      ...event,
      metadata: sanitizedMetadata
    };

    for (const sink of this.telemetrySinks) {
      try {
        sink(sanitizedEvent);
      } catch (err) {
        // Suppress telemetry sink errors
      }
    }
  }

  private sanitizeMetadata(meta?: Record<string, any>): Record<string, any> | undefined {
    if (!meta) return undefined;
    const sanitized: Record<string, any> = {};
    const sensitiveKeys = ['privatekey', 'secret', 'password', 'seed', 'mnemonic', 'auth', 'bearer', 'token'];

    for (const [key, value] of Object.entries(meta)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((s) => lowerKey.includes(s))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeMetadata(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  public resetAll(): void {
    this.endpoints.clear();
    this.endpointById.clear();
    this.maxObservedBlocks.clear();
    this.circuitResetTimers.clear();
    this.seedFromRegistry();
  }
}

export const defaultMultiProviderRpcManager = new MultiProviderRpcManager();
