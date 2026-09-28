import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AuthoritativeNetworkIdentity, AuthoritativeNetworkRegistry, defaultAuthoritativeNetworkRegistry, buildNetworkIdentityKey, parseNetworkIdentityKey, NetworkRegistryValidationEngine, ZENITH_AUTHORITATIVE_NETWORKS, defaultChainRegistry } from '../packages/chains/src';
import { performance } from 'node:perf_hooks';
function createPrng(seed = 0x7a5c37) {
    let s = seed >>> 0;
    return function () {
        s = (Math.imul(1664525, s) + 1013904223) >>> 0;
        return s / 4294967296;
    };
}
describe('ZENITH — PHASE 2 TASK 37: AUTHORITATIVE NETWORK REGISTRY & CHAIN METADATA CERTIFICATION', () => {
    describe('Suite 1: Canonical Identity Model & Key Generation', () => {
        it('1.1 buildNetworkIdentityKey formats EVM identity key as EVM:eip155:chainId', () => {
            const key = buildNetworkIdentityKey('EVM', 'eip155', 1);
            assert.strictEqual(key, 'EVM:eip155:1');
        });
        it('1.2 buildNetworkIdentityKey formats Solana identity key with family and namespace', () => {
            const key = buildNetworkIdentityKey('SOLANA', 'solana', 'mainnet-beta');
            assert.strictEqual(key, 'SOLANA:solana:mainnet-beta');
        });
        it('1.3 buildNetworkIdentityKey formats Move identity key for Aptos', () => {
            const key = buildNetworkIdentityKey('MOVE', 'move', 'aptos-mainnet');
            assert.strictEqual(key, 'MOVE:move:aptos-mainnet');
        });
        it('1.4 buildNetworkIdentityKey formats Cosmos identity key for Cosmos Hub', () => {
            const key = buildNetworkIdentityKey('COSMOS', 'cosmos', 'cosmoshub-4');
            assert.strictEqual(key, 'COSMOS:cosmos:cosmoshub-4');
        });
        it('1.5 parseNetworkIdentityKey accurately extracts family, namespace, and chainId', () => {
            const parsed = parseNetworkIdentityKey('EVM:eip155:42161');
            assert.strictEqual(parsed.family, 'EVM');
            assert.strictEqual(parsed.namespace, 'eip155');
            assert.strictEqual(parsed.chainId, '42161');
        });
        it('1.6 parseNetworkIdentityKey throws on malformed key format', () => {
            assert.throws(() => parseNetworkIdentityKey('malformed_key'), /Invalid NetworkIdentityKey format/);
        });
    });
    describe('Suite 2: Chain Identity Namespace & Family Alignment', () => {
        it('2.1 Ethereum Mainnet declares EVM family with eip155 namespace', () => {
            const net = defaultAuthoritativeNetworkRegistry.getNetwork('ethereum')!;
            assert.strictEqual(net.family, 'EVM');
            assert.strictEqual(net.namespace, 'eip155');
            assert.strictEqual(net.chainId, 1);
            assert.strictEqual(net.numericChainId, 1);
            assert.strictEqual(net.networkIdentityKey, 'EVM:eip155:1');
        });
        it('2.2 Solana declares SOLANA family with solana namespace and non-numeric chainId', () => {
            const net = defaultAuthoritativeNetworkRegistry.getNetwork('solana')!;
            assert.strictEqual(net.family, 'SOLANA');
            assert.strictEqual(net.namespace, 'solana');
            assert.strictEqual(net.chainId, 'mainnet-beta');
            assert.strictEqual(net.numericChainId, undefined);
        });
        it('2.3 Aptos declares MOVE family and does not collide with EVM chain ID 1', () => {
            const aptos = defaultAuthoritativeNetworkRegistry.getNetwork('aptos')!;
            const eth = defaultAuthoritativeNetworkRegistry.getNetwork('ethereum')!;
            assert.strictEqual(aptos.family, 'MOVE');
            assert.strictEqual(aptos.numericChainId, undefined);
            assert.notStrictEqual(aptos.networkIdentityKey, eth.networkIdentityKey);
        });
        it('2.4 Robinhood Orbit L3 has disambiguated chain ID 421610 distinct from Arbitrum 42161', () => {
            const robinhood = defaultAuthoritativeNetworkRegistry.getNetwork('robinhood')!;
            const arb = defaultAuthoritativeNetworkRegistry.getNetwork('arbitrum')!;
            assert.strictEqual(robinhood.numericChainId, 421610);
            assert.strictEqual(arb.numericChainId, 42161);
            assert.notStrictEqual(robinhood.networkIdentityKey, arb.networkIdentityKey);
        });
        it('2.5 Bitcoin declares BITCOIN family with bip122 namespace', () => {
            const net = defaultAuthoritativeNetworkRegistry.getNetwork('bitcoin')!;
            assert.strictEqual(net.family, 'BITCOIN');
            assert.strictEqual(net.namespace, 'bip122');
            assert.strictEqual(net.chainId, 'bitcoin-mainnet');
        });
        it('2.6 Cosmos Hub declares COSMOS family with cosmos namespace', () => {
            const net = defaultAuthoritativeNetworkRegistry.getNetwork('cosmos')!;
            assert.strictEqual(net.family, 'COSMOS');
            assert.strictEqual(net.namespace, 'cosmos');
            assert.strictEqual(net.chainId, 'cosmoshub-4');
        });
    });
    describe('Suite 3: Environment Model & Mainnet/Testnet Separation', () => {
        it('3.1 Ethereum is explicitly classified as MAINNET with isMainnet=true, isTestnet=false', () => {
            const net = defaultAuthoritativeNetworkRegistry.getNetwork('ethereum')!;
            assert.strictEqual(net.environment, 'MAINNET');
            assert.strictEqual(net.isMainnet, true);
            assert.strictEqual(net.isTestnet, false);
        });
        it('3.2 Polygon Amoy is explicitly classified as TESTNET with isMainnet=false, isTestnet=true', () => {
            const net = defaultAuthoritativeNetworkRegistry.getNetwork('polygon_amoy')!;
            assert.strictEqual(net.environment, 'TESTNET');
            assert.strictEqual(net.isMainnet, false);
            assert.strictEqual(net.isTestnet, true);
        });
        it('3.3 getMainnets() returns only networks with environment=MAINNET', () => {
            const mainnets = defaultAuthoritativeNetworkRegistry.getMainnets();
            assert.ok(mainnets.length > 40);
            for (const net of mainnets) {
                assert.strictEqual(net.environment, 'MAINNET');
                assert.strictEqual(net.isMainnet, true);
                assert.strictEqual(net.isTestnet, false);
            }
        });
        it('3.4 getTestnets() returns exactly the 5 certified testnet networks', () => {
            const testnets = defaultAuthoritativeNetworkRegistry.getTestnets();
            assert.strictEqual(testnets.length, 5);
            const testnetIds = testnets.map((t) => t.networkId).sort();
            assert.deepStrictEqual(testnetIds, [
                'arbitrum_sepolia',
                'base_sepolia',
                'optimism_sepolia',
                'polygon_amoy',
                'sepolia'
            ]);
            for (const net of testnets) {
                assert.strictEqual(net.environment, 'TESTNET');
                assert.strictEqual(net.isMainnet, false);
                assert.strictEqual(net.isTestnet, true);
            }
        });
        it('3.5 isMainnet() and isTestnet() helpers return accurate boolean states', () => {
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.isMainnet('ethereum'), true);
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.isTestnet('ethereum'), false);
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.isMainnet('polygon_amoy'), false);
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.isTestnet('polygon_amoy'), true);
        });
        it('3.6 Unregistered network returns false for both isMainnet and isTestnet', () => {
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.isMainnet('unknown_chain'), false);
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.isTestnet('unknown_chain'), false);
        });
    });
    describe('Suite 4: Native Asset Metadata & Bounds', () => {
        it('4.1 Ethereum native asset is ETH with 18 decimals and WETH wrappedAddress', () => {
            const asset = defaultAuthoritativeNetworkRegistry.getNativeAsset('ethereum')!;
            assert.strictEqual(asset.symbol, 'ETH');
            assert.strictEqual(asset.name, 'Ether');
            assert.strictEqual(asset.decimals, 18);
            assert.strictEqual(asset.isGasAsset, true);
            assert.strictEqual(asset.isWrappedEquivalent, false);
            assert.strictEqual(asset.wrappedAddress, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
        });
        it('4.2 Polygon native asset is POL with 18 decimals and WPOL wrappedAddress', () => {
            const asset = defaultAuthoritativeNetworkRegistry.getNativeAsset('polygon')!;
            assert.strictEqual(asset.symbol, 'POL');
            assert.strictEqual(asset.decimals, 18);
            assert.strictEqual(asset.isGasAsset, true);
            assert.strictEqual(asset.isWrappedEquivalent, false);
        });
        it('4.3 Solana native asset is SOL with 9 decimals and WSOL wrappedAddress', () => {
            const asset = defaultAuthoritativeNetworkRegistry.getNativeAsset('solana')!;
            assert.strictEqual(asset.symbol, 'SOL');
            assert.strictEqual(asset.decimals, 9);
            assert.strictEqual(asset.isGasAsset, true);
            assert.strictEqual(asset.wrappedAddress, 'So11111111111111111111111111111111111111112');
        });
        it('4.4 Bitcoin native asset is BTC with 8 decimals and zero wrapped address', () => {
            const asset = defaultAuthoritativeNetworkRegistry.getNativeAsset('bitcoin')!;
            assert.strictEqual(asset.symbol, 'BTC');
            assert.strictEqual(asset.decimals, 8);
            assert.strictEqual(asset.isGasAsset, true);
        });
        it('4.5 All 58 networks have native decimals between 0 and 24 inclusive', () => {
            const networks = defaultAuthoritativeNetworkRegistry.getNetworks();
            for (const net of networks) {
                assert.ok(Number.isInteger(net.nativeDecimals) && net.nativeDecimals >= 0 && net.nativeDecimals <= 24, `Network ${net.networkId} has invalid decimals: ${net.nativeDecimals}`);
                assert.strictEqual(net.nativeAsset.decimals, net.nativeDecimals);
            }
        });
        it('4.6 getNativeAsset returns undefined for unregistered network', () => {
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.getNativeAsset('nonexistent_network'), undefined);
        });
    });
    describe('Suite 5: Gas Model Registry & Fee Mechanisms', () => {
        it('5.1 Ethereum declares EVM_EIP1559 gas model with dynamic base fee and tip', () => {
            const gas = defaultAuthoritativeNetworkRegistry.getGasModel('ethereum')!;
            assert.strictEqual(gas.modelType, 'EVM_EIP1559');
            assert.strictEqual(gas.gasUnit, 'gas');
            assert.strictEqual(gas.feeAssetSymbol, 'ETH');
            assert.strictEqual(gas.baseFeeBehavior, 'DYNAMIC_BASE_FEE');
            assert.strictEqual(gas.priorityFeeBehavior, 'TIP');
            assert.strictEqual(gas.feeEstimationCapability, true);
        });
        it('5.2 Arbitrum declares EVM_ARBITRUM_L2 gas model with L1 calldata poster compensation', () => {
            const gas = defaultAuthoritativeNetworkRegistry.getGasModel('arbitrum')!;
            assert.strictEqual(gas.modelType, 'EVM_ARBITRUM_L2');
            assert.strictEqual(gas.l2FeeComponents?.l1DataFee, true);
            assert.strictEqual(gas.l2FeeComponents?.calldataPosterDiscount, true);
        });
        it('5.3 Base declares EVM_OP_STACK_L2 gas model with L1 DA fee', () => {
            const gas = defaultAuthoritativeNetworkRegistry.getGasModel('base')!;
            assert.strictEqual(gas.modelType, 'EVM_OP_STACK_L2');
            assert.strictEqual(gas.l2FeeComponents?.l1DataFee, true);
        });
        it('5.4 BNB Chain declares EVM_LEGACY gas model without dynamic base fee', () => {
            const gas = defaultAuthoritativeNetworkRegistry.getGasModel('bsc')!;
            assert.strictEqual(gas.modelType, 'EVM_LEGACY');
            assert.strictEqual(gas.baseFeeBehavior, 'NONE');
        });
        it('5.5 Solana declares SOLANA_FEE model with compute unit pricing', () => {
            const gas = defaultAuthoritativeNetworkRegistry.getGasModel('solana')!;
            assert.strictEqual(gas.modelType, 'SOLANA_FEE');
            assert.strictEqual(gas.gasUnit, 'compute_units');
            assert.strictEqual(gas.priorityFeeBehavior, 'COMPUTE_UNIT_PRICE');
        });
        it('5.6 Bitcoin declares UTXO_FEE model with auction-based fee rate in satoshis', () => {
            const gas = defaultAuthoritativeNetworkRegistry.getGasModel('bitcoin')!;
            assert.strictEqual(gas.modelType, 'UTXO_FEE');
            assert.strictEqual(gas.gasUnit, 'satoshis');
            assert.strictEqual(gas.baseFeeBehavior, 'AUCTION');
        });
    });
    describe('Suite 6: Finality Model Registry & Depths', () => {
        it('6.1 Polygon PoS declares CONFIRMATION_BASED finality with 128 safety blocks', () => {
            const finality = defaultAuthoritativeNetworkRegistry.getFinalityModel('polygon')!;
            assert.strictEqual(finality.model, 'CONFIRMATION_BASED');
            assert.strictEqual(finality.finalityDepthBlocks, 128);
            assert.strictEqual(finality.isDeterministic, false);
            assert.strictEqual(finality.status, 'KNOWN');
        });
        it('6.2 Arbitrum One declares OPTIMISTIC finality with 20 safety blocks', () => {
            const finality = defaultAuthoritativeNetworkRegistry.getFinalityModel('arbitrum')!;
            assert.strictEqual(finality.model, 'OPTIMISTIC');
            assert.strictEqual(finality.confirmationModel, 'SEQUENCER_SOFT');
            assert.strictEqual(finality.finalityDepthBlocks, 20);
            assert.strictEqual(finality.canonicalityVerification, 'L1_ROLLUP_VERIFICATION');
        });
        it('6.3 Avalanche declares INSTANT_FINALITY with 1 safety block via Snowman consensus', () => {
            const finality = defaultAuthoritativeNetworkRegistry.getFinalityModel('avalanche')!;
            assert.strictEqual(finality.model, 'INSTANT_FINALITY');
            assert.strictEqual(finality.finalityDepthBlocks, 1);
            assert.strictEqual(finality.isDeterministic, true);
        });
        it('6.4 Linea and Scroll declare ZK_PROVEN finality with L1 rollup verification', () => {
            const linea = defaultAuthoritativeNetworkRegistry.getFinalityModel('linea')!;
            const scroll = defaultAuthoritativeNetworkRegistry.getFinalityModel('scroll')!;
            assert.strictEqual(linea.model, 'ZK_PROVEN');
            assert.strictEqual(scroll.model, 'ZK_PROVEN');
            assert.strictEqual(linea.canonicalityVerification, 'L1_ROLLUP_VERIFICATION');
        });
        it('6.5 Bitcoin declares PROBABILISTIC finality with 6 blocks depth', () => {
            const finality = defaultAuthoritativeNetworkRegistry.getFinalityModel('bitcoin')!;
            assert.strictEqual(finality.model, 'PROBABILISTIC');
            assert.strictEqual(finality.finalityDepthBlocks, 6);
            assert.strictEqual(finality.isDeterministic, false);
        });
        it('6.6 getFinalityModel returns undefined for unregistered network', () => {
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.getFinalityModel('nonexistent'), undefined);
        });
    });
    describe('Suite 7: RPC Metadata & Health Alignment', () => {
        it('7.1 Ethereum RPC endpoint matches networkId, family, chainId, and environment', () => {
            const rpcs = defaultAuthoritativeNetworkRegistry.getRpcMetadata('ethereum');
            assert.ok(rpcs.length >= 1);
            const rpc = rpcs[0];
            assert.strictEqual(rpc.networkId, 'ethereum');
            assert.strictEqual(rpc.expectedFamily, 'EVM');
            assert.strictEqual(rpc.expectedChainId, 1);
            assert.strictEqual(rpc.environment, 'MAINNET');
            assert.strictEqual(rpc.healthState, 'HEALTHY');
        });
        it('7.2 Testnet RPC endpoints are explicitly flagged with environment=TESTNET', () => {
            const rpcs = defaultAuthoritativeNetworkRegistry.getRpcMetadata('polygon_amoy');
            assert.ok(rpcs.length >= 1);
            assert.strictEqual(rpcs[0].environment, 'TESTNET');
            assert.strictEqual(rpcs[0].expectedChainId, 80002);
        });
        it('7.3 RPC metadata contains no private keys, passwords, or credentials', () => {
            const networks = defaultAuthoritativeNetworkRegistry.getNetworks();
            for (const net of networks) {
                for (const rpc of net.rpcEndpoints) {
                    assert.doesNotMatch(rpc.url, /(private[_-]?key|secret|password|bearer)/i);
                }
            }
        });
        it('7.4 getRpcMetadata returns empty array for network without endpoints', () => {
            const rpcs = defaultAuthoritativeNetworkRegistry.getRpcMetadata('bitcoin');
            assert.deepStrictEqual(rpcs, []);
        });
        it('7.5 getRpcMetadata returns empty array for unregistered network', () => {
            const rpcs = defaultAuthoritativeNetworkRegistry.getRpcMetadata('unregistered');
            assert.deepStrictEqual(rpcs, []);
        });
        it('7.6 All configured RPC endpoints declare explicit read and preflight capabilities', () => {
            const rpcs = defaultAuthoritativeNetworkRegistry.getRpcMetadata('arbitrum');
            assert.ok(rpcs.length >= 1);
            assert.strictEqual(typeof rpcs[0].readCapability, 'boolean');
            assert.strictEqual(typeof rpcs[0].preflightCapability, 'boolean');
            assert.strictEqual(typeof rpcs[0].broadcastCapability, 'boolean');
        });
    });
    describe('Suite 8: Explorer Metadata & URL Templates', () => {
        it('8.1 Ethereum explorer provides valid Etherscan URL templates', () => {
            const exp = defaultAuthoritativeNetworkRegistry.getExplorerMetadata('ethereum')!;
            assert.strictEqual(exp.explorerId, 'etherscan');
            assert.strictEqual(exp.baseUrl, 'https://etherscan.io');
            assert.strictEqual(exp.txUrlTemplate, 'https://etherscan.io/tx/{txHash}');
            assert.strictEqual(exp.addressUrlTemplate, 'https://etherscan.io/address/{address}');
            assert.strictEqual(exp.blockUrlTemplate, 'https://etherscan.io/block/{block}');
        });
        it('8.2 Polygon explorer provides valid PolygonScan URL templates', () => {
            const exp = defaultAuthoritativeNetworkRegistry.getExplorerMetadata('polygon')!;
            assert.strictEqual(exp.baseUrl, 'https://polygonscan.com');
            assert.strictEqual(exp.txUrlTemplate, 'https://polygonscan.com/tx/{txHash}');
        });
        it('8.3 Solana explorer provides valid Solscan URL templates', () => {
            const exp = defaultAuthoritativeNetworkRegistry.getExplorerMetadata('solana')!;
            assert.strictEqual(exp.baseUrl, 'https://solscan.io');
            assert.strictEqual(exp.txUrlTemplate, 'https://solscan.io/tx/{txHash}');
            assert.strictEqual(exp.addressUrlTemplate, 'https://solscan.io/account/{address}');
        });
        it('8.4 Unsupported / unverified explorer is explicitly marked status=UNKNOWN', () => {
            const exp = defaultAuthoritativeNetworkRegistry.getExplorerMetadata('robinhood')!;
            assert.strictEqual(exp.status, 'UNKNOWN');
        });
        it('8.5 getExplorerMetadata returns undefined for unregistered network', () => {
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.getExplorerMetadata('nonexistent'), undefined);
        });
    });
    describe('Suite 9: Deterministic Network Alias Resolution', () => {
        it('9.1 Resolves common EVM aliases to canonical networkId', () => {
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity('eth'), 'ethereum');
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity('mainnet'), 'ethereum');
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity('matic'), 'polygon');
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity('polygon-pos'), 'polygon');
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity('arb'), 'arbitrum');
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity('arbitrum-one'), 'arbitrum');
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity('op'), 'optimism');
        });
        it('9.2 Resolves numeric chain IDs as numbers or strings to canonical networkId', () => {
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity(1), 'ethereum');
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity('1'), 'ethereum');
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity(137), 'polygon');
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity('137'), 'polygon');
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity(42161), 'arbitrum');
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity('42161'), 'arbitrum');
        });
        it('9.3 Resolves composite identity keys to canonical networkId', () => {
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity('evm:eip155:1'), 'ethereum');
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity('evm:eip155:137'), 'polygon');
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity('solana:solana:mainnet-beta'), 'solana');
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity('move:move:aptos-mainnet'), 'aptos');
        });
        it('9.4 Resolves case-insensitively and trims whitespace', () => {
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity('  ETHEREUM  '), 'ethereum');
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity('MATIC'), 'polygon');
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity('Sol'), 'solana');
        });
        it('9.5 Returns undefined for unknown aliases or unregistered networks', () => {
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity('completely_unknown'), undefined);
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity(99999999), undefined);
        });
        it('9.6 getNetworkByAlias returns complete deep-cloned network identity', () => {
            const net = defaultAuthoritativeNetworkRegistry.getNetworkByAlias('matic')!;
            assert.ok(net);
            assert.strictEqual(net.networkId, 'polygon');
            assert.strictEqual(net.canonicalName, 'Polygon PoS Mainnet');
        });
    });
    describe('Suite 10: Authoritative Network Registry Query API', () => {
        it('10.1 getNetwork returns accurate identity for canonical ID', () => {
            const net = defaultAuthoritativeNetworkRegistry.getNetwork('base')!;
            assert.strictEqual(net.networkId, 'base');
            assert.strictEqual(net.canonicalName, 'Base Mainnet');
            assert.strictEqual(net.numericChainId, 8453);
        });
        it('10.2 getNetworkByChainIdentity returns accurate identity', () => {
            const net = defaultAuthoritativeNetworkRegistry.getNetworkByChainIdentity('EVM', 'eip155', 8453)!;
            assert.strictEqual(net.networkId, 'base');
            assert.strictEqual(net.numericChainId, 8453);
        });
        it('10.3 getNetworks() returns all 58 certified networks', () => {
            const all = defaultAuthoritativeNetworkRegistry.getNetworks();
            assert.strictEqual(all.length, 58);
        });
        it('10.4 getNetworksByFamily returns only matching family networks', () => {
            const evmNets = defaultAuthoritativeNetworkRegistry.getNetworksByFamily('EVM');
            assert.ok(evmNets.length > 30);
            for (const net of evmNets) {
                assert.strictEqual(net.family, 'EVM');
            }
            const solNets = defaultAuthoritativeNetworkRegistry.getNetworksByFamily('SOLANA');
            assert.strictEqual(solNets.length, 1);
            assert.strictEqual(solNets[0].networkId, 'solana');
        });
        it('10.5 getNetworksByEnvironment filters accurately', () => {
            const testnets = defaultAuthoritativeNetworkRegistry.getNetworksByEnvironment('TESTNET');
            assert.strictEqual(testnets.length, 5);
            const mainnets = defaultAuthoritativeNetworkRegistry.getNetworksByEnvironment('MAINNET');
            assert.strictEqual(mainnets.length, 53);
        });
        it('10.6 isNetworkRegistered accurately verifies existence', () => {
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.isNetworkRegistered('ethereum'), true);
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.isNetworkRegistered('matic'), true);
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.isNetworkRegistered(137), true);
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.isNetworkRegistered('fake_net'), false);
        });
        it('10.7 getCapabilityProfile links to Task 36 capability profile', () => {
            const profile = defaultAuthoritativeNetworkRegistry.getCapabilityProfile('polygon')!;
            assert.ok(profile);
            assert.strictEqual(profile.overallCapabilityLevel, 'LIVE_VERIFIED');
            assert.strictEqual(profile.capabilityRank, 5);
        });
        it('10.8 getOnboardingState returns accurate onboarding lifecycle state', () => {
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.getOnboardingState('ethereum'), 'LIVE_VERIFIED');
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.getOnboardingState('polygon_amoy'), 'EXECUTION_ENABLED');
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.getOnboardingState('solana'), 'QUOTE_ENABLED');
            assert.strictEqual(defaultAuthoritativeNetworkRegistry.getOnboardingState('bitcoin'), 'DISCOVERED');
        });
    });
    describe('Suite 11: Immutability & Deep-Cloning Guarantees', () => {
        it('11.1 Mutating returned network object does not affect registry state', () => {
            const net1 = defaultAuthoritativeNetworkRegistry.getNetwork('polygon')!;
            net1.canonicalName = 'MUTATED POLYGON';
            net1.onboardingState = 'DISABLED';
            const net2 = defaultAuthoritativeNetworkRegistry.getNetwork('polygon')!;
            assert.strictEqual(net2.canonicalName, 'Polygon PoS Mainnet');
            assert.strictEqual(net2.onboardingState, 'LIVE_VERIFIED');
        });
        it('11.2 Mutating returned nativeAsset object does not affect registry state', () => {
            const asset1 = defaultAuthoritativeNetworkRegistry.getNativeAsset('ethereum')!;
            asset1.decimals = 99;
            asset1.symbol = 'FAKE_ETH';
            const asset2 = defaultAuthoritativeNetworkRegistry.getNativeAsset('ethereum')!;
            assert.strictEqual(asset2.decimals, 18);
            assert.strictEqual(asset2.symbol, 'ETH');
        });
        it('11.3 Mutating returned gasModel object does not affect registry state', () => {
            const gas1 = defaultAuthoritativeNetworkRegistry.getGasModel('ethereum')!;
            gas1.feeAssetSymbol = 'MUTATED';
            const gas2 = defaultAuthoritativeNetworkRegistry.getGasModel('ethereum')!;
            assert.strictEqual(gas2.feeAssetSymbol, 'ETH');
        });
        it('11.4 Mutating returned explorer object does not affect registry state', () => {
            const exp1 = defaultAuthoritativeNetworkRegistry.getExplorerMetadata('ethereum')!;
            exp1.baseUrl = 'https://fake-explorer.com';
            const exp2 = defaultAuthoritativeNetworkRegistry.getExplorerMetadata('ethereum')!;
            assert.strictEqual(exp2.baseUrl, 'https://etherscan.io');
        });
        it('11.5 Mutating getNetworks array elements does not pollute registry', () => {
            const all = defaultAuthoritativeNetworkRegistry.getNetworks();
            all[0].networkId = 'corrupted_id';
            const check = defaultAuthoritativeNetworkRegistry.getNetwork('ethereum')!;
            assert.strictEqual(check.networkId, 'ethereum');
        });
    });
    describe('Suite 12: 20-Rule Registry Validation Engine', () => {
        it('12.1 Validates canonical ZENITH_AUTHORITATIVE_NETWORKS with 0 violations', () => {
            const report = NetworkRegistryValidationEngine.validateRegistry(ZENITH_AUTHORITATIVE_NETWORKS);
            assert.strictEqual(report.isValid, true);
            assert.strictEqual(report.totalNetworksChecked, 58);
            assert.strictEqual(report.violations.length, 0);
        });
        it('12.2 Rule 1: Catches uppercase or empty networkId', () => {
            const bad = {
                ...ZENITH_AUTHORITATIVE_NETWORKS.polygon,
                networkId: 'UPPERCASE_POLYGON'
            };
            assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({ [bad.networkId]: bad }), /Rule 1: networkId uniqueness/);
        });
        it('12.3 Rule 2: Catches duplicate canonicalName across networks', () => {
            const netA = { ...ZENITH_AUTHORITATIVE_NETWORKS.polygon, networkId: 'poly_a' };
            const netB = { ...ZENITH_AUTHORITATIVE_NETWORKS.polygon, networkId: 'poly_b' };
            assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({ poly_a: netA, poly_b: netB }), /Rule 2: canonicalName uniqueness/);
        });
        it('12.4 Rule 6: Catches duplicate EVM numeric chain ID', () => {
            const netA = { ...ZENITH_AUTHORITATIVE_NETWORKS.polygon, networkId: 'poly_a', canonicalName: 'Poly A' };
            const netB = { ...ZENITH_AUTHORITATIVE_NETWORKS.polygon, networkId: 'poly_b', canonicalName: 'Poly B' };
            assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({ poly_a: netA, poly_b: netB }), /Rule 6: EVM chain ID uniqueness/);
        });
        it('12.5 Rule 7: Catches isMainnet=true with environment=TESTNET', () => {
            const bad: AuthoritativeNetworkIdentity = {
                ...ZENITH_AUTHORITATIVE_NETWORKS.polygon,
                networkId: 'poly_bad',
                canonicalName: 'Poly Bad',
                numericChainId: 99999,
                networkIdentityKey: 'EVM:eip155:99999',
                isMainnet: true,
                environment: 'TESTNET'
            };
            assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({ poly_bad: bad }), /Rule 7: Mainnet\/Testnet separation/);
        });
        it('12.6 Rule 8: Catches alias collisions across distinct networks', () => {
            const netA = { ...ZENITH_AUTHORITATIVE_NETWORKS.polygon, networkId: 'poly_a', canonicalName: 'Poly A', aliases: ['shared-alias'] };
            const netB = { ...ZENITH_AUTHORITATIVE_NETWORKS.arbitrum, networkId: 'arb_b', canonicalName: 'Arb B', aliases: ['shared-alias'] };
            assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({ poly_a: netA, arb_b: netB }), /Rule 8: Alias uniqueness/);
        });
        it('12.7 Rule 9: Catches native asset networkId mismatch', () => {
            const bad: AuthoritativeNetworkIdentity = {
                ...ZENITH_AUTHORITATIVE_NETWORKS.polygon,
                networkId: 'poly_bad',
                canonicalName: 'Poly Bad',
                numericChainId: 99998,
                networkIdentityKey: 'EVM:eip155:99998',
                nativeAsset: {
                    ...ZENITH_AUTHORITATIVE_NETWORKS.polygon.nativeAsset,
                    networkId: 'wrong_network'
                }
            };
            assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({ poly_bad: bad }), /Rule 9: Native asset ownership/);
        });
        it('12.8 Rule 10: Catches out-of-bounds native decimals', () => {
            const bad: AuthoritativeNetworkIdentity = {
                ...ZENITH_AUTHORITATIVE_NETWORKS.polygon,
                networkId: 'poly_bad',
                canonicalName: 'Poly Bad',
                numericChainId: 99997,
                networkIdentityKey: 'EVM:eip155:99997',
                nativeDecimals: 30,
                nativeAsset: {
                    ...ZENITH_AUTHORITATIVE_NETWORKS.polygon.nativeAsset,
                    networkId: 'poly_bad',
                    decimals: 30
                }
            };
            assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({ poly_bad: bad }), /Rule 10: Native decimals validity/);
        });
    });
    describe('Suite 13: Existing 58-Network Catalog Completeness', () => {
        it('13.1 Exactly 58 networks are present in ZENITH_AUTHORITATIVE_NETWORKS', () => {
            assert.strictEqual(Object.keys(ZENITH_AUTHORITATIVE_NETWORKS).length, 58);
        });
        it('13.2 Core certified EVM networks have completenessStatus=COMPLETE', () => {
            const core = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'celo', 'gnosis'];
            for (const id of core) {
                const net = ZENITH_AUTHORITATIVE_NETWORKS[id];
                assert.strictEqual(net.completenessStatus, 'COMPLETE', `Network ${id} must be COMPLETE`);
            }
        });
        it('13.3 Testnet networks have completenessStatus=COMPLETE and status=TESTNET_ONLY', () => {
            const testnets = ['polygon_amoy', 'arbitrum_sepolia', 'optimism_sepolia', 'base_sepolia', 'sepolia'];
            for (const id of testnets) {
                const net = ZENITH_AUTHORITATIVE_NETWORKS[id];
                assert.strictEqual(net.completenessStatus, 'COMPLETE');
                assert.strictEqual(net.status, 'TESTNET_ONLY');
            }
        });
        it('13.4 Unsupported networks are marked completenessStatus=PARTIAL or UNKNOWN', () => {
            const unsupported = ['bitcoin', 'cardano', 'icp', 'dogecoin', 'litecoin', 'monero', 'filecoin', 'klaytn', 'oasis_emerald', 'ronin', 'telos', 'robinhood'];
            for (const id of unsupported) {
                const net = ZENITH_AUTHORITATIVE_NETWORKS[id];
                assert.strictEqual(net.capabilityLevel, 'UNSUPPORTED');
                assert.ok(net.completenessStatus === 'PARTIAL' || net.completenessStatus === 'UNKNOWN');
            }
        });
        it('13.5 No network has completenessStatus=INVALID', () => {
            for (const net of Object.values(ZENITH_AUTHORITATIVE_NETWORKS)) {
                assert.notStrictEqual(net.completenessStatus, 'INVALID', `Network ${net.networkId} has INVALID status`);
            }
        });
        it('13.6 Every network defines a non-empty canonicalName and displayName', () => {
            for (const net of Object.values(ZENITH_AUTHORITATIVE_NETWORKS)) {
                assert.ok(net.canonicalName.length > 0);
                assert.ok(net.displayName.length > 0);
            }
        });
    });
    describe('Suite 14: Token Registry Boundary Enforcement', () => {
        it('14.1 Token boundary validation passes for valid canonical networkId', () => {
            const res = NetworkRegistryValidationEngine.validateTokenBoundary({ networkId: 'polygon', symbol: 'USDC', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' }, (id) => defaultAuthoritativeNetworkRegistry.isNetworkRegistered(id));
            assert.strictEqual(res, true);
        });
        it('14.2 Token boundary validation throws for unknown networkId', () => {
            assert.throws(() => NetworkRegistryValidationEngine.validateTokenBoundary({ networkId: 'fake_chain_id', symbol: 'FAKETOKEN' }, (id) => defaultAuthoritativeNetworkRegistry.isNetworkRegistered(id)), /Token Registry Boundary Violation.*fake_chain_id/);
        });
        it('14.3 Token boundary validation throws for empty networkId', () => {
            assert.throws(() => NetworkRegistryValidationEngine.validateTokenBoundary({ networkId: '', symbol: 'EMPTY' }, (id) => defaultAuthoritativeNetworkRegistry.isNetworkRegistered(id)), /Token Registry Boundary Violation/);
        });
        it('14.4 Token registry references on network profile are non-empty strings', () => {
            const net = defaultAuthoritativeNetworkRegistry.getNetwork('ethereum')!;
            assert.ok(net.tokenRegistryReferences && net.tokenRegistryReferences.length > 0);
            for (const t of net.tokenRegistryReferences) {
                assert.ok(t.length > 0);
            }
        });
    });
    describe('Suite 15: DEX Registry Boundary Enforcement', () => {
        it('15.1 DEX boundary validation passes for valid canonical networkId', () => {
            const res = NetworkRegistryValidationEngine.validateDexBoundary({ networkId: 'arbitrum', dexId: 'camelot_v3', routerAddress: '0x1234567890123456789012345678901234567890' }, (id) => defaultAuthoritativeNetworkRegistry.isNetworkRegistered(id));
            assert.strictEqual(res, true);
        });
        it('15.2 DEX boundary validation throws for unknown networkId', () => {
            assert.throws(() => NetworkRegistryValidationEngine.validateDexBoundary({ networkId: 'unsupported_network', dexId: 'dex_x' }, (id) => defaultAuthoritativeNetworkRegistry.isNetworkRegistered(id)), /DEX Registry Boundary Violation.*unsupported_network/);
        });
        it('15.3 DEX boundary validation throws for empty networkId', () => {
            assert.throws(() => NetworkRegistryValidationEngine.validateDexBoundary({ networkId: '', dexId: 'dex_y' }, (id) => defaultAuthoritativeNetworkRegistry.isNetworkRegistered(id)), /DEX Registry Boundary Violation/);
        });
        it('15.4 Certified networks reference verified DEX IDs', () => {
            const polygon = defaultAuthoritativeNetworkRegistry.getNetwork('polygon')!;
            assert.ok(polygon.dexRegistryReferences?.includes('uniswap_v3'));
            assert.ok(polygon.dexRegistryReferences?.includes('quickswap'));
        });
    });
    describe('Suite 16: Bridge Registry Boundary Enforcement', () => {
        it('16.1 Bridge boundary validation passes when both source and destination exist', () => {
            const res = NetworkRegistryValidationEngine.validateBridgeBoundary({ sourceNetworkId: 'polygon', destNetworkId: 'arbitrum', providerId: 'across' }, (id) => defaultAuthoritativeNetworkRegistry.isNetworkRegistered(id));
            assert.strictEqual(res, true);
        });
        it('16.2 Bridge boundary validation throws when source network is unknown', () => {
            assert.throws(() => NetworkRegistryValidationEngine.validateBridgeBoundary({ sourceNetworkId: 'ghost_source', destNetworkId: 'arbitrum', providerId: 'across' }, (id) => defaultAuthoritativeNetworkRegistry.isNetworkRegistered(id)), /Bridge Registry Boundary Violation.*ghost_source/);
        });
        it('16.3 Bridge boundary validation throws when destination network is unknown', () => {
            assert.throws(() => NetworkRegistryValidationEngine.validateBridgeBoundary({ sourceNetworkId: 'polygon', destNetworkId: 'ghost_dest', providerId: 'across' }, (id) => defaultAuthoritativeNetworkRegistry.isNetworkRegistered(id)), /Bridge Registry Boundary Violation.*ghost_dest/);
        });
        it('16.4 Certified cross-chain networks reference verified bridge providers', () => {
            const arb = defaultAuthoritativeNetworkRegistry.getNetwork('arbitrum')!;
            assert.ok(arb.bridgeRegistryReferences?.includes('across'));
        });
    });
    describe('Suite 17: Cross-System Consistency (ChainRegistry Adapter)', () => {
        it('17.1 defaultChainRegistry.getChain resolves aliases via Authoritative Network Registry', () => {
            const chainMatic = defaultChainRegistry.getChain('matic');
            assert.ok(chainMatic);
            assert.strictEqual(chainMatic.id, 'polygon');
            assert.strictEqual(chainMatic.chainId, 137);
            const chainArb = defaultChainRegistry.getChain('arb');
            assert.ok(chainArb);
            assert.strictEqual(chainArb.id, 'arbitrum');
            assert.strictEqual(chainArb.chainId, 42161);
        });
        it('17.2 defaultChainRegistry.getChain resolves numeric chain IDs accurately', () => {
            const chainEth = defaultChainRegistry.getChain(1);
            assert.ok(chainEth);
            assert.strictEqual(chainEth.id, 'ethereum');
            const chainBase = defaultChainRegistry.getChain(8453);
            assert.ok(chainBase);
            assert.strictEqual(chainBase.id, 'base');
        });
        it('17.3 defaultChainRegistry.getExplorerTxUrl produces formatted URL', () => {
            const url = defaultChainRegistry.getExplorerTxUrl('polygon', '0x123456');
            assert.match(url, /polygonscan\.com\/tx\/0x123456/);
        });
        it('17.4 defaultChainRegistry.getExplorerAddressUrl produces formatted URL', () => {
            const url = defaultChainRegistry.getExplorerAddressUrl('arbitrum', '0xabcdef');
            assert.match(url, /arbiscan\.io\/address\/0xabcdef/);
        });
        it('17.5 defaultChainRegistry and defaultAuthoritativeNetworkRegistry share consistent chain IDs', () => {
            const checkChains = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'];
            for (const id of checkChains) {
                const legacy = defaultChainRegistry.getChain(id)!;
                const auth = defaultAuthoritativeNetworkRegistry.getNetwork(id)!;
                assert.strictEqual(legacy.chainId, auth.numericChainId);
            }
        });
    });
    describe('Suite 18: Security & Adversarial Attack Matrix', () => {
        it('18.1 Rejects registering duplicate networkId with different canonical data', () => {
            const customReg = new AuthoritativeNetworkRegistry(undefined, true);
            const duplicateNet: AuthoritativeNetworkIdentity = {
                ...ZENITH_AUTHORITATIVE_NETWORKS.polygon,
                canonicalName: 'Conflicting Polygon'
            };
            assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({
                poly1: ZENITH_AUTHORITATIVE_NETWORKS.polygon,
                poly2: duplicateNet
            }), /duplicate networkId|duplicate canonicalName|EVM Chain ID collision/);
        });
        it('18.2 Rejects EVM network masquerading with another networks chain ID', () => {
            const spoofed: AuthoritativeNetworkIdentity = {
                ...ZENITH_AUTHORITATIVE_NETWORKS.ethereum,
                networkId: 'evil_ethereum',
                canonicalName: 'Evil Ethereum',
                numericChainId: 137,
                networkIdentityKey: 'EVM:eip155:137'
            };
            assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({
                polygon: ZENITH_AUTHORITATIVE_NETWORKS.polygon,
                evil_ethereum: spoofed
            }), /EVM Chain ID collision: Chain ID 137/);
        });
        it('18.3 Rejects non-EVM network attempting to claim EVM gas model', () => {
            const invalid: AuthoritativeNetworkIdentity = {
                ...ZENITH_AUTHORITATIVE_NETWORKS.solana,
                gasModel: {
                    ...ZENITH_AUTHORITATIVE_NETWORKS.solana.gasModel,
                    modelType: 'EVM_EIP1559'
                }
            };
            assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({ solana: invalid }), /Non-EVM network "solana" cannot declare EVM gas model/);
        });
        it('18.4 Rejects EVM network attempting to claim non-EVM gas model', () => {
            const invalid: AuthoritativeNetworkIdentity = {
                ...ZENITH_AUTHORITATIVE_NETWORKS.ethereum,
                gasModel: {
                    ...ZENITH_AUTHORITATIVE_NETWORKS.ethereum.gasModel,
                    modelType: 'SOLANA_FEE'
                }
            };
            assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({ ethereum: invalid }), /EVM network "ethereum" must declare an EVM gas model/);
        });
        it('18.5 Rejects promoting network to LIVE_VERIFIED without LIVE_VERIFIED onboardingState', () => {
            const invalid: AuthoritativeNetworkIdentity = {
                ...ZENITH_AUTHORITATIVE_NETWORKS.polygon,
                capabilityLevel: 'LIVE_VERIFIED',
                onboardingState: 'DISCOVERED'
            };
            assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({ polygon: invalid }), /cannot be LIVE_VERIFIED unless onboardingState is "LIVE_VERIFIED"/);
        });
        it('18.6 Rejects promoting network to LIVE_VERIFIED while finality model is UNKNOWN', () => {
            const invalid: AuthoritativeNetworkIdentity = {
                ...ZENITH_AUTHORITATIVE_NETWORKS.polygon,
                finality: {
                    ...ZENITH_AUTHORITATIVE_NETWORKS.polygon.finality,
                    status: 'UNKNOWN'
                }
            };
            assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({ polygon: invalid }), /cannot be promoted to LIVE_VERIFIED while finality model is UNKNOWN/);
        });
        it('18.7 Rejects RPC endpoint configured with mismatched expected chainId', () => {
            const invalid: AuthoritativeNetworkIdentity = {
                ...ZENITH_AUTHORITATIVE_NETWORKS.ethereum,
                rpcEndpoints: [
                    {
                        ...ZENITH_AUTHORITATIVE_NETWORKS.ethereum.rpcEndpoints[0],
                        expectedFamily: 'SOLANA'
                    }
                ]
            };
            assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({ ethereum: invalid }), /RPC endpoint expectedFamily "SOLANA" does not match network family "EVM"/);
        });
        it('18.8 Rejects wrapped native asset falsely marked as native gas asset', () => {
            const invalid: AuthoritativeNetworkIdentity = {
                ...ZENITH_AUTHORITATIVE_NETWORKS.ethereum,
                nativeAsset: {
                    ...ZENITH_AUTHORITATIVE_NETWORKS.ethereum.nativeAsset,
                    isWrappedEquivalent: true,
                    isGasAsset: true
                }
            };
            assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({ ethereum: invalid }), /Wrapped native asset cannot be marked as native isGasAsset=true/);
        });
        it('18.9 Rejects alias collision where alias matches another canonical networkId', () => {
            const netA = {
                ...ZENITH_AUTHORITATIVE_NETWORKS.polygon,
                aliases: ['arbitrum']
            };
            assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({
                polygon: netA,
                arbitrum: ZENITH_AUTHORITATIVE_NETWORKS.arbitrum
            }), /Alias collision/);
        });
        it('18.10 Rejects explorer metadata tagged with mismatched environment', () => {
            const invalid: AuthoritativeNetworkIdentity = {
                ...ZENITH_AUTHORITATIVE_NETWORKS.ethereum,
                explorer: {
                    ...ZENITH_AUTHORITATIVE_NETWORKS.ethereum.explorer,
                    environment: 'TESTNET'
                }
            };
            assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({ ethereum: invalid }), /Explorer environment "TESTNET" does not match network environment "MAINNET"/);
        });
    });
    describe('Suite 19: Latency & Performance Benchmarks', () => {
        it('19.1 getNetwork lookup latency is under 0.05ms', () => {
            defaultAuthoritativeNetworkRegistry.getNetwork('polygon');
            const iterations = 5000;
            const start = performance.now();
            for (let i = 0; i < iterations; i++) {
                defaultAuthoritativeNetworkRegistry.getNetwork('polygon');
            }
            const avgMs = (performance.now() - start) / iterations;
            assert.ok(avgMs < 0.05, `getNetwork average latency ${avgMs.toFixed(5)}ms exceeded 0.05ms limit`);
        });
        it('19.2 getNetworkByChainIdentity lookup latency is under 0.05ms', () => {
            const iterations = 5000;
            const start = performance.now();
            for (let i = 0; i < iterations; i++) {
                defaultAuthoritativeNetworkRegistry.getNetworkByChainIdentity('EVM', 'eip155', 137);
            }
            const avgMs = (performance.now() - start) / iterations;
            assert.ok(avgMs < 0.05, `getNetworkByChainIdentity latency ${avgMs.toFixed(5)}ms exceeded 0.05ms`);
        });
        it('19.3 resolveNetworkIdentity alias resolution latency is under 0.02ms', () => {
            const iterations = 5000;
            const start = performance.now();
            for (let i = 0; i < iterations; i++) {
                defaultAuthoritativeNetworkRegistry.resolveNetworkIdentity('matic');
            }
            const avgMs = (performance.now() - start) / iterations;
            assert.ok(avgMs < 0.02, `resolveNetworkIdentity latency ${avgMs.toFixed(5)}ms exceeded 0.02ms`);
        });
        it('19.4 getNativeAsset lookup latency is under 0.05ms', () => {
            const iterations = 5000;
            const start = performance.now();
            for (let i = 0; i < iterations; i++) {
                defaultAuthoritativeNetworkRegistry.getNativeAsset('ethereum');
            }
            const avgMs = (performance.now() - start) / iterations;
            assert.ok(avgMs < 0.05, `getNativeAsset latency ${avgMs.toFixed(5)}ms exceeded 0.05ms`);
        });
        it('19.5 getGasModel and getFinalityModel lookups are under 0.05ms', () => {
            const iterations = 5000;
            const start = performance.now();
            for (let i = 0; i < iterations; i++) {
                defaultAuthoritativeNetworkRegistry.getGasModel('arbitrum');
                defaultAuthoritativeNetworkRegistry.getFinalityModel('arbitrum');
            }
            const avgMs = (performance.now() - start) / (iterations * 2);
            assert.ok(avgMs < 0.05, `Gas & Finality lookup latency ${avgMs.toFixed(5)}ms exceeded 0.05ms`);
        });
        it('19.6 1,000 batch network lookups complete in under 50ms', () => {
            const keys = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'solana', 'bsc', 'avalanche'];
            const start = performance.now();
            for (let i = 0; i < 1000; i++) {
                const key = keys[i % keys.length];
                defaultAuthoritativeNetworkRegistry.getNetwork(key);
            }
            const elapsed = performance.now() - start;
            assert.ok(elapsed < 50, `1,000 batch lookups took ${elapsed.toFixed(2)}ms (must be < 50ms)`);
        });
    });
    describe('Suite 20: Deterministic Fuzzing - 1,000 Network Identity Mutations', () => {
        it('20.1 1,000 randomized network identity mutations fail closed or resolve deterministically (seed 0x7A5C37)', () => {
            const prng = createPrng(0x7a5c37);
            const families = ['EVM', 'SOLANA', 'MOVE', 'COSMOS', 'BITCOIN', 'UTXO'];
            const envs = ['MAINNET', 'TESTNET', 'DEVNET', 'LOCAL'];
            let validatedRejections = 0;
            for (let i = 0; i < 1000; i++) {
                const family = families[Math.floor(prng() * families.length)] as any;
                const env = envs[Math.floor(prng() * envs.length)] as any;
                const mutateDecimals = prng() < 0.3;
                const decimals = mutateDecimals ? Math.floor(prng() * 50) : 18;
                const numericChainId = 800000 + i;
                const candidate: AuthoritativeNetworkIdentity = {
                    networkId: `fuzz-net-${i}`,
                    canonicalName: `Fuzz Network ${i}`,
                    displayName: `Fuzz ${i}`,
                    family,
                    environment: env,
                    chainId: numericChainId,
                    numericChainId: family === 'EVM' ? numericChainId : undefined,
                    namespace: family === 'EVM' ? 'eip155' : 'custom',
                    networkIdentityKey: buildNetworkIdentityKey(family, family === 'EVM' ? 'eip155' : 'custom', numericChainId),
                    nativeAsset: {
                        assetId: `fuzz-asset-${i}`,
                        symbol: `FUZZ${i}`,
                        name: `Fuzz Coin ${i}`,
                        decimals,
                        networkId: `fuzz-net-${i}`,
                        family,
                        assetType: 'NATIVE',
                        isGasAsset: true,
                        isWrappedEquivalent: false,
                        status: 'ACTIVE'
                    },
                    nativeDecimals: decimals,
                    nativeSymbol: `FUZZ${i}`,
                    isMainnet: env === 'MAINNET',
                    isTestnet: env === 'TESTNET',
                    gasModel: {
                        modelType: family === 'EVM' ? 'EVM_EIP1559' : 'CHAIN_SPECIFIC',
                        feeMechanism: 'Fuzz fee',
                        gasUnit: 'gas',
                        feeAssetSymbol: `FUZZ${i}`,
                        baseFeeBehavior: 'DYNAMIC_BASE_FEE',
                        priorityFeeBehavior: 'TIP',
                        feeEstimationCapability: true,
                        supportedExecutionAdapter: family === 'EVM' ? 'EvmExecutionAdapter' : 'UnsupportedExecutionAdapter'
                    },
                    finality: {
                        model: 'CONFIRMATION_BASED',
                        confirmationModel: 'DETERMINISTIC_BFT',
                        isDeterministic: true,
                        reorgModel: 'IMPOSSIBLE_POST_FINALITY',
                        canonicalityVerification: 'ON_CHAIN_CONSENSUS',
                        finalityDepthBlocks: 12,
                        runtimeFinalitySource: 'status',
                        status: 'KNOWN'
                    },
                    rpcEndpoints: [],
                    explorer: {
                        explorerId: `fuzz-exp-${i}`,
                        explorerName: `Fuzz Explorer ${i}`,
                        baseUrl: 'https://fuzz.explorer',
                        txUrlTemplate: 'https://fuzz.explorer/tx/{txHash}',
                        addressUrlTemplate: 'https://fuzz.explorer/address/{address}',
                        blockUrlTemplate: 'https://fuzz.explorer/block/{block}',
                        networkId: `fuzz-net-${i}`,
                        environment: env,
                        status: 'ACTIVE'
                    },
                    status: env === 'TESTNET' ? 'TESTNET_ONLY' : 'SUPPORTED',
                    aliases: [`alias-${i}`],
                    capabilityLevel: 'CONFIGURED',
                    onboardingState: 'CONFIGURED',
                    executionAdapterReference: family === 'EVM' ? 'EvmExecutionAdapter' : 'UnsupportedExecutionAdapter',
                    completenessStatus: 'COMPLETE'
                };
                if (decimals > 24) {
                    assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({ [candidate.networkId]: candidate }), /Rule 10: Native decimals validity/);
                    validatedRejections++;
                }
                else {
                    const report = NetworkRegistryValidationEngine.validateRegistry({ [candidate.networkId]: candidate });
                    assert.strictEqual(report.isValid, true);
                }
            }
            assert.ok(validatedRejections > 0, 'Must have verified out-of-bounds decimal rejections');
        });
    });
    describe('Suite 21: Deterministic Fuzzing - 1,000 Chain / Environment Collisions', () => {
        it('21.1 1,000 chain ID collision mutations strictly fail closed (seed 0x7A5C37)', () => {
            const prng = createPrng(0x7a5c37);
            const existingChains = Object.values(ZENITH_AUTHORITATIVE_NETWORKS).filter((c) => c.family === 'EVM' && c.numericChainId);
            let blockedCollisions = 0;
            for (let i = 0; i < 1000; i++) {
                const target = existingChains[Math.floor(prng() * existingChains.length)];
                const collidingCandidate: AuthoritativeNetworkIdentity = {
                    ...target,
                    networkId: `collider-${i}`,
                    canonicalName: `Collider Network ${i}`,
                    networkIdentityKey: `EVM:eip155:${target.numericChainId}`
                };
                assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({
                    [target.networkId]: target,
                    [collidingCandidate.networkId]: collidingCandidate
                }), /EVM Chain ID collision/);
                blockedCollisions++;
            }
            assert.strictEqual(blockedCollisions, 1000, 'All 1,000 collisions must be strictly blocked');
        });
    });
    describe('Suite 22: Deterministic Fuzzing - 1,000 Alias & RPC Metadata Mutations', () => {
        it('22.1 1,000 alias collision mutations strictly fail closed (seed 0x7A5C37)', () => {
            const prng = createPrng(0x7a5c37);
            const networks = Object.values(ZENITH_AUTHORITATIVE_NETWORKS);
            let blockedAliasCollisions = 0;
            for (let i = 0; i < 1000; i++) {
                const netA = networks[Math.floor(prng() * networks.length)];
                let netB = networks[Math.floor(prng() * networks.length)];
                while (netB.networkId === netA.networkId) {
                    netB = networks[Math.floor(prng() * networks.length)];
                }
                const sharedAlias = `shared-alias-${i}`;
                const mutatedA = { ...netA, aliases: [sharedAlias] };
                const mutatedB = { ...netB, aliases: [sharedAlias] };
                assert.throws(() => NetworkRegistryValidationEngine.validateRegistry({
                    [mutatedA.networkId]: mutatedA,
                    [mutatedB.networkId]: mutatedB
                }), /Rule 8: Alias uniqueness/);
                blockedAliasCollisions++;
            }
            assert.strictEqual(blockedAliasCollisions, 1000);
        });
    });
    describe('Suite 23: Deterministic Fuzzing - 1,000 Cross-Registry Reference Mutations', () => {
        it('23.1 1,000 cross-registry boundary mutations fail closed on invalid references (seed 0x7A5C37)', () => {
            const prng = createPrng(0x7a5c37);
            let blockedTokens = 0;
            let blockedBridges = 0;
            for (let i = 0; i < 1000; i++) {
                const isKnown = prng() < 0.5;
                const netId = isKnown ? 'polygon' : `phantom_net_${i}`;
                if (prng() < 0.5) {
                    if (!isKnown) {
                        assert.throws(() => NetworkRegistryValidationEngine.validateTokenBoundary({ networkId: netId, symbol: 'TEST' }, (id) => defaultAuthoritativeNetworkRegistry.isNetworkRegistered(id)), /Token Registry Boundary Violation/);
                        blockedTokens++;
                    }
                    else {
                        const ok = NetworkRegistryValidationEngine.validateTokenBoundary({ networkId: netId, symbol: 'TEST' }, (id) => defaultAuthoritativeNetworkRegistry.isNetworkRegistered(id));
                        assert.strictEqual(ok, true);
                    }
                }
                else {
                    if (!isKnown) {
                        assert.throws(() => NetworkRegistryValidationEngine.validateBridgeBoundary({ sourceNetworkId: netId, destNetworkId: 'arbitrum', providerId: 'across' }, (id) => defaultAuthoritativeNetworkRegistry.isNetworkRegistered(id)), /Bridge Registry Boundary Violation/);
                        blockedBridges++;
                    }
                    else {
                        const ok = NetworkRegistryValidationEngine.validateBridgeBoundary({ sourceNetworkId: 'polygon', destNetworkId: 'arbitrum', providerId: 'across' }, (id) => defaultAuthoritativeNetworkRegistry.isNetworkRegistered(id));
                        assert.strictEqual(ok, true);
                    }
                }
            }
            assert.ok(blockedTokens > 0, 'Must have blocked invalid tokens');
            assert.ok(blockedBridges > 0, 'Must have blocked invalid bridges');
        });
    });
});
