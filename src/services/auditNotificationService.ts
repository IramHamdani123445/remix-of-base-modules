/**
 * Audit Notification Service — Wave 4 runtime cutover.
 *
 * Internal Audit no longer composes subjects or HTML bodies and no longer
 * invokes any send function. Each lifecycle moment is published as a
 * catalogued business fact to the single canonical Omni-Comms entrypoint,
 * which owns template, channel, branding, sender, queueing, retry and
 * delivery evidence.
 *
 * The exported surface is unchanged so existing call sites keep working.
 */
import { supabase } from '@/integrations/supabase/client';
import { emitInternalAuditCommunication } from '@/platform/omni-comms/integrations/business/internal-audit/internalAuditCommunicationProducer';

interface EmitArgs {
  eventCode: string;
  entityId: string;
  occurrence?: string;
  recipientName: string;
  reference: string;
  recipientEmail?: string | null;
  recipientUserId?: string | null;
  values?: Record<string, unknown>;
}

async function raise(args: EmitArgs): Promise<boolean> {
  const result = await emitInternalAuditCommunication({
    eventCode: args.eventCode,
    entityId: args.entityId,
    occurrence: args.occurrence,
    recipientName: args.recipientName,
    reference: args.reference,
    recipientEmail: args.recipientEmail ?? null,
    recipientUserId: args.recipientUserId ?? null,
    values: args.values ?? {},
  });
  if (result.outcome === 'blocked' || result.outcome === 'unavailable') {
    console.warn(`[IA Comms] ${args.eventCode} not accepted:`, result.blockers);
    return false;
  }
  return true;
}

// ── Recipient resolution (identity facts only — never delivery decisions) ──

async function getAuditor(
  auditorId: string,
): Promise<{ email: string | null; name: string | null; profileId: string | null }> {
  const { data } = await supabase
    .from('ia_auditors')
    .select('email, name, profile_id')
    .eq('id', auditorId)
    .maybeSingle();
  return {
    email: data?.email ?? null,
    name: data?.name ?? null,
    profileId: (data as { profile_id?: string | null } | null)?.profile_id ?? null,
  };
}

async function getDepartmentHead(
  departmentId: string,
): Promise<{ email: string | null; name: string | null; profileId: string | null }> {
  const { data: dept } = await supabase
    .from('ia_departments')
    .select('head, email, head_profile_id')
    .eq('id', departmentId)
    .maybeSingle();
  if (!dept) return { email: null, name: null, profileId: null };
  if (dept.head_profile_id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', dept.head_profile_id)
      .maybeSingle();
    return {
      email: dept.email || profile?.email || null,
      name: dept.head || profile?.full_name || null,
      profileId: dept.head_profile_id,
    };
  }
  return { email: dept.email ?? null, name: dept.head ?? null, profileId: null };
}

// ══════════════════════════════════════════════════════════════
// Plan lifecycle
// ══════════════════════════════════════════════════════════════

export async function notifyPlanSubmitted(planId: string, planTitle: string, leadAuditorId?: string) {
  if (!leadAuditorId) return;
  const auditor = await getAuditor(leadAuditorId);
  if (!auditor.email && !auditor.profileId) return;
  await raise({
    eventCode: 'INTERNAL_AUDIT.PLAN.SUBMITTED',
    entityId: planId,
    recipientName: auditor.name || 'Lead Auditor',
    reference: planTitle,
    recipientEmail: auditor.email,
    recipientUserId: auditor.profileId,
    values: { planTitle },
  });
}

export async function notifyPlanApproved(
  planId: string,
  planTitle: string,
  departmentId?: string,
  teamMemberIds?: string[],
) {
  if (departmentId) {
    const head = await getDepartmentHead(departmentId);
    if (head.email || head.profileId) {
      await raise({
        eventCode: 'INTERNAL_AUDIT.PLAN.APPROVED',
        entityId: planId,
        occurrence: `dept:${departmentId}`,
        recipientName: head.name || 'Department Head',
        reference: planTitle,
        recipientEmail: head.email,
        recipientUserId: head.profileId,
        values: { planTitle, acceptanceRequired: true },
      });
    }
  }
  for (const auditorId of teamMemberIds ?? []) {
    const auditor = await getAuditor(auditorId);
    if (!auditor.email && !auditor.profileId) continue;
    await raise({
      eventCode: 'INTERNAL_AUDIT.PLAN.APPROVED',
      entityId: planId,
      occurrence: `team:${auditorId}`,
      recipientName: auditor.name || 'Team Member',
      reference: planTitle,
      recipientEmail: auditor.email,
      recipientUserId: auditor.profileId,
      values: { planTitle, assignmentRole: 'team_member' },
    });
  }
}

export async function notifyDeptAcceptanceRequired(planId: string, planTitle: string, departmentId: string) {
  const head = await getDepartmentHead(departmentId);
  if (!head.email && !head.profileId) return;
  await raise({
    eventCode: 'INTERNAL_AUDIT.PLAN.APPROVED',
    entityId: planId,
    occurrence: `acceptance:${departmentId}`,
    recipientName: head.name || 'Department Head',
    reference: planTitle,
    recipientEmail: head.email,
    recipientUserId: head.profileId,
    values: { planTitle, acceptanceRequired: true },
  });
}

export async function notifyPlanClosed(planTitle: string, departmentId: string) {
  const head = await getDepartmentHead(departmentId);
  if (!head.email && !head.profileId) return;
  await raise({
    eventCode: 'INTERNAL_AUDIT.PLAN.CLOSED',
    entityId: `${departmentId}:${planTitle}`,
    recipientName: head.name || 'Department Head',
    reference: planTitle,
    recipientEmail: head.email,
    recipientUserId: head.profileId,
    values: { planTitle },
  });
}

// ══════════════════════════════════════════════════════════════
// Findings and corrective actions
// ══════════════════════════════════════════════════════════════

export async function notifyFindingCreated(findingTitle: string, departmentId?: string) {
  if (!departmentId) return;
  const head = await getDepartmentHead(departmentId);
  if (!head.email && !head.profileId) return;
  await raise({
    eventCode: 'INTERNAL_AUDIT.FINDING.RAISED',
    entityId: `${departmentId}:${findingTitle}`,
    recipientName: head.name || 'Department Head',
    reference: findingTitle,
    recipientEmail: head.email,
    recipientUserId: head.profileId,
    values: { findingTitle },
  });
}

/**
 * DEF-17 — action-owner identity propagation.
 *
 * Action owners are captured as a free-text email on the action record, so the
 * in-app leg previously carried no user reference and always failed closed with
 * `recipient_not_allowlisted`. We now resolve the platform profile behind that
 * email (identity fact only) and pass it through as the recipient user id.
 */
async function resolveProfileIdByEmail(email?: string | null): Promise<string | null> {
  const normalised = (email ?? '').trim().toLowerCase();
  if (!normalised || !normalised.includes('@')) return null;
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name')
    .ilike('email', normalised)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

export async function notifyActionAssigned(
  actionDescription: string,
  responsibleEmail: string,
  dueDate?: string,
  responsibleProfileId?: string | null,
) {
  const profileId = responsibleProfileId ?? (await resolveProfileIdByEmail(responsibleEmail));
  await raise({
    eventCode: 'INTERNAL_AUDIT.ACTION.ASSIGNED',
    entityId: `${responsibleEmail}:${actionDescription.slice(0, 120)}`,
    recipientName: 'Action owner',
    reference: actionDescription.slice(0, 80),
    recipientEmail: responsibleEmail,
    recipientUserId: profileId,
    values: { actionSummary: actionDescription, dueDate: dueDate ?? null },
  });
}

export async function notifyActionOverdue(
  actionDescription: string,
  responsibleEmail: string,
  dueDate: string,
  responsibleProfileId?: string | null,
) {
  const profileId = responsibleProfileId ?? (await resolveProfileIdByEmail(responsibleEmail));
  await raise({
    eventCode: 'INTERNAL_AUDIT.ACTION.OVERDUE',
    entityId: `${responsibleEmail}:${actionDescription.slice(0, 120)}`,
    occurrence: `overdue:${dueDate}`,
    recipientName: 'Action owner',
    reference: actionDescription.slice(0, 80),
    recipientEmail: responsibleEmail,
    recipientUserId: profileId,
    values: { actionSummary: actionDescription, dueDate },
  });
}

export async function notifyActionReminder(
  actionDescription: string,
  responsibleEmail: string,
  dueDate: string,
  daysRemaining: number,
  responsibleProfileId?: string | null,
) {
  const profileId = responsibleProfileId ?? (await resolveProfileIdByEmail(responsibleEmail));
  await raise({
    eventCode: 'INTERNAL_AUDIT.ACTION.DUE_SOON',
    entityId: `${responsibleEmail}:${actionDescription.slice(0, 120)}`,
    occurrence: `due_in_${daysRemaining}`,
    recipientName: 'Action owner',
    reference: actionDescription.slice(0, 80),
    recipientEmail: responsibleEmail,
    recipientUserId: profileId,
    values: { actionSummary: actionDescription, dueDate, daysRemaining },
  });
}


// ══════════════════════════════════════════════════════════════
// Management responses
// ══════════════════════════════════════════════════════════════

export async function notifyManagementResponseSubmitted(findingId: string, leadAuditorId?: string) {
  if (!leadAuditorId) return;
  const auditor = await getAuditor(leadAuditorId);
  if (!auditor.email && !auditor.profileId) return;
  const { data: finding } = await supabase
    .from('ia_findings')
    .select('title')
    .eq('id', findingId)
    .maybeSingle();
  await raise({
    eventCode: 'INTERNAL_AUDIT.FINDING.RESPONSE_SUBMITTED',
    entityId: findingId,
    recipientName: auditor.name || 'Lead Auditor',
    reference: finding?.title || findingId,
    recipientEmail: auditor.email,
    recipientUserId: auditor.profileId,
    values: { findingTitle: finding?.title || findingId },
  });
}

// ══════════════════════════════════════════════════════════════
// Reports and queries
// ══════════════════════════════════════════════════════════════

export async function notifyReportGenerated(auditTitle: string, departmentId?: string) {
  if (!departmentId) return;
  const head = await getDepartmentHead(departmentId);
  if (!head.email && !head.profileId) return;
  await raise({
    eventCode: 'INTERNAL_AUDIT.REPORT.DRAFT_CIRCULATED',
    entityId: `${departmentId}:${auditTitle}`,
    recipientName: head.name || 'Department Head',
    reference: auditTitle,
    recipientEmail: head.email,
    recipientUserId: head.profileId,
    values: { auditTitle },
  });
}

export async function notifyQuerySent(question: string, departmentId: string, auditTitle?: string) {
  const head = await getDepartmentHead(departmentId);
  if (!head.email && !head.profileId) return;
  await raise({
    eventCode: 'INTERNAL_AUDIT.REQUEST.ISSUED',
    entityId: `${departmentId}:${question.slice(0, 120)}`,
    recipientName: head.name || 'Department Head',
    reference: auditTitle || 'Information Request',
    recipientEmail: head.email,
    recipientUserId: head.profileId,
    values: { question, auditTitle: auditTitle ?? null },
  });
}

export async function notifyQueryResponse(question: string, auditorId?: string) {
  if (!auditorId) return;
  const auditor = await getAuditor(auditorId);
  if (!auditor.email && !auditor.profileId) return;
  await raise({
    eventCode: 'INTERNAL_AUDIT.REQUEST.REMINDER',
    entityId: `${auditorId}:${question.slice(0, 120)}`,
    occurrence: 'response_received',
    recipientName: auditor.name || 'Auditor',
    reference: question.slice(0, 80),
    recipientEmail: auditor.email,
    recipientUserId: auditor.profileId,
    values: { question },
  });
}
