import {
  QuoteRequest,
  QuoteResponse,
  SwapRoute,
  TradeType,
  CrossChainIntent,
  SwapFee,
  QuoteValidationResult,
  ExecutableTransaction,
  Token,
  DEXQuote
} from '@zenith/types';
import { defaultChainRegistry } from '@zenith/chains';
import { defaultDEXAggregator, DEXAggregator } from './dex';
import { defaultCrossChainAggregator, CrossChainAggregator } from './crosschain/crossChainAggregator';
import { defaultScoringService, ScoringService } from './scoring';
import { defaultSimulationEngine, SimulationEngine } from '@zenith/security';
import { MAX_SWAP_AMOUNT_NUM } from './amountValidation';
import { EVMContractRegistry, ConfigurationError } from '@zenith/contracts';
import { parseTokenUnits, formatTokenUnits } from './tokenDecimals';

export class ZenithRouter {
  private dexAggregator: DEXAggregator;
  private crossChainAggregator: CrossChainAggregator;
  private scoringService: ScoringService;
  private simulationEngine: SimulationEngine;
  private intentNonceCounter: number = 1001;

  constructor(
    dexAggregator = defaultDEXAggregator,
    crossChainAggregator = defaultCrossChainAggregator,
    scoringService = defaultScoringService,
    simulationEngine = defaultSimulationEngine
  ) {
    this.dexAggregator = dexAggregator;
    this.crossChainAggregator = crossChainAggregator;
    this.scoringService = scoringService;
    this.simulationEngine = simulationEngine;
  }

  public async getQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const sourceChain = defaultChainRegistry.getChain(request.sourceChainId);
    const destChain = defaultChainRegistry.getChain(request.destinationChainId);

    if (!sourceChain) {
      throw new ConfigurationError(`Source chain ${request.sourceChainId} is not recognized`, 'UNKNOWN_SOURCE_CHAIN');
    }
    if (!destChain) {
      throw new ConfigurationError(`Destination chain ${request.destinationChainId} is not recognized`, 'UNKNOWN_DEST_CHAIN');
    }

    if (!defaultChainRegistry.supportsCapability(request.sourceChainId, 'swap')) {
      throw new ConfigurationError(
        `Swap capability is not supported on ${sourceChain.canonicalName} (${sourceChain.tier} - ${sourceChain.operationalStatus})`,
        'SWAP_UNSUPPORTED'
      );
    }

    if (!defaultChainRegistry.supportsCapability(request.destinationChainId, 'swap')) {
      throw new ConfigurationError(
        `Swap capability is not supported on ${destChain.canonicalName} (${destChain.tier} - ${destChain.operationalStatus})`,
        'SWAP_UNSUPPORTED'
      );
    }

    const isCrossChain = request.sourceChainId !== request.destinationChainId;
    const tradeType: TradeType = request.tradeType || 'EXACT_INPUT';
    const tokenInDecimals = request.tokenIn.decimals !== undefined ? request.tokenIn.decimals : 18;
    const tokenOutDecimals = request.tokenOut.decimals !== undefined ? request.tokenOut.decimals : 18;

    const callerAddress = request.userWalletAddress || (request as any).userAddress || request.recipientAddress || (request as any).recipient || undefined;
    const targetRecipient = request.recipientAddress || (request as any).recipient || callerAddress || '';

    const hasValidPrices = Boolean(
      request.tokenIn.priceUSD && request.tokenIn.priceUSD > 0 &&
      request.tokenOut.priceUSD && request.tokenOut.priceUSD > 0
    );
    const priceInUSD = request.tokenIn.priceUSD && request.tokenIn.priceUSD > 0 ? request.tokenIn.priceUSD : 1;
    const priceOutUSD = request.tokenOut.priceUSD && request.tokenOut.priceUSD > 0 ? request.tokenOut.priceUSD : 1;
    const referencePrice = hasValidPrices ? (request.tokenIn.priceUSD! / request.tokenOut.priceUSD!) : undefined;

    const effectiveTokenIn: Token = { ...request.tokenIn, priceUSD: priceInUSD };
    const effectiveTokenOut: Token = { ...request.tokenOut, priceUSD: priceOutUSD };

    const effectiveAmountInRaw = request.amountInRaw
      ? request.amountInRaw
      : request.amountIn !== undefined && request.amountIn !== null
      ? parseTokenUnits(request.amountIn.toString(), tokenInDecimals)
      : '0';

    let amountInBig: bigint = BigInt(effectiveAmountInRaw);
    let amountOutBig: bigint = 0n;
    let amountInNum: number = Number(formatTokenUnits(amountInBig, tokenInDecimals));
    let amountOutNum: number = 0;
    let maximumInputRaw: string | undefined;
    let maximumInputFormatted: string | undefined;
    let minimumReceivedRaw: string = '0';
    let minimumReceivedNum: number = 0;

    let routes: SwapRoute[] = [];
    let bestRoute: SwapRoute;

    const slippagePct = request.slippageTolerancePercent !== undefined && !isNaN(request.slippageTolerancePercent) ? request.slippageTolerancePercent : 0.5;
    const slippageBps = Math.floor(slippagePct * 100);
    const quoteTimestamp = Date.now();
    const freshnessSeconds = 15;
    const expiresAt = quoteTimestamp + freshnessSeconds * 1000;
    const deadline = quoteTimestamp + (request.deadlineSeconds || 1200) * 1000;
    const deadlineSeconds = Math.floor(deadline / 1000);

    const sourceChainIdNum = sourceChain.chainId || 1;

    if (isCrossChain) {
      routes = await this.crossChainAggregator.findCrossChainRoutes({
        request: {
          ...request,
          amountInRaw: effectiveAmountInRaw,
          tokenIn: effectiveTokenIn,
          tokenOut: effectiveTokenOut,
          userWalletAddress: callerAddress,
          recipientAddress: targetRecipient
        },
        userAddress: callerAddress
      });

      if (routes.length === 0) {
        throw new ConfigurationError(
          `[ZenithRouter] No valid cross-chain bridge quote available for ${request.tokenIn.symbol} (${sourceChain.shortName}) -> ${request.tokenOut.symbol} (${destChain.shortName})`,
          'CROSS_CHAIN_QUOTE_UNAVAILABLE'
        );
      }

      bestRoute = routes[0];
      const ccQuote = bestRoute.crossChainQuote!;

      amountInBig = BigInt(ccQuote.sourceAmountRaw);
      amountOutBig = BigInt(ccQuote.destinationAmountRaw);
      minimumReceivedRaw = ccQuote.minDestinationAmountRaw;

      amountInNum = Number(formatTokenUnits(amountInBig, tokenInDecimals));
      amountOutNum = Number(formatTokenUnits(amountOutBig, tokenOutDecimals));
      minimumReceivedNum = Number(formatTokenUnits(BigInt(minimumReceivedRaw), tokenOutDecimals));

      if (callerAddress && !bestRoute.execution) {
        try {
          bestRoute.execution = await this.crossChainAggregator.buildExecution(
            ccQuote,
            callerAddress,
            targetRecipient || callerAddress
          );
        } catch {

        }
      }
    } else {
      if (tradeType === 'EXACT_INPUT') {
        if (request.amountInRaw) {
          amountInBig = BigInt(request.amountInRaw);
        } else if (request.amountIn !== undefined && request.amountIn !== null) {
          const inStr = request.amountIn.toString();
          amountInBig = BigInt(parseTokenUnits(inStr, tokenInDecimals));
        } else {
          amountInBig = 0n;
        }
        amountInNum = Number(formatTokenUnits(amountInBig, tokenInDecimals));
        if (amountInNum > MAX_SWAP_AMOUNT_NUM) {
          throw new Error(`Swap amount (${amountInNum.toLocaleString()}) exceeds maximum allowed limit of ${MAX_SWAP_AMOUNT_NUM.toLocaleString()}`);
        }
      } else {
        if (request.amountOutRaw) {
          amountOutBig = BigInt(request.amountOutRaw);
        } else if (request.amountOut !== undefined && request.amountOut !== null) {
          const outStr = request.amountOut.toString();
          amountOutBig = BigInt(parseTokenUnits(outStr, tokenOutDecimals));
        } else {
          amountOutBig = 0n;
        }
        amountOutNum = Number(formatTokenUnits(amountOutBig, tokenOutDecimals));
        if (amountOutNum > MAX_SWAP_AMOUNT_NUM) {
          throw new Error(`Swap amount (${amountOutNum.toLocaleString()}) exceeds maximum allowed limit of ${MAX_SWAP_AMOUNT_NUM.toLocaleString()}`);
        }

        const spotRatio = priceOutUSD / priceInUSD;
        const expectedInNum = amountOutNum * spotRatio * (10000 / 9970);
        const rawInStr = parseTokenUnits(expectedInNum.toFixed(Math.min(tokenInDecimals, 18)), tokenInDecimals);
        amountInBig = BigInt(rawInStr === '0' ? '1' : rawInStr);
        amountInNum = Number(formatTokenUnits(amountInBig, tokenInDecimals));
      }

      const dexQuotes = await this.dexAggregator.getQuotes({
        chainId: sourceChainIdNum,
        tokenIn: effectiveTokenIn,
        tokenOut: effectiveTokenOut,
        amountIn: amountInBig,
        slippageToleranceBps: slippageBps,
        recipient: targetRecipient || undefined
      });

      for (const dQuote of dexQuotes) {
        let execution = undefined;
        if (callerAddress) {
          try {
            execution = await this.dexAggregator.buildExecution(
              dQuote,
              callerAddress,
              targetRecipient || callerAddress,
              deadlineSeconds
            );
          } catch {

          }
        }

        routes.push({
          id: `route-direct-${dQuote.provider.toLowerCase()}-${sourceChain.id}`,
          routeType: 'DIRECT',
          hops: [
            {
              dexProtocol: dQuote.provider,
              poolAddress: dQuote.executionTarget,
              tokenIn: effectiveTokenIn,
              tokenOut: effectiveTokenOut,
              feeTierBps: dQuote.feeTierBps,
              proportionPercent: 100,
              estimatedGas: dQuote.gasEstimate
            }
          ],
          dexQuote: dQuote,
          execution,
          gasCostUSD: defaultChainRegistry.getEstimatedGasCostUSD(sourceChain.id, 'SWAP', request.gasPreset),
          estimatedGasUnits: dQuote.gasEstimate
        });
      }

      const isConnectorPair = effectiveTokenIn.symbol !== 'WETH' && effectiveTokenOut.symbol !== 'WETH' && effectiveTokenIn.symbol !== 'ETH' && effectiveTokenOut.symbol !== 'ETH';
      if (dexQuotes.length === 0 || isConnectorPair) {

        const connectorToken: Token = {
          address: sourceChain.id === 'polygon' ? '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270' : '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          chainId: sourceChain.id,
          name: 'Wrapped Ether',
          symbol: 'WETH',
          decimals: 18,
          priceUSD: 2450.0,
          verificationTier: 'VERIFIED_CANONICAL'
        };

        const hop1Quotes = await this.dexAggregator.getQuotes({
          chainId: sourceChainIdNum,
          tokenIn: effectiveTokenIn,
          tokenOut: connectorToken,
          amountIn: amountInBig,
          slippageToleranceBps: Math.floor(slippageBps / 2),
          recipient: targetRecipient || undefined
        });

        if (hop1Quotes.length > 0) {
          const hop1Quote = hop1Quotes[0];
          const hop2Quotes = await this.dexAggregator.getQuotes({
            chainId: sourceChainIdNum,
            tokenIn: connectorToken,
            tokenOut: effectiveTokenOut,
            amountIn: hop1Quote.amountOut,
            slippageToleranceBps: Math.floor(slippageBps / 2),
            recipient: targetRecipient || undefined
          });

          if (hop2Quotes.length > 0) {
            const hop2Quote = hop2Quotes[0];
            const multihopQuote: DEXQuote = {
              provider: hop1Quote.provider,
              providerName: `${hop1Quote.providerName} Multi-Hop`,
              chainId: sourceChainIdNum,
              tokenIn: effectiveTokenIn,
              tokenOut: effectiveTokenOut,
              amountIn: amountInBig,
              amountOut: hop2Quote.amountOut,
              minimumAmountOut: hop2Quote.minimumAmountOut,
              feeAmount: hop1Quote.feeAmount + hop2Quote.feeAmount,
              feeTierBps: hop1Quote.feeTierBps + hop2Quote.feeTierBps,
              priceImpactPercent: hop1Quote.priceImpactPercent + hop2Quote.priceImpactPercent,
              executionTarget: hop1Quote.executionTarget,
              approvalTarget: hop1Quote.approvalTarget,
              gasEstimate: hop1Quote.gasEstimate + hop2Quote.gasEstimate,
              gasCostUSD: hop1Quote.gasCostUSD + hop2Quote.gasCostUSD,
              quoteTimestamp: Date.now(),
              expiration: Date.now() + 15000
            };

            routes.push({
              id: `route-multihop-${sourceChain.id}`,
              routeType: 'MULTI_HOP',
              hops: [
                {
                  dexProtocol: hop1Quote.provider,
                  poolAddress: hop1Quote.executionTarget,
                  tokenIn: effectiveTokenIn,
                  tokenOut: connectorToken,
                  feeTierBps: hop1Quote.feeTierBps,
                  proportionPercent: 100,
                  estimatedGas: hop1Quote.gasEstimate
                },
                {
                  dexProtocol: hop2Quote.provider,
                  poolAddress: hop2Quote.executionTarget,
                  tokenIn: connectorToken,
                  tokenOut: effectiveTokenOut,
                  feeTierBps: hop2Quote.feeTierBps,
                  proportionPercent: 100,
                  estimatedGas: hop2Quote.gasEstimate
                }
              ],
              dexQuote: multihopQuote,
              gasCostUSD: defaultChainRegistry.getEstimatedGasCostUSD(sourceChain.id, 'SWAP', request.gasPreset),
              estimatedGasUnits: multihopQuote.gasEstimate
            });
          }
        }
      }

      if (dexQuotes.length === 0 && routes.length === 0) {
        throw new ConfigurationError(
          `[ZenithRouter] No DEX liquidity or route available on ${sourceChain.canonicalName} for ${request.tokenIn.symbol}/${request.tokenOut.symbol}`,
          'NO_DEX_QUOTE_AVAILABLE'
        );
      }

      if (routes.length > 0) {
        const primary = routes[0];

        routes.push({
          id: `route-split-${sourceChain.id}`,
          routeType: 'SPLIT_ROUTE',
          hops: [
            {
              dexProtocol: primary.dexQuote?.provider || 'UNISWAP_V3',
              poolAddress: primary.dexQuote?.executionTarget || '',
              tokenIn: effectiveTokenIn,
              tokenOut: effectiveTokenOut,
              feeTierBps: 30,
              proportionPercent: 60,
              estimatedGas: 90000n
            },
            {
              dexProtocol: primary.dexQuote?.provider || 'UNISWAP_V3',
              poolAddress: primary.dexQuote?.executionTarget || '',
              tokenIn: effectiveTokenIn,
              tokenOut: effectiveTokenOut,
              feeTierBps: 5,
              proportionPercent: 40,
              estimatedGas: 60000n
            }
          ],
          dexQuote: primary.dexQuote,
          gasCostUSD: primary.gasCostUSD,
          estimatedGasUnits: primary.estimatedGasUnits
        });

        routes.push({
          id: `route-zenith-v4-${sourceChain.id}`,
          routeType: 'DIRECT',
          hops: [
            {
              dexProtocol: 'ZENITH_V4_CONCENTRATED',
              poolAddress: primary.dexQuote?.executionTarget || '',
              tokenIn: effectiveTokenIn,
              tokenOut: effectiveTokenOut,
              feeTierBps: 15,
              proportionPercent: 100,
              estimatedGas: 135000n
            }
          ],
          dexQuote: primary.dexQuote,
          gasCostUSD: primary.gasCostUSD,
          estimatedGasUnits: 135000n
        });

        routes.push({
          id: `route-zenith-dutch-${sourceChain.id}`,
          routeType: 'DIRECT',
          hops: [
            {
              dexProtocol: 'ZENITH_DUTCH_INTENT',
              poolAddress: primary.dexQuote?.executionTarget || '',
              tokenIn: effectiveTokenIn,
              tokenOut: effectiveTokenOut,
              feeTierBps: 0,
              proportionPercent: 100,
              estimatedGas: 0n
            }
          ],
          dexQuote: primary.dexQuote,
          gasCostUSD: 0,
          estimatedGasUnits: 0n
        });
      }

      const executableRoute = routes.find((r) => r.execution && r.execution.data && r.execution.data !== '0x');
      bestRoute = executableRoute || routes[0];
      const bestDEXQuote = bestRoute.dexQuote!;
      amountOutBig = bestDEXQuote.amountOut;
      minimumReceivedRaw = bestDEXQuote.minimumAmountOut.toString();
      amountOutNum = Number(formatTokenUnits(amountOutBig, tokenOutDecimals));
      minimumReceivedNum = Number(formatTokenUnits(BigInt(minimumReceivedRaw), tokenOutDecimals));

      if (tradeType === 'EXACT_OUTPUT') {
        maximumInputRaw = this.scoringService.calculateMaximumInput(
          amountInBig.toString(),
          request.slippageTolerancePercent
        );
        maximumInputFormatted = Number(formatTokenUnits(BigInt(maximumInputRaw), tokenInDecimals)).toLocaleString(undefined, { maximumFractionDigits: 6 });
      }
    }

    const tradeValueUSD = amountInNum * priceInUSD;
    const executionPrice = amountInNum > 0 && amountOutNum > 0 ? (amountOutNum / amountInNum) : (priceInUSD / priceOutUSD);

    if (amountInBig <= 0n || amountOutBig <= 0n || amountInNum <= 0 || amountOutNum <= 0) {
      throw new ConfigurationError('QUOTE_INVALID: Quoted amount is zero or negative', 'QUOTE_INVALID');
    }

    if (BigInt(minimumReceivedRaw) > amountOutBig) {
      throw new ConfigurationError(
        'QUOTE_INVALID: Minimum received raw amount exceeds quoted output amount',
        'QUOTE_INVALID'
      );
    }

    if (priceInUSD > 0 && priceOutUSD > 0) {
      const spotRatio = priceInUSD / priceOutUSD;
      const isMicroDust = (amountInNum * priceInUSD < 0.001);
      if (!isMicroDust && (executionPrice > spotRatio * 100 || executionPrice < spotRatio / 100)) {
        throw new ConfigurationError(
          `QUOTE_INVALID: Quoted execution rate (${executionPrice}) diverges anomalously from reference market rate (${spotRatio})`,
          'QUOTE_INVALID'
        );
      }
    }

    const poolFeeBps = bestRoute.dexQuote?.feeTierBps || 30;
    const swapFeeRaw = ((amountInBig * BigInt(poolFeeBps)) / 10000n).toString();
    const swapFeeNum = (amountInNum * poolFeeBps) / 10000;
    const swapFeeUSD = request.tokenIn.priceUSD ? swapFeeNum * request.tokenIn.priceUSD : 0;
    const swapFee: SwapFee = {
      feeBps: poolFeeBps,
      feeAmountRaw: swapFeeRaw,
      feeAmountFormatted: swapFeeNum.toLocaleString(undefined, { maximumFractionDigits: 6 }),
      feeUSD: Number(swapFeeUSD.toFixed(4))
    };

    const protocolFee = this.scoringService.calculateProtocolFee({
      tokenIn: effectiveTokenIn,
      amountInRaw: amountInBig.toString(),
      amountInNum
    });

    const totalFeeBps = protocolFee.feeBps + poolFeeBps;
    const priceImpact = this.scoringService.calculatePriceImpact({
      tokenIn: effectiveTokenIn,
      tokenOut: effectiveTokenOut,
      amountInNum,
      amountOutExpectedNum: amountOutNum,
      referencePrice,
      feeBpsTotal: totalFeeBps
    });

    const effectiveExecutionScore = this.scoringService.calculateEffectiveExecutionScore({
      priceImpactPercent: priceImpact.percentage,
      gasCostUSD: bestRoute.gasCostUSD || 0.1,
      tradeValueUSD,
      slippagePercent: request.slippageTolerancePercent,
      hasBridgeStep: isCrossChain
    });

    let executableTransaction: ExecutableTransaction | undefined = undefined;
    if (bestRoute.execution && callerAddress && sourceChain.chainId) {
      executableTransaction = {
        to: bestRoute.execution.to,
        data: bestRoute.execution.data,
        value: bestRoute.execution.value,
        from: callerAddress,
        chainId: sourceChain.chainId,
        approvalTarget: bestRoute.execution.approvalTarget,
        amountInRaw: amountInBig.toString(),
        minimumOutRaw: minimumReceivedRaw
      };
    } else if (callerAddress && bestRoute.dexQuote && sourceChain.chainId) {
      try {
        const exec = await this.dexAggregator.buildExecution(
          bestRoute.dexQuote,
          callerAddress,
          targetRecipient || callerAddress,
          deadlineSeconds
        );
        if (exec && exec.data && exec.data !== '0x') {
          bestRoute.execution = exec;
          executableTransaction = {
            to: exec.to,
            data: exec.data,
            value: exec.value,
            from: callerAddress,
            chainId: sourceChain.chainId,
            approvalTarget: exec.approvalTarget,
            amountInRaw: amountInBig.toString(),
            minimumOutRaw: minimumReceivedRaw
          };
        }
      } catch (execErr) {
        console.warn('[ZenithRouter] Fallback buildExecution note:', execErr);
      }
    } else if (callerAddress && bestRoute.crossChainQuote && sourceChain.chainId) {
      try {
        const exec = await this.crossChainAggregator.buildExecution(
          bestRoute.crossChainQuote,
          callerAddress,
          targetRecipient || callerAddress
        );
        if (exec && exec.data && exec.data !== '0x') {
          bestRoute.execution = exec;
          executableTransaction = {
            to: exec.to,
            data: exec.data,
            value: exec.value,
            from: callerAddress,
            chainId: sourceChain.chainId,
            approvalTarget: exec.approvalTarget,
            amountInRaw: amountInBig.toString(),
            minimumOutRaw: minimumReceivedRaw
          };
        }
      } catch (execErr) {
        console.warn('[ZenithRouter] Fallback cross-chain buildExecution note:', execErr);
      }
    }

    const isExecutable = Boolean(
      callerAddress &&
      executableTransaction &&
      executableTransaction.data &&
      executableTransaction.data !== '0x' &&
      executableTransaction.data.length > 2
    );

    const validation: QuoteValidationResult = {
      isValid: true,
      isExecutable,
      errors: [],
      warnings: [],
      validatedAt: quoteTimestamp
    };

    if (amountInBig <= 0n) {
      validation.isValid = false;
      validation.errors.push('Amount in must be greater than zero');
    }
    if (amountOutBig <= 0n) {
      validation.isValid = false;
      validation.errors.push('Quoted amount out is zero');
    }
    if (!callerAddress) {
      validation.warnings.push('Wallet not connected. Connect wallet for executable signing calldata.');
    }
    if (callerAddress && (!executableTransaction || !isExecutable)) {
      validation.isValid = false;
      validation.isExecutable = false;
      validation.errors.push('Executable transaction could not be constructed');
    }

    const routerAddress = isCrossChain
      ? bestRoute.crossChainQuote?.executionTarget
      : (bestRoute.dexQuote?.executionTarget || (sourceChain.executionEnvironment === 'EVM' ? EVMContractRegistry.getPrimaryRouter(sourceChainIdNum) : undefined));

    let simulationPreview = undefined;
    if (routerAddress && callerAddress) {
      simulationPreview = await this.simulationEngine.simulateSwap({
        chainId: request.sourceChainId,
        userAddress: callerAddress,
        routerAddress,
        tokenIn: effectiveTokenIn,
        tokenOut: effectiveTokenOut,
        amountInRaw: amountInBig.toString(),
        amountOutExpectedRaw: amountOutBig.toString(),
        slippageTolerancePercent: request.slippageTolerancePercent,
        calldata: executableTransaction?.data || (isCrossChain ? bestRoute.crossChainQuote?.calldata : undefined)
      });
    }

    let intent: CrossChainIntent | undefined;
    if (isCrossChain) {
      const orderId = `intent_${Date.now()}_${this.intentNonceCounter++}`;
      intent = {
        orderId,
        sourceChainId: request.sourceChainId,
        destinationChainId: request.destinationChainId,
        sourceToken: effectiveTokenIn,
        destinationToken: effectiveTokenOut,
        sourceAmountRaw: amountInBig.toString(),
        minDestinationAmountRaw: minimumReceivedRaw,
        recipient: targetRecipient,
        deadline,
        nonce: this.intentNonceCounter,
        status: 'CREATED',
        solverId: bestRoute.crossChainQuote?.provider,
        createdAt: quoteTimestamp
      };
    }

    const uniqueNonce = this.intentNonceCounter++;
    return {
      requestId: `req_${Date.now()}_${uniqueNonce}`,
      request,
      tradeType,
      routes,
      bestRoute,
      amountIn: amountInBig.toString(),
      amountInRaw: amountInBig.toString(),
      amountInFormatted: amountInNum.toLocaleString(undefined, { maximumFractionDigits: 6 }),
      amountOut: amountOutBig.toString(),
      amountOutRaw: amountOutBig.toString(),
      amountOutFormatted: amountOutNum < 0.0001 ? amountOutNum.toFixed(6) : amountOutNum.toLocaleString(undefined, { maximumFractionDigits: 6 }),
      minimumReceivedRaw,
      minimumReceivedFormatted: minimumReceivedNum < 0.0001 ? minimumReceivedNum.toFixed(6) : minimumReceivedNum.toLocaleString(undefined, { maximumFractionDigits: 6 }),
      maximumInputRaw,
      maximumInputFormatted,
      executionPrice,
      referencePrice,
      priceImpact,
      protocolFee,
      swapFee,
      effectiveExecutionScore,
      quoteTimestamp,
      expiresAt,
      deadline,
      freshnessSeconds,
      simulationPreview,
      intent,
      dexQuote: bestRoute.dexQuote,
      crossChainQuote: bestRoute.crossChainQuote,
      executionTarget: executableTransaction?.to || routerAddress || '',
      approvalAddress: executableTransaction?.approvalTarget || (isCrossChain ? bestRoute.crossChainQuote?.approvalTarget : bestRoute.dexQuote?.approvalTarget) || '',
      calldata: executableTransaction?.data || (isCrossChain ? bestRoute.crossChainQuote?.calldata : bestRoute.dexQuote?.calldata) || '0x',
      isExecutable,
      executableTransaction,
      validation
    } as any;
  }
}

export const defaultZenithRouter = new ZenithRouter();
