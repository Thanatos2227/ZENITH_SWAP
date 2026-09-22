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
import {
  CrossChainStateRepository,
  validateTransactionStateTransition,
  validatePlanStatusTransition,
  validateStepStatusTransition,
  validateSettlementStateTransition
} from './repository';

interface SQLiteDatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: any[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: any[]): any;
    all(...params: any[]): any[];
  };
  close(): void;
}

function getDatabaseSyncConstructor(): new (path: string) => SQLiteDatabaseSync {
  if (typeof window !== 'undefined' || typeof document !== 'undefined') {
    throw new Error('[SQLiteRepo] SQLiteCrossChainStateRepository is only supported in Node.js runtime environments.');
  }

  const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
  if (!isNode) {
    throw new Error('[SQLiteRepo] SQLiteCrossChainStateRepository is only supported in Node.js runtime environments.');
  }

  try {
    const nodeRequire = (globalThis as any).require || (typeof require !== 'undefined' ? require : undefined);
    if (typeof nodeRequire === 'function') {
      const sqliteModule = nodeRequire('node:sqlite');
      if (sqliteModule?.DatabaseSync) {
        return sqliteModule.DatabaseSync;
      }
    }
  } catch {
    // Ignore and proceed to throw error
  }

  throw new Error("[SQLiteRepo] Node.js 22+ built-in 'node:sqlite' DatabaseSync is not available in current environment.");
}

export class SQLiteCrossChainStateRepository implements CrossChainStateRepository {
  private db: SQLiteDatabaseSync;

  constructor(dbPath: string = ':memory:') {
    const DatabaseSyncClass = getDatabaseSyncConstructor();
    this.db = new DatabaseSyncClass(dbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS execution_plans (
        plan_id TEXT PRIMARY KEY,
        route_id TEXT NOT NULL,
        route_type TEXT,
        source_chain_id TEXT NOT NULL,
        destination_chain_id TEXT NOT NULL,
        token_in_json TEXT NOT NULL,
        token_out_json TEXT NOT NULL,
        expected_amount_in_raw TEXT NOT NULL,
        expected_amount_out_raw TEXT NOT NULL,
        min_amount_out_raw TEXT NOT NULL,
        is_executable INTEGER NOT NULL,
        unexecutable_reason TEXT,
        composite_execution_mode TEXT,
        diagnostics_json TEXT NOT NULL,
        current_step_index INTEGER NOT NULL DEFAULT 0,
        overall_status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plan_steps (
        plan_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        chain_id TEXT NOT NULL,
        numeric_chain_id INTEGER,
        execution_environment TEXT NOT NULL,
        target_address TEXT,
        calldata TEXT,
        value_wei TEXT,
        approval_target TEXT,
        required_token_address TEXT,
        required_token_symbol TEXT,
        required_amount_raw TEXT,
        status TEXT NOT NULL,
        tx_hash TEXT,
        block_number INTEGER,
        error TEXT,
        dependencies_json TEXT NOT NULL,
        retry_policy_json TEXT NOT NULL,
        verification_condition_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (plan_id, step_id),
        FOREIGN KEY (plan_id) REFERENCES execution_plans(plan_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS transactions (
        transaction_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        chain_id TEXT NOT NULL,
        nonce INTEGER,
        from_address TEXT NOT NULL,
        to_address TEXT NOT NULL,
        value_wei TEXT NOT NULL,
        calldata TEXT NOT NULL,
        gas_limit TEXT,
        max_fee_per_gas TEXT,
        max_priority_fee_per_gas TEXT,
        state TEXT NOT NULL,
        tx_hash TEXT,
        created_at INTEGER NOT NULL,
        broadcast_at INTEGER,
        confirmed_at INTEGER,
        block_number INTEGER,
        receipt_status INTEGER,
        error_message TEXT,
        FOREIGN KEY (plan_id, step_id) REFERENCES plan_steps(plan_id, step_id)
      );

      CREATE TABLE IF NOT EXISTS worker_leases (
        resource_id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL,
        acquired_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        renewed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS intents (
        intent_id TEXT PRIMARY KEY,
        user_address TEXT NOT NULL,
        source_chain_id TEXT NOT NULL,
        destination_chain_id TEXT NOT NULL,
        source_token_address TEXT NOT NULL,
        source_token_symbol TEXT NOT NULL,
        destination_token_address TEXT NOT NULL,
        destination_token_symbol TEXT NOT NULL,
        amount_in_raw TEXT NOT NULL,
        expected_amount_out_raw TEXT NOT NULL,
        min_amount_out_raw TEXT NOT NULL,
        provider TEXT NOT NULL,
        route_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        deadline INTEGER NOT NULL,
        status TEXT NOT NULL,
        source_tx_hash TEXT,
        destination_tx_hash TEXT,
        solver_id TEXT,
        lease_owner TEXT,
        lease_expires_at INTEGER,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS execution_steps (
        step_id TEXT PRIMARY KEY,
        intent_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        type TEXT NOT NULL,
        chain_id TEXT NOT NULL,
        status TEXT NOT NULL,
        depends_on TEXT NOT NULL,
        target_address TEXT,
        token_address TEXT,
        amount_raw TEXT,
        tx_hash TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (intent_id) REFERENCES intents(intent_id)
      );

      CREATE TABLE IF NOT EXISTS provider_orders (
        order_id TEXT PRIMARY KEY,
        intent_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        source_chain_id TEXT NOT NULL,
        destination_chain_id TEXT NOT NULL,
        source_tx_hash TEXT NOT NULL,
        destination_tx_hash TEXT,
        recipient TEXT NOT NULL,
        quote_json TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (intent_id) REFERENCES intents(intent_id)
      );

      CREATE TABLE IF NOT EXISTS settlements (
        intent_id TEXT PRIMARY KEY,
        destination_tx_hash TEXT NOT NULL,
        destination_chain_id TEXT NOT NULL,
        token_address TEXT NOT NULL,
        token_symbol TEXT NOT NULL,
        recipient TEXT NOT NULL,
        expected_amount_raw TEXT NOT NULL,
        actual_amount_raw TEXT NOT NULL,
        verified INTEGER NOT NULL,
        verified_at INTEGER NOT NULL,
        FOREIGN KEY (intent_id) REFERENCES intents(intent_id)
      );

      CREATE INDEX IF NOT EXISTS idx_plan_steps_plan ON plan_steps(plan_id);
      CREATE INDEX IF NOT EXISTS idx_tx_plan_step ON transactions(plan_id, step_id);
      CREATE INDEX IF NOT EXISTS idx_tx_hash ON transactions(tx_hash);
      CREATE INDEX IF NOT EXISTS idx_tx_state ON transactions(state);
      CREATE INDEX IF NOT EXISTS idx_intents_status ON intents(status);
      CREATE INDEX IF NOT EXISTS idx_steps_intent ON execution_steps(intent_id);
      CREATE INDEX IF NOT EXISTS idx_orders_intent ON provider_orders(intent_id);
      CREATE INDEX IF NOT EXISTS idx_orders_source_tx ON provider_orders(source_tx_hash);
    `);
  }

  // ==========================================
  // ExecutionPlan CRUD
  // ==========================================

  public async saveExecutionPlan(plan: ExecutionPlan): Promise<void> {
    const existing = this.db.prepare('SELECT plan_id FROM execution_plans WHERE plan_id = ?').get(plan.planId);
    if (existing) {
      throw new Error(`[SQLiteRepo] Duplicate ExecutionPlan ID: ${plan.planId}`);
    }

    const now = Date.now();
    this.db.exec('BEGIN TRANSACTION');
    try {
      const planStmt = this.db.prepare(`
        INSERT INTO execution_plans (
          plan_id, route_id, route_type, source_chain_id, destination_chain_id,
          token_in_json, token_out_json, expected_amount_in_raw, expected_amount_out_raw,
          min_amount_out_raw, is_executable, unexecutable_reason, composite_execution_mode,
          diagnostics_json, current_step_index, overall_status, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?
        )
      `);

      planStmt.run(
        plan.planId,
        plan.routeId,
        plan.routeType || null,
        plan.sourceChainId,
        plan.destinationChainId,
        JSON.stringify(plan.tokenIn),
        JSON.stringify(plan.tokenOut),
        plan.expectedAmountInRaw,
        plan.expectedAmountOutRaw,
        plan.minimumAmountOutRaw,
        plan.isExecutable ? 1 : 0,
        plan.unexecutableReason || null,
        plan.compositeExecutionMode || null,
        JSON.stringify(plan.diagnostics || []),
        plan.currentStepIndex ?? 0,
        plan.overallStatus || 'IDLE',
        plan.createdAt || now,
        plan.updatedAt || now
      );

      const stepStmt = this.db.prepare(`
        INSERT INTO plan_steps (
          plan_id, step_id, step_index, type, title, description,
          chain_id, numeric_chain_id, execution_environment, target_address,
          calldata, value_wei, approval_target, required_token_address,
          required_token_symbol, required_amount_raw, status, tx_hash,
          block_number, error, dependencies_json, retry_policy_json,
          verification_condition_json, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?
        )
      `);

      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        stepStmt.run(
          plan.planId,
          step.id,
          i,
          step.type,
          step.title || '',
          step.description || '',
          step.chainId,
          step.numericChainId || null,
          step.executionEnvironment,
          step.targetAddress || null,
          step.calldata || null,
          step.valueWei || null,
          step.approvalTarget || null,
          step.requiredTokenAddress || null,
          step.requiredTokenSymbol || null,
          step.requiredAmountRaw || null,
          step.status,
          step.txHash || null,
          step.blockNumber || null,
          step.error || null,
          JSON.stringify(step.dependencies || []),
          JSON.stringify(step.retryPolicy || { maxAttempts: 1, backoffMs: 1000, timeoutMs: 60000, retryableErrors: [] }),
          step.verificationCondition ? JSON.stringify(step.verificationCondition) : null,
          now,
          now
        );
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public async getExecutionPlan(planId: string): Promise<ExecutionPlan | null> {
    const row: any = this.db.prepare('SELECT * FROM execution_plans WHERE plan_id = ?').get(planId);
    if (!row) return null;

    const stepRows: any[] = this.db.prepare('SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY step_index ASC').all(planId);
    const steps: ExecutionPlanStep[] = stepRows.map((sr) => this.mapRowToPlanStep(sr));

    return {
      planId: row.plan_id,
      routeId: row.route_id,
      routeType: row.route_type || 'DIRECT',
      sourceChainId: row.source_chain_id,
      destinationChainId: row.destination_chain_id,
      tokenIn: JSON.parse(row.token_in_json),
      tokenOut: JSON.parse(row.token_out_json),
      expectedAmountInRaw: row.expected_amount_in_raw,
      expectedAmountOutRaw: row.expected_amount_out_raw,
      minimumAmountOutRaw: row.min_amount_out_raw,
      isExecutable: Boolean(row.is_executable),
      unexecutableReason: row.unexecutable_reason || undefined,
      compositeExecutionMode: row.composite_execution_mode || undefined,
      diagnostics: JSON.parse(row.diagnostics_json || '[]'),
      steps,
      currentStepIndex: row.current_step_index ?? 0,
      overallStatus: (row.overall_status as any) || 'IDLE',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  public async updateExecutionPlan(planId: string, updates: Partial<ExecutionPlan>): Promise<ExecutionPlan> {
    const current = await this.getExecutionPlan(planId);
    if (!current) {
      throw new Error(`[SQLiteRepo] ExecutionPlan ${planId} not found`);
    }

    if (updates.overallStatus && updates.overallStatus !== current.overallStatus) {
      validatePlanStatusTransition(current.overallStatus, updates.overallStatus);
    }

    const updated: ExecutionPlan = {
      ...current,
      ...updates
    };

    const stmt = this.db.prepare(`
      UPDATE execution_plans SET
        is_executable = ?,
        unexecutable_reason = ?,
        composite_execution_mode = ?,
        diagnostics_json = ?,
        overall_status = ?,
        current_step_index = ?,
        updated_at = ?
      WHERE plan_id = ?
    `);

    stmt.run(
      updated.isExecutable ? 1 : 0,
      updated.unexecutableReason || null,
      updated.compositeExecutionMode || null,
      JSON.stringify(updated.diagnostics || []),
      updated.overallStatus || 'IDLE',
      updated.currentStepIndex ?? 0,
      Date.now(),
      planId
    );

    return updated;
  }

  public async listActiveExecutionPlans(): Promise<ExecutionPlan[]> {
    const rows: any[] = this.db.prepare("SELECT plan_id FROM execution_plans WHERE overall_status != 'COMPLETED' AND overall_status != 'FAILED'").all();
    const plans: ExecutionPlan[] = [];
    for (const r of rows) {
      const plan = await this.getExecutionPlan(r.plan_id);
      if (plan) {
        const isComplete = plan.steps.every((s) => s.status === 'SUCCESS');
        const isFailed = plan.steps.some((s) => s.status === 'FAILED');
        if (!isComplete && !isFailed) {
          plans.push(plan);
        }
      }
    }
    return plans;
  }

  // ==========================================
  // Plan Steps CRUD
  // ==========================================

  public async savePlanStep(planId: string, step: ExecutionPlanStep): Promise<void> {
    const existing: any = this.db.prepare('SELECT step_id FROM plan_steps WHERE plan_id = ? AND step_id = ?').get(planId, step.id);
    const now = Date.now();

    if (existing) {
      await this.updatePlanStep(planId, step.id, step);
      return;
    }

    const maxIdxRow: any = this.db.prepare('SELECT MAX(step_index) as max_idx FROM plan_steps WHERE plan_id = ?').get(planId);
    const nextIdx = (maxIdxRow?.max_idx ?? -1) + 1;

    const stmt = this.db.prepare(`
      INSERT INTO plan_steps (
        plan_id, step_id, step_index, type, title, description,
        chain_id, numeric_chain_id, execution_environment, target_address,
        calldata, value_wei, approval_target, required_token_address,
        required_token_symbol, required_amount_raw, status, tx_hash,
        block_number, error, dependencies_json, retry_policy_json,
        verification_condition_json, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
    `);

    stmt.run(
      planId,
      step.id,
      nextIdx,
      step.type,
      step.title || '',
      step.description || '',
      step.chainId,
      step.numericChainId || null,
      step.executionEnvironment,
      step.targetAddress || null,
      step.calldata || null,
      step.valueWei || null,
      step.approvalTarget || null,
      step.requiredTokenAddress || null,
      step.requiredTokenSymbol || null,
      step.requiredAmountRaw || null,
      step.status,
      step.txHash || null,
      step.blockNumber || null,
      step.error || null,
      JSON.stringify(step.dependencies || []),
      JSON.stringify(step.retryPolicy || { maxAttempts: 1, backoffMs: 1000, timeoutMs: 60000, retryableErrors: [] }),
      step.verificationCondition ? JSON.stringify(step.verificationCondition) : null,
      now,
      now
    );
  }

  public async getPlanStep(planId: string, stepId: string): Promise<ExecutionPlanStep | null> {
    const row: any = this.db.prepare('SELECT * FROM plan_steps WHERE plan_id = ? AND step_id = ?').get(planId, stepId);
    if (!row) return null;
    return this.mapRowToPlanStep(row);
  }

  public async getPlanSteps(planId: string): Promise<ExecutionPlanStep[]> {
    const rows: any[] = this.db.prepare('SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY step_index ASC').all(planId);
    return rows.map((r) => this.mapRowToPlanStep(r));
  }

  public async updatePlanStep(planId: string, stepId: string, updates: Partial<ExecutionPlanStep>): Promise<ExecutionPlanStep> {
    const current = await this.getPlanStep(planId, stepId);
    if (!current) {
      throw new Error(`[SQLiteRepo] Step ${stepId} in plan ${planId} not found`);
    }

    if (updates.status && updates.status !== current.status) {
      validateStepStatusTransition(current.status, updates.status);
    }

    const updated: ExecutionPlanStep = {
      ...current,
      ...updates
    };

    const stmt = this.db.prepare(`
      UPDATE plan_steps SET
        status = ?,
        tx_hash = ?,
        block_number = ?,
        error = ?,
        required_amount_raw = ?,
        calldata = ?,
        target_address = ?,
        approval_target = ?,
        updated_at = ?
      WHERE plan_id = ? AND step_id = ?
    `);

    stmt.run(
      updated.status,
      updated.txHash || null,
      updated.blockNumber || null,
      updated.error || null,
      updated.requiredAmountRaw || null,
      updated.calldata || null,
      updated.targetAddress || null,
      updated.approvalTarget || null,
      Date.now(),
      planId,
      stepId
    );

    return updated;
  }

  // ==========================================
  // Persistent Transactions CRUD
  // ==========================================

  public async createTransaction(tx: PersistentTransaction): Promise<void> {
    const existing = this.db.prepare('SELECT transaction_id FROM transactions WHERE transaction_id = ?').get(tx.transactionId);
    if (existing) {
      throw new Error(`[SQLiteRepo] Duplicate transaction ID: ${tx.transactionId}`);
    }

    // Critical validation: txHash MUST remain null/undefined before actual broadcast
    if (tx.state === 'CREATED' || tx.state === 'PREFLIGHTING' || tx.state === 'PREFLIGHT_PASSED' || tx.state === 'READY_TO_BROADCAST') {
      if (tx.txHash) {
        throw new Error(`[SQLiteRepo] Critical: txHash must remain undefined/null prior to genuine broadcast (found: "${tx.txHash}")`);
      }
    }

    const stmt = this.db.prepare(`
      INSERT INTO transactions (
        transaction_id, plan_id, step_id, chain_id, nonce,
        from_address, to_address, value_wei, calldata,
        gas_limit, max_fee_per_gas, max_priority_fee_per_gas,
        state, tx_hash, created_at, broadcast_at, confirmed_at,
        block_number, receipt_status, error_message
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?
      )
    `);

    stmt.run(
      tx.transactionId,
      tx.planId,
      tx.stepId,
      tx.chainId,
      tx.nonce != null ? tx.nonce : null,
      tx.fromAddress,
      tx.toAddress,
      tx.valueWei,
      tx.calldata,
      tx.gasLimit || null,
      tx.maxFeePerGas || null,
      tx.maxPriorityFeePerGas || null,
      tx.state,
      tx.txHash || null,
      tx.createdAt || Date.now(),
      tx.broadcastAt || null,
      tx.confirmedAt || null,
      tx.blockNumber || null,
      tx.receiptStatus != null ? tx.receiptStatus : null,
      tx.errorMessage || null
    );
  }

  public async getTransaction(transactionId: string): Promise<PersistentTransaction | null> {
    const row: any = this.db.prepare('SELECT * FROM transactions WHERE transaction_id = ?').get(transactionId);
    if (!row) return null;
    return this.mapRowToTransaction(row);
  }

  public async getTransactionByTxHash(txHash: string): Promise<PersistentTransaction | null> {
    const row: any = this.db.prepare('SELECT * FROM transactions WHERE LOWER(tx_hash) = ?').get(txHash.toLowerCase());
    if (!row) return null;
    return this.mapRowToTransaction(row);
  }

  public async getTransactionsForStep(planId: string, stepId: string): Promise<PersistentTransaction[]> {
    const rows: any[] = this.db.prepare('SELECT * FROM transactions WHERE plan_id = ? AND step_id = ? ORDER BY created_at ASC').all(planId, stepId);
    return rows.map((r) => this.mapRowToTransaction(r));
  }

  public async updateTransaction(transactionId: string, updates: Partial<PersistentTransaction>): Promise<PersistentTransaction> {
    const current = await this.getTransaction(transactionId);
    if (!current) {
      throw new Error(`[SQLiteRepo] Transaction ${transactionId} not found`);
    }

    if (updates.state && updates.state !== current.state) {
      validateTransactionStateTransition(current.state, updates.state);
    }

    const updated: PersistentTransaction = {
      ...current,
      ...updates
    };

    const stmt = this.db.prepare(`
      UPDATE transactions SET
        nonce = ?,
        state = ?,
        tx_hash = ?,
        broadcast_at = ?,
        confirmed_at = ?,
        block_number = ?,
        receipt_status = ?,
        error_message = ?
      WHERE transaction_id = ?
    `);

    stmt.run(
      updated.nonce != null ? updated.nonce : null,
      updated.state,
      updated.txHash || null,
      updated.broadcastAt || null,
      updated.confirmedAt || null,
      updated.blockNumber || null,
      updated.receiptStatus != null ? updated.receiptStatus : null,
      updated.errorMessage || null,
      transactionId
    );

    return updated;
  }

  public async listUncertainTransactions(): Promise<PersistentTransaction[]> {
    const rows: any[] = this.db.prepare("SELECT * FROM transactions WHERE state IN ('BROADCAST_UNCERTAIN', 'RECOVERY_REQUIRED')").all();
    return rows.map((r) => this.mapRowToTransaction(r));
  }

  // ==========================================
  // Worker Lease CRUD
  // ==========================================

  public async acquireLease(resourceId: string, workerId: string, durationMs: number): Promise<boolean> {
    const now = Date.now();
    const existing: any = this.db.prepare('SELECT * FROM worker_leases WHERE resource_id = ?').get(resourceId);

    if (existing && existing.expires_at > now && existing.worker_id !== workerId) {
      return false; // Active lease held by another worker
    }

    const acquiredAt = existing && existing.worker_id === workerId ? existing.acquired_at : now;
    const expiresAt = now + durationMs;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO worker_leases (
        resource_id, worker_id, acquired_at, expires_at, renewed_at
      ) VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(resourceId, workerId, acquiredAt, expiresAt, now);
    return true;
  }

  public async renewLease(resourceId: string, workerId: string, durationMs: number): Promise<boolean> {
    const now = Date.now();
    const existing: any = this.db.prepare('SELECT * FROM worker_leases WHERE resource_id = ?').get(resourceId);

    if (!existing || existing.worker_id !== workerId || existing.expires_at <= now) {
      return false;
    }

    const expiresAt = now + durationMs;
    const stmt = this.db.prepare('UPDATE worker_leases SET expires_at = ?, renewed_at = ? WHERE resource_id = ?');
    stmt.run(expiresAt, now, resourceId);
    return true;
  }

  public async releaseLease(resourceId: string, workerId: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM worker_leases WHERE resource_id = ? AND worker_id = ?');
    stmt.run(resourceId, workerId);
  }

  public async getLease(resourceId: string): Promise<WorkerLease | null> {
    const row: any = this.db.prepare('SELECT * FROM worker_leases WHERE resource_id = ?').get(resourceId);
    if (!row) return null;
    return {
      resourceId: row.resource_id,
      workerId: row.worker_id,
      acquiredAt: row.acquired_at,
      expiresAt: row.expires_at,
      renewedAt: row.renewed_at
    };
  }

  public async listExpiredLeases(): Promise<WorkerLease[]> {
    const now = Date.now();
    const rows: any[] = this.db.prepare('SELECT * FROM worker_leases WHERE expires_at <= ?').all(now);
    return rows.map((r) => ({
      resourceId: r.resource_id,
      workerId: r.worker_id,
      acquiredAt: r.acquired_at,
      expiresAt: r.expires_at,
      renewedAt: r.renewed_at
    }));
  }

  // ==========================================
  // Legacy Intent & Settlement CRUD
  // ==========================================

  public async createIntent(intent: PersistentIntent): Promise<void> {
    const existing = this.db.prepare('SELECT intent_id FROM intents WHERE intent_id = ?').get(intent.intentId);
    if (existing) {
      throw new Error(`[SQLiteRepo] Duplicate intent ID: ${intent.intentId}`);
    }

    const nonceCheck = this.db.prepare(
      'SELECT intent_id FROM intents WHERE LOWER(user_address) = ? AND source_chain_id = ? AND destination_chain_id = ? AND nonce = ?'
    ).get(intent.userAddress.toLowerCase(), intent.sourceChainId, intent.destinationChainId, intent.nonce);

    if (nonceCheck) {
      throw new Error(`[SQLiteRepo] Nonce replay detected for ${intent.userAddress} (nonce: ${intent.nonce})`);
    }

    const stmt = this.db.prepare(`
      INSERT INTO intents (
        intent_id, user_address, source_chain_id, destination_chain_id,
        source_token_address, source_token_symbol, destination_token_address, destination_token_symbol,
        amount_in_raw, expected_amount_out_raw, min_amount_out_raw,
        provider, route_id, nonce, deadline, status,
        source_tx_hash, destination_tx_hash, solver_id, lease_owner, lease_expires_at, error_message,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?
      )
    `);

    stmt.run(
      intent.intentId,
      intent.userAddress,
      intent.sourceChainId,
      intent.destinationChainId,
      intent.sourceTokenAddress,
      intent.sourceTokenSymbol,
      intent.destinationTokenAddress,
      intent.destinationTokenSymbol,
      intent.amountInRaw,
      intent.expectedAmountOutRaw,
      intent.minAmountOutRaw,
      intent.provider,
      intent.routeId,
      intent.nonce,
      intent.deadline,
      intent.status,
      intent.sourceTxHash || null,
      intent.destinationTxHash || null,
      intent.solverId || null,
      intent.leaseOwner || null,
      intent.leaseExpiresAt || null,
      intent.errorMessage || null,
      intent.createdAt || Date.now(),
      intent.updatedAt || Date.now()
    );
  }

  public async getIntent(intentId: string): Promise<PersistentIntent | null> {
    const row: any = this.db.prepare('SELECT * FROM intents WHERE intent_id = ?').get(intentId);
    if (!row) return null;
    return this.mapRowToIntent(row);
  }

  public async updateIntent(intentId: string, updates: Partial<PersistentIntent>): Promise<PersistentIntent> {
    const current = await this.getIntent(intentId);
    if (!current) {
      throw new Error(`[SQLiteRepo] Intent ${intentId} not found`);
    }

    if (updates.status && updates.status !== current.status) {
      validateSettlementStateTransition(current.status, updates.status);
    }

    const updated: PersistentIntent = {
      ...current,
      ...updates,
      updatedAt: Date.now()
    };

    const stmt = this.db.prepare(`
      UPDATE intents SET
        status = ?,
        source_tx_hash = ?,
        destination_tx_hash = ?,
        solver_id = ?,
        lease_owner = ?,
        lease_expires_at = ?,
        error_message = ?,
        updated_at = ?
      WHERE intent_id = ?
    `);

    stmt.run(
      updated.status,
      updated.sourceTxHash || null,
      updated.destinationTxHash || null,
      updated.solverId || null,
      updated.leaseOwner || null,
      updated.leaseExpiresAt || null,
      updated.errorMessage || null,
      updated.updatedAt,
      intentId
    );

    return updated;
  }

  public async listPendingIntents(): Promise<PersistentIntent[]> {
    const rows: any[] = this.db.prepare(
      "SELECT * FROM intents WHERE status IN ('CREATED', 'SIGNED', 'SUBMITTED', 'ACCEPTED', 'FULFILLING')"
    ).all();
    return rows.map((r) => this.mapRowToIntent(r));
  }

  public async listRecoverableIntents(): Promise<PersistentIntent[]> {
    const rows: any[] = this.db.prepare(
      "SELECT * FROM intents WHERE status NOT IN ('SETTLED', 'FAILED', 'REFUNDED', 'CANCELLED')"
    ).all();
    return rows.map((r) => this.mapRowToIntent(r));
  }

  public async claimIntentLease(intentId: string, workerId: string, leaseDurationMs: number): Promise<boolean> {
    const now = Date.now();
    const row: any = this.db.prepare('SELECT lease_owner, lease_expires_at FROM intents WHERE intent_id = ?').get(intentId);
    if (!row) return false;

    if (row.lease_owner && row.lease_expires_at && row.lease_expires_at > now && row.lease_owner !== workerId) {
      return false; // Active lease held by another worker
    }

    const expiresAt = now + leaseDurationMs;
    const stmt = this.db.prepare(
      'UPDATE intents SET lease_owner = ?, lease_expires_at = ?, updated_at = ? WHERE intent_id = ?'
    );
    stmt.run(workerId, expiresAt, now, intentId);
    return true;
  }

  public async releaseIntentLease(intentId: string, workerId: string): Promise<void> {
    const stmt = this.db.prepare(
      'UPDATE intents SET lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE intent_id = ? AND lease_owner = ?'
    );
    stmt.run(Date.now(), intentId, workerId);
  }

  public async createStep(step: PersistentExecutionStep): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO execution_steps (
        step_id, intent_id, step_index, type, chain_id, status,
        depends_on, target_address, token_address, amount_raw, tx_hash, error,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?
      )
    `);

    stmt.run(
      step.stepId,
      step.intentId,
      step.stepIndex,
      step.type,
      step.chainId,
      step.status,
      JSON.stringify(step.dependsOn || []),
      step.targetAddress || null,
      step.tokenAddress || null,
      step.amountRaw || null,
      step.txHash || null,
      step.error || null,
      step.createdAt || Date.now(),
      step.updatedAt || Date.now()
    );
  }

  public async getStep(stepId: string): Promise<PersistentExecutionStep | null> {
    const row: any = this.db.prepare('SELECT * FROM execution_steps WHERE step_id = ?').get(stepId);
    if (!row) return null;
    return this.mapRowToStep(row);
  }

  public async getStepsForIntent(intentId: string): Promise<PersistentExecutionStep[]> {
    const rows: any[] = this.db.prepare(
      'SELECT * FROM execution_steps WHERE intent_id = ? ORDER BY step_index ASC'
    ).all(intentId);
    return rows.map((r) => this.mapRowToStep(r));
  }

  public async updateStep(stepId: string, updates: Partial<PersistentExecutionStep>): Promise<PersistentExecutionStep> {
    const current = await this.getStep(stepId);
    if (!current) {
      throw new Error(`[SQLiteRepo] Step ${stepId} not found`);
    }

    const updated: PersistentExecutionStep = {
      ...current,
      ...updates,
      updatedAt: Date.now()
    };

    const stmt = this.db.prepare(`
      UPDATE execution_steps SET
        status = ?,
        tx_hash = ?,
        error = ?,
        updated_at = ?
      WHERE step_id = ?
    `);

    stmt.run(
      updated.status,
      updated.txHash || null,
      updated.error || null,
      updated.updatedAt,
      stepId
    );

    return updated;
  }

  public async createProviderOrder(order: PersistentProviderOrder): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO provider_orders (
        order_id, intent_id, provider, source_chain_id, destination_chain_id,
        source_tx_hash, destination_tx_hash, recipient, quote_json, status, error_message,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?
      )
    `);

    stmt.run(
      order.orderId,
      order.intentId,
      order.provider,
      order.sourceChainId,
      order.destinationChainId,
      order.sourceTxHash,
      order.destinationTxHash || null,
      order.recipient,
      order.quoteJson,
      order.status,
      order.errorMessage || null,
      order.createdAt || Date.now(),
      order.updatedAt || Date.now()
    );
  }

  public async getProviderOrder(orderId: string): Promise<PersistentProviderOrder | null> {
    const row: any = this.db.prepare('SELECT * FROM provider_orders WHERE order_id = ?').get(orderId);
    if (!row) return null;
    return this.mapRowToOrder(row);
  }

  public async getProviderOrderBySourceTx(sourceTxHash: string): Promise<PersistentProviderOrder | null> {
    const row: any = this.db.prepare(
      'SELECT * FROM provider_orders WHERE LOWER(source_tx_hash) = ?'
    ).get(sourceTxHash.toLowerCase());
    if (!row) return null;
    return this.mapRowToOrder(row);
  }

  public async updateProviderOrder(orderId: string, updates: Partial<PersistentProviderOrder>): Promise<PersistentProviderOrder> {
    const current = await this.getProviderOrder(orderId);
    if (!current) {
      throw new Error(`[SQLiteRepo] Provider order ${orderId} not found`);
    }

    const updated: PersistentProviderOrder = {
      ...current,
      ...updates,
      updatedAt: Date.now()
    };

    const stmt = this.db.prepare(`
      UPDATE provider_orders SET
        destination_tx_hash = ?,
        status = ?,
        error_message = ?,
        updated_at = ?
      WHERE order_id = ?
    `);

    stmt.run(
      updated.destinationTxHash || null,
      updated.status,
      updated.errorMessage || null,
      updated.updatedAt,
      orderId
    );

    return updated;
  }

  public async listActiveProviderOrders(): Promise<PersistentProviderOrder[]> {
    const rows: any[] = this.db.prepare(
      "SELECT * FROM provider_orders WHERE status IN ('ACCEPTED', 'FULFILLING', 'DESTINATION_FILLED', 'SETTLING')"
    ).all();
    return rows.map((r) => this.mapRowToOrder(r));
  }

  public async recordSettlement(settlement: PersistentSettlement): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO settlements (
        intent_id, destination_tx_hash, destination_chain_id,
        token_address, token_symbol, recipient,
        expected_amount_raw, actual_amount_raw, verified, verified_at
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?
      )
    `);

    stmt.run(
      settlement.intentId,
      settlement.destinationTxHash,
      settlement.destinationChainId,
      settlement.tokenAddress,
      settlement.tokenSymbol,
      settlement.recipient,
      settlement.expectedAmountRaw,
      settlement.actualAmountRaw,
      settlement.verified ? 1 : 0,
      settlement.verifiedAt || Date.now()
    );
  }

  public async getSettlement(intentId: string): Promise<PersistentSettlement | null> {
    const row: any = this.db.prepare('SELECT * FROM settlements WHERE intent_id = ?').get(intentId);
    if (!row) return null;
    return {
      intentId: row.intent_id,
      destinationTxHash: row.destination_tx_hash,
      destinationChainId: row.destination_chain_id,
      tokenAddress: row.token_address,
      tokenSymbol: row.token_symbol,
      recipient: row.recipient,
      expectedAmountRaw: row.expected_amount_raw,
      actualAmountRaw: row.actual_amount_raw,
      verified: Boolean(row.verified),
      verifiedAt: row.verified_at
    };
  }

  public async atomicRecordSourceSubmission(params: {
    intentId: string;
    stepId: string;
    sourceTxHash: string;
    providerOrderId: string;
    order: PersistentProviderOrder;
  }): Promise<void> {
    const { intentId, stepId, sourceTxHash, order } = params;
    const now = Date.now();

    this.db.exec('BEGIN TRANSACTION');
    try {
      // 1. Update intent
      this.db.prepare(`
        UPDATE intents SET source_tx_hash = ?, status = 'FULFILLING', updated_at = ? WHERE intent_id = ?
      `).run(sourceTxHash, now, intentId);

      // 2. Update step
      this.db.prepare(`
        UPDATE execution_steps SET tx_hash = ?, status = 'ACTIVE', updated_at = ? WHERE step_id = ?
      `).run(sourceTxHash, now, stepId);

      // 3. Register provider order
      this.db.prepare(`
        INSERT OR REPLACE INTO provider_orders (
          order_id, intent_id, provider, source_chain_id, destination_chain_id,
          source_tx_hash, destination_tx_hash, recipient, quote_json, status, error_message,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?
        )
      `).run(
        order.orderId,
        intentId,
        order.provider,
        order.sourceChainId,
        order.destinationChainId,
        sourceTxHash,
        order.destinationTxHash || null,
        order.recipient,
        order.quoteJson,
        'FULFILLING',
        null,
        now,
        now
      );

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public async clearAll(): Promise<void> {
    this.db.exec(`
      DELETE FROM settlements;
      DELETE FROM provider_orders;
      DELETE FROM execution_steps;
      DELETE FROM intents;
      DELETE FROM transactions;
      DELETE FROM plan_steps;
      DELETE FROM execution_plans;
      DELETE FROM worker_leases;
    `);
  }

  private mapRowToPlanStep(row: any): ExecutionPlanStep {
    return {
      id: row.step_id,
      type: row.type,
      title: row.title,
      description: row.description,
      chainId: row.chain_id,
      numericChainId: row.numeric_chain_id || undefined,
      executionEnvironment: row.execution_environment,
      targetAddress: row.target_address || undefined,
      calldata: row.calldata || undefined,
      valueWei: row.value_wei || undefined,
      approvalTarget: row.approval_target || undefined,
      requiredTokenAddress: row.required_token_address || undefined,
      requiredTokenSymbol: row.required_token_symbol || undefined,
      requiredAmountRaw: row.required_amount_raw || undefined,
      status: row.status,
      txHash: row.tx_hash || undefined,
      blockNumber: row.block_number || undefined,
      error: row.error || undefined,
      dependencies: JSON.parse(row.dependencies_json || '[]'),
      retryPolicy: JSON.parse(row.retry_policy_json || '{"maxAttempts":1,"backoffMs":1000,"timeoutMs":60000,"retryableErrors":[]}'),
      verificationCondition: row.verification_condition_json ? JSON.parse(row.verification_condition_json) : undefined
    };
  }

  private mapRowToTransaction(row: any): PersistentTransaction {
    return {
      transactionId: row.transaction_id,
      planId: row.plan_id,
      stepId: row.step_id,
      chainId: row.chain_id,
      nonce: row.nonce != null ? row.nonce : undefined,
      fromAddress: row.from_address,
      toAddress: row.to_address,
      valueWei: row.value_wei,
      calldata: row.calldata,
      gasLimit: row.gas_limit || undefined,
      maxFeePerGas: row.max_fee_per_gas || undefined,
      maxPriorityFeePerGas: row.max_priority_fee_per_gas || undefined,
      state: row.state as TransactionLifecycleState,
      txHash: row.tx_hash || undefined,
      createdAt: row.created_at,
      broadcastAt: row.broadcast_at || undefined,
      confirmedAt: row.confirmed_at || undefined,
      blockNumber: row.block_number || undefined,
      receiptStatus: row.receipt_status != null ? row.receipt_status : undefined,
      errorMessage: row.error_message || undefined
    };
  }

  private mapRowToIntent(row: any): PersistentIntent {
    return {
      intentId: row.intent_id,
      userAddress: row.user_address,
      sourceChainId: row.source_chain_id,
      destinationChainId: row.destination_chain_id,
      sourceTokenAddress: row.source_token_address,
      sourceTokenSymbol: row.source_token_symbol,
      destinationTokenAddress: row.destination_token_address,
      destinationTokenSymbol: row.destination_token_symbol,
      amountInRaw: row.amount_in_raw,
      expectedAmountOutRaw: row.expected_amount_out_raw,
      minAmountOutRaw: row.min_amount_out_raw,
      provider: row.provider,
      routeId: row.route_id,
      nonce: row.nonce,
      deadline: row.deadline,
      status: row.status as SettlementState,
      sourceTxHash: row.source_tx_hash || undefined,
      destinationTxHash: row.destination_tx_hash || undefined,
      solverId: row.solver_id || undefined,
      leaseOwner: row.lease_owner || undefined,
      leaseExpiresAt: row.lease_expires_at || undefined,
      errorMessage: row.error_message || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapRowToStep(row: any): PersistentExecutionStep {
    let dependsOn: string[] = [];
    try {
      dependsOn = JSON.parse(row.depends_on);
    } catch {
      dependsOn = [];
    }

    return {
      stepId: row.step_id,
      intentId: row.intent_id,
      stepIndex: row.step_index,
      type: row.type,
      chainId: row.chain_id,
      status: row.status,
      dependsOn,
      targetAddress: row.target_address || undefined,
      tokenAddress: row.token_address || undefined,
      amountRaw: row.amount_raw || undefined,
      txHash: row.tx_hash || undefined,
      error: row.error || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapRowToOrder(row: any): PersistentProviderOrder {
    return {
      orderId: row.order_id,
      intentId: row.intent_id,
      provider: row.provider,
      sourceChainId: row.source_chain_id,
      destinationChainId: row.destination_chain_id,
      sourceTxHash: row.source_tx_hash,
      destinationTxHash: row.destination_tx_hash || undefined,
      recipient: row.recipient,
      quoteJson: row.quote_json,
      status: row.status as SettlementState,
      errorMessage: row.error_message || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  public close(): void {
    try {
      this.db.close();
    } catch {
      // Ignore if already closed
    }
  }
}
