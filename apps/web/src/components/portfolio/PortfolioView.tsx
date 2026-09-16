import React from 'react';
import { useZenithStore, resolveTokenBalance } from '../../stores/useZenithStore';
import { formatAddress } from '../../utils/walletDetector';
import { defaultTokenService } from '@zenith/tokens';
import { defaultChainRegistry } from '@zenith/chains';
import { TokenLogo } from '../common/TokenLogo';
import { Wallet, ShieldCheck, Zap, RefreshCw, Loader2 } from 'lucide-react';

export const PortfolioView: React.FC = () => {
  const {
    walletAddress,
    isWalletConnected,
    walletBalances,
    isBalanceLoading,
    sourceChain,
    openWalletModal,
    setSourceChain,
    setTokenIn,
    setActiveTab,
    refreshBalance
  } = useZenithStore();

  const chainTokens = isWalletConnected
    ? defaultTokenService.getTokensForChain(sourceChain.id)
    : [];

  const userTokens = chainTokens.map((token) => {
    const balStr = resolveTokenBalance(sourceChain.id, token, walletBalances);
    const balance = parseFloat(balStr) || 0;
    return {
      token,
      balance,
      balanceStr: balStr,
      chainId: sourceChain.id
    };
  });

  const totalValueUSD = userTokens.reduce((acc, item) => {
    return acc + (item.token.priceUSD ? item.balance * item.token.priceUSD : 0);
  }, 0);

  const handleSwapAsset = (item: (typeof userTokens)[0]) => {
    const chain = defaultChainRegistry.getChain(item.chainId);
    if (chain) {
      setSourceChain(chain);
      setTokenIn(item.token);
      setActiveTab('TRADE');
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-semibold uppercase tracking-wider">Total Net Worth</span>
            <Wallet className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-extrabold font-mono text-white">
              ${isWalletConnected ? totalValueUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
            </p>
            {isBalanceLoading && <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
            <span>{isWalletConnected ? `${sourceChain.canonicalName} Asset Valuation` : 'Connect wallet to inspect balances'}</span>
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-semibold uppercase tracking-wider">Chains Active</span>
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-3xl font-extrabold font-mono text-white">
            {isWalletConnected ? '1 Network' : '0 Networks'}
          </p>
          <p className="text-xs text-slate-400 font-mono">
            {isWalletConnected ? `Connected to ${sourceChain.canonicalName}` : 'No active network connections'}
          </p>
        </div>

        <div className="glass-panel rounded-2xl p-6 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-semibold uppercase tracking-wider">Custody Status</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          {isWalletConnected ? (
            <>
              <p className="text-lg font-bold font-mono text-cyan-300 truncate" title={walletAddress}>
                {formatAddress(walletAddress, 10, 8)}
              </p>
              <p className="text-xs text-emerald-400 font-semibold">100% Non-Custodial On-Chain</p>
            </>
          ) : (
            <>
              <p className="text-sm font-bold text-slate-400">Wallet Disconnected</p>
              <button
                onClick={openWalletModal}
                className="text-xs text-cyan-400 hover:underline font-semibold"
              >
                Connect a Wallet →
              </button>
            </>
          )}
        </div>
      </div>

      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="p-4 bg-[#0B111E] border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="font-display font-bold text-base text-white">Your Network Assets</h3>
            {isWalletConnected && (
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                {sourceChain.canonicalName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-slate-400">
              {isWalletConnected ? `${userTokens.length} tracked tokens` : 'Wallet not connected'}
            </span>
            {isWalletConnected && (
              <button
                onClick={() => refreshBalance()}
                disabled={isBalanceLoading}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 border border-slate-700 transition-colors disabled:opacity-50"
                title="Refresh balances from blockchain"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isBalanceLoading ? 'animate-spin text-cyan-400' : ''}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            )}
          </div>
        </div>

        {isWalletConnected ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0B111E]/50 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800/80">
                <tr>
                  <th className="py-3.5 px-4">Asset</th>
                  <th className="py-3.5 px-4">Network</th>
                  <th className="py-3.5 px-4">Balance</th>
                  <th className="py-3.5 px-4">Price</th>
                  <th className="py-3.5 px-4">Value (USD)</th>
                  <th className="py-3.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50 font-mono">
                {userTokens.map((item, idx) => {
                  const chain = defaultChainRegistry.getChain(item.chainId);
                  const valueUSD = item.token.priceUSD ? item.balance * item.token.priceUSD : 0;

                  return (
                    <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-4 font-sans">
                        <div className="flex items-center gap-3">
                          <TokenLogo
                            symbol={item.token.symbol}
                            name={item.token.name}
                            logoURI={item.token.logoURI}
                            chainId={item.token.chainId}
                            address={item.token.address}
                            isNative={item.token.isNative}
                            className="w-7 h-7 rounded-full"
                          />
                          <div>
                            <p className="font-bold text-sm text-white">{item.token.symbol}</p>
                            <p className="text-xs text-slate-400">{item.token.name}</p>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
                          {chain?.shortName || item.chainId}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 font-bold text-white text-sm">
                        {isBalanceLoading && item.balanceStr === '0.00' ? (
                          <span className="text-slate-500 flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                            Loading...
                          </span>
                        ) : (
                          <span>
                            {item.balance > 0 ? item.balance.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '0.00'} {item.token.symbol}
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-slate-300">
                        {item.token.priceUSD !== undefined ? `$${item.token.priceUSD.toLocaleString()}` : '—'}
                      </td>

                      <td className="py-3.5 px-4 font-bold text-cyan-300 text-sm">
                        ${valueUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => handleSwapAsset(item)}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-cyan-500/20 hover:text-cyan-300 text-slate-300 font-bold font-sans text-xs transition-colors"
                        >
                          Trade
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-slate-400 space-y-3">
            <p className="text-sm">Connect your wallet to inspect balances and cross-chain portfolio.</p>
            <button
              onClick={openWalletModal}
              className="px-4 py-2 rounded-xl gradient-brand text-slate-950 font-bold text-xs shadow-glow-cyan"
            >
              Connect Wallet
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
