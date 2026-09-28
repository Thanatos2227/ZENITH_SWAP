import React, { useState, useEffect } from 'react';
import { useZenithStore } from '../../stores/useZenithStore';
import { detectInstalledWallets, formatAddress } from '../../utils/walletDetector';
import { WalletOption } from '@zenith/types';
import { X, ShieldCheck, Zap, ExternalLink, ChevronRight, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
export const WalletModal: React.FC = () => {
    const { isWalletModalOpen, closeWalletModal, connectWalletWithType, isWalletConnecting, isWalletConnected, walletAddress, connectedWalletName, isWrongNetwork, chainId, sourceChain, walletError, disconnectWallet } = useZenithStore();
    const [wallets, setWallets] = useState<WalletOption[]>([]);
    const [activeFilter, setActiveFilter] = useState<'ALL' | 'EVM' | 'SOLANA'>('ALL');
    useEffect(() => {
        if (isWalletModalOpen) {
            setWallets(detectInstalledWallets());
        }
    }, [isWalletModalOpen]);
    if (!isWalletModalOpen)
        return null;
    const filteredWallets = wallets.filter((w) => {
        if (activeFilter === 'ALL')
            return true;
        if (activeFilter === 'EVM')
            return w.environment === 'EVM' || w.environment === 'MULTI';
        if (activeFilter === 'SOLANA')
            return w.environment === 'SOLANA' || w.environment === 'MULTI';
        return true;
    });
    const detectedCount = wallets.filter((w) => w.isDetected).length;
    return (<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-md glass-panel rounded-2xl border border-slate-700/80 shadow-modal overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
              <Zap className="w-5 h-5 text-slate-950 fill-slate-950"/>
            </div>
            <div>
              <h3 className="font-display font-bold text-lg text-white">
                {isWalletConnected ? 'Connected Wallet' : 'Connect Wallet'}
              </h3>
              <p className="text-xs text-slate-400">Non-custodial multi-chain trading</p>
            </div>
          </div>
          <button onClick={closeWalletModal} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5"/>
          </button>
        </div>

        {isWalletConnected ? (<div className="p-5 space-y-4">
            <div className="p-4 rounded-xl bg-[#0B111E] border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">Active Provider</span>
                <span className="text-xs font-bold text-cyan-300 font-mono">
                  {connectedWalletName || 'Web3 Injected'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">Account Address</span>
                <span className="text-xs sm:text-sm font-bold text-white font-mono" title={walletAddress}>
                  {formatAddress(walletAddress, 10, 8)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">Network</span>
                <span className={`text-xs font-bold font-mono ${isWrongNetwork ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {isWrongNetwork
                ? `Unsupported (Chain ID: ${chainId ?? 'Unknown'})`
                : sourceChain.canonicalName}
                </span>
              </div>

              {isWrongNetwork ? (<div className="flex items-center gap-1.5 text-xs text-amber-400 pt-1 bg-amber-500/10 p-2 rounded-lg border border-amber-500/20">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0"/>
                  <span>Please switch to a supported network in your wallet extension.</span>
                </div>) : (<div className="flex items-center gap-1.5 text-xs text-emerald-400 pt-1">
                  <ShieldCheck className="w-4 h-4 text-emerald-400"/>
                  <span>Non-Custodial Authority Active</span>
                </div>)}
            </div>

            <button onClick={async () => {
                closeWalletModal();
                await disconnectWallet();
            }} className="w-full py-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 font-bold text-sm transition-colors">
              Disconnect Wallet
            </button>
          </div>) : (<div className="p-5 space-y-4">
            {walletError && (<div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-400 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0"/>
                <span>{walletError}</span>
              </div>)}
            <div className="flex items-center gap-1.5 bg-[#0B111E] p-1 rounded-xl border border-slate-800 text-xs">
              <button onClick={() => setActiveFilter('ALL')} className={`flex-1 py-1.5 rounded-lg font-semibold transition-colors ${activeFilter === 'ALL'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200'}`}>
                All Wallets
              </button>
              <button onClick={() => setActiveFilter('EVM')} className={`flex-1 py-1.5 rounded-lg font-semibold transition-colors ${activeFilter === 'EVM'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200'}`}>
                EVM Chains
              </button>
              <button onClick={() => setActiveFilter('SOLANA')} className={`flex-1 py-1.5 rounded-lg font-semibold transition-colors ${activeFilter === 'SOLANA'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200'}`}>
                Solana SVM
              </button>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {filteredWallets.map((w) => (<div key={w.id} onClick={() => connectWalletWithType(w.id)} className="flex items-center justify-between p-3.5 rounded-xl bg-[#0B111E] border border-slate-800 hover:border-cyan-500/50 hover:bg-slate-800/40 cursor-pointer transition-all group">
                  <div className="flex items-center gap-3">
                    <img src={w.icon} alt={w.name} className="w-7 h-7 rounded-lg" onError={(e) => {
                    (e.target as HTMLImageElement).style.opacity = '0.3';
                }}/>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white group-hover:text-cyan-300 transition-colors">
                          {w.name}
                        </span>
                        {w.isDetected && (<span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                            Detected
                          </span>)}
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {w.environment === 'MULTI' ? 'EVM & Solana' : w.environment}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isWalletConnecting ? (<Loader2 className="w-4 h-4 text-cyan-400 animate-spin"/>) : (<ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-cyan-400 transition-colors"/>)}
                  </div>
                </div>))}
            </div>

            <div className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 text-[11px] text-slate-400 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0"/>
              <span>
                By connecting a wallet, you agree to the non-custodial decentralized trading terms.
              </span>
            </div>
          </div>)}
      </div>
    </div>);
};
