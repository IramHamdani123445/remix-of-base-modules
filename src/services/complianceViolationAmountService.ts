/**
 * Compliance financial read layer — SINGLE SOURCE OF TRUTH.
 *
 * Every compliance surface (Violations Management list, Violation Details,
 * Case Details, Employer 360 and their summary widgets) must read money
 * figures through this service. Do NOT recompute principal/penalty/interest/
 * gross/waived/outstanding inside React components — the arithmetic lives in
 * the database so list, detail and roll-up views can never drift.
 *
 * Authoritative database sources
 * ──────────────────────────────
 * | Business value | Violation level                        | Case level                       |
 * |----------------|----------------------------------------|----------------------------------|
 * | Principal      | ce_v_violation_financials.principal    | ce_v_case_financials.principal   |
 * | Penalty/Fine   | ce_v_violation_financials.penalty      | ce_v_case_financials.penalty     |
 * | Interest       | ce_v_violation_financials.interest     | ce_v_case_financials.interest    |
 * | Gross          | ce_v_violation_financials.gross        | ce_v_case_financials.gross       |
 * | Paid/Collected | always 0 — see note                    | ce_v_case_financials.paid        |
 * | Waived         | ce_v_violation_financials.waived       | ce_v_case_financials.waived      |
 * | Outstanding    | gross − waived                         | gross − paid − waived            |
 *
 * Payment note: payments are structurally allocated at case/ledger level only
 * (`ce_payment_allocations` carries no violation_id), so violation-level
 * "paid" is always 0 and collection is reported through the case roll-up.
 * The UI must say so rather than implying a violation was never paid.
 *
 * Employer enforcement exposure uses fn_ce_employer_financial_exposure(), which
 * is non-double-counting by construction:
 *   exposure = SUM(open case outstanding) + SUM(open UNLINKED violation outstanding)
 * A case-linked violation is therefore counted exactly once, via its case.
 */
import { supabase } from '@/integrations/supabase/client';

/** Wording for surfaces that show a violation-level "Paid" column. */
export const VIOLATION_PAID_HELP =
  'Payments are allocated at case and ledger level, not against individual violations. ' +
  'Collections for this employer appear on the linked case and in the financial ledger.';

export interface ComplianceAmounts {
  principal: number;
  penalty: number;
  interest: number;
  gross: number;
  paid: number;
  waived: number;
  outstanding: number;
}

export interface ViolationFinancials extends ComplianceAmounts {
  violation_id: string;
  violation_number: string | null;
  employer_id: string | null;
  status: string | null;
  fund_type: string | null;
  case_id: string | null;
  is_case_linked: boolean;
  is_open: boolean;
}

export interface CaseFinancials extends ComplianceAmounts {
  case_id: string;
  case_number: string | null;
  employer_id: string | null;
  status: string | null;
  fund_type: string | null;
  is_open: boolean;
}

export interface EmployerExposure {
  employer_id: string;
  total_violations: number;
  open_violations: number;
  open_unlinked_violations: number;
  violation_principal: number;
  violation_penalty: number;
  violation_interest: number;
  violation_gross: number;
  violation_waived: number;
  total_cases: number;
  open_cases: number;
  case_gross: number;
  case_paid: number;
  case_waived: number;
  case_outstanding: number;
  unlinked_violation_outstanding: number;
  /** Non-double-counting enforcement exposure. */
  enforcement_exposure: number;
}

export const EMPTY_AMOUNTS: ComplianceAmounts = {
  principal: 0, penalty: 0, interest: 0, gross: 0, paid: 0, waived: 0, outstanding: 0,
};

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function toAmounts(row: any): ComplianceAmounts {
  return {
    principal: num(row?.principal),
    penalty: num(row?.penalty),
    interest: num(row?.interest),
    gross: num(row?.gross),
    paid: num(row?.paid),
    waived: num(row?.waived),
    outstanding: num(row?.outstanding),
  };
}

function toViolationFinancials(row: any): ViolationFinancials {
  return {
    ...toAmounts(row),
    violation_id: row.violation_id,
    violation_number: row.violation_number ?? null,
    employer_id: row.employer_id ?? null,
    status: row.status ?? null,
    fund_type: row.fund_type ?? null,
    case_id: row.case_id ?? null,
    is_case_linked: !!row.is_case_linked,
    is_open: !!row.is_open,
  };
}

function toCaseFinancials(row: any): CaseFinancials {
  return {
    ...toAmounts(row),
    case_id: row.case_id,
    case_number: row.case_number ?? null,
    employer_id: row.employer_id ?? null,
    status: row.status ?? null,
    fund_type: row.fund_type ?? null,
    is_open: !!row.is_open,
  };
}

/** Financials for one violation. */
export async function fetchViolationFinancials(
  violationId?: string | null,
): Promise<ViolationFinancials | null> {
  if (!violationId) return null;
  const { data, error } = await (supabase.from('ce_v_violation_financials' as never) as any)
    .select('*')
    .eq('violation_id', violationId)
    .maybeSingle();
  if (error) throw error;
  return data ? toViolationFinancials(data) : null;
}

/** Financials for many violations, keyed by violation id (for list views). */
export async function fetchViolationFinancialsMap(
  violationIds: string[],
): Promise<Record<string, ViolationFinancials>> {
  const ids = Array.from(new Set(violationIds.filter(Boolean)));
  if (ids.length === 0) return {};
  const out: Record<string, ViolationFinancials> = {};
  // Chunked so long list pages never exceed URL limits.
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await (supabase.from('ce_v_violation_financials' as never) as any)
      .select('*')
      .in('violation_id', ids.slice(i, i + 200));
    if (error) throw error;
    for (const row of data ?? []) out[row.violation_id] = toViolationFinancials(row);
  }
  return out;
}

/** Financials for one case (roll-up of its linked violations plus collections). */
export async function fetchCaseFinancials(caseId?: string | null): Promise<CaseFinancials | null> {
  if (!caseId) return null;
  const { data, error } = await (supabase.from('ce_v_case_financials' as never) as any)
    .select('*')
    .eq('case_id', caseId)
    .maybeSingle();
  if (error) throw error;
  return data ? toCaseFinancials(data) : null;
}

/** Financials for many cases, keyed by case id. */
export async function fetchCaseFinancialsMap(
  caseIds: string[],
): Promise<Record<string, CaseFinancials>> {
  const ids = Array.from(new Set(caseIds.filter(Boolean)));
  if (ids.length === 0) return {};
  const { data, error } = await (supabase.from('ce_v_case_financials' as never) as any)
    .select('*')
    .in('case_id', ids);
  if (error) throw error;
  const out: Record<string, CaseFinancials> = {};
  for (const row of data ?? []) out[row.case_id] = toCaseFinancials(row);
  return out;
}

/** Canonical, non-double-counting enforcement exposure for an employer. */
export async function fetchEmployerExposure(
  employerId?: string | null,
): Promise<EmployerExposure | null> {
  if (!employerId) return null;
  const { data, error } = await (supabase.rpc as any)('fn_ce_employer_financial_exposure', {
    p_employer_id: employerId,
  });
  if (error) throw error;
  if (!data) return null;
  const d = data as any;
  return {
    employer_id: d.employer_id,
    total_violations: num(d.total_violations),
    open_violations: num(d.open_violations),
    open_unlinked_violations: num(d.open_unlinked_violations),
    violation_principal: num(d.violation_principal),
    violation_penalty: num(d.violation_penalty),
    violation_interest: num(d.violation_interest),
    violation_gross: num(d.violation_gross),
    violation_waived: num(d.violation_waived),
    total_cases: num(d.total_cases),
    open_cases: num(d.open_cases),
    case_gross: num(d.case_gross),
    case_paid: num(d.case_paid),
    case_waived: num(d.case_waived),
    case_outstanding: num(d.case_outstanding),
    unlinked_violation_outstanding: num(d.unlinked_violation_outstanding),
    enforcement_exposure: num(d.enforcement_exposure),
  };
}

/** Shared currency formatter so every compliance surface renders identically. */
export function formatComplianceCurrency(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'XCD', minimumFractionDigits: 2,
  }).format(amount);
}
