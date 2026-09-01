/**
 * Internal Audit notification service — Wave 4 runtime cutover.
 *
 * This module NO LONGER dispatches anything itself. Every call is translated
 * into a catalogued Internal Audit communication obligation and handed to the
 * single canonical Omni-Comms entrypoint, which decides channel, template,
 * branding, sender, queueing, retry and evidence.
 *
 * The exported surface is unchanged so existing business call sites keep
 * working; only the execution path moved.
 */
import { emitInternalAuditCommunication } from '@/platform/omni-comms/integrations/business/internal-audit/internalAuditCommunicationProducer';

type IANotificationEvent =
  | 'ia_plan_submitted'
  | 'ia_plan_approved'
  | 'ia_plan_rejected'
  | 'ia_plan_revision_required'
  | 'ia_team_conflict'
  | 'ia_engagement_started'
  | 'ia_report_issued'
  | 'ia_action_overdue'
  | 'ia_closure_pending';

/** Legacy trigger name → catalogued Omni-Comms event code. */
const EVENT_MAP: Record<IANotificationEvent, string> = {
  ia_plan_submitted: 'INTERNAL_AUDIT.PLAN.SUBMITTED',
  ia_plan_approved: 'INTERNAL_AUDIT.PLAN.APPROVED',
  ia_plan_rejected: 'INTERNAL_AUDIT.PLAN.REJECTED',
  ia_plan_revision_required: 'INTERNAL_AUDIT.PLAN.REVISION_REQUESTED',
  ia_team_conflict: 'INTERNAL_AUDIT.PLAN.TEAM_CONFLICT',
  ia_engagement_started: 'INTERNAL_AUDIT.ENGAGEMENT.LAUNCHED',
  ia_report_issued: 'INTERNAL_AUDIT.REPORT.ISSUED',
  ia_action_overdue: 'INTERNAL_AUDIT.ACTION.OVERDUE',
  ia_closure_pending: 'INTERNAL_AUDIT.ENGAGEMENT.FIELDWORK_COMPLETED',
};

interface NotifyParams {
  event: IANotificationEvent;
  recipientIds?: string[];
  variables: Record<string, string>;
  entityId?: string;
  entityType?: string;
}

function referenceOf(variables: Record<string, string>, entityId?: string): string {
  return (
    variables.reference ||
    variables.planTitle ||
    variables.title ||
    variables.engagementRef ||
    entityId ||
    'Internal Audit'
  );
}

/**
 * Raise the obligation once per recipient. Never throws: a communication
 * failure must never break the audit transaction that raised it.
 */
export async function sendIANotification({
  event,
  recipientIds = [],
  variables,
  entityId,
}: NotifyParams) {
  const eventCode = EVENT_MAP[event];
  if (!eventCode) {
    console.warn(`[IA Notify] Uncatalogued event ignored: ${event}`);
    return;
  }

  const targets = recipientIds.length > 0 ? recipientIds : [null];

  for (const recipientUserId of targets) {
    const result = await emitInternalAuditCommunication({
      eventCode,
      entityId: entityId ?? 'unknown',
      occurrence: recipientUserId ?? 'default',
      recipientName: variables.recipientName || 'Recipient',
      reference: referenceOf(variables, entityId),
      recipientUserId,
      values: variables,
    });
    if (result.outcome === 'blocked' || result.outcome === 'unavailable') {
      console.warn(`[IA Notify] ${eventCode} not accepted:`, result.blockers);
    }
  }
}

/** Convenience helpers — signatures unchanged. */
export const notifyPlanSubmitted = (planId: string, vars: Record<string, string>) =>
  sendIANotification({ event: 'ia_plan_submitted', variables: vars, entityId: planId, entityType: 'audit_plan' });

export const notifyPlanApproved = (planId: string, vars: Record<string, string>) =>
  sendIANotification({ event: 'ia_plan_approved', variables: vars, entityId: planId, entityType: 'audit_plan' });

export const notifyPlanRejected = (planId: string, vars: Record<string, string>) =>
  sendIANotification({ event: 'ia_plan_rejected', variables: vars, entityId: planId, entityType: 'audit_plan' });

export const notifyTeamConflict = (planId: string, vars: Record<string, string>) =>
  sendIANotification({ event: 'ia_team_conflict', variables: vars, entityId: planId, entityType: 'audit_plan' });

export const notifyEngagementStarted = (engId: string, vars: Record<string, string>) =>
  sendIANotification({ event: 'ia_engagement_started', variables: vars, entityId: engId, entityType: 'audit_engagement' });

export const notifyReportIssued = (reportId: string, vars: Record<string, string>) =>
  sendIANotification({ event: 'ia_report_issued', variables: vars, entityId: reportId, entityType: 'audit_report' });

export const notifyActionOverdue = (actionId: string, vars: Record<string, string>) =>
  sendIANotification({ event: 'ia_action_overdue', variables: vars, entityId: actionId, entityType: 'audit_action' });

export const notifyClosurePending = (engId: string, vars: Record<string, string>) =>
  sendIANotification({ event: 'ia_closure_pending', variables: vars, entityId: engId, entityType: 'audit_engagement' });
