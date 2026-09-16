import { Contract, JsonRpcSigner, BrowserProvider, formatUnits } from 'ethers';
import { QuoteResponse, TransactionStatus, DEXExecution, CrossChainExecution } from '@zenith/types';
import {
  SignerRequiredError,
  CANONICAL_NATIVE_ADDRESS,
  validateEvmAddress,
  validateExecutionTarget,
  validateTokenAddress,
  InvalidCalldataError,
  ZenithSimulationFailedError,
  ZenithRouteExecutionMismatchError,
  ZenithApprovalTargetMismatchError
} from '@zenith/contracts';
import {
  defaultDEXAggregator,
  defaultCrossChainAggregator,
  isNativeToken
} from '@zenith/routing';

export interface EVMExecutionParams {
  quote: QuoteResponse;
  userAddress: string;
  signer?: JsonRpcSigner | null;
  provider?: BrowserProvider | null;
  onStatusChange?: (status: TransactionStatus, txHash?: string) => void;
}

export interface EVMExecutionResult {
  isSuccess: boolean;
  txHash: string;
  blockNumber: number;
  gasUsed: bigint;
  effectiveGasPriceWei: bigint;
  revertReason?: string;
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

    if (!isCrossChain && isNativeIn) {
      try {
        if (typeof signer.provider?.getBalance === 'function') {
          const nativeBalance = await signer.provider.getBalance(validatedUser);
          const requiredNative = BigInt(quote.amountInRaw);
          if (nativeBalance < requiredNative) {
            throw new Error(
              `Insufficient native ${tokenIn.symbol} balance: Wallet holds ${formatUnits(nativeBalance, 18)} ${tokenIn.symbol}, but swap requires ${quote.amountInFormatted} ${tokenIn.symbol}.`
            );
          }
        }
      } catch (nativeErr: any) {
        if (nativeErr.message?.includes('Insufficient')) throw nativeErr;
        console.warn('[ZENITH EVMAdapter] Native balance verification note:', nativeErr);
      }
    }

    if (!isNativeIn && approvalTarget !== CANONICAL_NATIVE_ADDRESS) {
      if (!isCrossChain && approvalTarget.toLowerCase() !== executionTo.toLowerCase()) {
        throw new ZenithApprovalTargetMismatchError(approvalTarget, executionTo);
      }

      const validatedTokenIn = validateTokenAddress(tokenIn.address, quote.request.sourceChainId);
      const tokenContract = new Contract(validatedTokenIn, ERC20_ABI, signer);

      try {
        if (typeof tokenContract.balanceOf === 'function') {
          const userBalance: bigint = await tokenContract.balanceOf(validatedUser);
          const requiredAmount = BigInt(quote.amountInRaw);
          if (userBalance < requiredAmount) {
            throw new Error(
              `Insufficient ${tokenIn.symbol} balance: Wallet has less than required ${quote.amountInFormatted} ${tokenIn.symbol}.`
            );
          }
        }
      } catch (balErr: any) {
        if (balErr.message?.includes('Insufficient')) throw balErr;
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

    // Apply documented 120% safety multiplier over measured estimateGas
    const finalGasLimit = (estimatedGas * 120n) / 100n;

    const submissionTx: any = {
      to: authoritativeTx.to,
      data: authoritativeTx.data,
      value: authoritativeTx.value,
      gasLimit: finalGasLimit
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

    const receipt = await tx.wait(1);
    if (!receipt || receipt.status === 0) {
      throw new Error(`Transaction reverted on-chain: ${txHash}`);
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
}

export const defaultEVMAdapter = new EVMExecutionAdapter();
