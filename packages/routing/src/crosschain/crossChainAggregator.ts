import {
  CrossChainProvider,
  CrossChainQuote,
  CrossChainExecution,
  QuoteRequest,
  SwapRoute,
  RouteHop,
  Token,
  NormalizedBridgeQuote,
  ProviderCapabilityLevel
} from '@zenith/types';
import { defaultChainRegistry } from '@zenith/chains';
import { CrossChainProviderCapabilityMatrix } from './crossChainProviderCapabilityMatrix';
import { defaultAcrossProvider } from './providers/acrossProvider';
import { defaultStargateProvider } from './providers/stargateProvider';
import { defaultDeBridgeProvider } from './providers/debridgeProvider';
import { defaultDEXAggregator } from '../dex/dexAggregator';
import { defaultTokenService } from '@zenith/tokens';
import { formatTokenUnits } from '../tokenDecimals';
import {
  DestinationExecutionUnavailableError,
  ExecutionUnavailableError,
  SourceSwapUnavailableError
} from '@zenith/contracts';
import { validateCrossChainQuoteExecutability } from './quoteValidator';
import { defaultQuoteDiagnosticLogger } from './quoteDiagnostics';
import { RouteArbitrator, RouteNormalizer } from '../arbitration';

function isSameToken(a: Token, b: Token): boolean {
  if (a.chainId.toLowerCase() !== b.chainId.toLowerCase()) return false;
  return (
    a.address.toLowerCase() === b.address.toLowerCase() ||
    (Boolean(a.isNative) && Boolean(b.isNative))
  );
}

export class CrossChainAggregator {
  private providers: CrossChainProvider[];

  constructor(providers?: CrossChainProvider[]) {
    this.providers = providers || [
      defaultAcrossProvider,
      defaultStargateProvider,
      defaultDeBridgeProvider
    ];
  }

  public getProviders(): CrossChainProvider[] {
    return [...this.providers];
  }

  public getProvider(id: string): CrossChainProvider | undefined {
    return this.providers.find((p) => p.id.toLowerCase() === id.toLowerCase());
  }

  public async getQuotes(request: QuoteRequest): Promise<CrossChainQuote[]> {
    const sourceChainId = request.sourceChainId || (request as any).srcChainId;
    const destinationChainId = request.destinationChainId || (request as any).destChainId;

    const isCrossChain = sourceChainId !== destinationChainId;
    if (!isCrossChain || !sourceChainId || !destinationChainId) return [];

    const availableProviders = this.providers.filter((p) =>
      p.isAvailable(sourceChainId, destinationChainId, request.tokenIn, request.tokenOut)
    );

    if (availableProviders.length === 0) {
      return [];
    }

    const quotePromises = availableProviders.map(async (provider) => {
      try {
        const quote = await provider.getQuote(request);
        if (quote) {
          const validation = validateCrossChainQuoteExecutability(quote, request);
          quote.isExecutable = validation.isExecutable;
          if (!validation.isExecutable) {
            quote.unexecutableReason = validation.unexecutableReason;
          }

          // Provider Routing Policy (Phase 1 Task 9):
          // In LIVE_EXECUTION mode, only providers certified as LIVE_VERIFIED may produce executable quotes.
          if (request.executionMode === 'LIVE_EXECUTION') {
            const isLive = CrossChainProviderCapabilityMatrix.isLiveVerified(
              quote.provider,
              sourceChainId,
              destinationChainId,
              request.tokenIn.symbol,
              request.tokenOut.symbol
            );
            if (!isLive) {
              quote.isExecutable = false;
              quote.unexecutableReason = `CAPABILITY_MISMATCH: Provider ${quote.provider} is not LIVE_VERIFIED for route ${sourceChainId} -> ${destinationChainId}. Required for LIVE_EXECUTION.`;
            }
          }
        }
        return quote;
      } catch (err: any) {
        console.warn(`[CrossChainAggregator] Provider ${provider.name} quote failed:`, err);
        const normCode = defaultQuoteDiagnosticLogger.normalizeErrorCode(err);
        defaultQuoteDiagnosticLogger.record({
          provider: provider.id,
          providerName: provider.name,
          sourceChainId,
          destinationChainId,
          sourceToken: request.tokenIn.symbol,
          destinationToken: request.tokenOut.symbol,
          amountInRaw: request.amountInRaw || '0',
          requestStatus: 'FAILED',
          normalizedError: normCode,
          providerErrorMessage: err?.message || String(err),
          isExecutable: false,
          unexecutableReason: `PROVIDER_EXCEPTION: ${err?.message || err}`,
          timestamp: Date.now()
        });
        return null;
      }
    });

    const results = await Promise.all(quotePromises);
    const validQuotes = results.filter((q): q is CrossChainQuote => q !== null);

    return validQuotes.sort((a, b) => {
      const diff = BigInt(b.destinationAmountRaw || '0') - BigInt(a.destinationAmountRaw || '0');
      if (diff !== 0n) {
        return diff > 0n ? 1 : -1;
      }
      return a.gasEstimateUSD - b.gasEstimateUSD;
    });
  }

  public async getBestQuote(request: QuoteRequest): Promise<CrossChainQuote | null> {
    const quotes = await this.getQuotes(request);
    if (quotes.length === 0) return null;

    // Authoritative Route Arbitration (Task 27 / Task 28)
    const normalized = quotes.map((q) => RouteNormalizer.normalizeQuote(q, request));
    const arbResult = RouteArbitrator.arbitrate(normalized, request, {
      executionMode: request.executionMode
    });

    if (arbResult.selectedRoute) {
      const match = quotes.find(
        (q) =>
          ((q as any).routeIdentifier === arbResult.selectedRoute!.routeId) ||
          (q.provider.toLowerCase() === (arbResult.selectedRoute!.bridgeProvider || '').toLowerCase())
      );
      if (match) {
        return match;
      }
    }

    // Fail-Closed: If no candidate passed arbitration in executable modes, NEVER fallback!
    if (
      request.executionMode === 'LIVE_EXECUTION' ||
      request.executionMode === 'LIVE_ONCHAIN' ||
      request.executionMode === 'PREFLIGHT_ONLY'
    ) {
      return null;
    }

    // In READ_ONLY mode, return diagnostic non-executable quote if available
    if (request.executionMode === 'READ_ONLY' && quotes.length > 0) {
      return { ...quotes[0], isExecutable: false, unexecutableReason: 'READ_ONLY_MODE' };
    }

    return null;
  }

  public async getQuote(request: QuoteRequest): Promise<CrossChainQuote | null> {
    return this.getBestQuote(request);
  }

  /**
   * Converts a CrossChainQuote into the standardized NormalizedBridgeQuote (Phase 1 Task 6).
   * Strictly preserves bigint/string safety and prevents floating-point token arithmetic.
   */
  public toNormalizedQuote(quote: CrossChainQuote): NormalizedBridgeQuote {
    const cap = CrossChainProviderCapabilityMatrix.getCapability(
      quote.provider,
      quote.sourceChainId,
      quote.destinationChainId,
      quote.sourceToken?.symbol || '',
      quote.destinationToken?.symbol || ''
    );
    const capabilityLevel: ProviderCapabilityLevel =
      cap.capabilityLevel || (cap.capabilityStatus as ProviderCapabilityLevel) || 'UNSUPPORTED';

    let feeAmountRaw = '0';
    try {
      const srcBig = BigInt(quote.sourceAmountRaw || '0');
      const dstBig = BigInt(quote.destinationAmountRaw || '0');
      if (srcBig > dstBig) {
        feeAmountRaw = (srcBig - dstBig).toString();
      }
    } catch {
      feeAmountRaw = '0';
    }

    return {
      provider: quote.provider,
      sourceChainId: quote.sourceChainId,
      destinationChainId: quote.destinationChainId,
      sourceToken: quote.sourceToken,
      destinationToken: quote.destinationToken,
      inputAmountRaw: quote.sourceAmountRaw,
      expectedOutputRaw: quote.destinationAmountRaw,
      minimumOutputRaw: quote.minDestinationAmountRaw,
      feeAmountRaw,
      feeToken: quote.sourceToken,
      expiration: quote.expiration,
      approvalTarget: quote.approvalTarget,
      executionTarget: quote.executionTarget,
      calldata: quote.calldata,
      value: quote.value,
      orderId: (quote as any).orderId || quote.routeIdentifier,
      statusEndpoint: (quote as any).statusEndpoint,
      isExecutable: Boolean(quote.isExecutable),
      capabilityLevel,
      unexecutableReason: quote.unexecutableReason
    };
  }

  public async findConnectorBridgeQuotes(request: QuoteRequest): Promise<CrossChainQuote[]> {
    const sourceChainId = request.sourceChainId || (request as any).srcChainId;
    const destinationChainId = request.destinationChainId || (request as any).destChainId;

    if (!sourceChainId || !destinationChainId || sourceChainId === destinationChainId) {
      return [];
    }

    const srcChain = defaultChainRegistry.getChain(sourceChainId);
    const dstChain = defaultChainRegistry.getChain(destinationChainId);
    if (!srcChain || !dstChain) return [];

    const amountInBig = BigInt(request.amountInRaw || (request as any).amountIn || '0');
    if (amountInBig <= 0n) return [];

    const inDecimals = request.tokenIn.decimals !== undefined ? request.tokenIn.decimals : 18;
    const amountInNum = Number(formatTokenUnits(amountInBig, inDecimals));
    const priceInUSD = request.tokenIn.priceUSD || 0;
    const tradeValueUSD = amountInNum * priceInUSD;

    if (tradeValueUSD > 0 && tradeValueUSD < 1.0) {
      return [];
    }

    const sourceTokens = defaultTokenService.getTokensForChain(sourceChainId);
    const destTokens = defaultTokenService.getTokensForChain(destinationChainId);

    const candidateSymbols = Array.from(
      new Set([
        (request.tokenOut.symbol || '').toUpperCase(),
        (request.tokenIn.symbol || '').toUpperCase(),
        'USDC',
        'USDT',
        'WETH',
        'ETH',
        'DAI'
      ])
    ).filter(Boolean);

    const compositeQuotes: CrossChainQuote[] = [];

    for (const symbol of candidateSymbols) {
      const srcConnector = sourceTokens.find(
        (t) =>
          t.symbol.toUpperCase() === symbol ||
          (symbol === 'WETH' && t.symbol.toUpperCase() === 'ETH') ||
          (symbol === 'ETH' && t.symbol.toUpperCase() === 'WETH')
      );
      const dstConnector = destTokens.find(
        (t) =>
          t.symbol.toUpperCase() === symbol ||
          (symbol === 'WETH' && t.symbol.toUpperCase() === 'ETH') ||
          (symbol === 'ETH' && t.symbol.toUpperCase() === 'WETH')
      );

      if (!srcConnector || !dstConnector) continue;

      let bridgeAmountInBig = amountInBig;
      let sourceDexQuote = null;

      const needsSourceSwap = !isSameToken(request.tokenIn, srcConnector);
      if (needsSourceSwap) {
        if (!srcChain.chainId) continue;
        try {
          const dexQuotes = await defaultDEXAggregator.getQuotes({
            chainId: srcChain.chainId,
            tokenIn: request.tokenIn,
            tokenOut: srcConnector,
            amountIn: amountInBig,
            slippageToleranceBps: 25,
            recipient: request.recipientAddress || request.userWalletAddress
          });
          if (!dexQuotes || dexQuotes.length === 0) continue;
          sourceDexQuote = dexQuotes[0];

          if (request.userWalletAddress) {
            try {
              const srcExec = await defaultDEXAggregator.buildExecution(
                sourceDexQuote,
                request.userWalletAddress,
                request.recipientAddress || request.userWalletAddress
              );
              sourceDexQuote.calldata = srcExec.data;
              sourceDexQuote.executionTarget = srcExec.to;
              sourceDexQuote.approvalTarget = srcExec.approvalTarget || srcExec.to;
              sourceDexQuote.execution = srcExec;
            } catch {
              // calldata will remain undefined
            }
          }
          bridgeAmountInBig = sourceDexQuote.amountOut;
        } catch {
          continue;
        }
      }

      if (bridgeAmountInBig <= 0n) continue;

      let bridgeQuotes: CrossChainQuote[] = [];
      try {
        bridgeQuotes = await this.getQuotes({
          ...request,
          tokenIn: srcConnector,
          tokenOut: dstConnector,
          amountInRaw: bridgeAmountInBig.toString()
        });
      } catch {
        continue;
      }

      if (!bridgeQuotes || bridgeQuotes.length === 0) continue;
      const bestBridgeQuote = bridgeQuotes[0];

      let finalAmountOutBig = BigInt(bestBridgeQuote.destinationAmountRaw);
      let minFinalAmountOutBig = BigInt(bestBridgeQuote.minDestinationAmountRaw);
      let destDexQuote = null;

      const needsDestSwap = !isSameToken(dstConnector, request.tokenOut);
      if (needsDestSwap) {
        if (!dstChain.chainId) continue;
        try {
          const destDexQuotes = await defaultDEXAggregator.getQuotes({
            chainId: dstChain.chainId,
            tokenIn: dstConnector,
            tokenOut: request.tokenOut,
            amountIn: BigInt(bestBridgeQuote.destinationAmountRaw),
            slippageToleranceBps: 25,
            recipient: request.recipientAddress || request.userWalletAddress
          });
          if (!destDexQuotes || destDexQuotes.length === 0) continue;
          destDexQuote = destDexQuotes[0];
          finalAmountOutBig = destDexQuote.amountOut;
          minFinalAmountOutBig = destDexQuote.minimumAmountOut;
        } catch {
          continue;
        }
      }

      if (finalAmountOutBig <= 0n) continue;

      const compositeDiagnostics = bestBridgeQuote.diagnostics ? [...bestBridgeQuote.diagnostics] : [];
      let isExecutable = false;
      let unexecutableReason: string | undefined = undefined;
      let compositeExecutionMode: 'ATOMIC' | 'SOLVER' | 'SEPARATE_DESTINATION_TX' | 'UNSUPPORTED' = 'UNSUPPORTED';

      if (destDexQuote) {
        compositeExecutionMode = 'UNSUPPORTED';
        isExecutable = false;
        unexecutableReason = 'DESTINATION_EXECUTION_UNAVAILABLE';
        compositeDiagnostics.push({
          code: 'DESTINATION_EXECUTION_UNAVAILABLE',
          message: `Composite cross-chain route requires destination DEX swap (${dstConnector.symbol} -> ${request.tokenOut.symbol}), but automated destination execution/solver is not yet enabled.`,
          severity: 'WARNING',
          providerId: bestBridgeQuote.provider,
          timestamp: Date.now()
        });
      } else if (sourceDexQuote && (!sourceDexQuote.calldata || sourceDexQuote.calldata === '0x')) {
        compositeExecutionMode = 'SEPARATE_DESTINATION_TX';
        isExecutable = false;
        unexecutableReason = 'SOURCE_SWAP_UNAVAILABLE';
        compositeDiagnostics.push({
          code: 'SOURCE_SWAP_UNAVAILABLE',
          message: `Source DEX swap (${request.tokenIn.symbol} -> ${srcConnector.symbol}) executable calldata could not be constructed.`,
          severity: 'WARNING',
          providerId: sourceDexQuote.provider,
          timestamp: Date.now()
        });
      } else {
        compositeExecutionMode = 'SEPARATE_DESTINATION_TX';
        isExecutable = Boolean(bestBridgeQuote.isExecutable);
        unexecutableReason = bestBridgeQuote.unexecutableReason;
      }

      const compositeQuote: CrossChainQuote = {
        provider: bestBridgeQuote.provider,
        providerName: `${bestBridgeQuote.providerName} (Swap + Bridge)`,
        sourceChainId: sourceChainId,
        destinationChainId: destinationChainId,
        sourceToken: request.tokenIn,
        destinationToken: request.tokenOut,
        sourceAmountRaw: amountInBig.toString(),
        destinationAmountRaw: finalAmountOutBig.toString(),
        minDestinationAmountRaw: minFinalAmountOutBig.toString(),
        bridgeFeeUSD: Number((bestBridgeQuote.bridgeFeeUSD + (sourceDexQuote?.gasCostUSD || 0) * 0.05).toFixed(4)),
        relayerFee: bestBridgeQuote.relayerFee,
        gasEstimateUSD: Number(
          (
            bestBridgeQuote.gasEstimateUSD +
            (sourceDexQuote?.gasCostUSD || 0) +
            (destDexQuote?.gasCostUSD || 0)
          ).toFixed(4)
        ),
        recipient: request.recipientAddress || request.userWalletAddress || '',
        expiration: bestBridgeQuote.expiration,
        routeIdentifier: `connector-${symbol.toLowerCase()}-${bestBridgeQuote.routeIdentifier}`,
        executionTarget: sourceDexQuote?.executionTarget || bestBridgeQuote.executionTarget,
        calldata: sourceDexQuote?.calldata || bestBridgeQuote.calldata || '0x',
        value: request.tokenIn.isNative ? amountInBig.toString() : '0',
        approvalTarget: sourceDexQuote?.approvalTarget || bestBridgeQuote.approvalTarget,
        quoteTimestamp: bestBridgeQuote.quoteTimestamp,
        estimatedTransferTimeSec: bestBridgeQuote.estimatedTransferTimeSec + (sourceDexQuote ? 5 : 0),
        securityRating: bestBridgeQuote.securityRating,
        sourceConnectorToken: srcConnector,
        destConnectorToken: dstConnector,
        sourceDexQuote: sourceDexQuote || undefined,
        destDexQuote: destDexQuote || undefined,
        underlyingBridgeQuote: bestBridgeQuote,
        compositeExecutionMode,
        isExecutable,
        unexecutableReason,
        diagnostics: compositeDiagnostics
      } as any;

      compositeQuotes.push(compositeQuote);
    }

    return compositeQuotes.sort((a, b) => {
      const diff = BigInt(b.destinationAmountRaw) - BigInt(a.destinationAmountRaw);
      if (diff !== 0n) {
        return diff > 0n ? 1 : -1;
      }
      return a.gasEstimateUSD - b.gasEstimateUSD;
    });
  }

  public async buildExecution(
    quote: CrossChainQuote,
    userAddress: string,
    recipientAddress?: string
  ): Promise<CrossChainExecution> {
    const quoteAny = quote as any;
    if (quoteAny.destDexQuote) {
      throw new DestinationExecutionUnavailableError(quote.destinationToken.symbol, quote.destinationChainId);
    }
    if (quoteAny.sourceDexQuote && (!quoteAny.sourceDexQuote.calldata || quoteAny.sourceDexQuote.calldata === '0x')) {
      throw new SourceSwapUnavailableError(
        `Source DEX swap for ${quote.sourceToken.symbol} cannot be executed: calldata missing.`
      );
    }
    if (quote.isExecutable === false || quote.calldata === '0x') {
      throw new ExecutionUnavailableError(
        quote.unexecutableReason || `Bridge provider ${quote.provider} does not have a verified executable quote.`
      );
    }
    const provider = this.getProvider(quote.provider);
    if (!provider) {
      throw new Error(`[CrossChainAggregator] Bridge provider ${quote.provider} not found`);
    }
    const targetQuote = quoteAny.underlyingBridgeQuote || quote;
    return provider.buildExecution(targetQuote, userAddress, recipientAddress);
  }

  public async findCrossChainRoutes(params: {
    request: QuoteRequest;
    userAddress?: string;
  }): Promise<SwapRoute[]> {
    const { request, userAddress } = params;
    let directQuotes = await this.getQuotes(request);
    let connectorQuotes: CrossChainQuote[] = [];

    const isDifferentSymbol =
      (request.tokenIn.symbol || '').toUpperCase() !== (request.tokenOut.symbol || '').toUpperCase();

    if (directQuotes.length === 0 || isDifferentSymbol) {
      connectorQuotes = await this.findConnectorBridgeQuotes(request);
    }

    const quotes = [...connectorQuotes, ...directQuotes];

    if (quotes.length === 0) {
      return [];
    }

    const sortedQuotes = [...quotes].sort((a, b) => {
      if (Boolean(a.isExecutable) !== Boolean(b.isExecutable)) {
        return a.isExecutable ? -1 : 1;
      }
      const minA = BigInt(a.minDestinationAmountRaw || a.destinationAmountRaw || '0');
      const minB = BigInt(b.minDestinationAmountRaw || b.destinationAmountRaw || '0');
      if (minA !== minB) {
        return minB > minA ? 1 : -1;
      }
      const diff = BigInt(b.destinationAmountRaw || '0') - BigInt(a.destinationAmountRaw || '0');
      if (diff !== 0n) {
        return diff > 0n ? 1 : -1;
      }
      return a.gasEstimateUSD - b.gasEstimateUSD;
    });

    const routes: SwapRoute[] = [];

    for (const quote of sortedQuotes) {
      const quoteAny = quote as any;
      const hops: RouteHop[] = [];

      if (quoteAny.sourceDexQuote) {
        hops.push({
          dexProtocol: quoteAny.sourceDexQuote.provider,
          poolAddress: quoteAny.sourceDexQuote.executionTarget,
          tokenIn: request.tokenIn,
          tokenOut: quoteAny.sourceConnectorToken || quote.sourceToken,
          feeTierBps: quoteAny.sourceDexQuote.feeTierBps || 30,
          proportionPercent: 100,
          estimatedGas: quoteAny.sourceDexQuote.gasEstimate || 150000n
        });
      } else if (quote.sourceToken.address.toLowerCase() !== request.tokenIn.address.toLowerCase()) {
        const routerAddress = quote.executionTarget;
        hops.push({
          dexProtocol: 'UNISWAP_V3',
          poolAddress: routerAddress,
          tokenIn: request.tokenIn,
          tokenOut: quote.sourceToken,
          proportionPercent: 100,
          estimatedGas: 150000n
        });
      }

      if (quoteAny.destDexQuote) {
        hops.push({
          dexProtocol: quoteAny.destDexQuote.provider,
          poolAddress: quoteAny.destDexQuote.executionTarget,
          tokenIn: quoteAny.destConnectorToken || quote.destinationToken,
          tokenOut: request.tokenOut,
          feeTierBps: quoteAny.destDexQuote.feeTierBps || 30,
          proportionPercent: 100,
          estimatedGas: quoteAny.destDexQuote.gasEstimate || 150000n
        });
      }

      let execution = undefined;
      const provider = this.getProvider(quote.provider);
      if (provider && userAddress && quote.isExecutable !== false && quote.calldata !== '0x') {
        try {
          execution = await this.buildExecution(quote, userAddress, request.recipientAddress);
        } catch {
          // execution remains undefined
        }
      }

      const isRouteExecutable = Boolean(
        quote.isExecutable !== false &&
        quote.calldata &&
        quote.calldata !== '0x' &&
        !quoteAny.destDexQuote
      );

      routes.push({
        id: `route-bridge-${quote.provider.toLowerCase()}-${quote.sourceChainId}-${quote.destinationChainId}`,
        routeType: 'CROSS_CHAIN',
        hops,
        bridgeStep: {
          bridgeProtocol: quote.provider,
          sourceChainId: quote.sourceChainId,
          destinationChainId: quote.destinationChainId,
          tokenIn: quoteAny.sourceConnectorToken || quote.sourceToken,
          tokenOut: quoteAny.destConnectorToken || quote.destinationToken,
          estimatedTransferTimeSec: quote.estimatedTransferTimeSec,
          bridgeFeeUSD: quote.bridgeFeeUSD,
          securityRating: quote.securityRating,
          relayerFee: quote.relayerFee
        },
        crossChainQuote: quote,
        execution,
        gasCostUSD: quote.gasEstimateUSD,
        estimatedGasUnits: 220000n,
        isExecutable: isRouteExecutable,
        unexecutableReason: !isRouteExecutable ? (quote.unexecutableReason || 'EXECUTION_UNAVAILABLE') : undefined,
        diagnostics: quote.diagnostics
      });
    }

    // Apply RouteArbitrator to deterministically order the resulting routes
    if (routes.length > 0) {
      try {
        const normalized = routes.map((r) => RouteNormalizer.normalize(r, request));
        const arbResult = RouteArbitrator.arbitrate(normalized, request, {
          executionMode: request.executionMode
        });
        if (arbResult.selectedRoute) {
          const selectedId = arbResult.selectedRoute.routeId;
          routes.sort((a, b) => {
            if (a.id === selectedId) return -1;
            if (b.id === selectedId) return 1;
            const execA = Boolean(a.isExecutable);
            const execB = Boolean(b.isExecutable);
            if (execA !== execB) return execA ? -1 : 1;
            return a.id.localeCompare(b.id);
          });
        } else if (
          request.executionMode === 'LIVE_EXECUTION' ||
          request.executionMode === 'LIVE_ONCHAIN' ||
          request.executionMode === 'PREFLIGHT_ONLY'
        ) {
          for (const r of routes) {
            r.isExecutable = false;
            r.unexecutableReason =
              arbResult.rejectedCandidates[0]?.reason || 'REJECTED_BY_ROUTE_ARBITRATOR';
          }
        }
      } catch (err: any) {
        if (
          request.executionMode === 'LIVE_EXECUTION' ||
          request.executionMode === 'LIVE_ONCHAIN' ||
          request.executionMode === 'PREFLIGHT_ONLY'
        ) {
          for (const r of routes) {
            r.isExecutable = false;
            r.unexecutableReason = `ARBITRATION_ERROR: ${err?.message || err}`;
          }
        }
      }
    }

    return routes;
  }
}

export const defaultCrossChainAggregator = new CrossChainAggregator();
