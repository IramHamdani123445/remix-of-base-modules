/**
 * Waiver Service
 *
 * Implements admin Waiver Rules + operational waiver request lifecycle.
 * Reuses the existing workflow mapping (event key `waiver.approval`) so
 * approval routing is centralised — no parallel workflow engine.
 *
 * Approved waivers update `ce_cases.amount_waived` (and never delete the
 * original amount). Every transition is appended to `ce_waiver_decisions`
 * for full audit traceability.
 */
import { supabase } from '@/integrations/supabase/client';
import { resolveWorkflow } from './complianceWorkflowMappingService';

// ---------- Types ----------
export type WaiverType = 'PENALTY' | 'INTEREST' | 'PRINCIPAL' | 'FULL' | 'PARTIAL';
export type WaiverStatus =
  | 'PENDING'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'APPLIED'
  | 'CANCELLED';
export type WaiverSource = 'CASE' | 'VIOLATION' | 'EMPLOYER_RESPONSE' | 'OFFICER';

export interface WaiverRule {
  id: string;
  code: string;
  name: string;
  description: string | null;
  enabled: boolean;
  waiver_type: WaiverType;
  max_percentage: number | null;
  amount_threshold: number | null;
  applicable_violation_type_ids: string[];
  applicable_funds: string[];
  valid_reasons: string[];
  required_documents: string[];
  approval_workflow_required: boolean;
  audit_required: boolean;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface WaiverRequest {
  id: string;
  waiver_number: string;
  employer_id: string;
  case_id: string | null;
  violation_id: string | null;
  waiver_rule_id: string | null;
  waiver_type: WaiverType;
  status: WaiverStatus;
  source: WaiverSource | null;
  amount_requested: number | null;
  amount_approved: number | null;
  reason_code: string | null;
  justification: string;
  supporting_documents: Array<{ name: string; url?: string; doc_type?: string }>;
  requested_by: string | null;
  requested_at: string;
  reviewer_id: string | null;
  reviewer_decision: string | null;
  reviewer_comments: string | null;
  reviewed_at: string | null;
  approver_id: string | null;
  approver_decision: string | null;
  approver_comments: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  applied_at: string | null;
  workflow_definition_id: string | null;
  created_at: string;
  updated_at: string;
}

const RULES = 'ce_waiver_rules' as never;
const WAIVERS = 'ce_waivers' as never;
const DECISIONS = 'ce_waiver_decisions' as never;

// ---------- Rules CRUD ----------
export async function listWaiverRules(): Promise<WaiverRule[]> {
  const { data, error } = await (supabase.from(RULES) as any)
    .select('*')
    .order('sort_order')
    .order('name');
  if (error) throw error;
  return (data || []) as WaiverRule[];
}

export async function upsertWaiverRule(
  r: Partial<WaiverRule>,
  userCode: string,
): Promise<void> {
  const payload: any = {
    code: r.code,
    name: r.name,
    description: r.description ?? null,
    enabled: !!r.enabled,
    waiver_type: r.waiver_type,
    max_percentage: r.max_percentage ?? null,
    amount_threshold: r.amount_threshold ?? null,
    applicable_violation_type_ids: r.applicable_violation_type_ids ?? [],
    applicable_funds: r.applicable_funds ?? [],
    valid_reasons: r.valid_reasons ?? [],
    required_documents: r.required_documents ?? [],
    approval_workflow_required: r.approval_workflow_required ?? true,
    audit_required: r.audit_required ?? true,
    notes: r.notes ?? null,
    sort_order: r.sort_order ?? 0,
    updated_by: userCode,
    updated_at: new Date().toISOString(),
  };
  if (r.id) {
    const { error } = await (supabase.from(RULES) as any).update(payload).eq('id', r.id);
    if (error) throw error;
  } else {
    const { error } = await (supabase.from(RULES) as any).insert({
      ...payload,
      created_by: userCode,
    });
    if (error) throw error;
  }
}

export async function toggleWaiverRule(id: string, enabled: boolean, userCode: string) {
  const { error } = await (supabase.from(RULES) as any)
    .update({ enabled, updated_by: userCode, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ---------- Helpers ----------
/**
 * Waiver lifecycle writes are NOT performed from the client.
 * `ce_waivers` / `ce_waiver_decisions` are read-only for `anon`/`authenticated`;
 * every transition goes through SECURITY DEFINER commands that re-check
 * feature toggles, rule caps, funds, reasons, approval authority and SoD
 * inside the database (Step 5 governance).
 */
function rpcError(e: any, fallback: string): Error {
  const msg: string = e?.message || e?.details || fallback;
  // Strip the postgres prefix so operators see the business reason.
  return new Error(msg.replace(/^.*?(CE-WV-\d+[^:]*:\s*)/, '$1'));
}

export async function listWaiverRequests(filter: {
  status?: WaiverStatus | 'ALL';
  employerId?: string;
  caseId?: string;
} = {}): Promise<WaiverRequest[]> {
  let q: any = (supabase.from(WAIVERS) as any).select('*').order('requested_at', { ascending: false });
  if (filter.status && filter.status !== 'ALL') q = q.eq('status', filter.status);
  if (filter.employerId) q = q.eq('employer_id', filter.employerId);
  if (filter.caseId) q = q.eq('case_id', filter.caseId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as WaiverRequest[];
}

export async function getWaiverDecisions(waiverId: string) {
  const { data, error } = await (supabase.from(DECISIONS) as any)
    .select('*')
    .eq('waiver_id', waiverId)
    .order('acted_at');
  if (error) throw error;
  return data || [];
}

// ---------- Lifecycle (governed RPCs) ----------
export interface NewWaiverInput {
  employer_id: string;
  case_id?: string | null;
  violation_id?: string | null;
  waiver_rule_id?: string | null;
  waiver_type: WaiverType;
  source: WaiverSource;
  amount_requested: number;
  reason_code?: string | null;
  justification: string;
  supporting_documents?: Array<{ name: string; url?: string; doc_type?: string }>;
  fund?: string | null;
}

export async function requestWaiver(input: NewWaiverInput, _userCode?: string): Promise<string> {
  // Workflow routing still comes from the existing mapping engine; the
  // database command records it and decides the resulting status.
  const mapping = await resolveWorkflow('waiver.approval', {
    fund: input.fund ?? null,
    amount: input.amount_requested,
  }).catch(() => null);

  const { data, error } = await (supabase.rpc as any)('ce_request_waiver_v1', {
    p_employer_id: input.employer_id,
    p_waiver_type: input.waiver_type,
    p_amount_requested: input.amount_requested,
    p_justification: input.justification,
    p_case_id: input.case_id ?? null,
    p_violation_id: input.violation_id ?? null,
    p_waiver_rule_id: input.waiver_rule_id ?? null,
    p_reason_code: input.reason_code ?? null,
    p_source: input.source,
    p_fund: input.fund ?? null,
    p_supporting_documents: input.supporting_documents ?? [],
    p_workflow_definition_id: mapping?.enabled ? mapping?.workflowDefinitionId ?? null : null,
  });
  if (error) throw rpcError(error, 'Waiver request was refused');
  return data as string;
}

export async function approveWaiver(args: {
  waiverId: string;
  approvedAmount: number;
  comments?: string;
  userCode?: string;
}) {
  const { error } = await (supabase.rpc as any)('ce_approve_waiver_v1', {
    p_waiver_id: args.waiverId,
    p_approved_amount: args.approvedAmount,
    p_comments: args.comments ?? null,
  });
  if (error) throw rpcError(error, 'Waiver approval was refused');
}

/**
 * Application to the case balance now happens atomically inside
 * `ce_approve_waiver_v1`. Retained for callers that still request it.
 */
export async function applyApprovedWaiver(_waiverId: string, _userCode?: string) {
  return;
}

export async function rejectWaiver(args: {
  waiverId: string;
  reason: string;
  comments?: string;
  userCode?: string;
}) {
  const { error } = await (supabase.rpc as any)('ce_reject_waiver_v1', {
    p_waiver_id: args.waiverId,
    p_reason: args.reason,
    p_comments: args.comments ?? null,
  });
  if (error) throw rpcError(error, 'Waiver rejection was refused');
}

export async function cancelWaiver(args: { waiverId: string; reason?: string; userCode?: string }) {
  const { error } = await (supabase.rpc as any)('ce_cancel_waiver_v1', {
    p_waiver_id: args.waiverId,
    p_reason: args.reason ?? null,
  });
  if (error) throw rpcError(error, 'Waiver cancellation was refused');
}

