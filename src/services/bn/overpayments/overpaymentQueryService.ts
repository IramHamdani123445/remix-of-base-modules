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

export const overpaymentQueryService = {
  worklist: (p: { status?: string | null; search?: string | null; limit?: number; offset?: number } = {}) =>
    q<BnOverpaymentWorklistRow[]>('bn_overpayment_worklist_v1', {
      p_status: p.status ?? null,
      p_search: p.search ?? null,
      p_limit: p.limit ?? 50,
      p_offset: p.offset ?? 0,
    }),

  caseDetail: (caseId: string) =>
    q<Record<string, unknown>>('bn_overpayment_case_detail_v1', { p_case_id: caseId }),

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
