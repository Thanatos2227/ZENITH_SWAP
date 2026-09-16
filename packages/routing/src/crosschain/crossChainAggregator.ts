import {
  CrossChainProvider,
  CrossChainQuote,
  CrossChainExecution,
  QuoteRequest,
  SwapRoute,
  RouteHop,
  Token
} from '@zenith/types';
import { defaultChainRegistry } from '@zenith/chains';
import { defaultAcrossProvider } from './providers/acrossProvider';
import { defaultStargateProvider } from './providers/stargateProvider';
import { defaultDeBridgeProvider } from './providers/debridgeProvider';
import { defaultDEXAggregator } from '../dex/dexAggregator';
import { defaultTokenService } from '@zenith/tokens';
import { formatTokenUnits } from '../tokenDecimals';

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
        return await provider.getQuote(request);
      } catch (err) {
        console.warn(`[CrossChainAggregator] Provider ${provider.name} quote failed:`, err);
        return null;
      }
    });

    const results = await Promise.all(quotePromises);
    const validQuotes = results.filter((q): q is CrossChainQuote => q !== null);

    return validQuotes.sort((a, b) => {
      const diff = BigInt(b.destinationAmountRaw) - BigInt(a.destinationAmountRaw);
      if (diff !== 0n) {
        return diff > 0n ? 1 : -1;
      }
      return a.gasEstimateUSD - b.gasEstimateUSD;
    });
  }

  public async getBestQuote(request: QuoteRequest): Promise<CrossChainQuote | null> {
    const quotes = await this.getQuotes(request);
    return quotes.length > 0 ? quotes[0] : null;
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

    const tokenInDecimals = request.tokenIn.decimals !== undefined ? request.tokenIn.decimals : 18;
    const amountInBig = BigInt(request.amountInRaw || (request as any).amountIn || '0');
    if (amountInBig <= 0n) return [];

    const amountInNum = Number(formatTokenUnits(amountInBig, tokenInDecimals));
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
        calldata: bestBridgeQuote.calldata,
        value: request.tokenIn.isNative ? amountInBig.toString() : '0',
        approvalTarget: sourceDexQuote?.approvalTarget || bestBridgeQuote.approvalTarget,
        quoteTimestamp: bestBridgeQuote.quoteTimestamp,
        estimatedTransferTimeSec: bestBridgeQuote.estimatedTransferTimeSec + (sourceDexQuote ? 5 : 0),
        securityRating: bestBridgeQuote.securityRating,
        sourceConnectorToken: srcConnector,
        destConnectorToken: dstConnector,
        sourceDexQuote: sourceDexQuote || undefined,
        destDexQuote: destDexQuote || undefined,
        underlyingBridgeQuote: bestBridgeQuote
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
    const provider = this.getProvider(quote.provider);
    if (!provider) {
      throw new Error(`[CrossChainAggregator] Bridge provider ${quote.provider} not found`);
    }
    const quoteAny = quote as any;
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

    const routes: SwapRoute[] = [];

    for (const quote of quotes) {
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
      if (provider && userAddress) {
        try {
          execution = await this.buildExecution(quote, userAddress, request.recipientAddress);
        } catch {

        }
      }

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
        estimatedGasUnits: 220000n
      });
    }

    return routes;
  }
}

export const defaultCrossChainAggregator = new CrossChainAggregator();
