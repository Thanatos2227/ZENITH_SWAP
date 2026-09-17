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

const emptyDeployment = (chainId: number, name: string): ZenithDeployment => ({
  chainId,
  name,
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
});

export const ZENITH_DEPLOYMENTS: Record<number, ZenithDeployment> = {
  31337: emptyDeployment(31337, 'Anvil Local Devnet'),
  1: emptyDeployment(1, 'Ethereum Mainnet'),
  10: emptyDeployment(10, 'Optimism'),
  56: emptyDeployment(56, 'BNB Smart Chain'),
  137: emptyDeployment(137, 'Polygon Mainnet'),
  8453: emptyDeployment(8453, 'Base Mainnet'),
  42161: emptyDeployment(42161, 'Arbitrum One'),
  43114: emptyDeployment(43114, 'Avalanche C-Chain')
};

export function getZenithDeployment(chainId: number): ZenithDeployment | undefined {
  return ZENITH_DEPLOYMENTS[chainId];
}

export function registerZenithDeployment(chainId: number, deployment: Partial<ZenithDeployment>): void {
  ZENITH_DEPLOYMENTS[chainId] = {
    ...(ZENITH_DEPLOYMENTS[chainId] || emptyDeployment(chainId, `Chain ${chainId}`)),
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
    unifiedRouter: deployment.unifiedRouter,
    crossChainRouter: deployment.crossChainRouter
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
      const hasCode = Boolean(code && code !== '0x' && code.length > 2);
      deployedContracts[name] = hasCode;
      if (!hasCode) missingBytecode.push(`${name} (${addr}: no bytecode)`);
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
