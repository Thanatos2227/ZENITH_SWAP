import {
  EconomicBoundaryCheckResult,
  SlippagePolicyConfig,
  GasEconomicParams
} from '@zenith/types';
import {
  validateEvmAddress,
  validateTokenAddress,
  EconomicSafetyBreachError,
  SlippagePolicyViolationError,
  MinimumOutputBreachError,
  InsufficientNativeReserveError,
  QuoteFreshnessExpiredError,
  FeeAccountingBreachError,
  PriceImpactExceededError
} from '@zenith/contracts';
import {
  validateAmountFormat,
  UINT256_MAX
} from '../security';

export { validateAmountFormat, UINT256_MAX };
export const DEFAULT_MAX_SLIPPAGE_BPS = 1000;

export const ABSOLUTE_MAX_SLIPPAGE_BPS = 5000;



export function calculateDeterministicMinimumOutput(expectedOutputRaw: string, slippageBps: number): bigint {
  const expectedBig = validateAmountFormat(expectedOutputRaw, 'expectedOutput');
  validateSlippagePolicy(slippageBps);

  const bpsBig = BigInt(slippageBps);
  const factor = 10000n - bpsBig;
  return (expectedBig * factor) / 10000n;
}

export function validateSlippagePolicy(slippageBps: number, config?: Partial<SlippagePolicyConfig>): void {
  const maxBps = config?.maxAllowedBps ?? DEFAULT_MAX_SLIPPAGE_BPS;

  if (typeof slippageBps !== 'number' || isNaN(slippageBps) || !isFinite(slippageBps)) {
    throw new SlippagePolicyViolationError(
      slippageBps,
      'Slippage basis points must be a finite non-NaN number'
    );
  }

  if (slippageBps < 0) {
    throw new SlippagePolicyViolationError(
      slippageBps,
      'Slippage basis points cannot be negative'
    );
  }

  if (slippageBps > maxBps) {
    throw new SlippagePolicyViolationError(
      slippageBps,
      `Slippage ${slippageBps} BPS exceeds maximum allowed threshold of ${maxBps} BPS`,
      `<= ${maxBps}`,
      String(slippageBps)
    );
  }
}

export function validateMinimumOutput(
  actualAmountRaw: string | bigint,
  minimumAmountRaw: string | bigint,
  context = 'Output validation'
): void {
  const actualBig = typeof actualAmountRaw === 'bigint' ? actualAmountRaw : validateAmountFormat(actualAmountRaw, 'actualAmount');
  const minBig = typeof minimumAmountRaw === 'bigint' ? minimumAmountRaw : validateAmountFormat(minimumAmountRaw, 'minimumAmount');

  if (actualBig < minBig) {
    throw new MinimumOutputBreachError(minBig.toString(), actualBig.toString(), context);
  }
}

export function validateSourceSwapEconomics(params: {
  amountInRaw: string;
  expectedAmountOutRaw: string;
  minimumAmountOutRaw: string;
  actualAmountOutRaw?: string;
}): EconomicBoundaryCheckResult {
  const inBig = validateAmountFormat(params.amountInRaw, 'amountIn');
  const expBig = validateAmountFormat(params.expectedAmountOutRaw, 'expectedAmountOut');
  const minBig = validateAmountFormat(params.minimumAmountOutRaw, 'minimumAmountOut');

  if (inBig <= 0n) {
    throw new EconomicSafetyBreachError('amountIn', '> 0', inBig.toString(), 'Source swap input amount must be positive');
  }

  if (expBig <= 0n) {
    throw new EconomicSafetyBreachError('expectedAmountOut', '> 0', expBig.toString(), 'Source swap expected output must be positive');
  }

  if (minBig > expBig) {
    throw new EconomicSafetyBreachError('minimumAmountOut', `<= ${expBig.toString()}`, minBig.toString(), 'Minimum output cannot exceed expected output');
  }

  if (params.actualAmountOutRaw !== undefined) {
    const actBig = validateAmountFormat(params.actualAmountOutRaw, 'actualAmountOut');
    validateMinimumOutput(actBig, minBig, 'Source swap execution');
  }

  return { isSafe: true };
}

export function validateBridgeQuoteRefreshEconomics(params: {
  actualSourceOutputRaw: string;
  refreshedBridgeInputRaw: string;
  initialGuaranteedMinOutputRaw: string;
  refreshedGuaranteedMinOutputRaw: string;
}): EconomicBoundaryCheckResult {
  const actualBig = validateAmountFormat(params.actualSourceOutputRaw, 'actualSourceOutput');
  const bridgeInBig = validateAmountFormat(params.refreshedBridgeInputRaw, 'refreshedBridgeInput');
  const initMinBig = validateAmountFormat(params.initialGuaranteedMinOutputRaw, 'initialGuaranteedMinOutput');
  const refreshedMinBig = validateAmountFormat(params.refreshedGuaranteedMinOutputRaw, 'refreshedGuaranteedMinOutput');

  if (actualBig !== bridgeInBig) {
    throw new EconomicSafetyBreachError(
      'bridgeInputAmount',
      actualBig.toString(),
      bridgeInBig.toString(),
      'Refreshed bridge quote input amount must strictly equal actual mined source swap output'
    );
  }

  if (refreshedMinBig <= 0n) {
    throw new EconomicSafetyBreachError(
      'refreshedGuaranteedMinOutput',
      '> 0',
      refreshedMinBig.toString(),
      'Refreshed bridge guaranteed output must be positive'
    );
  }

  return {
    isSafe: true,
    details: {
      actualSourceOutput: actualBig.toString(),
      refreshedBridgeInput: bridgeInBig.toString(),
      initialMinOutput: initMinBig.toString(),
      refreshedMinOutput: refreshedMinBig.toString()
    }
  };
}

export function validateBridgeEconomics(params: {
  inputAmountRaw: string;
  expectedOutputRaw: string;
  minOutputRaw: string;
  totalFeeRaw: string;
  destinationChainId: string | number;
  destinationTokenAddress: string;
  receiverAddress: string;
  expirationTimestamp?: number;
  currentTime?: number;
  maxAllowedFeeRaw?: string;
}): EconomicBoundaryCheckResult {
  const inBig = validateAmountFormat(params.inputAmountRaw, 'bridgeInputAmount');
  const expBig = validateAmountFormat(params.expectedOutputRaw, 'bridgeExpectedOutput');
  const minBig = validateAmountFormat(params.minOutputRaw, 'bridgeMinOutput');
  const feeBig = validateAmountFormat(params.totalFeeRaw, 'bridgeTotalFee');

  validateEvmAddress(params.receiverAddress, 'Receiver Address');
  validateTokenAddress(params.destinationTokenAddress, params.destinationChainId);

  if (inBig <= 0n) {
    throw new EconomicSafetyBreachError('bridgeInputAmount', '> 0', inBig.toString(), 'Bridge input amount must be positive');
  }

  if (minBig > expBig) {
    throw new EconomicSafetyBreachError('bridgeMinOutput', `<= ${expBig.toString()}`, minBig.toString(), 'Bridge minimum output cannot exceed expected output');
  }

  if (params.expirationTimestamp !== undefined) {
    const now = params.currentTime ?? Date.now();
    if (params.expirationTimestamp > 0 && params.expirationTimestamp < now) {
      throw new QuoteFreshnessExpiredError(
        now - params.expirationTimestamp,
        0,
        `Bridge quote expired at ${params.expirationTimestamp} (current time: ${now})`
      );
    }
  }

  if (params.maxAllowedFeeRaw !== undefined) {
    const maxFeeBig = validateAmountFormat(params.maxAllowedFeeRaw, 'maxAllowedFee');
    if (feeBig > maxFeeBig) {
      throw new FeeAccountingBreachError(maxFeeBig.toString(), feeBig.toString(), 'bridgeFee');
    }
  }

  return { isSafe: true };
}

export function validateDestinationSettlementEconomics(params: {
  expectedRecipient: string;
  expectedToken: string;
  expectedMinAmountRaw: string;
  actualDeliveredAmountRaw: string;
  deliveredRecipient: string;
  deliveredToken: string;
}): EconomicBoundaryCheckResult {
  const minBig = validateAmountFormat(params.expectedMinAmountRaw, 'expectedMinAmount');
  const deliveredBig = validateAmountFormat(params.actualDeliveredAmountRaw, 'actualDeliveredAmount');

  const expRecip = validateEvmAddress(params.expectedRecipient, 'Expected Recipient').toLowerCase();
  const actRecip = validateEvmAddress(params.deliveredRecipient, 'Delivered Recipient').toLowerCase();
  if (expRecip !== actRecip) {
    throw new EconomicSafetyBreachError('deliveredRecipient', expRecip, actRecip, 'Destination settlement delivered to incorrect recipient');
  }

  const expTok = params.expectedToken.toLowerCase();
  const actTok = params.deliveredToken.toLowerCase();
  if (expTok !== actTok) {
    throw new EconomicSafetyBreachError('deliveredToken', expTok, actTok, 'Destination settlement delivered incorrect token');
  }

  validateMinimumOutput(deliveredBig, minBig, 'Destination settlement delivery');

  return {
    isSafe: true,
    details: {
      recipient: expRecip,
      token: expTok,
      deliveredAmount: deliveredBig.toString(),
      minimumAmount: minBig.toString()
    }
  };
}

export function validateCrossChainEconomicBounds(params: {
  sourceAmountInRaw: string;
  sourceAmountOutRaw: string;
  bridgeAmountInRaw: string;
  bridgeAmountOutRaw: string;
  destinationAmountRaw: string;
  minDestinationAmountRaw: string;
}): EconomicBoundaryCheckResult {
  const srcIn = validateAmountFormat(params.sourceAmountInRaw, 'sourceAmountIn');
  const srcOut = validateAmountFormat(params.sourceAmountOutRaw, 'sourceAmountOut');
  const brIn = validateAmountFormat(params.bridgeAmountInRaw, 'bridgeAmountIn');
  const brOut = validateAmountFormat(params.bridgeAmountOutRaw, 'bridgeAmountOut');
  const dstOut = validateAmountFormat(params.destinationAmountRaw, 'destinationAmount');
  const dstMin = validateAmountFormat(params.minDestinationAmountRaw, 'minDestinationAmount');

  if (srcOut !== brIn) {
    throw new EconomicSafetyBreachError('bridgeAmountIn', srcOut.toString(), brIn.toString(), 'Cross-chain economic transition: bridge input must match source output');
  }

  if (dstOut < dstMin) {
    throw new MinimumOutputBreachError(dstMin.toString(), dstOut.toString(), 'Cross-chain destination output bound violated');
  }

  return {
    isSafe: true,
    details: {
      sourceIn: srcIn.toString(),
      sourceOut: srcOut.toString(),
      bridgeIn: brIn.toString(),
      bridgeOut: brOut.toString(),
      destOut: dstOut.toString(),
      destMin: dstMin.toString()
    }
  };
}

export function validateFeeAccounting(params: {
  sourceSwapFeeRaw?: string;
  bridgeFeeRaw?: string;
  destSwapFeeRaw?: string;
  gasCostRaw?: string;
  protocolFeeRaw?: string;
  solverFeeRaw?: string;
  relayerFeeRaw?: string;
  maxAuthorizedFeeRaw?: string;
}): { totalFeeRaw: string; totalFeeBig: bigint; isWithinAuthorizedLimit: boolean } {
  const srcFee = params.sourceSwapFeeRaw ? validateAmountFormat(params.sourceSwapFeeRaw, 'sourceSwapFee') : 0n;
  const brFee = params.bridgeFeeRaw ? validateAmountFormat(params.bridgeFeeRaw, 'bridgeFee') : 0n;
  const dstFee = params.destSwapFeeRaw ? validateAmountFormat(params.destSwapFeeRaw, 'destSwapFee') : 0n;
  const gasCost = params.gasCostRaw ? validateAmountFormat(params.gasCostRaw, 'gasCost') : 0n;
  const protoFee = params.protocolFeeRaw ? validateAmountFormat(params.protocolFeeRaw, 'protocolFee') : 0n;
  const solverFee = params.solverFeeRaw ? validateAmountFormat(params.solverFeeRaw, 'solverFee') : 0n;
  const relayerFee = params.relayerFeeRaw ? validateAmountFormat(params.relayerFeeRaw, 'relayerFee') : 0n;

  const totalFeeBig = srcFee + brFee + dstFee + gasCost + protoFee + solverFee + relayerFee;
  const totalFeeRaw = totalFeeBig.toString();

  let isWithinAuthorizedLimit = true;
  if (params.maxAuthorizedFeeRaw !== undefined) {
    const maxFeeBig = validateAmountFormat(params.maxAuthorizedFeeRaw, 'maxAuthorizedFee');
    if (totalFeeBig > maxFeeBig) {
      throw new FeeAccountingBreachError(maxFeeBig.toString(), totalFeeRaw, 'totalFee');
    }
  }

  return {
    totalFeeRaw,
    totalFeeBig,
    isWithinAuthorizedLimit
  };
}

export function validateGasEconomicsAndReserve(params: GasEconomicParams): {
  isSafe: boolean;
  totalRequiredNativeWei: bigint;
  remainingReserveWei: bigint;
} {
  if (params.gasLimit <= 0n) {
    throw new EconomicSafetyBreachError('gasLimit', '> 0', params.gasLimit.toString(), 'Gas limit must be strictly positive');
  }

  const effectiveGasPrice = params.maxFeePerGas ?? params.gasPrice ?? 0n;
  if (effectiveGasPrice < 0n) {
    throw new EconomicSafetyBreachError('effectiveGasPrice', '>= 0', effectiveGasPrice.toString(), 'Gas price cannot be negative');
  }

  const maxGasCostWei = params.gasLimit * effectiveGasPrice;
  const nativeValue = params.nativeValueWei >= 0n ? params.nativeValueWei : 0n;
  const reserveBuffer = params.reserveBufferWei && params.reserveBufferWei >= 0n ? params.reserveBufferWei : 0n;

  const totalRequiredNativeWei = nativeValue + maxGasCostWei + reserveBuffer;

  if (params.nativeBalance < totalRequiredNativeWei) {
    throw new InsufficientNativeReserveError(
      totalRequiredNativeWei.toString(),
      params.nativeBalance.toString(),
      `Native balance (${params.nativeBalance.toString()} wei) insufficient for value (${nativeValue.toString()}) + max gas (${maxGasCostWei.toString()}) + reserve buffer (${reserveBuffer.toString()})`
    );
  }

  const remainingReserveWei = params.nativeBalance - totalRequiredNativeWei;

  return {
    isSafe: true,
    totalRequiredNativeWei,
    remainingReserveWei
  };
}

export function validatePriceImpactEconomics(
  spotPrice: number,
  executionPrice: number,
  maxAllowedPercent = 10
): { priceImpactPercent: number; isWithinPolicy: boolean } {
  if (spotPrice <= 0 || executionPrice <= 0) {
    return { priceImpactPercent: 0, isWithinPolicy: true };
  }

  const drop = Math.max(0, spotPrice - executionPrice);
  const impactPercent = (drop / spotPrice) * 100;
  const boundedImpact = Math.min(Math.max(impactPercent, 0), 100);

  if (boundedImpact > maxAllowedPercent) {
    throw new PriceImpactExceededError(boundedImpact, maxAllowedPercent);
  }

  return {
    priceImpactPercent: boundedImpact,
    isWithinPolicy: true
  };
}

export function validateQuoteFreshnessEconomics(
  quoteTimestamp: number,
  currentTime = Date.now(),
  maxAgeMs = 120_000,
  expiringSoonThresholdMs = 90_000
): { freshnessState: 'FRESH' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNKNOWN'; ageMs: number } {
  if (!quoteTimestamp || quoteTimestamp <= 0) {
    return { freshnessState: 'UNKNOWN', ageMs: 0 };
  }

  const ageMs = Math.max(0, currentTime - quoteTimestamp);

  if (ageMs > maxAgeMs) {
    throw new QuoteFreshnessExpiredError(
      ageMs,
      maxAgeMs,
      `Quote age (${ageMs}ms) exceeds maximum freshness window (${maxAgeMs}ms)`
    );
  }

  if (ageMs > expiringSoonThresholdMs) {
    return { freshnessState: 'EXPIRING_SOON', ageMs };
  }

  return { freshnessState: 'FRESH', ageMs };
}

export function validateApprovalEconomics(params: {
  approvedAmountRaw: string;
  requiredAmountRaw: string;
  userBalanceRaw?: string;
  spenderAddress: string;
  allowedSpenderAddress: string;
  policy?: 'EXACT' | 'BOUNDED';
}): EconomicBoundaryCheckResult {
  const approvedBig = validateAmountFormat(params.approvedAmountRaw, 'approvedAmount');
  const reqBig = validateAmountFormat(params.requiredAmountRaw, 'requiredAmount');

  const actSpender = validateEvmAddress(params.spenderAddress, 'Spender Address').toLowerCase();
  const allowSpender = validateEvmAddress(params.allowedSpenderAddress, 'Allowed Spender Address').toLowerCase();

  if (actSpender !== allowSpender) {
    throw new EconomicSafetyBreachError('spenderAddress', allowSpender, actSpender, 'Approval target mismatch');
  }

  if (approvedBig < reqBig) {
    throw new EconomicSafetyBreachError(
      'approvedAmount',
      `>= ${reqBig.toString()}`,
      approvedBig.toString(),
      'Approved amount is less than required execution amount'
    );
  }

  const policy = params.policy || 'EXACT';
  if (policy === 'EXACT' && approvedBig !== reqBig) {
    throw new EconomicSafetyBreachError(
      'approvedAmount',
      reqBig.toString(),
      approvedBig.toString(),
      'Exact approval policy violated: approved amount does not equal required amount'
    );
  }

  if (params.userBalanceRaw !== undefined) {
    const balBig = validateAmountFormat(params.userBalanceRaw, 'userBalance');
    if (reqBig > balBig) {
      throw new EconomicSafetyBreachError(
        'requiredAmount',
        `<= ${balBig.toString()}`,
        reqBig.toString(),
        'Required execution amount exceeds available token balance'
      );
    }
  }

  return { isSafe: true };
}

export function validateCompositeEconomicInvariant(stages: {
  sourceInput: string;
  sourceOutputActual: string;
  bridgeInput: string;
  bridgeExpectedOutput: string;
  bridgeMinOutput: string;
  destDeliveredActual: string;
}): EconomicBoundaryCheckResult {
  const srcIn = validateAmountFormat(stages.sourceInput, 'sourceInput');
  const srcOut = validateAmountFormat(stages.sourceOutputActual, 'sourceOutputActual');
  const brIn = validateAmountFormat(stages.bridgeInput, 'bridgeInput');
  const brExp = validateAmountFormat(stages.bridgeExpectedOutput, 'bridgeExpectedOutput');
  const brMin = validateAmountFormat(stages.bridgeMinOutput, 'bridgeMinOutput');
  const dstAct = validateAmountFormat(stages.destDeliveredActual, 'destDeliveredActual');

  if (srcIn <= 0n) {
    throw new EconomicSafetyBreachError('sourceInput', '> 0', srcIn.toString(), 'Composite source input must be positive');
  }

  if (srcOut <= 0n) {
    throw new EconomicSafetyBreachError('sourceOutputActual', '> 0', srcOut.toString(), 'Composite source output must be positive');
  }

  if (srcOut !== brIn) {
    throw new EconomicSafetyBreachError('bridgeInput', srcOut.toString(), brIn.toString(), 'Composite stage 2 bridge input must match stage 1 actual source output');
  }

  if (brMin > brExp) {
    throw new EconomicSafetyBreachError('bridgeMinOutput', `<= ${brExp.toString()}`, brMin.toString(), 'Composite bridge minimum output cannot exceed expected output');
  }

  if (dstAct < brMin) {
    throw new MinimumOutputBreachError(brMin.toString(), dstAct.toString(), 'Composite stage 5 delivered actual output below guaranteed minimum');
  }

  return {
    isSafe: true,
    details: {
      sourceInput: srcIn.toString(),
      sourceOutputActual: srcOut.toString(),
      bridgeInput: brIn.toString(),
      bridgeExpectedOutput: brExp.toString(),
      bridgeMinOutput: brMin.toString(),
      destDeliveredActual: dstAct.toString()
    }
  };
}

export function validateDirectCrossChainInvariant(params: {
  sourceAmountRaw: string;
  bridgeInputRaw: string;
  expectedDestRaw: string;
  minDestRaw: string;
  actualDestRaw?: string;
}): EconomicBoundaryCheckResult {
  const src = validateAmountFormat(params.sourceAmountRaw, 'sourceAmount');
  const brIn = validateAmountFormat(params.bridgeInputRaw, 'bridgeInput');
  const expDest = validateAmountFormat(params.expectedDestRaw, 'expectedDest');
  const minDest = validateAmountFormat(params.minDestRaw, 'minDest');

  if (src !== brIn) {
    throw new EconomicSafetyBreachError('bridgeInput', src.toString(), brIn.toString(), 'Direct bridge input must match source amount');
  }

  if (minDest > expDest) {
    throw new EconomicSafetyBreachError('minDest', `<= ${expDest.toString()}`, minDest.toString(), 'Direct bridge minimum output cannot exceed expected output');
  }

  if (params.actualDestRaw !== undefined) {
    const act = validateAmountFormat(params.actualDestRaw, 'actualDest');
    validateMinimumOutput(act, minDest, 'Direct cross-chain destination delivery');
  }

  return { isSafe: true };
}
