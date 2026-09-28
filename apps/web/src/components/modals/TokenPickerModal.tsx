import React, { useState } from 'react';
import { useZenithStore } from '../../stores/useZenithStore';
import { defaultTokenService } from '@zenith/tokens';
import { defaultChainRegistry } from '@zenith/chains';
import { Token, ChainConfig } from '@zenith/types';
import { TokenLogo } from '../common/TokenLogo';
import { X, Search, CheckCircle2, PlusCircle, TrendingUp, TrendingDown, Layers } from 'lucide-react';
export const TokenPickerModal: React.FC = () => {
    const { isTokenPickerOpen, closeTokenPicker, tokenPickerTarget, sourceChain, destChain, tokenIn, tokenOut, setSourceChain, setDestChain, setTokenIn, setTokenOut } = useZenithStore();
    const [searchQuery, setSearchQuery] = useState('');
    const [isImportMode, setIsImportMode] = useState(false);
    const [customAddress, setCustomAddress] = useState('');
    const [customSymbol, setCustomSymbol] = useState('');
    const [customDecimals, setCustomDecimals] = useState('18');
    if (!isTokenPickerOpen)
        return null;
    const targetChain = tokenPickerTarget === 'IN' ? sourceChain : destChain;
    const activeSelected = tokenPickerTarget === 'IN' ? tokenIn : tokenOut;
    const allChains = defaultChainRegistry.getAllChains();
    const tokens = searchQuery.trim()
        ? defaultTokenService.searchTokens(searchQuery, targetChain.id)
        : defaultTokenService.getTokensForChain(targetChain.id);
    const unsupportedMatches = searchQuery.trim()
        ? defaultTokenService.searchUnsupportedTokenMetadata(searchQuery)
        : [];
    const handleSelectChain = (chain: ChainConfig) => {
        if (tokenPickerTarget === 'IN') {
            setSourceChain(chain);
            const native = defaultTokenService.getNativeToken(chain.id);
            if (native)
                setTokenIn(native);
        }
        else {
            setDestChain(chain);
            const tokensForDest = defaultTokenService.getTokensForChain(chain.id);
            const stable = tokensForDest.find((t) => t.symbol === 'USDC' || t.symbol === 'USDT') || tokensForDest[0];
            if (stable)
                setTokenOut(stable);
        }
    };
    const handleSelectToken = (token: Token) => {
        if (tokenPickerTarget === 'IN') {
            setTokenIn(token);
        }
        else {
            setTokenOut(token);
        }
        closeTokenPicker();
    };
    const handleImportCustom = (e: React.FormEvent) => {
        e.preventDefault();
        if (!customAddress || !customSymbol)
            return;
        try {
            const imported = defaultTokenService.importCustomToken({
                chainId: targetChain.id,
                address: customAddress,
                name: customSymbol.toUpperCase(),
                symbol: customSymbol.toUpperCase(),
                decimals: parseInt(customDecimals, 10) || 18
            });
            handleSelectToken(imported);
        }
        catch (err: any) {
            alert(err.message);
        }
    };
    const chainTokens = defaultTokenService.getTokensForChain(targetChain.id);
    const popularTokens = chainTokens.slice(0, 5);
    return (<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-lg glass-panel rounded-2xl border border-slate-700/80 shadow-modal overflow-hidden flex flex-col max-h-[85vh]">

        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div>
            <h3 className="font-display font-bold text-lg text-white">Select a Token</h3>
            <p className="text-xs text-slate-400">
              Active Network: <span className="text-cyan-400 font-semibold">{targetChain.canonicalName}</span> ({allChains.length} Networks Supported)
            </p>
          </div>
          <button onClick={closeTokenPicker} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
            <X className="w-5 h-5"/>
          </button>
        </div>

        <div className="p-3 bg-[#080d1a] border-b border-slate-800/80">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
            <Layers className="w-3.5 h-3.5 text-cyan-400"/>
            <span className="font-medium text-[11px] uppercase tracking-wider">Filter by Network ({allChains.length} Chains):</span>
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
            {allChains.map((c) => (<button key={c.id} onClick={() => handleSelectChain(c)} className={`px-2.5 py-1 rounded-lg text-xs font-semibold shrink-0 transition-colors inline-flex items-center gap-1.5 ${targetChain.id === c.id
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-glow-cyan'
                : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border border-slate-800'}`}>
                <img src={c.iconURI} alt={c.shortName} className="w-3.5 h-3.5 rounded-full" onError={(e) => {
                (e.target as HTMLImageElement).src =
                    'https://assets.coingecko.com/coins/images/279/small/ethereum.png';
            }}/>
                {c.shortName}
              </button>))}
          </div>
        </div>

        <div className="p-4 border-b border-slate-800/80 space-y-3">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"/>
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search token symbol, name, or paste address across all chains..." className="w-full pl-10 pr-4 py-2.5 bg-[#0B111E] border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/60"/>
          </div>

          {popularTokens.length > 0 && !searchQuery && (<div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-slate-500 font-medium">Popular on {targetChain.shortName}:</span>
              {popularTokens.map((t) => (<button key={`${t.chainId}-${t.symbol}-${t.address}`} onClick={() => handleSelectToken(t)} className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs text-white font-medium inline-flex items-center gap-1.5 transition-colors">
                  <TokenLogo symbol={t.symbol} name={t.name} logoURI={t.logoURI} chainId={t.chainId} address={t.address} isNative={t.isNative} className="w-3.5 h-3.5 rounded-full"/>
                  {t.symbol}
                </button>))}
            </div>)}
        </div>

        <div className="p-2 overflow-y-auto divide-y divide-slate-800/40 flex-1">
          {tokens.length === 0 && unsupportedMatches.length === 0 ? (<div className="py-8 text-center">
              <p className="text-slate-400 text-sm mb-3">No tokens found for "{searchQuery}"</p>
              <button onClick={() => setIsImportMode(true)} className="px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 text-xs font-semibold inline-flex items-center gap-1.5">
                <PlusCircle className="w-3.5 h-3.5"/>
                Import Custom Contract
              </button>
            </div>) : (<>
            {tokens.map((t) => {
                const isSelected = activeSelected.address.toLowerCase() === t.address.toLowerCase() && activeSelected.chainId === t.chainId;
                const riskScore = t.securityProfile?.riskScore ?? 0;
                const isPositive = (t.change24hUSD || 0) >= 0;
                const tokenChain = defaultChainRegistry.getChain(t.chainId);
                return (<div key={`${t.chainId}-${t.address}`} onClick={() => handleSelectToken(t)} className={`flex items-center justify-between p-3 rounded-xl cursor-pointer hover:bg-slate-800/60 transition-colors ${isSelected ? 'bg-slate-800/80 border border-cyan-500/30' : ''}`}>
                  <div className="flex items-center gap-3">
                    <TokenLogo symbol={t.symbol} name={t.name} logoURI={t.logoURI} chainId={t.chainId} address={t.address} isNative={t.isNative} className="w-8 h-8 rounded-full"/>

                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-sm text-white">{t.symbol}</span>
                        {tokenChain && (<span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400 font-mono border border-slate-700">
                            {tokenChain.shortName}
                          </span>)}
                        {t.verificationTier === 'VERIFIED_CANONICAL' && (<span title="Verified Canonical Token">
                            <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400"/>
                          </span>)}
                        {t.tags?.includes('RWA') && (<span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold">
                            RWA
                          </span>)}
                      </div>
                      <p className="text-xs text-slate-400">{t.name}</p>
                    </div>
                  </div>

                  <div className="text-right font-mono">
                    {t.priceUSD && (<p className="text-sm font-semibold text-white">${t.priceUSD.toLocaleString()}</p>)}
                    <div className="flex items-center justify-end gap-1.5 mt-0.5">
                      {t.change24hUSD !== undefined && (<span className={`text-[10px] font-bold inline-flex items-center gap-0.5 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isPositive ? <TrendingUp className="w-2.5 h-2.5"/> : <TrendingDown className="w-2.5 h-2.5"/>}
                          {isPositive ? '+' : ''}
                          {t.change24hUSD}%
                        </span>)}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-sans ${riskScore > 30
                        ? 'bg-red-500/20 text-red-300'
                        : riskScore > 10
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-emerald-500/20 text-emerald-300'}`}>
                        Risk {riskScore}
                      </span>
                    </div>
                  </div>
                </div>);
            })}
            {unsupportedMatches.map((metadata) => (<div key={`unsupported-${metadata.symbol}`} className="flex items-center justify-between p-3 rounded-xl opacity-60" title={metadata.reason}>
                <div className="flex items-center gap-3">
                  <TokenLogo symbol={metadata.symbol} name={metadata.name} logoURI={metadata.logoURI} className="w-8 h-8 rounded-full"/>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-sm text-white">{metadata.symbol}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 font-mono border border-slate-700">
                        Unavailable
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">{metadata.name}</p>
                  </div>
                </div>
              </div>))}
            </>)}
        </div>

        {isImportMode && (<form onSubmit={handleImportCustom} className="p-4 bg-[#0B111E] border-t border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-cyan-400 uppercase">Import Custom Contract</span>
              <button type="button" onClick={() => setIsImportMode(false)} className="text-xs text-slate-400 hover:text-white">
                Cancel
              </button>
            </div>

            <input type="text" value={customAddress} onChange={(e) => setCustomAddress(e.target.value)} placeholder="Contract Address (0x... or Solana Base58)" className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500" required/>

            <div className="grid grid-cols-2 gap-2">
              <input type="text" value={customSymbol} onChange={(e) => setCustomSymbol(e.target.value)} placeholder="Symbol (e.g. CUSTOM)" className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500" required/>
              <input type="number" value={customDecimals} onChange={(e) => setCustomDecimals(e.target.value)} placeholder="Decimals (18)" className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"/>
            </div>

            <button type="submit" className="w-full py-2 rounded-lg gradient-brand text-slate-950 font-bold text-xs shadow-glow-cyan transition-all">
              Verify & Import Token
            </button>
          </form>)}
      </div>
    </div>);
};
