import { DEXProtocol, Token } from '@zenith/types';
import { Interface } from 'ethers';
import {
  AERODROME_FACTORY,
  AERODROME_ROUTER_ABI,
  CANONICAL_NATIVE_ADDRESS,
  getAerodromeRouter
} from '@zenith/contracts';
import { DEXProvider, DEXQuote, DEXExecution, DEXQuoteParams } from './types';
import { calculateDEXLiquidityOutput, isNativeToken, resolvePoolTokenAddress } from './dexMath';

export class AerodromeProvider implements DEXProvider {
  public readonly id: DEXProtocol = 'AERODROME';
  public readonly protocol: DEXProtocol = 'AERODROME';
  public readonly name = 'Aerodrome Finance';
  public readonly supportedChainIds: number[] = [8453];

  public isAvailable(chainId: number | string, _tokenIn: Token, _tokenOut: Token): boolean {
    const id = typeof chainId === 'number' ? chainId : (chainId === 'base' ? 8453 : Number(chainId));
    return this.supportedChainIds.includes(id);
  }

  public async getQuote(params: DEXQuoteParams): Promise<DEXQuote | null> {
    if (!this.supportedChainIds.includes(params.chainId)) {
      return null;
    }

    try {
      const routerAddress = getAerodromeRouter(params.chainId);
      const reserveIn = (params as any).reserveIn || (params as any).customReserveIn;
      const reserveOut = (params as any).reserveOut || (params as any).customReserveOut;
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
        gasEstimate: 160000n,
        gasEstimateUnits: 160000n,
        gasCostUSD: 0.02,
        quoteTimestamp,
        expiration: quoteTimestamp + 15000,
        routePath: [params.tokenIn.address, params.tokenOut.address]
      };
    } catch {
      return null;
    }
  }

  public async buildExecution(
    quote: DEXQuote,
    userAddress: string,
    recipientAddress?: string,
    deadline?: number
  ): Promise<DEXExecution> {
    const chainIdNum = typeof quote.chainId === 'number' ? quote.chainId : Number(quote.chainId);
    const routerAddress = getAerodromeRouter(chainIdNum);
    const iface = new Interface(AERODROME_ROUTER_ABI);
    const recipient = recipientAddress || userAddress;
    const swapDeadline = deadline || Math.floor(Date.now() / 1000) + 1200;
    const tokenInAddr = resolvePoolTokenAddress(quote.tokenIn, chainIdNum);
    const tokenOutAddr = resolvePoolTokenAddress(quote.tokenOut, chainIdNum);

    const routes = [
      {
        from: tokenInAddr,
        to: tokenOutAddr,
        stable: false,
        factory: AERODROME_FACTORY
      }
    ];

    const isNativeIn = isNativeToken(quote.tokenIn.address) || Boolean(quote.tokenIn.isNative);
    const isNativeOut = isNativeToken(quote.tokenOut.address) || Boolean(quote.tokenOut.isNative);

    let calldata: string;
    if (isNativeIn) {
      calldata = iface.encodeFunctionData('swapExactETHForTokens', [
        quote.minimumAmountOut,
        routes,
        recipient,
        swapDeadline
      ]);
    } else if (isNativeOut) {
      calldata = iface.encodeFunctionData('swapExactTokensForETH', [
        quote.amountIn,
        quote.minimumAmountOut,
        routes,
        recipient,
        swapDeadline
      ]);
    } else {
      calldata = iface.encodeFunctionData('swapExactTokensForTokens', [
        quote.amountIn,
        quote.minimumAmountOut,
        routes,
        recipient,
        swapDeadline
      ]);
    }

    return {
      to: routerAddress,
      data: calldata,
      value: isNativeIn ? quote.amountIn.toString() : '0',
      chainId: chainIdNum,
      gasLimit: quote.gasEstimate.toString(),
      gasEstimateUnits: quote.gasEstimate,
      approvalTarget: isNativeIn ? CANONICAL_NATIVE_ADDRESS : routerAddress,
      approvalAmount: quote.amountIn.toString(),
      requiredAllowanceRaw: quote.amountIn.toString()
    };
  }
}
