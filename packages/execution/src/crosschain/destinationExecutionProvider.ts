import {
  DestinationExecutionCapabilities,
  DestinationExecutionRequest,
  DestinationExecutionPlan,
  DestinationExecutionResult,
  DestinationExecutionStatus,
  DestinationVerification
} from '@zenith/types';

export interface DestinationExecutionProvider {
  /**
   * Identifies the provider / solver
   */
  readonly id: string;
  readonly name: string;

  /**
   * Retrieves operational capabilities
   */
  getCapabilities(): Promise<DestinationExecutionCapabilities>;

  /**
   * Prepares authoritative destination execution plan using actual bridged amount
   */
  prepareDestinationExecution(
    request: DestinationExecutionRequest
  ): Promise<DestinationExecutionPlan>;

  /**
   * Broadcasts / executes destination transaction
   */
  submitDestinationExecution(
    plan: DestinationExecutionPlan,
    signer?: any,
    provider?: any
  ): Promise<DestinationExecutionResult>;

  /**
   * Tracks fulfillment on destination chain
   */
  trackDestinationExecution(
    executionId: string
  ): Promise<DestinationExecutionStatus>;

  /**
   * Validates final on-chain delivery to recipient
   */
  verifyDestinationExecution(
    executionId: string,
    expectedRecipient: string,
    expectedToken: string,
    minAmount: bigint
  ): Promise<DestinationVerification>;
}
