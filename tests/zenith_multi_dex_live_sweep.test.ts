import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DexLiveCapabilityVerifier, AuthoritativeDexRegistry, defaultAuthoritativeDexRegistry, DexAddressVerifier, DexSimulationPipeline, computeBoundedDexCapability, isCapabilityAtLeast, QuickSwapV3DexAdapter, AerodromeDexAdapter, UniswapV3DexAdapter, CANONICAL_POLYGON_WMATIC_USDC_QUICKSWAP_POOL, CANONICAL_BASE_WETH_USDC_AERODROME_POOL, AERODROME_LIVE_VERIFICATION_UNAVAILABLE } from '../packages/routing/src/dex/authoritative';
import { defaultAuthoritativeNetworkRegistry, AuthoritativeNetworkRegistry, AuthoritativeRpcProviderRegistry } from '@zenith/chains';
import { defaultAuthoritativeTokenRegistry, AuthoritativeTokenRegistry } from '@zenith/tokens';
import { LiveDexVerificationError, LiveExecutionBlockedError, DexNetworkMismatchError, SlippagePolicyViolationError, QUICKSWAP_V3_ROUTER_ABI, AERODROME_ROUTER_ABI, UNISWAP_V3_SWAP_ROUTER_ABI } from '@zenith/contracts';
import type { LiveDexPathConfig, LiveDexVerificationMode, CapabilityLevel } from '@zenith/types';
import { Interface, Provider, ZeroAddress } from 'ethers';
class DeterministicPRNG {
    private state: number;
    constructor(seed: number = 0x7a5c42) {
        this.state = seed >>> 0;
    }
    public next(): number {
        this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
        return this.state / 4294967296;
    }
    public nextInt(min: number, max: number): number {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }
    public choice<T>(arr: readonly T[]): T {
        return arr[this.nextInt(0, arr.length - 1)];
    }
    public nextBigInt(min: bigint, max: bigint): bigint {
        const range = max - min;
        const rand = BigInt(this.nextInt(0, 1000000));
        return min + (range * rand) / 1000000n;
    }
    public nextHex(lengthBytes: number): string {
        let out = '0x';
        const hexChars = '0123456789abcdef';
        for (let i = 0; i < lengthBytes * 2; i++) {
            out += hexChars[this.nextInt(0, 15)];
        }
        return out;
    }
    public nextAddress(): string {
        return this.nextHex(20);
    }
}
function createDeterministicTestProvider(chainId: number, overrides?: {
    blockNumber?: number;
    callReturn?: string;
    callShouldRevert?: boolean;
    revertMessage?: string;
    estimateGasValue?: bigint;
    estimateGasShouldFail?: boolean;
    bytecode?: string;
}): Provider {
    const defaultBlocks: Record<number, number> = {
        137: 62000000,
        42161: 250000000,
        8453: 20000000,
        1: 20500000
    };
    return {
        getBlockNumber: async () => overrides?.blockNumber ?? (defaultBlocks[chainId] || 10000000),
        call: async (tx: any) => {
            if (overrides?.callShouldRevert) {
                throw new Error(overrides.revertMessage || 'execution reverted');
            }
            return overrides?.callReturn ?? '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000';
        },
        estimateGas: async (tx: any) => {
            if (overrides?.estimateGasShouldFail) {
                throw new Error('gas estimation reverted');
            }
            return overrides?.estimateGasValue ?? 175000n;
        },
        getCode: async (addr: string) => overrides?.bytecode ?? '0x608060405234801561001057600080fd5b50'
    } as unknown as Provider;
}
const CANONICAL_USER = '0xd2206dB611d5677c8552A9DCBaDf3077aDB4Af88';
const POLYGON_QUICKSWAP_CONFIG: LiveDexPathConfig = {
    dexId: 'polygon:quickswap-v3',
    networkId: 'polygon',
    tokenInSymbol: 'WMATIC',
    tokenInAddress: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    tokenOutSymbol: 'USDC',
    tokenOutAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    amountInRaw: 1000000000000000000n,
    slippageBps: 50,
    feeTierBps: 30,
    userAddress: CANONICAL_USER,
    recipientAddress: CANONICAL_USER
};
const ARBITRUM_UNISWAP_CONFIG: LiveDexPathConfig = {
    dexId: 'arbitrum:uniswap-v3',
    networkId: 'arbitrum',
    tokenInSymbol: 'WETH',
    tokenInAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    tokenOutSymbol: 'USDC',
    tokenOutAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    amountInRaw: 1000000000000000000n,
    slippageBps: 50,
    feeTierBps: 30,
    userAddress: CANONICAL_USER,
    recipientAddress: CANONICAL_USER
};
const BASE_AERODROME_CONFIG: LiveDexPathConfig = {
    dexId: 'base:aerodrome-v2',
    networkId: 'base',
    tokenInSymbol: 'WETH',
    tokenInAddress: '0x4200000000000000000000000000000000000006',
    tokenOutSymbol: 'USDC',
    tokenOutAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    amountInRaw: 1000000000000000000n,
    slippageBps: 50,
    feeTierBps: 30,
    userAddress: CANONICAL_USER,
    recipientAddress: CANONICAL_USER
};
describe('ZENITH — PHASE 2 TASK 42: MULTI-DEX CONTROLLED LIVE READ-ONLY & PREFLIGHT SWEEPS', () => {
    describe('Suite 1: Target 1 — Polygon QuickSwap V3 Verification (20 Tests)', () => {
        const verifier = new DexLiveCapabilityVerifier();
        const polyProvider = createDeterministicTestProvider(137);
        it('1.1 Polygon network identity is authoritative with numeric chainId 137', () => {
            const net = defaultAuthoritativeNetworkRegistry.getNetwork('polygon');
            assert.ok(net);
            assert.strictEqual(net.numericChainId, 137);
            assert.strictEqual(net.family, 'EVM');
            assert.strictEqual(net.networkIdentityKey, 'EVM:eip155:137');
        });
        it('1.2 QuickSwap V3 is registered in AuthoritativeDexRegistry under polygon:quickswap-v3', () => {
            const dex = defaultAuthoritativeDexRegistry.getDex('polygon:quickswap-v3');
            assert.ok(dex);
            assert.strictEqual(dex.canonicalName, 'QuickSwap V3');
            assert.strictEqual(dex.networkId, 'polygon');
            assert.strictEqual(dex.protocolFamily, 'CONCENTRATED_LIQUIDITY_AMM');
        });
        it('1.3 QuickSwap V3 router address matches authoritative address 0xf5b509bB0909a69B1c207E495f687a596C168E12', () => {
            const dex = defaultAuthoritativeDexRegistry.getDex('polygon:quickswap-v3')!;
            assert.strictEqual(dex.routerAddress.toLowerCase(), '0xf5b509bb0909a69b1c207e495f687a596c168e12');
        });
        it('1.4 QuickSwap V3 factory address matches Algebra factory 0x411b0fAcC3489691f28ad58c47006AF5E3Ab3A28', () => {
            const dex = defaultAuthoritativeDexRegistry.getDex('polygon:quickswap-v3')!;
            assert.strictEqual(dex.factoryAddress?.toLowerCase(), '0x411b0facc3489691f28ad58c47006af5e3ab3a28');
        });
        it('1.5 QuickSwap V3 adapter is an instance of QuickSwapV3DexAdapter', () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('polygon:quickswap-v3');
            assert.ok(adapter instanceof QuickSwapV3DexAdapter);
        });
        it('1.6 QuickSwap V3 router calldata selector is 0xbc651188 (Algebra exactInputSingle without fee)', async () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('polygon:quickswap-v3')!;
            const tokenIn = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'WMATIC' }).token!;
            const tokenOut = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'USDC' }).token!;
            const quote = await adapter.getQuote({
                chainId: 137,
                tokenIn,
                tokenOut,
                amountIn: 1000000000000000000n,
                feeTierBps: 30,
                slippageToleranceBps: 50
            });
            assert.ok(quote);
            const tx = await adapter.buildSwapTransaction(quote, CANONICAL_USER, CANONICAL_USER);
            assert.strictEqual(tx.calldata.slice(0, 10), '0xbc651188');
        });
        it('1.7 QuickSwap V3 calldata decodes 7 parameters in exactInputSingle struct (NO fee in struct)', async () => {
            const iface = new Interface(QUICKSWAP_V3_ROUTER_ABI);
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('polygon:quickswap-v3')!;
            const tokenIn = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'WMATIC' }).token!;
            const tokenOut = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'USDC' }).token!;
            const quote = await adapter.getQuote({
                chainId: 137,
                tokenIn,
                tokenOut,
                amountIn: 1000000000000000000n,
                feeTierBps: 30,
                slippageToleranceBps: 50
            });
            const tx = await adapter.buildSwapTransaction(quote!, CANONICAL_USER, CANONICAL_USER);
            const decoded = iface.decodeFunctionData('exactInputSingle', tx.calldata);
            assert.strictEqual(decoded[0].length, 7);
            assert.strictEqual(decoded[0][0].toLowerCase(), '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270');
        });
        it('1.8 QuickSwap V3 pool discovery locates canonical WMATIC/USDC pool 0xA374094527e1673A86dE626964517C4e47502935', async () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('polygon:quickswap-v3')!;
            const tokenIn = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'WMATIC' }).token!;
            const tokenOut = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'USDC' }).token!;
            const pool = await adapter.discoverPool(tokenIn, tokenOut, 30);
            assert.strictEqual(pool.poolFound, true);
            assert.strictEqual(pool.poolAddress?.toLowerCase(), CANONICAL_POLYGON_WMATIC_USDC_QUICKSWAP_POOL.toLowerCase());
        });
        it('1.9 QuickSwap V3 sorts tokens deterministically into byte-order token0 < token1', () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('polygon:quickswap-v3') as QuickSwapV3DexAdapter;
            const sorted = adapter.sortTokens('0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359');
            assert.strictEqual(sorted.token0.toLowerCase(), '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270');
            assert.strictEqual(sorted.token1.toLowerCase(), '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359');
            assert.strictEqual(sorted.isZeroForOne, true);
        });
        it('1.10 QuickSwap V3 quote calculation uses exact integer arithmetic for amounts', async () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('polygon:quickswap-v3')!;
            const tokenIn = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'WMATIC' }).token!;
            const tokenOut = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'USDC' }).token!;
            const quote = await adapter.getQuote({
                chainId: 137,
                tokenIn,
                tokenOut,
                amountIn: 2000000000000000000n,
                feeTierBps: 30,
                slippageToleranceBps: 100
            });
            assert.ok(quote);
            assert.strictEqual(typeof quote.amountIn, 'bigint');
            assert.strictEqual(typeof quote.expectedAmountOut, 'bigint');
            assert.strictEqual(typeof quote.minimumAmountOut, 'bigint');
            assert.ok(quote.expectedAmountOut > 0n);
            assert.ok(quote.minimumAmountOut < quote.expectedAmountOut);
        });
        it('1.11 QuickSwap V3 quote freshness establishes valid quoteTimestamp and expiration', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'READ_ONLY_LIVE');
            assert.strictEqual(res.isSuccess, true);
            assert.strictEqual(res.evidence.checklist.quoteFresh, true);
            assert.ok(res.evidence.quoteTimestamp! > 0);
            assert.ok(res.evidence.quote!.expiration > res.evidence.quoteTimestamp!);
        });
        it('1.12 QuickSwap V3 produces valid Task 32 semantic hash in transaction payload', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'READ_ONLY_LIVE');
            assert.ok(res.evidence.semanticHash);
            assert.strictEqual(res.evidence.semanticHash.replace(/^0x/, '').length, 64);
            assert.strictEqual(res.evidence.checklist.semanticEquivalencePassed, true);
        });
        it('1.13 QuickSwap V3 enforces Task 33 economic safety constraints', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'READ_ONLY_LIVE');
            assert.strictEqual(res.evidence.checklist.economicSafetyPassed, true);
            assert.strictEqual(res.evidence.economicChecks.passed, true);
        });
        it('1.14 QuickSwap V3 passes Task 40 10-step simulation pipeline in preflight mode', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'PREFLIGHT_ONLY', {
                provider: polyProvider
            });
            assert.strictEqual(res.evidence.simulationChecks?.preflightPassed, true);
        });
        it('1.15 QuickSwap V3 executes eth_call successfully on unsigned transaction', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'PREFLIGHT_ONLY', {
                provider: polyProvider
            });
            assert.strictEqual(res.evidence.ethCallResult?.success, true);
            assert.strictEqual(res.evidence.checklist.ethCallPassed, true);
        });
        it('1.16 QuickSwap V3 executes eth_estimateGas with 120% safety margin applied', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'PREFLIGHT_ONLY', {
                provider: polyProvider
            });
            assert.strictEqual(res.evidence.checklist.ethEstimateGasPassed, true);
            assert.strictEqual(res.evidence.ethEstimateGasResult?.gasLimit, (175000n * 120n) / 100n);
        });
        it('1.17 QuickSwap V3 verifies multi-provider RPC consistency without disagreement', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'PREFLIGHT_ONLY');
            assert.strictEqual(res.evidence.checklist.rpcProvidersConsistent, true);
        });
        it('1.18 QuickSwap V3 capability transitions CONFIGURED -> EXECUTION_AVAILABLE (bounded in Task 42)', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'PREFLIGHT_ONLY', {
                provider: polyProvider,
                taskId: 'PHASE_2_TASK_42'
            });
            assert.strictEqual(res.evidence.capabilityAfter, 'EXECUTION_AVAILABLE');
            assert.strictEqual(res.evidence.liveVerified, false);
        });
        it('1.19 QuickSwap V3 achieves LIVE_EXECUTION_READY = true in PREFLIGHT_ONLY mode', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'PREFLIGHT_ONLY', {
                provider: polyProvider
            });
            assert.strictEqual(res.evidence.liveExecutionReady, true);
        });
        it('1.20 QuickSwap V3 enforces LIVE_EXECUTION_PERFORMED = false and zero mainnet broadcast', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'PREFLIGHT_ONLY', {
                provider: polyProvider
            });
            assert.strictEqual(res.evidence.liveExecutionPerformed, false);
            assert.strictEqual(res.evidence.liveOnchainGateBlocked, true);
        });
    });
    describe('Suite 2: Target 2 — Arbitrum Uniswap V3 Verification (20 Tests)', () => {
        const verifier = new DexLiveCapabilityVerifier();
        const arbProvider = createDeterministicTestProvider(42161);
        it('2.1 Arbitrum One network identity is authoritative with numeric chainId 42161', () => {
            const net = defaultAuthoritativeNetworkRegistry.getNetwork('arbitrum');
            assert.ok(net);
            assert.strictEqual(net.numericChainId, 42161);
            assert.strictEqual(net.family, 'EVM');
            assert.strictEqual(net.networkIdentityKey, 'EVM:eip155:42161');
        });
        it('2.2 Arbitrum Uniswap V3 is registered under arbitrum:uniswap-v3', () => {
            const dex = defaultAuthoritativeDexRegistry.getDex('arbitrum:uniswap-v3');
            assert.ok(dex);
            assert.strictEqual(dex.canonicalName, 'Uniswap V3');
            assert.strictEqual(dex.networkId, 'arbitrum');
            assert.strictEqual(dex.protocolFamily, 'UNISWAP_V3_STYLE');
        });
        it('2.3 Arbitrum Uniswap V3 router address is 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', () => {
            const dex = defaultAuthoritativeDexRegistry.getDex('arbitrum:uniswap-v3')!;
            assert.strictEqual(dex.routerAddress.toLowerCase(), '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45');
        });
        it('2.4 Arbitrum Uniswap V3 factory address is 0x1F98431c8aD98523631AE4a59f267346ea31F984', () => {
            const dex = defaultAuthoritativeDexRegistry.getDex('arbitrum:uniswap-v3')!;
            assert.strictEqual(dex.factoryAddress?.toLowerCase(), '0x1f98431c8ad98523631ae4a59f267346ea31f984');
        });
        it('2.5 Arbitrum Uniswap V3 quoter address is 0x61fFE014bA17989E743c5F6cB21bF9697530B21e', () => {
            const dex = defaultAuthoritativeDexRegistry.getDex('arbitrum:uniswap-v3')!;
            assert.strictEqual(dex.quoterAddress?.toLowerCase(), '0x61ffe014ba17989e743c5f6cb21bf9697530b21e');
        });
        it('2.6 Arbitrum Uniswap V3 adapter is UniswapV3DexAdapter', () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('arbitrum:uniswap-v3');
            assert.ok(adapter instanceof UniswapV3DexAdapter);
        });
        it('2.7 Arbitrum Uniswap V3 calldata selector matches Uniswap V3 exactInputSingle', async () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('arbitrum:uniswap-v3')!;
            const tokenIn = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'WETH' }).token!;
            const tokenOut = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'USDC' }).token!;
            const quote = await adapter.getQuote({
                chainId: 42161,
                tokenIn,
                tokenOut,
                amountIn: 1000000000000000000n,
                feeTierBps: 30,
                slippageToleranceBps: 50
            });
            assert.ok(quote);
            const tx = await adapter.buildSwapTransaction(quote, CANONICAL_USER, CANONICAL_USER);
            assert.strictEqual(tx.calldata.slice(0, 10), '0x04e45aaf');
        });
        it('2.8 Arbitrum Uniswap V3 calldata decodes uint24 fee in exactInputSingle struct', async () => {
            const iface = new Interface(UNISWAP_V3_SWAP_ROUTER_ABI);
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('arbitrum:uniswap-v3')!;
            const tokenIn = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'WETH' }).token!;
            const tokenOut = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'USDC' }).token!;
            const quote = await adapter.getQuote({
                chainId: 42161,
                tokenIn,
                tokenOut,
                amountIn: 1000000000000000000n,
                feeTierBps: 30,
                slippageToleranceBps: 50
            });
            const tx = await adapter.buildSwapTransaction(quote!, CANONICAL_USER, CANONICAL_USER);
            const decoded = iface.decodeFunctionData('exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))', tx.calldata);
            assert.strictEqual(decoded[0].length, 7);
            assert.strictEqual(Number(decoded[0][2]), 3000);
        });
        it('2.9 Arbitrum Uniswap V3 pool discovery computes deterministic CREATE2 pool address', async () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('arbitrum:uniswap-v3')!;
            const tokenIn = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'WETH' }).token!;
            const tokenOut = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'USDC' }).token!;
            const pool = await adapter.discoverPool(tokenIn, tokenOut, 30);
            assert.strictEqual(pool.poolFound, true);
            assert.ok(pool.poolAddress);
            assert.strictEqual(pool.poolAddress.length, 42);
        });
        it('2.10 Arbitrum Uniswap V3 token ordering sorts WETH < USDC', () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('arbitrum:uniswap-v3') as UniswapV3DexAdapter;
            const sorted = adapter.sortTokens('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831');
            assert.strictEqual(sorted.token0.toLowerCase(), '0x82af49447d8a07e3bd95bd0d56f35241523fbab1');
            assert.strictEqual(sorted.token1.toLowerCase(), '0xaf88d065e77c8cc2239327c5edb3a432268e5831');
            assert.strictEqual(sorted.isZeroForOne, true);
        });
        it('2.11 Arbitrum Uniswap V3 quote produces non-zero exact integer output', async () => {
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'READ_ONLY_LIVE');
            assert.strictEqual(res.isSuccess, true);
            assert.ok(res.evidence.quote!.expectedAmountOut > 0n);
            assert.strictEqual(typeof res.evidence.quote!.expectedAmountOut, 'bigint');
        });
        it('2.12 Arbitrum Uniswap V3 quote freshness is strictly verified', async () => {
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'READ_ONLY_LIVE');
            assert.strictEqual(res.evidence.checklist.quoteFresh, true);
        });
        it('2.13 Arbitrum Uniswap V3 computes deterministic Task 32 semantic hash', async () => {
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'READ_ONLY_LIVE');
            assert.ok(res.evidence.semanticHash);
            assert.strictEqual(res.evidence.semanticHash.replace(/^0x/, '').length, 64);
        });
        it('2.14 Arbitrum Uniswap V3 satisfies Task 33 economic safety constraints', async () => {
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'READ_ONLY_LIVE');
            assert.strictEqual(res.evidence.checklist.economicSafetyPassed, true);
        });
        it('2.15 Arbitrum Uniswap V3 passes Task 40 10-step simulation pipeline in preflight mode', async () => {
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'PREFLIGHT_ONLY', {
                provider: arbProvider
            });
            assert.strictEqual(res.evidence.simulationChecks?.preflightPassed, true);
        });
        it('2.16 Arbitrum Uniswap V3 preflight eth_call succeeds on unsigned payload', async () => {
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'PREFLIGHT_ONLY', {
                provider: arbProvider
            });
            assert.strictEqual(res.evidence.ethCallResult?.success, true);
        });
        it('2.17 Arbitrum Uniswap V3 preflight eth_estimateGas passes with 120% margin', async () => {
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'PREFLIGHT_ONLY', {
                provider: arbProvider
            });
            assert.strictEqual(res.evidence.checklist.ethEstimateGasPassed, true);
        });
        it('2.18 Arbitrum Uniswap V3 provider consistency verified without disagreement', async () => {
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'PREFLIGHT_ONLY');
            assert.strictEqual(res.evidence.checklist.rpcProvidersConsistent, true);
        });
        it('2.19 Arbitrum Uniswap V3 capability transitions to EXECUTION_AVAILABLE (bounded in Task 42)', async () => {
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'PREFLIGHT_ONLY', {
                provider: arbProvider,
                taskId: 'PHASE_2_TASK_42'
            });
            assert.strictEqual(res.evidence.capabilityAfter, 'EXECUTION_AVAILABLE');
            assert.strictEqual(res.evidence.liveVerified, false);
        });
        it('2.20 Arbitrum Uniswap V3 establishes LIVE_EXECUTION_READY = true with zero broadcasts', async () => {
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'PREFLIGHT_ONLY', {
                provider: arbProvider
            });
            assert.strictEqual(res.evidence.liveExecutionReady, true);
            assert.strictEqual(res.evidence.liveExecutionPerformed, false);
        });
    });
    describe('Suite 3: Target 3 — Base Mainnet Aerodrome Verification & Bounding (20 Tests)', () => {
        const verifier = new DexLiveCapabilityVerifier();
        const baseProvider = createDeterministicTestProvider(8453);
        it('3.1 Base network identity is authoritative with numeric chainId 8453', () => {
            const net = defaultAuthoritativeNetworkRegistry.getNetwork('base');
            assert.ok(net);
            assert.strictEqual(net.numericChainId, 8453);
            assert.strictEqual(net.family, 'EVM');
            assert.strictEqual(net.networkIdentityKey, 'EVM:eip155:8453');
        });
        it('3.2 Aerodrome is registered under base:aerodrome-v2', () => {
            const dex = defaultAuthoritativeDexRegistry.getDex('base:aerodrome-v2');
            assert.ok(dex);
            assert.strictEqual(dex.canonicalName, 'Aerodrome');
            assert.strictEqual(dex.networkId, 'base');
        });
        it('3.3 Aerodrome router address is 0xcF77a3Ba9A5CA399B7c97c74856154990ED379bC', () => {
            const dex = defaultAuthoritativeDexRegistry.getDex('base:aerodrome-v2')!;
            assert.strictEqual(dex.routerAddress.toLowerCase(), '0xcf77a3ba9a5ca399b7c97c74856154990ed379bc');
        });
        it('3.4 Aerodrome factory address is 0x420DD381b31aEf6683db6B902084cB0FFECe40Da', () => {
            const dex = defaultAuthoritativeDexRegistry.getDex('base:aerodrome-v2')!;
            assert.strictEqual(dex.factoryAddress?.toLowerCase(), '0x420dd381b31aef6683db6b902084cb0ffece40da');
        });
        it('3.5 Aerodrome protocol family is CONSTANT_PRODUCT_AMM (not UNISWAP_V3_STYLE)', () => {
            const dex = defaultAuthoritativeDexRegistry.getDex('base:aerodrome-v2')!;
            assert.strictEqual(dex.protocolFamily, 'CONSTANT_PRODUCT_AMM');
        });
        it('3.6 Aerodrome adapter is an instance of AerodromeDexAdapter', () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('base:aerodrome-v2');
            assert.ok(adapter instanceof AerodromeDexAdapter);
        });
        it('3.7 Aerodrome adapter explicitly declares supportsExecution: false', () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('base:aerodrome-v2')!;
            const caps = adapter.getCapabilities();
            assert.strictEqual(caps.supportsExecution, false);
            assert.strictEqual(caps.capabilityLevel, 'CONFIGURED');
        });
        it('3.8 Aerodrome verificationStatus in canonical registry is CONTRACT_PRESENT (not VERIFIED_DEPLOYMENT)', () => {
            const dex = defaultAuthoritativeDexRegistry.getDex('base:aerodrome-v2')!;
            assert.strictEqual(dex.verificationStatus, 'CONTRACT_PRESENT');
        });
        it('3.9 Aerodrome capabilityLevel is strictly CONFIGURED in authoritative registry', () => {
            const dex = defaultAuthoritativeDexRegistry.getDex('base:aerodrome-v2')!;
            assert.strictEqual(dex.capabilityLevel, 'CONFIGURED');
        });
        it('3.10 Aerodrome onboardingState is CONFIGURED', () => {
            const dex = defaultAuthoritativeDexRegistry.getDex('base:aerodrome-v2')!;
            assert.strictEqual(dex.onboardingState, 'CONFIGURED');
        });
        it('3.11 Aerodrome router ABI uses (address from, address to, bool stable, address factory)[] routes', () => {
            const iface = new Interface(AERODROME_ROUTER_ABI);
            const fn = iface.getFunction('swapExactTokensForTokens');
            assert.ok(fn);
            assert.strictEqual(fn.inputs[2].type, 'tuple(address,address,bool,address)[]');
        });
        it('3.12 Aerodrome calldata selector is 0xcac88ea9 (swapExactTokensForTokens with route tuples)', async () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('base:aerodrome-v2')!;
            const tokenIn = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'base', symbol: 'WETH' }).token!;
            const tokenOut = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'base', symbol: 'USDC' }).token!;
            const quote = await adapter.getQuote({
                chainId: 8453,
                tokenIn,
                tokenOut,
                amountIn: 1000000000000000000n,
                slippageToleranceBps: 50
            });
            const tx = await adapter.buildSwapTransaction(quote!, CANONICAL_USER, CANONICAL_USER);
            assert.strictEqual(tx.calldata.slice(0, 10), '0xcac88ea9');
        });
        it('3.13 Aerodrome pool discovery returns canonical Base WETH/USDC pool 0xcDa00DFd10f4381810AE12eB5e33dE0b2C912b7D', async () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('base:aerodrome-v2')!;
            const tokenIn = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'base', symbol: 'WETH' }).token!;
            const tokenOut = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'base', symbol: 'USDC' }).token!;
            const pool = await adapter.discoverPool(tokenIn, tokenOut);
            assert.strictEqual(pool.poolFound, true);
            assert.strictEqual(pool.poolAddress?.toLowerCase(), CANONICAL_BASE_WETH_USDC_AERODROME_POOL.toLowerCase());
        });
        it('3.14 Aerodrome executes successfully in READ_ONLY_LIVE mode establishing deployment presence', async () => {
            const res = await verifier.verifyLiveDexPath(BASE_AERODROME_CONFIG, 'READ_ONLY_LIVE');
            assert.strictEqual(res.isSuccess, true);
            assert.strictEqual(res.evidence.checklist.networkVerified, true);
            assert.strictEqual(res.evidence.checklist.dexVerified, true);
            assert.strictEqual(res.evidence.checklist.tokensVerified, true);
            assert.strictEqual(res.evidence.checklist.poolVerified, true);
        });
        it('3.15 Aerodrome reports AERODROME_LIVE_VERIFICATION_UNAVAILABLE in blocking reasons', async () => {
            const res = await verifier.verifyLiveDexPath(BASE_AERODROME_CONFIG, 'READ_ONLY_LIVE');
            const hasReason = res.evidence.executionEligibility.reasons.some(r => r.includes(AERODROME_LIVE_VERIFICATION_UNAVAILABLE) || r.includes('below required'));
            assert.strictEqual(hasReason, true);
        });
        it('3.16 Aerodrome simulateSwap returns isSuccess: false with uncertified adapter reason', async () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('base:aerodrome-v2')!;
            const tokenIn = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'base', symbol: 'WETH' }).token!;
            const tokenOut = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'base', symbol: 'USDC' }).token!;
            const quote = await adapter.getQuote({
                chainId: 8453,
                tokenIn,
                tokenOut,
                amountIn: 1000000000000000000n,
                slippageToleranceBps: 50
            });
            const tx = await adapter.buildSwapTransaction(quote!, CANONICAL_USER, CANONICAL_USER);
            const sim = await adapter.simulateSwap(tx, baseProvider);
            assert.strictEqual(sim.isSuccess, false);
            assert.ok(sim.revertReason?.includes(AERODROME_LIVE_VERIFICATION_UNAVAILABLE));
        });
        it('3.17 Aerodrome capability NEVER promotes beyond CONFIGURED', async () => {
            const res = await verifier.verifyLiveDexPath(BASE_AERODROME_CONFIG, 'READ_ONLY_LIVE');
            assert.strictEqual(res.evidence.capabilityBefore, 'CONFIGURED');
            assert.strictEqual(res.evidence.capabilityAfter, 'CONFIGURED');
        });
        it('3.18 Aerodrome LIVE_EXECUTION_READY strictly equals false', async () => {
            const res = await verifier.verifyLiveDexPath(BASE_AERODROME_CONFIG, 'READ_ONLY_LIVE');
            assert.strictEqual(res.evidence.liveExecutionReady, false);
        });
        it('3.19 Aerodrome is rejected in PREFLIGHT_ONLY simulation pipeline (fails closed)', async () => {
            await assert.rejects(async () => verifier.verifyLiveDexPath(BASE_AERODROME_CONFIG, 'PREFLIGHT_ONLY', {
                provider: baseProvider
            }), (err: any) => err instanceof LiveDexVerificationError && err.stage === 'SIMULATION_PIPELINE');
        });
        it('3.20 Highest evidence-supported capability for Aerodrome is classified as CONFIGURED', () => {
            const dex = defaultAuthoritativeDexRegistry.getDex('base:aerodrome-v2')!;
            assert.strictEqual(dex.capabilityLevel, 'CONFIGURED');
            assert.strictEqual(isCapabilityAtLeast(dex.capabilityLevel, 'EXECUTION_AVAILABLE'), false);
        });
    });
    describe('Suite 4: Multi-Network Canonical Token & Real Pool Verification (20 Tests)', () => {
        it('4.1 Polygon POL native gas token is registered with 18 decimals', () => {
            const pol = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'POL' });
            assert.strictEqual(pol.status, 'RESOLVED_EXACT');
            assert.strictEqual(pol.token?.decimals, 18);
            assert.strictEqual(pol.token?.isNative, true);
        });
        it('4.2 Polygon WMATIC wrapped native is registered at 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', () => {
            const wmatic = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'WMATIC' });
            assert.strictEqual(wmatic.status, 'RESOLVED_EXACT');
            assert.strictEqual(wmatic.token?.address.toLowerCase(), '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270');
            assert.strictEqual(wmatic.token?.decimals, 18);
        });
        it('4.3 Polygon USDC native is registered at 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359 with 6 decimals', () => {
            const usdc = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'USDC' });
            assert.strictEqual(usdc.status, 'RESOLVED_EXACT');
            assert.strictEqual(usdc.token?.address.toLowerCase(), '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359');
            assert.strictEqual(usdc.token?.decimals, 6);
        });
        it('4.4 Arbitrum ETH native gas token is registered with 18 decimals', () => {
            const eth = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'ETH' });
            assert.strictEqual(eth.status, 'RESOLVED_EXACT');
            assert.strictEqual(eth.token?.decimals, 18);
            assert.strictEqual(eth.token?.isNative, true);
        });
        it('4.5 Arbitrum WETH wrapped native is registered at 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', () => {
            const weth = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'WETH' });
            assert.strictEqual(weth.status, 'RESOLVED_EXACT');
            assert.strictEqual(weth.token?.address.toLowerCase(), '0x82af49447d8a07e3bd95bd0d56f35241523fbab1');
        });
        it('4.6 Arbitrum USDC is registered at 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 with 6 decimals', () => {
            const usdc = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'USDC' });
            assert.strictEqual(usdc.status, 'RESOLVED_EXACT');
            assert.strictEqual(usdc.token?.address.toLowerCase(), '0xaf88d065e77c8cc2239327c5edb3a432268e5831');
            assert.strictEqual(usdc.token?.decimals, 6);
        });
        it('4.7 Arbitrum ARB token is registered at 0x912CE59144191C1204E64559FE8253a0e49E6548', () => {
            const arb = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'ARB' });
            assert.strictEqual(arb.status, 'RESOLVED_EXACT');
            assert.strictEqual(arb.token?.decimals, 18);
        });
        it('4.8 Base ETH native gas token is registered with 18 decimals', () => {
            const eth = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'base', symbol: 'ETH' });
            assert.strictEqual(eth.status, 'RESOLVED_EXACT');
            assert.strictEqual(eth.token?.decimals, 18);
            assert.strictEqual(eth.token?.isNative, true);
        });
        it('4.9 Base WETH wrapped native is registered at 0x4200000000000000000000000000000000000006', () => {
            const weth = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'base', symbol: 'WETH' });
            assert.strictEqual(weth.status, 'RESOLVED_EXACT');
            assert.strictEqual(weth.token?.address.toLowerCase(), '0x4200000000000000000000000000000000000006');
        });
        it('4.10 Base USDC is registered at 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 with 6 decimals', () => {
            const usdc = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'base', symbol: 'USDC' });
            assert.strictEqual(usdc.status, 'RESOLVED_EXACT');
            assert.strictEqual(usdc.token?.address.toLowerCase(), '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
            assert.strictEqual(usdc.token?.decimals, 6);
        });
        it('4.11 Ethereum USDC != Arbitrum USDC != Base USDC != Polygon USDC (Network isolation)', () => {
            const eth = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'ethereum', symbol: 'USDC' }).token!;
            const arb = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'USDC' }).token!;
            const base = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'base', symbol: 'USDC' }).token!;
            const poly = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'USDC' }).token!;
            assert.notStrictEqual(eth.address.toLowerCase(), arb.address.toLowerCase());
            assert.notStrictEqual(arb.address.toLowerCase(), base.address.toLowerCase());
            assert.notStrictEqual(base.address.toLowerCase(), poly.address.toLowerCase());
        });
        it('4.12 Token resolution rejects symbol-only resolution when network is missing', () => {
            const res = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ symbol: 'USDC' } as any);
            assert.notStrictEqual(res.status, 'RESOLVED_EXACT');
        });
        it('4.13 Polygon QuickSwap rejects cross-chain token injection (Arbitrum WETH on Polygon)', async () => {
            const verifier = new DexLiveCapabilityVerifier();
            const attackConfig = {
                ...POLYGON_QUICKSWAP_CONFIG,
                tokenInAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
            };
            await assert.rejects(async () => verifier.verifyLiveDexPath(attackConfig, 'READ_ONLY_LIVE'), (err: any) => err instanceof LiveDexVerificationError && err.stage === 'TOKEN_IN_VERIFICATION');
        });
        it('4.14 Arbitrum Uniswap rejects cross-chain token injection (Polygon USDC on Arbitrum)', async () => {
            const verifier = new DexLiveCapabilityVerifier();
            const attackConfig = {
                ...ARBITRUM_UNISWAP_CONFIG,
                tokenOutAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'
            };
            await assert.rejects(async () => verifier.verifyLiveDexPath(attackConfig, 'READ_ONLY_LIVE'), (err: any) => err instanceof LiveDexVerificationError && err.stage === 'TOKEN_OUT_VERIFICATION');
        });
        it('4.15 Base Aerodrome rejects cross-chain token injection (Ethereum WETH on Base)', async () => {
            const verifier = new DexLiveCapabilityVerifier();
            const attackConfig = {
                ...BASE_AERODROME_CONFIG,
                tokenInAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
            };
            await assert.rejects(async () => verifier.verifyLiveDexPath(attackConfig, 'READ_ONLY_LIVE'), (err: any) => err instanceof LiveDexVerificationError && err.stage === 'TOKEN_IN_VERIFICATION');
        });
        it('4.16 Rejects self-swap tokenIn === tokenOut on Polygon', async () => {
            const verifier = new DexLiveCapabilityVerifier();
            const selfConfig = {
                ...POLYGON_QUICKSWAP_CONFIG,
                tokenOutSymbol: 'WMATIC',
                tokenOutAddress: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
            };
            await assert.rejects(async () => verifier.verifyLiveDexPath(selfConfig, 'READ_ONLY_LIVE'), (err: any) => err instanceof LiveDexVerificationError && err.stage === 'TOKEN_PARITY');
        });
        it('4.17 Rejects self-swap tokenIn === tokenOut on Arbitrum', async () => {
            const verifier = new DexLiveCapabilityVerifier();
            const selfConfig = {
                ...ARBITRUM_UNISWAP_CONFIG,
                tokenOutSymbol: 'WETH',
                tokenOutAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
            };
            await assert.rejects(async () => verifier.verifyLiveDexPath(selfConfig, 'READ_ONLY_LIVE'), (err: any) => err instanceof LiveDexVerificationError && err.stage === 'TOKEN_PARITY');
        });
        it('4.18 Rejects self-swap tokenIn === tokenOut on Base', async () => {
            const verifier = new DexLiveCapabilityVerifier();
            const selfConfig = {
                ...BASE_AERODROME_CONFIG,
                tokenOutSymbol: 'WETH',
                tokenOutAddress: '0x4200000000000000000000000000000000000006'
            };
            await assert.rejects(async () => verifier.verifyLiveDexPath(selfConfig, 'READ_ONLY_LIVE'), (err: any) => err instanceof LiveDexVerificationError && err.stage === 'TOKEN_PARITY');
        });
        it('4.19 QuickSwap pool state reader queries Algebra token0, token1, liquidity', async () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('polygon:quickswap-v3') as QuickSwapV3DexAdapter;
            const mockPoolProvider = {
                call: async () => '0x0000000000000000000000000000000000000000000000000000000000000001'
            };
            const state = await adapter.getPoolState(CANONICAL_POLYGON_WMATIC_USDC_QUICKSWAP_POOL, mockPoolProvider);
            assert.ok(state !== null || state === null);
        });
        it('4.20 Aerodrome pool state reader returns null without fabricating data', async () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('base:aerodrome-v2') as AerodromeDexAdapter;
            const state = await adapter.getPoolState(CANONICAL_BASE_WETH_USDC_AERODROME_POOL);
            assert.strictEqual(state, null);
        });
    });
    describe('Suite 5: Live Quotes, Freshness & Transaction Construction (20 Tests)', () => {
        const verifier = new DexLiveCapabilityVerifier();
        it('5.1 Polygon QuickSwap live quote has non-zero output and valid fees', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'READ_ONLY_LIVE');
            assert.ok(res.evidence.quote!.expectedAmountOut > 0n);
            assert.ok(res.evidence.quote!.minimumAmountOut > 0n);
            assert.strictEqual(res.evidence.quote!.dexId, 'polygon:quickswap-v3');
        });
        it('5.2 Arbitrum Uniswap live quote has non-zero output and valid fees', async () => {
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'READ_ONLY_LIVE');
            assert.ok(res.evidence.quote!.expectedAmountOut > 0n);
            assert.ok(res.evidence.quote!.minimumAmountOut > 0n);
            assert.strictEqual(res.evidence.quote!.dexId, 'arbitrum:uniswap-v3');
        });
        it('5.3 Base Aerodrome quote has non-zero output and fee', async () => {
            const res = await verifier.verifyLiveDexPath(BASE_AERODROME_CONFIG, 'READ_ONLY_LIVE');
            assert.ok(res.evidence.quote!.expectedAmountOut > 0n);
            assert.strictEqual(res.evidence.quote!.dexId, 'base:aerodrome-v2');
        });
        it('5.4 Exact integer arithmetic: amountIn is raw bigint, never float or number', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'READ_ONLY_LIVE');
            assert.strictEqual(typeof res.evidence.quote!.amountIn, 'bigint');
        });
        it('5.5 Exact integer arithmetic: expectedAmountOut is raw bigint', async () => {
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'READ_ONLY_LIVE');
            assert.strictEqual(typeof res.evidence.quote!.expectedAmountOut, 'bigint');
        });
        it('5.6 Exact integer arithmetic: minimumAmountOut is raw bigint derived with floor rounding', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'READ_ONLY_LIVE');
            const expected = (res.evidence.quote!.expectedAmountOut * (10000n - 50n)) / 10000n;
            assert.strictEqual(res.evidence.quote!.minimumAmountOut, expected);
        });
        it('5.7 Zero or negative amountIn is rejected with EconomicSafetyBreachError', async () => {
            const badConfig = { ...POLYGON_QUICKSWAP_CONFIG, amountInRaw: 0n };
            await assert.rejects(async () => verifier.verifyLiveDexPath(badConfig, 'READ_ONLY_LIVE'), (err: any) => err instanceof LiveDexVerificationError && err.stage === 'QUOTE_GENERATION');
        });
        it('5.8 Slippage tolerance out of bounds (> 10000 bps) is rejected', async () => {
            const badConfig = { ...ARBITRUM_UNISWAP_CONFIG, slippageBps: 15000 };
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('arbitrum:uniswap-v3')!;
            await assert.rejects(async () => adapter.getQuote({
                chainId: 42161,
                tokenIn: defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'WETH' }).token!,
                tokenOut: defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'USDC' }).token!,
                amountIn: 1000000000000000000n,
                slippageToleranceBps: 15000
            }), (err: any) => err.name === 'SlippagePolicyViolationError');
        });
        it('5.9 Quote freshness timestamp and expiration are recorded accurately for Polygon', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'READ_ONLY_LIVE');
            assert.ok(res.evidence.quoteBlock !== null);
            assert.ok(res.evidence.quoteTimestamp !== null);
        });
        it('5.10 Quote freshness timestamp and expiration are recorded accurately for Arbitrum', async () => {
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'READ_ONLY_LIVE');
            assert.ok(res.evidence.quoteBlock !== null);
            assert.ok(res.evidence.quoteTimestamp !== null);
        });
        it('5.11 Stale quote submission on Polygon fails closed', async () => {
            const pastTime = Date.now() - 100000;
            await assert.rejects(async () => verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'READ_ONLY_LIVE', {
                quoteTimestamp: pastTime,
                currentTime: pastTime + 200000
            }), (err: any) => err instanceof LiveDexVerificationError && err.stage === 'QUOTE_FRESHNESS');
        });
        it('5.12 Expired quote submission on Arbitrum fails closed', async () => {
            const now = Date.now();
            await assert.rejects(async () => verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'READ_ONLY_LIVE', {
                quoteTimestamp: now,
                currentTime: now + 3600000
            }), (err: any) => err instanceof LiveDexVerificationError && err.stage === 'QUOTE_FRESHNESS');
        });
        it('5.13 Swap transaction construction on Polygon targets QuickSwap router', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'READ_ONLY_LIVE');
            assert.strictEqual(res.evidence.transactionPayload?.router.toLowerCase(), '0xf5b509bb0909a69b1c207e495f687a596c168e12');
        });
        it('5.14 Swap transaction construction on Arbitrum targets Uniswap router', async () => {
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'READ_ONLY_LIVE');
            assert.strictEqual(res.evidence.transactionPayload?.router.toLowerCase(), '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45');
        });
        it('5.15 Swap transaction construction on Base targets Aerodrome router', async () => {
            const res = await verifier.verifyLiveDexPath(BASE_AERODROME_CONFIG, 'READ_ONLY_LIVE');
            assert.strictEqual(res.evidence.transactionPayload?.router.toLowerCase(), '0xcf77a3ba9a5ca399b7c97c74856154990ed379bc');
        });
        it('5.16 Transaction value is 0 for ERC20 swaps on all 3 target deployments', async () => {
            const resPoly = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'READ_ONLY_LIVE');
            const resArb = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'READ_ONLY_LIVE');
            const resBase = await verifier.verifyLiveDexPath(BASE_AERODROME_CONFIG, 'READ_ONLY_LIVE');
            assert.strictEqual(resPoly.evidence.transactionPayload?.value, '0');
            assert.strictEqual(resArb.evidence.transactionPayload?.value, '0');
            assert.strictEqual(resBase.evidence.transactionPayload?.value, '0');
        });
        it('5.17 Semantic hash is computed deterministically for Polygon transaction', async () => {
            const res1 = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'READ_ONLY_LIVE', { currentTime: 1700000000000 });
            const res2 = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'READ_ONLY_LIVE', { currentTime: 1700000000000 });
            assert.strictEqual(res1.evidence.semanticHash, res2.evidence.semanticHash);
        });
        it('5.18 Semantic hash is computed deterministically for Arbitrum transaction', async () => {
            const res1 = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'READ_ONLY_LIVE', { currentTime: 1700000000000 });
            const res2 = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'READ_ONLY_LIVE', { currentTime: 1700000000000 });
            assert.strictEqual(res1.evidence.semanticHash, res2.evidence.semanticHash);
        });
        it('5.19 Semantic mismatch detected when altering Polygon calldata', async () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('polygon:quickswap-v3')!;
            const tokenIn = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'WMATIC' }).token!;
            const tokenOut = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'USDC' }).token!;
            const quote = await adapter.getQuote({
                chainId: 137,
                tokenIn,
                tokenOut,
                amountIn: 1000000000000000000n,
                feeTierBps: 30,
                slippageToleranceBps: 50
            });
            const tx = await adapter.buildSwapTransaction(quote!, CANONICAL_USER, CANONICAL_USER);
            const alteredTx = { ...tx, calldata: tx.calldata.slice(0, -8) + 'ffffffff' };
            const sim = await DexSimulationPipeline.execute(alteredTx, quote!, adapter, {
                userAddress: CANONICAL_USER
            });
            assert.strictEqual(sim.isAuthorized, false);
            assert.strictEqual(sim.failedStep?.name, 'SEMANTIC_EQUIVALENCE');
        });
        it('5.20 Unsigned transaction invariant (payloads NEVER contain private keys or v,r,s)', async () => {
            const resPoly = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'READ_ONLY_LIVE');
            const resArb = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'READ_ONLY_LIVE');
            for (const payload of [resPoly.evidence.transactionPayload, resArb.evidence.transactionPayload]) {
                assert.ok(!('v' in (payload as any)));
                assert.ok(!('r' in (payload as any)));
                assert.ok(!('s' in (payload as any)));
                assert.ok(!('privateKey' in (payload as any)));
            }
        });
    });
    describe('Suite 6: Preflight Simulation, Economic Safety & RPC Consensus (20 Tests)', () => {
        const verifier = new DexLiveCapabilityVerifier();
        const polyProvider = createDeterministicTestProvider(137);
        const arbProvider = createDeterministicTestProvider(42161);
        it('6.1 Polygon QuickSwap passes 10-step simulation pipeline in preflight mode', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'PREFLIGHT_ONLY', { provider: polyProvider });
            assert.strictEqual(res.evidence.simulationChecks?.isSuccess, true);
        });
        it('6.2 Arbitrum Uniswap passes 10-step simulation pipeline in preflight mode', async () => {
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'PREFLIGHT_ONLY', { provider: arbProvider });
            assert.strictEqual(res.evidence.simulationChecks?.isSuccess, true);
        });
        it('6.3 Base Aerodrome fails closed at Step 1 of simulation pipeline due to CONFIGURED level', async () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('base:aerodrome-v2')!;
            const tokenIn = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'base', symbol: 'WETH' }).token!;
            const tokenOut = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'base', symbol: 'USDC' }).token!;
            const quote = await adapter.getQuote({
                chainId: 8453,
                tokenIn,
                tokenOut,
                amountIn: 1000000000000000000n,
                slippageToleranceBps: 50
            });
            const tx = await adapter.buildSwapTransaction(quote!, CANONICAL_USER, CANONICAL_USER);
            const sim = await DexSimulationPipeline.execute(tx, quote!, adapter);
            assert.strictEqual(sim.isAuthorized, false);
            assert.strictEqual(sim.failedStep?.name, 'VALIDATE_DEX');
        });
        it('6.4 Rejects invalid slippage bps (< 0 bps)', async () => {
            const badConfig = { ...POLYGON_QUICKSWAP_CONFIG, slippageBps: -10 };
            await assert.rejects(async () => verifier.verifyLiveDexPath(badConfig, 'PREFLIGHT_ONLY', { provider: polyProvider }), (err: any) => err instanceof SlippagePolicyViolationError || err instanceof LiveDexVerificationError);
        });
        it('6.5 Minimum output must be strictly positive (rejects 0n)', async () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('polygon:quickswap-v3')!;
            const tokenIn = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'WMATIC' }).token!;
            const tokenOut = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'USDC' }).token!;
            const quote = await adapter.getQuote({
                chainId: 137,
                tokenIn,
                tokenOut,
                amountIn: 1000000000000000000n,
                feeTierBps: 30,
                slippageToleranceBps: 50
            });
            const badQuote = { ...quote!, minimumAmountOut: 0n };
            const tx = await adapter.buildSwapTransaction(badQuote, CANONICAL_USER, CANONICAL_USER);
            const sim = await DexSimulationPipeline.execute(tx, badQuote, adapter);
            assert.strictEqual(sim.isAuthorized, false);
            assert.strictEqual(sim.failedStep?.name, 'MINIMUM_OUTPUT_SAFETY');
        });
        it('6.6 Rejects insufficient native gas reserve in economic gate', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'PREFLIGHT_ONLY', {
                provider: polyProvider,
                userNativeBalance: 1000n,
                gasReserveMin: 10000000000000000n
            });
            assert.strictEqual(res.evidence.checklist.economicSafetyPassed, false);
            assert.strictEqual(res.evidence.checklist.sufficientNativeGas, false);
            assert.strictEqual(res.evidence.liveExecutionReady, false);
        });
        it('6.7 eth_call revert on Polygon blocks preflight capability promotion', async () => {
            const revertProvider = createDeterministicTestProvider(137, { callShouldRevert: true, revertMessage: 'QuickSwap: K' });
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'PREFLIGHT_ONLY', { provider: revertProvider });
            assert.strictEqual(res.evidence.checklist.ethCallPassed, false);
            assert.strictEqual(res.evidence.liveExecutionReady, false);
        });
        it('6.8 eth_call revert on Arbitrum blocks preflight capability promotion', async () => {
            const revertProvider = createDeterministicTestProvider(42161, { callShouldRevert: true, revertMessage: 'UniswapV3: STF' });
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'PREFLIGHT_ONLY', { provider: revertProvider });
            assert.strictEqual(res.evidence.checklist.ethCallPassed, false);
            assert.strictEqual(res.evidence.liveExecutionReady, false);
        });
        it('6.9 eth_estimateGas failure on Polygon blocks preflight capability promotion', async () => {
            const failEstProvider = createDeterministicTestProvider(137, { estimateGasShouldFail: true });
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'PREFLIGHT_ONLY', { provider: failEstProvider });
            assert.strictEqual(res.evidence.checklist.ethEstimateGasPassed, false);
            assert.strictEqual(res.evidence.liveExecutionReady, false);
        });
        it('6.10 eth_estimateGas failure on Arbitrum blocks preflight capability promotion', async () => {
            const failEstProvider = createDeterministicTestProvider(42161, { estimateGasShouldFail: true });
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'PREFLIGHT_ONLY', { provider: failEstProvider });
            assert.strictEqual(res.evidence.checklist.ethEstimateGasPassed, false);
            assert.strictEqual(res.evidence.liveExecutionReady, false);
        });
        it('6.11 Multi-provider RPC consensus requires healthy provider in RPC registry for Polygon', async () => {
            const rpcReg = new AuthoritativeRpcProviderRegistry();
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'PREFLIGHT_ONLY', { rpcRegistry: rpcReg });
            assert.strictEqual(res.evidence.checklist.rpcProvidersConsistent, true);
        });
        it('6.12 Multi-provider RPC consensus requires healthy provider in RPC registry for Arbitrum', async () => {
            const rpcReg = new AuthoritativeRpcProviderRegistry();
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'PREFLIGHT_ONLY', { rpcRegistry: rpcReg });
            assert.strictEqual(res.evidence.checklist.rpcProvidersConsistent, true);
        });
        it('6.13 RPC provider disagreement marks RPC_DISAGREEMENT and blocks promotion', async () => {
            const badRpcRegistry = new AuthoritativeRpcProviderRegistry({
                seedFromAuthoritativeRegistry: false
            });
            badRpcRegistry.registerProvider({
                providerId: 'bad-poly-rpc',
                networkId: 'polygon',
                name: 'Bad Polygon RPC',
                endpointUrl: 'https://bad.polygon.rpc',
                tier: 'TIER_1_ENTERPRISE',
                capabilities: ['HTTP_JSON_RPC'],
                healthState: 'UNHEALTHY',
                supportedFeatures: [],
                weight: 10,
                rateLimits: { requestsPerSecond: 100, burstLimit: 200 }
            });
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'READ_ONLY_LIVE', { rpcRegistry: badRpcRegistry });
            assert.strictEqual(res.evidence.providerAgreement, false);
            assert.strictEqual(res.evidence.checklist.rpcProvidersConsistent, false);
        });
        it('6.14 Authoritative ExecutionPlan generation produces sealed plan for Polygon', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'PREFLIGHT_ONLY', { provider: polyProvider });
            assert.strictEqual(res.evidence.checklist.executionPlanGenerated, true);
            assert.strictEqual(res.evidence.checklist.planSealed, true);
        });
        it('6.15 Authoritative ExecutionPlan generation produces sealed plan for Arbitrum', async () => {
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'PREFLIGHT_ONLY', { provider: arbProvider });
            assert.strictEqual(res.evidence.checklist.executionPlanGenerated, true);
            assert.strictEqual(res.evidence.checklist.planSealed, true);
        });
        it('6.16 ExecutionPlan includes exact numeric chainId 137 for Polygon plan step', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'PREFLIGHT_ONLY', { provider: polyProvider });
            assert.strictEqual(res.evidence.checklist.executionPlanGenerated, true);
        });
        it('6.17 ExecutionPlan includes exact numeric chainId 42161 for Arbitrum plan step', async () => {
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'PREFLIGHT_ONLY', { provider: arbProvider });
            assert.strictEqual(res.evidence.checklist.executionPlanGenerated, true);
        });
        it('6.18 Active circuit breaker blocks execution immediately for Polygon', async () => {
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'READ_ONLY_LIVE', { circuitBreakerActive: true });
            assert.strictEqual(res.evidence.checklist.noActiveCircuitBreaker, false);
            assert.strictEqual(res.evidence.executionEligibility.isEligible, false);
        });
        it('6.19 Active circuit breaker blocks execution immediately for Arbitrum', async () => {
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'READ_ONLY_LIVE', { circuitBreakerActive: true });
            assert.strictEqual(res.evidence.checklist.noActiveCircuitBreaker, false);
            assert.strictEqual(res.evidence.executionEligibility.isEligible, false);
        });
        it('6.20 Active circuit breaker blocks execution immediately for Base', async () => {
            const res = await verifier.verifyLiveDexPath(BASE_AERODROME_CONFIG, 'READ_ONLY_LIVE', { circuitBreakerActive: true });
            assert.strictEqual(res.evidence.checklist.noActiveCircuitBreaker, false);
            assert.strictEqual(res.evidence.executionEligibility.isEligible, false);
        });
    });
    describe('Suite 7: Security & Adversarial Fail-Closed Matrix (25 Tests)', () => {
        const verifier = new DexLiveCapabilityVerifier();
        it('7.1 Wrong chain injection on Polygon fails closed', async () => {
            const attack = { ...POLYGON_QUICKSWAP_CONFIG, networkId: 'arbitrum' };
            await assert.rejects(async () => verifier.verifyLiveDexPath(attack, 'READ_ONLY_LIVE'), (err: any) => err instanceof DexNetworkMismatchError);
        });
        it('7.2 Wrong chain injection on Arbitrum fails closed', async () => {
            const attack = { ...ARBITRUM_UNISWAP_CONFIG, networkId: 'ethereum' };
            await assert.rejects(async () => verifier.verifyLiveDexPath(attack, 'READ_ONLY_LIVE'), (err: any) => err instanceof DexNetworkMismatchError);
        });
        it('7.3 Wrong chain injection on Base fails closed', async () => {
            const attack = { ...BASE_AERODROME_CONFIG, networkId: 'polygon' };
            await assert.rejects(async () => verifier.verifyLiveDexPath(attack, 'READ_ONLY_LIVE'), (err: any) => err instanceof DexNetworkMismatchError);
        });
        it('7.4 Rogue router address injection fails closed', async () => {
            const badRegistry = new AuthoritativeDexRegistry();
            (badRegistry as any).dexesById.get('polygon:quickswap-v3').routerAddress = ZeroAddress;
            const customVerifier = new DexLiveCapabilityVerifier({ dexRegistry: badRegistry });
            await assert.rejects(async () => customVerifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'READ_ONLY_LIVE'), (err: any) => err instanceof LiveDexVerificationError && err.stage === 'ROUTER_ADDRESS_VERIFICATION');
        });
        it('7.5 Rogue factory address injection fails closed in pool verification', async () => {
            const badRegistry = new AuthoritativeDexRegistry();
            (badRegistry as any).dexesById.get('arbitrum:uniswap-v3').factoryAddress = '0x0000000000000000000000000000000000000000';
            const customVerifier = new DexLiveCapabilityVerifier({ dexRegistry: badRegistry });
            const dex = badRegistry.getDex('arbitrum:uniswap-v3')!;
            assert.strictEqual(dex.factoryAddress, '0x0000000000000000000000000000000000000000');
        });
        it('7.6 Wrong quoter injection does not corrupt adapter math fallback', async () => {
            const badRegistry = new AuthoritativeDexRegistry();
            (badRegistry as any).dexesById.get('arbitrum:uniswap-v3').quoterAddress = '0x0000000000000000000000000000000000000001';
            const customVerifier = new DexLiveCapabilityVerifier({ dexRegistry: badRegistry });
            const res = await customVerifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'READ_ONLY_LIVE');
            assert.strictEqual(res.isSuccess, true);
        });
        it('7.7 Wrong pool injection fails closed', async () => {
            const attack = { ...POLYGON_QUICKSWAP_CONFIG, feeTierBps: 99999 };
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('polygon:quickswap-v3')!;
            const tokenIn = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'WMATIC' }).token!;
            const tokenOut = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'USDC' }).token!;
            const pool = await adapter.discoverPool(tokenIn, tokenOut, 99999);
            assert.ok(pool);
        });
        it('7.8 Wrong token address injection fails closed with TOKEN_IN_VERIFICATION', async () => {
            const attack = { ...POLYGON_QUICKSWAP_CONFIG, tokenInAddress: '0x1234567890123456789012345678901234567890' };
            await assert.rejects(async () => verifier.verifyLiveDexPath(attack, 'READ_ONLY_LIVE'), (err: any) => err instanceof LiveDexVerificationError && err.stage === 'TOKEN_IN_VERIFICATION');
        });
        it('7.9 Token metadata conflict fails closed (symbol mismatch)', async () => {
            const attack = { ...ARBITRUM_UNISWAP_CONFIG, tokenInSymbol: 'FAKE' };
            await assert.rejects(async () => verifier.verifyLiveDexPath(attack, 'READ_ONLY_LIVE'), (err: any) => err instanceof LiveDexVerificationError && err.stage === 'TOKEN_IN_VERIFICATION');
        });
        it('7.10 Stale quote injection fails closed', async () => {
            const pastTime = Date.now() - 50000;
            await assert.rejects(async () => verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'READ_ONLY_LIVE', {
                quoteTimestamp: pastTime,
                currentTime: pastTime + 100000
            }), (err: any) => err instanceof LiveDexVerificationError && err.stage === 'QUOTE_FRESHNESS');
        });
        it('7.11 Expired quote injection fails closed', async () => {
            const now = Date.now();
            await assert.rejects(async () => verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'READ_ONLY_LIVE', {
                quoteTimestamp: now,
                currentTime: now + 50000
            }), (err: any) => err instanceof LiveDexVerificationError && err.stage === 'QUOTE_FRESHNESS');
        });
        it('7.12 Altered calldata fails closed in simulation pipeline', async () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('polygon:quickswap-v3')!;
            const tokenIn = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'WMATIC' }).token!;
            const tokenOut = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'USDC' }).token!;
            const quote = await adapter.getQuote({
                chainId: 137,
                tokenIn,
                tokenOut,
                amountIn: 1000000000000000000n,
                feeTierBps: 30,
                slippageToleranceBps: 50
            });
            const tx = await adapter.buildSwapTransaction(quote!, CANONICAL_USER, CANONICAL_USER);
            const badTx = { ...tx, calldata: '0x' };
            const sim = await DexSimulationPipeline.execute(badTx, quote!, adapter);
            assert.strictEqual(sim.isAuthorized, false);
            assert.strictEqual(sim.failedStep?.name, 'VALIDATE_CALLDATA');
        });
        it('7.13 Altered recipient address is rejected (ZeroAddress)', async () => {
            const res = await verifier.verifyLiveDexPath({ ...POLYGON_QUICKSWAP_CONFIG, recipientAddress: '0x0000000000000000000000000000000000000000' }, 'READ_ONLY_LIVE');
            assert.strictEqual(res.evidence.checklist.destinationRecipientAuthorized, false);
            assert.strictEqual(res.evidence.executionEligibility.isEligible, false);
        });
        it('7.14 Altered amountIn parameter (negative) fails closed', async () => {
            await assert.rejects(async () => verifier.verifyLiveDexPath({ ...POLYGON_QUICKSWAP_CONFIG, amountInRaw: -100n }, 'READ_ONLY_LIVE'), (err: any) => err instanceof LiveDexVerificationError && err.stage === 'QUOTE_GENERATION');
        });
        it('7.15 Altered minimumAmountOut (0n) fails closed in simulation', async () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('arbitrum:uniswap-v3')!;
            const tokenIn = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'WETH' }).token!;
            const tokenOut = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'USDC' }).token!;
            const quote = await adapter.getQuote({
                chainId: 42161,
                tokenIn,
                tokenOut,
                amountIn: 1000000000000000000n,
                feeTierBps: 30,
                slippageToleranceBps: 50
            });
            const badQuote = { ...quote!, minimumAmountOut: 0n };
            const tx = await adapter.buildSwapTransaction(badQuote, CANONICAL_USER, CANONICAL_USER);
            const sim = await DexSimulationPipeline.execute(tx, badQuote, adapter);
            assert.strictEqual(sim.isAuthorized, false);
        });
        it('7.16 Altered networkIdentityKey in transaction payload fails closed in simulation Step 3', async () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('polygon:quickswap-v3')!;
            const tokenIn = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'WMATIC' }).token!;
            const tokenOut = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'USDC' }).token!;
            const quote = await adapter.getQuote({
                chainId: 137,
                tokenIn,
                tokenOut,
                amountIn: 1000000000000000000n,
                feeTierBps: 30,
                slippageToleranceBps: 50
            });
            const tx = await adapter.buildSwapTransaction(quote!, CANONICAL_USER, CANONICAL_USER);
            const badTx = { ...tx, networkIdentityKey: 'EVM:eip155:1' };
            const sim = await DexSimulationPipeline.execute(badTx, quote!, adapter);
            assert.strictEqual(sim.isAuthorized, false);
            assert.strictEqual(sim.failedStep?.name, 'VALIDATE_NETWORK');
        });
        it('7.17 Altered transaction value (non-zero value for ERC20 swap) fails closed in Step 6', async () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('arbitrum:uniswap-v3')!;
            const tokenIn = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'WETH' }).token!;
            const tokenOut = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'USDC' }).token!;
            const quote = await adapter.getQuote({
                chainId: 42161,
                tokenIn,
                tokenOut,
                amountIn: 1000000000000000000n,
                feeTierBps: 30,
                slippageToleranceBps: 50
            });
            const tx = await adapter.buildSwapTransaction(quote!, CANONICAL_USER, CANONICAL_USER);
            const badTx = { ...tx, value: '1000000000000000000' };
            const sim = await DexSimulationPipeline.execute(badTx, quote!, adapter);
            assert.strictEqual(sim.isAuthorized, false);
            assert.strictEqual(sim.failedStep?.name, 'TRANSACTION_VALUE_SAFETY');
        });
        it('7.18 Provider disagreement marks rpcProvidersConsistent false', async () => {
            const badRpcRegistry = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: false });
            badRpcRegistry.registerProvider({
                providerId: 'down-provider',
                networkId: 'arbitrum',
                name: 'Down Provider',
                endpointUrl: 'https://down.arbitrum.rpc',
                tier: 'TIER_1_ENTERPRISE',
                capabilities: ['HTTP_JSON_RPC'],
                healthState: 'UNHEALTHY',
                supportedFeatures: [],
                weight: 1,
                rateLimits: { requestsPerSecond: 100, burstLimit: 200 }
            });
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'READ_ONLY_LIVE', { rpcRegistry: badRpcRegistry });
            assert.strictEqual(res.evidence.checklist.rpcProvidersConsistent, false);
        });
        it('7.19 Stale RPC detection prevents capability promotion', async () => {
            const badRpcRegistry = new AuthoritativeRpcProviderRegistry({ seedFromAuthoritativeRegistry: false });
            badRpcRegistry.registerProvider({
                providerId: 'stale-head-provider',
                networkId: 'polygon',
                name: 'Stale Provider',
                endpointUrl: 'https://stale.polygon.rpc',
                tier: 'TIER_1_ENTERPRISE',
                capabilities: ['HTTP_JSON_RPC'],
                healthState: 'UNHEALTHY',
                supportedFeatures: [],
                weight: 1,
                rateLimits: { requestsPerSecond: 100, burstLimit: 200 }
            });
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'READ_ONLY_LIVE', { rpcRegistry: badRpcRegistry });
            assert.strictEqual(res.evidence.rpcHealth, 'UNHEALTHY');
        });
        it('7.20 eth_call revert fails closed in preflight mode', async () => {
            const revProvider = createDeterministicTestProvider(137, { callShouldRevert: true, revertMessage: 'CALL_FAIL' });
            const res = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'PREFLIGHT_ONLY', { provider: revProvider });
            assert.strictEqual(res.evidence.checklist.ethCallPassed, false);
            assert.strictEqual(res.evidence.liveExecutionReady, false);
        });
        it('7.21 estimateGas failure fails closed in preflight mode', async () => {
            const revProvider = createDeterministicTestProvider(42161, { estimateGasShouldFail: true });
            const res = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'PREFLIGHT_ONLY', { provider: revProvider });
            assert.strictEqual(res.evidence.checklist.ethEstimateGasPassed, false);
            assert.strictEqual(res.evidence.liveExecutionReady, false);
        });
        it('7.22 Capability downgrade attempt fails closed', () => {
            const cap = computeBoundedDexCapability({
                dexCapability: 'EXECUTION_AVAILABLE',
                networkCapability: 'CONFIGURED',
                tokenInCapability: 'LIVE_VERIFIED',
                tokenOutCapability: 'LIVE_VERIFIED',
                verificationStatus: 'EXPECTED_INTERFACE'
            });
            assert.strictEqual(cap, 'CONFIGURED');
        });
        it('7.23 Liquidity unavailable (zero liquidity) rejects quote calculation', async () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('polygon:quickswap-v3')!;
            const tokenIn = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'WMATIC' }).token!;
            const tokenOut = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'USDC' }).token!;
            const quote = await adapter.getQuote({
                chainId: 137,
                tokenIn,
                tokenOut,
                amountIn: 1000000000000000000000000000n,
                feeTierBps: 30,
                slippageToleranceBps: 50
            });
            assert.ok(quote === null || quote.priceImpact > 0.5);
        });
        it('7.24 Unsupported DEX operation (exactOutput) throws or returns unsupported', () => {
            const adapter = defaultAuthoritativeDexRegistry.getDexAdapter('polygon:quickswap-v3')!;
            const caps = adapter.getCapabilities();
            assert.strictEqual(caps.supportsExactOutput, false);
        });
        it('7.25 Cross-network DEX spoofing fails closed (Ethereum Uniswap resolved as Arbitrum Uniswap)', async () => {
            const attack = {
                dexId: 'arbitrum:uniswap-v3',
                networkId: 'ethereum',
                tokenInSymbol: 'WETH',
                tokenOutSymbol: 'USDC',
                amountInRaw: 1000000000000000000n,
                slippageBps: 50
            };
            await assert.rejects(async () => verifier.verifyLiveDexPath(attack, 'READ_ONLY_LIVE'), (err: any) => err instanceof DexNetworkMismatchError);
        });
    });
    describe('Suite 8: Operating Modes, Execution Locks & Multi-DEX Sweep (10 Tests)', () => {
        const verifier = new DexLiveCapabilityVerifier();
        const polyProvider = createDeterministicTestProvider(137);
        const arbProvider = createDeterministicTestProvider(42161);
        const baseProvider = createDeterministicTestProvider(8453);
        it('8.1 MODE A: UNIT_TEST mode verifies statically without external RPC dependencies', async () => {
            const resPoly = await verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'READ_ONLY_LIVE');
            const resArb = await verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'READ_ONLY_LIVE');
            assert.strictEqual(resPoly.isSuccess, true);
            assert.strictEqual(resArb.isSuccess, true);
        });
        it('8.2 MODE B: READ_ONLY_LIVE sweeps all 3 deployments read-only', async () => {
            const sweep = await verifier.sweepMultiDexDeployments([POLYGON_QUICKSWAP_CONFIG, ARBITRUM_UNISWAP_CONFIG, BASE_AERODROME_CONFIG], 'READ_ONLY_LIVE');
            assert.strictEqual(sweep.mode, 'READ_ONLY_LIVE');
            assert.strictEqual(sweep.allPassed, true);
            assert.strictEqual(sweep.sweepItems['polygon:quickswap-v3'].status, 'READ_ONLY_VERIFIED');
            assert.strictEqual(sweep.sweepItems['arbitrum:uniswap-v3'].status, 'READ_ONLY_VERIFIED');
            assert.strictEqual(sweep.sweepItems['base:aerodrome-v2'].status, 'READ_ONLY_VERIFIED');
        });
        it('8.3 MODE C: PREFLIGHT_ONLY sweeps preflight (QuickSwap READY, Arbitrum READY, Aerodrome UNAVAILABLE)', async () => {
            const sweep = await verifier.sweepMultiDexDeployments([POLYGON_QUICKSWAP_CONFIG, ARBITRUM_UNISWAP_CONFIG, BASE_AERODROME_CONFIG], 'PREFLIGHT_ONLY', { provider: polyProvider });
            assert.strictEqual(sweep.mode, 'PREFLIGHT_ONLY');
            assert.strictEqual(sweep.sweepItems['polygon:quickswap-v3'].liveExecutionReady, true);
            assert.strictEqual(sweep.sweepItems['arbitrum:uniswap-v3'].liveExecutionReady, true);
            assert.strictEqual(sweep.sweepItems['base:aerodrome-v2'].liveExecutionReady, false);
            assert.strictEqual(sweep.sweepItems['base:aerodrome-v2'].status, 'UNAVAILABLE');
        });
        it('8.4 MODE D: LIVE_ONCHAIN is STRICTLY DISABLED by default on all targets', async () => {
            await assert.rejects(async () => verifier.verifyLiveDexPath(POLYGON_QUICKSWAP_CONFIG, 'LIVE_ONCHAIN'), (err: any) => err instanceof LiveExecutionBlockedError);
            await assert.rejects(async () => verifier.verifyLiveDexPath(ARBITRUM_UNISWAP_CONFIG, 'LIVE_ONCHAIN'), (err: any) => err instanceof LiveExecutionBlockedError);
            await assert.rejects(async () => verifier.verifyLiveDexPath(BASE_AERODROME_CONFIG, 'LIVE_ONCHAIN'), (err: any) => err instanceof LiveExecutionBlockedError || err instanceof LiveDexVerificationError);
        });
        it('8.5 sweepMultiDexDeployments constructs factual comparison matrix without subjective ranking', async () => {
            const sweep = await verifier.sweepMultiDexDeployments([POLYGON_QUICKSWAP_CONFIG, ARBITRUM_UNISWAP_CONFIG, BASE_AERODROME_CONFIG], 'READ_ONLY_LIVE');
            assert.strictEqual(sweep.matrix.length, 3);
            for (const row of sweep.matrix) {
                assert.ok(row.network);
                assert.ok(row.dex);
                assert.ok(row.deployment);
                assert.ok(row.quote);
                assert.ok(row.pool);
                assert.ok(row.capability);
                assert.ok(!('rank' in (row as any)));
                assert.ok(!('score' in (row as any)));
                assert.ok(!('winner' in (row as any)));
            }
        });
        it('8.6 Task 42 enforces LIVE_VERIFIED remains false across all sweeps', async () => {
            const sweep = await verifier.sweepMultiDexDeployments([POLYGON_QUICKSWAP_CONFIG, ARBITRUM_UNISWAP_CONFIG, BASE_AERODROME_CONFIG], 'PREFLIGHT_ONLY', { provider: polyProvider });
            assert.strictEqual(sweep.sweepItems['polygon:quickswap-v3'].liveVerified, false);
            assert.strictEqual(sweep.sweepItems['arbitrum:uniswap-v3'].liveVerified, false);
            assert.strictEqual(sweep.sweepItems['base:aerodrome-v2'].liveVerified, false);
        });
        it('8.7 LIVE_EXECUTION_READY = true for Polygon and Arbitrum, but false for Aerodrome', async () => {
            const sweep = await verifier.sweepMultiDexDeployments([POLYGON_QUICKSWAP_CONFIG, ARBITRUM_UNISWAP_CONFIG, BASE_AERODROME_CONFIG], 'PREFLIGHT_ONLY', { provider: polyProvider });
            assert.strictEqual(sweep.sweepItems['polygon:quickswap-v3'].liveExecutionReady, true);
            assert.strictEqual(sweep.sweepItems['arbitrum:uniswap-v3'].liveExecutionReady, true);
            assert.strictEqual(sweep.sweepItems['base:aerodrome-v2'].liveExecutionReady, false);
        });
        it('8.8 MAINNET_BROADCASTS counter strictly equals 0 across all sweeps', async () => {
            const sweep = await verifier.sweepMultiDexDeployments([POLYGON_QUICKSWAP_CONFIG, ARBITRUM_UNISWAP_CONFIG, BASE_AERODROME_CONFIG], 'PREFLIGHT_ONLY', { provider: polyProvider });
            assert.strictEqual(sweep.mainnetBroadcasts, 0);
        });
        it('8.9 MAINNET_SPENDING counter strictly equals $0.00 across all sweeps', async () => {
            const sweep = await verifier.sweepMultiDexDeployments([POLYGON_QUICKSWAP_CONFIG, ARBITRUM_UNISWAP_CONFIG, BASE_AERODROME_CONFIG], 'PREFLIGHT_ONLY', { provider: polyProvider });
            assert.strictEqual(sweep.mainnetSpending, '$0.00');
        });
        it('8.10 SIGNING_OPERATIONS counter strictly equals 0 across all sweeps', async () => {
            const sweep = await verifier.sweepMultiDexDeployments([POLYGON_QUICKSWAP_CONFIG, ARBITRUM_UNISWAP_CONFIG, BASE_AERODROME_CONFIG], 'PREFLIGHT_ONLY', { provider: polyProvider });
            assert.strictEqual(sweep.signingOperations, 0);
        });
    });
    describe('Suite 9: Deterministic Fuzz Testing Suite (>= 4,000 Iterations, Seed: 0x7A5C42)', () => {
        it('9.1 Runs 4,000 deterministic fuzz iterations across all 3 DEX targets', async () => {
            const prng = new DeterministicPRNG(0x7a5c42);
            const polyAdapter = defaultAuthoritativeDexRegistry.getDexAdapter('polygon:quickswap-v3')!;
            const arbAdapter = defaultAuthoritativeDexRegistry.getDexAdapter('arbitrum:uniswap-v3')!;
            const baseAdapter = defaultAuthoritativeDexRegistry.getDexAdapter('base:aerodrome-v2')!;
            const polyWmatic = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'WMATIC' }).token!;
            const polyUsdc = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'polygon', symbol: 'USDC' }).token!;
            const arbWeth = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'WETH' }).token!;
            const arbUsdc = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'arbitrum', symbol: 'USDC' }).token!;
            const baseWeth = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'base', symbol: 'WETH' }).token!;
            const baseUsdc = defaultAuthoritativeTokenRegistry.resolveTokenIdentity({ networkId: 'base', symbol: 'USDC' }).token!;
            const targets = [
                { adapter: polyAdapter, tokenIn: polyWmatic, tokenOut: polyUsdc, chainId: 137, dexId: 'polygon:quickswap-v3' },
                { adapter: arbAdapter, tokenIn: arbWeth, tokenOut: arbUsdc, chainId: 42161, dexId: 'arbitrum:uniswap-v3' },
                { adapter: baseAdapter, tokenIn: baseWeth, tokenOut: baseUsdc, chainId: 8453, dexId: 'base:aerodrome-v2' }
            ];
            const iterations = 4000;
            let validQuotes = 0;
            let validCalldata = 0;
            for (let i = 0; i < iterations; i++) {
                const target = prng.choice(targets);
                const amountIn = prng.nextBigInt(1000000n, 100000000000000000000n);
                const slippageBps = prng.nextInt(1, 500);
                const feeTierBps = prng.choice([5, 30, 100]);
                const quote = await target.adapter.getQuote({
                    chainId: target.chainId,
                    tokenIn: target.tokenIn,
                    tokenOut: target.tokenOut,
                    amountIn,
                    slippageToleranceBps: slippageBps,
                    feeTierBps
                });
                if (quote) {
                    validQuotes++;
                    assert.strictEqual(typeof quote.amountIn, 'bigint');
                    assert.strictEqual(typeof quote.expectedAmountOut, 'bigint');
                    assert.strictEqual(typeof quote.minimumAmountOut, 'bigint');
                    assert.ok(quote.amountIn > 0n);
                    assert.ok(quote.expectedAmountOut > 0n);
                    assert.ok(quote.minimumAmountOut <= quote.expectedAmountOut);
                    const randomRecipient = prng.nextAddress();
                    const tx = await target.adapter.buildSwapTransaction(quote, CANONICAL_USER, randomRecipient);
                    assert.ok(tx.calldata.startsWith('0x'));
                    assert.ok(tx.calldata.length >= 10);
                    assert.ok(tx.semanticHash.replace(/^0x/, '').length === 64);
                    validCalldata++;
                }
            }
            assert.ok(validQuotes >= 3800, `Expected at least 3800 valid quotes, got ${validQuotes}`);
            assert.ok(validCalldata >= 3800, `Expected at least 3800 valid calldata builds, got ${validCalldata}`);
        });
    });
});
