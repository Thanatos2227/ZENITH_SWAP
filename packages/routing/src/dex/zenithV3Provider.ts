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
    if (!this.supportedChainIds.includes(params.chainId)) return null;

    const routerAddress = getZenithV3Router(params.chainId);
    if (!routerAddress) return null;

    const provider = (params as any).provider as Provider | undefined;
    if (!provider) return null;

    const requestedFeeBps = (params as any).feeTierBps;
    const feePips = (requestedFeeBps === undefined ? 30 : requestedFeeBps) * 100;

    let liveState: ZenithV3LivePoolState | null;
    try {
      const inAddr = resolvePoolTokenAddress(params.tokenIn, params.chainId);
      const outAddr = resolvePoolTokenAddress(params.tokenOut, params.chainId);
      liveState = await PoolStateReader.getLiveV3PoolStateForPair(
        params.chainId,
        inAddr,
        outAddr,
        feePips,
        provider
      );
    } catch {
      return null;
    }

    if (!liveState || !liveState.poolAddress || liveState.liquidity <= 0n || liveState.sqrtPriceX96 <= 0n) return null;
    if (!liveState.unlocked) return null;

    const effectiveFeeBps = liveState.fee / 100;
    if (!Number.isFinite(effectiveFeeBps) || effectiveFeeBps <= 0) return null;

    const calculated = calculateV3ConcentratedOutput({
      chainId: params.chainId,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      amountIn: params.amountIn,
      liquidity: liveState.liquidity,
      sqrtPriceX96: liveState.sqrtPriceX96,
      currentTick: liveState.tick,
      feeTierBps: effectiveFeeBps,
      tickSpacing: liveState.tickSpacing,
      slippageToleranceBps: params.slippageToleranceBps,
      initializedTicks: liveState.initializedTicks
    });

    if (!calculated || calculated.amountOut <= 0n) return null;

    const quoteTimestamp = Date.now();
    const quote: DEXQuote = {
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
        const iface = new Interface(ZENITH_V3_ROUTER_ABI);
        const tokenInAddr = resolvePoolTokenAddress(params.tokenIn, params.chainId);
        const tokenOutAddr = resolvePoolTokenAddress(params.tokenOut, params.chainId);
        const isNativeIn = isNativeToken(params.tokenIn.address) || Boolean(params.tokenIn.isNative);
        const data = iface.encodeFunctionData('exactInputSingle', [[
          tokenInAddr,
          tokenOutAddr,
          liveState.fee,
          params.recipient,
          Math.floor(Date.now() / 1000) + 1200,
          params.amountIn,
          calculated.minimumAmountOut,
          0
        ]]);
        const gas = await provider.estimateGas({
          to: routerAddress,
          data,
          value: isNativeIn ? params.amountIn : 0n
        });
        quote.gasEstimate = BigInt(gas.toString());
        quote.gasEstimateUnits = quote.gasEstimate;
      } catch {
        // Never substitute a fabricated gas estimate.
      }
    }

    return quote;
  }

  public async buildExecution(
    quote: DEXQuote,
    userAddress: string,
    recipientAddress?: string,
    deadline?: number
  ): Promise<DEXExecution> {
    const chainIdNum = typeof quote.chainId === 'number' ? quote.chainId : Number(quote.chainId);
    const routerAddress = getZenithV3Router(chainIdNum);
    if (!routerAddress) throw new ZenithRouterNotDeployedError('ZENITH_V3', chainIdNum);
    if (!quote.poolAddress) throw new Error('ZENITH_V3: quote is missing live pool address');
    if (Date.now() > quote.expiration) throw new Error('ZENITH_V3: quote expired; request a fresh quote');
    if (quote.minimumAmountOut <= 0n) throw new Error('ZENITH_V3: invalid minimum output');
    if (quote.gasEstimate <= 0n) throw new Error('ZENITH_V3: gas estimation unavailable; refusing fabricated gas limit');

    const iface = new Interface(ZENITH_V3_ROUTER_ABI);
    const recipient = recipientAddress || userAddress;
    const swapDeadline = deadline || Math.floor(Date.now() / 1000) + 1200;
    const tokenInAddr = resolvePoolTokenAddress(quote.tokenIn, chainIdNum);
    const tokenOutAddr = resolvePoolTokenAddress(quote.tokenOut, chainIdNum);
    const isNativeIn = isNativeToken(quote.tokenIn.address) || Boolean(quote.tokenIn.isNative);

    const calldata = iface.encodeFunctionData('exactInputSingle', [[
      tokenInAddr,
      tokenOutAddr,
      Math.round(quote.feeTierBps * 100),
      recipient,
      swapDeadline,
      quote.amountIn,
      quote.minimumAmountOut,
      0
    ]]);

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
