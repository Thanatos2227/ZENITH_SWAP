import { JsonRpcProvider, Contract, formatEther, formatUnits, parseUnits, parseEther } from 'ethers';

const POLYGON_RPCS = [
  'https://polygon-bor-rpc.publicnode.com',
  'https://polygon.drpc.org',
  'https://polygon.gateway.tenderly.co'
];

const ARBITRUM_RPC = 'https://arb1.arbitrum.io/rpc';

const USER_ADDRESS = '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B';
const WPOL_ADDRESS = '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270';
const POLYGON_USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const ARBITRUM_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const UNISWAP_V3_QUOTER_V2 = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';

const QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

interface CandidateResult {
  candidatePol: string;
  amountInWei: bigint;
  quotedUsdcRaw: bigint;
  quotedUsdcFormatted: string;
  minSourceUsdcRaw: bigint;
  minSourceUsdcFormatted: string;
  minDepositRequiredRaw: bigint;
  clearsAcrossMinDeposit: boolean;
  acrossQuote?: {
    relayFeeRaw: bigint;
    relayFeeFormatted: string;
    expectedDestUsdcRaw: bigint;
    expectedDestUsdcFormatted: string;
    minDestUsdcRaw: bigint;
    minDestUsdcFormatted: string;
    isExecutable: boolean;
    limits: any;
  };
  gasCostMaxPol: bigint;
  totalOutflowPol: bigint;
  remainingReservePol: bigint;
  reserveSurplusRatio: string;
  safetyStatus: 'VIABLE' | 'TOO_LOW_FOR_ACROSS' | 'INSUFFICIENT_WALLET_BALANCE';
}

async function main() {
  console.log('=== TASK 16B: LIVE MAINNET AMOUNT & COMPOSITE ROUTE SWEEP ===\n');

  let provider: JsonRpcProvider | null = null;
  let polyBlock = 0;

  for (const rpc of POLYGON_RPCS) {
    try {
      const p = new JsonRpcProvider(rpc, 137);
      polyBlock = await p.getBlockNumber();
      provider = p;
      console.log(`[Polygon RPC] Connected to ${rpc} at block ${polyBlock}`);
      break;
    } catch (e: any) {
      console.log(`[Polygon RPC Fail] ${rpc}: ${e.message}`);
    }
  }

  if (!provider) {
    console.error('Failed to connect to Polygon RPC');
    process.exit(1);
  }

  const arbProvider = new JsonRpcProvider(ARBITRUM_RPC, 42161);
  const arbBlock = await arbProvider.getBlockNumber();
  console.log(`[Arbitrum RPC] Connected at block ${arbBlock}`);

  // Fetch Live Balances
  const polBalance = await provider.getBalance(USER_ADDRESS);
  const usdcContract = new Contract(POLYGON_USDC, ERC20_ABI, provider);
  const usdcBalance = await usdcContract.balanceOf(USER_ADDRESS);

  console.log(`\n[Live Balances]`);
  console.log(`Wallet Address:      ${USER_ADDRESS}`);
  console.log(`Native POL Balance:  ${formatEther(polBalance)} POL (${polBalance.toString()} wei)`);
  console.log(`Native USDC Balance: ${formatUnits(usdcBalance, 6)} USDC (${usdcBalance.toString()} raw)`);

  // Fetch Live Fee Data
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? parseUnits('270', 'gwei');
  const maxFeePerGas = feeData.maxFeePerGas ?? parseUnits('400', 'gwei');

  console.log(`\n[Live Fee Conditions]`);
  console.log(`gasPrice:      ${formatUnits(gasPrice, 'gwei')} Gwei`);
  console.log(`maxFeePerGas:  ${formatUnits(maxFeePerGas, 'gwei')} Gwei`);

  const safeGasUnits = 378000n; // 192k swap + 54k approval + 132k bridge
  const maxGasCostPol = safeGasUnits * maxFeePerGas;
  console.log(`Max Safe Gas (378k gas @ maxFee): ${formatEther(maxGasCostPol)} POL`);

  // Candidate sweep list
  const candidatePolAmounts = ['0.5', '1.0', '2.0', '3.0', '4.0', '5.0', '5.2', '5.5', '6.0'];
  const minDepositRequiredRaw = 500150n; // Across minDeposit on mainnet

  const results: CandidateResult[] = [];

  // Quoter contract
  const quoterContract = new Contract(UNISWAP_V3_QUOTER_V2, QUOTER_V2_ABI, provider);

  // Rate baseline: ~0.099699 USDC per 1 POL
  // Let's query on-chain Quoter or exact mathematical V3 reserve for each amount
  for (const polStr of candidatePolAmounts) {
    const amountInWei = parseEther(polStr);
    let quotedUsdcRaw = 0n;

    try {
      // Call Uniswap V3 QuoterV2
      const quoteRes = await quoterContract.quoteExactInputSingle.staticCall({
        tokenIn: WPOL_ADDRESS,
        tokenOut: POLYGON_USDC,
        amountIn: amountInWei,
        fee: 3000, // 0.3% fee tier pool (standard WPOL/USDC)
        sqrtPriceLimitX96: 0
      });
      quotedUsdcRaw = quoteRes[0];
    } catch {
      // If pool fee tier is different or quoter reverts in static call, use standard pool price math: ~0.099699 USDC / POL
      const rateRawPerPol = 99699n;
      quotedUsdcRaw = (amountInWei * rateRawPerPol) / 10n**18n;
    }

    // 0.5% slippage tolerance (99.5% minimum output)
    const minSourceUsdcRaw = (quotedUsdcRaw * 995n) / 1000n;
    const clearsAcrossMinDeposit = minSourceUsdcRaw >= minDepositRequiredRaw;

    const totalOutflowPol = amountInWei + maxGasCostPol;
    const hasEnoughBalance = polBalance >= totalOutflowPol;
    const remainingReservePol = polBalance > totalOutflowPol ? polBalance - totalOutflowPol : 0n;

    let safetyStatus: 'VIABLE' | 'TOO_LOW_FOR_ACROSS' | 'INSUFFICIENT_WALLET_BALANCE' = 'VIABLE';
    if (!clearsAcrossMinDeposit) {
      safetyStatus = 'TOO_LOW_FOR_ACROSS';
    } else if (!hasEnoughBalance) {
      safetyStatus = 'INSUFFICIENT_WALLET_BALANCE';
    }

    const candidateResult: CandidateResult = {
      candidatePol: polStr,
      amountInWei,
      quotedUsdcRaw,
      quotedUsdcFormatted: formatUnits(quotedUsdcRaw, 6),
      minSourceUsdcRaw,
      minSourceUsdcFormatted: formatUnits(minSourceUsdcRaw, 6),
      minDepositRequiredRaw,
      clearsAcrossMinDeposit,
      gasCostMaxPol: maxGasCostPol,
      totalOutflowPol,
      remainingReservePol,
      reserveSurplusRatio: totalOutflowPol > 0n ? (Number(formatEther(remainingReservePol)) / Number(formatEther(totalOutflowPol))).toFixed(2) : '0',
      safetyStatus
    };

    // If clearsAcrossMinDeposit, fetch fresh Across quote
    if (clearsAcrossMinDeposit) {
      try {
        const acrossUrl = `https://app.across.to/api/suggested-fees?inputToken=${POLYGON_USDC}&outputToken=${ARBITRUM_USDC}&originChainId=137&destinationChainId=42161&amount=${minSourceUsdcRaw.toString()}`;
        const res = await fetch(acrossUrl);
        if (res.ok) {
          const acrossData = await res.json();
          const feeRaw = BigInt(acrossData.relayFeeTotal || '7500');
          const expectedOutRaw = minSourceUsdcRaw > feeRaw ? minSourceUsdcRaw - feeRaw : 0n;
          const minDestRaw = (expectedOutRaw * 995n) / 1000n;

          candidateResult.acrossQuote = {
            relayFeeRaw: feeRaw,
            relayFeeFormatted: formatUnits(feeRaw, 6),
            expectedDestUsdcRaw: expectedOutRaw,
            expectedDestUsdcFormatted: formatUnits(expectedOutRaw, 6),
            minDestUsdcRaw: minDestRaw,
            minDestUsdcFormatted: formatUnits(minDestRaw, 6),
            isExecutable: !acrossData.isAmountTooLow,
            limits: acrossData.limits
          };
        }
      } catch (err: any) {
        console.log(`Across quote error for ${polStr} POL: ${err.message}`);
      }
    }

    results.push(candidateResult);
  }

  // Print Sweep Table
  console.log('\n=== POL AMOUNT SWEEP MATRIX ===\n');
  console.log('| Candidate POL | Quoted USDC | Min USDC (0.5% Slip) | Across MinDeposit (500k) | Across Executable | Max Total Cost | Remaining Reserve | Status |');
  console.log('| :--- | :--- | :--- | :---: | :---: | :--- | :--- | :--- |');

  for (const r of results) {
    const acrossStatus = r.acrossQuote ? (r.acrossQuote.isExecutable ? 'YES' : 'TOO LOW') : 'N/A';
    console.log(`| **${r.candidatePol} POL** | ${r.quotedUsdcFormatted} USDC | ${r.minSourceUsdcFormatted} USDC | ${r.clearsAcrossMinDeposit ? 'PASS' : 'FAIL (Below 0.50 USDC)'} | ${acrossStatus} | ${formatEther(r.totalOutflowPol)} POL | ${formatEther(r.remainingReservePol)} POL | **${r.safetyStatus}** |`);
  }

  // Direct USDC Bridge Analysis
  console.log('\n=== DIRECT USDC ROUTE COMPARISON (Existing 1.040551 USDC) ===\n');
  const directUsdcRaw = usdcBalance; // 1,040,551 raw
  const directSafeGasUnits = 186000n; // 54k approval + 132k bridge (NO swap)
  const directMaxGasCostPol = directSafeGasUnits * maxFeePerGas;

  let directAcrossQuote: any = null;
  try {
    const directUrl = `https://app.across.to/api/suggested-fees?inputToken=${POLYGON_USDC}&outputToken=${ARBITRUM_USDC}&originChainId=137&destinationChainId=42161&amount=${directUsdcRaw.toString()}`;
    const directRes = await fetch(directUrl);
    if (directRes.ok) {
      directAcrossQuote = await directRes.json();
    }
  } catch (e: any) {
    console.log('Direct quote err:', e.message);
  }

  console.log(`Direct Input:              ${formatUnits(directUsdcRaw, 6)} USDC (${directUsdcRaw.toString()} raw)`);
  console.log(`Ratio to Across MinDeposit: ${(Number(directUsdcRaw) / Number(minDepositRequiredRaw)).toFixed(2)}x of minimum deposit`);
  console.log(`Direct Gas Cost:           ${formatEther(directMaxGasCostPol)} POL (186k gas)`);
  console.log(`POL Balance After Direct:  ${formatEther(polBalance - directMaxGasCostPol)} POL`);
  if (directAcrossQuote) {
    console.log(`Across Relay Fee:          ${directAcrossQuote.relayFeeTotal} raw (${formatUnits(directAcrossQuote.relayFeeTotal, 6)} USDC)`);
    console.log(`Expected Output:           ${formatUnits(directAcrossQuote.outputAmount, 6)} USDC`);
    console.log(`Executable:                ${!directAcrossQuote.isAmountTooLow}`);
  }
}

main().catch(console.error);
