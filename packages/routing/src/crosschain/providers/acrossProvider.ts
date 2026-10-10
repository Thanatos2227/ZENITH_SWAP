import {
  BridgeProtocol,
  CrossChainExecution,
  CrossChainProvider,
  CrossChainQuote,
  CrossChainStatus,
  ExecutionPlanDiagnostic,
  QuoteRequest,
  Token
} from '@zenith/types';
import { defaultChainRegistry } from '@zenith/chains';
import {
  getAcrossSpokePool,
  isAcrossSupported,
  validateTokenAddress,
  validateExecutionTarget,
  ProviderUnavailableError,
  ExecutionUnavailableError
} from '@zenith/contracts';
import { isNativeToken } from '../../dex/dexMath';
import { validateCrossChainQuoteExecutability } from '../quoteValidator';
import { defaultQuoteDiagnosticLogger } from '../quoteDiagnostics';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const EVM_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
const ACROSS_INTEGRATOR_ID_REGEX = /^0x[0-9a-fA-F]{4}$/;

export interface AcrossProviderOptions {
  apiKey?: string;
  integratorId?: string;
  apiBaseUrl?: string;
  statusApiBaseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class AcrossProvider implements CrossChainProvider {
  public readonly id: BridgeProtocol = 'ACROSS';
  public readonly name = 'Across Protocol V3';
  private apiKey?: string;
  private integratorId?: string;
  private customApiBaseUrl?: string;
  private customStatusApiBaseUrl?: string;
  private customFetch?: typeof fetch;
  private timeoutMs: number;

  constructor(options?: AcrossProviderOptions) {
    this.apiKey = options?.apiKey;
    this.integratorId = options?.integratorId;
    this.customApiBaseUrl = options?.apiBaseUrl;
    this.customStatusApiBaseUrl = options?.statusApiBaseUrl;
    this.customFetch = options?.fetchFn;
    this.timeoutMs = options?.timeoutMs || 4000;
  }

  private getCredentials(): { apiKey?: string; integratorId?: string } {
    const apiKey =
      this.apiKey ||
      (typeof process !== 'undefined'
        ? process.env.ACROSS_API_KEY || process.env.ZENITH_ACROSS_API_KEY
        : undefined);
    const integratorId =
      this.integratorId ||
      (typeof process !== 'undefined'
        ? process.env.ACROSS_INTEGRATOR_ID || process.env.ZENITH_ACROSS_INTEGRATOR_ID
        : undefined);
    return {
      apiKey: apiKey?.trim(),
      integratorId: integratorId?.trim()
    };
  }

  public isAvailable(
    sourceChainId?: string,
    destinationChainId?: string,
    tokenIn?: Token,
    tokenOut?: Token
  ): boolean {
    if (!sourceChainId || !destinationChainId) return false;
    if (sourceChainId.toLowerCase() === destinationChainId.toLowerCase()) return false;
    const src = defaultChainRegistry.getChain(sourceChainId);
    const dst = defaultChainRegistry.getChain(destinationChainId);

    if (!src?.chainId || !dst?.chainId) return false;
    if (src.executionEnvironment !== 'EVM' || dst.executionEnvironment !== 'EVM') return false;

    if (!isAcrossSupported(src.chainId) || !isAcrossSupported(dst.chainId)) return false;

    if (tokenIn && tokenOut) {
      const symIn = (tokenIn.symbol || '').toUpperCase().replace(/^W/, '');
      const symOut = (tokenOut.symbol || '').toUpperCase().replace(/^W/, '');
      if (symIn !== symOut) {
        const isUsd = (s: string) => s.startsWith('USD');
        if (!isUsd(symIn) || !isUsd(symOut)) {
          return false;
        }
      }
    }

    return true;
  }

  public async getQuote(request: QuoteRequest): Promise<CrossChainQuote | null> {
    const sourceChainId = request.sourceChainId || (request as any).srcChainId;
    const destinationChainId = request.destinationChainId || (request as any).destChainId;

    if (!this.isAvailable(sourceChainId, destinationChainId, request.tokenIn, request.tokenOut)) {
      return null;
    }

    const srcChain = defaultChainRegistry.getChain(sourceChainId)!;
    const dstChain = defaultChainRegistry.getChain(destinationChainId)!;

    const spokePool = validateExecutionTarget(getAcrossSpokePool(srcChain.chainId!), srcChain.id);
    const amountInBig = BigInt(request.amountInRaw || (request as any).amountIn || '0');
    if (amountInBig <= 0n) return null;

    const validatedInputToken = validateTokenAddress(request.tokenIn.address, srcChain.id, request.tokenIn.isNative);
    const validatedOutputToken = validateTokenAddress(request.tokenOut.address, dstChain.id, request.tokenOut.isNative);

    const isSrcNative = isNativeToken(request.tokenIn.address) || Boolean(request.tokenIn.isNative);
    const isDstNative = isNativeToken(request.tokenOut.address) || Boolean(request.tokenOut.isNative);

    const acrossInputToken = isSrcNative
      ? (request.tokenIn.wrappedAddress || (srcChain.nativeCurrency as any)?.wrappedAddress || validatedInputToken)
      : validatedInputToken;

    const acrossOutputToken = isDstNative
      ? (request.tokenOut.wrappedAddress || (dstChain.nativeCurrency as any)?.wrappedAddress || validatedOutputToken)
      : validatedOutputToken;

    const quoteArrivalTimestamp = Date.now();
    const startTime = Date.now();
    const isTestnet = (
      srcChain.chainId === 11155111 ||
      srcChain.chainId === 421614 ||
      srcChain.chainId === 84532 ||
      srcChain.chainId === 11155420 ||
      dstChain.chainId === 11155111 ||
      dstChain.chainId === 421614 ||
      dstChain.chainId === 84532 ||
      dstChain.chainId === 11155420
    );

    // 1. FAIL-CLOSED DEPOSITOR REQUIREMENT
    const rawDepositor = (request.userWalletAddress || (request as any).sender)?.trim();
    if (!rawDepositor || rawDepositor === ZERO_ADDRESS || !EVM_ADDRESS_REGEX.test(rawDepositor) || rawDepositor.toLowerCase() === spokePool.toLowerCase()) {
      const depDiagnostic: ExecutionPlanDiagnostic = {
        code: 'ACROSS_DEPOSITOR_REQUIRED',
        message: 'Valid non-zero user depositor wallet address is required for Across execution.',
        severity: 'ERROR',
        providerId: 'ACROSS',
        timestamp: Date.now()
      };

      const unexecutableQuote: CrossChainQuote = {
        provider: 'ACROSS',
        providerName: this.name,
        sourceChainId: request.sourceChainId,
        destinationChainId: request.destinationChainId,
        sourceToken: request.tokenIn,
        destinationToken: request.tokenOut,
        sourceAmountRaw: amountInBig.toString(),
        destinationAmountRaw: '0',
        minDestinationAmountRaw: '0',
        bridgeFeeUSD: 0,
        relayerFee: '0%',
        gasEstimateUSD: defaultChainRegistry.getEstimatedGasCostUSD(srcChain.id, 'BRIDGE', request.gasPreset),
        recipient: '',
        expiration: quoteArrivalTimestamp + 60000,
        routeIdentifier: `across-${srcChain.id}-${dstChain.id}-${Date.now()}`,
        executionTarget: spokePool,
        calldata: '0x',
        value: '0',
        approvalTarget: spokePool,
        quoteTimestamp: quoteArrivalTimestamp,
        estimatedTransferTimeSec: 30,
        securityRating: 'A+',
        isExecutable: false,
        unexecutableReason: 'ACROSS_DEPOSITOR_REQUIRED',
        diagnostics: [depDiagnostic]
      };

      defaultQuoteDiagnosticLogger.record({
        provider: 'ACROSS',
        providerName: this.name,
        sourceChainId: request.sourceChainId,
        destinationChainId: request.destinationChainId,
        sourceToken: request.tokenIn.symbol,
        destinationToken: request.tokenOut.symbol,
        amountInRaw: amountInBig.toString(),
        requestStatus: 'FAILED',
        httpStatus: 400,
        normalizedError: 'INVALID_TARGET',
        providerErrorMessage: 'Valid non-zero user depositor wallet address is required.',
        isExecutable: false,
        unexecutableReason: unexecutableQuote.unexecutableReason,
        latencyMs: 0,
        endpoint: 'https://app.across.to/api/swap/approval',
        timestamp: Date.now()
      });

      return unexecutableQuote;
    }

    // 2. FAIL-CLOSED RECIPIENT REQUIREMENT
    const rawRecipient = (request.recipientAddress || (request as any).recipient)?.trim();
    if (!rawRecipient || rawRecipient === ZERO_ADDRESS || !EVM_ADDRESS_REGEX.test(rawRecipient) || rawRecipient.toLowerCase() === spokePool.toLowerCase()) {
      const recDiagnostic: ExecutionPlanDiagnostic = {
        code: 'ACROSS_RECIPIENT_REQUIRED',
        message: 'Valid non-zero destination recipient address is required for Across execution.',
        severity: 'ERROR',
        providerId: 'ACROSS',
        timestamp: Date.now()
      };

      const unexecutableQuote: CrossChainQuote = {
        provider: 'ACROSS',
        providerName: this.name,
        sourceChainId: request.sourceChainId,
        destinationChainId: request.destinationChainId,
        sourceToken: request.tokenIn,
        destinationToken: request.tokenOut,
        sourceAmountRaw: amountInBig.toString(),
        destinationAmountRaw: '0',
        minDestinationAmountRaw: '0',
        bridgeFeeUSD: 0,
        relayerFee: '0%',
        gasEstimateUSD: defaultChainRegistry.getEstimatedGasCostUSD(srcChain.id, 'BRIDGE', request.gasPreset),
        recipient: '',
        expiration: quoteArrivalTimestamp + 60000,
        routeIdentifier: `across-${srcChain.id}-${dstChain.id}-${Date.now()}`,
        executionTarget: spokePool,
        calldata: '0x',
        value: '0',
        approvalTarget: spokePool,
        quoteTimestamp: quoteArrivalTimestamp,
        estimatedTransferTimeSec: 30,
        securityRating: 'A+',
        isExecutable: false,
        unexecutableReason: 'ACROSS_RECIPIENT_REQUIRED',
        diagnostics: [recDiagnostic]
      };

      defaultQuoteDiagnosticLogger.record({
        provider: 'ACROSS',
        providerName: this.name,
        sourceChainId: request.sourceChainId,
        destinationChainId: request.destinationChainId,
        sourceToken: request.tokenIn.symbol,
        destinationToken: request.tokenOut.symbol,
        amountInRaw: amountInBig.toString(),
        requestStatus: 'FAILED',
        httpStatus: 400,
        normalizedError: 'INVALID_TARGET',
        providerErrorMessage: 'Valid non-zero destination recipient address is required.',
        isExecutable: false,
        unexecutableReason: unexecutableQuote.unexecutableReason,
        latencyMs: 0,
        endpoint: 'https://app.across.to/api/swap/approval',
        timestamp: Date.now()
      });

      return unexecutableQuote;
    }

    const { apiKey, integratorId } = this.getCredentials();

    // 3. FAIL-CLOSED AUTHENTICATION GATING: Across API Key
    if (!apiKey) {
      const authDiagnostic: ExecutionPlanDiagnostic = {
        code: 'API_AUTH_REQUIRED',
        message: 'Across API key (ACROSS_API_KEY) is unconfigured. Fail-closed: Production execution disabled.',
        severity: 'ERROR',
        providerId: 'ACROSS',
        timestamp: Date.now()
      };

      const unauthQuote: CrossChainQuote = {
        provider: 'ACROSS',
        providerName: this.name,
        sourceChainId: request.sourceChainId,
        destinationChainId: request.destinationChainId,
        sourceToken: request.tokenIn,
        destinationToken: request.tokenOut,
        sourceAmountRaw: amountInBig.toString(),
        destinationAmountRaw: '0',
        minDestinationAmountRaw: '0',
        bridgeFeeUSD: 0,
        relayerFee: '0%',
        gasEstimateUSD: defaultChainRegistry.getEstimatedGasCostUSD(srcChain.id, 'BRIDGE', request.gasPreset),
        recipient: rawRecipient,
        expiration: quoteArrivalTimestamp + 60000,
        routeIdentifier: `across-${srcChain.id}-${dstChain.id}-${Date.now()}`,
        executionTarget: spokePool,
        calldata: '0x',
        value: '0',
        approvalTarget: spokePool,
        quoteTimestamp: quoteArrivalTimestamp,
        estimatedTransferTimeSec: 30,
        securityRating: 'A+',
        isExecutable: false,
        unexecutableReason: 'ACROSS_AUTH_REQUIRED',
        diagnostics: [authDiagnostic]
      };

      defaultQuoteDiagnosticLogger.record({
        provider: 'ACROSS',
        providerName: this.name,
        sourceChainId: request.sourceChainId,
        destinationChainId: request.destinationChainId,
        sourceToken: request.tokenIn.symbol,
        destinationToken: request.tokenOut.symbol,
        amountInRaw: amountInBig.toString(),
        requestStatus: 'FAILED',
        httpStatus: 401,
        normalizedError: 'API_AUTH_REQUIRED',
        providerErrorMessage: 'ACROSS_API_KEY not configured in environment.',
        isExecutable: false,
        unexecutableReason: unauthQuote.unexecutableReason,
        latencyMs: 0,
        endpoint: 'https://app.across.to/api/swap/approval',
        timestamp: Date.now()
      });

      return unauthQuote;
    }

    // 4. FAIL-CLOSED INTEGRATOR ID GATING: Presence and 2-byte Hex Format
    if (!integratorId) {
      const idDiagnostic: ExecutionPlanDiagnostic = {
        code: 'ACROSS_INTEGRATOR_ID_REQUIRED',
        message: 'Across Integrator ID (ACROSS_INTEGRATOR_ID) is unconfigured. Fail-closed: Production execution disabled.',
        severity: 'ERROR',
        providerId: 'ACROSS',
        timestamp: Date.now()
      };

      const unauthQuote: CrossChainQuote = {
        provider: 'ACROSS',
        providerName: this.name,
        sourceChainId: request.sourceChainId,
        destinationChainId: request.destinationChainId,
        sourceToken: request.tokenIn,
        destinationToken: request.tokenOut,
        sourceAmountRaw: amountInBig.toString(),
        destinationAmountRaw: '0',
        minDestinationAmountRaw: '0',
        bridgeFeeUSD: 0,
        relayerFee: '0%',
        gasEstimateUSD: defaultChainRegistry.getEstimatedGasCostUSD(srcChain.id, 'BRIDGE', request.gasPreset),
        recipient: rawRecipient,
        expiration: quoteArrivalTimestamp + 60000,
        routeIdentifier: `across-${srcChain.id}-${dstChain.id}-${Date.now()}`,
        executionTarget: spokePool,
        calldata: '0x',
        value: '0',
        approvalTarget: spokePool,
        quoteTimestamp: quoteArrivalTimestamp,
        estimatedTransferTimeSec: 30,
        securityRating: 'A+',
        isExecutable: false,
        unexecutableReason: 'ACROSS_INTEGRATOR_ID_REQUIRED',
        diagnostics: [idDiagnostic]
      };

      defaultQuoteDiagnosticLogger.record({
        provider: 'ACROSS',
        providerName: this.name,
        sourceChainId: request.sourceChainId,
        destinationChainId: request.destinationChainId,
        sourceToken: request.tokenIn.symbol,
        destinationToken: request.tokenOut.symbol,
        amountInRaw: amountInBig.toString(),
        requestStatus: 'FAILED',
        httpStatus: 401,
        normalizedError: 'API_AUTH_REQUIRED',
        providerErrorMessage: 'ACROSS_INTEGRATOR_ID not configured in environment.',
        isExecutable: false,
        unexecutableReason: unauthQuote.unexecutableReason,
        latencyMs: 0,
        endpoint: 'https://app.across.to/api/swap/approval',
        timestamp: Date.now()
      });

      return unauthQuote;
    }

    if (!ACROSS_INTEGRATOR_ID_REGEX.test(integratorId)) {
      const invalidIdDiagnostic: ExecutionPlanDiagnostic = {
        code: 'ACROSS_INVALID_INTEGRATOR_ID',
        message: `Invalid Across Integrator ID format "${integratorId}". Expected 2-byte hexadecimal string matching /^0x[0-9a-fA-F]{4}$/ (e.g. 0x0001, 0xdead).`,
        severity: 'ERROR',
        providerId: 'ACROSS',
        timestamp: Date.now()
      };

      const invalidIdQuote: CrossChainQuote = {
        provider: 'ACROSS',
        providerName: this.name,
        sourceChainId: request.sourceChainId,
        destinationChainId: request.destinationChainId,
        sourceToken: request.tokenIn,
        destinationToken: request.tokenOut,
        sourceAmountRaw: amountInBig.toString(),
        destinationAmountRaw: '0',
        minDestinationAmountRaw: '0',
        bridgeFeeUSD: 0,
        relayerFee: '0%',
        gasEstimateUSD: defaultChainRegistry.getEstimatedGasCostUSD(srcChain.id, 'BRIDGE', request.gasPreset),
        recipient: rawRecipient,
        expiration: quoteArrivalTimestamp + 60000,
        routeIdentifier: `across-${srcChain.id}-${dstChain.id}-${Date.now()}`,
        executionTarget: spokePool,
        calldata: '0x',
        value: '0',
        approvalTarget: spokePool,
        quoteTimestamp: quoteArrivalTimestamp,
        estimatedTransferTimeSec: 30,
        securityRating: 'A+',
        isExecutable: false,
        unexecutableReason: 'ACROSS_INVALID_INTEGRATOR_ID',
        diagnostics: [invalidIdDiagnostic]
      };

      defaultQuoteDiagnosticLogger.record({
        provider: 'ACROSS',
        providerName: this.name,
        sourceChainId: request.sourceChainId,
        destinationChainId: request.destinationChainId,
        sourceToken: request.tokenIn.symbol,
        destinationToken: request.tokenOut.symbol,
        amountInRaw: amountInBig.toString(),
        requestStatus: 'FAILED',
        httpStatus: 400,
        normalizedError: 'PROVIDER_UNAVAILABLE',
        providerErrorMessage: invalidIdDiagnostic.message,
        isExecutable: false,
        unexecutableReason: invalidIdQuote.unexecutableReason,
        latencyMs: 0,
        endpoint: 'https://app.across.to/api/swap/approval',
        timestamp: Date.now()
      });

      return invalidIdQuote;
    }

    const defaultApiBase = isTestnet ? 'https://testnet.across.to/api/swap/approval' : 'https://app.across.to/api/swap/approval';
    const apiBase = this.customApiBaseUrl || defaultApiBase;

    const queryParams = new URLSearchParams({
      originChainId: String(srcChain.chainId),
      destinationChainId: String(dstChain.chainId),
      inputToken: acrossInputToken.toLowerCase(),
      outputToken: acrossOutputToken.toLowerCase(),
      amount: amountInBig.toString(),
      tradeType: 'exactInput',
      depositor: rawDepositor.toLowerCase(),
      recipient: rawRecipient.toLowerCase(),
      integratorId
    });

    const url = `${apiBase}?${queryParams.toString()}`;
    const sanitizedUrl = `${apiBase}?originChainId=${srcChain.chainId}&destinationChainId=${dstChain.chainId}&inputToken=${acrossInputToken}&outputToken=${acrossOutputToken}&amount=${amountInBig.toString()}&tradeType=exactInput&integratorId=[REDACTED]`;

    let destinationAmountBig = 0n;
    let minDestinationAmountBig = 0n;
    let bridgeFeeUSD = 0;
    let relayerFeePctStr = '0.05%';
    let estTransferTimeSec = 30;
    let protocolTimestampSec = Math.floor(quoteArrivalTimestamp / 1000);
    let quoteExpiryMs = quoteArrivalTimestamp + 300000;
    let isLiveQuote = false;
    let quoteDiagnostic: ExecutionPlanDiagnostic | undefined = undefined;
    let httpStatus: number | undefined = undefined;
    let swapTx: { to: string; data: string; value?: string; chainId?: number } | undefined = undefined;
    let approvalTxns: any[] = [];
    let checks: any = undefined;

    const fetchImpl = this.customFetch || fetch;

    try {
      const res = await fetchImpl(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      httpStatus = res.status;

      if (res.ok) {
        const data = await res.json();

        if (data && typeof data === 'object') {
          // Parse swapTx from Across Swap API
          if (data.swapTx && typeof data.swapTx === 'object' && data.swapTx.to && data.swapTx.data) {
            const rawTo = String(data.swapTx.to).trim();
            const rawData = String(data.swapTx.data).trim();

            if (rawData.startsWith('0x') && rawData.length >= 10 && rawTo !== ZERO_ADDRESS) {
              swapTx = {
                to: validateExecutionTarget(rawTo, srcChain.id),
                data: rawData,
                value: data.swapTx.value ? String(data.swapTx.value) : (isSrcNative ? amountInBig.toString() : '0'),
                chainId: data.swapTx.chainId ? Number(data.swapTx.chainId) : srcChain.chainId
              };
            }
          }

          // Parse approval transactions
          if (Array.isArray(data.approvalTxns)) {
            let malformedApproval = false;
            for (const item of data.approvalTxns) {
              if (!item || typeof item !== 'object') {
                malformedApproval = true;
                break;
              }
              const itemTo = item.to ? String(item.to).trim() : '';
              const itemData = item.data ? String(item.data).trim() : '';
              if (!itemTo || !EVM_ADDRESS_REGEX.test(itemTo) || itemTo === ZERO_ADDRESS) {
                malformedApproval = true;
                break;
              }
              if (!itemData || !itemData.startsWith('0x') || itemData.length < 10 || !/^0x[0-9a-fA-F]+$/.test(itemData)) {
                malformedApproval = true;
                break;
              }
              if (item.chainId && Number(item.chainId) !== srcChain.chainId) {
                malformedApproval = true;
                break;
              }
            }

            if (malformedApproval) {
              quoteDiagnostic = {
                code: 'MALFORMED_APPROVAL_TRANSACTION',
                message: 'Across Swap API returned an invalid or malformed approval transaction.',
                severity: 'ERROR',
                providerId: 'ACROSS',
                timestamp: Date.now()
              };
            } else {
              approvalTxns = data.approvalTxns;
            }
          }

          // Parse checks
          checks = data.checks;

          // Parse expected output
          const rawOut = data.outputAmount || data.destinationAmount || (data.totalRelayFee && data.totalRelayFee.total ? (amountInBig > BigInt(data.totalRelayFee.total) ? (amountInBig - BigInt(data.totalRelayFee.total)).toString() : '0') : undefined);
          if (rawOut) {
            destinationAmountBig = BigInt(rawOut);
          }

          // Parse minimum output
          const rawMinOut = data.minOutputAmount || data.minimumOutputAmount || data.minDestinationAmount;
          if (rawMinOut) {
            minDestinationAmountBig = BigInt(rawMinOut);
          } else if (destinationAmountBig > 0n) {
            const slippagePct = request.slippageTolerancePercent !== undefined && !isNaN(request.slippageTolerancePercent) ? request.slippageTolerancePercent : 0.5;
            const slippageBps = BigInt(Math.floor(slippagePct * 100));
            const slippageMultiplier = 10000n - slippageBps;
            minDestinationAmountBig = (destinationAmountBig * slippageMultiplier) / 10000n;
          }

          // Parse fees
          if (data.totalRelayFee && data.totalRelayFee.total) {
            const totalFeeRaw = BigInt(data.totalRelayFee.total);
            const inDecimals = request.tokenIn.decimals !== undefined ? request.tokenIn.decimals : 18;
            const feeNum = Number(totalFeeRaw) / (10 ** inDecimals);
            bridgeFeeUSD = request.tokenIn.priceUSD ? Number((feeNum * request.tokenIn.priceUSD).toFixed(4)) : 0.05;

            const rawPct = Number(data.totalRelayFee.pct);
            relayerFeePctStr = data.totalRelayFee.pct
              ? (rawPct > 100 ? `${(rawPct / 1e16).toFixed(4)}%` : `${(rawPct * 100).toFixed(2)}%`)
              : '0.05%';
          }

          // Parse expiration
          if (data.timestamp) {
            protocolTimestampSec = Number(data.timestamp);
          }

          if (data.quoteExpiryTimestamp) {
            const expSec = Number(data.quoteExpiryTimestamp);
            quoteExpiryMs = expSec > 1e11 ? expSec : expSec * 1000;
          } else if (data.timestamp) {
            quoteExpiryMs = Math.max(quoteArrivalTimestamp + 300000, (protocolTimestampSec + 300) * 1000);
          }

          if (data.estimatedFillTimeSec) {
            estTransferTimeSec = Number(data.estimatedFillTimeSec);
          }

          if (!quoteDiagnostic && swapTx && destinationAmountBig > 0n && quoteExpiryMs > Date.now()) {
            isLiveQuote = true;
          } else if (quoteExpiryMs <= Date.now()) {
            quoteDiagnostic = {
              code: 'QUOTE_EXPIRED',
              message: 'Across API returned an expired quote timestamp.',
              severity: 'ERROR',
              providerId: 'ACROSS',
              timestamp: Date.now()
            };
          } else if (!swapTx) {
            quoteDiagnostic = {
              code: 'EXECUTION_DATA_UNAVAILABLE',
              message: 'Across Swap API response is missing valid executable swapTx object.',
              severity: 'ERROR',
              providerId: 'ACROSS',
              timestamp: Date.now()
            };
          } else if (destinationAmountBig <= 0n) {
            quoteDiagnostic = {
              code: 'INVALID_AMOUNT',
              message: 'Across Swap API returned zero or negative net output amount after fees.',
              severity: 'WARNING',
              providerId: 'ACROSS',
              timestamp: Date.now()
            };
          }
        } else {
          quoteDiagnostic = {
            code: 'MALFORMED_RESPONSE',
            message: 'Across API returned 200 OK but payload is not a valid JSON object.',
            severity: 'WARNING',
            providerId: 'ACROSS',
            timestamp: Date.now()
          };
        }
      } else {
        let providerErrorMsg = '';
        let providerErrorPayload: any = null;
        try {
          const bodyText = await res.text();
          try {
            providerErrorPayload = JSON.parse(bodyText);
            providerErrorMsg = providerErrorPayload.message || providerErrorPayload.error || providerErrorPayload.errorMessage || bodyText;
          } catch {
            providerErrorMsg = bodyText;
          }
        } catch {
          providerErrorMsg = res.statusText;
        }

        const normalizedCode = defaultQuoteDiagnosticLogger.normalizeErrorCode(
          providerErrorMsg || res.statusText,
          res.status,
          providerErrorPayload
        );
        const detailSuffix = providerErrorMsg ? ` (${providerErrorMsg})` : (res.statusText ? `: ${res.statusText}` : '');
        quoteDiagnostic = {
          code: normalizedCode,
          message: `Across Swap API returned HTTP ${res.status}${detailSuffix}`,
          severity: res.status === 401 || res.status === 403 ? 'ERROR' : 'WARNING',
          providerId: 'ACROSS',
          timestamp: Date.now()
        };
      }
    } catch (err: any) {
      const normalizedCode = defaultQuoteDiagnosticLogger.normalizeErrorCode(err, httpStatus);
      quoteDiagnostic = {
        code: normalizedCode,
        message: `Across Swap API request failed: ${err?.message || 'Network error'}`,
        severity: 'WARNING',
        providerId: 'ACROSS',
        timestamp: Date.now()
      };
    }

    const approvalTarget =
      (approvalTxns.length > 0 && (approvalTxns[0].spender || approvalTxns[0].to))
        ? approvalTxns[0].spender || approvalTxns[0].to
        : (swapTx ? swapTx.to : spokePool);

    const calldata = swapTx ? swapTx.data : '0x';
    const executionTarget = swapTx ? swapTx.to : spokePool;
    const value = swapTx?.value || (isSrcNative ? amountInBig.toString() : '0');

    const isQuoteExecutable = Boolean(
      isLiveQuote &&
      (!quoteDiagnostic || quoteDiagnostic.severity !== 'ERROR') &&
      swapTx &&
      calldata !== '0x' &&
      quoteExpiryMs > Date.now()
    );

    const diagnostics = quoteDiagnostic ? [quoteDiagnostic] : [];

    const quote: CrossChainQuote = {
      provider: 'ACROSS',
      providerName: this.name,
      sourceChainId: request.sourceChainId,
      destinationChainId: request.destinationChainId,
      sourceToken: request.tokenIn,
      destinationToken: request.tokenOut,
      sourceAmountRaw: amountInBig.toString(),
      destinationAmountRaw: destinationAmountBig.toString(),
      minDestinationAmountRaw: minDestinationAmountBig.toString(),
      bridgeFeeUSD,
      relayerFee: relayerFeePctStr,
      gasEstimateUSD: defaultChainRegistry.getEstimatedGasCostUSD(srcChain.id, 'BRIDGE', request.gasPreset),
      recipient: rawRecipient,
      expiration: quoteExpiryMs,
      routeIdentifier: `across-${srcChain.id}-${dstChain.id}-${Date.now()}`,
      executionTarget,
      calldata,
      value,
      approvalTarget,
      quoteTimestamp: quoteArrivalTimestamp,
      protocolTimestampSec,
      estimatedTransferTimeSec: estTransferTimeSec,
      securityRating: 'A+',
      isExecutable: isQuoteExecutable,
      unexecutableReason: !isQuoteExecutable ? (quoteDiagnostic?.code || 'PROVIDER_UNAVAILABLE') : undefined,
      diagnostics
    };

    (quote as any).swapTx = swapTx;
    (quote as any).approvalTxns = approvalTxns;
    (quote as any).checks = checks;

    const validationResult = validateCrossChainQuoteExecutability(quote, request);
    quote.isExecutable = Boolean(isQuoteExecutable && validationResult.isExecutable);
    if (!quote.isExecutable) {
      quote.unexecutableReason = quote.unexecutableReason || validationResult.unexecutableReason;
    }

    defaultQuoteDiagnosticLogger.record({
      provider: 'ACROSS',
      providerName: this.name,
      sourceChainId: request.sourceChainId,
      destinationChainId: request.destinationChainId,
      sourceToken: request.tokenIn.symbol,
      destinationToken: request.tokenOut.symbol,
      amountInRaw: amountInBig.toString(),
      requestStatus: isQuoteExecutable ? 'SUCCESS' : 'FAILED',
      httpStatus,
      normalizedError: quoteDiagnostic?.code as any,
      providerErrorMessage: quoteDiagnostic?.message,
      isExecutable: Boolean(quote.isExecutable),
      unexecutableReason: quote.unexecutableReason,
      latencyMs: Date.now() - startTime,
      endpoint: sanitizedUrl,
      timestamp: Date.now()
    });

    return quote;
  }

  public async buildExecution(
    quote: CrossChainQuote,
    _userAddress: string,
    _recipientAddress?: string
  ): Promise<CrossChainExecution> {
    if (quote.isExecutable === false) {
      throw new ProviderUnavailableError(
        `[AcrossProvider] Cannot build execution for unexecutable quote (${quote.unexecutableReason || 'QUOTE_UNAVAILABLE'}). Live verified quote required.`
      );
    }
    const srcChain = defaultChainRegistry.getChain(quote.sourceChainId);
    if (!srcChain || !srcChain.chainId) {
      throw new Error(`[AcrossProvider] Invalid source chain: ${quote.sourceChainId}`);
    }
    const dstChain = defaultChainRegistry.getChain(quote.destinationChainId);
    if (!dstChain || !dstChain.chainId) {
      throw new Error(`[AcrossProvider] Invalid destination chain: ${quote.destinationChainId}`);
    }

    const quoteAny = quote as any;
    const swapTx = quoteAny.swapTx;
    const to = swapTx?.to || quote.executionTarget;
    const data = swapTx?.data || quote.calldata;
    const value = swapTx?.value || quote.value || '0';
    const chainId = swapTx?.chainId || srcChain.chainId;
    const approvalTarget = quote.approvalTarget || to;

    if (!to || to === ZERO_ADDRESS || !data || data === '0x') {
      throw new ExecutionUnavailableError('[AcrossProvider] Missing valid execution target or swapTx calldata.');
    }

    return {
      to,
      data,
      calldata: data,
      value,
      chainId,
      approvalTarget,
      requiredAllowanceRaw: quote.sourceAmountRaw,
      approvalAmount: quote.sourceAmountRaw
    } as any;
  }

  public async getStatus(sourceTxHash: string, quote: CrossChainQuote): Promise<CrossChainStatus> {
    const srcChain = defaultChainRegistry.getChain(quote.sourceChainId);
    const chainIdNum = srcChain?.chainId || 1;
    const isTestnet = (
      chainIdNum === 11155111 ||
      chainIdNum === 421614 ||
      chainIdNum === 84532 ||
      chainIdNum === 11155420
    );
    const defaultStatusBase = isTestnet ? 'https://testnet.across.to/api' : 'https://app.across.to/api';
    const apiBase = this.customStatusApiBaseUrl || defaultStatusBase;

    const fetchImpl = this.customFetch || fetch;

    try {
      const url = `${apiBase}/deposit/status?originChainId=${chainIdNum}&depositTxHash=${sourceTxHash}`;
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (res.ok) {
        const data = await res.json();
        const normalized = normalizeAcrossDepositStatus(data);

        if (normalized.status === 'filled') {
          return {
            state: 'DESTINATION_FILLED',
            sourceTxHash,
            destinationTxHash: normalized.resolvedFillTx || undefined,
            isComplete: Boolean(normalized.resolvedFillTx),
            isFailed: false,
            timestamp: Date.now()
          };
        }
        if (normalized.status === 'pending') {
          return {
            state: 'FULFILLING',
            sourceTxHash,
            isComplete: false,
            isFailed: false,
            timestamp: Date.now()
          };
        }
        if (normalized.status === 'refunded' || normalized.status === 'expired') {
          return {
            state: 'REFUND_PENDING',
            sourceTxHash,
            isComplete: false,
            isFailed: true,
            errorMessage: `Across order status: ${normalized.status}`,
            timestamp: Date.now()
          };
        }
      }
    } catch {
      return {
        state: 'TRACKING_UNAVAILABLE',
        sourceTxHash,
        isComplete: false,
        isFailed: false,
        errorMessage: 'Across tracking API temporarily unreachable',
        timestamp: Date.now()
      };
    }

    return {
      state: 'FULFILLING',
      sourceTxHash,
      isComplete: false,
      isFailed: false,
      timestamp: Date.now()
    };
  }

  public async getDestinationTransaction(sourceTxHash: string, quote: CrossChainQuote): Promise<string | null> {
    const status = await this.getStatus(sourceTxHash, quote);
    return status.destinationTxHash || null;
  }
}

export const defaultAcrossProvider = new AcrossProvider();

export interface NormalizedAcrossDepositStatus {
  status: 'filled' | 'pending' | 'refunded' | 'expired' | 'unknown';
  resolvedFillTx: string | null;
  depositId: string | null;
  originChainId: number | null;
  destinationChainId: number | null;
  rawMetadata: Record<string, any>;
  hasStatusConflict: boolean;
}

export function isValidHexTxHash(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string') return false;
  const trimmed = candidate.trim();
  return /^0x[0-9a-fA-F]{64}$/.test(trimmed);
}

/**
 * Authoritative Across API response normalizer.
 * Extracts and canonicalizes resolvedFillTx across all possible provider representations
 * (fillTx, fillTxnRef, fillTxHash) with strict hexadecimal format validation and precedence.
 */
export function normalizeAcrossDepositStatus(data: any): NormalizedAcrossDepositStatus {
  if (!data || typeof data !== 'object') {
    return {
      status: 'unknown',
      resolvedFillTx: null,
      depositId: null,
      originChainId: null,
      destinationChainId: null,
      rawMetadata: {},
      hasStatusConflict: false
    };
  }

  // Precedence: fillTx > fillTxnRef > fillTxHash
  const rawCandidate =
    (data.fillTx !== undefined && data.fillTx !== null && String(data.fillTx).trim() !== '' ? data.fillTx : null) ||
    (data.fillTxnRef !== undefined && data.fillTxnRef !== null && String(data.fillTxnRef).trim() !== '' ? data.fillTxnRef : null) ||
    (data.fillTxHash !== undefined && data.fillTxHash !== null && String(data.fillTxHash).trim() !== '' ? data.fillTxHash : null) ||
    null;

  const resolvedFillTx = isValidHexTxHash(rawCandidate) ? rawCandidate.trim().toLowerCase() : null;

  const normalizedStatusStr = typeof data.status === 'string' ? data.status.trim().toLowerCase() : 'unknown';
  let status: 'filled' | 'pending' | 'refunded' | 'expired' | 'unknown' = 'unknown';
  if (normalizedStatusStr === 'filled') status = 'filled';
  else if (normalizedStatusStr === 'pending') status = 'pending';
  else if (normalizedStatusStr === 'refunded') status = 'refunded';
  else if (normalizedStatusStr === 'expired') status = 'expired';

  const hasStatusConflict =
    (status === 'filled' && !resolvedFillTx) ||
    (status !== 'filled' && status !== 'unknown' && Boolean(resolvedFillTx));

  const rawMetadata: Record<string, any> = {
    status: data.status,
    fillTx: typeof data.fillTx === 'string' ? data.fillTx : undefined,
    fillTxnRef: typeof data.fillTxnRef === 'string' ? data.fillTxnRef : undefined,
    fillTxHash: typeof data.fillTxHash === 'string' ? data.fillTxHash : undefined,
    depositId: data.depositId,
    originChainId: data.originChainId,
    destinationChainId: data.destinationChainId
  };

  return {
    status,
    resolvedFillTx,
    depositId: data.depositId ? String(data.depositId) : null,
    originChainId: typeof data.originChainId === 'number' ? data.originChainId : (data.originChainId ? Number(data.originChainId) : null),
    destinationChainId: typeof data.destinationChainId === 'number' ? data.destinationChainId : (data.destinationChainId ? Number(data.destinationChainId) : null),
    rawMetadata,
    hasStatusConflict
  };
}
