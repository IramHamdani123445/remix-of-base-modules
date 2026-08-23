/**
 * Compliance -> Legal escalation: single source of truth for the referral
 * lifecycle.
 *
 * One controlled workflow, no parallel definitions:
 *
 *   DRAFT                    referral created by the Refer to Legal wizard
 *   PENDING_APPROVAL         legal pack complete, awaiting supervisor approval
 *   APPROVED_FOR_SUBMISSION  approved - may now be submitted to Legal
 *   SUBMITTED_TO_LEGAL       Legal intake created (the hand-off point)
 *   ACCEPTED_BY_LEGAL        Legal accepted the intake and opened a legal case
 *   RETURNED_BY_LEGAL        Legal sent it back for rework
 *   REJECTED                 rejected at approval or abandoned
 *   IN_LEGAL_PROCEEDINGS     court / legal action under way
 *   CLOSED                   terminal
 *
 * The database CHECK constraint on ce_legal_referrals.status mirrors this list.
 */
import { supabase } from '@/integrations/supabase/client';
import { resolveWorkflow } from '@/services/complianceWorkflowMappingService';

const sb = supabase as any;

export const REFERRAL_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED_FOR_SUBMISSION: 'APPROVED_FOR_SUBMISSION',
  SUBMITTED_TO_LEGAL: 'SUBMITTED_TO_LEGAL',
  ACCEPTED_BY_LEGAL: 'ACCEPTED_BY_LEGAL',
  RETURNED_BY_LEGAL: 'RETURNED_BY_LEGAL',
  REJECTED: 'REJECTED',
  IN_LEGAL_PROCEEDINGS: 'IN_LEGAL_PROCEEDINGS',
  CLOSED: 'CLOSED',
} as const;

export type ReferralStatus = (typeof REFERRAL_STATUS)[keyof typeof REFERRAL_STATUS];

/** Ordered stages used by the progress rail on the case and referral screens. */
export const REFERRAL_STAGE_ORDER: ReferralStatus[] = [
  REFERRAL_STATUS.DRAFT,
  REFERRAL_STATUS.PENDING_APPROVAL,
  REFERRAL_STATUS.APPROVED_FOR_SUBMISSION,
  REFERRAL_STATUS.SUBMITTED_TO_LEGAL,
  REFERRAL_STATUS.ACCEPTED_BY_LEGAL,
  REFERRAL_STATUS.IN_LEGAL_PROCEEDINGS,
  REFERRAL_STATUS.CLOSED,
];

export const REFERRAL_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft - preparing legal pack',
  PENDING_APPROVAL: 'Pending supervisor approval',
  APPROVED_FOR_SUBMISSION: 'Approved - ready to submit',
  SUBMITTED_TO_LEGAL: 'Submitted to Legal',
  ACCEPTED_BY_LEGAL: 'Accepted by Legal',
  RETURNED_BY_LEGAL: 'Returned by Legal',
  REJECTED: 'Rejected',
  IN_LEGAL_PROCEEDINGS: 'In legal proceedings',
  CLOSED: 'Closed',
};

/** Referrals still owned by Compliance (preparation + rework). */
export const PREPARATION_STATUSES: ReferralStatus[] = [
  REFERRAL_STATUS.DRAFT,
  REFERRAL_STATUS.RETURNED_BY_LEGAL,
];

/** Referrals sitting in the Legal Queue awaiting a decision or hand-off. */
export const LEGAL_QUEUE_STATUSES: ReferralStatus[] = [
  REFERRAL_STATUS.PENDING_APPROVAL,
  REFERRAL_STATUS.APPROVED_FOR_SUBMISSION,
  REFERRAL_STATUS.SUBMITTED_TO_LEGAL,
];

/** Referrals that have cleared approval and reached Legal. */
export const APPROVED_ESCALATION_STATUSES: ReferralStatus[] = [
  REFERRAL_STATUS.APPROVED_FOR_SUBMISSION,
  REFERRAL_STATUS.SUBMITTED_TO_LEGAL,
  REFERRAL_STATUS.ACCEPTED_BY_LEGAL,
  REFERRAL_STATUS.IN_LEGAL_PROCEEDINGS,
];

/** A referral in one of these statuses blocks a second referral on the case. */
export const ACTIVE_REFERRAL_STATUSES: ReferralStatus[] = [
  REFERRAL_STATUS.DRAFT,
  REFERRAL_STATUS.PENDING_APPROVAL,
  REFERRAL_STATUS.APPROVED_FOR_SUBMISSION,
  REFERRAL_STATUS.SUBMITTED_TO_LEGAL,
  REFERRAL_STATUS.ACCEPTED_BY_LEGAL,
  REFERRAL_STATUS.IN_LEGAL_PROCEEDINGS,
  REFERRAL_STATUS.RETURNED_BY_LEGAL,
];

export function referralStatusVariant(
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === REFERRAL_STATUS.REJECTED || status === REFERRAL_STATUS.RETURNED_BY_LEGAL) return 'destructive';
  if (status === REFERRAL_STATUS.DRAFT) return 'outline';
  if (
    status === REFERRAL_STATUS.SUBMITTED_TO_LEGAL ||
    status === REFERRAL_STATUS.ACCEPTED_BY_LEGAL ||
    status === REFERRAL_STATUS.IN_LEGAL_PROCEEDINGS
  ) {
    return 'default';
  }
  return 'secondary';
}

export interface CaseLegalStatus {
  referral_id: string;
  referral_number: string;
  status: ReferralStatus;
  created_via: string | null;
  created_at: string;
  approval_requested_at: string | null;
  approval_requested_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  submitted_date: string | null;
  returned_at: string | null;
  return_reason: string | null;
  rejection_reason: string | null;
  lg_intake_id: string | null;
  lg_intake_no: string | null;
  legal_case_id: string | null;
  grand_total: number | null;
}

/** Current legal escalation status for a compliance case (latest referral). */
export async function fetchCaseLegalStatus(caseId: string): Promise<CaseLegalStatus | null> {
  const { data, error } = await sb
    .from('ce_legal_referrals')
    .select(
      'id, referral_number, status, created_via, created_at, approval_requested_at, approval_requested_by, approved_at, approved_by, submitted_date, returned_at, return_reason, rejection_reason, lg_intake_id, lg_intake_no, legal_case_id, grand_total',
    )
    .eq('source_case_id', caseId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...data, referral_id: data.id } as CaseLegalStatus;
}

async function audit(
  action: string,
  referralId: string,
  payload: Record<string, unknown>,
  userCode: string | null,
) {
  await sb
    .from('system_audit_trail')
    .insert({
      module: 'COMPLIANCE_TO_LEGAL',
      action,
      entity_type: 'ce_legal_referral',
      entity_id: referralId,
      severity: 'info',
      user_name: userCode,
      payload_json: payload,
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

async function loadReferral(referralId: string) {
  const { data, error } = await sb.from('ce_legal_referrals').select('*').eq('id', referralId).single();
  if (error) throw error;
  return data;
}

/**
 * Move a prepared referral into the approval stage. When no approval workflow
 * is mapped for `legal.escalation_approval` the referral is auto-approved and
 * that fact is recorded, so escalation is never silently uncontrolled.
 */
export async function requestReferralApproval(
  referralId: string,
  userCode: string | null,
): Promise<{ status: ReferralStatus; workflowName: string | null; autoApproved: boolean }> {
  const ref = await loadReferral(referralId);
  if (![REFERRAL_STATUS.DRAFT, REFERRAL_STATUS.RETURNED_BY_LEGAL].includes(ref.status)) {
    throw new Error(`Only draft or returned referrals can be sent for approval (current status: ${ref.status}).`);
  }
  const mapping = await resolveWorkflow('legal.escalation_approval', {
    amount: Number(ref.grand_total ?? 0),
    fund: null,
  }).catch(() => null);

  const now = new Date().toISOString();
  const autoApproved = !mapping?.enabled;
  const status = autoApproved ? REFERRAL_STATUS.APPROVED_FOR_SUBMISSION : REFERRAL_STATUS.PENDING_APPROVAL;

  const { error } = await sb
    .from('ce_legal_referrals')
    .update({
      status,
      pack_completed_at: now,
      approval_requested_at: now,
      approval_requested_by: userCode,
      approval_workflow_definition_id: mapping?.workflowDefinitionId ?? null,
      approved_at: autoApproved ? now : null,
      approved_by: autoApproved ? 'SYSTEM (no approval workflow mapped)' : null,
      returned_at: null,
      return_reason: null,
      updated_by: userCode,
      updated_at: now,
    })
    .eq('id', referralId);
  if (error) throw error;

  await audit(
    'LEGAL_REFERRAL_APPROVAL_REQUESTED',
    referralId,
    {
      referral_number: ref.referral_number,
      workflow: mapping?.workflowName ?? null,
      auto_approved: autoApproved,
      resulting_status: status,
    },
    userCode,
  );

  return { status, workflowName: mapping?.workflowName ?? null, autoApproved };
}

export async function approveReferral(
  referralId: string,
  userCode: string | null,
  notes?: string,
): Promise<void> {
  const ref = await loadReferral(referralId);
  if (ref.status !== REFERRAL_STATUS.PENDING_APPROVAL) {
    throw new Error(`Only referrals pending approval can be approved (current status: ${ref.status}).`);
  }
  if (ref.approval_requested_by && userCode && ref.approval_requested_by === userCode) {
    throw new Error('Maker-checker: the officer who requested approval cannot approve their own legal referral.');
  }
  const now = new Date().toISOString();
  const { error } = await sb
    .from('ce_legal_referrals')
    .update({
      status: REFERRAL_STATUS.APPROVED_FOR_SUBMISSION,
      approved_at: now,
      approved_by: userCode,
      approval_notes: notes ?? null,
      updated_by: userCode,
      updated_at: now,
    })
    .eq('id', referralId);
  if (error) throw error;
  await audit(
    'LEGAL_REFERRAL_APPROVED',
    referralId,
    { referral_number: ref.referral_number, notes: notes ?? null },
    userCode,
  );
}

export async function rejectReferral(
  referralId: string,
  reason: string,
  userCode: string | null,
): Promise<void> {
  if (!reason?.trim()) throw new Error('A rejection reason is required.');
  const ref = await loadReferral(referralId);
  if (![REFERRAL_STATUS.PENDING_APPROVAL, REFERRAL_STATUS.DRAFT].includes(ref.status)) {
    throw new Error(`Cannot reject a referral in status ${ref.status}.`);
  }
  const now = new Date().toISOString();
  const { error } = await sb
    .from('ce_legal_referrals')
    .update({
      status: REFERRAL_STATUS.REJECTED,
      rejected_date: now,
      rejected_by: userCode,
      rejection_reason: reason,
      updated_by: userCode,
      updated_at: now,
    })
    .eq('id', referralId);
  if (error) throw error;
  await audit('LEGAL_REFERRAL_REJECTED', referralId, { referral_number: ref.referral_number, reason }, userCode);
}

/** Legal sends a referral back to Compliance for rework. */
export async function markReferralReturned(
  referralId: string,
  reason: string,
  userCode: string | null,
): Promise<void> {
  if (!reason?.trim()) throw new Error('A return reason is required.');
  const ref = await loadReferral(referralId);
  const now = new Date().toISOString();
  const { error } = await sb
    .from('ce_legal_referrals')
    .update({
      status: REFERRAL_STATUS.RETURNED_BY_LEGAL,
      returned_at: now,
      returned_by: userCode,
      return_reason: reason,
      approved_at: null,
      approved_by: null,
      updated_by: userCode,
      updated_at: now,
    })
    .eq('id', referralId);
  if (error) throw error;
  await audit('LEGAL_REFERRAL_RETURNED', referralId, { referral_number: ref.referral_number, reason }, userCode);
}
