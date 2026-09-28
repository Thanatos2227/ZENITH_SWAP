import { Transaction } from 'ethers';
import {
  CanonicalTransactionPayload,
  ExecutionPlan,
  ExecutionPlanStep,
  SemanticEquivalenceCheckResult
} from '@zenith/types';
import {
  SemanticEquivalenceBreachError,
  ParameterSemanticMismatchError,
  NativeValueSemanticError,
  GasSemanticError,
  ReceiptSemanticError,
  ApprovalPolicyViolationError,
  ZERO_ADDRESS
} from '@zenith/contracts';
import {
  decodeCalldata,
  decodeReceiptEvents,
  assertByteForByteEquivalence
} from './transactionSemanticDecoder';
import { toNumericChainId } from '../security/executionAuthorizationValidator';

const UINT256_MAX = (1n << 256n) - 1n;
const DEFAULT_MAX_GAS_LIMIT = 30_000_000n;

export function validateTransactionPlanEquivalence(
  tx: CanonicalTransactionPayload,
  plan: ExecutionPlan,
  step?: ExecutionPlanStep
): SemanticEquivalenceCheckResult {
  const discrepancies: string[] = [];

  const expectedTarget = (step?.targetAddress || plan.executionTarget || '').toLowerCase();
  const actualTarget = (tx.to || '').toLowerCase();
  if (actualTarget !== expectedTarget) {
    discrepancies.push(`target: expected "${expectedTarget}", got "${actualTarget}"`);
  }

  const expectedCalldata = (step?.calldata || plan.calldata || '').toLowerCase();
  const actualCalldata = (tx.data || '').toLowerCase();
  if (actualCalldata !== expectedCalldata) {
    discrepancies.push(`calldata: expected "${expectedCalldata}", got "${actualCalldata}"`);
  }

  const expectedChainId = toNumericChainId(step?.chainId || plan.sourceChainId);
  const actualChainId = toNumericChainId(tx.chainId);
  if (actualChainId !== expectedChainId) {
    discrepancies.push(`chainId: expected ${expectedChainId}, got ${actualChainId}`);
  }

  const isNative = Boolean(plan.tokenIn?.isNative);
  const expectedValue = isNative ? BigInt(step?.requiredAmountRaw || plan.expectedAmountInRaw || '0') : 0n;
  const actualValue = BigInt(tx.value || '0');
  if (actualValue !== expectedValue) {
    discrepancies.push(`value: expected ${expectedValue.toString()}, got ${actualValue.toString()}`);
  }

  if (actualCalldata && actualCalldata.length >= 10) {
    try {
      const decoded = decodeCalldata(tx.data);
      if (decoded.functionName === 'approve') {
        const spender = (decoded.decodedArguments[0] || '').toLowerCase();
        const amount = BigInt(decoded.decodedArguments[1] || '0');
        const expectedSpender = (step?.approvalTarget || plan.approvalTarget || '').toLowerCase();
        const expectedAmount = BigInt(step?.requiredAmountRaw || plan.expectedAmountInRaw || '0');

        if (spender !== expectedSpender) {
          discrepancies.push(`approval spender: expected "${expectedSpender}", got "${spender}"`);
        }
        if (amount !== expectedAmount) {
          discrepancies.push(`approval amount: expected ${expectedAmount.toString()}, got ${amount.toString()}`);
        }
      } else if (decoded.functionName === 'depositV3') {
        const recipient = (decoded.decodedArguments[1] || '').toLowerCase();
        const inputAmount = BigInt(decoded.decodedArguments[4] || '0');
        const outputAmount = BigInt(decoded.decodedArguments[5] || '0');
        const destChain = Number(decoded.decodedArguments[6] || '0');

        const expectedRecipient = ((plan as any).recipient || (plan as any).userWalletAddress || '').toLowerCase();
        const expectedInputAmount = BigInt(plan.expectedAmountInRaw || '0');
        const expectedMinOut = BigInt(plan.minimumAmountOutRaw || '0');
        const expectedDestChain = toNumericChainId(plan.destinationChainId);

        if (recipient !== expectedRecipient) {
          discrepancies.push(`bridge recipient: expected "${expectedRecipient}", got "${recipient}"`);
        }
        if (inputAmount < expectedInputAmount) {
          discrepancies.push(`bridge inputAmount: expected >= ${expectedInputAmount.toString()}, got ${inputAmount.toString()}`);
        }
        if (outputAmount < expectedMinOut) {
          discrepancies.push(`bridge outputAmount: expected >= ${expectedMinOut.toString()}, got ${outputAmount.toString()}`);
        }
        if (destChain !== expectedDestChain) {
          discrepancies.push(`bridge destinationChainId: expected ${expectedDestChain}, got ${destChain}`);
        }
      }
    } catch (err: any) {
      discrepancies.push(`calldata decode failure: ${err?.message || err}`);
    }
  }

  if (discrepancies.length > 0) {
    throw new SemanticEquivalenceBreachError(
      discrepancies[0].split(':')[0],
      discrepancies[0].split('expected ')[1]?.split(',')[0] || 'expected',
      discrepancies[0].split('got ')[1] || 'actual',
      `Transaction construction failed semantic equivalence with plan: ${discrepancies.join('; ')}`
    );
  }

  return {
    isEquivalent: true,
    stage: 'TRANSACTION_PLAN_EQUIVALENCE',
    discrepancies: []
  };
}

export function validateEthCallEquivalence(
  preflightTx: CanonicalTransactionPayload,
  broadcastTx: CanonicalTransactionPayload
): SemanticEquivalenceCheckResult {
  const discrepancies: string[] = [];

  if ((preflightTx.to || '').toLowerCase() !== (broadcastTx.to || '').toLowerCase()) {
    discrepancies.push(`to: "${preflightTx.to}" !== "${broadcastTx.to}"`);
  }

  if ((preflightTx.data || '').toLowerCase() !== (broadcastTx.data || '').toLowerCase()) {
    discrepancies.push(`data: "${preflightTx.data}" !== "${broadcastTx.data}"`);
  }

  const preflightVal = BigInt(preflightTx.value || '0');
  const broadcastVal = BigInt(broadcastTx.value || '0');
  if (preflightVal !== broadcastVal) {
    discrepancies.push(`value: ${preflightVal.toString()} !== ${broadcastVal.toString()}`);
  }

  const preflightChain = toNumericChainId(preflightTx.chainId);
  const broadcastChain = toNumericChainId(broadcastTx.chainId);
  if (preflightChain !== broadcastChain) {
    discrepancies.push(`chainId: ${preflightChain} !== ${broadcastChain}`);
  }

  if (preflightTx.nonce !== undefined && broadcastTx.nonce !== undefined) {
    if (preflightTx.nonce !== broadcastTx.nonce) {
      discrepancies.push(`nonce: ${preflightTx.nonce} !== ${broadcastTx.nonce}`);
    }
  }

  if (discrepancies.length > 0) {
    throw new SemanticEquivalenceBreachError(
      'PREFLIGHT_BROADCAST_CONTINUITY',
      'identical',
      discrepancies.join(', '),
      `Pre-flight simulation payload differs from broadcast payload: ${discrepancies.join('; ')}`
    );
  }

  return {
    isEquivalent: true,
    stage: 'ETH_CALL_EQUIVALENCE',
    discrepancies: []
  };
}

export function validateEstimateGasEquivalence(
  estimateTx: CanonicalTransactionPayload,
  broadcastTx: CanonicalTransactionPayload
): SemanticEquivalenceCheckResult {
  return validateEthCallEquivalence(estimateTx, broadcastTx);
}

export function validateSigningPayloadEquivalence(
  tx: CanonicalTransactionPayload,
  serializedTx: string
): SemanticEquivalenceCheckResult {
  if (!serializedTx || typeof serializedTx !== 'string' || !serializedTx.startsWith('0x')) {
    throw new SemanticEquivalenceBreachError('serializedTx', 'valid hex string', String(serializedTx), 'Invalid serialized transaction format');
  }

  let parsed: Transaction;
  try {
    parsed = Transaction.from(serializedTx);
  } catch (err: any) {
    throw new SemanticEquivalenceBreachError('serializedTx', 'decodable transaction', err?.message || 'Decode failed');
  }

  const discrepancies: string[] = [];

  if ((parsed.to || '').toLowerCase() !== (tx.to || '').toLowerCase()) {
    discrepancies.push(`to: expected "${tx.to}", got "${parsed.to}"`);
  }

  assertByteForByteEquivalence(tx.data, parsed.data, 'Signing Payload Calldata');

  const expectedVal = BigInt(tx.value || '0');
  const actualVal = parsed.value;
  if (actualVal !== expectedVal) {
    discrepancies.push(`value: expected ${expectedVal.toString()}, got ${actualVal.toString()}`);
  }

  const expectedChainId = toNumericChainId(tx.chainId);
  const actualChainId = Number(parsed.chainId);
  if (actualChainId !== expectedChainId) {
    discrepancies.push(`chainId: expected ${expectedChainId}, got ${actualChainId}`);
  }

  if (tx.nonce !== undefined && parsed.nonce !== tx.nonce) {
    discrepancies.push(`nonce: expected ${tx.nonce}, got ${parsed.nonce}`);
  }

  if (discrepancies.length > 0) {
    throw new SemanticEquivalenceBreachError(
      'SIGNING_PAYLOAD_EQUIVALENCE',
      'identical',
      discrepancies.join(', '),
      `Signing payload has mutated from intended transaction: ${discrepancies.join('; ')}`
    );
  }

  return {
    isEquivalent: true,
    stage: 'SIGNING_PAYLOAD_EQUIVALENCE',
    discrepancies: []
  };
}

export function validateApprovalSemantics(
  tokenContract: string,
  spender: string,
  amount: bigint,
  plan: ExecutionPlan,
  step?: ExecutionPlanStep
): void {
  if (!spender || spender === ZERO_ADDRESS || !/^0x[0-9a-fA-F]{40}$/.test(spender)) {
    throw new ApprovalPolicyViolationError(spender, amount.toString(), 'Approval spender cannot be zero address or malformed');
  }

  const expectedSpender = (step?.approvalTarget || plan.approvalTarget || '').toLowerCase();
  if (spender.toLowerCase() !== expectedSpender) {
    throw new ApprovalPolicyViolationError(
      spender,
      amount.toString(),
      `Spender mismatch: expected "${expectedSpender}", got "${spender.toLowerCase()}"`
    );
  }

  if (amount === UINT256_MAX) {
    throw new ApprovalPolicyViolationError(spender, amount.toString(), 'Unlimited approval (type(uint256).max) is strictly prohibited by security policy');
  }

  if (amount <= 0n) {
    throw new ApprovalPolicyViolationError(spender, amount.toString(), 'Approval amount must be strictly positive');
  }

  const expectedAmount = BigInt(step?.requiredAmountRaw || plan.expectedAmountInRaw || '0');
  if (amount !== expectedAmount) {
    throw new ApprovalPolicyViolationError(
      spender,
      amount.toString(),
      `Exact bounded approval mismatch: expected ${expectedAmount.toString()}, requested ${amount.toString()}`
    );
  }

  const maxSafetyAllowance = 2n * BigInt(plan.expectedAmountInRaw || '0');
  if (amount > maxSafetyAllowance) {
    throw new ApprovalPolicyViolationError(
      spender,
      amount.toString(),
      `Approval amount exceeds safety ceiling (2x expected budget: ${maxSafetyAllowance.toString()})`
    );
  }

  const expectedToken = (plan.tokenIn?.address || '').toLowerCase();
  if (tokenContract.toLowerCase() !== expectedToken) {
    throw new ApprovalPolicyViolationError(
      spender,
      amount.toString(),
      `Approval token mismatch: expected "${expectedToken}", got "${tokenContract.toLowerCase()}"`
    );
  }
}

export function validateSwapSemantics(
  decodedArgs: any,
  plan: ExecutionPlan,
  step?: ExecutionPlanStep
): void {
  const params = Array.isArray(decodedArgs) && decodedArgs[0] && typeof decodedArgs[0] === 'object'
    ? decodedArgs[0]
    : decodedArgs;

  const tokenIn = (params.tokenIn || params[0] || '').toLowerCase();
  const tokenOut = (params.tokenOut || params[1] || '').toLowerCase();
  const recipient = (params.recipient || params[3] || '').toLowerCase();
  const amountIn = BigInt(params.amountIn || params[4] || '0');
  const amountOutMin = BigInt(params.amountOutMinimum || params[5] || '0');

  const expectedTokenIn = (plan.tokenIn?.address || '').toLowerCase();
  const expectedTokenOut = (plan.tokenOut?.address || '').toLowerCase();
  const expectedRecipient = ((plan as any).recipient || (plan as any).userWalletAddress || '').toLowerCase();
  const expectedAmountIn = BigInt(step?.requiredAmountRaw || plan.expectedAmountInRaw || '0');
  const expectedMinOut = BigInt(plan.minimumAmountOutRaw || '0');

  if (expectedTokenIn && tokenIn !== expectedTokenIn) {
    throw new ParameterSemanticMismatchError('tokenIn', expectedTokenIn, tokenIn);
  }

  if (expectedTokenOut && tokenOut !== expectedTokenOut) {
    throw new ParameterSemanticMismatchError('tokenOut', expectedTokenOut, tokenOut);
  }

  if (amountIn !== expectedAmountIn) {
    throw new ParameterSemanticMismatchError('amountIn', expectedAmountIn.toString(), amountIn.toString());
  }

  if (amountOutMin < expectedMinOut) {
    throw new ParameterSemanticMismatchError('amountOutMinimum', expectedMinOut.toString(), amountOutMin.toString());
  }

  if (expectedRecipient && recipient !== expectedRecipient) {
    throw new ParameterSemanticMismatchError('recipient', expectedRecipient, recipient);
  }
}

export function validateBridgeSemantics(
  decodedArgs: any,
  plan: ExecutionPlan,
  step?: ExecutionPlanStep
): void {
  const depositor = (decodedArgs[0] || decodedArgs.depositor || '').toLowerCase();
  const recipient = (decodedArgs[1] || decodedArgs.recipient || '').toLowerCase();
  const inputToken = (decodedArgs[2] || decodedArgs.inputToken || '').toLowerCase();
  const outputToken = (decodedArgs[3] || decodedArgs.outputToken || '').toLowerCase();
  const inputAmount = BigInt(decodedArgs[4] || decodedArgs.inputAmount || '0');
  const outputAmount = BigInt(decodedArgs[5] || decodedArgs.outputAmount || '0');
  const destChain = Number(decodedArgs[6] || decodedArgs.destinationChainId || 0);

  if (depositor === ZERO_ADDRESS || !/^0x[0-9a-fA-F]{40}$/.test(depositor)) {
    throw new ParameterSemanticMismatchError('depositor', 'non-zero valid address', depositor);
  }

  if (recipient === ZERO_ADDRESS || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    throw new ParameterSemanticMismatchError('recipient', 'non-zero valid address', recipient);
  }

  const expectedRecipient = ((plan as any).recipient || (plan as any).userWalletAddress || '').toLowerCase();
  if (expectedRecipient && recipient !== expectedRecipient) {
    throw new ParameterSemanticMismatchError('recipient', expectedRecipient, recipient);
  }

  const expectedTokenIn = (plan.tokenIn?.address || '').toLowerCase();
  if (expectedTokenIn && inputToken !== expectedTokenIn) {
    throw new ParameterSemanticMismatchError('inputToken', expectedTokenIn, inputToken);
  }

  const expectedTokenOut = (plan.tokenOut?.address || '').toLowerCase();
  if (expectedTokenOut && outputToken !== expectedTokenOut) {
    throw new ParameterSemanticMismatchError('outputToken', expectedTokenOut, outputToken);
  }

  const expectedInputAmount = BigInt(step?.requiredAmountRaw || plan.expectedAmountInRaw || '0');
  if (inputAmount < expectedInputAmount) {
    throw new ParameterSemanticMismatchError('inputAmount', `>= ${expectedInputAmount.toString()}`, inputAmount.toString());
  }

  const expectedMinOut = BigInt(plan.minimumAmountOutRaw || '0');
  if (outputAmount < expectedMinOut) {
    throw new ParameterSemanticMismatchError('outputAmount', `>= ${expectedMinOut.toString()}`, outputAmount.toString());
  }

  const expectedDestChain = toNumericChainId(plan.destinationChainId);
  if (destChain !== expectedDestChain) {
    throw new ParameterSemanticMismatchError('destinationChainId', String(expectedDestChain), String(destChain));
  }
}

export function validateNativeValueSemantics(
  txValue: bigint | string,
  expectedValue: bigint | string,
  isNativeOperation: boolean
): void {
  const val = typeof txValue === 'bigint' ? txValue : BigInt(txValue || '0');
  const expected = typeof expectedValue === 'bigint' ? expectedValue : BigInt(expectedValue || '0');

  if (val < 0n) {
    throw new NativeValueSemanticError(val.toString(), 'Transaction value cannot be negative');
  }

  if (!isNativeOperation && val > 0n) {
    throw new NativeValueSemanticError(val.toString(), 'Native value supplied to ERC20/token-only operation');
  }

  if (isNativeOperation && val === 0n && expected > 0n) {
    throw new NativeValueSemanticError(val.toString(), 'Native value omitted from native token operation');
  }

  if (val !== expected) {
    throw new NativeValueSemanticError(
      val.toString(),
      `Transaction native value mismatch: expected ${expected.toString()}, got ${val.toString()}`
    );
  }
}

export function validateGasSemantics(
  gasLimit?: bigint | string,
  maxFeePerGas?: bigint | string,
  maxPriorityFeePerGas?: bigint | string,
  legacyGasPrice?: bigint | string,
  estimatedGas?: bigint
): void {
  if (gasLimit !== undefined) {
    const limit = typeof gasLimit === 'bigint' ? gasLimit : BigInt(gasLimit);
    if (limit <= 0n) {
      throw new GasSemanticError(`Gas limit must be strictly positive, got ${limit.toString()}`);
    }
    if (limit > DEFAULT_MAX_GAS_LIMIT) {
      throw new GasSemanticError(`Gas limit ${limit.toString()} exceeds safety ceiling ${DEFAULT_MAX_GAS_LIMIT.toString()}`);
    }
    if (estimatedGas !== undefined && estimatedGas > 0n) {
      const minSafe = ((estimatedGas * 120n) + 99n) / 100n;
      if (limit < minSafe) {
        throw new GasSemanticError(`Gas limit ${limit.toString()} violates 120% margin policy (min: ${minSafe.toString()})`);
      }
    }
  }

  if (maxFeePerGas !== undefined) {
    const fee = typeof maxFeePerGas === 'bigint' ? maxFeePerGas : BigInt(maxFeePerGas);
    if (fee < 0n) {
      throw new GasSemanticError(`maxFeePerGas cannot be negative: ${fee.toString()}`);
    }
  }

  if (maxPriorityFeePerGas !== undefined) {
    const priority = typeof maxPriorityFeePerGas === 'bigint' ? maxPriorityFeePerGas : BigInt(maxPriorityFeePerGas);
    if (priority < 0n) {
      throw new GasSemanticError(`maxPriorityFeePerGas cannot be negative: ${priority.toString()}`);
    }
    if (maxFeePerGas !== undefined) {
      const fee = typeof maxFeePerGas === 'bigint' ? maxFeePerGas : BigInt(maxFeePerGas);
      if (priority > fee) {
        throw new GasSemanticError(`maxPriorityFeePerGas (${priority.toString()}) cannot exceed maxFeePerGas (${fee.toString()})`);
      }
    }
  }

  if (legacyGasPrice !== undefined) {
    const price = typeof legacyGasPrice === 'bigint' ? legacyGasPrice : BigInt(legacyGasPrice);
    if (price < 0n) {
      throw new GasSemanticError(`gasPrice cannot be negative: ${price.toString()}`);
    }
  }
}

export function validateNonceSemantics(
  planNonce?: number,
  txNonce?: number,
  signingNonce?: number,
  broadcastNonce?: number
): void {
  const nonces = [
    { label: 'planNonce', val: planNonce },
    { label: 'txNonce', val: txNonce },
    { label: 'signingNonce', val: signingNonce },
    { label: 'broadcastNonce', val: broadcastNonce }
  ].filter((n) => n.val !== undefined);

  for (const n of nonces) {
    if (n.val! < 0 || !Number.isInteger(n.val)) {
      throw new SemanticEquivalenceBreachError(n.label, 'non-negative integer', String(n.val));
    }
  }

  if (nonces.length > 1) {
    const firstVal = nonces[0].val;
    for (let i = 1; i < nonces.length; i++) {
      if (nonces[i].val !== firstVal) {
        throw new SemanticEquivalenceBreachError(
          nonces[i].label,
          String(firstVal),
          String(nonces[i].val),
          'Nonce continuity violation across transaction lifecycle'
        );
      }
    }
  }
}

export function validateReceiptSemantics(
  receipt: any,
  _plan?: ExecutionPlan,
  _step?: ExecutionPlanStep
): void {
  if (!receipt || typeof receipt !== 'object') {
    throw new ReceiptSemanticError('Receipt is missing or malformed');
  }

  if (receipt.status === 0) {
    throw new ReceiptSemanticError(`Transaction reverted on-chain (status=0)`, receipt.transactionHash || receipt.hash);
  }

  if (receipt.status !== 1) {
    throw new ReceiptSemanticError(`Receipt exhibits non-successful status "${receipt.status}"`, receipt.transactionHash);
  }

  if (!receipt.logs || !Array.isArray(receipt.logs) || receipt.logs.length === 0) {
    throw new ReceiptSemanticError(`Receipt exhibits status=1 but contains zero emitted event logs`, receipt.transactionHash);
  }

  const decodedEvents = decodeReceiptEvents(receipt.logs);
  const relevantEvents = decodedEvents.filter(
    (e) => e.eventName === 'Transfer' || e.eventName === 'Approval' || e.eventName === 'V3FundsDeposited' || e.eventName === 'FundsDeposited'
  );

  if (relevantEvents.length === 0) {
    throw new ReceiptSemanticError(
      `Receipt exhibits status=1 but contains zero relevant protocol transfer/deposit events`,
      receipt.transactionHash
    );
  }
}

export function validateCompositeSemantics(
  actualMinedSwapOut: bigint,
  bridgeRefreshQuoteAmount: bigint,
  bridgeTxAmount: bigint,
  minimumAllowedOut: bigint
): void {
  if (actualMinedSwapOut < minimumAllowedOut) {
    throw new SemanticEquivalenceBreachError(
      'actualMinedSwapOut',
      `>= ${minimumAllowedOut.toString()}`,
      actualMinedSwapOut.toString(),
      'Source swap output fell below minimum acceptable floor'
    );
  }

  if (actualMinedSwapOut !== bridgeRefreshQuoteAmount) {
    throw new SemanticEquivalenceBreachError(
      'bridgeRefreshQuoteAmount',
      actualMinedSwapOut.toString(),
      bridgeRefreshQuoteAmount.toString(),
      'Bridge quote was refreshed with stale/inconsistent source swap output'
    );
  }

  if (bridgeRefreshQuoteAmount !== bridgeTxAmount) {
    throw new SemanticEquivalenceBreachError(
      'bridgeTxAmount',
      bridgeRefreshQuoteAmount.toString(),
      bridgeTxAmount.toString(),
      'Bridge transaction calldata was encoded with amount differing from refreshed quote'
    );
  }
}
