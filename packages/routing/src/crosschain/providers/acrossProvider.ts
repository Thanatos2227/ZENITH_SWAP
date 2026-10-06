import { Interface } from 'ethers';
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
  ACROSS_SPOKE_POOL_ABI,
  validateEvmAddress,
  validateTokenAddress,
  validateRecipientAddress,
  validateExecutionTarget,
  ProviderUnavailableError
} from '@zenith/contracts';
import { isNativeToken } from '../../dex/dexMath';
import { validateCrossChainQuoteExecutability } from '../quoteValidator';
import { defaultQuoteDiagnosticLogger } from '../quoteDiagnostics';

const spokePoolInterface = new Interface(ACROSS_SPOKE_POOL_ABI);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export class AcrossProvider implements CrossChainProvider {
  public readonly id: BridgeProtocol = 'ACROSS';
  public readonly name = 'Across Protocol V3';

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
    const recipient = request.recipientAddress || (request as any).recipient || request.userWalletAddress;

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

    let destinationAmountBig = amountInBig;
    let bridgeFeeUSD = 0;
    let relayerFeePctStr = '0.05%';
    let estTransferTimeSec = 30;
    const quoteArrivalTimestamp = Date.now();
    let protocolTimestampSec = Math.floor(quoteArrivalTimestamp / 1000);
    let fillDeadlineSec = protocolTimestampSec + 1800;
    let exclusiveRelayer = ZERO_ADDRESS;
    let isLiveQuote = false;
    let quoteDiagnostic: ExecutionPlanDiagnostic | undefined = undefined;
    let httpStatus: number | undefined = undefined;
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
    const apiBase = isTestnet ? 'https://testnet.across.to/api' : 'https://app.across.to/api';
    const url = `${apiBase}/suggested-fees?inputToken=${acrossInputToken}&outputToken=${acrossOutputToken}&originChainId=${srcChain.chainId}&destinationChainId=${dstChain.chainId}&amount=${amountInBig.toString()}${recipient ? `&recipient=${recipient}` : ''}`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      httpStatus = res.status;
      if (res.ok) {
        const data = await res.json();
        if (data.totalRelayFee && data.totalRelayFee.total) {
          const totalFeeRaw = BigInt(data.totalRelayFee.total);
          destinationAmountBig = amountInBig > totalFeeRaw ? amountInBig - totalFeeRaw : 0n;

          if (destinationAmountBig > 0n) {
            const rawPct = Number(data.totalRelayFee.pct);
            relayerFeePctStr = data.totalRelayFee.pct
              ? (rawPct > 100 ? `${(rawPct / 1e16).toFixed(4)}%` : `${(rawPct * 100).toFixed(2)}%`)
              : '0.05%';
            exclusiveRelayer = data.exclusiveRelayer || ZERO_ADDRESS;
            protocolTimestampSec = Number(data.timestamp || protocolTimestampSec);
            fillDeadlineSec = Number(data.fillDeadline || protocolTimestampSec + 1800);
            estTransferTimeSec = Number(data.estimatedFillTimeSec || 30);
            isLiveQuote = true;
          } else {
            quoteDiagnostic = {
              code: 'INVALID_AMOUNT',
              message: `Across relay fee (${totalFeeRaw.toString()} raw) exceeds input amount (${amountInBig.toString()} raw). Net output is zero.`,
              severity: 'WARNING',
              providerId: 'ACROSS',
              timestamp: Date.now()
            };
          }
        } else {
          quoteDiagnostic = {
            code: 'MALFORMED_RESPONSE',
            message: 'Across API returned 200 OK but totalRelayFee is missing from response payload.',
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
          message: `Across API returned HTTP ${res.status}${detailSuffix}`,
          severity: 'WARNING',
          providerId: 'ACROSS',
          timestamp: Date.now()
        };
      }
    } catch (err: any) {
      const normalizedCode = defaultQuoteDiagnosticLogger.normalizeErrorCode(err, httpStatus);
      quoteDiagnostic = {
        code: normalizedCode,
        message: `Across API request failed: ${err?.message || 'Network error'}`,
        severity: 'WARNING',
        providerId: 'ACROSS',
        timestamp: Date.now()
      };
    }

    if (!isLiveQuote) {
      const fallbackFeeBps = 5n;
      const feeAmountRaw = (amountInBig * fallbackFeeBps) / 10000n;
      destinationAmountBig = amountInBig > feeAmountRaw ? amountInBig - feeAmountRaw : 1n;
      const inDecimals = request.tokenIn.decimals !== undefined ? request.tokenIn.decimals : 18;
      const feeNum = Number(feeAmountRaw) / (10 ** inDecimals);
      bridgeFeeUSD = request.tokenIn.priceUSD ? Number((feeNum * request.tokenIn.priceUSD).toFixed(4)) : 0.05;
      isLiveQuote = false;
      if (!quoteDiagnostic) {
        quoteDiagnostic = {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Across API did not return executable quote output. Informational estimate only.',
          severity: 'WARNING',
          providerId: 'ACROSS',
          timestamp: Date.now()
        };
      }
    }

    const slippagePct = request.slippageTolerancePercent !== undefined && !isNaN(request.slippageTolerancePercent) ? request.slippageTolerancePercent : 0.5;
    const slippageBps = BigInt(Math.floor(slippagePct * 100));
    const slippageMultiplier = 10000n - slippageBps;
    const minDestinationAmountBig = (destinationAmountBig * slippageMultiplier) / 10000n;

    const gasEstimateUSD = defaultChainRegistry.getEstimatedGasCostUSD(srcChain.id, 'BRIDGE', request.gasPreset);
    const value = isSrcNative ? amountInBig.toString() : '0';

    let calldata = '0x';
    if (recipient && isLiveQuote) {
      try {
        const safeRecipient = validateRecipientAddress(recipient, srcChain.id);
        calldata = spokePoolInterface.encodeFunctionData('depositV3', [
          safeRecipient.toLowerCase(),
          safeRecipient.toLowerCase(),
          acrossInputToken.toLowerCase(),
          acrossOutputToken.toLowerCase(),
          amountInBig,
          minDestinationAmountBig,
          dstChain.chainId!,
          exclusiveRelayer,
          protocolTimestampSec,
          fillDeadlineSec,
          0,
          '0x'
        ]);
      } catch (encErr) {
        console.warn('[AcrossProvider] Error encoding calldata preview:', encErr);
      }
    }

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
      gasEstimateUSD,
      recipient: recipient || '',
      expiration: Math.max(quoteArrivalTimestamp + 300000, (protocolTimestampSec + 300) * 1000),
      routeIdentifier: `across-${srcChain.id}-${dstChain.id}-${Date.now()}`,
      executionTarget: spokePool,
      calldata,
      value,
      approvalTarget: spokePool,
      quoteTimestamp: quoteArrivalTimestamp,
      protocolTimestampSec,
      estimatedTransferTimeSec: estTransferTimeSec,
      securityRating: 'A+',
      isExecutable: isLiveQuote && calldata !== '0x',
      unexecutableReason: !isLiveQuote ? (quoteDiagnostic?.code || 'PROVIDER_UNAVAILABLE') : undefined,
      diagnostics
    };

    const validationResult = validateCrossChainQuoteExecutability(quote, request);
    quote.isExecutable = validationResult.isExecutable;
    if (!validationResult.isExecutable) {
      quote.unexecutableReason = validationResult.unexecutableReason;
    }

    defaultQuoteDiagnosticLogger.record({
      provider: 'ACROSS',
      providerName: this.name,
      sourceChainId: request.sourceChainId,
      destinationChainId: request.destinationChainId,
      sourceToken: request.tokenIn.symbol,
      destinationToken: request.tokenOut.symbol,
      amountInRaw: amountInBig.toString(),
      requestStatus: isLiveQuote ? 'SUCCESS' : 'FAILED',
      httpStatus,
      normalizedError: quoteDiagnostic?.code as any,
      providerErrorMessage: quoteDiagnostic?.message,
      isExecutable: Boolean(quote.isExecutable),
      unexecutableReason: quote.unexecutableReason,
      latencyMs: Date.now() - startTime,
      endpoint: url,
      timestamp: Date.now()
    });

    return quote;
  }

  public async buildExecution(
    quote: CrossChainQuote,
    userAddress: string,
    recipientAddress?: string
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
    const spokePool = validateExecutionTarget(getAcrossSpokePool(srcChain.chainId), srcChain.id);

    const safeUser = validateEvmAddress(userAddress, 'User Address');
    const safeRecipient = validateRecipientAddress(recipientAddress || userAddress, srcChain.id);
    const safeInputToken = validateTokenAddress(quote.sourceToken.address, srcChain.id, quote.sourceToken.isNative);
    const safeOutputToken = validateTokenAddress(quote.destinationToken.address, dstChain.id, quote.destinationToken.isNative);

    const isSrcNative = isNativeToken(quote.sourceToken.address) || Boolean(quote.sourceToken.isNative);
    const isDstNative = isNativeToken(quote.destinationToken.address) || Boolean(quote.destinationToken.isNative);

    const acrossInputToken = isSrcNative
      ? (quote.sourceToken.wrappedAddress || (srcChain.nativeCurrency as any)?.wrappedAddress || safeInputToken)
      : safeInputToken;

    const acrossOutputToken = isDstNative
      ? (quote.destinationToken.wrappedAddress || (dstChain.nativeCurrency as any)?.wrappedAddress || safeOutputToken)
      : safeOutputToken;

    let exclusiveRelayer = ZERO_ADDRESS;
    let protocolTimestampSec = quote.protocolTimestampSec;
    let fillDeadlineSec: number | undefined;

    if (quote.calldata && quote.calldata !== '0x') {
      try {
        const decoded = spokePoolInterface.decodeFunctionData('depositV3', quote.calldata);
        exclusiveRelayer = decoded[7] || ZERO_ADDRESS;
        if (protocolTimestampSec === undefined) {
          protocolTimestampSec = Number(decoded[8]);
        }
        if (fillDeadlineSec === undefined) {
          fillDeadlineSec = Number(decoded[9]);
        }
      } catch {
        // Fallback if calldata is not decodable depositV3
      }
    }

    if (protocolTimestampSec === undefined) {
      protocolTimestampSec = Math.floor(quote.quoteTimestamp / 1000);
    }
    if (fillDeadlineSec === undefined) {
      fillDeadlineSec = protocolTimestampSec + 1800;
    }

    const data = spokePoolInterface.encodeFunctionData('depositV3', [
      safeUser.toLowerCase(),
      safeRecipient.toLowerCase(),
      acrossInputToken.toLowerCase(),
      acrossOutputToken.toLowerCase(),
      BigInt(quote.sourceAmountRaw),
      BigInt(quote.minDestinationAmountRaw),
      dstChain.chainId,
      exclusiveRelayer,
      protocolTimestampSec,
      fillDeadlineSec,
      0,
      '0x'
    ]);

    return {
      to: spokePool,
      data,
      calldata: data,
      value: isSrcNative ? quote.sourceAmountRaw : '0',
      chainId: srcChain.chainId,
      approvalTarget: spokePool,
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
    const apiBase = isTestnet ? 'https://testnet.across.to/api' : 'https://app.across.to/api';

    try {
      const url = `${apiBase}/deposit/status?originChainId=${chainIdNum}&depositTxHash=${sourceTxHash}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
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
