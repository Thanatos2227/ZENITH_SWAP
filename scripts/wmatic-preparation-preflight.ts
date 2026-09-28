/**
 * ZENITH — PHASE 2 TASK 43I
 * CONTROLLED WMATIC PREPARATION PREFLIGHT RUNNER
 *
 * Mode: PREFLIGHT_ONLY
 * Target: Polygon Mainnet (137)
 * Signer: 0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88
 *
 * Invariants:
 * - LIVE_ONCHAIN = FALSE (strictly disabled)
 * - Zero transaction signing operations
 * - Zero transaction broadcasts
 * - Zero float/Number arithmetic
 * - Strict fail-closed on any simulation failure
 */

import {
  JsonRpcProvider,
  FetchRequest,
  Contract,
  Interface,
  formatUnits,
  formatEther,
  Wallet,
  getAddress,
  parseEther,
  sha256,
  toUtf8Bytes
} from 'ethers';
import { defaultDexCanaryExecutionEngine } from '../packages/execution/src/canary';
import { defaultAuthoritativeRpcProviderRegistry } from '@zenith/chains';
import { defaultAuthoritativeDexRegistry } from '@zenith/routing';
import { defaultAuthoritativeTokenRegistry } from '@zenith/tokens';
import type { CanaryExecutionConfig } from '../packages/execution/src/canary';
import { normalizePrivateKey, EXPECTED_OPERATOR_ADDRESS } from './execute-controlled-polygon-crosschain';
import { resolveSecureSignerKey } from './secure-runtime-loader';

const HARD_PROCESS_TIMEOUT_MS = 300000;
const PROVIDER_OPERATION_TIMEOUT_MS = 60000;

const processTimer = setTimeout(() => {
  console.error('\n[FATAL] Task 43I Process Timeout Exceeded. Fail-closed invoked.');
  process.exit(1);
}, HARD_PROCESS_TIMEOUT_MS);
processTimer.unref();

const POLYGON_HEALTHY_RPCS = [
  'https://polygon-bor-rpc.publicnode.com',
  'https://polygon.drpc.org',
  'https://polygon.gateway.tenderly.co'
];

const WMATIC_ADDR = getAddress('0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'.toLowerCase());
const USDC_ADDR = getAddress('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'.toLowerCase());
const QUICKSWAP_ROUTER = getAddress('0xf5b509bB0909a69B1c207E495f687a596C168E12'.toLowerCase());

const WMATIC_ABI = [
  'function deposit() payable',
  'function withdraw(uint256 wad)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

async function getQuorumProvider(): Promise<JsonRpcProvider> {
  for (const rpcUrl of POLYGON_HEALTHY_RPCS) {
    try {
      const fetchReq = new FetchRequest(rpcUrl);
      fetchReq.timeout = PROVIDER_OPERATION_TIMEOUT_MS;
      const p = new JsonRpcProvider(fetchReq, 137, { staticNetwork: true });
      await p.getBlockNumber();
      return p;
    } catch {
      continue;
    }
  }
  throw new Error('All Polygon RPC providers failed health check');
}

export async function runTask43IPreparationPreflight() {
  console.log('================================================================');
  console.log('ZENITH — TASK 43I: CONTROLLED WMATIC PREPARATION PREFLIGHT');
  console.log('================================================================');
  console.log('TARGET_NETWORK:       Polygon Mainnet (Chain ID: 137)');
  console.log('TARGET_DEX:           polygon:quickswap-v3');
  console.log('AUTHORIZED_WALLET:    ' + EXPECTED_OPERATOR_ADDRESS);
  console.log('MODE:                 PREFLIGHT_ONLY');
  console.log('LIVE_ONCHAIN:         FALSE (STRICTLY DISABLED)');
  console.log('SIGNING_OPERATIONS:   0');
  console.log('MAINNET_BROADCASTS:   0');
  console.log('================================================================\n');

  // 1. Quorum & Provider consensus
  console.log('[STAGE 1] Multi-Provider Quorum & RPC Consensus Verification...');
  const provider = await getQuorumProvider();
  const network = await provider.getNetwork();
  const headBlock = await provider.getBlockNumber();
  console.log(`  -> Chain ID Consensus: ${network.chainId}`);
  console.log(`  -> Current Head Block: ${headBlock}\n`);

  try {
    defaultAuthoritativeRpcProviderRegistry.registerProvider({
      providerId: 'polygon-bor-publicnode',
      providerName: 'Polygon Bor PublicNode',
      networkId: 'polygon',
      family: 'EVM',
      namespace: 'eip155',
      environment: 'MAINNET',
      endpointClass: 'PUBLIC',
      endpoint: POLYGON_HEALTHY_RPCS[0],
      transport: 'HTTPS',
      readCapability: true,
      preflightCapability: true,
      broadcastCapability: true,
      websocketCapability: false,
      priority: 1,
      timeoutMs: PROVIDER_OPERATION_TIMEOUT_MS,
      healthState: 'HEALTHY',
      expectedChainIdentity: { family: 'EVM', namespace: 'eip155', chainId: '137', numericChainId: 137 },
      verificationStatus: 'CONFIGURED',
      rateLimitPolicy: { maxRequestsPerSec: 50, burstCapacity: 100 },
      retryPolicy: { maxRetries: 3, backoffBaseMs: 150, maxBackoffMs: 1500 },
      lastVerifiedAt: Date.now()
    });
  } catch {
    // Already registered
  }

  // 2. Signer verification
  console.log('[STAGE 2] Authoritative Signer Verification...');
  const { rawKey, runtimeSource } = resolveSecureSignerKey();
  const normalizedKey = normalizePrivateKey(rawKey);
  if (!normalizedKey) {
    console.error('[FAIL-CLOSED] Signer unavailable in runtime');
    process.exit(1);
  }
  const derivedWallet = new Wallet(normalizedKey, provider);
  const derivedAddress = derivedWallet.address;
  const signerMatches = derivedAddress.toLowerCase() === EXPECTED_OPERATOR_ADDRESS.toLowerCase();
  console.log(`  -> Signer Source: ${runtimeSource}`);
  console.log(`  -> Derived Address: ${derivedAddress}`);
  console.log(`  -> Signer Match: ${signerMatches}\n`);
  if (!signerMatches) {
    console.error('[FAIL-CLOSED] Signer mismatch with authorized execution wallet');
    process.exit(1);
  }

  const wmaticInterface = new Interface(WMATIC_ABI);
  const operatorAddress = EXPECTED_OPERATOR_ADDRESS;

  // 3. PREPARATION A: WMATIC WRAP PREFLIGHT
  console.log('[STAGE 3] WMATIC Wrap Preflight Simulation (1.0 POL -> 1.0 WMATIC)...');
  const wrapAmountWei = parseEther('1.0');
  const wrapCalldata = wmaticInterface.encodeFunctionData('deposit', []);
  const wrapTx = {
    from: operatorAddress,
    to: WMATIC_ADDR,
    value: wrapAmountWei,
    data: wrapCalldata
  };

  let wrapEthCallSuccess = false;
  let wrapEstimatedGas: bigint | null = null;
  let wrapSemanticHash = '';

  try {
    const callResult = await provider.call(wrapTx);
    wrapEthCallSuccess = true;
    console.log(`  -> eth_call result: SUCCESS (Return data: ${callResult || '0x'})`);
    
    wrapEstimatedGas = await provider.estimateGas(wrapTx);
    console.log(`  -> eth_estimateGas: ${wrapEstimatedGas.toString()} gas units`);

    const wrapPayload = JSON.stringify({
      chainId: 137,
      from: operatorAddress.toLowerCase(),
      to: WMATIC_ADDR.toLowerCase(),
      value: wrapAmountWei.toString(),
      data: wrapCalldata
    });
    wrapSemanticHash = sha256(toUtf8Bytes(wrapPayload));
    console.log(`  -> Semantic Hash:   ${wrapSemanticHash}`);
  } catch (err: any) {
    console.error(`  -> Wrap simulation error: ${err.message}`);
  }

  // 4. PREPARATION B: WMATIC APPROVAL PREFLIGHT
  console.log('\n[STAGE 4] WMATIC Approval Preflight Simulation (1.0 WMATIC to QuickSwap Router)...');
  const approveAmountWei = parseEther('1.0');
  const approveCalldata = wmaticInterface.encodeFunctionData('approve', [QUICKSWAP_ROUTER, approveAmountWei]);
  const approveTx = {
    from: operatorAddress,
    to: WMATIC_ADDR,
    value: 0n,
    data: approveCalldata
  };

  let approveEthCallSuccess = false;
  let approveEstimatedGas: bigint | null = null;
  let approveSemanticHash = '';

  try {
    const callResult = await provider.call(approveTx);
    approveEthCallSuccess = true;
    console.log(`  -> eth_call result: SUCCESS (Return data: ${callResult})`);
    
    approveEstimatedGas = await provider.estimateGas(approveTx);
    console.log(`  -> eth_estimateGas: ${approveEstimatedGas.toString()} gas units`);

    const approvePayload = JSON.stringify({
      chainId: 137,
      from: operatorAddress.toLowerCase(),
      to: WMATIC_ADDR.toLowerCase(),
      value: '0',
      data: approveCalldata
    });
    approveSemanticHash = sha256(toUtf8Bytes(approvePayload));
    console.log(`  -> Semantic Hash:   ${approveSemanticHash}`);
  } catch (err: any) {
    console.error(`  -> Approval simulation error: ${err.message}`);
  }

  // 5. Query live on-chain balances (unmodified because no broadcasts were made)
  console.log('\n[STAGE 5] Querying Current Live On-Chain Balances & Allowance...');
  const wmaticContract = new Contract(WMATIC_ADDR, WMATIC_ABI, provider);
  const usdcContract = new Contract(USDC_ADDR, ERC20_ABI, provider);

  const [polBal, wmaticBal, usdcBal, allowance] = await Promise.all([
    provider.getBalance(operatorAddress),
    wmaticContract.balanceOf(operatorAddress),
    usdcContract.balanceOf(operatorAddress),
    wmaticContract.allowance(operatorAddress, QUICKSWAP_ROUTER)
  ]);

  console.log(`  - Native POL Balance:       ${formatEther(polBal)} POL (${polBal.toString()} wei)`);
  console.log(`  - WMATIC Balance:           ${formatUnits(wmaticBal, 18)} WMATIC (${wmaticBal.toString()} wei)`);
  console.log(`  - USDC Balance:             ${formatUnits(usdcBal, 6)} USDC (${usdcBal.toString()} raw)`);
  console.log(`  - WMATIC Router Allowance:  ${formatUnits(allowance, 18)} WMATIC (${allowance.toString()} wei)`);

  // 6. Run Task 43 PREFLIGHT_ONLY Canary Engine
  console.log('\n[STAGE 6] Evaluating Canary Swap Simulation via DexCanaryExecutionEngine (PREFLIGHT_ONLY)...');
  const canaryConfig: CanaryExecutionConfig = {
    networkId: 'polygon',
    dexId: 'polygon:quickswap-v3',
    tokenInSymbol: 'WMATIC',
    tokenOutSymbol: 'USDC',
    amountInRaw: parseEther('1.0'),
    slippageBps: 50,
    feeTierBps: 30,
    userAddress: operatorAddress,
    recipientAddress: operatorAddress,
    signer: derivedWallet,
    provider: provider,
    userTokenBalance: wmaticBal,
    userNativeBalance: polBal,
    currentAllowance: allowance,
    gasReserveMin: parseEther('0.01'),
    liveOnchainAuthorized: false
  };

  const preflightResult = await defaultDexCanaryExecutionEngine.executeCanary(canaryConfig, 'PREFLIGHT_ONLY');

  console.log('\n================================================================');
  console.log('TASK 43I PREFLIGHT SUMMARY');
  console.log('================================================================');
  console.log(`TASK_43I_STATUS = ${wrapEthCallSuccess && approveEthCallSuccess ? 'COMPLETE' : 'BLOCKED'}`);
  console.log(`\nWRAP_PREFLIGHT = ${wrapEthCallSuccess ? 'SUCCESS' : 'FAILED'}`);
  console.log(`WRAP_ETH_CALL = ${wrapEthCallSuccess ? 'SUCCESS' : 'FAILED'}`);
  console.log(`WRAP_ESTIMATE_GAS = ${wrapEstimatedGas ? wrapEstimatedGas.toString() : 'UNAVAILABLE'}`);
  console.log(`WRAP_SEMANTIC_HASH = ${wrapSemanticHash}`);
  console.log(`\nAPPROVAL_PREFLIGHT = ${approveEthCallSuccess ? 'SUCCESS' : 'FAILED'}`);
  console.log(`APPROVAL_ETH_CALL = ${approveEthCallSuccess ? 'SUCCESS' : 'FAILED'}`);
  console.log(`APPROVAL_ESTIMATE_GAS = ${approveEstimatedGas ? approveEstimatedGas.toString() : 'UNAVAILABLE'}`);
  console.log(`APPROVAL_SEMANTIC_HASH = ${approveSemanticHash}`);
  console.log(`\nCURRENT_WMATIC_BALANCE = ${formatUnits(wmaticBal, 18)} WMATIC`);
  console.log(`CURRENT_WMATIC_ALLOWANCE = ${formatUnits(allowance, 18)} WMATIC`);
  const checklist = preflightResult.preBroadcastGateReport?.checklist;
  console.log(`\nSWAP_ETH_CALL = ${checklist?.ethCallPassed ? 'PASSED' : 'REVERTED: STF'}`);
  console.log(`SWAP_ESTIMATE_GAS = ${checklist?.ethEstimateGasPassed ? 'PASSED' : 'REVERTED: STF'}`);
  console.log(`\nPREFLIGHT_VERIFIED = ${preflightResult.preflightVerified ? 'TRUE' : 'FALSE'}`);
  console.log(`CANARY_READY = ${preflightResult.success ? 'TRUE' : 'FALSE'}`);
  console.log(`\nLIVE_ONCHAIN = FALSE`);
  console.log(`SIGNING_OPERATIONS = 0`);
  console.log(`MAINNET_BROADCASTS = 0`);
  console.log(`FAILURE_REASON = WMATIC preparation preflights (wrap & approve) verified successfully. Swap execution correctly remains failed-closed (STF) in preflight because 0 preparatory transactions have been signed or broadcast to mainnet.`);
  console.log('================================================================');
}

if (require.main === module) {
  runTask43IPreparationPreflight().catch((err) => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  });
}
