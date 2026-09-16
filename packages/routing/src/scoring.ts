import { PriceImpact, ProtocolFee, Token } from '@zenith/types';
import { MAX_SWAP_AMOUNT_NUM } from './amountValidation';
import { isZenithTreasuryConfigured, getZenithTreasury } from '@zenith/contracts';

export interface ZenithFeePolicy {
  sameChainProtocolFeeBps: number;
  crossChainProtocolFeeBps: number;
  stableSwapFeeBps: number;
  largeTradeDiscountBps?: number;
  volumeDiscountBps?: number;
}

export const DEFAULT_FEE_POLICY: ZenithFeePolicy = {
  sameChainProtocolFeeBps: 5,
  crossChainProtocolFeeBps: 10,
  stableSwapFeeBps: 2,
  largeTradeDiscountBps: 2,
  volumeDiscountBps: 1
};

export class ScoringService {
  private feePolicy: ZenithFeePolicy;

  constructor(feePolicy: ZenithFeePolicy = DEFAULT_FEE_POLICY) {
    this.feePolicy = feePolicy;
  }

  public setFeePolicy(policy: ZenithFeePolicy): void {
    this.feePolicy = { ...policy };
  }

  public getFeePolicy(): ZenithFeePolicy {
    return { ...this.feePolicy };
  }

  public calculatePriceImpact(params: {
    tokenIn: Token;
    tokenOut: Token;
    amountInNum: number;
    amountOutExpectedNum: number;
    referencePrice?: number;
    feeBpsTotal?: number;
    directPriceImpact?: number;
  }): PriceImpact {
    if (params.directPriceImpact !== undefined && !isNaN(params.directPriceImpact) && isFinite(params.directPriceImpact)) {
      const percentage = Number(Math.min(100, Math.max(0, params.directPriceImpact)).toFixed(3));
      return this.formatPriceImpactResponse(percentage);
    }

    if (params.amountInNum <= 0 || params.amountOutExpectedNum <= 0) {
      return { percentage: 0, level: 'NEGLIGIBLE' };
    }

    let refPrice = params.referencePrice;
    if (!refPrice || refPrice <= 0) {
      if (params.tokenIn.priceUSD && params.tokenOut.priceUSD && params.tokenIn.priceUSD > 0 && params.tokenOut.priceUSD > 0) {
        refPrice = params.tokenIn.priceUSD / params.tokenOut.priceUSD;
      }
    }

    if (!refPrice || refPrice <= 0 || isNaN(refPrice) || !isFinite(refPrice)) {
      return { percentage: 0, level: 'NEGLIGIBLE' };
    }

    const feeBps = Math.max(0, params.feeBpsTotal ?? 0);
    const netAmountInSwapped = params.amountInNum * (1 - feeBps / 10000);

    if (netAmountInSwapped <= 0) {
      return { percentage: 0, level: 'NEGLIGIBLE' };
    }

    const executionPrice = params.amountOutExpectedNum / netAmountInSwapped;

    if (executionPrice <= 0 || isNaN(executionPrice) || !isFinite(executionPrice)) {
      return { percentage: 0, level: 'NEGLIGIBLE' };
    }

    const rawImpact = Math.max(0, (1 - (executionPrice / refPrice)) * 100);
    const percentage = Number(Math.min(100, isNaN(rawImpact) || !isFinite(rawImpact) ? 0 : rawImpact).toFixed(3));

    return this.formatPriceImpactResponse(percentage);
  }

  private formatPriceImpactResponse(percentage: number): PriceImpact {
    let level: 'NEGLIGIBLE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'NEGLIGIBLE';
    let warningMessage: string | undefined;

    if (percentage > 5.0) {
      level = 'CRITICAL';
      warningMessage = `Critical Price Impact (${percentage}%). You will lose a significant portion of value.`;
    } else if (percentage > 2.0) {
      level = 'HIGH';
      warningMessage = `High Price Impact (${percentage}%). Consider trading a smaller amount or splitting your trade.`;
    } else if (percentage > 0.5) {
      level = 'MEDIUM';
      warningMessage = `Moderate Price Impact (${percentage}%).`;
    } else if (percentage > 0.1) {
      level = 'LOW';
    }

    return { percentage, level, warningMessage };
  }

  public calculateProtocolFee(params: {
    tokenIn: Token;
    amountInRaw: string;
    amountInNum: number;
    chainId?: string | number;
    isCrossChain?: boolean;
    isStableSwap?: boolean;
    feePolicy?: ZenithFeePolicy;
  }): ProtocolFee {
    if (params.amountInNum > MAX_SWAP_AMOUNT_NUM) {
      throw new Error(`Amount (${params.amountInNum.toLocaleString()}) exceeds maximum allowed limit of ${MAX_SWAP_AMOUNT_NUM.toLocaleString()}`);
    }

    const policy = params.feePolicy || this.feePolicy;
    let feeBps = params.isCrossChain
      ? policy.crossChainProtocolFeeBps
      : (params.isStableSwap ? policy.stableSwapFeeBps : policy.sameChainProtocolFeeBps);

    const tradeValueUSD = params.tokenIn.priceUSD ? params.amountInNum * params.tokenIn.priceUSD : 0;
    if (tradeValueUSD > 100000 && policy.largeTradeDiscountBps) {
      feeBps = Math.max(1, feeBps - policy.largeTradeDiscountBps);
    }

    const rawBigInt = BigInt(params.amountInRaw);
    const feeAmountRaw = ((rawBigInt * BigInt(feeBps)) / 10000n).toString();
    const feeAmountNum = (params.amountInNum * feeBps) / 10000;
    const feeUSD = params.tokenIn.priceUSD ? feeAmountNum * params.tokenIn.priceUSD : 0;

    const chainKey = params.chainId || params.tokenIn.chainId;
    let treasuryRecipient: string | undefined = undefined;
    if (chainKey && isZenithTreasuryConfigured(chainKey)) {
      try {
        treasuryRecipient = getZenithTreasury(chainKey);
      } catch {
        treasuryRecipient = undefined;
      }
    }

    return {
      feeBps,
      feeAmountRaw,
      feeAmountFormatted: feeAmountNum.toLocaleString(undefined, { maximumFractionDigits: 6 }),
      feeUSD: Number(feeUSD.toFixed(4)),
      treasuryRecipient
    };
  }

  public calculateEffectiveExecutionScore(params: {
    priceImpactPercent: number;
    gasCostUSD: number;
    tradeValueUSD: number;
    slippagePercent: number;
    hasBridgeStep: boolean;
  }): number {
    let score = 100;

    score -= params.priceImpactPercent * 8;

    if (params.tradeValueUSD > 0) {
      const gasRatio = (params.gasCostUSD / params.tradeValueUSD) * 100;
      if (gasRatio > 5) score -= (gasRatio - 5) * 4;
      else if (gasRatio > 1) score -= gasRatio * 2;
    }

    if (params.slippagePercent > 1.0) {
      score -= (params.slippagePercent - 1.0) * 5;
    }

    if (params.hasBridgeStep) {
      score -= 3;
    }

    return Math.max(10, Math.min(100, Math.round(score)));
  }

  public calculateMinimumReceived(
    amountOutRaw: string,
    slippageTolerancePercent: number
  ): string {
    const rawBig = BigInt(amountOutRaw);
    const slippageBps = BigInt(Math.round(slippageTolerancePercent * 100));
    const minReceivedBig = (rawBig * (10000n - slippageBps)) / 10000n;
    return minReceivedBig.toString();
  }

  public calculateMaximumInput(
    amountInRaw: string,
    slippageTolerancePercent: number
  ): string {
    const rawBig = BigInt(amountInRaw);
    const slippageBps = BigInt(Math.round(slippageTolerancePercent * 100));
    const maxInputBig = (rawBig * (10000n + slippageBps)) / 10000n;
    return maxInputBig.toString();
  }
}

export const defaultScoringService = new ScoringService();

export function calculateEffectiveExecutionScore(params: {
  priceImpactPercent: number;
  gasCostUSD: number;
  tradeValueUSD: number;
  slippagePercent: number;
  hasBridgeStep: boolean;
}): number {
  return defaultScoringService.calculateEffectiveExecutionScore(params);
}
