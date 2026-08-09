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


  timeline: async (caseId: string) =>
    rowsOf(await q<unknown>('bn_overpayment_timeline_v1', { p_case_id: caseId })),

  balance: async (caseId: string) =>
    ((await q<unknown>('bn_overpayment_balance_v1', { p_case_id: caseId })) ?? {}) as Json,

  transactions: async (caseId: string) =>
    rowsOf(await q<unknown>('bn_overpayment_transactions_v1', { p_case_id: caseId })),

  liabilityVersions: async (caseId: string) =>
    rowsOf(await q<unknown>('bn_overpayment_liability_versions_v1', { p_case_id: caseId })),

  recoveryPlans: async (caseId: string) =>
    rowsOf(await q<unknown>('bn_overpayment_recovery_plans_v1', { p_case_id: caseId })),

  waiverRequests: async (caseId: string) =>
    rowsOf(await q<unknown>('bn_overpayment_waiver_requests_v1', { p_case_id: caseId })),

  writeoffRequests: async (caseId: string) =>
    rowsOf(await q<unknown>('bn_overpayment_writeoff_requests_v1', { p_case_id: caseId })),

  referrals: async (caseId: string) =>
    rowsOf(await q<unknown>('bn_overpayment_referrals_v1', { p_case_id: caseId })),

  reconciliations: async (caseId: string) =>
    rowsOf(await q<unknown>('bn_overpayment_reconciliations_v1', { p_case_id: caseId })),

  appealHolds: async (caseId: string) =>
    rowsOf(await q<unknown>('bn_overpayment_appeal_holds_v1', { p_case_id: caseId })),

  auditHistory: async (caseId: string) =>
    rowsOf(await q<unknown>('bn_overpayment_audit_history_v1', { p_case_id: caseId })),

  availableActions: async (caseId: string) => {
    const payload = (await q<unknown>('bn_overpayment_available_actions_v1', { p_case_id: caseId })) as Json;
    if (Array.isArray(payload)) return payload as unknown as BnOverpaymentAvailableAction[];
    const granted = Array.isArray(payload?.granted_actions) ? (payload.granted_actions as string[]) : [];
    const enabled = payload?.actions_enabled === true;
    return granted.map((action) => ({
      action,
      command: OVERPAYMENT_ACTION_COMMANDS[action] ?? '',
      allowed: enabled,
      reason_code: enabled ? null : 'E_ACTIONS_DISABLED',
    })) as BnOverpaymentAvailableAction[];
  },
} as const;

/** Granted action code → canonical command name, for display and audit. */
export const OVERPAYMENT_ACTION_COMMANDS: Record<string, string> = {
  create_candidate: 'BN_OVP_CREATE_CANDIDATE',
  calculate_liability: 'BN_OVP_CALCULATE_LIABILITY',
  confirm_liability: 'BN_OVP_CONFIRM_LIABILITY',
  issue_notice: 'BN_OVP_ISSUE_NOTICE',
  record_representation: 'BN_OVP_RECORD_REPRESENTATION',
  propose_recovery_plan: 'BN_OVP_PROPOSE_RECOVERY_PLAN',
  approve_recovery_plan: 'BN_OVP_APPROVE_RECOVERY_PLAN',
  activate_deduction: 'BN_OVP_ACTIVATE_DEDUCTION',
  record_receipt: 'BN_OVP_RECORD_RECEIPT',
  allocate_receipt: 'BN_OVP_ALLOCATE_RECEIPT',
  request_waiver: 'BN_OVP_REQUEST_WAIVER',
  approve_waiver: 'BN_OVP_APPROVE_WAIVER',
  request_writeoff: 'BN_OVP_REQUEST_WRITEOFF',
  approve_writeoff: 'BN_OVP_APPROVE_WRITEOFF',
  place_appeal_hold: 'BN_OVP_PLACE_APPEAL_HOLD',
  release_appeal_hold: 'BN_OVP_RELEASE_APPEAL_HOLD',
  suspend_recovery: 'BN_OVP_SUSPEND_RECOVERY',
  resume_recovery: 'BN_OVP_RESUME_RECOVERY',
  refer_legal: 'BN_OVP_REFER_LEGAL',
  refer_estate: 'BN_OVP_REFER_ESTATE',
  reverse_transaction: 'BN_OVP_REVERSE_TRANSACTION',
  reconcile: 'BN_OVP_RECONCILE',
  close: 'BN_OVP_CLOSE_CASE',
  reopen: 'BN_OVP_REOPEN_CASE',
};


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
