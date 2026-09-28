import { JsonRpcProvider, FetchRequest, Contract, formatUnits, formatEther, getAddress } from 'ethers';
const ARBITRUM_CHAIN_ID = 42161;
const ARBITRUM_RPCS = [
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum-one-rpc.publicnode.com',
    'https://arbitrum.drpc.org'
];
const OPERATOR_ADDR = getAddress('0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88'.toLowerCase());
const WETH_ADDR = getAddress('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'.toLowerCase());
const USDC_ADDR = getAddress('0xaf88d065e77c8cC2239327C5EDb3A432268e5831'.toLowerCase());
const UNISWAP_ROUTER = getAddress('0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'.toLowerCase());
const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address, address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)'
];
const REQUIRED_ETH_MIN = 0.0008188;
async function runFundingVerification() {
    console.log('================================================================');
    console.log('ZENITH — ARBITRUM ONE FUNDING VERIFICATION ENGINE');
    console.log('================================================================');
    console.log('AUTHORIZED_WALLET:    ' + OPERATOR_ADDR);
    console.log('TARGET_NETWORK:       Arbitrum One (Chain ID: 42161)');
    console.log('MODE:                 READ_ONLY');
    console.log('================================================================\n');
    let activeProvider: JsonRpcProvider | null = null;
    let verifiedBlock = 0;
    let healthyRpcs = 0;
    for (const rpcUrl of ARBITRUM_RPCS) {
        try {
            const fetchReq = new FetchRequest(rpcUrl);
            fetchReq.timeout = 15000;
            const p = new JsonRpcProvider(fetchReq, ARBITRUM_CHAIN_ID, { staticNetwork: true });
            const network = await p.getNetwork();
            const head = await p.getBlockNumber();
            if (Number(network.chainId) === ARBITRUM_CHAIN_ID && head > 0) {
                healthyRpcs++;
                if (!activeProvider) {
                    activeProvider = p;
                    verifiedBlock = head;
                }
            }
        }
        catch {
            continue;
        }
    }
    if (!activeProvider || healthyRpcs === 0) {
        throw new Error('All Arbitrum RPC providers failed quorum consensus');
    }
    console.log(`[STAGE 1] RPC Quorum Consensus: ${healthyRpcs}/${ARBITRUM_RPCS.length} Healthy Nodes (Head Block: ${verifiedBlock})`);
    const wethContract = new Contract(WETH_ADDR, ERC20_ABI, activeProvider);
    const usdcContract = new Contract(USDC_ADDR, ERC20_ABI, activeProvider);
    const [ethBal, wethBal, usdcBal, allowance, nonce] = await Promise.all([
        activeProvider.getBalance(OPERATOR_ADDR),
        wethContract.balanceOf(OPERATOR_ADDR),
        usdcContract.balanceOf(OPERATOR_ADDR),
        wethContract.allowance(OPERATOR_ADDR, UNISWAP_ROUTER),
        activeProvider.getTransactionCount(OPERATOR_ADDR)
    ]);
    const ethFormatted = formatEther(ethBal);
    const wethFormatted = formatEther(wethBal);
    const usdcFormatted = formatUnits(usdcBal, 6);
    const allowanceFormatted = formatEther(allowance);
    console.log('\n[STAGE 2] Authoritative Live On-Chain State:');
    console.log('  ETH_BALANCE:          ', ethFormatted, 'ETH (', ethBal.toString(), 'wei)');
    console.log('  WETH_BALANCE:         ', wethFormatted, 'WETH (', wethBal.toString(), 'wei)');
    console.log('  USDC_BALANCE:         ', usdcFormatted, 'USDC (', usdcBal.toString(), 'raw)');
    console.log('  WETH_ALLOWANCE:       ', allowanceFormatted, 'WETH (', allowance.toString(), 'wei)');
    console.log('  SIGNER_NONCE:         ', nonce);
    const ethNumber = Number(ethFormatted);
    const requirementMet = ethNumber >= REQUIRED_ETH_MIN;
    console.log('\n[STAGE 3] Funding Threshold Evaluation:');
    console.log('  REQUIRED_ETH:         ', REQUIRED_ETH_MIN, 'ETH');
    console.log('  CURRENT_ETH:          ', ethFormatted, 'ETH');
    console.log('  REQUIREMENT_MET:      ', requirementMet ? 'TRUE' : 'FALSE');
    console.log('\n================================================================');
    console.log('VERIFICATION COMPLETE');
    console.log('================================================================');
    return {
        chainId: ARBITRUM_CHAIN_ID,
        rpcConsensus: true,
        ethBalance: ethFormatted,
        wethBalance: wethFormatted,
        usdcBalance: usdcFormatted,
        wethAllowance: allowanceFormatted,
        requiredEth: REQUIRED_ETH_MIN,
        requirementMet
    };
}
if (require.main === module) {
    runFundingVerification().catch((err) => {
        console.error('\n[FATAL] Funding verification failed:', err);
        process.exit(1);
    });
}
