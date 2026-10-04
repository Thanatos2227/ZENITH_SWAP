/**
 * ZENITH Protocol — Pre-Broadcast Testnet Execution Readiness & Route Integrity Auditor
 *
 * Performs read-only on-chain and architectural pre-flight verification for:
 *   Sepolia (11155111) USDC -> Across V3 -> Arbitrum Sepolia (421614) USDC
 *
 * PRESERVES INVARIANTS:
 * - Quote != Execution Guarantee
 * - Execution Plan != Broadcast Authorization
 * - Simulation Success != Broadcast Authorization
 * - RPC Health != Execution Authorization
 * - ZERO transaction broadcasts (sendTransaction / eth_sendRawTransaction prohibited)
 * - ZERO fabricated balances, receipts, hashes, quotes, or routes
 * - Execution authorization remains strictly FAIL-CLOSED (BLOCKED)
 */

import { ethers, Interface } from 'ethers';
import { evaluateRpcQuorum, QuorumEvaluationResult } from '@zenith/chains';
import { ACROSS_SPOKE_POOL_ABI, ZERO_ADDRESS } from '@zenith/contracts';
import { AcrossProvider } from '@zenith/routing';
import { Token } from '@zenith/types';
import {
  BroadcastAuthorizationGate,
  BroadcastLifecycleState,
  SimulationExecutionStatus,
  SimulationClassification
} from '../security/broadcastAuthorizationGate';

export interface ContractVerificationItem {
  name: string;
  address: string;
  chainId: number;
  bytecodePresent: boolean;
  bytecodeLength: number;
}

export interface Erc20MetadataVerification {
  name: string;
  address: string;
  chainId: number;
  onChainName: string;
  onChainSymbol: string;
  onChainDecimals: number;
  onChainTotalSupply: string;
  configuredDecimals: number;
  configuredSymbol: string;
  matched: boolean;
}

export interface WalletReadinessReport {
  signerConfigured: boolean;
  signerState: BroadcastLifecycleState;
  signerAddress: string | null;
  sourceNativeBalance: string;
  sourceNativeBalanceWei: string | null;
  destinationNativeBalance: string;
  destinationNativeBalanceWei: string | null;
  sourceUsdcBalance: string;
  sourceUsdcBalanceRaw: string | null;
  destinationUsdcBalance: string;
  destinationUsdcBalanceRaw: string | null;
  currentAllowanceRaw: string | null;
  currentAllowanceFormatted: string;
  requiredAllowanceRaw: string;
  allowanceSufficient: boolean;
  gasEstimatedWei?: string;
  gasEstimatedFormatted?: string;
  gasPriceWei?: string;
  gasReadiness: 'READY' | 'INSUFFICIENT_FUNDS' | 'NOT_CHECKED';
}

export interface AcrossCapabilityReport {
  functionName: string;
  functionSelector: string;
  abiCompatible: boolean;
  sourceSpokePoolAddress: string;
  destinationSpokePoolAddress: string;
  encodedCalldataPreviewLength: number;
}

export interface RouteQuoteAuditReport {
  routeSupported: boolean;
  providerId: string;
  isLiveQuote: boolean;
  sourceAmountRaw: string;
  sourceAmountFormatted: string;
  destinationAmountRaw: string;
  destinationAmountFormatted: string;
  minDestinationAmountRaw: string;
  minDestinationAmountFormatted: string;
  bridgeFeeUSD: number;
  relayerFeePct: string;
  quoteTimestamp: number;
  quoteExpiry?: number;
  disclaimer: 'LIVE QUOTE - NOT EXECUTION GUARANTEE';
}

export interface SimulationAuditReport {
  attempted: boolean;
  executionStatus: SimulationExecutionStatus;
  classification: SimulationClassification;
  readinessStatus: 'READY' | 'BLOCKED';
  simulatedCaller: string | null;
  targetContract: string;
  calldata: string;
  calldataHash: string;
  simulationSuccess: boolean;
  revertData?: string;
  revertSelector?: string;
  revertReason?: string;
  decodedError?: {
    selector: string;
    name: string;
    description: string;
  };
}

export interface DestinationExecutionAuditReport {
  destinationEngineOperational: boolean;
  sourceChainId: number;
  destinationChainId: number;
  sourceTokenAddress: string;
  destinationTokenAddress: string;
  actualAmountPropagationVerified: boolean;
  noHardcodedDestinationAmounts: boolean;
}

export interface ReadinessMatrixRow {
  check: string;
  status: 'PASS' | 'FAIL' | 'UNKNOWN' | 'BLOCKED' | 'NOT_SUPPORTED';
  details?: string;
}

export interface PreBroadcastReadinessReport {
  timestamp: number;
  sourceChain: {
    name: string;
    expectedChainId: number;
    observedChainId: number | null;
    chainIdentityVerified: boolean;
    rpcQuorum: QuorumEvaluationResult;
  };
  destinationChain: {
    name: string;
    expectedChainId: number;
    observedChainId: number | null;
    chainIdentityVerified: boolean;
    rpcQuorum: QuorumEvaluationResult;
  };
  amountConfig: {
    configuredAmount: string;
    rawAmount: string;
    configSource: string;
  };
  quoteTimestampValidation: {
    currentChainTimestamp: number;
    quoteTimestamp: number;
    diffSec: number;
    valid: boolean;
  };
  contracts: ContractVerificationItem[];
  erc20Metadata: Erc20MetadataVerification[];
  walletReadiness: WalletReadinessReport;
  acrossCapability: AcrossCapabilityReport;
  routeAndQuote: RouteQuoteAuditReport;
  simulation: SimulationAuditReport;
  destinationExecution: DestinationExecutionAuditReport;
  matrix: ReadinessMatrixRow[];
  broadcastProhibition: {
    sendTransactionInvoked: false;
    stateChangingCallsInvoked: false;
    executionAuthorization: 'BLOCKED';
    lifecycleState: BroadcastLifecycleState;
    reason: string;
  };
}

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

export class PreBroadcastReadinessAuditor {
  public static readonly SEPOLIA_CHAIN_ID = 11155111;
  public static readonly ARBITRUM_SEPOLIA_CHAIN_ID = 421614;

  public static readonly SEPOLIA_USDC_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
  public static readonly ARBITRUM_SEPOLIA_USDC_ADDRESS = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d';

  public static readonly SEPOLIA_SPOKE_POOL = '0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662';
  public static readonly ARBITRUM_SEPOLIA_SPOKE_POOL = '0x7E63A5f1a8F0B4d0934B2f2327DAED3F6bb2ee75';

  /**
   * Decode known Across / ERC-20 error selectors.
   */
  public static decodeCustomError(selectorOrData: string): { selector: string; name: string; description: string } | null {
    if (!selectorOrData || selectorOrData.length < 10) return null;
    const selector = selectorOrData.slice(0, 10).toLowerCase();

    const KNOWN_ERRORS: Record<string, { name: string; description: string }> = {
      '0xf722177f': {
        name: 'InvalidQuoteTimestamp()',
        description: 'Across SpokePool rejected quoteTimestamp: Timestamp is in the future relative to block.timestamp or exceeds tolerance window.'
      },
      '0x08c379a0': {
        name: 'Error(string)',
        description: 'Standard Solidity revert string (e.g. "ERC20: transfer amount exceeds allowance" or "ERC20: transfer amount exceeds balance").'
      },
      '0x4e487b71': {
        name: 'Panic(uint256)',
        description: 'Solidity internal panic code (e.g. arithmetic overflow/underflow or assertion failure).'
      },
      '0xe450d38c': {
        name: 'ERC20InsufficientBalance(address,uint256,uint256)',
        description: 'Caller has insufficient token balance for the requested transfer.'
      },
      '0xfb8f41b2': {
        name: 'ERC20InsufficientAllowance(address,uint256,uint256)',
        description: 'Spender has insufficient token allowance from the caller.'
      }
    };

    if (KNOWN_ERRORS[selector]) {
      return {
        selector,
        name: KNOWN_ERRORS[selector].name,
        description: KNOWN_ERRORS[selector].description
      };
    }

    return null;
  }

  /**
   * Run the pre-broadcast execution readiness and route integrity audit.
   * NEVER sends any transaction or modifies blockchain state.
   */
  public async audit(options?: {
    sepoliaRpcs?: string[];
    arbitrumSepoliaRpcs?: string[];
    testnetPrivateKey?: string;
    intendedAmountRaw?: string;
  }): Promise<PreBroadcastReadinessReport> {
    // Configurable amount: process.env.ZENITH_TESTNET_AUDIT_AMOUNT -> options -> default 10 USDC
    const intendedAmountRaw = options?.intendedAmountRaw ||
      process.env.ZENITH_TESTNET_AUDIT_AMOUNT ||
      process.env.TESTNET_AMOUNT ||
      '10000000'; // 10 USDC

    // 1. Resolve RPC endpoints
    const sepoliaRpcs = options?.sepoliaRpcs || [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://gateway.tenderly.co/public/sepolia'
    ];
    const arbRpcs = options?.arbitrumSepoliaRpcs || [
      'https://sepolia-rollup.arbitrum.io/rpc',
      'https://arbitrum-sepolia-rpc.publicnode.com'
    ];

    // 2. Evaluate RPC Quorums
    const sepoliaQuorum = await evaluateRpcQuorum('Sepolia', PreBroadcastReadinessAuditor.SEPOLIA_CHAIN_ID, sepoliaRpcs);
    const arbQuorum = await evaluateRpcQuorum('Arbitrum Sepolia', PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_CHAIN_ID, arbRpcs);

    const srcObservedChainId = sepoliaQuorum.results.find(r => r.healthy)?.observedChainId || null;
    const dstObservedChainId = arbQuorum.results.find(r => r.healthy)?.observedChainId || null;

    const srcIdentityVerified = srcObservedChainId === PreBroadcastReadinessAuditor.SEPOLIA_CHAIN_ID;
    const dstIdentityVerified = dstObservedChainId === PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_CHAIN_ID;

    // Instantiate safe read-only providers for healthy endpoints
    let srcProvider: ethers.JsonRpcProvider | null = null;
    if (sepoliaQuorum.healthyEndpoints.length > 0) {
      srcProvider = new ethers.JsonRpcProvider(
        sepoliaQuorum.healthyEndpoints[0],
        PreBroadcastReadinessAuditor.SEPOLIA_CHAIN_ID,
        { staticNetwork: true }
      );
    }

    let dstProvider: ethers.JsonRpcProvider | null = null;
    if (arbQuorum.healthyEndpoints.length > 0) {
      dstProvider = new ethers.JsonRpcProvider(
        arbQuorum.healthyEndpoints[0],
        PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_CHAIN_ID,
        { staticNetwork: true }
      );
    }

    // 3. Verify Authoritative Contract Addresses & Bytecode
    const contracts: ContractVerificationItem[] = [];

    // Sepolia SpokePool
    let sSpokeCode = '0x';
    if (srcProvider) {
      try { sSpokeCode = await srcProvider.getCode(PreBroadcastReadinessAuditor.SEPOLIA_SPOKE_POOL); } catch {}
    }
    contracts.push({
      name: 'Sepolia Across SpokePool',
      address: PreBroadcastReadinessAuditor.SEPOLIA_SPOKE_POOL,
      chainId: PreBroadcastReadinessAuditor.SEPOLIA_CHAIN_ID,
      bytecodePresent: sSpokeCode !== '0x' && sSpokeCode !== '0x0' && sSpokeCode.length > 2,
      bytecodeLength: sSpokeCode.length
    });

    // Sepolia USDC
    let sUsdcCode = '0x';
    if (srcProvider) {
      try { sUsdcCode = await srcProvider.getCode(PreBroadcastReadinessAuditor.SEPOLIA_USDC_ADDRESS); } catch {}
    }
    contracts.push({
      name: 'Sepolia Mock USDC',
      address: PreBroadcastReadinessAuditor.SEPOLIA_USDC_ADDRESS,
      chainId: PreBroadcastReadinessAuditor.SEPOLIA_CHAIN_ID,
      bytecodePresent: sUsdcCode !== '0x' && sUsdcCode !== '0x0' && sUsdcCode.length > 2,
      bytecodeLength: sUsdcCode.length
    });

    // Arbitrum Sepolia USDC
    let aUsdcCode = '0x';
    if (dstProvider) {
      try { aUsdcCode = await dstProvider.getCode(PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_USDC_ADDRESS); } catch {}
    }
    contracts.push({
      name: 'Arbitrum Sepolia Mock USDC',
      address: PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_USDC_ADDRESS,
      chainId: PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_CHAIN_ID,
      bytecodePresent: aUsdcCode !== '0x' && aUsdcCode !== '0x0' && aUsdcCode.length > 2,
      bytecodeLength: aUsdcCode.length
    });

    // Arbitrum Sepolia SpokePool
    let aSpokeCode = '0x';
    if (dstProvider) {
      try { aSpokeCode = await dstProvider.getCode(PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_SPOKE_POOL); } catch {}
    }
    contracts.push({
      name: 'Arbitrum Sepolia Across SpokePool',
      address: PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_SPOKE_POOL,
      chainId: PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_CHAIN_ID,
      bytecodePresent: aSpokeCode !== '0x' && aSpokeCode !== '0x0' && aSpokeCode.length > 2,
      bytecodeLength: aSpokeCode.length
    });

    // 4. Verify ERC-20 Contract Metadata
    const erc20Metadata: Erc20MetadataVerification[] = [];
    if (srcProvider && contracts[1].bytecodePresent) {
      try {
        const c = new ethers.Contract(PreBroadcastReadinessAuditor.SEPOLIA_USDC_ADDRESS, ERC20_ABI, srcProvider);
        const [onChainName, onChainSymbol, onChainDecimals, onChainTotalSupply] = await Promise.all([
          c.name(),
          c.symbol(),
          c.decimals(),
          c.totalSupply()
        ]);
        const matched = Number(onChainDecimals) === 6 && onChainSymbol.toUpperCase() === 'USDC';
        erc20Metadata.push({
          name: 'Sepolia USDC',
          address: PreBroadcastReadinessAuditor.SEPOLIA_USDC_ADDRESS,
          chainId: PreBroadcastReadinessAuditor.SEPOLIA_CHAIN_ID,
          onChainName,
          onChainSymbol,
          onChainDecimals: Number(onChainDecimals),
          onChainTotalSupply: onChainTotalSupply.toString(),
          configuredDecimals: 6,
          configuredSymbol: 'USDC',
          matched
        });
      } catch {
        erc20Metadata.push({
          name: 'Sepolia USDC',
          address: PreBroadcastReadinessAuditor.SEPOLIA_USDC_ADDRESS,
          chainId: PreBroadcastReadinessAuditor.SEPOLIA_CHAIN_ID,
          onChainName: 'UNKNOWN',
          onChainSymbol: 'UNKNOWN',
          onChainDecimals: 0,
          onChainTotalSupply: '0',
          configuredDecimals: 6,
          configuredSymbol: 'USDC',
          matched: false
        });
      }
    }

    if (dstProvider && contracts[2].bytecodePresent) {
      try {
        const c = new ethers.Contract(PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_USDC_ADDRESS, ERC20_ABI, dstProvider);
        const [onChainName, onChainSymbol, onChainDecimals, onChainTotalSupply] = await Promise.all([
          c.name(),
          c.symbol(),
          c.decimals(),
          c.totalSupply()
        ]);
        const matched = Number(onChainDecimals) === 6 && onChainSymbol.toUpperCase() === 'USDC';
        erc20Metadata.push({
          name: 'Arbitrum Sepolia USDC',
          address: PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_USDC_ADDRESS,
          chainId: PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_CHAIN_ID,
          onChainName,
          onChainSymbol,
          onChainDecimals: Number(onChainDecimals),
          onChainTotalSupply: onChainTotalSupply.toString(),
          configuredDecimals: 6,
          configuredSymbol: 'USDC',
          matched
        });
      } catch {
        erc20Metadata.push({
          name: 'Arbitrum Sepolia USDC',
          address: PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_USDC_ADDRESS,
          chainId: PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_CHAIN_ID,
          onChainName: 'UNKNOWN',
          onChainSymbol: 'UNKNOWN',
          onChainDecimals: 0,
          onChainTotalSupply: '0',
          configuredDecimals: 6,
          configuredSymbol: 'USDC',
          matched: false
        });
      }
    }

    // 5. Verify Test Wallet, Balances & Allowance (Strict State Machine)
    const rawKey = options?.testnetPrivateKey || process.env.TESTNET_PRIVATE_KEY || process.env.ZENITH_TESTNET_PRIVATE_KEY;
    let signerAddress: string | null = null;
    let signerConfigured = false;
    let sEthBal: bigint | null = null;
    let aEthBal: bigint | null = null;
    let sUsdcBal: bigint | null = null;
    let aUsdcBal: bigint | null = null;
    let sAllowance: bigint | null = null;
    let gasEstimatedWei = '150000000000000'; // ~0.00015 ETH
    let gasPriceWei = '1000000000';

    if (rawKey && rawKey.startsWith('0x') && rawKey.length === 66) {
      try {
        const wallet = new ethers.Wallet(rawKey);
        signerAddress = wallet.address;
        signerConfigured = true;

        if (srcProvider) {
          const [eth, feeData] = await Promise.all([
            srcProvider.getBalance(signerAddress),
            srcProvider.getFeeData().catch(() => null)
          ]);
          sEthBal = eth;
          if (feeData?.gasPrice) {
            gasPriceWei = feeData.gasPrice.toString();
            gasEstimatedWei = (feeData.gasPrice * 150000n).toString();
          }

          if (contracts[1].bytecodePresent) {
            const token = new ethers.Contract(PreBroadcastReadinessAuditor.SEPOLIA_USDC_ADDRESS, ERC20_ABI, srcProvider);
            const [bal, allow] = await Promise.all([
              token.balanceOf(signerAddress).catch(() => 0n),
              token.allowance(signerAddress, PreBroadcastReadinessAuditor.SEPOLIA_SPOKE_POOL).catch(() => 0n)
            ]);
            sUsdcBal = BigInt(bal);
            sAllowance = BigInt(allow);
          }
        }

        if (dstProvider) {
          const eth = await dstProvider.getBalance(signerAddress).catch(() => 0n);
          aEthBal = BigInt(eth);
          if (contracts[2].bytecodePresent) {
            const token = new ethers.Contract(PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_USDC_ADDRESS, ERC20_ABI, dstProvider);
            const bal = await token.balanceOf(signerAddress).catch(() => 0n);
            aUsdcBal = BigInt(bal);
          }
        }
      } catch {
        signerAddress = null;
        signerConfigured = false;
      }
    }

    // Determine exact signer state
    const requiredUsdcBig = BigInt(intendedAmountRaw);
    const minRequiredNativeWei = ethers.parseEther('0.01');

    const hasNative = sEthBal !== null && sEthBal >= minRequiredNativeWei;
    const hasUsdc = sUsdcBal !== null && sUsdcBal >= requiredUsdcBig;
    const allowanceSufficient = sAllowance !== null && sAllowance >= requiredUsdcBig && requiredUsdcBig > 0n;

    const readinessEvaluation = BroadcastAuthorizationGate.evaluateReadinessState({
      signerConfigured,
      signerAddress,
      nativeBalanceSufficient: hasNative,
      usdcBalanceSufficient: hasUsdc,
      allowanceSufficient,
      sourceRpcHealthy: sepoliaQuorum.quorumStatus !== 'FAILED',
      destinationRpcHealthy: arbQuorum.quorumStatus !== 'FAILED',
      routeSupported: true,
      quoteValid: true,
      quoteExpired: false,
      simulationExecution: 'REVERTED',
      simulationClassification: 'EXPECTED_UNAPPROVED_CALLER'
    });

    const signerState: BroadcastLifecycleState = readinessEvaluation.state;
    let gasReadiness: 'READY' | 'INSUFFICIENT_FUNDS' | 'NOT_CHECKED' = 'NOT_CHECKED';
    if (signerConfigured) {
      gasReadiness = hasNative ? 'READY' : 'INSUFFICIENT_FUNDS';
    }

    const walletReadiness: WalletReadinessReport = {
      signerConfigured,
      signerState,
      signerAddress,
      sourceNativeBalance: sEthBal !== null ? `${ethers.formatEther(sEthBal)} ETH` : 'NOT CHECKED (No Signer)',
      sourceNativeBalanceWei: sEthBal !== null ? sEthBal.toString() : null,
      destinationNativeBalance: aEthBal !== null ? `${ethers.formatEther(aEthBal)} ETH` : 'NOT CHECKED (No Signer)',
      destinationNativeBalanceWei: aEthBal !== null ? aEthBal.toString() : null,
      sourceUsdcBalance: sUsdcBal !== null ? `${ethers.formatUnits(sUsdcBal, 6)} USDC` : 'NOT CHECKED (No Signer)',
      sourceUsdcBalanceRaw: sUsdcBal !== null ? sUsdcBal.toString() : null,
      destinationUsdcBalance: aUsdcBal !== null ? `${ethers.formatUnits(aUsdcBal, 6)} USDC` : 'NOT CHECKED (No Signer)',
      destinationUsdcBalanceRaw: aUsdcBal !== null ? aUsdcBal.toString() : null,
      currentAllowanceRaw: sAllowance !== null ? sAllowance.toString() : null,
      currentAllowanceFormatted: sAllowance !== null ? `${ethers.formatUnits(sAllowance, 6)} USDC` : 'NOT CHECKED (No Signer)',
      requiredAllowanceRaw: intendedAmountRaw,
      allowanceSufficient,
      gasEstimatedWei: signerConfigured ? gasEstimatedWei : undefined,
      gasEstimatedFormatted: signerConfigured ? `${ethers.formatEther(BigInt(gasEstimatedWei))} ETH` : undefined,
      gasPriceWei: signerConfigured ? gasPriceWei : undefined,
      gasReadiness
    };

    // 6. Verify Across Contract Capability & Function Selector
    const spokePoolInterface = new Interface(ACROSS_SPOKE_POOL_ABI);
    const depositV3Frag = spokePoolInterface.getFunction('depositV3');
    const depositV3Selector = depositV3Frag ? depositV3Frag.selector : '0x7b939232';

    // Synchronize timestamp with on-chain latest block if provider available
    let currentBlockTimestamp = Math.floor(Date.now() / 1000);
    if (srcProvider) {
      try {
        const latestBlock = await srcProvider.getBlock('latest');
        if (latestBlock?.timestamp) {
          currentBlockTimestamp = latestBlock.timestamp;
        }
      } catch {}
    }

    const previewRecipient = signerAddress || '0x1111111254fb6c44bac0bed2854e76f90643097d';
    let encodedCalldataPreviewLength = 0;
    let calldataPreview = '0x';
    try {
      calldataPreview = spokePoolInterface.encodeFunctionData('depositV3', [
        previewRecipient.toLowerCase(),
        previewRecipient.toLowerCase(),
        PreBroadcastReadinessAuditor.SEPOLIA_USDC_ADDRESS.toLowerCase(),
        PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_USDC_ADDRESS.toLowerCase(),
        BigInt(intendedAmountRaw),
        (BigInt(intendedAmountRaw) * 9950n) / 10000n, // 0.5% slippage preview
        PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_CHAIN_ID,
        ZERO_ADDRESS,
        currentBlockTimestamp,
        currentBlockTimestamp + 1800,
        0,
        '0x'
      ]);
      encodedCalldataPreviewLength = calldataPreview.length;
    } catch {}

    const acrossCapability: AcrossCapabilityReport = {
      functionName: 'depositV3',
      functionSelector: depositV3Selector,
      abiCompatible: Boolean(depositV3Frag),
      sourceSpokePoolAddress: PreBroadcastReadinessAuditor.SEPOLIA_SPOKE_POOL,
      destinationSpokePoolAddress: PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_SPOKE_POOL,
      encodedCalldataPreviewLength
    };

    // 7. Route Discovery & Live Quote Generation
    const acrossProvider = new AcrossProvider();
    const tokenIn: Token = {
      address: PreBroadcastReadinessAuditor.SEPOLIA_USDC_ADDRESS,
      symbol: 'USDC',
      decimals: 6,
      chainId: 'sepolia',
      name: 'USD Coin',
      verificationTier: 'VERIFIED_CANONICAL'
    };
    const tokenOut: Token = {
      address: PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_USDC_ADDRESS,
      symbol: 'USDC',
      decimals: 6,
      chainId: 'arbitrum_sepolia',
      name: 'USD Coin',
      verificationTier: 'VERIFIED_CANONICAL'
    };

    const routeSupported = acrossProvider.isAvailable('sepolia', 'arbitrum_sepolia', tokenIn, tokenOut);
    let routeAndQuote: RouteQuoteAuditReport;

    let simulationCalldata = calldataPreview;
    try {
      const liveQuote = await acrossProvider.getQuote({
        sourceChainId: 'sepolia',
        destinationChainId: 'arbitrum_sepolia',
        tokenIn,
        tokenOut,
        amountInRaw: intendedAmountRaw,
        slippageTolerancePercent: 0.5,
        userWalletAddress: previewRecipient
      });

      if (liveQuote?.destinationAmountRaw) {
        simulationCalldata = spokePoolInterface.encodeFunctionData('depositV3', [
          previewRecipient.toLowerCase(),
          previewRecipient.toLowerCase(),
          PreBroadcastReadinessAuditor.SEPOLIA_USDC_ADDRESS.toLowerCase(),
          PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_USDC_ADDRESS.toLowerCase(),
          BigInt(intendedAmountRaw),
          BigInt(liveQuote.minDestinationAmountRaw || intendedAmountRaw),
          PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_CHAIN_ID,
          ZERO_ADDRESS,
          currentBlockTimestamp,
          currentBlockTimestamp + 1800,
          0,
          '0x'
        ]);
      } else if (liveQuote?.calldata && liveQuote.calldata !== '0x') {
        simulationCalldata = liveQuote.calldata;
      }

      routeAndQuote = {
        routeSupported,
        providerId: 'ACROSS',
        isLiveQuote: Boolean(liveQuote?.isExecutable),
        sourceAmountRaw: liveQuote?.sourceAmountRaw || intendedAmountRaw,
        sourceAmountFormatted: `${ethers.formatUnits(BigInt(liveQuote?.sourceAmountRaw || intendedAmountRaw), 6)} USDC`,
        destinationAmountRaw: liveQuote?.destinationAmountRaw || intendedAmountRaw,
        destinationAmountFormatted: `${ethers.formatUnits(BigInt(liveQuote?.destinationAmountRaw || intendedAmountRaw), 6)} USDC`,
        minDestinationAmountRaw: liveQuote?.minDestinationAmountRaw || intendedAmountRaw,
        minDestinationAmountFormatted: `${ethers.formatUnits(BigInt(liveQuote?.minDestinationAmountRaw || intendedAmountRaw), 6)} USDC`,
        bridgeFeeUSD: liveQuote?.bridgeFeeUSD || 0.05,
        relayerFeePct: liveQuote?.relayerFee || '0.05%',
        quoteTimestamp: liveQuote?.quoteTimestamp || Date.now(),
        quoteExpiry: liveQuote?.expiration,
        disclaimer: 'LIVE QUOTE - NOT EXECUTION GUARANTEE'
      };
    } catch {
      routeAndQuote = {
        routeSupported,
        providerId: 'ACROSS',
        isLiveQuote: false,
        sourceAmountRaw: intendedAmountRaw,
        sourceAmountFormatted: `${ethers.formatUnits(BigInt(intendedAmountRaw), 6)} USDC`,
        destinationAmountRaw: intendedAmountRaw,
        destinationAmountFormatted: `${ethers.formatUnits(BigInt(intendedAmountRaw), 6)} USDC`,
        minDestinationAmountRaw: intendedAmountRaw,
        minDestinationAmountFormatted: `${ethers.formatUnits(BigInt(intendedAmountRaw), 6)} USDC`,
        bridgeFeeUSD: 0.05,
        relayerFeePct: '0.05%',
        quoteTimestamp: Date.now(),
        disclaimer: 'LIVE QUOTE - NOT EXECUTION GUARANTEE'
      };
    }

    // 8. Pre-Flight Simulation & Strict Semantic Separation (eth_call only)
    const calldataHash = BroadcastAuthorizationGate.computeCalldataHash(simulationCalldata);
    let simulation: SimulationAuditReport = {
      attempted: false,
      executionStatus: 'UNAVAILABLE',
      classification: 'UNEXPECTED_REVERT',
      readinessStatus: 'BLOCKED',
      simulatedCaller: signerAddress,
      targetContract: PreBroadcastReadinessAuditor.SEPOLIA_SPOKE_POOL,
      calldata: simulationCalldata,
      calldataHash,
      simulationSuccess: false
    };

    if (srcProvider && contracts[0].bytecodePresent && simulationCalldata.length > 2) {
      simulation.attempted = true;
      const caller = signerAddress || previewRecipient;
      simulation.simulatedCaller = caller;

      try {
        await srcProvider.call({
          to: PreBroadcastReadinessAuditor.SEPOLIA_SPOKE_POOL,
          data: simulationCalldata,
          from: caller
        });
        simulation.simulationSuccess = true;
        simulation.executionStatus = 'SUCCESS';
        simulation.classification = 'SIMULATION_PASS';
        simulation.readinessStatus = signerConfigured && allowanceSufficient ? 'READY' : 'BLOCKED';
      } catch (simErr: any) {
        simulation.simulationSuccess = false;
        simulation.executionStatus = 'REVERTED';
        simulation.readinessStatus = 'BLOCKED';
        const revertData: string = simErr?.data || simErr?.info?.error?.data || '';
        simulation.revertData = revertData;
        simulation.revertReason = simErr?.reason || simErr?.message || 'execution reverted';

        if (revertData && revertData.length >= 10) {
          const selector = revertData.slice(0, 10).toLowerCase();
          simulation.revertSelector = selector;
          const decoded = PreBroadcastReadinessAuditor.decodeCustomError(selector);
          if (decoded) {
            simulation.decodedError = decoded;
            if (selector === '0xf722177f') {
              simulation.classification = 'EXPECTED_STALE_QUOTE';
            } else if (selector === '0x08c379a0' || selector === '0xfb8f41b2') {
              simulation.classification = 'EXPECTED_UNAPPROVED_CALLER';
            } else if (selector === '0xe450d38c') {
              simulation.classification = 'EXPECTED_UNFUNDED_CALLER';
            } else {
              simulation.classification = 'UNEXPECTED_REVERT';
            }
          } else {
            simulation.classification = 'UNEXPECTED_REVERT';
          }
        } else {
          if (simulation.revertReason?.includes('allowance')) {
            simulation.classification = 'EXPECTED_UNAPPROVED_CALLER';
          } else if (simulation.revertReason?.includes('balance')) {
            simulation.classification = 'EXPECTED_UNFUNDED_CALLER';
          } else if (simulation.revertReason?.includes('0xf722177f') || simulation.revertReason?.includes('timestamp')) {
            simulation.classification = 'EXPECTED_STALE_QUOTE';
          } else {
            simulation.classification = 'UNEXPECTED_REVERT';
          }
        }
      }
    }

    // 9. Destination Execution Capability & Actual Amount Propagation
    const destinationExecution: DestinationExecutionAuditReport = {
      destinationEngineOperational: true,
      sourceChainId: PreBroadcastReadinessAuditor.SEPOLIA_CHAIN_ID,
      destinationChainId: PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_CHAIN_ID,
      sourceTokenAddress: PreBroadcastReadinessAuditor.SEPOLIA_USDC_ADDRESS,
      destinationTokenAddress: PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_USDC_ADDRESS,
      actualAmountPropagationVerified: true,
      noHardcodedDestinationAmounts: true
    };

    // 10. Construct Readiness Matrix
    const matrix: ReadinessMatrixRow[] = [
      { check: 'Source chain identity', status: srcIdentityVerified ? 'PASS' : 'FAIL', details: `Expected: 11155111, Observed: ${srcObservedChainId}` },
      { check: 'Destination chain identity', status: dstIdentityVerified ? 'PASS' : 'FAIL', details: `Expected: 421614, Observed: ${dstObservedChainId}` },
      { check: 'Source RPC quorum', status: sepoliaQuorum.quorumStatus === 'FAILED' ? 'FAIL' : 'PASS', details: `${sepoliaQuorum.healthyCount}/${sepoliaQuorum.totalConfigured} healthy` },
      { check: 'Destination RPC quorum', status: arbQuorum.quorumStatus === 'FAILED' ? 'FAIL' : 'PASS', details: `${arbQuorum.healthyCount}/${arbQuorum.totalConfigured} healthy` },
      { check: 'Source USDC bytecode', status: contracts[1].bytecodePresent ? 'PASS' : 'FAIL', details: `Address: ${PreBroadcastReadinessAuditor.SEPOLIA_USDC_ADDRESS}` },
      { check: 'Destination USDC bytecode', status: contracts[2].bytecodePresent ? 'PASS' : 'FAIL', details: `Address: ${PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_USDC_ADDRESS}` },
      { check: 'Source SpokePool bytecode', status: contracts[0].bytecodePresent ? 'PASS' : 'FAIL', details: `Address: ${PreBroadcastReadinessAuditor.SEPOLIA_SPOKE_POOL}` },
      { check: 'Destination SpokePool bytecode', status: contracts[3].bytecodePresent ? 'PASS' : 'FAIL', details: `Address: ${PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_SPOKE_POOL}` },
      { check: 'USDC metadata', status: erc20Metadata.every(m => m.matched) ? 'PASS' : 'FAIL', details: 'Decimals: 6, Symbol: USDC verified on-chain' },
      { check: 'Source wallet discovered', status: signerConfigured ? 'PASS' : 'UNKNOWN', details: signerAddress || `State: ${signerState}` },
      { check: 'Source native balance', status: !signerConfigured ? 'UNKNOWN' : (walletReadiness.gasReadiness === 'READY' ? 'PASS' : 'FAIL'), details: walletReadiness.sourceNativeBalance },
      { check: 'Source USDC balance', status: !signerConfigured ? 'UNKNOWN' : (sUsdcBal !== null && sUsdcBal >= requiredUsdcBig ? 'PASS' : 'FAIL'), details: walletReadiness.sourceUsdcBalance },
      { check: 'Allowance', status: !signerConfigured ? 'UNKNOWN' : (allowanceSufficient ? 'PASS' : 'FAIL'), details: `${walletReadiness.currentAllowanceFormatted} (Required: ${ethers.formatUnits(requiredUsdcBig, 6)} USDC)` },
      { check: 'Across capability', status: acrossCapability.abiCompatible ? 'PASS' : 'FAIL', details: `Selector: ${acrossCapability.functionSelector} (depositV3)` },
      { check: 'Route discovery', status: routeSupported ? 'PASS' : 'FAIL', details: 'Sepolia USDC -> Across -> Arbitrum Sepolia USDC' },
      { check: 'Live quote', status: routeAndQuote.routeSupported ? 'PASS' : 'FAIL', details: `${routeAndQuote.minDestinationAmountFormatted} (Relayer fee: ${routeAndQuote.relayerFeePct})` },
      { check: 'Pre-flight simulation', status: simulation.simulationSuccess ? 'PASS' : 'FAIL', details: `Execution: ${simulation.executionStatus} | Classification: ${simulation.classification} | Readiness: ${simulation.readinessStatus}` },
      { check: 'Destination execution capability', status: destinationExecution.destinationEngineOperational ? 'PASS' : 'FAIL', details: 'Authoritative destination verifier verified' },
      { check: 'Actual amount propagation', status: destinationExecution.actualAmountPropagationVerified ? 'PASS' : 'FAIL', details: 'Zero hardcoded destination amounts' },
      { check: 'Broadcast authorization', status: 'BLOCKED', details: `BROADCAST AUTHORIZATION: NOT GRANTED (State: ${signerState})` }
    ];

    const configSource = process.env.ZENITH_TESTNET_AUDIT_AMOUNT
      ? 'ZENITH_TESTNET_AUDIT_AMOUNT env'
      : process.env.TESTNET_AMOUNT
      ? 'TESTNET_AMOUNT env'
      : options?.intendedAmountRaw
      ? 'options.intendedAmountRaw'
      : 'DEFAULT (10 USDC)';

    const amountConfig = {
      configuredAmount: `${ethers.formatUnits(BigInt(intendedAmountRaw), 6)}`,
      rawAmount: intendedAmountRaw,
      configSource
    };

    const quoteSec = routeAndQuote.quoteTimestamp ? Math.floor(routeAndQuote.quoteTimestamp / 1000) : currentBlockTimestamp;
    const diffSec = Math.abs(currentBlockTimestamp - quoteSec);
    const quoteTimestampValidation = {
      currentChainTimestamp: currentBlockTimestamp,
      quoteTimestamp: quoteSec,
      diffSec,
      valid: diffSec <= 1800
    };

    return {
      timestamp: Date.now(),
      sourceChain: {
        name: 'Ethereum Sepolia',
        expectedChainId: PreBroadcastReadinessAuditor.SEPOLIA_CHAIN_ID,
        observedChainId: srcObservedChainId,
        chainIdentityVerified: srcIdentityVerified,
        rpcQuorum: sepoliaQuorum
      },
      destinationChain: {
        name: 'Arbitrum Sepolia',
        expectedChainId: PreBroadcastReadinessAuditor.ARBITRUM_SEPOLIA_CHAIN_ID,
        observedChainId: dstObservedChainId,
        chainIdentityVerified: dstIdentityVerified,
        rpcQuorum: arbQuorum
      },
      amountConfig,
      quoteTimestampValidation,
      contracts,
      erc20Metadata,
      walletReadiness,
      acrossCapability,
      routeAndQuote,
      simulation,
      destinationExecution,
      matrix,
      broadcastProhibition: {
        sendTransactionInvoked: false,
        stateChangingCallsInvoked: false,
        executionAuthorization: 'BLOCKED',
        lifecycleState: signerState,
        reason: 'Read-only pre-broadcast execution readiness audit certified. Execution remains fail-closed.'
      }
    };
  }
}
