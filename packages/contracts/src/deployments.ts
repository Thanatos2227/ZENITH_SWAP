// SPDX-License-Identifier: MIT

export interface ZenithDeployment {
  chainId: number;
  name: string;
  treasury: string | null;
  feeController: string | null;
  v1Factory: string | null;
  v1Router: string | null;
  v2Factory: string | null;
  v2Router: string | null;
  v3Factory: string | null;
  v3Router: string | null;
  v3PositionManager: string | null;
  unifiedRouter: string | null;
  crossChainRouter: string | null;
}

export const ZENITH_DEPLOYMENTS: Record<number, ZenithDeployment> = {
  31337: {
    chainId: 31337,
    name: 'Anvil Local Devnet',
    treasury: null,
    feeController: null,
    v1Factory: null,
    v1Router: null,
    v2Factory: null,
    v2Router: null,
    v3Factory: null,
    v3Router: null,
    v3PositionManager: null,
    unifiedRouter: null,
    crossChainRouter: null
  },
  1: {
    chainId: 1,
    name: 'Ethereum Mainnet',
    treasury: null,
    feeController: null,
    v1Factory: null,
    v1Router: null,
    v2Factory: null,
    v2Router: null,
    v3Factory: null,
    v3Router: null,
    v3PositionManager: null,
    unifiedRouter: null,
    crossChainRouter: null
  },
  10: {
    chainId: 10,
    name: 'Optimism',
    treasury: null,
    feeController: null,
    v1Factory: null,
    v1Router: null,
    v2Factory: null,
    v2Router: null,
    v3Factory: null,
    v3Router: null,
    v3PositionManager: null,
    unifiedRouter: null,
    crossChainRouter: null
  },
  56: {
    chainId: 56,
    name: 'BNB Smart Chain',
    treasury: null,
    feeController: null,
    v1Factory: null,
    v1Router: null,
    v2Factory: null,
    v2Router: null,
    v3Factory: null,
    v3Router: null,
    v3PositionManager: null,
    unifiedRouter: null,
    crossChainRouter: null
  },
  137: {
    chainId: 137,
    name: 'Polygon Mainnet',
    treasury: null,
    feeController: null,
    v1Factory: null,
    v1Router: null,
    v2Factory: null,
    v2Router: null,
    v3Factory: null,
    v3Router: null,
    v3PositionManager: null,
    unifiedRouter: null,
    crossChainRouter: null
  },
  8453: {
    chainId: 8453,
    name: 'Base Mainnet',
    treasury: null,
    feeController: null,
    v1Factory: null,
    v1Router: null,
    v2Factory: null,
    v2Router: null,
    v3Factory: null,
    v3Router: null,
    v3PositionManager: null,
    unifiedRouter: null,
    crossChainRouter: null
  },
  42161: {
    chainId: 42161,
    name: 'Arbitrum One',
    treasury: null,
    feeController: null,
    v1Factory: null,
    v1Router: null,
    v2Factory: null,
    v2Router: null,
    v3Factory: null,
    v3Router: null,
    v3PositionManager: null,
    unifiedRouter: null,
    crossChainRouter: null
  },
  43114: {
    chainId: 43114,
    name: 'Avalanche C-Chain',
    treasury: null,
    feeController: null,
    v1Factory: null,
    v1Router: null,
    v2Factory: null,
    v2Router: null,
    v3Factory: null,
    v3Router: null,
    v3PositionManager: null,
    unifiedRouter: null,
    crossChainRouter: null
  }
};

export function getZenithDeployment(chainId: number): ZenithDeployment | undefined {
  return ZENITH_DEPLOYMENTS[chainId];
}

export function registerZenithDeployment(chainId: number, deployment: Partial<ZenithDeployment>): void {
  ZENITH_DEPLOYMENTS[chainId] = {
    ...(ZENITH_DEPLOYMENTS[chainId] || {
      chainId,
      name: `Chain ${chainId}`,
      treasury: null,
      feeController: null,
      v1Factory: null,
      v1Router: null,
      v2Factory: null,
      v2Router: null,
      v3Factory: null,
      v3Router: null,
      v3PositionManager: null,
      unifiedRouter: null,
      crossChainRouter: null
    }),
    ...deployment
  };
}
