import { DEXProtocol, Token } from '@zenith/types';
import { Interface } from 'ethers';
import {
  PANCAKESWAP_V3_ROUTERS,
  PANCAKESWAP_V3_ROUTER_ABI,
  CANONICAL_NATIVE_ADDRESS,
  getPancakeSwapRouter
} from '@zenith/contracts';
import { DEXProvider, DEXQuote, DEXExecution, DEXQuoteParams } from './types';
import { calculateDEXLiquidityOutput, isNativeToken, resolvePoolTokenAddress } from './dexMath';

export class PancakeSwapProvider implements DEXProvider {
  public readonly id: DEXProtocol = 'PANCAKESWAP';
  public readonly protocol: DEXProtocol = 'PANCAKESWAP';
  public readonly name = 'PancakeSwap V3';
  public readonly supportedChainIds: number[] = Object.keys(PANCAKESWAP_V3_ROUTERS).map(Number);

  public isAvailable(chainId: number | string, _tokenIn: Token, _tokenOut: Token): boolean {
    const id = typeof chainId === 'number' ? chainId : Number(chainId);
    return this.supportedChainIds.includes(id);
  }

  public async getQuote(params: DEXQuoteParams): Promise<DEXQuote | null> {
    if (!this.supportedChainIds.includes(params.chainId)) {
      return null;
    }

    try {
      const routerAddress = getPancakeSwapRouter(params.chainId);

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
        gasCostUSD: 0.05,
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
    _deadline?: number
  ): Promise<DEXExecution> {
    const chainIdNum = typeof quote.chainId === 'number' ? quote.chainId : Number(quote.chainId);
    const routerAddress = getPancakeSwapRouter(chainIdNum);
    const iface = new Interface(PANCAKESWAP_V3_ROUTER_ABI);
    const recipient = recipientAddress || userAddress;

    const tokenInAddr = resolvePoolTokenAddress(quote.tokenIn, chainIdNum);
    const tokenOutAddr = resolvePoolTokenAddress(quote.tokenOut, chainIdNum);

    const calldata = iface.encodeFunctionData('exactInputSingle', [
      [
        tokenInAddr,
        tokenOutAddr,
        quote.feeTierBps * 100,
        recipient,
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
