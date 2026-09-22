import { ZeroAddress } from 'ethers';
import {
  CrossChainQuote,
  QuoteRequest,
  ExecutionPlanDiagnostic,
  ProviderErrorCategory,
  UniversalValidationGate,
  UniversalValidationResult,
  ProviderCapabilityLevel
} from '@zenith/types';
import { defaultChainRegistry } from '@zenith/chains';
import { CrossChainProviderCapabilityMatrix } from './crossChainProviderCapabilityMatrix';

export interface QuoteExecutabilityResult {
  isExecutable: boolean;
  unexecutableReason?: string;
  failedGates: string[];
  passedGates: string[];
  diagnostics: ExecutionPlanDiagnostic[];
}

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const HEX_CALLDATA_REGEX = /^0x[a-fA-F0-9]+$/;

/**
 * Normalizes any error or exception into the standardized 16-category Provider Error Taxonomy (Phase 1 Task 8).
 */
export function normalizeProviderErrorCategory(
  err: unknown,
  httpStatus?: number
): ProviderErrorCategory {
  if (httpStatus === 429) return 'RATE_LIMITED';
  if (httpStatus && httpStatus >= 500 && httpStatus <= 599) return 'PROVIDER_UNAVAILABLE';

  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();

  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests')) {
    return 'RATE_LIMITED';
  }
  if (msg.includes('unsupported route') || msg.includes('route is not supported') || msg.includes('unsupported_chain') || msg.includes('invalid_chain_pair')) {
    return 'UNSUPPORTED_ROUTE';
  }
  if (msg.includes('expired') || msg.includes('quote_expired')) {
    return 'EXPIRED_QUOTE';
  }
  if (msg.includes('liquidity') || msg.includes('insufficient liquidity') || msg.includes('too little received')) {
    return 'INSUFFICIENT_LIQUIDITY';
  }
  if (msg.includes('invalid calldata') || msg.includes('calldata missing') || msg.includes('calldata unpopulated')) {
    return 'INVALID_CALLDATA';
  }
  if (msg.includes('invalid target') || msg.includes('invalid execution target') || msg.includes('zero address')) {
    return 'INVALID_TARGET';
  }
  if (msg.includes('token') && (msg.includes('invalid') || msg.includes('malformed') || msg.includes('unsupported'))) {
    return 'INVALID_TOKEN';
  }
  if (msg.includes('chain') && (msg.includes('invalid') || msg.includes('mismatch'))) {
    return 'INVALID_CHAIN';
  }
  if (msg.includes('missing execution') || msg.includes('missing data') || msg.includes('missing_execution_data')) {
    return 'MISSING_EXECUTION_DATA';
  }
  if (msg.includes('destination unavailable') || msg.includes('destination_execution_unavailable')) {
    return 'DESTINATION_UNAVAILABLE';
  }
  if (msg.includes('tracking unavailable') || msg.includes('tracking_unavailable')) {
    return 'TRACKING_UNAVAILABLE';
  }
  if (msg.includes('conflict') || msg.includes('status_conflict')) {
    return 'STATUS_CONFLICT';
  }
  if (msg.includes('unknown status') || msg.includes('status unknown') || msg.includes('status_unknown')) {
    return 'STATUS_UNKNOWN';
  }
  if (msg.includes('timeout') || msg.includes('unavailable') || msg.includes('econnrefused') || msg.includes('network') || msg.includes('fetch failed')) {
    return 'PROVIDER_UNAVAILABLE';
  }
  if (msg.includes('invalid quote') || msg.includes('malformed') || msg.includes('parse error')) {
    return 'INVALID_QUOTE';
  }

  return 'EXECUTION_UNAVAILABLE';
}

/**
 * Universal 15-Gate Cross-Chain Executability Validator (Phase 1 Task 7).
 *
 * Evaluates all 15 deterministic gates:
 * 1.  ROUTE_SUPPORTED
 * 2.  LIVE_QUOTE_VERIFIED
 * 3.  VALID_SOURCE_TOKEN
 * 4.  VALID_DESTINATION_TOKEN
 * 5.  VALID_CHAIN_IDS
 * 6.  VALID_INPUT_AMOUNT
 * 7.  VALID_EXPECTED_OUTPUT
 * 8.  VALID_MINIMUM_OUTPUT
 * 9.  VALID_EXECUTION_TARGET
 * 10. VALID_CALLDATA
 * 11. VALID_APPROVAL_TARGET
 * 12. VALID_EXPIRATION
 * 13. VALID_RECEIVER
 * 14. VALID_TRANSACTION_VALUE
 * 15. CAPABILITY_PERMITS_EXECUTION
 *
 * Failure of ANY gate results in NON_EXECUTABLE.
 * Never silently downgrades or fabricates missing fields.
 */
export function validateUniversalBridgeQuoteExecutability(
  quote: CrossChainQuote,
  request?: QuoteRequest
): UniversalValidationResult {
  const failedGates: UniversalValidationGate[] = [];
  const passedGates: UniversalValidationGate[] = [];
  const diagnostics: ExecutionPlanDiagnostic[] = quote.diagnostics ? [...quote.diagnostics] : [];
  const now = Date.now();

  // Gate 1: ROUTE_SUPPORTED
  const srcChain = defaultChainRegistry.getChain(quote.sourceChainId);
  const dstChain = defaultChainRegistry.getChain(quote.destinationChainId);
  const isDistinctChains = Boolean(
    srcChain &&
    dstChain &&
    quote.sourceChainId.toLowerCase() !== quote.destinationChainId.toLowerCase()
  );
  const capRecord = CrossChainProviderCapabilityMatrix.getCapability(
    quote.provider,
    quote.sourceChainId,
    quote.destinationChainId,
    quote.sourceToken?.symbol || '',
    quote.destinationToken?.symbol || ''
  );
  if (!isDistinctChains || capRecord.capabilityLevel === 'UNSUPPORTED') {
    failedGates.push('ROUTE_SUPPORTED');
  } else {
    passedGates.push('ROUTE_SUPPORTED');
  }

  // Gate 2: LIVE_QUOTE_VERIFIED
  // Unverified mathematical estimates must fail closed
  if (quote.isExecutable === false && quote.unexecutableReason && quote.unexecutableReason.includes('unverified')) {
    failedGates.push('LIVE_QUOTE_VERIFIED');
  } else if (!quote.sourceAmountRaw || !quote.destinationAmountRaw) {
    failedGates.push('LIVE_QUOTE_VERIFIED');
  } else {
    passedGates.push('LIVE_QUOTE_VERIFIED');
  }

  // Gate 3: VALID_SOURCE_TOKEN
  const isSrcNative = Boolean(quote.sourceToken?.isNative) || quote.sourceToken?.address?.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const isSrcValidAddr = isSrcNative || (quote.sourceToken?.address && EVM_ADDRESS_REGEX.test(quote.sourceToken.address));
  if (!quote.sourceToken || !isSrcValidAddr) {
    failedGates.push('VALID_SOURCE_TOKEN');
  } else {
    passedGates.push('VALID_SOURCE_TOKEN');
  }

  // Gate 4: VALID_DESTINATION_TOKEN
  const isDstNative = Boolean(quote.destinationToken?.isNative) || quote.destinationToken?.address?.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const isDstValidAddr = isDstNative || (quote.destinationToken?.address && EVM_ADDRESS_REGEX.test(quote.destinationToken.address));
  if (!quote.destinationToken || !isDstValidAddr) {
    failedGates.push('VALID_DESTINATION_TOKEN');
  } else {
    passedGates.push('VALID_DESTINATION_TOKEN');
  }

  // Gate 5: VALID_CHAIN_IDS
  if (
    request &&
    (quote.sourceChainId.toLowerCase() !== request.sourceChainId.toLowerCase() ||
     quote.destinationChainId.toLowerCase() !== request.destinationChainId.toLowerCase())
  ) {
    failedGates.push('VALID_CHAIN_IDS');
  } else {
    passedGates.push('VALID_CHAIN_IDS');
  }

  // Gate 6: VALID_INPUT_AMOUNT
  let isInputValid = false;
  try {
    const srcBig = BigInt(quote.sourceAmountRaw || '0');
    if (srcBig > 0n) {
      if (request?.amountInRaw) {
        isInputValid = srcBig === BigInt(request.amountInRaw) || Boolean((quote as any).sourceDexQuote);
      } else {
        isInputValid = true;
      }
    }
  } catch {
    isInputValid = false;
  }
  if (!isInputValid) {
    failedGates.push('VALID_INPUT_AMOUNT');
  } else {
    passedGates.push('VALID_INPUT_AMOUNT');
  }

  // Gate 7: VALID_EXPECTED_OUTPUT
  let isExpectedOutputValid = false;
  try {
    const dstBig = BigInt(quote.destinationAmountRaw || '0');
    isExpectedOutputValid = dstBig > 0n;
  } catch {
    isExpectedOutputValid = false;
  }
  if (!isExpectedOutputValid) {
    failedGates.push('VALID_EXPECTED_OUTPUT');
  } else {
    passedGates.push('VALID_EXPECTED_OUTPUT');
  }

  // Gate 8: VALID_MINIMUM_OUTPUT
  let isMinOutputValid = false;
  try {
    const dstBig = BigInt(quote.destinationAmountRaw || '0');
    const minDstBig = BigInt(quote.minDestinationAmountRaw || '0');
    isMinOutputValid = minDstBig > 0n && minDstBig <= dstBig;
  } catch {
    isMinOutputValid = false;
  }
  if (!isMinOutputValid) {
    failedGates.push('VALID_MINIMUM_OUTPUT');
  } else {
    passedGates.push('VALID_MINIMUM_OUTPUT');
  }

  // Gate 9: VALID_EXECUTION_TARGET
  const hasValidTarget =
    Boolean(quote.executionTarget) &&
    quote.executionTarget !== ZeroAddress &&
    EVM_ADDRESS_REGEX.test(quote.executionTarget);
  if (!hasValidTarget) {
    failedGates.push('VALID_EXECUTION_TARGET');
  } else {
    passedGates.push('VALID_EXECUTION_TARGET');
  }

  // Gate 10: VALID_CALLDATA
  const hasValidCalldata =
    Boolean(quote.calldata) &&
    quote.calldata.startsWith('0x') &&
    quote.calldata !== '0x' &&
    quote.calldata.length > 2 &&
    HEX_CALLDATA_REGEX.test(quote.calldata);
  if (!hasValidCalldata) {
    failedGates.push('VALID_CALLDATA');
  } else {
    passedGates.push('VALID_CALLDATA');
  }

  // Gate 11: VALID_APPROVAL_TARGET
  const needsApproval = !isSrcNative;
  const hasValidApproval =
    !needsApproval ||
    (Boolean(quote.approvalTarget) &&
     quote.approvalTarget !== ZeroAddress &&
     EVM_ADDRESS_REGEX.test(quote.approvalTarget));
  if (!hasValidApproval) {
    failedGates.push('VALID_APPROVAL_TARGET');
  } else {
    passedGates.push('VALID_APPROVAL_TARGET');
  }

  // Gate 12: VALID_EXPIRATION
  const isNotExpired = Boolean(quote.expiration) && quote.expiration > now;
  if (!isNotExpired) {
    failedGates.push('VALID_EXPIRATION');
  } else {
    passedGates.push('VALID_EXPIRATION');
  }

  // Gate 13: VALID_RECEIVER
  const recipientAddr = quote.recipient || request?.recipientAddress || request?.userWalletAddress;
  const hasValidReceiver =
    Boolean(recipientAddr) &&
    recipientAddr !== ZeroAddress &&
    EVM_ADDRESS_REGEX.test(recipientAddr!);
  if (!hasValidReceiver) {
    failedGates.push('VALID_RECEIVER');
  } else {
    passedGates.push('VALID_RECEIVER');
  }

  // Gate 14: VALID_TRANSACTION_VALUE
  let isValueValid = false;
  try {
    const valBig = BigInt(quote.value || '0');
    if (isSrcNative) {
      isValueValid = valBig === BigInt(quote.sourceAmountRaw || '0');
    } else {
      isValueValid = valBig === 0n;
    }
  } catch {
    isValueValid = false;
  }
  if (!isValueValid) {
    failedGates.push('VALID_TRANSACTION_VALUE');
  } else {
    passedGates.push('VALID_TRANSACTION_VALUE');
  }

  // Gate 15: CAPABILITY_PERMITS_EXECUTION
  const actualLevel: ProviderCapabilityLevel =
    capRecord.capabilityLevel || (capRecord.capabilityStatus as ProviderCapabilityLevel);
  const requiredLevel: ProviderCapabilityLevel =
    request?.executionMode === 'LIVE_EXECUTION'
      ? 'LIVE_VERIFIED'
      : (request?.requiredCapabilityLevel || 'EXECUTION_AVAILABLE');

  const capabilityPermits =
    CrossChainProviderCapabilityMatrix.meetsCapability(actualLevel, requiredLevel) &&
    capRecord.executionSupported;

  if (!capabilityPermits) {
    failedGates.push('CAPABILITY_PERMITS_EXECUTION');
  } else {
    passedGates.push('CAPABILITY_PERMITS_EXECUTION');
  }

  // Decision
  const isExecutable = failedGates.length === 0;
  let unexecutableReason: string | undefined = undefined;
  let errorCategory: ProviderErrorCategory | undefined = undefined;

  if (!isExecutable) {
    if (quote.unexecutableReason && !quote.isExecutable) {
      unexecutableReason = quote.unexecutableReason;
      errorCategory = normalizeProviderErrorCategory(unexecutableReason);
    } else if (failedGates.includes('ROUTE_SUPPORTED')) {
      errorCategory = 'UNSUPPORTED_ROUTE';
      unexecutableReason = capRecord.unsupportedReason || 'UNSUPPORTED_ROUTE: Route is not supported on configured chains';
    } else if (failedGates.includes('CAPABILITY_PERMITS_EXECUTION')) {
      errorCategory = 'EXECUTION_UNAVAILABLE';
      unexecutableReason = `EXECUTION_UNAVAILABLE: Provider ${quote.provider} has capability level ${actualLevel}, but execution requires ${requiredLevel}`;
    } else if (failedGates.includes('LIVE_QUOTE_VERIFIED')) {
      errorCategory = 'PROVIDER_UNAVAILABLE';
      unexecutableReason = quote.unexecutableReason || 'PROVIDER_UNAVAILABLE: Live quoter did not verify this quote';
    } else if (failedGates.includes('VALID_EXPIRATION')) {
      errorCategory = 'EXPIRED_QUOTE';
      unexecutableReason = 'EXPIRED_QUOTE: Quote has exceeded its freshness lifetime';
    } else if (failedGates.includes('VALID_CALLDATA')) {
      errorCategory = 'INVALID_CALLDATA';
      unexecutableReason = 'INVALID_CALLDATA: Calldata missing, empty, or malformed';
    } else if (failedGates.includes('VALID_EXECUTION_TARGET')) {
      errorCategory = 'INVALID_TARGET';
      unexecutableReason = 'INVALID_TARGET: Execution target is missing or zero address';
    } else if (failedGates.includes('VALID_APPROVAL_TARGET')) {
      errorCategory = 'INVALID_TARGET';
      unexecutableReason = 'INVALID_TARGET: Approval target is missing or zero address';
    } else if (failedGates.includes('VALID_SOURCE_TOKEN') || failedGates.includes('VALID_DESTINATION_TOKEN')) {
      errorCategory = 'INVALID_TOKEN';
      unexecutableReason = 'INVALID_TOKEN: Token address is malformed or zero address';
    } else if (failedGates.includes('VALID_CHAIN_IDS')) {
      errorCategory = 'INVALID_CHAIN';
      unexecutableReason = 'INVALID_CHAIN: Quote chain IDs do not match request';
    } else if (failedGates.includes('VALID_RECEIVER')) {
      errorCategory = 'INVALID_TARGET';
      unexecutableReason = 'INVALID_TARGET: Recipient address is missing or invalid';
    } else if (failedGates.includes('VALID_INPUT_AMOUNT') || failedGates.includes('VALID_EXPECTED_OUTPUT') || failedGates.includes('VALID_MINIMUM_OUTPUT')) {
      errorCategory = 'INVALID_QUOTE';
      unexecutableReason = 'INVALID_QUOTE: Trade amount is non-positive or min amount exceeds expected';
    } else {
      errorCategory = 'EXECUTION_UNAVAILABLE';
      unexecutableReason = `EXECUTION_UNAVAILABLE: Failed validation gates [${failedGates.join(', ')}]`;
    }

    diagnostics.push({
      code: errorCategory,
      message: `Quote failed executability check: ${unexecutableReason}`,
      severity: 'WARNING',
      providerId: quote.provider,
      timestamp: now
    });
  }

  return {
    isExecutable,
    status: isExecutable ? 'EXECUTABLE' : 'NON_EXECUTABLE',
    unexecutableReason,
    errorCategory,
    failedGates,
    passedGates,
    diagnostics
  };
}

/**
 * Backwards-compatible wrapper delegating to validateUniversalBridgeQuoteExecutability.
 */
export function validateCrossChainQuoteExecutability(
  quote: CrossChainQuote,
  request?: QuoteRequest
): QuoteExecutabilityResult {
  const result = validateUniversalBridgeQuoteExecutability(quote, request);

  const legacyGateMap: Record<string, string> = {
    VALID_EXPIRATION: 'EXPIRATION_VALID',
    VALID_EXECUTION_TARGET: 'EXECUTION_TARGET_VALID',
    VALID_APPROVAL_TARGET: 'APPROVAL_TARGET_VALID',
    VALID_CALLDATA: 'CALLDATA_VALID',
    VALID_SOURCE_TOKEN: 'TOKEN_IDENTIFIERS_VALID',
    VALID_DESTINATION_TOKEN: 'TOKEN_IDENTIFIERS_VALID',
    VALID_CHAIN_IDS: 'CHAIN_IDS_MATCH',
    VALID_INPUT_AMOUNT: 'INPUT_AMOUNT_VALID',
    VALID_EXPECTED_OUTPUT: 'OUTPUT_AMOUNT_VALID',
    VALID_MINIMUM_OUTPUT: 'OUTPUT_AMOUNT_VALID',
    ROUTE_SUPPORTED: 'ROUTE_SUPPORTED',
    LIVE_QUOTE_VERIFIED: 'LIVE_QUOTE_VERIFIED'
  };

  const expandedFailedGates = Array.from(new Set([
    ...result.failedGates,
    ...result.failedGates.map(g => legacyGateMap[g]).filter((g): g is string => Boolean(g))
  ]));

  const expandedPassedGates = Array.from(new Set([
    ...result.passedGates,
    ...result.passedGates.map(g => legacyGateMap[g]).filter((g): g is string => Boolean(g))
  ]));

  return {
    isExecutable: result.isExecutable,
    unexecutableReason: result.unexecutableReason,
    failedGates: expandedFailedGates,
    passedGates: expandedPassedGates,
    diagnostics: result.diagnostics
  };
}
