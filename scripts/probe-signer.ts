import { JsonRpcProvider, Wallet, formatEther } from 'ethers';
import {
  normalizePrivateKey,
  EXPECTED_OPERATOR_ADDRESS,
  OLD_COMPROMISED_WALLET_ADDRESS,
  SignerInitErrorCode
} from './execute-controlled-polygon-crosschain';

export interface ProbeSignerResult {
  environmentConfigured: boolean;
  privateKeyFormat: 'VALID' | 'INVALID' | 'UNSET';
  walletInitialized: boolean;
  providerAttached: boolean;
  derivedAddress: string;
  authorizedAddress: string;
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

  const rawKey = process.env.ZENITH_MAINNET_PRIVATE_KEY || process.env.TESTNET_PRIVATE_KEY;
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
  } else if (!normalizedKey) {
    environmentConfigured = true;
    privateKeyFormat = 'INVALID';
    errorCode = 'INVALID_PRIVATE_KEY_FORMAT';
  } else {
    privateKeyFormat = 'VALID';
    try {
      const wallet = new Wallet(normalizedKey, provider);
      walletInitialized = true;
      providerAttached = Boolean(wallet.provider);
      derivedAddress = wallet.address;

      if (derivedAddress.toLowerCase() === OLD_COMPROMISED_WALLET_ADDRESS.toLowerCase()) {
        compromisedKeyDetected = true;
        errorCode = 'COMPROMISED_KEY_DETECTED';
      } else {
        addressMatch = derivedAddress.toLowerCase() === authorizedAddress.toLowerCase();
        if (!addressMatch) {
          errorCode = 'SIGNER_ADDRESS_MISMATCH';
        }
      }

      if (walletInitialized && providerAttached && addressMatch && !compromisedKeyDetected) {
        signingGate = 'READY';
      }
    } catch {
      walletInitialized = false;
      providerAttached = false;
      privateKeyFormat = 'INVALID';
      errorCode = 'INVALID_PRIVATE_KEY_FORMAT';
    }
  }

  // Query on-chain data for authorized operator address or derived address
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
  } catch (err: any) {
    console.warn(`[Probe Note] RPC query warning: ${err.message}`);
  }

  console.log('SAFE SIGNER PROBE');
  console.log('-----------------');
  console.log(`Environment configured: ${environmentConfigured}`);
  console.log(`Private key format: ${privateKeyFormat}`);
  console.log(`Wallet initialized: ${walletInitialized}`);
  console.log(`Provider attached: ${providerAttached}`);
  console.log(`Derived address: ${derivedAddress}`);
  console.log(`Authorized address: ${authorizedAddress}`);
  console.log(`Address match: ${addressMatch}`);
  console.log(`Polygon chain ID: ${polygonChainId}`);
  console.log(`Nonce: ${nonce}`);
  console.log(`POL balance: ${polBalance}`);
  console.log(`Signing gate: ${signingGate}`);
  if (errorCode !== 'NONE') {
    console.log(`Error code: ${errorCode}`);
  }
  console.log('-----------------');

  return {
    environmentConfigured,
    privateKeyFormat,
    walletInitialized,
    providerAttached,
    derivedAddress,
    authorizedAddress,
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
