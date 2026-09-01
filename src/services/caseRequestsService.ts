/**
 * Case Requests Service — closure / reopen / merge workflow
 */
import { supabase } from '@/integrations/supabase/client';

export type CaseRequestType = 'CLOSURE' | 'REOPEN' | 'MERGE';
export type CaseRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface CaseRequestRow {
  id: string;
  case_id: string;
  request_type: CaseRequestType;
  target_case_id: string | null;
  reason: string;
  status: CaseRequestStatus;
  requested_by: string;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  metadata: Record<string, unknown> | null;
  case_number?: string;
  employer_name?: string;
  target_case_number?: string;
}

const TABLE = 'ce_case_requests' as never;

/** Enterprise row shape returned by `ce_case_requests_v1`. */
export interface CaseRequestQueueRow {
  rn: number;
  id: string;
  case_id: string;
  request_type: CaseRequestType;
  target_case_id: string | null;
  reason: string;
  status: CaseRequestStatus;
  requested_by: string;
  requested_by_name: string | null;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  metadata: Record<string, unknown> | null;
  case_number: string;
  employer_id: string | null;
  employer_name: string | null;
  case_status: string;
  case_priority: string;
  case_risk_band: string;
  case_total_amount: number;
  closed_date: string | null;
  closure_reason: string | null;
  reopened_count: number;
  legal_case_id: string | null;
  assigned_officer_name: string | null;
  open_violations: number;
  arrangement_state: string | null;
  target_case_number: string | null;
  target_employer_id: string | null;
  target_employer_name: string | null;
  target_case_status: string | null;
  waiting_hours: number;
  waiting_days: number;
  waiting_bucket: string;
  sla_breached: boolean;
  same_employer: boolean | null;
}

export interface CaseRequestPrecheck {
  found: boolean;
  eligible: boolean;
  status?: CaseRequestStatus;
  request_type?: CaseRequestType;
  blockers: string[];
  warnings: string[];
  is_self_request?: boolean;
  can_approve?: boolean;
  can_approve_own?: boolean;
  case?: {
    id: string; case_number: string; status: string; employer_name: string | null;
    employer_id: string | null; total_amount: number; open_violations: number;
    arrangement_state: string; legal_case_id: string | null; closed_date: string | null;
    closure_reason: string | null; reopened_count: number;
  } | null;
  target?: {
    id: string; case_number: string; status: string; employer_name: string | null;
    employer_id: string | null; total_amount: number;
  } | null;
}

/** Legacy simple reader — retained for callers outside the approval queues. */
export async function listCaseRequests(
  type: CaseRequestType,
  status: CaseRequestStatus = 'PENDING'
): Promise<CaseRequestRow[]> {
  const { data, error } = await (supabase.from(TABLE) as any)
    .select(
      '*, ce_cases!ce_case_requests_case_id_fkey(case_number, employer_name), ' +
      'target:ce_cases!ce_case_requests_target_case_id_fkey(case_number, employer_name)'
    )
    .eq('request_type', type)
    .eq('status', status)
    .order('requested_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data || []).map((r: any) => ({
    ...r,
    case_number: r.ce_cases?.case_number,
    employer_name: r.ce_cases?.employer_name,
    target_case_number: r.target?.case_number,
  }));
}

/** Re-validates a pending request at decision time. */
export async function precheckCaseRequest(id: string): Promise<CaseRequestPrecheck> {
  const { data, error } = await (supabase as any).rpc('ce_case_request_precheck_v1', { p_id: id });
  if (error) throw error;
  return data as CaseRequestPrecheck;
}

export async function createCaseRequest(input: {
  caseId: string;
  type: CaseRequestType;
  reason: string;
  targetCaseId?: string;
  requestedBy: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await (supabase.from(TABLE) as any).insert({
    case_id: input.caseId,
    request_type: input.type,
    target_case_id: input.targetCaseId ?? null,
    reason: input.reason,
    requested_by: input.requestedBy,
    metadata: input.metadata ?? null,
  });
  if (error) {
    // One open governance request per case per type (ux_ce_case_requests_one_pending).
    if ((error as any).code === '23505') {
      throw new Error(
        `A pending ${input.type.toLowerCase()} request already exists for this case. ` +
        'It must be decided or cancelled before a new one can be submitted.',
      );
    }
    throw error;
  }
}


/**
 * Records an approval / rejection decision.
 *
 * Ordering is deliberate and governance-safe:
 *   1. `ce_case_request_precheck_v1` re-validates the request, the case and the
 *      merge target at decision time (nothing is trusted from the list page).
 *   2. `ce_case_request_claim_v1` atomically claims the decision — it enforces
 *      approval capability, segregation of duties, and only transitions a row
 *      that is still PENDING, so two reviewers can never both decide it.
 *   3. Only then is the case transition / merge applied.
 *   4. If step 3 fails the claim is reverted to PENDING with the failure
 *      recorded on the request metadata, so a request can never remain
 *      APPROVED while the case was never changed.
 */
export async function reviewCaseRequest(input: {
  id: string;
  approve: boolean;
  reviewedBy: string;
  notes: string;
}): Promise<void> {
  const pre = await precheckCaseRequest(input.id);
  if (!pre.found) throw new Error('Request not found');
  if (pre.status !== 'PENDING') {
    throw new Error(`This request has already been ${String(pre.status).toLowerCase()}.`);
  }
  if (input.approve && !pre.eligible) {
    throw new Error(pre.blockers?.[0] || 'This request is no longer eligible for approval.');
  }

  const { data: claim, error: claimErr } = await (supabase as any).rpc('ce_case_request_claim_v1', {
    p_id: input.id,
    p_approve: input.approve,
    p_actor: input.reviewedBy,
    p_notes: input.notes,
  });
  if (claimErr) throw new Error(claimErr.message || 'Unable to record the decision');
  if (!claim?.claimed) throw new Error(claim?.message || 'This request was already decided.');

  if (!input.approve) return;

  const caseId: string = claim.case_id;
  const targetCaseId: string | null = claim.target_case_id;
  const reason: string = claim.reason;
  const requestType: CaseRequestType = claim.request_type;

  try {
    const { requestTransition } = await import('@/services/ceWorkflowStatusService');
    const today = new Date().toISOString().slice(0, 10);

    if (requestType === 'CLOSURE') {
      const r = await requestTransition({
        entityType: 'case', recordId: caseId, actionCode: 'CLOSE',
        userCode: input.reviewedBy, notes: reason,
      });
      if (!r.success) throw new Error(r.error || 'Failed to close case');
      await supabase.from('ce_cases').update({
        closed_date: today, closure_reason: reason,
      } as any).eq('id', caseId);
    } else if (requestType === 'REOPEN') {
      const { data: existing } = await supabase.from('ce_cases')
        .select('reopened_count').eq('id', caseId).maybeSingle();
      const r = await requestTransition({
        entityType: 'case', recordId: caseId, actionCode: 'REOPEN',
        userCode: input.reviewedBy, notes: reason,
      });
      if (!r.success) throw new Error(r.error || 'Failed to reopen case');
      await supabase.from('ce_cases').update({
        closed_date: null, closure_reason: null,
        reopened_count: ((existing as any)?.reopened_count || 0) + 1,
      } as any).eq('id', caseId);
    } else if (requestType === 'MERGE' && targetCaseId) {
      const r = await requestTransition({
        entityType: 'case', recordId: caseId, actionCode: 'CLOSE',
        userCode: input.reviewedBy, notes: `Merged: ${reason}`,
      });
      if (!r.success) throw new Error(r.error || 'Failed to merge case');
      // Moves violations / notices / actions onto the surviving case, recomputes
      // financial roll-ups on both sides and writes the permanent merge history
      // entry — all inside one server-side transaction.
      const { error: mergeErr } = await (supabase as any).rpc('ce_apply_case_merge', {
        p_request_id: input.id, p_actor: input.reviewedBy,
      });
      if (mergeErr) throw new Error(mergeErr.message || 'Failed to apply case merge');
    }
  } catch (e: any) {
    await (supabase as any).rpc('ce_case_request_revert_v1', {
      p_id: input.id, p_actor: input.reviewedBy, p_error: e?.message || String(e),
    });
    throw new Error(
      `${e?.message || 'The case action failed'} — the request was returned to Pending and no case change was recorded.`,
    );
  }
}
