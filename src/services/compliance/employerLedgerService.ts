/**
 * Employer Financial Ledger (Passbook) — read service.
 *
 * Thin, read-only wrapper over the governed ledger reporting RPCs.
 * The ledger itself stays append-only: writes continue to flow through
 * ce_post_ledger_entry / ce_reverse_ledger_entry.
 */

import { supabase } from '@/integrations/supabase/client';

const sb = supabase as any;

export interface LedgerPageFilters {
  employerId: string;
  fromDate?: string | null;
  toDate?: string | null;
  fundType?: string | null;
  entryType?: string | null;
  direction?: 'DEBIT' | 'CREDIT' | null;
  period?: string | null;
  reference?: string | null;
  arrangementId?: string | null;
  sourceSystem?: string | null;
  limit?: number;
  offset?: number;
}

export interface LedgerPageRow {
  entry_id: string;
  posted_at: string;
  effective_date: string | null;
  period: string | null;
  fund_type: string;
  entry_type: string;
  description: string | null;
  debit_amount: number;
  credit_amount: number;
  running_balance_fund: number;
  running_balance_total: number;
  status: string;
  reference_type: string | null;
  reference_id: string | null;
  reversal_of_id: string | null;
  reversal_reason: string | null;
  reversed_by_entry_id: string | null;
  arrangement_id: string | null;
  installment_id: string | null;
  violation_id: string | null;
  case_id: string | null;
  payment_reference: string | null;
  source_system: string | null;
  source_pk: string | null;
  posted_by: string | null;
  total_count: number;
}

export interface LedgerFundSummary {
  fund: string;
  debits: number;
  credits: number;
  balance: number;
}

export interface LedgerSummary {
  employer_id: string;
  opening_balance: number;
  total_debits: number;
  total_credits: number;
  entry_count: number;
  closing_balance: number;
  current_balance: number;
  outstanding_amount: number;
  available_credit: number;
  unallocated_credit: number;
  amount_under_arrangement: number;
  by_fund: LedgerFundSummary[];
}

export interface LedgerEntryDetail {
  entry: Record<string, any>;
  original_entry: Record<string, any> | null;
  reversal_entry: Record<string, any> | null;
  allocations: Record<string, any>[];
  arrangement: Record<string, any> | null;
  installment: Record<string, any> | null;
  violation: Record<string, any> | null;
}

export interface LedgerReconciliation {
  employer_id: string;
  reconciled: boolean;
  funds: Array<{
    fund: string;
    total_debits: number;
    total_credits: number;
    derived_balance: number;
    stored_running_balance: number | null;
    variance: number;
    reconciled: boolean;
  }>;
}

const nullable = (v?: string | null) => (v && v !== 'all' ? v : null);

export async function fetchEmployerLedgerPage(
  filters: LedgerPageFilters,
): Promise<{ rows: LedgerPageRow[]; totalCount: number }> {
  const { data, error } = await sb.rpc('ce_employer_ledger_page', {
    p_employer_id: filters.employerId,
    p_from_date: nullable(filters.fromDate),
    p_to_date: nullable(filters.toDate),
    p_fund_type: nullable(filters.fundType),
    p_entry_type: nullable(filters.entryType),
    p_direction: nullable(filters.direction),
    p_period: nullable(filters.period),
    p_reference: nullable(filters.reference),
    p_arrangement_id: nullable(filters.arrangementId),
    p_source_system: nullable(filters.sourceSystem),
    p_limit: filters.limit ?? 50,
    p_offset: filters.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as LedgerPageRow[];
  return { rows, totalCount: Number(rows[0]?.total_count ?? 0) };
}

export async function fetchEmployerLedgerSummary(args: {
  employerId: string;
  fromDate?: string | null;
  toDate?: string | null;
  fundType?: string | null;
}): Promise<LedgerSummary> {
  const { data, error } = await sb.rpc('ce_employer_ledger_summary', {
    p_employer_id: args.employerId,
    p_from_date: nullable(args.fromDate),
    p_to_date: nullable(args.toDate),
    p_fund_type: nullable(args.fundType),
  });
  if (error) throw error;
  return data as LedgerSummary;
}

export async function fetchLedgerEntryDetail(entryId: string): Promise<LedgerEntryDetail> {
  const { data, error } = await sb.rpc('ce_employer_ledger_entry_detail', {
    p_entry_id: entryId,
  });
  if (error) throw error;
  return data as LedgerEntryDetail;
}

export async function fetchLedgerReconciliation(
  employerId: string,
): Promise<LedgerReconciliation> {
  const { data, error } = await sb.rpc('ce_employer_ledger_reconcile', {
    p_employer_id: employerId,
  });
  if (error) throw error;
  return data as LedgerReconciliation;
}
