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
    const routerAddress = getZenithV2Router(id);
    return Boolean(routerAddress && this.supportedChainIds.includes(id));
  }

  public async getQuote(params: DEXQuoteParams): Promise<DEXQuote | null> {
    if (!this.supportedChainIds.includes(params.chainId)) {
      return null;
    }

    const routerAddress = getZenithV2Router(params.chainId);
    if (!routerAddress) {
      return null;
    }

    const inAddr = resolvePoolTokenAddress(params.tokenIn, params.chainId);
    const outAddr = resolvePoolTokenAddress(params.tokenOut, params.chainId);
    const effectiveFeeBps = (params as any).feeTierBps !== undefined ? (params as any).feeTierBps : 30;

    let reserveIn: bigint | undefined = (params as any).reserveIn || (params as any).customReserveIn;
    let reserveOut: bigint | undefined = (params as any).reserveOut || (params as any).customReserveOut;
    let poolAddress: string | undefined = (params as any).poolAddress;
    let quoteBlockNumber: number | undefined = (params as any).quoteBlockNumber;

    if ((!reserveIn || !reserveOut) && (params as any).provider) {
      const liveState: ZenithV2LivePoolState | null = await PoolStateReader.getLiveV2PoolStateForPair(
        params.chainId,
        inAddr,
        outAddr,
        effectiveFeeBps,
        (params as any).provider as Provider
      );

      if (liveState && liveState.reserve0 > 0n && liveState.reserve1 > 0n) {
        poolAddress = liveState.poolAddress;
        quoteBlockNumber = liveState.blockNumber;
        const zeroForOne = inAddr.toLowerCase() === liveState.token0.toLowerCase();
        reserveIn = zeroForOne ? liveState.reserve0 : liveState.reserve1;
        reserveOut = zeroForOne ? liveState.reserve1 : liveState.reserve0;
      }
    }

    if (!reserveIn || !reserveOut || reserveIn <= 0n || reserveOut <= 0n) {
      return null;
    }

    const calculated = calculateDEXLiquidityOutput({
      chainId: params.chainId,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      reserveIn,
      reserveOut,
      feeTierBps: effectiveFeeBps,
      slippageToleranceBps: params.slippageToleranceBps || 50
    });

    if (!calculated || calculated.amountOut <= 0n) {
      return null;
    }

    const quoteTimestamp = Date.now();

    return {
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
      poolAddress,
      quoteBlockNumber,
      gasEstimate: 125000n,
      gasCostUSD: 0.03,
      quoteTimestamp,
      expiration: quoteTimestamp + 15000,
      routePath: [params.tokenIn.address, params.tokenOut.address]
    };
  }

  public async buildExecution(
    quote: DEXQuote,
    userAddress: string,
    recipientAddress?: string,
    deadline?: number
  ): Promise<DEXExecution> {
    const chainIdNum = typeof quote.chainId === 'number' ? quote.chainId : Number(quote.chainId);
    const routerAddress = getZenithV2Router(chainIdNum);
    if (!routerAddress) {
      throw new ZenithRouterNotDeployedError('ZENITH_V2', chainIdNum);
    }
    const iface = new Interface(ZENITH_V2_ROUTER_ABI);
    const recipient = recipientAddress || userAddress;
    const swapDeadline = deadline || Math.floor(Date.now() / 1000) + 1200;

    const tokenInAddr = resolvePoolTokenAddress(quote.tokenIn, chainIdNum);
    const tokenOutAddr = resolvePoolTokenAddress(quote.tokenOut, chainIdNum);

    const isNativeIn = isNativeToken(quote.tokenIn.address) || Boolean(quote.tokenIn.isNative);
    const isNativeOut = isNativeToken(quote.tokenOut.address) || Boolean(quote.tokenOut.isNative);

    let calldata: string;
    let value = '0';
    let approvalTarget = routerAddress;

    if (isNativeIn) {
      calldata = iface.encodeFunctionData('swapExactETHForTokens', [
        quote.minimumAmountOut,
        [tokenInAddr, tokenOutAddr],
        [quote.feeTierBps || 30],
        recipient,
        swapDeadline
      ]);
      value = quote.amountIn.toString();
      approvalTarget = CANONICAL_NATIVE_ADDRESS;
    } else if (isNativeOut) {
      calldata = iface.encodeFunctionData('swapExactTokensForETH', [
        quote.amountIn,
        quote.minimumAmountOut,
        [tokenInAddr, tokenOutAddr],
        [quote.feeTierBps || 30],
        recipient,
        swapDeadline
      ]);
    } else {
      calldata = iface.encodeFunctionData('swapExactTokensForTokens', [
        quote.amountIn,
        quote.minimumAmountOut,
        [tokenInAddr, tokenOutAddr],
        [quote.feeTierBps || 30],
        recipient,
        swapDeadline
      ]);
    }

    return {
      to: routerAddress,
      data: calldata,
      value,
      chainId: chainIdNum,
      gasLimit: quote.gasEstimate.toString(),
      gasEstimateUnits: quote.gasEstimate,
      approvalTarget,
      approvalAmount: isNativeIn ? '0' : quote.amountIn.toString(),
      requiredAllowanceRaw: isNativeIn ? '0' : quote.amountIn.toString()
    };
  }
}

export const zenithV2Provider = new ZenithV2Provider();
