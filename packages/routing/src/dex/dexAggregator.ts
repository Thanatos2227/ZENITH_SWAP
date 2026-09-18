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

export type DEXAggregationMode = 'ZENITH_ONLY' | 'ZENITH_SOVEREIGN' | 'EXTERNAL_AGGREGATION';
export const SOVEREIGN_ZENITH_PROTOCOLS: DEXProtocol[] = ['ZENITH_V1', 'ZENITH_V2', 'ZENITH_V3'];
const ZENITH_V3_FEE_TIERS_BPS = [1, 5, 30, 100];

export class DEXAggregator {
  private providers: Map<DEXProtocol, DEXProvider> = new Map();
  private mode: DEXAggregationMode = 'EXTERNAL_AGGREGATION';

  constructor(customProviders?: DEXProvider[], mode: DEXAggregationMode = 'EXTERNAL_AGGREGATION') {
    this.mode = mode;
    if (customProviders && customProviders.length > 0) {
      for (const p of customProviders) this.providers.set(p.protocol, p);
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

  public setExecutionMode(mode: DEXAggregationMode): void { this.mode = mode; }
  public getExecutionMode(): DEXAggregationMode { return this.mode; }
  public registerProvider(provider: DEXProvider): void { this.providers.set(provider.protocol, provider); }
  public getProvider(protocol: DEXProtocol): DEXProvider | undefined { return this.providers.get(protocol); }
  public isSovereignMode(mode?: DEXAggregationMode): boolean {
    const active = mode || this.mode;
    return active === 'ZENITH_ONLY' || active === 'ZENITH_SOVEREIGN';
  }

  public async getQuotes(params: {
    chainId: number;
    tokenIn: Token;
    tokenOut: Token;
    amountIn: bigint;
    slippageToleranceBps: number;
    recipient?: string;
    mode?: DEXAggregationMode;
  }): Promise<DEXQuote[]> {
    const activeMode = params.mode || this.mode;
    const isSovereign = this.isSovereignMode(activeMode);
    const applicableProviders = Array.from(this.providers.values()).filter((p) => {
      if (isSovereign && !SOVEREIGN_ZENITH_PROTOCOLS.includes(p.protocol)) return false;
      return p.supportedChainIds.includes(params.chainId);
    });
    if (applicableProviders.length === 0) return [];

    const quotePromises: Promise<DEXQuote | null>[] = [];
    for (const provider of applicableProviders) {
      if (provider.protocol === 'ZENITH_V3') {
        for (const feeTierBps of ZENITH_V3_FEE_TIERS_BPS) {
          quotePromises.push((async () => {
            try {
              return await provider.getQuote({ ...params, feeTierBps } as any);
            } catch {
              return null;
            }
          })());
        }
      } else {
        quotePromises.push((async () => {
          try {
            return await provider.getQuote(params);
          } catch {
            return null;
          }
        })());
      }
    }

    const results = await Promise.allSettled(quotePromises);
    const validQuotes: DEXQuote[] = [];
    for (const res of results) {
      if (res.status === 'fulfilled' && res.value !== null) validQuotes.push(res.value);
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
    mode?: DEXAggregationMode;
  }): Promise<DEXQuote | null> {
    const quotes = await this.getQuotes(params);
    return quotes.length > 0 ? quotes[0] : null;
  }

  public async buildExecution(
    quote: DEXQuote,
    userAddress: string,
    recipientAddress?: string,
    deadline?: number,
    mode?: DEXAggregationMode
  ): Promise<DEXExecution> {
    const activeMode = mode || this.mode;
    if (this.isSovereignMode(activeMode) && !SOVEREIGN_ZENITH_PROTOCOLS.includes(quote.provider)) {
      throw new Error(`ZENITH_EXTERNAL_EXECUTION_DETECTED: external protocol ${quote.provider} is prohibited in ZENITH_ONLY mode (sovereign mode)`);
    }
    const provider = this.providers.get(quote.provider);
    if (!provider) throw new Error(`No provider registered for DEX protocol: ${quote.provider}`);
    return provider.buildExecution(quote, userAddress, recipientAddress, deadline);
  }
}

export const defaultDEXAggregator = new DEXAggregator();
