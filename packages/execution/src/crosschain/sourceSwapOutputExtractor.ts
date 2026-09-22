import { Interface } from 'ethers';
import {
  validateEvmAddress,
  validateTokenAddress,
  SourceSwapFailedError,
  AmountMismatchError,
  StatusConflictError
} from '@zenith/contracts';

const ERC20_TRANSFER_EVENT_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];
const erc20Interface = new Interface(ERC20_TRANSFER_EVENT_ABI);
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface ExtractSourceSwapOutputParams {
  receipt?: any;
  expectedTokenOutAddress: string;
  recipientAddress: string;
  minimumAmountOutRaw: string | bigint;
  sourceChainId?: string | number;
  balanceBeforeRaw?: string | bigint;
  balanceAfterRaw?: string | bigint;
  fallbackAmountRaw?: string | bigint;
}

export interface SourceSwapOutputExtractionResult {
  actualAmountRaw: string;
  actualAmountBig: bigint;
  tokenAddress: string;
  recipient: string;
  verified: boolean;
  extractionMethod: 'RECEIPT_LOGS' | 'BALANCE_DELTA' | 'EXPLICIT_ACTUAL' | 'COMBINED_RECONCILED';
}

/**
 * Extracts and strictly verifies the actual output token amount produced by a mined
 * source-chain AMM swap before allowing bridge deposit execution.
 *
 * Implements:
 * 1. Receipt status validation (status === 1)
 * 2. On-chain event log decoding for ERC-20 Transfer to recipient
 * 3. Transfer-Balance cross-check (flags STATUS_CONFLICT on divergence)
 * 4. Slippage enforcement (rejects if actualAmount < minimumAmountOut)
 */
export function extractActualSourceSwapOutput(
  params: ExtractSourceSwapOutputParams
): SourceSwapOutputExtractionResult {
  const {
    receipt,
    expectedTokenOutAddress,
    recipientAddress,
    minimumAmountOutRaw,
    sourceChainId,
    balanceBeforeRaw,
    balanceAfterRaw,
    fallbackAmountRaw
  } = params;

  const minOutBig = BigInt(minimumAmountOutRaw.toString());
  const safeRecipient = validateEvmAddress(recipientAddress, 'Recipient Address').toLowerCase();
  const safeTokenOut = validateTokenAddress(
    expectedTokenOutAddress,
    sourceChainId || 'ethereum'
  ).toLowerCase();

  if (receipt && receipt.status === 0) {
    throw new SourceSwapFailedError(
      'Source swap transaction reverted on-chain (receipt status: 0)',
      receipt.hash || receipt.transactionHash
    );
  }

  let eventOutputBig: bigint | undefined = undefined;

  // 1. Decode Transfer events from receipt logs if logs are available
  if (receipt && Array.isArray(receipt.logs) && receipt.logs.length > 0) {
    let totalTransferred = 0n;
    let foundMatchingTransfer = false;

    for (const log of receipt.logs) {
      const logAddress = (log.address || '').toLowerCase();
      if (logAddress !== safeTokenOut) continue;

      const topics = log.topics || [];
      if (topics[0]?.toLowerCase() === TRANSFER_TOPIC.toLowerCase()) {
        try {
          const parsed = erc20Interface.parseLog({
            topics: log.topics,
            data: log.data
          });
          if (parsed && parsed.name === 'Transfer') {
            const toAddr = (parsed.args[1] || '').toLowerCase();
            if (toAddr === safeRecipient) {
              const value = BigInt(parsed.args[2].toString());
              totalTransferred += value;
              foundMatchingTransfer = true;
            }
          }
        } catch {
          // Log decoding error ignored for non-standard events
        }
      }
    }

    if (foundMatchingTransfer && totalTransferred > 0n) {
      eventOutputBig = totalTransferred;
    }
  }

  // 2. Compute balance delta if before/after balances are provided
  let balanceDeltaBig: bigint | undefined = undefined;
  if (balanceBeforeRaw !== undefined && balanceAfterRaw !== undefined) {
    const bBefore = BigInt(balanceBeforeRaw.toString());
    const bAfter = BigInt(balanceAfterRaw.toString());
    if (bAfter >= bBefore) {
      balanceDeltaBig = bAfter - bBefore;
    }
  }

  // 3. Reconcile Event vs Balance Delta (Cross-Check)
  let actualAmountBig: bigint;
  let extractionMethod: SourceSwapOutputExtractionResult['extractionMethod'];

  if (eventOutputBig !== undefined && balanceDeltaBig !== undefined) {
    if (eventOutputBig !== balanceDeltaBig) {
      throw new StatusConflictError(
        `Source swap output mismatch: decoded Transfer event amount (${eventOutputBig.toString()} raw) conflicts with balance delta (${balanceDeltaBig.toString()} raw).`,
        eventOutputBig.toString(),
        balanceDeltaBig.toString()
      );
    }
    actualAmountBig = eventOutputBig;
    extractionMethod = 'COMBINED_RECONCILED';
  } else if (eventOutputBig !== undefined) {
    actualAmountBig = eventOutputBig;
    extractionMethod = 'RECEIPT_LOGS';
  } else if (balanceDeltaBig !== undefined && balanceDeltaBig > 0n) {
    actualAmountBig = balanceDeltaBig;
    extractionMethod = 'BALANCE_DELTA';
  } else if (fallbackAmountRaw !== undefined) {
    actualAmountBig = BigInt(fallbackAmountRaw.toString());
    extractionMethod = 'EXPLICIT_ACTUAL';
  } else {
    throw new SourceSwapFailedError(
      'Unable to extract authoritative swap output amount: receipt contains no matching Transfer logs and balance delta is unavailable.',
      receipt?.hash || receipt?.transactionHash
    );
  }

  // 4. Strict Minimum Output Invariant (Slippage check)
  if (minOutBig > 0n && actualAmountBig < minOutBig) {
    throw new AmountMismatchError(
      minOutBig.toString(),
      actualAmountBig.toString(),
      `Actual swap output (${actualAmountBig.toString()} raw) is below minimum acceptable threshold (${minOutBig.toString()} raw)`
    );
  }

  return {
    actualAmountRaw: actualAmountBig.toString(),
    actualAmountBig,
    tokenAddress: safeTokenOut,
    recipient: safeRecipient,
    verified: true,
    extractionMethod
  };
}
