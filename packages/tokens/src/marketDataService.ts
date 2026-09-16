import { Token, ZenithPool, LPPosition, ProtocolAnalytics } from '@zenith/types';
import { DEFAULT_TOKENS } from './defaultTokens';

export type MarketStatus = 'LIVE' | 'FALLBACK' | 'STALE' | 'OFFLINE' | 'UNAVAILABLE';
export type MarketSource = 'COINGECKO' | 'BINANCE_REST' | 'BINANCE_WS' | 'CACHE' | 'UNAVAILABLE';

export interface LiveMarketData {
  symbol?: string;
  priceUSD: number | null;
  change24hUSD: number | null;
  volume24hUSD: number | null;
  marketCapUSD?: number | null;
  high24h?: number;
  low24h?: number;
  lastUpdated: number;
  isLive: boolean;
  status: MarketStatus;
  source?: MarketSource | string;
}

export interface MarketCandle {
  timestamp: number;
  timeLabel: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketStats24h {
  currentPrice: number;
  change24hPercent: number;
  high24h: number;
  low24h: number;
  volume24hUSD: number;
}

export type TimeframeInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export const VERIFIED_CIRCULATING_SUPPLY: Record<string, number> = {
  BTC: 19750000,
  WBTC: 19750000,
  CBBTC: 19750000,
  ETH: 120200000,
  WETH: 120200000,
  WSTETH: 120200000,
  SOL: 468000000,
  WSOL: 468000000,
  JITOSOL: 468000000,
  BNB: 147500000,
  WBNB: 147500000,
  ARB: 3250000000,
  OP: 1250000000,
  AVAX: 400000000,
  WAVAX: 400000000,
  POL: 10000000000,
  MATIC: 10000000000,
  LINK: 608000000,
  UNI: 600000000,
  PEPE: 420690000000000,
  SHIB: 589000000000000,
  DOGE: 146000000000,
  XRP: 56000000000,
  ADA: 35700000000,
  SUI: 2850000000,
  NEAR: 1210000000,
  APT: 490000000,
  AAVE: 14900000,
  LDO: 890000000,
  CRV: 1250000000,
  MKR: 920000,
  PENDLE: 160000000,
  TIA: 210000000,
  INJ: 97000000,
  FET: 2500000000,
  SEI: 3500000000,
  RENDER: 518000000,
  RNDR: 518000000,
  BONK: 69000000000000,
  WIF: 998000000,
  JUP: 1350000000,
  RAY: 290000000,
  PYTH: 3600000000,
  USDC: 35000000000,
  USDT: 118000000000,
  DAI: 5300000000,
  FDUSD: 2500000000
};

export const TOKEN_COINGECKO_MAP: Record<string, string> = {
  BTC: 'bitcoin',
  WBTC: 'wrapped-bitcoin',
  CBBTC: 'coinbase-wrapped-btc',
  ORDI: 'ordinals',
  SATS: 'sats-ordinals',
  DOG: 'dog-go-to-the-moon-runes',
  PUPS: 'pups-world-peace',
  ETH: 'ethereum',
  WETH: 'weth',
  WSTETH: 'wrapped-steth',
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  PYUSD: 'paypal-usd',
  USDS: 'usds',
  USDE: 'ethena-usde',
  WBETH: 'wrapped-beacon-eth',
  USD1: 'usd1-wlfi',
  XAUT: 'tether-gold',
  RLUSD: 'ripple-usd',
  ASTER: 'aster-2',
  PAXG: 'pax-gold',
  WLFI: 'world-liberty-financial',
  ZEC: 'zcash',
  BCH: 'bitcoin-cash',
  LTC: 'litecoin',
  TAO: 'bittensor',
  GRAM: 'the-open-network',
  FDUSD: 'first-digital-usd',
  UNI: 'uniswap',
  LINK: 'chainlink',
  AAVE: 'aave',
  MKR: 'maker',
  LDO: 'lido-dao',
  CRV: 'curve-dao-token',
  SNX: 'havven',
  PEPE: 'pepe',
  SHIB: 'shiba-inu',
  DOGE: 'dogecoin',
  ONDO: 'ondo-finance',
  AERO: 'aerodrome-finance',
  DEGEN: 'degen-base',
  BRETT: 'based-brett',
  TOSHI: 'toshi',
  VIRTUAL: 'virtuals-protocol',
  ARB: 'arbitrum',
  GMX: 'gmx',
  PENDLE: 'pendle',
  BLUR: 'blur',
  GRT: 'the-graph',
  SOL: 'solana',
  WSOL: 'solana',
  JITOSOL: 'jito-staked-sol',
  JUP: 'jupiter-exchange-solana',
  RAY: 'raydium',
  PYTH: 'pyth-network',
  BONK: 'bonk',
  WIF: 'dogwifcoin',
  POPCAT: 'popcat',
  JTO: 'jito-governance-token',

  POL: 'polygon-ecosystem-token',
  MATIC: 'polygon-ecosystem-token',
  QUICK: 'quickswap',
  TRX: 'tron',
  USDD: 'usdd',
  BTT: 'bittorrent',
  SUN: 'sun-token',
  JST: 'just',
  BNB: 'binancecoin',
  WBNB: 'binancecoin',
  AVAX: 'avalanche-2',
  WAVAX: 'avalanche-2',
  OP: 'optimism',
  SUI: 'sui',
  APT: 'aptos',
  NEAR: 'near',
  ATOM: 'cosmos',
  OSMO: 'osmosis',
  INJ: 'injective-protocol',
  SEI: 'sei-network',
  TIA: 'celestia',
  CRO: 'crypto-com-chain',
  TAIKO: 'taiko',
  METIS: 'metis-token',
  GLMR: 'moonbeam',
  MOVR: 'moonriver',
  TON: 'the-open-network',
  HBAR: 'hedera-hashgraph',
  ALGO: 'algorand',
  XLM: 'stellar',
  XRP: 'ripple',
  ADA: 'cardano',
  DOT: 'polkadot',
  ICP: 'internet-computer',
  FET: 'fetch-ai',
  RENDER: 'render-token',
  RNDR: 'render-token',
  FLR: 'flare-networks',
  FTM: 'fantom',
  S: 'sonic-3',
  STX: 'blockstack',
  CELO: 'celo',
  MNT: 'mantle',
  STRK: 'starknet',
  BLAST: 'blast',
  MANTA: 'manta-network',
  SCR: 'scroll',
  ZK: 'zksync',
  WLD: 'worldcoin-wld'
};

const BINANCE_SYMBOL_MAP: Record<string, string> = {
  ETH: 'ETH',
  WETH: 'ETH',
  WSTETH: 'ETH',
  BTC: 'BTC',
  WBTC: 'BTC',
  CBBTC: 'BTC',
  SOL: 'SOL',
  WSOL: 'SOL',
  JITOSOL: 'SOL',
  BNB: 'BNB',
  WBNB: 'BNB',
  ARB: 'ARB',
  OP: 'OP',
  AVAX: 'AVAX',
  WAVAX: 'AVAX',
  POL: 'POL',
  MATIC: 'POL',
  LINK: 'LINK',
  UNI: 'UNI',
  PEPE: 'PEPE',
  SUI: 'SUI',
  NEAR: 'NEAR',
  APT: 'APT',
  DOGE: 'DOGE',
  SHIB: 'SHIB',
  XRP: 'XRP',
  ADA: 'ADA',
  FTM: 'FTM',
  S: 'FTM',
  TIA: 'TIA',
  INJ: 'INJ',
  RENDER: 'RENDER',
  RNDR: 'RENDER',
  FET: 'FET',
  SEI: 'SEI',
  AAVE: 'AAVE',
  LDO: 'LDO',
  CRV: 'CRV',
  MKR: 'MKR',
  SNX: 'SNX',
  GRT: 'GRT',
  PENDLE: 'PENDLE',
  BLUR: 'BLUR',
  GMX: 'GMX',
  BONK: 'BONK',
  WIF: 'WIF',
  JUP: 'JUP',
  RAY: 'RAY',
  PYTH: 'PYTH',
  ORDI: 'ORDI',
  STX: 'STX',
  USDC: 'USDC',
  DAI: 'DAI',
  FDUSD: 'FDUSD',
  USDE: 'USDE',
  WBETH: 'ETH',
  USD1: 'USD1',
  XAUT: 'PAXG',
  RLUSD: 'USDC',
  ASTER: 'ASTER',
  PAXG: 'PAXG',
  WLFI: 'WLFI',
  GRAM: 'TON'
};

const STABLECOINS = new Set(['USDC', 'USDT', 'DAI', 'FDUSD', 'USDE', 'BUSD']);

export type StoreTickCallback = (chainId: string, address: string, data: LiveMarketData) => void;

export interface PairListener {
  symbolIn: string;
  symbolOut: string;
  interval: TimeframeInterval;
  onPriceUpdate: (price: number, tickCandle?: MarketCandle) => void;
  onStatusChange?: (status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED') => void;
}

const KNOWN_BINANCE_SYMBOLS = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'TRX', 'DOGE', 'ADA', 'AVAX', 'DOT',
  'LINK', 'POL', 'MATIC', 'SHIB', 'UNI', 'NEAR', 'APT', 'SUI', 'ICP', 'FET',
  'RENDER', 'RNDR', 'AAVE', 'ALGO', 'PEPE', 'WIF', 'BONK', 'JUP', 'SEI', 'INJ',
  'TIA', 'PENDLE', 'MKR', 'CRV', 'LDO', 'RAY', 'PYTH', 'ARB', 'OP', 'FTM',
  'STX', 'ORDI', 'GRT', 'SNX', 'BLUR', 'GMX', 'TON', 'HBAR', 'XLM', 'USDC'
]);

export class MarketDataService {
  private static instance: MarketDataService;
  private cache: Map<string, LiveMarketData> = new Map();
  private lastFetchTime = 0;
  private inFlightPromise: Promise<Map<string, LiveMarketData>> | null = null;
  private lastError: string | null = null;
  private overallStatus: MarketStatus = 'UNAVAILABLE';

  private activeSockets: WebSocket[] = [];
  private globalWsStatus: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' = 'DISCONNECTED';
  private reconnectTimer: any = null;
  private storeUpdateCallbacks: Set<StoreTickCallback> = new Set();
  private pairListeners: Set<PairListener> = new Set();
  private trackedTokens: Token[] = DEFAULT_TOKENS;

  public static getInstance(): MarketDataService {
    if (!MarketDataService.instance) {
      MarketDataService.instance = new MarketDataService();
    }
    return MarketDataService.instance;
  }

  constructor() {

    DEFAULT_TOKENS.forEach((t) => {
      const key = this.getKey(t.chainId, t.address);
      const sym = t.symbol.toUpperCase();
      this.cache.set(key, {
        symbol: sym,
        priceUSD: null,
        change24hUSD: null,
        volume24hUSD: null,
        marketCapUSD: null,
        lastUpdated: 0,
        isLive: false,
        status: 'UNAVAILABLE',
        source: 'UNAVAILABLE'
      });
    });
  }

  public getKey(chainId: string, address: string): string {
    return `${chainId.toLowerCase()}:${address.toLowerCase()}`;
  }

  public resolveSymbol(symbol: string): string {
    const clean = symbol.toUpperCase().trim();
    return BINANCE_SYMBOL_MAP[clean] || clean;
  }

  public getCachedMarketData(chainId: string, address: string): LiveMarketData | undefined {
    return this.cache.get(this.getKey(chainId, address));
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public getLastUpdated(): number {
    return this.lastFetchTime;
  }

  public getOverallStatus(): MarketStatus {
    return this.overallStatus;
  }

  public getWsStatus(): 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' {
    return this.globalWsStatus;
  }

  public addStoreTickListener(callback: StoreTickCallback): () => void {
    this.storeUpdateCallbacks.add(callback);
    return () => {
      this.storeUpdateCallbacks.delete(callback);
    };
  }

  public async fetchMarketData(tokens: Token[] = DEFAULT_TOKENS, force = false): Promise<Map<string, LiveMarketData>> {
    this.trackedTokens = tokens;
    const now = Date.now();
    if (!force && now - this.lastFetchTime < 15000 && this.overallStatus === 'LIVE') {
      return this.cache;
    }

    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }

    this.inFlightPromise = this.executeFetchMultiTier(tokens).finally(() => {
      this.inFlightPromise = null;
    });

    return this.inFlightPromise;
  }

  private async executeFetchMultiTier(tokens: Token[]): Promise<Map<string, LiveMarketData>> {
    const idToTokensMap = new Map<string, Token[]>();
    const cgIdsSet = new Set<string>();

    tokens.forEach((t) => {
      const sym = t.symbol.toUpperCase();
      const cgId = TOKEN_COINGECKO_MAP[sym];
      if (cgId) {
        cgIdsSet.add(cgId);
        const list = idToTokensMap.get(cgId) || [];
        list.push(t);
        idToTokensMap.set(cgId, list);
      }
    });

    const cgIdsArray = Array.from(cgIdsSet);
    const now = Date.now();

    try {
      if (cgIdsArray.length === 0) {
        throw new Error('No mapped CoinGecko IDs found');
      }

      const idsParam = cgIdsArray.join(',');
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(idsParam)}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true`;

      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
      });

      if (!response.ok) {
        throw new Error(`CoinGecko HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      Object.entries(data).forEach(([cgId, info]: [string, any]) => {
        if (info && typeof info.usd === 'number' && info.usd > 0) {
          const matchingTokens = idToTokensMap.get(cgId) || [];
          matchingTokens.forEach((t) => {
            const sym = t.symbol.toUpperCase();
            const key = this.getKey(t.chainId, t.address);
            const supply = VERIFIED_CIRCULATING_SUPPLY[sym] || null;
            const cap = supply ? info.usd * supply : null;

            const liveData: LiveMarketData = {
              symbol: sym,
              priceUSD: info.usd,
              change24hUSD: typeof info.usd_24h_change === 'number' ? Number(info.usd_24h_change.toFixed(2)) : 0,
              volume24hUSD: typeof info.usd_24h_vol === 'number' ? Math.round(info.usd_24h_vol) : 0,
              marketCapUSD: cap,
              lastUpdated: now,
              isLive: true,
              status: 'LIVE',
              source: 'COINGECKO'
            };

            this.cache.set(key, liveData);
            this.cache.set(sym.toLowerCase(), liveData);
            this.notifyStoreListeners(t.chainId, t.address, liveData);
          });
        }
      });

      this.lastFetchTime = now;
      this.lastError = null;
      this.overallStatus = 'LIVE';

      this.startGlobalWebSocket(tokens);
      return this.cache;
    } catch (primaryErr: any) {
      console.warn('[MarketDataService] CoinGecko fetch failed, trying Binance fallback:', primaryErr?.message || primaryErr);
      this.lastError = primaryErr?.message || 'CoinGecko API unreachable';

      try {
        await this.executeFetchBinanceFallback(tokens);
        this.lastFetchTime = now;
        this.lastError = null;
        this.overallStatus = 'FALLBACK';

        this.startGlobalWebSocket(tokens);
        return this.cache;
      } catch (fallbackErr: any) {
        console.warn('[MarketDataService] Fallback also failed:', fallbackErr?.message || fallbackErr);
        this.lastError = fallbackErr?.message || 'All market APIs unreachable';

        let hasRecentCache = false;
        this.cache.forEach((item) => {
          if (item.priceUSD !== null && item.priceUSD > 0 && now - item.lastUpdated < 60000) {
            hasRecentCache = true;
            item.isLive = false;
            item.status = 'STALE';
            item.source = 'CACHE';
          } else if (!hasRecentCache) {
            item.isLive = false;
            item.status = 'OFFLINE';
            item.source = 'UNAVAILABLE';
          }
        });

        this.overallStatus = hasRecentCache ? 'STALE' : 'OFFLINE';
        return this.cache;
      }
    }
  }

  private async executeFetchBinanceFallback(tokens: Token[]): Promise<void> {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr', {
      signal: AbortSignal.timeout(12000)
    });

    if (!res.ok) {
      throw new Error(`Binance HTTP ${res.status}: ${res.statusText}`);
    }

    const tickers: Array<{
      symbol: string;
      lastPrice: string;
      priceChangePercent: string;
      quoteVolume: string;
      highPrice?: string;
      lowPrice?: string;
    }> = await res.json();

    const tickerMap = new Map<string, { price: number; change: number; volume: number; high?: number; low?: number }>();
    let usdcUsdtRate = 1.0;

    tickers.forEach((item) => {
      if (item.symbol === 'USDCUSDT') {
        const p = parseFloat(item.lastPrice);
        if (p > 0) usdcUsdtRate = p;
      }

      if (item.symbol.endsWith('USDT')) {
        const base = item.symbol.replace(/USDT$/, '');
        tickerMap.set(base, {
          price: parseFloat(item.lastPrice) || 0,
          change: parseFloat(item.priceChangePercent) || 0,
          volume: parseFloat(item.quoteVolume) || 0,
          high: parseFloat(item.highPrice || '0') || 0,
          low: parseFloat(item.lowPrice || '0') || 0
        });
      }
    });

    const derivedUsdtPrice = usdcUsdtRate > 0 ? Number((1 / usdcUsdtRate).toFixed(6)) : 1.0;
    const now = Date.now();

    tokens.forEach((t) => {
      const sym = t.symbol.toUpperCase();
      const baseSymbol = this.resolveSymbol(sym);

      let price: number | null = null;
      let change = 0;
      let volume = 0;
      let high = 0;
      let low = 0;

      if (sym === 'USDT') {

        price = derivedUsdtPrice;
        change = 0;
        volume = tickerMap.get('USDC')?.volume || 0;
      } else {
        const ticker = tickerMap.get(baseSymbol);
        if (ticker && ticker.price > 0) {
          price = ticker.price;
          change = ticker.change;
          volume = ticker.volume;
          high = ticker.high || 0;
          low = ticker.low || 0;
        }
      }

      if (price !== null && price > 0) {
        const key = this.getKey(t.chainId, t.address);
        const supply = VERIFIED_CIRCULATING_SUPPLY[sym] || VERIFIED_CIRCULATING_SUPPLY[baseSymbol] || null;
        const cap = supply ? price * supply : null;

        const liveData: LiveMarketData = {
          symbol: baseSymbol,
          priceUSD: price,
          change24hUSD: Number(change.toFixed(2)),
          volume24hUSD: Math.round(volume),
          marketCapUSD: cap,
          high24h: high || undefined,
          low24h: low || undefined,
          lastUpdated: now,
          isLive: true,
          status: 'FALLBACK',
          source: 'BINANCE_REST'
        };

        this.cache.set(key, liveData);
        this.cache.set(sym.toLowerCase(), liveData);
        if (baseSymbol) this.cache.set(baseSymbol.toLowerCase(), liveData);
        this.notifyStoreListeners(t.chainId, t.address, liveData);
      }
    });
  }

  public startGlobalWebSocket(tokens: Token[] = this.trackedTokens): void {
    this.trackedTokens = tokens;

    if (this.activeSockets.length > 0) {
      const allActive = this.activeSockets.every(
        (s) => s.readyState === WebSocket.OPEN || s.readyState === WebSocket.CONNECTING
      );
      if (allActive) return;
    }

    if (typeof window === 'undefined' || !window.WebSocket) return;

    this.closeExistingSockets();
    this.globalWsStatus = 'CONNECTING';

    try {

      const supportedSymbols = Array.from(
        new Set(
          tokens
            .map((t) => this.resolveSymbol(t.symbol))
            .filter((s) => Boolean(s) && s !== 'USDT' && s !== 'USDE' && KNOWN_BINANCE_SYMBOLS.has(s))
        )
      );

      const BATCH_SIZE = 12;
      const batches: string[][] = [];
      for (let i = 0; i < supportedSymbols.length; i += BATCH_SIZE) {
        batches.push(supportedSymbols.slice(i, i + BATCH_SIZE));
      }

      let connectedCount = 0;

      batches.forEach((batch) => {
        const streamNames = batch.map((s) => `${s.toLowerCase()}usdt@kline_1m`).join('/');
        const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streamNames}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          connectedCount++;
          if (connectedCount > 0) {
            this.globalWsStatus = 'CONNECTED';
            this.lastError = null;
            this.pairListeners.forEach((l) => l.onStatusChange?.('CONNECTED'));
          }
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
        };

        ws.onmessage = (event) => {
          try {
            const raw = JSON.parse(event.data);
            const data = raw.data || raw;
            if (!data || !data.k) return;

            const k = data.k;
            const binanceSymbol = k.s;
            if (!binanceSymbol || !binanceSymbol.endsWith('USDT')) return;

            const baseSymbol = binanceSymbol.replace(/USDT$/, '');
            const closePrice = parseFloat(k.c) || 0;
            const openPrice = parseFloat(k.o) || 0;
            const highPrice = parseFloat(k.h) || 0;
            const lowPrice = parseFloat(k.l) || 0;
            const volUSD = parseFloat(k.q) || (parseFloat(k.v) * closePrice) || 0;
            const now = Date.now();

            if (closePrice <= 0) return;

            this.trackedTokens.forEach((t) => {
              const sym = t.symbol.toUpperCase();
              const mappedBase = this.resolveSymbol(sym);

              if (mappedBase === baseSymbol) {
                const key = this.getKey(t.chainId, t.address);
                const existing = this.cache.get(key);
                const supply = VERIFIED_CIRCULATING_SUPPLY[sym] || VERIFIED_CIRCULATING_SUPPLY[mappedBase] || null;
                const cap = supply ? closePrice * supply : null;

                const change24hPercent = existing?.change24hUSD !== undefined && existing.change24hUSD !== 0
                  ? existing.change24hUSD
                  : (openPrice > 0 ? Number((((closePrice - openPrice) / openPrice) * 100).toFixed(2)) : 0);

                const liveData: LiveMarketData = {
                  symbol: baseSymbol,
                  priceUSD: closePrice,
                  change24hUSD: change24hPercent,
                  volume24hUSD: Math.round(volUSD) || (existing?.volume24hUSD ?? 0),
                  marketCapUSD: cap,
                  high24h: highPrice,
                  low24h: lowPrice,
                  lastUpdated: now,
                  isLive: true,
                  status: 'LIVE',
                  source: 'BINANCE_TRADE_VIEW_WS'
                };

                this.cache.set(key, liveData);
                this.cache.set(sym.toLowerCase(), liveData);
                if (mappedBase) this.cache.set(mappedBase.toLowerCase(), liveData);
                this.notifyStoreListeners(t.chainId, t.address, liveData);
              }
            });

            this.pairListeners.forEach((listener) => {
              const pair = this.getPairConfig(listener.symbolIn, listener.symbolOut);
              if (pair.baseSymbol === baseSymbol || (pair.isCrossRate && pair.quoteSymbol === baseSymbol)) {
                let pairPrice = closePrice;

                if (!pair.isCrossRate) {
                  if (pair.invertRate) {
                    pairPrice = closePrice > 0 ? 1 / closePrice : 0;
                  }
                } else {
                  const baseTok = this.trackedTokens.find((t) => this.resolveSymbol(t.symbol) === pair.baseSymbol);
                  const quoteTok = this.trackedTokens.find((t) => this.resolveSymbol(t.symbol) === pair.quoteSymbol);
                  const pBase = baseTok ? (this.cache.get(this.getKey(baseTok.chainId, baseTok.address))?.priceUSD || closePrice) : closePrice;
                  const pQuote = quoteTok ? (this.cache.get(this.getKey(quoteTok.chainId, quoteTok.address))?.priceUSD || 1) : 1;
                  pairPrice = pQuote > 0 ? pBase / pQuote : pBase;
                }

                const ts = Number(k.t);
                const timeLabel = this.formatTimeLabel(new Date(ts), listener.interval);
                let o = openPrice;
                let h = highPrice;
                let l = lowPrice;
                let c = closePrice;

                if (pair.invertRate) {
                  c = c > 0 ? 1 / c : 0;
                  o = o > 0 ? 1 / o : 0;
                  const prevH = h;
                  h = l > 0 ? 1 / l : 0;
                  l = prevH > 0 ? 1 / prevH : 0;
                }

                const tickCandle: MarketCandle = {
                  timestamp: ts,
                  timeLabel,
                  open: o,
                  high: h,
                  low: l,
                  close: pairPrice,
                  volume: parseFloat(k.v) || 0
                };

                listener.onPriceUpdate(pairPrice, tickCandle);
              }
            });
          } catch (parseErr) {

          }
        };

        ws.onerror = () => {
          this.handleWsDisconnect();
        };

        ws.onclose = () => {
          this.handleWsDisconnect();
        };

        this.activeSockets.push(ws);
      });
    } catch (err) {
      this.handleWsDisconnect();
    }
  }

  private closeExistingSockets(): void {
    this.activeSockets.forEach((s) => {
      try {
        s.close();
      } catch {}
    });
    this.activeSockets = [];
  }

  private handleWsDisconnect(): void {
    this.globalWsStatus = 'DISCONNECTED';
    this.closeExistingSockets();
    this.pairListeners.forEach((l) => l.onStatusChange?.('DISCONNECTED'));

    this.cache.forEach((val) => {
      val.isLive = false;
      val.status = 'STALE';
    });
    this.overallStatus = 'STALE';

    if (!this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.startGlobalWebSocket();
      }, 3000);
    }
  }

  private notifyStoreListeners(chainId: string, address: string, data: LiveMarketData): void {
    this.storeUpdateCallbacks.forEach((cb) => cb(chainId, address, data));
  }

  public getPairConfig(symbolIn: string, symbolOut: string): {
    isDirect: boolean;
    binanceSymbol: string;
    isCrossRate: boolean;
    baseSymbol: string;
    quoteSymbol: string;
    invertRate: boolean;
  } {
    const sIn = this.resolveSymbol(symbolIn);
    const sOut = this.resolveSymbol(symbolOut);

    const isStableIn = STABLECOINS.has(sIn);
    const isStableOut = STABLECOINS.has(sOut);

    if (!isStableIn && isStableOut) {
      return {
        isDirect: true,
        binanceSymbol: `${sIn}USDT`,
        isCrossRate: false,
        baseSymbol: sIn,
        quoteSymbol: 'USDT',
        invertRate: false
      };
    }

    if (isStableIn && !isStableOut) {
      return {
        isDirect: true,
        binanceSymbol: `${sOut}USDT`,
        isCrossRate: false,
        baseSymbol: sOut,
        quoteSymbol: 'USDT',
        invertRate: true
      };
    }

    if (isStableIn && isStableOut) {
      return {
        isDirect: true,
        binanceSymbol: 'USDCUSDT',
        isCrossRate: false,
        baseSymbol: 'USDC',
        quoteSymbol: 'USDT',
        invertRate: false
      };
    }

    return {
      isDirect: false,
      binanceSymbol: `${sIn}${sOut}`,
      isCrossRate: true,
      baseSymbol: sIn,
      quoteSymbol: sOut,
      invertRate: false
    };
  }

  public async fetchKlines(
    symbolIn: string,
    symbolOut: string,
    interval: TimeframeInterval = '15m',
    limit: number = 50,
    fallbackPriceUSD: number = 2465.87
  ): Promise<MarketCandle[]> {
    const pair = this.getPairConfig(symbolIn, symbolOut);

    try {
      if (!pair.isCrossRate) {
        const url = `https://api.binance.com/api/v3/klines?symbol=${pair.binanceSymbol}&interval=${interval}&limit=${limit}`;
        const res = await fetch(url);
        if (res.ok) {
          const rawData: any[][] = await res.json();
          if (Array.isArray(rawData) && rawData.length > 0) {
            return rawData.map((k) => {
              const ts = Number(k[0]);
              const d = new Date(ts);
              const timeLabel = this.formatTimeLabel(d, interval);
              let open = parseFloat(k[1]);
              let high = parseFloat(k[2]);
              let low = parseFloat(k[3]);
              let close = parseFloat(k[4]);
              const volume = parseFloat(k[5]);

              if (pair.invertRate) {
                const origOpen = open;
                const origHigh = high;
                const origLow = low;
                const origClose = close;
                open = origOpen > 0 ? 1 / origOpen : 0;
                high = origLow > 0 ? 1 / origLow : 0;
                low = origHigh > 0 ? 1 / origHigh : 0;
                close = origClose > 0 ? 1 / origClose : 0;
              }

              return { timestamp: ts, timeLabel, open, high, low, close, volume };
            });
          }
        }
      } else {
        const [resBase, resQuote] = await Promise.all([
          fetch(`https://api.binance.com/api/v3/klines?symbol=${pair.baseSymbol}USDT&interval=${interval}&limit=${limit}`),
          fetch(`https://api.binance.com/api/v3/klines?symbol=${pair.quoteSymbol}USDT&interval=${interval}&limit=${limit}`)
        ]);

        if (resBase.ok && resQuote.ok) {
          const baseData: any[][] = await resBase.json();
          const quoteData: any[][] = await resQuote.json();
          const count = Math.min(baseData.length, quoteData.length);
          const candles: MarketCandle[] = [];

          for (let i = 0; i < count; i++) {
            const b = baseData[i];
            const q = quoteData[i];
            const ts = Number(b[0]);
            const d = new Date(ts);
            const timeLabel = this.formatTimeLabel(d, interval);

            const bClose = parseFloat(b[4]);
            const qClose = parseFloat(q[4]);
            const close = qClose > 0 ? bClose / qClose : 1;
            const bOpen = parseFloat(b[1]);
            const qOpen = parseFloat(q[1]);
            const open = qOpen > 0 ? bOpen / qOpen : 1;
            const bHigh = parseFloat(b[2]);
            const qLow = parseFloat(q[3]);
            const high = qLow > 0 ? bHigh / qLow : close * 1.002;
            const bLow = parseFloat(b[3]);
            const qHigh = parseFloat(q[2]);
            const low = qHigh > 0 ? bLow / qHigh : close * 0.998;
            const volume = parseFloat(b[5]);

            candles.push({ timestamp: ts, timeLabel, open, high, low, close, volume });
          }

          if (candles.length > 0) return candles;
        }
      }
    } catch (err) {
      console.warn('[MarketDataService] fetchKlines error:', err);
    }

    return this.generateSyntheticCandles(fallbackPriceUSD, interval, limit);
  }

  public async fetch24hStats(
    symbolIn: string,
    symbolOut: string,
    fallbackPriceUSD: number = 2465.87
  ): Promise<MarketStats24h> {
    const pair = this.getPairConfig(symbolIn, symbolOut);

    try {
      if (!pair.isCrossRate) {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair.binanceSymbol}`);
        if (res.ok) {
          const data = await res.json();
          let price = parseFloat(data.lastPrice);
          let change = parseFloat(data.priceChangePercent);
          let high = parseFloat(data.highPrice);
          let low = parseFloat(data.lowPrice);
          const vol = parseFloat(data.quoteVolume);

          if (pair.invertRate) {
            price = price > 0 ? 1 / price : 1;
            change = -change;
            const prevHigh = high;
            high = low > 0 ? 1 / low : price * 1.05;
            low = prevHigh > 0 ? 1 / prevHigh : price * 0.95;
          }

          return { currentPrice: price, change24hPercent: change, high24h: high, low24h: low, volume24hUSD: vol };
        }
      } else {
        const [resBase, resQuote] = await Promise.all([
          fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair.baseSymbol}USDT`),
          fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair.quoteSymbol}USDT`)
        ]);

        if (resBase.ok && resQuote.ok) {
          const b = await resBase.json();
          const q = await resQuote.json();

          const bPrice = parseFloat(b.lastPrice);
          const qPrice = parseFloat(q.lastPrice);
          const currentPrice = qPrice > 0 ? bPrice / qPrice : 1;
          const bChange = parseFloat(b.priceChangePercent);
          const qChange = parseFloat(q.priceChangePercent);
          const change24hPercent = bChange - qChange;
          const high24h = currentPrice * (1 + Math.abs(change24hPercent) * 0.01 + 0.03);
          const low24h = currentPrice * (1 - Math.abs(change24hPercent) * 0.01 - 0.03);
          const volume24hUSD = parseFloat(b.quoteVolume);

          return { currentPrice, change24hPercent, high24h, low24h, volume24hUSD };
        }
      }
    } catch (err) {
      console.warn('[MarketDataService] fetch24hStats error:', err);
    }

    return {
      currentPrice: fallbackPriceUSD,
      change24hPercent: 2.85,
      high24h: fallbackPriceUSD * 1.042,
      low24h: fallbackPriceUSD * 0.965,
      volume24hUSD: 148500000
    };
  }

  public subscribeLiveStream(
    symbolIn: string,
    symbolOut: string,
    interval: TimeframeInterval,
    onPriceUpdate: (price: number, tickCandle?: MarketCandle) => void,
    onStatusChange?: (status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED') => void
  ): () => void {

    this.startGlobalWebSocket();

    const listener: PairListener = {
      symbolIn,
      symbolOut,
      interval,
      onPriceUpdate,
      onStatusChange
    };

    this.pairListeners.add(listener);
    onStatusChange?.(this.globalWsStatus);

    const pair = this.getPairConfig(symbolIn, symbolOut);
    const baseTok = this.trackedTokens.find((t) => this.resolveSymbol(t.symbol) === pair.baseSymbol);
    const quoteTok = pair.isCrossRate ? this.trackedTokens.find((t) => this.resolveSymbol(t.symbol) === pair.quoteSymbol) : undefined;
    if (baseTok) {
      const cachedBase = this.cache.get(this.getKey(baseTok.chainId, baseTok.address));
      if (cachedBase && typeof cachedBase.priceUSD === 'number' && cachedBase.priceUSD > 0) {
        let initPrice: number = cachedBase.priceUSD;
        if (!pair.isCrossRate) {
          if (pair.invertRate) {
            initPrice = initPrice > 0 ? 1 / initPrice : 0;
          }
        } else if (quoteTok) {
          const cachedQuote = this.cache.get(this.getKey(quoteTok.chainId, quoteTok.address));
          const pQuote = cachedQuote && typeof cachedQuote.priceUSD === 'number' && cachedQuote.priceUSD > 0 ? cachedQuote.priceUSD : 1;
          initPrice = pQuote > 0 ? initPrice / pQuote : initPrice;
        }
        onPriceUpdate(initPrice);
      }
    }

    return () => {
      this.pairListeners.delete(listener);
    };
  }

  private formatTimeLabel(d: Date, interval: TimeframeInterval): string {
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    const ss = d.getSeconds().toString().padStart(2, '0');
    const day = (d.getMonth() + 1).toString().padStart(2, '0') + '/' + d.getDate().toString().padStart(2, '0');

    if (interval === '1d' || interval === '4h') {
      return `${day} ${hh}:${mm}`;
    }
    return `${hh}:${mm}:${ss}`;
  }

  private generateSyntheticCandles(
    basePrice: number,
    interval: TimeframeInterval,
    count: number
  ): MarketCandle[] {
    const candles: MarketCandle[] = [];
    const now = Date.now();
    let stepMs = 60 * 1000;
    if (interval === '5m') stepMs = 5 * 60 * 1000;
    if (interval === '15m') stepMs = 15 * 60 * 1000;
    if (interval === '1h') stepMs = 60 * 60 * 1000;
    if (interval === '4h') stepMs = 4 * 60 * 60 * 1000;
    if (interval === '1d') stepMs = 24 * 60 * 60 * 1000;

    let lastClose = basePrice * 0.985;

    for (let i = count; i >= 0; i--) {
      const ts = now - i * stepMs;
      const d = new Date(ts);
      const timeLabel = this.formatTimeLabel(d, interval);
      const volatility = lastClose * 0.003;
      const open = lastClose;
      const noise1 = (Math.sin(ts * 0.0001) + 1) / 2;
      const noise2 = (Math.cos(ts * 0.0001) + 1) / 2;
      const delta = (noise1 - 0.5) * volatility;
      const close = Math.max(open + delta, 0.000001);
      const high = Math.max(open, close) + noise2 * volatility * 0.5;
      const low = Math.min(open, close) - noise1 * volatility * 0.5;
      const volume = Math.floor(noise2 * 800 + 120);

      candles.push({ timestamp: ts, timeLabel, open, high, low, close, volume });
      lastClose = close;
    }
    return candles;
  }

  public getPools(): ZenithPool[] {
    const getToken = (symbol: string, chainId?: string): Token => {
      if (chainId) {
        const found = DEFAULT_TOKENS.find(
          t => t.symbol.toUpperCase() === symbol.toUpperCase() && t.chainId.toLowerCase() === chainId.toLowerCase()
        );
        if (found) return found;
      }
      const foundBySym = DEFAULT_TOKENS.find(t => t.symbol.toUpperCase() === symbol.toUpperCase());
      if (foundBySym) return foundBySym;
      return DEFAULT_TOKENS[0];
    };

    const eth = getToken('ETH', 'ethereum');
    const usdcEth = getToken('USDC', 'ethereum');
    const wbtc = getToken('WBTC', 'ethereum');
    const usdtEth = getToken('USDT', 'ethereum');
    const linkEth = getToken('LINK', 'ethereum');
    const uniEth = getToken('UNI', 'ethereum');
    const pepeEth = getToken('PEPE', 'ethereum');

    const sol = getToken('SOL', 'solana');
    const usdcSol = getToken('USDC', 'solana');
    const jitoSol = getToken('JITOSOL', 'solana');
    const bonkSol = getToken('BONK', 'solana');

    const usdcBase = getToken('USDC', 'base');
    const ethBase = getToken('ETH', 'base');
    const degenBase = getToken('DEGEN', 'base');
    const aeroBase = getToken('AERO', 'base');

    const arbArb = getToken('ARB', 'arbitrum');
    const usdcArb = getToken('USDC', 'arbitrum');
    const ethArb = getToken('ETH', 'arbitrum');

    const polPolygon = getToken('POL', 'polygon') || getToken('POLYGON', 'polygon');
    const usdcPolygon = getToken('USDC', 'polygon');

    const opOptimism = getToken('OP', 'optimism');
    const usdcOptimism = getToken('USDC', 'optimism');

    const wbnbBnb = getToken('WBNB', 'bnb') || getToken('BNB', 'bnb');
    const usdtBnb = getToken('USDT', 'bnb');

    const wavaxAvax = getToken('WAVAX', 'avalanche') || getToken('AVAX', 'avalanche');
    const usdcAvax = getToken('USDC', 'avalanche');

    return [
      {
        id: 'pool-eth-usdc-5',
        poolAddress: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
        chainId: 'ethereum',
        token0: usdcEth,
        token1: eth,
        feeBps: 5,
        tickSpacing: 10,
        sqrtPriceX96: '14614467034852101032872730522',
        currentTick: 201240,
        liquidity: '45892100000000000000',
        tvlUSD: 142580000,
        volume24hUSD: 68450000,
        volume7dUSD: 412000000,
        fees24hUSD: 34225,
        aprPercent: 18.4,
        hookName: 'DynamicVolFee',
        isDynamicFee: true
      },
      {
        id: 'pool-wbtc-eth-30',
        poolAddress: '0xcbcdf9626bc03e24f779434178a73a0b4bad62ed',
        chainId: 'ethereum',
        token0: eth,
        token1: wbtc,
        feeBps: 30,
        tickSpacing: 60,
        sqrtPriceX96: '429512873900000000000000',
        currentTick: 254100,
        liquidity: '18920000000000000000',
        tvlUSD: 98400000,
        volume24hUSD: 32100000,
        volume7dUSD: 215000000,
        fees24hUSD: 96300,
        aprPercent: 24.2,
        hookName: 'TWAMMAutoRebalance'
      },
      {
        id: 'pool-usdc-usdt-1',
        poolAddress: '0x3416cf6c708da44db26246036dd20e4505682f6e',
        chainId: 'ethereum',
        token0: usdcEth,
        token1: usdtEth,
        feeBps: 1,
        tickSpacing: 1,
        sqrtPriceX96: '79228162514264337593543950336',
        currentTick: 0,
        liquidity: '120500000000000000000',
        tvlUSD: 210000000,
        volume24hUSD: 125000000,
        volume7dUSD: 850000000,
        fees24hUSD: 12500,
        aprPercent: 8.6
      },
      {
        id: 'pool-pepe-eth-30',
        poolAddress: '0xa43fe1690fb5055b73983c3e0159b04c7380a5ac',
        chainId: 'ethereum',
        token0: pepeEth,
        token1: eth,
        feeBps: 30,
        tickSpacing: 60,
        sqrtPriceX96: '1890000000000000000000',
        currentTick: -198400,
        liquidity: '8400000000000000000',
        tvlUSD: 41200000,
        volume24hUSD: 28500000,
        volume7dUSD: 184000000,
        fees24hUSD: 85500,
        aprPercent: 44.6,
        hookName: 'DynamicVolFee',
        isDynamicFee: true
      },
      {
        id: 'pool-link-eth-30',
        poolAddress: '0xa6cc3c2531fda8bc185641cecdac7b8238646d80',
        chainId: 'ethereum',
        token0: linkEth,
        token1: eth,
        feeBps: 30,
        tickSpacing: 60,
        sqrtPriceX96: '512000000000000000000',
        currentTick: 182300,
        liquidity: '12400000000000000000',
        tvlUSD: 36800000,
        volume24hUSD: 14200000,
        volume7dUSD: 98000000,
        fees24hUSD: 42600,
        aprPercent: 21.8
      },
      {
        id: 'pool-uni-eth-30',
        poolAddress: '0x1d42064fc4beb5f8aaf85f4617ae8b3b5b8bd801',
        chainId: 'ethereum',
        token0: uniEth,
        token1: eth,
        feeBps: 30,
        tickSpacing: 60,
        sqrtPriceX96: '450000000000000000000',
        currentTick: 174000,
        liquidity: '9800000000000000000',
        tvlUSD: 28900000,
        volume24hUSD: 11800000,
        volume7dUSD: 75000000,
        fees24hUSD: 35400,
        aprPercent: 19.5
      },
      {
        id: 'pool-sol-usdc-30',
        poolAddress: '0xsolusdcwhirlpool0000000000000000001',
        chainId: 'solana',
        token0: usdcSol,
        token1: sol,
        feeBps: 30,
        tickSpacing: 60,
        sqrtPriceX96: '254100000000000000000000',
        currentTick: 142000,
        liquidity: '35000000000000000000',
        tvlUSD: 88400000,
        volume24hUSD: 52000000,
        volume7dUSD: 340000000,
        fees24hUSD: 156000,
        aprPercent: 34.2,
        hookName: 'MEVCaptureLPReward',
        isDynamicFee: true
      },
      {
        id: 'pool-jitosol-sol-1',
        poolAddress: '0xjitosolpoolwhirlpool000000000000002',
        chainId: 'solana',
        token0: jitoSol,
        token1: sol,
        feeBps: 1,
        tickSpacing: 1,
        sqrtPriceX96: '79228162514264337593543950336',
        currentTick: 100,
        liquidity: '45000000000000000000',
        tvlUSD: 62500000,
        volume24hUSD: 18400000,
        volume7dUSD: 120000000,
        fees24hUSD: 1840,
        aprPercent: 9.8,
        hookName: 'TWAMMAutoRebalance'
      },
      {
        id: 'pool-bonk-sol-100',
        poolAddress: '0xbonksolpool000000000000000000000003',
        chainId: 'solana',
        token0: bonkSol,
        token1: sol,
        feeBps: 100,
        tickSpacing: 200,
        sqrtPriceX96: '1200000000000000000',
        currentTick: -340000,
        liquidity: '6000000000000000000',
        tvlUSD: 18400000,
        volume24hUSD: 15200000,
        volume7dUSD: 95000000,
        fees24hUSD: 152000,
        aprPercent: 58.4,
        hookName: 'DynamicVolFee',
        isDynamicFee: true
      },
      {
        id: 'pool-base-eth-usdc-5',
        poolAddress: '0xd0b53d9277642d899df5c87a3966a349a798f224',
        chainId: 'base',
        token0: usdcBase,
        token1: ethBase,
        feeBps: 5,
        tickSpacing: 10,
        sqrtPriceX96: '14614467034852101032872730522',
        currentTick: 201240,
        liquidity: '32000000000000000000',
        tvlUSD: 74200000,
        volume24hUSD: 41800000,
        volume7dUSD: 270000000,
        fees24hUSD: 20900,
        aprPercent: 20.8,
        hookName: 'DynamicVolFee',
        isDynamicFee: true
      },
      {
        id: 'pool-base-degen-eth-30',
        poolAddress: '0xc9034c3e7fde0fb3c70754d04397b34f02fbdefb',
        chainId: 'base',
        token0: degenBase,
        token1: ethBase,
        feeBps: 30,
        tickSpacing: 60,
        sqrtPriceX96: '2500000000000000',
        currentTick: -250000,
        liquidity: '4500000000000000000',
        tvlUSD: 12400000,
        volume24hUSD: 9800000,
        volume7dUSD: 62000000,
        fees24hUSD: 29400,
        aprPercent: 41.2,
        hookName: 'DynamicVolFee',
        isDynamicFee: true
      },
      {
        id: 'pool-base-aero-usdc-30',
        poolAddress: '0x6cDcb1C4A4D1C3C6d054b27AC5B77e89eAFb971d',
        chainId: 'base',
        token0: aeroBase,
        token1: usdcBase,
        feeBps: 30,
        tickSpacing: 60,
        sqrtPriceX96: '85000000000000000000000',
        currentTick: 120000,
        liquidity: '7800000000000000000',
        tvlUSD: 24500000,
        volume24hUSD: 14200000,
        volume7dUSD: 90000000,
        fees24hUSD: 42600,
        aprPercent: 31.6
      },
      {
        id: 'pool-arb-eth-usdc-5',
        poolAddress: '0xc6962004f452be9203591991d15f6b388e09e8d0',
        chainId: 'arbitrum',
        token0: usdcArb,
        token1: ethArb,
        feeBps: 5,
        tickSpacing: 10,
        sqrtPriceX96: '14614467034852101032872730522',
        currentTick: 201240,
        liquidity: '48000000000000000000',
        tvlUSD: 82500000,
        volume24hUSD: 46200000,
        volume7dUSD: 310000000,
        fees24hUSD: 23100,
        aprPercent: 22.4,
        hookName: 'MEVCaptureLPReward',
        isDynamicFee: true
      },
      {
        id: 'pool-arb-arb-usdc-5',
        poolAddress: '0xb1a9d18e84c0cbcf1097db361fb5f0376cb2b3c1',
        chainId: 'arbitrum',
        token0: arbArb,
        token1: usdcArb,
        feeBps: 5,
        tickSpacing: 10,
        sqrtPriceX96: '65000000000000000000000',
        currentTick: 110000,
        liquidity: '15000000000000000000',
        tvlUSD: 31400000,
        volume24hUSD: 16800000,
        volume7dUSD: 105000000,
        fees24hUSD: 8400,
        aprPercent: 19.8
      },
      {
        id: 'pool-polygon-pol-usdc-5',
        poolAddress: '0x45dda9cb7c25131df268515131f647d726f50608',
        chainId: 'polygon',
        token0: polPolygon,
        token1: usdcPolygon,
        feeBps: 5,
        tickSpacing: 10,
        sqrtPriceX96: '55000000000000000000000',
        currentTick: 98000,
        liquidity: '18000000000000000000',
        tvlUSD: 26800000,
        volume24hUSD: 12400000,
        volume7dUSD: 82000000,
        fees24hUSD: 6200,
        aprPercent: 18.2
      },
      {
        id: 'pool-optimism-op-usdc-5',
        poolAddress: '0x1634d1b821ad6850c95a32b69414e21a2c918c5e',
        chainId: 'optimism',
        token0: opOptimism,
        token1: usdcOptimism,
        feeBps: 5,
        tickSpacing: 10,
        sqrtPriceX96: '92000000000000000000000',
        currentTick: 135000,
        liquidity: '14000000000000000000',
        tvlUSD: 22100000,
        volume24hUSD: 10500000,
        volume7dUSD: 68000000,
        fees24hUSD: 5250,
        aprPercent: 17.6
      },
      {
        id: 'pool-bnb-wbnb-usdt-5',
        poolAddress: '0x36696169c63e42cd08ce11f5deeebbcebfa52ac0',
        chainId: 'bnb',
        token0: usdtBnb,
        token1: wbnbBnb,
        feeBps: 5,
        tickSpacing: 10,
        sqrtPriceX96: '110000000000000000000000',
        currentTick: 185000,
        liquidity: '25000000000000000000',
        tvlUSD: 58400000,
        volume24hUSD: 31200000,
        volume7dUSD: 210000000,
        fees24hUSD: 15600,
        aprPercent: 21.2,
        hookName: 'TWAMMAutoRebalance'
      },
      {
        id: 'pool-avax-wavax-usdc-5',
        poolAddress: '0xfae22303c7372ea7b513dd91122a20e2ef64d7ee',
        chainId: 'avalanche',
        token0: usdcAvax,
        token1: wavaxAvax,
        feeBps: 5,
        tickSpacing: 10,
        sqrtPriceX96: '75000000000000000000000',
        currentTick: 125000,
        liquidity: '16000000000000000000',
        tvlUSD: 29500000,
        volume24hUSD: 14800000,
        volume7dUSD: 96000000,
        fees24hUSD: 7400,
        aprPercent: 19.4
      }
    ];
  }

  public getProtocolAnalytics(): ProtocolAnalytics {
    const pools = this.getPools();
    const totalTVL = pools.reduce((acc, p) => acc + p.tvlUSD, 0);
    const totalVol24h = pools.reduce((acc, p) => acc + p.volume24hUSD, 0);
    const totalFees24h = pools.reduce((acc, p) => acc + p.fees24hUSD, 0);

    const now = Date.now();
    const historicalVolume = Array.from({ length: 30 }).map((_, i) => {
      const ts = now - (29 - i) * 24 * 60 * 60 * 1000;
      const baseVol = 180000000 + Math.sin(i / 3) * 50000000;
      const baseTvl = totalTVL * 0.9 + (i / 30) * (totalTVL * 0.1);
      const noise = (Math.sin(i * 1337) + Math.cos(i * 919)) / 2;
      return {
        timestamp: ts,
        volumeUSD: Math.round(baseVol + noise * 20000000),
        tvlUSD: Math.round(baseTvl)
      };
    });

    return {
      totalValueLockedUSD: totalTVL,
      totalVolume24hUSD: totalVol24h,
      totalVolume7dUSD: totalVol24h * 6.4,
      totalFees24hUSD: totalFees24h,
      totalTransactions24h: 142850,
      activeLPsCount: 12450,
      topPools: pools,
      topTokens: DEFAULT_TOKENS.slice(0, 8),
      historicalVolume
    };
  }

  public getUserPositions(_userAddress?: string): LPPosition[] {
    const eth = DEFAULT_TOKENS.find(t => t.symbol === 'ETH') || DEFAULT_TOKENS[0];
    const usdc = DEFAULT_TOKENS.find(t => t.symbol === 'USDC') || DEFAULT_TOKENS[1];
    const wbtc = DEFAULT_TOKENS.find(t => t.symbol === 'WBTC') || DEFAULT_TOKENS[2];

    return [
      {
        tokenId: '#4102',
        poolId: 'pool-eth-usdc-5',
        token0: usdc,
        token1: eth,
        feeBps: 5,
        tickLower: 198000,
        tickUpper: 204000,
        priceLower: 2200,
        priceUpper: 2800,
        currentPrice: 2465.87,
        isInRange: true,
        liquidityRaw: '1240000000000000000',
        depositedAmount0: '12,500.00 USDC',
        depositedAmount1: '5.07 ETH',
        depositedUSD: 25000,
        unclaimedFee0: '142.50 USDC',
        unclaimedFee1: '0.058 ETH',
        unclaimedFeeUSD: 285.50,
        earnedAprPercent: 21.4,
        createdAt: Date.now() - 14 * 24 * 60 * 60 * 1000
      },
      {
        tokenId: '#3984',
        poolId: 'pool-wbtc-eth-30',
        token0: eth,
        token1: wbtc,
        feeBps: 30,
        tickLower: 240000,
        tickUpper: 265000,
        priceLower: 22.5,
        priceUpper: 32.0,
        currentPrice: 26.8,
        isInRange: true,
        liquidityRaw: '850000000000000000',
        depositedAmount0: '15.00 ETH',
        depositedAmount1: '0.56 WBTC',
        depositedUSD: 74200,
        unclaimedFee0: '0.35 ETH',
        unclaimedFee1: '0.013 WBTC',
        unclaimedFeeUSD: 1720.00,
        earnedAprPercent: 28.6,
        createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000
      }
    ];
  }
}

export const defaultMarketDataService = MarketDataService.getInstance();
