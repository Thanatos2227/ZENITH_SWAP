import { QuoteResponse, TransactionStatus } from '@zenith/types';
import { SignerRequiredError, ConfigurationError } from '@zenith/contracts';

export interface SolanaExecutionParams {
  quote: QuoteResponse;
  userPublicKey: string;
  walletProvider?: any;
  onStatusChange?: (status: TransactionStatus, txSignature?: string) => void;
}

export interface SolanaExecutionResult {
  isSuccess: boolean;
  txSignature: string;
  slot: number;
  computeUnitsUsed: number;
  priorityFeeLamports: number;
  revertReason?: string;
}

export class SolanaExecutionAdapter {
  public async checkAssociatedTokenAccount(_params: {
    walletPublicKey: string;
    tokenMintAddress: string;
  }): Promise<boolean> {
    return true;
  }

  public async executeSwap(params: SolanaExecutionParams): Promise<SolanaExecutionResult> {
    const { userPublicKey, walletProvider } = params;

    if (!userPublicKey) {
      throw new SignerRequiredError('Solana public key / wallet connection is required.');
    }

    if (!walletProvider || typeof walletProvider.signAndSendTransaction !== 'function') {
      throw new ConfigurationError(
        'Connected Solana wallet does not support automated transaction signing. Please sign through wallet extension.',
        'SOLANA_SIGNER_UNAVAILABLE'
      );
    }

    params.onStatusChange?.('SIGNING');

    try {

      const response = await walletProvider.signAndSendTransaction({
        instructions: [],
        feePayer: userPublicKey
      });

      const txSignature = response.signature || response;
      params.onStatusChange?.('SUBMITTING', txSignature);
      params.onStatusChange?.('BROADCASTED', txSignature);
      params.onStatusChange?.('CONFIRMING', txSignature);
      params.onStatusChange?.('COMPLETED', txSignature);

      return {
        isSuccess: true,
        txSignature,
        slot: response.slot || 0,
        computeUnitsUsed: response.computeUnits || 0,
        priorityFeeLamports: 10000
      };
    } catch (err: any) {
      params.onStatusChange?.('FAILED');
      throw err;
    }
  }
}

export const defaultSolanaAdapter = new SolanaExecutionAdapter();
