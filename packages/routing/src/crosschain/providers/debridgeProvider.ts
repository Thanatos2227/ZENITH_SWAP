import { Interface, AbiCoder } from 'ethers';
import {
  BridgeProtocol,
  CrossChainExecution,
  CrossChainProvider,
  CrossChainQuote,
  CrossChainStatus,
  QuoteRequest,
  Token
} from '@zenith/types';
import { defaultChainRegistry } from '@zenith/chains';
import {
  getDeBridgeSourceContract,
  isDeBridgeSupported,
  DEBRIDGE_DLN_SOURCE_ABI,
  validateEvmAddress,
  validateTokenAddress,
  validateRecipientAddress,
  validateExecutionTarget
} from '@zenith/contracts';
import { isNativeToken, scaleTokenUnits } from '../../dex/dexMath';
import { formatTokenUnits, parseTokenUnits } from '../../tokenDecimals';

const dlnInterface = new Interface(DEBRIDGE_DLN_SOURCE_ABI);

export class DeBridgeProvider implements CrossChainProvider {
  public readonly id: BridgeProtocol = 'DEBRIDGE_DLN';
  public readonly name = 'deBridge DLN';

  public isAvailable(
    sourceChainId?: string,
    destinationChainId?: string,
    tokenIn?: Token,
    tokenOut?: Token
  ): boolean {
    if (!sourceChainId || !destinationChainId) return false;
    if (sourceChainId === destinationChainId) return false;
    const src = defaultChainRegistry.getChain(sourceChainId);
    const dst = defaultChainRegistry.getChain(destinationChainId);

    if (!src?.chainId || !dst?.chainId) return false;
    if (src.executionEnvironment !== 'EVM' || dst.executionEnvironment !== 'EVM') return false;

    if (tokenIn && tokenOut) {
      const symIn = (tokenIn.symbol || '').toUpperCase().replace(/^W/, '');
      const symOut = (tokenOut.symbol || '').toUpperCase().replace(/^W/, '');
      if (symIn !== symOut && !(symIn.startsWith('USD') && symOut.startsWith('USD'))) {
        return false;
      }
    }

    return isDeBridgeSupported(src.chainId) && isDeBridgeSupported(dst.chainId);
  }

  public async getQuote(request: QuoteRequest): Promise<CrossChainQuote | null> {
    const sourceChainId = request.sourceChainId || (request as any).srcChainId;
    const destinationChainId = request.destinationChainId || (request as any).destChainId;
    const recipient = request.recipientAddress || (request as any).recipient || request.userWalletAddress;

    if (!this.isAvailable(sourceChainId, destinationChainId, request.tokenIn, request.tokenOut)) {
      return null;
    }

    const srcChain = defaultChainRegistry.getChain(sourceChainId)!;
    const dstChain = defaultChainRegistry.getChain(destinationChainId)!;

    const sourceContract = validateExecutionTarget(getDeBridgeSourceContract(srcChain.chainId!), srcChain.id);
    const amountInBig = BigInt(request.amountInRaw || (request as any).amountIn || '0');
    if (amountInBig <= 0n) return null;

    const inDecimals = request.tokenIn.decimals !== undefined ? request.tokenIn.decimals : 18;
    const outDecimals = request.tokenOut.decimals !== undefined ? request.tokenOut.decimals : 18;
    const inUnits = Number(formatTokenUnits(amountInBig, inDecimals));
    const priceIn = request.tokenIn.priceUSD && request.tokenIn.priceUSD > 0 ? request.tokenIn.priceUSD : 0;
    const priceOut = request.tokenOut.priceUSD && request.tokenOut.priceUSD > 0 ? request.tokenOut.priceUSD : 0;

    const tradeValueUSD = inUnits * priceIn;
    if (priceIn > 0 && tradeValueUSD < 1.0) {
      return null;
    }

    const quoteTimestamp = Math.floor(Date.now() / 1000);

    const validatedInputToken = validateTokenAddress(request.tokenIn.address, srcChain.id, request.tokenIn.isNative);
    const validatedOutputToken = validateTokenAddress(request.tokenOut.address, dstChain.id, request.tokenOut.isNative);

    let destinationAmountBig: bigint | null = null;
    let estTransferTimeSec = 120;
    let relayerFee = '0.04%';
    let bridgeFeeUSD = 0;

    try {
      const url = `https://dln.debridge.finance/v1.0/dln/order/quote?srcChainId=${srcChain.chainId}&srcChainTokenIn=${validatedInputToken}&srcChainTokenInAmount=${amountInBig.toString()}&dstChainId=${dstChain.chainId}&dstChainTokenOut=${validatedOutputToken}&prependOperatingExpense=true`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        const outAmountStr = data.estimation?.dstChainTokenOut?.recommendedAmount || data.estimation?.dstChainTokenOut?.amount;
        if (outAmountStr) {
          const apiDecimals = data.estimation?.dstChainTokenOut?.decimals !== undefined ? Number(data.estimation.dstChainTokenOut.decimals) : outDecimals;
          const parsedAmountBig = scaleTokenUnits(BigInt(outAmountStr), apiDecimals, outDecimals);
          const outUnits = Number(formatTokenUnits(parsedAmountBig, outDecimals));
          // Sanity check rate
          if (priceIn > 0 && priceOut > 0 && inUnits > 0) {
            const rate = outUnits / inUnits;
            const spotRatio = priceIn / priceOut;
            if (rate <= spotRatio * 2 && rate >= spotRatio / 2) {
              destinationAmountBig = parsedAmountBig;
            }
          } else {
            destinationAmountBig = parsedAmountBig;
          }
          if (data.estimation?.costsDetails) {
            const opCost = data.estimation.costsDetails.find((c: any) => c.name === 'OperatingExpense');
            if (opCost?.amount) {
              bridgeFeeUSD = Number(opCost.amount) || 0;
            }
          }
          if (data.order?.approximateFulfillmentDelay) {
            estTransferTimeSec = Number(data.order.approximateFulfillmentDelay);
          } else if (data.estimation?.recommendedEstimatedFillTimeSec) {
            estTransferTimeSec = Number(data.estimation.recommendedEstimatedFillTimeSec);
          }
          if (data.protocolFeeApproximateUsdValue) {
            bridgeFeeUSD += Number(data.protocolFeeApproximateUsdValue) || 0;
          }
          if (data.estimation?.percentFee) {
            relayerFee = `${Number(data.estimation.percentFee).toFixed(4)}%`;
          }
        }
      }
    } catch {

    }

    if (!destinationAmountBig || destinationAmountBig <= 0n) {
      const inDecimals = request.tokenIn.decimals !== undefined ? request.tokenIn.decimals : 18;
      const outDecimals = request.tokenOut.decimals !== undefined ? request.tokenOut.decimals : 18;
      const protocolFeeBps = 4n;
      const feeAmountRaw = (amountInBig * protocolFeeBps) / 10000n;
      const netInBig = amountInBig - feeAmountRaw;
      const priceIn = request.tokenIn.priceUSD && request.tokenIn.priceUSD > 0 ? request.tokenIn.priceUSD : 1;
      const priceOut = request.tokenOut.priceUSD && request.tokenOut.priceUSD > 0 ? request.tokenOut.priceUSD : 1;
      const inUnits = Number(formatTokenUnits(netInBig, inDecimals));
      const expectedOutUnits = (inUnits * priceIn) / priceOut;
      const outRawStr = parseTokenUnits(expectedOutUnits.toFixed(Math.min(outDecimals, 8)), outDecimals);
      destinationAmountBig = BigInt(outRawStr) > 0n ? BigInt(outRawStr) : 1n;
      relayerFee = '0.04%';
      const feeNum = Number(feeAmountRaw) / (10 ** inDecimals);
      bridgeFeeUSD = request.tokenIn.priceUSD ? Number((feeNum * request.tokenIn.priceUSD).toFixed(4)) : 0.04;
    }

    const slippagePct = request.slippageTolerancePercent !== undefined && !isNaN(request.slippageTolerancePercent) ? request.slippageTolerancePercent : 0.5;
    const slippageBps = BigInt(Math.floor(slippagePct * 100));
    const slippageMultiplier = 10000n - slippageBps;
    const minDestinationAmountBig = (destinationAmountBig * slippageMultiplier) / 10000n;

    const gasEstimateUSD = defaultChainRegistry.getEstimatedGasCostUSD(srcChain.id, 'BRIDGE', request.gasPreset);
    const isNative = isNativeToken(request.tokenIn.address) || Boolean(request.tokenIn.isNative);
    const value = isNative ? amountInBig.toString() : '0';

    let calldata = '0x';
    if (recipient) {
      try {
        const safeUser = validateEvmAddress(recipient, 'User Address');
        const safeRecipient = validateRecipientAddress(recipient, srcChain.id);
        const abiCoder = AbiCoder.defaultAbiCoder();

        const orderCreation = {
          giveTokenAddress: validatedInputToken.toLowerCase(),
          giveAmount: amountInBig,
          takeTokenAddress: abiCoder.encode(['address'], [validatedOutputToken.toLowerCase()]),
          takeAmount: minDestinationAmountBig,
          takeChainId: dstChain.chainId!,
          receiverAddress: abiCoder.encode(['address'], [safeRecipient.toLowerCase()]),
          allowedTaker: '0x',
          allowedCancelBeneficiary: abiCoder.encode(['address'], [safeUser.toLowerCase()]),
          externalCall: '0x'
        };

        calldata = dlnInterface.encodeFunctionData('createOrder', [
          orderCreation,
          '0x',
          0,
          '0x'
        ]);
      } catch (encErr) {
        console.warn('[DeBridgeProvider] Error encoding calldata preview:', encErr);
      }
    }

    return {
      provider: 'DEBRIDGE_DLN',
      providerName: this.name,
      sourceChainId: sourceChainId,
      destinationChainId: destinationChainId,
      sourceToken: request.tokenIn,
      destinationToken: request.tokenOut,
      sourceAmountRaw: amountInBig.toString(),
      destinationAmountRaw: destinationAmountBig.toString(),
      minDestinationAmountRaw: minDestinationAmountBig.toString(),
      bridgeFeeUSD: Number(bridgeFeeUSD.toFixed(4)),
      relayerFee,
      gasEstimateUSD,
      recipient: recipient || '',
      expiration: (quoteTimestamp + 300) * 1000,
      routeIdentifier: `debridge-${srcChain.id}-${dstChain.id}-${Date.now()}`,
      executionTarget: sourceContract,
      calldata,
      value,
      approvalTarget: sourceContract,
      quoteTimestamp: quoteTimestamp * 1000,
      estimatedTransferTimeSec: estTransferTimeSec,
      securityRating: 'A'
    };
  }

  public async buildExecution(
    quote: CrossChainQuote,
    userAddress: string,
    recipientAddress?: string
  ): Promise<CrossChainExecution> {
    const srcChain = defaultChainRegistry.getChain(quote.sourceChainId)!;
    const dstChain = defaultChainRegistry.getChain(quote.destinationChainId)!;
    const sourceContract = validateExecutionTarget(getDeBridgeSourceContract(srcChain.chainId!), srcChain.id);

    const safeUser = validateEvmAddress(userAddress, 'User Address');
    const safeRecipient = validateRecipientAddress(recipientAddress || userAddress, srcChain.id);
    const safeInputToken = validateTokenAddress(quote.sourceToken.address, srcChain.id, quote.sourceToken.isNative);
    const safeOutputToken = validateTokenAddress(quote.destinationToken.address, dstChain.id, quote.destinationToken.isNative);
    const abiCoder = AbiCoder.defaultAbiCoder();

    const orderCreation = {
      giveTokenAddress: safeInputToken.toLowerCase(),
      giveAmount: BigInt(quote.sourceAmountRaw),
      takeTokenAddress: abiCoder.encode(['address'], [safeOutputToken.toLowerCase()]),
      takeAmount: BigInt(quote.minDestinationAmountRaw),
      takeChainId: dstChain.chainId!,
      receiverAddress: abiCoder.encode(['address'], [safeRecipient.toLowerCase()]),
      allowedTaker: '0x',
      allowedCancelBeneficiary: abiCoder.encode(['address'], [safeUser.toLowerCase()]),
      externalCall: '0x'
    };

    const data = dlnInterface.encodeFunctionData('createOrder', [
      orderCreation,
      '0x',
      0,
      '0x'
    ]);

    const isNative = isNativeToken(quote.sourceToken.address) || Boolean(quote.sourceToken.isNative);

    return {
      to: sourceContract,
      data,
      calldata: data,
      value: isNative ? quote.sourceAmountRaw : '0',
      chainId: srcChain.chainId!,
      approvalTarget: sourceContract,
      requiredAllowanceRaw: quote.sourceAmountRaw,
      approvalAmount: quote.sourceAmountRaw
    } as any;
  }

  public async getStatus(sourceTxHash: string, _quote: CrossChainQuote): Promise<CrossChainStatus> {
    try {
      const url = `https://dln.debridge.finance/v1.0/dln/tx/${sourceTxHash}/order-ids`;
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const orderIds = await res.json();
        const orderId = orderIds?.[0];
        if (orderId) {
          const statusRes = await fetch(`https://dln.debridge.finance/v1.0/dln/order/${orderId}/status`);
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            if (statusData.state === 'Fulfilled') {
              return {
                state: 'DESTINATION_FILLED',
                sourceTxHash,
                destinationTxHash: statusData.fulfillTxHash,
                isComplete: true,
                isFailed: false,
                timestamp: Date.now()
              };
            }
            if (statusData.state === 'Cancelled' || statusData.state === 'ClaimedUnlock') {
              return {
                state: 'REFUND_PENDING',
                sourceTxHash,
                isComplete: false,
                isFailed: true,
                errorMessage: `deBridge DLN order state: ${statusData.state}`,
                timestamp: Date.now()
              };
            }
          }
        }
      }
    } catch {

    }

    return {
      state: 'FULFILLING',
      sourceTxHash,
      isComplete: false,
      isFailed: false,
      timestamp: Date.now()
    };
  }

  public async getDestinationTransaction(sourceTxHash: string, quote: CrossChainQuote): Promise<string | null> {
    const status = await this.getStatus(sourceTxHash, quote);
    return status.destinationTxHash || null;
  }
}

export const defaultDeBridgeProvider = new DeBridgeProvider();
