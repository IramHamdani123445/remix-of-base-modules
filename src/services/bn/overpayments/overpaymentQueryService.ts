/**
 * BN Overpayments — typed query service (Phase B11).
 *
 * Read-only boundary. The browser NEVER selects from `bn_op_*` tables
 * directly; every read goes through a secured `bn_overpayment_*_v1` query RPC
 * which applies permission, scope and financial-detail masking server side.
 */
import { supabase } from '@/integrations/supabase/client';

export interface BnOverpaymentWorklistRow {
  case_id: string;
  case_reference: string;
  award_id: string | null;
  status: string;
  reason_code: string | null;
  currency: string;
  gross_amount: number | null;
  outstanding_amount: number | null;
  recovered_amount: number | null;
  row_version: number;
  opened_at: string | null;
  updated_at: string | null;
  claimant_display: string | null;
  on_appeal_hold: boolean | null;
  recovery_suspended: boolean | null;
}

export interface BnOverpaymentAvailableAction {
  action: string;
  command: string;
  allowed: boolean;
  reason_code: string | null;
}

async function q<T>(rpc: string, args: Record<string, unknown> = {}): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(rpc, args);
  if (error) throw new Error(error.message);
  return data as T;
}

type Json = Record<string, unknown>;

/**
 * Every `bn_overpayment_*_v1` query RPC answers with a governed envelope
 * (`{ ok, rows | <payload> }`). The presentation layer consumes plain rows and
 * objects, so unwrapping happens here, in one place, rather than in each screen.
 */
function rowsOf(payload: unknown): Json[] {
  if (Array.isArray(payload)) return payload as Json[];
  if (payload && typeof payload === 'object') {
    const rows = (payload as Json).rows;
    if (Array.isArray(rows)) return rows as Json[];
  }
  return [];
}

const numOf = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0;

/** Map a governed worklist row onto the shape the screens render. */
function toRow(r: Json): BnOverpaymentWorklistRow {
  const gross = numOf(r.gross_amount ?? r.gross_liability);
  const outstanding = numOf(r.outstanding_amount);
  return {
    case_id: String(r.case_id ?? r.id ?? ''),
    case_reference: String(r.case_reference ?? ''),
    award_id: (r.award_id ?? r.bn_award_id ?? null) as string | null,
    status: String(r.status ?? ''),
    reason_code: (r.reason_code ?? null) as string | null,
    currency: String(r.currency ?? 'XCD'),
    gross_amount: gross,
    outstanding_amount: outstanding,
    recovered_amount: numOf(r.recovered_amount ?? gross - outstanding),
    row_version: numOf(r.row_version),
    opened_at: (r.opened_at ?? r.created_at ?? null) as string | null,
    updated_at: (r.updated_at ?? null) as string | null,
    claimant_display: (r.claimant_display ?? r.person_reference ?? null) as string | null,
    on_appeal_hold: (r.on_appeal_hold ?? false) as boolean,
    recovery_suspended: (r.recovery_suspended ?? false) as boolean,
  };
}

/** Flatten the case-detail envelope into a single record for the workspace. */
function toDetail(payload: unknown): Json {
  if (!payload || typeof payload !== 'object') return {};
  const env = payload as Json;
  const body = (env.case && typeof env.case === 'object' ? env.case : env) as Json;
  const merged: Json = { ...body, ...env };
  delete merged.case;
  const row = toRow(merged);
  return { ...merged, ...row };
}

export const overpaymentQueryService = {
  worklist: async (p: { status?: string | null; search?: string | null; limit?: number; offset?: number } = {}) => {
    const payload = await q<unknown>('bn_overpayment_worklist_v1', {
      p_status: p.status ?? null,
      p_search: p.search ?? null,
      p_limit: p.limit ?? 50,
      p_offset: p.offset ?? 0,
    });
    return rowsOf(payload).map(toRow);
  },

  caseDetail: async (caseId: string) =>
    toDetail(await q<unknown>('bn_overpayment_case_detail_v1', { p_case_id: caseId })),


  timeline: (caseId: string) =>
    q<Record<string, unknown>[]>('bn_overpayment_timeline_v1', { p_case_id: caseId }),

  balance: (caseId: string) =>
    q<Record<string, unknown>>('bn_overpayment_balance_v1', { p_case_id: caseId }),

  transactions: (caseId: string) =>
    q<Record<string, unknown>[]>('bn_overpayment_transactions_v1', { p_case_id: caseId }),

  liabilityVersions: (caseId: string) =>
    q<Record<string, unknown>[]>('bn_overpayment_liability_versions_v1', { p_case_id: caseId }),

  recoveryPlans: (caseId: string) =>
    q<Record<string, unknown>[]>('bn_overpayment_recovery_plans_v1', { p_case_id: caseId }),

  waiverRequests: (caseId: string) =>
    q<Record<string, unknown>[]>('bn_overpayment_waiver_requests_v1', { p_case_id: caseId }),

  writeoffRequests: (caseId: string) =>
    q<Record<string, unknown>[]>('bn_overpayment_writeoff_requests_v1', { p_case_id: caseId }),

  referrals: (caseId: string) =>
    q<Record<string, unknown>[]>('bn_overpayment_referrals_v1', { p_case_id: caseId }),

  reconciliations: (caseId: string) =>
    q<Record<string, unknown>[]>('bn_overpayment_reconciliations_v1', { p_case_id: caseId }),

  appealHolds: (caseId: string) =>
    q<Record<string, unknown>[]>('bn_overpayment_appeal_holds_v1', { p_case_id: caseId }),

  auditHistory: (caseId: string) =>
    q<Record<string, unknown>[]>('bn_overpayment_audit_history_v1', { p_case_id: caseId }),

  availableActions: (caseId: string) =>
    q<BnOverpaymentAvailableAction[]>('bn_overpayment_available_actions_v1', { p_case_id: caseId }),
} as const;

/** Canonical query RPC list — asserted by the query-boundary parity test. */
export const BN_OVERPAYMENT_QUERY_RPCS = [
  'bn_overpayment_worklist_v1',
  'bn_overpayment_case_detail_v1',
  'bn_overpayment_timeline_v1',
  'bn_overpayment_balance_v1',
  'bn_overpayment_transactions_v1',
  'bn_overpayment_liability_versions_v1',
  'bn_overpayment_recovery_plans_v1',
  'bn_overpayment_waiver_requests_v1',
  'bn_overpayment_writeoff_requests_v1',
  'bn_overpayment_referrals_v1',
  'bn_overpayment_reconciliations_v1',
  'bn_overpayment_appeal_holds_v1',
  'bn_overpayment_audit_history_v1',
  'bn_overpayment_available_actions_v1',
] as const;
