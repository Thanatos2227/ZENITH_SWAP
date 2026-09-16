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
  constructor(message = 'Quote has expired. A fresh quote must be obtained before execution.') {
    super(message);
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

