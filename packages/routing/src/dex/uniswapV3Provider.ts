import { DEXProtocol, Token } from '@zenith/types';
import { Interface, AbiCoder, solidityPacked } from 'ethers';
import {
  UNISWAP_V3_SWAP_ROUTERS,
  UNISWAP_V3_SWAP_ROUTER_ABI,
  CANONICAL_NATIVE_ADDRESS,
  getUniswapV3Router,
  getUniswapUniversalRouter,
  UNISWAP_UNIVERSAL_ROUTER_ABI
} from '@zenith/contracts';
import { DEXProvider, DEXQuote, DEXExecution, DEXQuoteParams } from './types';
import { calculateDEXLiquidityOutput, isNativeToken, resolvePoolTokenAddress } from './dexMath';

export class UniswapV3Provider implements DEXProvider {
  public readonly id: DEXProtocol = 'UNISWAP_V3';
  public readonly protocol: DEXProtocol = 'UNISWAP_V3';
  public readonly name = 'Uniswap V3';
  public readonly supportedChainIds: number[] = Object.keys(UNISWAP_V3_SWAP_ROUTERS).map(Number);

  public isAvailable(chainId: number | string, _tokenIn: Token, _tokenOut: Token): boolean {
    const id = typeof chainId === 'number' ? chainId : Number(chainId);
    return this.supportedChainIds.includes(id);
  }

  public async getQuote(params: DEXQuoteParams): Promise<DEXQuote | null> {
    if (!this.supportedChainIds.includes(params.chainId)) {
      return null;
    }

    try {
      const isNative = isNativeToken(params.tokenIn.address) || Boolean(params.tokenIn.isNative) || isNativeToken(params.tokenOut.address) || Boolean(params.tokenOut.isNative);
      const universalRouter = getUniswapUniversalRouter(params.chainId);
      const routerAddress = (isNative && universalRouter) ? universalRouter : getUniswapV3Router(params.chainId);

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
        gasEstimate: 185000n,
        gasEstimateUnits: 185000n,
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
    deadline?: number
  ): Promise<DEXExecution> {
    const chainIdNum = typeof quote.chainId === 'number' ? quote.chainId : Number(quote.chainId);
    const routerAddress = getUniswapV3Router(chainIdNum);
    const recipient = recipientAddress || userAddress;
    const swapDeadline = deadline || Math.floor(Date.now() / 1000) + 1200;

    const tokenInAddr = resolvePoolTokenAddress(quote.tokenIn, chainIdNum);
    const tokenOutAddr = resolvePoolTokenAddress(quote.tokenOut, chainIdNum);

    const isNativeIn = isNativeToken(quote.tokenIn.address) || Boolean(quote.tokenIn.isNative);
    const isNativeOut = isNativeToken(quote.tokenOut.address) || Boolean(quote.tokenOut.isNative);
    const universalRouter = getUniswapUniversalRouter(chainIdNum);

    if ((isNativeIn || isNativeOut) && universalRouter) {
      const uIface = new Interface(UNISWAP_UNIVERSAL_ROUTER_ABI);
      const abiCoder = AbiCoder.defaultAbiCoder();
      const path = solidityPacked(
        ['address', 'uint24', 'address'],
        [tokenInAddr, quote.feeTierBps * 100, tokenOutAddr]
      );
      const ROUTER_ADDRESS_THIS = '0x0000000000000000000000000000000000000002';

      if (isNativeIn) {

        const wrapInput = abiCoder.encode(['address', 'uint256'], [ROUTER_ADDRESS_THIS, quote.amountIn]);
        const swapInput = abiCoder.encode(
          ['address', 'uint256', 'uint256', 'bytes', 'bool'],
          [recipient, quote.amountIn, quote.minimumAmountOut, path, false]
        );
        const calldata = uIface.encodeFunctionData('execute(bytes,bytes[],uint256)', [
          '0x0b00',
          [wrapInput, swapInput],
          swapDeadline
        ]);

        return {
          to: universalRouter,
          data: calldata,
          value: quote.amountIn.toString(),
          chainId: chainIdNum,
          gasLimit: quote.gasEstimate.toString(),
          gasEstimateUnits: quote.gasEstimate,
          approvalTarget: CANONICAL_NATIVE_ADDRESS,
          approvalAmount: '0',
          requiredAllowanceRaw: '0'
        };
      } else {

        const swapInput = abiCoder.encode(
          ['address', 'uint256', 'uint256', 'bytes', 'bool'],
          [ROUTER_ADDRESS_THIS, quote.amountIn, quote.minimumAmountOut, path, true]
        );
        const unwrapInput = abiCoder.encode(['address', 'uint256'], [recipient, quote.minimumAmountOut]);
        const calldata = uIface.encodeFunctionData('execute(bytes,bytes[],uint256)', [
          '0x0001',
          [swapInput, unwrapInput],
          swapDeadline
        ]);

        return {
          to: universalRouter,
          data: calldata,
          value: '0',
          chainId: chainIdNum,
          gasLimit: quote.gasEstimate.toString(),
          gasEstimateUnits: quote.gasEstimate,
          approvalTarget: universalRouter,
          approvalAmount: quote.amountIn.toString(),
          requiredAllowanceRaw: quote.amountIn.toString()
        };
      }
    }

    const iface = new Interface(UNISWAP_V3_SWAP_ROUTER_ABI);
    const isSwapRouter02 = routerAddress.toLowerCase() === '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'.toLowerCase() ||
      routerAddress.toLowerCase() === '0x2626664c2603336e57b271c5c0b26f421741e481'.toLowerCase() ||
      routerAddress.toLowerCase() === '0xb9714879f3842923608032f71fc48e3006863d23'.toLowerCase();

    let calldata: string;
    if (isSwapRouter02) {
      calldata = iface.encodeFunctionData(
        'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))',
        [
          [
            tokenInAddr,
            tokenOutAddr,
            quote.feeTierBps * 100,
            recipient,
            quote.amountIn,
            quote.minimumAmountOut,
            0
          ]
        ]
      );
    } else {
      calldata = iface.encodeFunctionData(
        'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))',
        [
          [
            tokenInAddr,
            tokenOutAddr,
            quote.feeTierBps * 100,
            recipient,
            swapDeadline,
            quote.amountIn,
            quote.minimumAmountOut,
            0
          ]
        ]
      );
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
