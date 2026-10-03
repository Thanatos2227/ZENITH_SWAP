export type SignerEnvironment = 'LOCAL' | 'TESTNET' | 'STAGING' | 'PRODUCTION';

export type KmsProviderType = 'AWS_KMS' | 'GCP_KMS' | 'AZURE_KEY_VAULT' | 'HASHICORP_VAULT' | 'LOCAL_DEV_HSM';

export interface SignerPolicy {
    readonly allowedChainIds: number[];
    readonly maxTransactionValueWei: bigint;
    readonly maxGasPriceWei?: bigint;
    readonly destinationAllowlist: string[];
    readonly requireOperatorConfirmation: boolean;
    readonly allowUnboundedApprovals: boolean;
}

export interface KmsSigningRequest {
    readonly chainId: number;
    readonly to: string;
    readonly value: bigint;
    readonly data: string;
    readonly nonce?: number;
    readonly gasLimit?: bigint;
    readonly maxFeePerGas?: bigint;
    readonly maxPriorityFeePerGas?: bigint;
}

export interface KmsSignedTransaction {
    readonly rawTransaction: string;
    readonly transactionHash: string;
    readonly keyId: string;
    readonly providerType: KmsProviderType;
    readonly signatureTimestamp: number;
}

export interface ISecureSignerProvider {
    readonly environment: SignerEnvironment;
    readonly keyId: string;
    readonly providerType: KmsProviderType;
    
    getAddress(): Promise<string>;
    getSignerPolicy(): SignerPolicy;
    signTransaction(request: KmsSigningRequest, operatorConfirmationToken?: string): Promise<KmsSignedTransaction>;
    signMessage(message: Uint8Array | string): Promise<string>;
    validatePolicy(request: KmsSigningRequest): void;
}
