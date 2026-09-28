import { JsonRpcProvider, Wallet, formatEther } from 'ethers';
import { normalizePrivateKey, EXPECTED_OPERATOR_ADDRESS, OLD_COMPROMISED_WALLET_ADDRESS, SignerInitErrorCode } from './execute-controlled-polygon-crosschain';
import { resolveSecureSignerKey, SignerRuntimeSource } from './secure-runtime-loader';
export interface ProbeSignerResult {
    signerRuntimeSource: SignerRuntimeSource;
    signerConfigPresent: boolean;
    environmentConfigured: boolean;
    privateKeyFormat: 'VALID' | 'INVALID' | 'UNSET';
    walletInitialized: boolean;
    signerProviderInitialized: boolean;
    providerAttached: boolean;
    derivedAddress: string;
    authorizedAddress: string;
    authorizedAddressMatch: boolean;
    addressMatch: boolean;
    compromisedKeyDetected: boolean;
    polygonChainId: number;
    nonce: number;
    polBalance: string;
    signingGate: 'READY' | 'BLOCKED';
    errorCode?: SignerInitErrorCode;
}
export async function runSafeSignerProbe(): Promise<ProbeSignerResult> {
    const polygonRpc = process.env.POLYGON_MAINNET_RPC_URL || 'https://polygon-bor-rpc.publicnode.com';
    const provider = new JsonRpcProvider(polygonRpc, 137);
    const { rawKey, runtimeSource } = resolveSecureSignerKey();
    const hasRawKey = Boolean(rawKey && rawKey.trim());
    const normalizedKey = normalizePrivateKey(rawKey);
    let environmentConfigured = hasRawKey;
    let privateKeyFormat: 'VALID' | 'INVALID' | 'UNSET' = 'UNSET';
    let walletInitialized = false;
    let providerAttached = false;
    let derivedAddress = 'NONE';
    const authorizedAddress = EXPECTED_OPERATOR_ADDRESS;
    let addressMatch = false;
    let compromisedKeyDetected = false;
    let polygonChainId = 137;
    let nonce = 0;
    let polBalance = '0.0';
    let signingGate: 'READY' | 'BLOCKED' = 'BLOCKED';
    let errorCode: SignerInitErrorCode = 'NONE';
    if (!hasRawKey) {
        environmentConfigured = false;
        privateKeyFormat = 'UNSET';
        errorCode = 'EMPTY_KEY';
    }
    else if (!normalizedKey) {
        environmentConfigured = true;
        privateKeyFormat = 'INVALID';
        errorCode = 'INVALID_PRIVATE_KEY_FORMAT';
    }
    else {
        privateKeyFormat = 'VALID';
        try {
            const wallet = new Wallet(normalizedKey, provider);
            walletInitialized = true;
            providerAttached = Boolean(wallet.provider);
            derivedAddress = wallet.address;
            if (derivedAddress.toLowerCase() === OLD_COMPROMISED_WALLET_ADDRESS.toLowerCase()) {
                compromisedKeyDetected = true;
                errorCode = 'COMPROMISED_KEY_DETECTED';
            }
            else {
                addressMatch = derivedAddress.toLowerCase() === authorizedAddress.toLowerCase();
                if (!addressMatch) {
                    errorCode = 'SIGNER_ADDRESS_MISMATCH';
                }
            }
            if (walletInitialized && providerAttached && addressMatch && !compromisedKeyDetected) {
                signingGate = 'READY';
            }
        }
        catch {
            walletInitialized = false;
            providerAttached = false;
            privateKeyFormat = 'INVALID';
            errorCode = 'INVALID_PRIVATE_KEY_FORMAT';
        }
    }
    const queryTarget = walletInitialized && addressMatch ? derivedAddress : authorizedAddress;
    try {
        const network = await provider.getNetwork();
        polygonChainId = Number(network.chainId);
        const [balanceWei, txCount] = await Promise.all([
            provider.getBalance(queryTarget),
            provider.getTransactionCount(queryTarget)
        ]);
        polBalance = `${formatEther(balanceWei)} POL`;
        nonce = txCount;
    }
    catch (err: any) {
        console.warn(`[Probe Note] RPC query warning: ${err.message}`);
    }
    console.log('SAFE SIGNER PROBE');
    console.log('-----------------');
    console.log(`SIGNER_RUNTIME_SOURCE = ${runtimeSource}`);
    console.log(`SIGNER_CONFIG_PRESENT = ${hasRawKey ? 'TRUE' : 'FALSE'}`);
    console.log(`SIGNER_PROVIDER_INITIALIZED = ${walletInitialized && providerAttached ? 'TRUE' : 'FALSE'}`);
    console.log(`DERIVED_ADDRESS = ${walletInitialized ? derivedAddress : 'NONE'}`);
    console.log(`AUTHORIZED_ADDRESS_MATCH = ${addressMatch ? 'TRUE' : 'FALSE'}`);
    console.log(`SIGNING_GATE = ${signingGate}`);
    console.log('-----------------');
    console.log(`Polygon chain ID: ${polygonChainId}`);
    console.log(`Nonce: ${nonce}`);
    console.log(`POL balance: ${polBalance}`);
    if (errorCode !== 'NONE') {
        console.log(`Error code: ${errorCode}`);
    }
    console.log('-----------------');
    return {
        signerRuntimeSource: runtimeSource,
        signerConfigPresent: hasRawKey,
        environmentConfigured,
        privateKeyFormat,
        walletInitialized,
        signerProviderInitialized: walletInitialized && providerAttached,
        providerAttached,
        derivedAddress: walletInitialized ? derivedAddress : 'NONE',
        authorizedAddress,
        authorizedAddressMatch: addressMatch,
        addressMatch,
        compromisedKeyDetected,
        polygonChainId,
        nonce,
        polBalance,
        signingGate,
        errorCode
    };
}
if (require.main === module) {
    runSafeSignerProbe().catch((err) => {
        console.error('Probe error:', err);
        process.exit(1);
    });
}
