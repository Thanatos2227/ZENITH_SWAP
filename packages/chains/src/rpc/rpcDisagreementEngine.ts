import type {
  RpcDisagreementEvaluation
} from '@zenith/types';

export class RpcDisagreementEngine {
  /**
   * Evaluates chain ID responses from two providers.
   * Chain ID discrepancy is always an IDENTITY_CONFLICT.
   */
  public static evaluateChainId(
    primaryProviderId: string,
    primaryChainId: string | number,
    secondaryProviderId: string,
    secondaryChainId: string | number
  ): RpcDisagreementEvaluation {
    const pStr = String(primaryChainId).toLowerCase().trim();
    const sStr = String(secondaryChainId).toLowerCase().trim();

    if (pStr === sStr) {
      return {
        level: 'AGREEMENT',
        method: 'eth_chainId',
        primaryProviderId,
        secondaryProviderId,
        primaryValue: primaryChainId,
        secondaryValue: secondaryChainId,
        reason: 'Chain IDs match identically',
        timestamp: Date.now()
      };
    }

    return {
      level: 'IDENTITY_CONFLICT',
      method: 'eth_chainId',
      primaryProviderId,
      secondaryProviderId,
      primaryValue: primaryChainId,
      secondaryValue: secondaryChainId,
      reason: `Chain ID conflict: ${primaryProviderId} returned ${primaryChainId}, but ${secondaryProviderId} returned ${secondaryChainId}`,
      timestamp: Date.now()
    };
  }

  /**
   * Evaluates block numbers from two providers.
   * Tracks lag and state context uncertainty.
   */
  public static evaluateBlockNumber(
    primaryProviderId: string,
    primaryBlock: number,
    secondaryProviderId: string,
    secondaryBlock: number,
    maxAllowedLag: number = 3
  ): RpcDisagreementEvaluation {
    const diff = Math.abs(primaryBlock - secondaryBlock);

    if (diff === 0) {
      return {
        level: 'AGREEMENT',
        method: 'eth_blockNumber',
        primaryProviderId,
        secondaryProviderId,
        primaryValue: primaryBlock,
        secondaryValue: secondaryBlock,
        reason: 'Block numbers match identically',
        timestamp: Date.now()
      };
    }

    if (diff <= maxAllowedLag) {
      return {
        level: 'EXPECTED_VARIANCE',
        method: 'eth_blockNumber',
        primaryProviderId,
        secondaryProviderId,
        primaryValue: primaryBlock,
        secondaryValue: secondaryBlock,
        stateContextUncertain: diff > 1,
        reason: `Minor block progression variance of ${diff} blocks within tolerance ${maxAllowedLag}`,
        timestamp: Date.now()
      };
    }

    return {
      level: 'MATERIAL_DISAGREEMENT',
      method: 'eth_blockNumber',
      primaryProviderId,
      secondaryProviderId,
      primaryValue: primaryBlock,
      secondaryValue: secondaryBlock,
      stateContextUncertain: true,
      reason: `Major head discrepancy: ${primaryProviderId} at ${primaryBlock}, ${secondaryProviderId} at ${secondaryBlock} (diff: ${diff} > ${maxAllowedLag})`,
      timestamp: Date.now()
    };
  }

  /**
   * Evaluates preflight / eth_call simulation results across two providers.
   */
  public static evaluateSimulationResult(
    primaryProviderId: string,
    primaryResult: { success: boolean; data?: string; error?: string; blockNumber?: number },
    secondaryProviderId: string,
    secondaryResult: { success: boolean; data?: string; error?: string; blockNumber?: number }
  ): RpcDisagreementEvaluation {
    const blockDiff = (primaryResult.blockNumber !== undefined && secondaryResult.blockNumber !== undefined)
      ? Math.abs(primaryResult.blockNumber - secondaryResult.blockNumber)
      : 0;
    const isStateContextUncertain = blockDiff > 1;

    // One succeeded, one reverted
    if (primaryResult.success !== secondaryResult.success) {
      return {
        level: 'MATERIAL_DISAGREEMENT',
        method: 'eth_call',
        primaryProviderId,
        secondaryProviderId,
        primaryValue: primaryResult,
        secondaryValue: secondaryResult,
        stateContextUncertain: isStateContextUncertain,
        reason: `Simulation outcome conflict: ${primaryProviderId} success=${primaryResult.success}, ${secondaryProviderId} success=${secondaryResult.success}`,
        timestamp: Date.now()
      };
    }

    // Both succeeded, compare return data
    if (primaryResult.success) {
      const pData = (primaryResult.data || '').toLowerCase();
      const sData = (secondaryResult.data || '').toLowerCase();
      if (pData === sData) {
        return {
          level: 'AGREEMENT',
          method: 'eth_call',
          primaryProviderId,
          secondaryProviderId,
          primaryValue: primaryResult.data,
          secondaryValue: secondaryResult.data,
          stateContextUncertain: isStateContextUncertain,
          reason: 'Simulation return data matches byte-for-byte',
          timestamp: Date.now()
        };
      }
      return {
        level: 'MATERIAL_DISAGREEMENT',
        method: 'eth_call',
        primaryProviderId,
        secondaryProviderId,
        primaryValue: primaryResult.data,
        secondaryValue: secondaryResult.data,
        stateContextUncertain: isStateContextUncertain,
        reason: 'Simulation return data differs between providers',
        timestamp: Date.now()
      };
    }

    // Both reverted, compare error messages
    if (primaryResult.error === secondaryResult.error) {
      return {
        level: 'AGREEMENT',
        method: 'eth_call',
        primaryProviderId,
        secondaryProviderId,
        primaryValue: primaryResult.error,
        secondaryValue: secondaryResult.error,
        stateContextUncertain: isStateContextUncertain,
        reason: 'Both providers reverted with matching error',
        timestamp: Date.now()
      };
    }

    return {
      level: 'EXPECTED_VARIANCE',
      method: 'eth_call',
      primaryProviderId,
      secondaryProviderId,
      primaryValue: primaryResult.error,
      secondaryValue: secondaryResult.error,
      stateContextUncertain: isStateContextUncertain,
      reason: 'Both providers reverted but with varying error message formats',
      timestamp: Date.now()
    };
  }

  /**
   * Evaluates gas estimates from two providers.
   * Small variances (<15%) are expected, large variances (>30%) are material disagreements.
   */
  public static evaluateGasEstimate(
    primaryProviderId: string,
    primaryGas: bigint | number,
    secondaryProviderId: string,
    secondaryGas: bigint | number,
    maxVariancePercent: number = 20
  ): RpcDisagreementEvaluation {
    const p = BigInt(primaryGas);
    const s = BigInt(secondaryGas);

    if (p === s) {
      return {
        level: 'AGREEMENT',
        method: 'eth_estimateGas',
        primaryProviderId,
        secondaryProviderId,
        primaryValue: p.toString(),
        secondaryValue: s.toString(),
        reason: 'Gas estimates match identically',
        timestamp: Date.now()
      };
    }

    const min = p < s ? p : s;
    const max = p > s ? p : s;
    const diff = max - min;
    const percentDiff = min > 0n ? Number((diff * 100n) / min) : 100;

    if (percentDiff <= maxVariancePercent) {
      return {
        level: 'EXPECTED_VARIANCE',
        method: 'eth_estimateGas',
        primaryProviderId,
        secondaryProviderId,
        primaryValue: p.toString(),
        secondaryValue: s.toString(),
        reason: `Gas estimate variance of ${percentDiff}% is within acceptable tolerance of ${maxVariancePercent}%`,
        timestamp: Date.now()
      };
    }

    return {
      level: 'MATERIAL_DISAGREEMENT',
      method: 'eth_estimateGas',
      primaryProviderId,
      secondaryProviderId,
      primaryValue: p.toString(),
      secondaryValue: s.toString(),
      reason: `Gas estimate discrepancy of ${percentDiff}% exceeds safety tolerance of ${maxVariancePercent}%`,
      timestamp: Date.now()
    };
  }

  /**
   * Evaluates transaction receipts.
   * Conflicting receipts (e.g. status 1 vs 0, different block hash) are material disagreements.
   */
  public static evaluateReceipt(
    primaryProviderId: string,
    primaryReceipt: { status: number; blockHash?: string; blockNumber?: number } | null,
    secondaryProviderId: string,
    secondaryReceipt: { status: number; blockHash?: string; blockNumber?: number } | null
  ): RpcDisagreementEvaluation {
    if (!primaryReceipt && !secondaryReceipt) {
      return {
        level: 'AGREEMENT',
        method: 'eth_getTransactionReceipt',
        primaryProviderId,
        secondaryProviderId,
        primaryValue: null,
        secondaryValue: null,
        reason: 'Both providers report receipt pending/not found',
        timestamp: Date.now()
      };
    }

    if (!primaryReceipt || !secondaryReceipt) {
      return {
        level: 'EXPECTED_VARIANCE',
        method: 'eth_getTransactionReceipt',
        primaryProviderId,
        secondaryProviderId,
        primaryValue: primaryReceipt ? 'FOUND' : 'NULL',
        secondaryValue: secondaryReceipt ? 'FOUND' : 'NULL',
        reason: 'One provider returned receipt while the other is slightly lagging behind',
        timestamp: Date.now()
      };
    }

    if (primaryReceipt.status !== secondaryReceipt.status) {
      return {
        level: 'MATERIAL_DISAGREEMENT',
        method: 'eth_getTransactionReceipt',
        primaryProviderId,
        secondaryProviderId,
        primaryValue: primaryReceipt.status,
        secondaryValue: secondaryReceipt.status,
        reason: `Receipt execution status conflict: ${primaryProviderId} reported status ${primaryReceipt.status}, ${secondaryProviderId} reported status ${secondaryReceipt.status}`,
        timestamp: Date.now()
      };
    }

    if (primaryReceipt.blockHash && secondaryReceipt.blockHash && primaryReceipt.blockHash !== secondaryReceipt.blockHash) {
      return {
        level: 'MATERIAL_DISAGREEMENT',
        method: 'eth_getTransactionReceipt',
        primaryProviderId,
        secondaryProviderId,
        primaryValue: primaryReceipt.blockHash,
        secondaryValue: secondaryReceipt.blockHash,
        reason: 'Receipt mined in conflicting block hashes (potential chain split/reorg)',
        timestamp: Date.now()
      };
    }

    return {
      level: 'AGREEMENT',
      method: 'eth_getTransactionReceipt',
      primaryProviderId,
      secondaryProviderId,
      primaryValue: primaryReceipt,
      secondaryValue: secondaryReceipt,
      reason: 'Receipts match consistently across providers',
      timestamp: Date.now()
    };
  }
}
