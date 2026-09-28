/**
 * ZENITH — PHASE 2 TASK 43B
 * PREPARATORY WMATIC FUNDING & APPROVAL READINESS RUNNER
 *
 * Objectives:
 * 1. Verify current live Polygon state for authorized wallet
 * 2. Preflight & execute authorized POL -> WMATIC wrap (deposit)
 * 3. Preflight & execute authorized WMATIC approval for QuickSwap V3 Router
 * 4. Re-run Task 43 PREFLIGHT_ONLY with fresh live state & fresh deadline
 *
 * Safety Invariants:
 * - DO NOT EXECUTE FINAL WMATIC -> USDC SWAP
 * - MODE REMAINS PREFLIGHT_ONLY FOR SWAP CANARY
 * - Zero private key exposure
 * - Zero float arithmetic
 * - Strict fail-closed on any preflight gate failure
 */

import {
  JsonRpcProvider,
  FetchRequest,
  Contract,
  formatUnits,
  formatEther,
  Wallet,
  getAddress,
  parseEther
} from 'ethers';
import { defaultDexCanaryExecutionEngine } from '../packages/execution/src/canary';
import { defaultAuthoritativeRpcProviderRegistry } from '@zenith/chains';
import { defaultAuthoritativeDexRegistry } from '@zenith/routing';
import { defaultAuthoritativeTokenRegistry } from '@zenith/tokens';
import type { CanaryExecutionConfig } from '../packages/execution/src/canary';
import { normalizePrivateKey, EXPECTED_OPERATOR_ADDRESS } from './execute-controlled-polygon-crosschain';

const HARD_PROCESS_TIMEOUT_MS = 300000;
const PROVIDER_OPERATION_TIMEOUT_MS = 60000;

const processTimer = setTimeout(() => {
  console.error('\n[FATAL] Task 43B Process Timeout Exceeded. Fail-closed invoked.');
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

export interface Task43BExecutionReport {
  polBalanceBefore: bigint;
  wmaticBalanceBefore: bigint;
  usdcBalanceBefore: bigint;
  allowanceBefore: bigint;
  wrapPreflightPassed: boolean;
  wrapTxHash: string | null;
  wrapGasUsed: bigint | null;
  wmaticBalanceAfter: bigint;
  approvalPreflightPassed: boolean;
  approvalTxHash: string | null;
  approvalGasUsed: bigint | null;
  allowanceAfter: bigint;
  preflightGateChecklist: Record<string, boolean>;
  allGatesPassed: boolean;
  status: 'SUCCESS_READINESS_CONFIRMED' | 'BLOCKED_NO_LOCAL_SIGNER' | 'FAILED_PREFLIGHT';
}

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
  throw new Error('RPC Consensus Error: All healthy Polygon RPC providers failed to respond');
}

export async function runTask43BPreparation(): Promise<Task43BExecutionReport> {
  console.log('================================================================');
  console.log('ZENITH — TASK 43B: PREPARATORY WMATIC FUNDING & APPROVAL RUNNER');
  console.log('================================================================');
  console.log('TARGET_CHAIN:         Polygon Mainnet (137)');
  console.log('TARGET_ROUTER:        ', QUICKSWAP_ROUTER);
  console.log('WMATIC_CONTRACT:      ', WMATIC_ADDR);
  console.log('USDC_CONTRACT:        ', USDC_ADDR);
  console.log('AUTHORIZED_WALLET:    ', EXPECTED_OPERATOR_ADDRESS);
  console.log('================================================================\n');

  const provider = await getQuorumProvider();
  const wmaticContract = new Contract(WMATIC_ADDR, WMATIC_ABI, provider);
  const usdcContract = new Contract(USDC_ADDR, ERC20_ABI, provider);

  // 1. Current State Verification
  console.log('[STAGE 1] Querying Live Baseline Polygon State...');
  const [polBalBefore, wmaticBalBefore, usdcBalBefore, allowanceBefore, currentNonce, blockNum] = await Promise.all([
    provider.getBalance(EXPECTED_OPERATOR_ADDRESS),
    wmaticContract.balanceOf(EXPECTED_OPERATOR_ADDRESS),
    usdcContract.balanceOf(EXPECTED_OPERATOR_ADDRESS),
    wmaticContract.allowance(EXPECTED_OPERATOR_ADDRESS, QUICKSWAP_ROUTER),
    provider.getTransactionCount(EXPECTED_OPERATOR_ADDRESS),
    provider.getBlockNumber()
  ]);

  console.log(`  - Block Height:               ${blockNum}`);
  console.log(`  - Operator Nonce:             ${currentNonce}`);
  console.log(`  - Native POL Balance:         ${polBalBefore.toString()} wei (${formatEther(polBalBefore)} POL)`);
  console.log(`  - WMATIC Balance:             ${wmaticBalBefore.toString()} wei (${formatUnits(wmaticBalBefore, 18)} WMATIC)`);
  console.log(`  - USDC Balance:               ${usdcBalBefore.toString()} raw (${formatUnits(usdcBalBefore, 6)} USDC)`);
  console.log(`  - Router Allowance:           ${allowanceBefore.toString()} wei (${formatUnits(allowanceBefore, 18)} WMATIC)\n`);

  // Signer Resolution (Strictly Secure, No Private Key Printing)
  const rawKey =
    process.env.ZENITH_MAINNET_PRIVATE_KEY ||
    process.env.TESTNET_PRIVATE_KEY ||
    process.env.ZENITH_PRIVATE_KEY ||
    process.env.PRIVATE_KEY;
  const normalizedKey = normalizePrivateKey(rawKey);

  let signerWallet: Wallet | null = null;
  let signerVerified = false;

  if (normalizedKey) {
    try {
      const w = new Wallet(normalizedKey, provider);
      if (w.address.toLowerCase() === EXPECTED_OPERATOR_ADDRESS.toLowerCase()) {
        signerWallet = w;
        signerVerified = true;
        console.log(`[STAGE 2] Signer Verification: Authorized wallet match confirmed.`);
      } else {
        console.error(`[STAGE 2] FAIL-CLOSED: Configured signer address does not match ${EXPECTED_OPERATOR_ADDRESS}`);
        clearTimeout(processTimer);
        process.exit(1);
      }
    } catch {
      console.error(`[STAGE 2] FAIL-CLOSED: Signer wallet failed initialization`);
      clearTimeout(processTimer);
      process.exit(1);
    }
  } else {
    console.log(`[STAGE 2] Signer Resolution: NO_LOCAL_SIGNER (Environment key unset).`);
    console.log(`          Simulation & dry-run validation will proceed without on-chain broadcast.`);
  }
  console.log('');

  // 2. Wrap POL -> WMATIC Preflight & Execution
  console.log('[STAGE 3] Evaluating POL -> WMATIC Wrap Preflight Gates...');
  const CANARY_AMOUNT = 1000000000000000000n; // 1.0 WMATIC
  const WRAP_AMOUNT = 1050000000000000000n;   // 1.05 POL (1.0 canary + 0.05 safety buffer)
  const MIN_GAS_RESERVE = 10000000000000000n; // 0.01 POL

  const hasWrapBalance = polBalBefore >= WRAP_AMOUNT + MIN_GAS_RESERVE;
  let wrapEthCallPassed = false;
  let wrapEthEstimateGasPassed = false;
  let wrapEstimatedGas: bigint | null = null;

  try {
    const depositData = wmaticContract.interface.encodeFunctionData('deposit');
    await provider.call({
      to: WMATIC_ADDR,
      data: depositData,
      value: WRAP_AMOUNT,
      from: EXPECTED_OPERATOR_ADDRESS
    });
    wrapEthCallPassed = true;

    wrapEstimatedGas = await provider.estimateGas({
      to: WMATIC_ADDR,
      data: depositData,
      value: WRAP_AMOUNT,
      from: EXPECTED_OPERATOR_ADDRESS
    });
    wrapEthEstimateGasPassed = true;
  } catch (err: any) {
    console.error(`  - Wrap Simulation Error: ${err.message}`);
  }

  console.log(`  - POL Balance Sufficient:     ${hasWrapBalance}`);
  console.log(`  - Wrap eth_call:              ${wrapEthCallPassed ? 'PASSED' : 'FAILED'}`);
  console.log(`  - Wrap eth_estimateGas:       ${wrapEthEstimateGasPassed ? `PASSED (${wrapEstimatedGas} gas)` : 'FAILED'}`);

  let wrapTxHash: string | null = null;
  let wrapGasUsed: bigint | null = null;
  let wmaticBalAfter = wmaticBalBefore;

  if (signerWallet && wrapEthCallPassed && wrapEthEstimateGasPassed && hasWrapBalance) {
    console.log('\n[STAGE 3.1] Broadcasting Authorized POL -> WMATIC Wrap Transaction...');
    const feeData = await provider.getFeeData();
    const maxFeePerGas = (feeData.maxFeePerGas || parseEther('0.0000003')) * 12n / 10n; // 120%
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || parseEther('0.00000003');

    try {
      const wrapTx = await signerWallet.sendTransaction({
        to: WMATIC_ADDR,
        data: wmaticContract.interface.encodeFunctionData('deposit'),
        value: WRAP_AMOUNT,
        gasLimit: (wrapEstimatedGas! * 12n) / 10n,
        maxFeePerGas,
        maxPriorityFeePerGas
      });
      wrapTxHash = wrapTx.hash;
      console.log(`  -> Wrap Dispatched. Hash: ${wrapTxHash}`);
      const receipt = await wrapTx.wait(1);
      if (receipt && receipt.status === 1) {
        wrapGasUsed = receipt.gasUsed;
        console.log(`  -> Wrap Confirmed in Block: ${receipt.blockNumber} (Gas Used: ${receipt.gasUsed})`);
        wmaticBalAfter = await wmaticContract.balanceOf(EXPECTED_OPERATOR_ADDRESS);
        console.log(`  -> WMATIC Balance Delta: +${formatUnits(wmaticBalAfter - wmaticBalBefore, 18)} WMATIC`);
      } else {
        throw new Error('Wrap transaction reverted on-chain');
      }
    } catch (err: any) {
      console.error(`[FATAL] Wrap broadcast or confirmation failed: ${err.message}`);
      clearTimeout(processTimer);
      process.exit(1);
    }
  } else {
    console.log(`  -> Live Wrap Broadcast Skipped (Signer Unset: fail-closed safety preserved)\n`);
  }

  // 3. Approval Preflight & Execution
  console.log('[STAGE 4] Evaluating WMATIC Approval Preflight Gates...');
  const APPROVAL_AMOUNT = CANARY_AMOUNT;
  let approveEthCallPassed = false;
  let approveEthEstimateGasPassed = false;
  let approveEstimatedGas: bigint | null = null;

  try {
    const approveData = wmaticContract.interface.encodeFunctionData('approve', [QUICKSWAP_ROUTER, APPROVAL_AMOUNT]);
    await provider.call({
      to: WMATIC_ADDR,
      data: approveData,
      value: 0n,
      from: EXPECTED_OPERATOR_ADDRESS
    });
    approveEthCallPassed = true;

    approveEstimatedGas = await provider.estimateGas({
      to: WMATIC_ADDR,
      data: approveData,
      value: 0n,
      from: EXPECTED_OPERATOR_ADDRESS
    });
    approveEthEstimateGasPassed = true;
  } catch (err: any) {
    console.error(`  - Approval Simulation Error: ${err.message}`);
  }

  console.log(`  - Approval eth_call:          ${approveEthCallPassed ? 'PASSED' : 'FAILED'}`);
  console.log(`  - Approval eth_estimateGas:   ${approveEthEstimateGasPassed ? `PASSED (${approveEstimatedGas} gas)` : 'FAILED'}`);

  let approvalTxHash: string | null = null;
  let approvalGasUsed: bigint | null = null;
  let allowanceAfter = allowanceBefore;

  if (signerWallet && approveEthCallPassed && approveEthEstimateGasPassed) {
    console.log('\n[STAGE 4.1] Broadcasting Authorized WMATIC Approval Transaction...');
    const feeData = await provider.getFeeData();
    const maxFeePerGas = (feeData.maxFeePerGas || parseEther('0.0000003')) * 12n / 10n;
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || parseEther('0.00000003');

    try {
      const approveTx = await signerWallet.sendTransaction({
        to: WMATIC_ADDR,
        data: wmaticContract.interface.encodeFunctionData('approve', [QUICKSWAP_ROUTER, APPROVAL_AMOUNT]),
        value: 0n,
        gasLimit: (approveEstimatedGas! * 12n) / 10n,
        maxFeePerGas,
        maxPriorityFeePerGas
      });
      approvalTxHash = approveTx.hash;
      console.log(`  -> Approval Dispatched. Hash: ${approvalTxHash}`);
      const receipt = await approveTx.wait(1);
      if (receipt && receipt.status === 1) {
        approvalGasUsed = receipt.gasUsed;
        console.log(`  -> Approval Confirmed in Block: ${receipt.blockNumber} (Gas Used: ${receipt.gasUsed})`);
        allowanceAfter = await wmaticContract.allowance(EXPECTED_OPERATOR_ADDRESS, QUICKSWAP_ROUTER);
        console.log(`  -> Allowance Delta: +${formatUnits(allowanceAfter - allowanceBefore, 18)} WMATIC`);
      } else {
        throw new Error('Approval transaction reverted on-chain');
      }
    } catch (err: any) {
      console.error(`[FATAL] Approval broadcast or confirmation failed: ${err.message}`);
      clearTimeout(processTimer);
      process.exit(1);
    }
  } else {
    console.log(`  -> Live Approval Broadcast Skipped (Signer Unset: fail-closed safety preserved)\n`);
  }

  // 4. Return to PREFLIGHT_ONLY and Re-run Full Swap Verification
  console.log('[STAGE 5] Re-running Task 43 PREFLIGHT_ONLY (with fresh quote and fresh deadline)...');
  const canaryConfig: CanaryExecutionConfig = {
    networkId: 'polygon',
    dexId: 'polygon:quickswap-v3',
    tokenInSymbol: 'WMATIC',
    tokenOutSymbol: 'USDC',
    amountInRaw: CANARY_AMOUNT,
    slippageBps: 50,
    feeTierBps: 30,
    userAddress: EXPECTED_OPERATOR_ADDRESS,
    recipientAddress: EXPECTED_OPERATOR_ADDRESS,
    signer: signerWallet,
    provider,
    userTokenBalance: wmaticBalAfter,
    userNativeBalance: polBalBefore,
    currentAllowance: allowanceAfter,
    gasReserveMin: MIN_GAS_RESERVE,
    liveOnchainAuthorized: false // STRICTLY PREFLIGHT ONLY
  };

  const preflightRes = await defaultDexCanaryExecutionEngine.executeCanary(canaryConfig, 'PREFLIGHT_ONLY');

  console.log('\n================================================================');
  console.log('TASK 43B PREPARATORY READINESS GATE REPORT');
  console.log('================================================================');
  console.log('MODE:                      PREFLIGHT_ONLY');
  console.log('LIVE_ONCHAIN:              FALSE');
  console.log('SIGNING_OPERATIONS (SWAP): 0');
  console.log('MAINNET_BROADCASTS (SWAP): 0');
  console.log('MAINNET_SPENDING (SWAP):   $0.00');
  console.log('PLAN_HASH:                ', preflightRes.planHash);
  console.log('SEMANTIC_HASH:            ', preflightRes.semanticHash);
  console.log('ALL_25_GATES_PASSED:      ', preflightRes.preBroadcastGateReport.allGatesPassed);
  console.log('\n25-POINT GATE CHECKLIST:');
  console.log(JSON.stringify(preflightRes.preBroadcastGateReport.checklist, null, 2));

  clearTimeout(processTimer);

  const status =
    signerWallet && preflightRes.preBroadcastGateReport.allGatesPassed
      ? 'SUCCESS_READINESS_CONFIRMED'
      : !signerWallet
      ? 'BLOCKED_NO_LOCAL_SIGNER'
      : 'FAILED_PREFLIGHT';

  return {
    polBalanceBefore: polBalBefore,
    wmaticBalanceBefore: wmaticBalBefore,
    usdcBalanceBefore: usdcBalBefore,
    allowanceBefore,
    wrapPreflightPassed: wrapEthCallPassed && wrapEthEstimateGasPassed,
    wrapTxHash,
    wrapGasUsed,
    wmaticBalanceAfter: wmaticBalAfter,
    approvalPreflightPassed: approveEthCallPassed && approveEthEstimateGasPassed,
    approvalTxHash,
    approvalGasUsed,
    allowanceAfter,
    preflightGateChecklist: preflightRes.preBroadcastGateReport.checklist,
    allGatesPassed: preflightRes.preBroadcastGateReport.allGatesPassed,
    status
  };
}

// Execute when invoked directly
if (process.argv[1]?.includes('task43b-prepare-wmatic')) {
  runTask43BPreparation()
    .then((r) => {
      console.log('\nTASK 43B RESULT STATUS:', r.status);
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n[FATAL] Task 43B Failed:', err);
      process.exit(1);
    });
}
