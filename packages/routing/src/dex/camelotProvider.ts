import { DEXProtocol, Token } from '@zenith/types';
import { Interface, Contract, JsonRpcProvider } from 'ethers';
import { defaultChainRegistry } from '@zenith/chains';
import { CAMELOT_V2_ROUTER, CAMELOT_V2_ROUTER_ABI, CAMELOT_V3_ROUTER_ABI, CANONICAL_NATIVE_ADDRESS, getCamelotRouter } from '@zenith/contracts';
import { DEXProvider, DEXQuote, DEXExecution, DEXQuoteParams } from './types';
import { calculateDEXLiquidityOutput, isNativeToken, resolvePoolTokenAddress } from './dexMath';

export class CamelotProvider implements DEXProvider {
    public readonly id: DEXProtocol = 'CAMELOT';
    public readonly protocol: DEXProtocol = 'CAMELOT';
    public readonly name = 'Camelot DEX';
    public readonly supportedChainIds: number[] = [42161];
    public isAvailable(chainId: number | string, _tokenIn: Token, _tokenOut: Token): boolean {
        const id = typeof chainId === 'number' ? chainId : (chainId === 'arbitrum' ? 42161 : Number(chainId));
        return this.supportedChainIds.includes(id);
    }
    public async getQuote(params: DEXQuoteParams): Promise<DEXQuote | null> {
        if (!this.supportedChainIds.includes(params.chainId)) {
            return null;
        }
        try {
            const routerAddress = getCamelotRouter(params.chainId);
            const tokenInAddr = resolvePoolTokenAddress(params.tokenIn, params.chainId);
            const tokenOutAddr = resolvePoolTokenAddress(params.tokenOut, params.chainId);
            const isNative = isNativeToken(params.tokenIn.address) || Boolean(params.tokenIn.isNative);

            // 1. Attempt Live On-Chain Quoting via RPC
            const rpcUrl = params.rpcUrl || defaultChainRegistry.getChain(params.chainId)?.rpcEndpoints?.[0]?.url;
            const provider = params.provider || (rpcUrl ? new JsonRpcProvider(rpcUrl, params.chainId, { staticNetwork: true }) : null);

            if (provider && params.amountIn > 0n && params.chainId === 42161) {
                try {
                    const camelotV2 = new Contract(CAMELOT_V2_ROUTER, CAMELOT_V2_ROUTER_ABI, provider);
                    const amounts = await camelotV2.getAmountsOut(params.amountIn, [tokenInAddr, tokenOutAddr]);
                    if (amounts && amounts.length >= 2 && amounts[1] > 0n) {
                        const amountOut = BigInt(amounts[1].toString());
                        const quoteTimestamp = Date.now();
                        let blockNumber: number | undefined = undefined;
                        try {
                            blockNumber = await provider.getBlockNumber();
                        } catch {
                            // ignore block number error
                        }

                        const safeSlippage = params.slippageToleranceBps !== undefined && !isNaN(params.slippageToleranceBps)
                            ? params.slippageToleranceBps
                            : 50;
                        const slippageMultiplier = 10000n - BigInt(Math.max(0, safeSlippage));
                        const minimumAmountOut = (amountOut * slippageMultiplier) / 10000n;
                        const feeTierBps = 30; // 0.3%
                        const feeAmount = (params.amountIn * BigInt(feeTierBps)) / 10000n;

                        return {
                            provider: this.protocol,
                            providerName: this.name,
                            chainId: params.chainId,
                            tokenIn: params.tokenIn,
                            tokenOut: params.tokenOut,
                            amountIn: params.amountIn,
                            amountOut,
                            minimumAmountOut: minimumAmountOut === 0n ? 1n : minimumAmountOut,
                            amountInRaw: params.amountIn.toString(),
                            amountOutRaw: amountOut.toString(),
                            minimumOutRaw: (minimumAmountOut === 0n ? 1n : minimumAmountOut).toString(),
                            feeAmount,
                            feeAmountRaw: feeAmount.toString(),
                            feeTierBps,
                            priceImpactPercent: 0.05,
                            executionTarget: routerAddress,
                            approvalTarget: isNative ? CANONICAL_NATIVE_ADDRESS : routerAddress,
                            gasEstimate: 180000n,
                            gasEstimateUnits: 180000n,
                            gasCostUSD: 0.03,
                            quoteTimestamp,
                            quoteBlockNumber: blockNumber,
                            expiration: quoteTimestamp + 15000,
                            routePath: [params.tokenIn.address, params.tokenOut.address],
                            liquiditySource: 'LIVE_RPC'
                        };
                    }
                } catch {
                    // Camelot live quote failed
                }
            }

            // 2. Fallback to Deterministic Simulation Fixtures for offline / unit tests
            const calculated = calculateDEXLiquidityOutput({
                chainId: params.chainId,
                tokenIn: params.tokenIn,
                tokenOut: params.tokenOut,
                amountIn: params.amountIn,
                slippageToleranceBps: params.slippageToleranceBps
            });
            if (!calculated) {
                return null;
            }
            const quoteTimestamp = Date.now();
            return {
                provider: this.protocol,
                providerName: this.name,
                chainId: params.chainId,
                tokenIn: params.tokenIn,
                tokenOut: params.tokenOut,
                amountIn: params.amountIn,
                amountOut: calculated.amountOut,
                minimumAmountOut: calculated.minimumAmountOut,
                amountInRaw: params.amountIn.toString(),
                amountOutRaw: calculated.amountOut.toString(),
                minimumOutRaw: calculated.minimumAmountOut.toString(),
                feeAmount: calculated.feeAmount,
                feeAmountRaw: calculated.feeAmount.toString(),
                feeTierBps: calculated.feeTierBps,
                priceImpactPercent: calculated.priceImpactPercent,
                executionTarget: routerAddress,
                approvalTarget: routerAddress,
                gasEstimate: 180000n,
                gasEstimateUnits: 180000n,
                gasCostUSD: 0.03,
                quoteTimestamp,
                expiration: quoteTimestamp + 15000,
                routePath: [params.tokenIn.address, params.tokenOut.address],
                liquiditySource: calculated.liquiditySource
            };
        }
        catch {
            return null;
        }
    }
    public async buildExecution(quote: DEXQuote, userAddress: string, recipientAddress?: string, deadline?: number): Promise<DEXExecution> {
        const chainIdNum = typeof quote.chainId === 'number' ? quote.chainId : Number(quote.chainId);
        const routerAddress = getCamelotRouter(chainIdNum);
        const iface = new Interface(CAMELOT_V3_ROUTER_ABI);
        const recipient = recipientAddress || userAddress;
        const swapDeadline = deadline || Math.floor(Date.now() / 1000) + 1200;
        const tokenInAddr = resolvePoolTokenAddress(quote.tokenIn, chainIdNum);
        const tokenOutAddr = resolvePoolTokenAddress(quote.tokenOut, chainIdNum);
        const calldata = iface.encodeFunctionData('exactInputSingle', [
            [
                tokenInAddr,
                tokenOutAddr,
                recipient,
                swapDeadline,
                quote.amountIn,
                quote.minimumAmountOut,
                0
            ]
        ]);
        const isNative = isNativeToken(quote.tokenIn.address) || Boolean(quote.tokenIn.isNative);
        return {
            to: routerAddress,
            data: calldata,
            value: isNative ? quote.amountIn.toString() : '0',
            chainId: chainIdNum,
            gasLimit: quote.gasEstimate.toString(),
            gasEstimateUnits: quote.gasEstimate,
            approvalTarget: isNative ? CANONICAL_NATIVE_ADDRESS : routerAddress,
            approvalAmount: quote.amountIn.toString(),
            requiredAllowanceRaw: quote.amountIn.toString()
        };
    }
}
