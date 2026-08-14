/**
 * Omni-Comms — delivery gate approvals carried by the CENTRAL workflow engine.
 *
 * The Omnichannel Communications Hub does NOT own a private approval store.
 * Every request to turn a delivery gate on or off is recorded as an instance
 * of the central workflow definition `OMNI_COMMS_GATE_APPROVAL`
 * (module `OMNI_COMMS`), so the request appears in the same enterprise
 * workflow catalogue, inbox and audit trail as every other approval.
 *
 * Boundaries:
 *   - This module records and reads INTENT only. It never enables delivery.
 *     The authoritative gate decision stays with the trusted Release Control
 *     Edge boundary and its server-side two-person rule.
 *   - No provider is contacted and nothing is sent from here.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  approveWorkflow,
  getWorkflowInstanceForEntity,
  rejectWorkflow,
  startWorkflow,
  withdrawWorkflow,
  completeWorkflow,
} from '@/platform/workflow/workflowService';
import type { WorkflowInstance } from '@/platform/workflow/workflowTypes';

export const OMNI_COMMS_GATE_WORKFLOW_CODE = 'OMNI_COMMS_GATE_APPROVAL';
export const OMNI_COMMS_GATE_MODULE_CODE = 'OMNI_COMMS';
export const OMNI_COMMS_GATE_ENTITY_TYPE = 'omni_comms_gate_request';

/** Statuses that still need somebody to act. */
export const OMNI_COMMS_GATE_OPEN_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'IN_PROGRESS',
  'PENDING_REVIEW',
  'PENDING_APPROVAL',
  'ESCALATED',
] as const;

export type GateIntent = 'enable' | 'disable';

export interface GateRequestScope {
  organizationId: string;
  departmentId: string | null;
  channel: string;
  /** `channel_delivery` today; business-event gates use their event code. */
  gate: string;
}

export interface GateApprovalRequest {
  id: string;
  entityId: string;
  displayName: string | null;
  status: string;
  intent: GateIntent | null;
  channel: string;
  gate: string;
  requestedBy: string | null;
  requestedAt: string | null;
  metadata: Record<string, unknown> | null;
}

/** Stable, scope-unique key for one gate. */
export const gateEntityId = (scope: GateRequestScope): string =>
  [
    scope.organizationId,
    scope.departmentId ?? 'org',
    scope.channel,
    scope.gate,
  ].join(':');

const toRequest = (row: WorkflowInstance): GateApprovalRequest => {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const intent = meta.intent === 'enable' || meta.intent === 'disable'
    ? (meta.intent as GateIntent)
    : null;
  return {
    id: row.id,
    entityId: row.entity_id,
    displayName: row.entity_display_name ?? null,
    status: row.status,
    intent,
    channel: typeof meta.channel === 'string' ? meta.channel : 'email',
    gate: typeof meta.gate === 'string' ? meta.gate : 'channel_delivery',
    requestedBy: row.submitted_by ?? null,
    requestedAt: row.submitted_at ?? row.created_at ?? null,
    metadata: row.metadata ?? null,
  };
};

export const gateRequestTitle = (
  scope: GateRequestScope,
  intent: GateIntent,
): string =>
  `${intent === 'enable' ? 'Turn on' : 'Turn off'} automatic ${scope.channel} delivery`;

/**
 * Open the central approval TASK for a gate request, so the second person
 * sees it in the enterprise workflow inbox and not only in this screen.
 * The task is assigned by PERMISSION, never to the requester personally.
 */
async function openGateApprovalTask(
  instance: WorkflowInstance,
  scope: GateRequestScope,
  intent: GateIntent,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: existing } = await db
    .from('core_workflow_task')
    .select('id')
    .eq('workflow_instance_id', instance.id)
    .eq('task_status', 'OPEN')
    .limit(1)
    .maybeSingle();
  if (existing?.id) return;

  const { error } = await db.from('core_workflow_task').insert({
    workflow_instance_id: instance.id,
    task_code: 'OMNI_COMMS_GATE_APPROVAL',
    task_name: gateRequestTitle(scope, intent),
    task_description:
      'A different administrator must confirm this Omnichannel Communications '
      + 'delivery gate change before automatic sending starts.',
    step_code: 'APPROVAL',
    step_name: 'Second-person approval',
    assigned_to_permission_key: 'omni_comms.operate',
    task_status: 'OPEN',
    priority: 'HIGH',
    metadata: {
      intent,
      channel: scope.channel,
      gate: scope.gate,
      organization_id: scope.organizationId,
      department_id: scope.departmentId,
    },
  });
  if (error) throw error;
}

/** Close every open task on a gate request instance. */
export async function closeGateApprovalTasks(
  instanceId: string,
  outcome: 'APPROVED' | 'REJECTED' | 'WITHDRAWN',
  comments?: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: user } = await supabase.auth.getUser();
  await db
    .from('core_workflow_task')
    .update({
      task_status: outcome === 'APPROVED' ? 'COMPLETED' : 'CANCELLED',
      outcome,
      comments: comments ?? null,
      completed_by: user?.user?.id ?? null,
      completed_at: new Date().toISOString(),
      is_active: false,
    })
    .eq('workflow_instance_id', instanceId)
    .in('task_status', ['OPEN', 'CLAIMED', 'IN_PROGRESS', 'ESCALATED']);
}

/**
 * Record an operator's intent in the central workflow. Re-recording the same
 * open request is a no-op, so pressing the switch twice never creates a
 * duplicate queue item.
 *
 * Failures are RAISED — a gate change must never look recorded when it is not.
 */
export async function recordGateRequest(
  scope: GateRequestScope,
  intent: GateIntent,
): Promise<GateApprovalRequest> {
  const entityId = gateEntityId(scope);
  const existing = await getWorkflowInstanceForEntity(
    OMNI_COMMS_GATE_MODULE_CODE,
    OMNI_COMMS_GATE_ENTITY_TYPE,
    entityId,
    OMNI_COMMS_GATE_WORKFLOW_CODE,
  ).catch(() => null);

  if (existing && (OMNI_COMMS_GATE_OPEN_STATUSES as readonly string[]).includes(existing.status)) {
    await openGateApprovalTask(existing, scope, intent);
    return toRequest(existing);
  }

  if (existing) {
    // One instance per gate: reopen the existing record rather than creating a
    // second one, so the queue never shows duplicates for the same gate.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data: user } = await supabase.auth.getUser();
    const { data: reopened, error } = await db
      .from('core_workflow_instance')
      .update({
        status: 'PENDING_APPROVAL',
        current_step_code: 'APPROVAL',
        current_step_name: 'Second-person approval',
        entity_display_name: gateRequestTitle(scope, intent),
        submitted_by: user?.user?.id ?? null,
        submitted_at: new Date().toISOString(),
        completed_at: null,
        completed_by: null,
        cancelled_at: null,
        cancelled_by: null,
        cancellation_reason: null,
        metadata: {
          intent,
          channel: scope.channel,
          gate: scope.gate,
          organization_id: scope.organizationId,
          department_id: scope.departmentId,
        },
      })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    await openGateApprovalTask(reopened as WorkflowInstance, scope, intent);
    return toRequest(reopened as WorkflowInstance);
  }

  const created = await startWorkflow({
    workflow_code: OMNI_COMMS_GATE_WORKFLOW_CODE,
    module_code: OMNI_COMMS_GATE_MODULE_CODE,
    entity_type: OMNI_COMMS_GATE_ENTITY_TYPE,
    entity_id: entityId,
    entity_display_name: gateRequestTitle(scope, intent),
    priority: 'HIGH',
    status: 'PENDING_APPROVAL',
    metadata: {
      intent,
      channel: scope.channel,
      gate: scope.gate,
      organization_id: scope.organizationId,
      department_id: scope.departmentId,
    },
  });
  await openGateApprovalTask(created, scope, intent);
  return toRequest(created);
}


/** Open gate requests for an organisation, newest first. */
export async function listOpenGateRequests(
  organizationId: string,
): Promise<GateApprovalRequest[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from('core_workflow_instance')
    .select('*')
    .eq('module_code', OMNI_COMMS_GATE_MODULE_CODE)
    .eq('entity_type', OMNI_COMMS_GATE_ENTITY_TYPE)
    .in('status', OMNI_COMMS_GATE_OPEN_STATUSES as unknown as string[])
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return ((data ?? []) as WorkflowInstance[])
    .filter((row) => row.entity_id.startsWith(`${organizationId}:`))
    .map(toRequest);
}

/** Recently closed requests, so the operator can see what happened. */
export async function listRecentGateDecisions(
  organizationId: string,
): Promise<GateApprovalRequest[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from('core_workflow_instance')
    .select('*')
    .eq('module_code', OMNI_COMMS_GATE_MODULE_CODE)
    .eq('entity_type', OMNI_COMMS_GATE_ENTITY_TYPE)
    .not('status', 'in', `(${OMNI_COMMS_GATE_OPEN_STATUSES.join(',')})`)
    .order('updated_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return ((data ?? []) as WorkflowInstance[])
    .filter((row) => row.entity_id.startsWith(`${organizationId}:`))
    .map(toRequest);
}

/** Close a request as approved. The gate itself is changed by the server. */
export const approveGateRequest = (id: string, comments?: string) =>
  approveWorkflow(id, undefined, comments);

export const rejectGateRequest = (id: string, reason: string) =>
  rejectWorkflow(id, undefined, reason);

export const withdrawGateRequest = (id: string, reason?: string) =>
  withdrawWorkflow(id, reason);

/**
 * Record an IMMEDIATE pause (turning automatic delivery off).
 *
 * Pausing is a safety action: it never needs a second person, but it always
 * needs a reason and is always written to the central workflow trail.
 */
export async function recordGatePause(
  scope: GateRequestScope,
  reason: string,
): Promise<GateApprovalRequest> {
  const request = await recordGateRequest(scope, 'disable');
  await closeGateApprovalTasks(request.id, 'APPROVED', reason);
  await completeWorkflow(request.id);
  return request;
}

/** Approve a gate request and close its central task in one step. */
export async function approveGateRequestWithTask(id: string, comments?: string) {
  await closeGateApprovalTasks(id, 'APPROVED', comments);
  return approveGateRequest(id, comments);
}

export async function rejectGateRequestWithTask(id: string, reason: string) {
  await closeGateApprovalTasks(id, 'REJECTED', reason);
  return rejectGateRequest(id, reason);
}

export async function withdrawGateRequestWithTask(id: string, reason?: string) {
  await closeGateApprovalTasks(id, 'WITHDRAWN', reason);
  return withdrawGateRequest(id, reason);
}
