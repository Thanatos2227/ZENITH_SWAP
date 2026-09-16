import { DEXProtocol, Token } from '@zenith/types';
import { Interface } from 'ethers';
import {
  ZENITH_V3_ROUTER_ABI,
  CANONICAL_NATIVE_ADDRESS,
  getZenithV3Router,
  ZenithRouterNotDeployedError
} from '@zenith/contracts';
import { DEXProvider, DEXQuote, DEXExecution, DEXQuoteParams } from './types';
import {
  calculateV3ConcentratedOutput,
  isNativeToken,
  resolvePoolTokenAddress
} from './dexMath';

export class ZenithV3Provider implements DEXProvider {
  public readonly id: DEXProtocol = 'ZENITH_V3';
  public readonly protocol: DEXProtocol = 'ZENITH_V3';
  public readonly name = 'ZENITH V3 Concentrated AMM';
  public readonly supportedChainIds: number[] = [1, 10, 56, 137, 8453, 42161, 43114, 31337];

  public isAvailable(chainId: number | string, _tokenIn: Token, _tokenOut: Token): boolean {
    const id = typeof chainId === 'number' ? chainId : (chainId === 'polygon' ? 137 : Number(chainId));
    const routerAddress = getZenithV3Router(id);
    return Boolean(routerAddress && this.supportedChainIds.includes(id));
  }

  public async getQuote(params: DEXQuoteParams): Promise<DEXQuote | null> {
    if (!this.supportedChainIds.includes(params.chainId)) {
      return null;
    }

    const routerAddress = getZenithV3Router(params.chainId);
    if (!routerAddress) {
      return null;
    }

    const effectiveFeeBps = (params as any).feeTierBps !== undefined ? (params as any).feeTierBps : 30;

    const calculated = calculateV3ConcentratedOutput({
      chainId: params.chainId,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      feeTierBps: effectiveFeeBps,
      slippageToleranceBps: params.slippageToleranceBps || 50,
      customReserveIn: (params as any).customReserveIn,
      customReserveOut: (params as any).customReserveOut,
      customLiquidity: (params as any).customLiquidity,
      customSqrtPriceX96: (params as any).customSqrtPriceX96,
      customCurrentTick: (params as any).customCurrentTick,
      customTickSpacing: (params as any).customTickSpacing,
      initializedTicks: (params as any).initializedTicks
    });

    if (!calculated || calculated.amountOut <= 0n) {
      return null;
    }

    const quoteTimestamp = Date.now();

    return {
      provider: 'ZENITH_V3',
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
      gasEstimate: 145000n,
      gasCostUSD: 0.04,
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
    const routerAddress = getZenithV3Router(chainIdNum);
    if (!routerAddress) {
      throw new ZenithRouterNotDeployedError('ZENITH_V3', chainIdNum);
    }
    const iface = new Interface(ZENITH_V3_ROUTER_ABI);
    const recipient = recipientAddress || userAddress;
    const swapDeadline = deadline || Math.floor(Date.now() / 1000) + 1200;

    const tokenInAddr = resolvePoolTokenAddress(quote.tokenIn, chainIdNum);
    const tokenOutAddr = resolvePoolTokenAddress(quote.tokenOut, chainIdNum);

    const isNativeIn = isNativeToken(quote.tokenIn.address) || Boolean(quote.tokenIn.isNative);

    const calldata = iface.encodeFunctionData('exactInputSingle', [
      [
        tokenInAddr,
        tokenOutAddr,
        (quote.feeTierBps || 30) * 100,
        recipient,
        swapDeadline,
        quote.amountIn,
        quote.minimumAmountOut,
        0
      ]
    ]);

    return {
      to: routerAddress,
      data: calldata,
      value: isNativeIn ? quote.amountIn.toString() : '0',
      chainId: chainIdNum,
      gasLimit: quote.gasEstimate.toString(),
      gasEstimateUnits: quote.gasEstimate,
      approvalTarget: isNativeIn ? CANONICAL_NATIVE_ADDRESS : routerAddress,
      approvalAmount: isNativeIn ? '0' : quote.amountIn.toString(),
      requiredAllowanceRaw: isNativeIn ? '0' : quote.amountIn.toString()
    };
  }
}

export const zenithV3Provider = new ZenithV3Provider();

