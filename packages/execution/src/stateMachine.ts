import { ExecutionStep, ReceiptView, TransactionStatus } from '@zenith/types';
import { InvalidStateTransitionError } from '@zenith/contracts';

export type StateChangeCallback = (status: TransactionStatus, steps: ExecutionStep[]) => void;

export const VALID_TRANSACTION_STATUS_TRANSITIONS: Record<string, string[]> = {
  IDLE: ['QUOTE_REQUESTED', 'QUOTED', 'SIMULATING', 'APPROVAL_NEEDED', 'APPROVING', 'SIGNING', 'SUBMITTING', 'BROADCASTED', 'CONFIRMING', 'BRIDGE_SOURCE_CONFIRMED', 'BRIDGE_IN_FLIGHT', 'BRIDGE_DESTINATION_CONFIRMED', 'DESTINATION_FILLED', 'SETTLED', 'TRACKING_TIMEOUT', 'TRACKING_UNAVAILABLE', 'REFUND_PENDING', 'REFUNDED', 'FAILED', 'CANCELLED', 'PREPARING'],
  PREPARING: ['SIMULATING', 'SIMULATED', 'FAILED', 'CANCELLED'],
  QUOTE_REQUESTED: ['QUOTED', 'FAILED', 'CANCELLED'],
  QUOTED: ['SIMULATING', 'SIMULATED', 'APPROVAL_NEEDED', 'APPROVING', 'SIGNING', 'FAILED', 'CANCELLED'],
  SIMULATING: ['SIMULATED', 'APPROVAL_NEEDED', 'APPROVING', 'SIGNING', 'FAILED', 'REVERTED', 'CANCELLED'],
  SIMULATED: ['APPROVAL_NEEDED', 'APPROVING', 'SIGNING', 'SUBMITTING', 'FAILED', 'CANCELLED'],
  APPROVAL_NEEDED: ['APPROVING', 'FAILED', 'CANCELLED'],
  APPROVING: ['APPROVED', 'FAILED', 'CANCELLED', 'REVERTED'],
  APPROVED: ['SIGNING', 'SUBMITTING', 'CONFIRMING', 'BRIDGE_IN_FLIGHT', 'FAILED', 'CANCELLED'],
  SIGNING: ['SUBMITTING', 'BROADCASTED', 'CONFIRMING', 'BRIDGE_IN_FLIGHT', 'FAILED', 'CANCELLED'],
  SUBMITTING: ['BROADCASTED', 'CONFIRMING', 'BRIDGE_SOURCE_CONFIRMED', 'BRIDGE_IN_FLIGHT', 'FAILED', 'CANCELLED', 'REVERTED'],
  BROADCASTED: ['CONFIRMING', 'COMPLETED', 'BRIDGE_SOURCE_CONFIRMED', 'BRIDGE_IN_FLIGHT', 'FAILED', 'REVERTED'],
  CONFIRMING: ['COMPLETED', 'BRIDGE_SOURCE_CONFIRMED', 'BRIDGE_IN_FLIGHT', 'DESTINATION_FILLED', 'SETTLED', 'FAILED', 'REVERTED', 'SIMULATING', 'SIMULATED', 'APPROVING', 'APPROVED', 'SIGNING', 'SUBMITTING'],
  BRIDGE_SOURCE_CONFIRMED: ['BRIDGE_IN_FLIGHT', 'BRIDGE_DESTINATION_CONFIRMED', 'DESTINATION_FILLED', 'SETTLED', 'TRACKING_TIMEOUT', 'TRACKING_UNAVAILABLE', 'REFUND_PENDING', 'FAILED'],
  BRIDGE_IN_FLIGHT: ['BRIDGE_DESTINATION_CONFIRMED', 'DESTINATION_FILLED', 'COMPLETED', 'SETTLED', 'TRACKING_TIMEOUT', 'TRACKING_UNAVAILABLE', 'REFUND_PENDING', 'FAILED'],
  BRIDGE_DESTINATION_CONFIRMED: ['DESTINATION_FILLED', 'COMPLETED', 'SETTLED', 'REFUND_PENDING', 'FAILED'],
  DESTINATION_FILLED: ['SETTLED', 'COMPLETED', 'REFUND_PENDING', 'FAILED'],
  TRACKING_TIMEOUT: ['BRIDGE_IN_FLIGHT', 'DESTINATION_FILLED', 'SETTLED', 'REFUND_PENDING', 'REFUNDED', 'FAILED'],
  TRACKING_UNAVAILABLE: ['BRIDGE_IN_FLIGHT', 'DESTINATION_FILLED', 'SETTLED', 'REFUND_PENDING', 'REFUNDED', 'FAILED'],
  REFUND_PENDING: ['REFUNDED', 'FAILED'],
  COMPLETED: [],
  SETTLED: [],
  FAILED: [],
  REVERTED: [],
  CANCELLED: [],
  REFUNDED: []
};

export const TERMINAL_TRANSACTION_STATUSES: Set<string> = new Set([
  'COMPLETED',
  'SETTLED',
  'FAILED',
  'REVERTED',
  'CANCELLED',
  'REFUNDED'
]);

export function validateTransactionStatusTransition(from: string, to: string): void {
  if (from === to) return;
  if (TERMINAL_TRANSACTION_STATUSES.has(from)) {
    throw new InvalidStateTransitionError(from, to, 'ExecutionStatus');
  }
  const allowed = VALID_TRANSACTION_STATUS_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new InvalidStateTransitionError(from, to, 'ExecutionStatus');
  }
}

export class ExecutionStateMachine {
  private currentStatus: TransactionStatus = 'IDLE';
  private steps: ExecutionStep[] = [];
  private listeners: Set<StateChangeCallback> = new Set();
  private lastReceipt?: ReceiptView;

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.currentStatus = 'IDLE';
    this.steps = [];
    this.lastReceipt = undefined;
    this.notify();
  }

  public getStatus(): TransactionStatus {
    return this.currentStatus;
  }

  public isTerminal(): boolean {
    return TERMINAL_TRANSACTION_STATUSES.has(this.currentStatus);
  }

  public getSteps(): ExecutionStep[] {
    return [...this.steps];
  }

  public getReceipt(): ReceiptView | undefined {
    return this.lastReceipt;
  }

  public setReceipt(receipt: ReceiptView): void {
    this.lastReceipt = receipt;
  }

  public subscribe(callback: StateChangeCallback): () => void {
    this.listeners.add(callback);
    callback(this.currentStatus, this.steps);
    return () => {
      this.listeners.delete(callback);
    };
  }

  public transitionTo(
    newStatus: TransactionStatus,
    stepUpdate?: { id: string; status: ExecutionStep['status']; txHash?: string; error?: string }
  ): void {
    if (this.currentStatus !== newStatus) {
      validateTransactionStatusTransition(this.currentStatus, newStatus);
      this.currentStatus = newStatus;
    }

    if (stepUpdate) {
      const stepIdx = this.steps.findIndex((s) => s.id === stepUpdate.id);
      if (stepIdx >= 0) {
        this.steps[stepIdx] = {
          ...this.steps[stepIdx],
          status: stepUpdate.status,
          txHash: stepUpdate.txHash || this.steps[stepIdx].txHash,
          error: stepUpdate.error,
          timestamp: Date.now()
        };
      }
    }

    this.notify();
  }

  public initializeSteps(steps: ExecutionStep[]): void {
    this.steps = [...steps];
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach((listener) => {
      try {
        listener(this.currentStatus, [...this.steps]);
      } catch (err) {
        console.error('[ExecutionStateMachine] Listener error:', err);
      }
    });
  }
}

