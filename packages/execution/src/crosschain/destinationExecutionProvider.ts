import { DestinationExecutionCapabilities, DestinationExecutionRequest, DestinationExecutionPlan, DestinationExecutionResult, DestinationExecutionStatus, DestinationVerification } from '@zenith/types';
export interface DestinationExecutionProvider {
    readonly id: string;
    readonly name: string;
    getCapabilities(): Promise<DestinationExecutionCapabilities>;
    prepareDestinationExecution(request: DestinationExecutionRequest): Promise<DestinationExecutionPlan>;
    submitDestinationExecution(plan: DestinationExecutionPlan, signer?: any, provider?: any): Promise<DestinationExecutionResult>;
    trackDestinationExecution(executionId: string): Promise<DestinationExecutionStatus>;
    verifyDestinationExecution(executionId: string, expectedRecipient: string, expectedToken: string, minAmount: bigint): Promise<DestinationVerification>;
}
