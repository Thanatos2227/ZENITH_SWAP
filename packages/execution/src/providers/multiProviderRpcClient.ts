import {
  RequestCategory,
  ErrorCategory
} from '@zenith/types';


import {
  MultiProviderRpcManager,
  defaultMultiProviderRpcManager
} from '@zenith/chains';
import {
  AllProvidersUnavailableError,
  RpcTimeoutError,
  RpcRateLimitError,
  BroadcastUncertainError,
  ChainIdMismatchError
} from '@zenith/contracts';

export interface RpcClientOptions {
  manager?: MultiProviderRpcManager;
  defaultTimeoutMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  jitterMs?: number;
}

export class MultiProviderRpcClient {
  private manager: MultiProviderRpcManager;
  private nextRpcId = 1;
  private nextEventId = 1;
  public readonly defaultTimeoutMs: number;
  public readonly maxRetries: number;
  public readonly baseBackoffMs: number;
  public readonly maxBackoffMs: number;
  public readonly jitterMs: number;

  constructor(options: RpcClientOptions = {}) {
    this.manager = options.manager || defaultMultiProviderRpcManager;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5000;
    this.maxRetries = options.maxRetries ?? 3;
    this.baseBackoffMs = options.baseBackoffMs ?? 150;
    this.maxBackoffMs = options.maxBackoffMs ?? 1500;
    this.jitterMs = options.jitterMs ?? 50;
  }

  public getManager(): MultiProviderRpcManager {
    return this.manager;
  }

  public classifyError(err: any): ErrorCategory {
    if (!err) return 'RETRYABLE';

    const msg = (err.message || String(err)).toLowerCase();
    const code = err.code || err.statusCode;

    // Smart contract revert or deterministic failures
    if (
      msg.includes('revert') ||
      msg.includes('execution reverted') ||
      msg.includes('call_exception') ||
      msg.includes('insufficient funds') ||
      msg.includes('exceeds balance') ||
      msg.includes('invalid argument') ||
      msg.includes('gas_limit_overflow') ||
      msg.includes('nonce too low') ||
      msg.includes('already known') ||
      err instanceof ChainIdMismatchError
    ) {
      return 'NON_RETRYABLE';
    }

    // Rate limits (HTTP 429)
    if (code === 429 || msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
      return 'RETRYABLE';
    }

    // Timeouts and network disconnects
    if (
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('etimedout') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('fetch failed') ||
      msg.includes('network error') ||
      msg.includes('socket hang up') ||
      msg.includes('500') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504') ||
      code === 500 ||
      code === 502 ||
      code === 503 ||
      code === 504
    ) {
      return 'RETRYABLE';
    }

    return 'RETRYABLE';
  }

  public calculateBackoff(attempt: number): number {
    const exponential = this.baseBackoffMs * Math.pow(2, attempt);
    const jitter = this.jitterMs > 0 ? ((attempt * 37 + (this.nextRpcId % this.jitterMs)) % this.jitterMs) : 0;
    return Math.min(exponential + jitter, this.maxBackoffMs);
  }

  public async executeReadOnly<T>(
    chainId: string | number,
    method: string,
    params: any[] = [],
    options?: { timeoutMs?: number; requireBlockSync?: boolean }
  ): Promise<T> {
    return this.executeWithFailover<T>(
      chainId,
      'READ_ONLY',
      method,
      params,
      options
    );
  }

  public async executePreBroadcast<T>(
    chainId: string | number,
    method: string,
    params: any[] = [],
    options?: { timeoutMs?: number; requireBlockSync?: boolean }
  ): Promise<T> {
    return this.executeWithFailover<T>(
      chainId,
      'PRE_BROADCAST',
      method,
      params,
      options
    );
  }

  public async executeBroadcast<T>(
    chainId: string | number,
    rawTxHex: string,
    customBroadcastFn?: (rpcUrl: string) => Promise<T>
  ): Promise<T> {
    const eligible = this.manager.selectEligibleEndpoints(chainId);
    if (eligible.length === 0) {
      throw new AllProvidersUnavailableError(chainId, 'eth_sendRawTransaction', 0);
    }

    const selectedProvider = eligible[0];
    const startTime = Date.now();
    const timeoutMs = this.defaultTimeoutMs * 2; // Allow extra time for broadcast

    try {
      let result: T;
      if (customBroadcastFn) {
        result = await customBroadcastFn(selectedProvider.url);
      } else {
        result = await this.rawJsonRpcCall<T>(
          selectedProvider.url,
          'eth_sendRawTransaction',
          [rawTxHex],
          timeoutMs
        );
      }

      const latencyMs = Date.now() - startTime;
      this.manager.recordSuccess(selectedProvider.id, latencyMs);
      this.manager.recordTelemetry({
        eventId: `tel-${Date.now()}-${this.nextEventId++}`,
        providerId: selectedProvider.id,
        chainId: String(chainId),
        operation: 'eth_sendRawTransaction',
        category: 'BROADCAST',
        latencyMs,
        success: true,
        retryCount: 0,
        failoverCount: 0,
        timestamp: Date.now()
      });

      return result;
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      const category = this.classifyError(err);

      this.manager.recordFailure(selectedProvider.id, err instanceof RpcTimeoutError || err.name === 'AbortError', category);
      this.manager.recordTelemetry({
        eventId: `tel-${Date.now()}-${this.nextEventId++}`,
        providerId: selectedProvider.id,
        chainId: String(chainId),
        operation: 'eth_sendRawTransaction',
        category: 'BROADCAST',
        latencyMs,
        success: false,
        errorCategory: category,
        retryCount: 0,
        failoverCount: 0,
        timestamp: Date.now(),
        metadata: { error: err?.message || String(err) }
      });

      // CRITICAL BROADCAST SAFETY: If broadcast error was ambiguous (timeout or transport disconnect),
      // we MUST NEVER fail over to a second RPC. We throw BroadcastUncertainError immediately.
      if (category === 'RETRYABLE') {
        throw new BroadcastUncertainError(
          `Broadcast to provider ${selectedProvider.id} encountered network ambiguity (${err?.message || 'unknown error'}). Automatic failover is blocked to prevent double-spend.`,
          { chainId: String(chainId) }
        );
      }


      throw err;
    }
  }

  private async executeWithFailover<T>(
    chainId: string | number,
    category: RequestCategory,
    method: string,
    params: any[],
    options?: { timeoutMs?: number; requireBlockSync?: boolean }
  ): Promise<T> {
    const eligible = this.manager.selectEligibleEndpoints(chainId, {
      requireBlockSync: options?.requireBlockSync
    });

    if (eligible.length === 0) {
      throw new AllProvidersUnavailableError(chainId, method, 0);
    }

    const timeoutMs = options?.timeoutMs || this.defaultTimeoutMs;
    let lastError: any = null;
    let failoverCount = 0;

    for (let attempt = 0; attempt < eligible.length && attempt < this.maxRetries; attempt++) {
      const endpoint = eligible[attempt];
      const startTime = Date.now();

      try {
        const result = await this.rawJsonRpcCall<T>(
          endpoint.url,
          method,
          params,
          timeoutMs
        );

        const latencyMs = Date.now() - startTime;
        let blockNum: number | undefined = undefined;
        if (method === 'eth_blockNumber' && typeof result === 'string') {
          blockNum = parseInt(result, 16);
        }

        this.manager.recordSuccess(endpoint.id, latencyMs, blockNum);
        this.manager.recordTelemetry({
          eventId: `tel-${Date.now()}-${this.nextEventId++}`,
          providerId: endpoint.id,
          chainId: String(chainId),
          operation: method,
          category,
          latencyMs,
          success: true,
          retryCount: attempt,
          failoverCount,
          blockNumber: blockNum,
          timestamp: Date.now()
        });

        return result;
      } catch (err: any) {
        const latencyMs = Date.now() - startTime;
        const errCat = this.classifyError(err);
        const isTimeout = err instanceof RpcTimeoutError || err.name === 'AbortError';

        this.manager.recordFailure(endpoint.id, isTimeout, errCat);
        this.manager.recordTelemetry({
          eventId: `tel-${Date.now()}-${this.nextEventId++}`,
          providerId: endpoint.id,
          chainId: String(chainId),
          operation: method,
          category,
          latencyMs,
          success: false,
          errorCategory: errCat,
          retryCount: attempt,
          failoverCount,
          timestamp: Date.now(),
          metadata: { error: err?.message || String(err) }
        });

        lastError = err;

        // If error is NON_RETRYABLE (e.g. deterministic smart contract revert on eth_call),
        // fail immediately rather than trying other providers with same calldata.
        if (errCat === 'NON_RETRYABLE') {
          throw err;
        }

        failoverCount++;

        // Backoff before trying the next provider
        if (attempt < eligible.length - 1 && attempt < this.maxRetries - 1) {
          const backoff = this.calculateBackoff(attempt);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      }
    }

    throw new AllProvidersUnavailableError(
      chainId,
      `${method} (last error: ${lastError?.message || lastError})`,
      eligible.length
    );
  }

  private async rawJsonRpcCall<T>(
    url: string,
    method: string,
    params: any[],
    timeoutMs: number
  ): Promise<T> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: this.nextRpcId++,
          method,
          params
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (res.status === 429) {
        throw new RpcRateLimitError(url);
      }

      if (!res.ok) {
        throw new Error(`RPC server error HTTP ${res.status}: ${res.statusText}`);
      }


      const json = await res.json();
      if (json.error) {
        const errObj = new Error(json.error.message || `RPC error: ${JSON.stringify(json.error)}`);
        (errObj as any).code = json.error.code;
        (errObj as any).data = json.error.data;
        throw errObj;
      }

      return json.result as T;
    } catch (err: any) {
      if (err.name === 'AbortError' || (err.message && err.message.includes('timeout'))) {
        throw new RpcTimeoutError(url, timeoutMs, method);
      }
      throw err;
    }
  }

  // Common high-level EVM helpers
  public async getBlockNumber(chainId: string | number): Promise<number> {
    const hex = await this.executeReadOnly<string>(chainId, 'eth_blockNumber', []);
    return parseInt(hex || '0x0', 16);
  }

  public async getBalance(chainId: string | number, address: string): Promise<bigint> {
    const hex = await this.executeReadOnly<string>(chainId, 'eth_getBalance', [address, 'latest']);
    return BigInt(hex || '0x0');
  }

  public async getCode(chainId: string | number, address: string): Promise<string> {
    return this.executeReadOnly<string>(chainId, 'eth_getCode', [address, 'latest']);
  }

  public async call(
    chainId: string | number,
    tx: { to: string; data?: string; value?: string | bigint; from?: string }
  ): Promise<string> {
    const formattedTx: any = {
      to: tx.to,
      data: tx.data || '0x'
    };
    if (tx.value !== undefined) {
      formattedTx.value = typeof tx.value === 'bigint' ? `0x${tx.value.toString(16)}` : tx.value;
    }
    if (tx.from) {
      formattedTx.from = tx.from;
    }

    return this.executePreBroadcast<string>(chainId, 'eth_call', [formattedTx, 'latest']);
  }

  public async getTransaction(chainId: string | number, txHash: string): Promise<any> {
    return this.executeReadOnly<any>(chainId, 'eth_getTransactionByHash', [txHash]);
  }

  public async getTransactionReceipt(chainId: string | number, txHash: string): Promise<any> {
    return this.executeReadOnly<any>(chainId, 'eth_getTransactionReceipt', [txHash]);
  }

  public async getTransactionCount(
    chainId: string | number,
    address: string,
    blockTag: string = 'latest'
  ): Promise<number> {
    const hex = await this.executeReadOnly<string>(chainId, 'eth_getTransactionCount', [address, blockTag]);
    return parseInt(hex || '0x0', 16);
  }

  public async estimateGas(chainId: string | number, tx: any): Promise<bigint> {
    const hex = await this.executePreBroadcast<string>(chainId, 'eth_estimateGas', [tx]);
    return BigInt(hex || '0x0');
  }

  public async getFeeData(
    chainId: string | number
  ): Promise<{ maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint; gasPrice?: bigint }> {
    try {
      // Try gasPrice first
      const gasPriceHex = await this.executeReadOnly<string>(chainId, 'eth_gasPrice', []);
      const gasPrice = BigInt(gasPriceHex || '0x0');

      // Try maxPriorityFeePerGas if supported
      try {
        const priorityHex = await this.executeReadOnly<string>(chainId, 'eth_maxPriorityFeePerGas', []);
        const maxPriorityFeePerGas = BigInt(priorityHex || '0x0');
        const maxFeePerGas = gasPrice * 2n + maxPriorityFeePerGas;
        return { maxFeePerGas, maxPriorityFeePerGas, gasPrice };
      } catch {
        return { gasPrice };
      }
    } catch (err) {
      return {};
    }
  }
}

export const defaultMultiProviderRpcClient = new MultiProviderRpcClient();
