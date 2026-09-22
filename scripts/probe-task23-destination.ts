import { JsonRpcProvider, Contract, Interface, formatUnits } from 'ethers';

const POLYGON_RPC = process.env.POLYGON_MAINNET_RPC_URL || 'https://polygon-bor-rpc.publicnode.com';
const ARBITRUM_RPC = process.env.ARBITRUM_MAINNET_RPC_URL || 'https://arb1.arbitrum.io/rpc';

const OPERATOR_WALLET = '0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88';
const POLYGON_USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const ARBITRUM_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

const SOURCE_SWAP_TX = '0xbeaa1d786b82b5639bc89f0357dd00fd4f6ef801385a30f2a0e916e2f6bc60c0';
const APPROVAL_TX = '0x49247a7d4a59df80339c283406855d9ac6faa2e0ca1cc6cb61f19263e6b66c69';
const DEPOSIT_TX = '0x6cdc877e7a12b0cefb05c480dcec4e8dc9dd7e72a0ec23ea23f4f23a877b99c8';

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

const FUNDS_DEPOSITED_EVENT = 'event FundsDeposited(uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, address indexed recipient, address depositor, address inputToken, address outputToken, bytes message)';
const FILLED_RELAY_EVENT = 'event FilledRelay(uint256 inputAmount, uint256 outputAmount, uint256 repaymentChainId, uint256 indexed originChainId, uint256 indexed depositId, uint32 fillDeadline, uint32 exclusivityDeadline, address indexed relayer, address depositor, address recipient, address inputToken, address outputToken, bytes message, tuple(address recipient, bytes message, uint256 amount, bytes) executionDetails)';

async function runTask23Reconciliation() {
  console.log('================================================================================');
  console.log('ZENITH PHASE 1 TASK 23: EXISTING ACROSS DEPOSIT RECONCILIATION PROBE');
  console.log('Target Wallet:  ', OPERATOR_WALLET);
  console.log('Source Chain:   Polygon Mainnet (137)');
  console.log('Dest Chain:     Arbitrum One (42161)');
  console.log('Deposit Tx:     ', DEPOSIT_TX);
  console.log('================================================================================\n');

  const polygonProvider = new JsonRpcProvider(POLYGON_RPC, 137);
  const arbitrumProvider = new JsonRpcProvider(ARBITRUM_RPC, 42161);

  // 1. Across API Query
  console.log('[1/5] Querying Across API Deposit Status...');
  let acrossData: any = null;
  try {
    const res = await fetch(`https://app.across.to/api/deposit/status?originChainId=137&depositTxHash=${DEPOSIT_TX}`);
    acrossData = await res.json();
    console.log('  Across API Status:         ', acrossData.status);
    console.log('  Across Deposit ID:         ', acrossData.depositId);
    console.log('  Origin Chain ID:           ', acrossData.originChainId);
    console.log('  Destination Chain ID:      ', acrossData.destinationChainId);
    console.log('  Across fillTx (API field): ', acrossData.fillTx);
    console.log('  Across fillTxnRef:         ', acrossData.fillTxnRef);
  } catch (err: any) {
    console.error('  Across API Error:', err.message);
  }

  const fillTxHash = acrossData?.fillTx || acrossData?.fillTxnRef || acrossData?.fillTxHash;
  console.log('  Resolved Fill Tx Hash:     ', fillTxHash || 'NOT_FOUND');

  // 2. Query Polygon Deposit On-Chain Details
  console.log('\n[2/5] Querying Polygon Deposit Transaction On-Chain...');
  try {
    const [depTx, depReceipt] = await Promise.all([
      polygonProvider.getTransaction(DEPOSIT_TX),
      polygonProvider.getTransactionReceipt(DEPOSIT_TX)
    ]);
    if (depReceipt) {
      console.log('  Polygon Deposit Block:     ', depReceipt.blockNumber);
      console.log('  Polygon Deposit Status:    ', depReceipt.status === 1 ? 'SUCCESS (1)' : 'REVERTED (0)');
      console.log('  Polygon Gas Used:          ', depReceipt.gasUsed.toString());

      // Parse FundsDeposited
      const spokeIface = new Interface([FUNDS_DEPOSITED_EVENT]);
      for (const log of depReceipt.logs) {
        try {
          const parsed = spokeIface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed && parsed.name === 'FundsDeposited') {
            console.log('  [FundsDeposited Event Found]');
            console.log('    Input Token:             ', parsed.args.inputToken);
            console.log('    Output Token:            ', parsed.args.outputToken);
            console.log('    Input Amount:            ', parsed.args.inputAmount.toString(), `(${formatUnits(parsed.args.inputAmount, 6)} USDC)`);
            console.log('    Output Amount (Min):     ', parsed.args.outputAmount.toString(), `(${formatUnits(parsed.args.outputAmount, 6)} USDC)`);
            console.log('    Destination Chain ID:    ', parsed.args.destinationChainId.toString());
            console.log('    Deposit ID:              ', parsed.args.depositId.toString());
            console.log('    Depositor:               ', parsed.args.depositor);
            console.log('    Recipient:               ', parsed.args.recipient);
            console.log('    Quote Timestamp:         ', parsed.args.quoteTimestamp);
            console.log('    Fill Deadline:           ', parsed.args.fillDeadline);
          }
        } catch {}
      }
    }
  } catch (err: any) {
    console.error('  Polygon Receipt Error:', err.message);
  }

  // 3. Query Arbitrum One Destination Transaction
  console.log('\n[3/5] Querying Arbitrum One Destination Transaction On-Chain...');
  let destReceiptFound = false;
  let destStatusSuccess = false;
  let destBlockNumber = 0;
  let destGasUsed = '0';
  let destTimestamp = 0;
  let usdcTransferFound = false;
  let actualUsdcReceivedRaw = 0n;
  let relayerAddress = 'UNKNOWN';

  if (fillTxHash) {
    try {
      const [destTx, destReceipt] = await Promise.all([
        arbitrumProvider.getTransaction(fillTxHash),
        arbitrumProvider.getTransactionReceipt(fillTxHash)
      ]);

      if (destTx) {
        console.log('  Arbitrum Fill Tx Found:    ', true);
        console.log('  From (Relayer):            ', destTx.from);
        console.log('  To:                        ', destTx.to);
        console.log('  Chain ID:                  ', destTx.chainId.toString());
        relayerAddress = destTx.from;
      }

      if (destReceipt) {
        destReceiptFound = true;
        destStatusSuccess = destReceipt.status === 1;
        destBlockNumber = destReceipt.blockNumber;
        destGasUsed = destReceipt.gasUsed.toString();

        const block = await arbitrumProvider.getBlock(destReceipt.blockNumber);
        if (block) destTimestamp = block.timestamp;

        console.log('  Arbitrum Receipt Found:    ', true);
        console.log('  Receipt Status:            ', destReceipt.status === 1 ? 'SUCCESS (1)' : 'REVERTED (0)');
        console.log('  Block Number:              ', destBlockNumber);
        console.log('  Block Timestamp:           ', new Date(destTimestamp * 1000).toISOString());
        console.log('  Gas Used:                  ', destGasUsed);

        // Check ERC20 Transfer logs on Arbitrum USDC
        const erc20Iface = new Interface(ERC20_ABI);
        for (const log of destReceipt.logs) {
          if (log.address.toLowerCase() === ARBITRUM_USDC.toLowerCase()) {
            try {
              const parsed = erc20Iface.parseLog({ topics: log.topics as string[], data: log.data });
              if (parsed && parsed.name === 'Transfer') {
                const to = parsed.args.to.toLowerCase();
                const from = parsed.args.from;
                const value = BigInt(parsed.args.value.toString());
                console.log(`  [USDC Transfer] From: ${from} -> To: ${to}, Value: ${value.toString()} (${formatUnits(value, 6)} USDC)`);
                if (to === OPERATOR_WALLET.toLowerCase()) {
                  usdcTransferFound = true;
                  actualUsdcReceivedRaw = value;
                  console.log('  >>> TARGET RECIPIENT MATCHED! <<<');
                  console.log('  Exact Received Amount:     ', value.toString(), `(${formatUnits(value, 6)} USDC)`);
                }
              }
            } catch {}
          }
        }
      } else {
        console.log('  Arbitrum Receipt Found:     FALSE (pending or not indexed)');
      }
    } catch (err: any) {
      console.error('  Arbitrum Query Error:', err.message);
    }
  } else {
    console.log('  No fillTxHash provided by Across API.');
  }

  // 4. Query Destination USDC Balance
  console.log('\n[4/5] Reading Arbitrum One USDC Balance for Target Wallet...');
  let currentBalanceWei = 0n;
  try {
    const usdcContract = new Contract(ARBITRUM_USDC, ERC20_ABI, arbitrumProvider);
    currentBalanceWei = await usdcContract.balanceOf(OPERATOR_WALLET);
    console.log('  Current Arbitrum USDC Balance: ', currentBalanceWei.toString(), `(${formatUnits(currentBalanceWei, 6)} USDC)`);
    console.log('  Pre-Bridge Arbitrum Balance:   0 (0.000000 USDC verified in Task 21 / 21C audits)');
    console.log('  Net Balance Delta:             +', currentBalanceWei.toString(), `(+${formatUnits(currentBalanceWei, 6)} USDC)`);
  } catch (err: any) {
    console.error('  Arbitrum Balance Error:', err.message);
  }

  // 5. Source Swap Verification
  console.log('\n[5/5] Cross-Checking Source Swap & Approval Evidence...');
  try {
    const swapReceipt = await polygonProvider.getTransactionReceipt(SOURCE_SWAP_TX);
    if (swapReceipt) {
      console.log('  Source Swap Tx Status:     ', swapReceipt.status === 1 ? 'SUCCESS (1)' : 'REVERTED (0)');
      console.log('  Source Swap Block:         ', swapReceipt.blockNumber);
      console.log('  Source Swap Gas:           ', swapReceipt.gasUsed.toString());
    }
    const appReceipt = await polygonProvider.getTransactionReceipt(APPROVAL_TX);
    if (appReceipt) {
      console.log('  Approval Tx Status:        ', appReceipt.status === 1 ? 'SUCCESS (1)' : 'REVERTED (0)');
      console.log('  Approval Block:            ', appReceipt.blockNumber);
    }
  } catch (err: any) {
    console.error('  Source Check Error:', err.message);
  }

  // Synthesis & Classification
  console.log('\n================================================================================');
  console.log('RECONCILIATION SYNTHESIS');
  console.log('================================================================================');
  console.log('ACROSS API STATUS:           ', acrossData?.status || 'UNKNOWN');
  console.log('DESTINATION TX:              ', fillTxHash || 'NOT_FOUND');
  console.log('DESTINATION RECEIPT:         ', destReceiptFound ? (destStatusSuccess ? 'SUCCESS' : 'FAILED') : 'NOT_FOUND');
  console.log('DESTINATION USDC TRANSFER:   ', usdcTransferFound ? 'FOUND' : 'NOT_FOUND');
  console.log('ACTUAL RECEIVED RAW:         ', actualUsdcReceivedRaw.toString());
  console.log('ACTUAL RECEIVED FORMATTED:   ', formatUnits(actualUsdcReceivedRaw, 6), 'USDC');
  console.log('DESTINATION BALANCE DELTA:   ', formatUnits(currentBalanceWei, 6), 'USDC');
  console.log('FINAL EVIDENCE CLASS:        ', destReceiptFound && usdcTransferFound ? 'P1_ONCHAIN_RECEIPT' : 'P3_PROVIDER_API');
  
  let finalStatus = 'DESTINATION_STATUS_UNCERTAIN';
  if (destReceiptFound && destStatusSuccess && usdcTransferFound && actualUsdcReceivedRaw > 0n) {
    finalStatus = 'DESTINATION_SETTLED';
  } else if (destReceiptFound && !destStatusSuccess) {
    finalStatus = 'DESTINATION_FAILED';
  }
  console.log('FINAL RECONCILIATION STATUS: ', finalStatus);
  console.log('================================================================================\n');

  return {
    acrossStatus: acrossData?.status,
    depositId: acrossData?.depositId,
    fillTxHash,
    destReceiptFound,
    destStatusSuccess,
    destBlockNumber,
    destGasUsed,
    destTimestamp,
    usdcTransferFound,
    actualUsdcReceivedRaw: actualUsdcReceivedRaw.toString(),
    currentBalanceWei: currentBalanceWei.toString(),
    finalStatus
  };
}

if (require.main === module) {
  runTask23Reconciliation().catch((err) => {
    console.error('Fatal probe error:', err);
    process.exit(1);
  });
}
