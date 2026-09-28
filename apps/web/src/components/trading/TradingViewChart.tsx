import React, { useEffect, useRef, useState, useMemo, memo } from 'react';
import { Token } from '@zenith/types';
import { defaultMarketDataService } from '../../services/marketDataService';
import { ExternalLink, Activity } from 'lucide-react';
interface TradingViewChartProps {
    tokenIn: Token;
    tokenOut: Token;
}
const STABLES = new Set(['USDC', 'USDT', 'DAI', 'FDUSD', 'USDE', 'BUSD', 'USD']);
export function getTradingViewSymbol(tokenInSymbol: string, tokenOutSymbol: string): string {
    const sIn = defaultMarketDataService.resolveSymbol(tokenInSymbol);
    const sOut = defaultMarketDataService.resolveSymbol(tokenOutSymbol);
    if (!STABLES.has(sIn) && STABLES.has(sOut)) {
        return `BINANCE:${sIn}USDT`;
    }
    if (STABLES.has(sIn) && !STABLES.has(sOut)) {
        return `BINANCE:${sOut}USDT`;
    }
    if (STABLES.has(sIn) && STABLES.has(sOut)) {
        return `BINANCE:USDCUSDT`;
    }
    if ((sIn === 'ETH' && sOut === 'BTC') || (sIn === 'BTC' && sOut === 'ETH')) {
        return 'BINANCE:ETHBTC';
    }
    if ((sIn === 'SOL' && sOut === 'ETH') || (sIn === 'ETH' && sOut === 'SOL')) {
        return 'BINANCE:SOLETH';
    }
    if ((sIn === 'SOL' && sOut === 'BTC') || (sIn === 'BTC' && sOut === 'SOL')) {
        return 'BINANCE:SOLBTC';
    }
    return `BINANCE:${sIn}USDT`;
}
const TradingViewChartComponent: React.FC<TradingViewChartProps> = ({ tokenIn, tokenOut }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [loadError, setLoadError] = useState(false);
    const tvSymbol = useMemo(() => {
        return getTradingViewSymbol(tokenIn.symbol, tokenOut.symbol);
    }, [tokenIn.symbol, tokenOut.symbol]);
    const containerId = useMemo(() => `tv_chart_container_${Math.random().toString(36).substring(2, 9)}`, [tvSymbol]);
    useEffect(() => {
        setLoadError(false);
        let isCancelled = false;
        const initWidget = () => {
            if (isCancelled)
                return;
            if ((window as any).TradingView && (window as any).TradingView.widget) {
                try {
                    if (containerRef.current) {
                        containerRef.current.innerHTML = `<div id="${containerId}" style="height:100%;width:100%;"></div>`;
                    }
                    new (window as any).TradingView.widget({
                        autosize: true,
                        symbol: tvSymbol,
                        interval: '15',
                        timezone: 'Etc/UTC',
                        theme: 'dark',
                        style: '1',
                        locale: 'en',
                        toolbar_bg: '#080B11',
                        enable_publishing: false,
                        allow_symbol_change: true,
                        container_id: containerId,
                        hide_side_toolbar: false,
                        withdateranges: true,
                        details: true,
                        hotlist: false,
                        calendar: false,
                        show_popup_button: true,
                        popup_width: '1000',
                        popup_height: '650',
                        studies: [
                            'MASimple@tv-basicstudies',
                            'RSI@tv-basicstudies'
                        ],
                        disabled_features: ['header_saveload'],
                        loading_screen: { backgroundColor: '#080B11', foregroundColor: '#00E599' }
                    });
                }
                catch (e) {
                    console.warn('TradingView widget initialization fallback:', e);
                    setLoadError(true);
                }
            }
            else {
                const existingScript = document.getElementById('tradingview-tv-script');
                if (!existingScript) {
                    const script = document.createElement('script');
                    script.id = 'tradingview-tv-script';
                    script.src = 'https://s3.tradingview.com/tv.js';
                    script.type = 'text/javascript';
                    script.async = true;
                    script.onload = () => {
                        if (!isCancelled)
                            initWidget();
                    };
                    script.onerror = () => {
                        if (!isCancelled)
                            setLoadError(true);
                    };
                    document.head.appendChild(script);
                }
                else {
                    existingScript.addEventListener('load', () => {
                        if (!isCancelled)
                            initWidget();
                    });
                }
            }
        };
        const timer = setTimeout(() => {
            if (!isCancelled && !(window as any).TradingView) {
                setLoadError(true);
            }
        }, 3000);
        initWidget();
        return () => {
            isCancelled = true;
            clearTimeout(timer);
            if (containerRef.current) {
                containerRef.current.innerHTML = '';
            }
        };
    }, [tvSymbol, containerId]);
    const displaySymbol = useMemo(() => {
        return tvSymbol.replace('BINANCE:', 'MARKET:');
    }, [tvSymbol]);
    const iframeSrc = useMemo(() => {
        return `https://s.tradingview.com/widgetembed/?frameElementId=tradingview_widget&symbol=${encodeURIComponent(tvSymbol)}&interval=15&hidesidetoolbar=0&symboledit=1&saveimage=1&toolbarbg=080B11&theme=dark&style=1&timezone=Etc%2FUTC&locale=en`;
    }, [tvSymbol]);
    return (<div className="w-full h-[460px] sm:h-[500px] rounded-xl overflow-hidden border border-slate-800 bg-[#080B11] relative flex flex-col">
      
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/90 border-b border-slate-800/80 text-xs font-mono">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-indigo-400"/>
          <span className="text-slate-300 font-semibold">TradingView Pro Chart</span>
          <span className="text-slate-500">|</span>
          <span className="text-cyan-400 font-bold">{displaySymbol}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <span>Real-Time Technical Engine</span>
          <a href={`https://www.tradingview.com/symbols/${tvSymbol.replace(':', '-')}/`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors">
            <ExternalLink className="w-3 h-3"/>
          </a>
        </div>
      </div>

      
      <div className="relative flex-1 w-full h-full min-h-[400px]">
        
        <div ref={containerRef} className={`w-full h-full ${loadError ? 'hidden' : 'block'}`}/>

        
        {loadError && (<iframe src={iframeSrc} title={`TradingView Pro - ${displaySymbol}`} className="w-full h-full border-0" allow="fullscreen"/>)}
      </div>
    </div>);
};
export const TradingViewChart = memo(TradingViewChartComponent);
