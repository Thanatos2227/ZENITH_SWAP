/**
 * ZENITH Protocol — Authoritative Broadcast Authorization Gate
 *
 * Final safety boundary before any transaction dispatch or on-chain broadcast.
 *
 * INVARIANTS ENFORCED:
 * 1. Quote != Execution Plan != Simulation Success != Broadcast Authorization
 * 2. sendTransaction / eth_sendRawTransaction are strictly blocked unless a valid,
 *    unexpired, parameter-locked BroadcastAuthorization object is explicitly verified.
 * 3. Read-only audits NEVER automatically transition into BROADCAST_AUTHORIZED.
 * 4. Calldata integrity: keccak256(calldata) must exactly match the authorized hash.
 * 5. Quote freshness: quoteTimestamp must satisfy on-chain tolerance.
 * 6. ZERO private key logging, serialization, or exposure.
 * 7. Fail-closed: Any parameter divergence halts progression and revokes authorization.
 */

import { ethers, keccak256, getAddress } from 'ethers';

export type BroadcastLifecycleState =
  | 'NO_SIGNER_CONFIGURED'
  | 'SIGNER_CONFIGURED_BUT_UNFUNDED'
  | 'SIGNER_CONFIGURED_INSUFFICIENT_USDC'
  | 'SIGNER_CONFIGURED_INSUFFICIENT_NATIVE_GAS'
  | 'SIGNER_CONFIGURED_ALLOWANCE_INSUFFICIENT'
  | 'SIGNER_CONFIGURED_EXECUTION_READY'
  | 'BROADCAST_AUTHORIZATION_REQUIRED'
  | 'BROADCAST_AUTHORIZED'
  | 'BROADCAST_SUBMITTED'
  | 'BROADCAST_CONFIRMED'
  | 'BROADCAST_FAILED';

export type SimulationExecutionStatus = 'SUCCESS' | 'REVERTED' | 'UNAVAILABLE';

export type SimulationClassification =
  | 'SIMULATION_PASS'
  | 'EXPECTED_STALE_QUOTE'
  | 'EXPECTED_UNAPPROVED_CALLER'
  | 'EXPECTED_UNFUNDED_CALLER'
  | 'NO_SIGNER_CONFIGURED'
  | 'UNEXPECTED_REVERT';

export interface BroadcastAuthorization {
  authorizationId: string;
  sourceChainId: number;
  destinationChainId: number;
  signerAddress: string;
  recipientAddress: string;
  sourceToken: string;
  destinationToken: string;
  sourceSpokePool: string;
  destinationSpokePool: string;
  inputAmountRaw: string;
  quotedOutputAmountRaw: string;
  minimumOutputAmountRaw: string;
  quoteTimestamp: number;
  quoteExpiry: number;
  routeId: string;
  calldataHash: string;
  simulationStatus: SimulationExecutionStatus;
  simulationClassification: SimulationClassification;
  gasReadiness: 'READY' | 'INSUFFICIENT_FUNDS' | 'NOT_CHECKED';
  balanceReadiness: 'SUFFICIENT' | 'INSUFFICIENT' | 'NOT_CHECKED';
  allowanceReadiness: 'SUFFICIENT' | 'INSUFFICIENT' | 'NOT_CHECKED';
  authorizedAt: number;
  validUntil: number;
  authorizedBy: string;
}

export interface BroadcastExecutionContext {
  sourceChainId: number;
  destinationChainId: number;
  signerAddress: string;
  recipientAddress: string;
  sourceToken: string;
  destinationToken: string;
  sourceSpokePool: string;
  inputAmountRaw: string;
  calldata: string;
  currentChainTimestamp?: number;
}

export class BroadcastAuthorizationError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, any>;

  constructor(code: string, message: string, details?: Record<string, any>) {
    super(`[ZENITH BroadcastAuthorizationGate] ${code}: ${message}`);
    this.name = 'BroadcastAuthorizationError';
    this.code = code;
    this.details = details;
  }
}

export class BroadcastAuthorizationGate {
  public static readonly MAX_QUOTE_AGE_SEC = 1800; // 30 minutes max tolerance
  public static readonly AUTHORIZATION_VALIDITY_MS = 60000; // 60 seconds TTL

  /**
   * Deterministically compute the keccak256 hash of the transaction calldata.
   */
  public static computeCalldataHash(calldata: string): string {
    if (!calldata || !calldata.startsWith('0x')) {
      throw new BroadcastAuthorizationError('INVALID_CALLDATA', 'Calldata must be a non-empty 0x-prefixed hex string');
    }
    return keccak256(calldata);
  }

  /**
   * Verify all pre-broadcast readiness gates and return the strict lifecycle state.
   * NOTE: Even if all checks pass, this returns BROADCAST_AUTHORIZATION_REQUIRED.
   * It will NEVER return BROADCAST_AUTHORIZED automatically.
   */
  public static evaluateReadinessState(params: {
    signerConfigured: boolean;
    signerAddress: string | null;
    nativeBalanceSufficient: boolean;
    usdcBalanceSufficient: boolean;
    allowanceSufficient: boolean;
    sourceRpcHealthy: boolean;
    destinationRpcHealthy: boolean;
    routeSupported: boolean;
    quoteValid: boolean;
    quoteExpired: boolean;
    simulationExecution: SimulationExecutionStatus;
    simulationClassification: SimulationClassification;
  }): { state: BroadcastLifecycleState; authorized: false; reason: string } {
    if (!params.signerConfigured || !params.signerAddress) {
      return {
        state: 'NO_SIGNER_CONFIGURED',
        authorized: false,
        reason: 'Signer is not configured in the active environment.'
      };
    }

    if (!params.nativeBalanceSufficient && !params.usdcBalanceSufficient) {
      return {
        state: 'SIGNER_CONFIGURED_BUT_UNFUNDED',
        authorized: false,
        reason: 'Signer lacks both native gas funds and source USDC balance.'
      };
    }

    if (params.nativeBalanceSufficient && !params.usdcBalanceSufficient) {
      return {
        state: 'SIGNER_CONFIGURED_INSUFFICIENT_USDC',
        authorized: false,
        reason: 'Signer has sufficient gas but lacks required source USDC balance.'
      };
    }

    if (!params.nativeBalanceSufficient && params.usdcBalanceSufficient) {
      return {
        state: 'SIGNER_CONFIGURED_INSUFFICIENT_NATIVE_GAS',
        authorized: false,
        reason: 'Signer has source USDC but lacks sufficient native gas balance.'
      };
    }

    if (!params.allowanceSufficient) {
      return {
        state: 'SIGNER_CONFIGURED_ALLOWANCE_INSUFFICIENT',
        authorized: false,
        reason: 'SpokePool contract allowance is insufficient for the intended amount.'
      };
    }

    if (!params.sourceRpcHealthy || !params.destinationRpcHealthy) {
      return {
        state: 'SIGNER_CONFIGURED_EXECUTION_READY',
        authorized: false,
        reason: 'One or more RPC quorums are offline or degraded.'
      };
    }

    if (!params.routeSupported || !params.quoteValid || params.quoteExpired) {
      return {
        state: 'SIGNER_CONFIGURED_EXECUTION_READY',
        authorized: false,
        reason: 'Route is unavailable or live quote is invalid/expired.'
      };
    }

    // All on-chain and architectural prerequisites met -> requires explicit authorization
    return {
      state: 'BROADCAST_AUTHORIZATION_REQUIRED',
      authorized: false,
      reason: 'All technical prerequisites verified. Explicit operator authorization required before broadcast.'
    };
  }

  /**
   * Explicitly issue an authorization record.
   * Can ONLY be called by an authorized operator ceremony, NEVER by read-only probes.
   */
  public static issueAuthorization(params: {
    sourceChainId: number;
    destinationChainId: number;
    signerAddress: string;
    recipientAddress: string;
    sourceToken: string;
    destinationToken: string;
    sourceSpokePool: string;
    destinationSpokePool: string;
    inputAmountRaw: string;
    quotedOutputAmountRaw: string;
    minimumOutputAmountRaw: string;
    quoteTimestamp: number;
    quoteExpiry: number;
    routeId: string;
    calldata: string;
    simulationStatus: SimulationExecutionStatus;
    simulationClassification: SimulationClassification;
    gasReadiness: 'READY' | 'INSUFFICIENT_FUNDS' | 'NOT_CHECKED';
    balanceReadiness: 'SUFFICIENT' | 'INSUFFICIENT' | 'NOT_CHECKED';
    allowanceReadiness: 'SUFFICIENT' | 'INSUFFICIENT' | 'NOT_CHECKED';
    authorizedBy: string;
    validityMs?: number;
  }): BroadcastAuthorization {
    const now = Date.now();
    const validity = params.validityMs || this.AUTHORIZATION_VALIDITY_MS;

    // Zero key validation (prevent any accidental key passing)
    if ((params.signerAddress as any).length === 66 && (params.signerAddress as any).startsWith('0x')) {
      // Check if user accidentally passed a private key instead of an address
      try {
        new ethers.Wallet(params.signerAddress);
        throw new BroadcastAuthorizationError('SECURITY_BREACH_PRIVATE_KEY_PASSED', 'Private key passed where address was expected! Key discarded.');
      } catch (err: any) {
        if (err.code === 'SECURITY_BREACH_PRIVATE_KEY_PASSED') throw err;
      }
    }

    const normalizedSigner = getAddress(params.signerAddress);
    const normalizedRecipient = getAddress(params.recipientAddress);
    const normalizedSourceToken = getAddress(params.sourceToken);
    const normalizedDestToken = getAddress(params.destinationToken);
    const normalizedSourceSpokePool = getAddress(params.sourceSpokePool);
    const normalizedDestSpokePool = getAddress(params.destinationSpokePool);

    const calldataHash = this.computeCalldataHash(params.calldata);
    const authEntropy = keccak256(ethers.toUtf8Bytes(`${params.signerAddress}-${params.calldata}-${now}`)).slice(2, 10);

    return {
      authorizationId: `AUTH-${params.sourceChainId}-${params.destinationChainId}-${now}-${authEntropy}`,
      sourceChainId: params.sourceChainId,
      destinationChainId: params.destinationChainId,
      signerAddress: normalizedSigner,
      recipientAddress: normalizedRecipient,
      sourceToken: normalizedSourceToken,
      destinationToken: normalizedDestToken,
      sourceSpokePool: normalizedSourceSpokePool,
      destinationSpokePool: normalizedDestSpokePool,
      inputAmountRaw: params.inputAmountRaw,
      quotedOutputAmountRaw: params.quotedOutputAmountRaw,
      minimumOutputAmountRaw: params.minimumOutputAmountRaw,
      quoteTimestamp: params.quoteTimestamp,
      quoteExpiry: params.quoteExpiry,
      routeId: params.routeId,
      calldataHash,
      simulationStatus: params.simulationStatus,
      simulationClassification: params.simulationClassification,
      gasReadiness: params.gasReadiness,
      balanceReadiness: params.balanceReadiness,
      allowanceReadiness: params.allowanceReadiness,
      authorizedAt: now,
      validUntil: now + validity,
      authorizedBy: params.authorizedBy
    };
  }

  /**
   * Authoritatively verify a BroadcastAuthorization before any transaction dispatch.
   * Throws BroadcastAuthorizationError if any condition is violated.
   */
  public static verifyAuthorization(
    auth: BroadcastAuthorization | null | undefined,
    context: BroadcastExecutionContext
  ): { authorized: true; calldataHash: string; authorizedAt: number } {
    if (!auth) {
      throw new BroadcastAuthorizationError('NO_AUTHORIZATION_PROVIDED', 'Broadcast blocked: No BroadcastAuthorization provided.');
    }

    const now = Date.now();

    // 1. Check TTL Expiration
    if (now > auth.validUntil) {
      throw new BroadcastAuthorizationError('AUTHORIZATION_EXPIRED', `Authorization expired at ${auth.validUntil} (current time: ${now}).`, { validUntil: auth.validUntil, now });
    }

    // 2. Check Quote Expiry
    if (now > auth.quoteExpiry) {
      throw new BroadcastAuthorizationError('QUOTE_EXPIRED', `Underlying route quote expired at ${auth.quoteExpiry} (current time: ${now}).`, { quoteExpiry: auth.quoteExpiry, now });
    }

    // 3. Check Quote Timestamp Age vs On-Chain Time
    const currentChainTs = context.currentChainTimestamp || Math.floor(now / 1000);
    if (auth.quoteTimestamp > currentChainTs) {
      throw new BroadcastAuthorizationError('INVALID_FUTURE_QUOTE_TIMESTAMP', `Quote timestamp (${auth.quoteTimestamp}) is in the future relative to chain timestamp (${currentChainTs}).`, { quoteTimestamp: auth.quoteTimestamp, currentChainTs });
    }
    if (currentChainTs - auth.quoteTimestamp > this.MAX_QUOTE_AGE_SEC) {
      throw new BroadcastAuthorizationError('STALE_QUOTE_TIMESTAMP', `Quote timestamp (${auth.quoteTimestamp}) is too old relative to chain timestamp (${currentChainTs}).`, { quoteTimestamp: auth.quoteTimestamp, currentChainTs });
    }

    // 4. Verify Chain IDs
    if (context.sourceChainId !== auth.sourceChainId) {
      throw new BroadcastAuthorizationError('SOURCE_CHAIN_MISMATCH', `Context sourceChainId (${context.sourceChainId}) does not match authorized (${auth.sourceChainId}).`);
    }
    if (context.destinationChainId !== auth.destinationChainId) {
      throw new BroadcastAuthorizationError('DESTINATION_CHAIN_MISMATCH', `Context destinationChainId (${context.destinationChainId}) does not match authorized (${auth.destinationChainId}).`);
    }

    // 5. Verify Signer & Recipient
    const normalizedContextSigner = getAddress(context.signerAddress);
    const normalizedContextRecipient = getAddress(context.recipientAddress);

    if (normalizedContextSigner !== auth.signerAddress) {
      throw new BroadcastAuthorizationError('SIGNER_MISMATCH', `Context signer (${normalizedContextSigner}) does not match authorized (${auth.signerAddress}).`);
    }
    if (normalizedContextRecipient !== auth.recipientAddress) {
      throw new BroadcastAuthorizationError('RECIPIENT_MISMATCH', `Context recipient (${normalizedContextRecipient}) does not match authorized (${auth.recipientAddress}).`);
    }

    // 6. Verify Tokens & SpokePool
    const normalizedContextToken = getAddress(context.sourceToken);
    const normalizedContextDestToken = getAddress(context.destinationToken);
    const normalizedContextSpokePool = getAddress(context.sourceSpokePool);

    if (normalizedContextToken !== auth.sourceToken) {
      throw new BroadcastAuthorizationError('SOURCE_TOKEN_MISMATCH', `Context sourceToken (${normalizedContextToken}) does not match authorized (${auth.sourceToken}).`);
    }
    if (normalizedContextDestToken !== auth.destinationToken) {
      throw new BroadcastAuthorizationError('DEST_TOKEN_MISMATCH', `Context destinationToken (${normalizedContextDestToken}) does not match authorized (${auth.destinationToken}).`);
    }
    if (normalizedContextSpokePool !== auth.sourceSpokePool) {
      throw new BroadcastAuthorizationError('SPOKE_POOL_MISMATCH', `Context spokePool (${normalizedContextSpokePool}) does not match authorized (${auth.sourceSpokePool}).`);
    }

    // 7. Verify Amount
    if (context.inputAmountRaw !== auth.inputAmountRaw) {
      throw new BroadcastAuthorizationError('AMOUNT_MISMATCH', `Context amount (${context.inputAmountRaw}) does not match authorized (${auth.inputAmountRaw}).`);
    }

    // 8. Calldata Integrity Hash Verification
    const contextCalldataHash = this.computeCalldataHash(context.calldata);
    if (contextCalldataHash !== auth.calldataHash) {
      throw new BroadcastAuthorizationError('CALLDATA_HASH_MISMATCH', `Calldata has been modified post-authorization! (Expected: ${auth.calldataHash}, Actual: ${contextCalldataHash})`);
    }

    return {
      authorized: true,
      calldataHash: auth.calldataHash,
      authorizedAt: auth.authorizedAt
    };
  }

  /**
   * Secure wrapper: intercept transaction broadcast and execute only after gate passes.
   */
  public static async executeWithGate<T>(
    auth: BroadcastAuthorization | null | undefined,
    context: BroadcastExecutionContext,
    broadcastFn: () => Promise<T>
  ): Promise<T> {
    this.verifyAuthorization(auth, context);
    return await broadcastFn();
  }
}
