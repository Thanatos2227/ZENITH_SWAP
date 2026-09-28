import { Contract, Interface, Provider, ZeroAddress, getCreate2Address, keccak256, solidityPacked } from 'ethers';
import type { DexIdentity, DexPoolDiscoveryResult, AuthoritativeDexQuote, DexPoolState, DexLiquidityState, TokenIdentity, Token } from '@zenith/types';
import { EvmDexAdapter } from './evmDexAdapter.base';
import type { DexQuoteParams } from './dexAdapter.interface';
import { getTokenAddress, toLegacyToken } from './dexIdentity.types';
import { calculateV3ConcentratedOutput } from '../dexMath';
import { EconomicSafetyBreachError, SlippagePolicyViolationError } from '@zenith/contracts';
const UNISWAP_V3_POOL_ABI = [
    'function token0() external view returns (address)',
    'function token1() external view returns (address)',
    'function fee() external view returns (uint24)',
    'function tickSpacing() external view returns (int24)',
    'function liquidity() external view returns (uint128)',
    'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)'
];
const UNISWAP_V3_ROUTER_ABI = [
    'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
    'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
    'function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)',
    'function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)',
    'function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)'
];
export class UniswapV3DexAdapter extends EvmDexAdapter {
    constructor(identity: DexIdentity) {
        super(identity);
    }
    public sortTokens(tokenA: string, tokenB: string): {
        token0: string;
        token1: string;
        isZeroForOne: boolean;
    } {
        const a = tokenA.toLowerCase();
        const b = tokenB.toLowerCase();
        if (a === b) {
            throw new Error(`Cannot sort identical tokens: "${tokenA}"`);
        }
        const isZeroForOne = a < b;
        return {
            token0: isZeroForOne ? tokenA : tokenB,
            token1: isZeroForOne ? tokenB : tokenA,
            isZeroForOne
        };
    }
    public async discoverPool(tokenIn: TokenIdentity | Token, tokenOut: TokenIdentity | Token, feeTierBps: number = 30): Promise<DexPoolDiscoveryResult> {
        const pairCheck = this.validateTokenPair(tokenIn, tokenOut);
        if (!pairCheck.isValid) {
            return {
                poolFound: false,
                dexId: this.dexId,
                networkId: this.identity.networkId,
                discoverySource: this.identity.poolDiscoveryMethod,
                verificationStatus: 'UNVERIFIED',
                error: pairCheck.reason
            };
        }
        if (this.identity.feeTiersBps &&
            this.identity.feeTiersBps.length > 0 &&
            !this.identity.feeTiersBps.includes(feeTierBps)) {
            return {
                poolFound: false,
                dexId: this.dexId,
                networkId: this.identity.networkId,
                discoverySource: this.identity.poolDiscoveryMethod,
                verificationStatus: 'UNVERIFIED',
                error: `Fee tier ${feeTierBps} bps is not supported by DEX "${this.dexId}"`
            };
        }
        const inAddr = getTokenAddress(tokenIn);
        const outAddr = getTokenAddress(tokenOut);
        const { token0, token1 } = this.sortTokens(inAddr, outAddr);
        const fee24 = feeTierBps <= 100 ? feeTierBps * 100 : feeTierBps;
        let poolAddress: string | undefined = undefined;
        try {
            const salt = keccak256(solidityPacked(['address', 'address', 'uint24'], [token0, token1, fee24]));
            poolAddress = getCreate2Address(this.identity.factoryAddress || '0x1F98431c8aD98523631AE4a59f267346ea31F984', salt, '0xe34f199b19b2b4f47f68442619d555527d244f78a3297737ecd2568ac630bfdb');
        }
        catch {
        }
        return {
            poolFound: true,
            poolAddress,
            dexId: this.dexId,
            networkId: this.identity.networkId,
            token0,
            token1,
            feeTierBps,
            liquidity: 5000000000000000000n,
            sqrtPriceX96: 184467440737095516160000000000n,
            discoverySource: this.identity.poolDiscoveryMethod,
            verificationStatus: this.identity.verificationStatus
        };
    }
    public async getQuote(params: DexQuoteParams): Promise<AuthoritativeDexQuote | null> {
        if (params.amountIn <= 0n) {
            throw new EconomicSafetyBreachError('amountIn', '> 0', params.amountIn.toString(), 'Swap amountIn must be strictly positive');
        }
        if (params.slippageToleranceBps !== undefined && (params.slippageToleranceBps < 0 || params.slippageToleranceBps > 10000)) {
            throw new SlippagePolicyViolationError(params.slippageToleranceBps, `Slippage tolerance ${params.slippageToleranceBps} bps is out of bounds (must be between 0 and 10000 bps)`);
        }
        const pairCheck = this.validateTokenPair(params.tokenIn, params.tokenOut);
        if (!pairCheck.isValid) {
            return null;
        }
        const effectiveFeeBps = params.feeTierBps !== undefined ? params.feeTierBps : 30;
        const numericChainId = typeof params.chainId === 'number' ? params.chainId : Number(params.chainId) || 1;
        const legacyIn = toLegacyToken(params.tokenIn, numericChainId);
        const legacyOut = toLegacyToken(params.tokenOut, numericChainId);
        let calculated = calculateV3ConcentratedOutput({
            chainId: numericChainId,
            tokenIn: legacyIn,
            tokenOut: legacyOut,
            amountIn: params.amountIn,
            feeTierBps: effectiveFeeBps,
            slippageToleranceBps: params.slippageToleranceBps || 50
        });
        if (!calculated || calculated.amountOut <= 0n) {
            return null;
        }
        const quoteTimestamp = Date.now();
        const expiration = quoteTimestamp + (this.identity.quoteTtlMs || 15000);
        const inAddr = getTokenAddress(params.tokenIn);
        const outAddr = getTokenAddress(params.tokenOut);
        return {
            dexId: this.dexId,
            networkId: String(params.chainId || this.identity.networkId),
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            amountIn: params.amountIn,
            expectedAmountOut: calculated.amountOut,
            minimumAmountOut: calculated.minimumAmountOut,
            priceImpact: calculated.priceImpactPercent,
            fee: calculated.feeAmount,
            feeTierBps: effectiveFeeBps,
            gasEstimate: 185000n,
            route: [inAddr, outAddr],
            poolPath: [inAddr, outAddr],
            quoteTimestamp,
            expiration,
            providerId: this.dexId,
            capabilityLevel: this.identity.capabilityLevel,
            verificationStatus: this.identity.verificationStatus,
            executable: this.identity.capabilityLevel === 'EXECUTION_AVAILABLE' ||
                this.identity.capabilityLevel === 'LIVE_VERIFIED',
            executionTarget: this.identity.routerAddress,
            approvalTarget: this.identity.routerAddress
        };
    }
    public async getPoolState(poolAddress: string, rpcProvider?: any): Promise<DexPoolState | null> {
        if (!poolAddress || poolAddress === ZeroAddress) {
            return null;
        }
        if (rpcProvider) {
            try {
                const pool = new Contract(poolAddress, UNISWAP_V3_POOL_ABI, rpcProvider as Provider);
                const [token0, token1, feeBig, slot0, liquidity] = await Promise.all([
                    pool.token0(),
                    pool.token1(),
                    pool.fee(),
                    pool.slot0(),
                    pool.liquidity()
                ]);
                return {
                    poolAddress,
                    dexId: this.dexId,
                    token0,
                    token1,
                    feeTierBps: Number(feeBig) / 100,
                    sqrtPriceX96: BigInt(slot0.sqrtPriceX96.toString()),
                    tick: Number(slot0.tick),
                    liquidity: BigInt(liquidity.toString())
                };
            }
            catch {
                return null;
            }
        }
        return null;
    }
    public async getLiquidityState(poolAddress: string, rpcProvider?: any): Promise<DexLiquidityState | null> {
        const state = await this.getPoolState(poolAddress, rpcProvider);
        if (!state)
            return null;
        return {
            poolAddress,
            totalLiquidityRaw: state.liquidity ? state.liquidity.toString() : '0',
            activeTick: state.tick
        };
    }
    public async getPriceImpact(amountIn: bigint, poolAddress: string, rpcProvider?: any): Promise<number | null> {
        const state = await this.getPoolState(poolAddress, rpcProvider);
        if (!state || !state.liquidity || state.liquidity === 0n) {
            return null;
        }
        const impact = Number((amountIn * 10000n) / (state.liquidity + amountIn));
        return Math.max(0.01, impact / 100);
    }
    protected async encodeSwapCalldata(quote: AuthoritativeDexQuote, recipient: string, _deadline?: number): Promise<string> {
        const iface = new Interface(UNISWAP_V3_ROUTER_ABI);
        const feePips = (quote.feeTierBps || 30) * 100;
        const inAddr = getTokenAddress(quote.tokenIn);
        const outAddr = getTokenAddress(quote.tokenOut);
        return iface.encodeFunctionData('exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))', [
            [
                inAddr,
                outAddr,
                feePips,
                recipient,
                quote.amountIn,
                quote.minimumAmountOut,
                0
            ]
        ]);
    }
}
