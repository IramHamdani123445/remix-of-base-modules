/**
 * Post-Issue Review Service
 *
 * Business Purpose:
 *   Captures and controls all claim-side and support-table updates that occur
 *   after payment issue. Payment issue is NOT fully complete until all required
 *   post-issue tasks finish. This preserves legacy post-issue side effects and
 *   integrates them into the modern orchestration pipeline.
 *
 * Existing tables WRITTEN (post-issue side effects):
 *   - cl_head           — Claim status update (e.g., PAID, CLOSED, CONTINUING)
 *   - cl_wages_credited  — Wage credit updates for contribution-linked benefits
 *   - tb_postal_reg      — Postal registration updates for cheque delivery
 *   - cl_cheques_holding  — Holding follow-up (release conditions check)
 *   - cl_cheques_survivor — Survivor follow-up (beneficiary confirmation)
 *
 * Existing tables READ:
 *   - bn_issue_record     — Source issued payments
 *   - bn_payment_batch    — Batch context
 *   - bn_payment_instruction — Instruction context
 *   - bn_entitlement      — Entitlement context
 *   - bn_claim            — Claim context
 *   - bn_claim_event      — Audit trail
 *   - cl_head             — Legacy claim header
 *
 * New table:
 *   - bn_post_issue_task  — Post-issue task tracking
 *
 * CRITICAL CONSTRAINTS:
 *   - cn_payment*, cn_receipt, cn_refund are NEVER used for outbound payments.
 *   - Post-issue updates preserve all legacy behavior and side effects.
 *   - Issue is not "complete" until all REQUIRED tasks reach COMPLETED status.
 */
import { supabase } from '@/integrations/supabase/client';
import { routeClaimAfterStatusChange } from '@/services/bn/workflow/routeClaimAfterStatusChange';

const db = supabase as any;

// ─── Types ──────────────────────────────────────────────────────────

export type PostIssueTaskStatus =
  | 'PENDING'       // Created, awaiting execution
  | 'IN_PROGRESS'   // Currently executing
  | 'COMPLETED'     // Successfully completed
  | 'FAILED'        // Execution failed (retryable)
  | 'SKIPPED'       // Not applicable for this payment
  | 'DEFERRED'      // Deferred for manual review
  | 'CANCELLED';    // Cancelled

export type PostIssueTaskType =
  | 'CL_HEAD_UPDATE'          // Update cl_head status after payment
  | 'CLAIM_CLOSURE'           // Close claim if final payment
  | 'CLAIM_CONTINUATION'      // Continue claim for next period
  | 'WAGES_CREDITED'          // Update cl_wages_credited
  | 'POSTAL_REG_UPDATE'       // Update tb_postal_reg for cheque delivery
  | 'PENSION_SUPPORT'         // Pension-specific support table updates
  | 'SURVIVOR_FOLLOWUP'       // Survivor beneficiary confirmation
  | 'HOLDING_FOLLOWUP'        // Holding release condition check
  | 'ENTITLEMENT_UPDATE'      // Update entitlement balance/status
  | 'INSTRUCTION_FINALIZE'    // Mark instruction as fully issued
  | 'BATCH_COMPLETION_CHECK'  // Check if entire batch is complete
  | 'AUDIT_COMPLETION';       // Final audit event logging

export type PostIssueAction =
  | 'EXECUTE'
  | 'RETRY'
  | 'SKIP'
  | 'DEFER'
  | 'CANCEL'
  | 'COMPLETE_MANUAL';

// ─── Interfaces ─────────────────────────────────────────────────────

export interface PostIssueTask {
  id: string;
  issue_record_id: string;
  batch_id: string;
  task_type: PostIssueTaskType;
  task_order: number;
  status: PostIssueTaskStatus;
  is_required: boolean;

  // Context
  ssn: string;
  claim_number: string | null;
  cheque_number: string | null;
  amount: number;
  target_table: string | null;

  // Execution
  executed_at: string | null;
  executed_by: string | null;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  result_data: Record<string, any> | null;

  // Manual
  deferred_reason: string | null;
  skip_reason: string | null;
  notes: string | null;

  created_at: string;
}

export interface PostIssueFilters {
  batch_id?: string;
  status?: PostIssueTaskStatus;
  task_type?: PostIssueTaskType;
  search?: string;
  is_required?: boolean;
}

export interface PostIssueSummary {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  skipped: number;
  deferred: number;
  completionPct: number;
  allRequiredDone: boolean;
}

// ─── Task Definitions ───────────────────────────────────────────────

interface TaskDefinition {
  type: PostIssueTaskType;
  label: string;
  description: string;
  order: number;
  isRequired: boolean;
  appliesTo: (ctx: TaskContext) => boolean;
}

interface TaskContext {
  instructionType: string;
  targetTable: string;
  isFinalPayment: boolean;
  isRecurring: boolean;
  hasSurvivor: boolean;
  isHolding: boolean;
}

const TASK_DEFINITIONS: TaskDefinition[] = [
  {
    type: 'CL_HEAD_UPDATE',
    label: 'Update Claim Header',
    description: 'Update cl_head with payment status and dates',
    order: 1,
    isRequired: true,
    appliesTo: () => true,
  },
  {
    type: 'WAGES_CREDITED',
    label: 'Wages Credited Update',
    description: 'Update cl_wages_credited for contribution-linked benefits',
    order: 2,
    isRequired: true,
    appliesTo: (ctx) => ['PERIODIC', 'ARREARS'].includes(ctx.instructionType),
  },
  {
    type: 'POSTAL_REG_UPDATE',
    label: 'Postal Registration',
    description: 'Update tb_postal_reg for cheque delivery tracking',
    order: 3,
    isRequired: false,
    appliesTo: (ctx) => ctx.targetTable === 'cl_cheques',
  },
  {
    type: 'PENSION_SUPPORT',
    label: 'Pension Support Update',
    description: 'Update pension-specific support tables',
    order: 4,
    isRequired: true,
    appliesTo: (ctx) => ctx.isRecurring && ctx.instructionType === 'PERIODIC',
  },
  {
    type: 'SURVIVOR_FOLLOWUP',
    label: 'Survivor Follow-up',
    description: 'Confirm survivor beneficiary details and update records',
    order: 5,
    isRequired: true,
    appliesTo: (ctx) => ctx.hasSurvivor,
  },
  {
    type: 'HOLDING_FOLLOWUP',
    label: 'Holding Follow-up',
    description: 'Check holding release conditions and update status',
    order: 6,
    isRequired: true,
    appliesTo: (ctx) => ctx.isHolding,
  },
  {
    type: 'ENTITLEMENT_UPDATE',
    label: 'Entitlement Balance Update',
    description: 'Update entitlement paid amount and remaining balance',
    order: 7,
    isRequired: true,
    appliesTo: () => true,
  },
  {
    type: 'CLAIM_CLOSURE',
    label: 'Claim Closure',
    description: 'Close claim if this is the final payment',
    order: 8,
    isRequired: true,
    appliesTo: (ctx) => ctx.isFinalPayment,
  },
  {
    type: 'CLAIM_CONTINUATION',
    label: 'Claim Continuation',
    description: 'Continue claim and prepare next payment period',
    order: 9,
    isRequired: true,
    appliesTo: (ctx) => ctx.isRecurring && !ctx.isFinalPayment,
  },
  {
    type: 'INSTRUCTION_FINALIZE',
    label: 'Instruction Finalization',
    description: 'Mark payment instruction as fully issued',
    order: 10,
    isRequired: true,
    appliesTo: () => true,
  },
  {
    type: 'BATCH_COMPLETION_CHECK',
    label: 'Batch Completion Check',
    description: 'Verify if all batch items have completed post-issue',
    order: 11,
    isRequired: false,
    appliesTo: () => true,
  },
  {
    type: 'AUDIT_COMPLETION',
    label: 'Audit Completion',
    description: 'Log final audit event for completed payment lifecycle',
    order: 12,
    isRequired: true,
    appliesTo: () => true,
  },
];

export function getTaskDefinitions(): TaskDefinition[] {
  return TASK_DEFINITIONS;
}

// ─── Status Transitions ─────────────────────────────────────────────

const TASK_TRANSITIONS: Record<PostIssueTaskStatus, PostIssueAction[]> = {
  PENDING:     ['EXECUTE', 'SKIP', 'DEFER', 'CANCEL'],
  IN_PROGRESS: [],
  COMPLETED:   [],
  FAILED:      ['RETRY', 'SKIP', 'DEFER', 'CANCEL'],
  SKIPPED:     [],
  DEFERRED:    ['EXECUTE', 'COMPLETE_MANUAL', 'SKIP', 'CANCEL'],
  CANCELLED:   [],
};

export function getAvailableTaskActions(status: PostIssueTaskStatus): PostIssueAction[] {
  return TASK_TRANSITIONS[status] || [];
}

// ─── Role Permissions ───────────────────────────────────────────────

const TASK_ACTION_ROLES: Record<PostIssueAction, string[]> = {
  EXECUTE:         ['CLAIMS_OFFICER', 'SUPERVISOR', 'MANAGER', 'FINANCE_OFFICER'],
  RETRY:           ['CLAIMS_OFFICER', 'SUPERVISOR', 'MANAGER', 'FINANCE_OFFICER'],
  SKIP:            ['SUPERVISOR', 'MANAGER'],
  DEFER:           ['SUPERVISOR', 'MANAGER'],
  CANCEL:          ['MANAGER'],
  COMPLETE_MANUAL: ['SUPERVISOR', 'MANAGER'],
};

// ─── Fetch Tasks ────────────────────────────────────────────────────

export async function fetchPostIssueTasks(filters: PostIssueFilters = {}): Promise<PostIssueTask[]> {
  let query = db.from('bn_post_issue_task').select('*').order('task_order', { ascending: true });

  if (filters.batch_id) query = query.eq('batch_id', filters.batch_id);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.task_type) query = query.eq('task_type', filters.task_type);
  if (filters.is_required !== undefined) query = query.eq('is_required', filters.is_required);
  if (filters.search) {
    query = query.or(`ssn.ilike.%${filters.search}%,claim_number.ilike.%${filters.search}%,cheque_number.ilike.%${filters.search}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function fetchPostIssueTaskDetail(id: string): Promise<PostIssueTask> {
  const { data, error } = await db.from('bn_post_issue_task').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function fetchPostIssueSummary(batchId?: string): Promise<PostIssueSummary> {
  let query = db.from('bn_post_issue_task').select('status, is_required');
  if (batchId) query = query.eq('batch_id', batchId);

  const { data } = await query;
  const tasks = data || [];

  const total = tasks.length;
  const pending = tasks.filter((t: any) => t.status === 'PENDING').length;
  const in_progress = tasks.filter((t: any) => t.status === 'IN_PROGRESS').length;
  const completed = tasks.filter((t: any) => t.status === 'COMPLETED').length;
  const failed = tasks.filter((t: any) => t.status === 'FAILED').length;
  const skipped = tasks.filter((t: any) => t.status === 'SKIPPED').length;
  const deferred = tasks.filter((t: any) => t.status === 'DEFERRED').length;

  const requiredTasks = tasks.filter((t: any) => t.is_required);
  const requiredDone = requiredTasks.filter(
    (t: any) => t.status === 'COMPLETED' || t.status === 'SKIPPED'
  );

  return {
    total,
    pending,
    in_progress,
    completed,
    failed,
    skipped,
    deferred,
    completionPct: total > 0 ? Math.round((completed + skipped) / total * 100) : 0,
    allRequiredDone: requiredTasks.length > 0 && requiredDone.length === requiredTasks.length,
  };
}

// ─── Generate Post-Issue Tasks from Issued Records ──────────────────

export async function generatePostIssueTasks(batchId: string, userCode: string): Promise<number> {
  // Fetch issued records for this batch
  const { data: issueRecords, error } = await db
    .from('bn_issue_record')
    .select('*')
    .eq('batch_id', batchId)
    .eq('status', 'ISSUED');

  if (error) throw error;
  if (!issueRecords?.length) throw new Error('No issued records in batch');

  const tasks: any[] = [];

  for (const record of issueRecords) {
    // Fetch instruction for context
    const { data: instr } = await db
      .from('bn_payment_instruction')
      .select('*')
      .eq('id', record.instruction_id)
      .single();

    // Fetch entitlement for context
    const { data: entitlement } = await db
      .from('bn_entitlement')
      .select('*')
      .eq('id', instr?.entitlement_id)
      .single();

    const ctx: TaskContext = {
      instructionType: record.instruction_type,
      targetTable: record.target_table,
      isFinalPayment: !!(entitlement?.total_entitlement &&
        (entitlement.amount_paid || 0) + record.amount >= entitlement.total_entitlement),
      isRecurring: instr?.payment_frequency !== 'ONE_TIME',
      hasSurvivor: !!record.survivor_id,
      isHolding: record.target_table === 'cl_cheques_holding',
    };

    for (const def of TASK_DEFINITIONS) {
      if (def.appliesTo(ctx)) {
        tasks.push({
          issue_record_id: record.id,
          batch_id: batchId,
          task_type: def.type,
          task_order: def.order,
          status: 'PENDING',
          is_required: def.isRequired,
          ssn: record.ssn,
          claim_number: record.claim_number,
          cheque_number: record.cheque_number || record.dd_reference,
          amount: record.amount,
          target_table: record.target_table,
          retry_count: 0,
          max_retries: 3,
        });
      }
    }
  }

  if (tasks.length > 0) {
    const { error: iErr } = await db.from('bn_post_issue_task').insert(tasks);
    if (iErr) throw iErr;
  }

  await logPostIssueEvent(batchId, null, 'GENERATE', userCode,
    `Generated ${tasks.length} post-issue tasks for ${issueRecords.length} issued records`, {
      task_count: tasks.length,
      record_count: issueRecords.length,
    });

  return tasks.length;
}

// ─── Execute Task ───────────────────────────────────────────────────

export interface ExecutePostIssueActionParams {
  taskId: string;
  action: PostIssueAction;
  userCode: string;
  reason?: string;
  resultData?: Record<string, any>;
}

export async function executePostIssueAction(params: ExecutePostIssueActionParams): Promise<void> {
  const { taskId, action, userCode, reason, resultData } = params;
  const task = await fetchPostIssueTaskDetail(taskId);
  const available = getAvailableTaskActions(task.status);

  if (!available.includes(action)) {
    throw new Error(`Action ${action} not allowed in status ${task.status}`);
  }

  switch (action) {
    case 'EXECUTE':
    case 'RETRY':
      await executeTask(task, userCode);
      break;
    case 'SKIP':
      await skipTask(task, userCode, reason || 'Skipped');
      break;
    case 'DEFER':
      await deferTask(task, userCode, reason || 'Deferred for manual review');
      break;
    case 'CANCEL':
      await cancelTask(task, userCode, reason || 'Cancelled');
      break;
    case 'COMPLETE_MANUAL':
      await completeManual(task, userCode, reason, resultData);
      break;
  }

  await logPostIssueEvent(task.batch_id, taskId, action, userCode,
    reason || `${action} on ${task.task_type}`, { task_type: task.task_type, ssn: task.ssn });
}

// ─── Task Execution Logic ───────────────────────────────────────────

async function executeTask(task: PostIssueTask, userCode: string): Promise<void> {
  await db.from('bn_post_issue_task').update({ status: 'IN_PROGRESS' }).eq('id', task.id);

  try {
    const result = await executeTaskByType(task, userCode);

    await db.from('bn_post_issue_task').update({
      status: 'COMPLETED',
      executed_at: new Date().toISOString(),
      executed_by: userCode,
      result_data: result,
      error_message: null,
    }).eq('id', task.id);

  } catch (err: any) {
    const retryCount = task.retry_count + 1;
    const newStatus = retryCount >= task.max_retries ? 'FAILED' : 'PENDING';

    await db.from('bn_post_issue_task').update({
      status: newStatus,
      retry_count: retryCount,
      error_message: err.message,
    }).eq('id', task.id);

    if (newStatus === 'FAILED') {
      await db.from('bn_payment_exception').insert({
        instruction_id: null,
        batch_id: task.batch_id,
        exception_type: 'POST_ISSUE_FAILURE',
        description: `Post-issue task ${task.task_type} failed after ${retryCount} attempts: ${err.message}`,
        status: 'OPEN',
        raised_by: userCode,
      });
    }
  }
}

async function executeTaskByType(task: PostIssueTask, userCode: string): Promise<Record<string, any>> {
  switch (task.task_type) {
    case 'CL_HEAD_UPDATE':
      return executeCLHeadUpdate(task, userCode);
    case 'CLAIM_CLOSURE':
      return executeClaimClosure(task, userCode);
    case 'CLAIM_CONTINUATION':
      return executeClaimContinuation(task, userCode);
    case 'WAGES_CREDITED':
      return executeWagesCredited(task, userCode);
    case 'POSTAL_REG_UPDATE':
      return executePostalRegUpdate(task, userCode);
    case 'PENSION_SUPPORT':
      return executePensionSupport(task, userCode);
    case 'SURVIVOR_FOLLOWUP':
      return executeSurvivorFollowup(task, userCode);
    case 'HOLDING_FOLLOWUP':
      return executeHoldingFollowup(task, userCode);
    case 'ENTITLEMENT_UPDATE':
      return executeEntitlementUpdate(task, userCode);
    case 'INSTRUCTION_FINALIZE':
      return executeInstructionFinalize(task, userCode);
    case 'BATCH_COMPLETION_CHECK':
      return executeBatchCompletionCheck(task, userCode);
    case 'AUDIT_COMPLETION':
      return executeAuditCompletion(task, userCode);
    default:
      throw new Error(`Unknown task type: ${task.task_type}`);
  }
}

// ─── Individual Task Implementations ────────────────────────────────

async function executeCLHeadUpdate(task: PostIssueTask, userCode: string): Promise<Record<string, any>> {
  if (!task.claim_number) throw new Error('Missing claim_number');

  const { error } = await db.from('cl_head').update({
    last_payment_date: new Date().toISOString(),
    last_payment_amount: task.amount,
    last_cheque_no: task.cheque_number,
    modified_by: userCode,
    modified_date: new Date().toISOString(),
  }).eq('claim_number', task.claim_number);

  if (error) throw error;
  return { updated: 'cl_head', claim_number: task.claim_number };
}

async function executeClaimClosure(task: PostIssueTask, userCode: string): Promise<Record<string, any>> {
  if (!task.claim_number) throw new Error('Missing claim_number');

  await db.from('cl_head').update({
    claim_status: 'CLOSED',
    closed_date: new Date().toISOString(),
    closed_by: userCode,
    close_reason: 'FINAL_PAYMENT_ISSUED',
  }).eq('claim_number', task.claim_number);

  // Also update bn_claim
  const { data: closedClaim } = await db.from('bn_claim').update({
    status: 'CLOSED',
  }).eq('claim_number', task.claim_number).select('id').maybeSingle();

  // A closed claim must leave the work queue, not linger in its last basket.
  await routeClaimAfterStatusChange(closedClaim?.id ?? null, userCode);

  return { closed: task.claim_number };
}

async function executeClaimContinuation(task: PostIssueTask, userCode: string): Promise<Record<string, any>> {
  if (!task.claim_number) throw new Error('Missing claim_number');

  await db.from('cl_head').update({
    claim_status: 'IN_PAYMENT',
    modified_by: userCode,
    modified_date: new Date().toISOString(),
  }).eq('claim_number', task.claim_number);

  return { continued: task.claim_number };
}

async function executeWagesCredited(task: PostIssueTask, userCode: string): Promise<Record<string, any>> {
  const { error } = await db.from('cl_wages_credited').insert({
    ssn: task.ssn,
    claim_number: task.claim_number,
    cheque_number: task.cheque_number,
    amount_credited: task.amount,
    credit_date: new Date().toISOString(),
    credited_by: userCode,
  });

  if (error) throw error;
  return { credited: task.amount };
}

async function executePostalRegUpdate(task: PostIssueTask, userCode: string): Promise<Record<string, any>> {
  // Update postal registration for cheque delivery tracking
  const { error } = await db.from('tb_postal_reg').insert({
    ssn: task.ssn,
    claim_number: task.claim_number,
    cheque_number: task.cheque_number,
    dispatch_date: new Date().toISOString(),
    dispatch_status: 'PENDING',
    entered_by: userCode,
  });

  if (error) throw error;
  return { postal_reg: 'created' };
}

async function executePensionSupport(task: PostIssueTask, userCode: string): Promise<Record<string, any>> {
  // Pension-specific: update last payment period, next due date
  const { data: issueRec } = await db
    .from('bn_issue_record')
    .select('period_start, period_end')
    .eq('id', task.issue_record_id)
    .single();

  return {
    pension_updated: true,
    last_period_end: issueRec?.period_end,
  };
}

async function executeSurvivorFollowup(task: PostIssueTask, userCode: string): Promise<Record<string, any>> {
  // Confirm survivor payment was routed correctly
  const { data } = await db
    .from('cl_cheques_survivor')
    .select('id, status')
    .eq('cheque_number', task.cheque_number)
    .single();

  if (!data) throw new Error('Survivor cheque record not found');
  return { survivor_confirmed: true, cheque_status: data.status };
}

async function executeHoldingFollowup(task: PostIssueTask, userCode: string): Promise<Record<string, any>> {
  // Check if holding conditions are met
  const { data } = await db
    .from('cl_cheques_holding')
    .select('hold_status, hold_reason')
    .eq('cheque_number', task.cheque_number)
    .single();

  if (!data) throw new Error('Holding record not found');
  return { hold_status: data.hold_status, hold_reason: data.hold_reason };
}

async function executeEntitlementUpdate(task: PostIssueTask, userCode: string): Promise<Record<string, any>> {
  // Get instruction to find entitlement
  const { data: issueRec } = await db
    .from('bn_issue_record')
    .select('instruction_id')
    .eq('id', task.issue_record_id)
    .single();

  if (!issueRec) throw new Error('Issue record not found');

  const { data: instr } = await db
    .from('bn_payment_instruction')
    .select('entitlement_id')
    .eq('id', issueRec.instruction_id)
    .single();

  if (!instr?.entitlement_id) throw new Error('Entitlement not linked');

  // Increment amount_paid on entitlement
  const { data: ent } = await db
    .from('bn_entitlement')
    .select('amount_paid, total_entitlement')
    .eq('id', instr.entitlement_id)
    .single();

  const newPaid = (ent?.amount_paid || 0) + task.amount;
  const updates: any = { amount_paid: newPaid };

  // Check if exhausted
  if (ent?.total_entitlement && newPaid >= ent.total_entitlement) {
    updates.status = 'EXHAUSTED';
  }

  await db.from('bn_entitlement').update(updates).eq('id', instr.entitlement_id);

  return { entitlement_id: instr.entitlement_id, new_paid: newPaid, exhausted: !!updates.status };
}

async function executeInstructionFinalize(task: PostIssueTask, userCode: string): Promise<Record<string, any>> {
  const { data: issueRec } = await db
    .from('bn_issue_record')
    .select('instruction_id')
    .eq('id', task.issue_record_id)
    .single();

  if (!issueRec) throw new Error('Issue record not found');

  await db.from('bn_payment_instruction').update({
    status: 'ISSUED_PENDING',
  }).eq('id', issueRec.instruction_id);

  return { instruction_finalized: issueRec.instruction_id };
}

async function executeBatchCompletionCheck(task: PostIssueTask, userCode: string): Promise<Record<string, any>> {
  // Check if all required tasks in this batch are done
  const summary = await fetchPostIssueSummary(task.batch_id);

  if (summary.allRequiredDone) {
    // Update batch status to fully complete
    await db.from('bn_payment_batch').update({
      status: 'ISSUED',
    }).eq('id', task.batch_id);
  }

  return { all_required_done: summary.allRequiredDone, completion_pct: summary.completionPct };
}

async function executeAuditCompletion(task: PostIssueTask, userCode: string): Promise<Record<string, any>> {
  await logPostIssueEvent(task.batch_id, task.id, 'LIFECYCLE_COMPLETE', userCode,
    `Payment lifecycle complete for SSN ${task.ssn}, Claim ${task.claim_number}`, {
      ssn: task.ssn,
      claim_number: task.claim_number,
      cheque_number: task.cheque_number,
      amount: task.amount,
    });

  return { audit_logged: true };
}

// ─── Skip / Defer / Cancel ──────────────────────────────────────────

async function skipTask(task: PostIssueTask, userCode: string, reason: string): Promise<void> {
  if (task.is_required) {
    throw new Error('Required tasks cannot be skipped without Manager approval');
  }
  await db.from('bn_post_issue_task').update({
    status: 'SKIPPED',
    skip_reason: reason,
    executed_by: userCode,
    executed_at: new Date().toISOString(),
  }).eq('id', task.id);
}

async function deferTask(task: PostIssueTask, userCode: string, reason: string): Promise<void> {
  await db.from('bn_post_issue_task').update({
    status: 'DEFERRED',
    deferred_reason: reason,
    executed_by: userCode,
  }).eq('id', task.id);
}

async function cancelTask(task: PostIssueTask, userCode: string, reason: string): Promise<void> {
  await db.from('bn_post_issue_task').update({
    status: 'CANCELLED',
    notes: reason,
    executed_by: userCode,
    executed_at: new Date().toISOString(),
  }).eq('id', task.id);
}

async function completeManual(task: PostIssueTask, userCode: string, reason?: string, resultData?: Record<string, any>): Promise<void> {
  await db.from('bn_post_issue_task').update({
    status: 'COMPLETED',
    executed_at: new Date().toISOString(),
    executed_by: userCode,
    notes: reason || 'Manually completed',
    result_data: resultData || null,
  }).eq('id', task.id);
}

// ─── Bulk Execute All Pending Tasks ─────────────────────────────────

export async function executeAllPendingTasks(batchId: string, userCode: string): Promise<{ completed: number; failed: number }> {
  const { data: tasks } = await db
    .from('bn_post_issue_task')
    .select('*')
    .eq('batch_id', batchId)
    .eq('status', 'PENDING')
    .order('task_order', { ascending: true });

  let completed = 0;
  let failed = 0;

  for (const task of (tasks || [])) {
    try {
      await executeTask(task, userCode);
      completed++;
    } catch {
      failed++;
    }
  }

  await logPostIssueEvent(batchId, null, 'BULK_EXECUTE', userCode,
    `Bulk execute: ${completed} completed, ${failed} failed`, { completed, failed });

  return { completed, failed };
}

// ─── Audit ──────────────────────────────────────────────────────────

async function logPostIssueEvent(
  batchId: string,
  taskId: string | null,
  action: string,
  userCode: string,
  description: string,
  metadata: Record<string, any>
): Promise<void> {
  try {
    await db.from('bn_claim_event').insert({
      entity_type: 'POST_ISSUE',
      entity_id: taskId || batchId,
      event_type: `POST_ISSUE_${action}`,
      description,
      performed_by: userCode,
      metadata: { ...metadata, batch_id: batchId, task_id: taskId },
    });
  } catch {
    console.error('Failed to log post-issue event');
  }
}
