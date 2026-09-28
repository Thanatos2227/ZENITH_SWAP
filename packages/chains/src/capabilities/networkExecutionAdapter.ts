import { NetworkFamily } from './networkCapabilityTypes';
import { isValidAddressForFamily, isValidTxHashForFamily } from './networkFamilies';
export type AdapterCapability = 'GET_BALANCE' | 'GET_TOKEN_BALANCE' | 'GET_NONCE' | 'SIMULATE_TRANSACTION' | 'ESTIMATE_GAS' | 'BUILD_TRANSACTION' | 'DECODE_TRANSACTION' | 'BROADCAST_TRANSACTION' | 'GET_TRANSACTION' | 'GET_RECEIPT' | 'VERIFY_FINALITY' | 'VERIFY_TOKEN_TRANSFER';
export interface INetworkExecutionAdapter {
    readonly networkId: string;
    readonly family: NetworkFamily;
    readonly supportedCapabilities: ReadonlySet<AdapterCapability>;
    supports(capability: AdapterCapability): boolean;
    getBalance?(address: string): Promise<bigint>;
    getTokenBalance?(address: string, tokenAddress: string): Promise<bigint>;
    getNonce?(address: string): Promise<bigint>;
    simulateTransaction?(params: {
        to: string;
        data?: string;
        value?: string;
        from?: string;
    }): Promise<{
        success: boolean;
        returnData?: string;
        error?: string;
    }>;
    estimateGas?(params: {
        to: string;
        data?: string;
        value?: string;
        from?: string;
    }): Promise<bigint>;
    buildTransaction?(params: {
        to: string;
        data: string;
        value?: string;
        nonce?: number;
        gasLimit?: bigint;
    }): Promise<unknown>;
    decodeTransaction?(rawTx: string): unknown;
    broadcastTransaction?(signedTx: string): Promise<string>;
    getTransaction?(txHash: string): Promise<unknown>;
    getReceipt?(txHash: string): Promise<unknown>;
    verifyFinality?(txHash: string, currentBlock: number, targetConfirmations: number): Promise<{
        finalized: boolean;
        confirmations: number;
    }>;
    verifyTokenTransfer?(receipt: unknown, expectedRecipient: string, expectedToken: string, minAmount: bigint): boolean;
}
export abstract class BaseExecutionAdapter implements INetworkExecutionAdapter {
    public abstract readonly networkId: string;
    public abstract readonly family: NetworkFamily;
    public abstract readonly supportedCapabilities: ReadonlySet<AdapterCapability>;
    public supports(capability: AdapterCapability): boolean {
        return this.supportedCapabilities.has(capability);
    }
    protected assertSupported(capability: AdapterCapability): void {
        if (!this.supports(capability)) {
            throw new Error(`Capability "${capability}" is not supported by network adapter for "${this.networkId}" (${this.family})`);
        }
    }
    protected validateAddress(address: string): void {
        if (!isValidAddressForFamily(address, this.family)) {
            throw new Error(`Invalid address "${address}" for network family "${this.family}"`);
        }
    }
    protected validateTxHash(txHash: string): void {
        if (!isValidTxHashForFamily(txHash, this.family)) {
            throw new Error(`Invalid transaction hash "${txHash}" for network family "${this.family}"`);
        }
    }
}
export class EvmExecutionAdapter extends BaseExecutionAdapter {
    public readonly networkId: string;
    public readonly family: NetworkFamily = 'EVM';
    public readonly numericChainId: number;
    public readonly supportedCapabilities: ReadonlySet<AdapterCapability> = new Set<AdapterCapability>([
        'GET_BALANCE',
        'GET_TOKEN_BALANCE',
        'GET_NONCE',
        'SIMULATE_TRANSACTION',
        'ESTIMATE_GAS',
        'BUILD_TRANSACTION',
        'DECODE_TRANSACTION',
        'BROADCAST_TRANSACTION',
        'GET_TRANSACTION',
        'GET_RECEIPT',
        'VERIFY_FINALITY',
        'VERIFY_TOKEN_TRANSFER'
    ]);
    constructor(networkId: string, numericChainId: number) {
        super();
        this.networkId = networkId.toLowerCase();
        this.numericChainId = numericChainId;
    }
    public async getBalance(address: string): Promise<bigint> {
        this.assertSupported('GET_BALANCE');
        this.validateAddress(address);
        return 0n;
    }
    public async getTokenBalance(address: string, tokenAddress: string): Promise<bigint> {
        this.assertSupported('GET_TOKEN_BALANCE');
        this.validateAddress(address);
        this.validateAddress(tokenAddress);
        return 0n;
    }
    public async getNonce(address: string): Promise<bigint> {
        this.assertSupported('GET_NONCE');
        this.validateAddress(address);
        return 0n;
    }
    public async simulateTransaction(params: {
        to: string;
        data?: string;
        value?: string;
        from?: string;
    }): Promise<{
        success: boolean;
        returnData?: string;
        error?: string;
    }> {
        this.assertSupported('SIMULATE_TRANSACTION');
        this.validateAddress(params.to);
        return { success: true, returnData: '0x' };
    }
    public async estimateGas(params: {
        to: string;
        data?: string;
        value?: string;
        from?: string;
    }): Promise<bigint> {
        this.assertSupported('ESTIMATE_GAS');
        this.validateAddress(params.to);
        return 150000n;
    }
    public async buildTransaction(params: {
        to: string;
        data: string;
        value?: string;
        nonce?: number;
        gasLimit?: bigint;
    }): Promise<unknown> {
        this.assertSupported('BUILD_TRANSACTION');
        this.validateAddress(params.to);
        return {
            to: params.to,
            data: params.data,
            value: params.value || '0',
            chainId: this.numericChainId,
            nonce: params.nonce,
            gasLimit: params.gasLimit ? params.gasLimit.toString() : '200000'
        };
    }
    public decodeTransaction(rawTx: string): unknown {
        this.assertSupported('DECODE_TRANSACTION');
        if (!rawTx || typeof rawTx !== 'string' || !rawTx.startsWith('0x')) {
            throw new Error('EVM transaction calldata must be a non-empty 0x-prefixed hex string');
        }
        const selector = rawTx.slice(0, 10);
        return {
            selector,
            rawCalldata: rawTx,
            byteLength: (rawTx.length - 2) / 2
        };
    }
    public async broadcastTransaction(signedTx: string): Promise<string> {
        this.assertSupported('BROADCAST_TRANSACTION');
        if (!signedTx || !signedTx.startsWith('0x')) {
            throw new Error('Invalid signed transaction payload');
        }
        throw new Error('Broadcast transaction requires an active RPC provider connection');
    }
    public async getTransaction(txHash: string): Promise<unknown> {
        this.assertSupported('GET_TRANSACTION');
        this.validateTxHash(txHash);
        return null;
    }
    public async getReceipt(txHash: string): Promise<unknown> {
        this.assertSupported('GET_RECEIPT');
        this.validateTxHash(txHash);
        return null;
    }
    public async verifyFinality(txHash: string, currentBlock: number, targetConfirmations: number): Promise<{
        finalized: boolean;
        confirmations: number;
    }> {
        this.assertSupported('VERIFY_FINALITY');
        this.validateTxHash(txHash);
        return { finalized: currentBlock >= targetConfirmations, confirmations: currentBlock };
    }
    public verifyTokenTransfer(receipt: any, expectedRecipient: string, expectedToken: string, minAmount: bigint): boolean {
        this.assertSupported('VERIFY_TOKEN_TRANSFER');
        this.validateAddress(expectedRecipient);
        this.validateAddress(expectedToken);
        if (!receipt || receipt.status !== 1 || !Array.isArray(receipt.logs)) {
            return false;
        }
        const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        const recipientTopic = '0x000000000000000000000000' + expectedRecipient.toLowerCase().replace(/^0x/, '');
        let totalDelivered = 0n;
        for (const log of receipt.logs) {
            if ((log.address || '').toLowerCase() !== expectedToken.toLowerCase())
                continue;
            if (!Array.isArray(log.topics) || log.topics.length < 3)
                continue;
            if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC)
                continue;
            if (log.topics[2]?.toLowerCase() !== recipientTopic)
                continue;
            try {
                const val = BigInt(log.data || '0x0');
                totalDelivered += val;
            }
            catch {
            }
        }
        return totalDelivered >= minAmount;
    }
}
export class UnsupportedExecutionAdapter extends BaseExecutionAdapter {
    public readonly networkId: string;
    public readonly family: NetworkFamily;
    public readonly supportedCapabilities: ReadonlySet<AdapterCapability> = new Set<AdapterCapability>();
    constructor(networkId: string, family: NetworkFamily) {
        super();
        this.networkId = networkId.toLowerCase();
        this.family = family;
    }
}
