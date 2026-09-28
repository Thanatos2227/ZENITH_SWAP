import { Interface } from 'ethers';
import { defaultSettlementTelemetry } from './settlementTelemetry';

export type DestinationEvidenceTier =
  | 'TIER_1_ONCHAIN_RECEIPT'
  | 'TIER_2_ONCHAIN_TX_LOOKUP'
  | 'TIER_3_ERC20_TRANSFER_EVENT'
  | 'TIER_4_RECIPIENT_BALANCE_DELTA'
  | 'TIER_5_PROVIDER_API'
  | 'TIER_6_LOCAL_CACHE';

export type DestinationSettlementStatus =
  | 'DESTINATION_SETTLED'
  | 'DESTINATION_STATUS_UNCERTAIN'
  | 'STATUS_CONFLICT'
  | 'DESTINATION_FAILED'
  | 'REORG_DETECTED';

export interface DestinationEvidenceItem {
  tier: DestinationEvidenceTier;
  priority: number; // 1 = highest, 6 = lowest
  verified: boolean;
  status: 'CONFIRMED' | 'REVERTED' | 'NOT_FOUND' | 'MISMATCH' | 'PENDING' | 'UNAVAILABLE';
  txHash?: string | null;
  blockNumber?: number;
  blockHash?: string | null;
  details?: Record<string, any>;
  timestamp: number;
}

export interface AuthoritativeDestinationVerificationParams {
  destinationChainId: number | string;
  destinationTxHash?: string | null;
  expectedRecipient: string;
  expectedToken: string;
  expectedMinAmountRaw: string | bigint;
  expectedSpokePoolOrTarget?: string | null;
  expectedBlockHash?: string | null;
  currentBlockNumber?: number | null;
  requiredConfirmations?: number | null;
  providerStatus?: string | null;
  providerFillTx?: string | null;
  bridgeProvider?: string | null;
  preBridgeBalanceRaw?: string | bigint;
  receipt?: {
    status: number | string;
    blockNumber: number;
    blockHash?: string;
    gasUsed?: string | bigint;
    logs?: Array<{ address: string; topics: string[]; data: string }>;
  } | null;
  transaction?: {
    hash: string;
    from: string;
    to: string;
    chainId?: number | bigint | string;
  } | null;
  currentBalanceRaw?: string | bigint | null;
  localCacheStatus?: string | null;
  planId?: string;
  intentId?: string;
}

export interface AuthoritativeDestinationVerificationResult {
  settlementStatus: DestinationSettlementStatus;
  primaryEvidenceTier: DestinationEvidenceTier | 'NONE';
  evidences: DestinationEvidenceItem[];
  actualDeliveredAmountRaw?: string;
  deliveredToExpectedRecipient: boolean;
  tokenMatched: boolean;
  confirmations?: number;
  requiredConfirmations?: number;
  isFinalized?: boolean;
  reorgDetected?: boolean;
  revertReason?: string;
  conflictReason?: string;
  blockNumber?: number;
  blockHash?: string;
  gasUsed?: string;
  timestamp: number;
}

const ERC20_TRANSFER_EVENT = 'event Transfer(address indexed from, address indexed to, uint256 value)';

export function verifyDestinationSettlement(
  params: AuthoritativeDestinationVerificationParams
): AuthoritativeDestinationVerificationResult {
  const evidences: DestinationEvidenceItem[] = [];
  const expectedRecipient = (params.expectedRecipient || '').toLowerCase();
  const expectedToken = (params.expectedToken || '').toLowerCase();
  const expectedMinAmount = BigInt((params.expectedMinAmountRaw || '0').toString());
  const now = Date.now();

  // Tier 6: Local Cache
  if (params.localCacheStatus) {
    evidences.push({
      tier: 'TIER_6_LOCAL_CACHE',
      priority: 6,
      verified: true,
      status: params.localCacheStatus === 'SETTLED' ? 'CONFIRMED' : 'PENDING',
      details: { localCacheStatus: params.localCacheStatus },
      timestamp: now
    });
  }

  // Tier 5: Provider API
  const providerStatus = (params.providerStatus || '').toLowerCase();
  const providerFillTx = params.providerFillTx;
  if (providerStatus) {
    const isFilled = providerStatus === 'filled';
    const isFailed = providerStatus === 'refunded' || providerStatus === 'expired';
    evidences.push({
      tier: 'TIER_5_PROVIDER_API',
      priority: 5,
      verified: true,
      status: isFilled ? 'CONFIRMED' : (isFailed ? 'REVERTED' : 'PENDING'),
      txHash: providerFillTx,
      details: { providerStatus, providerFillTx },
      timestamp: now
    });
  }

  // Tier 2: Transaction Lookup
  let txChainMismatch = false;
  let txTargetMismatch = false;
  if (params.transaction) {
    if (params.transaction.chainId !== undefined && params.transaction.chainId !== null) {
      const normalizedTxChain = String(params.transaction.chainId).toLowerCase();
      const normalizedExpectedChain = String(params.destinationChainId).toLowerCase();
      if (normalizedTxChain !== normalizedExpectedChain) {
        txChainMismatch = true;
      }
    }

    if (params.expectedSpokePoolOrTarget && params.transaction.to) {
      if (params.transaction.to.toLowerCase() !== params.expectedSpokePoolOrTarget.toLowerCase()) {
        txTargetMismatch = true;
      }
    }

    evidences.push({
      tier: 'TIER_2_ONCHAIN_TX_LOOKUP',
      priority: 2,
      verified: !txChainMismatch && !txTargetMismatch,
      status: txChainMismatch || txTargetMismatch ? 'MISMATCH' : 'CONFIRMED',
      txHash: params.transaction.hash,
      details: {
        from: params.transaction.from,
        to: params.transaction.to,
        chainId: params.transaction.chainId?.toString(),
        txChainMismatch,
        txTargetMismatch
      },
      timestamp: now
    });
  }

  // Tier 1: On-Chain Receipt
  let receiptConfirmed = false;
  let receiptReverted = false;
  let receiptBlockNumber: number | undefined;
  let receiptBlockHash: string | undefined;
  let receiptGasUsed: string | undefined;
  let reorgDetected = false;
  let reorgReason: string | undefined;
  let confirmations: number | undefined;
  const requiredConfirmations = params.requiredConfirmations || 1;
  let isFinalized = false;

  if (params.receipt) {
    const rawStatus = params.receipt.status;
    const isSuccess = rawStatus === 1 || rawStatus === '0x1' || rawStatus === '1';
    receiptConfirmed = isSuccess;
    receiptReverted = !isSuccess;
    receiptBlockNumber = params.receipt.blockNumber;
    receiptBlockHash = params.receipt.blockHash;
    receiptGasUsed = params.receipt.gasUsed?.toString();

    // Check block hash reorg
    if (params.expectedBlockHash && receiptBlockHash) {
      if (params.expectedBlockHash.toLowerCase() !== receiptBlockHash.toLowerCase()) {
        reorgDetected = true;
        reorgReason = `Reorg detected: expected block hash ${params.expectedBlockHash}, got ${receiptBlockHash}`;
      }
    }

    // Check confirmation depth
    if (params.currentBlockNumber !== undefined && params.currentBlockNumber !== null && receiptBlockNumber !== undefined) {
      if (params.currentBlockNumber < receiptBlockNumber) {
        reorgDetected = true;
        reorgReason = `Reorg detected: current block ${params.currentBlockNumber} is behind receipt block ${receiptBlockNumber}`;
      }
      confirmations = params.currentBlockNumber - receiptBlockNumber + 1;
      isFinalized = confirmations >= requiredConfirmations && !reorgDetected;
    } else {
      confirmations = 1;
      isFinalized = true;
    }

    evidences.push({
      tier: 'TIER_1_ONCHAIN_RECEIPT',
      priority: 1,
      verified: isSuccess && !reorgDetected,
      status: reorgDetected ? 'MISMATCH' : (isSuccess ? 'CONFIRMED' : 'REVERTED'),
      txHash: params.destinationTxHash || params.transaction?.hash,
      blockNumber: receiptBlockNumber,
      blockHash: receiptBlockHash,
      details: { gasUsed: receiptGasUsed, rawStatus, confirmations, requiredConfirmations, isFinalized, reorgDetected },
      timestamp: now
    });
  } else if (params.destinationTxHash) {
    evidences.push({
      tier: 'TIER_1_ONCHAIN_RECEIPT',
      priority: 1,
      verified: false,
      status: 'NOT_FOUND',
      txHash: params.destinationTxHash,
      timestamp: now
    });
  }

  // Tier 3: ERC-20 Transfer Event Verification
  let transferFound = false;
  let tokenMatched = false;
  let deliveredToExpectedRecipient = false;
  let actualDeliveredAmountRaw = '0';
  let transferMismatchReason: string | undefined;

  if (params.receipt?.logs && Array.isArray(params.receipt.logs)) {
    const erc20Iface = new Interface([ERC20_TRANSFER_EVENT]);
    for (const log of params.receipt.logs) {
      if (log.address.toLowerCase() === expectedToken) {
        tokenMatched = true;
        try {
          const parsed = erc20Iface.parseLog({ topics: log.topics, data: log.data });
          if (parsed && parsed.name === 'Transfer') {
            const transferTo = parsed.args.to.toLowerCase();
            const transferVal = BigInt(parsed.args.value.toString());
            if (transferTo === expectedRecipient) {
              deliveredToExpectedRecipient = true;
              actualDeliveredAmountRaw = transferVal.toString();
              if (transferVal >= expectedMinAmount) {
                transferFound = true;
              } else {
                transferMismatchReason = `Delivered amount ${transferVal.toString()} below minimum expected ${expectedMinAmount.toString()}`;
              }
              break;
            }
          }
        } catch {
          // Non-transfer log in token contract
        }
      }
    }

    evidences.push({
      tier: 'TIER_3_ERC20_TRANSFER_EVENT',
      priority: 3,
      verified: transferFound,
      status: transferFound ? 'CONFIRMED' : (tokenMatched ? 'MISMATCH' : 'NOT_FOUND'),
      details: {
        tokenMatched,
        deliveredToExpectedRecipient,
        actualDeliveredAmountRaw,
        expectedMinAmount: expectedMinAmount.toString(),
        mismatchReason: transferMismatchReason
      },
      timestamp: now
    });
  }

  // Tier 4: Balance Delta
  let balanceDeltaConfirmed = false;
  if (params.currentBalanceRaw !== undefined && params.currentBalanceRaw !== null) {
    const currentBal = BigInt(params.currentBalanceRaw.toString());
    const preBal = params.preBridgeBalanceRaw !== undefined && params.preBridgeBalanceRaw !== null
      ? BigInt(params.preBridgeBalanceRaw.toString())
      : 0n;
    const delta = currentBal - preBal;
    balanceDeltaConfirmed = delta >= expectedMinAmount;

    evidences.push({
      tier: 'TIER_4_RECIPIENT_BALANCE_DELTA',
      priority: 4,
      verified: balanceDeltaConfirmed,
      status: balanceDeltaConfirmed ? 'CONFIRMED' : 'MISMATCH',
      details: {
        preBridgeBalance: preBal.toString(),
        currentBalance: currentBal.toString(),
        netDelta: delta.toString()
      },
      timestamp: now
    });
  }

  // Helper to record telemetry and return
  const finalizeResult = (res: AuthoritativeDestinationVerificationResult): AuthoritativeDestinationVerificationResult => {
    defaultSettlementTelemetry.record({
      planId: params.planId || 'plan-unspecified',
      intentId: params.intentId || 'intent-unspecified',
      sourceChainId: 'source-unspecified',
      destinationChainId: params.destinationChainId,
      destinationTxHash: params.destinationTxHash || params.transaction?.hash || '',
      destinationBlockHash: receiptBlockHash,
      destinationBlockNumber: receiptBlockNumber,
      confirmations,
      requiredConfirmations,
      expectedRecipient,
      actualRecipient: deliveredToExpectedRecipient ? expectedRecipient : undefined,
      expectedToken,
      actualToken: tokenMatched ? expectedToken : undefined,
      expectedMinAmount: expectedMinAmount.toString(),
      actualDeliveredAmount: actualDeliveredAmountRaw,
      primaryEvidenceTier: res.primaryEvidenceTier,
      evidenceSource: res.primaryEvidenceTier,
      verificationResult: res.settlementStatus === 'DESTINATION_SETTLED'
        ? 'SETTLED'
        : (res.settlementStatus === 'STATUS_CONFLICT'
          ? 'CONFLICT'
          : (res.settlementStatus === 'REORG_DETECTED'
            ? 'REORG_DETECTED'
            : (res.settlementStatus === 'DESTINATION_FAILED' ? 'FAILED' : 'PENDING'))),
      reorgDetected: res.reorgDetected,
      conflictReason: res.conflictReason || res.revertReason
    });
    return res;
  };

  // ==========================================
  // HIERARCHICAL SETTLEMENT EVALUATION
  // ==========================================

  // 1. Reorg Detected
  if (reorgDetected) {
    return finalizeResult({
      settlementStatus: 'REORG_DETECTED',
      primaryEvidenceTier: 'TIER_1_ONCHAIN_RECEIPT',
      evidences,
      deliveredToExpectedRecipient: false,
      tokenMatched,
      reorgDetected: true,
      conflictReason: reorgReason,
      blockNumber: receiptBlockNumber,
      blockHash: receiptBlockHash,
      gasUsed: receiptGasUsed,
      timestamp: now
    });
  }

  // 2. Chain ID Mismatch
  if (txChainMismatch) {
    return finalizeResult({
      settlementStatus: 'STATUS_CONFLICT',
      primaryEvidenceTier: 'TIER_2_ONCHAIN_TX_LOOKUP',
      evidences,
      deliveredToExpectedRecipient: false,
      tokenMatched: false,
      conflictReason: `Transaction chain ID ${params.transaction?.chainId} does not match expected destination chain ${params.destinationChainId}.`,
      timestamp: now
    });
  }

  // 3. Execution Target / SpokePool Mismatch
  if (txTargetMismatch) {
    return finalizeResult({
      settlementStatus: 'STATUS_CONFLICT',
      primaryEvidenceTier: 'TIER_2_ONCHAIN_TX_LOOKUP',
      evidences,
      deliveredToExpectedRecipient: false,
      tokenMatched: false,
      conflictReason: `Transaction destination target ${params.transaction?.to} does not match authorized SpokePool ${params.expectedSpokePoolOrTarget}.`,
      timestamp: now
    });
  }

  // 4. Conflict: Receipt is Reverted, but Provider API claimed FILLED
  if (receiptReverted && providerStatus === 'filled') {
    const providerLabel = params.bridgeProvider && params.bridgeProvider.toLowerCase() !== 'across'
      ? `${params.bridgeProvider.charAt(0).toUpperCase() + params.bridgeProvider.slice(1)} Provider API`
      : 'Across Provider API';
    return finalizeResult({
      settlementStatus: 'STATUS_CONFLICT',
      primaryEvidenceTier: 'TIER_1_ONCHAIN_RECEIPT',
      evidences,
      deliveredToExpectedRecipient: false,
      tokenMatched,
      conflictReason: `${providerLabel} reported filled, but on-chain receipt in block ${receiptBlockNumber} was REVERTED.`,
      blockNumber: receiptBlockNumber,
      blockHash: receiptBlockHash,
      gasUsed: receiptGasUsed,
      timestamp: now
    });
  }

  // 5. Conflict: Receipt is Confirmed, but ERC20 Transfer delivered to a different recipient
  if (receiptConfirmed && params.receipt?.logs && tokenMatched && !deliveredToExpectedRecipient) {
    return finalizeResult({
      settlementStatus: 'STATUS_CONFLICT',
      primaryEvidenceTier: 'TIER_3_ERC20_TRANSFER_EVENT',
      evidences,
      deliveredToExpectedRecipient: false,
      tokenMatched: true,
      conflictReason: `Destination transaction succeeded, but token transfer recipient did not match expected ${expectedRecipient}.`,
      blockNumber: receiptBlockNumber,
      blockHash: receiptBlockHash,
      gasUsed: receiptGasUsed,
      timestamp: now
    });
  }

  // 6. Conflict: Receipt is Confirmed, provider claims FILLED, but delivered amount is below minimum
  if (receiptConfirmed && params.receipt?.logs && tokenMatched && deliveredToExpectedRecipient && !transferFound && providerStatus === 'filled') {
    return finalizeResult({
      settlementStatus: 'STATUS_CONFLICT',
      primaryEvidenceTier: 'TIER_3_ERC20_TRANSFER_EVENT',
      evidences,
      deliveredToExpectedRecipient: true,
      tokenMatched: true,
      actualDeliveredAmountRaw,
      conflictReason: transferMismatchReason || `Delivered amount ${actualDeliveredAmountRaw} is below expected minimum ${expectedMinAmount.toString()}.`,
      blockNumber: receiptBlockNumber,
      blockHash: receiptBlockHash,
      gasUsed: receiptGasUsed,
      timestamp: now
    });
  }

  // 7. Reverted on-chain
  if (receiptReverted) {
    return finalizeResult({
      settlementStatus: 'DESTINATION_FAILED',
      primaryEvidenceTier: 'TIER_1_ONCHAIN_RECEIPT',
      evidences,
      deliveredToExpectedRecipient: false,
      tokenMatched,
      revertReason: `Destination transaction reverted on-chain in block ${receiptBlockNumber}.`,
      blockNumber: receiptBlockNumber,
      blockHash: receiptBlockHash,
      gasUsed: receiptGasUsed,
      timestamp: now
    });
  }

  // 8. Provider reported failure
  if (providerStatus === 'refunded' || providerStatus === 'expired') {
    return finalizeResult({
      settlementStatus: 'DESTINATION_FAILED',
      primaryEvidenceTier: 'TIER_5_PROVIDER_API',
      evidences,
      deliveredToExpectedRecipient: false,
      tokenMatched: false,
      revertReason: `Bridge order was ${providerStatus} by provider.`,
      timestamp: now
    });
  }

  // 9. Authoritative On-Chain Settlement
  // Requires on-chain receipt status 1 AND confirmed ERC-20 transfer to recipient AND required finality confirmations met
  if (receiptConfirmed && (transferFound || balanceDeltaConfirmed)) {
    if (!isFinalized) {
      return finalizeResult({
        settlementStatus: 'DESTINATION_STATUS_UNCERTAIN',
        primaryEvidenceTier: 'TIER_1_ONCHAIN_RECEIPT',
        evidences,
        actualDeliveredAmountRaw,
        deliveredToExpectedRecipient: true,
        tokenMatched: true,
        confirmations,
        requiredConfirmations,
        isFinalized: false,
        conflictReason: `Confirmations (${confirmations}) below required finality threshold (${requiredConfirmations}).`,
        blockNumber: receiptBlockNumber,
        blockHash: receiptBlockHash,
        gasUsed: receiptGasUsed,
        timestamp: now
      });
    }

    return finalizeResult({
      settlementStatus: 'DESTINATION_SETTLED',
      primaryEvidenceTier: transferFound ? 'TIER_3_ERC20_TRANSFER_EVENT' : 'TIER_1_ONCHAIN_RECEIPT',
      evidences,
      actualDeliveredAmountRaw,
      deliveredToExpectedRecipient: true,
      tokenMatched: true,
      confirmations,
      requiredConfirmations,
      isFinalized: true,
      blockNumber: receiptBlockNumber,
      blockHash: receiptBlockHash,
      gasUsed: receiptGasUsed,
      timestamp: now
    });
  }

  // 10. Provider reports filled, but receipt is missing, pending, or unindexed
  if (providerStatus === 'filled' && !receiptConfirmed) {
    return finalizeResult({
      settlementStatus: 'DESTINATION_STATUS_UNCERTAIN',
      primaryEvidenceTier: 'TIER_5_PROVIDER_API',
      evidences,
      deliveredToExpectedRecipient,
      tokenMatched,
      conflictReason: `Provider reported filled with tx ${params.destinationTxHash || providerFillTx}, but on-chain receipt is pending or unconfirmed.`,
      timestamp: now
    });
  }

  // 11. Default: Uncertain / Pending
  return finalizeResult({
    settlementStatus: 'DESTINATION_STATUS_UNCERTAIN',
    primaryEvidenceTier: evidences.find(e => e.verified)?.tier || 'NONE',
    evidences,
    deliveredToExpectedRecipient,
    tokenMatched,
    actualDeliveredAmountRaw,
    conflictReason: transferMismatchReason,
    timestamp: now
  });
}
