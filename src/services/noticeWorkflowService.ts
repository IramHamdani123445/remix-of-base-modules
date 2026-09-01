/**
 * Notice workflow & employer-response service.
 * Reuses existing ce_notices, ce_notice_templates, ce_notice_delivery_log,
 * ce_case_correspondence tables — no parallel permission/workflow system.
 */
import { supabase } from '@/integrations/supabase/client';

export type NoticeStatus =
  | 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'SENT'
  | 'DELIVERED' | 'FAILED' | 'ACKNOWLEDGED' | 'CANCELLED';

export type ResponseType =
  | 'ACKNOWLEDGEMENT' | 'DISPUTE' | 'EVIDENCE_SUBMITTED'
  | 'WAIVER_REQUEST' | 'ARRANGEMENT_REQUEST' | 'CLARIFICATION';

export const RESPONSE_TYPES: { value: ResponseType; label: string }[] = [
  { value: 'ACKNOWLEDGEMENT', label: 'Acknowledgement' },
  { value: 'DISPUTE', label: 'Dispute' },
  { value: 'EVIDENCE_SUBMITTED', label: 'Evidence Submitted' },
  { value: 'WAIVER_REQUEST', label: 'Waiver Request' },
  { value: 'ARRANGEMENT_REQUEST', label: 'Arrangement Request' },
  { value: 'CLARIFICATION', label: 'Clarification' },
];

export interface NoticeResponse {
  id: string;
  notice_id: string;
  case_id: string | null;
  violation_id: string | null;
  employer_id: string;
  response_type: ResponseType;
  response_date: string;
  notes: string | null;
  documents: any[];
  next_action: string | null;
  recorded_by: string;
  recorded_by_name: string | null;
  created_at: string;
}

/** Resolve simple merge fields {{key}} in notice template body / subject. */
export function resolveTemplate(text: string, vars: Record<string, string | number | null | undefined>): string {
  if (!text) return '';
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? `{{${k}}}` : String(v);
  });
}

/** Generate a notice (DRAFT or PENDING_APPROVAL based on requiresApproval). */
export async function generateNotice(input: {
  templateId: string;
  employerId: string;
  employerName: string;
  caseId?: string | null;
  violationId?: string | null;
  noticeType: string;
  deliveryMethod: string;
  dueResponseDate?: string | null;
  mergeVars: Record<string, any>;
  requiresApproval: boolean;
  userCode: string;
}): Promise<string> {
  const { data: tpl, error: tErr } = await supabase
    .from('ce_notice_templates').select('*').eq('id', input.templateId).maybeSingle();
  if (tErr) throw tErr;
  if (!tpl) throw new Error('Template not found');

  const subject = resolveTemplate(tpl.subject || '', input.mergeVars);
  const body = resolveTemplate(tpl.body || '', input.mergeVars);
  // Notice numbers are allocated by the database (ce_notice_allocate_number_v1)
  // so concurrent generation can never collide and every number is auditable.
  const { data: allocated, error: numErr } = await (supabase as any)
    .rpc('ce_notice_allocate_number_v1');
  if (numErr) throw new Error(`Unable to allocate a notice number: ${numErr.message}`);
  const noticeNumber = allocated as string;
  if (!noticeNumber) throw new Error('Unable to allocate a notice number');

  const { data, error } = await supabase
    .from('ce_notices')
    .insert({
      notice_number: noticeNumber,
      employer_id: input.employerId,
      employer_name: input.employerName,
      case_id: input.caseId || null,
      violation_id: input.violationId || null,
      notice_type: input.noticeType,
      template_id: input.templateId,
      delivery_method: input.deliveryMethod,
      due_response_date: input.dueResponseDate || null,
      subject,
      body,
      status: input.requiresApproval ? 'PENDING_APPROVAL' : 'DRAFT',
      created_by: input.userCode,
    } as any)
    .select('id').single();
  if (error) throw error;
  return (data as any).id;
}

export async function approveNotice(noticeId: string, userCode: string) {
  const { requestTransition } = await import('@/services/ceWorkflowStatusService');
  const result = await requestTransition({
    entityType: 'notice',
    recordId: noticeId,
    actionCode: 'APPROVE',
    userCode,
  });
  if (!result.success) throw new Error(result.error || 'Failed to approve notice');
}

export async function rejectNotice(noticeId: string, userCode: string) {
  const { requestTransition } = await import('@/services/ceWorkflowStatusService');
  const result = await requestTransition({
    entityType: 'notice',
    recordId: noticeId,
    actionCode: 'REJECT',
    userCode,
  });
  if (!result.success) throw new Error(result.error || 'Failed to reject notice');
}

export async function markFailed(noticeId: string, reason: string, userCode: string) {
  const { requestTransition } = await import('@/services/ceWorkflowStatusService');
  const result = await requestTransition({
    entityType: 'notice',
    recordId: noticeId,
    actionCode: 'FAIL',
    userCode,
    notes: reason,
  });
  if (!result.success) throw new Error(result.error || 'Failed to mark notice failed');

  await supabase.from('ce_notice_delivery_log').insert({
    notice_id: noticeId, attempt_number: 0, channel: 'SYSTEM',
    status: 'FAILED', failure_reason: reason, created_by: userCode,
  } as any);
}

// ── Employer responses ──────────────────────────────────────────
export async function recordEmployerResponse(input: {
  noticeId: string;
  caseId?: string | null;
  violationId?: string | null;
  employerId: string;
  responseType: ResponseType;
  responseDate: string;
  notes?: string;
  nextAction?: string;
  userCode: string;
}): Promise<void> {
  const { error } = await supabase.from('ce_notice_responses').insert({
    notice_id: input.noticeId,
    case_id: input.caseId || null,
    violation_id: input.violationId || null,
    employer_id: input.employerId,
    response_type: input.responseType,
    response_date: input.responseDate,
    notes: input.notes || null,
    next_action: input.nextAction || null,
    recorded_by: input.userCode,
  } as any);
  if (error) throw error;

  // Mark the notice acknowledged when an ACKNOWLEDGEMENT comes in
  if (input.responseType === 'ACKNOWLEDGEMENT') {
    await supabase.from('ce_notices').update({
      status: 'ACKNOWLEDGED',
      acknowledged_at: new Date().toISOString(),
      response_received: true,
      response_date: input.responseDate,
      updated_by: input.userCode,
    } as any).eq('id', input.noticeId);
  } else {
    await supabase.from('ce_notices').update({
      response_received: true,
      response_date: input.responseDate,
      updated_by: input.userCode,
    } as any).eq('id', input.noticeId);
  }
}

export async function fetchNoticeResponses(filters: { noticeId?: string; employerId?: string } = {}) {
  let q = supabase.from('ce_notice_responses').select('*').order('response_date', { ascending: false }).limit(500);
  if (filters.noticeId) q = q.eq('notice_id', filters.noticeId);
  if (filters.employerId) q = q.eq('employer_id', filters.employerId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as unknown as NoticeResponse[];
}

// ── Communication history (chronological union) ─────────────────
export interface CommHistoryEntry {
  id: string;
  ts: string;
  channel: string;
  direction: 'IN' | 'OUT';
  subject: string;
  body?: string | null;
  source: 'NOTICE' | 'CORRESPONDENCE' | 'RESPONSE' | 'DELIVERY';
  ref_id: string;
}

export async function fetchCommunicationHistory(filters: { employerId?: string; caseId?: string }) {
  const out: CommHistoryEntry[] = [];

  // Notices
  let nq = supabase.from('ce_notices').select('id,notice_number,subject,body,sent_at,created_at,delivery_method,status,employer_id,case_id').limit(500);
  if (filters.employerId) nq = nq.eq('employer_id', filters.employerId);
  if (filters.caseId) nq = nq.eq('case_id', filters.caseId);
  const { data: notices } = await nq;
  (notices || []).forEach((n: any) => {
    out.push({
      id: `notice-${n.id}`, ts: n.sent_at || n.created_at,
      channel: n.delivery_method || 'EMAIL', direction: 'OUT',
      subject: `${n.notice_number} — ${n.subject || n.status}`,
      body: n.body, source: 'NOTICE', ref_id: n.id,
    });
  });

  // Case correspondence (emails, portal, sms, calls, notes)
  if (filters.caseId) {
    const { data: cc } = await supabase.from('ce_case_correspondence')
      .select('*').eq('case_id', filters.caseId).limit(500);
    (cc || []).forEach((c: any) => {
      out.push({
        id: `cc-${c.id}`, ts: c.sent_at || c.received_at || c.created_at,
        channel: c.channel, direction: c.direction === 'IN' ? 'IN' : 'OUT',
        subject: c.subject || '(no subject)', body: c.body,
        source: 'CORRESPONDENCE', ref_id: c.id,
      });
    });
  }

  // Employer responses
  if (filters.employerId || filters.caseId) {
    let rq = supabase.from('ce_notice_responses').select('*').limit(500);
    if (filters.employerId) rq = rq.eq('employer_id', filters.employerId);
    if (filters.caseId) rq = rq.eq('case_id', filters.caseId);
    const { data: rs } = await rq;
    (rs || []).forEach((r: any) => {
      out.push({
        id: `resp-${r.id}`, ts: r.response_date || r.created_at,
        channel: 'EMPLOYER_RESPONSE', direction: 'IN',
        subject: `Response: ${r.response_type}`, body: r.notes,
        source: 'RESPONSE', ref_id: r.id,
      });
    });
  }

  out.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  return out;
}
