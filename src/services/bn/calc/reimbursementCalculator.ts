/**
 * Reimbursement Calculator — Medical Expenses (REIMBURSEMENT calc_type).
 *
 * Reads the captured expense lines for a claim (`bn_medical_claim_expense`)
 * and resolves each line through the single medical engine
 * (`medicalPolicyResolver.resolveReimbursement`). When no policy row matches,
 * the line falls back to the approved (or claimed) actual amount so operational
 * claims are never silently valued at zero without an explanation.
 */
import { supabase } from '@/integrations/supabase/client';
import { resolveReimbursement } from './medicalPolicyResolver';

const db = supabase as any;

export interface ReimbursementLine {
  expenseId: string;
  procedureCode: string | null;
  jurisdiction: string;
  claimedAmount: number;
  approvedAmount: number;
  payableAmount: number;
  policyApplied: boolean;
  method: string | null;
  note: string;
}

export interface ReimbursementComputation {
  total: number;
  lines: ReimbursementLine[];
  expenseCount: number;
  /** Reason the total is zero, when applicable. */
  blockingReason: string | null;
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export async function computeClaimReimbursement(
  claimId: string,
  asOfDate?: string,
): Promise<ReimbursementComputation> {
  const { data, error } = await db
    .from('bn_medical_claim_expense')
    .select('id, procedure_id, jurisdiction_level, claimed_amount, approved_amount, status, service_date')
    .eq('claim_id', claimId);

  if (error) throw new Error(error.message);

  const rows = (data ?? []).filter(
    (r: any) => String(r.status ?? '').toUpperCase() !== 'REJECTED',
  );

  if (rows.length === 0) {
    return {
      total: 0,
      lines: [],
      expenseCount: 0,
      blockingReason: 'NO_MEDICAL_EXPENSE_LINES_CAPTURED',
    };
  }

  // Resolve procedure codes in one round-trip.
  const procedureIds = Array.from(
    new Set(rows.map((r: any) => r.procedure_id).filter(Boolean)),
  );
  const procedureCodeById = new Map<string, string>();
  if (procedureIds.length > 0) {
    const { data: procs } = await db
      .from('bn_medical_procedure')
      .select('id, procedure_code')
      .in('id', procedureIds);
    for (const p of procs ?? []) procedureCodeById.set(String(p.id), String(p.procedure_code));
  }

  const lines: ReimbursementLine[] = [];

  for (const row of rows) {
    const claimed = num(row.claimed_amount);
    const approved = row.approved_amount != null ? num(row.approved_amount) : claimed;
    const procedureCode = row.procedure_id
      ? procedureCodeById.get(String(row.procedure_id)) ?? null
      : null;
    const jurisdiction = String(row.jurisdiction_level ?? 'LOCAL_ST_KITTS');

    let payable = approved;
    let policyApplied = false;
    let method: string | null = null;
    let note = 'Actual approved expense (no policy row matched)';

    if (procedureCode) {
      try {
        const trace = await resolveReimbursement({
          procedure_code: procedureCode,
          location_code: jurisdiction,
          provider_type_code: 'ANY',
          approved_expense_amount: approved,
          asOfDate: asOfDate ?? row.service_date ?? undefined,
        });
        if (trace.policy_row_id) {
          policyApplied = true;
          method = trace.reimbursement_method;
          payable = num(trace.payable_amount);
          note = `Policy ${trace.reimbursement_method} → ${payable.toFixed(2)} (${trace.status})`;
        }
      } catch {
        // Policy library unavailable — retain the actual approved amount.
        note = 'Policy library unavailable — actual approved expense used';
      }
    }

    lines.push({
      expenseId: String(row.id),
      procedureCode,
      jurisdiction,
      claimedAmount: claimed,
      approvedAmount: approved,
      payableAmount: payable,
      policyApplied,
      method,
      note,
    });
  }

  const total = lines.reduce((sum, l) => sum + l.payableAmount, 0);

  return {
    total: Math.round(total * 100) / 100,
    lines,
    expenseCount: lines.length,
    blockingReason: total > 0 ? null : 'ALL_EXPENSE_LINES_RESOLVED_TO_ZERO',
  };
}
