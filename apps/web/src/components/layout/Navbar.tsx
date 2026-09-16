import React from 'react';
import { useZenithStore } from '../../stores/useZenithStore';
import { formatAddress } from '../../utils/walletDetector';
import {
  Zap,
  Layers,
  BarChart3,
  TrendingUp,
  PieChart,
  History,
  Bell,
  Sun,
  Moon,
  ChevronDown,
  Wallet,
  AlertTriangle
} from 'lucide-react';

export const Navbar: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    theme,
    toggleTheme,
    sourceChain,
    openChainPicker,
    isWalletConnected,
    walletAddress,
    connectedWalletName,
    isWrongNetwork,
    chainId,
    openWalletModal,
    notifications,
    toggleNotificationDrawer
  } = useZenithStore();

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const navItems: Array<{ id: 'TRADE' | 'POOLS' | 'EXPLORE' | 'MARKETS' | 'PORTFOLIO' | 'HISTORY'; label: string; icon: React.FC<{ className?: string }> }> = [
    { id: 'TRADE', label: 'Trade', icon: Zap },
    { id: 'POOLS', label: 'Pools', icon: Layers },
    { id: 'EXPLORE', label: 'Explore', icon: BarChart3 },
    { id: 'MARKETS', label: 'Markets', icon: TrendingUp },
    { id: 'PORTFOLIO', label: 'Portfolio', icon: PieChart },
    { id: 'HISTORY', label: 'History', icon: History }
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800/90 bg-[#080B11]/90 backdrop-blur-md transition-colors duration-200">
      {}
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-3">
        {}
        <div
          onClick={() => setActiveTab('TRADE')}
          className="flex items-center gap-2.5 sm:gap-3 cursor-pointer group select-none shrink-0"
        >
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl gradient-brand flex items-center justify-center shadow-glow-cyan">
            <Zap className="w-5 h-5 sm:w-6 sm:h-6 text-slate-950 fill-slate-950 transform group-hover:scale-110 transition-transform" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-display font-black text-lg sm:text-xl tracking-wider text-white">
                ZENITH SWAP
              </span>
              <span className="text-[9px] sm:text-[10px] uppercase font-bold tracking-widest px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                v4
              </span>
            </div>
            <p className="text-[9px] sm:text-[10px] text-slate-400 font-medium tracking-tight -mt-0.5">
              Trade Beyond Limits
            </p>
          </div>
        </div>

        {/* Right: Controls & Wallet */}
        <div className="flex items-center flex-wrap gap-2 sm:gap-3 shrink-0">
          {/* Network Selector */}
          <button
            onClick={() => openChainPicker('SOURCE')}
            className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors text-xs sm:text-sm font-medium text-slate-200 shrink-0 shadow-sm"
            title={`Active Network: ${sourceChain.canonicalName}`}
          >
            <img
              src={sourceChain.iconURI}
              alt={sourceChain.shortName}
              className="w-4 h-4 rounded-full"
              onError={(e) => {
                (e.target as HTMLImageElement).style.opacity = '0.3';
              }}
            />
            <span className="font-semibold">{sourceChain.shortName}</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {/* Notifications */}
          <button
            onClick={toggleNotificationDrawer}
            className="relative p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-cyan-400 transition-colors shrink-0"
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-cyan-500 text-slate-950 text-[10px] font-bold flex items-center justify-center animate-pulse">
                {unreadCount}
              </span>
            )}
          </button>

          {}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-yellow-400 transition-colors shrink-0"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-yellow-400" />
            ) : (
              <Moon className="w-4 h-4 text-slate-700" />
            )}
          </button>

          {/* Wallet Connection */}
          {isWalletConnected ? (
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {isWrongNetwork && (
                <div
                  onClick={openWalletModal}
                  className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold cursor-pointer hover:bg-amber-500/20 transition-colors animate-pulse shrink-0"
                  title="Chain mismatch between wallet and selected swap network"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  <span className="font-mono">Wrong Network</span>
                </div>
              )}
              <button
                onClick={openWalletModal}
                className={`flex items-center gap-2 px-3 sm:px-3.5 py-1.5 rounded-lg bg-slate-900 border font-mono text-xs sm:text-sm font-semibold transition-all shadow-sm whitespace-nowrap shrink-0 ${
                  isWrongNetwork
                    ? 'border-amber-500/50 text-amber-300 hover:border-amber-500'
                    : 'border-cyan-500/30 hover:border-cyan-500/60 text-cyan-300'
                }`}
                title={`Connected: ${connectedWalletName || 'Wallet'} (${walletAddress})`}
              >
                <span className={`w-2 h-2 rounded-full ${isWrongNetwork ? 'bg-amber-400 animate-ping' : 'bg-emerald-400 animate-pulse'}`} />
                <span>
                  {connectedWalletName ? `${connectedWalletName}: ` : ''}
                  {formatAddress(walletAddress)}
                </span>
              </button>
            </div>
          ) : (
            <button
              onClick={openWalletModal}
              className="gradient-brand text-slate-950 px-3.5 sm:px-4 py-1.5 rounded-lg font-bold text-xs sm:text-sm shadow-glow-cyan hover:opacity-95 transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Wallet className="w-4 h-4" />
              Connect Wallet
            </button>
          )}
        </div>
      </div>

      {/* Bottom Row: Navigation Items */}
      <div className="w-full border-t border-slate-800/80 bg-[#080B11]/85 px-3 sm:px-6 lg:px-8 py-1.5">
        <nav className="max-w-7xl mx-auto flex flex-wrap items-center justify-center gap-1 sm:gap-2">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-colors shrink-0 ${
                activeTab === id
                  ? 'bg-slate-800/90 text-cyan-400 shadow-sm border border-slate-700/50'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
};
