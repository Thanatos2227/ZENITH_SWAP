import { DEXProtocol, Token } from '@zenith/types';
import { DEXProvider, DEXQuote, DEXExecution } from './types';
import { ZenithV1Provider } from './zenithV1Provider';
import { ZenithV2Provider } from './zenithV2Provider';
import { ZenithV3Provider } from './zenithV3Provider';
import { UniswapV3Provider } from './uniswapV3Provider';
import { QuickSwapProvider } from './quickswapProvider';
import { AerodromeProvider } from './aerodromeProvider';
import { VelodromeProvider } from './velodromeProvider';
import { CamelotProvider } from './camelotProvider';
import { PancakeSwapProvider } from './pancakeSwapProvider';
import { TraderJoeProvider } from './traderJoeProvider';

export class DEXAggregator {
  private providers: Map<DEXProtocol, DEXProvider> = new Map();

  constructor(customProviders?: DEXProvider[]) {
    if (customProviders && customProviders.length > 0) {
      for (const p of customProviders) {
        this.providers.set(p.protocol, p);
      }
    } else {

      this.registerProvider(new ZenithV3Provider());
      this.registerProvider(new ZenithV2Provider());
      this.registerProvider(new ZenithV1Provider());

      this.registerProvider(new UniswapV3Provider());
      this.registerProvider(new QuickSwapProvider());
      this.registerProvider(new AerodromeProvider());
      this.registerProvider(new VelodromeProvider());
      this.registerProvider(new CamelotProvider());
      this.registerProvider(new PancakeSwapProvider());
      this.registerProvider(new TraderJoeProvider());
    }
  }

  public registerProvider(provider: DEXProvider): void {
    this.providers.set(provider.protocol, provider);
  }

  public getProvider(protocol: DEXProtocol): DEXProvider | undefined {
    return this.providers.get(protocol);
  }

  public async getQuotes(params: {
    chainId: number;
    tokenIn: Token;
    tokenOut: Token;
    amountIn: bigint;
    slippageToleranceBps: number;
    recipient?: string;
  }): Promise<DEXQuote[]> {
    const applicableProviders = Array.from(this.providers.values()).filter((p) =>
      p.supportedChainIds.includes(params.chainId)
    );

    if (applicableProviders.length === 0) {
      return [];
    }

    const quotePromises = applicableProviders.map(async (provider) => {
      try {
        return await provider.getQuote(params);
      } catch {
        return null;
      }
    });

    const results = await Promise.allSettled(quotePromises);
    const validQuotes: DEXQuote[] = [];

    for (const res of results) {
      if (res.status === 'fulfilled' && res.value !== null) {
        validQuotes.push(res.value);
      }
    }

    validQuotes.sort((a, b) => {
      if (b.amountOut > a.amountOut) return 1;
      if (b.amountOut < a.amountOut) return -1;
      return 0;
    });

    return validQuotes;
  }

  public async getBestQuote(params: {
    chainId: number;
    tokenIn: Token;
    tokenOut: Token;
    amountIn: bigint;
    slippageToleranceBps: number;
    recipient?: string;
  }): Promise<DEXQuote | null> {
    const quotes = await this.getQuotes(params);
    return quotes.length > 0 ? quotes[0] : null;
  }

  public async buildExecution(
    quote: DEXQuote,
    userAddress: string,
    recipientAddress?: string,
    deadline?: number
  ): Promise<DEXExecution> {
    const provider = this.providers.get(quote.provider);
    if (!provider) {
      throw new Error(`No provider registered for DEX protocol: ${quote.provider}`);
    }
    return provider.buildExecution(quote, userAddress, recipientAddress, deadline);
  }
}

export const defaultDEXAggregator = new DEXAggregator();
