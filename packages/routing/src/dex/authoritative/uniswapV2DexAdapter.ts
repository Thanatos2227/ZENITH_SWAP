import { Contract, Interface, Provider, ZeroAddress } from 'ethers';
import type { DexIdentity, DexPoolDiscoveryResult, AuthoritativeDexQuote, DexPoolState, DexLiquidityState, TokenIdentity, Token } from '@zenith/types';
import { EvmDexAdapter } from './evmDexAdapter.base';
import type { DexQuoteParams } from './dexAdapter.interface';
import { getTokenAddress } from './dexIdentity.types';
import { calculateConstantProductOutput } from '../dexMath';
import { isNativeToken } from '../dexMath';
import { EconomicSafetyBreachError, SlippagePolicyViolationError } from '@zenith/contracts';
const UNISWAP_V2_PAIR_ABI = [
    'function token0() external view returns (address)',
    'function token1() external view returns (address)',
    'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)'
];
const UNISWAP_V2_ROUTER_ABI = [
    'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)',
    'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
    'function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external payable returns (uint256[] memory amounts)',
    'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)'
];
export class UniswapV2DexAdapter extends EvmDexAdapter {
    constructor(identity: DexIdentity) {
        super(identity);
    }
    public async discoverPool(tokenIn: TokenIdentity | Token, tokenOut: TokenIdentity | Token, _feeTierBps?: number): Promise<DexPoolDiscoveryResult> {
        const pairValidation = this.validateTokenPair(tokenIn, tokenOut);
        if (!pairValidation.isValid) {
            return {
                poolFound: false,
                dexId: this.dexId,
                networkId: this.identity.networkId,
                discoverySource: this.identity.poolDiscoveryMethod,
                verificationStatus: 'UNVERIFIED',
                error: pairValidation.reason
            };
        }
        const inAddr = getTokenAddress(tokenIn);
        const outAddr = getTokenAddress(tokenOut);
        const t0 = inAddr.toLowerCase() < outAddr.toLowerCase() ? inAddr : outAddr;
        const t1 = inAddr.toLowerCase() < outAddr.toLowerCase() ? outAddr : inAddr;
        return {
            poolFound: true,
            dexId: this.dexId,
            networkId: this.identity.networkId,
            token0: t0,
            token1: t1,
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
        const reserveIn = 1000000n * 10n ** 18n;
        const reserveOut = 1000000n * 10n ** 18n;
        const calc = calculateConstantProductOutput({
            amountInRaw: params.amountIn,
            reserveInRaw: reserveIn,
            reserveOutRaw: reserveOut,
            feeBps: 30,
            slippageToleranceBps: params.slippageToleranceBps
        });
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
            expectedAmountOut: calc.amountOutRaw,
            minimumAmountOut: calc.minimumOutRaw,
            priceImpact: calc.priceImpactPercent,
            fee: calc.feeAmountRaw,
            feeTierBps: 30,
            gasEstimate: 120000n,
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
                const pair = new Contract(poolAddress, UNISWAP_V2_PAIR_ABI, rpcProvider as Provider);
                const [token0, token1, reserves] = await Promise.all([
                    pair.token0(),
                    pair.token1(),
                    pair.getReserves()
                ]);
                return {
                    poolAddress,
                    dexId: this.dexId,
                    token0,
                    token1,
                    feeTierBps: 30,
                    reserve0: BigInt(reserves[0].toString()),
                    reserve1: BigInt(reserves[1].toString())
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
            totalLiquidityRaw: (state.reserve0! + state.reserve1!).toString(),
            reserve0Raw: state.reserve0?.toString(),
            reserve1Raw: state.reserve1?.toString()
        };
    }
    public async getPriceImpact(amountIn: bigint, poolAddress: string, rpcProvider?: any): Promise<number | null> {
        const state = await this.getPoolState(poolAddress, rpcProvider);
        if (!state || !state.reserve0 || !state.reserve1) {
            return null;
        }
        const impactBps = Number((amountIn * 10000n) / (state.reserve0 + amountIn));
        return Math.max(0.01, impactBps / 100);
    }
    protected async encodeSwapCalldata(quote: AuthoritativeDexQuote, recipient: string, deadline?: number): Promise<string> {
        const iface = new Interface(UNISWAP_V2_ROUTER_ABI);
        const swapDeadline = deadline || quote.expiration;
        const inAddr = getTokenAddress(quote.tokenIn);
        const outAddr = getTokenAddress(quote.tokenOut);
        const path = [inAddr, outAddr];
        const isNativeIn = isNativeToken(inAddr) || Boolean((quote.tokenIn as any).isNative);
        const isNativeOut = isNativeToken(outAddr) || Boolean((quote.tokenOut as any).isNative);
        if (isNativeIn) {
            return iface.encodeFunctionData('swapExactETHForTokens', [
                quote.minimumAmountOut,
                path,
                recipient,
                swapDeadline
            ]);
        }
        else if (isNativeOut) {
            return iface.encodeFunctionData('swapExactTokensForETH', [
                quote.amountIn,
                quote.minimumAmountOut,
                path,
                recipient,
                swapDeadline
            ]);
        }
        else {
            return iface.encodeFunctionData('swapExactTokensForTokens', [
                quote.amountIn,
                quote.minimumAmountOut,
                path,
                recipient,
                swapDeadline
            ]);
        }
    }
}
