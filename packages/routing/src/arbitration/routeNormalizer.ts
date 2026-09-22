import {
  NormalizedRoute,
  NormalizedRouteType,
  SwapRoute,
  QuoteRequest,
  ProviderCapabilityLevel,
  CrossChainQuote
} from '@zenith/types';
import { CrossChainProviderCapabilityMatrix } from '../crosschain/crossChainProviderCapabilityMatrix';

export class RouteNormalizer {
  /**
   * Converts a CrossChainQuote directly into a NormalizedRoute.
   * Preserves exact bigint/string representations without floating-point math.
   */
  public static normalizeQuote(quote: CrossChainQuote, request: QuoteRequest): NormalizedRoute {
    const isCrossChain = request.sourceChainId !== request.destinationChainId;
    const quoteAny = quote as any;
    let routeType: NormalizedRouteType = 'DIRECT_CROSS_CHAIN';
    if (quoteAny.sourceDexQuote || quoteAny.destDexQuote) {
      routeType = 'COMPOSITE_CROSS_CHAIN';
    } else if (!isCrossChain) {
      routeType = 'SAME_CHAIN';
    }

    const sourceChainId = request.sourceChainId;
    const destinationChainId = request.destinationChainId;
    const sourceToken = request.tokenIn;
    const destinationToken = request.tokenOut;

    const inputAmountRaw = quote.sourceAmountRaw || request.amountInRaw || '0';
    const expectedOutputRaw = quote.destinationAmountRaw || '0';
    const minimumOutputRaw = quote.minDestinationAmountRaw || expectedOutputRaw;

    let totalFeeRaw = '0';
    if (quote.relayerFee) {
      totalFeeRaw = quote.relayerFee;
    } else {
      try {
        const inBig = BigInt(inputAmountRaw);
        const outBig = BigInt(expectedOutputRaw);
        if (inBig > outBig && sourceToken.symbol.toUpperCase() === destinationToken.symbol.toUpperCase()) {
          totalFeeRaw = (inBig - outBig).toString();
        }
      } catch {
        totalFeeRaw = '0';
      }
    }

    const quotedAt = quote.quoteTimestamp || Date.now();
    const expiresAt = quote.expiration || (quotedAt + 15_000);

    const cap = CrossChainProviderCapabilityMatrix.getCapability(
      quote.provider,
      sourceChainId,
      destinationChainId,
      sourceToken.symbol,
      destinationToken.symbol
    );
    const capabilityLevel = cap.capabilityLevel || 'UNSUPPORTED';

    const routeId = (quote as any).routeIdentifier || `route-${quote.provider.toLowerCase()}-${sourceChainId}-${destinationChainId}`;

    return {
      routeId,
      sourceChainId,
      destinationChainId,
      sourceToken,
      destinationToken,
      inputAmountRaw,
      expectedOutputRaw,
      minimumOutputRaw,
      totalFeeRaw,
      feeToken: request.tokenIn,
      estimatedGasRaw: '220000',
      estimatedGasCostRaw: '0',
      bridgeProvider: quote.provider,
      sourceDex: quoteAny.sourceDexQuote?.provider,
      destinationDex: quoteAny.destDexQuote?.provider,
      quotedAt,
      expiresAt,
      capabilityLevel,
      isExecutable: Boolean(quote.isExecutable ?? true),
      routeType,
      unexecutableReason: quote.unexecutableReason,
      diagnostics: quote.diagnostics,
      calldata: quote.calldata,
      executionTarget: quote.executionTarget,
      approvalTarget: quote.approvalTarget,
      valueWei: quote.value || '0'
    };
  }

  /**
   * Converts a SwapRoute into a NormalizedRoute.
   * Preserves exact bigint/string representations without floating-point math.
   */
  public static normalize(route: SwapRoute, request: QuoteRequest): NormalizedRoute {
    const isCrossChain = request.sourceChainId !== request.destinationChainId;
    const ccQuote = route.crossChainQuote;
    const dexQuote = route.dexQuote;

    let routeType: NormalizedRouteType = 'SAME_CHAIN';
    if (isCrossChain) {
      routeType =
        ccQuote?.sourceDexQuote || ccQuote?.destDexQuote
          ? 'COMPOSITE_CROSS_CHAIN'
          : 'DIRECT_CROSS_CHAIN';
    }

    const sourceChainId = request.sourceChainId;
    const destinationChainId = request.destinationChainId;
    const sourceToken = request.tokenIn;
    const destinationToken = request.tokenOut;

    let inputAmountRaw = request.amountInRaw || '0';
    let expectedOutputRaw = '0';
    let minimumOutputRaw = '0';
    let totalFeeRaw = '0';
    let feeToken = request.tokenIn;
    let estimatedGasRaw = '150000';
    let estimatedGasCostRaw = '0';
    let bridgeProvider: string | undefined = undefined;
    let sourceDex: string | undefined = undefined;
    let destinationDex: string | undefined = undefined;
    let quotedAt = Date.now();
    let expiresAt = Date.now() + 15_000;
    let capabilityLevel: ProviderCapabilityLevel = 'UNSUPPORTED';
    let isExecutable = Boolean(route.isExecutable ?? true);
    let unexecutableReason = route.unexecutableReason;
    let calldata = route.execution?.data || (route.execution as any)?.calldata;
    let executionTarget = route.execution?.to || (route.execution as any)?.targetAddress;
    let approvalTarget = route.execution?.approvalTarget;
    let valueWei = route.execution?.value || '0';

    if (isCrossChain && ccQuote) {
      bridgeProvider = ccQuote.provider;
      sourceDex = ccQuote.sourceDexQuote?.provider;
      destinationDex = ccQuote.destDexQuote?.provider;

      inputAmountRaw = ccQuote.sourceAmountRaw || inputAmountRaw;
      expectedOutputRaw = ccQuote.destinationAmountRaw || '0';
      minimumOutputRaw = ccQuote.minDestinationAmountRaw || expectedOutputRaw;

      // Exact fee calculation: difference between input and expected output if same-token, or relayerFee
      if (ccQuote.relayerFee) {
        totalFeeRaw = ccQuote.relayerFee;
      } else {
        try {
          const inBig = BigInt(inputAmountRaw);
          const outBig = BigInt(expectedOutputRaw);
          if (inBig > outBig && sourceToken.symbol.toUpperCase() === destinationToken.symbol.toUpperCase()) {
            totalFeeRaw = (inBig - outBig).toString();
          }
        } catch {
          totalFeeRaw = '0';
        }
      }

      quotedAt = ccQuote.quoteTimestamp || Date.now();
      expiresAt = ccQuote.expiration || (quotedAt + 15_000);

      // Derive capability level
      const cap = CrossChainProviderCapabilityMatrix.getCapability(
        ccQuote.provider,
        sourceChainId,
        destinationChainId,
        sourceToken.symbol,
        destinationToken.symbol
      );
      capabilityLevel = cap.capabilityLevel || 'UNSUPPORTED';

      if (ccQuote.isExecutable !== undefined) {
        isExecutable = Boolean(ccQuote.isExecutable);
      }
      if (ccQuote.unexecutableReason) {
        unexecutableReason = ccQuote.unexecutableReason;
      }

      calldata = calldata || ccQuote.calldata;
      executionTarget = executionTarget || ccQuote.executionTarget;
      approvalTarget = approvalTarget || ccQuote.approvalTarget;
      valueWei = valueWei !== '0' ? valueWei : (ccQuote.value || '0');
    } else if (dexQuote) {
      sourceDex = dexQuote.provider;
      inputAmountRaw = dexQuote.amountIn ? dexQuote.amountIn.toString() : inputAmountRaw;
      expectedOutputRaw = dexQuote.amountOut ? dexQuote.amountOut.toString() : '0';
      minimumOutputRaw = dexQuote.minimumAmountOut
        ? dexQuote.minimumAmountOut.toString()
        : expectedOutputRaw;
      totalFeeRaw = dexQuote.feeAmount ? dexQuote.feeAmount.toString() : '0';
      estimatedGasRaw = dexQuote.gasEstimate ? dexQuote.gasEstimate.toString() : '150000';

      quotedAt = dexQuote.quoteTimestamp || Date.now();
      expiresAt = dexQuote.expiration || (quotedAt + 15_000);

      // Same-chain DEX pools with verified factory/router are EXECUTION_AVAILABLE / LIVE_VERIFIED
      capabilityLevel = 'LIVE_VERIFIED';

      calldata = calldata || dexQuote.calldata;
      executionTarget = executionTarget || dexQuote.executionTarget;
      approvalTarget = approvalTarget || dexQuote.approvalTarget;
    }

    const routeId =
      route.id ||
      (route as any).routeIdentifier ||
      `route-${routeType.toLowerCase()}-${bridgeProvider ? bridgeProvider.toLowerCase() : 'dex'}-${sourceChainId}-${destinationChainId}`;

    return {
      routeId,
      sourceChainId,
      destinationChainId,
      sourceToken,
      destinationToken,
      inputAmountRaw,
      expectedOutputRaw,
      minimumOutputRaw,
      totalFeeRaw,
      feeToken,
      estimatedGasRaw,
      estimatedGasCostRaw,
      bridgeProvider,
      sourceDex,
      destinationDex,
      quotedAt,
      expiresAt,
      capabilityLevel,
      isExecutable,
      routeType,
      unexecutableReason,
      diagnostics: route.diagnostics,
      calldata,
      executionTarget,
      approvalTarget,
      valueWei
    };
  }
}
