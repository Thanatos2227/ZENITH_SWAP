import { JsonRpcProvider, Contract, formatEther, formatUnits, parseUnits } from 'ethers';
import { defaultAcrossProvider } from '@zenith/routing';

async function queryNewWallet() {
  const newAddress = '0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88';
  const polygonRpc = 'https://polygon-bor-rpc.publicnode.com';
  const arbitrumRpc = 'https://arb1.arbitrum.io/rpc';

  const polyProvider = new JsonRpcProvider(polygonRpc, 137);
  const arbProvider = new JsonRpcProvider(arbitrumRpc, 42161);

  const ERC20_ABI = [
    'function balanceOf(address account) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function decimals() view returns (uint8)'
  ];

  const polygonUsdcAddress = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
  const arbitrumUsdcAddress = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
  const acrossPolygonSpokePool = '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096';

  const [polyBlock, arbBlock] = await Promise.all([
    polyProvider.getBlockNumber(),
    arbProvider.getBlockNumber()
  ]);

  const [polBalance, polyUsdcContract, arbUsdcContract, nonce, feeData] = await Promise.all([
    polyProvider.getBalance(newAddress),
    new Contract(polygonUsdcAddress, ERC20_ABI, polyProvider),
    new Contract(arbitrumUsdcAddress, ERC20_ABI, arbProvider),
    polyProvider.getTransactionCount(newAddress),
    polyProvider.getFeeData()
  ]);

  const [polyUsdcBalance, arbUsdcBalance, allowance] = await Promise.all([
    polyUsdcContract.balanceOf(newAddress),
    arbUsdcContract.balanceOf(newAddress),
    polyUsdcContract.allowance(newAddress, acrossPolygonSpokePool)
  ]);

  console.log('=== NEW WALLET LIVE QUERY ===');
  console.log('Address:', newAddress);
  console.log('Polygon Latest Block:', polyBlock);
  console.log('Arbitrum Latest Block:', arbBlock);
  console.log('POL Balance:', formatEther(polBalance), 'POL (' + polBalance.toString() + ' wei)');
  console.log('Polygon USDC Balance:', formatUnits(polyUsdcBalance, 6), 'USDC (' + polyUsdcBalance.toString() + ' raw)');
  console.log('Arbitrum USDC Balance:', formatUnits(arbUsdcBalance, 6), 'USDC (' + arbUsdcBalance.toString() + ' raw)');
  console.log('Polygon Nonce:', nonce);
  console.log('Across Allowance:', formatUnits(allowance, 6), 'USDC');
  console.log('Gas Price:', feeData.gasPrice ? formatUnits(feeData.gasPrice, 'gwei') + ' gwei' : 'N/A');
  console.log('Max Fee Per Gas:', feeData.maxFeePerGas ? formatUnits(feeData.maxFeePerGas, 'gwei') + ' gwei' : 'N/A');
  console.log('Max Priority Fee:', feeData.maxPriorityFeePerGas ? formatUnits(feeData.maxPriorityFeePerGas, 'gwei') + ' gwei' : 'N/A');

  // Calculations for 5 POL
  const amountInWei = parseUnits('5.0', 18);
  const rateRawPerPol = 103577n; // 0.103577 USDC per POL
  const expectedSourceUsdcRaw = (amountInWei * rateRawPerPol) / 10n**18n;
  const minSourceUsdcRaw = (expectedSourceUsdcRaw * 995n) / 1000n;

  console.log('\n=== QUOTES ===');
  console.log('5 POL Source Quoted USDC:', formatUnits(expectedSourceUsdcRaw, 6), 'USDC (' + expectedSourceUsdcRaw.toString() + ' raw)');
  console.log('5 POL Min Source USDC (0.5% slippage):', formatUnits(minSourceUsdcRaw, 6), 'USDC (' + minSourceUsdcRaw.toString() + ' raw)');

  // Gas Outflow Check
  const maxFee = feeData.maxFeePerGas || parseUnits('390', 'gwei');
  const safeGasUnits = 378000n; // 120% margin
  const maxGasOutflowWei = safeGasUnits * maxFee;
  const totalRequiredPolWei = amountInWei + maxGasOutflowWei;

  console.log('\n=== BALANCE SAFETY CHECK ===');
  console.log('5 POL Input Amount:', formatEther(amountInWei), 'POL');
  console.log('120% Gas Outflow (378k gas @ maxFee):', formatEther(maxGasOutflowWei), 'POL');
  console.log('Total Required Outflow:', formatEther(totalRequiredPolWei), 'POL');
  console.log('Wallet POL Balance:', formatEther(polBalance), 'POL');
  const hasEnough = polBalance >= totalRequiredPolWei;
  console.log('Has Enough POL for 5 POL + Gas:', hasEnough);
  if (hasEnough) {
    const reserve = polBalance - totalRequiredPolWei;
    console.log('Safety Reserve Remaining:', formatEther(reserve), 'POL');
  } else {
    const deficit = totalRequiredPolWei - polBalance;
    console.log('Deficit:', formatEther(deficit), 'POL');
  }

  // Across limits fetch
  try {
    const res = await fetch('https://app.across.to/api/limits?inputToken=' + polygonUsdcAddress + '&outputToken=' + arbitrumUsdcAddress + '&originChainId=137&destinationChainId=42161');
    const limits = await res.json();
    console.log('\n=== ACROSS LIMITS ===');
    console.log('Across Limits minDeposit:', limits.minDeposit);
    console.log('Across Limits maxDeposit:', limits.maxDeposit);
    console.log('Min Source Output >= Across minDeposit:', minSourceUsdcRaw >= BigInt(limits.minDeposit));
  } catch (err: any) {
    console.log('Limits API err:', err.message);
  }

  // Across quote fetch
  try {
    const quoteRes = await fetch('https://app.across.to/api/suggested-fees?inputToken=' + polygonUsdcAddress + '&outputToken=' + arbitrumUsdcAddress + '&originChainId=137&destinationChainId=42161&amount=' + minSourceUsdcRaw.toString() + '&recipient=' + newAddress);
    const quoteData = await quoteRes.json();
    console.log('\n=== ACROSS SUGGESTED FEES ===');
    console.log('Relay Fee:', quoteData.relayFeePct, quoteData.relayFeeTotal);
    console.log('Destination Output:', quoteData.outputAmount);
  } catch (err: any) {
    console.log('Across quote err:', err.message);
  }
}

queryNewWallet().catch(console.error);
