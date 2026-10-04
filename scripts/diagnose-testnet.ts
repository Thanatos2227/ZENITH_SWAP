#!/usr/bin/env tsx
/**
 * ZENITH Protocol — Testnet Execution & Funding Diagnostic
 *
 * Authoritative diagnostic verifying real on-chain testnet prerequisites:
 * - Sepolia RPC & Chain ID (11155111)
 * - Arbitrum Sepolia RPC & Chain ID (421614)
 * - Signer presence & address derivation (zero key logging)
 * - Real on-chain native gas balances
 * - Real on-chain ERC20 test token balances
 * - On-chain bytecode verification for tokens and SpokePool contracts
 *
 * Never outputs private keys, seeds, or credentials.
 */

import { ethers } from 'ethers';
import { defaultAuthoritativeNetworkRegistry, defaultChainRegistry } from '../packages/chains/src';
import { getAcrossSpokePool } from '../packages/contracts/src';

export interface TestnetDiagnosticReport {
  network: string;
  chainId: number;
  rpcEndpointsChecked: string[];
  rpcHealthy: boolean;
  signerPresent: boolean;
  signerAddress: string | null;
  nativeBalance: string;
  requiredNativeBalance: string;
  nativeBalanceSufficient: boolean;
  tokenAddress: string;
  tokenBalance: string;
  requiredTokenBalance: string;
  tokenBalanceSufficient: boolean;
  tokenBytecodePresent: boolean;
  bridgeContractAddress: string;
  bridgeBytecodePresent: boolean;
  destinationNetwork: string;
  destinationChainId: number;
  destinationRpcHealthy: boolean;
  destinationTokenAddress: string;
  destinationTokenBytecodePresent: boolean;
  destinationBridgeAddress: string;
  destinationBridgeBytecodePresent: boolean;
  routerDeploymentStatus: string;
  preflightStatus: 'READY_FOR_REAL_TESTNET_EXECUTION' | 'BLOCKED';
  blockerReason?: string;
}

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

const SEPOLIA_RPCS = [
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://rpc.sepolia.org',
  'https://rpc2.sepolia.org',
  'https://eth-sepolia.public.blastapi.io'
];

const ARBITRUM_SEPOLIA_RPCS = [
  'https://sepolia-rollup.arbitrum.io/rpc',
  'https://arbitrum-sepolia-rpc.publicnode.com'
];

async function createHealthyProvider(rpcs: string[], expectedChainId: number): Promise<{ provider: ethers.JsonRpcProvider | null; healthyRpc: string | null }> {
  for (const rpc of rpcs) {
    try {
      const p = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
      const network = await Promise.race([
        p.getNetwork(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
      ]);
      if (Number(network.chainId) === expectedChainId) {
        return { provider: p, healthyRpc: rpc };
      }
    } catch {
      // Try next RPC
    }
  }
  return { provider: null, healthyRpc: null };
}

export async function runTestnetDiagnostic(): Promise<TestnetDiagnosticReport> {
  const sepoliaConfig = defaultAuthoritativeNetworkRegistry.getNetwork('sepolia');
  const arbSepoliaConfig = defaultAuthoritativeNetworkRegistry.getNetwork('arbitrum_sepolia');

  const sepoliaChainId = Number(sepoliaConfig?.numericChainId || 11155111);
  const arbSepoliaChainId = Number(arbSepoliaConfig?.numericChainId || 421614);

  const sepoliaTokenAddress = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
  const arbSepoliaTokenAddress = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d';

  const sepoliaBridgeAddress = getAcrossSpokePool(sepoliaChainId);
  const arbSepoliaBridgeAddress = getAcrossSpokePool(arbSepoliaChainId);

  // 1. Source RPC
  const { provider: srcProvider, healthyRpc: srcRpc } = await createHealthyProvider(SEPOLIA_RPCS, sepoliaChainId);
  const rpcHealthy = srcProvider !== null;

  // 2. Destination RPC
  const { provider: dstProvider, healthyRpc: dstRpc } = await createHealthyProvider(ARBITRUM_SEPOLIA_RPCS, arbSepoliaChainId);
  const destinationRpcHealthy = dstProvider !== null;

  // 3. Signer Verification (Safe derivation, no key exposure)
  const testnetKey = process.env.TESTNET_PRIVATE_KEY || process.env.ZENITH_TESTNET_PRIVATE_KEY;
  let signerAddress: string | null = null;
  let nativeBalance = '0';
  let nativeBalanceSufficient = false;
  let tokenBalance = '0';
  let tokenBalanceSufficient = false;

  if (testnetKey && testnetKey.startsWith('0x') && testnetKey.length === 66) {
    try {
      const wallet = new ethers.Wallet(testnetKey);
      signerAddress = wallet.address;

      if (srcProvider) {
        // Query Native Balance
        const bal = await srcProvider.getBalance(signerAddress);
        nativeBalance = ethers.formatEther(bal);
        nativeBalanceSufficient = bal >= ethers.parseEther('0.05');

        // Query Token Balance
        try {
          const tokenContract = new ethers.Contract(sepoliaTokenAddress, ERC20_ABI, srcProvider);
          const rawBal = await tokenContract.balanceOf(signerAddress);
          const decimals = await tokenContract.decimals();
          tokenBalance = ethers.formatUnits(rawBal, decimals);
          tokenBalanceSufficient = rawBal >= ethers.parseUnits('10.0', decimals);
        } catch {
          tokenBalance = '0.0';
          tokenBalanceSufficient = false;
        }
      }
    } catch {
      signerAddress = null;
    }
  }

  // 4. Source On-Chain Bytecode Verification
  let tokenBytecodePresent = false;
  let bridgeBytecodePresent = false;
  if (srcProvider) {
    try {
      const [tokenCode, bridgeCode] = await Promise.all([
        srcProvider.getCode(sepoliaTokenAddress),
        srcProvider.getCode(sepoliaBridgeAddress)
      ]);
      tokenBytecodePresent = tokenCode !== '0x' && tokenCode !== '0x0';
      bridgeBytecodePresent = bridgeCode !== '0x' && bridgeCode !== '0x0';
    } catch {
      // RPC error
    }
  }

  // 5. Destination On-Chain Bytecode Verification
  let destinationTokenBytecodePresent = false;
  let destinationBridgeBytecodePresent = false;
  if (dstProvider) {
    try {
      const [dstTokenCode, dstBridgeCode] = await Promise.all([
        dstProvider.getCode(arbSepoliaTokenAddress),
        dstProvider.getCode(arbSepoliaBridgeAddress)
      ]);
      destinationTokenBytecodePresent = dstTokenCode !== '0x' && dstTokenCode !== '0x0';
      destinationBridgeBytecodePresent = dstBridgeCode !== '0x' && dstBridgeCode !== '0x0';
    } catch {
      // RPC error
    }
  }

  const signerPresent = signerAddress !== null;
  const routerDeploymentStatus = 'DEPLOYMENT_CONFIGURED';

  let preflightStatus: 'READY_FOR_REAL_TESTNET_EXECUTION' | 'BLOCKED' = 'BLOCKED';
  let blockerReason: string | undefined = 'BLOCKED_NO_FUNDED_KEY';

  if (!signerPresent) {
    blockerReason = 'BLOCKED_NO_FUNDED_KEY: TESTNET_PRIVATE_KEY environment variable is not configured';
  } else if (!rpcHealthy) {
    blockerReason = 'BLOCKED_RPC_UNHEALTHY: Sepolia RPC endpoints unreachable';
  } else if (!destinationRpcHealthy) {
    blockerReason = 'BLOCKED_DESTINATION_RPC_UNHEALTHY: Arbitrum Sepolia RPC unreachable';
  } else if (!nativeBalanceSufficient) {
    blockerReason = `BLOCKED_INSUFFICIENT_NATIVE_BALANCE: Balance ${nativeBalance} ETH < required 0.05 ETH`;
  } else if (!tokenBalanceSufficient) {
    blockerReason = `BLOCKED_INSUFFICIENT_TOKEN_BALANCE: Balance ${tokenBalance} USDC < required 10.0 USDC`;
  } else if (routerDeploymentStatus !== 'DEPLOYED_VERIFIED') {
    blockerReason = 'BLOCKED_ROUTER_NOT_DEPLOYED: ZenithCrossChainRouter pending testnet deployment ceremony';
  } else {
    preflightStatus = 'READY_FOR_REAL_TESTNET_EXECUTION';
    blockerReason = undefined;
  }

  return {
    network: 'Ethereum Sepolia',
    chainId: sepoliaChainId,
    rpcEndpointsChecked: SEPOLIA_RPCS,
    rpcHealthy,
    signerPresent,
    signerAddress,
    nativeBalance: `${nativeBalance} ETH`,
    requiredNativeBalance: '0.05 ETH',
    nativeBalanceSufficient,
    tokenAddress: sepoliaTokenAddress,
    tokenBalance: `${tokenBalance} USDC`,
    requiredTokenBalance: '10.0 USDC',
    tokenBalanceSufficient,
    tokenBytecodePresent,
    bridgeContractAddress: sepoliaBridgeAddress,
    bridgeBytecodePresent,
    destinationNetwork: 'Arbitrum Sepolia',
    destinationChainId: arbSepoliaChainId,
    destinationRpcHealthy,
    destinationTokenAddress: arbSepoliaTokenAddress,
    destinationTokenBytecodePresent,
    destinationBridgeAddress: arbSepoliaBridgeAddress,
    destinationBridgeBytecodePresent,
    routerDeploymentStatus,
    preflightStatus,
    blockerReason,
  };
}

if (process.argv[1]?.includes('diagnose-testnet')) {
  (async () => {
    console.log('============================================================');
    console.log('   ZENITH PROTOCOL — REAL TESTNET READINESS & PREFLIGHT     ');
    console.log('============================================================');

    const diag = await runTestnetDiagnostic();

    console.log(`Source Network:           ${diag.network} (Chain ID: ${diag.chainId})`);
    console.log(`Source RPC Health:        ${diag.rpcHealthy ? 'HEALTHY' : 'OFFLINE / UNREACHABLE'}`);
    console.log(`Destination Network:      ${diag.destinationNetwork} (Chain ID: ${diag.destinationChainId})`);
    console.log(`Destination RPC Health:   ${diag.destinationRpcHealthy ? 'HEALTHY' : 'OFFLINE / UNREACHABLE'}`);
    console.log('------------------------------------------------------------');
    console.log(`Signer Present:           ${diag.signerPresent ? 'YES' : 'NO'}`);
    console.log(`Signer Address:           ${diag.signerAddress || 'NONE'}`);
    console.log(`Native Gas Balance:       ${diag.nativeBalance} (Required: >= ${diag.requiredNativeBalance})`);
    console.log(`Token Balance:            ${diag.tokenBalance} (Required: >= ${diag.requiredTokenBalance})`);
    console.log('------------------------------------------------------------');
    console.log(`Source Token (USDC):      ${diag.tokenAddress}`);
    console.log(`Source Bridge (Across):   ${diag.bridgeContractAddress}`);
    console.log(`Destination Token (USDC): ${diag.destinationTokenAddress}`);
    console.log(`Destination Bridge:       ${diag.destinationBridgeAddress}`);
    console.log(`Router Deployment:        ${diag.routerDeploymentStatus}`);
    console.log('------------------------------------------------------------');
    console.log(`PREFLIGHT STATUS:         ${diag.preflightStatus}`);
    if (diag.blockerReason) {
      console.log(`BLOCKER REASON:           ${diag.blockerReason}`);
    }
    console.log('============================================================');
  })();
}
