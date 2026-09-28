import {
  NetworkFamily,
  AuthoritativeNetworkIdentity,
  RpcProviderProfile
} from '@zenith/types';

export interface RpcHeadInfo {
  blockNumber: number;
  blockHash?: string;
  timestamp?: number;
}

export interface RpcBalanceInfo {
  address: string;
  balance: bigint;
  decimals: number;
  symbol: string;
}

export interface RpcSimulationResult {
  success: boolean;
  returnData?: string;
  gasUsed?: bigint;
  revertReason?: string;
  blockNumber?: number;
}

export interface RpcFeeEstimate {
  gasLimit?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  estimatedFeeNative: bigint;
}

export interface INetworkRpcAdapter {
  readonly family: NetworkFamily;
  readonly networkId: string;
  readonly provider: RpcProviderProfile;

  getNetworkIdentity(): Promise<string | number>;
  getLatestHead(): Promise<RpcHeadInfo>;
  getBalance(address: string): Promise<RpcBalanceInfo>;
  getCodeOrEquivalent(address: string): Promise<string>;
  simulateTransaction(tx: any): Promise<RpcSimulationResult>;
  estimateFee(tx: any): Promise<RpcFeeEstimate>;
  broadcastTransaction(rawTxHex: string): Promise<string>;
  getTransaction(txHash: string): Promise<any | null>;
  getReceiptOrEquivalent(txHash: string): Promise<any | null>;
}

export class UnsupportedRpcAdapter implements INetworkRpcAdapter {
  public readonly family: NetworkFamily;
  public readonly networkId: string;
  public readonly provider: RpcProviderProfile;

  constructor(networkId: string, family: NetworkFamily, provider: RpcProviderProfile) {
    this.networkId = networkId;
    this.family = family;
    this.provider = provider;
  }

  public async getNetworkIdentity(): Promise<string | number> {
    throw new Error(`UNSUPPORTED_RPC_OPERATION: getNetworkIdentity is not supported on family ${this.family} (network: ${this.networkId})`);
  }

  public async getLatestHead(): Promise<RpcHeadInfo> {
    throw new Error(`UNSUPPORTED_RPC_OPERATION: getLatestHead is not supported on family ${this.family} (network: ${this.networkId})`);
  }

  public async getBalance(_address: string): Promise<RpcBalanceInfo> {
    throw new Error(`UNSUPPORTED_RPC_OPERATION: getBalance is not supported on family ${this.family} (network: ${this.networkId})`);
  }

  public async getCodeOrEquivalent(_address: string): Promise<string> {
    throw new Error(`UNSUPPORTED_RPC_OPERATION: getCode is not supported on family ${this.family} (network: ${this.networkId})`);
  }

  public async simulateTransaction(_tx: any): Promise<RpcSimulationResult> {
    throw new Error(`UNSUPPORTED_RPC_OPERATION: simulateTransaction is not supported on family ${this.family} (network: ${this.networkId})`);
  }

  public async estimateFee(_tx: any): Promise<RpcFeeEstimate> {
    throw new Error(`UNSUPPORTED_RPC_OPERATION: estimateFee is not supported on family ${this.family} (network: ${this.networkId})`);
  }

  public async broadcastTransaction(_rawTxHex: string): Promise<string> {
    throw new Error(`UNSUPPORTED_RPC_OPERATION: broadcastTransaction is not supported on family ${this.family} (network: ${this.networkId})`);
  }

  public async getTransaction(_txHash: string): Promise<any | null> {
    throw new Error(`UNSUPPORTED_RPC_OPERATION: getTransaction is not supported on family ${this.family} (network: ${this.networkId})`);
  }

  public async getReceiptOrEquivalent(_txHash: string): Promise<any | null> {
    throw new Error(`UNSUPPORTED_RPC_OPERATION: getReceipt is not supported on family ${this.family} (network: ${this.networkId})`);
  }
}

export class EvmRpcAdapter implements INetworkRpcAdapter {
  public readonly family: NetworkFamily = 'EVM';
  public readonly networkId: string;
  public readonly provider: RpcProviderProfile;
  public readonly expectedNumericChainId: number;

  constructor(
    network: AuthoritativeNetworkIdentity,
    provider: RpcProviderProfile
  ) {
    if (network.family !== 'EVM') {
      throw new Error(`EvmRpcAdapter cannot be initialized for non-EVM family: ${network.family}`);
    }
    this.networkId = network.networkId;
    this.provider = provider;
    this.expectedNumericChainId = network.numericChainId || Number(network.chainId);
  }

  private async rpcCall<T>(method: string, params: any[] = []): Promise<T> {
    const res = await fetch(this.provider.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(this.provider.timeoutMs)
    });

    if (!res.ok) {
      throw new Error(`RPC transport HTTP ${res.status}: ${res.statusText}`);
    }

    const json = await res.json();
    if (json.error) {
      throw new Error(`RPC Error (${json.error.code}): ${json.error.message}`);
    }
    return json.result as T;
  }

  public async getNetworkIdentity(): Promise<number> {
    const hex = await this.rpcCall<string>('eth_chainId');
    const returnedId = parseInt(hex, 16);
    if (returnedId !== this.expectedNumericChainId) {
      throw new Error(`RPC_NETWORK_IDENTITY_MISMATCH: Provider ${this.provider.providerId} returned chainId ${returnedId}, expected ${this.expectedNumericChainId}`);
    }
    return returnedId;
  }

  public async getLatestHead(): Promise<RpcHeadInfo> {
    const block = await this.rpcCall<any>('eth_getBlockByNumber', ['latest', false]);
    return {
      blockNumber: parseInt(block.number, 16),
      blockHash: block.hash,
      timestamp: parseInt(block.timestamp, 16)
    };
  }

  public async getBalance(address: string): Promise<RpcBalanceInfo> {
    const hex = await this.rpcCall<string>('eth_getBalance', [address, 'latest']);
    return {
      address,
      balance: BigInt(hex),
      decimals: 18,
      symbol: 'ETH'
    };
  }

  public async getCodeOrEquivalent(address: string): Promise<string> {
    return this.rpcCall<string>('eth_getCode', [address, 'latest']);
  }

  public async simulateTransaction(tx: any): Promise<RpcSimulationResult> {
    try {
      const returnData = await this.rpcCall<string>('eth_call', [tx, 'latest']);
      return {
        success: true,
        returnData
      };
    } catch (err: any) {
      return {
        success: false,
        revertReason: err?.message || 'Reverted'
      };
    }
  }

  public async estimateFee(tx: any): Promise<RpcFeeEstimate> {
    const gasLimitHex = await this.rpcCall<string>('eth_estimateGas', [tx]);
    const gasPriceHex = await this.rpcCall<string>('eth_gasPrice');
    const gasLimit = BigInt(gasLimitHex);
    const gasPrice = BigInt(gasPriceHex);
    return {
      gasLimit,
      gasPrice,
      estimatedFeeNative: gasLimit * gasPrice
    };
  }

  public async broadcastTransaction(rawTxHex: string): Promise<string> {
    if (!this.provider.broadcastCapability) {
      throw new Error(`BROADCAST_REJECTED: Provider ${this.provider.providerId} does not possess verified broadcast capability`);
    }
    return this.rpcCall<string>('eth_sendRawTransaction', [rawTxHex]);
  }

  public async getTransaction(txHash: string): Promise<any | null> {
    return this.rpcCall<any | null>('eth_getTransactionByHash', [txHash]);
  }

  public async getReceiptOrEquivalent(txHash: string): Promise<any | null> {
    return this.rpcCall<any | null>('eth_getTransactionReceipt', [txHash]);
  }
}
