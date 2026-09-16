import React, { useState, useEffect } from 'react';
import { useZenithStore } from '../../stores/useZenithStore';
import { MARKET_TOKENS, defaultTokenService, defaultMarketDataService, VERIFIED_CIRCULATING_SUPPLY } from '@zenith/tokens';
import { defaultChainRegistry } from '@zenith/chains';
import { Token } from '@zenith/types';
import { TokenLogo } from '../common/TokenLogo';
import {
  TrendingUp,
  TrendingDown,
  Search,
  ArrowRight,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

export const MarketsView: React.FC = () => {
  const {
    setTokenIn,
    setTokenOut,
    setSourceChain,
    setDestChain,
    setActiveTab,
    marketData,
    isMarketsLoading,
    marketsError,
    lastMarketUpdate,
    marketDataStatus,
    fetchMarketData
  } = useZenithStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [networkTypeFilter, setNetworkTypeFilter] = useState('ALL');
  const [chainFilter, setChainFilter] = useState('ALL');

  useEffect(() => {
    fetchMarketData();
    const interval = setInterval(() => {
      fetchMarketData();
    }, 20000);
    return () => clearInterval(interval);
  }, [fetchMarketData]);

  const filteredTokens = MARKET_TOKENS.filter((t) => {
    const chain = defaultChainRegistry.getChain(t.chainId);
    const matchesSearch =
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (chain && chain.canonicalName.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesChain = chainFilter === 'ALL' || t.chainId.toLowerCase() === chainFilter.toLowerCase();

    let matchesType = true;
    if (networkTypeFilter === 'EVM') {
      matchesType = chain?.executionEnvironment === 'EVM';
    } else if (networkTypeFilter === 'L2') {
      matchesType = chain?.category === 'OPTIMISTIC_ROLLUP' || chain?.category === 'ZK_ROLLUP' || chain?.category === 'ORBIT_RWA';
    } else if (networkTypeFilter === 'NON_EVM') {
      matchesType = chain?.executionEnvironment !== 'EVM';
    }

    return matchesSearch && matchesChain && matchesType;
  });

  const handleTrade = (token: Token) => {
    const chain = defaultChainRegistry.getChain(token.chainId);
    if (chain) {
      setSourceChain(chain);
      setDestChain(chain);
      if (token.isNative) {
        setTokenIn(token);
        const destTokens = defaultTokenService.getTokensForChain(chain.id);
        const stable =
          destTokens.find(
            (t) =>
              (t.symbol === 'USDC' || t.symbol === 'USDT' || t.symbol === 'DAI') &&
              t.address.toLowerCase() !== token.address.toLowerCase()
          ) ||
          destTokens.find((t) => t.address.toLowerCase() !== token.address.toLowerCase()) ||
          destTokens[0];
        if (stable) setTokenOut(stable);
      } else {
        const native = defaultTokenService.getNativeToken(chain.id);
        if (native) setTokenIn(native);
        setTokenOut(token);
      }
      setActiveTab('TRADE');
    }
  };

  const formatPrice = (val: number): string => {
    if (val >= 1000) return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (val >= 1) return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    if (val >= 0.0001) return val.toFixed(6);
    return val.toFixed(8);
  };

  const formatMarketCap = (cap?: number | null): string => {
    if (!cap || cap <= 0) return '—';
    if (cap >= 1e12) return `$${(cap / 1e12).toFixed(2)}T`;
    if (cap >= 1e9) return `$${(cap / 1e9).toFixed(2)}B`;
    if (cap >= 1e6) return `$${(cap / 1e6).toFixed(1)}M`;
    return `$${cap.toLocaleString()}`;
  };

  const seenAssets = new Set<string>();
  let uniqueTotalVolumeUSD = 0;

  Object.entries(marketData).forEach(([key, m]) => {
    if (m && typeof m.volume24hUSD === 'number' && m.volume24hUSD > 0) {
      const assetId = m.symbol ? m.symbol.toUpperCase() : key;
      if (!seenAssets.has(assetId)) {
        seenAssets.add(assetId);
        uniqueTotalVolumeUSD += m.volume24hUSD;
      }
    }
  });

  const totalVolumeFormatted =
    uniqueTotalVolumeUSD > 0
      ? uniqueTotalVolumeUSD >= 1e9
        ? `$${(uniqueTotalVolumeUSD / 1e9).toFixed(1)} Billion`
        : `$${(uniqueTotalVolumeUSD / 1e6).toFixed(1)} Million`
      : '—';

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="font-display font-extrabold text-2xl text-white">Multi-Chain Markets</h2>
            {marketDataStatus === 'LIVE' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono text-[10px] font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                🟢 LIVE FEED
              </span>
            ) : marketDataStatus === 'FALLBACK' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-mono text-[10px] font-bold">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                🟡 BINANCE FALLBACK
              </span>
            ) : marketDataStatus === 'STALE' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 font-mono text-[10px] font-bold">
                <span className="w-2 h-2 rounded-full bg-orange-400" />
                🟠 STALE CACHE
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 font-mono text-[10px] font-bold">
                <span className="w-2 h-2 rounded-full bg-rose-400" />
                🔴 OFFLINE / UNAVAILABLE
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Real-time live WebSocket price feeds, circulating supply market caps, and 24h metrics across {defaultChainRegistry.getAllChains().length} supported networks
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono flex-wrap">
          <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[10px]">Tracked 24h Volume</span>
            <span className="font-bold text-white text-sm">{totalVolumeFormatted}</span>
          </div>
          <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400 block text-[10px]">Active Chains</span>
            <span className="font-bold text-cyan-400 text-sm">{defaultChainRegistry.getAllChains().length} Networks</span>
          </div>
          <button
            onClick={() => fetchMarketData()}
            disabled={isMarketsLoading}
            className="flex items-center gap-1.5 p-3 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 border border-slate-800 transition-colors disabled:opacity-50"
            title="Click to refresh live prices"
          >
            <RefreshCw className={`w-4 h-4 ${isMarketsLoading ? 'animate-spin text-cyan-400' : 'text-slate-400'}`} />
            <span className="text-[11px] font-bold font-sans">
              {isMarketsLoading ? 'Updating...' : lastMarketUpdate ? 'Updated' : 'Refresh'}
            </span>
          </button>
        </div>
      </div>

      {marketsError && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
          <span>Pricing feed notice: {marketsError}. Serving last cached market snapshot.</span>
        </div>
      )}

      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative w-full md:w-80 shrink-0">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tokens, symbols, or networks..."
            className="w-full pl-10 pr-4 py-2.5 bg-[#0B111E] border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/60"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-thin">
          {[
            { id: 'ALL', label: 'All Networks' },
            { id: 'EVM', label: 'EVM Networks' },
            { id: 'L2', label: 'Layer 2 Rollups' },
            { id: 'NON_EVM', label: 'Non-EVM / SVM' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setNetworkTypeFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg font-semibold shrink-0 transition-colors ${
                networkTypeFilter === tab.id
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-glow-cyan'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0B111E] text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
              <tr>
                <th className="py-3.5 px-4">Asset</th>
                <th className="py-3.5 px-4">Network</th>
                <th className="py-3.5 px-4">Live Price (USD)</th>
                <th className="py-3.5 px-4">24h Change</th>
                <th className="py-3.5 px-4">Market Cap</th>
                <th className="py-3.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50 font-mono">
              {filteredTokens.map((t) => {
                const chain = defaultChainRegistry.getChain(t.chainId);
                const tokenKey = `${t.chainId.toLowerCase()}:${t.address.toLowerCase()}`;
                const baseSymbol = defaultMarketDataService.resolveSymbol(t.symbol);
                const live =
                  marketData[tokenKey] ||
                  marketData[t.symbol.toLowerCase()] ||
                  marketData[baseSymbol.toLowerCase()] ||
                  defaultMarketDataService.getCachedMarketData(t.chainId, t.address);

                const currentPrice = (live?.priceUSD !== undefined && live.priceUSD !== null && live.priceUSD > 0) ? live.priceUSD : null;
                const change24h = (live?.change24hUSD !== undefined && live.change24hUSD !== null) ? live.change24hUSD : null;
                const marketCapUSD = live?.marketCapUSD ?? null;
                const isAvailable = currentPrice !== null;
                const isPositive = change24h !== null && change24h >= 0;

                return (
                  <tr key={`${t.chainId}-${t.address}`} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-4 font-sans">
                      <div className="flex items-center gap-3">
                        <TokenLogo
                          symbol={t.symbol}
                          name={t.name}
                          logoURI={t.logoURI}
                          chainId={t.chainId}
                          address={t.address}
                          isNative={t.isNative}
                          className="w-7 h-7 rounded-full"
                        />
                        <div>
                          <p className="font-bold text-sm text-white">{t.symbol}</p>
                          <p className="text-xs text-slate-400 font-sans">{t.name}</p>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 font-medium">
                          {chain?.shortName || t.chainId}
                        </span>
                        {chain && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold border border-cyan-500/20 bg-cyan-500/10 text-cyan-300 font-mono">
                            {chain.executionEnvironment}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-bold text-white text-sm">
                      {currentPrice !== null ? `$${formatPrice(currentPrice)}` : <span className="text-slate-500 font-normal">Unavailable</span>}
                    </td>

                    <td className="py-3.5 px-4">
                      {change24h !== null ? (
                        <span
                          className={`inline-flex items-center gap-1 font-bold ${
                            isPositive ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                          {isPositive ? '+' : ''}
                          {change24h.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-slate-200 font-semibold">
                      {formatMarketCap(marketCapUSD)}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => handleTrade(t)}
                        disabled={!isAvailable}
                        className="px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 font-bold font-sans text-xs transition-colors inline-flex items-center gap-1 disabled:opacity-40 disabled:hover:bg-cyan-500/20"
                      >
                        Trade
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
