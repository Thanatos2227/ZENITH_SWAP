import { JsonRpcProvider, Contract, Interface, Network } from 'ethers';
import { SimulationRequest, SimulationResult, Token, TokenBalanceDelta } from '@zenith/types';
import { defaultChainRegistry } from '@zenith/chains';

const ERC20_SIM_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

export class SimulationEngine {
  public async simulateSwap(params: {
    chainId: string;
    userAddress: string;
    routerAddress?: string;
    tokenIn: Token;
    tokenOut: Token;
    amountInRaw: string;
    amountOutExpectedRaw: string;
    slippageTolerancePercent: number;
    currentAllowanceRaw?: string;
    calldata?: string;
    valueWei?: string;
  }): Promise<SimulationResult> {
    const warnings: string[] = [];
    const balanceDeltas: TokenBalanceDelta[] = [];

    let approvalRequired = false;
    let approvalAmountRaw: string | undefined;

    const chain = defaultChainRegistry.getChain(params.chainId);
    const tokenInDecimals = params.tokenIn.decimals || 18;
    const tokenOutDecimals = params.tokenOut.decimals || 18;

    const amountInBig = BigInt(params.amountInRaw || '0');
    const amountOutBig = BigInt(params.amountOutExpectedRaw || '0');

    const amountInNum = Number(amountInBig) / 10 ** tokenInDecimals;
    const amountOutNum = Number(amountOutBig) / 10 ** tokenOutDecimals;

    if (chain && chain.executionEnvironment === 'EVM' && params.userAddress && params.routerAddress) {
      try {
        const rpcUrl = defaultChainRegistry.getHealthyRPC(chain.id);
        const chainNumeric = Number(chain.chainId || 1);
        const network = Network.from(chainNumeric);
        const provider = new JsonRpcProvider(rpcUrl, network, { staticNetwork: network });

        if (!params.tokenIn.isNative) {
          const tokenContract = new Contract(params.tokenIn.address, ERC20_SIM_ABI, provider);
          const [balance, allowance] = await Promise.all([
            tokenContract.balanceOf(params.userAddress).catch(() => null),
            tokenContract.allowance(params.userAddress, params.routerAddress).catch(() => null)
          ]);

          if (balance !== null && balance < amountInBig) {
            warnings.push(
              `Insufficient ${params.tokenIn.symbol} balance: required ${amountInNum.toLocaleString()}, available ${(Number(balance) / 10 ** tokenInDecimals).toLocaleString()}`
            );
          }

          const currentAllowance = allowance !== null ? allowance : BigInt(params.currentAllowanceRaw || '0');
          if (currentAllowance < amountInBig) {
            approvalRequired = true;
            approvalAmountRaw = params.amountInRaw;
            warnings.push(`Token approval required for ${params.tokenIn.symbol} to spender ${params.routerAddress}`);
          }
        }

        if (params.calldata && params.routerAddress) {
          try {
            await provider.call({
              from: params.userAddress,
              to: params.routerAddress,
              data: params.calldata,
              value: params.valueWei ? BigInt(params.valueWei) : 0n
            });
          } catch (callErr: any) {
            const revertReason = this.decodeRevertReason(callErr);
            if (revertReason) {
              return {
                isSuccess: false,
                gasUsed: 0,
                revertReason,
                balanceDeltas: [],
                approvalRequired,
                approvalTokenAddress: approvalRequired ? params.tokenIn.address : undefined,
                approvalSpenderAddress: approvalRequired ? params.routerAddress : undefined,
                approvalAmountRaw,
                warnings: [...warnings, `Simulation reverted: ${revertReason}`],
                simulationSource: 'NODE_ETH_CALL'
              };
            }
          }
        }
      } catch (err: any) {

        console.warn('[SimulationEngine] RPC dry run query note:', err?.message || err);
      }
    }

    balanceDeltas.push({
      token: params.tokenIn,
      deltaRaw: `-${params.amountInRaw}`,
      deltaFormatted: `-${amountInNum.toLocaleString(undefined, { maximumFractionDigits: 6 })}`,
      deltaUSD: params.tokenIn.priceUSD ? -(amountInNum * params.tokenIn.priceUSD) : undefined,
      isIncoming: false
    });

    balanceDeltas.push({
      token: params.tokenOut,
      deltaRaw: `+${params.amountOutExpectedRaw}`,
      deltaFormatted: `+${amountOutNum.toLocaleString(undefined, { maximumFractionDigits: 6 })}`,
      deltaUSD: params.tokenOut.priceUSD ? amountOutNum * params.tokenOut.priceUSD : undefined,
      isIncoming: true
    });

    if (params.slippageTolerancePercent < 0.05) {
      warnings.push('Extremely low slippage (<0.05%). High likelihood of transaction revert during execution.');
    }

    if (params.slippageTolerancePercent > 5.0) {
      warnings.push('High slippage setting (>5.0%). Susceptible to sandwich/MEV attacks.');
    }

    const estimatedGasUsed = params.tokenIn.isNative ? 145000 : 185000;

    return {
      isSuccess: true,
      gasUsed: estimatedGasUsed,
      balanceDeltas,
      approvalRequired,
      approvalTokenAddress: approvalRequired ? params.tokenIn.address : undefined,
      approvalSpenderAddress: approvalRequired ? params.routerAddress : undefined,
      approvalAmountRaw,
      warnings,
      simulationSource: 'NODE_ETH_CALL'
    };
  }

  public async simulateCustomCall(request: SimulationRequest): Promise<SimulationResult> {
    const chain = defaultChainRegistry.getChain(request.chainId);
    if (!chain) {
      return {
        isSuccess: false,
        gasUsed: 0,
        revertReason: `Chain ${request.chainId} not found in registry`,
        balanceDeltas: [],
        approvalRequired: false,
        warnings: ['Invalid chain'],
        simulationSource: 'NODE_ETH_CALL'
      };
    }

    try {
      const rpcUrl = defaultChainRegistry.getHealthyRPC(chain.id);
      const chainNumeric = Number(chain.chainId || 1);
      const network = Network.from(chainNumeric);
      const provider = new JsonRpcProvider(rpcUrl, network, { staticNetwork: network });

      await provider.call({
        from: request.fromAddress,
        to: request.toAddress,
        data: request.calldata,
        value: BigInt(request.valueWei || '0')
      });

      return {
        isSuccess: true,
        gasUsed: 150000,
        balanceDeltas: [],
        approvalRequired: false,
        warnings: [],
        simulationSource: 'NODE_ETH_CALL'
      };
    } catch (err: any) {
      const revertReason = this.decodeRevertReason(err);
      return {
        isSuccess: false,
        gasUsed: 0,
        revertReason: revertReason || err.message || 'Call reverted',
        balanceDeltas: [],
        approvalRequired: false,
        warnings: [revertReason || 'Transaction simulation failed'],
        simulationSource: 'NODE_ETH_CALL'
      };
    }
  }

  private decodeRevertReason(err: any): string | undefined {
    if (!err) return undefined;
    if (err.reason) return err.reason;
    if (err.data && typeof err.data === 'string') {
      if (err.data.startsWith('0x08c379a0')) {
        try {
          const iface = new Interface(['function Error(string)']);
          const decoded = iface.decodeFunctionData('Error', err.data);
          return decoded[0];
        } catch {

        }
      }
      return `Execution reverted with data ${err.data.slice(0, 10)}...`;
    }
    if (err.message && (err.message.includes('execution reverted') || err.message.includes('revert:'))) {
      return err.message;
    }
    return undefined;
  }
}

export const defaultSimulationEngine = new SimulationEngine();
