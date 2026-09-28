import React, { useEffect } from 'react';
import { useZenithStore } from './stores/useZenithStore';
import { Navbar } from './components/layout/Navbar';
import { UnifiedTradingView } from './components/trading/UnifiedTradingView';
import { PoolsView } from './components/pools/PoolsView';
import { ExploreView } from './components/explore/ExploreView';
import { MarketsView } from './components/markets/MarketsView';
import { PortfolioView } from './components/portfolio/PortfolioView';
import { HistoryView } from './components/history/HistoryView';
import { SettingsView } from './components/settings/SettingsView';
import { ConfirmSheet } from './components/modals/ConfirmSheet';
import { TokenPickerModal } from './components/modals/TokenPickerModal';
import { ChainPickerModal } from './components/modals/ChainPickerModal';
import { WalletModal } from './components/modals/WalletModal';
import { ReceiptModal } from './components/postTrade/ReceiptModal';
import { NotificationCenter } from './components/notifications/NotificationCenter';
import { ShieldCheck, Lock, Globe } from 'lucide-react';
export const App: React.FC = () => {
    const { activeTab, theme, fetchMarketData, initializeWalletSession } = useZenithStore();
    const isDark = theme === 'dark';
    useEffect(() => {
        fetchMarketData();
        initializeWalletSession();
    }, [fetchMarketData, initializeWalletSession]);
    return (<div className={`min-h-screen flex flex-col ${isDark ? 'bg-[#080B11] text-slate-100' : 'bg-[#F8FAFC] text-slate-900'} font-sans selection:bg-cyan-500/30 selection:text-cyan-200 transition-colors duration-200`}>
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 flex flex-col justify-start">
        {activeTab === 'TRADE' && <UnifiedTradingView />}
        {activeTab === 'POOLS' && <PoolsView />}
        {activeTab === 'EXPLORE' && <ExploreView />}
        {activeTab === 'MARKETS' && <MarketsView />}
        {activeTab === 'PORTFOLIO' && <PortfolioView />}
        {activeTab === 'HISTORY' && <HistoryView />}
        {activeTab === 'SETTINGS' && <SettingsView />}
      </main>

      <ConfirmSheet />
      <TokenPickerModal />
      <ChainPickerModal />
      <WalletModal />
      <ReceiptModal />
      <NotificationCenter />

      <footer className={`w-full border-t ${isDark ? 'border-slate-800/80 bg-[#080B11]/90 text-slate-400' : 'border-slate-200 bg-white/90 text-slate-600'} py-6 text-xs transition-colors duration-200`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"/>
            <span className={`font-mono ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>All 52 Networks Operational</span>
            <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>|</span>
            <span className="font-mono text-cyan-400">MEV Protected</span>
          </div>

          <div className="flex items-center gap-6">
            <span className="flex items-center gap-1 text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400"/>
              Non-Custodial
            </span>
            <span className="flex items-center gap-1 text-slate-400">
              <Lock className="w-3.5 h-3.5 text-indigo-400"/>
              Audited Routing
            </span>
            <span className="flex items-center gap-1 text-slate-400">
              <Globe className="w-3.5 h-3.5 text-cyan-400"/>
              Universal EVM + Solana
            </span>
          </div>

          <p className="text-[11px] text-slate-500 font-mono">
            ZENITH SWAP v4.0.0 — Trade Beyond Limits.
          </p>
        </div>
      </footer>
    </div>);
};
export default App;
