import React, { useState } from 'react';

export interface TokenLogoProps {
  logoURI?: string;
  symbol: string;
  name?: string;
  chainId?: string;
  address?: string;
  isNative?: boolean;
  className?: string;
}

export const TokenLogo: React.FC<TokenLogoProps> = ({
  logoURI,
  symbol,
  name,
  chainId,
  address,
  isNative,
  className = 'w-7 h-7 rounded-full'
}) => {
  const [imgError, setImgError] = useState(false);
  const [triedFallbackUrl, setTriedFallbackUrl] = useState(false);
  const [currentSrc, setCurrentSrc] = useState<string | undefined>(logoURI);

  const getTrustWalletFallback = (): string | null => {
    if (!address || !chainId || isNative || address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
      return null;
    }
    const cleanAddress = address.trim();
    if (cleanAddress.startsWith('0x') && cleanAddress.length === 42) {
      const chainFolderMap: Record<string, string> = {
        ethereum: 'ethereum',
        base: 'base',
        arbitrum: 'arbitrum',
        optimism: 'optimism',
        polygon: 'polygon',
        bnb: 'smartchain',
        avalanche: 'avalanche',
        linea: 'linea',
        zksync: 'zksync',
        scroll: 'scroll',
        blast: 'blast',
        mantle: 'mantle',
        metis: 'metis',
        moonriver: 'moonriver',
        rootstock: 'rootstock',
        gnosis: 'xdai'
      };
      const folder = chainFolderMap[chainId.toLowerCase()];
      if (folder) {
        return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${folder}/assets/${cleanAddress}/logo.png`;
      }
    }
    return null;
  };

  const handleImgError = () => {
    if (!triedFallbackUrl) {
      setTriedFallbackUrl(true);
      const fallback = getTrustWalletFallback();
      if (fallback && fallback !== currentSrc) {
        setCurrentSrc(fallback);
        return;
      }
    }
    setImgError(true);
  };

  React.useEffect(() => {
    setCurrentSrc(logoURI);
    setImgError(false);
    setTriedFallbackUrl(false);
  }, [logoURI]);

  const showImg = currentSrc && !imgError;

  if (showImg) {
    return (
      <img
        src={currentSrc}
        alt={symbol}
        className={`${className} object-cover shrink-0`}
        onError={handleImgError}
      />
    );
  }

  const displaySymbol = symbol ? symbol.toUpperCase().slice(0, 3) : 'TOK';
  const initialChars = displaySymbol.slice(0, 2);

  return (
    <div
      className={`${className} bg-cyan-500/20 text-cyan-300 font-extrabold flex items-center justify-center text-[10px] sm:text-xs border border-cyan-500/30 uppercase tracking-tight shrink-0 select-none`}
      title={name || symbol}
    >
      {initialChars}
    </div>
  );
};
