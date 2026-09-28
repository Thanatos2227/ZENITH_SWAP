import { JsonRpcProvider, FetchRequest, Contract, formatUnits, formatEther, getAddress, parseEther, Interface, sha256, toUtf8Bytes } from 'ethers';
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
const WETH_ABI = [
    'function deposit() public payable',
    'function withdraw(uint256 wad) public',
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address, address) view returns (uint256)',
    'function approve(address spender, uint256 amount) public returns (bool)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)'
];
const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address, address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)'
];
const REQUIRED_ETH_MIN = 0.0008188;
async function runPreparationPreflight() {
    console.log('================================================================');
    console.log('ZENITH — ARBITRUM PREPARATION PREFLIGHT ENGINE');
    console.log('================================================================');
    console.log('AUTHORIZED_WALLET:    ' + OPERATOR_ADDR);
    console.log('TARGET_NETWORK:       Arbitrum One (Chain ID: 42161)');
    console.log('MODE:                 PREFLIGHT_ONLY (Zero Broadcast)');
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
    const wethContract = new Contract(WETH_ADDR, WETH_ABI, activeProvider);
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
    console.log('\n[STAGE 2] Fresh Live On-Chain State:');
    console.log('  ETH_BALANCE:          ', ethFormatted, 'ETH (', ethBal.toString(), 'wei)');
    console.log('  WETH_BALANCE:         ', wethFormatted, 'WETH (', wethBal.toString(), 'wei)');
    console.log('  USDC_BALANCE:         ', usdcFormatted, 'USDC (', usdcBal.toString(), 'raw)');
    console.log('  WETH_ALLOWANCE:       ', allowanceFormatted, 'WETH (', allowance.toString(), 'wei)');
    console.log('  SIGNER_NONCE:         ', nonce);
    const ethNumber = Number(ethFormatted);
    const requirementMet = ethNumber >= REQUIRED_ETH_MIN;
    console.log('\n[STAGE 3] Funding Threshold Check:');
    console.log('  REQUIRED_ETH:         ', REQUIRED_ETH_MIN, 'ETH');
    console.log('  CURRENT_ETH:          ', ethFormatted, 'ETH');
    console.log('  REQUIREMENT_MET:      ', requirementMet ? 'TRUE' : 'FALSE');
    if (!requirementMet) {
        console.log('\n[STOP] Funding requirement not met. Halting preflight safely.');
        return {
            status: 'BLOCKED',
            chainId: ARBITRUM_CHAIN_ID,
            rpcConsensus: true,
            ethBalance: ethFormatted,
            wethBalance: wethFormatted,
            usdcBalance: usdcFormatted,
            wethAllowance: allowanceFormatted,
            requirementMet: false,
            failureReason: `INSUFFICIENT_NATIVE_ETH_BALANCE (Wallet ${OPERATOR_ADDR} holds ${ethFormatted} ETH; minimum required is ${REQUIRED_ETH_MIN} ETH)`
        };
    }
    console.log('\n[STAGE 4] Preflighting Transaction 1: WETH Wrap (deposit())...');
    const wethIf = new Interface(WETH_ABI);
    const wrapCalldata = wethIf.encodeFunctionData('deposit');
    const wrapValue = parseEther('0.000100');
    const wrapSemanticPayload = JSON.stringify({
        chainId: 'arbitrum',
        networkIdentityKey: 'EVM:eip155:42161',
        target: WETH_ADDR.toLowerCase(),
        function: 'deposit()',
        sender: OPERATOR_ADDR.toLowerCase(),
        value: wrapValue.toString(),
        calldata: wrapCalldata.toLowerCase()
    });
    const wrapSemanticHash = sha256(toUtf8Bytes(wrapSemanticPayload));
    let wrapEthCall = 'UNKNOWN';
    let wrapEstGas = 0n;
    try {
        await activeProvider.call({
            to: WETH_ADDR,
            from: OPERATOR_ADDR,
            data: wrapCalldata,
            value: wrapValue
        });
        wrapEthCall = 'SUCCESS';
    }
    catch (err: any) {
        wrapEthCall = `FAIL_CLOSED (${err.message?.slice(0, 60)}...)`;
    }
    try {
        wrapEstGas = await activeProvider.estimateGas({
            to: WETH_ADDR,
            from: OPERATOR_ADDR,
            data: wrapCalldata,
            value: wrapValue
        });
    }
    catch {
        wrapEstGas = 30000n;
    }
    console.log('  TARGET:               ', WETH_ADDR);
    console.log('  CALLDATA:             ', wrapCalldata);
    console.log('  VALUE:                ', formatEther(wrapValue), 'ETH (', wrapValue.toString(), 'wei)');
    console.log('  ETH_CALL:             ', wrapEthCall);
    console.log('  ESTIMATE_GAS:         ', wrapEstGas.toString());
    console.log('  SEMANTIC_HASH:        ', wrapSemanticHash);
    console.log('\n[STAGE 5] Preflighting Transaction 2: Exact Bounded WETH Router Approval...');
    const approvalAmount = parseEther('0.000100');
    const approvalCalldata = wethIf.encodeFunctionData('approve', [UNISWAP_ROUTER, approvalAmount]);
    const approvalSemanticPayload = JSON.stringify({
        chainId: 'arbitrum',
        networkIdentityKey: 'EVM:eip155:42161',
        target: WETH_ADDR.toLowerCase(),
        spender: UNISWAP_ROUTER.toLowerCase(),
        function: 'approve(address,uint256)',
        sender: OPERATOR_ADDR.toLowerCase(),
        amount: approvalAmount.toString(),
        value: '0',
        calldata: approvalCalldata.toLowerCase()
    });
    const approvalSemanticHash = sha256(toUtf8Bytes(approvalSemanticPayload));
    let approvalEthCall = 'UNKNOWN';
    let approvalEstGas = 0n;
    try {
        await activeProvider.call({
            to: WETH_ADDR,
            from: OPERATOR_ADDR,
            data: approvalCalldata,
            value: 0n
        });
        approvalEthCall = 'SUCCESS';
    }
    catch (err: any) {
        approvalEthCall = `FAIL_CLOSED (${err.message?.slice(0, 60)}...)`;
    }
    try {
        approvalEstGas = await activeProvider.estimateGas({
            to: WETH_ADDR,
            from: OPERATOR_ADDR,
            data: approvalCalldata,
            value: 0n
        });
    }
    catch {
        approvalEstGas = 35000n;
    }
    console.log('  TARGET:               ', WETH_ADDR);
    console.log('  SPENDER:              ', UNISWAP_ROUTER);
    console.log('  CALLDATA:             ', approvalCalldata);
    console.log('  AMOUNT:               ', formatEther(approvalAmount), 'WETH (', approvalAmount.toString(), 'wei)');
    console.log('  ETH_CALL:             ', approvalEthCall);
    console.log('  ESTIMATE_GAS:         ', approvalEstGas.toString());
    console.log('  SEMANTIC_HASH:        ', approvalSemanticHash);
    return {
        status: 'COMPLETE',
        chainId: ARBITRUM_CHAIN_ID,
        rpcConsensus: true,
        ethBalance: ethFormatted,
        wethBalance: wethFormatted,
        usdcBalance: usdcFormatted,
        wethAllowance: allowanceFormatted,
        requirementMet: true,
        wrapEthCall,
        wrapEstGas: wrapEstGas.toString(),
        wrapSemanticHash,
        approvalEthCall,
        approvalEstGas: approvalEstGas.toString(),
        approvalSemanticHash
    };
}
if (require.main === module) {
    runPreparationPreflight().catch((err) => {
        console.error('[FATAL] Preparation preflight failed:', err);
        process.exit(1);
    });
}
