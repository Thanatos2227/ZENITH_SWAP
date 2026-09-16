import React from 'react';
import { useZenithStore } from '../../stores/useZenithStore';
import {
  CheckCircle2,
  ExternalLink,
  X,
  ArrowRight,
  ShieldCheck,
  Clock
} from 'lucide-react';

export const ReceiptModal: React.FC = () => {
  const { isReceiptOpen, closeReceipt, lastReceipt } = useZenithStore();

  if (!isReceiptOpen || !lastReceipt) return null;

  const destChain = lastReceipt.destChain || lastReceipt.destinationChain || lastReceipt.sourceChain;
  const isCrossChain = Boolean(lastReceipt.bridgeDetails || lastReceipt.sourceChain.id !== destChain.id);
  const bridge = lastReceipt.bridgeDetails;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-md glass-panel rounded-2xl border border-emerald-500/40 shadow-glow-emerald overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display font-bold text-lg text-white">
                {isCrossChain ? 'Cross-Chain Receipt' : 'Execution Receipt'}
              </h3>
              <p className="text-xs text-slate-400">
                {isCrossChain
                  ? bridge?.destinationVerified
                    ? 'Cross-Chain Settlement Verified'
                    : 'Source Confirmed • Bridge In-Flight'
                  : 'Transaction Confirmed On-Chain'}
              </p>
            </div>
          </div>
          <button
            onClick={closeReceipt}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="p-4 rounded-xl bg-[#0B111E] border border-slate-800 text-center space-y-1">
            <p className="text-xs text-slate-400">Successfully Swapped</p>
            <p className="text-xl font-bold font-mono text-white">
              {lastReceipt.amountInFormatted} {lastReceipt.tokenIn.symbol}
            </p>
            <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
              <span>on {lastReceipt.sourceChain.canonicalName}</span>
              <ArrowRight className="w-3 h-3 text-cyan-400" />
              <span className="font-bold text-emerald-400 font-mono">
                {lastReceipt.amountOutFormatted} {lastReceipt.tokenOut.symbol}
              </span>
              <span>on {destChain.canonicalName}</span>
            </div>
          </div>

          <div className="space-y-2 text-xs bg-slate-900/60 rounded-xl p-3.5 border border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Source Tx Hash</span>
              <span className="font-mono text-cyan-400 font-semibold">
                {lastReceipt.txHash.slice(0, 10)}...{lastReceipt.txHash.slice(-8)}
              </span>
            </div>

            {bridge && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Bridge Provider</span>
                  <span className="font-mono font-bold text-indigo-400">{bridge.bridgeName}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Settlement Status</span>
                  <span className="font-mono flex items-center gap-1">
                    {bridge.destinationVerified ? (
                      <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                        <ShieldCheck className="w-3.5 h-3.5" /> Verified On-Chain
                      </span>
                    ) : (
                      <span className="text-amber-400 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 animate-spin" /> In Flight ({bridge.elapsedSec}s)
                      </span>
                    )}
                  </span>
                </div>

                {bridge.destTxHash && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Dest Tx Hash</span>
                    <span className="font-mono text-emerald-400 font-semibold">
                      {bridge.destTxHash.slice(0, 10)}...{bridge.destTxHash.slice(-8)}
                    </span>
                  </div>
                )}
              </>
            )}

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Execution Score</span>
              <span className="font-mono font-bold text-emerald-400">
                {lastReceipt.effectiveExecutionScore}/100
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Realized Price Impact</span>
              <span className="font-mono text-emerald-400 font-semibold">
                {lastReceipt.realizedPriceImpactPercent}%
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Gas Paid ({lastReceipt.sourceChain.shortName})</span>
              <span className="font-mono text-emerald-400 font-semibold">
                ${lastReceipt.gasPaidUSD < 0.01 ? lastReceipt.gasPaidUSD.toFixed(4) : lastReceipt.gasPaidUSD.toFixed(2)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Route Execution</span>
              <span className="font-mono text-slate-300">{lastReceipt.routeSummary}</span>
            </div>
          </div>

          <div className="space-y-2">
            <a
              href={lastReceipt.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors"
            >
              <ExternalLink className="w-4 h-4 text-cyan-400" />
              View Source on {lastReceipt.sourceChain.explorer.name}
            </a>

            {bridge?.destExplorerUrl && (
              <a
                href={bridge.destExplorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 rounded-xl bg-emerald-950/40 hover:bg-emerald-900/40 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <ExternalLink className="w-4 h-4 text-emerald-400" />
                View Destination on {destChain.explorer.name}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
