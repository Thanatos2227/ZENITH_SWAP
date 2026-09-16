import { JsonRpcProvider, Provider, formatUnits } from 'ethers';
import {
  Token,
  QuoteRequest,
  QuoteResponse,
  DEXProtocol,
  SwapRoute
} from '@zenith/types';
import {
  ZenithRouter,
  parseTokenUnits,
  isNativeToken
} from '@zenith/routing';
import {
  EVMContractRegistry,
  getZenithTreasuryAddress,
  CANONICAL_NATIVE_ADDRESS
} from '@zenith/contracts';
import {
  ZenithSDKConfig,
  ZenithQuoteParams,
  ZenithQuoteResult,
  ZenithRouteParams,
  ZenithRoute,
  ZenithPoolInfo,
  LiquidityParams,
  ZenithV3PositionInfo,
  ZenithTreasuryInfo,
  UnsignedTransaction,
  SwapExecutionOptions
} from './types';
import { buildLiquidityTransaction } from './liquidity';
import { getPool, getPools, fetchTokenDetails } from './pools';
import { getZenithV3Position } from './positions';
import { getTreasuryInfo } from './treasury';

export class ZenithSDK {
  private router: ZenithRouter;
  private providers: Map<number, Provider> = new Map();
  private defaultSlippageBps: number;
  public readonly referralAddress?: string;

  constructor(config?: ZenithSDKConfig) {
    this.router = new ZenithRouter();
    this.defaultSlippageBps = config?.defaultSlippageBps ?? 50;
    this.referralAddress = config?.referralAddress;

    if (config?.providers) {
      for (const [chainIdStr, provider] of Object.entries(config.providers)) {
        this.providers.set(Number(chainIdStr), provider);
      }
    } else if (config?.rpcUrls) {
      for (const [chainIdStr, url] of Object.entries(config.rpcUrls)) {
        this.providers.set(Number(chainIdStr), new JsonRpcProvider(url));
      }
    }
  }

  public setProvider(chainId: number, provider: Provider): void {
    this.providers.set(chainId, provider);
  }

  public getProvider(chainId: number): Provider | undefined {
    return this.providers.get(chainId);
  }

  private async resolveToken(token: Token | string, chainId: number): Promise<Token> {
    if (typeof token === 'string') {
      const provider = this.providers.get(chainId);
      if (provider) {
        return fetchTokenDetails(provider, token, chainId);
      }
      return {
        chainId: chainId.toString(),
        address: token,
        symbol: 'TOKEN',
        name: 'Token',
        decimals: 18,
        isNative: isNativeToken(token),
        verificationTier: 'COMMUNITY_VERIFIED'
      };
    }
    return token;
  }

  public async getQuote(params: ZenithQuoteParams): Promise<ZenithQuoteResult> {
    const tokenIn = await this.resolveToken(params.tokenIn, params.chainId);
    const destChainId = params.destinationChainId ?? params.chainId;
    const tokenOut = await this.resolveToken(params.tokenOut, destChainId);

    const slippageBps = params.slippageToleranceBps ?? this.defaultSlippageBps;
    const slippagePercent = slippageBps / 100;

    const amountInRaw = typeof params.amountIn === 'bigint' ? params.amountIn.toString() : params.amountIn;
    const amountInFormatted = formatUnits(amountInRaw, tokenIn.decimals);

    const quoteRequest: QuoteRequest = {
      sourceChainId: params.chainId.toString(),
      destinationChainId: destChainId.toString(),
      tokenIn,
      tokenOut,
      amountInRaw,
      amountIn: amountInFormatted,
      tradeType: 'EXACT_INPUT',
      slippageTolerancePercent: slippagePercent,
      recipientAddress: params.recipient,
      userWalletAddress: params.recipient
    };

    const rawQuote = await this.router.getQuote(quoteRequest);
    const bestRoute = rawQuote.bestRoute;

    const amountInBig = BigInt(rawQuote.amountInRaw || parseTokenUnits(rawQuote.amountInFormatted, tokenIn.decimals));
    const amountOutBig = BigInt(rawQuote.amountOutRaw || parseTokenUnits(rawQuote.amountOutFormatted, tokenOut.decimals));
    const minReceivedBig = BigInt(rawQuote.minimumReceivedRaw || parseTokenUnits(rawQuote.minimumReceivedFormatted, tokenOut.decimals));

    let treasuryAddr = CANONICAL_NATIVE_ADDRESS;
    try {
      treasuryAddr = getZenithTreasuryAddress(params.chainId);
    } catch {

    }

    const protocolFeeBps = rawQuote.protocolFee?.feeBps ?? 5;
    const protocolFeeAmount = BigInt(rawQuote.protocolFee?.feeAmountRaw || ((amountInBig * BigInt(protocolFeeBps)) / 10000n).toString());

    const protocol = (bestRoute.dexQuote?.provider || bestRoute.hops?.[0]?.dexProtocol || 'ZENITH_V3') as DEXProtocol;
    const routePath = (bestRoute.path?.map(t => t.address) || [tokenIn.address, tokenOut.address]);

    return {
      sourceChainId: params.chainId,
      destinationChainId: destChainId,
      tokenIn,
      tokenOut,
      amountIn: amountInBig,
      amountOut: amountOutBig,
      minimumReceived: minReceivedBig,
      executionPrice: rawQuote.executionPrice,
      priceImpact: rawQuote.priceImpact?.percentage ?? 0,
      protocol,
      routePath,
      protocolFeeBps,
      protocolFeeAmount,
      treasuryAddress: treasuryAddr,
      estimatedGas: BigInt(rawQuote.bestRoute?.estimatedGasUnits ? rawQuote.bestRoute.estimatedGasUnits.toString() : '150000'),
      rawQuote
    };
  }

  public async getRoutes(params: ZenithRouteParams): Promise<ZenithRoute[]> {
    const tokenIn = await this.resolveToken(params.tokenIn, params.chainId);
    const destChainId = params.destinationChainId ?? params.chainId;
    const tokenOut = await this.resolveToken(params.tokenOut, destChainId);

    const amountInRaw = typeof params.amountIn === 'bigint' ? params.amountIn.toString() : params.amountIn;
    const amountInFormatted = formatUnits(amountInRaw, tokenIn.decimals);

    const quoteRequest: QuoteRequest = {
      sourceChainId: params.chainId.toString(),
      destinationChainId: destChainId.toString(),
      tokenIn,
      tokenOut,
      amountInRaw,
      amountIn: amountInFormatted,
      tradeType: 'EXACT_INPUT',
      slippageTolerancePercent: this.defaultSlippageBps / 100
    };

    const rawQuote = await this.router.getQuote(quoteRequest);
    const routesList = rawQuote.routes || [rawQuote.bestRoute];

    return routesList.map((route: SwapRoute) => {
      const outBig = route.dexQuote?.amountOut !== undefined
        ? BigInt(route.dexQuote.amountOut)
        : BigInt(route.amountOutRaw || (route.amountOutFormatted ? parseTokenUnits(route.amountOutFormatted, tokenOut.decimals) : '0'));

      const inBig = route.dexQuote?.amountIn !== undefined
        ? BigInt(route.dexQuote.amountIn)
        : BigInt(route.amountInRaw || (route.amountInFormatted ? parseTokenUnits(route.amountInFormatted, tokenIn.decimals) : '0'));

      const proto = (route.dexQuote?.provider || route.hops?.[0]?.dexProtocol || 'ZENITH_V3') as DEXProtocol;

      let executionTarget = CANONICAL_NATIVE_ADDRESS;
      try {
        executionTarget = EVMContractRegistry.getRouterForProtocol(proto, Number(params.chainId));
      } catch {

      }

      return {
        protocol: proto,
        tokenIn,
        tokenOut,
        amountIn: inBig,
        amountOut: outBig,
        priceImpact: route.priceImpact?.percentage ?? 0,
        gasCostEstimateWei: BigInt(route.estimatedGasUnits ? route.estimatedGasUnits.toString() : '100000'),
        path: route.path?.map(t => t.address) || [tokenIn.address, tokenOut.address],
        executionTarget
      };
    });
  }

  public async buildSwapTransaction(
    quote: ZenithQuoteResult | QuoteResponse,
    _options?: SwapExecutionOptions
  ): Promise<UnsignedTransaction> {
    const rawQuote: QuoteResponse = 'rawQuote' in quote ? quote.rawQuote : quote;
    const isNativeIn = Boolean(rawQuote.request.tokenIn.isNative);
    const bestRoute = rawQuote.bestRoute;

    let to = bestRoute.execution?.to;
    let data = bestRoute.execution?.data;
    let value = bestRoute.execution?.value ? BigInt(bestRoute.execution.value) : 0n;

    if (!to || !data || data === '0x') {
      const proto = ('protocol' in quote && quote.protocol)
        ? quote.protocol
        : (bestRoute.dexQuote?.provider || bestRoute.hops?.[0]?.dexProtocol || 'ZENITH_V3');

      const routerTarget = EVMContractRegistry.getRouterForProtocol(
        proto,
        Number(rawQuote.request.sourceChainId)
      );
      to = routerTarget;
      data = '0x';
      if (isNativeIn) {
        value = BigInt(rawQuote.amountInRaw || parseTokenUnits(rawQuote.amountInFormatted, rawQuote.request.tokenIn.decimals));
      }
    }

    return {
      to,
      data,
      value,
      chainId: Number(rawQuote.request.sourceChainId)
    };
  }

  public async buildLiquidityTransaction(params: LiquidityParams): Promise<UnsignedTransaction> {
    return buildLiquidityTransaction(params);
  }

  public async getPool(
    chainId: number,
    address: string,
    protocol: DEXProtocol = 'ZENITH_V3'
  ): Promise<ZenithPoolInfo> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`Provider for chain ${chainId} not found in ZenithSDK. Call setProvider() or supply rpcUrls.`);
    }
    return getPool(provider, chainId, address, protocol);
  }

  public async getPools(chainId: number, protocol?: DEXProtocol): Promise<ZenithPoolInfo[]> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`Provider for chain ${chainId} not found in ZenithSDK. Call setProvider() or supply rpcUrls.`);
    }
    return getPools(provider, chainId, protocol);
  }

  public async getPosition(chainId: number, tokenId: string | bigint): Promise<ZenithV3PositionInfo> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`Provider for chain ${chainId} not found in ZenithSDK. Call setProvider() or supply rpcUrls.`);
    }
    return getZenithV3Position(provider, chainId, tokenId);
  }

  public async getTreasuryInfo(chainId: number): Promise<ZenithTreasuryInfo> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`Provider for chain ${chainId} not found in ZenithSDK. Call setProvider() or supply rpcUrls.`);
    }
    return getTreasuryInfo(provider, chainId);
  }
}

export const zenithSDK = new ZenithSDK();
