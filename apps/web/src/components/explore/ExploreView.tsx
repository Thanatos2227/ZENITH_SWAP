import React, { useState, useEffect } from 'react';
import { useZenithStore } from '../../stores/useZenithStore';
import { defaultMarketDataService } from '@zenith/tokens';
import { defaultSubgraphService, SubgraphProtocolStats } from '../../services/subgraphService';
import { ProtocolAnalytics, Token } from '@zenith/types';
import { TokenLogo } from '../common/TokenLogo';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Activity,
  Layers,
  Search,
  Zap,
  DollarSign,
  Database
} from 'lucide-react';

export const ExploreView: React.FC = () => {
  const { setTokenIn, setActiveTab, sourceChain } = useZenithStore();
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [subgraphStats, setSubgraphStats] = useState<SubgraphProtocolStats | null>(null);

  useEffect(() => {
    let isMounted = true;
    defaultSubgraphService.getProtocolStats(sourceChain?.chainId || 1).then((stats) => {
      if (isMounted) setSubgraphStats(stats);
    });
    return () => {
      isMounted = false;
    };
  }, [sourceChain]);

  const analytics: ProtocolAnalytics = defaultMarketDataService.getProtocolAnalytics();
  const pools = analytics.topPools;
  const tokens = analytics.topTokens.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.symbol.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleTradeToken = (tok: Token) => {
    setTokenIn(tok);
    setActiveTab('TRADE');
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      {}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <BarChart3 className="w-5 h-5" />
            </span>
            <h1 className="text-2xl font-display font-black text-white tracking-wide">
              Protocol Analytics & Explorer
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live Metrics
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center gap-1">
              <Database className="w-3 h-3" /> Goldsky Indexed
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Real-time multi-chain volume, total value locked, fee yields, and top token pairs.
          </p>
        </div>

        {}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search token or pool..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900/90 border border-slate-800 text-sm rounded-xl pl-9 pr-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
          />
        </div>
      </div>

      {}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-panel p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono uppercase">
            <span>Total Value Locked</span>
            <Layers className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-black text-white mt-1.5 font-mono">
            ${((subgraphStats?.totalValueLockedUSD || analytics.totalValueLockedUSD) / 1_000_000).toFixed(2)}M
          </div>
          <div className="text-xs text-emerald-400 flex items-center gap-1 mt-1 font-mono">
            <TrendingUp className="w-3.5 h-3.5" /> +5.8% this week
          </div>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono uppercase">
            <span>24h Total Volume</span>
            <Activity className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-black text-cyan-400 mt-1.5 font-mono">
            ${(analytics.totalVolume24hUSD / 1_000_000).toFixed(2)}M
          </div>
          <div className="text-xs text-slate-400 mt-1 font-mono">
            7d Vol: ${(analytics.totalVolume7dUSD / 1_000_000).toFixed(2)}M
          </div>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono uppercase">
            <span>24h Protocol Fees</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400 mt-1.5 font-mono">
            ${(subgraphStats?.totalFeesUSD || analytics.totalFees24hUSD).toLocaleString()}
          </div>
          <div className="text-xs text-indigo-400 mt-1 font-mono">
            60% distributed to veZENITH
          </div>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono uppercase">
            <span>Total Transactions</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-white mt-1.5 font-mono">
            {(subgraphStats?.txCount || analytics.totalTransactions24h).toLocaleString()}
          </div>
          <div className="text-xs text-slate-400 mt-1 font-mono">
            Across 53 Chains
          </div>
        </div>
      </div>

      {/* Grid: Top Tokens & Pools */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Verified Tokens */}
        <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white uppercase font-mono">Top Verified Tokens</h2>
            <span className="text-xs text-slate-400 font-mono">By Market Cap</span>
          </div>
          <div className="divide-y divide-slate-800/40 text-sm">
            {tokens.slice(0, 8).map((tok) => (
              <div
                key={`${tok.chainId}-${tok.symbol}-${tok.address}`}
                onClick={() => handleTradeToken(tok)}
                className="p-3.5 hover:bg-slate-800/30 transition-colors flex items-center justify-between cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <TokenLogo
                    logoURI={tok.logoURI}
                    symbol={tok.symbol}
                    name={tok.name}
                    chainId={tok.chainId}
                    address={tok.address}
                    isNative={tok.isNative}
                    className="w-7 h-7 rounded-full"
                  />
                  <div>
                    <div className="font-semibold text-white group-hover:text-cyan-400 transition-colors">
                      {tok.name}
                    </div>
                    <span className="text-xs font-mono text-slate-400">{tok.symbol}</span>
                  </div>
                </div>

                <div className="text-right font-mono">
                  <div className="font-bold text-white">${(tok.priceUSD || 0).toLocaleString()}</div>
                  <span
                    className={`text-xs flex items-center justify-end gap-0.5 ${
                      (tok.change24hUSD || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {(tok.change24hUSD || 0) >= 0 ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : (
                      <TrendingDown className="w-3 h-3" />
                    )}
                    {Math.abs(tok.change24hUSD || 1.45)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Concentrated Pools */}
        <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white uppercase font-mono">Top Concentrated Pools</h2>
            <span className="text-xs text-cyan-400 font-mono">v4 Singleton</span>
          </div>
          <div className="divide-y divide-slate-800/40 text-sm">
            {pools.slice(0, 8).map((p) => (
              <div
                key={p.id}
                onClick={() => setActiveTab('POOLS')}
                className="p-3.5 hover:bg-slate-800/30 transition-colors flex items-center justify-between cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-1.5 shrink-0">
                    <TokenLogo
                      logoURI={p.token0.logoURI}
                      symbol={p.token0.symbol}
                      name={p.token0.name}
                      chainId={p.token0.chainId}
                      address={p.token0.address}
                      isNative={p.token0.isNative}
                      className="w-6 h-6 rounded-full border border-slate-900"
                    />
                    <TokenLogo
                      logoURI={p.token1.logoURI}
                      symbol={p.token1.symbol}
                      name={p.token1.name}
                      chainId={p.token1.chainId}
                      address={p.token1.address}
                      isNative={p.token1.isNative}
                      className="w-6 h-6 rounded-full border border-slate-900"
                    />
                  </div>
                  <div>
                    <div className="font-semibold text-white group-hover:text-cyan-400 transition-colors">
                      {p.token0.symbol}/{p.token1.symbol}
                    </div>
                    <span className="text-[11px] font-mono text-cyan-300">{(p.feeBps / 100).toFixed(2)}% fee</span>
                  </div>
                </div>

                <div className="text-right font-mono">
                  <div className="font-bold text-emerald-400">{p.aprPercent}% APR</div>
                  <span className="text-xs text-slate-400">${(p.tvlUSD / 1_000_000).toFixed(1)}M TVL</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
