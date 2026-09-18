import { DEXProtocol, Token } from '@zenith/types';
import { Interface, Provider } from 'ethers';
import {
  ZENITH_V2_ROUTER_ABI,
  CANONICAL_NATIVE_ADDRESS,
  getZenithV2Router,
  ZenithRouterNotDeployedError
} from '@zenith/contracts';
import { DEXProvider, DEXQuote, DEXExecution, DEXQuoteParams } from './types';
import { calculateDEXLiquidityOutput, isNativeToken, resolvePoolTokenAddress } from './dexMath';
import { PoolStateReader, ZenithV2LivePoolState } from './poolStateReader';

export class ZenithV2Provider implements DEXProvider {
  public readonly id: DEXProtocol = 'ZENITH_V2';
  public readonly protocol: DEXProtocol = 'ZENITH_V2';
  public readonly name = 'ZENITH V2 AMM';
  public readonly supportedChainIds: number[] = [1, 10, 56, 137, 8453, 42161, 43114, 31337];

  public isAvailable(chainId: number | string, _tokenIn: Token, _tokenOut: Token): boolean {
    const id = typeof chainId === 'number' ? chainId : (chainId === 'polygon' ? 137 : Number(chainId));
    return Boolean(getZenithV2Router(id) && this.supportedChainIds.includes(id));
  }

  public async getQuote(params: DEXQuoteParams): Promise<DEXQuote | null> {
    if (!this.supportedChainIds.includes(params.chainId) || params.amountIn <= 0n) return null;

    const routerAddress = getZenithV2Router(params.chainId);
    const provider = params.provider as Provider | undefined;
    if (!routerAddress || !provider) return null;

    const inAddr = resolvePoolTokenAddress(params.tokenIn, params.chainId);
    const outAddr = resolvePoolTokenAddress(params.tokenOut, params.chainId);
    const requestedFeeBps = (params as any).feeTierBps;
    const effectiveFeeBps = requestedFeeBps !== undefined ? Number(requestedFeeBps) : 30;
    if (!Number.isInteger(effectiveFeeBps) || effectiveFeeBps < 0 || effectiveFeeBps >= 10000) return null;

    let liveState: ZenithV2LivePoolState | null;
    try {
      liveState = await PoolStateReader.getLiveV2PoolStateForPair(params.chainId, inAddr, outAddr, effectiveFeeBps, provider);
    } catch {
      return null;
    }
    if (!liveState || liveState.reserve0 <= 0n || liveState.reserve1 <= 0n) return null;

    const zeroForOne = inAddr.toLowerCase() === liveState.token0.toLowerCase();
    const reserveIn = zeroForOne ? liveState.reserve0 : liveState.reserve1;
    const reserveOut = zeroForOne ? liveState.reserve1 : liveState.reserve0;
    const calculated = calculateDEXLiquidityOutput({
      chainId: params.chainId,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      reserveIn,
      reserveOut,
      feeTierBps: effectiveFeeBps,
      slippageToleranceBps: params.slippageToleranceBps
    });
    if (!calculated || calculated.amountOut <= 0n || calculated.minimumAmountOut <= 0n) return null;

    const quoteTimestamp = Date.now();
    const quote: DEXQuote = {
      provider: 'ZENITH_V2',
      providerName: this.name,
      chainId: params.chainId,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      amountOut: calculated.amountOut,
      minimumAmountOut: calculated.minimumAmountOut,
      feeAmount: calculated.feeAmount,
      feeTierBps: calculated.feeTierBps,
      priceImpactPercent: calculated.priceImpactPercent,
      executionTarget: routerAddress,
      approvalTarget: routerAddress,
      poolAddress: liveState.poolAddress,
      quoteBlockNumber: liveState.blockNumber,
      gasEstimate: 0n,
      gasCostUSD: 0,
      quoteTimestamp,
      expiration: quoteTimestamp + 15000,
      routePath: [params.tokenIn.address, params.tokenOut.address]
    };

    if (params.recipient) {
      try {
        const iface = new Interface(ZENITH_V2_ROUTER_ABI);
        const recipient = params.recipient;
        const deadline = Math.floor(Date.now() / 1000) + 1200;
        const isNativeIn = isNativeToken(params.tokenIn.address) || Boolean(params.tokenIn.isNative);
        const isNativeOut = isNativeToken(params.tokenOut.address) || Boolean(params.tokenOut.isNative);
        let data: string;
        let value = 0n;
        if (isNativeIn) {
          data = iface.encodeFunctionData('swapExactETHForTokens', [quote.minimumAmountOut, [inAddr, outAddr], [effectiveFeeBps], recipient, deadline]);
          value = params.amountIn;
        } else if (isNativeOut) {
          data = iface.encodeFunctionData('swapExactTokensForETH', [params.amountIn, quote.minimumAmountOut, [inAddr, outAddr], [effectiveFeeBps], recipient, deadline]);
        } else {
          data = iface.encodeFunctionData('swapExactTokensForTokens', [params.amountIn, quote.minimumAmountOut, [inAddr, outAddr], [effectiveFeeBps], recipient, deadline]);
        }
        const gas = await provider.estimateGas({ to: routerAddress, data, value });
        quote.gasEstimate = BigInt(gas.toString());
        quote.gasEstimateUnits = quote.gasEstimate;
      } catch {
        // Fail closed: do not invent a gas estimate.
      }
    }

    return quote;
  }

  public async buildExecution(quote: DEXQuote, userAddress: string, recipientAddress?: string, deadline?: number): Promise<DEXExecution> {
    const chainIdNum = typeof quote.chainId === 'number' ? quote.chainId : Number(quote.chainId);
    const routerAddress = getZenithV2Router(chainIdNum);
    if (!routerAddress) throw new ZenithRouterNotDeployedError('ZENITH_V2', chainIdNum);
    if (!quote.poolAddress) throw new Error('ZENITH_V2: quote is missing live pool address');
    if (Date.now() > quote.expiration) throw new Error('ZENITH_V2: quote expired; request a fresh quote');
    if (quote.minimumAmountOut <= 0n) throw new Error('ZENITH_V2: invalid minimum output');
    const gasEstimate = quote.gasEstimate || 0n;

    const iface = new Interface(ZENITH_V2_ROUTER_ABI);
    const recipient = recipientAddress || userAddress;
    const swapDeadline = deadline || Math.floor(Date.now() / 1000) + 1200;
    const tokenInAddr = resolvePoolTokenAddress(quote.tokenIn, chainIdNum);
    const tokenOutAddr = resolvePoolTokenAddress(quote.tokenOut, chainIdNum);
    const isNativeIn = isNativeToken(quote.tokenIn.address) || Boolean(quote.tokenIn.isNative);
    const isNativeOut = isNativeToken(quote.tokenOut.address) || Boolean(quote.tokenOut.isNative);
    const fee = quote.feeTierBps || 30;

    let calldata: string;
    let value = '0';
    let approvalTarget = routerAddress;
    if (isNativeIn) {
      calldata = iface.encodeFunctionData('swapExactETHForTokens', [quote.minimumAmountOut, [tokenInAddr, tokenOutAddr], [fee], recipient, swapDeadline]);
      value = quote.amountIn.toString();
      approvalTarget = CANONICAL_NATIVE_ADDRESS;
    } else if (isNativeOut) {
      calldata = iface.encodeFunctionData('swapExactTokensForETH', [quote.amountIn, quote.minimumAmountOut, [tokenInAddr, tokenOutAddr], [fee], recipient, swapDeadline]);
    } else {
      calldata = iface.encodeFunctionData('swapExactTokensForTokens', [quote.amountIn, quote.minimumAmountOut, [tokenInAddr, tokenOutAddr], [fee], recipient, swapDeadline]);
    }

    return {
      to: routerAddress,
      data: calldata,
      value,
      chainId: chainIdNum,
      gasLimit: gasEstimate.toString(),
      gasEstimateUnits: gasEstimate,
      approvalTarget,
      approvalAmount: isNativeIn ? '0' : quote.amountIn.toString(),
      requiredAllowanceRaw: isNativeIn ? '0' : quote.amountIn.toString()
    };
  }
}

export const zenithV2Provider = new ZenithV2Provider();
