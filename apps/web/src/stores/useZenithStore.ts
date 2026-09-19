import { create } from 'zustand';
import { BrowserProvider, JsonRpcSigner, JsonRpcProvider, Contract, formatEther, formatUnits, Provider, ZeroAddress } from 'ethers';
import {
  ChainConfig,
  ExecutionStep,
  GasPreset,
  MEVProtectionLevel,
  QuoteResponse,
  ReceiptView,
  SlippagePreset,
  Token,
  TransactionStatus,
  WalletType,
  ZenithNotification
} from '@zenith/types';
import { defaultChainRegistry, ZENITH_SUPPORTED_CHAINS } from '@zenith/chains';
import { DEFAULT_TOKENS, defaultTokenService, defaultMarketDataService, LiveMarketData, MarketStatus } from '@zenith/tokens';
import { defaultZenithRouter, validateAndSanitizeAmount, parseTokenUnits, isNativeToken } from '@zenith/routing';
import { isZenithDeployed } from '@zenith/contracts';
import { defaultExecutionCoordinator, ExecutionStateMachine, defaultCrossChainTracker, ActiveCrossChainOrder } from '@zenith/execution';
import { defaultThemeManager } from '@zenith/ui';
import {
  connectToWalletProvider,
  checkAuthorizedAccounts,
  revokeWalletPermissions,
  verifyRevocation,
  formatAddress,
  isExplicitlyDisconnected,
  setExplicitlyDisconnected,
  getStoredWalletSession,
  setStoredWalletSession,
  clearStoredWalletSession
} from '../utils/walletDetector';

const THEME_STORAGE_KEY = 'zenith-theme';
const CROSS_CHAIN_ORDERS_KEY = 'zenith_active_cross_chain_orders';

let notifIdCounter = 1;

export const getStoredTheme = (): 'dark' | 'light' => {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') {
        return stored;
      }
    } catch (e) {

    }
  }
  return 'dark';
};

export const applyThemeToDom = (theme: 'dark' | 'light'): void => {
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
      root.setAttribute('data-theme', 'dark');
      if (document.body) {
        document.body.classList.add('dark');
        document.body.classList.remove('light');
      }
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
      root.setAttribute('data-theme', 'light');
      if (document.body) {
        document.body.classList.remove('dark');
        document.body.classList.add('light');
      }
    }
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (e) {}
  }

  defaultThemeManager.setTheme(theme);
};

export interface ZenithState {
  activeTab: 'TRADE' | 'POOLS' | 'EXPLORE' | 'MARKETS' | 'PORTFOLIO' | 'HISTORY' | 'SETTINGS';
  isProMode: boolean;
  theme: 'dark' | 'light';

  executionMode: 'INSTANT_AMM' | 'GASLESS_INTENT';
  orderType: 'SWAP' | 'LIMIT' | 'DCA';
  limitPrice: string;

  sourceChain: ChainConfig;
  destChain: ChainConfig;
  tokenIn: Token;
  tokenOut: Token;
  amountIn: string;

  slippagePreset: SlippagePreset;
  slippageTolerancePercent: number;
  gasPreset: GasPreset;
  mevProtection: MEVProtectionLevel;

  isWalletConnected: boolean;
  isConnected: boolean;
  isWalletConnecting: boolean;
  walletAddress: string;
  connectedWalletName: string;
  walletBalances: Record<string, string>;
  isBalanceLoading: boolean;

  provider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  chainId: number | null;
  isWrongNetwork: boolean;
  walletError: string | null;

  quote: QuoteResponse | null;
  isQuoteLoading: boolean;
  quoteCountdown: number;
  quoteError: string | null;

  isConfirmSheetOpen: boolean;
  isReceiptOpen: boolean;
  isTokenPickerOpen: boolean;
  tokenPickerTarget: 'IN' | 'OUT';
  isChainPickerOpen: boolean;
  chainPickerTarget: 'SOURCE' | 'DEST';
  isNotificationDrawerOpen: boolean;
  isWalletModalOpen: boolean;

  executionStatus: TransactionStatus;
  executionSteps: ExecutionStep[];
  isExecutingTrade: boolean;
  lastReceipt: ReceiptView | null;

  transactionHistory: ReceiptView[];
  notifications: ZenithNotification[];

  marketData: Record<string, LiveMarketData>;
  isMarketsLoading: boolean;
  marketsError: string | null;
  lastMarketUpdate: number | null;
  marketDataStatus: MarketStatus;

  setActiveTab: (tab: ZenithState['activeTab']) => void;
  setExecutionMode: (mode: 'INSTANT_AMM' | 'GASLESS_INTENT') => void;
  setOrderType: (type: 'SWAP' | 'LIMIT' | 'DCA') => void;
  setLimitPrice: (price: string) => void;
  setProMode: (pro: boolean) => void;
  toggleTheme: () => void;
  updateSingleTokenMarketData: (chainId: string, address: string, data: LiveMarketData) => void;
  fetchMarketData: () => Promise<void>;
  setSourceChain: (chain: ChainConfig) => void;
  setDestChain: (chain: ChainConfig) => void;
  setTokenIn: (token: Token) => void;
  setTokenOut: (token: Token) => void;
  switchTokens: () => void;
  setAmountIn: (amount: string) => void;
  setSlippage: (preset: SlippagePreset, customPercent?: number) => void;
  setGasPreset: (preset: GasPreset) => void;
  setMEVProtection: (level: MEVProtectionLevel) => void;
  openWalletModal: () => void;
  closeWalletModal: () => void;
  connectWalletWithType: (walletType: WalletType, isSilentRestore?: boolean) => Promise<void>;
  connectWallet: () => void;
  disconnectWallet: () => Promise<void>;
  initializeWalletSession: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  switchNetwork: (chainId: number) => Promise<void>;
  openTokenPicker: (target: 'IN' | 'OUT') => void;
  closeTokenPicker: () => void;
  openChainPicker: (target: 'SOURCE' | 'DEST') => void;
  closeChainPicker: () => void;
  openConfirmSheet: () => void;
  closeConfirmSheet: () => void;
  closeReceipt: () => void;
  toggleNotificationDrawer: () => void;
  fetchQuote: () => Promise<void>;
  executeTrade: () => Promise<void>;
  addNotification: (notification: Omit<ZenithNotification, 'id' | 'timestamp' | 'isRead'>) => void;
  markNotificationsAsRead: () => void;
}

const defaultEthChain = ZENITH_SUPPORTED_CHAINS.ethereum;
const defaultEthToken = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.isNative) || DEFAULT_TOKENS[0];
const defaultUsdcToken = DEFAULT_TOKENS.find((t) => t.chainId === 'ethereum' && t.symbol === 'USDC') || DEFAULT_TOKENS[1];

const executionSM = new ExecutionStateMachine();

let activeInjectedProvider: any = null;
let activeAccountsChangedListener: ((accounts: string[]) => void) | null = null;
let activeChainChangedListener: ((hexChainId: string) => void) | null = null;
let isMarketStoreListenerRegistered = false;
let quoteDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let activeQuoteRequestId = 0;

const cleanupWalletListeners = () => {
  if (activeInjectedProvider) {
    try {
      if (activeAccountsChangedListener) {
        if (typeof activeInjectedProvider.removeListener === 'function') {
          activeInjectedProvider.removeListener('accountsChanged', activeAccountsChangedListener);
        } else if (typeof activeInjectedProvider.off === 'function') {
          activeInjectedProvider.off('accountsChanged', activeAccountsChangedListener);
        }
      }
      if (activeChainChangedListener) {
        if (typeof activeInjectedProvider.removeListener === 'function') {
          activeInjectedProvider.removeListener('chainChanged', activeChainChangedListener);
        } else if (typeof activeInjectedProvider.off === 'function') {
          activeInjectedProvider.off('chainChanged', activeChainChangedListener);
        }
      }
    } catch (err) {
      console.warn('[Wallet] Listener cleanup error:', err);
    }
  }
  activeInjectedProvider = null;
  activeAccountsChangedListener = null;
  activeChainChangedListener = null;
};

// Architecture distinction:
// 1. Wallet/injected provider (BrowserProvider / JsonRpcSigner) is used exclusively
//    for user authorization, signing, and transaction dispatch. Read-only JsonRpcProvider
//    cannot sign transactions.
// 2. ZENITH RPC registry (JsonRpcProvider) is used for independent state reads,
//    token discovery, and resilient receipt verification across fallback RPCs.
// 3. Transaction confirmation does not depend exclusively on the wallet's internal RPC,
//    as ZENITH execution adapters verify transaction receipts against configured public RPC fallbacks.
const getChainRpcProvider = (
  chainIdStr: string,
  activeChainId: number | null,
  injectedProvider: BrowserProvider | null
): Provider => {
  const chain = defaultChainRegistry.getChain(chainIdStr);
  if (!chain) {
    return injectedProvider || new JsonRpcProvider('https://eth.llamarpc.com');
  }

  if (injectedProvider && activeChainId !== null && chain.chainId === activeChainId) {
    return injectedProvider;
  }

  try {
    const rpcUrl = defaultChainRegistry.getHealthyRPC(chain.id);
    return new JsonRpcProvider(rpcUrl, chain.chainId ? { chainId: chain.chainId, name: chain.id } : undefined);
  } catch (err) {
    console.warn(`[useZenithStore] Fallback to candidate RPC for ${chainIdStr}:`, err);
    const candidates = defaultChainRegistry.getCandidateRPCs(chain.id);
    if (candidates.length > 0) {
      return new JsonRpcProvider(candidates[0], chain.chainId ? { chainId: chain.chainId, name: chain.id } : undefined);
    }
    return injectedProvider || new JsonRpcProvider('https://eth.llamarpc.com');
  }
};

export const resolveTokenLivePrice = (token: Token, marketDataRecord: Record<string, LiveMarketData>): number => {
  if (!token) return 0;
  const tokenKey = `${token.chainId.toLowerCase()}:${token.address.toLowerCase()}`;
  const cached = defaultMarketDataService.getCachedMarketData(token.chainId, token.address);

  const price =
    marketDataRecord[tokenKey]?.priceUSD ||
    cached?.priceUSD ||
    token.priceUSD;

  if (typeof price === 'number' && price > 0) {
    return price;
  }

  const symKey = token.symbol.toLowerCase();
  const cleanSym = defaultMarketDataService.resolveSymbol(token.symbol).toLowerCase();
  if (
    ['usdc', 'usdt', 'dai', 'usde', 'pyusd', 'fdusd', 'busd'].includes(symKey) ||
    ['usdc', 'usdt', 'dai', 'usde', 'pyusd', 'fdusd', 'busd'].includes(cleanSym)
  ) {
    return 1.0;
  }

  return 0;
};

export const resolveTokenBalance = (
  chainId: string,
  token: Token,
  walletBalances: Record<string, string>
): string => {
  if (!walletBalances || !token) return '0.00';
  const cId = chainId.toLowerCase();
  const addr = token.address || '';
  const addrLower = addr.toLowerCase();

  const keys = [
    `${chainId}:${addr}`,
    `${chainId}:${addrLower}`,
    `${cId}:${addr}`,
    `${cId}:${addrLower}`
  ];

  if (
    token.isNative ||
    addrLower === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ||
    addrLower === ZeroAddress.toLowerCase() ||
    addrLower === 'native'
  ) {
    keys.push(
      `${chainId}:${ZeroAddress}`,
      `${chainId}:0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee`,
      `${chainId}:0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`,
      `${chainId}:native`,
      `${cId}:${ZeroAddress.toLowerCase()}`,
      `${cId}:0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee`,
      `${cId}:0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`,
      `${cId}:native`
    );
  }

  for (const key of keys) {
    if (walletBalances[key] !== undefined && walletBalances[key] !== null) {
      return walletBalances[key];
    }
  }

  return '0.00';
};

export const useZenithStore = create<ZenithState>((set, get) => {
  executionSM.subscribe((status, steps) => {
    set({
      executionStatus: status,
      executionSteps: steps,
      lastReceipt: executionSM.getReceipt() || null
    });
  });

  return {
    activeTab: 'TRADE',
    isProMode: true,
    theme: getStoredTheme(),

    executionMode: 'INSTANT_AMM',
    orderType: 'SWAP',
    limitPrice: '',

    sourceChain: defaultEthChain,
    destChain: defaultEthChain,
    tokenIn: defaultEthToken,
    tokenOut: defaultUsdcToken,
    amountIn: '1.0',

    slippagePreset: 'AUTO',
    slippageTolerancePercent: 0.5,
    gasPreset: 'FAST',
    mevProtection: 'FLASHBOTS_PRIVATE',

    isWalletConnected: false,
    isConnected: false,
    isWalletConnecting: false,
    walletAddress: '',
    connectedWalletName: '',
    walletBalances: {},
    isBalanceLoading: false,

    provider: null,
    signer: null,
    chainId: null,
    isWrongNetwork: false,
    walletError: null,

    quote: null,
    isQuoteLoading: false,
    quoteCountdown: 10,
    quoteError: null,

    isConfirmSheetOpen: false,
    isReceiptOpen: false,
    isTokenPickerOpen: false,
    tokenPickerTarget: 'IN',
    isChainPickerOpen: false,
    chainPickerTarget: 'SOURCE',
    isNotificationDrawerOpen: false,
    isWalletModalOpen: false,

    executionStatus: 'IDLE',
    executionSteps: [],
    isExecutingTrade: false,
    lastReceipt: null,

    transactionHistory: [],
    notifications: [
      {
        id: 'notif-1',
        title: 'Welcome to ZENITH SWAP v4',
        message: 'Connected to 52 target chains with MEV protection & simulation enabled.',
        type: 'INFO',
        timestamp: Date.now() - 1000 * 60 * 5,
        isRead: false
      }
    ],

    marketData: {},
    isMarketsLoading: false,
    marketsError: null,
    lastMarketUpdate: null,
    marketDataStatus: 'UNAVAILABLE',

    setActiveTab: (tab) => set({ activeTab: tab }),
    setExecutionMode: (executionMode) => set({ executionMode }),
    setOrderType: (orderType) => set({ orderType }),
    setLimitPrice: (limitPrice) => set({ limitPrice }),
    setProMode: (isProMode) => set({ isProMode }),
    toggleTheme: () => {
      const nextTheme = get().theme === 'dark' ? 'light' : 'dark';
      applyThemeToDom(nextTheme);
      set({ theme: nextTheme });
    },

    setSourceChain: (chain) => {
      const prevSource = get().sourceChain;
      const prevDest = get().destChain;
      const isSameChainTrade = prevSource.id === prevDest.id;

      const sourceTokens = defaultTokenService.getTokensForChain(chain.id);
      let rawIn = defaultTokenService.getNativeToken(chain.id) || sourceTokens[0] || get().tokenIn;

      const livePriceIn = resolveTokenLivePrice(rawIn, get().marketData);
      const newIn = livePriceIn ? { ...rawIn, priceUSD: livePriceIn } : rawIn;

      let nextDest = prevDest;
      let nextOut = get().tokenOut;

      if (isSameChainTrade) {
        nextDest = chain;
        const destTokens = defaultTokenService.getTokensForChain(chain.id);
        const stable = destTokens.find(
          (t) => (t.symbol === 'USDC' || t.symbol === 'USDT' || t.symbol === 'DAI') && t.address.toLowerCase() !== newIn.address.toLowerCase()
        );
        let rawOut =
          stable ||
          destTokens.find((t) => t.address.toLowerCase() !== newIn.address.toLowerCase()) ||
          destTokens[1] ||
          destTokens[0] ||
          newIn;

        const livePriceOut = resolveTokenLivePrice(rawOut, get().marketData);
        nextOut = livePriceOut ? { ...rawOut, priceUSD: livePriceOut } : rawOut;
      } else {
        if (nextOut.chainId !== nextDest.id) {
          const destTokens = defaultTokenService.getTokensForChain(nextDest.id);
          const stable = destTokens.find((t) => t.symbol === 'USDC' || t.symbol === 'USDT');
          let rawOut = stable || destTokens[0] || nextOut;

          const livePriceOut = resolveTokenLivePrice(rawOut, get().marketData);
          nextOut = livePriceOut ? { ...rawOut, priceUSD: livePriceOut } : rawOut;
        }
      }

      const isWrongNetwork = get().chainId !== null && chain.chainId !== undefined && get().chainId !== chain.chainId;

      set({
        sourceChain: chain,
        tokenIn: newIn,
        destChain: nextDest,
        tokenOut: nextOut,
        isWrongNetwork
      });

      get().fetchQuote();
      get().refreshBalance();
    },

    setDestChain: (chain) => {
      const currentIn = get().tokenIn;
      const isSameChain = get().sourceChain.id === chain.id;
      const destTokens = defaultTokenService.getTokensForChain(chain.id);

      let rawOut = destTokens.find(
        (t) =>
          (t.symbol === 'USDC' || t.symbol === 'USDT' || t.symbol === 'DAI') &&
          (!isSameChain || t.address.toLowerCase() !== currentIn.address.toLowerCase())
      );

      if (!rawOut) {
        rawOut =
          destTokens.find((t) => !isSameChain || t.address.toLowerCase() !== currentIn.address.toLowerCase()) ||
          destTokens[1] ||
          destTokens[0] ||
          get().tokenOut;
      }

      const livePriceOut = resolveTokenLivePrice(rawOut, get().marketData);
      const newOut = livePriceOut ? { ...rawOut, priceUSD: livePriceOut } : rawOut;

      set({ destChain: chain, tokenOut: newOut });
      get().fetchQuote();
    },

    setTokenIn: (token) => {
      const chain = defaultChainRegistry.getChain(token.chainId);
      const prevSource = get().sourceChain;
      const prevDest = get().destChain;
      const isSameChainTrade = prevSource.id === prevDest.id;

      const livePriceIn = resolveTokenLivePrice(token, get().marketData);
      const effectiveToken = livePriceIn ? { ...token, priceUSD: livePriceIn } : token;

      let nextSource = chain || prevSource;
      let nextDest = prevDest;
      let nextOut = get().tokenOut;

      if (chain && chain.id !== prevSource.id) {
        nextSource = chain;
        if (isSameChainTrade) {
          nextDest = chain;
          const destTokens = defaultTokenService.getTokensForChain(chain.id);
          const stable = destTokens.find(
            (t) => (t.symbol === 'USDC' || t.symbol === 'USDT' || t.symbol === 'DAI') && t.address.toLowerCase() !== effectiveToken.address.toLowerCase()
          );
          let rawOut =
            stable ||
            destTokens.find((t) => t.address.toLowerCase() !== effectiveToken.address.toLowerCase()) ||
            destTokens[1] ||
            destTokens[0] ||
            effectiveToken;

          const livePriceOut = resolveTokenLivePrice(rawOut, get().marketData);
          nextOut = livePriceOut ? { ...rawOut, priceUSD: livePriceOut } : rawOut;
        }
      } else if (isSameChainTrade && effectiveToken.address.toLowerCase() === nextOut.address.toLowerCase()) {
        const destTokens = defaultTokenService.getTokensForChain(effectiveToken.chainId);
        const alt = destTokens.find((t) => t.address.toLowerCase() !== effectiveToken.address.toLowerCase());
        if (alt) {
          const livePriceOut = resolveTokenLivePrice(alt, get().marketData);
          nextOut = livePriceOut ? { ...alt, priceUSD: livePriceOut } : alt;
        }
      }

      const isWrongNetwork = get().chainId !== null && nextSource.chainId !== undefined && get().chainId !== nextSource.chainId;

      set({
        sourceChain: nextSource,
        destChain: nextDest,
        tokenIn: effectiveToken,
        tokenOut: nextOut,
        isWrongNetwork
      });

      get().fetchQuote();
      get().refreshBalance();
    },

    setTokenOut: (token) => {
      const chain = defaultChainRegistry.getChain(token.chainId);
      const isSameChain = get().sourceChain.id === (chain ? chain.id : get().destChain.id);
      let nextIn = get().tokenIn;

      const livePriceOut = resolveTokenLivePrice(token, get().marketData);
      const effectiveToken = livePriceOut ? { ...token, priceUSD: livePriceOut } : token;

      if (isSameChain && effectiveToken.address.toLowerCase() === nextIn.address.toLowerCase()) {
        const sourceTokens = defaultTokenService.getTokensForChain(effectiveToken.chainId);
        const alt = sourceTokens.find((t) => t.address.toLowerCase() !== effectiveToken.address.toLowerCase());
        if (alt) {
          const livePriceIn = resolveTokenLivePrice(alt, get().marketData);
          nextIn = livePriceIn ? { ...alt, priceUSD: livePriceIn } : alt;
        }
      }

      if (chain && chain.id !== get().destChain.id) {
        set({ destChain: chain, tokenOut: effectiveToken, tokenIn: nextIn });
      } else {
        set({ tokenOut: effectiveToken, tokenIn: nextIn });
      }
      get().fetchQuote();
    },

    switchTokens: () => {
      const { tokenIn, tokenOut, sourceChain, destChain } = get();
      set({
        tokenIn: tokenOut,
        tokenOut: tokenIn,
        sourceChain: destChain,
        destChain: sourceChain
      });
      get().fetchQuote();
      get().refreshBalance();
    },

    setAmountIn: (rawAmountIn) => {
      const validation = validateAndSanitizeAmount(rawAmountIn);
      if (!validation.isValid) {

        return;
      }
      set({ amountIn: validation.sanitized });

      if (quoteDebounceTimer) {
        clearTimeout(quoteDebounceTimer);
        quoteDebounceTimer = null;
      }

      if (validation.numericValue <= 0) {
        set({ quote: null, isQuoteLoading: false, quoteError: null });
        return;
      }

      quoteDebounceTimer = setTimeout(() => {
        get().fetchQuote();
      }, 350);
    },

    setSlippage: (preset, customPercent) => {
      let percent = 0.5;
      if (preset === '0.1%') percent = 0.1;
      else if (preset === '0.5%') percent = 0.5;
      else if (preset === '1.0%') percent = 1.0;
      else if (preset === 'CUSTOM' && customPercent !== undefined) percent = customPercent;
      else if (preset === 'AUTO') percent = 0.5;

      set({ slippagePreset: preset, slippageTolerancePercent: percent });
      get().fetchQuote();
    },

    setGasPreset: (gasPreset) => set({ gasPreset }),
    setMEVProtection: (mevProtection) => set({ mevProtection }),

    openWalletModal: () => set({ isWalletModalOpen: true }),
    closeWalletModal: () => set({ isWalletModalOpen: false }),

    connectWalletWithType: async (walletType: WalletType, isSilentRestore = false) => {
      if (!isSilentRestore) {
        if (isExplicitlyDisconnected()) {
          console.log('[Wallet] Reconnect requested by user');
        }
        setExplicitlyDisconnected(false);
        console.log('[Wallet] Connect requested');
      } else {
        if (isExplicitlyDisconnected()) {
          console.log('[Wallet] Auto-connect blocked after explicit disconnect');
          return;
        }
      }

      set({ isWalletConnecting: true, walletError: null });
      cleanupWalletListeners();

      try {
        let address: string;
        let walletName: string;
        let rawProvider: any;
        let initialChainId: number | undefined;

        if (isSilentRestore) {
          const check = await checkAuthorizedAccounts(walletType);
          if (!check || !check.address) {
            set({ isWalletConnecting: false });
            return;
          }
          address = check.address;
          walletName = check.walletName;
          rawProvider = check.rawProvider;
          initialChainId = check.chainId;
        } else {
          const result = await connectToWalletProvider(walletType);
          address = result.address;
          walletName = result.walletName;
          rawProvider = result.rawProvider;
          initialChainId = result.chainId;
          console.log('[Wallet] Connection approved');
        }

        console.log(`[Wallet] Connected: ${address}`);

        let provider: BrowserProvider | null = null;
        let signer: JsonRpcSigner | null = null;
        let connectedChainId: number | null = initialChainId ?? null;
        let isWrongNetwork = false;
        let matchedChain: ChainConfig | undefined;

        let initialTokenIn = get().tokenIn;
        let initialTokenOut = get().tokenOut;
        let initialDestChain = get().destChain;

        if (walletType !== 'PHANTOM') {
          provider = new BrowserProvider(rawProvider, 'any');
          try {
            signer = await provider.getSigner();
          } catch (signerErr) {
            console.warn('[useZenithStore] Could not obtain signer on connection:', signerErr);
          }

          try {
            const network = await provider.getNetwork();
            connectedChainId = Number(network.chainId);
          } catch {
            if (typeof rawProvider.request === 'function') {
              const hexId = await rawProvider.request({ method: 'eth_chainId' }).catch(() => null);
              if (hexId) connectedChainId = parseInt(hexId, 16);
            }
          }

          if (connectedChainId !== null) {
            const allChains = defaultChainRegistry.getAllChains();
            matchedChain = allChains.find((c) => c.chainId === connectedChainId);
            if (matchedChain) {
              const native = defaultTokenService.getNativeToken(matchedChain.id);
              if (native) initialTokenIn = native;
              const destToks = defaultTokenService.getTokensForChain(matchedChain.id);
              const stable = destToks.find((t) => (t.symbol === 'USDC' || t.symbol === 'USDT') && t.address.toLowerCase() !== initialTokenIn.address.toLowerCase());
              if (stable) initialTokenOut = stable;
              initialDestChain = matchedChain;
              isWrongNetwork = false;
            } else {
              isWrongNetwork = true;
            }
          }
        }

        setStoredWalletSession(walletType, address);

        set({
          isWalletConnected: true,
          isConnected: true,
          isWalletConnecting: false,
          walletAddress: address,
          connectedWalletName: walletName,
          provider,
          signer,
          chainId: connectedChainId,
          isWrongNetwork,
          walletBalances: {},
          walletError: null,
          isWalletModalOpen: false,
          ...(matchedChain ? {
            sourceChain: matchedChain,
            destChain: initialDestChain,
            tokenIn: initialTokenIn,
            tokenOut: initialTokenOut
          } : {})
        });

        if (!isSilentRestore) {
          get().addNotification({
            title: 'Wallet Connected',
            message: `Connected ${walletName} (${formatAddress(address)})`,
            type: 'SUCCESS'
          });
        }

        if (isWrongNetwork && connectedChainId !== null) {
          get().addNotification({
            title: 'Unsupported Network',
            message: `Connected to chain ID ${connectedChainId}. Please switch to a supported network (Polygon, Ethereum, Arbitrum, Base, Optimism, etc.).`,
            type: 'WARNING'
          });
        }

        await get().refreshBalance();
        get().fetchQuote();

        if (rawProvider && typeof rawProvider.on === 'function') {
          activeInjectedProvider = rawProvider;

          activeAccountsChangedListener = async (accounts: string[]) => {
            console.log('[Zenith Web3] accountsChanged:', accounts);
            if (isExplicitlyDisconnected() || !get().isWalletConnected) {
              console.log('[Wallet] Auto-connect blocked after explicit disconnect (accountsChanged ignored)');
              return;
            }

            if (!accounts || accounts.length === 0) {
              console.log('[Wallet] accountsChanged reported zero accounts - disconnecting Zenith');
              get().disconnectWallet();
              return;
            }

            const newAddress = accounts[0];
            const currentProvider = get().provider;
            let newSigner = get().signer;
            if (currentProvider) {
              newSigner = await currentProvider.getSigner().catch(() => null);
            }

            setStoredWalletSession(walletType, newAddress);

            set({
              walletAddress: newAddress,
              signer: newSigner,
              walletBalances: {}
            });

            await get().refreshBalance();
            get().addNotification({
              title: 'Account Changed',
              message: `Active account switched to ${formatAddress(newAddress)}`,
              type: 'INFO'
            });
            get().fetchQuote();
          };

          activeChainChangedListener = async (hexChainId: string) => {
            if (isExplicitlyDisconnected() || !get().isWalletConnected) {
              return;
            }

            const newChainId = typeof hexChainId === 'string' && hexChainId.startsWith('0x')
              ? parseInt(hexChainId, 16)
              : Number(hexChainId);
            console.log('[Zenith Web3] chainChanged:', newChainId);

            const allChains = defaultChainRegistry.getAllChains();
            const chainMatch = allChains.find((c) => c.chainId === newChainId);
            const wrongNet = !chainMatch;

            const newProvider = new BrowserProvider(rawProvider, 'any');
            const newSigner = await newProvider.getSigner().catch(() => null);

            let newIn = get().tokenIn;
            let newOut = get().tokenOut;
            let newDest = get().destChain;

            if (chainMatch) {
              const native = defaultTokenService.getNativeToken(chainMatch.id);
              if (native) newIn = native;
              const destToks = defaultTokenService.getTokensForChain(chainMatch.id);
              const stable = destToks.find((t) => (t.symbol === 'USDC' || t.symbol === 'USDT') && t.address.toLowerCase() !== newIn.address.toLowerCase());
              if (stable) newOut = stable;
              newDest = chainMatch;
            }

            set({
              chainId: newChainId,
              isWrongNetwork: wrongNet,
              provider: newProvider,
              signer: newSigner,
              walletBalances: {},
              ...(chainMatch ? {
                sourceChain: chainMatch,
                destChain: newDest,
                tokenIn: newIn,
                tokenOut: newOut
              } : {})
            });

            if (wrongNet) {
              get().addNotification({
                title: 'Wrong Network',
                message: `Switched to unsupported network (Chain ID: ${newChainId}). Please select a supported chain.`,
                type: 'WARNING'
              });
            } else if (chainMatch) {
              await get().refreshBalance();
              get().addNotification({
                title: 'Network Updated',
                message: `Network switched to ${chainMatch.canonicalName}`,
                type: 'INFO'
              });
              get().fetchQuote();
            }
          };

          rawProvider.on('accountsChanged', activeAccountsChangedListener);
          rawProvider.on('chainChanged', activeChainChangedListener);
        }
      } catch (err: any) {
        let errorMessage = err?.message || 'Could not connect to wallet';
        if (
          err?.code === 4001 ||
          err?.message?.includes('User rejected') ||
          err?.message?.includes('user rejected') ||
          err?.message?.includes('User denied')
        ) {
          errorMessage = 'Connection request was rejected by user in wallet.';
        } else if (err?.code === -32002) {
          errorMessage = 'Connection request is already pending in wallet. Please open the extension.';
        }

        console.warn('[Wallet] Connection failed or rejected:', errorMessage, err);

        set({
          isWalletConnected: false,
          isConnected: false,
          isWalletConnecting: false,
          walletError: errorMessage
        });
        if (!isSilentRestore) {
          get().addNotification({
            title: 'Connection Rejected / Failed',
            message: errorMessage,
            type: 'ERROR'
          });
        }
      }
    },

    connectWallet: () => {
      set({ isWalletModalOpen: true });
    },

    disconnectWallet: async () => {
      console.log('[Wallet] Disconnect requested');

      const providerToRevoke =
        activeInjectedProvider ||
        (typeof window !== 'undefined' ? (window as any).ethereum : null);

      setExplicitlyDisconnected(true);
      console.log('[Wallet] Explicit disconnect flag set');
      clearStoredWalletSession();
      cleanupWalletListeners();

      set({
        isWalletConnected: false,
        isConnected: false,
        isWalletConnecting: false,
        walletAddress: '',
        connectedWalletName: '',
        provider: null,
        signer: null,
        chainId: null,
        isWrongNetwork: false,
        walletBalances: {},
        isBalanceLoading: false,
        walletError: null
      });

      get().addNotification({
        title: 'Wallet Disconnected',
        message: 'Wallet session ended',
        type: 'INFO'
      });

      if (providerToRevoke && typeof providerToRevoke.request === 'function') {
        try {
          const revoked = await revokeWalletPermissions(providerToRevoke);
          if (revoked) {

            const remaining = await verifyRevocation(providerToRevoke);
            if (remaining.length === 0) {
              console.log('[Wallet] Permission revocation verified: 0 accounts authorized');
            } else {
              console.log('[Wallet] Post-revocation accounts reported:', remaining);
            }
          }
        } catch (revokeErr) {
          console.warn('[Wallet] Permission revocation step error:', revokeErr);
        }
      }
    },

    initializeWalletSession: async () => {
      if (typeof window === 'undefined') return;

      if (isExplicitlyDisconnected()) {
        console.log('[Wallet] Auto-connect blocked after explicit disconnect');
        return;
      }

      const session = getStoredWalletSession();
      if (!session.isConnected || !session.walletType) {
        return;
      }

      try {
        await get().connectWalletWithType(session.walletType, true );
      } catch (err) {
        console.warn('[Wallet] Failed to restore session on initialization:', err);
      }
    },

    refreshBalance: async () => {
      const { provider, walletAddress, sourceChain, isWalletConnected, chainId } = get();
      if (!isWalletConnected || !walletAddress) {
        set({ walletBalances: {}, isBalanceLoading: false });
        return;
      }

      set({ isBalanceLoading: true });
      const newBalances: Record<string, string> = { ...get().walletBalances };

      try {

        const chainProvider = getChainRpcProvider(sourceChain.id, chainId, provider);

        const nativeToken = defaultTokenService.getNativeToken(sourceChain.id);
        if (nativeToken) {
          try {
            const balWei = await chainProvider.getBalance(walletAddress);
            const formatted = formatEther(balWei);
            const num = parseFloat(formatted);
            const valStr = isNaN(num) ? '0.00' : (num === 0 ? '0.00' : formatted);
            const nativeAliases = [
              `${sourceChain.id}:${nativeToken.address}`,
              `${sourceChain.id}:${nativeToken.address.toLowerCase()}`,
              `${sourceChain.id}:${ZeroAddress}`,
              `${sourceChain.id}:0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee`,
              `${sourceChain.id}:0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`,
              `${sourceChain.id}:native`
            ];
            for (const alias of nativeAliases) {
              newBalances[alias] = valStr;
            }
          } catch (nativeErr) {
            console.warn(`[useZenithStore] Native balance fetch failed for ${sourceChain.id}:`, nativeErr);
          }
        }

        const chainTokens = defaultTokenService.getTokensForChain(sourceChain.id);
        const erc20Tokens = chainTokens.filter(
          (t) => !t.isNative && t.address.startsWith('0x') && t.address.length === 42
        );

        const erc20Abi = ['function balanceOf(address) view returns (uint256)'];
        await Promise.allSettled(
          erc20Tokens.map(async (tok) => {
            try {
              const contract = new Contract(tok.address, erc20Abi, chainProvider);
              const rawBal = await contract.balanceOf(walletAddress);
              const formatted = formatUnits(rawBal, tok.decimals || 18);
              const n = parseFloat(formatted);
              const valStr = isNaN(n) ? '0.00' : (n === 0 ? '0.00' : formatted);
              newBalances[`${sourceChain.id}:${tok.address}`] = valStr;
              newBalances[`${sourceChain.id}:${tok.address.toLowerCase()}`] = valStr;
            } catch {
              newBalances[`${sourceChain.id}:${tok.address}`] = '0.00';
              newBalances[`${sourceChain.id}:${tok.address.toLowerCase()}`] = '0.00';
            }
          })
        );

        set({
          walletBalances: newBalances,
          isBalanceLoading: false
        });
      } catch (err) {
        console.warn('[useZenithStore] refreshBalance failed:', err);
        set({ isBalanceLoading: false });
      }
    },

    switchNetwork: async (targetChainId: number) => {
      if (!activeInjectedProvider || typeof activeInjectedProvider.request !== 'function') {
        throw new Error('No active Web3 provider available to switch networks');
      }

      const hexChainId = `0x${targetChainId.toString(16)}`;
      try {
        await activeInjectedProvider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: hexChainId }]
        });
      } catch (switchErr: any) {

        if (switchErr.code === 4902 || switchErr?.data?.originalError?.code === 4902) {
          const chain = defaultChainRegistry.getAllChains().find((c) => c.chainId === targetChainId);
          if (chain && chain.rpcEndpoints.length > 0) {
            await activeInjectedProvider.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: hexChainId,
                  chainName: chain.canonicalName,
                  nativeCurrency: chain.nativeCurrency,
                  rpcUrls: chain.rpcEndpoints.map((r) => r.url),
                  blockExplorerUrls: chain.explorer ? [chain.explorer.baseUrl] : []
                }
              ]
            });
          } else {
            throw switchErr;
          }
        } else {
          throw switchErr;
        }
      }
    },

    openTokenPicker: (target) => set({ isTokenPickerOpen: true, tokenPickerTarget: target }),
    closeTokenPicker: () => set({ isTokenPickerOpen: false }),

    openChainPicker: (target) => set({ isChainPickerOpen: true, chainPickerTarget: target }),
    closeChainPicker: () => set({ isChainPickerOpen: false }),

    openConfirmSheet: () => set({ isConfirmSheetOpen: true }),
    closeConfirmSheet: () => {
      const isExecuting = get().executionStatus !== 'IDLE' && get().executionStatus !== 'COMPLETED' && get().executionStatus !== 'FAILED';
      if (!isExecuting) {
        set({ isConfirmSheetOpen: false });
      }
    },
    closeReceipt: () => set({ isReceiptOpen: false }),

    toggleNotificationDrawer: () => set((state) => ({ isNotificationDrawerOpen: !state.isNotificationDrawerOpen })),

    fetchQuote: async () => {

      if (quoteDebounceTimer) {
        clearTimeout(quoteDebounceTimer);
        quoteDebounceTimer = null;
      }

      const { sourceChain, destChain, tokenIn, tokenOut, amountIn, slippageTolerancePercent, walletAddress, gasPreset, marketData } = get();

      const validation = validateAndSanitizeAmount(amountIn);
      if (!validation.isValid || validation.numericValue <= 0) {
        set({ quote: null, quoteError: null, isQuoteLoading: false });
        return;
      }

      const cleanAmount = validation.sanitized;

      const currentRequestId = ++activeQuoteRequestId;

      set({ isQuoteLoading: true, quoteError: null });

      try {
        const livePriceIn = resolveTokenLivePrice(tokenIn, marketData);
        const livePriceOut = resolveTokenLivePrice(tokenOut, marketData);

        const effectiveTokenIn: Token = livePriceIn > 0 ? { ...tokenIn, priceUSD: livePriceIn } : tokenIn;
        const effectiveTokenOut: Token = livePriceOut > 0 ? { ...tokenOut, priceUSD: livePriceOut } : tokenOut;

        if (
          effectiveTokenIn.priceUSD !== tokenIn.priceUSD ||
          effectiveTokenOut.priceUSD !== tokenOut.priceUSD
        ) {
          set({ tokenIn: effectiveTokenIn, tokenOut: effectiveTokenOut });
        }

        const decimals = effectiveTokenIn.decimals !== undefined ? effectiveTokenIn.decimals : 18;
        const rawAmountIn = parseTokenUnits(cleanAmount, decimals);

        const quote = await defaultZenithRouter.getQuote({
          sourceChainId: sourceChain.id,
          destinationChainId: destChain.id,
          tokenIn: effectiveTokenIn,
          tokenOut: effectiveTokenOut,
          amountInRaw: rawAmountIn === '0' ? '1' : rawAmountIn,
          slippageTolerancePercent,
          userWalletAddress: walletAddress || undefined,
          gasPreset
        });

        if (currentRequestId !== activeQuoteRequestId) {
          return;
        }

        set({
          quote,
          isQuoteLoading: false,
          quoteCountdown: quote.freshnessSeconds,
          quoteError: null
        });
      } catch (err: any) {

        if (currentRequestId !== activeQuoteRequestId) {
          return;
        }

        set({
          quote: null,
          isQuoteLoading: false,
          quoteError: err.message || 'Failed to fetch executable quote'
        });
      }
    },

    executeTrade: async () => {
      if (get().isExecutingTrade) {
        console.warn('[ZENITH UI] executeTrade already in progress. Blocking duplicate invocation.');
        return;
      }

      set({ isExecutingTrade: true });

      const { quote, walletAddress, isWalletConnected, openWalletModal, signer, provider, sourceChain, chainId, isWrongNetwork, walletBalances } = get();
      console.log('[ZENITH UI] executeTrade invoked:', {
        isWalletConnected,
        walletAddress,
        hasSigner: Boolean(signer),
        hasProvider: Boolean(provider),
        sourceChain: sourceChain?.id,
        connectedChainId: chainId,
        quoteTokenIn: quote?.request?.tokenIn?.symbol,
        quoteAmount: quote?.amountInFormatted
      });

      if (!quote) {
        console.warn('[ZENITH UI] executeTrade aborted: No active quote found.');
        set({ isExecutingTrade: false });
        return;
      }

      if (!isWalletConnected || !walletAddress) {
        console.warn('[ZENITH UI] executeTrade: Wallet not connected. Opening WalletModal...');
        set({ isExecutingTrade: false });
        openWalletModal();
        return;
      }

      const isSameChain = sourceChain.id === get().destChain.id;
      const isSovereignZenith = quote.bestRoute?.dexQuote?.provider?.startsWith('ZENITH_') || quote.bestRoute?.hops?.some((h) => h.dexProtocol.startsWith('ZENITH_'));
      if (isSameChain && isSovereignZenith && sourceChain.executionEnvironment === 'EVM' && sourceChain.chainId !== undefined && !isZenithDeployed(sourceChain.chainId)) {
        get().addNotification({
          title: 'ZENITH AMM Not Deployed',
          message: `ZENITH Sovereign AMM is not deployed on ${sourceChain.canonicalName}. Deployment required for native Zenith AMM execution.`,
          type: 'WARNING'
        });
        set({ isExecutingTrade: false, isConfirmSheetOpen: false });
        return;
      }

      if (sourceChain.executionEnvironment === 'EVM' && chainId !== null && sourceChain.chainId !== undefined && sourceChain.chainId !== chainId) {
        try {
          await get().switchNetwork(sourceChain.chainId);
        } catch {
          get().addNotification({
            title: 'Network Mismatch',
            message: `Please switch your wallet to ${sourceChain.canonicalName} (Chain ID: ${sourceChain.chainId}) to execute this swap.`,
            type: 'WARNING'
          });
          set({ isExecutingTrade: false });
          return;
        }
      }

      let activeSigner = signer;
      if (!activeSigner && provider && typeof provider.getSigner === 'function') {
        try {
          activeSigner = await provider.getSigner();
          set({ signer: activeSigner });
        } catch {
          activeSigner = null;
        }
      }

      if (!activeSigner && typeof window !== 'undefined' && (window as any).ethereum) {
        try {
          const bp = new BrowserProvider((window as any).ethereum, 'any');
          activeSigner = await bp.getSigner();
          set({ provider: bp, signer: activeSigner });
        } catch (e) {
          console.warn('[ZENITH UI] Fallback BrowserProvider signer creation note:', e);
        }
      }

      if (!activeSigner && sourceChain.executionEnvironment === 'EVM') {
        get().addNotification({
          title: 'Wallet Signer Missing',
          message: 'Please reconnect your wallet to authorize transaction signing.',
          type: 'WARNING'
        });
        set({ isExecutingTrade: false });
        openWalletModal();
        return;
      }

      try {
        const isCrossChain = quote.request.sourceChainId !== quote.request.destinationChainId;
        const receipt = await defaultExecutionCoordinator.executeTrade({
          quote,
          userAddress: walletAddress,
          stateMachine: executionSM,
          signer: activeSigner,
          provider
        });

        if (isCrossChain && quote.intent) {
          try {
            const rawOrders = localStorage.getItem(CROSS_CHAIN_ORDERS_KEY);
            const orders = rawOrders ? JSON.parse(rawOrders) : [];
            orders.unshift({
              orderId: quote.intent.orderId,
              sourceChainId: quote.request.sourceChainId,
              destinationChainId: quote.request.destinationChainId,
              sourceTxHash: receipt.txHash,
              destTxHash: receipt.bridgeDetails?.destTxHash,
              provider: quote.bestRoute.crossChainQuote?.provider || 'ACROSS',
              recipient: walletAddress,
              quote: quote.bestRoute.crossChainQuote,
              timestamp: Date.now()
            });
            localStorage.setItem(CROSS_CHAIN_ORDERS_KEY, JSON.stringify(orders.slice(0, 50)));
          } catch {

          }
        }

        set((state) => ({
          isConfirmSheetOpen: false,
          lastReceipt: receipt,
          isReceiptOpen: true,
          transactionHistory: [receipt, ...state.transactionHistory]
        }));

        await get().refreshBalance();

        get().addNotification({
          title: isCrossChain ? 'Cross-Chain Trade Initiated' : 'Trade Executed Successfully',
          message: `Swapped ${receipt.amountInFormatted} ${receipt.tokenIn.symbol} for ${receipt.amountOutFormatted} ${receipt.tokenOut.symbol}`,
          type: 'SUCCESS',
          txHash: receipt.txHash,
          chainId: receipt.sourceChain.id
        });
      } catch (err: any) {
        set({ isConfirmSheetOpen: false });
        const rawCode = err?.code || err?.info?.error?.code;
        const rawMsg = err?.reason || err?.message || String(err);
        const isSimulationOrRevert =
          err?.code === 'ZENITH_SIMULATION_FAILED' ||
          err?.name === 'ZenithSimulationFailedError' ||
          rawMsg.includes('ZENITH_SIMULATION_FAILED') ||
          rawMsg.includes('TRANSFER_FAILED') ||
          rawMsg.includes('TFROM_FAILED') ||
          rawMsg.includes('0x39d35496') ||
          rawMsg.includes('V3_TOO_LITTLE_RECEIVED') ||
          rawMsg.includes('V3TooLittleReceived') ||
          rawMsg.includes('TOO_LITTLE_RECEIVED') ||
          rawMsg.includes('ZENITH_APPROVAL_TARGET_MISMATCH') ||
          rawMsg.includes('SIMULATION_REVERT');

        const isUserRejected =
          !isSimulationOrRevert &&
          (rawCode === 4001 ||
            rawCode === 'ACTION_REJECTED' ||
            rawMsg.toLowerCase().includes('user rejected') ||
            rawMsg.toLowerCase().includes('user denied transaction') ||
            rawMsg.toLowerCase().includes('user disapproved') ||
            rawMsg.toLowerCase().includes('user canceled transaction') ||
            rawMsg.toLowerCase().includes('user cancelled transaction'));

        if (isUserRejected) {
          get().addNotification({
            title: 'Transaction Cancelled',
            message: 'You rejected the transaction in your wallet.',
            type: 'INFO'
          });
          return;
        }

        let errMsg = rawMsg;
        let notifTitle = 'Execution Failed';
        let notifType: 'ERROR' | 'WARNING' | 'INFO' = 'ERROR';

        if (
          rawMsg.includes('submission timed out') ||
          rawMsg.includes('Transaction submission timed out')
        ) {
          notifTitle = 'Submission Timeout';
          notifType = 'WARNING';
          errMsg = rawMsg;
        } else if (
          rawMsg.includes('confirmation timed out') ||
          rawMsg.includes('still pending on-chain')
        ) {
          notifTitle = 'Confirmation Pending';
          notifType = 'WARNING';
          errMsg = rawMsg;
        } else if (
          rawMsg.includes('RPC provider unavailable') ||
          rawMsg.includes('RPC temporarily unavailable')
        ) {
          notifTitle = 'RPC Provider Unavailable';
          notifType = 'WARNING';
          errMsg = rawMsg;
        } else if (
          rawMsg.includes('Cross-chain settlement timed out') ||
          rawMsg.includes('settlement tracking timed out')
        ) {
          notifTitle = 'Bridge Tracking Timeout';
          notifType = 'WARNING';
          errMsg = rawMsg;
        } else if (
          rawMsg.includes('Token approval') ||
          rawMsg.includes('approval transaction')
        ) {
          notifTitle = 'Approval Failed';
          errMsg = rawMsg;
        } else if (
          rawMsg.includes('STF') ||
          err?.revert?.args?.[0] === 'STF' ||
          err?.data?.includes('535446')
        ) {
          errMsg = `SafeTransferFrom failed (STF): Insufficient ${quote.request.tokenIn.symbol} balance or token allowance in your connected wallet.`;
        } else if (
          rawMsg.includes('0x39d35496') ||
          rawMsg.includes('V3_TOO_LITTLE_RECEIVED') ||
          rawMsg.includes('V3TooLittleReceived') ||
          rawMsg.includes('Too little received') ||
          rawMsg.includes('TOO_LITTLE_RECEIVED') ||
          rawMsg.includes('Slippage limit exceeded') ||
          rawMsg.includes('ZenithV3Router: SLIPPAGE') ||
          err?.revert?.args?.[0] === 'Too little received'
        ) {
          errMsg = `V3 Too Little Received (Slippage Limit Exceeded): On-chain pool output was below your minimum requested pay of ${quote.minimumReceivedFormatted} ${quote.request.tokenOut.symbol}. Please refresh the quote or adjust slippage tolerance (e.g. 0.5% or 1.0%).`;
        } else if (
          rawMsg.includes('require(false)') ||
          rawMsg.includes('execution reverted') ||
          rawMsg.includes('CALL_EXCEPTION')
        ) {
          errMsg = `On-Chain Execution Reverted: The smart contract rejected this swap on ${quote.request.sourceChainId}. Possible reasons: insufficient liquidity, pool price impact, or token allowance missing.`;
        }

        get().addNotification({
          title: notifTitle,
          message: errMsg || 'Transaction could not be executed on-chain.',
          type: notifType
        });
      } finally {
        set({ isExecutingTrade: false });
      }
    },

    addNotification: (notif) => {
      const item: ZenithNotification = {
        id: `notif_${Date.now()}_${notifIdCounter++}`,
        timestamp: Date.now(),
        isRead: false,
        ...notif
      };
      set((state) => ({ notifications: [item, ...state.notifications] }));
    },

    markNotificationsAsRead: () => {
      set((state) => ({
        notifications: state.notifications.map((n) => ({ ...n, isRead: true }))
      }));
    },

    updateSingleTokenMarketData: (chainId: string, address: string, data: LiveMarketData) => {
      const key = `${chainId.toLowerCase()}:${address.toLowerCase()}`;
      const currentTokenIn = get().tokenIn;
      const currentTokenOut = get().tokenOut;

      let updatedTokenIn = currentTokenIn;
      let updatedTokenOut = currentTokenOut;

      const isTokenInMatch = currentTokenIn.chainId.toLowerCase() === chainId.toLowerCase() &&
        (currentTokenIn.address.toLowerCase() === address.toLowerCase() ||
         (currentTokenIn.isNative && isNativeToken(address)));

      const isTokenOutMatch = currentTokenOut.chainId.toLowerCase() === chainId.toLowerCase() &&
        (currentTokenOut.address.toLowerCase() === address.toLowerCase() ||
         (currentTokenOut.isNative && isNativeToken(address)));

      if (isTokenInMatch && data.priceUSD && data.priceUSD > 0 && currentTokenIn.priceUSD !== data.priceUSD) {
        updatedTokenIn = { ...currentTokenIn, priceUSD: data.priceUSD };
      }
      if (isTokenOutMatch && data.priceUSD && data.priceUSD > 0 && currentTokenOut.priceUSD !== data.priceUSD) {
        updatedTokenOut = { ...currentTokenOut, priceUSD: data.priceUSD };
      }

      set((state) => ({
        marketData: {
          ...state.marketData,
          [key]: data
        },
        tokenIn: updatedTokenIn,
        tokenOut: updatedTokenOut,
        lastMarketUpdate: Date.now(),
        marketDataStatus: data.isLive ? 'LIVE' : defaultMarketDataService.getOverallStatus()
      }));
    },

    fetchMarketData: async () => {
      set({ isMarketsLoading: true, marketsError: null });

      if (!isMarketStoreListenerRegistered) {
        isMarketStoreListenerRegistered = true;
        defaultMarketDataService.addStoreTickListener((chainId, address, data) => {
          get().updateSingleTokenMarketData(chainId, address, data);
        });
      }

      try {
        const dataMap = await defaultMarketDataService.fetchMarketData(DEFAULT_TOKENS);
        const record: Record<string, LiveMarketData> = {};
        dataMap.forEach((val, key) => {
          record[key] = val;
        });

        const currentTokenIn = get().tokenIn;
        const currentTokenOut = get().tokenOut;
        const livePriceIn = resolveTokenLivePrice(currentTokenIn, record);
        const livePriceOut = resolveTokenLivePrice(currentTokenOut, record);

        set({
          marketData: record,
          tokenIn: livePriceIn ? { ...currentTokenIn, priceUSD: livePriceIn } : currentTokenIn,
          tokenOut: livePriceOut ? { ...currentTokenOut, priceUSD: livePriceOut } : currentTokenOut,
          isMarketsLoading: false,
          marketsError: defaultMarketDataService.getLastError(),
          lastMarketUpdate: defaultMarketDataService.getLastUpdated() || Date.now(),
          marketDataStatus: defaultMarketDataService.getOverallStatus()
        });

        get().fetchQuote();
      } catch (err: any) {
        set({
          isMarketsLoading: false,
          marketsError: err.message || 'Failed to fetch live market data',
          marketDataStatus: defaultMarketDataService.getOverallStatus()
        });
      }
    }
  };
});

if (typeof window !== 'undefined') {
  applyThemeToDom(getStoredTheme());

  window.addEventListener('offline', () => {
    useZenithStore.setState({ marketDataStatus: 'OFFLINE' });
  });

  window.addEventListener('online', () => {
    useZenithStore.getState().fetchMarketData();
  });
}
