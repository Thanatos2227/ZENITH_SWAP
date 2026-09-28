import { JsonRpcProvider, FetchRequest, Contract, Interface, formatUnits, formatEther, Wallet, getAddress, parseEther, sha256, toUtf8Bytes } from 'ethers';
import { normalizePrivateKey, EXPECTED_OPERATOR_ADDRESS } from './execute-controlled-polygon-crosschain';
import { resolveSecureSignerKey } from './secure-runtime-loader';
const HARD_PROCESS_TIMEOUT_MS = 300000;
const PROVIDER_OPERATION_TIMEOUT_MS = 60000;
const processTimer = setTimeout(() => {
    console.error('\n[FATAL] Execution Process Timeout Exceeded. Fail-closed invoked.');
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
    'function symbol() view returns (string)',
    'event Deposit(address indexed dst, uint256 wad)',
    'event Approval(address indexed src, address indexed guy, uint256 wad)'
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
        }
        catch {
            continue;
        }
    }
    throw new Error('All Polygon RPC providers failed health check');
}
export async function executeControlledWrap(): Promise<{
    txHash: string;
    receiptStatus: number;
    gasUsed: bigint;
    blockNumber: number;
    newWmaticBal: bigint;
}> {
    const provider = await getQuorumProvider();
    const { rawKey } = resolveSecureSignerKey();
    const normalizedKey = normalizePrivateKey(rawKey);
    if (!normalizedKey)
        throw new Error('Signer unavailable');
    const wallet = new Wallet(normalizedKey, provider);
    if (wallet.address.toLowerCase() !== EXPECTED_OPERATOR_ADDRESS.toLowerCase()) {
        throw new Error('Signer address mismatch');
    }
    const wmaticContract = new Contract(WMATIC_ADDR, WMATIC_ABI, wallet);
    const wrapAmountWei = parseEther('1.0');
    const depositData = wmaticContract.interface.encodeFunctionData('deposit');
    await provider.call({
        from: EXPECTED_OPERATOR_ADDRESS,
        to: WMATIC_ADDR,
        value: wrapAmountWei,
        data: depositData
    });
    const estimatedGas = await provider.estimateGas({
        from: EXPECTED_OPERATOR_ADDRESS,
        to: WMATIC_ADDR,
        value: wrapAmountWei,
        data: depositData
    });
    const feeData = await provider.getFeeData();
    const maxFeePerGas = ((feeData.maxFeePerGas || parseEther('0.0000003')) * 13n) / 10n;
    const maxPriorityFeePerGas = ((feeData.maxPriorityFeePerGas || parseEther('0.000000035')) * 13n) / 10n;
    const tx = await wallet.sendTransaction({
        to: WMATIC_ADDR,
        value: wrapAmountWei,
        data: depositData,
        gasLimit: (estimatedGas * 13n) / 10n,
        maxFeePerGas,
        maxPriorityFeePerGas
    });
    const receipt = await tx.wait(2);
    if (!receipt || receipt.status !== 1) {
        throw new Error(`Wrap transaction failed on-chain. Status: ${receipt?.status}`);
    }
    const newWmaticBal = await wmaticContract.balanceOf(EXPECTED_OPERATOR_ADDRESS);
    return {
        txHash: tx.hash,
        receiptStatus: receipt.status,
        gasUsed: receipt.gasUsed,
        blockNumber: receipt.blockNumber,
        newWmaticBal
    };
}
export async function executeControlledApproval(): Promise<{
    txHash: string;
    receiptStatus: number;
    gasUsed: bigint;
    blockNumber: number;
    newAllowance: bigint;
}> {
    const provider = await getQuorumProvider();
    const { rawKey } = resolveSecureSignerKey();
    const normalizedKey = normalizePrivateKey(rawKey);
    if (!normalizedKey)
        throw new Error('Signer unavailable');
    const wallet = new Wallet(normalizedKey, provider);
    if (wallet.address.toLowerCase() !== EXPECTED_OPERATOR_ADDRESS.toLowerCase()) {
        throw new Error('Signer address mismatch');
    }
    const wmaticContract = new Contract(WMATIC_ADDR, WMATIC_ABI, wallet);
    const approveAmountWei = parseEther('1.0');
    const approveData = wmaticContract.interface.encodeFunctionData('approve', [QUICKSWAP_ROUTER, approveAmountWei]);
    await provider.call({
        from: EXPECTED_OPERATOR_ADDRESS,
        to: WMATIC_ADDR,
        value: 0n,
        data: approveData
    });
    const estimatedGas = await provider.estimateGas({
        from: EXPECTED_OPERATOR_ADDRESS,
        to: WMATIC_ADDR,
        value: 0n,
        data: approveData
    });
    const feeData = await provider.getFeeData();
    const maxFeePerGas = ((feeData.maxFeePerGas || parseEther('0.0000003')) * 13n) / 10n;
    const maxPriorityFeePerGas = ((feeData.maxPriorityFeePerGas || parseEther('0.000000035')) * 13n) / 10n;
    const tx = await wallet.sendTransaction({
        to: WMATIC_ADDR,
        value: 0n,
        data: approveData,
        gasLimit: (estimatedGas * 13n) / 10n,
        maxFeePerGas,
        maxPriorityFeePerGas
    });
    const receipt = await tx.wait(2);
    if (!receipt || receipt.status !== 1) {
        throw new Error(`Approval transaction failed on-chain. Status: ${receipt?.status}`);
    }
    const newAllowance = await wmaticContract.allowance(EXPECTED_OPERATOR_ADDRESS, QUICKSWAP_ROUTER);
    return {
        txHash: tx.hash,
        receiptStatus: receipt.status,
        gasUsed: receipt.gasUsed,
        blockNumber: receipt.blockNumber,
        newAllowance
    };
}
if (require.main === module) {
    const mode = (process.argv[2] || 'WRAP').toUpperCase();
    if (mode === 'WRAP') {
        console.log('[STAGE] Executing Authorized POL -> WMATIC Wrap on Polygon Mainnet...');
        executeControlledWrap()
            .then((res) => {
            console.log('\n================================================================');
            console.log('WRAP EXECUTION COMPLETE');
            console.log('================================================================');
            console.log(`TX_HASH:             ${res.txHash}`);
            console.log(`RECEIPT_STATUS:      ${res.receiptStatus === 1 ? 'SUCCESS (1)' : 'REVERT (0)'}`);
            console.log(`BLOCK_NUMBER:        ${res.blockNumber}`);
            console.log(`GAS_USED:            ${res.gasUsed.toString()}`);
            console.log(`NEW_WMATIC_BALANCE:  ${formatUnits(res.newWmaticBal, 18)} WMATIC (${res.newWmaticBal.toString()} wei)`);
            console.log('================================================================');
            process.exit(0);
        })
            .catch((err) => {
            console.error('\n[FATAL] Wrap Execution Error:', err);
            process.exit(1);
        });
    }
    else if (mode === 'APPROVE') {
        console.log('[STAGE] Executing Authorized WMATIC Approval on Polygon Mainnet...');
        executeControlledApproval()
            .then((res) => {
            console.log('\n================================================================');
            console.log('APPROVAL EXECUTION COMPLETE');
            console.log('================================================================');
            console.log(`TX_HASH:             ${res.txHash}`);
            console.log(`RECEIPT_STATUS:      ${res.receiptStatus === 1 ? 'SUCCESS (1)' : 'REVERT (0)'}`);
            console.log(`BLOCK_NUMBER:        ${res.blockNumber}`);
            console.log(`GAS_USED:            ${res.gasUsed.toString()}`);
            console.log(`NEW_ALLOWANCE:       ${formatUnits(res.newAllowance, 18)} WMATIC (${res.newAllowance.toString()} wei)`);
            console.log('================================================================');
            process.exit(0);
        })
            .catch((err) => {
            console.error('\n[FATAL] Approval Execution Error:', err);
            process.exit(1);
        });
    }
}
