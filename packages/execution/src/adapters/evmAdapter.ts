import { Contract, JsonRpcSigner, BrowserProvider, formatUnits } from 'ethers';


import { QuoteResponse, TransactionStatus, DEXExecution, CrossChainExecution } from '@zenith/types';
import { defaultChainRegistry } from '@zenith/chains';
import {
  SignerRequiredError,
  CANONICAL_NATIVE_ADDRESS,
  validateEvmAddress,
  validateExecutionTarget,
  validateTokenAddress,
  InvalidCalldataError,
  ZenithSimulationFailedError,
  ZenithRouteExecutionMismatchError,
  ZenithApprovalTargetMismatchError,
  InvalidExecutionTargetError,
  InsufficientBalanceError,
  GasEstimationFailedError,
  FeeDataUnavailableError,
  ReceiptRevertedError,
  ConfirmationTimeoutError,
  GasLimitOverflowError,
  TransactionRejectedError,
  BroadcastUncertainError,
  getAcrossSpokePool,
  getStargateRouter,
  getDeBridgeSourceContract
} from '@zenith/contracts';
import {
  defaultDEXAggregator,
  defaultCrossChainAggregator,
  isNativeToken
} from '@zenith/routing';
import { defaultMultiProviderRpcClient } from '../providers/multiProviderRpcClient';


export interface EVMExecutionParams {
  quote: QuoteResponse;
  userAddress: string;
  signer?: JsonRpcSigner | null;
  provider?: BrowserProvider | null;
  onStatusChange?: (status: TransactionStatus, txHash?: string) => void;
  confirmations?: number;
  timeoutMs?: number;
  maxGasCeiling?: bigint;
}

export interface EVMExecutionResult {
  isSuccess: boolean;
  txHash: string;
  blockNumber: number;
  gasUsed: bigint;
  effectiveGasPriceWei: bigint;
  revertReason?: string;
}

export type FeeStrategyType = 'EIP1559' | 'LEGACY' | 'UNAVAILABLE';

export interface ResolvedFeeData {
  type: FeeStrategyType;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  gasPrice?: bigint;
}

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

export const KNOWN_REVERT_ERRORS: Record<string, string> = {
  '0x39d35496': 'V3_TOO_LITTLE_RECEIVED: Simulated output was less than amountOutMinimum (slippage limit exceeded)',
  '0x739dbe52': 'V3_TOO_MUCH_REQUESTED: Input amount exceeded maximum allowed',
  '0xc9f52c71': 'TOO_LITTLE_RECEIVED: Quoted amount received was below minimum threshold',
  '0xd4e0248e': 'V3_INVALID_AMOUNT_OUT: Output amount was invalid or zero',
  '0x316cf0eb': 'V3_INVALID_SWAP: Swap parameters or path invalid',
  '0x32b13d91': 'V3_INVALID_CALLER: Unauthorized callback sender'
};

export function decodeRevertReason(rawReason: string): string {
  if (!rawReason) return 'UNKNOWN_REVERT';
  for (const [selector, decoded] of Object.entries(KNOWN_REVERT_ERRORS)) {
    if (rawReason.toLowerCase().includes(selector.toLowerCase())) {
      return decoded;
    }
  }
  return rawReason;
}

export class EVMExecutionAdapter {
  public calculateSafeGasLimit(
    estimatedGas: bigint,
    _chainId?: string | number,
    customCeiling?: bigint
  ): bigint {
    if (estimatedGas <= 0n) {
      throw new GasEstimationFailedError(
        `Invalid estimated gas: ${estimatedGas.toString()}. Estimated gas must be strictly positive.`
      );
    }

    const maxCeiling = customCeiling || 30_000_000n;
    // safeGasLimit = ceil(estimatedGas * 1.20)
    const safeGasLimit = ((estimatedGas * 120n) + 99n) / 100n;

    if (safeGasLimit > maxCeiling) {
      throw new GasLimitOverflowError(
        safeGasLimit.toString(),
        maxCeiling.toString()
      );
    }

    return safeGasLimit;
  }

  public async resolveFeeStrategy(
    runner: any,
    chainId: string | number
  ): Promise<ResolvedFeeData> {
    const chain = defaultChainRegistry.getChain(chainId);
    const supportsEIP1559 = chain?.capabilities?.supportsEIP1559 ?? true;

    if (!runner) {
      throw new FeeDataUnavailableError(chainId, 'No provider available to query dynamic fee data.');
    }

    try {
      let feeData: any;
      if (typeof runner.getFeeData === 'function') {
        feeData = await runner.getFeeData();
      } else if (typeof runner.provider?.getFeeData === 'function') {
        feeData = await runner.provider.getFeeData();
      }

      if (supportsEIP1559 && feeData && (feeData.maxFeePerGas != null || feeData.maxPriorityFeePerGas != null)) {
        return {
          type: 'EIP1559',
          maxFeePerGas: feeData.maxFeePerGas != null ? BigInt(feeData.maxFeePerGas.toString()) : undefined,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas != null ? BigInt(feeData.maxPriorityFeePerGas.toString()) : undefined
        };
      }

      if (feeData && feeData.gasPrice != null) {
        return {
          type: 'LEGACY',
          gasPrice: BigInt(feeData.gasPrice.toString())
        };
      }
    } catch (err: any) {
      console.warn(`[ZENITH EVMAdapter] Fee resolution note on chain ${chainId}:`, err?.message || err);
    }

    try {
      const multiFee = await defaultMultiProviderRpcClient.getFeeData(chainId);
      if (supportsEIP1559 && (multiFee.maxFeePerGas != null || multiFee.maxPriorityFeePerGas != null)) {
        return {
          type: 'EIP1559',
          maxFeePerGas: multiFee.maxFeePerGas,
          maxPriorityFeePerGas: multiFee.maxPriorityFeePerGas
        };
      }
      if (multiFee.gasPrice != null) {
        return {
          type: 'LEGACY',
          gasPrice: multiFee.gasPrice
        };
      }
    } catch {}

    return { type: 'UNAVAILABLE' };
  }


  public async checkAllowance(params: {
    tokenAddress: string;
    ownerAddress: string;
    spenderAddress: string;
    signer?: JsonRpcSigner | null;
    provider?: BrowserProvider | null;
  }): Promise<bigint> {
    if (isNativeToken(params.tokenAddress)) {
      return BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    }

    const runner = params.signer || params.provider;
    if (runner) {
      try {
        const tokenContract = new Contract(params.tokenAddress, ERC20_ABI, runner);
        return await tokenContract.allowance(params.ownerAddress, params.spenderAddress);
      } catch (err) {
        console.warn('[ZENITH EVMAdapter] checkAllowance error:', err);
      }
    }

    return 0n;
  }

  public async verifyTransactionReceipt(
    provider: any,
    txHash: string,
    options?: {
      confirmations?: number;
      timeoutMs?: number;
      pollIntervalMs?: number;
      chainId?: string | number;
    }
  ): Promise<{
    isSuccess: boolean;
    txHash: string;
    blockNumber: number;
    gasUsed: bigint;
    effectiveGasPriceWei: bigint;
    receipt: any;
  }> {
    if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      throw new Error(`Invalid transaction hash for receipt verification: "${txHash}".`);
    }

    const timeoutMs = options?.timeoutMs || 60000;
    const pollIntervalMs = options?.pollIntervalMs || 1000;
    const confirmations = options?.confirmations || 1;
    const startTime = Date.now();

    let receipt: any = null;

    while (Date.now() - startTime < timeoutMs) {
      try {
        if (typeof provider.getTransactionReceipt === 'function') {
          receipt = await provider.getTransactionReceipt(txHash);
        } else if (typeof provider.provider?.getTransactionReceipt === 'function') {
          receipt = await provider.provider.getTransactionReceipt(txHash);
        }
      } catch (rpcErr: any) {
        console.warn(`[ZENITH EVMAdapter] Receipt fetch error for ${txHash}:`, rpcErr?.message || rpcErr);
      }

      if (receipt) {
        if (receipt.status === 0) {
          throw new ReceiptRevertedError(txHash, receipt.blockNumber);
        }
        if (receipt.status === 1) {
          if (confirmations > 1) {
            try {
              let currentBlock: number | undefined;
              if (typeof provider.getBlockNumber === 'function') {
                currentBlock = await provider.getBlockNumber();
              } else if (typeof provider.provider?.getBlockNumber === 'function') {
                currentBlock = await provider.provider.getBlockNumber();
              }
              if (currentBlock !== undefined && currentBlock - receipt.blockNumber + 1 < confirmations) {
                await new Promise((r) => setTimeout(r, pollIntervalMs));
                continue;
              }
            } catch {
              // ignore
            }
          }

          return {
            isSuccess: true,
            txHash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed ? BigInt(receipt.gasUsed.toString()) : 0n,
            effectiveGasPriceWei:
              receipt.gasPrice || receipt.effectiveGasPrice
                ? BigInt((receipt.gasPrice || receipt.effectiveGasPrice).toString())
                : 0n,
            receipt
          };
        }
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new ConfirmationTimeoutError(txHash, timeoutMs);
  }

  public async executeSwap(params: EVMExecutionParams): Promise<EVMExecutionResult> {
    const { quote, userAddress, signer, provider } = params;

    if (!signer) {
      throw new SignerRequiredError('Wallet signer is required to sign and broadcast transaction on-chain.');
    }

    const validatedUser = validateEvmAddress(userAddress, 'User Address');
    const isCrossChain = quote.request.sourceChainId !== quote.request.destinationChainId;
    const tokenIn = quote.request.tokenIn;
    const isNativeIn = Boolean(tokenIn.isNative || isNativeToken(tokenIn.address));

    // 1. Slippage validation
    const quotedOut = BigInt(quote.amountOutRaw || '0');
    const minOut = BigInt(quote.minimumReceivedRaw || '0');
    if (minOut < 0n || (quotedOut > 0n && minOut > quotedOut)) {
      throw new Error(`Slippage bounds invalid: minimumAmountOut (${minOut}) must be >= 0 and <= quotedAmountOut (${quotedOut})`);
    }

    let executionTo: string;
    let executionData: string;
    let executionValue: bigint;
    let approvalTarget: string;
    let requiredAllowance: bigint;

    if (isCrossChain) {
      const ccQuote = quote.crossChainQuote || quote.bestRoute.crossChainQuote;
      if (!ccQuote) {
        throw new Error('Cross-chain quote data is missing from QuoteResponse');
      }

      let ccExecution: CrossChainExecution | undefined = quote.bestRoute.execution as CrossChainExecution | undefined;
      if (!ccExecution || !ccExecution.data || ccExecution.data === '0x') {
        const providerAdapter = defaultCrossChainAggregator.getProvider(ccQuote.provider);
        if (!providerAdapter) {
          throw new Error(`Bridge provider ${ccQuote.provider} not found`);
        }
        ccExecution = await providerAdapter.buildExecution(ccQuote, validatedUser, quote.request.recipientAddress);
      }

      if (!ccExecution || !ccExecution.data || ccExecution.data === '0x') {
        throw new InvalidCalldataError('Failed to generate executable calldata for cross-chain transaction');
      }

      executionTo = validateExecutionTarget(ccExecution.to, quote.request.sourceChainId);
      executionData = ccExecution.data;
      executionValue = BigInt(ccExecution.value || '0');
      approvalTarget = validateExecutionTarget(ccExecution.approvalTarget || ccExecution.to, quote.request.sourceChainId);
      requiredAllowance = BigInt(ccExecution.requiredAllowanceRaw || quote.amountInRaw);

      // Verify execution target against known canonical bridge contracts
      const srcChain = defaultChainRegistry.getChain(quote.request.sourceChainId);
      if (srcChain?.chainId) {
        if (ccQuote.provider === 'ACROSS') {
          const expectedTarget = getAcrossSpokePool(srcChain.chainId);
          if (executionTo.toLowerCase() !== expectedTarget.toLowerCase()) {
            throw new InvalidExecutionTargetError(executionTo, quote.request.sourceChainId, `Expected Across SpokePool ${expectedTarget}`);
          }
        } else if (ccQuote.provider === 'STARGATE') {
          const expectedTarget = getStargateRouter(srcChain.chainId);
          if (executionTo.toLowerCase() !== expectedTarget.toLowerCase()) {
            throw new InvalidExecutionTargetError(executionTo, quote.request.sourceChainId, `Expected Stargate Router ${expectedTarget}`);
          }
        } else if (ccQuote.provider === 'DEBRIDGE_DLN') {
          const expectedTarget = getDeBridgeSourceContract(srcChain.chainId);
          if (executionTo.toLowerCase() !== expectedTarget.toLowerCase()) {
            throw new InvalidExecutionTargetError(executionTo, quote.request.sourceChainId, `Expected deBridge DLN Source ${expectedTarget}`);
          }
        }
      }
    } else {
      const dexQuote = quote.dexQuote || quote.bestRoute.dexQuote;
      let dexExecution: DEXExecution | undefined = quote.bestRoute.execution as DEXExecution | undefined;

      if (!dexExecution || !dexExecution.data || dexExecution.data === '0x') {
        if (dexQuote) {
          dexExecution = await defaultDEXAggregator.buildExecution(
            dexQuote,
            validatedUser,
            quote.request.recipientAddress
          );
        }
      }

      if (!dexExecution || !dexExecution.data || dexExecution.data === '0x') {
        throw new InvalidCalldataError('Failed to generate executable calldata for DEX swap');
      }

      executionTo = validateExecutionTarget(dexExecution.to, quote.request.sourceChainId);
      executionData = dexExecution.data;
      executionValue = BigInt(dexExecution.value || '0');
      approvalTarget = validateExecutionTarget(dexExecution.approvalTarget || dexExecution.to, quote.request.sourceChainId);
      requiredAllowance = BigInt(dexExecution.approvalAmount || dexExecution.requiredAllowanceRaw || quote.amountInRaw);
    }

    // 2. Route/Execution Consistency check
    if (quote.executionTarget && executionTo.toLowerCase() !== quote.executionTarget.toLowerCase()) {
      throw new ZenithRouteExecutionMismatchError(quote.executionTarget, executionTo);
    }

    if (isNativeIn) {
      try {
        if (typeof signer.provider?.getBalance === 'function') {
          const nativeBalance = await signer.provider.getBalance(validatedUser);
          const requiredNative = BigInt(quote.amountInRaw);
          if (nativeBalance < requiredNative) {
            throw new InsufficientBalanceError(
              tokenIn.symbol,
              quote.amountInFormatted,
              formatUnits(nativeBalance, tokenIn.decimals || 18)
            );
          }
        }
      } catch (nativeErr: any) {
        if (nativeErr instanceof InsufficientBalanceError || nativeErr.message?.includes('Insufficient balance')) throw nativeErr;
        console.warn('[ZENITH EVMAdapter] Native balance verification note:', nativeErr);
      }
    }

    if (!isNativeIn && approvalTarget !== CANONICAL_NATIVE_ADDRESS) {
      if (!isCrossChain && approvalTarget.toLowerCase() !== executionTo.toLowerCase()) {
        throw new ZenithApprovalTargetMismatchError(approvalTarget, executionTo);
      }

      const validatedTokenIn = validateTokenAddress(tokenIn.address, quote.request.sourceChainId, tokenIn.isNative);
      const tokenContract = new Contract(validatedTokenIn, ERC20_ABI, signer);

      try {
        if (typeof tokenContract.balanceOf === 'function') {
          const userBalance: bigint = await tokenContract.balanceOf(validatedUser);
          const requiredAmount = BigInt(quote.amountInRaw);
          if (userBalance < requiredAmount) {
            throw new InsufficientBalanceError(
              tokenIn.symbol,
              quote.amountInFormatted,
              formatUnits(userBalance, tokenIn.decimals || 18)
            );
          }
        }
      } catch (balErr: any) {
        if (balErr instanceof InsufficientBalanceError || balErr.message?.includes('Insufficient balance')) throw balErr;
        console.warn('[ZENITH EVMAdapter] Pre-flight balance check warning:', balErr);
      }

      const currentAllowance = await this.checkAllowance({
        tokenAddress: validatedTokenIn,
        ownerAddress: validatedUser,
        spenderAddress: approvalTarget,
        signer,
        provider
      });

      if (currentAllowance < requiredAllowance) {
        console.log(`[ZENITH EVMAdapter] Insufficient allowance (${currentAllowance.toString()} < ${requiredAllowance.toString()}). Requesting wallet approval...`);
        params.onStatusChange?.('APPROVING');
        const approveTx = await tokenContract.approve(approvalTarget, requiredAllowance, {
          gasLimit: 100000n
        });
        console.log('[ZENITH EVMAdapter] Approval transaction broadcasted:', approveTx.hash);
        if (typeof approveTx?.wait === 'function') {
          const approveReceipt = await approveTx.wait(1);
          if (!approveReceipt || approveReceipt.status === 0) {
            throw new Error(`Token approval transaction reverted on-chain: ${approveTx.hash}`);
          }
        }

        const verifiedAllowance = await this.checkAllowance({
          tokenAddress: validatedTokenIn,
          ownerAddress: validatedUser,
          spenderAddress: approvalTarget,
          signer,
          provider
        });

        if (verifiedAllowance < requiredAllowance) {
          throw new Error(
            `Token approval confirmation did not update allowance sufficiently (${verifiedAllowance.toString()} < ${requiredAllowance.toString()}).`
          );
        }
        console.log('[ZENITH EVMAdapter] Token allowance successfully verified on-chain:', verifiedAllowance.toString());
        params.onStatusChange?.('APPROVED');
      }
    }

    // 3. Construct Authoritative Transaction Object
    const authoritativeTx = {
      from: validatedUser,
      to: executionTo,
      data: executionData,
      value: executionValue
    };

    const diagTrace = {
      chainId: quote.request.sourceChainId,
      from: authoritativeTx.from,
      to: authoritativeTx.to,
      value: authoritativeTx.value.toString(),
      tokenIn: `${tokenIn.symbol} (${tokenIn.address})`,
      tokenOut: `${quote.request.tokenOut.symbol} (${quote.request.tokenOut.address})`,
      amountIn: quote.amountInRaw,
      amountOut: quote.amountOutRaw,
      amountOutMinimum: quote.minimumReceivedRaw,
      router: executionTo,
      calldata: authoritativeTx.data
    };

    params.onStatusChange?.('SIMULATING');

    // 4. Pre-Flight Simulation Step 1: eth_call
    const rpcRunner = signer.provider || provider;
    if (rpcRunner && typeof rpcRunner.call === 'function') {
      try {
        await rpcRunner.call({
          from: authoritativeTx.from,
          to: authoritativeTx.to,
          data: authoritativeTx.data,
          value: authoritativeTx.value
        });
      } catch (callErr: any) {
        const rawReason = callErr?.data || callErr?.reason || callErr?.message || String(callErr);
        const revertReason = decodeRevertReason(rawReason);
        console.error('[ZENITH EVMAdapter] Pre-flight eth_call reverted:', {
          ...diagTrace,
          revertReason
        });
        throw new ZenithSimulationFailedError(
          `On-chain simulation (eth_call) reverted. Target rejected execution. (${revertReason})`,
          revertReason
        );
      }
    }

    // 5. Pre-Flight Simulation Step 2: eth_estimateGas
    let estimatedGas: bigint;
    try {
      if (typeof signer.estimateGas === 'function') {
        estimatedGas = await signer.estimateGas({
          from: authoritativeTx.from,
          to: authoritativeTx.to,
          data: authoritativeTx.data,
          value: authoritativeTx.value
        });
      } else if (rpcRunner && typeof rpcRunner.estimateGas === 'function') {
        estimatedGas = await rpcRunner.estimateGas({
          from: authoritativeTx.from,
          to: authoritativeTx.to,
          data: authoritativeTx.data,
          value: authoritativeTx.value
        });
      } else {
        estimatedGas = 200000n;
      }
    } catch (gasErr: any) {
      const rawReason = gasErr?.data || gasErr?.reason || gasErr?.message || String(gasErr);
      const revertReason = decodeRevertReason(rawReason);
      console.error('[ZENITH EVMAdapter] Pre-flight estimateGas failed:', {
        ...diagTrace,
        revertReason
      });
      throw new ZenithSimulationFailedError(
        `Gas estimation (eth_estimateGas) failed. Transaction is predicted to revert on-chain. (${revertReason})`,
        revertReason
      );
    }

    // Apply safe gas limit calculation with 120% margin
    const finalGasLimit = this.calculateSafeGasLimit(
      estimatedGas,
      quote.request.sourceChainId,
      params.maxGasCeiling
    );

    // Dynamic fee resolution (EIP-1559 vs Legacy)
    let feeOverrides: Record<string, bigint> = {};
    if (rpcRunner) {
      const feeStrategy = await this.resolveFeeStrategy(rpcRunner, quote.request.sourceChainId);
      if (feeStrategy.type === 'EIP1559') {
        if (feeStrategy.maxFeePerGas != null) feeOverrides.maxFeePerGas = feeStrategy.maxFeePerGas;
        if (feeStrategy.maxPriorityFeePerGas != null) feeOverrides.maxPriorityFeePerGas = feeStrategy.maxPriorityFeePerGas;
      } else if (feeStrategy.type === 'LEGACY' && feeStrategy.gasPrice != null) {
        feeOverrides.gasPrice = feeStrategy.gasPrice;
      }
    }

    const submissionTx: any = {
      to: authoritativeTx.to,
      data: authoritativeTx.data,
      value: authoritativeTx.value,
      gasLimit: finalGasLimit,
      ...feeOverrides
    };

    if (
      submissionTx.to.toLowerCase() !== authoritativeTx.to.toLowerCase() ||
      submissionTx.data !== authoritativeTx.data ||
      submissionTx.value !== authoritativeTx.value
    ) {
      throw new Error('Transaction inconsistency detected between simulation payload and submission payload');
    }

    console.log('[ZENITH EVMAdapter] Preparing transaction dispatch:', {
      to: executionTo,
      value: executionValue.toString(),
      gasLimit: finalGasLimit.toString(),
      dataLength: executionData.length,
      user: validatedUser,
      isCrossChain,
      isNativeIn
    });

    params.onStatusChange?.('SIGNING');

    let tx;
    try {
      console.log('[ZENITH EVMAdapter] Calling signer.sendTransaction()... Waiting for wallet popup/approval...');
      tx = await signer.sendTransaction(submissionTx);
      console.log('[ZENITH EVMAdapter] Transaction broadcasted successfully! TxHash:', tx.hash);
    } catch (sendErr: any) {
      console.error('[ZENITH EVMAdapter] signer.sendTransaction error:', sendErr);
      const rawMsg = sendErr?.reason || sendErr?.message || String(sendErr);

      if (sendErr?.code === 'ACTION_REJECTED' || sendErr?.code === 4001 || rawMsg.includes('user rejected') || rawMsg.includes('User rejected')) {
        throw new TransactionRejectedError('Transaction rejected by user in connected wallet.');
      }

      if (
        rawMsg.includes('STF') ||
        sendErr?.revert?.args?.[0] === 'STF' ||
        sendErr?.data?.includes('535446')
      ) {
        throw new Error(
          `SafeTransferFrom failed (STF): Insufficient ${tokenIn.symbol} balance or token allowance in your connected wallet.`
        );
      }
      if (
        rawMsg.includes('Too little received') ||
        rawMsg.includes('TOO_LITTLE_RECEIVED') ||
        rawMsg.includes('Slippage limit exceeded') ||
        sendErr?.revert?.args?.[0] === 'Too little received'
      ) {
        throw new Error(
          `Slippage Limit Exceeded (Too little received): On-chain pool output was below your minimum requested pay to user of ${quote.minimumReceivedFormatted} ${quote.request.tokenOut.symbol}. Please increase your slippage tolerance (e.g. 1.0% or 2.0%) or refresh the quote.`
        );
      }
      if (
        rawMsg.includes('require(false)') ||
        rawMsg.includes('execution reverted') ||
        rawMsg.includes('CALL_EXCEPTION')
      ) {
        throw new Error(
          `On-Chain Execution Reverted (require(false)): The smart contract rejected this swap on ${quote.request.sourceChainId}. Possible reasons: 1) Insufficient pool liquidity, 2) Token transfer fee/tax mismatch, 3) Token approval missing, or 4) Slippage exceeded. Try increasing slippage tolerance or choosing a smaller amount.`
        );
      }
      throw sendErr;
    }

    const txHash = tx.hash;
    params.onStatusChange?.('SUBMITTING', txHash);
    params.onStatusChange?.('BROADCASTED', txHash);
    params.onStatusChange?.('CONFIRMING', txHash);

    const receipt = await tx.wait(params.confirmations || 1);
    if (!receipt || receipt.status === 0) {
      throw new ReceiptRevertedError(txHash, receipt?.blockNumber);
    }

    if (isCrossChain) {
      params.onStatusChange?.('BRIDGE_IN_FLIGHT', txHash);
    } else {
      params.onStatusChange?.('COMPLETED', txHash);
    }

    return {
      isSuccess: true,
      txHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed || 0n,
      effectiveGasPriceWei: receipt.gasPrice || (receipt as any).effectiveGasPrice || 0n
    };
  }

  public async getBalance(params: {
    tokenAddress: string;
    accountAddress: string;
    isNative?: boolean;
    runner: any;
  }): Promise<bigint> {
    const { tokenAddress, accountAddress, isNative, runner } = params;
    if (isNative || isNativeToken(tokenAddress)) {
      if (typeof runner.getBalance === 'function') {
        return await runner.getBalance(accountAddress);
      }
      if (typeof runner.provider?.getBalance === 'function') {
        return await runner.provider.getBalance(accountAddress);
      }
      return 0n;
    }
    const tokenContract = new Contract(tokenAddress, ERC20_ABI, runner);
    if (typeof tokenContract.balanceOf === 'function') {
      return await tokenContract.balanceOf(accountAddress);
    }
    return 0n;
  }

  public async executeTransaction(params: {
    chainId: string;
    to: string;
    data: string;
    value?: string | bigint;
    approvalTarget?: string;
    tokenInAddress?: string;
    tokenInSymbol?: string;
    tokenInDecimals?: number;
    amountInRaw?: string;
    userAddress: string;
    signer: JsonRpcSigner;
    provider?: BrowserProvider | null;
    confirmations?: number;
    maxGasCeiling?: bigint;
    onStatusChange?: (status: TransactionStatus, txHash?: string) => void;
  }): Promise<EVMExecutionResult & { receipt?: any }> {
    const {
      chainId,
      to,
      data,
      value = '0',
      approvalTarget,
      tokenInAddress,
      tokenInSymbol = 'TOKEN',
      tokenInDecimals = 18,
      amountInRaw,
      userAddress,
      signer,
      provider,
      confirmations = 1,
      maxGasCeiling,
      onStatusChange
    } = params;

    if (!signer) {
      throw new SignerRequiredError('Wallet signer is required to sign and broadcast transaction on-chain.');
    }

    const validatedUser = validateEvmAddress(userAddress, 'User Address');
    const executionTo = validateExecutionTarget(to, chainId);
    const executionData = data;
    const executionValue = BigInt(value.toString());

    if (!executionData || executionData === '0x') {
      throw new InvalidCalldataError('Cannot execute transaction with empty calldata (0x)');
    }

    const isNativeIn = tokenInAddress ? isNativeToken(tokenInAddress) : executionValue > 0n;

    // 1. Balance verification
    if (amountInRaw && BigInt(amountInRaw) > 0n) {
      const requiredAmount = BigInt(amountInRaw);
      const userBalance = await this.getBalance({
        tokenAddress: tokenInAddress || CANONICAL_NATIVE_ADDRESS,
        accountAddress: validatedUser,
        isNative: isNativeIn,
        runner: signer.provider || signer
      });

      if (userBalance < requiredAmount) {
        throw new InsufficientBalanceError(
          tokenInSymbol,
          formatUnits(requiredAmount, tokenInDecimals),
          formatUnits(userBalance, tokenInDecimals)
        );
      }
    }

    // 2. Allowance check & approval
    if (!isNativeIn && tokenInAddress && approvalTarget && approvalTarget !== CANONICAL_NATIVE_ADDRESS && amountInRaw) {
      const validatedTokenIn = validateTokenAddress(tokenInAddress, chainId);
      const validatedApprovalTarget = validateExecutionTarget(approvalTarget, chainId);
      const requiredAllowance = BigInt(amountInRaw);

      const currentAllowance = await this.checkAllowance({
        tokenAddress: validatedTokenIn,
        ownerAddress: validatedUser,
        spenderAddress: validatedApprovalTarget,
        signer,
        provider
      });

      if (currentAllowance < requiredAllowance) {
        onStatusChange?.('APPROVING');
        const tokenContract = new Contract(validatedTokenIn, ERC20_ABI, signer);
        const approveTx = await tokenContract.approve(validatedApprovalTarget, requiredAllowance, {
          gasLimit: 100000n
        });
        if (typeof approveTx?.wait === 'function') {
          const approveReceipt = await approveTx.wait(1);
          if (!approveReceipt || approveReceipt.status === 0) {
            throw new ReceiptRevertedError(approveTx.hash, approveReceipt?.blockNumber);
          }
        }
        onStatusChange?.('APPROVED');
      }
    }

    // 3. Pre-flight eth_call simulation
    const authoritativeTx = {
      from: validatedUser,
      to: executionTo,
      data: executionData,
      value: executionValue
    };

    const rpcRunner = signer.provider || provider;
    if (rpcRunner && typeof rpcRunner.call === 'function') {
      try {
        await rpcRunner.call(authoritativeTx);
      } catch (callErr: any) {
        const rawReason = callErr?.data || callErr?.reason || callErr?.message || String(callErr);
        const revertReason = decodeRevertReason(rawReason);
        throw new ZenithSimulationFailedError(
          `Pre-flight simulation (eth_call) reverted on ${chainId}. (${revertReason})`,
          revertReason
        );
      }
    }

    // 4. Pre-flight eth_estimateGas
    let estimatedGas: bigint;
    try {
      if (typeof signer.estimateGas === 'function') {
        estimatedGas = await signer.estimateGas(authoritativeTx);
      } else if (rpcRunner && typeof rpcRunner.estimateGas === 'function') {
        estimatedGas = await rpcRunner.estimateGas(authoritativeTx);
      } else {
        estimatedGas = 200000n;
      }
    } catch (gasErr: any) {
      const rawReason = gasErr?.data || gasErr?.reason || gasErr?.message || String(gasErr);
      const revertReason = decodeRevertReason(rawReason);
      throw new ZenithSimulationFailedError(
        `Gas estimation (eth_estimateGas) failed on ${chainId}. (${revertReason})`,
        revertReason
      );
    }

    const finalGasLimit = this.calculateSafeGasLimit(estimatedGas, chainId, maxGasCeiling);

    // Dynamic fee resolution
    let feeOverrides: Record<string, bigint> = {};
    if (rpcRunner) {
      const feeStrategy = await this.resolveFeeStrategy(rpcRunner, chainId);
      if (feeStrategy.type === 'EIP1559') {
        if (feeStrategy.maxFeePerGas != null) feeOverrides.maxFeePerGas = feeStrategy.maxFeePerGas;
        if (feeStrategy.maxPriorityFeePerGas != null) feeOverrides.maxPriorityFeePerGas = feeStrategy.maxPriorityFeePerGas;
      } else if (feeStrategy.type === 'LEGACY' && feeStrategy.gasPrice != null) {
        feeOverrides.gasPrice = feeStrategy.gasPrice;
      }
    }

    onStatusChange?.('SIGNING');

    let preparedNonce: number | undefined = undefined;
    try {
      if (typeof signer.getNonce === 'function') {
        preparedNonce = await signer.getNonce('pending');
      }
    } catch {
      // Nonce retrieval is best-effort
    }

    let tx: any;
    try {
      tx = await signer.sendTransaction({
        to: authoritativeTx.to,
        data: authoritativeTx.data,
        value: authoritativeTx.value,
        gasLimit: finalGasLimit,
        ...(preparedNonce !== undefined ? { nonce: preparedNonce } : {}),
        ...feeOverrides
      });
    } catch (sendErr: any) {
      const rawMsg = sendErr?.reason || sendErr?.message || String(sendErr);
      if (sendErr?.code === 'ACTION_REJECTED' || sendErr?.code === 4001 || rawMsg.toLowerCase().includes('user rejected') || rawMsg.toLowerCase().includes('user denied')) {
        throw new TransactionRejectedError('Transaction rejected by user in connected wallet.');
      }

      // Check for network timeout / RPC connection reset / dropped connection
      const isNetworkOrTimeout =
        sendErr?.code === 'NETWORK_ERROR' ||
        sendErr?.code === 'TIMEOUT' ||
        sendErr?.code === 'SERVER_ERROR' ||
        rawMsg.includes('timeout') ||
        rawMsg.includes('ETIMEDOUT') ||
        rawMsg.includes('ECONNRESET') ||
        rawMsg.includes('fetch failed') ||
        rawMsg.includes('network error') ||
        rawMsg.includes('Socket connection was closed');

      if (isNetworkOrTimeout) {
        throw new BroadcastUncertainError(
          `Transaction broadcast outcome is uncertain due to RPC/network interruption: ${rawMsg}`,
          {
            sender: validatedUser,
            nonce: preparedNonce,
            chainId
          }
        );
      }

      throw sendErr;
    }

    if (!tx || !tx.hash) {
      throw new BroadcastUncertainError(
        'sendTransaction succeeded but no transaction hash was returned by the provider.',
        {
          sender: validatedUser,
          nonce: preparedNonce,
          chainId
        }
      );
    }

    const txHash = tx.hash;
    onStatusChange?.('SUBMITTING', txHash);
    onStatusChange?.('BROADCASTED', txHash);
    onStatusChange?.('CONFIRMING', txHash);

    const receipt = await tx.wait(confirmations);
    if (!receipt || receipt.status === 0) {
      throw new ReceiptRevertedError(txHash, receipt?.blockNumber);
    }

    return {
      isSuccess: true,
      txHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed || 0n,
      effectiveGasPriceWei: receipt.gasPrice || (receipt as any).effectiveGasPrice || 0n,
      receipt
    };
  }

  public async discoverTransactionByNonce(params: {
    sender: string;
    nonce: number;
    provider: any;
    searchBlocks?: number;
  }): Promise<{ found: boolean; txHash?: string; isMined?: boolean; blockNumber?: number }> {
    const { sender, nonce, provider, searchBlocks = 20 } = params;
    if (!provider) return { found: false };

    try {
      let currentBlock: number | undefined;
      let latestNonce: number | undefined;

      if (typeof provider.getBlockNumber === 'function') {
        currentBlock = await provider.getBlockNumber();
      }
      if (typeof provider.getTransactionCount === 'function') {
        latestNonce = await provider.getTransactionCount(sender, 'latest');
      }

      // If sender's latest mined nonce is <= target nonce, the transaction might be pending in mempool or not mined yet
      if (currentBlock && latestNonce !== undefined && latestNonce > nonce) {
        // The nonce has already been mined in a block! Search recent blocks backwards
        const fromBlock = Math.max(0, currentBlock - searchBlocks);
        for (let b = currentBlock; b >= fromBlock; b--) {
          try {
            const block = typeof provider.getBlock === 'function' ? await provider.getBlock(b, true) : null;
            if (block && block.prefetchedTransactions) {
              for (const tx of block.prefetchedTransactions) {
                if (
                  tx.from &&
                  tx.from.toLowerCase() === sender.toLowerCase() &&
                  tx.nonce === nonce
                ) {
                  return { found: true, txHash: tx.hash, isMined: true, blockNumber: b };
                }
              }
            }
          } catch {
            // Block query error - continue search
          }
        }
      }
    } catch (err) {
      console.warn('[ZENITH EVMAdapter] discoverTransactionByNonce note:', err);
    }

    return { found: false };
  }
}

export const defaultEVMAdapter = new EVMExecutionAdapter();
