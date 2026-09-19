import { Contract, JsonRpcSigner, BrowserProvider, JsonRpcProvider, Network, FetchRequest, formatUnits } from 'ethers';
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
import { defaultChainRegistry } from '@zenith/chains';

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
        let approveTx: any;
        try {
          approveTx = await tokenContract.approve(approvalTarget, requiredAllowance, {
            gasLimit: 100000n
          });
        } catch (approveErr: any) {
          console.error('[ZENITH EVMAdapter] Approval submission error:', approveErr);
          const rawApproveMsg = approveErr?.reason || approveErr?.message || String(approveErr);
          const isUserRejected =
            approveErr?.code === 4001 ||
            approveErr?.code === 'ACTION_REJECTED' ||
            rawApproveMsg.toLowerCase().includes('user rejected') ||
            rawApproveMsg.toLowerCase().includes('user denied');
          if (isUserRejected) {
            throw new Error('Token approval was rejected by user in wallet.');
          }
          throw new Error(`Token approval submission failed: ${rawApproveMsg}`);
        }

        console.log('[ZENITH EVMAdapter] Approval transaction broadcasted:', approveTx.hash);

        // Waiting for a receipt can fail because the RPC provider may not respond.
        // A provider timeout does not prove that the blockchain transaction failed.
        // Therefore, receipt verification should be attempted before declaring failure.
        // We use a bounded wait with candidate RPC fallback and double-check allowance on-chain.
        try {
          await this.waitForReceiptWithFallback({
            txHash: approveTx.hash,
            chainKey: quote.request.sourceChainId,
            primaryTx: approveTx,
            timeoutMs: 45000,
            pollIntervalMs: 2500
          });
        } catch (waitErr: any) {
          console.warn(`[ZENITH EVMAdapter] Approval receipt lookup note: ${waitErr?.message || waitErr}. Checking allowance directly on-chain...`);
          // Even if receipt lookup encountered a provider timeout, check on-chain allowance directly
          const fallbackAllowance = await this.checkAllowance({
            tokenAddress: validatedTokenIn,
            ownerAddress: validatedUser,
            spenderAddress: approvalTarget,
            signer,
            provider
          });
          if (fallbackAllowance < requiredAllowance) {
            throw waitErr;
          }
          console.log('[ZENITH EVMAdapter] Allowance verified directly despite receipt delay:', fallbackAllowance.toString());
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

    let tx: any;
    try {
      console.log('[ZENITH EVMAdapter] Calling signer.sendTransaction()... Waiting for wallet popup/approval...');
      tx = await signer.sendTransaction(submissionTx);
      console.log('[ZENITH EVMAdapter] Transaction broadcasted successfully! TxHash:', tx.hash);
    } catch (sendErr: any) {
      console.error('[ZENITH EVMAdapter] signer.sendTransaction error:', sendErr);

      // Do NOT blindly resend the transaction after an uncertain submission timeout.
      // A timeout at the wallet/injected RPC layer means the payload may have already been signed
      // and broadcast to the network's mempool even if the client did not receive a response.
      // Automatically resending would risk executing a duplicate swap and spending double funds.
      // If a transaction hash is available, verify whether the transaction exists on-chain via
      // fallback RPCs before continuing confirmation; if not found, return a clear submission error.
      const extractedHash =
        sendErr?.transactionHash ||
        sendErr?.hash ||
        sendErr?.receipt?.hash ||
        sendErr?.info?.error?.data?.txHash ||
        sendErr?.info?.txHash;

      const rawMsg = sendErr?.reason || sendErr?.message || String(sendErr);
      const isTimeout =
        sendErr?.code === 'TIMEOUT' ||
        rawMsg.toLowerCase().includes('timeout') ||
        rawMsg.toLowerCase().includes('timed out') ||
        rawMsg.toLowerCase().includes('etimedout');

      if (extractedHash && typeof extractedHash === 'string' && extractedHash.startsWith('0x') && extractedHash.length === 66) {
        console.warn(`[ZENITH EVMAdapter] sendTransaction returned an error, but contained valid txHash ${extractedHash}. Verifying existence via fallback RPCs...`);
        const exists = await this.verifyTransactionExists(extractedHash, quote.request.sourceChainId);
        if (exists) {
          console.log(`[ZENITH EVMAdapter] Transaction ${extractedHash} verified on network. Proceeding to receipt confirmation.`);
          tx = { hash: extractedHash };
        } else {
          throw new Error(
            `Transaction submission was uncertain (hash: ${extractedHash}) and could not be verified on network ${quote.request.sourceChainId}. Do NOT resubmit blindly; check your wallet activity and block explorer before retrying.`
          );
        }
      } else {
        if (isTimeout) {
          throw new Error(
            `Transaction submission timed out at wallet provider layer. The transaction may have already been broadcast to the mempool without a hash returned. Do NOT resubmit blindly; check your wallet activity and block explorer before retrying.`
          );
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
    }

    const txHash = tx.hash;
    console.log('[ZENITH EVMAdapter] Transaction broadcasted:', txHash);
    params.onStatusChange?.('SUBMITTING', txHash);
    params.onStatusChange?.('BROADCASTED', txHash);
    params.onStatusChange?.('CONFIRMING', txHash);

    // tx.wait() depends on the provider returning a receipt. If that provider
    // becomes unavailable after broadcast, the transaction may still be mined.
    // Use a bounded wait and independently verify the hash before reporting failure.
    // A transaction hash can remain valid even when the RPC used to submit
    // or monitor the transaction becomes unavailable. Receipt verification
    // therefore needs to be separated from the original RPC request.
    const receipt = await this.waitForReceiptWithFallback({
      txHash,
      chainKey: quote.request.sourceChainId,
      primaryTx: tx,
      timeoutMs: 60000,
      pollIntervalMs: 3000
    });

    if (isCrossChain) {
      params.onStatusChange?.('BRIDGE_IN_FLIGHT', txHash);
    } else {
      params.onStatusChange?.('COMPLETED', txHash);
    }

    return {
      isSuccess: true,
      txHash,
      blockNumber: receipt.blockNumber || 0,
      gasUsed: receipt.gasUsed || 0n,
      effectiveGasPriceWei: receipt.gasPrice || (receipt as any).effectiveGasPrice || 0n
    };
  }

  // Receipt lookup is intentionally separated from transaction submission.
  // This allows ZENITH to verify a transaction through another configured RPC
  // when the wallet's RPC is unavailable.
  // A transaction hash can remain valid even when the RPC used to submit
  // or monitor the transaction becomes unavailable. Receipt verification
  // therefore needs to be separated from the original RPC request.
  // Verify whether a transaction exists on-chain or in mempool across candidate RPCs.
  // This is used after an uncertain submission timeout to prevent duplicate submissions.
  private async verifyTransactionExists(txHash: string, chainKey: string): Promise<boolean> {
    const candidateUrls = defaultChainRegistry.getCandidateRPCs(chainKey);
    const chainConfig = defaultChainRegistry.getChain(chainKey);
    const chainNumeric = chainConfig?.chainId ? Number(chainConfig.chainId) : 1;
    const network = Network.from(chainNumeric);

    for (const url of candidateUrls) {
      let rpcTimer: ReturnType<typeof setTimeout> | null = null;
      let activeReq: FetchRequest | null = null;
      try {
        const fetchReq = new FetchRequest(url);
        fetchReq.timeout = 5000;
        fetchReq.preflightFunc = async function (req) {
          activeReq = this;
          return req;
        };
        const provider = new JsonRpcProvider(fetchReq, network, { staticNetwork: network });

        const checkPromise = (async () => {
          const [tx, receipt] = await Promise.all([
            provider.getTransaction(txHash).catch(() => null),
            provider.getTransactionReceipt(txHash).catch(() => null)
          ]);
          return Boolean(tx || receipt);
        })();

        const timeoutPromise = new Promise<boolean>((_, reject) => {
          rpcTimer = setTimeout(() => {
            // Abort underlying RPC request when the timeout is reached
            if (activeReq) {
              try { activeReq.cancel(); } catch {}
              activeReq = null;
            }
            reject(new Error('RPC verification timeout'));
          }, 5000);
        });

        const exists = await Promise.race([checkPromise, timeoutPromise]);
        if (rpcTimer) clearTimeout(rpcTimer);
        if (exists) return true;
      } catch {
        if (rpcTimer) clearTimeout(rpcTimer);
      }
    }
    return false;
  }

  // Receipt lookup is intentionally separated from transaction submission.
  // This allows ZENITH to verify a transaction through another configured RPC
  // when the wallet's RPC is unavailable.
  // A transaction hash can remain valid even when the RPC used to submit
  // or monitor the transaction becomes unavailable. Receipt verification
  // therefore needs to be separated from the original RPC request.
  public async waitForReceiptWithFallback(params: {
    txHash: string;
    chainKey: string;
    primaryTx?: any;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<any> {
    const { txHash, chainKey, primaryTx, timeoutMs = 60000, pollIntervalMs = 3000 } = params;
    const startTime = Date.now();

    console.log(`[ZENITH EVMAdapter] Waiting for confirmation`);

    // Step 1: Attempt fast bounded wait on primary provider if available (bounded to 15s)
    let primaryWaitTimer: ReturnType<typeof setTimeout> | null = null;
    let isPrimaryWaitCancelled = false;

    if (primaryTx && typeof primaryTx.wait === 'function') {
      try {
        const primaryWaitPromise = (async () => {
          // Pass 15000ms timeout directly to wait(confirms, timeout) so ethers' built-in
          // wait cancellation stops scanning and removes block listeners automatically.
          const res = await primaryTx.wait(1, 15000);
          if (isPrimaryWaitCancelled) return null;
          return res;
        })();

        const primaryTimeoutPromise = new Promise<never>((_, reject) => {
          primaryWaitTimer = setTimeout(() => {
            isPrimaryWaitCancelled = true;
            // Stop and cancel primary wait before starting fallback receipt verification
            // so the primary provider does not continue polling or keeping block listeners
            // open in parallel with the fallback RPC verification.
            try {
              if (primaryTx.provider && typeof primaryTx.provider.off === 'function') {
                primaryTx.provider.off(txHash);
              }
            } catch {
              // Ignore cleanup error on third-party provider
            }
            reject(new Error('PRIMARY_WAIT_TIMEOUT'));
          }, 15000);
        });

        const receipt = await Promise.race([primaryWaitPromise, primaryTimeoutPromise]);
        if (primaryWaitTimer) {
          clearTimeout(primaryWaitTimer);
          primaryWaitTimer = null;
        }

        if (receipt) {
          if (receipt.status === 0) {
            console.error(`[ZENITH EVMAdapter] Transaction reverted on-chain: ${txHash}`);
            throw new Error(`Transaction reverted on-chain: ${txHash}`);
          }
          console.log(`[ZENITH EVMAdapter] Receipt found`);
          console.log(`[ZENITH EVMAdapter] Transaction confirmed`);
          return receipt;
        }
      } catch (primaryErr: any) {
        if (primaryWaitTimer) {
          clearTimeout(primaryWaitTimer);
          primaryWaitTimer = null;
        }
        if (primaryErr?.message?.includes('reverted on-chain')) {
          throw primaryErr;
        }
        console.warn(`[ZENITH EVMAdapter] Primary receipt lookup timed out`);
      } finally {
        if (primaryWaitTimer) {
          clearTimeout(primaryWaitTimer);
          primaryWaitTimer = null;
        }
      }
    } else {
      console.log(`[ZENITH EVMAdapter] Primary receipt lookup timed out`);
    }

    console.log(`[ZENITH EVMAdapter] Checking fallback RPC`);

    // Step 2: Query receipt using fallback RPC endpoints from defaultChainRegistry
    const candidateUrls = defaultChainRegistry.getCandidateRPCs(chainKey);
    const chainConfig = defaultChainRegistry.getChain(chainKey);
    const chainNumeric = chainConfig?.chainId ? Number(chainConfig.chainId) : 1;
    const network = Network.from(chainNumeric);

    // Reuse JsonRpcProvider instances during the receipt-checking operation rather than
    // recreating them on every polling tick. Reusing providers avoids memory leaks,
    // preserves TCP connections, and maintains the configured RPC fallback hierarchy.
    interface ReusableRpcEntry {
      provider: JsonRpcProvider;
      fetchReq: FetchRequest;
      activeInflight: FetchRequest | null;
    }

    const providerCache = new Map<string, ReusableRpcEntry>();

    const getOrCreateProviderEntry = (url: string): ReusableRpcEntry => {
      let entry = providerCache.get(url);
      if (!entry) {
        const fetchReq = new FetchRequest(url);
        fetchReq.timeout = 6000;
        
        const newEntry: ReusableRpcEntry = {
          fetchReq,
          activeInflight: null,
          provider: null as any
        };

        fetchReq.preflightFunc = async function (req) {
          newEntry.activeInflight = this;
          return req;
        };

        newEntry.provider = new JsonRpcProvider(fetchReq, network, { staticNetwork: network });
        providerCache.set(url, newEntry);
        entry = newEntry;
      }
      return entry;
    };

    let lastRpcError: string | null = null;
    let sawPending = false;

    try {
      while (Date.now() - startTime < timeoutMs) {
        for (let i = 0; i < candidateUrls.length; i++) {
          const rpcUrl = candidateUrls[i];
          console.log(`[ZENITH RPC] Trying RPC ${i + 1} for ${chainConfig?.canonicalName || chainKey}`);
          const entry = getOrCreateProviderEntry(rpcUrl);
          let rpcTimer: ReturnType<typeof setTimeout> | null = null;

          try {
            const fetchReceiptPromise = entry.provider.getTransactionReceipt(txHash);
            const rpcTimeoutPromise = new Promise<never>((_, reject) => {
              rpcTimer = setTimeout(() => {
                // Abort the RPC request when the timeout is reached so the old request
                // does not continue running while another RPC request is started.
                if (entry.activeInflight) {
                  try {
                    entry.activeInflight.cancel();
                  } catch {
                    // Ignore if already concluded
                  }
                  entry.activeInflight = null;
                }
                reject(new Error('RPC request timeout'));
              }, 6000);
            });

            const receipt = await Promise.race([fetchReceiptPromise, rpcTimeoutPromise]);
            if (rpcTimer) {
              clearTimeout(rpcTimer);
              rpcTimer = null;
            }
            entry.activeInflight = null;

            if (receipt) {
              console.log(`[ZENITH RPC] Receipt found using RPC ${i + 1}`);
              if (receipt.status === 0) {
                console.error(`[ZENITH EVMAdapter] Transaction reverted on-chain: ${txHash}`);
                throw new Error(`Transaction reverted on-chain: ${txHash}`);
              }
              console.log(`[ZENITH EVMAdapter] Receipt found`);
              console.log(`[ZENITH EVMAdapter] Transaction confirmed`);
              return receipt;
            }

            // Receipt was null -> transaction not yet mined (still pending in mempool)
            sawPending = true;
            break;
          } catch (rpcErr: any) {
            if (rpcTimer) {
              clearTimeout(rpcTimer);
              rpcTimer = null;
            }
            entry.activeInflight = null;

            if (rpcErr?.message?.includes('reverted on-chain')) {
              throw rpcErr;
            }
            lastRpcError = rpcErr?.message || String(rpcErr);
            console.warn(`[ZENITH RPC] RPC ${i + 1} failed: ${lastRpcError}`);
            if (i + 1 < candidateUrls.length) {
              console.log(`[ZENITH RPC] Falling back to RPC ${i + 2}`);
            }
          } finally {
            if (rpcTimer) {
              clearTimeout(rpcTimer);
              rpcTimer = null;
            }
          }
        }

        const elapsed = Date.now() - startTime;
        if (elapsed < timeoutMs) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, timeoutMs - elapsed)));
        }
      }
    } finally {
      // Clean up any remaining inflight requests on all cached providers
      for (const entry of providerCache.values()) {
        if (entry.activeInflight) {
          try {
            entry.activeInflight.cancel();
          } catch {
            // Ignore
          }
          entry.activeInflight = null;
        }
      }
    }

    // Distinguish between genuine pending timeout and all RPCs being unavailable
    if (sawPending) {
      throw new Error(
        `Transaction confirmation timed out: Transaction is still pending on-chain with hash ${txHash}. It was not reverted; verify on block explorer.`
      );
    }

    if (lastRpcError) {
      throw new Error(
        `RPC provider unavailable: Unable to confirm transaction receipt for ${txHash} across configured RPC endpoints (${lastRpcError}). The transaction was broadcast and may be mined.`
      );
    }

    throw new Error(
      `Transaction confirmation timed out after ${Math.round(timeoutMs / 1000)} seconds for ${txHash}. Verify on block explorer before retrying.`
    );
  }
}

export const defaultEVMAdapter = new EVMExecutionAdapter();
