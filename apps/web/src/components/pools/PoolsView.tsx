import React, { useState, useEffect, useMemo } from 'react';
import { useZenithStore } from '../../stores/useZenithStore';
import { defaultMarketDataService, DEFAULT_TOKENS } from '@zenith/tokens';
import { defaultChainRegistry } from '@zenith/chains';
import { ZenithPool, Token } from '@zenith/types';
import { TokenLogo } from '../common/TokenLogo';
import {
  Layers,
  TrendingUp,
  TrendingDown,
  Sparkles,
  ShieldCheck,
  ChevronRight,
  DollarSign,
  ArrowUpDown,
  ArrowRight,
  RefreshCw,
  Zap,
  Search,
  Filter,
  ExternalLink,
  Activity,
  BarChart3,
  Database,
  CheckCircle2
} from 'lucide-react';

export const PoolsView: React.FC = () => {
  const {
    theme,
    marketData,
    fetchMarketData,
    isMarketsLoading,
    lastMarketUpdate,
    marketDataStatus,
    setTokenIn,
    setTokenOut,
    setSourceChain,
    setDestChain,
    setActiveTab
  } = useZenithStore();

  const isDark = theme === 'dark';

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedChain, setSelectedChain] = useState<string>('ALL');
  const [selectedFeeTier, setSelectedFeeTier] = useState<number | 'ALL'>('ALL');
  const [selectedHook, setSelectedHook] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'TVL' | 'VOLUME' | 'FEES' | 'APR'>('TVL');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');
  const [secondsAgo, setSecondsAgo] = useState<number>(0);

  useEffect(() => {
    fetchMarketData();
    const refreshInterval = setInterval(() => {
      fetchMarketData();
    }, 15000);

    return () => clearInterval(refreshInterval);
  }, [fetchMarketData]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (lastMarketUpdate && lastMarketUpdate > 0) {
        const diff = Math.max(0, Math.floor((Date.now() - lastMarketUpdate) / 1000));
        setSecondsAgo(diff);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [lastMarketUpdate]);

  const basePools: ZenithPool[] = useMemo(() => {
    return defaultMarketDataService.getPools();
  }, []);

  const livePools = useMemo(() => {
    return basePools.map((pool) => {
      const liveToken0Price = marketData[pool.token0.symbol]?.priceUSD ?? pool.token0.priceUSD ?? 1;
      const liveToken1Price = marketData[pool.token1.symbol]?.priceUSD ?? pool.token1.priceUSD ?? 1;
      const live24hChange1 = marketData[pool.token1.symbol]?.change24hUSD ?? pool.token1.change24hUSD ?? 0;

      const exchangeRate = liveToken0Price > 0 && liveToken1Price > 0
        ? liveToken1Price / liveToken0Price
        : 1;

      return {
        ...pool,
        liveToken0Price,
        liveToken1Price,
        exchangeRate,
        change24h: live24hChange1
      };
    });
  }, [basePools, marketData]);

  const filteredPools = useMemo(() => {
    return livePools
      .filter((p) => {
        const chain = defaultChainRegistry.getChain(p.chainId);
        const matchesSearch =
          p.token0.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.token0.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.token1.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.token1.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.chainId.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (chain && chain.canonicalName.toLowerCase().includes(searchQuery.toLowerCase()));

        const matchesChain = selectedChain === 'ALL' || p.chainId.toLowerCase() === selectedChain.toLowerCase();

        const matchesFee = selectedFeeTier === 'ALL' || p.feeBps === selectedFeeTier;

        let matchesHook = true;
        if (selectedHook === 'DYNAMIC') {
          matchesHook = p.hookName === 'DynamicVolFee' || p.isDynamicFee === true;
        } else if (selectedHook === 'TWAMM') {
          matchesHook = p.hookName === 'TWAMMAutoRebalance';
        } else if (selectedHook === 'MEV') {
          matchesHook = p.hookName === 'MEVCaptureLPReward';
        } else if (selectedHook === 'STANDARD') {
          matchesHook = !p.hookName;
        }

        return matchesSearch && matchesChain && matchesFee && matchesHook;
      })
      .sort((a, b) => {
        let valA = 0;
        let valB = 0;
        if (sortBy === 'TVL') {
          valA = a.tvlUSD;
          valB = b.tvlUSD;
        } else if (sortBy === 'VOLUME') {
          valA = a.volume24hUSD;
          valB = b.volume24hUSD;
        } else if (sortBy === 'FEES') {
          valA = a.fees24hUSD;
          valB = b.fees24hUSD;
        } else if (sortBy === 'APR') {
          valA = a.aprPercent;
          valB = b.aprPercent;
        }
        return sortOrder === 'DESC' ? valB - valA : valA - valB;
      });
  }, [livePools, searchQuery, selectedChain, selectedFeeTier, selectedHook, sortBy, sortOrder]);

  const totalTVL = useMemo(() => livePools.reduce((acc, p) => acc + p.tvlUSD, 0), [livePools]);
  const total24hVolume = useMemo(() => livePools.reduce((acc, p) => acc + p.volume24hUSD, 0), [livePools]);
  const total24hFees = useMemo(() => livePools.reduce((acc, p) => acc + p.fees24hUSD, 0), [livePools]);
  const avgApr = useMemo(() => {
    if (livePools.length === 0) return 0;
    const sum = livePools.reduce((acc, p) => acc + p.aprPercent, 0);
    return (sum / livePools.length).toFixed(1);
  }, [livePools]);

  const handleTradePool = (pool: ZenithPool) => {
    const chain = defaultChainRegistry.getChain(pool.chainId);
    if (chain) {
      setSourceChain(chain);
      setDestChain(chain);
    }
    setTokenIn(pool.token0);
    setTokenOut(pool.token1);
    setActiveTab('TRADE');
  };

  const handleSort = (type: 'TVL' | 'VOLUME' | 'FEES' | 'APR') => {
    if (sortBy === type) {
      setSortOrder((prev) => (prev === 'DESC' ? 'ASC' : 'DESC'));
    } else {
      setSortBy(type);
      setSortOrder('DESC');
    }
  };

  const formatUSD = (val: number): string => {
    if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(2)}B`;
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(2)}K`;
    return `$${val.toLocaleString()}`;
  };

  const chainOptions = [
    { id: 'ALL', label: 'All Networks' },
    { id: 'ethereum', label: 'Ethereum' },
    { id: 'solana', label: 'Solana' },
    { id: 'base', label: 'Base' },
    { id: 'arbitrum', label: 'Arbitrum' },
    { id: 'polygon', label: 'Polygon' },
    { id: 'optimism', label: 'Optimism' },
    { id: 'bnb', label: 'BNB Chain' },
    { id: 'avalanche', label: 'Avalanche' }
  ];

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 pb-12">
      {}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-glow-cyan/20">
              <Layers className="w-6 h-6" />
            </span>
            <h1 className="text-2xl sm:text-3xl font-display font-black text-white tracking-wide">
              Concentrated Liquidity Pools
            </h1>
            <span className="px-2.5 py-1 rounded-full text-xs font-mono font-semibold bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 text-cyan-300 border border-cyan-500/30">
              v4 Singleton AMM
            </span>
            <span className="px-2.5 py-1 rounded-full text-xs font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              EIP-1153 Flash Accounting
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-2 max-w-2xl">
            Live multi-chain singleton liquidity pools with dynamic volatility hooks, automated TWAMM rebalancing, and MEV capture protection.
          </p>
        </div>

        {/* Live Status Indicator & Refresh */}
        <div className="flex items-center gap-3 bg-slate-900/90 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-slate-800 shrink-0 self-start lg:self-auto">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <div className="flex flex-col">
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                Live On-Chain Feed
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {secondsAgo === 0 ? 'Syncing...' : `Updated ${secondsAgo}s ago`}
              </span>
            </div>
          </div>

          <div className="h-6 w-px bg-slate-800" />

          <button
            onClick={() => fetchMarketData()}
            disabled={isMarketsLoading}
            title="Refresh Live Pool Metrics"
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isMarketsLoading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Aggregate KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-panel p-5 rounded-2xl border border-slate-800 relative overflow-hidden group hover:border-cyan-500/40 transition-all">
          <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 rounded-full blur-2xl group-hover:bg-cyan-500/10 transition-all pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-mono">Total Value Locked</span>
            <span className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400">
              <Database className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-white mt-2 font-mono">
            {formatUSD(totalTVL)}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 mt-2 font-mono">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>+5.8% (7d)</span>
            <span className="text-slate-500">• 18 Active Pools</span>
          </div>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800 relative overflow-hidden group hover:border-cyan-500/40 transition-all">
          <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 rounded-full blur-2xl group-hover:bg-cyan-500/10 transition-all pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-mono">24h Pool Volume</span>
            <span className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400">
              <Activity className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-cyan-400 mt-2 font-mono">
            {formatUSD(total24hVolume)}
          </div>
          <div className="text-xs text-slate-400 mt-2 font-mono">
            58.4% of total cross-chain DEX volume
          </div>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800 relative overflow-hidden group hover:border-emerald-500/40 transition-all">
          <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl group-hover:bg-emerald-500/10 transition-all pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-mono">24h LP Fees Earned</span>
            <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
              <DollarSign className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-emerald-400 mt-2 font-mono">
            ${total24hFees.toLocaleString()}
          </div>
          <div className="text-xs text-indigo-300 mt-2 font-mono flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Avg LP APR: ~{avgApr}%</span>
          </div>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800 relative overflow-hidden group hover:border-indigo-500/40 transition-all">
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl group-hover:bg-indigo-500/10 transition-all pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-mono">Gas Efficiency</span>
            <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
              <Zap className="w-4 h-4" />
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-black text-indigo-400 mt-2 font-mono">
            -68% Gas Cost
          </div>
          <div className="text-xs text-slate-400 mt-2 font-mono">
            EIP-1153 Transient Flash Accounting
          </div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-4">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by token, pool pair, or network..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900/90 border border-slate-800 focus:border-cyan-500 focus:outline-none text-sm text-white placeholder-slate-500 font-mono transition-all"
            />
          </div>

          {/* Fee Tier Filter */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 shrink-0">
            <span className="text-xs font-mono text-slate-400 mr-1 hidden sm:inline">Fee Tier:</span>
            {[
              { id: 'ALL', label: 'All' },
              { id: 1, label: '0.01%' },
              { id: 5, label: '0.05%' },
              { id: 30, label: '0.30%' },
              { id: 100, label: '1.00%' }
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setSelectedFeeTier(f.id as number | 'ALL')}
                className={`px-3 py-1.5 rounded-xl text-xs font-mono font-medium transition-all ${
                  selectedFeeTier === f.id
                    ? 'bg-cyan-500 text-slate-950 font-bold shadow-glow-cyan'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Hook Filter */}
          <div className="flex items-center gap-1.5 shrink-0">
            <select
              value={selectedHook}
              onChange={(e) => setSelectedHook(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-slate-300 focus:border-cyan-500 focus:outline-none transition-all cursor-pointer"
            >
              <option value="ALL">All Hooks & Standard</option>
              <option value="DYNAMIC">⚡ Dynamic Volatility Fee</option>
              <option value="TWAMM">⚡ TWAMM Auto-Rebalance</option>
              <option value="MEV">⚡ MEV LP Reward Capture</option>
              <option value="STANDARD">Standard AMM Pools</option>
            </select>
          </div>
        </div>

        {/* Network Filter Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pt-1 no-scrollbar">
          {chainOptions.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedChain(c.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5 ${
                selectedChain === c.id
                  ? 'bg-slate-800 text-cyan-300 border border-cyan-500/40 shadow-glow-cyan/20 font-semibold'
                  : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-slate-800/80'
              }`}
            >
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Live Liquidity Pools Table */}
      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/40">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white font-mono uppercase tracking-wider">
              Live Liquidity Pools ({filteredPools.length})
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              Real-Time Quoting
            </span>
          </div>
          <span className="text-xs text-slate-400 font-mono hidden sm:inline">
            Click any pool to initiate immediate swap routing
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800/60 bg-slate-900/60 text-[11px] font-mono text-slate-400 uppercase tracking-wider select-none">
                <th className="py-4 px-4 sm:px-6">Pool Pair & Network</th>
                <th className="py-4 px-4 cursor-pointer hover:text-white transition-colors">
                  <div className="flex items-center gap-1">
                    <span>Live Exchange Rate</span>
                  </div>
                </th>
                <th className="py-4 px-4">Fee Tier</th>
                <th
                  onClick={() => handleSort('TVL')}
                  className="py-4 px-4 cursor-pointer hover:text-white transition-colors"
                >
                  <div className="flex items-center gap-1">
                    <span>TVL</span>
                    <ArrowUpDown className={`w-3 h-3 ${sortBy === 'TVL' ? 'text-cyan-400' : 'text-slate-600'}`} />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('VOLUME')}
                  className="py-4 px-4 cursor-pointer hover:text-white transition-colors"
                >
                  <div className="flex items-center gap-1">
                    <span>24h Volume</span>
                    <ArrowUpDown className={`w-3 h-3 ${sortBy === 'VOLUME' ? 'text-cyan-400' : 'text-slate-600'}`} />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('FEES')}
                  className="py-4 px-4 cursor-pointer hover:text-white transition-colors hidden md:table-cell"
                >
                  <div className="flex items-center gap-1">
                    <span>24h LP Fees</span>
                    <ArrowUpDown className={`w-3 h-3 ${sortBy === 'FEES' ? 'text-cyan-400' : 'text-slate-600'}`} />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('APR')}
                  className="py-4 px-4 cursor-pointer hover:text-white transition-colors"
                >
                  <div className="flex items-center gap-1">
                    <span>Real APR</span>
                    <ArrowUpDown className={`w-3 h-3 ${sortBy === 'APR' ? 'text-cyan-400' : 'text-slate-600'}`} />
                  </div>
                </th>
                <th className="py-4 px-4 hidden lg:table-cell">v4 Hook Logic</th>
                <th className="py-4 px-4 sm:px-6 text-right">Quick Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40 text-sm font-normal">
              {filteredPools.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400 font-mono text-sm">
                    No active pools match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredPools.map((p) => {
                  const chain = defaultChainRegistry.getChain(p.chainId);
                  const isPositiveChange = (p.change24h || 0) >= 0;

                  return (
                    <tr
                      key={p.id}
                      className="hover:bg-slate-800/30 transition-colors group cursor-pointer"
                      onClick={() => handleTradePool(p)}
                    >
                      {/* Pool Pair & Chain */}
                      <td className="py-4 px-4 sm:px-6 font-medium text-white">
                        <div className="flex items-center gap-3">
                          <div className="flex -space-x-2 shrink-0">
                            <TokenLogo
                              logoURI={p.token0.logoURI}
                              symbol={p.token0.symbol}
                              name={p.token0.name}
                              chainId={p.token0.chainId}
                              address={p.token0.address}
                              isNative={p.token0.isNative}
                              className="w-8 h-8 rounded-full border-2 border-slate-900 shadow-md"
                            />
                            <TokenLogo
                              logoURI={p.token1.logoURI}
                              symbol={p.token1.symbol}
                              name={p.token1.name}
                              chainId={p.token1.chainId}
                              address={p.token1.address}
                              isNative={p.token1.isNative}
                              className="w-8 h-8 rounded-full border-2 border-slate-900 shadow-md"
                            />
                          </div>
                          <div>
                            <div className="font-bold text-white group-hover:text-cyan-400 transition-colors flex items-center gap-1.5">
                              {p.token0.symbol} / {p.token1.symbol}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[11px] font-mono font-medium text-slate-400 capitalize">
                                {chain ? chain.canonicalName : p.chainId}
                              </span>
                              <span className="text-slate-600 text-[10px]">•</span>
                              <span className="text-[10px] font-mono text-slate-500">
                                {p.poolAddress.slice(0, 6)}...{p.poolAddress.slice(-4)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Live Exchange Rate */}
                      <td className="py-4 px-4 font-mono">
                        <div className="text-xs font-semibold text-slate-200">
                          1 {p.token1.symbol} = {p.exchangeRate >= 1000 ? p.exchangeRate.toLocaleString(undefined, { maximumFractionDigits: 2 }) : p.exchangeRate.toFixed(4)} {p.token0.symbol}
                        </div>
                        <div className={`text-[11px] font-mono flex items-center gap-0.5 mt-0.5 ${
                          isPositiveChange ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                          {isPositiveChange ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          <span>{isPositiveChange ? '+' : ''}{(p.change24h || 0).toFixed(2)}%</span>
                        </div>
                      </td>

                      {/* Fee Tier */}
                      <td className="py-4 px-4">
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold border ${
                          p.isDynamicFee
                            ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30'
                            : 'bg-slate-800 text-cyan-300 border-slate-700'
                        }`}>
                          {(p.feeBps / 100).toFixed(2)}%
                          {p.isDynamicFee && ' ⚡'}
                        </span>
                      </td>

                      {/* TVL */}
                      <td className="py-4 px-4 font-mono font-semibold text-white">
                        {formatUSD(p.tvlUSD)}
                      </td>

                      {/* 24h Volume */}
                      <td className="py-4 px-4 font-mono font-medium text-cyan-400">
                        {formatUSD(p.volume24hUSD)}
                      </td>

                      {/* 24h Fees */}
                      <td className="py-4 px-4 font-mono font-medium text-emerald-400 hidden md:table-cell">
                        ${p.fees24hUSD.toLocaleString()}
                      </td>

                      {/* Real APR */}
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-black text-emerald-400 text-sm sm:text-base">
                            {p.aprPercent}%
                          </span>
                          {p.aprPercent >= 30 && (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 text-[10px] font-mono border border-emerald-500/20">
                              High Yield
                            </span>
                          )}
                        </div>
                      </td>

                      {/* v4 Hook Logic */}
                      <td className="py-4 px-4 hidden lg:table-cell">
                        {p.hookName ? (
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-mono font-medium bg-gradient-to-r from-indigo-500/15 to-purple-500/15 text-indigo-300 border border-indigo-500/30 flex items-center gap-1 w-fit">
                            <Zap className="w-3 h-3 text-indigo-400" />
                            {p.hookName}
                          </span>
                        ) : (
                          <span className="text-slate-500 text-xs font-mono">Standard AMM</span>
                        )}
                      </td>

                      {/* Action Button */}
                      <td className="py-4 px-4 sm:px-6 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTradePool(p);
                          }}
                          className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-xs font-semibold text-cyan-400 border border-slate-700 hover:border-cyan-400 transition-all flex items-center gap-1.5 ml-auto shadow-sm"
                        >
                          <span>Trade Pair</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Protocol Architecture Features Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
        <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
            <Zap className="w-4 h-4" />
            <span>Dynamic Volatility Hooks</span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            v4 smart hooks automatically calibrate pool swap fees in real-time based on 10-block volatility spikes, protecting liquidity providers from toxic flow.
          </p>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
            <Sparkles className="w-4 h-4" />
            <span>Internalized MEV Yield</span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Arbitrage profits that normally leak to searcher bots are captured by singleton router hooks and distributed directly back to concentrated pool positions.
          </p>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
            <ShieldCheck className="w-4 h-4" />
            <span>Transient Flash Accounting</span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Built on EIP-1153 opcode standards, all multi-hop token balances are settled at net transaction completion, cutting gas consumption by up to 68%.
          </p>
        </div>
      </div>
    </div>
  );
};
