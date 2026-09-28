import type {
  RpcEndpointClass,
  RpcTransportType,
  RpcCapabilityType,
  RpcVerificationStatus,
  RpcDisagreementLevel,
  RpcErrorType,
  RateLimitPolicy,
  RetryPolicy,
  ExpectedChainIdentity,
  RpcProviderProfile,
  RpcDisagreementEvaluation,
  RpcMetricsSnapshot
} from '@zenith/types';

export type {
  RpcEndpointClass,
  RpcTransportType,
  RpcCapabilityType,
  RpcVerificationStatus,
  RpcDisagreementLevel,
  RpcErrorType,
  RateLimitPolicy,
  RetryPolicy,
  ExpectedChainIdentity,
  RpcProviderProfile,
  RpcDisagreementEvaluation,
  RpcMetricsSnapshot
};

/**
 * Validates endpoint URL format and protocol.
 */
export function validateRpcEndpointUrl(url: string, transport: RpcTransportType): { valid: boolean; reason?: string } {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return { valid: false, reason: 'Endpoint URL must be a non-empty string' };
  }

  try {
    const parsed = new URL(url);
    if (transport === 'HTTPS' && parsed.protocol !== 'https:') {
      return { valid: false, reason: `HTTPS transport requires https: protocol, found ${parsed.protocol}` };
    }
    if (transport === 'HTTP' && parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, reason: `HTTP transport requires http(s): protocol, found ${parsed.protocol}` };
    }
    if (transport === 'WSS' && parsed.protocol !== 'wss:') {
      return { valid: false, reason: `WSS transport requires wss: protocol, found ${parsed.protocol}` };
    }
    if (transport === 'WS' && parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      return { valid: false, reason: `WS transport requires ws(s): protocol, found ${parsed.protocol}` };
    }
    return { valid: true };
  } catch (err: any) {
    return { valid: false, reason: `Malformed URL: ${err?.message || 'Invalid format'}` };
  }
}

/**
 * Sanitizes an RPC URL by stripping basic-auth user/password and sensitive query parameters (e.g. apikey, key, secret).
 */
export function sanitizeRpcUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '***';
    }
    const sensitiveKeys = ['key', 'apikey', 'api_key', 'secret', 'token', 'auth'];
    for (const key of parsed.searchParams.keys()) {
      if (sensitiveKeys.includes(key.toLowerCase())) {
        parsed.searchParams.set(key, '***');
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
