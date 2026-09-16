import React, { useState, useEffect } from 'react';
import { useZenithStore } from '../../stores/useZenithStore';
import { TokenLogo } from '../common/TokenLogo';
import {
  Share2,
  Lock,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  BarChart3
} from 'lucide-react';
import { SwapCard } from './SwapCard';
import { LivePriceChart } from './LivePriceChart';
import { defaultMarketDataService, MarketStats24h } from '../../services/marketDataService';

type ProTab = 'CHART' | 'ROUTING';

export const UnifiedTradingView: React.FC = () => {
  const {
    sourceChain,
    destChain,
    tokenIn,
    tokenOut,
    quote,
    marketData
  } = useZenithStore();

  const [activeProTab, setActiveProTab] = useState<ProTab>('CHART');

  const isCrossChain = sourceChain.id !== destChain.id;
  const currentPair = `${tokenIn.symbol} / ${tokenOut.symbol}`;

  const tokenKey = `${tokenIn.chainId.toLowerCase()}:${tokenIn.address.toLowerCase()}`;
  const storePrice =
    marketData[tokenKey]?.priceUSD ||
    marketData[tokenIn.symbol.toLowerCase()]?.priceUSD ||
    defaultMarketDataService.getCachedMarketData(tokenIn.chainId, tokenIn.address)?.priceUSD ||
    tokenIn.priceUSD;

  const basePrice = storePrice || tokenIn.priceUSD || 0;

  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const [liveStats, setLiveStats] = useState<MarketStats24h>({
    currentPrice: basePrice,
    change24hPercent: 2.85,
    high24h: basePrice * 1.04,
    low24h: basePrice * 0.96,
    volume24hUSD: 148500000
  });

  useEffect(() => {
    if (!isOnline) return;

    let isMounted = true;
    defaultMarketDataService.fetch24hStats(tokenIn.symbol, 'USDT', basePrice).then((stats) => {
      if (isMounted && stats) {
        setLiveStats((prev) => ({
          ...stats,
          currentPrice: stats.currentPrice || prev.currentPrice
        }));
      }
    });

    const cleanup = defaultMarketDataService.subscribeLiveStream(
      tokenIn.symbol,
      'USDT',
      '1m',
      (livePrice) => {
        if (isMounted && livePrice > 0) {
          setLiveStats((prev) => ({
            ...prev,
            currentPrice: livePrice,
            high24h: Math.max(prev.high24h, livePrice),
            low24h: Math.min(prev.low24h, livePrice)
          }));
        }
      }
    );

    return () => {
      isMounted = false;
      cleanup();
    };
  }, [tokenIn.symbol, basePrice, isOnline]);

  const markPrice = (liveStats.currentPrice > 0 ? liveStats.currentPrice : storePrice) || basePrice;
  const isPositive = liveStats.change24hPercent >= 0;

  return (
    <div className="w-full max-w-7xl mx-auto space-y-4">
      {}
      {}
      <div className="glass-panel rounded-2xl p-4 sm:p-5 border border-slate-800/80 shadow-xl flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        {}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2 shrink-0">
              <TokenLogo
                symbol={tokenIn.symbol}
                name={tokenIn.name}
                logoURI={tokenIn.logoURI}
                chainId={tokenIn.chainId}
                address={tokenIn.address}
                isNative={tokenIn.isNative}
                className="w-8 h-8 rounded-full border-2 border-[#080B11] z-10"
              />
              <TokenLogo
                symbol={tokenOut.symbol}
                name={tokenOut.name}
                logoURI={tokenOut.logoURI}
                chainId={tokenOut.chainId}
                address={tokenOut.address}
                isNative={tokenOut.isNative}
                className="w-8 h-8 rounded-full border-2 border-[#080B11]"
              />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display font-black text-lg sm:text-xl text-white tracking-wide">
                  {currentPair}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono uppercase bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 whitespace-nowrap">
                  {isCrossChain ? 'Cross-Chain' : 'Same-Chain'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono flex-wrap mt-0.5">
              <span className="font-medium text-slate-300">{sourceChain.shortName}</span>
              <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                sourceChain.tier === 'TIER_1' ? 'text-emerald-400 bg-emerald-500/10' :
                sourceChain.tier === 'TIER_2' ? 'text-cyan-400 bg-cyan-500/10' :
                sourceChain.tier === 'TIER_3' ? 'text-amber-400 bg-amber-500/10' :
                'text-purple-400 bg-purple-500/10'
              }`}>
                {sourceChain.tier.replace('_', ' ')}
              </span>
              {isCrossChain && (
                <>
                  <ArrowRight className="w-3 h-3 text-cyan-400" />
                  <span className="font-medium text-slate-300">{destChain.shortName}</span>
                  <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                    destChain.tier === 'TIER_1' ? 'text-emerald-400 bg-emerald-500/10' :
                    destChain.tier === 'TIER_2' ? 'text-cyan-400 bg-cyan-500/10' :
                    destChain.tier === 'TIER_3' ? 'text-amber-400 bg-amber-500/10' :
                    'text-purple-400 bg-purple-500/10'
                  }`}>
                    {destChain.tier.replace('_', ' ')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Market Stats: Mark Price, 24h Change, 24h High/Low, 24h Volume */}
        <div className="grid grid-cols-2 sm:grid-cols-4 items-center gap-3 sm:gap-6 text-xs font-mono">
          <div>
            <span className="text-slate-400 block text-[10px] uppercase font-semibold tracking-wider">Mark Price</span>
            <span className="font-bold text-white text-sm">
              ${markPrice >= 1000 ? markPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : markPrice >= 1 ? markPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : markPrice >= 0.0001 ? markPrice.toFixed(6) : markPrice.toFixed(8)}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px] uppercase font-semibold tracking-wider">24h Change</span>
            <span className={`font-bold text-sm flex items-center gap-0.5 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
              {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {isPositive ? '+' : ''}
              {liveStats.change24hPercent.toFixed(2)}%
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px] uppercase font-semibold tracking-wider">24h High / Low</span>
            <span className="text-slate-300 font-medium">
              ${liveStats.high24h.toLocaleString(undefined, { maximumFractionDigits: 2 })} / ${liveStats.low24h.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[10px] uppercase font-semibold tracking-wider">24h Volume</span>
            <span className="text-slate-200 font-semibold">
              ${(liveStats.volume24hUSD / 1e6).toFixed(1)}M
            </span>
          </div>
        </div>

        {/* Private Relay Protected: Always accessible */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-300 text-xs font-mono shrink-0 shadow-sm">
          <Lock className="w-3.5 h-3.5 text-cyan-400" />
          <span className="font-semibold text-cyan-300">Private Relay Protected</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

        <div className="lg:col-span-7 space-y-4">
          <div className="glass-panel rounded-2xl p-5 border border-slate-800 shadow-xl">

            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveProTab('CHART')}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    activeProTab === 'CHART'
                      ? 'bg-slate-800 text-cyan-400 border border-slate-700 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
                  Live Price Chart
                </button>

                <button
                  onClick={() => setActiveProTab('ROUTING')}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    activeProTab === 'ROUTING'
                      ? 'bg-slate-800 text-cyan-400 border border-slate-700 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  <Share2 className="w-3.5 h-3.5" />
                  Route & Liquidity
                </button>
              </div>

              {quote && (
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-slate-400">EES Rating:</span>
                  <span className="font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-lg border border-emerald-500/20">
                    {quote.effectiveExecutionScore}/100
                  </span>
                </div>
              )}
            </div>

            {activeProTab === 'CHART' && (
              <div className="animate-in fade-in duration-300">
                <LivePriceChart tokenIn={tokenIn} tokenOut={tokenOut} />
              </div>
            )}

            {activeProTab === 'ROUTING' && quote && (
              <div className="space-y-4 animate-in fade-in duration-300">
                <div className="p-4 rounded-xl bg-[#0B111E] border border-slate-800">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Dynamic Multi-Hop Route Map
                    </h4>
                    <span className="text-[11px] font-mono text-cyan-400">
                      {isCrossChain ? 'Cross-Chain Stargate Relay' : 'Atomic Smart Split DEX Route'}
                    </span>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-slate-900/90 rounded-xl border border-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center font-bold font-mono text-cyan-300">
                        {tokenIn.symbol.slice(0, 3)}
                      </div>
                      <div>
                        <p className="font-bold text-sm text-white">{quote.amountInFormatted} {tokenIn.symbol}</p>
                        <p className="text-[11px] text-slate-400 font-mono">{sourceChain.canonicalName}</p>
                      </div>
                    </div>

                    <div className="flex flex-col items-center justify-center px-4 w-full sm:w-auto">
                      <div className="flex flex-wrap items-center justify-center gap-1.5">
                        {quote.bestRoute.hops.map((hop, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-xs font-mono text-cyan-300 font-semibold"
                          >
                            {hop.dexProtocol} ({hop.proportionPercent}%)
                          </span>
                        ))}
                      </div>
                      <div className="w-full flex items-center gap-1 my-1.5">
                        <div className="h-[2px] flex-1 bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-500" />
                        <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {isCrossChain ? `Bridge Latency: ~${quote.bestRoute.bridgeStep?.estimatedTransferTimeSec || 45}s` : 'Atomic Single Transaction'}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center font-bold font-mono text-emerald-300">
                        {tokenOut.symbol.slice(0, 3)}
                      </div>
                      <div>
                        <p className="font-bold text-sm text-white">{quote.amountOutFormatted} {tokenOut.symbol}</p>
                        <p className="text-[11px] text-slate-400 font-mono">{destChain.canonicalName}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#0B111E] border border-slate-800">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                    Ranked Liquidity Pathways & Quotes
                  </h4>
                  <div className="space-y-2">
                    {quote.routes.map((r, i) => (
                      <div
                        key={r.id}
                        className={`flex items-center justify-between p-3 rounded-xl border text-xs transition-colors ${
                          i === 0
                            ? 'bg-cyan-950/30 border-cyan-500/40 text-cyan-200'
                            : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="font-bold font-mono text-slate-400">#{i + 1}</span>
                          <span className="font-semibold">{r.routeType}</span>
                          <span className="text-slate-400 font-mono text-[11px]">
                            ({r.hops.map((h) => `${h.dexProtocol} ${h.proportionPercent}%`).join(' + ')})
                          </span>
                        </div>
                        <div className="flex items-center gap-3 font-mono">
                          {i === 0 && (
                            <span className="px-2 py-0.5 rounded bg-cyan-500 text-slate-950 font-bold text-[10px]">
                              BEST ROUTE
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5">
          <SwapCard />
        </div>
      </div>
    </div>
  );
};
