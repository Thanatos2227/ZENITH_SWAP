import { Interface, AbiCoder } from 'ethers';
import {
  BridgeProtocol,
  CrossChainExecution,
  CrossChainProvider,
  CrossChainQuote,
  CrossChainStatus,
  ExecutionPlanDiagnostic,
  QuoteRequest,
  Token
} from '@zenith/types';
import { defaultChainRegistry } from '@zenith/chains';
import {
  getStargateRouter,
  isStargateSupported,
  STARGATE_ROUTER_ABI,
  validateEvmAddress,
  validateTokenAddress,
  validateRecipientAddress,
  validateExecutionTarget,
  ProviderUnavailableError
} from '@zenith/contracts';
import { isNativeToken, scaleTokenUnits } from '../../dex/dexMath';
import { validateCrossChainQuoteExecutability } from '../quoteValidator';
import { defaultQuoteDiagnosticLogger } from '../quoteDiagnostics';

const stargateInterface = new Interface(STARGATE_ROUTER_ABI);

const STARGATE_POOL_IDS: Record<string, number> = {
  USDC: 1,
  USDT: 2,
  DAI: 3,
  ETH: 13,
  WETH: 13
};

const LZ_CHAIN_IDS: Record<number, number> = {
  1: 101,
  56: 102,
  43114: 106,
  137: 109,
  42161: 110,
  10: 111,
  8453: 184,
  59144: 183,
  534352: 214
};

export class StargateProvider implements CrossChainProvider {
  public readonly id: BridgeProtocol = 'STARGATE';
  public readonly name = 'Stargate V2 (LayerZero)';

  public isAvailable(
    sourceChainId?: string,
    destinationChainId?: string,
    tokenIn?: Token,
    tokenOut?: Token
  ): boolean {
    if (!sourceChainId || !destinationChainId) return false;
    if (sourceChainId.toLowerCase() === destinationChainId.toLowerCase()) return false;
    const src = defaultChainRegistry.getChain(sourceChainId);
    const dst = defaultChainRegistry.getChain(destinationChainId);

    if (!src?.chainId || !dst?.chainId) return false;
    if (src.executionEnvironment !== 'EVM' || dst.executionEnvironment !== 'EVM') return false;

    if (!isStargateSupported(src.chainId) || !isStargateSupported(dst.chainId)) return false;

    if (tokenIn && tokenOut) {
      const symIn = (tokenIn.symbol || '').toUpperCase().replace(/^W/, '');
      const symOut = (tokenOut.symbol || '').toUpperCase().replace(/^W/, '');
      const poolIn = STARGATE_POOL_IDS[symIn] || (symIn === 'USDC' ? 1 : undefined);
      const poolOut = STARGATE_POOL_IDS[symOut] || (symOut === 'USDC' ? 1 : undefined);

      if (!poolIn || !poolOut) return false;

      if (poolIn !== poolOut && !(symIn.startsWith('USD') && symOut.startsWith('USD'))) return false;
    }

    return true;
  }

  public async getQuote(request: QuoteRequest): Promise<CrossChainQuote | null> {
    const sourceChainId = request.sourceChainId || (request as any).srcChainId;
    const destinationChainId = request.destinationChainId || (request as any).destChainId;
    const recipient = request.recipientAddress || (request as any).recipient || request.userWalletAddress;

    if (!this.isAvailable(sourceChainId, destinationChainId, request.tokenIn, request.tokenOut)) {
      return null;
    }

    const srcChain = defaultChainRegistry.getChain(sourceChainId)!;
    const dstChain = defaultChainRegistry.getChain(destinationChainId)!;

    const routerAddress = validateExecutionTarget(getStargateRouter(srcChain.chainId!), srcChain.id);
    const amountInBig = BigInt(request.amountInRaw || (request as any).amountIn || '0');
    if (amountInBig <= 0n) return null;

    const quoteTimestamp = Math.floor(Date.now() / 1000);
    const startTime = Date.now();

    validateTokenAddress(request.tokenIn.address, srcChain.id, request.tokenIn.isNative);
    validateTokenAddress(request.tokenOut.address, dstChain.id, request.tokenOut.isNative);

    const symIn = (request.tokenIn.symbol || '').toUpperCase().replace(/^W/, '');
    const symOut = (request.tokenOut.symbol || '').toUpperCase().replace(/^W/, '');
    const srcPoolId = STARGATE_POOL_IDS[symIn] || (symIn === 'USDC' ? 1 : undefined);
    const dstPoolId = STARGATE_POOL_IDS[symOut] || (symOut === 'USDC' ? 1 : undefined);

    if (!srcPoolId || !dstPoolId) {
      return null;
    }

    const protocolFeeBps = 6n;
    const feeAmountRaw = (amountInBig * protocolFeeBps) / 10000n;
    const netInBig = amountInBig - feeAmountRaw;

    const tokenInDecimals = request.tokenIn.decimals !== undefined ? request.tokenIn.decimals : 18;
    const tokenOutDecimals = request.tokenOut.decimals !== undefined ? request.tokenOut.decimals : 18;
    const destinationAmountBig = scaleTokenUnits(netInBig, tokenInDecimals, tokenOutDecimals);

    if (destinationAmountBig <= 0n) {
      return null;
    }

    const slippagePct = request.slippageTolerancePercent !== undefined && !isNaN(request.slippageTolerancePercent) ? request.slippageTolerancePercent : 0.5;
    const slippageBps = BigInt(Math.floor(slippagePct * 100));
    const slippageMultiplier = 10000n - slippageBps;
    const minDestinationAmountBig = (destinationAmountBig * slippageMultiplier) / 10000n;

    const feeNum = Number(feeAmountRaw) / (10 ** tokenInDecimals);
    const bridgeFeeUSD = request.tokenIn.priceUSD ? Number((feeNum * request.tokenIn.priceUSD).toFixed(4)) : 0.05;
    const gasEstimateUSD = defaultChainRegistry.getEstimatedGasCostUSD(srcChain.id, 'BRIDGE', request.gasPreset);

    const isNative = isNativeToken(request.tokenIn.address) || Boolean(request.tokenIn.isNative);
    const value = isNative ? amountInBig.toString() : '0';

    // Stargate V2 does not have a live quoter API connected in the current codebase.
    // In accordance with Phase 0 Task 2/6 invariants: unverified estimates must NEVER produce executable calldata.
    const calldata = '0x';
    const unexecutableReason = 'QUOTE_UNAVAILABLE: Stargate V2 live quoter not configured (unverified estimates not executable)';
    const diagnostic: ExecutionPlanDiagnostic = {
      code: 'QUOTE_UNAVAILABLE',
      message: unexecutableReason,
      severity: 'WARNING',
      providerId: 'STARGATE',
      timestamp: Date.now()
    };

    const quote: CrossChainQuote = {
      provider: 'STARGATE',
      providerName: this.name,
      sourceChainId: request.sourceChainId,
      destinationChainId: request.destinationChainId,
      sourceToken: request.tokenIn,
      destinationToken: request.tokenOut,
      sourceAmountRaw: amountInBig.toString(),
      destinationAmountRaw: destinationAmountBig.toString(),
      minDestinationAmountRaw: minDestinationAmountBig.toString(),
      bridgeFeeUSD,
      relayerFee: '0.06%',
      gasEstimateUSD,
      recipient: recipient || '',
      expiration: (quoteTimestamp + 300) * 1000,
      routeIdentifier: `stargate-${srcChain.id}-${dstChain.id}-${Date.now()}`,
      executionTarget: routerAddress,
      calldata,
      value,
      approvalTarget: routerAddress,
      quoteTimestamp: quoteTimestamp * 1000,
      estimatedTransferTimeSec: 45,
      securityRating: 'A+',
      isExecutable: false,
      unexecutableReason,
      diagnostics: [diagnostic]
    };

    const validationResult = validateCrossChainQuoteExecutability(quote, request);
    quote.isExecutable = validationResult.isExecutable;
    if (!validationResult.isExecutable) {
      quote.unexecutableReason = validationResult.unexecutableReason;
    }

    defaultQuoteDiagnosticLogger.record({
      provider: 'STARGATE',
      providerName: this.name,
      sourceChainId: request.sourceChainId,
      destinationChainId: request.destinationChainId,
      sourceToken: request.tokenIn.symbol,
      destinationToken: request.tokenOut.symbol,
      amountInRaw: amountInBig.toString(),
      requestStatus: 'SKIPPED',
      normalizedError: 'QUOTE_UNAVAILABLE',
      providerErrorMessage: unexecutableReason,
      isExecutable: false,
      unexecutableReason,
      latencyMs: Date.now() - startTime,
      timestamp: Date.now()
    });

    return quote;
  }

  public async buildExecution(
    quote: CrossChainQuote,
    userAddress: string,
    recipientAddress?: string
  ): Promise<CrossChainExecution> {
    if (quote.isExecutable === false) {
      throw new ProviderUnavailableError(
        `[StargateProvider] Cannot build execution for unexecutable quote (${quote.unexecutableReason || 'QUOTE_UNAVAILABLE'}). Stargate V2 live quoter is required.`
      );
    }
    const srcChain = defaultChainRegistry.getChain(quote.sourceChainId);
    if (!srcChain || !srcChain.chainId) {
      throw new Error(`[StargateProvider] Invalid source chain: ${quote.sourceChainId}`);
    }
    const dstChain = defaultChainRegistry.getChain(quote.destinationChainId);
    if (!dstChain || !dstChain.chainId) {
      throw new Error(`[StargateProvider] Invalid destination chain: ${quote.destinationChainId}`);
    }
    const routerAddress = validateExecutionTarget(getStargateRouter(srcChain.chainId), srcChain.id);

    const safeUser = validateEvmAddress(userAddress, 'User Address');
    const safeRecipient = validateRecipientAddress(recipientAddress || userAddress, srcChain.id);
    const recipientBytes = AbiCoder.defaultAbiCoder().encode(['address'], [safeRecipient.toLowerCase()]);

    const symIn = (quote.sourceToken.symbol || '').toUpperCase().replace(/^W/, '');
    const symOut = (quote.destinationToken.symbol || '').toUpperCase().replace(/^W/, '');
    const srcPoolId = STARGATE_POOL_IDS[symIn] || 1;
    const dstPoolId = STARGATE_POOL_IDS[symOut] || 1;
    const dstLzChainId = LZ_CHAIN_IDS[dstChain.chainId!] || dstChain.chainId!;

    const data = stargateInterface.encodeFunctionData('swap', [
      dstLzChainId,
      srcPoolId,
      dstPoolId,
      safeUser.toLowerCase(),
      BigInt(quote.sourceAmountRaw),
      BigInt(quote.minDestinationAmountRaw),
      [200000, 0, '0x'],
      recipientBytes,
      '0x'
    ]);

    const isNative = isNativeToken(quote.sourceToken.address) || Boolean(quote.sourceToken.isNative);

    return {
      to: routerAddress,
      data,
      calldata: data,
      value: isNative ? quote.sourceAmountRaw : '0',
      chainId: srcChain.chainId!,
      approvalTarget: routerAddress,
      requiredAllowanceRaw: quote.sourceAmountRaw,
      approvalAmount: quote.sourceAmountRaw
    } as any;
  }

  public async getStatus(sourceTxHash: string, _quote: CrossChainQuote): Promise<CrossChainStatus> {
    try {
      const url = `https://api-mainnet.layerzero-scan.com/tx/${sourceTxHash}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        const msg = data.messages?.[0];
        if (msg?.status === 'DELIVERED') {
          return {
            state: 'DESTINATION_FILLED',
            sourceTxHash,
            destinationTxHash: msg.dstTxHash,
            isComplete: true,
            isFailed: false,
            timestamp: Date.now()
          };
        }
        if (msg?.status === 'FAILED') {
          return {
            state: 'FAILED',
            sourceTxHash,
            isComplete: false,
            isFailed: true,
            errorMessage: 'LayerZero message delivery failed',
            timestamp: Date.now()
          };
        }
      }
    } catch {
      return {
        state: 'TRACKING_UNAVAILABLE',
        sourceTxHash,
        isComplete: false,
        isFailed: false,
        errorMessage: 'LayerZero tracking API temporarily unreachable',
        timestamp: Date.now()
      };
    }

    return {
      state: 'FULFILLING',
      sourceTxHash,
      isComplete: false,
      isFailed: false,
      timestamp: Date.now()
    };
  }

  public async getDestinationTransaction(sourceTxHash: string, quote: CrossChainQuote): Promise<string | null> {
    const status = await this.getStatus(sourceTxHash, quote);
    return status.destinationTxHash || null;
  }
}

export const defaultStargateProvider = new StargateProvider();
