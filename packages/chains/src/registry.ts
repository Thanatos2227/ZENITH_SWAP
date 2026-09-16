import {
  ChainConfig,
  ExecutionEnvironment,
  GasPreset,
  NetworkSupportTier,
  OperationalStatus,
  ChainCapabilities
} from '@zenith/types';
import { ZENITH_SUPPORTED_CHAINS } from './chains.data';

export interface NetworkGasProfile {
  swapGasUnits: number;
  avgGasPriceGwei: number;
  typicalSwapUSD: number;
  typicalSplitSwapUSD: number;
  bridgeRelayUSD: number;
}

export const NETWORK_GAS_PROFILES: Record<string, NetworkGasProfile> = {

  ethereum: { swapGasUnits: 140000, avgGasPriceGwei: 18, typicalSwapUSD: 4.85, typicalSplitSwapUSD: 8.50, bridgeRelayUSD: 6.20 },
  base: { swapGasUnits: 120000, avgGasPriceGwei: 0.05, typicalSwapUSD: 0.015, typicalSplitSwapUSD: 0.028, bridgeRelayUSD: 0.45 },
  arbitrum: { swapGasUnits: 130000, avgGasPriceGwei: 0.1, typicalSwapUSD: 0.022, typicalSplitSwapUSD: 0.038, bridgeRelayUSD: 0.55 },
  optimism: { swapGasUnits: 125000, avgGasPriceGwei: 0.06, typicalSwapUSD: 0.024, typicalSplitSwapUSD: 0.042, bridgeRelayUSD: 0.50 },
  polygon: { swapGasUnits: 150000, avgGasPriceGwei: 35, typicalSwapUSD: 0.025, typicalSplitSwapUSD: 0.045, bridgeRelayUSD: 0.60 },
  bnb: { swapGasUnits: 135000, avgGasPriceGwei: 3, typicalSwapUSD: 0.12, typicalSplitSwapUSD: 0.22, bridgeRelayUSD: 0.85 },
  avalanche: { swapGasUnits: 140000, avgGasPriceGwei: 25, typicalSwapUSD: 0.14, typicalSplitSwapUSD: 0.25, bridgeRelayUSD: 0.90 },
  solana: { swapGasUnits: 5000, avgGasPriceGwei: 0.001, typicalSwapUSD: 0.0012, typicalSplitSwapUSD: 0.0022, bridgeRelayUSD: 0.35 },

  unichain: { swapGasUnits: 110000, avgGasPriceGwei: 0.04, typicalSwapUSD: 0.012, typicalSplitSwapUSD: 0.020, bridgeRelayUSD: 0.40 },
  linea: { swapGasUnits: 145000, avgGasPriceGwei: 0.15, typicalSwapUSD: 0.038, typicalSplitSwapUSD: 0.065, bridgeRelayUSD: 0.75 },
  zksync: { swapGasUnits: 160000, avgGasPriceGwei: 0.12, typicalSwapUSD: 0.032, typicalSplitSwapUSD: 0.055, bridgeRelayUSD: 0.70 },
  scroll: { swapGasUnits: 150000, avgGasPriceGwei: 0.10, typicalSwapUSD: 0.028, typicalSplitSwapUSD: 0.050, bridgeRelayUSD: 0.65 },
  blast: { swapGasUnits: 125000, avgGasPriceGwei: 0.06, typicalSwapUSD: 0.021, typicalSplitSwapUSD: 0.036, bridgeRelayUSD: 0.55 },
  zora: { swapGasUnits: 115000, avgGasPriceGwei: 0.04, typicalSwapUSD: 0.016, typicalSplitSwapUSD: 0.028, bridgeRelayUSD: 0.45 },
  worldchain: { swapGasUnits: 115000, avgGasPriceGwei: 0.04, typicalSwapUSD: 0.014, typicalSplitSwapUSD: 0.024, bridgeRelayUSD: 0.45 },
  mantle: { swapGasUnits: 120000, avgGasPriceGwei: 0.02, typicalSwapUSD: 0.008, typicalSplitSwapUSD: 0.015, bridgeRelayUSD: 0.40 },
  celo: { swapGasUnits: 90000, avgGasPriceGwei: 5, typicalSwapUSD: 0.0022, typicalSplitSwapUSD: 0.0038, bridgeRelayUSD: 0.30 },
  gnosis: { swapGasUnits: 130000, avgGasPriceGwei: 2, typicalSwapUSD: 0.005, typicalSplitSwapUSD: 0.009, bridgeRelayUSD: 0.35 },
  sonic: { swapGasUnits: 70000, avgGasPriceGwei: 0.002, typicalSwapUSD: 0.0015, typicalSplitSwapUSD: 0.0026, bridgeRelayUSD: 0.25 },
  soneium: { swapGasUnits: 120000, avgGasPriceGwei: 0.05, typicalSwapUSD: 0.018, typicalSplitSwapUSD: 0.030, bridgeRelayUSD: 0.50 },
  berachain: { swapGasUnits: 130000, avgGasPriceGwei: 0.08, typicalSwapUSD: 0.022, typicalSplitSwapUSD: 0.038, bridgeRelayUSD: 0.55 },
  cronos: { swapGasUnits: 140000, avgGasPriceGwei: 15, typicalSwapUSD: 0.045, typicalSplitSwapUSD: 0.080, bridgeRelayUSD: 0.65 },
  xlayer: { swapGasUnits: 135000, avgGasPriceGwei: 0.08, typicalSwapUSD: 0.026, typicalSplitSwapUSD: 0.045, bridgeRelayUSD: 0.65 },
  sei: { swapGasUnits: 65000, avgGasPriceGwei: 0.001, typicalSwapUSD: 0.0012, typicalSplitSwapUSD: 0.0020, bridgeRelayUSD: 0.25 },
  sui: { swapGasUnits: 2000, avgGasPriceGwei: 0.001, typicalSwapUSD: 0.0025, typicalSplitSwapUSD: 0.0040, bridgeRelayUSD: 0.35 },
  aptos: { swapGasUnits: 2500, avgGasPriceGwei: 0.001, typicalSwapUSD: 0.0030, typicalSplitSwapUSD: 0.0050, bridgeRelayUSD: 0.35 },
  near: { swapGasUnits: 1000, avgGasPriceGwei: 0.0001, typicalSwapUSD: 0.0010, typicalSplitSwapUSD: 0.0018, bridgeRelayUSD: 0.30 },
  cosmoshub: { swapGasUnits: 150000, avgGasPriceGwei: 0.005, typicalSwapUSD: 0.025, typicalSplitSwapUSD: 0.045, bridgeRelayUSD: 0.40 },
  osmosis: { swapGasUnits: 120000, avgGasPriceGwei: 0.002, typicalSwapUSD: 0.008, typicalSplitSwapUSD: 0.014, bridgeRelayUSD: 0.30 },
  injective: { swapGasUnits: 80000, avgGasPriceGwei: 0.001, typicalSwapUSD: 0.0020, typicalSplitSwapUSD: 0.0035, bridgeRelayUSD: 0.25 },

  arbitrumnova: { swapGasUnits: 110000, avgGasPriceGwei: 0.01, typicalSwapUSD: 0.005, typicalSplitSwapUSD: 0.009, bridgeRelayUSD: 0.40 },
  polygonzkevm: { swapGasUnits: 150000, avgGasPriceGwei: 0.12, typicalSwapUSD: 0.035, typicalSplitSwapUSD: 0.060, bridgeRelayUSD: 0.70 },
  mode: { swapGasUnits: 120000, avgGasPriceGwei: 0.04, typicalSwapUSD: 0.015, typicalSplitSwapUSD: 0.028, bridgeRelayUSD: 0.45 },
  taiko: { swapGasUnits: 140000, avgGasPriceGwei: 0.08, typicalSwapUSD: 0.024, typicalSplitSwapUSD: 0.042, bridgeRelayUSD: 0.55 },
  metis: { swapGasUnits: 130000, avgGasPriceGwei: 0.05, typicalSwapUSD: 0.018, typicalSplitSwapUSD: 0.032, bridgeRelayUSD: 0.50 },
  moonbeam: { swapGasUnits: 145000, avgGasPriceGwei: 10, typicalSwapUSD: 0.040, typicalSplitSwapUSD: 0.070, bridgeRelayUSD: 0.60 },
  moonriver: { swapGasUnits: 145000, avgGasPriceGwei: 5, typicalSwapUSD: 0.030, typicalSplitSwapUSD: 0.055, bridgeRelayUSD: 0.55 },
  rootstock: { swapGasUnits: 160000, avgGasPriceGwei: 0.06, typicalSwapUSD: 0.45, typicalSplitSwapUSD: 0.75, bridgeRelayUSD: 1.10 },
  tron: { swapGasUnits: 65000, avgGasPriceGwei: 0.001, typicalSwapUSD: 0.85, typicalSplitSwapUSD: 1.40, bridgeRelayUSD: 1.20 },
  ton: { swapGasUnits: 5000, avgGasPriceGwei: 0.005, typicalSwapUSD: 0.045, typicalSplitSwapUSD: 0.080, bridgeRelayUSD: 0.60 },
  hedera: { swapGasUnits: 50000, avgGasPriceGwei: 0.001, typicalSwapUSD: 0.0010, typicalSplitSwapUSD: 0.0018, bridgeRelayUSD: 0.25 },
  algorand: { swapGasUnits: 1000, avgGasPriceGwei: 0.001, typicalSwapUSD: 0.0015, typicalSplitSwapUSD: 0.0025, bridgeRelayUSD: 0.25 },
  stellar: { swapGasUnits: 100, avgGasPriceGwei: 0.0001, typicalSwapUSD: 0.0005, typicalSplitSwapUSD: 0.0009, bridgeRelayUSD: 0.20 },
  xrpl: { swapGasUnits: 12, avgGasPriceGwei: 0.0001, typicalSwapUSD: 0.0004, typicalSplitSwapUSD: 0.0008, bridgeRelayUSD: 0.20 },
  cardano: { swapGasUnits: 200000, avgGasPriceGwei: 0.17, typicalSwapUSD: 0.18, typicalSplitSwapUSD: 0.32, bridgeRelayUSD: 0.80 },
  polkadot: { swapGasUnits: 150000, avgGasPriceGwei: 0.01, typicalSwapUSD: 0.08, typicalSplitSwapUSD: 0.14, bridgeRelayUSD: 0.70 },
  icp: { swapGasUnits: 10000, avgGasPriceGwei: 0.0001, typicalSwapUSD: 0.0008, typicalSplitSwapUSD: 0.0014, bridgeRelayUSD: 0.20 },

  bitcoin: { swapGasUnits: 250, avgGasPriceGwei: 15, typicalSwapUSD: 2.10, typicalSplitSwapUSD: 3.50, bridgeRelayUSD: 4.80 },
  monad: { swapGasUnits: 80000, avgGasPriceGwei: 0.005, typicalSwapUSD: 0.0028, typicalSplitSwapUSD: 0.0045, bridgeRelayUSD: 0.30 },
  robinhood: { swapGasUnits: 95000, avgGasPriceGwei: 0.02, typicalSwapUSD: 0.0095, typicalSplitSwapUSD: 0.016, bridgeRelayUSD: 0.40 },
  tempo: { swapGasUnits: 75000, avgGasPriceGwei: 0.002, typicalSwapUSD: 0.0018, typicalSplitSwapUSD: 0.0030, bridgeRelayUSD: 0.25 },
  megaeth: { swapGasUnits: 60000, avgGasPriceGwei: 0.001, typicalSwapUSD: 0.0008, typicalSplitSwapUSD: 0.0014, bridgeRelayUSD: 0.20 }
};

export class ChainRegistry {
  private chains: Map<string, ChainConfig> = new Map();
  private chainIdToKey: Map<number, string> = new Map();

  constructor(customChains?: Record<string, ChainConfig>) {
    const initial = customChains || ZENITH_SUPPORTED_CHAINS;
    Object.entries(initial).forEach(([key, config]) => {
      this.registerChain(key, config);
    });
  }

  public registerChain(key: string, config: ChainConfig): void {
    this.chains.set(key.toLowerCase(), config);
    if (config.chainId !== undefined && config.chainId > 0) {
      this.chainIdToKey.set(config.chainId, key.toLowerCase());
    }
  }

  public getChain(keyOrId: string | number): ChainConfig | undefined {
    if (typeof keyOrId === 'number') {
      const key = this.chainIdToKey.get(keyOrId);
      return key ? this.chains.get(key) : undefined;
    }
    const directMatch = this.chains.get(keyOrId.toLowerCase());
    if (directMatch) return directMatch;

    const num = Number(keyOrId);
    if (!isNaN(num) && this.chainIdToKey.has(num)) {
      const key = this.chainIdToKey.get(num);
      return key ? this.chains.get(key) : undefined;
    }
    return undefined;
  }

  public getAllChains(includeMaintenance = true): ChainConfig[] {
    const all = Array.from(this.chains.values());
    if (includeMaintenance) return all;
    return all.filter((c) => c.operationalStatus !== 'DISABLED');
  }

  public getChainsByTier(tier: NetworkSupportTier): ChainConfig[] {
    return this.getAllChains().filter((c) => c.tier === tier);
  }

  public getChainsByEnvironment(env: ExecutionEnvironment): ChainConfig[] {
    return this.getAllChains().filter((c) => c.executionEnvironment === env);
  }

  public updateChainTier(chainKey: string, tier: NetworkSupportTier): void {
    const chain = this.getChain(chainKey);
    if (chain) {
      chain.tier = tier;
    }
  }

  public setOperationalStatus(chainKey: string, status: OperationalStatus): void {
    const chain = this.getChain(chainKey);
    if (chain) {
      chain.operationalStatus = status;
    }
  }

  public supportsCapability(chainKey: string, capability: keyof ChainCapabilities): boolean {
    const chain = this.getChain(chainKey);
    if (!chain) return false;
    if (chain.operationalStatus === 'PAUSED' || chain.operationalStatus === 'DISABLED') {
      return false;
    }
    return Boolean(chain.capabilities[capability]);
  }

  public isChainOperational(chainKey: string): boolean {
    const chain = this.getChain(chainKey);
    if (!chain) return false;
    return chain.operationalStatus === 'HEALTHY' || chain.operationalStatus === 'PARTIALLY_AVAILABLE';
  }

  public getHealthyRPC(chainKey: string): string {
    const chain = this.getChain(chainKey);
    if (!chain || chain.rpcEndpoints.length === 0) {
      throw new Error(`[ChainRegistry] No RPC endpoints configured for chain: ${chainKey}`);
    }

    const healthy = chain.rpcEndpoints
      .filter((rpc) => rpc.status !== 'UNAVAILABLE')
      .sort((a, b) => a.priority - b.priority);

    if (healthy.length === 0) {
      return chain.rpcEndpoints[0].url;
    }

    return healthy[0].url;
  }

  public isJurisdictionAllowed(chainKey: string, userCountryCode?: string): boolean {
    const chain = this.getChain(chainKey);
    if (!chain) return false;
    if (!chain.regulatoryScope.jurisdictionGated) return true;
    if (!userCountryCode) return true;

    const blocked = chain.regulatoryScope.blockedRegions || [];
    return !blocked.includes(userCountryCode.toUpperCase());
  }

  public getExplorerTxUrl(chainKey: string, txHash: string): string {
    const chain = this.getChain(chainKey);
    if (!chain) return '#';
    return `${chain.explorer.baseUrl}${chain.explorer.txPath}${txHash}`;
  }

  public getExplorerAddressUrl(chainKey: string, address: string): string {
    const chain = this.getChain(chainKey);
    if (!chain) return '#';
    return `${chain.explorer.baseUrl}${chain.explorer.addressPath}${address}`;
  }

  public getEstimatedGasCostUSD(
    chainId: string,
    txType: 'SWAP' | 'SPLIT_SWAP' | 'BRIDGE' = 'SWAP',
    priorityPreset: GasPreset = 'STANDARD',
    nativePriceUSD?: number
  ): number {
    const profile = NETWORK_GAS_PROFILES[chainId.toLowerCase()] || {
      swapGasUnits: 120000,
      avgGasPriceGwei: 0.05,
      typicalSwapUSD: 0.02,
      typicalSplitSwapUSD: 0.035,
      bridgeRelayUSD: 0.50
    };

    const priorityMultiplier = priorityPreset === 'INSTANT' ? 1.4 : priorityPreset === 'FAST' ? 1.2 : 1.0;

    if (nativePriceUSD !== undefined && nativePriceUSD > 0) {
      let units = profile.swapGasUnits;
      if (txType === 'SPLIT_SWAP') units = Math.round(profile.swapGasUnits * 1.6);
      else if (txType === 'BRIDGE') units = 180000;

      const effectiveGwei = profile.avgGasPriceGwei * priorityMultiplier;
      const gasCostUSD = (units * effectiveGwei * 1e-9) * nativePriceUSD;
      return Number(gasCostUSD < 0.0001 ? gasCostUSD.toFixed(6) : (gasCostUSD < 0.01 ? gasCostUSD.toFixed(4) : gasCostUSD.toFixed(2)));
    }

    let baseCost = profile.typicalSwapUSD;
    if (txType === 'SPLIT_SWAP') {
      baseCost = profile.typicalSplitSwapUSD;
    } else if (txType === 'BRIDGE') {
      baseCost = profile.bridgeRelayUSD;
    }

    const timeSeed = Date.now() / 15000;
    const dynamicJitter = 1 + Math.sin(timeSeed + chainId.length) * 0.04;

    const dynamicUSD = baseCost * dynamicJitter * priorityMultiplier;
    return Number(dynamicUSD < 0.01 ? dynamicUSD.toFixed(4) : dynamicUSD.toFixed(2));
  }

  public getGasUnits(chainId: string, isSplit = false): bigint {
    const profile = NETWORK_GAS_PROFILES[chainId.toLowerCase()];
    if (!profile) return isSplit ? 220000n : 130000n;
    return BigInt(isSplit ? Math.round(profile.swapGasUnits * 1.6) : profile.swapGasUnits);
  }
}

export const defaultChainRegistry = new ChainRegistry();
