import type { CrossChainQuoteErrorCode, QuoteProviderDiagnostic, Token } from '@zenith/types';
import { AggregateCrossChainQuoteError } from '@zenith/contracts';

export class QuoteDiagnosticLogger {
    private diagnosticsLog: QuoteProviderDiagnostic[] = [];
    private maxLogs: number = 200;

    public sanitizeUrl(rawUrl: string): string {
        try {
            const parsed = new URL(rawUrl);
            const sensitiveKeys = ['key', 'apikey', 'api_key', 'secret', 'auth', 'token', 'signature', 'bearer', 'private_key', 'privatekey'];
            for (const k of Array.from(parsed.searchParams.keys())) {
                if (sensitiveKeys.some((s) => k.toLowerCase().includes(s))) {
                    parsed.searchParams.set(k, '[REDACTED]');
                }
            }
            return parsed.toString();
        } catch {
            return rawUrl.replace(/(key|secret|token|auth|bearer|signature)=[^&]+/gi, '$1=[REDACTED]');
        }
    }

    public sanitizeMessage(rawMsg: string): string {
        if (!rawMsg) return '';
        return rawMsg
            .replace(/(0x)?[a-fA-F0-9]{64}/g, '[REDACTED_SECRET]')
            .replace(/(api[_-]?key|secret|token|auth|bearer)=[^&\s,]+/gi, '$1=[REDACTED]');
    }

    public normalizeErrorCode(err: any, httpStatus?: number, errorPayload?: any): CrossChainQuoteErrorCode {
        if (httpStatus === 401 || httpStatus === 403) {
            return 'API_AUTH_REQUIRED';
        }
        if (httpStatus === 429) {
            return 'RATE_LIMITED';
        }
        if (httpStatus && httpStatus >= 500 && httpStatus <= 599) {
            return 'PROVIDER_UNAVAILABLE';
        }

        const rawMsg = typeof err === 'string'
            ? err
            : (err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err || '')));
        const payloadMsg = errorPayload
            ? (typeof errorPayload === 'string' ? errorPayload : JSON.stringify(errorPayload))
            : '';
        const combinedMsg = `${rawMsg} ${payloadMsg}`.toLowerCase();

        // 1. Token / Asset Errors
        if (
            combinedMsg.includes('unsupported token') ||
            combinedMsg.includes('token not supported') ||
            combinedMsg.includes('unknown token') ||
            combinedMsg.includes('no pool for token') ||
            combinedMsg.includes('unsupported asset') ||
            combinedMsg.includes('asset not supported') ||
            combinedMsg.includes('unsupported token pair') ||
            combinedMsg.includes('token pair not supported') ||
            combinedMsg.includes('unsupported pair')
        ) {
            return 'UNSUPPORTED_TOKEN';
        }

        if (
            combinedMsg.includes('invalid token') ||
            combinedMsg.includes('invalid srcchaintokenin') ||
            combinedMsg.includes('invalid dstchaintokenout') ||
            combinedMsg.includes('invalid token address') ||
            combinedMsg.includes('malformed token') ||
            combinedMsg.includes('invalid address')
        ) {
            return 'INVALID_TOKEN';
        }

        // 2. Route / Cross-Asset Errors
        if (
            combinedMsg.includes('cross asset not supported') ||
            combinedMsg.includes('cross_asset_direct_unsupported') ||
            combinedMsg.includes('unsupported route') ||
            combinedMsg.includes('route not supported') ||
            combinedMsg.includes('no route found') ||
            combinedMsg.includes('route unavailable')
        ) {
            return 'UNSUPPORTED_ROUTE';
        }

        // 3. Chain Errors
        if (
            combinedMsg.includes('unsupported chain') ||
            combinedMsg.includes('chain not supported') ||
            combinedMsg.includes('invalid chain') ||
            combinedMsg.includes('unsupported chain id') ||
            combinedMsg.includes('invalid_chain_pair')
        ) {
            return 'INVALID_CHAIN';
        }

        // 4. Liquidity Errors
        if (
            combinedMsg.includes('insufficient liquidity') ||
            combinedMsg.includes('not enough liquidity') ||
            combinedMsg.includes('low liquidity') ||
            combinedMsg.includes('pool empty') ||
            combinedMsg.includes('cannot fill')
        ) {
            return 'INSUFFICIENT_LIQUIDITY';
        }

        // 5. Amount / Limit Errors
        if (
            combinedMsg.includes('amount too small') ||
            combinedMsg.includes('below minimum') ||
            combinedMsg.includes('minimum amount') ||
            combinedMsg.includes('amount is below') ||
            combinedMsg.includes('exceeds limit') ||
            combinedMsg.includes('amount too large') ||
            combinedMsg.includes('maximum amount') ||
            combinedMsg.includes('invalid amount') ||
            combinedMsg.includes('amount is required') ||
            combinedMsg.includes('invalid_amount')
        ) {
            return 'INVALID_AMOUNT';
        }

        // 6. Network / Timeout / Availability
        if (
            combinedMsg.includes('timeout') ||
            combinedMsg.includes('timed out') ||
            combinedMsg.includes('abort') ||
            combinedMsg.includes('etimedout') ||
            combinedMsg.includes('econnrefused') ||
            combinedMsg.includes('econnreset') ||
            combinedMsg.includes('network') ||
            combinedMsg.includes('fetch failed')
        ) {
            return 'PROVIDER_UNAVAILABLE';
        }

        // 7. Rate Limits
        if (combinedMsg.includes('rate limit') || combinedMsg.includes('too many requests') || combinedMsg.includes('429')) {
            return 'RATE_LIMITED';
        }

        // 8. Auth
        if (combinedMsg.includes('unauthorized') || combinedMsg.includes('forbidden') || combinedMsg.includes('api key') || combinedMsg.includes('authentication')) {
            return 'API_AUTH_REQUIRED';
        }

        // 9. Expiration
        if (combinedMsg.includes('expired') || combinedMsg.includes('quote_expired')) {
            return 'QUOTE_EXPIRED';
        }

        // 10. Execution / Calldata
        if (combinedMsg.includes('calldata') || combinedMsg.includes('execution target') || combinedMsg.includes('invalid execution')) {
            return 'INVALID_EXECUTION_DATA';
        }

        // 11. Malformed JSON Response (HTTP 200 with corrupt body)
        if (combinedMsg.includes('json parse') || combinedMsg.includes('syntax error') || combinedMsg.includes('unexpected token') || combinedMsg.includes('malformed')) {
            return 'MALFORMED_RESPONSE';
        }

        if (httpStatus === 400) {
            return 'UNKNOWN_PROVIDER_ERROR';
        }

        return 'UNKNOWN_PROVIDER_ERROR';
    }

    public record(diagnostic: QuoteProviderDiagnostic): void {
        if (diagnostic.endpoint) {
            diagnostic.endpoint = this.sanitizeUrl(diagnostic.endpoint);
        }
        if (diagnostic.providerErrorMessage) {
            diagnostic.providerErrorMessage = this.sanitizeMessage(diagnostic.providerErrorMessage);
        }
        this.diagnosticsLog.push(diagnostic);
        if (this.diagnosticsLog.length > this.maxLogs) {
            this.diagnosticsLog.shift();
        }
    }

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
