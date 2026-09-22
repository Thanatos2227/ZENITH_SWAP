import { JsonRpcProvider, formatUnits } from 'ethers';
import { defaultAcrossProvider } from '../packages/routing/src/crosschain/providers/acrossProvider';
import { defaultDeBridgeProvider } from '../packages/routing/src/crosschain/providers/debridgeProvider';
import { defaultTokenService } from '../packages/tokens/src';

async function main() {
  console.log('=== ZENITH — POLYGON CROSS-CHAIN READ-ONLY PROBE ===');

  const rpcUrls = [
    'https://polygon-bor-rpc.publicnode.com',
    'https://polygon.drpc.org',
    'https://polygon.blockpi.network/v1/rpc/public',
    'https://polygon.gateway.tenderly.co',
    'https://rpc-mainnet.maticvigil.com'
  ];

  let activeProvider: JsonRpcProvider | null = null;
  let activeUrl = '';

  for (const url of rpcUrls) {
    try {
      const p = new JsonRpcProvider(url, 137, { staticNetwork: true });
      const network = await p.getNetwork();
      const blockNumber = await p.getBlockNumber();
      console.log(`[RPC Check] ${url} -> OK! Chain ID: ${network.chainId}, Block: ${blockNumber}`);
      if (!activeProvider) {
        activeProvider = p;
        activeUrl = url;
      }
    } catch (err: any) {
      console.log(`[RPC Check] ${url} -> FAILED: ${err.message}`);
    }
  }

  if (!activeProvider) {
    console.error('No healthy Polygon RPC endpoint found!');
    return;
  }

  console.log(`\nActive Provider Selected: ${activeUrl}`);
  const feeData = await activeProvider.getFeeData();
  console.log(`Gas Price: ${feeData.gasPrice ? formatUnits(feeData.gasPrice, 'gwei') : 'N/A'} Gwei`);
  console.log(`Max Fee Per Gas: ${feeData.maxFeePerGas ? formatUnits(feeData.maxFeePerGas, 'gwei') : 'N/A'} Gwei`);

  // Verify Bytecode of Key Contracts on Polygon
  const contractsToVerify = [
    { name: 'WPOL (Wrapped POL)', address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270' },
    { name: 'Native USDC (Circle)', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },
    { name: 'USDT (Tether)', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' },
    { name: 'Across V3 SpokePool', address: '0x9295ee1d8C5b022Be115A2AD3c30C72E34e7F096' },
    { name: 'deBridge DLN Source', address: '0xeF4fB24aD0916217251F553c0596F8Edc630EB66' },
    { name: 'Uniswap V3 SwapRouter02', address: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45' },
    { name: 'Uniswap V3 QuoterV2', address: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' }
  ];

  console.log('\n--- On-Chain Bytecode Verification on Polygon (Chain ID 137) ---');
  for (const c of contractsToVerify) {
    try {
      const code = await activeProvider.getCode(c.address);
      const isValid = code && code.length > 2;
      console.log(`[Bytecode] ${c.name} (${c.address}) -> ${isValid ? 'VERIFIED_ON_CHAIN (' + (code.length/2 - 1) + ' bytes)' : 'NOT_DEPLOYED'}`);
    } catch (err: any) {
      console.log(`[Bytecode] ${c.name} (${c.address}) -> ERROR: ${err.message}`);
    }
  }

  // Probe Live Across Quote from Polygon USDC to Arbitrum USDC
  console.log('\n--- Live Bridge Quote Probes ---');
  const polygonUSDC = defaultTokenService.getToken('polygon', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359') || {
    address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    symbol: 'USDC',
    decimals: 6,
    chainId: 'polygon',
    name: 'USD Coin',
    verificationTier: 'VERIFIED_CANONICAL'
  };

  const arbitrumUSDC = defaultTokenService.getToken('arbitrum', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831') || {
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    symbol: 'USDC',
    decimals: 6,
    chainId: 'arbitrum',
    name: 'USD Coin',
    verificationTier: 'VERIFIED_CANONICAL'
  };

  const ethereumUSDC = defaultTokenService.getToken('ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48') || {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    decimals: 6,
    chainId: 'ethereum',
    name: 'USD Coin',
    verificationTier: 'VERIFIED_CANONICAL'
  };

  // Across: Polygon -> Arbitrum (1 USDC = 1000000 raw)
  try {
    const acrossQuote = await defaultAcrossProvider.getQuote({
      sourceChainId: 'polygon',
      destinationChainId: 'arbitrum',
      tokenIn: polygonUSDC,
      tokenOut: arbitrumUSDC,
      amountInRaw: '1000000', // 1 USDC
      slippageTolerancePercent: 0.5,
      userWalletAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
      recipientAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B'
    });
    console.log('\n[Across Quote] Polygon USDC -> Arbitrum USDC:', {
      provider: acrossQuote?.provider,
      sourceAmountRaw: acrossQuote?.sourceAmountRaw,
      destinationAmountRaw: acrossQuote?.destinationAmountRaw,
      minDestinationAmountRaw: acrossQuote?.minDestinationAmountRaw,
      executionTarget: acrossQuote?.executionTarget,
      approvalTarget: acrossQuote?.approvalTarget,
      isExecutable: acrossQuote?.isExecutable,
      calldataLength: acrossQuote?.calldata?.length
    });
  } catch (err: any) {
    console.log('\n[Across Quote] Polygon USDC -> Arbitrum USDC FAILED:', err.message);
  }

  // Across: Polygon -> Ethereum (1 USDC = 1000000 raw)
  try {
    const acrossQuoteEth = await defaultAcrossProvider.getQuote({
      sourceChainId: 'polygon',
      destinationChainId: 'ethereum',
      tokenIn: polygonUSDC,
      tokenOut: ethereumUSDC,
      amountInRaw: '1000000', // 1 USDC
      slippageTolerancePercent: 0.5,
      userWalletAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
      recipientAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B'
    });
    console.log('\n[Across Quote] Polygon USDC -> Ethereum USDC:', {
      provider: acrossQuoteEth?.provider,
      sourceAmountRaw: acrossQuoteEth?.sourceAmountRaw,
      destinationAmountRaw: acrossQuoteEth?.destinationAmountRaw,
      minDestinationAmountRaw: acrossQuoteEth?.minDestinationAmountRaw,
      executionTarget: acrossQuoteEth?.executionTarget,
      approvalTarget: acrossQuoteEth?.approvalTarget,
      isExecutable: acrossQuoteEth?.isExecutable,
      calldataLength: acrossQuoteEth?.calldata?.length
    });
  } catch (err: any) {
    console.log('\n[Across Quote] Polygon USDC -> Ethereum USDC FAILED:', err.message);
  }

  // deBridge: Polygon -> Arbitrum (1 USDC = 1000000 raw)
  try {
    const debridgeQuote = await defaultDeBridgeProvider.getQuote({
      sourceChainId: 'polygon',
      destinationChainId: 'arbitrum',
      tokenIn: polygonUSDC,
      tokenOut: arbitrumUSDC,
      amountInRaw: '1000000',
      slippageTolerancePercent: 0.5,
      userWalletAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
      recipientAddress: '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B'
    });
    console.log('\n[deBridge Quote] Polygon USDC -> Arbitrum USDC:', {
      provider: debridgeQuote?.provider,
      sourceAmountRaw: debridgeQuote?.sourceAmountRaw,
      destinationAmountRaw: debridgeQuote?.destinationAmountRaw,
      minDestinationAmountRaw: debridgeQuote?.minDestinationAmountRaw,
      executionTarget: debridgeQuote?.executionTarget,
      approvalTarget: debridgeQuote?.approvalTarget,
      isExecutable: debridgeQuote?.isExecutable,
      calldataLength: debridgeQuote?.calldata?.length
    });
  } catch (err: any) {
    console.log('\n[deBridge Quote] Polygon USDC -> Arbitrum USDC FAILED:', err.message);
  }
}

main().catch(console.error);
