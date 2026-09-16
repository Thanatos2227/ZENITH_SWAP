import React, { useEffect, useState } from 'react';
import { useZenithStore, resolveTokenLivePrice, resolveTokenBalance } from '../../stores/useZenithStore';
import { TokenLogo } from '../common/TokenLogo';
import {
  ArrowDownUp,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ChevronDown,
  Sparkles,
  ArrowRight,
  Wallet
} from 'lucide-react';
import {
  validateAndSanitizeAmount,
  truncateToThreeDecimals,
  MAX_SWAP_AMOUNT_NUM
} from '../../utils/amountValidation';

const formatRateValue = (rate: number): string => {
  if (!rate || isNaN(rate) || rate <= 0) return '0.00';
  if (rate >= 1000) return rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (rate >= 1) return rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  if (rate >= 0.0001) return rate.toFixed(6);
  return rate.toExponential(4);
};

export const SwapCard: React.FC = () => {
  const {
    sourceChain,
    destChain,
    tokenIn,
    tokenOut,
    amountIn,
    setAmountIn,
    switchTokens,
    openTokenPicker,
    openChainPicker,
    quote,
    quoteError,
    isQuoteLoading,
    fetchQuote,
    fetchMarketData,
    openConfirmSheet,
    isWalletConnected,
    walletBalances,
    isBalanceLoading,
    openWalletModal,
    chainId,
    switchNetwork,
    marketData,
    lastMarketUpdate,
    executionMode,
    setExecutionMode,
    orderType,
    setOrderType,
    limitPrice,
    setLimitPrice,
    slippageTolerancePercent,
    slippagePreset,
    isExecutingTrade
  } = useZenithStore();

  const [refreshTimer, setRefreshTimer] = useState<number>(10);

  useEffect(() => {
    fetchMarketData();
    fetchQuote();
  }, []);

  useEffect(() => {
    setRefreshTimer(10);
  }, [tokenIn.address, tokenIn.chainId, tokenOut.address, tokenOut.chainId, sourceChain.id, destChain.id]);

  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshTimer((prev) => {
        if (prev <= 1) {
          fetchQuote();
          return 10;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [fetchQuote]);

  const isCrossChain = sourceChain.id !== destChain.id;
  const isSwapSupported = sourceChain.capabilities.swap && destChain.capabilities.swap;
  const numAmountIn = parseFloat(amountIn) || 0;
  const currentValidation = validateAndSanitizeAmount(amountIn);
  const isAmountValid = currentValidation.isValid && currentValidation.numericValue > 0 && currentValidation.numericValue <= MAX_SWAP_AMOUNT_NUM;
  const hasInputError = !currentValidation.isValid || currentValidation.numericValue > MAX_SWAP_AMOUNT_NUM;
  const inputErrorMessage = !currentValidation.isValid
    ? currentValidation.error
    : currentValidation.numericValue > MAX_SWAP_AMOUNT_NUM
    ? 'Amount exceeds maximum allowed limit of 9,999,999.999'
    : null;

  const liveInUSD: number = resolveTokenLivePrice(tokenIn, marketData) || tokenIn.priceUSD || 0;
  const liveOutUSD: number = resolveTokenLivePrice(tokenOut, marketData) || tokenOut.priceUSD || 0;

  const tradeValueUSD = isAmountValid && liveInUSD > 0 ? numAmountIn * liveInUSD : 0;
  const receiveValueUSD = isAmountValid && quote && liveOutUSD > 0
    ? parseFloat(quote.amountOutFormatted.replace(/,/g, '')) * liveOutUSD
    : 0;

  const marketRate = quote?.referencePrice || (liveInUSD > 0 && liveOutUSD > 0 ? liveInUSD / liveOutUSD : undefined);

  const isNetworkMismatch = isWalletConnected && chainId !== null && sourceChain.chainId !== undefined && chainId !== sourceChain.chainId;

  const tokenInBalanceStr = isWalletConnected
    ? resolveTokenBalance(sourceChain.id, tokenIn, walletBalances)
    : '0.00';
  const tokenInBalanceNum = parseFloat(tokenInBalanceStr) || 0;
  const isInsufficientBalance = isWalletConnected && !isNetworkMismatch && !isBalanceLoading && tokenInBalanceNum > 0 && numAmountIn > tokenInBalanceNum;

  const handlePercentage = (pct: number) => {
    if (tokenInBalanceNum <= 0) {
      setAmountIn('0.0');
      return;
    }
    let target = tokenInBalanceNum * pct;
    if (pct === 1 && tokenIn.isNative) {
      const gasReserve = sourceChain.id === 'polygon' ? 0.02 : 0.003;
      target = Math.max(0, tokenInBalanceNum - gasReserve);
    }
    if (target > MAX_SWAP_AMOUNT_NUM) {
      target = MAX_SWAP_AMOUNT_NUM;
    }
    const val = truncateToThreeDecimals(target);
    setAmountIn(val);
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const validation = validateAndSanitizeAmount(raw);
    if (!validation.isValid) {

      e.target.value = amountIn;
      return;
    }

    if (validation.isTruncated || validation.sanitized !== raw) {
      e.target.value = validation.sanitized;
    }
    setAmountIn(validation.sanitized);
  };

  return (
    <div className="w-full max-w-lg mx-auto">
      <div className="glass-panel rounded-2xl p-5 sm:p-6 shadow-2xl relative overflow-hidden border border-slate-800/80">
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent" />

        {}
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800/60">
          <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
            <button
              onClick={() => setOrderType('SWAP')}
              className={`px-3 py-1 rounded-lg transition-all ${
                orderType === 'SWAP' ? 'bg-cyan-500 text-slate-950 shadow-glow-cyan' : 'text-slate-400 hover:text-white'
              }`}
            >
              Swap
            </button>
            <button
              onClick={() => setOrderType('LIMIT')}
              className={`px-3 py-1 rounded-lg transition-all ${
                orderType === 'LIMIT' ? 'bg-cyan-500 text-slate-950 shadow-glow-cyan' : 'text-slate-400 hover:text-white'
              }`}
            >
              Limit
            </button>
            <button
              onClick={() => setOrderType('DCA')}
              className={`px-3 py-1 rounded-lg transition-all ${
                orderType === 'DCA' ? 'bg-cyan-500 text-slate-950 shadow-glow-cyan' : 'text-slate-400 hover:text-white'
              }`}
            >
              DCA
            </button>
          </div>

          <button
            onClick={() => setExecutionMode(executionMode === 'INSTANT_AMM' ? 'GASLESS_INTENT' : 'INSTANT_AMM')}
            className={`px-2.5 py-1 rounded-xl text-[11px] font-mono font-bold flex items-center gap-1.5 transition-all border ${
              executionMode === 'GASLESS_INTENT'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-glow-emerald'
                : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
            }`}
            title="Toggle between Gasless Intent (UniswapX RFQ) and Instant AMM"
          >
            <Sparkles className="w-3 h-3" />
            {executionMode === 'GASLESS_INTENT' ? '⚡ Gasless (UniswapX)' : '⚡ Instant AMM'}
          </button>
        </div>

        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800/60">
          <div className="flex items-center gap-2 flex-wrap">

            <button
              onClick={() => openChainPicker('SOURCE')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-cyan-500/60 text-xs font-semibold text-slate-200 transition-all hover:bg-slate-800/70 shadow-sm"
              title="Click to select Source Network"
            >
              <img src={sourceChain.iconURI} alt={sourceChain.shortName} className="w-4 h-4 rounded-full" />
              <span>{sourceChain.shortName}</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20">
                Network
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            <div className="flex items-center gap-1.5">
              <ArrowRight className={`w-3.5 h-3.5 ${isCrossChain ? 'text-cyan-400' : 'text-slate-600'}`} />
              <button
                onClick={() => openChainPicker('DEST')}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border transition-all text-xs font-semibold ${
                  isCrossChain
                    ? 'bg-slate-900/90 border-cyan-500/50 text-cyan-300 shadow-glow-cyan'
                    : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
                title="Click to select Destination Network (Cross-Chain)"
              >
                <img src={destChain.iconURI} alt={destChain.shortName} className="w-4 h-4 rounded-full" />
                <span>{destChain.shortName}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                fetchQuote();
                setRefreshTimer(10);
              }}
              disabled={isQuoteLoading || !isSwapSupported}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium text-slate-400 hover:text-cyan-400 bg-slate-900/60 border border-slate-800/80 transition-colors disabled:opacity-40"
              title="Click to refresh quote"
            >
              <RefreshCw className={`w-3 h-3 ${isQuoteLoading ? 'animate-spin text-cyan-400' : ''}`} />
              <span>{refreshTimer}s</span>
            </button>
          </div>
        </div>

        {isNetworkMismatch && (
          <div className="flex items-center justify-between p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs mb-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" />
              <span>Wallet on different chain. Switch to {sourceChain.canonicalName} to trade.</span>
            </div>
            <button
              onClick={() => switchNetwork(sourceChain.chainId!)}
              className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold text-[11px] shrink-0 transition-colors"
            >
              Switch Network
            </button>
          </div>
        )}

        <div className="bg-[#0B111E] rounded-xl p-4 border border-slate-800/70 focus-within:border-cyan-500/50 transition-colors mb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              You Pay
            </span>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span>Bal: {tokenInBalanceStr} {tokenIn.symbol}</span>
              <div className="flex gap-1 ml-1">
                <button
                  onClick={() => handlePercentage(0.25)}
                  className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-slate-300 transition-colors"
                >
                  25%
                </button>
                <button
                  onClick={() => handlePercentage(0.5)}
                  className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-slate-300 transition-colors"
                >
                  50%
                </button>
                <button
                  onClick={() => handlePercentage(1)}
                  className="px-1.5 py-0.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-[10px] font-semibold text-cyan-300 transition-colors"
                >
                  MAX
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <input
              type="text"
              inputMode="decimal"
              value={amountIn}
              onChange={handleAmountChange}
              placeholder="0.0"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full bg-transparent text-2xl sm:text-3xl font-bold font-mono text-white placeholder-slate-600 focus:outline-none"
            />

            <button
              onClick={() => openTokenPicker('IN')}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/80 transition-colors shrink-0"
            >
              <TokenLogo
                symbol={tokenIn.symbol}
                name={tokenIn.name}
                logoURI={tokenIn.logoURI}
                chainId={tokenIn.chainId}
                address={tokenIn.address}
                isNative={tokenIn.isNative}
                className="w-6 h-6 rounded-full"
              />
              <span className="font-bold text-base text-white">{tokenIn.symbol}</span>
              <ChevronDown className="w-4 h-4 text-slate-400" />
            </button>
          </div>

          <div className="flex items-center justify-between mt-2 text-xs text-slate-400">
            <span>
              ~${tradeValueUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          {inputErrorMessage && (
            <div className="flex items-center gap-1.5 text-xs text-amber-400 mt-2 font-mono bg-amber-500/10 px-2.5 py-1.5 rounded-lg border border-amber-500/20">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              <span>{inputErrorMessage}</span>
            </div>
          )}
        </div>

        <div className="flex justify-center -my-2.5 relative z-10">
          <button
            onClick={switchTokens}
            className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-cyan-500 hover:text-slate-950 text-slate-300 border border-slate-700 hover:border-cyan-400 flex items-center justify-center shadow-lg transition-all transform hover:rotate-180"
            aria-label="Switch Tokens"
          >
            <ArrowDownUp className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-[#0B111E] rounded-xl p-4 border border-slate-800/70 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              You Receive (Estimated)
            </span>
            {quote && isAmountValid && (
              <span className="text-xs font-mono text-cyan-400">
                Score: {quote.effectiveExecutionScore}/100
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="w-full">
              {isQuoteLoading ? (
                <div className="h-9 w-40 bg-slate-800/60 animate-pulse rounded-lg" />
              ) : (
                <span className="text-2xl sm:text-3xl font-bold font-mono text-white tracking-tight">
                  {quote && isAmountValid ? quote.amountOutFormatted : '0.00'}
                </span>
              )}
            </div>

            <button
              onClick={() => openTokenPicker('OUT')}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/80 transition-colors shrink-0"
            >
              <TokenLogo
                symbol={tokenOut.symbol}
                name={tokenOut.name}
                logoURI={tokenOut.logoURI}
                chainId={tokenOut.chainId}
                address={tokenOut.address}
                isNative={tokenOut.isNative}
                className="w-6 h-6 rounded-full"
              />
              <span className="font-bold text-base text-white">{tokenOut.symbol}</span>
              <ChevronDown className="w-4 h-4 text-slate-400" />
            </button>
          </div>

          <div className="flex items-center justify-between mt-2 text-xs text-slate-400">
            <span>
              {receiveValueUSD > 0
                ? `~$${receiveValueUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : '$0.00'}
            </span>
            {quote && isAmountValid && (
              <span className="font-mono text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 text-[11px] flex items-center gap-1" title="Minimum requested pay to user after slippage">
                <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                <span>Min Requested Pay to User: {quote.minimumReceivedFormatted} {tokenOut.symbol}</span>
              </span>
            )}
          </div>

          {liveInUSD > 0 && (
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/60 text-xs text-slate-400">
              <span>Live Market Price</span>
              <span className="font-mono text-cyan-300 font-semibold">
                1 {tokenIn.symbol} ≈ ${liveInUSD >= 1000 ? liveInUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (liveInUSD >= 1 ? liveInUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : (liveInUSD >= 0.0001 ? liveInUSD.toFixed(6) : liveInUSD.toFixed(8)))}
              </span>
            </div>
          )}
        </div>

        {quote && isAmountValid && (
          <div className="space-y-2 mb-4 bg-slate-900/50 rounded-xl p-3.5 border border-slate-800/60 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">Rate</span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live
                </span>
              </div>
              <div className="text-right font-mono">
                <div className="text-slate-100 font-semibold">
                  {quote.executionPrice > 0 ? (
                    `1 ${tokenIn.symbol} ≈ ${formatRateValue(quote.executionPrice)} ${tokenOut.symbol}`
                  ) : (
                    <span className="text-amber-400 font-normal">Extreme Impact — Rate Depleted</span>
                  )}
                </div>
                {marketRate && marketRate > 0 && (
                  <div className="text-[11px] text-slate-400 flex items-center justify-end gap-1">
                    <span>Market:</span>
                    <span className="text-cyan-300">
                      1 {tokenIn.symbol} = {formatRateValue(marketRate)} {tokenOut.symbol}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between py-1.5 px-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
              <div className="flex items-center gap-1.5 text-emerald-300">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="font-semibold">Minimum Requested Pay to User</span>
              </div>
              <span className="font-mono text-emerald-400 font-bold">
                {quote.minimumReceivedFormatted} {tokenOut.symbol}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Slippage Tolerance</span>
              <span className="font-mono text-cyan-300 font-medium">
                {slippageTolerancePercent}% ({slippagePreset})
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Price Impact</span>
              <span
                className={`font-mono font-semibold ${
                  quote.priceImpact.level === 'CRITICAL' || quote.priceImpact.level === 'HIGH'
                    ? 'text-red-400'
                    : quote.priceImpact.level === 'MEDIUM'
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }`}
              >
                {quote.priceImpact.percentage}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Swap Fee (LP)</span>
              <span className="font-mono text-slate-200">
                {quote.swapFee
                  ? `${quote.swapFee.feeAmountFormatted} ${tokenIn.symbol} (~$${quote.swapFee.feeUSD < 0.01 ? quote.swapFee.feeUSD.toFixed(4) : quote.swapFee.feeUSD.toFixed(2)})`
                  : '0.30%'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Platform Fee</span>
              <span className="font-mono text-slate-200">
                {quote.protocolFee
                  ? `${quote.protocolFee.feeAmountFormatted} ${tokenIn.symbol} (~$${quote.protocolFee.feeUSD < 0.01 ? quote.protocolFee.feeUSD.toFixed(4) : quote.protocolFee.feeUSD.toFixed(2)})`
                  : '0.05%'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Network Fee (Est.)</span>
              <span className="font-mono text-emerald-400 font-semibold">
                ~${quote.bestRoute.gasCostUSD < 0.01 ? quote.bestRoute.gasCostUSD.toFixed(4) : quote.bestRoute.gasCostUSD.toFixed(2)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-slate-400">Route</span>
              <span className="font-mono text-cyan-300 font-medium">
                {isCrossChain
                  ? quote.bestRoute.hops.length > 0
                    ? `${quote.bestRoute.hops.map((h) => h.dexProtocol).join(' → ')} → ${quote.bestRoute.bridgeStep?.bridgeProtocol} Bridge`
                    : `${quote.bestRoute.bridgeStep?.bridgeProtocol} Bridge`
                  : quote.bestRoute.hops.map((h) => h.dexProtocol).join(' → ')}
              </span>
            </div>
          </div>
        )}

        {quote && isAmountValid && tradeValueUSD > 0 && quote.bestRoute.gasCostUSD > tradeValueUSD && (
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs mb-3 font-mono">
            <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" />
            <span>High Gas: Network fee (~${quote.bestRoute.gasCostUSD < 0.01 ? quote.bestRoute.gasCostUSD.toFixed(4) : quote.bestRoute.gasCostUSD.toFixed(2)}) exceeds swap value (~${tradeValueUSD.toFixed(2)}).</span>
          </div>
        )}

        {quoteError && isAmountValid && !isQuoteLoading && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs mb-4 font-mono">
            <ShieldAlert className="w-4 h-4 shrink-0 text-red-400" />
            <span>{quoteError}</span>
          </div>
        )}

        {tokenOut.securityProfile && tokenOut.securityProfile.riskScore > 20 && (
          <div className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs mb-4">
            <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" />
            <div>
              <p className="font-semibold">Security Advisory: Elevated Token Risk</p>
              <p className="text-slate-400 text-[11px]">
                {tokenOut.securityProfile.warnings[0] || 'Unverified token contract. Check details before signing.'}
              </p>
            </div>
          </div>
        )}

        {!isSwapSupported && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-300 text-xs mb-4">
            <Sparkles className="w-4 h-4 shrink-0 text-purple-400 mt-0.5" />
            <div>
              <p className="font-semibold">Network In Research / Adapter Stage</p>
              <p className="text-slate-400 text-[11px] mt-0.5 leading-relaxed">
                {!sourceChain.capabilities.swap ? sourceChain.canonicalName : destChain.canonicalName} is currently in{' '}
                <span className="text-purple-300 font-semibold">Research / Adapter Mode</span>. Direct swap execution is in active testing; token discovery and portfolio balance tracking are available.
              </p>
            </div>
          </div>
        )}

        {!isSwapSupported ? (
          <button
            disabled
            className="w-full py-4 rounded-xl bg-slate-900 border border-slate-800 text-slate-500 font-display font-bold text-base cursor-not-allowed flex items-center justify-center gap-2"
          >
            Swaps Coming Soon for {sourceChain.shortName}
          </button>
        ) : !isWalletConnected ? (
          <button
            onClick={openWalletModal}
            className="w-full py-4 rounded-xl gradient-brand text-slate-950 font-display font-extrabold text-base tracking-wide shadow-glow-cyan hover:opacity-95 transition-all flex items-center justify-center gap-2"
          >
            <Wallet className="w-5 h-5" />
            Connect Wallet to Trade
          </button>
        ) : isNetworkMismatch ? (
          <button
            onClick={() => switchNetwork(sourceChain.chainId!)}
            className="w-full py-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-extrabold text-base tracking-wide shadow-lg transition-all flex items-center justify-center gap-2"
          >
            <ShieldAlert className="w-5 h-5" />
            Switch Network to {sourceChain.shortName}
          </button>
        ) : hasInputError ? (
          <button
            disabled
            className="w-full py-4 rounded-xl bg-slate-900/80 border border-amber-500/40 text-amber-400 font-display font-bold text-base cursor-not-allowed flex items-center justify-center gap-2"
          >
            <ShieldAlert className="w-5 h-5 text-amber-400" />
            {inputErrorMessage || 'Invalid Amount'}
          </button>
        ) : !amountIn || !isAmountValid || numAmountIn <= 0 ? (
          <button
            disabled
            className="w-full py-4 rounded-xl bg-slate-900/80 border border-slate-800 text-slate-500 font-display font-bold text-base cursor-not-allowed flex items-center justify-center gap-2"
          >
            Enter an Amount
          </button>
        ) : isInsufficientBalance ? (
          <button
            disabled
            className="w-full py-4 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 font-display font-bold text-base cursor-not-allowed flex items-center justify-center gap-2"
          >
            Insufficient {tokenIn.symbol} Balance
          </button>
        ) : isQuoteLoading ? (
          <button
            disabled
            className="w-full py-4 rounded-xl bg-slate-800 text-cyan-400 font-display font-bold text-base cursor-not-allowed flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-5 h-5 animate-spin text-cyan-400" />
            Fetching Best Route...
          </button>
        ) : isExecutingTrade ? (
          <button
            disabled
            className="w-full py-4 rounded-xl bg-slate-800 text-cyan-400 font-display font-bold text-base cursor-not-allowed flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-5 h-5 animate-spin text-cyan-400" />
            Executing Transaction...
          </button>
        ) : quote && isAmountValid && quote.validation?.isValid !== false ? (
          <button
            onClick={openConfirmSheet}
            className="w-full py-4 rounded-xl gradient-brand text-slate-950 font-display font-extrabold text-base tracking-wide shadow-glow-cyan hover:opacity-95 transition-all flex items-center justify-center gap-2"
          >
            <Sparkles className="w-5 h-5 fill-slate-950" />
            Review & Swap
          </button>
        ) : quote && isAmountValid && quote.validation?.isValid === false ? (
          <button
            disabled
            className="w-full py-4 rounded-xl bg-slate-900/80 border border-amber-500/40 text-amber-400 font-display font-bold text-base cursor-not-allowed flex items-center justify-center gap-2"
          >
            <ShieldAlert className="w-5 h-5 text-amber-400" />
            {quote.validation?.errors?.[0] || 'Execution Validation Failed'}
          </button>
        ) : (
          <button
            disabled
            className="w-full py-4 rounded-xl bg-slate-900/80 border border-slate-800 text-slate-500 font-display font-bold text-base cursor-not-allowed flex items-center justify-center gap-2"
          >
            {quoteError || 'Route Unavailable for Pair'}
          </button>
        )}
      </div>
    </div>
  );
};
