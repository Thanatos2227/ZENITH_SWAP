import { DEXProtocol, Token } from '@zenith/types';
import { Interface } from 'ethers';
import {
  TRADER_JOE_LB_ROUTERS,
  TRADER_JOE_ROUTER_ABI,
  CANONICAL_NATIVE_ADDRESS,
  getTraderJoeRouter
} from '@zenith/contracts';
import { DEXProvider, DEXQuote, DEXExecution, DEXQuoteParams } from './types';
import { calculateDEXLiquidityOutput, isNativeToken, resolvePoolTokenAddress } from './dexMath';

export class TraderJoeProvider implements DEXProvider {
  public readonly id: DEXProtocol = 'TRADER_JOE';
  public readonly protocol: DEXProtocol = 'TRADER_JOE';
  public readonly name = 'Trader Joe (LFJ)';
  public readonly supportedChainIds: number[] = Object.keys(TRADER_JOE_LB_ROUTERS).map(Number);

  public isAvailable(chainId: number | string, _tokenIn: Token, _tokenOut: Token): boolean {
    const id = typeof chainId === 'number' ? chainId : (chainId === 'avalanche' ? 43114 : Number(chainId));
    return this.supportedChainIds.includes(id);
  }

  public async getQuote(params: DEXQuoteParams): Promise<DEXQuote | null> {
    if (!this.supportedChainIds.includes(params.chainId)) {
      return null;
    }

    try {
      const routerAddress = getTraderJoeRouter(params.chainId);

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
        gasEstimate: 165000n,
        gasEstimateUnits: 165000n,
        gasCostUSD: 0.04,
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
    const routerAddress = getTraderJoeRouter(chainIdNum);
    const iface = new Interface(TRADER_JOE_ROUTER_ABI);
    const recipient = recipientAddress || userAddress;
    const swapDeadline = deadline || Math.floor(Date.now() / 1000) + 1200;

    const tokenInAddr = resolvePoolTokenAddress(quote.tokenIn, chainIdNum);
    const tokenOutAddr = resolvePoolTokenAddress(quote.tokenOut, chainIdNum);

    const path = {
      pairBinSteps: [20],
      versions: [2],
      tokenPath: [tokenInAddr, tokenOutAddr]
    };

    const isNativeIn = isNativeToken(quote.tokenIn.address) || Boolean(quote.tokenIn.isNative);
    const isNativeOut = isNativeToken(quote.tokenOut.address) || Boolean(quote.tokenOut.isNative);

    let calldata: string;
    if (isNativeIn) {
      calldata = iface.encodeFunctionData('swapExactNATIVEForTokens', [
        quote.minimumAmountOut,
        path,
        recipient,
        swapDeadline
      ]);
    } else if (isNativeOut) {
      calldata = iface.encodeFunctionData('swapExactTokensForNATIVE', [
        quote.amountIn,
        quote.minimumAmountOut,
        path,
        recipient,
        swapDeadline
      ]);
    } else {
      calldata = iface.encodeFunctionData('swapExactTokensForTokens', [
        quote.amountIn,
        quote.minimumAmountOut,
        path,
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
