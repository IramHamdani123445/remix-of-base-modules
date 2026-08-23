/**
 * Arrangement Register Service — read-only operational reads.
 *
 * All figures come from authoritative server-side views:
 *   ce_v_arrangement_register                    (per-arrangement operational summary)
 *   ce_v_arrangement_installment_operational     (installment schedule + derived status)
 *   ce_v_arrangement_allocation_trail            (canonical payment allocation trail)
 *
 * No financial value is recomputed in the client.
 */
import { supabase } from '@/integrations/supabase/client';

export interface ArrangementRegisterRow {
  arrangement_id: string;
  arrangement_number: string | null;
  employer_id: string | null;
  employer_name: string | null;
  case_id: string | null;
  status: string | null;
  total_arranged: number | null;
  total_paid: number | null;
  outstanding: number | null;
  installment_amount: number | null;
  number_of_installments: number | null;
  frequency: string | null;
  start_date: string | null;
  end_date: string | null;
  breach_detected: boolean | null;
  missed_payments: number | null;
  max_missed_before_breach: number | null;
  created_at: string | null;
  installments_total: number;
  installments_paid: number;
  installments_partial: number;
  overdue_count: number;
  past_due_amount: number;
  unattributed_amount: number;
  next_installment_number: number | null;
  next_due_date: string | null;
  next_installment_amount: number | null;
  breach_count: number;
  unresolved_breach_count: number;
  last_breach_at: string | null;
  health_status: string | null;
  arrangement_default_violation_id: string | null;
  arrangement_default_violation_number: string | null;
}

export interface OperationalInstallment {
  installment_id: string;
  arrangement_id: string;
  arrangement_number: string | null;
  employer_id: string | null;
  employer_name: string | null;
  arrangement_status: string | null;
  case_id: string | null;
  installment_number: number | null;
  due_date: string | null;
  scheduled_amount: number | null;
  paid_amount: number | null;
  outstanding_amount: number | null;
  paid_date: string | null;
  payment_reference: string | null;
  stored_status: string | null;
  grace_days: number | null;
  effective_status: string;
  days_overdue: number;
  days_until_due: number | null;
  allocation_count: number;
  allocated_amount: number;
  unattributed_amount: number;
}

export interface AllocationTrailRow {
  allocation_id: string;
  allocation_key: string | null;
  payment_date: string | null;
  receipt_id: string | null;
  amount_received: number | null;
  allocation_amount: number | null;
  allocation_order: number | null;
  allocation_policy: string | null;
  fund_type: string | null;
  is_reversed: boolean | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  created_at: string | null;
  ledger_entry_id: string | null;
  ledger_posted_at: string | null;
  ledger_payment_reference: string | null;
  ledger_credit_amount: number | null;
  ledger_status: string | null;
  installment_id: string | null;
  installment_number: number | null;
  installment_due_date: string | null;
  arrangement_id: string | null;
  arrangement_number: string | null;
  employer_id: string | null;
  employer_name: string | null;
  item_id: string | null;
  liability_type: string | null;
  source_reference_no: string | null;
  period_from: string | null;
  period_to: string | null;
  is_unattributed: boolean | null;
}

const table = (name: string) => supabase.from(name as never);

/** Full operational register (server-side aggregated). */
export async function fetchArrangementRegister(): Promise<ArrangementRegisterRow[]> {
  const { data, error } = await table('ce_v_arrangement_register')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as ArrangementRegisterRow[];
}

/** One register row (used for the detail Overview strip). */
export async function fetchArrangementRegisterRow(
  arrangementId: string,
): Promise<ArrangementRegisterRow | null> {
  const { data, error } = await table('ce_v_arrangement_register')
    .select('*')
    .eq('arrangement_id', arrangementId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as ArrangementRegisterRow | null;
}

/** Installment schedule for one arrangement. */
export async function fetchArrangementInstallments(
  arrangementId: string,
): Promise<OperationalInstallment[]> {
  const { data, error } = await table('ce_v_arrangement_installment_operational')
    .select('*')
    .eq('arrangement_id', arrangementId)
    .order('installment_number', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as OperationalInstallment[];
}

/** Cross-arrangement installments for the "Installments Due" workqueue. */
export async function fetchInstallmentsDue(horizonDays = 30): Promise<OperationalInstallment[]> {
  const horizon = new Date(Date.now() + horizonDays * 86400000).toISOString().slice(0, 10);
  const { data, error } = await table('ce_v_arrangement_installment_operational')
    .select('*')
    .in('effective_status', ['PENDING', 'PARTIAL', 'OVERDUE'])
    .lte('due_date', horizon)
    .order('due_date', { ascending: true })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as OperationalInstallment[];
}

/** Canonical allocation trail, optionally scoped to one arrangement. */
export async function fetchAllocationTrail(arrangementId?: string): Promise<AllocationTrailRow[]> {
  let q = table('ce_v_arrangement_allocation_trail')
    .select('*')
    .order('payment_date', { ascending: false })
    .order('allocation_order', { ascending: true })
    .limit(500);
  if (arrangementId) q = q.eq('arrangement_id', arrangementId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as AllocationTrailRow[];
}

/** Configured grace days after an installment due date. */
export async function fetchGraceDays(): Promise<number> {
  const { data, error } = await supabase.rpc('ce_arrangement_grace_days' as never);
  if (error) throw error;
  return Number(data ?? 0);
}

/**
 * Reconciliation check between the arrangement header, its installments and
 * the canonical allocation trail. Surfaces disagreement rather than choosing
 * a preferred number.
 */
export interface ReconciliationIssue {
  scope: string;
  expected: number;
  actual: number;
  message: string;
}

export function detectReconciliationIssues(
  row: ArrangementRegisterRow | null,
  installments: OperationalInstallment[],
  allocations: AllocationTrailRow[],
): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = [];
  const round = (n: number) => Math.round(n * 100) / 100;
  if (row) {
    const headerOutstanding = round(Number(row.total_arranged ?? 0) - Number(row.total_paid ?? 0));
    if (round(Number(row.outstanding ?? 0)) !== headerOutstanding) {
      issues.push({
        scope: 'Arrangement',
        expected: headerOutstanding,
        actual: round(Number(row.outstanding ?? 0)),
        message: 'Arrangement outstanding does not equal arranged minus paid.',
      });
    }
    if (installments.length > 0) {
      const instPaid = round(installments.reduce((s, i) => s + Number(i.paid_amount ?? 0), 0));
      if (instPaid > round(Number(row.total_paid ?? 0)) + 0.01) {
        issues.push({
          scope: 'Installments vs header',
          expected: round(Number(row.total_paid ?? 0)),
          actual: instPaid,
          message: 'Sum of installment payments exceeds the arrangement total paid.',
        });
      }
    }
  }
  for (const inst of installments) {
    const allocated = round(
      allocations
        .filter((a) => a.installment_id === inst.installment_id && !a.is_reversed && !a.is_unattributed)
        .reduce((s, a) => s + Number(a.allocation_amount ?? 0), 0),
    );
    if (allocated > round(Number(inst.paid_amount ?? 0)) + 0.01) {
      issues.push({
        scope: `Installment #${inst.installment_number}`,
        expected: round(Number(inst.paid_amount ?? 0)),
        actual: allocated,
        message: 'Allocated amount exceeds the recorded installment payment.',
      });
    }
    const expectedOutstanding = round(
      Number(inst.scheduled_amount ?? 0) - Number(inst.paid_amount ?? 0),
    );
    if (round(Number(inst.outstanding_amount ?? 0)) !== Math.max(expectedOutstanding, 0)) {
      issues.push({
        scope: `Installment #${inst.installment_number}`,
        expected: Math.max(expectedOutstanding, 0),
        actual: round(Number(inst.outstanding_amount ?? 0)),
        message: 'Installment outstanding does not equal scheduled minus paid.',
      });
    }
  }
  return issues;
}
