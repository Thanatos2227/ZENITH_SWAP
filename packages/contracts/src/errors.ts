export class ConfigurationError extends Error {
  public readonly code: string;
  constructor(message: string, code = 'CONFIGURATION_ERROR') {
    super(message);
    this.name = 'ConfigurationError';
    this.code = code;
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

export class UnsupportedProtocolError extends ConfigurationError {
  constructor(protocol: string, chainId: string | number) {
    super(
      `Protocol ${protocol} is not supported or has no verified deployment on chain ${chainId}`,
      'UNSUPPORTED_PROTOCOL'
    );
    this.name = 'UnsupportedProtocolError';
  }
}

export class RecipientMismatchError extends Error {
  public readonly code = 'RECIPIENT_MISMATCH';
  constructor(expected: string, actual: string) {
    super(
      `[Recipient Security] Recipient mismatch detected. Destination recipient (${actual}) does not match connected wallet (${expected}). Normal trades must settle to connected wallet.`
    );
    this.name = 'RecipientMismatchError';
    Object.setPrototypeOf(this, RecipientMismatchError.prototype);
  }
}

export class SimulationRevertError extends Error {
  public readonly code = 'SIMULATION_REVERT';
  public readonly revertReason?: string;
  constructor(message: string, revertReason?: string) {
    super(message);
    this.name = 'SimulationRevertError';
    this.revertReason = revertReason;
    Object.setPrototypeOf(this, SimulationRevertError.prototype);
  }
}

export class SecurityPolicyViolationError extends Error {
  public readonly code = 'SECURITY_POLICY_VIOLATION';
  public readonly reasons: string[];
  constructor(message: string, reasons: string[] = []) {
    super(message);
    this.name = 'SecurityPolicyViolationError';
    this.reasons = reasons;
    Object.setPrototypeOf(this, SecurityPolicyViolationError.prototype);
  }
}

export class SignerRequiredError extends Error {
  public readonly code = 'SIGNER_REQUIRED';
  constructor(message = 'Wallet connection and active signer required to execute transaction.') {
    super(message);
    this.name = 'SignerRequiredError';
    Object.setPrototypeOf(this, SignerRequiredError.prototype);
  }
}

export class InvalidAddressError extends ConfigurationError {
  constructor(message: string, code = 'INVALID_ADDRESS') {
    super(message, code);
    this.name = 'InvalidAddressError';
    Object.setPrototypeOf(this, InvalidAddressError.prototype);
  }
}

export class InvalidTokenAddressError extends InvalidAddressError {
  constructor(address: string, chainId: string | number, reason?: string) {
    super(
      `Invalid or unrecognized token address: "${address}" on chain ${chainId}${reason ? ` (${reason})` : ''}. Cannot construct executable transaction.`,
      'INVALID_TOKEN_ADDRESS'
    );
    this.name = 'InvalidTokenAddressError';
    Object.setPrototypeOf(this, InvalidTokenAddressError.prototype);
  }
}

export class InvalidRecipientAddressError extends InvalidAddressError {
  constructor(address: string, chainId: string | number, reason?: string) {
    super(
      `Invalid recipient address: "${address}" for chain ${chainId}${reason ? ` (${reason})` : ''}. Swaps cannot execute to malformed or placeholder addresses.`,
      'INVALID_RECIPIENT_ADDRESS'
    );
    this.name = 'InvalidRecipientAddressError';
    Object.setPrototypeOf(this, InvalidRecipientAddressError.prototype);
  }
}

export class InvalidExecutionTargetError extends InvalidAddressError {
  constructor(target: string, chainId: string | number, reason?: string) {
    super(
      `Invalid execution/router target contract: "${target}" on chain ${chainId}${reason ? ` (${reason})` : ''}.`,
      'INVALID_EXECUTION_TARGET'
    );
    this.name = 'InvalidExecutionTargetError';
    Object.setPrototypeOf(this, InvalidExecutionTargetError.prototype);
  }
}

export class QuoteUnavailableError extends Error {
  public readonly code = 'QUOTE_UNAVAILABLE';
  constructor(message = 'Live executable quote is currently unavailable. No synthetic quotes permitted in production.') {
    super(message);
    this.name = 'QuoteUnavailableError';
    Object.setPrototypeOf(this, QuoteUnavailableError.prototype);
  }
}

export class InsufficientLiquidityError extends Error {
  public readonly code = 'INSUFFICIENT_LIQUIDITY';
  constructor(pair: string, chainId: string | number) {
    super(`Insufficient liquidity on-chain for pair ${pair} on chain ${chainId}.`);
    this.name = 'InsufficientLiquidityError';
    Object.setPrototypeOf(this, InsufficientLiquidityError.prototype);
  }
}

export class InsufficientBalanceError extends Error {
  public readonly code = 'INSUFFICIENT_BALANCE';
  constructor(token: string, required: string, available: string) {
    super(`Insufficient balance for ${token}. Required: ${required}, Available: ${available}.`);
    this.name = 'InsufficientBalanceError';
    Object.setPrototypeOf(this, InsufficientBalanceError.prototype);
  }
}

export class InsufficientAllowanceError extends Error {
  public readonly code = 'INSUFFICIENT_ALLOWANCE';
  constructor(token: string, spender: string) {
    super(`Token allowance for ${token} to spender ${spender} is insufficient.`);
    this.name = 'InsufficientAllowanceError';
    Object.setPrototypeOf(this, InsufficientAllowanceError.prototype);
  }
}

export class GasEstimationFailedError extends Error {
  public readonly code = 'GAS_ESTIMATION_FAILED';
  public readonly underlyingError?: any;
  constructor(message: string, underlyingError?: any) {
    super(message);
    this.name = 'GasEstimationFailedError';
    this.underlyingError = underlyingError;
    Object.setPrototypeOf(this, GasEstimationFailedError.prototype);
  }
}

export class SimulationFailedError extends Error {
  public readonly code = 'SIMULATION_FAILED';
  public readonly revertReason?: string;
  constructor(message: string, revertReason?: string) {
    super(message);
    this.name = 'SimulationFailedError';
    this.revertReason = revertReason;
    Object.setPrototypeOf(this, SimulationFailedError.prototype);
  }
}

export class TransactionRejectedError extends Error {
  public readonly code = 'TRANSACTION_REJECTED';
  constructor(message = 'Transaction was rejected by user wallet.') {
    super(message);
    this.name = 'TransactionRejectedError';
    Object.setPrototypeOf(this, TransactionRejectedError.prototype);
  }
}

export class TransactionRevertedError extends Error {
  public readonly code = 'TRANSACTION_REVERTED';
  public readonly txHash?: string;
  constructor(message: string, txHash?: string) {
    super(message);
    this.name = 'TransactionRevertedError';
    this.txHash = txHash;
    Object.setPrototypeOf(this, TransactionRevertedError.prototype);
  }
}

export class BridgeQuoteExpiredError extends Error {
  public readonly code = 'BRIDGE_QUOTE_EXPIRED';
  constructor(message = 'Cross-chain bridge quote has expired. Please fetch a fresh quote before signing.') {
    super(message);
    this.name = 'BridgeQuoteExpiredError';
    Object.setPrototypeOf(this, BridgeQuoteExpiredError.prototype);
  }
}

export class BridgeExecutionFailedError extends Error {
  public readonly code = 'BRIDGE_EXECUTION_FAILED';
  public readonly sourceTxHash?: string;
  constructor(message: string, sourceTxHash?: string) {
    super(message);
    this.name = 'BridgeExecutionFailedError';
    this.sourceTxHash = sourceTxHash;
    Object.setPrototypeOf(this, BridgeExecutionFailedError.prototype);
  }
}

export class DestinationVerificationFailedError extends Error {
  public readonly code = 'DESTINATION_VERIFICATION_FAILED';
  public readonly destinationTxHash?: string;
  constructor(message: string, destinationTxHash?: string) {
    super(message);
    this.name = 'DestinationVerificationFailedError';
    this.destinationTxHash = destinationTxHash;
    Object.setPrototypeOf(this, DestinationVerificationFailedError.prototype);
  }
}

export class TreasuryNotConfiguredError extends ConfigurationError {
  constructor(chainId: string | number) {
    super(
      `ZENITH Treasury address is intentionally undefined and unconfigured on chain ${chainId}. Protocol fee transfer cannot proceed.`,
      'ZENITH_TREASURY_NOT_CONFIGURED'
    );
    this.name = 'TreasuryNotConfiguredError';
    Object.setPrototypeOf(this, TreasuryNotConfiguredError.prototype);
  }
}

export class ProtocolFeeRecipientNotConfiguredError extends ConfigurationError {
  constructor(chainId: string | number) {
    super(
      `ZENITH Protocol Fee Recipient address is intentionally undefined and unconfigured on chain ${chainId}.`,
      'ZENITH_FEE_RECIPIENT_NOT_CONFIGURED'
    );
    this.name = 'ProtocolFeeRecipientNotConfiguredError';
    Object.setPrototypeOf(this, ProtocolFeeRecipientNotConfiguredError.prototype);
  }
}

export class BridgeUnavailableError extends ConfigurationError {
  constructor(bridge: string, reason = 'Bridge provider is currently unavailable or returned an error.') {
    super(`Bridge ${bridge} unavailable: ${reason}`, 'BRIDGE_UNAVAILABLE');
    this.name = 'BridgeUnavailableError';
    Object.setPrototypeOf(this, BridgeUnavailableError.prototype);
  }
}

export class TokenUnsupportedError extends ConfigurationError {
  constructor(token: string, chainId: string | number, reason = 'Token is unsupported on this route') {
    super(`Token ${token} on chain ${chainId} is unsupported: ${reason}`, 'TOKEN_UNSUPPORTED');
    this.name = 'TokenUnsupportedError';
    Object.setPrototypeOf(this, TokenUnsupportedError.prototype);
  }
}

export class ChainUnsupportedError extends ConfigurationError {
  constructor(chainId: string | number, protocol = 'Protocol') {
    super(`Chain ${chainId} is unsupported by ${protocol}`, 'CHAIN_UNSUPPORTED');
    this.name = 'ChainUnsupportedError';
    Object.setPrototypeOf(this, ChainUnsupportedError.prototype);
  }
}

export class QuoteExpiredError extends Error {
  public readonly code = 'QUOTE_EXPIRED';
  public readonly quoteTimestamp?: number;
  public readonly expiration?: number;
  public readonly providerId?: string;

  constructor(messageOrTimestamp?: string | number, expiration?: number, providerId?: string) {
    if (typeof messageOrTimestamp === 'number') {
      const ts = messageOrTimestamp;
      const exp = expiration || ts;
      super(
        `QUOTE_EXPIRED: Quote from ${providerId || 'provider'} expired at ${new Date(exp).toISOString()} (generated at ${new Date(ts).toISOString()}). Fresh quote required.`
      );
      this.quoteTimestamp = ts;
      this.expiration = exp;
      this.providerId = providerId;
    } else {
      super(messageOrTimestamp || 'Quote has expired. A fresh quote must be obtained before execution.');
    }
    this.name = 'QuoteExpiredError';
    Object.setPrototypeOf(this, QuoteExpiredError.prototype);
  }
}

export class QuoteInvalidError extends Error {
  public readonly code = 'QUOTE_INVALID';
  constructor(message = 'Quote failed validation criteria.') {
    super(message);
    this.name = 'QuoteInvalidError';
    Object.setPrototypeOf(this, QuoteInvalidError.prototype);
  }
}

export class InvalidRecipientError extends Error {
  public readonly code = 'INVALID_RECIPIENT';
  constructor(message = 'Recipient address is invalid or not provided.') {
    super(message);
    this.name = 'InvalidRecipientError';
    Object.setPrototypeOf(this, InvalidRecipientError.prototype);
  }
}

export class InvalidCalldataError extends Error {
  public readonly code = 'INVALID_CALLDATA';
  constructor(message = 'Generated execution calldata is invalid or empty ("0x").') {
    super(message);
    this.name = 'InvalidCalldataError';
    Object.setPrototypeOf(this, InvalidCalldataError.prototype);
  }
}

export class ZenithRouterNotDeployedError extends ConfigurationError {
  constructor(protocol: string, chainId: string | number) {
    super(
      `ZENITH_ROUTER_NOT_DEPLOYED: ${protocol} router contract is not deployed or configured on chain ${chainId}. Silent fallback to external DEXes is strictly forbidden.`,
      'ZENITH_ROUTER_NOT_DEPLOYED'
    );
    this.name = 'ZenithRouterNotDeployedError';
    Object.setPrototypeOf(this, ZenithRouterNotDeployedError.prototype);
  }
}

export class ZenithRouteExecutionMismatchError extends Error {
  public readonly code = 'ZENITH_ROUTE_EXECUTION_MISMATCH';
  constructor(expected: string, actual: string) {
    super(
      `ZENITH_ROUTE_EXECUTION_MISMATCH: Quoted route provider (${expected}) does not match actual execution target contract (${actual}). Transaction aborted for user safety.`
    );
    this.name = 'ZenithRouteExecutionMismatchError';
    Object.setPrototypeOf(this, ZenithRouteExecutionMismatchError.prototype);
  }
}

export class ZenithSimulationFailedError extends Error {
  public readonly code = 'ZENITH_SIMULATION_FAILED';
  public readonly revertReason?: string;
  constructor(message: string, revertReason?: string) {
    super(`ZENITH_SIMULATION_FAILED: ${message}${revertReason ? ` (Revert Reason: ${revertReason})` : ''}`);
    this.name = 'ZenithSimulationFailedError';
    this.revertReason = revertReason;
    Object.setPrototypeOf(this, ZenithSimulationFailedError.prototype);
  }
}

export class ZenithPoolNotFoundError extends Error {
  public readonly code = 'ZENITH_POOL_NOT_FOUND';
  constructor(tokenA: string, tokenB: string, chainId: string | number) {
    super(`ZENITH_POOL_NOT_FOUND: No deployed ZENITH pool exists for pair ${tokenA}/${tokenB} on chain ${chainId}.`);
    this.name = 'ZenithPoolNotFoundError';
    Object.setPrototypeOf(this, ZenithPoolNotFoundError.prototype);
  }
}

export class ZenithLiquidityInsufficientError extends Error {
  public readonly code = 'ZENITH_LIQUIDITY_INSUFFICIENT';
  constructor(tokenA: string, tokenB: string, chainId: string | number) {
    super(`ZENITH_LIQUIDITY_INSUFFICIENT: Insufficient pool liquidity for pair ${tokenA}/${tokenB} on chain ${chainId}.`);
    this.name = 'ZenithLiquidityInsufficientError';
    Object.setPrototypeOf(this, ZenithLiquidityInsufficientError.prototype);
  }
}

export class ZenithApprovalTargetMismatchError extends Error {
  public readonly code = 'ZENITH_APPROVAL_TARGET_MISMATCH';
  constructor(approvalSpender: string, executionTarget: string) {
    super(
      `ZENITH_APPROVAL_TARGET_MISMATCH: Approval target/spender (${approvalSpender}) does not match execution router (${executionTarget}). Swap aborted for user safety.`
    );
    this.name = 'ZenithApprovalTargetMismatchError';
    Object.setPrototypeOf(this, ZenithApprovalTargetMismatchError.prototype);
  }
}

export class ProviderUnavailableError extends Error {
  public readonly code = 'PROVIDER_UNAVAILABLE';
  public readonly providerId?: string;
  constructor(message = 'The requested bridge/execution provider is currently unavailable.', providerId?: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
    this.providerId = providerId;
    Object.setPrototypeOf(this, ProviderUnavailableError.prototype);
  }
}

export class ExecutionUnavailableError extends Error {
  public readonly code = 'EXECUTION_UNAVAILABLE';
  public readonly reason?: string;
  constructor(message = 'Executable transaction data cannot be generated for this quote.', reason?: string) {
    super(message);
    this.name = 'ExecutionUnavailableError';
    this.reason = reason;
    Object.setPrototypeOf(this, ExecutionUnavailableError.prototype);
  }
}

export class DestinationExecutionUnavailableError extends ExecutionUnavailableError {
  constructor(destinationToken: string, destinationChain: string | number) {
    super(
      `DESTINATION_EXECUTION_UNAVAILABLE: No verified execution mechanism or solver available to settle destination swap for ${destinationToken} on chain ${destinationChain}. Route cannot be executed.`,
      'DESTINATION_EXECUTION_UNAVAILABLE'
    );
    this.name = 'DestinationExecutionUnavailableError';
    Object.setPrototypeOf(this, DestinationExecutionUnavailableError.prototype);
  }
}

export class SourceSwapUnavailableError extends ExecutionUnavailableError {
  constructor(reason = 'Source DEX swap cannot be constructed: calldata or execution target missing.') {
    super(`SOURCE_SWAP_UNAVAILABLE: ${reason}`, 'SOURCE_SWAP_UNAVAILABLE');
    this.name = 'SourceSwapUnavailableError';
    Object.setPrototypeOf(this, SourceSwapUnavailableError.prototype);
  }
}

export class SourceSwapFailedError extends Error {
  public readonly code = 'SOURCE_SWAP_FAILED';
  public readonly txHash?: string;
  constructor(message: string, txHash?: string) {
    super(`SOURCE_SWAP_FAILED: ${message}`);
    this.name = 'SourceSwapFailedError';
    this.txHash = txHash;
    Object.setPrototypeOf(this, SourceSwapFailedError.prototype);
  }
}

export class BridgeFailedError extends Error {
  public readonly code = 'BRIDGE_FAILED';
  public readonly sourceTxHash?: string;
  constructor(message: string, sourceTxHash?: string) {
    super(`BRIDGE_FAILED: ${message}`);
    this.name = 'BridgeFailedError';
    this.sourceTxHash = sourceTxHash;
    Object.setPrototypeOf(this, BridgeFailedError.prototype);
  }
}

export class DestinationExecutionFailedError extends Error {
  public readonly code = 'DESTINATION_EXECUTION_FAILED';
  public readonly destinationTxHash?: string;
  constructor(message: string, destinationTxHash?: string) {
    super(`DESTINATION_EXECUTION_FAILED: ${message}`);
    this.name = 'DestinationExecutionFailedError';
    this.destinationTxHash = destinationTxHash;
    Object.setPrototypeOf(this, DestinationExecutionFailedError.prototype);
  }
}

export class CompositeExecutionUnavailableError extends ExecutionUnavailableError {
  constructor(reason = 'Composite cross-chain route execution mechanism is unavailable or unsupported.') {
    super(`COMPOSITE_EXECUTION_UNAVAILABLE: ${reason}`, 'COMPOSITE_EXECUTION_UNAVAILABLE');
    this.name = 'CompositeExecutionUnavailableError';
    Object.setPrototypeOf(this, CompositeExecutionUnavailableError.prototype);
  }
}

export class SettlementUnverifiedError extends Error {
  public readonly code = 'SETTLEMENT_UNVERIFIED';
  public readonly details?: any;
  constructor(message = 'Cross-chain settlement verification failed or delivered amount does not match expected output.', details?: any) {
    super(`SETTLEMENT_UNVERIFIED: ${message}`);
    this.name = 'SettlementUnverifiedError';
    this.details = details;
    Object.setPrototypeOf(this, SettlementUnverifiedError.prototype);
  }
}

export class TrackingTimeoutError extends Error {
  public readonly code = 'TRACKING_TIMEOUT';
  public readonly sourceTxHash?: string;
  constructor(message = 'Cross-chain bridge fulfillment tracking timed out.', sourceTxHash?: string) {
    super(`TRACKING_TIMEOUT: ${message}`);
    this.name = 'TrackingTimeoutError';
    this.sourceTxHash = sourceTxHash;
    Object.setPrototypeOf(this, TrackingTimeoutError.prototype);
  }
}

export class SolverLiquidityUnavailableError extends ExecutionUnavailableError {
  constructor(message = 'SOLVER_LIQUIDITY_UNAVAILABLE: Solver lacks required liquidity or gas balance to fulfill destination execution.') {
    super(message, 'SOLVER_LIQUIDITY_UNAVAILABLE');
    this.name = 'SolverLiquidityUnavailableError';
    Object.setPrototypeOf(this, SolverLiquidityUnavailableError.prototype);
  }
}

export class IntentExpiredError extends Error {
  public readonly code = 'INTENT_EXPIRED';
  constructor(message = 'INTENT_EXPIRED: Intent deadline has passed. Destination execution cannot be constructed or executed for expired orders.') {
    super(message);
    this.name = 'IntentExpiredError';
    Object.setPrototypeOf(this, IntentExpiredError.prototype);
  }
}

export class ExecutionPlanValidationError extends Error {
  public readonly code: string;
  public readonly validationErrors: string[];
  constructor(message: string, validationErrors: string[] = [], code = 'EXECUTION_PLAN_VALIDATION_ERROR') {
    super(message);
    this.name = 'ExecutionPlanValidationError';
    this.code = code;
    this.validationErrors = validationErrors;
    Object.setPrototypeOf(this, ExecutionPlanValidationError.prototype);
  }
}

export class DuplicateStepIdError extends ExecutionPlanValidationError {
  constructor(stepId: string) {
    super(`Duplicate step ID "${stepId}" detected in execution plan.`, [stepId], 'DUPLICATE_STEP_ID');
    this.name = 'DuplicateStepIdError';
    Object.setPrototypeOf(this, DuplicateStepIdError.prototype);
  }
}

export class PlanMissingDependencyError extends ExecutionPlanValidationError {
  constructor(stepId: string, missingDepId: string) {
    super(`Step "${stepId}" declares missing or unknown dependency "${missingDepId}".`, [stepId, missingDepId], 'MISSING_DEPENDENCY');
    this.name = 'PlanMissingDependencyError';
    Object.setPrototypeOf(this, PlanMissingDependencyError.prototype);
  }
}

export class PlanDependencyCycleError extends ExecutionPlanValidationError {
  constructor(cycle: string[]) {
    super(`Circular dependency cycle detected in execution plan: ${cycle.join(' -> ')}`, cycle, 'DEPENDENCY_CYCLE');
    this.name = 'PlanDependencyCycleError';
    Object.setPrototypeOf(this, PlanDependencyCycleError.prototype);
  }
}

export class UncertainTransactionRecoveryError extends Error {
  public readonly code = 'UNCERTAIN_TRANSACTION_RECOVERY';
  public readonly txHash?: string;
  constructor(message: string, txHash?: string) {
    super(`UNCERTAIN_TRANSACTION_RECOVERY: ${message}`);
    this.name = 'UncertainTransactionRecoveryError';
    this.txHash = txHash;
    Object.setPrototypeOf(this, UncertainTransactionRecoveryError.prototype);
  }
}

export class FeeDataUnavailableError extends ConfigurationError {
  constructor(chainId: string | number, reason = 'Unable to fetch dynamic fee/gas data from RPC provider.') {
    super(`FEE_DATA_UNAVAILABLE: ${reason} (Chain: ${chainId})`, 'FEE_DATA_UNAVAILABLE');
    this.name = 'FeeDataUnavailableError';
    Object.setPrototypeOf(this, FeeDataUnavailableError.prototype);
  }
}

export class RpcUnavailableError extends ConfigurationError {
  constructor(chainId: string | number, reason = 'RPC endpoint is unreachable or returned network error.') {
    super(`RPC_UNAVAILABLE: ${reason} (Chain: ${chainId})`, 'RPC_UNAVAILABLE');
    this.name = 'RpcUnavailableError';
    Object.setPrototypeOf(this, RpcUnavailableError.prototype);
  }
}

export class BroadcastFailedError extends Error {
  public readonly code = 'BROADCAST_FAILED';
  public readonly details?: any;
  constructor(message: string, details?: any) {
    super(`BROADCAST_FAILED: ${message}`);
    this.name = 'BroadcastFailedError';
    this.details = details;
    Object.setPrototypeOf(this, BroadcastFailedError.prototype);
  }
}

export class BroadcastUncertainError extends Error {
  public readonly code = 'BROADCAST_UNCERTAIN';
  public readonly txHash?: string;
  public readonly transactionId?: string;
  public readonly sender?: string;
  public readonly nonce?: number;
  public readonly chainId?: string | number;
  constructor(
    message: string,
    contextOrTxHash?: string | { transactionId?: string; sender?: string; nonce?: number; chainId?: string | number; txHash?: string }
  ) {
    super(`BROADCAST_UNCERTAIN: ${message}`);
    this.name = 'BroadcastUncertainError';
    if (typeof contextOrTxHash === 'string') {
      this.txHash = contextOrTxHash;
      this.transactionId = contextOrTxHash;
    } else if (contextOrTxHash) {
      this.txHash = contextOrTxHash.txHash || contextOrTxHash.transactionId;
      this.transactionId = contextOrTxHash.transactionId || contextOrTxHash.txHash;
      this.sender = contextOrTxHash.sender;
      this.nonce = contextOrTxHash.nonce;
      this.chainId = contextOrTxHash.chainId;
    }
    Object.setPrototypeOf(this, BroadcastUncertainError.prototype);
  }
}

export class ReceiptPendingError extends Error {
  public readonly code = 'RECEIPT_PENDING';
  public readonly txHash: string;
  constructor(txHash: string, message = 'Transaction is still pending confirmation in mempool/block.') {
    super(`RECEIPT_PENDING: ${message} (TxHash: ${txHash})`);
    this.name = 'ReceiptPendingError';
    this.txHash = txHash;
    Object.setPrototypeOf(this, ReceiptPendingError.prototype);
  }
}

export class ReceiptRevertedError extends Error {
  public readonly code = 'RECEIPT_REVERTED';
  public readonly txHash: string;
  public readonly blockNumber?: number;
  public readonly revertReason?: string;
  constructor(txHash: string, blockNumber?: number, revertReason?: string) {
    super(`RECEIPT_REVERTED: Transaction reverted on-chain (TxHash: ${txHash}, Block: ${blockNumber ?? 'N/A'}${revertReason ? `, Reason: ${revertReason}` : ''})`);
    this.name = 'ReceiptRevertedError';
    this.txHash = txHash;
    this.blockNumber = blockNumber;
    this.revertReason = revertReason;
    Object.setPrototypeOf(this, ReceiptRevertedError.prototype);
  }
}

export class ReorgDetectedError extends Error {
  public readonly code = 'REORG_DETECTED';
  public readonly txHash: string;
  public readonly previousBlock?: number;
  public readonly originalBlockHash?: string;
  public readonly canonicalBlockHash?: string;

  constructor(
    txHash: string,
    previousBlockOrOriginalHash?: number | string,
    canonicalBlockHash?: string,
    customMessage?: string
  ) {
    const isNum = typeof previousBlockOrOriginalHash === 'number';
    const previousBlock = isNum ? previousBlockOrOriginalHash : undefined;
    const originalBlockHash = !isNum && typeof previousBlockOrOriginalHash === 'string' ? previousBlockOrOriginalHash : undefined;
    const msg = customMessage || (originalBlockHash
      ? `Reorg detected for tx ${txHash}: block hash mutated from ${originalBlockHash} to ${canonicalBlockHash || 'reorged/dropped'}`
      : `REORG_DETECTED: Transaction receipt or block was invalidated by chain reorganization (TxHash: ${txHash}, Previous Block: ${previousBlock ?? 'N/A'})`);
    super(msg);
    this.name = 'ReorgDetectedError';
    this.txHash = txHash;
    this.previousBlock = previousBlock;
    this.originalBlockHash = originalBlockHash;
    this.canonicalBlockHash = canonicalBlockHash;
    Object.setPrototypeOf(this, ReorgDetectedError.prototype);
  }
}

export class ConfirmationTimeoutError extends Error {
  public readonly code = 'CONFIRMATION_TIMEOUT';
  public readonly txHash: string;
  constructor(txHash: string, timeoutMs: number) {
    super(`CONFIRMATION_TIMEOUT: Transaction confirmation timed out after ${timeoutMs}ms (TxHash: ${txHash}). Transaction may still confirm on-chain.`);
    this.name = 'ConfirmationTimeoutError';
    this.txHash = txHash;
    Object.setPrototypeOf(this, ConfirmationTimeoutError.prototype);
  }
}

export class ChainCapabilityUnavailableError extends ConfigurationError {
  constructor(chainId: string | number, capability: string) {
    super(`CHAIN_CAPABILITY_UNAVAILABLE: Chain ${chainId} does not support requested capability: ${capability}`, 'CHAIN_CAPABILITY_UNAVAILABLE');
    this.name = 'ChainCapabilityUnavailableError';
    Object.setPrototypeOf(this, ChainCapabilityUnavailableError.prototype);
  }
}

export class GasLimitOverflowError extends Error {
  public readonly code = 'GAS_LIMIT_OVERFLOW';
  constructor(limit: string, maxAllowed: string) {
    super(`GAS_LIMIT_OVERFLOW: Calculated gas limit ${limit} exceeds safety ceiling ${maxAllowed}.`);
    this.name = 'GasLimitOverflowError';
    Object.setPrototypeOf(this, GasLimitOverflowError.prototype);
  }
}

export class RecoveryRequiredError extends Error {
  public readonly code = 'RECOVERY_REQUIRED';
  public readonly reason: string;
  public readonly context?: any;
  constructor(reason: string, context?: any) {
    super(`RECOVERY_REQUIRED: State inconsistency or unconfirmed broadcast requires recovery intervention: ${reason}`);
    this.name = 'RecoveryRequiredError';
    this.reason = reason;
    this.context = context;
    Object.setPrototypeOf(this, RecoveryRequiredError.prototype);
  }
}

export class InvalidStateTransitionError extends Error {
  public readonly code = 'INVALID_STATE_TRANSITION';
  public readonly fromState: string;
  public readonly toState: string;
  constructor(fromState: string, toState: string, entityType = 'Transaction') {
    super(`INVALID_STATE_TRANSITION: Cannot transition ${entityType} from "${fromState}" to "${toState}".`);
    this.name = 'InvalidStateTransitionError';
    this.fromState = fromState;
    this.toState = toState;
    Object.setPrototypeOf(this, InvalidStateTransitionError.prototype);
  }
}

export class LeaseLockConflictError extends Error {
  public readonly code = 'LEASE_LOCK_CONFLICT';
  public readonly resourceId: string;
  public readonly currentOwner?: string;
  constructor(resourceId: string, currentOwner?: string) {
    super(`LEASE_LOCK_CONFLICT: Resource "${resourceId}" is actively claimed by another worker${currentOwner ? ` (${currentOwner})` : ''}.`);
    this.name = 'LeaseLockConflictError';
    this.resourceId = resourceId;
    this.currentOwner = currentOwner;
    Object.setPrototypeOf(this, LeaseLockConflictError.prototype);
  }
}

export class AllProvidersUnavailableError extends Error {
  public readonly code = 'ALL_PROVIDERS_UNAVAILABLE';
  public readonly chainId: string | number;
  public readonly operation?: string;
  public readonly attempts?: number;
  constructor(chainId: string | number, operation?: string, attempts?: number) {
    super(`ALL_PROVIDERS_UNAVAILABLE: All RPC endpoints for chain ${chainId} are currently unhealthy, circuit-open, or exhausted retries${operation ? ` during ${operation}` : ''}${attempts !== undefined ? ` (after ${attempts} attempts)` : ''}.`);
    this.name = 'AllProvidersUnavailableError';
    this.chainId = chainId;
    this.operation = operation;
    this.attempts = attempts;
    Object.setPrototypeOf(this, AllProvidersUnavailableError.prototype);
  }
}

export class ChainIdMismatchError extends Error {
  public readonly code = 'CHAIN_ID_MISMATCH';
  public readonly providerId: string;
  public readonly expectedChainId: number;
  public readonly actualChainId: number;
  constructor(providerId: string, expectedChainId: number, actualChainId: number) {
    super(`CHAIN_ID_MISMATCH: Provider ${providerId} returned chainId ${actualChainId}, but expected chainId ${expectedChainId}.`);
    this.name = 'ChainIdMismatchError';
    this.providerId = providerId;
    this.expectedChainId = expectedChainId;
    this.actualChainId = actualChainId;
    Object.setPrototypeOf(this, ChainIdMismatchError.prototype);
  }
}

export class BlockLagExceededError extends Error {
  public readonly code = 'BLOCK_LAG_EXCEEDED';
  public readonly providerId: string;
  public readonly providerBlock: number;
  public readonly maxObservedBlock: number;
  public readonly lag: number;
  constructor(providerId: string, providerBlock: number, maxObservedBlock: number, lag: number) {
    super(`BLOCK_LAG_EXCEEDED: Provider ${providerId} block height ${providerBlock} is lagging max observed height ${maxObservedBlock} by ${lag} blocks.`);
    this.name = 'BlockLagExceededError';
    this.providerId = providerId;
    this.providerBlock = providerBlock;
    this.maxObservedBlock = maxObservedBlock;
    this.lag = lag;
    Object.setPrototypeOf(this, BlockLagExceededError.prototype);
  }
}

export class CircuitBreakerOpenError extends Error {
  public readonly code = 'CIRCUIT_BREAKER_OPEN';
  public readonly providerId: string;
  public readonly resetAt: number;
  constructor(providerId: string, resetAt: number) {
    super(`CIRCUIT_BREAKER_OPEN: Circuit breaker is OPEN for provider ${providerId}. Cooldown expires in ${Math.max(0, resetAt - Date.now())}ms.`);
    this.name = 'CircuitBreakerOpenError';
    this.providerId = providerId;
    this.resetAt = resetAt;
    Object.setPrototypeOf(this, CircuitBreakerOpenError.prototype);
  }
}

export class ProviderConflictError extends Error {
  public readonly code = 'PROVIDER_CONFLICT';
  public readonly reason: string;
  public readonly conflictingDetails?: any;
  constructor(reason: string, conflictingDetails?: any) {
    super(`PROVIDER_CONFLICT: Inconsistent evidence detected across providers: ${reason}`);
    this.name = 'ProviderConflictError';
    this.reason = reason;
    this.conflictingDetails = conflictingDetails;
    Object.setPrototypeOf(this, ProviderConflictError.prototype);
  }
}

export class DestinationStatusUncertainError extends Error {
  public readonly code = 'DESTINATION_STATUS_UNCERTAIN';
  public readonly reason: string;
  public readonly details?: any;
  constructor(reason: string, details?: any) {
    super(`DESTINATION_STATUS_UNCERTAIN: Destination settlement cannot be definitively verified: ${reason}`);
    this.name = 'DestinationStatusUncertainError';
    this.reason = reason;
    this.details = details;
    Object.setPrototypeOf(this, DestinationStatusUncertainError.prototype);
  }
}

export class RpcTimeoutError extends Error {
  public readonly code = 'RPC_TIMEOUT';
  public readonly providerId: string;
  public readonly timeoutMs: number;
  public readonly operation?: string;
  constructor(providerId: string, timeoutMs: number, operation?: string) {
    super(`RPC_TIMEOUT: Request ${operation || 'RPC call'} to provider ${providerId} timed out after ${timeoutMs}ms.`);
    this.name = 'RpcTimeoutError';
    this.providerId = providerId;
    this.timeoutMs = timeoutMs;
    this.operation = operation;
    Object.setPrototypeOf(this, RpcTimeoutError.prototype);
  }
}

export class RpcRateLimitError extends Error {
  public readonly code = 'RPC_RATE_LIMIT';
  public readonly providerId: string;
  public readonly retryAfterMs?: number;
  constructor(providerId: string, retryAfterMs?: number) {
    super(`RPC_RATE_LIMIT: Rate limit (HTTP 429) encountered on provider ${providerId}${retryAfterMs ? `. Retry after ${retryAfterMs}ms` : ''}.`);
    this.name = 'RpcRateLimitError';
    this.providerId = providerId;
    this.retryAfterMs = retryAfterMs;
    Object.setPrototypeOf(this, RpcRateLimitError.prototype);
  }
}

// ============================================================================
// PHASE 0 / TASK 6: CROSS-CHAIN QUOTE PROVIDER DIAGNOSTIC ERRORS
// ============================================================================

export class AggregateCrossChainQuoteError extends ConfigurationError {
  public readonly sourceChainId: string;
  public readonly destinationChainId: string;
  public readonly sourceTokenSymbol: string;
  public readonly destinationTokenSymbol: string;
  public readonly providerDiagnostics: Record<string, any>;

  constructor(params: {
    sourceChainId: string;
    destinationChainId: string;
    sourceTokenSymbol: string;
    destinationTokenSymbol: string;
    providerDiagnostics: Record<string, any>;
    message?: string;
  }) {
    const defaultMsg = `[ZenithRouter] No valid cross-chain bridge quote available for ${params.sourceTokenSymbol} (${params.sourceChainId}) -> ${params.destinationTokenSymbol} (${params.destinationChainId}). Diagnostics: ${JSON.stringify(params.providerDiagnostics)}`;
    super(params.message || defaultMsg, 'CROSS_CHAIN_QUOTE_UNAVAILABLE');
    this.name = 'AggregateCrossChainQuoteError';
    this.sourceChainId = params.sourceChainId;
    this.destinationChainId = params.destinationChainId;
    this.sourceTokenSymbol = params.sourceTokenSymbol;
    this.destinationTokenSymbol = params.destinationTokenSymbol;
    this.providerDiagnostics = params.providerDiagnostics;
    Object.setPrototypeOf(this, AggregateCrossChainQuoteError.prototype);
  }
}

export class InvalidQuoteAmountError extends Error {
  public readonly code = 'INVALID_AMOUNT';
  public readonly amount: string;
  public readonly reason: string;

  constructor(amount: string, reason: string) {
    super(`INVALID_AMOUNT: Invalid swap/bridge amount (${amount}): ${reason}`);
    this.name = 'InvalidQuoteAmountError';
    this.amount = amount;
    this.reason = reason;
    Object.setPrototypeOf(this, InvalidQuoteAmountError.prototype);
  }
}

export class UnsupportedCrossChainRouteError extends ConfigurationError {
  public readonly sourceChain: string;
  public readonly destinationChain: string;
  public readonly tokenIn: string;
  public readonly tokenOut: string;

  constructor(sourceChain: string, destinationChain: string, tokenIn: string, tokenOut: string, reason?: string) {
    super(
      `UNSUPPORTED_ROUTE: Cross-chain route from ${tokenIn} (${sourceChain}) to ${tokenOut} (${destinationChain}) is not supported by configured bridge providers${reason ? `: ${reason}` : ''}.`,
      'UNSUPPORTED_ROUTE'
    );
    this.name = 'UnsupportedCrossChainRouteError';
    this.sourceChain = sourceChain;
    this.destinationChain = destinationChain;
    this.tokenIn = tokenIn;
    this.tokenOut = tokenOut;
    Object.setPrototypeOf(this, UnsupportedCrossChainRouteError.prototype);
  }
}

// ============================================================================
// PHASE 0 / TASK 8: COMPOSITE ROUTE & OUTPUT EXTRACTION ERRORS
// ============================================================================

export class AmountMismatchError extends Error {
  public readonly code = 'AMOUNT_MISMATCH';
  public readonly expectedAmount: string;
  public readonly actualAmount: string;
  public readonly context?: string;

  constructor(expectedAmount: string, actualAmount: string, context = 'Composite route amount mismatch') {
    super(`AMOUNT_MISMATCH: ${context} (Expected: ${expectedAmount}, Actual: ${actualAmount})`);
    this.name = 'AmountMismatchError';
    this.expectedAmount = expectedAmount;
    this.actualAmount = actualAmount;
    Object.setPrototypeOf(this, AmountMismatchError.prototype);
  }
}

export class TokenMismatchError extends Error {
  public readonly code = 'TOKEN_MISMATCH';
  public readonly expectedToken: string;
  public readonly actualToken: string;
  public readonly context?: string;

  constructor(expectedToken: string, actualToken: string, context = 'Composite route token continuity broken') {
    super(`TOKEN_MISMATCH: ${context} (Expected: ${expectedToken}, Actual: ${actualToken})`);
    this.name = 'TokenMismatchError';
    this.expectedToken = expectedToken;
    this.actualToken = actualToken;
    Object.setPrototypeOf(this, TokenMismatchError.prototype);
  }
}

export class ChainMismatchError extends Error {
  public readonly code = 'CHAIN_MISMATCH';
  public readonly expectedChain: string | number;
  public readonly actualChain: string | number;
  public readonly context?: string;

  constructor(expectedChain: string | number, actualChain: string | number, context = 'Composite route chain continuity broken') {
    super(`CHAIN_MISMATCH: ${context} (Expected: ${expectedChain}, Actual: ${actualChain})`);
    this.name = 'ChainMismatchError';
    this.expectedChain = expectedChain;
    this.actualChain = actualChain;
    Object.setPrototypeOf(this, ChainMismatchError.prototype);
  }
}

export class StatusConflictError extends Error {
  public readonly code = 'STATUS_CONFLICT';
  public readonly eventOutput?: string;
  public readonly balanceDelta?: string;
  public readonly context?: string;

  constructor(message: string, eventOutput?: string, balanceDelta?: string) {
    super(`STATUS_CONFLICT: ${message}${eventOutput && balanceDelta ? ` (Event output: ${eventOutput}, Balance delta: ${balanceDelta})` : ''}`);
    this.name = 'StatusConflictError';
    this.eventOutput = eventOutput;
    this.balanceDelta = balanceDelta;
    Object.setPrototypeOf(this, StatusConflictError.prototype);
  }
}

export class CompositePlanValidationError extends ExecutionPlanValidationError {
  constructor(reason: string, validationErrors: string[] = []) {
    super(`COMPOSITE_PLAN_INVALID: ${reason}`, validationErrors, 'COMPOSITE_PLAN_INVALID');
    this.name = 'CompositePlanValidationError';
    Object.setPrototypeOf(this, CompositePlanValidationError.prototype);
  }
}

// ============================================================================
// PHASE 0 / TASK 11: OPERATOR CONTROL & EXECUTION GATES
// ============================================================================

export class BlockedOperatorConfirmationError extends Error {
  public readonly code = 'BLOCKED_OPERATOR_CONFIRMATION';
  public readonly confirmationGate: string;
  public readonly providedToken?: string;

  constructor(confirmationGate: string, message = 'Operator confirmation token missing or invalid', providedToken?: string) {
    super(`BLOCKED_OPERATOR_CONFIRMATION: [${confirmationGate}] ${message}${providedToken ? ` (Provided: "${providedToken}")` : ''}`);
    this.name = 'BlockedOperatorConfirmationError';
    this.confirmationGate = confirmationGate;
    this.providedToken = providedToken;
    Object.setPrototypeOf(this, BlockedOperatorConfirmationError.prototype);
  }
}

export class ProductionChainProhibitedError extends SecurityPolicyViolationError {
  public readonly chainId: string | number;

  constructor(chainId: string | number, context = 'LIVE_TESTNET execution mode strictly prohibits production mainnet chains.') {
    super(`PRODUCTION_CHAIN_PROHIBITED: Chain ${chainId} is not permitted for testnet execution: ${context}`, [`Chain ID ${chainId} is on mainnet or not on testnet allowlist`]);
    this.name = 'ProductionChainProhibitedError';
    this.chainId = chainId;
    Object.setPrototypeOf(this, ProductionChainProhibitedError.prototype);
  }
}

// ============================================================================
// PHASE 1 / TASK 29: PLAN INTEGRITY, IMMUTABILITY & BROADCAST UNCERTAINTY
// ============================================================================

export class PlanIntegrityBreachError extends ExecutionPlanValidationError {
  public readonly tamperedFields: string[];

  constructor(message = 'ExecutionPlan integrity seal check failed: plan was mutated after authorization.', tamperedFields: string[] = []) {
    super(`PLAN_INTEGRITY_BREACH: ${message}${tamperedFields.length ? ` (Tampered fields: ${tamperedFields.join(', ')})` : ''}`, tamperedFields, 'PLAN_INTEGRITY_BREACH');
    this.name = 'PlanIntegrityBreachError';
    this.tamperedFields = tamperedFields;
    Object.setPrototypeOf(this, PlanIntegrityBreachError.prototype);
  }
}

export class ExecutionPlanMutationError extends ExecutionPlanValidationError {
  public readonly fieldName: string;
  public readonly originalValue: any;
  public readonly attemptedValue: any;

  constructor(fieldName: string, originalValue: any, attemptedValue: any) {
    super(
      `EXECUTION_PLAN_MUTATION_REJECTED: Authoritative field "${fieldName}" cannot be mutated from "${String(originalValue)}" to "${String(attemptedValue)}".`,
      [fieldName],
      'EXECUTION_PLAN_MUTATION_REJECTED'
    );
    this.name = 'ExecutionPlanMutationError';
    this.fieldName = fieldName;
    this.originalValue = originalValue;
    this.attemptedValue = attemptedValue;
    Object.setPrototypeOf(this, ExecutionPlanMutationError.prototype);
  }
}

export class AmbiguousBroadcastError extends BroadcastUncertainError {
  constructor(
    message = 'Transaction broadcast returned an ambiguous error or transport timeout.',
    contextOrTxHash?: string | { transactionId?: string; sender?: string; nonce?: number; chainId?: string | number; txHash?: string }
  ) {
    super(message, contextOrTxHash);
    this.name = 'AmbiguousBroadcastError';
    Object.setPrototypeOf(this, AmbiguousBroadcastError.prototype);
  }
}

export class AuthorizationBoundaryBreachError extends SecurityPolicyViolationError {
  public readonly boundary: string;
  public readonly attemptedAction: string;

  constructor(boundary: string, attemptedAction: string, reason = 'Execution boundary check failed') {
    super(`AUTHORIZATION_BOUNDARY_BREACH: [${boundary}] ${reason} (Attempted: ${attemptedAction})`, [boundary, reason]);
    this.name = 'AuthorizationBoundaryBreachError';
    this.boundary = boundary;
    this.attemptedAction = attemptedAction;
    Object.setPrototypeOf(this, AuthorizationBoundaryBreachError.prototype);
  }
}

export class UnauthorizedExecutionError extends SecurityPolicyViolationError {
  public readonly planId?: string;

  constructor(message = 'Execution attempted without authoritative authorization', planId?: string) {
    super(`UNAUTHORIZED_EXECUTION: ${message}${planId ? ` (Plan: ${planId})` : ''}`, [message]);
    this.name = 'UnauthorizedExecutionError';
    this.planId = planId;
    Object.setPrototypeOf(this, UnauthorizedExecutionError.prototype);
  }
}

export class InvalidSecurityStateTransitionError extends InvalidStateTransitionError {
  constructor(fromState: string, toState: string, context = 'SecurityStateMachine') {
    super(fromState, toState, context);
    this.name = 'InvalidSecurityStateTransitionError';
    Object.setPrototypeOf(this, InvalidSecurityStateTransitionError.prototype);
  }
}

export class ExecutionTargetNotAllowlistedError extends InvalidExecutionTargetError {
  constructor(target: string, chainId: string | number, reason = 'Target address is not on canonical allowlist') {
    super(target, chainId, `ALLOWLIST_REJECTION: ${reason}`);
    this.name = 'ExecutionTargetNotAllowlistedError';
    Object.setPrototypeOf(this, ExecutionTargetNotAllowlistedError.prototype);
  }
}

export class ApprovalPolicyViolationError extends SecurityPolicyViolationError {
  public readonly approvalTarget: string;
  public readonly amount: string;

  constructor(approvalTarget: string, amount: string, reason: string) {
    super(`APPROVAL_POLICY_VIOLATION: ${reason} (Target: ${approvalTarget}, Amount: ${amount})`, [reason]);
    this.name = 'ApprovalPolicyViolationError';
    this.approvalTarget = approvalTarget;
    this.amount = amount;
    Object.setPrototypeOf(this, ApprovalPolicyViolationError.prototype);
  }
}

export class CalldataAuthorizationError extends InvalidCalldataError {
  public readonly selector?: string;

  constructor(message: string, selector?: string) {
    super(`CALLDATA_AUTHORIZATION_FAILED: ${message}${selector ? ` (Selector: ${selector})` : ''}`);
    this.name = 'CalldataAuthorizationError';
    this.selector = selector;
    Object.setPrototypeOf(this, CalldataAuthorizationError.prototype);
  }
}

export class SemanticEquivalenceBreachError extends SecurityPolicyViolationError {
  public readonly field: string;
  public readonly expected: string;
  public readonly actual: string;

  constructor(field: string, expected: string, actual: string, message = 'Semantic equivalence check failed') {
    super(`SEMANTIC_EQUIVALENCE_BREACH: ${message} [Field: ${field}] (Expected: "${expected}", Actual: "${actual}")`, [field, message]);
    this.name = 'SemanticEquivalenceBreachError';
    this.field = field;
    this.expected = expected;
    this.actual = actual;
    Object.setPrototypeOf(this, SemanticEquivalenceBreachError.prototype);
  }
}

export class AbiEncodingMismatchError extends InvalidCalldataError {
  public readonly functionName: string;

  constructor(functionName: string, reason = 'Decoded and re-encoded calldata does not match byte-for-byte') {
    super(`ABI_ENCODING_MISMATCH: Function "${functionName}" ${reason}`);
    this.name = 'AbiEncodingMismatchError';
    this.functionName = functionName;
    Object.setPrototypeOf(this, AbiEncodingMismatchError.prototype);
  }
}

export class ParameterSemanticMismatchError extends SemanticEquivalenceBreachError {
  public readonly parameterIndex?: number;

  constructor(parameterName: string, expected: string, actual: string, parameterIndex?: number) {
    super(parameterName, expected, actual, `Parameter semantic mismatch${parameterIndex !== undefined ? ` at index ${parameterIndex}` : ''}`);
    this.name = 'ParameterSemanticMismatchError';
    this.parameterIndex = parameterIndex;
    Object.setPrototypeOf(this, ParameterSemanticMismatchError.prototype);
  }
}

export class NativeValueSemanticError extends SecurityPolicyViolationError {
  public readonly value: string;

  constructor(value: string, reason: string) {
    super(`NATIVE_VALUE_SEMANTIC_ERROR: ${reason} (Supplied value: "${value}")`, [reason]);
    this.name = 'NativeValueSemanticError';
    this.value = value;
    Object.setPrototypeOf(this, NativeValueSemanticError.prototype);
  }
}

export class GasSemanticError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'GAS_SEMANTIC_ERROR') {
    super(`GAS_SEMANTIC_ERROR: ${message}`);
    this.name = 'GasSemanticError';
    this.code = code;
    Object.setPrototypeOf(this, GasSemanticError.prototype);
  }
}

export class ReceiptSemanticError extends Error {
  public readonly code: string;
  public readonly txHash?: string;

  constructor(message: string, txHash?: string) {
    super(`RECEIPT_SEMANTIC_ERROR: ${message}${txHash ? ` (Tx: ${txHash})` : ''}`);
    this.name = 'ReceiptSemanticError';
    this.code = 'RECEIPT_SEMANTIC_ERROR';
    this.txHash = txHash;
    Object.setPrototypeOf(this, ReceiptSemanticError.prototype);
  }
}

export class EconomicSafetyBreachError extends SecurityPolicyViolationError {
  public readonly field: string;
  public readonly expected: string;
  public readonly actual: string;

  constructor(field: string, expected: string, actual: string, message = 'Economic safety boundary breached') {
    super(`ECONOMIC_SAFETY_BREACH: ${message} [Field: ${field}] (Expected: "${expected}", Actual: "${actual}")`, [field, message]);
    this.name = 'EconomicSafetyBreachError';
    this.field = field;
    this.expected = expected;
    this.actual = actual;
    Object.setPrototypeOf(this, EconomicSafetyBreachError.prototype);
  }
}

export class SlippagePolicyViolationError extends EconomicSafetyBreachError {
  public readonly slippageBps: number;

  constructor(slippageBps: number, reason: string, expected = '<= policy limit', actual = String(slippageBps)) {
    super('slippageBps', expected, actual, `Slippage policy violation: ${reason}`);
    this.name = 'SlippagePolicyViolationError';
    this.slippageBps = slippageBps;
    Object.setPrototypeOf(this, SlippagePolicyViolationError.prototype);
  }
}

export class MinimumOutputBreachError extends EconomicSafetyBreachError {
  constructor(minimumAmountOut: string, actualAmountOut: string, context = 'Output below guaranteed threshold') {
    super('minimumAmountOut', `>= ${minimumAmountOut}`, actualAmountOut, `Minimum output breach: ${context}`);
    this.name = 'MinimumOutputBreachError';
    Object.setPrototypeOf(this, MinimumOutputBreachError.prototype);
  }
}

export class InsufficientNativeReserveError extends EconomicSafetyBreachError {
  constructor(requiredTotal: string, availableBalance: string, reason = 'Insufficient native gas reserve') {
    super('nativeReserve', `>= ${requiredTotal}`, availableBalance, reason);
    this.name = 'InsufficientNativeReserveError';
    Object.setPrototypeOf(this, InsufficientNativeReserveError.prototype);
  }
}

export class QuoteFreshnessExpiredError extends EconomicSafetyBreachError {
  public readonly quoteAgeMs: number;
  public readonly maxAgeMs: number;

  constructor(quoteAgeMs: number, maxAgeMs: number, reason = 'Quote has expired or exceeds maximum freshness threshold') {
    super('quoteAgeMs', `<= ${maxAgeMs}`, String(quoteAgeMs), reason);
    this.name = 'QuoteFreshnessExpiredError';
    this.quoteAgeMs = quoteAgeMs;
    this.maxAgeMs = maxAgeMs;
    Object.setPrototypeOf(this, QuoteFreshnessExpiredError.prototype);
  }
}

export class FeeAccountingBreachError extends EconomicSafetyBreachError {
  constructor(maxAllowedFee: string, actualFee: string, feeType = 'totalFee') {
    super(feeType, `<= ${maxAllowedFee}`, actualFee, `Fee accounting breach: fee exceeds authorized limit`);
    this.name = 'FeeAccountingBreachError';
    Object.setPrototypeOf(this, FeeAccountingBreachError.prototype);
  }
}

export class PriceImpactExceededError extends EconomicSafetyBreachError {
  public readonly priceImpactPercent: number;
  public readonly maxAllowedPercent: number;

  constructor(priceImpactPercent: number, maxAllowedPercent: number) {
    super('priceImpactPercent', `<= ${maxAllowedPercent}%`, `${priceImpactPercent}%`, 'Price impact exceeds acceptable safety ceiling');
    this.name = 'PriceImpactExceededError';
    this.priceImpactPercent = priceImpactPercent;
    this.maxAllowedPercent = maxAllowedPercent;
    Object.setPrototypeOf(this, PriceImpactExceededError.prototype);
  }
}

export class SettlementFinalityBreachError extends Error {
  public readonly code = 'SETTLEMENT_FINALITY_BREACH';
  public readonly currentConfirmations: number;
  public readonly requiredConfirmations: number;
  public readonly chainId?: number | string;

  constructor(currentConfirmations: number, requiredConfirmations: number, chainId?: number | string, message?: string) {
    super(message || `Settlement finality breach: current confirmations (${currentConfirmations}) below required safety depth (${requiredConfirmations}) for chain ${chainId || 'unknown'}`);
    this.name = 'SettlementFinalityBreachError';
    this.currentConfirmations = currentConfirmations;
    this.requiredConfirmations = requiredConfirmations;
    this.chainId = chainId;
    Object.setPrototypeOf(this, SettlementFinalityBreachError.prototype);
  }
}

export class DestinationEvidenceMismatchError extends Error {
  public readonly code = 'DESTINATION_EVIDENCE_MISMATCH';
  public readonly field: string;
  public readonly expected: string;
  public readonly actual: string;

  constructor(field: string, expected: string, actual: string, message?: string) {
    super(message || `Destination evidence mismatch on ${field}: expected ${expected}, got ${actual}`);
    this.name = 'DestinationEvidenceMismatchError';
    this.field = field;
    this.expected = expected;
    this.actual = actual;
    Object.setPrototypeOf(this, DestinationEvidenceMismatchError.prototype);
  }
}

export class EvidenceConflictError extends Error {
  public readonly code = 'EVIDENCE_CONFLICT';
  public readonly primaryTier: string;
  public readonly secondaryTier: string;
  public readonly conflictDetails: string;

  constructor(primaryTier: string, secondaryTier: string, conflictDetails: string) {
    super(`Evidence conflict between ${primaryTier} and ${secondaryTier}: ${conflictDetails}`);
    this.name = 'EvidenceConflictError';
    this.primaryTier = primaryTier;
    this.secondaryTier = secondaryTier;
    this.conflictDetails = conflictDetails;
    Object.setPrototypeOf(this, EvidenceConflictError.prototype);
  }
}

export class DexNetworkMismatchError extends ConfigurationError {
  constructor(dexId: string, expectedNetworkId: string, actualNetworkId: string) {
    super(
      `DEX_NETWORK_MISMATCH: DEX "${dexId}" belongs to network "${expectedNetworkId}", cannot operate on network "${actualNetworkId}"`,
      'DEX_NETWORK_MISMATCH'
    );
    this.name = 'DexNetworkMismatchError';
    Object.setPrototypeOf(this, DexNetworkMismatchError.prototype);
  }
}

export class DexEnvironmentMismatchError extends ConfigurationError {
  constructor(dexId: string, expectedEnv: string, actualEnv: string) {
    super(
      `DEX_ENVIRONMENT_MISMATCH: DEX "${dexId}" environment "${expectedEnv}" does not match requested network environment "${actualEnv}"`,
      'DEX_ENVIRONMENT_MISMATCH'
    );
    this.name = 'DexEnvironmentMismatchError';
    Object.setPrototypeOf(this, DexEnvironmentMismatchError.prototype);
  }
}

export class DexFamilyMismatchError extends ConfigurationError {
  constructor(dexId: string, expectedFamily: string, actualFamily: string) {
    super(
      `DEX_FAMILY_MISMATCH: DEX "${dexId}" family "${expectedFamily}" does not match target family "${actualFamily}"`,
      'DEX_FAMILY_MISMATCH'
    );
    this.name = 'DexFamilyMismatchError';
    Object.setPrototypeOf(this, DexFamilyMismatchError.prototype);
  }
}

export class UnsupportedDexOperationError extends ConfigurationError {
  public readonly operation: string;
  public readonly dexId: string;
  constructor(dexId: string, operation: string, reason?: string) {
    super(
      `UNSUPPORTED_DEX_OPERATION: Operation "${operation}" is not supported on DEX "${dexId}"${reason ? `: ${reason}` : ''}`,
      'UNSUPPORTED_DEX_OPERATION'
    );
    this.name = 'UnsupportedDexOperationError';
    this.operation = operation;
    this.dexId = dexId;
    Object.setPrototypeOf(this, UnsupportedDexOperationError.prototype);
  }
}

export class DexCapabilityMismatchError extends ConfigurationError {
  constructor(dexId: string, requiredCapability: string, currentCapability: string, reason?: string) {
    super(
      `DEX_CAPABILITY_MISMATCH: DEX "${dexId}" capability "${currentCapability}" does not meet required "${requiredCapability}"${reason ? `: ${reason}` : ''}`,
      'DEX_CAPABILITY_MISMATCH'
    );
    this.name = 'DexCapabilityMismatchError';
    Object.setPrototypeOf(this, DexCapabilityMismatchError.prototype);
  }
}

export class DexMetadataConflictError extends ConfigurationError {
  constructor(dexId: string, conflictType: string, details: string) {
    super(
      `DEX_METADATA_CONFLICT: DEX "${dexId}" has ${conflictType}: ${details}`,
      'DEX_METADATA_CONFLICT'
    );
    this.name = 'DexMetadataConflictError';
    Object.setPrototypeOf(this, DexMetadataConflictError.prototype);
  }
}

export class DexPoolNotFoundError extends ConfigurationError {
  constructor(dexId: string, tokenA: string, tokenB: string, feeTier?: number) {
    super(
      `POOL_NOT_FOUND: No verified pool found on DEX "${dexId}" for pair ${tokenA}/${tokenB}${feeTier !== undefined ? ` (fee: ${feeTier})` : ''}`,
      'POOL_NOT_FOUND'
    );
    this.name = 'DexPoolNotFoundError';
    Object.setPrototypeOf(this, DexPoolNotFoundError.prototype);
  }
}

export class DexPoolUnverifiedError extends ConfigurationError {
  constructor(dexId: string, poolAddress: string, reason?: string) {
    super(
      `POOL_UNVERIFIED: Pool "${poolAddress}" on DEX "${dexId}" could not be verified${reason ? `: ${reason}` : ''}`,
      'POOL_UNVERIFIED'
    );
    this.name = 'DexPoolUnverifiedError';
    Object.setPrototypeOf(this, DexPoolUnverifiedError.prototype);
  }
}

export class DexSimulationFailedError extends Error {
  public readonly code = 'DEX_SIMULATION_FAILED';
  public readonly step: string;
  public readonly reason: string;
  constructor(step: string, reason: string) {
    super(`DEX simulation failed at step "${step}": ${reason}`);
    this.name = 'DexSimulationFailedError';
    this.step = step;
    this.reason = reason;
    Object.setPrototypeOf(this, DexSimulationFailedError.prototype);
  }
}

export class DexOnboardingTransitionError extends ConfigurationError {
  constructor(dexId: string, fromState: string, toState: string, reason?: string) {
    super(
      `DEX_ONBOARDING_TRANSITION_INVALID: Cannot transition DEX "${dexId}" from state "${fromState}" to "${toState}"${reason ? `: ${reason}` : ''}`,
      'DEX_ONBOARDING_TRANSITION_INVALID'
    );
    this.name = 'DexOnboardingTransitionError';
    Object.setPrototypeOf(this, DexOnboardingTransitionError.prototype);
  }
}

export class PriceImpactUnavailableError extends Error {
  public readonly code = 'PRICE_IMPACT_UNKNOWN';
  constructor(dexId: string, poolAddress?: string) {
    super(`PRICE_IMPACT_UNKNOWN: Price impact calculation unavailable for DEX "${dexId}"${poolAddress ? ` pool "${poolAddress}"` : ''}`);
    this.name = 'PriceImpactUnavailableError';
    Object.setPrototypeOf(this, PriceImpactUnavailableError.prototype);
  }
}

export class LiveDexVerificationError extends Error {
  public readonly code = 'LIVE_DEX_VERIFICATION_FAILED';
  public readonly dexId: string;
  public readonly stage: string;
  public readonly details?: string;
  constructor(dexId: string, stage: string, message: string, details?: string) {
    super(`LIVE_DEX_VERIFICATION_FAILED: DEX "${dexId}" failed at stage "${stage}": ${message}`);
    this.name = 'LiveDexVerificationError';
    this.dexId = dexId;
    this.stage = stage;
    this.details = details;
    Object.setPrototypeOf(this, LiveDexVerificationError.prototype);
  }
}

export class LiveExecutionBlockedError extends Error {
  public readonly code = 'LIVE_EXECUTION_BLOCKED';
  public readonly blockingReasons: string[];
  public readonly reasons: string[];
  constructor(reasons: string[]) {
    super(`LIVE_EXECUTION_BLOCKED: Live on-chain execution is strictly blocked by safety gate. Unmet prerequisites: ${reasons.join('; ')}`);
    this.name = 'LiveExecutionBlockedError';
    this.blockingReasons = reasons;
    this.reasons = reasons;
    Object.setPrototypeOf(this, LiveExecutionBlockedError.prototype);
  }
}
