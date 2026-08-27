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
    .limit(500);
  if (error) throw error;
  return (data || []).map((r: any) => ({
    ...r,
    case_number: r.ce_cases?.case_number,
    employer_name: r.ce_cases?.employer_name,
    target_case_number: r.target?.case_number,
  }));
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
  if (error) throw error;
}

export async function reviewCaseRequest(input: {
  id: string;
  approve: boolean;
  reviewedBy: string;
  notes: string;
}): Promise<void> {
  const { data: req, error: fetchErr } = await (supabase.from(TABLE) as any)
    .select('*').eq('id', input.id).maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!req) throw new Error('Request not found');

  const { error } = await (supabase.from(TABLE) as any)
    .update({
      status: input.approve ? 'APPROVED' : 'REJECTED',
      reviewed_by: input.reviewedBy,
      reviewed_at: new Date().toISOString(),
      review_notes: input.notes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.id);
  if (error) throw error;

  if (!input.approve) return;

  // Apply side-effect on approval — status changes flow through the central
  // CE workflow engine (ce_apply_status_transition). Metadata columns
  // (closed_date, closure_reason, merge bookkeeping) are written separately.
  const { requestTransition } = await import('@/services/ceWorkflowStatusService');
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  if (req.request_type === 'CLOSURE') {
    const r = await requestTransition({
      entityType: 'case',
      recordId: req.case_id,
      actionCode: 'CLOSE',
      userCode: input.reviewedBy,
      notes: req.reason,
    });
    if (!r.success) throw new Error(r.error || 'Failed to close case');
    await supabase.from('ce_cases').update({
      closed_date: today,
      closure_reason: req.reason,
    } as any).eq('id', req.case_id);
  } else if (req.request_type === 'REOPEN') {
    const { data: existing } = await supabase.from('ce_cases')
      .select('reopened_count').eq('id', req.case_id).maybeSingle();
    const r = await requestTransition({
      entityType: 'case',
      recordId: req.case_id,
      actionCode: 'REOPEN',
      userCode: input.reviewedBy,
      notes: req.reason,
    });
    if (!r.success) throw new Error(r.error || 'Failed to reopen case');
    await supabase.from('ce_cases').update({
      closed_date: null,
      closure_reason: null,
      reopened_count: ((existing as any)?.reopened_count || 0) + 1,
    } as any).eq('id', req.case_id);
  } else if (req.request_type === 'MERGE' && req.target_case_id) {
    const r = await requestTransition({
      entityType: 'case',
      recordId: req.case_id,
      actionCode: 'CLOSE',
      userCode: input.reviewedBy,
      notes: `Merged: ${req.reason}`,
    });
    if (!r.success) throw new Error(r.error || 'Failed to merge case');
    // Move violations / notices / actions onto the surviving case, recompute
    // financial roll-ups on both sides and write the permanent merge history
    // entry — all inside one server-side transaction.
    const { error: mergeErr } = await (supabase as any).rpc('ce_apply_case_merge', {
      p_request_id: req.id,
      p_actor: input.reviewedBy,
    });
    if (mergeErr) throw new Error(mergeErr.message || 'Failed to apply case merge');
  }

}
