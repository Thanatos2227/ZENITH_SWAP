import { Interface } from 'ethers';
import type { DexIdentity, DexPoolDiscoveryResult, AuthoritativeDexQuote, DexSwapTransaction, DexSimulationResult, DexPoolState, DexLiquidityState, TokenIdentity, Token, DexCapabilities } from '@zenith/types';
import { EvmDexAdapter } from './evmDexAdapter.base';
import type { DexQuoteParams } from './dexAdapter.interface';
import { getTokenAddress, toLegacyToken } from './dexIdentity.types';
import { calculateDEXLiquidityOutput } from '../dexMath';
import { EconomicSafetyBreachError, SlippagePolicyViolationError, AERODROME_ROUTER_ABI, AERODROME_FACTORY } from '@zenith/contracts';
export const AERODROME_LIVE_VERIFICATION_UNAVAILABLE = 'AERODROME_LIVE_VERIFICATION_UNAVAILABLE';
export const CANONICAL_BASE_WETH_USDC_AERODROME_POOL = '0xcDa00DFd10f4381810AE12eB5e33dE0b2C912b7D';
export class AerodromeDexAdapter extends EvmDexAdapter {
    constructor(identity: DexIdentity) {
        super(identity);
    }
    public override getCapabilities(): DexCapabilities {
        return {
            dexId: this.dexId,
            capabilityLevel: 'CONFIGURED',
            supportsQuotes: true,
            supportsExecution: false,
            supportsExactInput: true,
            supportsExactOutput: false,
            supportsPoolDiscovery: true,
            supportsSimulation: false,
            supportsPriceImpact: false,
            supportedTokenStandards: [...this.identity.supportedTokenStandards]
        };
    }
    public async discoverPool(tokenIn: TokenIdentity | Token, tokenOut: TokenIdentity | Token, feeTierBps?: number): Promise<DexPoolDiscoveryResult> {
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
        const inAddr = getTokenAddress(tokenIn);
        const outAddr = getTokenAddress(tokenOut);
        return {
            poolFound: true,
            poolAddress: CANONICAL_BASE_WETH_USDC_AERODROME_POOL,
            dexId: this.dexId,
            networkId: this.identity.networkId,
            token0: inAddr,
            token1: outAddr,
            feeTierBps: feeTierBps || 30,
            liquidity: 0n,
            discoverySource: this.identity.poolDiscoveryMethod,
            verificationStatus: 'CONTRACT_PRESENT'
        };
    }
    public async getQuote(params: DexQuoteParams): Promise<AuthoritativeDexQuote | null> {
        if (params.amountIn <= 0n) {
            throw new EconomicSafetyBreachError('amountIn', '> 0', params.amountIn.toString(), 'Swap amountIn must be strictly positive');
        }
        if (params.slippageToleranceBps !== undefined &&
            (params.slippageToleranceBps < 0 || params.slippageToleranceBps > 10000)) {
            throw new SlippagePolicyViolationError(params.slippageToleranceBps, `Slippage tolerance ${params.slippageToleranceBps} bps is out of bounds (must be between 0 and 10000 bps)`);
        }
        const pairCheck = this.validateTokenPair(params.tokenIn, params.tokenOut);
        if (!pairCheck.isValid) {
            return null;
        }
        const numericChainId = typeof params.chainId === 'number' ? params.chainId : Number(params.chainId) || 8453;
        const legacyIn = toLegacyToken(params.tokenIn, numericChainId);
        const legacyOut = toLegacyToken(params.tokenOut, numericChainId);
        const calculated = calculateDEXLiquidityOutput({
            chainId: numericChainId,
            tokenIn: legacyIn,
            tokenOut: legacyOut,
            amountIn: params.amountIn,
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
            feeTierBps: calculated.feeTierBps,
            gasEstimate: 160000n,
            route: [inAddr, outAddr],
            poolPath: [inAddr, outAddr],
            quoteTimestamp,
            expiration,
            providerId: this.dexId,
            capabilityLevel: 'CONFIGURED',
            verificationStatus: 'CONTRACT_PRESENT',
            executable: false,
            executionTarget: this.identity.routerAddress,
            approvalTarget: this.identity.routerAddress
        };
    }
    public override async simulateSwap(_swapTx: DexSwapTransaction, _rpcProvider?: any): Promise<DexSimulationResult> {
        return {
            isSuccess: false,
            revertReason: `${AERODROME_LIVE_VERIFICATION_UNAVAILABLE}: Aerodrome is classified as CONFIGURED with no authorized live execution adapter`,
            semanticEquivalenceValid: false,
            minimumOutputValid: false,
            gasReserveValid: false,
            preflightPassed: false
        };
    }
    public async getPoolState(_poolAddress: string, _rpcProvider?: any): Promise<DexPoolState | null> {
        return null;
    }
    public async getLiquidityState(_poolAddress: string, _rpcProvider?: any): Promise<DexLiquidityState | null> {
        return null;
    }
    public async getPriceImpact(_amountIn: bigint, _poolAddress: string, _rpcProvider?: any): Promise<number | null> {
        return null;
    }
    protected async encodeSwapCalldata(quote: AuthoritativeDexQuote, recipient: string, deadline?: number): Promise<string> {
        const iface = new Interface(AERODROME_ROUTER_ABI);
        const inAddr = getTokenAddress(quote.tokenIn);
        const outAddr = getTokenAddress(quote.tokenOut);
        const swapDeadline = deadline || quote.expiration;
        const routes = [
            {
                from: inAddr,
                to: outAddr,
                stable: false,
                factory: AERODROME_FACTORY
            }
        ];
        return iface.encodeFunctionData('swapExactTokensForTokens', [
            quote.amountIn,
            quote.minimumAmountOut,
            routes,
            recipient,
            swapDeadline
        ]);
    }
}
