/**
 * Arrangement workflow service — approval, installment payments,
 * payment allocation, and breach detection.
 * Reuses ce_payment_arrangements, ce_installments, ce_arrangement_breaches,
 * ce_payment_allocations, ce_arrangement_policies. No parallel permission system.
 */
import { supabase } from '@/integrations/supabase/client';
import { isComplianceDbFlagEnabled } from '@/lib/compliance/featureToggles';

const PAYMENT_ARRANGEMENT_FLAG = 'compliance.payment.arrangement';
function assertArrangementEnabled() {
  if (!isComplianceDbFlagEnabled(PAYMENT_ARRANGEMENT_FLAG)) {
    throw new Error('Payment Arrangement is disabled in Setup → Feature Toggles.');
  }
}

export type AllocationTarget = 'principal' | 'penalty' | 'interest' | 'legal_fee' | 'oldest_balance';

export const DEFAULT_ALLOCATION_ORDER: AllocationTarget[] = [
  'principal', 'penalty', 'interest', 'legal_fee', 'oldest_balance',
];

// ── Lifecycle ───────────────────────────────────────────────────
export async function submitForApproval(arrangementId: string, userCode: string) {
  assertArrangementEnabled();
  const { error } = await supabase
    .from('ce_payment_arrangements')
    .update({ status: 'PENDING_APPROVAL', updated_by: userCode, updated_at: new Date().toISOString() } as any)
    .eq('id', arrangementId).eq('status', 'DRAFT');
  if (error) throw error;
}

export async function approveArrangement(arrangementId: string, userCode: string) {
  assertArrangementEnabled();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('ce_payment_arrangements')
    .update({ status: 'ACTIVE', approved_by: userCode, approved_at: now, updated_by: userCode, updated_at: now } as any)
    .eq('id', arrangementId).eq('status', 'PENDING_APPROVAL');
  if (error) throw error;
}

export async function rejectArrangement(arrangementId: string, userCode: string, reason?: string) {
  assertArrangementEnabled();
  const { error } = await supabase
    .from('ce_payment_arrangements')
    .update({
      status: 'CANCELLED',
      breach_reason: reason || null,
      updated_by: userCode,
      updated_at: new Date().toISOString(),
    } as any)
    .eq('id', arrangementId)
    .in('status', ['DRAFT', 'PENDING_APPROVAL']);
  if (error) throw error;
}

/**
 * Direct activation from DRAFT — used when the reviewer has authority to
 * skip the two-step submit/approve workflow (e.g. supervisor-created plans).
 * Sets ACTIVE + records approver metadata in one step.
 */
export async function activateArrangement(arrangementId: string, userCode: string) {
  assertArrangementEnabled();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('ce_payment_arrangements')
    .update({
      status: 'ACTIVE',
      approved_by: userCode,
      approved_at: now,
      updated_by: userCode,
      updated_at: now,
    } as any)
    .eq('id', arrangementId)
    .in('status', ['DRAFT', 'PENDING_APPROVAL']);
  if (error) throw error;
}

// ── Installment payment recording ───────────────────────────────
export async function recordInstallmentPayment(input: {
  installmentId: string;
  amount: number;
  paymentReference?: string;
  paidDate?: string;
  userCode: string;
}): Promise<void> {
  assertArrangementEnabled();
  const { data: inst, error: iErr } = await supabase
    .from('ce_installments').select('*').eq('id', input.installmentId).single();
  if (iErr || !inst) throw iErr || new Error('Installment not found');

  const newPaid = Number(inst.paid_amount ?? 0) + input.amount;
  const fullyPaid = newPaid >= Number(inst.amount);
  const partial = !fullyPaid && newPaid > 0;
  const paidDate = input.paidDate || new Date().toISOString().slice(0, 10);

  const { error: uErr } = await supabase.from('ce_installments').update({
    paid_amount: newPaid,
    paid_date: fullyPaid ? paidDate : inst.paid_date,
    payment_reference: input.paymentReference || inst.payment_reference,
    status: fullyPaid ? 'PAID' : partial ? 'PARTIAL' : inst.status,
    is_overdue: false,
    overdue_days: 0,
  } as any).eq('id', input.installmentId);
  if (uErr) throw uErr;

  // Roll up arrangement totals
  const { data: agg } = await supabase
    .from('ce_installments').select('status,paid_amount,amount')
    .eq('arrangement_id', inst.arrangement_id);
  const totalPaid = (agg || []).reduce((s, r: any) => s + Number(r.paid_amount || 0), 0);
  const installmentsPaid = (agg || []).filter((r: any) => r.status === 'PAID').length;

  const { data: arr } = await supabase
    .from('ce_payment_arrangements').select('total_debt').eq('id', inst.arrangement_id).single();
  const complete = arr && totalPaid >= Number(arr.total_debt);

  await supabase.from('ce_payment_arrangements').update({
    total_paid: totalPaid,
    installments_paid: installmentsPaid,
    status: complete ? 'COMPLETED' : undefined,
    updated_by: input.userCode,
    updated_at: new Date().toISOString(),
  } as any).eq('id', inst.arrangement_id);
}

// ── Payment allocation ──────────────────────────────────────────
export async function allocatePayment(input: {
  sourcePaymentId: number;
  sourceTable?: string;
  employerId: string;
  totalAmount: number;
  order?: AllocationTarget[];
  userCode: string;
  notes?: string;
}): Promise<{ allocations: any[]; remaining: number }> {
  assertArrangementEnabled();
  const order = input.order || DEFAULT_ALLOCATION_ORDER;
  let remaining = input.totalAmount;
  const allocations: any[] = [];

  // Find arrangement installments for this employer (oldest unpaid first)
  const { data: arrangements } = await supabase
    .from('ce_payment_arrangements').select('id')
    .eq('employer_id', input.employerId).eq('status', 'ACTIVE');
  const arrIds = (arrangements || []).map((a: any) => a.id);

  let queue: any[] = [];
  if (arrIds.length) {
    const { data: insts } = await supabase
      .from('ce_installments').select('*')
      .in('arrangement_id', arrIds)
      .in('status', ['PENDING', 'PLANNED', 'PARTIAL', 'OVERDUE'])
      .order('due_date', { ascending: true });
    queue = insts || [];
  }

  let seq = 1;
  for (const target of order) {
    if (remaining <= 0) break;
    // For installments we treat 'principal' and 'oldest_balance' uniformly against queue
    const targetType = target === 'penalty' ? 'penalty' :
                       target === 'interest' ? 'interest' :
                       target === 'legal_fee' ? 'other' : 'arrangement';

    for (const inst of queue) {
      if (remaining <= 0) break;
      const due = Number(inst.amount) - Number(inst.paid_amount || 0);
      if (due <= 0) continue;
      const apply = Math.min(due, remaining);

      const { data: a, error } = await supabase.from('ce_payment_allocations').insert({
        source_payment_id: input.sourcePaymentId,
        source_table: input.sourceTable || 'cn_payment',
        employer_id: input.employerId,
        target_type: targetType,
        target_period: null,
        allocated_amount: apply,
        allocation_sequence: seq++,
        allocation_mode: 'arrangement_priority',
        allocated_by: input.userCode,
        notes: input.notes || null,
      } as any).select('*').single();
      if (error) throw error;
      allocations.push(a);

      await recordInstallmentPayment({
        installmentId: inst.id,
        amount: apply,
        paymentReference: `PAY-${input.sourcePaymentId}`,
        userCode: input.userCode,
      });

      inst.paid_amount = Number(inst.paid_amount || 0) + apply;
      remaining -= apply;
      // After applying once per target priority, advance to next target
      break;
    }
  }

  return { allocations, remaining };
}

// ── Breach detection ────────────────────────────────────────────
export interface BreachDetectionResult {
  arrangementId: string;
  missedCount: number;
  breachType: 'MISSED' | 'LATE' | 'PARTIAL' | 'DEFAULTED';
  description: string;
  breachId?: string;
}

export async function detectBreaches(opts: { graceDays?: number; maxMissed?: number; userCode: string }): Promise<BreachDetectionResult[]> {
  // Server-side, grace-aware, occurrence-linked detection (idempotent).
  const { data, error } = await supabase.rpc('ce_detect_arrangement_breaches' as any, {
    p_actor: opts.userCode,
  } as any);
  if (error) throw error;
  const summary = (data as any) || {};
  const created = Number(summary.new_occurrences || 0);
  return Array.from({ length: created }, () => ({
    arrangementId: '',
    missedCount: 1,
    breachType: 'MISSED' as const,
    description: 'Missed installment breach occurrence recorded',
  }));
}
