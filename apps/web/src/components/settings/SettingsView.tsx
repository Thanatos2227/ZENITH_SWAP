import React from 'react';
import { useZenithStore } from '../../stores/useZenithStore';
import { ShieldCheck, Lock, Fuel, Sliders, CheckCircle2 } from 'lucide-react';
export const SettingsView: React.FC = () => {
    const { slippagePreset, setSlippage, gasPreset, setGasPreset, mevProtection, setMEVProtection } = useZenithStore();
    return (<div className="w-full max-w-4xl mx-auto space-y-6">
      <div className="glass-panel rounded-2xl p-6 border border-slate-800">
        <h2 className="font-display font-extrabold text-2xl text-white mb-1">Trading & Security Settings</h2>
        <p className="text-sm text-slate-400">
          Configure default slippage, private RPC routing, MEV shields, and accessibility options
        </p>
      </div>

      <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
        <div className="flex items-center gap-2 text-white font-bold text-base">
          <Sliders className="w-5 h-5 text-cyan-400"/>
          <h3>Slippage Tolerance</h3>
        </div>
        <p className="text-xs text-slate-400">
          Transactions will automatically revert if price moves adversely by more than this percentage.
        </p>

        <div className="flex flex-wrap gap-2">
          {(['AUTO', '0.1%', '0.5%', '1.0%'] as const).map((preset) => (<button key={preset} onClick={() => setSlippage(preset)} className={`px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all ${slippagePreset === preset
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-glow-cyan'
                : 'bg-slate-900 text-slate-400 border border-slate-800 hover:border-slate-700'}`}>
              {preset}
            </button>))}
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
        <div className="flex items-center gap-2 text-white font-bold text-base">
          <Lock className="w-5 h-5 text-indigo-400"/>
          <h3>MEV & Frontrunning Protection</h3>
        </div>
        <p className="text-xs text-slate-400">
          Route transactions via private builder relays and stealth mempools to prevent sandwich attacks.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            {
                id: 'FLASHBOTS_PRIVATE',
                title: 'Flashbots Protect',
                desc: 'Private mempool with 100% frontrunning & sandwich protection'
            },
            {
                id: 'RPC_STEALTH',
                title: 'Stealth RPC',
                desc: 'High-speed private relay routing via Blocknative Protect'
            },
            {
                id: 'NONE',
                title: 'Standard Mempool',
                desc: 'Public mempool broadcast (standard speed, zero extra latency)'
            }
        ].map((item) => (<div key={item.id} onClick={() => setMEVProtection(item.id as any)} className={`p-4 rounded-xl border cursor-pointer transition-all ${mevProtection === item.id
                ? 'bg-cyan-950/30 border-cyan-500/50 shadow-glow-cyan'
                : 'bg-slate-900 border-slate-800 hover:border-slate-700'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-sm text-white">{item.title}</span>
                {mevProtection === item.id && <CheckCircle2 className="w-4 h-4 text-cyan-400"/>}
              </div>
              <p className="text-xs text-slate-400">{item.desc}</p>
            </div>))}
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-4">
        <div className="flex items-center gap-2 text-white font-bold text-base">
          <Fuel className="w-5 h-5 text-amber-400"/>
          <h3>Gas Priority Speed</h3>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['STANDARD', 'FAST', 'INSTANT'] as const).map((preset) => (<button key={preset} onClick={() => setGasPreset(preset)} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${gasPreset === preset
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-slate-900 text-slate-400 border border-slate-800 hover:border-slate-700'}`}>
              {preset}
            </button>))}
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-3">
        <div className="flex items-center gap-2 text-white font-bold text-base">
          <ShieldCheck className="w-5 h-5 text-emerald-400"/>
          <h3>System Security & Compliance Matrix</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
            <span className="text-slate-400 block">Custody Model</span>
            <span className="font-bold text-emerald-400">100% Non-Custodial (User owns keys)</span>
          </div>
          <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
            <span className="text-slate-400 block">Accessibility Standard</span>
            <span className="font-bold text-cyan-400">WCAG 2.1 AA Compliant</span>
          </div>
          <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
            <span className="text-slate-400 block">Protocol Fee Cap</span>
            <span className="font-bold text-white">Immutable 0.30% Max (Default: 0.05%)</span>
          </div>
          <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
            <span className="text-slate-400 block">Circuit Breaker</span>
            <span className="font-bold text-emerald-400">Active & Observable</span>
          </div>
        </div>
      </div>
    </div>);
};
