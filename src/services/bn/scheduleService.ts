/**
 * Payment Schedule Management Service
 *
 * Business Purpose:
 *   Supports one-time and recurring benefit disbursement planning before
 *   batch and issue. Schedule rows are orchestration records only — issued
 *   payments persist to cl_cheques / cl_cheques_holding / cl_cheques_survivor.
 *
 * Existing tables used:
 *   - bn_claim (claim context, linked-claim refs)
 *   - bn_entitlement (parent entitlement — rates, duration, balance)
 *   - bn_payment_instruction (payable instructions generated from schedule rows)
 *   - bn_claim_event (audit trail)
 *   - bn_product / bn_product_version (benefit type, frequency config)
 *   - cl_head (legacy claim header — soft join)
 *   - cl_cheques (outbound payment — read-only from here)
 *
 * New tables used:
 *   - bn_payment_schedule (this module's primary table)
 *
 * CRITICAL CONSTRAINTS:
 *   - Schedule rows are planning/orchestration records ONLY.
 *   - This module does NOT write to cl_cheques — payment batch process does.
 *   - cn_payment*, cn_receipt, cn_refund are NEVER used for outbound benefit payments.
 *   - Each schedule row, when due, generates a bn_payment_instruction (PENDING).
 */
import { supabase } from '@/integrations/supabase/client';
import { addWeeks, addDays, addMonths, isBefore, isAfter, startOfDay } from 'date-fns';
import { toStorageDate } from '@/lib/culture/culture';
import { auditConfigChange } from '@/services/bn/audit/bnAuditService';

const db = supabase as any;

const safeScheduleAudit = async (
  action: string,
  entityId: string | null,
  performedBy: string,
  beforeValue: Record<string, any> | null,
  afterValue: Record<string, any> | null,
) => {
  try {
    await auditConfigChange({
      entityType: 'bn_payment_schedule',
      entityId,
      action,
      performedBy: performedBy || 'SYSTEM',
      beforeValue,
      afterValue,
    });
  } catch (e) {
    console.warn('[scheduleService] audit failed (non-blocking):', e);
  }
};


// ─── Types ──────────────────────────────────────────────────────────

export type ScheduleRowStatus =
  | 'PROJECTED'    // Future row, not yet actionable
  | 'DUE'          // Reached due date, ready for instruction generation
  | 'GENERATED'    // bn_payment_instruction created from this row
  | 'SUSPENDED'    // Suspended (entitlement or manual suspension)
  | 'SKIPPED'      // Skipped (correction, catch-up replacement, etc.)
  | 'CANCELLED'    // Permanently cancelled
  | 'ARREARS'      // Arrears catch-up row
  | 'ADJUSTED';    // Adjusted row (rate change mid-schedule)

export type ScheduleFrequency = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'ONE_TIME';

export type ScheduleGenerationMode = 'INITIAL' | 'REGENERATE' | 'CATCH_UP' | 'ARREARS' | 'CORRECTION';

export interface BnPaymentScheduleRow {
  id: string;
  entitlement_id: string;
  claim_id: string;
  ssn: string;
  claim_number: string | null;

  // Schedule definition
  sequence_number: number;
  frequency: ScheduleFrequency;
  period_start: string;
  period_end: string;
  due_date: string;
  amount: number;
  currency: string;

  // Rate snapshot (frozen at generation time)
  rate_weekly: number | null;
  rate_monthly: number | null;
  rate_applied: number;  // Actual rate used for this row

  // Status
  status: ScheduleRowStatus;
  generation_mode: ScheduleGenerationMode;

  // Instruction link
  instruction_id: string | null;  // Links to bn_payment_instruction when generated
  batch_id: string | null;        // Populated downstream by batch process
  cl_cheque_no: string | null;    // Populated downstream when issued

  // Suspension
  suspended_at: string | null;
  suspended_by: string | null;
  suspension_reason: string | null;

  // Adjustment
  adjusted_from_id: string | null; // Original row this adjusts
  adjustment_reason: string | null;

  // Arrears
  arrears_from: string | null;
  arrears_to: string | null;
  arrears_periods: number | null;

  // Audit
  entered_by: string | null;
  entered_at: string;
  modified_by: string | null;
  modified_at: string | null;

  // Legacy
  legacy_schedule_ref: string | null;
}

export interface ScheduleWithContext extends BnPaymentScheduleRow {
  benefit_name: string | null;
  product_category: string | null;
  entitlement_status: string | null;
  claim_status: string | null;
  total_entitlement: number | null;
  remaining_amount: number | null;
}

export interface ScheduleFilters {
  entitlementId?: string;
  claimId?: string;
  ssn?: string;
  status?: string[];
  frequency?: string;
  search?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
}

export interface ScheduleSummary {
  totalRows: number;
  projected: number;
  due: number;
  generated: number;
  suspended: number;
  cancelled: number;
  arrears: number;
  totalScheduledAmount: number;
  totalGeneratedAmount: number;
}

// ─── Status Configuration ───────────────────────────────────────────

export const SCHEDULE_STATUS_CONFIG: Record<ScheduleRowStatus, {
  label: string;
  description: string;
}> = {
  PROJECTED:  { label: 'Projected',  description: 'Future row not yet due for instruction generation' },
  DUE:        { label: 'Due',        description: 'Due date reached; ready for instruction generation' },
  GENERATED:  { label: 'Generated',  description: 'Payment instruction created from this row' },
  SUSPENDED:  { label: 'Suspended',  description: 'Temporarily suspended — no instruction generated' },
  SKIPPED:    { label: 'Skipped',    description: 'Skipped due to correction or replacement' },
  CANCELLED:  { label: 'Cancelled',  description: 'Permanently cancelled' },
  ARREARS:    { label: 'Arrears',    description: 'Arrears catch-up row' },
  ADJUSTED:   { label: 'Adjusted',   description: 'Rate or amount adjusted mid-schedule' },
};

export const SCHEDULE_STATUS_LABELS: Record<ScheduleRowStatus, string> = Object.fromEntries(
  Object.entries(SCHEDULE_STATUS_CONFIG).map(([k, v]) => [k, v.label])
) as Record<ScheduleRowStatus, string>;

// ─── Actions ────────────────────────────────────────────────────────

export interface ScheduleAction {
  action: string;
  label: string;
  variant: 'default' | 'destructive' | 'outline' | 'secondary';
  scope: 'row' | 'schedule';  // Row-level or entire schedule
  fromStatuses: ScheduleRowStatus[];
  toStatus: ScheduleRowStatus | null;  // null = complex logic
  requiresNarrative: boolean;
  requiresReasonCode: boolean;
  roles: string[];
  bulk: boolean;
  auditEvent: string;
  notificationTrigger: string | null;
  description: string;
}

export const SCHEDULE_ACTIONS: ScheduleAction[] = [
  {
    action: 'GENERATE_INSTRUCTION',
    label: 'Generate Instruction',
    variant: 'default',
    scope: 'row',
    fromStatuses: ['DUE', 'ARREARS'],
    toStatus: 'GENERATED',
    requiresNarrative: false,
    requiresReasonCode: false,
    roles: ['SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN'],
    bulk: true,
    auditEvent: 'schedule.instruction_generated',
    notificationTrigger: null,
    description: 'Create bn_payment_instruction from this schedule row',
  },
  {
    action: 'SUSPEND_ROW',
    label: 'Suspend',
    variant: 'destructive',
    scope: 'row',
    fromStatuses: ['PROJECTED', 'DUE'],
    toStatus: 'SUSPENDED',
    requiresNarrative: true,
    requiresReasonCode: true,
    roles: ['SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN'],
    bulk: true,
    auditEvent: 'schedule.row_suspended',
    notificationTrigger: 'schedule.suspended',
    description: 'Suspend this schedule row — no instruction will be generated',
  },
  {
    action: 'RESUME_ROW',
    label: 'Resume',
    variant: 'default',
    scope: 'row',
    fromStatuses: ['SUSPENDED'],
    toStatus: 'PROJECTED',
    requiresNarrative: true,
    requiresReasonCode: false,
    roles: ['SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN'],
    bulk: true,
    auditEvent: 'schedule.row_resumed',
    notificationTrigger: null,
    description: 'Resume suspended schedule row',
  },
  {
    action: 'SKIP_ROW',
    label: 'Skip',
    variant: 'outline',
    scope: 'row',
    fromStatuses: ['PROJECTED', 'DUE', 'SUSPENDED'],
    toStatus: 'SKIPPED',
    requiresNarrative: true,
    requiresReasonCode: false,
    roles: ['MANAGER', 'DIRECTOR', 'ADMIN'],
    bulk: false,
    auditEvent: 'schedule.row_skipped',
    notificationTrigger: null,
    description: 'Skip this row (correction or replacement)',
  },
  {
    action: 'CANCEL_ROW',
    label: 'Cancel',
    variant: 'destructive',
    scope: 'row',
    fromStatuses: ['PROJECTED', 'DUE', 'SUSPENDED'],
    toStatus: 'CANCELLED',
    requiresNarrative: true,
    requiresReasonCode: true,
    roles: ['MANAGER', 'DIRECTOR', 'ADMIN'],
    bulk: false,
    auditEvent: 'schedule.row_cancelled',
    notificationTrigger: 'schedule.cancelled',
    description: 'Permanently cancel this schedule row',
  },
  {
    action: 'SUSPEND_FUTURE',
    label: 'Suspend All Future',
    variant: 'destructive',
    scope: 'schedule',
    fromStatuses: ['PROJECTED'],
    toStatus: 'SUSPENDED',
    requiresNarrative: true,
    requiresReasonCode: true,
    roles: ['SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN'],
    bulk: false,
    auditEvent: 'schedule.future_suspended',
    notificationTrigger: 'schedule.bulk_suspended',
    description: 'Suspend all future PROJECTED rows for this entitlement',
  },
  {
    action: 'REGENERATE',
    label: 'Regenerate Schedule',
    variant: 'secondary',
    scope: 'schedule',
    fromStatuses: [],
    toStatus: null,
    requiresNarrative: true,
    requiresReasonCode: false,
    roles: ['MANAGER', 'DIRECTOR', 'ADMIN'],
    bulk: false,
    auditEvent: 'schedule.regenerated',
    notificationTrigger: 'schedule.regenerated',
    description: 'Cancel future rows and regenerate from current entitlement state',
  },
  {
    action: 'GENERATE_ARREARS',
    label: 'Generate Arrears',
    variant: 'secondary',
    scope: 'schedule',
    fromStatuses: [],
    toStatus: null,
    requiresNarrative: true,
    requiresReasonCode: false,
    roles: ['SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN'],
    bulk: false,
    auditEvent: 'schedule.arrears_generated',
    notificationTrigger: 'schedule.arrears',
    description: 'Generate arrears catch-up rows for missed periods',
  },
];

// ─── Role Matrix ────────────────────────────────────────────────────

export const SCHEDULE_ROLE_MATRIX: Record<string, { canView: boolean; canAct: boolean; actions: string[] }> = {
  CLAIMS_OFFICER: { canView: true, canAct: false, actions: [] },
  SUPERVISOR: {
    canView: true, canAct: true,
    actions: ['GENERATE_INSTRUCTION', 'SUSPEND_ROW', 'RESUME_ROW', 'SUSPEND_FUTURE', 'GENERATE_ARREARS'],
  },
  MANAGER: {
    canView: true, canAct: true,
    actions: ['GENERATE_INSTRUCTION', 'SUSPEND_ROW', 'RESUME_ROW', 'SKIP_ROW', 'CANCEL_ROW', 'SUSPEND_FUTURE', 'REGENERATE', 'GENERATE_ARREARS'],
  },
  DIRECTOR: {
    canView: true, canAct: true,
    actions: ['GENERATE_INSTRUCTION', 'SUSPEND_ROW', 'RESUME_ROW', 'SKIP_ROW', 'CANCEL_ROW', 'SUSPEND_FUTURE', 'REGENERATE', 'GENERATE_ARREARS'],
  },
  ADMIN: {
    canView: true, canAct: true,
    actions: ['GENERATE_INSTRUCTION', 'SUSPEND_ROW', 'RESUME_ROW', 'SKIP_ROW', 'CANCEL_ROW', 'SUSPEND_FUTURE', 'REGENERATE', 'GENERATE_ARREARS'],
  },
  AUDITOR: { canView: true, canAct: false, actions: [] },
};

// ─── Schedule Generation Logic ──────────────────────────────────────

export interface GenerateScheduleParams {
  entitlementId: string;
  claimId: string;
  ssn: string;
  claimNumber: string | null;
  frequency: ScheduleFrequency;
  startDate: string;
  endDate: string | null;        // null = open-ended (pension-style)
  weeklyRate: number;
  monthlyRate: number | null;
  totalEntitlement: number;
  maxPeriods?: number;            // Safety cap for open-ended (default 52 weeks / 12 months)
  currency?: string;
  mode: ScheduleGenerationMode;
  performedBy: string;
}

function computePeriodAmount(frequency: ScheduleFrequency, weeklyRate: number, monthlyRate: number | null): number {
  switch (frequency) {
    case 'WEEKLY': return weeklyRate;
    case 'FORTNIGHTLY': return weeklyRate * 2;
    case 'MONTHLY': return monthlyRate ?? weeklyRate * 4.33;
    case 'ONE_TIME': return monthlyRate ?? weeklyRate;
    default: return weeklyRate;
  }
}

function advanceDate(date: Date, frequency: ScheduleFrequency): Date {
  switch (frequency) {
    case 'WEEKLY': return addWeeks(date, 1);
    case 'FORTNIGHTLY': return addWeeks(date, 2);
    case 'MONTHLY': return addMonths(date, 1);
    case 'ONE_TIME': return date; // No advancement
    default: return addWeeks(date, 1);
  }
}

function periodEndDate(periodStart: Date, frequency: ScheduleFrequency): Date {
  switch (frequency) {
    case 'WEEKLY': return addDays(periodStart, 6);
    case 'FORTNIGHTLY': return addDays(periodStart, 13);
    case 'MONTHLY': return addDays(addMonths(periodStart, 1), -1);
    case 'ONE_TIME': return periodStart;
    default: return addDays(periodStart, 6);
  }
}

export function generateScheduleRows(params: GenerateScheduleParams): Omit<BnPaymentScheduleRow, 'id' | 'entered_at'>[] {
  const {
    entitlementId, claimId, ssn, claimNumber, frequency,
    startDate, endDate, weeklyRate, monthlyRate, totalEntitlement,
    maxPeriods = frequency === 'MONTHLY' ? 12 : 52,
    currency = 'XCD', mode, performedBy,
  } = params;

  const rows: Omit<BnPaymentScheduleRow, 'id' | 'entered_at'>[] = [];
  const periodAmount = computePeriodAmount(frequency, weeklyRate, monthlyRate);

  if (frequency === 'ONE_TIME') {
    rows.push({
      entitlement_id: entitlementId,
      claim_id: claimId,
      ssn,
      claim_number: claimNumber,
      sequence_number: 1,
      frequency,
      period_start: startDate,
      period_end: startDate,
      due_date: startDate,
      amount: totalEntitlement,
      currency,
      rate_weekly: weeklyRate,
      rate_monthly: monthlyRate,
      rate_applied: totalEntitlement,
      status: 'PROJECTED',
      generation_mode: mode,
      instruction_id: null,
      batch_id: null,
      cl_cheque_no: null,
      suspended_at: null,
      suspended_by: null,
      suspension_reason: null,
      adjusted_from_id: null,
      adjustment_reason: null,
      arrears_from: null,
      arrears_to: null,
      arrears_periods: null,
      entered_by: performedBy,
      modified_by: null,
      modified_at: null,
      legacy_schedule_ref: null,
    });
    return rows;
  }

  let currentStart = startOfDay(new Date(startDate));
  const endLimit = endDate ? startOfDay(new Date(endDate)) : null;
  let seq = 1;
  let cumulativeAmount = 0;

  while (seq <= maxPeriods) {
    const pEnd = periodEndDate(currentStart, frequency);
    const dueDate = currentStart;

    // Stop if past end date
    if (endLimit && isAfter(currentStart, endLimit)) break;

    // Stop if total entitlement would be exceeded
    const rowAmount = Math.min(periodAmount, totalEntitlement - cumulativeAmount);
    if (rowAmount <= 0) break;

    rows.push({
      entitlement_id: entitlementId,
      claim_id: claimId,
      ssn,
      claim_number: claimNumber,
      sequence_number: seq,
      frequency,
      period_start: toStorageDate(currentStart),
      period_end: toStorageDate(pEnd),
      due_date: toStorageDate(dueDate),
      amount: Math.round(rowAmount * 100) / 100,
      currency,
      rate_weekly: weeklyRate,
      rate_monthly: monthlyRate,
      rate_applied: periodAmount,
      status: 'PROJECTED',
      generation_mode: mode,
      instruction_id: null,
      batch_id: null,
      cl_cheque_no: null,
      suspended_at: null,
      suspended_by: null,
      suspension_reason: null,
      adjusted_from_id: null,
      adjustment_reason: null,
      arrears_from: null,
      arrears_to: null,
      arrears_periods: null,
      entered_by: performedBy,
      modified_by: null,
      modified_at: null,
      legacy_schedule_ref: null,
    });

    cumulativeAmount += rowAmount;
    currentStart = advanceDate(currentStart, frequency);
    seq++;
  }

  return rows;
}

// ─── Fetch Schedules ────────────────────────────────────────────────

export async function fetchScheduleRows(filters: ScheduleFilters = {}): Promise<ScheduleWithContext[]> {
  let query = db
    .from('bn_payment_schedule')
    .select(`
      *,
      bn_entitlement(id, status, total_entitlement, remaining_amount, weekly_rate, claim_number),
      bn_claim(claim_number, ssn, status, bn_product(benefit_name, category))
    `)
    .order('sequence_number', { ascending: true })
    .limit(500);

  if (filters.entitlementId) query = query.eq('entitlement_id', filters.entitlementId);
  if (filters.claimId) query = query.eq('claim_id', filters.claimId);
  if (filters.ssn) query = query.eq('ssn', filters.ssn);
  if (filters.status?.length) query = query.in('status', filters.status);
  if (filters.frequency) query = query.eq('frequency', filters.frequency);
  if (filters.search) query = query.or(`ssn.ilike.%${filters.search}%,claim_number.ilike.%${filters.search}%`);
  if (filters.dueDateFrom) query = query.gte('due_date', filters.dueDateFrom);
  if (filters.dueDateTo) query = query.lte('due_date', filters.dueDateTo);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    ...r,
    benefit_name: r.bn_claim?.bn_product?.benefit_name || null,
    product_category: r.bn_claim?.bn_product?.category || null,
    entitlement_status: r.bn_entitlement?.status || null,
    claim_status: r.bn_claim?.status || null,
    total_entitlement: r.bn_entitlement?.total_entitlement || null,
    remaining_amount: r.bn_entitlement?.remaining_amount || null,
  }));
}

export async function fetchScheduleSummary(entitlementId: string): Promise<ScheduleSummary> {
  const { data, error } = await db
    .from('bn_payment_schedule')
    .select('status, amount')
    .eq('entitlement_id', entitlementId);

  if (error) throw error;
  const rows = data ?? [];

  return {
    totalRows: rows.length,
    projected: rows.filter((r: any) => r.status === 'PROJECTED').length,
    due: rows.filter((r: any) => r.status === 'DUE').length,
    generated: rows.filter((r: any) => r.status === 'GENERATED').length,
    suspended: rows.filter((r: any) => r.status === 'SUSPENDED').length,
    cancelled: rows.filter((r: any) => r.status === 'CANCELLED').length,
    arrears: rows.filter((r: any) => r.status === 'ARREARS').length,
    totalScheduledAmount: rows
      .filter((r: any) => !['CANCELLED', 'SKIPPED'].includes(r.status))
      .reduce((sum: number, r: any) => sum + (r.amount ?? 0), 0),
    totalGeneratedAmount: rows
      .filter((r: any) => r.status === 'GENERATED')
      .reduce((sum: number, r: any) => sum + (r.amount ?? 0), 0),
  };
}

// ─── Execute Schedule Row Action ────────────────────────────────────

export interface ExecuteScheduleActionParams {
  rowId: string;
  action: string;
  narrative?: string;
  reasonCodeId?: string;
  performedBy: string;
}

export async function executeScheduleRowAction(params: ExecuteScheduleActionParams): Promise<{ success: boolean; newStatus: ScheduleRowStatus }> {
  const { rowId, action, narrative, reasonCodeId, performedBy } = params;

  const actionDef = SCHEDULE_ACTIONS.find(a => a.action === action && a.scope === 'row');
  if (!actionDef) throw new Error(`Unknown schedule row action: ${action}`);

  const { data: row, error: fetchErr } = await db
    .from('bn_payment_schedule')
    .select('id, status, claim_id, entitlement_id, ssn')
    .eq('id', rowId)
    .single();
  if (fetchErr || !row) throw new Error('Schedule row not found');

  if (!actionDef.fromStatuses.includes(row.status)) {
    throw new Error(`Cannot ${action} from status ${row.status}`);
  }
  if (actionDef.requiresNarrative && !narrative?.trim()) throw new Error('Narrative required');
  if (actionDef.requiresReasonCode && !reasonCodeId) throw new Error('Reason code required');

  const now = new Date().toISOString();
  const newStatus = actionDef.toStatus!;

  const update: Record<string, any> = {
    status: newStatus,
    modified_by: performedBy,
    modified_at: now,
  };

  if (action === 'SUSPEND_ROW') {
    update.suspended_at = now;
    update.suspended_by = performedBy;
    update.suspension_reason = narrative;
  }
  if (action === 'RESUME_ROW') {
    update.suspended_at = null;
    update.suspended_by = null;
    update.suspension_reason = null;
  }

  const { error: updErr } = await db
    .from('bn_payment_schedule')
    .update(update)
    .eq('id', rowId);
  if (updErr) throw updErr;

  await db.from('bn_claim_event').insert({
    claim_id: row.claim_id,
    event_type: `SCHEDULE_${action}`,
    from_status: row.status,
    to_status: newStatus,
    notes: narrative || `Schedule action: ${action}`,
    performed_by: performedBy,
    performed_at: now,
    metadata: {
      schedule_row_id: rowId,
      entity_type: 'PAYMENT_SCHEDULE',
      reason_code_id: reasonCodeId,
      entitlement_id: row.entitlement_id,
      action,
    },
  });

  await safeScheduleAudit(`SCHEDULE_${action}`, rowId, performedBy, { status: row.status }, { status: newStatus });

  return { success: true, newStatus };
}


// ─── Schedule-Level Actions ─────────────────────────────────────────

export async function suspendFutureRows(entitlementId: string, performedBy: string, narrative: string, reasonCodeId: string): Promise<number> {
  const today = toStorageDate(new Date());

  const { data: rows } = await db
    .from('bn_payment_schedule')
    .select('id, claim_id')
    .eq('entitlement_id', entitlementId)
    .eq('status', 'PROJECTED')
    .gte('due_date', today);

  if (!rows?.length) return 0;

  const now = new Date().toISOString();
  const { error } = await db
    .from('bn_payment_schedule')
    .update({
      status: 'SUSPENDED',
      suspended_at: now,
      suspended_by: performedBy,
      suspension_reason: narrative,
      modified_by: performedBy,
      modified_at: now,
    })
    .eq('entitlement_id', entitlementId)
    .eq('status', 'PROJECTED')
    .gte('due_date', today);

  if (error) throw error;

  // Audit
  if (rows[0]) {
    await db.from('bn_claim_event').insert({
      claim_id: rows[0].claim_id,
      event_type: 'SCHEDULE_FUTURE_SUSPENDED',
      notes: narrative,
      performed_by: performedBy,
      performed_at: now,
      metadata: {
        entity_type: 'PAYMENT_SCHEDULE',
        entitlement_id: entitlementId,
        rows_affected: rows.length,
        reason_code_id: reasonCodeId,
      },
    });
  }

  await safeScheduleAudit('SUSPEND_FUTURE_ROWS', entitlementId, performedBy, null, { rows_affected: rows.length, narrative, reasonCodeId });

  return rows.length;
}


export async function regenerateSchedule(
  entitlementId: string,
  performedBy: string,
  narrative: string
): Promise<{ cancelledRows: number; newRows: number }> {
  const today = toStorageDate(new Date());
  const now = new Date().toISOString();

  // Cancel future non-generated rows
  const { data: cancelled } = await db
    .from('bn_payment_schedule')
    .select('id')
    .eq('entitlement_id', entitlementId)
    .in('status', ['PROJECTED', 'DUE', 'SUSPENDED'])
    .gte('due_date', today);

  if (cancelled?.length) {
    await db
      .from('bn_payment_schedule')
      .update({ status: 'CANCELLED', modified_by: performedBy, modified_at: now })
      .eq('entitlement_id', entitlementId)
      .in('status', ['PROJECTED', 'DUE', 'SUSPENDED'])
      .gte('due_date', today);
  }

  // Fetch entitlement for regeneration params
  const { data: ent } = await db
    .from('bn_entitlement')
    .select('*, bn_claim(claim_number, ssn)')
    .eq('id', entitlementId)
    .single();

  if (!ent) throw new Error('Entitlement not found for regeneration');

  const newRows = generateScheduleRows({
    entitlementId,
    claimId: ent.claim_id,
    ssn: ent.ssn,
    claimNumber: ent.bn_claim?.claim_number || ent.claim_number,
    frequency: ent.payment_frequency,
    startDate: today,
    endDate: ent.effective_to,
    weeklyRate: ent.weekly_rate,
    monthlyRate: ent.monthly_rate,
    totalEntitlement: ent.remaining_amount ?? ent.total_entitlement,
    mode: 'REGENERATE',
    performedBy,
  });

  if (newRows.length) {
    // Find max existing sequence
    const { data: maxSeq } = await db
      .from('bn_payment_schedule')
      .select('sequence_number')
      .eq('entitlement_id', entitlementId)
      .order('sequence_number', { ascending: false })
      .limit(1);

    const startSeq = (maxSeq?.[0]?.sequence_number ?? 0) + 1;
    const insertRows = newRows.map((r, i) => ({
      ...r,
      sequence_number: startSeq + i,
    }));

    await db.from('bn_payment_schedule').insert(insertRows);
  }

  // Audit
  await db.from('bn_claim_event').insert({
    claim_id: ent.claim_id,
    event_type: 'SCHEDULE_REGENERATED',
    notes: narrative,
    performed_by: performedBy,
    performed_at: now,
    metadata: {
      entity_type: 'PAYMENT_SCHEDULE',
      entitlement_id: entitlementId,
      cancelled_rows: cancelled?.length ?? 0,
      new_rows: newRows.length,
    },
  });

  await safeScheduleAudit('REGENERATE_SCHEDULE', entitlementId, performedBy, { cancelled_rows: cancelled?.length ?? 0 }, { new_rows: newRows.length, narrative });

  return { cancelledRows: cancelled?.length ?? 0, newRows: newRows.length };
}


// ─── Arrears Generation ─────────────────────────────────────────────

export async function generateArrearsRows(
  entitlementId: string,
  arrearsFrom: string,
  arrearsTo: string,
  performedBy: string,
  narrative: string
): Promise<number> {
  const { data: ent } = await db
    .from('bn_entitlement')
    .select('*, bn_claim(claim_number, ssn)')
    .eq('id', entitlementId)
    .single();

  if (!ent) throw new Error('Entitlement not found');

  const arrearsRows = generateScheduleRows({
    entitlementId,
    claimId: ent.claim_id,
    ssn: ent.ssn,
    claimNumber: ent.bn_claim?.claim_number || ent.claim_number,
    frequency: ent.payment_frequency,
    startDate: arrearsFrom,
    endDate: arrearsTo,
    weeklyRate: ent.weekly_rate,
    monthlyRate: ent.monthly_rate,
    totalEntitlement: ent.remaining_amount ?? ent.total_entitlement,
    mode: 'ARREARS',
    performedBy,
  });

  // Mark as ARREARS status
  const { data: maxSeq } = await db
    .from('bn_payment_schedule')
    .select('sequence_number')
    .eq('entitlement_id', entitlementId)
    .order('sequence_number', { ascending: false })
    .limit(1);

  const startSeq = (maxSeq?.[0]?.sequence_number ?? 0) + 1;
  const insertRows = arrearsRows.map((r, i) => ({
    ...r,
    sequence_number: startSeq + i,
    status: 'ARREARS' as ScheduleRowStatus,
    arrears_from: arrearsFrom,
    arrears_to: arrearsTo,
    arrears_periods: arrearsRows.length,
  }));

  if (insertRows.length) {
    await db.from('bn_payment_schedule').insert(insertRows);
  }

  // Audit
  await db.from('bn_claim_event').insert({
    claim_id: ent.claim_id,
    event_type: 'SCHEDULE_ARREARS_GENERATED',
    notes: narrative,
    performed_by: performedBy,
    performed_at: new Date().toISOString(),
    metadata: {
      entity_type: 'PAYMENT_SCHEDULE',
      entitlement_id: entitlementId,
      arrears_from: arrearsFrom,
      arrears_to: arrearsTo,
      rows_created: insertRows.length,
    },
  });

  await safeScheduleAudit('GENERATE_ARREARS', entitlementId, performedBy, null, { rows_created: insertRows.length, arrears_from: arrearsFrom, arrears_to: arrearsTo, narrative });

  return insertRows.length;
}

