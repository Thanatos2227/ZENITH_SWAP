import { 
    ISecureSignerProvider, 
    SignerEnvironment, 
    KmsProviderType, 
    SignerPolicy, 
    KmsSigningRequest, 
    KmsSignedTransaction 
} from './signerInterface';
import { 
    validateEvmAddress, 
    ZERO_ADDRESS, 
    AuthorizationBoundaryBreachError, 
    SecurityPolicyViolationError,
    ChainIdMismatchError 
} from '@zenith/contracts';
import { sha256, toUtf8Bytes, getBytes } from 'ethers';

export interface KmsSignerConfig {
    readonly environment: SignerEnvironment;
    readonly keyId: string;
    readonly providerType: KmsProviderType;
    readonly policy: SignerPolicy;
    readonly addressResolver: () => Promise<string>;
    readonly signatureDelegate: (digest: Uint8Array) => Promise<{ r: string; s: string; v: number }>;
}

export class KmsSignerProvider implements ISecureSignerProvider {
    public readonly environment: SignerEnvironment;
    public readonly keyId: string;
    public readonly providerType: KmsProviderType;
    private readonly policy: SignerPolicy;
    private readonly addressResolver: () => Promise<string>;
    private readonly signatureDelegate: (digest: Uint8Array) => Promise<{ r: string; s: string; v: number }>;
    private cachedAddress: string | null = null;

    constructor(config: KmsSignerConfig) {
        if (!config.keyId || config.keyId.trim() === '') {
            throw new SecurityPolicyViolationError('KmsSignerProvider: keyId must be a non-empty string', ['keyId']);
        }
        this.environment = config.environment;
        this.keyId = config.keyId;
        this.providerType = config.providerType;
        this.policy = config.policy;
        this.addressResolver = config.addressResolver;
        this.signatureDelegate = config.signatureDelegate;
    }

    public async getAddress(): Promise<string> {
        if (this.cachedAddress) {
            return this.cachedAddress;
        }
        const address = await this.addressResolver();
        validateEvmAddress(address, `KMS Signer Address for Key ${this.keyId}`);
        this.cachedAddress = address;
        return address;
    }

    public getSignerPolicy(): SignerPolicy {
        return { ...this.policy, allowedChainIds: [...this.policy.allowedChainIds], destinationAllowlist: [...this.policy.destinationAllowlist] };
    }

    public validatePolicy(request: KmsSigningRequest): void {
        if (!this.policy.allowedChainIds.includes(request.chainId)) {
            throw new ChainIdMismatchError(
                'KmsSignerProvider',
                this.policy.allowedChainIds[0] || 1,
                request.chainId
            );
        }


        if (!request.to || request.to === ZERO_ADDRESS || request.to.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
            throw new SecurityPolicyViolationError('KMS Signer Policy Breach: Transaction destination cannot be zero address', ['to']);
        }

        validateEvmAddress(request.to, 'KMS Signer Destination');

        if (this.policy.destinationAllowlist.length > 0) {
            const normalizedTo = request.to.toLowerCase();
            const isAllowlisted = this.policy.destinationAllowlist.some(addr => addr.toLowerCase() === normalizedTo);
            if (!isAllowlisted) {
                throw new AuthorizationBoundaryBreachError(
                    'SIGNING_AUTHORIZATION',
                    `KMS Signer Policy Breach: Destination address ${request.to} is not in authorized allowlist`
                );
            }
        }

        if (request.value > this.policy.maxTransactionValueWei) {
            throw new SecurityPolicyViolationError(
                `KMS Signer Policy Breach: Transaction value ${request.value} exceeds maximum policy threshold ${this.policy.maxTransactionValueWei}`,
                ['value']
            );
        }

        if (request.data && request.data.startsWith('0x095ea7b3')) { // approve(address,uint256)
            if (!this.policy.allowUnboundedApprovals && request.data.includes('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')) {
                throw new SecurityPolicyViolationError('KMS Signer Policy Breach: Unbounded approval (type(uint256).max) prohibited', ['calldata']);
            }
        }
    }

    public async signTransaction(
        request: KmsSigningRequest, 
        operatorConfirmationToken?: string
    ): Promise<KmsSignedTransaction> {
        this.validatePolicy(request);

        if (this.policy.requireOperatorConfirmation) {
            if (!operatorConfirmationToken || operatorConfirmationToken.trim() === '') {
                throw new AuthorizationBoundaryBreachError(
                    'SIGNING_AUTHORIZATION',
                    'KMS Signer: Operator confirmation token is strictly required for production signing'
                );
            }
        }

        const txPayload = JSON.stringify({
            chainId: request.chainId,
            to: request.to.toLowerCase(),
            value: request.value.toString(),
            data: request.data.toLowerCase(),
            nonce: request.nonce,
            gasLimit: request.gasLimit?.toString(),
            maxFeePerGas: request.maxFeePerGas?.toString(),
            maxPriorityFeePerGas: request.maxPriorityFeePerGas?.toString()
        });

        const digest = getBytes(sha256(toUtf8Bytes(txPayload)));
        const sig = await this.signatureDelegate(digest);
        const txHash = sha256(toUtf8Bytes(txPayload + sig.r + sig.s));

        const hexPayload = Array.from(toUtf8Bytes(txPayload)).map(b => b.toString(16).padStart(2, '0')).join('');

        return {
            rawTransaction: `0x${hexPayload}`,
            transactionHash: txHash,
            keyId: this.keyId,
            providerType: this.providerType,
            signatureTimestamp: Date.now()
        };
    }

    public async signMessage(message: Uint8Array | string): Promise<string> {
        const payloadBytes = typeof message === 'string' ? toUtf8Bytes(message) : message;
        const digest = getBytes(sha256(payloadBytes));
        const sig = await this.signatureDelegate(digest);
        return `0x${sig.r}${sig.s}${sig.v.toString(16).padStart(2, '0')}`;
    }
}

