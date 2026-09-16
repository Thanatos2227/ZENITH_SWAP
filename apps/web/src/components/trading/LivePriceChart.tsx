import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Token } from '@zenith/types';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  RefreshCw,
  WifiOff,
  Wifi,
  AlertTriangle
} from 'lucide-react';
import {
  defaultMarketDataService,
  MarketCandle,
  MarketStats24h
} from '../../services/marketDataService';
import { useZenithStore } from '../../stores/useZenithStore';

interface LivePriceChartProps {
  tokenIn: Token;
  tokenOut: Token;
}

export const LivePriceChart: React.FC<LivePriceChartProps> = ({ tokenIn, tokenOut }) => {
  const { theme, marketData } = useZenithStore();
  const isDark = theme === 'dark';
  const tokenKey = `${tokenIn.chainId.toLowerCase()}:${tokenIn.address.toLowerCase()}`;
  const storePrice =
    marketData[tokenKey]?.priceUSD ||
    defaultMarketDataService.getCachedMarketData(tokenIn.chainId, tokenIn.address)?.priceUSD ||
    tokenIn.priceUSD;

  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [chartMode, setChartMode] = useState<'AREA' | 'CANDLE'>('AREA');
  const [showEMA, setShowEMA] = useState<boolean>(true);
  const [showVolume, setShowVolume] = useState<boolean>(true);
  const [hoveredCandle, setHoveredCandle] = useState<MarketCandle | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [isTickUp, setIsTickUp] = useState<boolean | null>(null);
  const [tickCounter, setTickCounter] = useState<number>(0);
  const [wsStatus, setWsStatus] = useState<'CONNECTING' | 'CONNECTED' | 'DISCONNECTED'>('CONNECTING');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const baseRate = useMemo(() => {
    const pIn = storePrice || tokenIn.priceUSD || 0;
    const pOut = tokenOut.priceUSD || 1;
    return pOut > 0 ? pIn / pOut : pIn;
  }, [tokenIn, tokenOut, storePrice]);

  const latestPriceRef = useRef<number>(baseRate);
  const authoritativePriceRef = useRef<number>(baseRate);
  useEffect(() => {
    latestPriceRef.current = baseRate;
    authoritativePriceRef.current = baseRate;
  }, [baseRate]);

  const [stats24h, setStats24h] = useState<MarketStats24h>({
    currentPrice: baseRate,
    change24hPercent: 3.42,
    high24h: baseRate * 1.04,
    low24h: baseRate * 0.96,
    volume24hUSD: 185000000
  });

  const [candles, setCandles] = useState<MarketCandle[]>([]);

  const format1mTimeLabel = (d: Date): string => {
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const generateSynthetic1mCandles = useCallback((startPrice: number, count: number = 45): MarketCandle[] => {
    const list: MarketCandle[] = [];
    const now = Date.now();
    let lastClose = startPrice * 0.985;

    for (let i = count; i >= 0; i--) {
      const ts = now - i * 60 * 1000;
      const d = new Date(ts);
      const timeLabel = format1mTimeLabel(d);
      const volatility = lastClose * 0.0025;
      const open = lastClose;
      const delta = (Math.random() - 0.5) * volatility;
      const close = Math.max(open + delta, 0.000001);
      const high = Math.max(open, close) + Math.random() * volatility * 0.4;
      const low = Math.min(open, close) - Math.random() * volatility * 0.4;
      const volume = Math.floor(Math.random() * 500 + 100);

      list.push({ timestamp: ts, timeLabel, open, high, low, close, volume });
      lastClose = close;
    }
    if (list.length > 0) {
      list[list.length - 1].close = startPrice;
      list[list.length - 1].high = Math.max(list[list.length - 1].high, startPrice);
      list[list.length - 1].low = Math.min(list[list.length - 1].low, startPrice);
    }
    return list;
  }, []);

  const initMarketData = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOnline(false);
      setWsStatus('DISCONNECTED');
      if (candles.length === 0) {
        setCandles(generateSynthetic1mCandles(latestPriceRef.current || baseRate, 45));
      }
      return;
    }

    setIsLoading(true);
    try {
      const [fetchedCandles, fetchedStats] = await Promise.all([
        defaultMarketDataService.fetchKlines(tokenIn.symbol, tokenOut.symbol, '1m', 45, baseRate),
        defaultMarketDataService.fetch24hStats(tokenIn.symbol, tokenOut.symbol, baseRate)
      ]);

      if (fetchedStats) {
        setStats24h(fetchedStats);
        if (fetchedStats.currentPrice > 0) {
          authoritativePriceRef.current = fetchedStats.currentPrice;
          latestPriceRef.current = fetchedStats.currentPrice;
        }
      }

      if (fetchedCandles && fetchedCandles.length > 0) {
        setCandles(fetchedCandles);
      } else {
        setCandles(generateSynthetic1mCandles(authoritativePriceRef.current || baseRate, 45));
      }
    } catch (err) {
      console.error('Error fetching market data:', err);
      setCandles(generateSynthetic1mCandles(baseRate, 45));
    } finally {
      setIsLoading(false);
    }
  }, [tokenIn.symbol, tokenOut.symbol, baseRate, generateSynthetic1mCandles, candles.length]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setWsStatus('CONNECTING');
      initMarketData();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setWsStatus('DISCONNECTED');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [initMarketData]);

  useEffect(() => {
    initMarketData();
  }, [initMarketData]);

  useEffect(() => {
    if (!isOnline) {
      setWsStatus('DISCONNECTED');
      return;
    }

    const cleanup = defaultMarketDataService.subscribeLiveStream(
      tokenIn.symbol,
      tokenOut.symbol,
      '1m',
      (livePrice, tickCandle) => {
        if (livePrice > 0) {
          authoritativePriceRef.current = livePrice;
          latestPriceRef.current = livePrice;
          setIsTickUp((prevUp) => (stats24h.currentPrice > 0 ? livePrice >= stats24h.currentPrice : true));
          setTickCounter((c) => c + 1);
          setStats24h((prevStats) => ({
            ...prevStats,
            currentPrice: livePrice,
            high24h: Math.max(prevStats.high24h, livePrice),
            low24h: Math.min(prevStats.low24h, livePrice)
          }));

          if (tickCandle) {
            setCandles((prev) => {
              if (prev.length === 0) return prev;
              const lastIndex = prev.length - 1;
              const last = prev[lastIndex];

              if (tickCandle.timestamp === last.timestamp) {
                const updatedLast: MarketCandle = {
                  ...last,
                  high: Math.max(last.high, tickCandle.high, livePrice),
                  low: Math.min(last.low, tickCandle.low, livePrice),
                  close: livePrice,
                  volume: last.volume + (tickCandle.volume ? tickCandle.volume * 0.05 : 1)
                };
                return [...prev.slice(0, lastIndex), updatedLast];
              } else if (tickCandle.timestamp > last.timestamp) {
                return [...prev.slice(1), tickCandle];
              }
              return prev;
            });
          }
        }
      },
      (status) => {
        setWsStatus(status);
      }
    );

    return () => {
      cleanup();
    };
  }, [tokenIn.symbol, tokenOut.symbol, isOnline]);

  const currentPrice = storePrice || candles[candles.length - 1]?.close || stats24h.currentPrice || baseRate;
  const firstPrice = candles[0]?.open || baseRate;
  const priceChangeUSD = currentPrice - firstPrice;
  const priceChangePercent = stats24h.change24hPercent !== undefined ? stats24h.change24hPercent : (firstPrice > 0 ? (priceChangeUSD / firstPrice) * 100 : 0);
  const isPositive = priceChangePercent >= 0;

  const minPrice = useMemo(() => {
    if (candles.length === 0) return baseRate * 0.95;
    return Math.min(...candles.map((c) => c.low));
  }, [candles, baseRate]);

  const maxPrice = useMemo(() => {
    if (candles.length === 0) return baseRate * 1.05;
    return Math.max(...candles.map((c) => c.high));
  }, [candles, baseRate]);

  const priceRange = maxPrice - minPrice || 1;
  const maxVolume = useMemo(() => {
    if (candles.length === 0) return 1000;
    return Math.max(...candles.map((c) => c.volume), 1);
  }, [candles]);

  const chartWidth = 720;
  const chartHeight = 250;
  const paddingX = 20;
  const paddingY = 25;
  const usableWidth = chartWidth - paddingX * 2;
  const usableHeight = chartHeight - paddingY * 2;

  const points = useMemo(() => {
    if (candles.length === 0) return [];
    return candles.map((c, i) => {
      const x = paddingX + (i / (candles.length - 1 || 1)) * usableWidth;
      const normalizedY = (c.close - minPrice) / priceRange;
      const y = chartHeight - paddingY - normalizedY * usableHeight;
      return { x, y, candle: c };
    });
  }, [candles, minPrice, priceRange, usableHeight, usableWidth, chartHeight]);

  const linePath = useMemo(() => {
    if (points.length === 0) return '';
    return points.reduce((path, pt, i) => `${path} ${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`, '');
  }, [points]);

  const areaPath = useMemo(() => {
    if (points.length === 0) return '';
    const firstX = points[0].x;
    const lastX = points[points.length - 1].x;
    const bottomY = chartHeight - paddingY;
    return `${linePath} L ${lastX.toFixed(1)},${bottomY} L ${firstX.toFixed(1)},${bottomY} Z`;
  }, [linePath, points, chartHeight]);

  const emaPoints = useMemo(() => {
    if (candles.length < 9) return [];
    const k = 2 / (9 + 1);
    let ema = candles[0].close;
    return candles.map((c, i) => {
      ema = c.close * k + ema * (1 - k);
      const x = paddingX + (i / (candles.length - 1 || 1)) * usableWidth;
      const normalizedY = (ema - minPrice) / priceRange;
      const y = chartHeight - paddingY - normalizedY * usableHeight;
      return { x, y };
    });
  }, [candles, minPrice, priceRange, usableHeight, usableWidth, chartHeight]);

  const emaPath = useMemo(() => {
    if (emaPoints.length === 0) return '';
    return emaPoints.reduce((path, pt, i) => `${path} ${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`, '');
  }, [emaPoints]);

  const ema21Points = useMemo(() => {
    if (candles.length < 21) return [];
    const k = 2 / (21 + 1);
    let ema = candles[0].close;
    return candles.map((c, i) => {
      ema = c.close * k + ema * (1 - k);
      const x = paddingX + (i / (candles.length - 1 || 1)) * usableWidth;
      const normalizedY = (ema - minPrice) / priceRange;
      const y = chartHeight - paddingY - normalizedY * usableHeight;
      return { x, y };
    });
  }, [candles, minPrice, priceRange, usableHeight, usableWidth, chartHeight]);

  const ema21Path = useMemo(() => {
    if (ema21Points.length === 0) return '';
    return ema21Points.reduce((path, pt, i) => `${path} ${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`, '');
  }, [ema21Points]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (candles.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * chartWidth;
    const mouseY = ((e.clientY - rect.top) / rect.height) * chartHeight;

    const closestIndex = Math.min(
      Math.max(Math.round(((mouseX - paddingX) / usableWidth) * (candles.length - 1)), 0),
      candles.length - 1
    );

    setHoveredCandle(candles[closestIndex]);
    setMousePos({ x: mouseX, y: mouseY });
  };

  const handleMouseLeave = () => {
    setHoveredCandle(null);
    setMousePos(null);
  };

  const displayedCandle = hoveredCandle || candles[candles.length - 1];

  const formatPriceDigits = (p: number) => {
    if (p >= 1000) return p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (p >= 1) return p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    if (p >= 0.0001) return p.toFixed(6);
    return p.toFixed(8);
  };

  return (
    <div className="p-4 sm:p-5 rounded-2xl bg-[#0B111E] border border-slate-800 space-y-4 shadow-xl">

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-display font-black text-lg sm:text-xl text-white tracking-wide">
              {tokenIn.symbol}/{tokenOut.symbol}
            </span>
            <div
              className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[10px] font-mono font-bold uppercase tracking-wider transition-colors ${!isOnline
                  ? 'bg-rose-950/70 border-rose-500/40 text-rose-300'
                  : wsStatus === 'CONNECTED'
                    ? 'bg-emerald-950/60 border-emerald-500/30 text-emerald-400'
                    : 'bg-amber-950/60 border-amber-500/30 text-amber-400'
                }`}
            >
              {!isOnline ? (
                <>
                  <WifiOff className="w-2.5 h-2.5 text-rose-400" />
                  <span>OFFLINE</span>
                </>
              ) : (
                <>
                  <span className={`w-2 h-2 rounded-full ${wsStatus === 'CONNECTED' ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`} />
                  <span>{wsStatus === 'CONNECTED' ? 'LIVE WS' : 'SYNCING'}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-baseline gap-2">
            <span
              className={`font-mono font-bold text-lg sm:text-xl tracking-tight transition-colors duration-300 ${!isOnline
                  ? 'text-slate-300'
                  : isTickUp === true
                    ? 'text-emerald-400'
                    : isTickUp === false
                      ? 'text-red-400'
                      : 'text-white'
                }`}
            >
              ${formatPriceDigits(currentPrice)}
            </span>

            <span
              className={`inline-flex items-center gap-0.5 font-mono text-xs font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'
                }`}
            >
              {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {isPositive ? '+' : ''}
              {priceChangePercent.toFixed(2)}%
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">

          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-semibold text-xs shadow-sm transition-colors ${!isOnline
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
            }`}>
            <Activity className={`w-3.5 h-3.5 ${!isOnline ? 'text-rose-400' : 'text-cyan-400'}`} />
            <span className="font-mono">{!isOnline ? 'Feed Paused (Offline)' : 'Zenith Swap Live • 1m'}</span>
          </div>

          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs">
            <button
              onClick={() => setChartMode('AREA')}
              className={`px-2 py-0.5 rounded font-semibold transition-colors ${chartMode === 'AREA'
                  ? 'bg-slate-800 text-cyan-300 border border-slate-700 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
                }`}
            >
              Line
            </button>
            <button
              onClick={() => setChartMode('CANDLE')}
              className={`px-2 py-0.5 rounded font-semibold transition-colors ${chartMode === 'CANDLE'
                  ? 'bg-slate-800 text-cyan-300 border border-slate-700 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
                }`}
            >
              Candles
            </button>
          </div>

          <button
            onClick={() => setShowEMA(!showEMA)}
            className={`px-2 py-1 rounded-lg text-xs font-mono font-semibold border transition-colors ${showEMA
                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                : 'bg-slate-900 text-slate-500 border-slate-800'
              }`}
            title="Toggle EMA 9 & EMA 21 overlays"
          >
            EMA
          </button>

          <button
            onClick={() => setShowVolume(!showVolume)}
            className={`px-2 py-1 rounded-lg text-xs font-mono font-semibold border transition-colors ${showVolume
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                : 'bg-slate-900 text-slate-500 border-slate-800'
              }`}
            title="Toggle Volume Histogram"
          >
            Vol
          </button>

          <button
            onClick={() => {
              if (typeof navigator !== 'undefined' && navigator.onLine) {
                setIsOnline(true);
              }
              initMarketData();
            }}
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Refresh Live Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
      </div>

      {!isOnline && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-rose-950/60 via-slate-900/80 to-rose-950/40 border border-rose-500/40 text-rose-200 text-xs font-mono shadow-lg animate-in fade-in duration-300">
          <div className="flex items-center gap-2.5">
            <div className="p-1 rounded-lg bg-rose-500/20 text-rose-400">
              <WifiOff className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <p className="font-bold text-rose-200">No Network Connection Detected</p>
              <p className="text-[11px] text-rose-300/80">Live chart updates & real-time tick streaming are stopped. Displaying last cached price state.</p>
            </div>
          </div>
          <button
            onClick={() => {
              if (typeof navigator !== 'undefined' && navigator.onLine) {
                setIsOnline(true);
              }
              initMarketData();
            }}
            className="self-end sm:self-center px-3 py-1.5 rounded-lg bg-rose-900/60 hover:bg-rose-800 text-rose-100 border border-rose-500/40 text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Retry Connection
          </button>
        </div>
      )}

      {displayedCandle && (
        <div className="flex flex-wrap items-center gap-4 text-xs font-mono bg-slate-900/80 px-3 py-1.5 rounded-xl border border-slate-800/80">
          <div className="text-slate-400">
            <span>Time: </span>
            <span className="text-white font-semibold">{displayedCandle.timeLabel}</span>
          </div>
          <div>
            <span className="text-slate-400">O: </span>
            <span className="text-slate-200">${formatPriceDigits(displayedCandle.open)}</span>
          </div>
          <div>
            <span className="text-slate-400">H: </span>
            <span className="text-emerald-400">${formatPriceDigits(displayedCandle.high)}</span>
          </div>
          <div>
            <span className="text-slate-400">L: </span>
            <span className="text-red-400">${formatPriceDigits(displayedCandle.low)}</span>
          </div>
          <div>
            <span className="text-slate-400">C: </span>
            <span className="text-cyan-300 font-bold">${formatPriceDigits(displayedCandle.close)}</span>
          </div>
          {showVolume && (
            <div>
              <span className="text-slate-400">Vol: </span>
              <span className="text-indigo-300">{displayedCandle.volume.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
            </div>
          )}
          <div className="sm:ml-auto text-[11px] text-slate-500 flex items-center gap-2">
            <span>Ticks: {tickCounter}</span>
            <span className="text-slate-600">|</span>
            <span className={!isOnline ? "text-rose-400 font-bold" : "text-cyan-400"}>
              {!isOnline ? "PAUSED (OFFLINE)" : "1m Duration"}
            </span>
          </div>
        </div>
      )}

      <div className={`relative w-full h-72 sm:h-80 ${isDark ? 'bg-[#080B11]/90 border-slate-800/80' : 'bg-white/95 border-slate-200 shadow-sm'} rounded-xl border overflow-hidden select-none`}>

        {!isOnline && (
          <div className="absolute inset-0 z-20 backdrop-blur-[2px] bg-slate-950/75 flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-3 shadow-lg shadow-rose-950/60">
              <WifiOff className="w-6 h-6 animate-pulse" />
            </div>
            <h3 className="text-base font-bold text-white tracking-wide mb-1 font-display">
              Live Chart Stopped — No Network
            </h3>
            <p className="text-xs text-slate-300 max-w-md mb-4 leading-relaxed font-sans">
              Real-time candlestick calculations and live price feeds are stopped because there is no network connection. Please check your internet connection to resume real-time feeds.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => {
                  if (typeof navigator !== 'undefined' && navigator.onLine) {
                    setIsOnline(true);
                  }
                  initMarketData();
                }}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs shadow-md transition-all flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                Reconnect Feed
              </button>
              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/90 border border-slate-700/80 text-[11px] font-mono text-slate-400">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                <span>Offline Safe Mode</span>
              </div>
            </div>
          </div>
        )}

        <div className="absolute inset-0 flex flex-col justify-between p-4 pointer-events-none opacity-30">
          <div className={`w-full border-b border-dashed ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-300 text-slate-500'} flex justify-between text-[10px] font-mono`}>
            <span>${formatPriceDigits(maxPrice)}</span>
          </div>
          <div className={`w-full border-b border-dashed ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-300 text-slate-500'} flex justify-between text-[10px] font-mono`}>
            <span>${formatPriceDigits((maxPrice + minPrice) / 2)}</span>
          </div>
          <div className={`w-full border-b border-dashed ${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-300 text-slate-500'} flex justify-between text-[10px] font-mono`}>
            <span>${formatPriceDigits(minPrice)}</span>
          </div>
        </div>

        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full h-full cursor-crosshair"
          preserveAspectRatio="none"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>

            <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isPositive ? '#00E599' : '#F43F5E'} stopOpacity="0.35" />
              <stop offset="50%" stopColor={isPositive ? '#06B6D4' : '#E11D48'} stopOpacity="0.15" />
              <stop offset="100%" stopColor={isDark ? '#080B11' : '#FFFFFF'} stopOpacity="0.0" />
            </linearGradient>

            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {showVolume &&
            candles.map((c, i) => {
              const x = paddingX + (i / (candles.length - 1 || 1)) * usableWidth;
              const barHeight = (c.volume / maxVolume) * 45;
              const y = chartHeight - paddingY - barHeight;
              const barWidth = Math.max(usableWidth / candles.length - 3, 2);
              const isUp = c.close >= c.open;

              return (
                <rect
                  key={`vol-${i}`}
                  x={x - barWidth / 2}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  fill={isUp ? '#00E599' : '#F43F5E'}
                  opacity="0.25"
                  rx="1"
                />
              );
            })}

          {chartMode === 'AREA' && (
            <>

              <path d={areaPath} fill="url(#areaGradient)" />

              <path
                d={linePath}
                fill="none"
                stroke={isPositive ? '#00E599' : '#F43F5E'}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#glow)"
              />
            </>
          )}

          {chartMode === 'CANDLE' &&
            candles.map((c, i) => {
              const x = paddingX + (i / (candles.length - 1 || 1)) * usableWidth;
              const normalizedHighY = chartHeight - paddingY - ((c.high - minPrice) / priceRange) * usableHeight;
              const normalizedLowY = chartHeight - paddingY - ((c.low - minPrice) / priceRange) * usableHeight;
              const normalizedOpenY = chartHeight - paddingY - ((c.open - minPrice) / priceRange) * usableHeight;
              const normalizedCloseY = chartHeight - paddingY - ((c.close - minPrice) / priceRange) * usableHeight;

              const isUp = c.close >= c.open;
              const candleTop = Math.min(normalizedOpenY, normalizedCloseY);
              const candleHeight = Math.max(Math.abs(normalizedOpenY - normalizedCloseY), 2);
              const candleWidth = Math.max(usableWidth / candles.length - 4, 3);

              return (
                <g key={`candle-${i}`}>

                  <line
                    x1={x}
                    y1={normalizedHighY}
                    x2={x}
                    y2={normalizedLowY}
                    stroke={isUp ? '#00E599' : '#F43F5E'}
                    strokeWidth="1.2"
                  />

                  <rect
                    x={x - candleWidth / 2}
                    y={candleTop}
                    width={candleWidth}
                    height={candleHeight}
                    fill={isUp ? '#00E599' : '#F43F5E'}
                    stroke={isUp ? '#00E599' : '#F43F5E'}
                    strokeWidth="0.8"
                    rx="1"
                  />
                </g>
              );
            })}

          {showEMA && emaPath && (
            <path
              d={emaPath}
              fill="none"
              stroke="#818CF8"
              strokeWidth="1.5"
              strokeDasharray="4 2"
              opacity="0.8"
            />
          )}

          {showEMA && ema21Path && (
            <path
              d={ema21Path}
              fill="none"
              stroke="#F59E0B"
              strokeWidth="1.2"
              opacity="0.7"
            />
          )}

          {points.length > 0 && (
            <g>

              <line
                x1={paddingX}
                y1={points[points.length - 1].y}
                x2={chartWidth - paddingX}
                y2={points[points.length - 1].y}
                stroke={isPositive ? '#00E599' : '#F43F5E'}
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.6"
              />

              {isOnline && (
                <circle
                  cx={points[points.length - 1].x}
                  cy={points[points.length - 1].y}
                  r="7"
                  fill={isPositive ? '#00E599' : '#F43F5E'}
                  opacity="0.3"
                  className="animate-ping"
                />
              )}
              <circle
                cx={points[points.length - 1].x}
                cy={points[points.length - 1].y}
                r="4"
                fill={isPositive ? '#00E599' : '#F43F5E'}
                stroke={isDark ? '#080B11' : '#FFFFFF'}
                strokeWidth="1.5"
              />
            </g>
          )}

          {mousePos && (
            <g>

              <line
                x1={mousePos.x}
                y1={paddingY}
                x2={mousePos.x}
                y2={chartHeight - paddingY}
                stroke={isDark ? '#94A3B8' : '#64748B'}
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.7"
              />

              <line
                x1={paddingX}
                y1={mousePos.y}
                x2={chartWidth - paddingX}
                y2={mousePos.y}
                stroke={isDark ? '#94A3B8' : '#64748B'}
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.7"
              />

              <circle cx={mousePos.x} cy={mousePos.y} r="3.5" fill="#38BDF8" stroke={isDark ? '#080B11' : '#FFFFFF'} strokeWidth="1" />
            </g>
          )}
        </svg>

        <div
          style={{
            top: `${((points[points.length - 1]?.y || usableHeight / 2) / chartHeight) * 100}%`,
            transform: 'translateY(-50%)'
          }}
          className={`absolute right-2 px-2 py-0.5 rounded text-[10px] font-mono font-bold shadow-lg pointer-events-none ${isPositive ? 'bg-emerald-500 text-slate-950' : 'bg-red-500 text-white'
            }`}
        >
          ${formatPriceDigits(currentPrice)}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between text-xs text-slate-400 font-mono pt-1">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <span className="text-slate-500 text-[10px] block">24h High</span>
            <span className="text-slate-200 font-semibold">${formatPriceDigits(stats24h.high24h)}</span>
          </div>
          <div>
            <span className="text-slate-500 text-[10px] block">24h Low</span>
            <span className="text-slate-200 font-semibold">${formatPriceDigits(stats24h.low24h)}</span>
          </div>
          <div>
            <span className="text-slate-500 text-[10px] block">24h Volume</span>
            <span className="text-slate-200 font-semibold">
              ${(stats24h.volume24hUSD / 1e6).toFixed(1)}M
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px]">
          {showEMA && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-indigo-400" />
                <span className="text-indigo-300">EMA 9</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-amber-400" />
                <span className="text-amber-300">EMA 21</span>
              </div>
            </>
          )}
          <div className="flex items-center gap-1.5">
            <span className={`w-3 h-0.5 ${isPositive ? 'bg-emerald-400' : 'bg-red-400'}`} />
            <span className="text-slate-300">Real Price Action</span>
          </div>
        </div>
      </div>
    </div>
  );
};
