import { Interface } from 'ethers';
import { ZERO_ADDRESS } from '@zenith/contracts';
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
    priority: number;
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
        logs?: Array<{
            address: string;
            topics: string[];
            data: string;
        }>;
    } | null;
    transaction?: {
        hash: string;
        from: string;
        to: string;
        value?: string | bigint;
        data?: string;
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

function isNativeTokenIdentifier(token: string): boolean {
    const norm = (token || '').toLowerCase();
    return (
        norm === '' ||
        norm === ZERO_ADDRESS.toLowerCase() ||
        norm === '0x0' ||
        norm === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ||
        norm === 'eth' ||
        norm === 'pol' ||
        norm === 'matic' ||
        norm === 'avax' ||
        norm === 'bnb' ||
        norm === 'native'
    );
}

export function verifyDestinationSettlement(
    params: AuthoritativeDestinationVerificationParams
): AuthoritativeDestinationVerificationResult {
    const evidences: DestinationEvidenceItem[] = [];
    const expectedRecipient = (params.expectedRecipient || '').toLowerCase();
    const expectedToken = (params.expectedToken || '').toLowerCase();
    const expectedMinAmount = BigInt((params.expectedMinAmountRaw || '0').toString());
    const isNative = isNativeTokenIdentifier(expectedToken);
    const now = Date.now();

    // 1. Diagnostic Evidence (Tier 6: Local Cache)
    if (params.localCacheStatus) {
        evidences.push({
            tier: 'TIER_6_LOCAL_CACHE',
            priority: 6,
            verified: false,
            status: params.localCacheStatus === 'SETTLED' ? 'CONFIRMED' : 'PENDING',
            details: { localCacheStatus: params.localCacheStatus, note: 'Diagnostic only; cannot establish finality' },
            timestamp: now
        });
    }

    // 2. Secondary Diagnostic Evidence (Tier 5: Provider API)
    const providerStatus = (params.providerStatus || '').toLowerCase();
    const providerFillTx = params.providerFillTx;
    if (providerStatus) {
        const isFilled = providerStatus === 'filled';
        const isFailed = providerStatus === 'refunded' || providerStatus === 'expired';
        evidences.push({
            tier: 'TIER_5_PROVIDER_API',
            priority: 5,
            verified: isFilled || isFailed,
            status: isFilled ? 'CONFIRMED' : (isFailed ? 'REVERTED' : 'PENDING'),
            txHash: providerFillTx,
            details: { providerStatus, providerFillTx },
            timestamp: now
        });
    }

    // 3. On-chain Transaction Lookup (Tier 2)
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
            const txTo = params.transaction.to.toLowerCase();
            const expTarget = params.expectedSpokePoolOrTarget.toLowerCase();
            if (txTo !== expTarget && txTo !== expectedRecipient) {
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
                value: params.transaction.value?.toString(),
                chainId: params.transaction.chainId?.toString(),
                txChainMismatch,
                txTargetMismatch
            },
            timestamp: now
        });
    }

    // 4. Primary On-chain Receipt Verification (Tier 1)
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

        if (params.expectedBlockHash && receiptBlockHash) {
            if (params.expectedBlockHash.toLowerCase() !== receiptBlockHash.toLowerCase()) {
                reorgDetected = true;
                reorgReason = `Reorg detected: expected block hash ${params.expectedBlockHash}, got ${receiptBlockHash}`;
            }
        }

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

    // 5. Transfer & Execution Semantics Verification (Tier 3 & Native)
    let transferFound = false;
    let tokenMatched = isNative;
    let deliveredToExpectedRecipient = false;
    let actualDeliveredAmountRaw = '0';
    let transferMismatchReason: string | undefined;

    if (isNative) {
        // Native asset transfer validation
        if (params.transaction && params.transaction.to && params.transaction.to.toLowerCase() === expectedRecipient) {
            deliveredToExpectedRecipient = true;
            tokenMatched = true;
            const nativeVal = BigInt(params.transaction.value?.toString() || '0');
            actualDeliveredAmountRaw = nativeVal.toString();
            if (nativeVal >= expectedMinAmount) {
                transferFound = true;
            } else {
                transferMismatchReason = `Native transfer value ${nativeVal.toString()} is below expected minimum ${expectedMinAmount.toString()}`;
            }
        }
    } else if (params.receipt?.logs && Array.isArray(params.receipt.logs)) {
        // ERC20 Transfer log validation with event aggregation
        const erc20Iface = new Interface([ERC20_TRANSFER_EVENT]);
        let totalRecipientAmount = 0n;

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
                            totalRecipientAmount += transferVal;
                        }
                    }
                } catch {
                    // Ignore non-transfer logs
                }
            }
        }

        if (deliveredToExpectedRecipient) {
            actualDeliveredAmountRaw = totalRecipientAmount.toString();
            if (totalRecipientAmount >= expectedMinAmount) {
                transferFound = true;
            } else {
                transferMismatchReason = `Delivered amount ${totalRecipientAmount.toString()} below minimum expected ${expectedMinAmount.toString()}`;
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

    // 6. Balance Delta Verification (Tier 4: Provenance-Guarded)
    let balanceDeltaConfirmed = false;
    if (params.currentBalanceRaw !== undefined && params.currentBalanceRaw !== null) {
        if (params.preBridgeBalanceRaw !== undefined && params.preBridgeBalanceRaw !== null) {
            const currentBal = BigInt(params.currentBalanceRaw.toString());
            const preBal = BigInt(params.preBridgeBalanceRaw.toString());
            const delta = currentBal - preBal;
            balanceDeltaConfirmed = delta >= expectedMinAmount;
            if (balanceDeltaConfirmed) {
                tokenMatched = true;
                deliveredToExpectedRecipient = true;
                if (!transferFound) {
                    actualDeliveredAmountRaw = delta.toString();
                }
            }
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
        } else {
            // Provenance violation: missing pre-bridge balance baseline
            evidences.push({
                tier: 'TIER_4_RECIPIENT_BALANCE_DELTA',
                priority: 4,
                verified: false,
                status: 'UNAVAILABLE',
                details: {
                    reason: 'Pre-bridge balance not provided; cannot establish provenance of balance delta'
                },
                timestamp: now
            });
        }
    }

    const finalizeResult = (
        res: AuthoritativeDestinationVerificationResult
    ): AuthoritativeDestinationVerificationResult => {
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
            verificationResult:
                res.settlementStatus === 'DESTINATION_SETTLED'
                    ? 'SETTLED'
                    : res.settlementStatus === 'STATUS_CONFLICT'
                    ? 'CONFLICT'
                    : res.settlementStatus === 'REORG_DETECTED'
                    ? 'REORG_DETECTED'
                    : res.settlementStatus === 'DESTINATION_FAILED'
                    ? 'FAILED'
                    : 'PENDING',
            reorgDetected: res.reorgDetected,
            conflictReason: res.conflictReason || res.revertReason
        });
        return res;
    };

    // Rule 1: Reorganization Invalidation
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

    // Rule 2: Destination Chain Mismatch
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

    // Rule 3: Destination Target Mismatch
    if (txTargetMismatch) {
        return finalizeResult({
            settlementStatus: 'STATUS_CONFLICT',
            primaryEvidenceTier: 'TIER_2_ONCHAIN_TX_LOOKUP',
            evidences,
            deliveredToExpectedRecipient: false,
            tokenMatched: false,
            conflictReason: `Transaction destination target ${params.transaction?.to} does not match authorized target ${params.expectedSpokePoolOrTarget}.`,
            timestamp: now
        });
    }

    // Rule 4: Provider Claim vs Reverted On-chain Receipt Conflict
    if (receiptReverted && providerStatus === 'filled') {
        const providerLabel =
            params.bridgeProvider && params.bridgeProvider.toLowerCase() !== 'across'
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

    // Rule 5: Recipient Mismatch on Succeeded Transaction
    if (receiptConfirmed && params.receipt?.logs && tokenMatched && !deliveredToExpectedRecipient && !isNative) {
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

    // Rule 6: Output Below Minimum on Succeeded Transaction
    if (
        receiptConfirmed &&
        params.receipt?.logs &&
        params.receipt.logs.length > 0 &&
        tokenMatched &&
        deliveredToExpectedRecipient &&
        !transferFound &&
        !balanceDeltaConfirmed &&
        providerStatus === 'filled'
    ) {
        return finalizeResult({
            settlementStatus: 'STATUS_CONFLICT',
            primaryEvidenceTier: 'TIER_3_ERC20_TRANSFER_EVENT',
            evidences,
            deliveredToExpectedRecipient: true,
            tokenMatched: true,
            actualDeliveredAmountRaw,
            conflictReason:
                transferMismatchReason ||
                `Delivered amount ${actualDeliveredAmountRaw} is below expected minimum ${expectedMinAmount.toString()}.`,
            blockNumber: receiptBlockNumber,
            blockHash: receiptBlockHash,
            gasUsed: receiptGasUsed,
            timestamp: now
        });
    }

    // Rule 7: Pure Reverted Receipt
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

    // Rule 8: Provider Explicit Failure / Refund
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

    // Rule 9: Authoritative On-chain Settlement (Receipt + Transfer/Native/Delta Evidence)
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
            primaryEvidenceTier: transferFound
                ? isNative
                    ? 'TIER_1_ONCHAIN_RECEIPT'
                    : 'TIER_3_ERC20_TRANSFER_EVENT'
                : 'TIER_4_RECIPIENT_BALANCE_DELTA',
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

    // Rule 10: Provider API Filled Without Verified Receipt
    if (providerStatus === 'filled' && !receiptConfirmed) {
        return finalizeResult({
            settlementStatus: 'DESTINATION_STATUS_UNCERTAIN',
            primaryEvidenceTier: 'TIER_5_PROVIDER_API',
            evidences,
            deliveredToExpectedRecipient,
            tokenMatched,
            conflictReason: `Provider reported filled with tx ${
                params.destinationTxHash || providerFillTx
            }, but on-chain receipt is pending or unconfirmed.`,
            timestamp: now
        });
    }

    // Default: Fail-Closed Uncertain
    return finalizeResult({
        settlementStatus: 'DESTINATION_STATUS_UNCERTAIN',
        primaryEvidenceTier: evidences.find((e) => e.verified)?.tier || 'NONE',
        evidences,
        deliveredToExpectedRecipient,
        tokenMatched,
        actualDeliveredAmountRaw,
        conflictReason: transferMismatchReason,
        timestamp: now
    });
}

