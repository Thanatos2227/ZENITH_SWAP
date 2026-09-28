import React from 'react';
import { useZenithStore } from '../../stores/useZenithStore';
import { ExternalLink, History, ArrowRight } from 'lucide-react';
export const HistoryView: React.FC = () => {
    const { transactionHistory } = useZenithStore();
    return (<div className="w-full max-w-7xl mx-auto space-y-6">
      <div className="glass-panel rounded-2xl p-6 border border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="font-display font-extrabold text-2xl text-white">Execution History</h2>
          <p className="text-sm text-slate-400">
            Immutable indexed record of on-chain swaps, bridge transfers, and execution diagnostics
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800 text-slate-300">
          <History className="w-4 h-4 text-cyan-400"/>
          <span>{transactionHistory.length} Transactions</span>
        </div>
      </div>

      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        {transactionHistory.length === 0 ? (<div className="p-12 text-center text-slate-500 space-y-2">
            <p className="text-base font-semibold">No recent transactions recorded</p>
            <p className="text-xs">Your completed and cross-chain swaps will appear here with full execution receipts.</p>
          </div>) : (<div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[#0B111E] text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-3.5 px-4 font-sans">Time</th>
                  <th className="py-3.5 px-4 font-sans">Pair</th>
                  <th className="py-3.5 px-4 font-sans">Route / Bridge</th>
                  <th className="py-3.5 px-4 font-sans">Score</th>
                  <th className="py-3.5 px-4 font-sans">Price Impact</th>
                  <th className="py-3.5 px-4 font-sans">Gas Paid</th>
                  <th className="py-3.5 px-4 font-sans text-right">Explorer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {transactionHistory.map((rx, idx) => (<tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-4 text-slate-400">
                      {new Date(rx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>

                    <td className="py-3.5 px-4 font-sans font-bold text-white">
                      <div className="flex items-center gap-1.5">
                        <span>{rx.amountInFormatted} {rx.tokenIn.symbol}</span>
                        <ArrowRight className="w-3 h-3 text-cyan-400"/>
                        <span className="text-emerald-400">{rx.amountOutFormatted} {rx.tokenOut.symbol}</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 text-slate-300">
                      {rx.sourceChain.shortName} → {rx.destinationChain.shortName}
                    </td>

                    <td className="py-3.5 px-4">
                      <span className="text-emerald-400 font-bold">{rx.effectiveExecutionScore}/100</span>
                    </td>

                    <td className="py-3.5 px-4 text-slate-300">{rx.realizedPriceImpactPercent}%</td>

                    <td className="py-3.5 px-4 text-slate-300">${rx.gasPaidUSD.toFixed(2)}</td>

                    <td className="py-3.5 px-4 text-right font-sans">
                      <a href={rx.explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-semibold transition-colors">
                        {rx.txHash.slice(0, 6)}...
                        <ExternalLink className="w-3 h-3"/>
                      </a>
                    </td>
                  </tr>))}
              </tbody>
            </table>
          </div>)}
      </div>
    </div>);
};
