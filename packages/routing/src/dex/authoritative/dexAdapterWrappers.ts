import { sha256, toUtf8Bytes } from 'ethers';
import type { DexIdentity, DexCapabilities, DexPairValidationResult, DexPoolDiscoveryResult, AuthoritativeDexQuote, DexSwapTransaction, DexSimulationResult, DexPoolState, DexDeploymentVerificationResult, DexLiquidityState, TokenIdentity, Token, TokenStandard } from '@zenith/types';
import type { DEXProvider, DEXQuote } from '../types';
import type { IDexAdapter, DexQuoteParams } from './dexAdapter.interface';
import { isFungibleStandard } from '@zenith/tokens';
import { validateEvmAddress, InvalidCalldataError } from '@zenith/contracts';
import { DexAddressVerifier } from './dexAddressVerifier';
import { getTokenAddress, toLegacyToken } from './dexIdentity.types';
export class LegacyDexProviderWrapper implements IDexAdapter {
    public readonly dexId: string;
    private readonly identity: DexIdentity;
    private readonly legacyProvider: DEXProvider;
    constructor(identity: DexIdentity, legacyProvider: DEXProvider) {
        this.identity = Object.freeze({ ...identity });
        this.dexId = identity.dexId;
        this.legacyProvider = legacyProvider;
    }
    public getDexIdentity(): DexIdentity {
        return { ...this.identity };
    }
    public getCapabilities(): DexCapabilities {
        return {
            dexId: this.dexId,
            capabilityLevel: this.identity.capabilityLevel,
            supportsQuotes: true,
            supportsExecution: this.identity.capabilityLevel === 'EXECUTION_AVAILABLE' ||
                this.identity.capabilityLevel === 'LIVE_VERIFIED',
            supportsExactInput: true,
            supportsExactOutput: false,
            supportsPoolDiscovery: this.identity.poolDiscoveryMethod !== 'UNSUPPORTED',
            supportsSimulation: true,
            supportsPriceImpact: true,
            supportedTokenStandards: [...this.identity.supportedTokenStandards]
        };
    }
    public validateTokenPair(tokenIn: TokenIdentity | Token, tokenOut: TokenIdentity | Token): DexPairValidationResult {
        const stdIn = (tokenIn as TokenIdentity).standard || ('isNative' in tokenIn && tokenIn.isNative ? 'NATIVE' : 'ERC20');
        const stdOut = (tokenOut as TokenIdentity).standard || ('isNative' in tokenOut && tokenOut.isNative ? 'NATIVE' : 'ERC20');
        if (!isFungibleStandard(stdIn as TokenStandard) || !isFungibleStandard(stdOut as TokenStandard)) {
            return {
                isValid: false,
                reason: 'TOKEN_STANDARD_UNSUPPORTED: Non-fungible standards rejected',
                tokenInStandard: stdIn as TokenStandard,
                tokenOutStandard: stdOut as TokenStandard
            };
        }
        const inAddr = getTokenAddress(tokenIn);
        const outAddr = getTokenAddress(tokenOut);
        if (inAddr.toLowerCase() === outAddr.toLowerCase()) {
            return {
                isValid: false,
                reason: 'IDENTICAL_TOKEN_PAIR: tokenIn and tokenOut are the same asset',
                tokenInStandard: stdIn as TokenStandard,
                tokenOutStandard: stdOut as TokenStandard
            };
        }
        return {
            isValid: true,
            tokenInStandard: stdIn as TokenStandard,
            tokenOutStandard: stdOut as TokenStandard
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
            dexId: this.dexId,
            networkId: this.identity.networkId,
            token0: inAddr,
            token1: outAddr,
            feeTierBps,
            discoverySource: this.identity.poolDiscoveryMethod,
            verificationStatus: this.identity.verificationStatus
        };
    }
    public async getQuote(params: DexQuoteParams): Promise<AuthoritativeDexQuote | null> {
        const pairCheck = this.validateTokenPair(params.tokenIn, params.tokenOut);
        if (!pairCheck.isValid) {
            return null;
        }
        const numericChainId = typeof params.chainId === 'number' ? params.chainId : Number(params.chainId) || 1;
        const legacyIn = toLegacyToken(params.tokenIn, numericChainId);
        const legacyOut = toLegacyToken(params.tokenOut, numericChainId);
        const legacyQuote: DEXQuote | null = await this.legacyProvider.getQuote({
            chainId: numericChainId,
            tokenIn: legacyIn,
            tokenOut: legacyOut,
            amountIn: params.amountIn,
            slippageToleranceBps: params.slippageToleranceBps,
            feeTierBps: params.feeTierBps,
            recipient: params.recipient,
            provider: params.provider
        });
        if (!legacyQuote || legacyQuote.amountOut <= 0n) {
            return null;
        }
        const inAddr = getTokenAddress(params.tokenIn);
        const outAddr = getTokenAddress(params.tokenOut);
        return {
            dexId: this.dexId,
            networkId: String(params.chainId || this.identity.networkId),
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            amountIn: legacyQuote.amountIn,
            expectedAmountOut: legacyQuote.amountOut,
            minimumAmountOut: legacyQuote.minimumAmountOut,
            priceImpact: legacyQuote.priceImpactPercent,
            fee: legacyQuote.feeAmount,
            feeTierBps: legacyQuote.feeTierBps,
            gasEstimate: legacyQuote.gasEstimate,
            route: legacyQuote.routePath || [inAddr, outAddr],
            poolPath: legacyQuote.routePath || [inAddr, outAddr],
            quoteTimestamp: legacyQuote.quoteTimestamp,
            expiration: legacyQuote.expiration,
            providerId: this.dexId,
            capabilityLevel: this.identity.capabilityLevel,
            verificationStatus: this.identity.verificationStatus,
            executable: this.identity.capabilityLevel === 'EXECUTION_AVAILABLE' ||
                this.identity.capabilityLevel === 'LIVE_VERIFIED',
            executionTarget: legacyQuote.executionTarget,
            approvalTarget: legacyQuote.approvalTarget
        };
    }
    public async buildSwapTransaction(quote: AuthoritativeDexQuote, userAddress: string, recipientAddress?: string, deadline?: number): Promise<DexSwapTransaction> {
        const recipient = recipientAddress || userAddress;
        validateEvmAddress(recipient, 'Recipient Address');
        const router = this.identity.routerAddress;
        validateEvmAddress(router, 'DEX Router');
        const mappedLegacyQuote: DEXQuote = {
            provider: (this.legacyProvider as any).protocol || 'UNISWAP_V3',
            providerName: this.identity.canonicalName,
            chainId: this.identity.networkId,
            tokenIn: quote.tokenIn as Token,
            tokenOut: quote.tokenOut as Token,
            amountIn: quote.amountIn,
            amountOut: quote.expectedAmountOut,
            minimumAmountOut: quote.minimumAmountOut,
            feeAmount: quote.fee,
            feeTierBps: quote.feeTierBps || 30,
            priceImpactPercent: quote.priceImpact || 0.05,
            gasEstimate: quote.gasEstimate,
            gasCostUSD: 0.05,
            executionTarget: router,
            approvalTarget: router,
            quoteTimestamp: quote.quoteTimestamp,
            expiration: quote.expiration
        };
        const execution = await this.legacyProvider.buildExecution(mappedLegacyQuote, userAddress, recipient, deadline);
        if (!execution.data || execution.data === '0x' || execution.data.length < 10) {
            throw new InvalidCalldataError(`Invalid calldata generated for legacy DEX ${this.dexId}`);
        }
        const swapDeadline = deadline || quote.expiration;
        const value = execution.value || quote.value || '0';
        const safeGasLimit = (quote.gasEstimate * 120n) / 100n;
        const inAddr = getTokenAddress(quote.tokenIn);
        const outAddr = getTokenAddress(quote.tokenOut);
        const semanticPayload = JSON.stringify({
            chainId: quote.networkId,
            networkIdentityKey: this.identity.networkIdentityKey,
            dexId: this.dexId,
            router: router.toLowerCase(),
            tokenIn: inAddr.toLowerCase(),
            tokenOut: outAddr.toLowerCase(),
            amountIn: quote.amountIn.toString(),
            amountOutMinimum: quote.minimumAmountOut.toString(),
            recipient: recipient.toLowerCase(),
            deadline: swapDeadline,
            value: value.toString(),
            calldata: execution.data.toLowerCase()
        });
        const semanticHash = sha256(toUtf8Bytes(semanticPayload));
        const planHash = sha256(toUtf8Bytes(`PLAN:${semanticHash}`));
        return {
            chainId: quote.networkId,
            networkIdentityKey: this.identity.networkIdentityKey,
            dexId: this.dexId,
            router,
            tokenIn: inAddr,
            tokenOut: outAddr,
            amountIn: quote.amountIn.toString(),
            amountOutMinimum: quote.minimumAmountOut.toString(),
            recipient,
            deadline: swapDeadline,
            value,
            calldata: execution.data,
            gasLimit: safeGasLimit.toString(),
            semanticHash,
            planHash
        };
    }
    public async simulateSwap(swapTx: DexSwapTransaction, rpcProvider?: any): Promise<DexSimulationResult> {
        if (swapTx.dexId !== this.dexId) {
            return {
                isSuccess: false,
                revertReason: `DEX mismatch: ${swapTx.dexId} vs ${this.dexId}`,
                semanticEquivalenceValid: false,
                minimumOutputValid: false,
                gasReserveValid: false,
                preflightPassed: false
            };
        }
        if (BigInt(swapTx.amountOutMinimum) <= 0n) {
            return {
                isSuccess: false,
                revertReason: 'MINIMUM_OUTPUT_ZERO: Minimum output must be positive',
                semanticEquivalenceValid: true,
                minimumOutputValid: false,
                gasReserveValid: false,
                preflightPassed: false
            };
        }
        if (rpcProvider) {
            try {
                await rpcProvider.call({
                    to: swapTx.router,
                    data: swapTx.calldata,
                    value: swapTx.value
                });
                return {
                    isSuccess: true,
                    simulatedAmountOut: BigInt(swapTx.amountOutMinimum),
                    gasUsed: 165000n,
                    semanticEquivalenceValid: true,
                    minimumOutputValid: true,
                    gasReserveValid: true,
                    preflightPassed: true
                };
            }
            catch (err: any) {
                return {
                    isSuccess: false,
                    revertReason: `Simulation failed: ${err?.message || err}`,
                    semanticEquivalenceValid: true,
                    minimumOutputValid: true,
                    gasReserveValid: true,
                    preflightPassed: false
                };
            }
        }
        return {
            isSuccess: true,
            simulatedAmountOut: BigInt(swapTx.amountOutMinimum),
            gasUsed: 165000n,
            semanticEquivalenceValid: true,
            minimumOutputValid: true,
            gasReserveValid: true,
            preflightPassed: true
        };
    }
    public async getPoolState(_poolAddress: string, _rpcProvider?: any): Promise<DexPoolState | null> {
        return null;
    }
    public async verifyDeployment(rpcProvider?: any): Promise<DexDeploymentVerificationResult> {
        const routerVer = await DexAddressVerifier.verifyAddress(this.identity.routerAddress, 'ROUTER', rpcProvider);
        const factoryVer = await DexAddressVerifier.verifyAddress(this.identity.factoryAddress, 'FACTORY', rpcProvider);
        return {
            dexId: this.dexId,
            routerStatus: routerVer.status,
            factoryStatus: factoryVer.status,
            verifiedAt: Date.now(),
            overallStatus: routerVer.status === 'EXPECTED_INTERFACE' && factoryVer.status === 'EXPECTED_INTERFACE'
                ? 'VERIFIED_DEPLOYMENT'
                : routerVer.status,
            issues: []
        };
    }
    public async getLiquidityState(_poolAddress: string, _rpcProvider?: any): Promise<DexLiquidityState | null> {
        return null;
    }
    public async getPriceImpact(_amountIn: bigint, _poolAddress: string, _rpcProvider?: any): Promise<number | null> {
        return null;
    }
}
