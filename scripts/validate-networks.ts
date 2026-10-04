import { defaultAuthoritativeNetworkRegistry, ZENITH_AUTHORITATIVE_NETWORKS } from '../packages/chains/src';

interface NetworkValidationError {
    networkKey: string;
    chainId?: string | number;
    issue: string;
}

export function validateNetworkRegistry(): NetworkValidationError[] {
    const errors: NetworkValidationError[] = [];
    const evmChainIdMap = new Map<number, string>();

    const networks = defaultAuthoritativeNetworkRegistry.getNetworks();
    if (!networks || networks.length === 0) {
        errors.push({ networkKey: 'GLOBAL', issue: 'Network registry is empty.' });
        return errors;
    }

    for (const net of networks) {
        const key = net.networkId;

        // 1. Mandatory Identity Check
        if (!key) {
            errors.push({ networkKey: 'UNKNOWN', issue: 'Missing network key / ID.' });
            continue;
        }

        if (!net.family) {
            errors.push({ networkKey: key, issue: 'Missing execution environment family.' });
        }

        // 2. EVM Chain ID Collision & Integrity Check
        if (net.family === 'EVM') {
            if (typeof net.numericChainId !== 'number' || net.numericChainId <= 0) {
                errors.push({ networkKey: key, issue: `Invalid EVM numeric chain ID: ${net.numericChainId}` });
            } else {
                if (evmChainIdMap.has(net.numericChainId)) {
                    const existingKey = evmChainIdMap.get(net.numericChainId);
                    errors.push({
                        networkKey: key,
                        chainId: net.numericChainId,
                        issue: `Duplicate EVM Chain ID ${net.numericChainId} with network '${existingKey}'`
                    });
                } else {
                    evmChainIdMap.set(net.numericChainId, key);
                }
            }
        }

        // 3. RPC Validation
        const rpcEndpoints = net.rpcEndpoints || [];
        const isExecutionSupported = net.gasModel?.supportedExecutionAdapter !== 'UnsupportedExecutionAdapter';
        const isExecutionActive = (net.family === 'EVM' && isExecutionSupported) || net.operationalStatus === 'SUPPORTED' || net.operationalStatus === 'TESTNET_ONLY';
        if (isExecutionActive && rpcEndpoints.length === 0) {
            errors.push({ networkKey: key, issue: 'No RPC endpoints configured for active execution network.' });
        } else {
            for (const rpc of rpcEndpoints) {
                if (!rpc.url || (!rpc.url.startsWith('http://') && !rpc.url.startsWith('https://') && !rpc.url.startsWith('wss://'))) {
                    errors.push({ networkKey: key, issue: `Invalid RPC URL format: ${rpc.url}` });
                }
            }
        }

        // 4. Native Asset Validation
        if (!net.nativeAsset || !net.nativeAsset.symbol) {
            errors.push({ networkKey: key, issue: 'Missing native asset configuration.' });
        }

        // 5. Finality Policy Check
        if (net.family === 'EVM' && (!net.finality || net.finality.safeDepth < 1)) {
            errors.push({ networkKey: key, issue: 'Invalid or missing finality safeDepth rule.' });
        }
    }

    // 6. Testnet Specific Matrix Check
    const requiredTestnets = [
        { key: 'sepolia', chainId: 11155111 },
        { key: 'arbitrum_sepolia', chainId: 421614 },
        { key: 'polygon_amoy', chainId: 80002 },
        { key: 'base_sepolia', chainId: 84532 }
    ];

    for (const testnet of requiredTestnets) {
        const found = networks.find(
            n => n.numericChainId === testnet.chainId || n.networkId === testnet.key
        );
        if (!found) {
            errors.push({
                networkKey: testnet.key,
                chainId: testnet.chainId,
                issue: `Required testnet '${testnet.key}' (Chain ID ${testnet.chainId}) not found in registry.`
            });
        }
    }

    return errors;
}

if (require.main === module) {
    console.log('🌐 Validating ZENITH Network & Chain Registry configurations...');
    const errors = validateNetworkRegistry();
    if (errors.length > 0) {
        console.error(`❌ Network Registry Validation FAILED with ${errors.length} error(s):`);
        for (const err of errors) {
            console.error(`  - [${err.networkKey}] (ChainId: ${err.chainId ?? 'N/A'}): ${err.issue}`);
        }
        process.exit(1);
    } else {
        console.log(`✅ Network Registry Validation PASSED: All supported networks and testnets verified.`);
    }
}
