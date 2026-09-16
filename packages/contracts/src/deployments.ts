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
    treasury: '0x0123456789012345678901234567890123456789',
    feeController: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    v1Factory: '0x71C84167B3aFdae37c4FEdf64082269c4c478a22',
    v1Router: '0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7',
    v2Factory: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    v2Router: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    v3Factory: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
    v3Router: '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
    v3PositionManager: '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
    unifiedRouter: '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f',
    crossChainRouter: '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720'
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

export function isZenithDeployed(chainId: number): boolean {
  const d = getZenithDeployment(chainId);
  if (!d) return false;
  return Boolean(d.v3Router || d.v2Router || d.v1Router || d.unifiedRouter);
}

export function isZenithV1Deployed(chainId: number): boolean {
  const d = getZenithDeployment(chainId);
  return Boolean(d?.v1Router && d?.v1Factory);
}

export function isZenithV2Deployed(chainId: number): boolean {
  const d = getZenithDeployment(chainId);
  return Boolean(d?.v2Router && d?.v2Factory);
}

export function isZenithV3Deployed(chainId: number): boolean {
  const d = getZenithDeployment(chainId);
  return Boolean(d?.v3Router && d?.v3Factory);
}

export interface BytecodeVerificationResult {
  isFullyDeployed: boolean;
  deployedContracts: Record<string, boolean>;
  missingBytecode: string[];
}

export async function verifyZenithBytecode(
  provider: { getCode: (address: string) => Promise<string> },
  chainId: number
): Promise<BytecodeVerificationResult> {
  const deployment = getZenithDeployment(chainId);
  if (!deployment) {
    return {
      isFullyDeployed: false,
      deployedContracts: {},
      missingBytecode: ['ALL_CONTRACTS_UNCONFIGURED']
    };
  }

  const contractsToCheck: Record<string, string | null> = {
    treasury: deployment.treasury,
    feeController: deployment.feeController,
    v1Factory: deployment.v1Factory,
    v1Router: deployment.v1Router,
    v2Factory: deployment.v2Factory,
    v2Router: deployment.v2Router,
    v3Factory: deployment.v3Factory,
    v3Router: deployment.v3Router,
    v3PositionManager: deployment.v3PositionManager,
    unifiedRouter: deployment.unifiedRouter
  };

  const deployedContracts: Record<string, boolean> = {};
  const missingBytecode: string[] = [];

  for (const [name, addr] of Object.entries(contractsToCheck)) {
    if (!addr) {
      deployedContracts[name] = false;
      missingBytecode.push(`${name} (address null)`);
      continue;
    }

    try {
      const code = await provider.getCode(addr);
      const hasCode = code && code !== '0x' && code.length > 2;
      deployedContracts[name] = Boolean(hasCode);
      if (!hasCode) {
        missingBytecode.push(`${name} (${addr}: code.length == 0)`);
      }
    } catch {
      deployedContracts[name] = false;
      missingBytecode.push(`${name} (${addr}: rpc error)`);
    }
  }

  return {
    isFullyDeployed: missingBytecode.length === 0,
    deployedContracts,
    missingBytecode
  };
}

