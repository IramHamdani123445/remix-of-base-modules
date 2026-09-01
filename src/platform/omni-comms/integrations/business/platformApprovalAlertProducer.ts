/**
 * Wave 4 — Business producer: Platform approval / workflow decision alerts.
 *
 * EVIDENCE, not invention. Two communications already exist today:
 *
 *   1. `gateApprovalNotifications` alerts administrators that a delivery-gate
 *      change was requested / approved / rejected. It wrote the in-app row and
 *      then called the platform notification function directly.
 *   2. A configured workflow step action notifies the applicant when a review
 *      decision is taken (`useApplicationsReview`), also calling
 *      the platform notification function directly.
 *
 * OWNERSHIP BOUNDARY. Omni owns ONLY the message informing a person. It does
 * not own task assignment, task completion or approval state — those remain in
 * the workflow engine and surface through My Tasks. This producer therefore
 * never creates, mutates or closes a task.
 *
 * Delivery authority is NOT widened: the bindings authorise `shadow` only.
 */

import { emitBusinessCommunication } from './emitBusinessCommunication';
import { resolveBusinessCommunicationScope } from './businessScopeResolver';
import type {
  BusinessProducerMode,
  BusinessProducerResult,
} from './businessProducerTypes';

export const PLATFORM_MODULE_CODE = 'PLATFORM';

export const GATE_APPROVAL_EVENT_CODES = {
  requested: 'PLATFORM.APPROVAL.GATE_REQUESTED',
  approved: 'PLATFORM.APPROVAL.GATE_APPROVED',
  rejected: 'PLATFORM.APPROVAL.GATE_REJECTED',
} as const;

export const WORKFLOW_DECISION_EVENT_CODE = 'PLATFORM.WORKFLOW.DECISION_NOTIFIED';

/** Evaluate-only until platform alerts are certified for live delivery. */
export const PLATFORM_ALERT_MODE: BusinessProducerMode = 'shadow';

export type GateApprovalAlertEvent = keyof typeof GATE_APPROVAL_EVENT_CODES;

export interface GateApprovalAlertRecipient {
  userId: string;
  name?: string | null;
  email?: string | null;
}

export interface GateApprovalAlertInput {
  event: GateApprovalAlertEvent;
  /** Human title of the gate change being decided. */
  subject: string;
  actorName?: string | null;
  comment?: string | null;
  /** Authoritative workflow instance — the task itself stays in workflow. */
  workflowInstanceId?: string | null;
  recipients: GateApprovalAlertRecipient[];
  organizationId?: string | null;
  departmentId?: string | null;
}

/**
 * Alert administrators about an approval transition.
 *
 * Recipients are resolved by the caller from the administrator audience — an
 * authenticated internal user set — never from a caller-supplied address.
 */
export async function emitGateApprovalAlert(
  input: GateApprovalAlertInput,
): Promise<BusinessProducerResult> {
  const scope = await resolveBusinessCommunicationScope({
    moduleCode: PLATFORM_MODULE_CODE,
    organizationId: input.organizationId ?? null,
    departmentId: input.departmentId ?? null,
  });

  const entityId =
    input.workflowInstanceId?.trim() || `gate-approval:${input.subject.trim()}`;

  return emitBusinessCommunication({
    moduleCode: PLATFORM_MODULE_CODE,
    eventCode: GATE_APPROVAL_EVENT_CODES[input.event],
    organizationId: scope.organizationId ?? '',
    departmentId: scope.departmentId,
    entityType: 'workflow_instance',
    entityId,
    entityVersion: `gate-approval-${input.event}-v1`,
    mode: PLATFORM_ALERT_MODE,
    correlationId: `omni-comms-gate-approval:${entityId}`,
    recipients: input.recipients.map((r) => ({
      // Internal administrator: an authenticated platform user.
      recipientType: 'user' as const,
      recipientRole: 'administrator',
      recipientReference: r.userId,
      displayName: r.name ?? null,
      email: r.email ?? null,
    })),
    payload: {
      event: input.event,
      subject: input.subject,
      actorName: input.actorName ?? '',
      comment: input.comment ?? '',
      workflowInstanceId: input.workflowInstanceId ?? '',
    },
  });
}

export interface WorkflowDecisionNotificationInput {
  /** Workflow instance the decision belongs to (authoritative business record). */
  workflowInstanceId: string;
  stepId?: string | null;
  actionName: string;
  actionType: string;
  decisionOutcome: string;
  applicationTitle: string;
  reviewerName?: string | null;
  comments?: string | null;
  /** Recipient resolved from the application record or the workflow starter. */
  recipientUserId?: string | null;
  recipientEmail?: string | null;
  recipientName?: string | null;
  organizationId?: string | null;
  departmentId?: string | null;
}

/**
 * Notify the applicant of a workflow review decision.
 *
 * The decision itself, the task and its completion remain owned by the
 * workflow engine. This is the informational leg only.
 */
export async function emitWorkflowDecisionNotification(
  input: WorkflowDecisionNotificationInput,
): Promise<BusinessProducerResult> {
  const scope = await resolveBusinessCommunicationScope({
    moduleCode: PLATFORM_MODULE_CODE,
    organizationId: input.organizationId ?? null,
    departmentId: input.departmentId ?? null,
  });

  return emitBusinessCommunication({
    moduleCode: PLATFORM_MODULE_CODE,
    eventCode: WORKFLOW_DECISION_EVENT_CODE,
    organizationId: scope.organizationId ?? '',
    departmentId: scope.departmentId,
    entityType: 'workflow_instance',
    entityId: input.workflowInstanceId,
    // The step + action identify WHICH decision, so a later decision on the
    // same instance is a new communication rather than a replay.
    entityVersion: `decision:${input.stepId ?? 'step'}:${input.actionType}-v1`,
    mode: PLATFORM_ALERT_MODE,
    correlationId: `platform-workflow-decision:${input.workflowInstanceId}`,
    recipients: [
      {
        // A resolved internal user when known, otherwise the applicant
        // recorded on the business record.
        recipientType: input.recipientUserId ? ('user' as const) : ('external' as const),
        recipientRole: 'applicant',
        recipientReference: input.recipientUserId ?? input.workflowInstanceId,
        displayName: input.recipientName ?? null,
        email: input.recipientEmail ?? null,
      },
    ],
    payload: {
      applicationTitle: input.applicationTitle,
      decisionOutcome: input.decisionOutcome,
      actionName: input.actionName,
      actionType: input.actionType,
      reviewerName: input.reviewerName ?? '',
      comments: input.comments ?? '',
      workflowInstanceId: input.workflowInstanceId,
    },
  });
}
