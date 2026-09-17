import { DEXProtocol, Token } from '@zenith/types';
import { Interface, Provider } from 'ethers';
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
import { PoolStateReader, ZenithV3LivePoolState } from './poolStateReader';

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

    let poolAddress: string | undefined = (params as any).poolAddress;
    let quoteBlockNumber: number | undefined = (params as any).quoteBlockNumber;
    let liquidity: bigint | undefined = (params as any).liquidity || (params as any).customLiquidity;
    let sqrtPriceX96: bigint | undefined = (params as any).sqrtPriceX96 || (params as any).customSqrtPriceX96;
    let currentTick: number | undefined = (params as any).currentTick || (params as any).customCurrentTick;
    let tickSpacing: number | undefined = (params as any).tickSpacing || (params as any).customTickSpacing;
    let initializedTicks = (params as any).initializedTicks;

    if ((!liquidity || !sqrtPriceX96) && (params as any).provider) {
      try {
        const inAddr = resolvePoolTokenAddress(params.tokenIn, params.chainId);
        const outAddr = resolvePoolTokenAddress(params.tokenOut, params.chainId);
        const feePips = effectiveFeeBps * 100;
        const liveState: ZenithV3LivePoolState | null = await PoolStateReader.getLiveV3PoolStateForPair(
          params.chainId,
          inAddr,
          outAddr,
          feePips,
          (params as any).provider as Provider
        );

        if (liveState && liveState.liquidity > 0n && liveState.sqrtPriceX96 > 0n) {
          poolAddress = liveState.poolAddress;
          quoteBlockNumber = liveState.blockNumber;
          liquidity = liveState.liquidity;
          sqrtPriceX96 = liveState.sqrtPriceX96;
          currentTick = liveState.tick;
          tickSpacing = liveState.tickSpacing;
          initializedTicks = liveState.initializedTicks;
        }
      } catch {
        // Fall back to parameters
      }
    }

    if (!liquidity || !sqrtPriceX96 || liquidity <= 0n || sqrtPriceX96 <= 0n) {
      return null;
    }

    const calculated = calculateV3ConcentratedOutput({
      chainId: params.chainId,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      liquidity,
      sqrtPriceX96,
      currentTick,
      feeTierBps: effectiveFeeBps,
      tickSpacing,
      slippageToleranceBps: params.slippageToleranceBps || 50,
      initializedTicks,
      reserveIn: (params as any).reserveIn || (params as any).customReserveIn,
      reserveOut: (params as any).reserveOut || (params as any).customReserveOut
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
      poolAddress,
      quoteBlockNumber,
      gasEstimate: 160000n,
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
