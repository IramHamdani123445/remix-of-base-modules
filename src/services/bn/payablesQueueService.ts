/**
 * Payables Queue Service
 *
 * Business Purpose:
 *   Manages payable_instruction records created from approved entitlements
 *   before actual payment issue. This is the orchestration layer between
 *   entitlement activation and legacy payment persistence (cl_cheques*).
 *
 * Existing tables used:
 *   - bn_claim (claim context, linked-claim refs)
 *   - bn_entitlement (parent entitlement for each payable)
 *   - bn_claim_event (audit trail)
 *   - bn_product / bn_product_version (benefit type metadata)
 *   - cl_head (legacy claim header — soft join via claim_number)
 *   - cl_cheques / cl_cheques_holding (outbound payment — read-only from here)
 *
 * New tables used:
 *   - bn_payment_instruction (primary table for this module)
 *   - bn_payment_schedule (recurring schedule reference)
 *   - bn_payment_batch (batch control for grouping issued payments)
 *   - bn_payment_exception (exception routing records)
 *
 * CRITICAL CONSTRAINTS:
 *   - This module does NOT write to cl_cheques — the payment batch/issue process does.
 *   - cn_payment*, cn_receipt, cn_refund are NEVER used for outbound benefit payments.
 *   - Payable instructions are created by entitlement activation or schedule generation.
 *   - Actual payment issue is a separate downstream process.
 */
import { supabase } from '@/integrations/supabase/client';

const db = supabase as any;

// ─── Types ──────────────────────────────────────────────────────────

export type PayableStatus =
  | 'READY'
  | 'BLOCKED'
  | 'HELD'
  | 'EXCEPTION'
  | 'SCHEDULED'
  | 'ISSUED_PENDING'
  | 'CANCELLED'
  | 'REISSUE_PENDING';

export type PayableInstructionType = 'PERIODIC' | 'LUMP_SUM' | 'ARREARS' | 'ADJUSTMENT' | 'FINAL';

export interface PayableInstruction {
  id: string;
  entitlement_id: string;
  claim_id: string;
  ssn: string;
  claim_number: string | null;

  // Instruction details
  instruction_type: PayableInstructionType;
  amount: number;
  currency: string;
  payment_frequency: string | null;
  period_start: string | null;
  period_end: string | null;
  scheduled_date: string | null;
  due_date: string | null;

  // Payment method
  payment_method: string | null; // CHEQUE, EFT, DIRECT_DEPOSIT
  bank_account: string | null;
  bank_routing: string | null;
  payee_name: string | null;

  // Status & control
  status: PayableStatus;
  readiness_score: number; // 0-100 composite readiness
  readiness_flags: Record<string, boolean>;
  hold_reason: string | null;
  hold_by: string | null;
  hold_at: string | null;
  exception_code: string | null;
  exception_detail: string | null;
  exception_at: string | null;

  // Duplicate prevention
  duplicate_check_hash: string | null;
  is_duplicate: boolean;
  duplicate_of_id: string | null;

  // Batch reference (populated when issued)
  batch_id: string | null;
  batch_number: string | null;
  cl_cheque_no: string | null; // Link to legacy cl_cheques

  // Reissue tracking
  reissue_reason: string | null;
  reissue_of_id: string | null;
  original_instruction_id: string | null;

  // Audit
  entered_by: string | null;
  entered_at: string;
  modified_by: string | null;
  modified_at: string | null;
  issued_by: string | null;
  issued_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
}

export interface PayableWithContext extends PayableInstruction {
  benefit_name: string | null;
  product_category: string | null;
  claimant_name: string | null;
  entitlement_status: string | null;
  claim_status: string | null;
  age_days: number;
}

export interface PayableFilters {
  status?: string[];
  instructionType?: string;
  search?: string;
  officeCode?: string;
  benefitCategory?: string;
  ageMin?: number;
  ageMax?: number;
  priority?: string;
  scheduledFrom?: string;
  scheduledTo?: string;
}

// ─── Status Definitions ─────────────────────────────────────────────

export const PAYABLE_STATUS_CONFIG: Record<PayableStatus, {
  label: string;
  description: string;
  color: string;
  canTransitionTo: PayableStatus[];
}> = {
  READY: {
    label: 'Ready',
    description: 'All readiness checks passed; eligible for batch inclusion',
    color: 'emerald',
    canTransitionTo: ['HELD', 'ISSUED_PENDING', 'CANCELLED', 'EXCEPTION'],
  },
  BLOCKED: {
    label: 'Blocked',
    description: 'One or more readiness rules failed; requires resolution',
    color: 'destructive',
    canTransitionTo: ['READY', 'CANCELLED', 'EXCEPTION'],
  },
  HELD: {
    label: 'Held',
    description: 'Manually held by supervisor pending review or verification',
    color: 'amber',
    canTransitionTo: ['READY', 'CANCELLED', 'EXCEPTION'],
  },
  EXCEPTION: {
    label: 'Exception',
    description: 'Flagged for investigation — duplicate, amount anomaly, or data issue',
    color: 'orange',
    canTransitionTo: ['READY', 'CANCELLED', 'HELD'],
  },
  SCHEDULED: {
    label: 'Scheduled',
    description: 'Recurring payment not yet due; will become READY on scheduled date',
    color: 'blue',
    canTransitionTo: ['READY', 'CANCELLED', 'HELD'],
  },
  ISSUED_PENDING: {
    label: 'Issued (Pending)',
    description: 'Added to batch; awaiting confirmation of payment issue to cl_cheques',
    color: 'teal',
    canTransitionTo: ['CANCELLED', 'REISSUE_PENDING'],
  },
  CANCELLED: {
    label: 'Cancelled',
    description: 'Permanently cancelled; will not be paid',
    color: 'muted',
    canTransitionTo: ['REISSUE_PENDING'],
  },
  REISSUE_PENDING: {
    label: 'Reissue Pending',
    description: 'Original cancelled or returned; replacement instruction pending',
    color: 'violet',
    canTransitionTo: ['READY', 'CANCELLED'],
  },
};

export const PAYABLE_STATUS_LABELS: Record<PayableStatus, string> = Object.fromEntries(
  Object.entries(PAYABLE_STATUS_CONFIG).map(([k, v]) => [k, v.label])
) as Record<PayableStatus, string>;

// ─── Actions ────────────────────────────────────────────────────────

export interface PayableAction {
  action: string;
  label: string;
  variant: 'default' | 'destructive' | 'outline' | 'secondary';
  fromStatuses: PayableStatus[];
  toStatus: PayableStatus;
  requiresNarrative: boolean;
  requiresReasonCode: boolean;
  roles: string[];
  bulk: boolean;
  notificationTrigger: string | null;
  auditEvent: string;
  description: string;
}

export const PAYABLE_ACTIONS: PayableAction[] = [
  {
    action: 'RELEASE',
    label: 'Release',
    variant: 'default',
    fromStatuses: ['HELD', 'EXCEPTION'],
    toStatus: 'READY',
    requiresNarrative: false,
    requiresReasonCode: false,
    roles: ['SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN'],
    bulk: true,
    notificationTrigger: null,
    auditEvent: 'payable.released',
    description: 'Release held/exception payable back to ready queue',
  },
  {
    action: 'HOLD',
    label: 'Hold',
    variant: 'secondary',
    fromStatuses: ['READY', 'SCHEDULED', 'BLOCKED'],
    toStatus: 'HELD',
    requiresNarrative: true,
    requiresReasonCode: false,
    roles: ['SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN'],
    bulk: true,
    notificationTrigger: 'payable.held',
    auditEvent: 'payable.held',
    description: 'Place hold on payable pending supervisor review',
  },
  {
    action: 'CANCEL',
    label: 'Cancel',
    variant: 'destructive',
    fromStatuses: ['READY', 'BLOCKED', 'HELD', 'EXCEPTION', 'SCHEDULED'],
    toStatus: 'CANCELLED',
    requiresNarrative: true,
    requiresReasonCode: true,
    roles: ['MANAGER', 'DIRECTOR', 'ADMIN'],
    bulk: false,
    notificationTrigger: 'payable.cancelled',
    auditEvent: 'payable.cancelled',
    description: 'Permanently cancel this payable instruction',
  },
  {
    action: 'FLAG_EXCEPTION',
    label: 'Flag Exception',
    variant: 'outline',
    fromStatuses: ['READY', 'BLOCKED', 'HELD', 'SCHEDULED'],
    toStatus: 'EXCEPTION',
    requiresNarrative: true,
    requiresReasonCode: true,
    roles: ['CLAIMS_OFFICER', 'SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN'],
    bulk: false,
    notificationTrigger: 'payable.exception',
    auditEvent: 'payable.exception_flagged',
    description: 'Flag payable for investigation',
  },
  {
    action: 'RESOLVE_BLOCK',
    label: 'Resolve Block',
    variant: 'default',
    fromStatuses: ['BLOCKED'],
    toStatus: 'READY',
    requiresNarrative: true,
    requiresReasonCode: false,
    roles: ['SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN'],
    bulk: true,
    notificationTrigger: null,
    auditEvent: 'payable.block_resolved',
    description: 'Resolve blocking condition and mark as ready',
  },
  {
    action: 'REQUEST_REISSUE',
    label: 'Request Reissue',
    variant: 'secondary',
    fromStatuses: ['ISSUED_PENDING', 'CANCELLED'],
    toStatus: 'REISSUE_PENDING',
    requiresNarrative: true,
    requiresReasonCode: true,
    roles: ['SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN'],
    bulk: false,
    notificationTrigger: 'payable.reissue_requested',
    auditEvent: 'payable.reissue_requested',
    description: 'Request reissue of a cancelled or failed payment',
  },
  {
    action: 'APPROVE_REISSUE',
    label: 'Approve Reissue',
    variant: 'default',
    fromStatuses: ['REISSUE_PENDING'],
    toStatus: 'READY',
    requiresNarrative: false,
    requiresReasonCode: false,
    roles: ['MANAGER', 'DIRECTOR', 'ADMIN'],
    bulk: false,
    notificationTrigger: null,
    auditEvent: 'payable.reissue_approved',
    description: 'Approve reissue and move to ready queue',
  },
];

// ─── Readiness Rules ────────────────────────────────────────────────

export interface ReadinessRule {
  code: string;
  label: string;
  description: string;
  blocking: boolean;
}

export const READINESS_RULES: ReadinessRule[] = [
  { code: 'ENTITLEMENT_ACTIVE', label: 'Entitlement Active', description: 'Parent entitlement must be ACTIVE or REOPENED', blocking: true },
  { code: 'CLAIM_NOT_SUSPENDED', label: 'Claim Not Suspended', description: 'Parent claim must not be SUSPENDED or DENIED', blocking: true },
  { code: 'BANK_DETAILS_VALID', label: 'Bank Details Valid', description: 'Payment method and bank account must be populated for EFT', blocking: true },
  { code: 'AMOUNT_WITHIN_LIMITS', label: 'Amount Within Limits', description: 'Amount must be within product min/max thresholds', blocking: true },
  { code: 'NO_DUPLICATE', label: 'No Duplicate', description: 'No existing payable for same SSN+period+amount', blocking: true },
  { code: 'EVIDENCE_COMPLETE', label: 'Evidence Complete', description: 'All required evidence must be verified', blocking: false },
  { code: 'ENTITLEMENT_BALANCE', label: 'Entitlement Balance', description: 'Remaining entitlement balance must cover this amount', blocking: true },
  { code: 'SCHEDULE_DUE', label: 'Schedule Due', description: 'Scheduled date must be on or before current date', blocking: false },
];

export function evaluateReadiness(instruction: Partial<PayableInstruction>, context: {
  entitlementStatus?: string;
  claimStatus?: string;
  remainingBalance?: number;
}): { score: number; flags: Record<string, boolean>; blocking: string[] } {
  const flags: Record<string, boolean> = {};
  const blocking: string[] = [];

  flags['ENTITLEMENT_ACTIVE'] = ['ACTIVE', 'REOPENED'].includes(context.entitlementStatus ?? '');
  flags['CLAIM_NOT_SUSPENDED'] = !['SUSPENDED', 'DENIED', 'WITHDRAWN'].includes(context.claimStatus ?? '');
  flags['BANK_DETAILS_VALID'] = instruction.payment_method !== 'EFT' || !!(instruction.bank_account && instruction.bank_routing);
  flags['AMOUNT_WITHIN_LIMITS'] = (instruction.amount ?? 0) > 0 && (instruction.amount ?? 0) < 999999;
  flags['NO_DUPLICATE'] = !instruction.is_duplicate;
  flags['ENTITLEMENT_BALANCE'] = (context.remainingBalance ?? 0) >= (instruction.amount ?? 0);

  const scheduled = instruction.scheduled_date ? new Date(instruction.scheduled_date) <= new Date() : true;
  flags['SCHEDULE_DUE'] = scheduled;
  flags['EVIDENCE_COMPLETE'] = true; // Default; overridden by caller with actual evidence check

  for (const rule of READINESS_RULES) {
    if (rule.blocking && !flags[rule.code]) {
      blocking.push(rule.code);
    }
  }

  const passed = Object.values(flags).filter(Boolean).length;
  const total = Object.keys(flags).length;
  const score = total > 0 ? Math.round((passed / total) * 100) : 0;

  return { score, flags, blocking };
}

// ─── Duplicate Check ────────────────────────────────────────────────

export function generateDuplicateHash(ssn: string, periodStart: string, periodEnd: string, amount: number, instructionType: string): string {
  return `${ssn}|${periodStart}|${periodEnd}|${amount}|${instructionType}`;
}

// ─── Role Matrix ────────────────────────────────────────────────────

export const PAYABLE_ROLE_MATRIX: Record<string, { canView: boolean; canAct: boolean; actions: string[] }> = {
  CLAIMS_OFFICER: { canView: true, canAct: true, actions: ['FLAG_EXCEPTION'] },
  SUPERVISOR: { canView: true, canAct: true, actions: ['RELEASE', 'HOLD', 'FLAG_EXCEPTION', 'RESOLVE_BLOCK', 'REQUEST_REISSUE'] },
  MANAGER: { canView: true, canAct: true, actions: ['RELEASE', 'HOLD', 'CANCEL', 'FLAG_EXCEPTION', 'RESOLVE_BLOCK', 'REQUEST_REISSUE', 'APPROVE_REISSUE'] },
  DIRECTOR: { canView: true, canAct: true, actions: ['RELEASE', 'HOLD', 'CANCEL', 'FLAG_EXCEPTION', 'RESOLVE_BLOCK', 'REQUEST_REISSUE', 'APPROVE_REISSUE'] },
  ADMIN: { canView: true, canAct: true, actions: ['RELEASE', 'HOLD', 'CANCEL', 'FLAG_EXCEPTION', 'RESOLVE_BLOCK', 'REQUEST_REISSUE', 'APPROVE_REISSUE'] },
  AUDITOR: { canView: true, canAct: false, actions: [] },
};

// ─── Fetch Payables ─────────────────────────────────────────────────

export async function fetchPayables(filters: PayableFilters = {}): Promise<PayableWithContext[]> {
  // NOTE: bn_payment_instruction currently has a minimal legacy schema.
  // Embed only the FK-related bn_entitlement; resolve claim/product
  // metadata via a separate lookup to avoid PostgREST relation errors.
  let query = db
    .from('bn_payment_instruction')
    .select(`
      *,
      bn_entitlement(id, status, ssn, claim_number, claim_id, weekly_rate, remaining_amount)
    `)
    .order('created_at', { ascending: false })
    .limit(500);

  if (filters.status?.length) {
    query = query.in('status', filters.status);
  }
  if (filters.search) {
    query = query.or(`ssn.ilike.%${filters.search}%`);
  }
  if (filters.scheduledFrom) {
    query = query.gte('due_date', filters.scheduledFrom);
  }
  if (filters.scheduledTo) {
    query = query.lte('due_date', filters.scheduledTo);
  }

  const { data, error } = await query;
  if (error) throw error;

  const claimIds = Array.from(
    new Set(((data ?? []) as any[]).map(p => p.claim_id || p.bn_entitlement?.claim_id).filter(Boolean))
  );
  const claimMap: Record<string, any> = {};
  if (claimIds.length) {
    const { data: claims } = await db
      .from('bn_claim')
      .select('id, claim_number, ssn, status, priority, product_id, bn_product:product_id(benefit_name, category)')
      .in('id', claimIds);
    (claims ?? []).forEach((c: any) => { claimMap[c.id] = c; });
  }

  const now = new Date();
  return ((data ?? []) as any[]).map((p) => {
    const claimId = p.claim_id || p.bn_entitlement?.claim_id;
    const claim = claimId ? claimMap[claimId] : null;
    const enteredAtRaw = p.entered_at || p.created_at;
    const enteredAt = enteredAtRaw ? new Date(enteredAtRaw) : now;
    const ageDays = Math.floor((now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60 * 24));
    return {
      ...p,
      entered_at: enteredAtRaw,
      instruction_type: (p.instruction_type || p.frequency || 'PERIODIC').toString().toUpperCase(),
      scheduled_date: p.scheduled_date || p.due_date,
      payee_name: p.payee_name || null,
      readiness_score: p.readiness_score ?? 0,
      readiness_flags: p.readiness_flags ?? {},
      benefit_name: claim?.bn_product?.benefit_name || null,
      product_category: claim?.bn_product?.category || null,
      claimant_name: null,
      entitlement_status: p.bn_entitlement?.status || null,
      claim_status: claim?.status || null,
      claim_number: claim?.claim_number || p.bn_entitlement?.claim_number || p.claim_number || null,
      age_days: ageDays,
    } as PayableWithContext;
  });
}

// ─── Fetch Single Payable ───────────────────────────────────────────

export async function fetchPayableDetail(instructionId: string): Promise<PayableWithContext | null> {
  const { data, error } = await db
    .from('bn_payment_instruction')
    .select(`
      *,
      bn_entitlement(id, status, ssn, claim_number, claim_id, weekly_rate, monthly_rate, remaining_amount, total_entitlement, effective_from, effective_to)
    `)
    .eq('id', instructionId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const claimId = (data as any).claim_id || (data as any).bn_entitlement?.claim_id;
  let claim: any = null;
  if (claimId) {
    const { data: c } = await db
      .from('bn_claim')
      .select('id, claim_number, ssn, status, priority, entered_by, product_id, bn_product:product_id(benefit_name, category)')
      .eq('id', claimId)
      .maybeSingle();
    claim = c;
  }

  const now = new Date();
  const enteredAtRaw = (data as any).entered_at || (data as any).created_at;
  const enteredAt = enteredAtRaw ? new Date(enteredAtRaw) : now;
  return {
    ...(data as any),
    entered_at: enteredAtRaw,
    instruction_type: ((data as any).instruction_type || (data as any).frequency || 'PERIODIC').toString().toUpperCase(),
    scheduled_date: (data as any).scheduled_date || (data as any).due_date,
    payee_name: (data as any).payee_name || null,
    readiness_score: (data as any).readiness_score ?? 0,
    readiness_flags: (data as any).readiness_flags ?? {},
    benefit_name: claim?.bn_product?.benefit_name || null,
    product_category: claim?.bn_product?.category || null,
    claimant_name: null,
    entitlement_status: (data as any).bn_entitlement?.status || null,
    claim_status: claim?.status || null,
    claim_number: claim?.claim_number || (data as any).bn_entitlement?.claim_number || (data as any).claim_number || null,
    age_days: Math.floor((now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60 * 24)),
  } as PayableWithContext;
}


// ─── Check for Duplicates ───────────────────────────────────────────

export async function checkDuplicate(ssn: string, periodStart: string, periodEnd: string, amount: number, instructionType: string, excludeId?: string): Promise<{ isDuplicate: boolean; duplicateId: string | null }> {
  const hash = generateDuplicateHash(ssn, periodStart, periodEnd, amount, instructionType);

  let query = db
    .from('bn_payment_instruction')
    .select('id')
    .eq('duplicate_check_hash', hash)
    .not('status', 'eq', 'CANCELLED')
    .limit(1);

  if (excludeId) {
    query = query.not('id', 'eq', excludeId);
  }

  const { data } = await query;
  if (data?.length) {
    return { isDuplicate: true, duplicateId: data[0].id };
  }
  return { isDuplicate: false, duplicateId: null };
}

// ─── Execute Payable Action ─────────────────────────────────────────

export interface ExecutePayableActionParams {
  instructionId: string;
  action: string;
  narrative?: string;
  reasonCodeId?: string;
  performedBy: string;
  bulk?: boolean;
}

export async function executePayableAction(params: ExecutePayableActionParams): Promise<{ success: boolean; newStatus: PayableStatus }> {
  const { instructionId, action, narrative, reasonCodeId, performedBy } = params;

  const actionDef = PAYABLE_ACTIONS.find(a => a.action === action);
  if (!actionDef) throw new Error(`Unknown payable action: ${action}`);

  // Fetch current instruction
  const { data: instr, error: fetchErr } = await db
    .from('bn_payment_instruction')
    .select('id, status, claim_id, entitlement_id, ssn')
    .eq('id', instructionId)
    .single();
  if (fetchErr || !instr) throw new Error('Payment instruction not found');

  // Validate transition
  if (!actionDef.fromStatuses.includes(instr.status)) {
    throw new Error(`Cannot ${action} from status ${instr.status}. Allowed from: ${actionDef.fromStatuses.join(', ')}`);
  }

  if (actionDef.requiresNarrative && !narrative?.trim()) {
    throw new Error('Narrative is required for this action.');
  }
  if (actionDef.requiresReasonCode && !reasonCodeId) {
    throw new Error('Reason code is required for this action.');
  }

  const now = new Date().toISOString();
  const newStatus = actionDef.toStatus;

  const update: Record<string, any> = {
    status: newStatus,
    modified_by: performedBy,
    modified_at: now,
  };

  switch (action) {
    case 'HOLD':
      update.hold_reason = narrative;
      update.hold_by = performedBy;
      update.hold_at = now;
      break;
    case 'RELEASE':
    case 'RESOLVE_BLOCK':
    case 'APPROVE_REISSUE':
      update.hold_reason = null;
      update.hold_by = null;
      update.hold_at = null;
      break;
    case 'CANCEL':
      update.cancelled_by = performedBy;
      update.cancelled_at = now;
      break;
    case 'FLAG_EXCEPTION':
      update.exception_code = reasonCodeId;
      update.exception_detail = narrative;
      update.exception_at = now;
      break;
    case 'REQUEST_REISSUE':
      update.reissue_reason = narrative;
      update.original_instruction_id = instructionId;
      break;
  }

  const { error: updErr } = await db
    .from('bn_payment_instruction')
    .update(update)
    .eq('id', instructionId);
  if (updErr) throw updErr;

  // Write audit event
  await db.from('bn_claim_event').insert({
    claim_id: instr.claim_id,
    event_type: `PAYABLE_${action}`,
    from_status: instr.status,
    to_status: newStatus,
    notes: narrative || `Payable action: ${action}`,
    performed_by: performedBy,
    performed_at: now,
    metadata: {
      instruction_id: instructionId,
      entity_type: 'PAYMENT_INSTRUCTION',
      reason_code_id: reasonCodeId,
      action,
      entitlement_id: instr.entitlement_id,
    },
  });

  return { success: true, newStatus };
}

// ─── Bulk Action ────────────────────────────────────────────────────

export async function executeBulkPayableAction(
  instructionIds: string[],
  action: string,
  performedBy: string,
  narrative?: string
): Promise<{ succeeded: number; failed: number; errors: string[] }> {
  const actionDef = PAYABLE_ACTIONS.find(a => a.action === action);
  if (!actionDef || !actionDef.bulk) throw new Error(`Action ${action} does not support bulk execution`);

  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const id of instructionIds) {
    try {
      await executePayableAction({ instructionId: id, action, narrative, performedBy });
      succeeded++;
    } catch (e: any) {
      failed++;
      errors.push(`${id}: ${e.message}`);
    }
  }

  return { succeeded, failed, errors };
}

// ─── Validation Diagnostics ─────────────────────────────────────────
//
// Spec section 5 + 9: before a payable can be issued, verify every
// prerequisite. Returns a structured list of blockers so the UI can
// render exact reasons (missing bank, no approved decision, etc).

export interface PayableBlocker {
  code: string;
  message: string;
}

export interface PayableValidation {
  payableId: string;
  claimId: string | null;
  ok: boolean;
  blockers: PayableBlocker[];
}

export async function validatePayable(instructionId: string): Promise<PayableValidation> {
  const blockers: PayableBlocker[] = [];

  const { data: pi } = await db
    .from('bn_payment_instruction')
    .select('id, claim_id, ssn, amount, payment_method, bank_code, account_number, status')
    .eq('id', instructionId)
    .single();

  if (!pi) {
    return { payableId: instructionId, claimId: null, ok: false, blockers: [{ code: 'NOT_FOUND', message: 'Payable not found' }] };
  }

  if (pi.status === 'HELD' || pi.status === 'BLOCKED') {
    blockers.push({ code: 'HELD', message: `Payable is on hold (${pi.status})` });
  }

  if (!pi.amount || Number(pi.amount) <= 0) {
    blockers.push({ code: 'NO_AMOUNT', message: 'Calculation has produced no payable amount' });
  }

  if (pi.payment_method === 'EFT' && (!pi.account_number || !pi.bank_code)) {
    blockers.push({ code: 'MISSING_BANK', message: 'Bank details missing — required for EFT payment' });
  }

  if (pi.claim_id) {
    const [{ data: decisions }, { data: eligibility }, { data: calcs }] = await Promise.all([
      db.from('bn_claim_decision')
        .select('action_code, to_status, performed_at')
        .eq('claim_id', pi.claim_id)
        .order('performed_at', { ascending: false })
        .limit(1),
      db.from('bn_claim_eligibility')
        .select('overall_result, override_applied')
        .eq('claim_id', pi.claim_id)
        .order('check_date', { ascending: false })
        .limit(1),
      db.from('bn_claim_calculation')
        .select('id, weekly_rate, lump_sum, monthly_rate')
        .eq('claim_id', pi.claim_id)
        .order('calc_date', { ascending: false })
        .limit(1),
    ]);

    const decision = decisions?.[0];
    if (!decision || decision.action_code !== 'APPROVE') {
      blockers.push({ code: 'NO_APPROVED_DECISION', message: 'No approved claim decision exists' });
    }

    const elig = eligibility?.[0];
    if (!elig || (!elig.overall_result && !elig.override_applied)) {
      blockers.push({ code: 'NOT_ELIGIBLE', message: 'Claim is not eligible (and no approved override)' });
    }

    if (!calcs?.[0]) {
      blockers.push({ code: 'NO_CALCULATION', message: 'Calculation has not been finalized' });
    }
  } else {
    blockers.push({ code: 'NO_CLAIM_LINK', message: 'Payable is not linked to a claim' });
  }

  // Documents flagged "Blocks Payment" on the product must be fulfilled or
  // waived before this payable can be paid — checked against the claim's
  // actual evidence checklist, not just the product's static requirement list.
  if (pi.claim_id) {
    const { data: checklist } = await db
      .from('bn_evidence_checklist')
      .select('status, bn_doc_requirement(document_type_code, blocks_payment)')
      .eq('claim_id', pi.claim_id);
    const outstanding = (checklist ?? []).filter((c: any) =>
      c.bn_doc_requirement?.blocks_payment && !['FULFILLED', 'WAIVED'].includes(c.status),
    );
    if (outstanding.length) {
      blockers.push({
        code: 'DOCUMENT_BLOCKS_PAYMENT',
        message: `Payment-blocking document(s) not yet fulfilled: ${outstanding.map((c: any) => c.bn_doc_requirement?.document_type_code).join(', ')}`,
      });
    }
  }

  return {
    payableId: pi.id,
    claimId: pi.claim_id,
    ok: blockers.length === 0,
    blockers,
  };
}

