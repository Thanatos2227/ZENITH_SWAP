import { defaultChainRegistry } from '@zenith/chains';
import { ExecutionStep, QuoteResponse, ReceiptView } from '@zenith/types';
import { defaultEVMAdapter, EVMExecutionAdapter } from './adapters/evmAdapter';
import { defaultSolanaAdapter, SolanaExecutionAdapter } from './adapters/solanaAdapter';
import { ExecutionStateMachine } from './stateMachine';
import { defaultIntentEngine, CrossChainIntentEngine } from './crosschain/intentEngine';
import { defaultCrossChainTracker, CrossChainTracker, ActiveCrossChainOrder } from './crosschain/crossChainTracker';
import { defaultTokenRiskEngine } from '@zenith/security';
import {
  RecipientMismatchError,
  SecurityPolicyViolationError,
  ConfigurationError
} from '@zenith/contracts';

export class ExecutionCoordinator {
  private evmAdapter: EVMExecutionAdapter;
  private solanaAdapter: SolanaExecutionAdapter;
  private intentEngine: CrossChainIntentEngine;
  private tracker: CrossChainTracker;

  constructor(
    evmAdapter = defaultEVMAdapter,
    solanaAdapter = defaultSolanaAdapter,
    intentEngine = defaultIntentEngine,
    tracker = defaultCrossChainTracker
  ) {
    this.evmAdapter = evmAdapter;
    this.solanaAdapter = solanaAdapter;
    this.intentEngine = intentEngine;
    this.tracker = tracker;
  }

  public async executeTrade(params: {
    quote: QuoteResponse;
    userAddress: string;
    stateMachine?: ExecutionStateMachine;
    signer?: any;
    provider?: any;
    skipDestinationWait?: boolean;
  }): Promise<ReceiptView> {
    const stateMachine = params.stateMachine || new ExecutionStateMachine();
    const isCrossChain = params.quote.request.sourceChainId !== params.quote.request.destinationChainId;
    const sourceChain = defaultChainRegistry.getChain(params.quote.request.sourceChainId);
    const destChain = defaultChainRegistry.getChain(params.quote.request.destinationChainId);

    if (!sourceChain || !destChain) {
      throw new ConfigurationError('[ExecutionCoordinator] Source or destination chain config not found in registry');
    }

    const expectedRecipient = params.quote.request.recipientAddress || params.quote.request.userWalletAddress || params.userAddress;
    if (params.userAddress.toLowerCase() !== expectedRecipient.toLowerCase()) {
      throw new RecipientMismatchError(params.userAddress, expectedRecipient);
    }

    const riskIn = defaultTokenRiskEngine.evaluateToken(params.quote.request.tokenIn);
    const riskOut = defaultTokenRiskEngine.evaluateToken(params.quote.request.tokenOut);

    if (!riskIn.isTradeable) {
      throw new SecurityPolicyViolationError(
        `Execution blocked: Token ${params.quote.request.tokenIn.symbol} failed security policy (${riskIn.overallRiskLevel} risk).`,
        riskIn.reasons
      );
    }
    if (!riskOut.isTradeable) {
      throw new SecurityPolicyViolationError(
        `Execution blocked: Token ${params.quote.request.tokenOut.symbol} failed security policy (${riskOut.overallRiskLevel} risk).`,
        riskOut.reasons
      );
    }

    const steps: ExecutionStep[] = [];

    if (!params.quote.request.tokenIn.isNative && sourceChain.executionEnvironment === 'EVM') {
      steps.push({
        id: 'step-approve',
        title: `Approve ${params.quote.request.tokenIn.symbol}`,
        description: 'Authorize router/bridge contract to spend tokens',
        status: 'PENDING'
      });
    }

    steps.push({
      id: 'step-execute',
      title: isCrossChain
        ? `Initiate Cross-Chain Bridge (${params.quote.bestRoute.crossChainQuote?.providerName || 'Bridge'})`
        : (params.quote.tradeType === 'EXACT_OUTPUT' ? 'Execute Exact-Output Swap' : 'Execute Swap'),
      description: `Swap ${params.quote.amountInFormatted} ${params.quote.request.tokenIn.symbol} for ${params.quote.amountOutFormatted} ${params.quote.request.tokenOut.symbol}`,
      status: 'PENDING'
    });

    if (isCrossChain) {
      steps.push({
        id: 'step-intent-fulfill',
        title: 'Destination Settlement & Verification',
        description: `Bridge tracking on ${destChain.shortName}`,
        status: 'PENDING'
      });
    }

    stateMachine.initializeSteps(steps);

    let txHash = '';
    let gasUsedWei: bigint = 0n;
    let gasPriceWei: bigint = 0n;

    if (isCrossChain && params.quote.intent) {
      this.intentEngine.registerIntent(params.quote.intent);
      this.intentEngine.updateIntentState(params.quote.intent.orderId, 'SIGNED');
      this.intentEngine.updateIntentState(params.quote.intent.orderId, 'SUBMITTED');
    }

    if (sourceChain.executionEnvironment === 'SOLANA') {
      const result = await this.solanaAdapter.executeSwap({
        quote: params.quote,
        userPublicKey: params.userAddress,
        walletProvider: params.signer,
        onStatusChange: (status, signature) => {
          if (signature) txHash = signature;
          stateMachine.transitionTo(status, { id: 'step-execute', status: 'ACTIVE', txHash: signature });
        }
      });
      txHash = result.txSignature;
    } else {
      const result = await this.evmAdapter.executeSwap({
        quote: params.quote,
        userAddress: params.userAddress,
        signer: params.signer,
        provider: params.provider,
        onStatusChange: (status, hash) => {
          if (hash) txHash = hash;
          if (status === 'APPROVING') {
            stateMachine.transitionTo('APPROVING', { id: 'step-approve', status: 'ACTIVE' });
          } else if (status === 'APPROVED') {
            stateMachine.transitionTo('APPROVED', { id: 'step-approve', status: 'SUCCESS' });
          } else if (status === 'SIGNING') {
            stateMachine.transitionTo('SIGNING', { id: 'step-execute', status: 'ACTIVE' });
          } else if (status === 'SUBMITTING' || status === 'BROADCASTED') {
            stateMachine.transitionTo(status, { id: 'step-execute', status: 'ACTIVE', txHash: hash });
          } else if (status === 'CONFIRMING') {
            stateMachine.transitionTo('CONFIRMING', { id: 'step-execute', status: 'ACTIVE', txHash: hash });
          } else if (status === 'BRIDGE_IN_FLIGHT') {
            stateMachine.transitionTo('BRIDGE_IN_FLIGHT', { id: 'step-execute', status: 'SUCCESS', txHash: hash });
          } else if (status === 'COMPLETED') {
            stateMachine.transitionTo('CONFIRMING', { id: 'step-execute', status: 'SUCCESS', txHash: hash });
          }
        }
      });
      txHash = result.txHash;
      gasUsedWei = result.gasUsed;
      gasPriceWei = result.effectiveGasPriceWei;
    }

    stateMachine.transitionTo('CONFIRMING', { id: 'step-execute', status: 'SUCCESS', txHash });

    let destinationTxHash: string | undefined;

    if (isCrossChain && params.quote.intent) {
      stateMachine.transitionTo('BRIDGE_IN_FLIGHT', { id: 'step-intent-fulfill', status: 'ACTIVE' });
      this.intentEngine.updateIntentState(params.quote.intent.orderId, 'ACCEPTED', { txHashSource: txHash });
      this.intentEngine.updateIntentState(params.quote.intent.orderId, 'FULFILLING');

      const activeOrder: ActiveCrossChainOrder = {
        orderId: params.quote.intent.orderId,
        sourceChainId: params.quote.request.sourceChainId,
        destinationChainId: params.quote.request.destinationChainId,
        sourceTxHash: txHash,
        provider: params.quote.bestRoute.crossChainQuote?.provider || 'ACROSS',
        recipient: params.userAddress,
        quote: params.quote.bestRoute.crossChainQuote!,
        status: 'FULFILLING',
        createdAt: Date.now(),
        lastUpdated: Date.now()
      };

      this.tracker.registerOrder(activeOrder);

      if (!params.skipDestinationWait) {
        const trackingResult = await this.tracker.trackUntilSettled({
          order: activeOrder,
          stateMachine: stateMachine,
          maxPollDurationMs: (params as any).maxPollDurationMs || 1800000,
          pollIntervalMs: 2500,
          onStateChange: (state, meta) => {
            if (params.quote.intent) {
              this.intentEngine.updateIntentState(params.quote.intent.orderId, state, {
                txHashDestination: meta?.destTxHash
              });
            }
          }
        });

        if (trackingResult.isSuccess && trackingResult.destinationTxHash) {
          destinationTxHash = trackingResult.destinationTxHash;
        }
      }
    }

    const explorerUrl = defaultChainRegistry.getExplorerTxUrl(sourceChain.id, txHash);
    const destExplorerUrl = destinationTxHash
      ? defaultChainRegistry.getExplorerTxUrl(destChain.id, destinationTxHash)
      : undefined;

    const amountOutNum = Number(params.quote.amountOutFormatted.replace(/,/g, ''));
    const amountOutUSD = params.quote.request.tokenOut.priceUSD
      ? amountOutNum * params.quote.request.tokenOut.priceUSD
      : undefined;

    let gasPaidUSD = params.quote.bestRoute.gasCostUSD;
    if (gasUsedWei > 0n && gasPriceWei > 0n && sourceChain.nativeCurrency?.symbol) {
      const nativePrice = sourceChain.id === 'base' || sourceChain.id === 'arbitrum' || sourceChain.id === 'optimism' || sourceChain.id === 'ethereum'
        ? (params.quote.request.tokenIn.symbol === 'ETH' ? params.quote.request.tokenIn.priceUSD || 2500 : 2500)
        : 1;
      const gasCostEth = Number(gasUsedWei * gasPriceWei) / 1e18;
      gasPaidUSD = Number((gasCostEth * nativePrice).toFixed(4));
    }

    const receipt: ReceiptView = {
      txHash,
      sourceChain,
      destinationChain: destChain,
      destChain,
      tokenIn: params.quote.request.tokenIn,
      tokenOut: params.quote.request.tokenOut,
      amountInFormatted: params.quote.amountInFormatted,
      amountOutFormatted: params.quote.amountOutFormatted,
      amountOutUSD,
      realizedPriceImpactPercent: params.quote.priceImpact.percentage,
      realizedSlippagePercent: 0.0,
      gasPaidUSD,
      protocolFeePaidUSD: params.quote.protocolFee.feeUSD,
      effectiveExecutionScore: params.quote.effectiveExecutionScore,
      timestamp: Date.now(),
      status: 'COMPLETED',
      explorerUrl,
      routeSummary: isCrossChain
        ? `Cross-chain via ${params.quote.bestRoute.crossChainQuote?.providerName || 'Across V3'}`
        : `Swapped via ${params.quote.bestRoute.hops.map((h) => h.dexProtocol).join(' + ')}`,
      bridgeDetails: isCrossChain
        ? {
            bridgeName: params.quote.bestRoute.crossChainQuote?.providerName || 'Across Protocol',
            sourceTxHash: txHash,
            destTxHash: destinationTxHash,
            elapsedSec: params.quote.bestRoute.crossChainQuote?.estimatedTransferTimeSec || 30,
            sourceExplorerUrl: explorerUrl,
            destExplorerUrl,
            destinationVerified: Boolean(destinationTxHash)
          }
        : undefined
    };

    stateMachine.setReceipt(receipt);
    stateMachine.transitionTo('COMPLETED', { id: 'step-execute', status: 'SUCCESS', txHash });
    return receipt;
  }
}

export const defaultExecutionCoordinator = new ExecutionCoordinator();
