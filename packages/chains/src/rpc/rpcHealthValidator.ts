/**
 * ZENITH Protocol — Authoritative RPC Endpoint Health & Quorum Validator
 *
 * Pre-validates RPC endpoints via raw JSON-RPC before instantiating ethers providers.
 * Completely prevents ethers autodetection retry loops and unhandled 404 / connection errors.
 */

export interface EndpointHealthCheckResult {
  url: string;
  healthy: boolean;
  httpStatus: number | null;
  observedChainId: number | null;
  expectedChainId: number;
  blockNumber: number | null;
  blockTimestamp: number | null;
  latencyMs: number;
  reason?: string;
}

export interface QuorumEvaluationResult {
  networkName: string;
  expectedChainId: number;
  totalConfigured: number;
  healthyCount: number;
  unhealthyCount: number;
  quorumStatus: 'HEALTHY' | 'DEGRADED' | 'FAILED';
  results: EndpointHealthCheckResult[];
  healthyEndpoints: string[];
}

export async function validateSingleRpcEndpoint(
  url: string,
  expectedChainId: number,
  timeoutMs = 4000
): Promise<EndpointHealthCheckResult> {
  const startTime = Date.now();
  let httpStatus: number | null = null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Step 1: Query eth_chainId
    const chainIdReq = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_chainId',
        params: []
      }),
      signal: controller.signal
    }).finally(() => clearTimeout(timeoutId));

    httpStatus = chainIdReq.status;

    if (!chainIdReq.ok) {
      return {
        url,
        healthy: false,
        httpStatus,
        observedChainId: null,
        expectedChainId,
        blockNumber: null,
        blockTimestamp: null,
        latencyMs: Date.now() - startTime,
        reason: `HTTP ${chainIdReq.status} ${chainIdReq.statusText || 'Error'}`
      };
    }

    const chainIdJson: any = await chainIdReq.json();
    if (!chainIdJson || chainIdJson.error || !chainIdJson.result) {
      return {
        url,
        healthy: false,
        httpStatus,
        observedChainId: null,
        expectedChainId,
        blockNumber: null,
        blockTimestamp: null,
        latencyMs: Date.now() - startTime,
        reason: chainIdJson?.error?.message || 'Malformed JSON-RPC response for eth_chainId'
      };
    }

    const observedChainId = typeof chainIdJson.result === 'string'
      ? parseInt(chainIdJson.result, 16)
      : Number(chainIdJson.result);

    if (observedChainId !== expectedChainId) {
      return {
        url,
        healthy: false,
        httpStatus,
        observedChainId,
        expectedChainId,
        blockNumber: null,
        blockTimestamp: null,
        latencyMs: Date.now() - startTime,
        reason: `Chain ID mismatch: observed ${observedChainId} != expected ${expectedChainId}`
      };
    }

    // Step 2: Query latest block for block number and timestamp
    const blockController = new AbortController();
    const blockTimeoutId = setTimeout(() => blockController.abort(), timeoutMs);

    const blockReq = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'eth_getBlockByNumber',
        params: ['latest', false]
      }),
      signal: blockController.signal
    }).finally(() => clearTimeout(blockTimeoutId));

    if (!blockReq.ok) {
      return {
        url,
        healthy: false,
        httpStatus: blockReq.status,
        observedChainId,
        expectedChainId,
        blockNumber: null,
        blockTimestamp: null,
        latencyMs: Date.now() - startTime,
        reason: `HTTP ${blockReq.status} fetching latest block`
      };
    }

    const blockJson: any = await blockReq.json();
    const block = blockJson?.result;

    if (!block || !block.number) {
      return {
        url,
        healthy: false,
        httpStatus,
        observedChainId,
        expectedChainId,
        blockNumber: null,
        blockTimestamp: null,
        latencyMs: Date.now() - startTime,
        reason: 'Missing or invalid block data from eth_getBlockByNumber'
      };
    }

    const blockNumber = parseInt(block.number, 16);
    const blockTimestamp = parseInt(block.timestamp, 16);

    return {
      url,
      healthy: true,
      httpStatus,
      observedChainId,
      expectedChainId,
      blockNumber,
      blockTimestamp,
      latencyMs: Date.now() - startTime
    };
  } catch (err: any) {
    const isTimeout = err.name === 'AbortError' || err.message?.includes('aborted');
    return {
      url,
      healthy: false,
      httpStatus,
      observedChainId: null,
      expectedChainId,
      blockNumber: null,
      blockTimestamp: null,
      latencyMs: Date.now() - startTime,
      reason: isTimeout ? `Request timed out after ${timeoutMs}ms` : (err.message || 'Connection failed')
    };
  }
}

export async function evaluateRpcQuorum(
  networkName: string,
  expectedChainId: number,
  endpoints: string[],
  timeoutMs = 4000
): Promise<QuorumEvaluationResult> {
  const checkPromises = endpoints.map(url => validateSingleRpcEndpoint(url, expectedChainId, timeoutMs));
  const results = await Promise.all(checkPromises);

  const healthyResults = results.filter(r => r.healthy);
  const healthyCount = healthyResults.length;
  const unhealthyCount = results.length - healthyCount;

  let quorumStatus: 'HEALTHY' | 'DEGRADED' | 'FAILED' = 'FAILED';

  if (healthyCount >= 2 || (endpoints.length === 1 && healthyCount === 1)) {
    quorumStatus = 'HEALTHY';
  } else if (healthyCount > 0) {
    quorumStatus = 'DEGRADED';
  } else {
    quorumStatus = 'FAILED';
  }

  return {
    networkName,
    expectedChainId,
    totalConfigured: endpoints.length,
    healthyCount,
    unhealthyCount,
    quorumStatus,
    results,
    healthyEndpoints: healthyResults.map(r => r.url)
  };
}
