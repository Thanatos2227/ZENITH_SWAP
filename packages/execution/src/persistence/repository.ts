import {
  PersistentIntent,
  PersistentExecutionStep,
  PersistentProviderOrder,
  PersistentSettlement,
  SettlementState,
  ExecutionPlan,
  ExecutionPlanStep,
  PersistentTransaction,
  WorkerLease,
  TransactionLifecycleState
} from '@zenith/types';
import { InvalidStateTransitionError } from '@zenith/contracts';

export const VALID_TRANSACTION_STATE_TRANSITIONS: Record<TransactionLifecycleState, TransactionLifecycleState[]> = {
  CREATED: ['PREFLIGHTING', 'PREFLIGHT_FAILED'],
  PREFLIGHTING: ['PREFLIGHT_PASSED', 'PREFLIGHT_FAILED'],
  PREFLIGHT_PASSED: ['READY_TO_BROADCAST', 'PREFLIGHT_FAILED'],
  READY_TO_BROADCAST: ['BROADCASTING', 'BROADCAST_FAILED'],
  BROADCASTING: ['BROADCAST_CONFIRMED', 'BROADCAST_FAILED', 'BROADCAST_UNCERTAIN'],
  BROADCAST_UNCERTAIN: ['BROADCAST_CONFIRMED', 'CONFIRMED', 'BROADCAST_FAILED', 'RECOVERY_REQUIRED'],
  BROADCAST_CONFIRMED: ['CONFIRMING', 'CONFIRMED', 'REVERTED', 'RECOVERY_REQUIRED'],
  CONFIRMING: ['CONFIRMED', 'REVERTED', 'DROPPED', 'EXPIRED', 'RECOVERY_REQUIRED'],
  CONFIRMED: [],
  PREFLIGHT_FAILED: ['PREFLIGHTING'],
  BROADCAST_FAILED: ['READY_TO_BROADCAST', 'PREFLIGHTING'],
  REVERTED: [],
  DROPPED: ['RECOVERY_REQUIRED'],
  EXPIRED: ['RECOVERY_REQUIRED'],
  RECOVERY_REQUIRED: ['BROADCAST_CONFIRMED', 'CONFIRMED', 'BROADCAST_FAILED', 'REVERTED']
};

export const TERMINAL_TRANSACTION_LIFECYCLE_STATES: Set<TransactionLifecycleState> = new Set(['CONFIRMED', 'REVERTED']);

export function validateTransactionStateTransition(fromState: TransactionLifecycleState, toState: TransactionLifecycleState): void {
  if (fromState === toState) return;
  if (TERMINAL_TRANSACTION_LIFECYCLE_STATES.has(fromState)) {
    throw new InvalidStateTransitionError(fromState, toState, 'Transaction');
  }
  const allowed = VALID_TRANSACTION_STATE_TRANSITIONS[fromState] || [];
  if (!allowed.includes(toState)) {
    throw new InvalidStateTransitionError(fromState, toState, 'Transaction');
  }
}

export const VALID_PLAN_STATUS_TRANSITIONS: Record<string, string[]> = {
  IDLE: ['EXECUTING', 'PAUSED', 'COMPLETED', 'FAILED'],
  EXECUTING: ['PAUSED', 'COMPLETED', 'FAILED'],
  PAUSED: ['EXECUTING', 'FAILED'],
  COMPLETED: [],
  FAILED: []
};

export const TERMINAL_PLAN_STATUSES: Set<string> = new Set(['COMPLETED', 'FAILED']);

export function validatePlanStatusTransition(fromState: string, toState: string): void {
  if (fromState === toState) return;
  if (TERMINAL_PLAN_STATUSES.has(fromState)) {
    throw new InvalidStateTransitionError(fromState, toState, 'ExecutionPlan');
  }
  const allowed = VALID_PLAN_STATUS_TRANSITIONS[fromState] || [];
  if (!allowed.includes(toState)) {
    throw new InvalidStateTransitionError(fromState, toState, 'ExecutionPlan');
  }
}

export const VALID_STEP_STATUS_TRANSITIONS: Record<string, string[]> = {
  NOT_STARTED: ['PENDING', 'ACTIVE', 'SIMULATING', 'SIGNING', 'SUBMITTED', 'CONFIRMING', 'SUCCESS', 'SKIPPED', 'FAILED', 'ERROR'],
  IDLE: ['PENDING', 'ACTIVE', 'SIMULATING', 'SIGNING', 'SUBMITTED', 'CONFIRMING', 'SUCCESS', 'SKIPPED', 'FAILED', 'ERROR'],
  PENDING: ['ACTIVE', 'SIMULATING', 'SIGNING', 'SUBMITTED', 'CONFIRMING', 'SUCCESS', 'SKIPPED', 'FAILED', 'ERROR'],
  ACTIVE: ['SIMULATING', 'SIGNING', 'SUBMITTED', 'CONFIRMING', 'SUCCESS', 'SKIPPED', 'FAILED', 'ERROR'],
  SIMULATING: ['ACTIVE', 'SIGNING', 'SUBMITTED', 'CONFIRMING', 'SUCCESS', 'FAILED', 'SKIPPED', 'ERROR'],
  SIGNING: ['ACTIVE', 'SUBMITTED', 'CONFIRMING', 'SUCCESS', 'FAILED', 'SKIPPED', 'ERROR'],
  SUBMITTED: ['CONFIRMING', 'SUCCESS', 'FAILED', 'ERROR'],
  CONFIRMING: ['SUCCESS', 'FAILED', 'ERROR'],
  SUCCESS: [],
  FAILED: [],
  SKIPPED: [],
  ERROR: []
};

export const TERMINAL_STEP_STATUSES: Set<string> = new Set(['SUCCESS', 'FAILED', 'SKIPPED', 'ERROR']);

export function validateStepStatusTransition(fromState: string, toState: string): void {
  if (fromState === toState) return;
  if (TERMINAL_STEP_STATUSES.has(fromState)) {
    throw new InvalidStateTransitionError(fromState, toState, 'ExecutionPlanStep');
  }
  const allowed = VALID_STEP_STATUS_TRANSITIONS[fromState] || [];
  if (!allowed.includes(toState)) {
    throw new InvalidStateTransitionError(fromState, toState, 'ExecutionPlanStep');
  }
}

export const VALID_SETTLEMENT_STATE_TRANSITIONS: Record<SettlementState, SettlementState[]> = {
  CREATED: ['SIGNED', 'SUBMITTED', 'FULFILLING', 'CANCELLED', 'EXPIRED'],
  SIGNED: ['SUBMITTED', 'CANCELLED', 'EXPIRED'],
  SUBMITTED: ['ACCEPTED', 'REJECTED', 'FAILED', 'EXPIRED', 'FULFILLING', 'SETTLED'],
  ACCEPTED: ['FULFILLING', 'FAILED', 'REFUND_PENDING'],
  FULFILLING: ['FULFILLING', 'DESTINATION_FILLED', 'FAILED', 'REFUND_PENDING', 'SETTLED', 'TRACKING_TIMEOUT', 'TRACKING_UNAVAILABLE'],
  DESTINATION_FILLED: ['VERIFIED', 'SETTLING', 'SETTLED', 'FAILED', 'REFUND_PENDING'],
  VERIFIED: ['SETTLING', 'SETTLED', 'FAILED', 'REFUND_PENDING'],
  SETTLING: ['SETTLED', 'FAILED'],
  SETTLED: [],
  FAILED: ['REFUND_PENDING', 'REFUNDED'],
  REFUND_PENDING: ['REFUNDED'],
  REFUNDED: [],
  CANCELLED: [],
  EXPIRED: ['REFUND_PENDING', 'REFUNDED'],
  REJECTED: ['REFUND_PENDING', 'REFUNDED'],
  TRACKING_TIMEOUT: ['FULFILLING', 'DESTINATION_FILLED', 'SETTLED', 'FAILED', 'REFUND_PENDING', 'REFUNDED'],
  TRACKING_UNAVAILABLE: ['FULFILLING', 'DESTINATION_FILLED', 'SETTLED', 'FAILED', 'REFUND_PENDING', 'REFUNDED']
};

export const TERMINAL_SETTLEMENT_STATES: Set<SettlementState> = new Set(['SETTLED', 'REFUNDED', 'CANCELLED']);

export function validateSettlementStateTransition(fromState: SettlementState, toState: SettlementState): void {
  if (fromState === toState) return;
  if (TERMINAL_SETTLEMENT_STATES.has(fromState)) {
    throw new InvalidStateTransitionError(fromState, toState, 'SettlementIntent');
  }
  const allowed = VALID_SETTLEMENT_STATE_TRANSITIONS[fromState] || [];
  if (!allowed.includes(toState)) {
    throw new InvalidStateTransitionError(fromState, toState, 'SettlementIntent');
  }
}


export interface CrossChainStateRepository {
  // Authoritative ExecutionPlan persistence
  saveExecutionPlan(plan: ExecutionPlan): Promise<void>;
  getExecutionPlan(planId: string): Promise<ExecutionPlan | null>;
  updateExecutionPlan(planId: string, updates: Partial<ExecutionPlan>): Promise<ExecutionPlan>;
  listActiveExecutionPlans(): Promise<ExecutionPlan[]>;

  // ExecutionPlanStep persistence
  savePlanStep(planId: string, step: ExecutionPlanStep): Promise<void>;
  getPlanStep(planId: string, stepId: string): Promise<ExecutionPlanStep | null>;
  getPlanSteps(planId: string): Promise<ExecutionPlanStep[]>;
  updatePlanStep(planId: string, stepId: string, updates: Partial<ExecutionPlanStep>): Promise<ExecutionPlanStep>;

  // Transaction record persistence
  createTransaction(tx: PersistentTransaction): Promise<void>;
  getTransaction(transactionId: string): Promise<PersistentTransaction | null>;
  getTransactionByTxHash(txHash: string): Promise<PersistentTransaction | null>;
  getTransactionsForStep(planId: string, stepId: string): Promise<PersistentTransaction[]>;
  updateTransaction(transactionId: string, updates: Partial<PersistentTransaction>): Promise<PersistentTransaction>;
  listUncertainTransactions(): Promise<PersistentTransaction[]>;

  // Worker Lease management
  acquireLease(resourceId: string, workerId: string, durationMs: number): Promise<boolean>;
  renewLease(resourceId: string, workerId: string, durationMs: number): Promise<boolean>;
  releaseLease(resourceId: string, workerId: string): Promise<void>;
  getLease(resourceId: string): Promise<WorkerLease | null>;
  listExpiredLeases(): Promise<WorkerLease[]>;

  // Intent lifecycle (legacy/intent engine)
  createIntent(intent: PersistentIntent): Promise<void>;
  getIntent(intentId: string): Promise<PersistentIntent | null>;
  updateIntent(intentId: string, updates: Partial<PersistentIntent>): Promise<PersistentIntent>;
  listPendingIntents(): Promise<PersistentIntent[]>;
  listRecoverableIntents(): Promise<PersistentIntent[]>;
  claimIntentLease(intentId: string, workerId: string, leaseDurationMs: number): Promise<boolean>;
  releaseIntentLease(intentId: string, workerId: string): Promise<void>;

  // Step lifecycle (legacy)
  createStep(step: PersistentExecutionStep): Promise<void>;
  getStep(stepId: string): Promise<PersistentExecutionStep | null>;
  getStepsForIntent(intentId: string): Promise<PersistentExecutionStep[]>;
  updateStep(stepId: string, updates: Partial<PersistentExecutionStep>): Promise<PersistentExecutionStep>;

  // Provider order lifecycle
  createProviderOrder(order: PersistentProviderOrder): Promise<void>;
  getProviderOrder(orderId: string): Promise<PersistentProviderOrder | null>;
  getProviderOrderBySourceTx(sourceTxHash: string): Promise<PersistentProviderOrder | null>;
  updateProviderOrder(orderId: string, updates: Partial<PersistentProviderOrder>): Promise<PersistentProviderOrder>;
  listActiveProviderOrders(): Promise<PersistentProviderOrder[]>;

  // Settlement lifecycle
  recordSettlement(settlement: PersistentSettlement): Promise<void>;
  getSettlement(intentId: string): Promise<PersistentSettlement | null>;

  // Atomic state updates
  atomicRecordSourceSubmission(params: {
    intentId: string;
    stepId: string;
    sourceTxHash: string;
    providerOrderId: string;
    order: PersistentProviderOrder;
  }): Promise<void>;

  // Maintenance & cleanup
  clearAll(): Promise<void>;
}

export class InMemoryCrossChainStateRepository implements CrossChainStateRepository {
  private plans: Map<string, ExecutionPlan> = new Map();
  private planSteps: Map<string, Map<string, ExecutionPlanStep>> = new Map();
  private transactions: Map<string, PersistentTransaction> = new Map();
  private leases: Map<string, WorkerLease> = new Map();

  private intents: Map<string, PersistentIntent> = new Map();
  private steps: Map<string, PersistentExecutionStep> = new Map();
  private providerOrders: Map<string, PersistentProviderOrder> = new Map();
  private settlements: Map<string, PersistentSettlement> = new Map();
  private nonces: Set<string> = new Set();

  // ExecutionPlan methods
  public async saveExecutionPlan(plan: ExecutionPlan): Promise<void> {
    if (this.plans.has(plan.planId)) {
      throw new Error(`[InMemoryRepo] Duplicate ExecutionPlan ID: ${plan.planId}`);
    }
    const clonedPlan: ExecutionPlan = JSON.parse(JSON.stringify(plan));
    this.plans.set(plan.planId, clonedPlan);

    // Also persist individual steps
    const stepMap = new Map<string, ExecutionPlanStep>();
    for (const step of plan.steps) {
      stepMap.set(step.id, JSON.parse(JSON.stringify(step)));
    }
    this.planSteps.set(plan.planId, stepMap);
  }

  public async getExecutionPlan(planId: string): Promise<ExecutionPlan | null> {
    const plan = this.plans.get(planId);
    if (!plan) return null;
    const stepMap = this.planSteps.get(planId);
    const steps = stepMap
      ? Array.from(stepMap.values()).map((s) => JSON.parse(JSON.stringify(s)))
      : plan.steps;
    return {
      ...JSON.parse(JSON.stringify(plan)),
      steps
    };
  }

  public async updateExecutionPlan(planId: string, updates: Partial<ExecutionPlan>): Promise<ExecutionPlan> {
    const existing = this.plans.get(planId);
    if (!existing) {
      throw new Error(`[InMemoryRepo] ExecutionPlan ${planId} not found`);
    }
    if (updates.overallStatus && updates.overallStatus !== existing.overallStatus) {
      validatePlanStatusTransition(existing.overallStatus, updates.overallStatus);
    }
    const updated: ExecutionPlan = {
      ...existing,
      ...updates
    };
    this.plans.set(planId, updated);
    return JSON.parse(JSON.stringify(updated));
  }

  public async listActiveExecutionPlans(): Promise<ExecutionPlan[]> {
    const activePlans: ExecutionPlan[] = [];
    for (const plan of this.plans.values()) {
      const fullPlan = await this.getExecutionPlan(plan.planId);
      if (fullPlan) {
        const isComplete = fullPlan.steps.every((s) => s.status === 'SUCCESS');
        const isFailed = fullPlan.steps.some((s) => s.status === 'FAILED');
        if (!isComplete && !isFailed) {
          activePlans.push(fullPlan);
        }
      }
    }
    return activePlans;
  }

  // ExecutionPlanStep methods
  public async savePlanStep(planId: string, step: ExecutionPlanStep): Promise<void> {
    let stepMap = this.planSteps.get(planId);
    if (!stepMap) {
      stepMap = new Map();
      this.planSteps.set(planId, stepMap);
    }
    stepMap.set(step.id, JSON.parse(JSON.stringify(step)));
  }

  public async getPlanStep(planId: string, stepId: string): Promise<ExecutionPlanStep | null> {
    const stepMap = this.planSteps.get(planId);
    if (!stepMap) return null;
    const step = stepMap.get(stepId);
    return step ? JSON.parse(JSON.stringify(step)) : null;
  }

  public async getPlanSteps(planId: string): Promise<ExecutionPlanStep[]> {
    const stepMap = this.planSteps.get(planId);
    if (!stepMap) return [];
    return Array.from(stepMap.values()).map((s) => JSON.parse(JSON.stringify(s)));
  }

  public async updatePlanStep(planId: string, stepId: string, updates: Partial<ExecutionPlanStep>): Promise<ExecutionPlanStep> {
    const stepMap = this.planSteps.get(planId);
    if (!stepMap) {
      throw new Error(`[InMemoryRepo] Plan steps for ${planId} not found`);
    }
    const existing = stepMap.get(stepId);
    if (!existing) {
      throw new Error(`[InMemoryRepo] Step ${stepId} not found in plan ${planId}`);
    }
    if (updates.status && updates.status !== existing.status) {
      validateStepStatusTransition(existing.status, updates.status);
    }
    const updated: ExecutionPlanStep = {
      ...existing,
      ...updates
    };
    stepMap.set(stepId, updated);
    return JSON.parse(JSON.stringify(updated));
  }

  // Transaction Record methods
  public async createTransaction(tx: PersistentTransaction): Promise<void> {
    if (this.transactions.has(tx.transactionId)) {
      throw new Error(`[InMemoryRepo] Duplicate transaction ID: ${tx.transactionId}`);
    }
    // Critical validation: txHash MUST remain null/undefined before actual broadcast
    if (tx.state === 'CREATED' || tx.state === 'PREFLIGHTING' || tx.state === 'PREFLIGHT_PASSED' || tx.state === 'READY_TO_BROADCAST') {
      if (tx.txHash) {
        throw new Error(`[InMemoryRepo] Critical: txHash must remain undefined/null prior to genuine broadcast (found: "${tx.txHash}")`);
      }
    }
    this.transactions.set(tx.transactionId, {
      ...tx,
      createdAt: tx.createdAt || Date.now()
    });
  }

  public async getTransaction(transactionId: string): Promise<PersistentTransaction | null> {
    const tx = this.transactions.get(transactionId);
    return tx ? { ...tx } : null;
  }

  public async getTransactionByTxHash(txHash: string): Promise<PersistentTransaction | null> {
    const lower = txHash.toLowerCase();
    for (const tx of this.transactions.values()) {
      if (tx.txHash && tx.txHash.toLowerCase() === lower) {
        return { ...tx };
      }
    }
    return null;
  }

  public async getTransactionsForStep(planId: string, stepId: string): Promise<PersistentTransaction[]> {
    return Array.from(this.transactions.values())
      .filter((t) => t.planId === planId && t.stepId === stepId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((t) => ({ ...t }));
  }

  public async updateTransaction(transactionId: string, updates: Partial<PersistentTransaction>): Promise<PersistentTransaction> {
    const existing = this.transactions.get(transactionId);
    if (!existing) {
      throw new Error(`[InMemoryRepo] Transaction ${transactionId} not found`);
    }

    if (updates.state && updates.state !== existing.state) {
      validateTransactionStateTransition(existing.state, updates.state);
    }

    const updated: PersistentTransaction = {
      ...existing,
      ...updates
    };
    this.transactions.set(transactionId, updated);
    return { ...updated };
  }

  public async listUncertainTransactions(): Promise<PersistentTransaction[]> {
    return Array.from(this.transactions.values())
      .filter((t) => t.state === 'BROADCAST_UNCERTAIN' || t.state === 'RECOVERY_REQUIRED')
      .map((t) => ({ ...t }));
  }

  // Worker Lease methods
  public async acquireLease(resourceId: string, workerId: string, durationMs: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.leases.get(resourceId);

    if (existing && existing.expiresAt > now && existing.workerId !== workerId) {
      return false; // Active lease held by another worker
    }

    const lease: WorkerLease = {
      resourceId,
      workerId,
      acquiredAt: existing && existing.workerId === workerId ? existing.acquiredAt : now,
      expiresAt: now + durationMs,
      renewedAt: now
    };
    this.leases.set(resourceId, lease);
    return true;
  }

  public async renewLease(resourceId: string, workerId: string, durationMs: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.leases.get(resourceId);
    if (!existing || existing.workerId !== workerId || existing.expiresAt <= now) {
      return false;
    }
    existing.expiresAt = now + durationMs;
    existing.renewedAt = now;
    this.leases.set(resourceId, existing);
    return true;
  }

  public async releaseLease(resourceId: string, workerId: string): Promise<void> {
    const existing = this.leases.get(resourceId);
    if (existing && existing.workerId === workerId) {
      this.leases.delete(resourceId);
    }
  }

  public async getLease(resourceId: string): Promise<WorkerLease | null> {
    const lease = this.leases.get(resourceId);
    return lease ? { ...lease } : null;
  }

  public async listExpiredLeases(): Promise<WorkerLease[]> {
    const now = Date.now();
    return Array.from(this.leases.values())
      .filter((l) => l.expiresAt <= now)
      .map((l) => ({ ...l }));
  }

  // Intent lifecycle
  public async createIntent(intent: PersistentIntent): Promise<void> {
    const nonceKey = `${intent.userAddress.toLowerCase()}:${intent.sourceChainId}:${intent.destinationChainId}:${intent.nonce}`;
    if (this.nonces.has(nonceKey)) {
      throw new Error(`[InMemoryRepo] Nonce replay detected for ${intent.userAddress} (nonce: ${intent.nonce})`);
    }
    if (this.intents.has(intent.intentId)) {
      throw new Error(`[InMemoryRepo] Duplicate intent ID: ${intent.intentId}`);
    }
    this.nonces.add(nonceKey);
    this.intents.set(intent.intentId, {
      ...intent,
      createdAt: intent.createdAt || Date.now(),
      updatedAt: intent.updatedAt || Date.now()
    });
  }

  public async getIntent(intentId: string): Promise<PersistentIntent | null> {
    const item = this.intents.get(intentId);
    return item ? { ...item } : null;
  }

  public async updateIntent(intentId: string, updates: Partial<PersistentIntent>): Promise<PersistentIntent> {
    const existing = this.intents.get(intentId);
    if (!existing) {
      throw new Error(`[InMemoryRepo] Intent ${intentId} not found`);
    }
    if (updates.status && updates.status !== existing.status) {
      validateSettlementStateTransition(existing.status, updates.status);
    }
    const updated: PersistentIntent = {
      ...existing,
      ...updates,
      updatedAt: Date.now()
    };
    this.intents.set(intentId, updated);
    return { ...updated };
  }

  public async listPendingIntents(): Promise<PersistentIntent[]> {
    const pendingStates: SettlementState[] = ['CREATED', 'SIGNED', 'SUBMITTED', 'ACCEPTED', 'FULFILLING'];
    return Array.from(this.intents.values())
      .filter((i) => pendingStates.includes(i.status))
      .map((i) => ({ ...i }));
  }

  public async listRecoverableIntents(): Promise<PersistentIntent[]> {
    const terminalStates: SettlementState[] = ['SETTLED', 'FAILED', 'REFUNDED', 'CANCELLED'];
    return Array.from(this.intents.values())
      .filter((i) => !terminalStates.includes(i.status))
      .map((i) => ({ ...i }));
  }

  public async claimIntentLease(intentId: string, workerId: string, leaseDurationMs: number): Promise<boolean> {
    const existing = this.intents.get(intentId);
    if (!existing) return false;

    const now = Date.now();
    if (existing.leaseOwner && existing.leaseExpiresAt && existing.leaseExpiresAt > now && existing.leaseOwner !== workerId) {
      return false; // Lease held by another worker
    }

    existing.leaseOwner = workerId;
    existing.leaseExpiresAt = now + leaseDurationMs;
    existing.updatedAt = now;
    this.intents.set(intentId, existing);
    return true;
  }

  public async releaseIntentLease(intentId: string, workerId: string): Promise<void> {
    const existing = this.intents.get(intentId);
    if (existing && existing.leaseOwner === workerId) {
      existing.leaseOwner = undefined;
      existing.leaseExpiresAt = undefined;
      existing.updatedAt = Date.now();
      this.intents.set(intentId, existing);
    }
  }

  public async createStep(step: PersistentExecutionStep): Promise<void> {
    if (this.steps.has(step.stepId)) {
      throw new Error(`[InMemoryRepo] Duplicate step ID: ${step.stepId}`);
    }
    this.steps.set(step.stepId, {
      ...step,
      createdAt: step.createdAt || Date.now(),
      updatedAt: step.updatedAt || Date.now()
    });
  }

  public async getStep(stepId: string): Promise<PersistentExecutionStep | null> {
    const item = this.steps.get(stepId);
    return item ? { ...item } : null;
  }

  public async getStepsForIntent(intentId: string): Promise<PersistentExecutionStep[]> {
    return Array.from(this.steps.values())
      .filter((s) => s.intentId === intentId)
      .sort((a, b) => a.stepIndex - b.stepIndex)
      .map((s) => ({ ...s }));
  }

  public async updateStep(stepId: string, updates: Partial<PersistentExecutionStep>): Promise<PersistentExecutionStep> {
    const existing = this.steps.get(stepId);
    if (!existing) {
      throw new Error(`[InMemoryRepo] Step ${stepId} not found`);
    }
    const updated: PersistentExecutionStep = {
      ...existing,
      ...updates,
      updatedAt: Date.now()
    };
    this.steps.set(stepId, updated);
    return { ...updated };
  }

  public async createProviderOrder(order: PersistentProviderOrder): Promise<void> {
    if (this.providerOrders.has(order.orderId)) {
      throw new Error(`[InMemoryRepo] Duplicate provider order ID: ${order.orderId}`);
    }
    this.providerOrders.set(order.orderId, {
      ...order,
      createdAt: order.createdAt || Date.now(),
      updatedAt: order.updatedAt || Date.now()
    });
  }

  public async getProviderOrder(orderId: string): Promise<PersistentProviderOrder | null> {
    const item = this.providerOrders.get(orderId);
    return item ? { ...item } : null;
  }

  public async getProviderOrderBySourceTx(sourceTxHash: string): Promise<PersistentProviderOrder | null> {
    const item = Array.from(this.providerOrders.values()).find((o) => o.sourceTxHash.toLowerCase() === sourceTxHash.toLowerCase());
    return item ? { ...item } : null;
  }

  public async updateProviderOrder(orderId: string, updates: Partial<PersistentProviderOrder>): Promise<PersistentProviderOrder> {
    const existing = this.providerOrders.get(orderId);
    if (!existing) {
      throw new Error(`[InMemoryRepo] Provider order ${orderId} not found`);
    }
    const updated: PersistentProviderOrder = {
      ...existing,
      ...updates,
      updatedAt: Date.now()
    };
    this.providerOrders.set(orderId, updated);
    return { ...updated };
  }

  public async listActiveProviderOrders(): Promise<PersistentProviderOrder[]> {
    const activeStates: SettlementState[] = ['ACCEPTED', 'FULFILLING', 'DESTINATION_FILLED', 'SETTLING'];
    return Array.from(this.providerOrders.values())
      .filter((o) => activeStates.includes(o.status))
      .map((o) => ({ ...o }));
  }

  public async recordSettlement(settlement: PersistentSettlement): Promise<void> {
    this.settlements.set(settlement.intentId, { ...settlement });
  }

  public async getSettlement(intentId: string): Promise<PersistentSettlement | null> {
    const item = this.settlements.get(intentId);
    return item ? { ...item } : null;
  }

  public async atomicRecordSourceSubmission(params: {
    intentId: string;
    stepId: string;
    sourceTxHash: string;
    providerOrderId: string;
    order: PersistentProviderOrder;
  }): Promise<void> {
    const { intentId, stepId, sourceTxHash, order } = params;

    // 1. Update intent
    const intent = this.intents.get(intentId);
    if (intent) {
      intent.sourceTxHash = sourceTxHash;
      intent.status = 'FULFILLING';
      intent.updatedAt = Date.now();
      this.intents.set(intentId, intent);
    }

    // 2. Update step
    const step = this.steps.get(stepId);
    if (step) {
      step.txHash = sourceTxHash;
      step.status = 'ACTIVE';
      step.updatedAt = Date.now();
      this.steps.set(stepId, step);
    }

    // 3. Register provider order
    this.providerOrders.set(order.orderId, {
      ...order,
      sourceTxHash,
      status: 'FULFILLING',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }

  public async clearAll(): Promise<void> {
    this.plans.clear();
    this.planSteps.clear();
    this.transactions.clear();
    this.leases.clear();
    this.intents.clear();
    this.steps.clear();
    this.providerOrders.clear();
    this.settlements.clear();
    this.nonces.clear();
  }
}

export const defaultInMemoryRepository = new InMemoryCrossChainStateRepository();
