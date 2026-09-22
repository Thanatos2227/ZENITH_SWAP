import type {
  CrossChainQuoteErrorCode,
  QuoteProviderDiagnostic,
  Token
} from '@zenith/types';
import { AggregateCrossChainQuoteError } from '@zenith/contracts';

export class QuoteDiagnosticLogger {
  private diagnosticsLog: QuoteProviderDiagnostic[] = [];
  private maxLogs: number = 200;

  /**
   * Sanitizes URLs by removing any query string sensitive tokens/keys if present.
   */
  public sanitizeUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      const sensitiveKeys = ['key', 'apikey', 'api_key', 'secret', 'auth', 'token', 'signature'];
      for (const k of Array.from(parsed.searchParams.keys())) {
        if (sensitiveKeys.some((s) => k.toLowerCase().includes(s))) {
          parsed.searchParams.set(k, '[REDACTED]');
        }
      }
      return parsed.toString();
    } catch {
      return rawUrl.replace(/(key|secret|token|auth)=[^&]+/gi, '$1=[REDACTED]');
    }
  }

  /**
   * Normalizes arbitrary provider errors into the standardized CrossChainQuoteErrorCode taxonomy.
   */
  public normalizeErrorCode(err: any, httpStatus?: number): CrossChainQuoteErrorCode {
    if (httpStatus === 401 || httpStatus === 403) {
      return 'API_AUTH_REQUIRED';
    }
    if (httpStatus === 429) {
      return 'RATE_LIMITED';
    }
    if (httpStatus === 400) {
      const msg = String(err?.message || err || '').toLowerCase();
      if (msg.includes('token') || msg.includes('asset')) return 'UNSUPPORTED_TOKEN';
      if (msg.includes('chain')) return 'INVALID_CHAIN';
      if (msg.includes('amount') || msg.includes('minimum') || msg.includes('limit')) return 'INVALID_AMOUNT';
      return 'MALFORMED_RESPONSE';
    }
    if (httpStatus && httpStatus >= 500) {
      return 'PROVIDER_UNAVAILABLE';
    }

    const msg = String(err?.message || err || '').toLowerCase();
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort') || msg.includes('etimedout')) {
      return 'PROVIDER_UNAVAILABLE';
    }
    if (msg.includes('rate limit') || msg.includes('429')) {
      return 'RATE_LIMITED';
    }
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused') || msg.includes('econnreset')) {
      return 'PROVIDER_UNAVAILABLE';
    }
    if (msg.includes('unsupported token') || msg.includes('no pool') || msg.includes('unsupported asset')) {
      return 'UNSUPPORTED_TOKEN';
    }
    if (msg.includes('unsupported route') || msg.includes('chain not supported')) {
      return 'UNSUPPORTED_ROUTE';
    }
    if (msg.includes('expired')) {
      return 'QUOTE_EXPIRED';
    }
    if (msg.includes('amount')) {
      return 'INVALID_AMOUNT';
    }
    if (msg.includes('calldata') || msg.includes('execution target')) {
      return 'INVALID_EXECUTION_DATA';
    }

    return 'UNKNOWN_PROVIDER_ERROR';
  }

  /**
   * Records a provider diagnostic entry.
   */
  public record(diagnostic: QuoteProviderDiagnostic): void {
    if (diagnostic.endpoint) {
      diagnostic.endpoint = this.sanitizeUrl(diagnostic.endpoint);
    }
    this.diagnosticsLog.push(diagnostic);
    if (this.diagnosticsLog.length > this.maxLogs) {
      this.diagnosticsLog.shift();
    }
  }

  /**
   * Retrieves recorded diagnostics for a specific route.
   */
  public getDiagnostics(sourceChainId?: string, destinationChainId?: string): QuoteProviderDiagnostic[] {
    if (!sourceChainId && !destinationChainId) {
      return [...this.diagnosticsLog];
    }
    return this.diagnosticsLog.filter((d) => {
      const srcMatch = !sourceChainId || String(d.sourceChainId).toLowerCase() === sourceChainId.toLowerCase();
      const dstMatch = !destinationChainId || String(d.destinationChainId).toLowerCase() === destinationChainId.toLowerCase();
      return srcMatch && dstMatch;
    });
  }

  /**
   * Builds an AggregateCrossChainQuoteError with structured per-provider diagnostics.
   */
  public buildAggregateError(params: {
    sourceChainId: string;
    destinationChainId: string;
    tokenIn: Token;
    tokenOut: Token;
    amountInRaw: string;
    diagnostics: Record<string, QuoteProviderDiagnostic>;
  }): AggregateCrossChainQuoteError {
    const { sourceChainId, destinationChainId, tokenIn, tokenOut, diagnostics } = params;
    return new AggregateCrossChainQuoteError({
      sourceChainId,
      destinationChainId,
      sourceTokenSymbol: tokenIn.symbol,
      destinationTokenSymbol: tokenOut.symbol,
      providerDiagnostics: diagnostics
    });
  }

  public clear(): void {
    this.diagnosticsLog = [];
  }
}

export const defaultQuoteDiagnosticLogger = new QuoteDiagnosticLogger();
