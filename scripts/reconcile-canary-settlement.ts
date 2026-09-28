import {
  JsonRpcProvider,
  Contract,
  formatUnits,
  formatEther,
  getAddress,
  Interface,
  id
} from 'ethers';

const POLYGON_RPCS = [
  'https://polygon-bor-rpc.publicnode.com',
  'https://polygon.drpc.org',
  'https://polygon.gateway.tenderly.co'
];

const CANONICAL_TX_HASH = '0x66d379b1806fff0c291cbf31143dfdf3bd5a8ddce66ff578f9d7e6aac16130dd';
const EXPECTED_OPERATOR = getAddress('0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88'.toLowerCase());
const QUICKSWAP_ROUTER = getAddress('0xf5b509bB0909a69B1c207E495f687a596C168E12'.toLowerCase());
const WMATIC_ADDR = getAddress('0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'.toLowerCase());
const USDC_ADDR = getAddress('0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'.toLowerCase());

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address, address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

const ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice)) external payable returns (uint256 amountOut)'
];

async function runReconciliation() {
  console.log('================================================================');
  console.log('ZENITH — POST-CANARY RECONCILIATION & SETTLEMENT ENGINE');
  console.log('================================================================\n');

  const provider = new JsonRpcProvider(POLYGON_RPCS[0], 137, { staticNetwork: true });

  // 1. On-Chain Transaction & Receipt
  console.log('[SECTION 1] Retrieving Authoritative On-Chain Evidence...');
  const [tx, receipt, currentHead] = await Promise.all([
    provider.getTransaction(CANONICAL_TX_HASH),
    provider.getTransactionReceipt(CANONICAL_TX_HASH),
    provider.getBlockNumber()
  ]);

  if (!tx || !receipt) {
    throw new Error('Canonical canary transaction or receipt not found on Polygon mainnet');
  }

  const block = await provider.getBlock(receipt.blockNumber, false);

  console.log('TRANSACTION_HASH:           ', tx.hash);
  console.log('BLOCK_NUMBER:               ', receipt.blockNumber);
  console.log('BLOCK_CONFIRMATIONS:        ', currentHead - receipt.blockNumber);
  console.log('BLOCK_TIMESTAMP:            ', block ? new Date(block.timestamp * 1000).toISOString() : 'N/A');
  console.log('SENDER_ADDRESS:             ', tx.from);
  console.log('TARGET_ROUTER_ADDRESS:      ', tx.to);
  console.log('SENDER_MATCH:               ', tx.from.toLowerCase() === EXPECTED_OPERATOR.toLowerCase());
  console.log('ROUTER_MATCH:               ', tx.to?.toLowerCase() === QUICKSWAP_ROUTER.toLowerCase());
  console.log('NONCE:                      ', tx.nonce);
  console.log('RECEIPT_STATUS:             ', receipt.status === 1 ? 'SUCCESS (1)' : 'REVERTED (0)');
  console.log('GAS_USED:                   ', receipt.gasUsed.toString());
  console.log('GAS_LIMIT:                  ', tx.gasLimit.toString());
  console.log('EFFECTIVE_GAS_PRICE:        ', receipt.gasPrice ? receipt.gasPrice.toString() : 'N/A');
  console.log('TOTAL_LOGS_COUNT:           ', receipt.logs.length);

  // 2. Decode Calldata
  const routerIf = new Interface(ROUTER_ABI);
  let decodedInput: any = null;
  try {
    const parsed = routerIf.parseTransaction({ data: tx.data, value: tx.value });
    decodedInput = parsed?.args[0];
  } catch (err: any) {
    console.warn('Could not parse calldata with standard router interface:', err.message);
  }

  if (decodedInput) {
    console.log('\n[SECTION 2] Decoded Transaction Calldata Parameters:');
    console.log('  tokenIn:                  ', decodedInput.tokenIn);
    console.log('  tokenOut:                 ', decodedInput.tokenOut);
    console.log('  recipient:                ', decodedInput.recipient);
    console.log('  deadline:                 ', Number(decodedInput.deadline));
    console.log('  amountIn:                 ', decodedInput.amountIn.toString(), `(${formatUnits(decodedInput.amountIn, 18)} WMATIC)`);
    console.log('  amountOutMinimum:         ', decodedInput.amountOutMinimum.toString(), `(${formatUnits(decodedInput.amountOutMinimum, 6)} USDC)`);
  }

  // 3. Decode Logs and Transfer Events
  console.log('\n[SECTION 3] Decoded Event Logs & Transfer Accounting:');
  const erc20If = new Interface(ERC20_ABI);
  let wmaticSpent = 0n;
  let usdcReceived = 0n;

  for (let i = 0; i < receipt.logs.length; i++) {
    const log = receipt.logs[i];
    try {
      const parsedLog = erc20If.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsedLog && parsedLog.name === 'Transfer') {
        const [from, to, value] = parsedLog.args;
        console.log(`  Log #${i} Transfer:`);
        console.log(`    Token:   ${log.address}`);
        console.log(`    From:    ${from}`);
        console.log(`    To:      ${to}`);
        console.log(`    Amount:  ${value.toString()}`);

        if (log.address.toLowerCase() === WMATIC_ADDR.toLowerCase() && from.toLowerCase() === EXPECTED_OPERATOR.toLowerCase()) {
          wmaticSpent += BigInt(value.toString());
        }
        if (log.address.toLowerCase() === USDC_ADDR.toLowerCase() && to.toLowerCase() === EXPECTED_OPERATOR.toLowerCase()) {
          usdcReceived += BigInt(value.toString());
        }
      }
    } catch {
      // Pool internal swap / swap events
      console.log(`  Log #${i} (DEX Internal Event): contract ${log.address}`);
    }
  }

  console.log('\n[SECTION 4] Net Token Deltas From Transfer Logs:');
  console.log('  WMATIC Spent by Operator: ', formatUnits(wmaticSpent, 18), 'WMATIC (', wmaticSpent.toString(), 'wei)');
  console.log('  USDC Received by Operator:', formatUnits(usdcReceived, 6), 'USDC (', usdcReceived.toString(), 'raw)');

  // 4. Current On-Chain Balances & Allowances
  console.log('\n[SECTION 5] Live Current State On-Chain:');
  const wmaticContract = new Contract(WMATIC_ADDR, ERC20_ABI, provider);
  const usdcContract = new Contract(USDC_ADDR, ERC20_ABI, provider);

  const [currentPol, currentWmatic, currentUsdc, currentAllowance, currentNonce] = await Promise.all([
    provider.getBalance(EXPECTED_OPERATOR),
    wmaticContract.balanceOf(EXPECTED_OPERATOR),
    usdcContract.balanceOf(EXPECTED_OPERATOR),
    wmaticContract.allowance(EXPECTED_OPERATOR, QUICKSWAP_ROUTER),
    provider.getTransactionCount(EXPECTED_OPERATOR)
  ]);

  console.log('  Current Native POL:       ', formatEther(currentPol), 'POL');
  console.log('  Current WMATIC Balance:   ', formatUnits(currentWmatic, 18), 'WMATIC');
  console.log('  Current USDC Balance:     ', formatUnits(currentUsdc, 6), 'USDC');
  console.log('  Current Router Allowance: ', formatUnits(currentAllowance, 18), 'WMATIC');
  console.log('  Current Nonce:            ', currentNonce);

  // 5. Assertion Reconciliation
  console.log('\n================================================================');
  console.log('RECONCILIATION SUMMARY MATRIX');
  console.log('================================================================');
  const checks = {
    senderMatch: tx.from.toLowerCase() === EXPECTED_OPERATOR.toLowerCase(),
    routerMatch: tx.to?.toLowerCase() === QUICKSWAP_ROUTER.toLowerCase(),
    receiptSuccess: receipt.status === 1,
    wmaticExactSpent: wmaticSpent === 1000000000000000000n,
    usdcExactReceived: usdcReceived === 118537n,
    economicInvariantPass: usdcReceived >= 99200n,
    allowanceZero: currentAllowance === 0n
  };

  console.log('SENDER_MATCH:              ', checks.senderMatch ? 'PASS' : 'FAIL');
  console.log('ROUTER_MATCH:              ', checks.routerMatch ? 'PASS' : 'FAIL');
  console.log('RECEIPT_STATUS_SUCCESS:    ', checks.receiptSuccess ? 'PASS' : 'FAIL');
  console.log('EXACT_1_WMATIC_SPENT:      ', checks.wmaticExactSpent ? 'PASS' : 'FAIL');
  console.log('EXACT_0_118537_USDC_OUTPUT:', checks.usdcExactReceived ? 'PASS' : 'FAIL');
  console.log('ECONOMIC_INVARIANT_BOUND:  ', checks.economicInvariantPass ? 'PASS' : 'FAIL');
  console.log('ALLOWANCE_EXHAUSTED_TO_0:  ', checks.allowanceZero ? 'PASS' : 'FAIL');
  console.log('================================================================');
}

runReconciliation().catch((err) => {
  console.error('[FATAL] Reconciliation failed:', err);
  process.exit(1);
});
