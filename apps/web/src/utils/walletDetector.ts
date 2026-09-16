import { WalletOption, WalletType } from '@zenith/types';

export const formatAddress = (address: string, prefixLen = 6, suffixLen = 4): string => {
  if (!address) return '';
  if (address.length <= prefixLen + suffixLen) return address;
  return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`;
};

export const ZENITH_WALLET_DISCONNECTED_KEY = 'zenith_wallet_disconnected';
export const ZENITH_WALLET_CONNECTED_KEY = 'zenith_wallet_connected';
export const ZENITH_WALLET_TYPE_KEY = 'zenith_wallet_type';
export const ZENITH_WALLET_ADDRESS_KEY = 'zenith_wallet_address';

export const isExplicitlyDisconnected = (): boolean => {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    return window.localStorage.getItem(ZENITH_WALLET_DISCONNECTED_KEY) === 'true';
  } catch {
    return false;
  }
};

export const setExplicitlyDisconnected = (disconnected: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    if (disconnected) {
      if (window.localStorage) {
        window.localStorage.setItem(ZENITH_WALLET_DISCONNECTED_KEY, 'true');
      }
      clearStoredWalletSession();
    } else {
      if (window.localStorage) {
        window.localStorage.removeItem(ZENITH_WALLET_DISCONNECTED_KEY);
      }
    }
  } catch (err) {
    console.warn('[Wallet] Failed to update disconnect flag:', err);
  }
};

export const getStoredWalletSession = (): {
  isConnected: boolean;
  walletType: WalletType | null;
  address: string | null;
} => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { isConnected: false, walletType: null, address: null };
  }
  try {
    const isDisconnected = window.localStorage.getItem(ZENITH_WALLET_DISCONNECTED_KEY) === 'true';
    if (isDisconnected) {
      return { isConnected: false, walletType: null, address: null };
    }
    const isConnected = window.localStorage.getItem(ZENITH_WALLET_CONNECTED_KEY) === 'true';
    const walletType = (window.localStorage.getItem(ZENITH_WALLET_TYPE_KEY) as WalletType) || null;
    const address = window.localStorage.getItem(ZENITH_WALLET_ADDRESS_KEY) || null;
    return { isConnected, walletType, address };
  } catch {
    return { isConnected: false, walletType: null, address: null };
  }
};

export const setStoredWalletSession = (walletType: WalletType, address: string): void => {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage) {
      window.localStorage.removeItem(ZENITH_WALLET_DISCONNECTED_KEY);
      window.localStorage.setItem(ZENITH_WALLET_CONNECTED_KEY, 'true');
      window.localStorage.setItem(ZENITH_WALLET_TYPE_KEY, walletType);
      window.localStorage.setItem(ZENITH_WALLET_ADDRESS_KEY, address);
    }
  } catch (err) {
    console.warn('[Wallet] Failed to persist wallet session:', err);
  }
};

export const clearStoredWalletSession = (): void => {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage) {
      window.localStorage.removeItem(ZENITH_WALLET_CONNECTED_KEY);
      window.localStorage.removeItem(ZENITH_WALLET_TYPE_KEY);
      window.localStorage.removeItem(ZENITH_WALLET_ADDRESS_KEY);
      window.localStorage.removeItem('walletconnect');
      window.localStorage.removeItem('WALLETCONNECT_DEEPLINK_CHOICE');
    }
    if (window.sessionStorage) {
      window.sessionStorage.removeItem(ZENITH_WALLET_CONNECTED_KEY);
      window.sessionStorage.removeItem(ZENITH_WALLET_TYPE_KEY);
      window.sessionStorage.removeItem(ZENITH_WALLET_ADDRESS_KEY);
    }
  } catch (err) {
    console.warn('[Wallet] Failed to clear stored wallet session:', err);
  }
};

export const getInjectedEthereumProvider = (walletType: WalletType): any => {
  if (typeof window === 'undefined') return null;

  const anyWin = window as any;
  const eth = anyWin.ethereum;

  if (walletType === 'COINBASE') {
    if (anyWin.coinbaseWalletExtension) return anyWin.coinbaseWalletExtension;
    if (eth?.providers?.length) {
      const p = eth.providers.find((item: any) => item.isCoinbaseWallet);
      if (p) return p;
    }
    if (eth?.isCoinbaseWallet) return eth;
  }

  if (walletType === 'RABBY') {
    if (anyWin.rabby) return anyWin.rabby;
    if (eth?.providers?.length) {
      const p = eth.providers.find((item: any) => item.isRabby);
      if (p) return p;
    }
    if (eth?.isRabby) return eth;
  }

  if (walletType === 'OKX') {
    if (anyWin.okxwallet) return anyWin.okxwallet;
    if (eth?.providers?.length) {
      const p = eth.providers.find((item: any) => item.isOKXWallet);
      if (p) return p;
    }
    if (eth?.isOKXWallet) return eth;
  }

  if (walletType === 'RAINBOW') {
    if (eth?.providers?.length) {
      const p = eth.providers.find((item: any) => item.isRainbow);
      if (p) return p;
    }
    if (eth?.isRainbow) return eth;
  }

  if (walletType === 'METAMASK') {
    if (eth?.providers?.length) {
      const p = eth.providers.find((item: any) => item.isMetaMask && !item.isRabby && !item.isRainbow && !item.isOKXWallet);
      if (p) return p;
    }
    if (eth?.isMetaMask && !eth?.isRabby && !eth?.isRainbow && !eth?.isOKXWallet) return eth;
  }

  return eth || null;
};

export const detectInstalledWallets = (): WalletOption[] => {
  const isClient = typeof window !== 'undefined';

  const hasEthereum = isClient && typeof (window as any).ethereum !== 'undefined';
  const eth = hasEthereum ? (window as any).ethereum : null;

  const isMetaMask = !!(eth && (eth.isMetaMask && !eth.isRabby && !eth.isRainbow && !eth.isOKXWallet));
  const isPhantom = isClient && !!((window as any).phantom?.solana || (window as any).solana?.isPhantom);
  const isCoinbase = isClient && !!(eth?.isCoinbaseWallet || (window as any).coinbaseWalletExtension);
  const isRabby = isClient && !!(eth?.isRabby || (window as any).rabby);
  const isOKX = isClient && !!((window as any).okxwallet || eth?.isOKXWallet);
  const isRainbow = isClient && !!eth?.isRainbow;

  return [
    {
      id: 'METAMASK',
      name: 'MetaMask',
      icon: '/wallets/metamask.png',
      isDetected: isMetaMask,
      environment: 'EVM',
      downloadUrl: 'https://metamask.io/download/'
    },
    {
      id: 'PHANTOM',
      name: 'Phantom',
      icon: '/wallets/phantom.png',
      isDetected: isPhantom,
      environment: 'SOLANA',
      downloadUrl: 'https://phantom.app/download'
    },
    {
      id: 'COINBASE',
      name: 'Coinbase Wallet',
      icon: '/wallets/coinbase.png',
      isDetected: isCoinbase,
      environment: 'EVM',
      downloadUrl: 'https://www.coinbase.com/wallet'
    },
    {
      id: 'RABBY',
      name: 'Rabby Wallet',
      icon: '/wallets/rabby.png',
      isDetected: isRabby,
      environment: 'EVM',
      downloadUrl: 'https://rabby.io'
    },
    {
      id: 'OKX',
      name: 'OKX Wallet',
      icon: '/wallets/okx.png',
      isDetected: isOKX,
      environment: 'MULTI',
      downloadUrl: 'https://www.okx.com/web3'
    },
    {
      id: 'RAINBOW',
      name: 'Rainbow',
      icon: 'https://rainbow.me/favicon.ico',
      isDetected: isRainbow,
      environment: 'EVM',
      downloadUrl: 'https://rainbow.me'
    },
    {
      id: 'WALLETCONNECT',
      name: 'WalletConnect',
      icon: 'https://raw.githubusercontent.com/WalletConnect/walletconnect-assets/master/Logo/Blue%20(Default)/Logo.svg',
      isDetected: false,
      environment: 'MULTI',
      downloadUrl: 'https://walletconnect.com'
    }
  ];
};

export interface WalletConnectionResult {
  address: string;
  walletName: string;
  rawProvider: any;
  chainId?: number;
}

export const connectToWalletProvider = async (
  walletType: WalletType
): Promise<WalletConnectionResult> => {
  const isClient = typeof window !== 'undefined';
  if (!isClient) {
    throw new Error('Window is undefined (SSR environment)');
  }

  if (walletType === 'PHANTOM') {
    const solana = (window as any).phantom?.solana || (window as any).solana;
    if (!solana) {
      throw new Error('Phantom wallet extension is not installed. Please install it to proceed.');
    }
    const resp = await solana.connect();
    const pubkey = resp.publicKey ? resp.publicKey.toString() : '';
    if (!pubkey) {
      throw new Error('Phantom wallet returned an empty public key.');
    }
    return {
      address: pubkey,
      walletName: 'Phantom',
      rawProvider: solana
    };
  }

  const rawProvider = getInjectedEthereumProvider(walletType);
  if (!rawProvider || typeof rawProvider.request !== 'function') {
    throw new Error(`${walletType} wallet provider was not detected. Please make sure the browser extension is installed and unlocked.`);
  }

  const accounts: string[] = await rawProvider.request({ method: 'eth_requestAccounts' });
  if (!accounts || accounts.length === 0 || !accounts[0]) {
    throw new Error('No accounts authorized or returned by the wallet provider.');
  }

  const fullAddress = accounts[0];

  let chainId: number | undefined;
  try {
    const hexChainId = await rawProvider.request({ method: 'eth_chainId' });
    if (hexChainId) {
      chainId = parseInt(hexChainId, 16);
    }
  } catch (err) {
    console.warn('[WalletDetector] Could not fetch chainId on initial connect', err);
  }

  const walletNameMap: Record<WalletType, string> = {
    METAMASK: 'MetaMask',
    COINBASE: 'Coinbase Wallet',
    RABBY: 'Rabby Wallet',
    OKX: 'OKX Wallet',
    RAINBOW: 'Rainbow',
    WALLETCONNECT: 'WalletConnect',
    PHANTOM: 'Phantom',
    INJECTED: 'Injected Web3'
  };

  return {
    address: fullAddress,
    walletName: walletNameMap[walletType] || walletType,
    rawProvider,
    chainId
  };
};

export const checkAuthorizedAccounts = async (
  walletType: WalletType
): Promise<{ address: string; walletName: string; rawProvider: any; chainId?: number } | null> => {
  if (typeof window === 'undefined') return null;

  if (walletType === 'PHANTOM') {
    const solana = (window as any).phantom?.solana || (window as any).solana;
    if (solana && solana.isConnected && solana.publicKey) {
      return {
        address: solana.publicKey.toString(),
        walletName: 'Phantom',
        rawProvider: solana
      };
    }
    return null;
  }

  const rawProvider = getInjectedEthereumProvider(walletType);
  if (!rawProvider || typeof rawProvider.request !== 'function') {
    return null;
  }

  try {
    const accounts: string[] = await rawProvider.request({ method: 'eth_accounts' });
    if (!accounts || accounts.length === 0 || !accounts[0]) {
      return null;
    }

    let chainId: number | undefined;
    try {
      const hexChainId = await rawProvider.request({ method: 'eth_chainId' });
      if (hexChainId) {
        chainId = parseInt(hexChainId, 16);
      }
    } catch {}

    const walletNameMap: Record<WalletType, string> = {
      METAMASK: 'MetaMask',
      COINBASE: 'Coinbase Wallet',
      RABBY: 'Rabby Wallet',
      OKX: 'OKX Wallet',
      RAINBOW: 'Rainbow',
      WALLETCONNECT: 'WalletConnect',
      PHANTOM: 'Phantom',
      INJECTED: 'Injected Web3'
    };

    return {
      address: accounts[0],
      walletName: walletNameMap[walletType] || walletType,
      rawProvider,
      chainId
    };
  } catch {
    return null;
  }
};

export const revokeWalletPermissions = async (rawProvider: any): Promise<boolean> => {
  if (!rawProvider || typeof rawProvider.request !== 'function') {
    return false;
  }

  try {
    console.log('[Wallet] Attempting wallet_revokePermissions for eth_accounts...');
    await rawProvider.request({
      method: 'wallet_revokePermissions',
      params: [{ eth_accounts: {} }]
    });
    console.log('[Wallet] wallet_revokePermissions successfully revoked eth_accounts permission');
    return true;
  } catch (err: any) {

    console.warn('[Wallet] wallet_revokePermissions not supported or failed:', err?.message || err);
    return false;
  }
};

export const verifyRevocation = async (rawProvider: any): Promise<string[]> => {
  if (!rawProvider || typeof rawProvider.request !== 'function') {
    return [];
  }

  try {
    const remainingAccounts: string[] = await rawProvider.request({ method: 'eth_accounts' });
    console.log('[Wallet] Verification after disconnect (eth_accounts):', remainingAccounts);
    return remainingAccounts || [];
  } catch (err: any) {
    console.warn('[Wallet] Error verifying post-disconnect accounts:', err?.message || err);
    return [];
  }
};
