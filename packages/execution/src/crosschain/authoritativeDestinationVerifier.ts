import { Interface } from 'ethers';

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
  | 'DESTINATION_FAILED';

export interface DestinationEvidenceItem {
  tier: DestinationEvidenceTier;
  priority: number; // 1 = highest, 6 = lowest
  verified: boolean;
  status: 'CONFIRMED' | 'REVERTED' | 'NOT_FOUND' | 'MISMATCH' | 'PENDING' | 'UNAVAILABLE';
  txHash?: string | null;
  blockNumber?: number;
  details?: Record<string, any>;
  timestamp: number;
}

export interface AuthoritativeDestinationVerificationParams {
  destinationChainId: number;
  destinationTxHash?: string | null;
  expectedRecipient: string;
  expectedToken: string;
  expectedMinAmountRaw: string | bigint;
  providerStatus?: string | null;
  providerFillTx?: string | null;
  preBridgeBalanceRaw?: string | bigint;
  receipt?: {
    status: number | string;
    blockNumber: number;
    gasUsed?: string | bigint;
    logs?: Array<{ address: string; topics: string[]; data: string }>;
  } | null;
  transaction?: {
    hash: string;
    from: string;
    to: string;
    chainId?: number | bigint;
  } | null;
  currentBalanceRaw?: string | bigint | null;
  localCacheStatus?: string | null;
}

export interface AuthoritativeDestinationVerificationResult {
  settlementStatus: DestinationSettlementStatus;
  primaryEvidenceTier: DestinationEvidenceTier | 'NONE';
  evidences: DestinationEvidenceItem[];
  actualDeliveredAmountRaw?: string;
  deliveredToExpectedRecipient: boolean;
  tokenMatched: boolean;
  revertReason?: string;
  conflictReason?: string;
  blockNumber?: number;
  gasUsed?: string;
  timestamp: number;
}

const ERC20_TRANSFER_EVENT = 'event Transfer(address indexed from, address indexed to, uint256 value)';

/**
 * Authoritative 6-Tier Destination Evidence Verifier
 * Enforces strict hierarchy where On-Chain Receipts and Mined Logs (Tiers 1-3)
 * strictly override Bridge Provider APIs and Local Caches (Tiers 5-6).
 */
export function verifyDestinationSettlement(
  params: AuthoritativeDestinationVerificationParams
): AuthoritativeDestinationVerificationResult {
  const evidences: DestinationEvidenceItem[] = [];
  const expectedRecipient = params.expectedRecipient.toLowerCase();
  const expectedToken = params.expectedToken.toLowerCase();
  const expectedMinAmount = BigInt(params.expectedMinAmountRaw.toString());
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
  if (params.transaction) {
    evidences.push({
      tier: 'TIER_2_ONCHAIN_TX_LOOKUP',
      priority: 2,
      verified: true,
      status: 'CONFIRMED',
      txHash: params.transaction.hash,
      details: {
        from: params.transaction.from,
        to: params.transaction.to,
        chainId: params.transaction.chainId?.toString()
      },
      timestamp: now
    });
  }

  // Tier 1: On-Chain Receipt
  let receiptConfirmed = false;
  let receiptReverted = false;
  let receiptBlockNumber: number | undefined;
  let receiptGasUsed: string | undefined;

  if (params.receipt) {
    const rawStatus = params.receipt.status;
    const isSuccess = rawStatus === 1 || rawStatus === '0x1' || rawStatus === '1';
    receiptConfirmed = isSuccess;
    receiptReverted = !isSuccess;
    receiptBlockNumber = params.receipt.blockNumber;
    receiptGasUsed = params.receipt.gasUsed?.toString();

    evidences.push({
      tier: 'TIER_1_ONCHAIN_RECEIPT',
      priority: 1,
      verified: true,
      status: isSuccess ? 'CONFIRMED' : 'REVERTED',
      txHash: params.destinationTxHash || params.transaction?.hash,
      blockNumber: receiptBlockNumber,
      details: { gasUsed: receiptGasUsed, rawStatus },
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

  // ==========================================
  // HIERARCHICAL SETTLEMENT EVALUATION
  // ==========================================

  // 1. Conflict: Receipt is Reverted, but Provider API claimed FILLED
  if (receiptReverted && providerStatus === 'filled') {
    return {
      settlementStatus: 'STATUS_CONFLICT',
      primaryEvidenceTier: 'TIER_1_ONCHAIN_RECEIPT',
      evidences,
      deliveredToExpectedRecipient: false,
      tokenMatched,
      conflictReason: `Across Provider API reported filled, but on-chain receipt in block ${receiptBlockNumber} was REVERTED.`,
      blockNumber: receiptBlockNumber,
      gasUsed: receiptGasUsed,
      timestamp: now
    };
  }

  // 2. Conflict: Receipt is Confirmed, but ERC20 Transfer was delivered to a different recipient
  if (receiptConfirmed && params.receipt?.logs && tokenMatched && !deliveredToExpectedRecipient) {
    return {
      settlementStatus: 'STATUS_CONFLICT',
      primaryEvidenceTier: 'TIER_3_ERC20_TRANSFER_EVENT',
      evidences,
      deliveredToExpectedRecipient: false,
      tokenMatched: true,
      conflictReason: `Destination transaction succeeded, but token transfer recipient did not match expected ${expectedRecipient}.`,
      blockNumber: receiptBlockNumber,
      gasUsed: receiptGasUsed,
      timestamp: now
    };
  }

  // 3. Reverted on-chain
  if (receiptReverted) {
    return {
      settlementStatus: 'DESTINATION_FAILED',
      primaryEvidenceTier: 'TIER_1_ONCHAIN_RECEIPT',
      evidences,
      deliveredToExpectedRecipient: false,
      tokenMatched,
      revertReason: `Destination transaction reverted on-chain in block ${receiptBlockNumber}.`,
      blockNumber: receiptBlockNumber,
      gasUsed: receiptGasUsed,
      timestamp: now
    };
  }

  // 4. Provider reported failure
  if (providerStatus === 'refunded' || providerStatus === 'expired') {
    return {
      settlementStatus: 'DESTINATION_FAILED',
      primaryEvidenceTier: 'TIER_5_PROVIDER_API',
      evidences,
      deliveredToExpectedRecipient: false,
      tokenMatched: false,
      revertReason: `Bridge order was ${providerStatus} by provider.`,
      timestamp: now
    };
  }

  // 5. Authoritative On-Chain Settlement
  // Requires on-chain receipt status 1 AND confirmed ERC-20 transfer to recipient
  if (receiptConfirmed && (transferFound || balanceDeltaConfirmed)) {
    return {
      settlementStatus: 'DESTINATION_SETTLED',
      primaryEvidenceTier: transferFound ? 'TIER_3_ERC20_TRANSFER_EVENT' : 'TIER_1_ONCHAIN_RECEIPT',
      evidences,
      actualDeliveredAmountRaw,
      deliveredToExpectedRecipient: true,
      tokenMatched: true,
      blockNumber: receiptBlockNumber,
      gasUsed: receiptGasUsed,
      timestamp: now
    };
  }

  // 6. Provider reports filled, but receipt is missing, pending, or unindexed
  if (providerStatus === 'filled' && !receiptConfirmed) {
    return {
      settlementStatus: 'DESTINATION_STATUS_UNCERTAIN',
      primaryEvidenceTier: 'TIER_5_PROVIDER_API',
      evidences,
      deliveredToExpectedRecipient,
      tokenMatched,
      conflictReason: `Provider reported filled with tx ${params.destinationTxHash || providerFillTx}, but on-chain receipt is pending or unconfirmed.`,
      timestamp: now
    };
  }

  // 7. Default: Uncertain / Pending
  return {
    settlementStatus: 'DESTINATION_STATUS_UNCERTAIN',
    primaryEvidenceTier: evidences.find(e => e.verified)?.tier || 'NONE',
    evidences,
    deliveredToExpectedRecipient,
    tokenMatched,
    timestamp: now
  };
}
