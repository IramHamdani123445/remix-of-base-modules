/**
 * BN Award Suspension — Read-Only View Service (canonical schema)
 *
 * Serves the redesigned Award Suspension workspace
 * (src/pages/bn/servicing/award-suspension/*).
 *
 * STRICT CONTRACT
 * ---------------
 * This module is **read-only**. It MUST NOT perform any mutation against
 * the database. Only the RPCs on `ALLOWED_READ_RPCS` may be invoked, and
 * every one of them is a read-only helper published by the platform.
 *
 * Canonical objects consulted:
 *   - bn_award, ip_master
 *   - bn_award_suspension_event
 *   - core_workflow_instance, core_workflow_task, core_workflow_action_log
 *   - core_audit_log
 *   - bn_workbasket, bn_workbasket_role, bn_role_delegation, bn_reason_code
 *   - bn_approval_policy
 *   - app_modules (rollout flags)
 *   - v_bn_user_effective_roles (view)
 *   - RPC bn_workbaskets_for_user(uuid) (read-only)
 *
 * A source-level test asserts:
 *   - No `.insert(`, `.update(`, `.delete(`, `.upsert(` on any table.
 *   - `.rpc(` may only be invoked for names in ALLOWED_READ_RPCS.
 */
import { supabase } from '@/integrations/supabase/client';
import { isFeatureEnabled } from '@/lib/bn/featureToggles';

const db = supabase as any;

/** Explicit allowlist. Every entry must be a read-only platform helper. */
export const ALLOWED_READ_RPCS = ['bn_workbaskets_for_user'] as const;

/** Workflow domain used by all Award Suspension requests. */
const SUSPENSION_WORKFLOW = {
  workflow_code: 'BN_AWARD_SUSPENSION',
  module_code: 'bn_award_suspension',
  entity_type: 'bn_award_suspension_event',
} as const;

// ─────────────────────────── Types ───────────────────────────
/**
 * BN-SUSP-STATUS — Canonical event lifecycle values stored in
 * `bn_award_suspension_event.status`. `UNKNOWN` is a fail-closed sentinel for
 * values the client does not recognise; it must never enable a command.
 */
export type SuspensionEventStatus =
  | 'PROPOSED'
  | 'APPROVED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'ACTIVE'
  | 'RESUMED'
  | 'EXECUTION_FAILED'
  | 'REINSTATEMENT_PROPOSED'
  | 'REINSTATEMENT_APPROVED'
  | 'REINSTATEMENT_REJECTED'
  | 'REINSTATEMENT_WITHDRAWN'
  | 'UNKNOWN';

export const SUSPENSION_EVENT_STATUSES = [
  'PROPOSED',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
  'ACTIVE',
  'RESUMED',
  'EXECUTION_FAILED',
  'REINSTATEMENT_PROPOSED',
  'REINSTATEMENT_APPROVED',
  'REINSTATEMENT_REJECTED',
  'REINSTATEMENT_WITHDRAWN',
] as const;

/**
 * Display-only status derived from event + workflow task via
 * `resolveDisplayStatus`. Never written to the database and never used to
 * decide whether a lifecycle command is available.
 */
export type SuspensionRequestStatus =
  | 'PROPOSED'
  | 'PENDING_APPROVAL'
  | 'PENDING_LEVEL_1'
  | 'PENDING_LEVEL_2'
  | 'PENDING_LEVEL_N'
  | 'APPROVED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'APPLIED'
  | 'CANCELLED'
  | 'EXECUTION_FAILED'
  | 'REINSTATEMENT_PENDING'
  | 'REINSTATEMENT_APPROVED'
  | 'REINSTATEMENT_REJECTED'
  | 'REINSTATEMENT_WITHDRAWN'
  | 'UNKNOWN';


export interface AwardSuspensionListItem {
  awardId: string;
  awardNumber: string | null;
  claimantName: string;
  ssnMasked: string;
  benefitCode: string | null;
  awardType: string | null;
  awardStatus: string;
  baseAmount: number | null;
  currency: string | null;
  frequency: string | null;
  startDate: string;
  nextReviewDate: string | null;
  currentSuspensionStatus: string | null;
  openRequestStatus: SuspensionRequestStatus | null;
  openRequestId: string | null;
  requestedEffectiveDate: string | null;
}

export interface SuspensionRequestListItem {
  requestId: string;
  awardId: string;
  awardNumber: string | null;
  claimantName: string;
  benefitCode: string | null;
  requestedEffectiveDate: string;
  reasonCode: string | null;
  reasonText: string | null;
  proposedBy: string | null;
  /** Trusted maker identity used for maker-checker UI gating. */
  proposedByUserId: string | null;
  proposedAt: string;
  /** Raw canonical lifecycle status from the database (fail-closed UNKNOWN). */
  eventStatus: SuspensionEventStatus;
  /** Display-only status. Never use to decide command availability. */
  displayStatus: SuspensionRequestStatus;
  /** @deprecated Alias of `displayStatus`; kept for existing call sites. */
  status: SuspensionRequestStatus;
  /** Optimistic-concurrency token required by every lifecycle command. */
  rowVersion: number;
  /** SUSPENSION or REINSTATEMENT — never inferred from labels. */
  caseKind: 'SUSPENSION' | 'REINSTATEMENT';
  /** Server execution state of the case. */
  executionStatus: string | null;
  /** Actual open workflow task id — never inferred from array position. */
  currentTaskId: string | null;
  currentApprovalLevel: number | null;
  totalApprovalLevels: number | null;
  currentTaskCode: string | null;
  assignedRole: string | null;
  assignedWorkbasketId: string | null;
  assignedWorkbasketCode: string | null;
  assignedWorkbasketName: string | null;
  directTaskOwner: string | null;
  claimedBy: string | null;
  taskStatus: string | null;
  dueAt: string | null;
  slaBreached: boolean;
  policyId: string | null;
  ageDays: number;
  lastActionAt: string | null;
}

export interface SuspensionApprovalTask extends SuspensionRequestListItem {
  taskId: string;
  assignmentReason: 'DIRECT' | 'CLAIMED' | 'ROLE' | 'WORKBASKET' | 'DELEGATION';
}

export interface SuspensionTimelineItem {
  at: string;
  actor: string | null;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  correlationId: string | null;
}

export interface SuspensionApprovalRouteItem {
  level: number;
  /** Real workflow task id for this route row (null for planned levels). */
  taskId: string | null;
  taskCode: string | null;
  policyId: string | null;
  role: string | null;
  workbasketId: string | null;
  workbasketCode: string | null;
  taskStatus: string | null;
  outcome: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED' | 'PLANNED';
  completedBy: string | null;
  completedAt: string | null;
  isCurrent: boolean;
}

export interface SuspensionAuditEntry {
  id: string;
  at: string;
  actor: string | null;
  action: string | null;
  actionName: string | null;
  beforeValue: unknown;
  afterValue: unknown;
  permissionAction: string | null;
  workflowInstanceId: string | null;
  workflowTaskId: string | null;
  policyId: string | null;
  approvalLevel: number | null;
  workbasketId: string | null;
  correlationId: string | null;
}

/**
 * BN-SUSP-EXEC — operational execution / reinstatement state for a case.
 * Read-only projection of the columns owned by the server commands.
 */
export interface SuspensionExecutionState {
  caseKind: 'SUSPENSION' | 'REINSTATEMENT';
  rowVersion: number;
  executionStatus:
    | 'NOT_DUE'
    | 'SCHEDULED'
    | 'EXECUTING'
    | 'EXECUTED'
    | 'FAILED'
    | 'NOT_APPLICABLE';
  executedAt: string | null;
  executedByUserId: string | null;
  executionAttempts: number;
  lastExecutionError: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** True when the effective date has been reached. */
  due: boolean;
  reinstatementOfId: string | null;
  arrearsSnapshot: unknown | null;
}

export interface LinkedReinstatementCase {
  reinstatementId: string;
  status: string;
  rowVersion: number;
  effectiveFrom: string | null;
  proposedByUserId: string | null;
  proposedAt: string;
  reasonCode: string | null;
  narrative: string | null;
  executionStatus: string;
  arrearsSnapshot: unknown | null;
}

export interface SuspensionRequestDetails {
  request: SuspensionRequestListItem & {
    narrative: string | null;
    correlationId: string | null;
  };
  award: AwardSuspensionListItem;
  timeline: SuspensionTimelineItem[];
  approvalRoute: SuspensionApprovalRouteItem[];
  audit: SuspensionAuditEntry[];
  execution: SuspensionExecutionState;
  reinstatement: LinkedReinstatementCase | null;
  /** Section-level warnings so the UI can surface partial failures honestly. */
  warnings: string[];
}

export interface SuspensionSummaryCounts {
  activeAwards: number;
  openRequests: number;
  pendingMyApproval: number;
  approvedNotYetApplied: number;
  currentlySuspended: number;
  rejectedOrWithdrawn: number;
}

export interface SuspensionReasonOption {
  code: string;
  label: string;
  requiresNarrative: boolean;
}

export interface AwardSuspensionRolloutState {
  moduleEnabled: boolean;
  actionsEnabled: boolean;
  showInMenu: boolean;
  rolloutState: string | null;
  /** UI feature flag `bn.servicing.awardSuspension` (defaults false). */
  frontendFeatureEnabled: boolean;
  /**
   * Combined effective flag — all three gates must be on for mutation UI:
   * DB module enabled + DB actions enabled + frontend feature enabled.
   */
  effectiveActionsEnabled: boolean;
  loadError: string | null;
}

// ─────────────────────────── Helpers ───────────────────────────
const maskSsn = (ssn: string | null | undefined): string => {
  if (!ssn) return '—';
  const s = String(ssn);
  if (s.length <= 4) return `••••${s}`;
  return `•••-••-${s.slice(-4)}`;
};

const daysBetween = (fromIso: string, toIso: string = new Date().toISOString()): number => {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
};

/**
 * BN-SUSP-STATUS — Normalise raw event.status to its canonical form.
 * Unrecognised values fail closed to `UNKNOWN` (they are NEVER coerced to
 * PROPOSED, which previously made unknown rows look actionable).
 */
export const normaliseEventStatus = (raw: unknown): SuspensionEventStatus => {
  const s = String(raw ?? '').toUpperCase();
  return (SUSPENSION_EVENT_STATUSES as readonly string[]).includes(s)
    ? (s as SuspensionEventStatus)
    : 'UNKNOWN';
};

/**
 * BN-SUSP-STATUS — Combine canonical event.status with the *current* workflow
 * task to produce a display-only status. Execution failure and unknown states
 * are surfaced explicitly rather than being flattened into PROPOSED.
 */
export function resolveDisplayStatus(
  eventStatus: SuspensionEventStatus,
  currentTask: { task_status?: string | null; metadata?: unknown } | null | undefined,
): SuspensionRequestStatus {
  const pending = (): SuspensionRequestStatus => {
    const level = numMetaField(currentTask?.metadata, 'approval_level');
    if (level === 1) return 'PENDING_LEVEL_1';
    if (level === 2) return 'PENDING_LEVEL_2';
    if (level != null && level > 2) return 'PENDING_LEVEL_N';
    return 'PENDING_APPROVAL';
  };
  const taskOpen = !!currentTask && isOpenTaskStatus(currentTask.task_status);

  switch (eventStatus) {
    case 'APPROVED':
      return 'APPROVED';
    case 'REJECTED':
      return 'REJECTED';
    case 'WITHDRAWN':
      return 'WITHDRAWN';
    case 'ACTIVE':
    case 'RESUMED':
      return 'APPLIED';
    case 'EXECUTION_FAILED':
      return 'EXECUTION_FAILED';
    case 'REINSTATEMENT_PROPOSED':
      return taskOpen ? pending() : 'REINSTATEMENT_PENDING';
    case 'REINSTATEMENT_APPROVED':
      return 'REINSTATEMENT_APPROVED';
    case 'REINSTATEMENT_REJECTED':
      return 'REINSTATEMENT_REJECTED';
    case 'REINSTATEMENT_WITHDRAWN':
      return 'REINSTATEMENT_WITHDRAWN';
    case 'PROPOSED':
      return taskOpen ? pending() : 'PROPOSED';
    case 'UNKNOWN':
    default:
      return 'UNKNOWN';
  }
}


const metaField = (meta: unknown, key: string): string | null => {
  if (!meta || typeof meta !== 'object') return null;
  const v = (meta as Record<string, unknown>)[key];
  return v == null ? null : String(v);
};

const numMetaField = (meta: unknown, key: string): number | null => {
  const v = metaField(meta, key);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function isOpenTaskStatus(s: string | null | undefined): boolean {
  return !!s && !['COMPLETED', 'CANCELLED', 'SKIPPED', 'REJECTED', 'APPROVED'].includes(String(s).toUpperCase());
}

/**
 * Legacy adapter — combine event row + optional current task into a
 * display status. Retained so all existing call sites keep working while
 * they migrate to `resolveDisplayStatus` directly.
 */
function deriveRequestStatus(
  row: any,
  currentTask?: { task_status?: string | null; metadata?: unknown } | null,
): SuspensionRequestStatus {
  return resolveDisplayStatus(normaliseEventStatus(row?.status), currentTask ?? null);
}

// ─────────────────────────── Rollout ───────────────────────────
export async function getAwardSuspensionRolloutState(): Promise<AwardSuspensionRolloutState> {
  let frontendFeatureEnabled = false;
  try {
    frontendFeatureEnabled = isFeatureEnabled('bn.servicing.awardSuspension');
  } catch {
    frontendFeatureEnabled = false;
  }
  try {
    const { data, error } = await db
      .from('app_modules')
      .select('is_enabled, actions_enabled, show_in_menu, rollout_state')
      .eq('name', 'bn_award_suspension')
      .maybeSingle();
    if (error) throw error;
    const moduleEnabled = Boolean(data?.is_enabled);
    const actionsEnabled = Boolean(data?.actions_enabled);
    const showInMenu = Boolean(data?.show_in_menu);
    return {
      moduleEnabled,
      actionsEnabled,
      showInMenu,
      rolloutState: data?.rollout_state ?? null,
      frontendFeatureEnabled,
      effectiveActionsEnabled: moduleEnabled && actionsEnabled && frontendFeatureEnabled,
      loadError: null,
    };
  } catch (e: any) {
    return {
      moduleEnabled: false,
      actionsEnabled: false,
      showInMenu: false,
      rolloutState: null,
      frontendFeatureEnabled,
      effectiveActionsEnabled: false,
      loadError: e?.message ?? 'Could not load rollout state',
    };
  }
}

// ─────────────────────────── Reasons ───────────────────────────
/** Active reason codes whose `applicable_actions` include the given action. */
export async function listReasonCodesForAction(action: string): Promise<SuspensionReasonOption[]> {
  const { data, error } = await db
    .from('bn_reason_code')
    .select('reason_code, reason_label, applicable_actions, is_active, requires_narrative')
    .eq('is_active', true);
  if (error) throw error;
  return (data ?? [])
    .filter((r: any) => Array.isArray(r.applicable_actions) && r.applicable_actions.includes(action))
    .map((r: any) => ({
      code: r.reason_code,
      label: r.reason_label ?? r.reason_code,
      requiresNarrative: Boolean(r.requires_narrative),
    }));
}

export const listSuspensionReasonCodes = (): Promise<SuspensionReasonOption[]> =>
  listReasonCodesForAction('SUSPEND');

/** Reason codes valid on a suspension rejection decision. */
export const listSuspensionRejectionReasonCodes = (): Promise<SuspensionReasonOption[]> =>
  listReasonCodesForAction('SUSPEND_REJECT');

// ─────────────────────────── Awards register ───────────────────────────
export async function listAwardsForSuspension(): Promise<AwardSuspensionListItem[]> {
  const { data: awards, error: aErr } = await db
    .from('bn_award')
    .select(
      'id, award_number, ssn, benefit_code, award_type, status, base_amount, currency, frequency, start_date, next_review_date'
    )
    .order('start_date', { ascending: false });
  if (aErr) throw aErr;

  const ssns: string[] = Array.from(new Set((awards ?? []).map((a: any) => a.ssn).filter(Boolean)));
  const ipMap: Record<string, string> = {};
  if (ssns.length) {
    const { data: ip, error: ipErr } = await db
      .from('ip_master')
      .select('ssn, firstname, middle_name, surname')
      .in('ssn', ssns);
    if (ipErr) throw ipErr;
    (ip ?? []).forEach((r: any) => {
      ipMap[r.ssn] = [r.firstname, r.middle_name, r.surname].filter(Boolean).join(' ').trim() || r.ssn;
    });
  }

  const awardIds: string[] = (awards ?? []).map((a: any) => a.id);
  const openEvents: Record<string, any> = {};
  if (awardIds.length) {
    const { data: events, error: evErr } = await db
      .from('bn_award_suspension_event')
      .select('id, bn_award_id, status, suspended_from, entered_at, workflow_instance_id')
      .in('bn_award_id', awardIds)
      .order('entered_at', { ascending: false });
    if (evErr) throw evErr;
    (events ?? []).forEach((e: any) => {
      if (!openEvents[e.bn_award_id]) openEvents[e.bn_award_id] = e;
    });
  }

  // BN-UI-S1.2A — enrich each latest event with its current workflow task so
  // the Awards tab resolves the same display status as the Requests tab.
  const instanceIds: string[] = Array.from(
    new Set(
      Object.values(openEvents)
        .map((e: any) => e?.workflow_instance_id)
        .filter((v: any): v is string => typeof v === 'string' && v.length > 0),
    ),
  );
  const tasksByInstance: Record<string, WorkflowTaskRow[]> = {};
  if (instanceIds.length) {
    try {
      const tasks = await fetchTasksForInstances(instanceIds);
      for (const t of tasks) {
        (tasksByInstance[t.workflow_instance_id] ??= []).push(t);
      }
    } catch {
      // Non-fatal: fall back to event-only status derivation.
    }
  }

  return (awards ?? []).map((a: any): AwardSuspensionListItem => {
    const evt = openEvents[a.id];
    const instanceTasks = evt?.workflow_instance_id
      ? tasksByInstance[evt.workflow_instance_id] ?? []
      : [];
    const currentTask = pickCurrentTask(instanceTasks);
    const evtStatus = evt ? deriveRequestStatus(evt, currentTask) : null;
    const isOpen = evt && !['APPLIED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'].includes(evtStatus ?? '');
    return {
      awardId: a.id,
      awardNumber: a.award_number ?? null,
      claimantName: ipMap[a.ssn] ?? a.ssn ?? '—',
      ssnMasked: maskSsn(a.ssn),
      benefitCode: a.benefit_code ?? null,
      awardType: a.award_type ?? null,
      awardStatus: a.status,
      baseAmount: a.base_amount ?? null,
      currency: a.currency ?? null,
      frequency: a.frequency ?? null,
      startDate: a.start_date,
      nextReviewDate: a.next_review_date ?? null,
      currentSuspensionStatus: a.status === 'SUSPENDED' ? 'SUSPENDED' : null,
      openRequestStatus: isOpen ? evtStatus : null,
      openRequestId: isOpen ? evt.id : null,
      requestedEffectiveDate: isOpen ? evt.suspended_from : null,
    };
  });
}

// ─────────────────────────── Workflow enrichment ───────────────────────────
interface WorkflowTaskRow {
  id: string;
  workflow_instance_id: string;
  task_code: string | null;
  step_code: string | null;
  assigned_to_user_id: string | null;
  assigned_to_role_key: string | null;
  assigned_to_permission_key: string | null;
  task_status: string | null;
  due_at: string | null;
  claimed_by: string | null;
  completed_by: string | null;
  completed_at: string | null;
  outcome: string | null;
  metadata: unknown;
  is_active: boolean | null;
  created_at: string;
}

interface WorkbasketRow {
  id: string;
  basket_code: string | null;
  basket_name: string | null;
}

async function fetchSuspensionInstances(): Promise<
  { id: string; entity_id: string | null; status: string | null; metadata: unknown }[]
> {
  const { data, error } = await db
    .from('core_workflow_instance')
    .select('id, entity_id, entity_type, module_code, workflow_code, status, metadata')
    .or(
      [
        `workflow_code.eq.${SUSPENSION_WORKFLOW.workflow_code}`,
        `and(module_code.eq.${SUSPENSION_WORKFLOW.module_code},entity_type.eq.${SUSPENSION_WORKFLOW.entity_type})`,
      ].join(',')
    );
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    entity_id: r.entity_id ?? null,
    status: r.status ?? null,
    metadata: r.metadata ?? null,
  }));
}

async function fetchTasksForInstances(instanceIds: string[]): Promise<WorkflowTaskRow[]> {
  if (!instanceIds.length) return [];
  const { data, error } = await db
    .from('core_workflow_task')
    .select(
      'id, workflow_instance_id, task_code, step_code, assigned_to_user_id, assigned_to_role_key, assigned_to_permission_key, task_status, due_at, claimed_by, completed_by, completed_at, outcome, metadata, is_active, created_at'
    )
    .in('workflow_instance_id', instanceIds);
  if (error) throw error;
  return (data ?? []) as WorkflowTaskRow[];
}

async function fetchWorkbaskets(ids: string[]): Promise<Record<string, WorkbasketRow>> {
  const map: Record<string, WorkbasketRow> = {};
  if (!ids.length) return map;
  const { data, error } = await db
    .from('bn_workbasket')
    .select('id, basket_code, basket_name')
    .in('id', ids);
  if (error) throw error;
  (data ?? []).forEach((r: any) => (map[r.id] = r));
  return map;
}

/** Pick the "current" task for an instance: prefer open, else most recent. */
function pickCurrentTask(tasks: WorkflowTaskRow[]): WorkflowTaskRow | null {
  if (!tasks.length) return null;
  const open = tasks.filter((t) => isOpenTaskStatus(t.task_status) && t.is_active !== false);
  const pool = open.length ? open : tasks;
  return pool
    .slice()
    .sort((a, b) => {
      const la = numMetaField(a.metadata, 'approval_level') ?? 0;
      const lb = numMetaField(b.metadata, 'approval_level') ?? 0;
      if (la !== lb) return la - lb;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    })
    [0] ?? null;
}

/** Derive total approval levels from tasks + applicable policy rows. */
function deriveTotalLevels(tasks: WorkflowTaskRow[], policyLevels: number[]): number | null {
  const taskLevels = tasks
    .map((t) => numMetaField(t.metadata, 'approval_level'))
    .filter((n): n is number => n != null);
  const all = [...taskLevels, ...policyLevels];
  return all.length ? Math.max(...all) : null;
}

/**
 * BN-UI-S1.2 — Resolve product_version_id for a set of awards through the
 * canonical relationship: `bn_award.bn_claim_id → bn_claim.product_version_id`.
 * Returns a map keyed by award id. Awards without a linked claim or product
 * version are omitted.
 */
async function fetchAwardProductVersions(
  awardIds: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!awardIds.length) return out;
  const { data: awards } = await db
    .from('bn_award')
    .select('id, bn_claim_id')
    .in('id', awardIds);
  const claimByAward: Record<string, string> = {};
  const claimIds: string[] = [];
  for (const a of awards ?? []) {
    if (a?.bn_claim_id) {
      claimByAward[a.id] = a.bn_claim_id;
      claimIds.push(a.bn_claim_id);
    }
  }
  if (!claimIds.length) return out;
  const { data: claims } = await db
    .from('bn_claim')
    .select('id, product_version_id')
    .in('id', claimIds);
  const pvByClaim: Record<string, string> = {};
  for (const c of claims ?? []) {
    if (c?.product_version_id) pvByClaim[c.id] = c.product_version_id;
  }
  for (const [awardId, claimId] of Object.entries(claimByAward)) {
    const pv = pvByClaim[claimId];
    if (pv) out[awardId] = pv;
  }
  return out;
}

interface ApplicablePolicyRow {
  id: string;
  level: number | null;
  product_version_id: string;
}

/**
 * BN-UI-S1.2 — Load Award-Suspend approval-policy rows scoped to the given
 * product versions. Never uses `.or()` and never invents policy_area
 * values. When `productVersionIds` is empty, returns `[]` and callers must
 * fall back to task-derived levels only.
 */
async function fetchApplicablePolicies(
  productVersionIds: string[],
): Promise<ApplicablePolicyRow[]> {
  const uniq = Array.from(new Set(productVersionIds.filter(Boolean)));
  if (!uniq.length) return [];
  const { data, error } = await db
    .from('bn_approval_policy')
    .select('id, level, product_version_id, action_code, policy_area, is_enabled')
    .eq('policy_area', 'AWARD')
    .eq('action_code', 'SUSPEND')
    .eq('is_enabled', true)
    .in('product_version_id', uniq);
  if (error) return [];
  return (data ?? []).map((r: any) => ({
    id: r.id,
    level: r.level ?? null,
    product_version_id: r.product_version_id,
  }));
}

// ─────────────────────────── Requests register ───────────────────────────
export async function listSuspensionRequests(): Promise<SuspensionRequestListItem[]> {
  const { data: events, error } = await db
    .from('bn_award_suspension_event')
    .select(
      'id, bn_award_id, status, suspended_from, reason_code, reason_text, proposed_by_user_id, entered_at, entered_by, workflow_instance_id, modified_at, correlation_id, row_version, case_kind, execution_status'
    )
    .order('entered_at', { ascending: false });
  if (error) throw error;

  const awardIds: string[] = Array.from(new Set((events ?? []).map((e: any) => e.bn_award_id).filter(Boolean)));
  const awardMap: Record<string, any> = {};
  if (awardIds.length) {
    const { data: awards, error: aErr } = await db
      .from('bn_award')
      .select('id, award_number, ssn, benefit_code')
      .in('id', awardIds);
    if (aErr) throw aErr;
    (awards ?? []).forEach((a: any) => (awardMap[a.id] = a));
  }
  const ssns: string[] = Array.from(new Set(Object.values(awardMap).map((a: any) => a.ssn).filter(Boolean)));
  const ipMap: Record<string, string> = {};
  if (ssns.length) {
    const { data: ip, error: ipErr } = await db
      .from('ip_master')
      .select('ssn, firstname, middle_name, surname')
      .in('ssn', ssns);
    if (ipErr) throw ipErr;
    (ip ?? []).forEach((r: any) => {
      ipMap[r.ssn] = [r.firstname, r.middle_name, r.surname].filter(Boolean).join(' ').trim() || r.ssn;
    });
  }

  const instanceIds: string[] = Array.from(
    new Set((events ?? []).map((e: any) => e.workflow_instance_id).filter(Boolean))
  );
  const tasksByInstance: Record<string, WorkflowTaskRow[]> = {};
  const tasks = await fetchTasksForInstances(instanceIds).catch(() => []);
  tasks.forEach((t) => {
    (tasksByInstance[t.workflow_instance_id] ??= []).push(t);
  });
  const workbasketIds = Array.from(
    new Set(
      tasks
        .map((t) => metaField(t.metadata, 'workbasket_id'))
        .filter((v): v is string => !!v)
    )
  );
  const wbMap = await fetchWorkbaskets(workbasketIds).catch(() => ({} as Record<string, WorkbasketRow>));
  const productVersionByAward = await fetchAwardProductVersions(awardIds).catch(
    () => ({} as Record<string, string>),
  );
  const distinctPvs = Array.from(new Set(Object.values(productVersionByAward)));
  const policies = await fetchApplicablePolicies(distinctPvs);
  const policiesByPv: Record<string, ApplicablePolicyRow[]> = {};
  for (const p of policies) {
    (policiesByPv[p.product_version_id] ??= []).push(p);
  }

  return (events ?? []).map((e: any): SuspensionRequestListItem => {
    const award = awardMap[e.bn_award_id] ?? {};
    const instanceTasks = tasksByInstance[e.workflow_instance_id ?? ''] ?? [];
    const cur = pickCurrentTask(instanceTasks);
    const wbId = cur ? metaField(cur.metadata, 'workbasket_id') : null;
    const wb = wbId ? wbMap[wbId] : null;
    const approvalLevel = cur ? numMetaField(cur.metadata, 'approval_level') : null;
    const pv = productVersionByAward[e.bn_award_id];
    const pvPolicies = pv ? policiesByPv[pv] ?? [] : [];
    const pvPolicyLevels = pvPolicies.map((p) => p.level ?? 0).filter((n) => n > 0);
    const totalLevels = deriveTotalLevels(instanceTasks, pvPolicyLevels);
    const due = cur?.due_at ?? null;
    const eventStatus = normaliseEventStatus(e.status);
    const status = resolveDisplayStatus(eventStatus, cur);
    return {
      requestId: e.id,
      awardId: e.bn_award_id,
      awardNumber: award.award_number ?? null,
      claimantName: award.ssn ? ipMap[award.ssn] ?? award.ssn : '—',
      benefitCode: award.benefit_code ?? null,
      requestedEffectiveDate: e.suspended_from,
      reasonCode: e.reason_code ?? null,
      reasonText: e.reason_text ?? null,
      proposedBy: e.proposed_by_user_id ?? e.entered_by ?? null,
      proposedByUserId: e.proposed_by_user_id ?? null,
      proposedAt: e.entered_at,
      eventStatus,
      displayStatus: status,
      status,
      rowVersion: e.row_version ?? 1,
      caseKind: (e.case_kind ?? 'SUSPENSION') as 'SUSPENSION' | 'REINSTATEMENT',
      executionStatus: e.execution_status ?? null,
      currentTaskId: cur?.id ?? null,
      currentApprovalLevel: approvalLevel,
      totalApprovalLevels: totalLevels,
      currentTaskCode: cur?.task_code ?? null,
      assignedRole: cur?.assigned_to_role_key ?? null,
      assignedWorkbasketId: wbId,
      assignedWorkbasketCode: wb?.basket_code ?? null,
      assignedWorkbasketName: wb?.basket_name ?? null,
      directTaskOwner: cur?.assigned_to_user_id ?? null,
      claimedBy: cur?.claimed_by ?? null,
      taskStatus: cur?.task_status ?? null,
      dueAt: due,
      slaBreached: due ? new Date(due).getTime() < Date.now() : false,
      policyId: cur ? metaField(cur.metadata, 'policy_id') : null,
      ageDays: daysBetween(e.entered_at),
      lastActionAt: e.modified_at ?? e.entered_at,
    };
  });
}

// ─────────────────────────── My Approvals ───────────────────────────
export async function listMyApprovalTasks(userId: string | null): Promise<SuspensionApprovalTask[]> {
  if (!userId) return [];

  // 1. Effective roles for this user
  const { data: rolesData, error: rolesErr } = await db
    .from('v_bn_user_effective_roles')
    .select('role_name')
    .eq('user_id', userId);
  if (rolesErr) throw rolesErr;
  const effectiveRoles = Array.from(
    new Set((rolesData ?? []).map((r: any) => r.role_name).filter(Boolean))
  ) as string[];

  // 2. Workbaskets from platform helper (allow-listed read RPC)
  let userWorkbasketIds: string[] = [];
  try {
    const { data: wbs } = await db.rpc('bn_workbaskets_for_user', { p_user_id: userId });
    userWorkbasketIds = Array.from(
      new Set((wbs ?? []).map((r: any) => r.workbasket_id).filter(Boolean))
    );
  } catch {
    userWorkbasketIds = [];
  }

  // 3. Active delegations to this user
  const nowIso = new Date().toISOString();
  const { data: delegations } = await db
    .from('bn_role_delegation')
    .select('id, role_name, workbasket_id, valid_from, valid_to, status')
    .eq('to_user_id', userId)
    .eq('status', 'APPROVED')
    .lte('valid_from', nowIso);
  const activeDelegations = (delegations ?? []).filter(
    (d: any) => !d.valid_to || new Date(d.valid_to).getTime() > Date.now()
  );
  const delegatedRoles = new Set(activeDelegations.map((d: any) => d.role_name).filter(Boolean));
  const delegatedWorkbaskets = new Set(
    activeDelegations.map((d: any) => d.workbasket_id).filter(Boolean)
  );

  // 4. Restrict to BN_AWARD_SUSPENSION workflow instances only
  const instances = await fetchSuspensionInstances();
  const instanceIds = instances.map((i) => i.id);
  if (!instanceIds.length) return [];

  const tasks = await fetchTasksForInstances(instanceIds);
  const openTasks = tasks.filter(
    (t) => isOpenTaskStatus(t.task_status) && t.is_active !== false
  );

  /**
   * BN-UI-S1.2 — Tightened matching:
   *  - direct/claimed short-circuit
   *  - when a task carries both a role and a workbasket, the user must
   *    satisfy BOTH dimensions
   *  - delegation must satisfy the same dimensions the task requires
   *  - role-only or workbasket-only tasks check just that dimension
   */
  const matchedTasks: { task: WorkflowTaskRow; reason: SuspensionApprovalTask['assignmentReason'] }[] =
    [];
  for (const t of openTasks) {
    if (t.assigned_to_user_id === userId) {
      matchedTasks.push({ task: t, reason: 'DIRECT' });
      continue;
    }
    if (t.claimed_by === userId) {
      matchedTasks.push({ task: t, reason: 'CLAIMED' });
      continue;
    }
    const role = t.assigned_to_role_key;
    const wbId = metaField(t.metadata, 'workbasket_id');
    if (!role && !wbId) continue; // Unassigned/no dimensions — cannot claim.

    const roleOk = role ? effectiveRoles.includes(role) : true;
    const wbOk = wbId ? userWorkbasketIds.includes(wbId) : true;

    if (role && wbId) {
      if (roleOk && wbOk) {
        matchedTasks.push({ task: t, reason: 'ROLE' });
        continue;
      }
    } else if (role) {
      if (roleOk) {
        matchedTasks.push({ task: t, reason: 'ROLE' });
        continue;
      }
    } else if (wbId) {
      if (wbOk) {
        matchedTasks.push({ task: t, reason: 'WORKBASKET' });
        continue;
      }
    }

    // Delegation must satisfy the *same* dimensions the task requires.
    const delRoleOk = role ? delegatedRoles.has(role) : true;
    const delWbOk = wbId ? delegatedWorkbaskets.has(wbId) : true;
    if (role && wbId) {
      if (delRoleOk && delWbOk) matchedTasks.push({ task: t, reason: 'DELEGATION' });
    } else if (role) {
      if (delRoleOk) matchedTasks.push({ task: t, reason: 'DELEGATION' });
    } else if (wbId) {
      if (delWbOk) matchedTasks.push({ task: t, reason: 'DELEGATION' });
    }
  }

  if (!matchedTasks.length) return [];

  const matchedInstanceIds = Array.from(new Set(matchedTasks.map((m) => m.task.workflow_instance_id)));
  const { data: eventsData, error: evErr } = await db
    .from('bn_award_suspension_event')
    .select(
      'id, bn_award_id, status, suspended_from, reason_code, reason_text, proposed_by_user_id, entered_at, entered_by, workflow_instance_id, modified_at, correlation_id, row_version, case_kind, execution_status'
    )
    .in('workflow_instance_id', matchedInstanceIds);
  if (evErr) throw evErr;
  const eventByInstance: Record<string, any> = {};
  (eventsData ?? []).forEach((e: any) => (eventByInstance[e.workflow_instance_id] = e));

  const awardIds = Array.from(
    new Set((eventsData ?? []).map((e: any) => e.bn_award_id).filter(Boolean))
  );
  const awardMap: Record<string, any> = {};
  if (awardIds.length) {
    const { data: awards } = await db
      .from('bn_award')
      .select('id, award_number, ssn, benefit_code')
      .in('id', awardIds);
    (awards ?? []).forEach((a: any) => (awardMap[a.id] = a));
  }
  const ssns = Array.from(
    new Set(Object.values(awardMap).map((a: any) => a.ssn).filter(Boolean))
  );
  const ipMap: Record<string, string> = {};
  if (ssns.length) {
    const { data: ip } = await db
      .from('ip_master')
      .select('ssn, firstname, middle_name, surname')
      .in('ssn', ssns);
    (ip ?? []).forEach((r: any) => {
      ipMap[r.ssn] = [r.firstname, r.middle_name, r.surname].filter(Boolean).join(' ').trim() || r.ssn;
    });
  }

  const wbIds = Array.from(
    new Set(
      matchedTasks
        .map((m) => metaField(m.task.metadata, 'workbasket_id'))
        .filter((v): v is string => !!v)
    )
  );
  const wbMap = await fetchWorkbaskets(wbIds).catch(() => ({} as Record<string, WorkbasketRow>));
  const productVersionByAward = await fetchAwardProductVersions(awardIds as string[]).catch(
    () => ({} as Record<string, string>),
  );
  const distinctPvs = Array.from(new Set(Object.values(productVersionByAward)));
  const policies = await fetchApplicablePolicies(distinctPvs);
  const policiesByPv: Record<string, ApplicablePolicyRow[]> = {};
  for (const p of policies) {
    (policiesByPv[p.product_version_id] ??= []).push(p);
  }

  return matchedTasks
    .map(({ task, reason }): SuspensionApprovalTask | null => {
      const e = eventByInstance[task.workflow_instance_id];
      if (!e) return null;
      const award = awardMap[e.bn_award_id] ?? {};
      const wbId = metaField(task.metadata, 'workbasket_id');
      const wb = wbId ? wbMap[wbId] : null;
      const dueAt = task.due_at ?? null;
      const pv = productVersionByAward[e.bn_award_id];
      const pvPolicyLevels = (pv ? policiesByPv[pv] ?? [] : [])
        .map((p) => p.level ?? 0)
        .filter((n) => n > 0);
      return {
        requestId: e.id,
        awardId: e.bn_award_id,
        awardNumber: award.award_number ?? null,
        claimantName: award.ssn ? ipMap[award.ssn] ?? award.ssn : '—',
        benefitCode: award.benefit_code ?? null,
        requestedEffectiveDate: e.suspended_from,
        reasonCode: e.reason_code ?? null,
        reasonText: e.reason_text ?? null,
        proposedBy: e.proposed_by_user_id ?? e.entered_by ?? null,
        proposedByUserId: e.proposed_by_user_id ?? null,
        proposedAt: e.entered_at,
        eventStatus: normaliseEventStatus(e.status),
        displayStatus: resolveDisplayStatus(normaliseEventStatus(e.status), task),
        status: resolveDisplayStatus(normaliseEventStatus(e.status), task),
        rowVersion: e.row_version ?? 1,
        caseKind: (e.case_kind ?? 'SUSPENSION') as 'SUSPENSION' | 'REINSTATEMENT',
        executionStatus: e.execution_status ?? null,
        currentTaskId: task.id,
        currentApprovalLevel: numMetaField(task.metadata, 'approval_level'),
        totalApprovalLevels: deriveTotalLevels([task], pvPolicyLevels),
        currentTaskCode: task.task_code ?? null,
        assignedRole: task.assigned_to_role_key ?? null,
        assignedWorkbasketId: wbId,
        assignedWorkbasketCode: wb?.basket_code ?? null,
        assignedWorkbasketName: wb?.basket_name ?? null,
        directTaskOwner: task.assigned_to_user_id ?? null,
        claimedBy: task.claimed_by ?? null,
        taskStatus: task.task_status ?? null,
        dueAt,
        slaBreached: dueAt ? new Date(dueAt).getTime() < Date.now() : false,
        policyId: metaField(task.metadata, 'policy_id'),
        ageDays: daysBetween(e.entered_at),
        lastActionAt: e.modified_at ?? e.entered_at,
        taskId: task.id,
        assignmentReason: reason,
      };
    })
    .filter((v): v is SuspensionApprovalTask => v !== null);
}

// ─────────────────────────── Request details ───────────────────────────
export interface SuspensionRequestDetailsOptions {
  /**
   * BN-UI-S1.2 — When false (default), the details service does NOT query
   * `core_audit_log`. Callers must pass `true` only when the current user
   * holds `bn_award_suspension.audit`.
   */
  includeAudit?: boolean;
}

export async function getSuspensionRequestDetails(
  requestId: string,
  options: SuspensionRequestDetailsOptions = {},
): Promise<SuspensionRequestDetails | null> {
  const includeAudit = options.includeAudit === true;
  const warnings: string[] = [];

  const { data: e, error: eErr } = await db
    .from('bn_award_suspension_event')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();
  if (eErr) throw eErr;
  if (!e) return null;

  const { data: award } = await db
    .from('bn_award')
    .select('*')
    .eq('id', e.bn_award_id)
    .maybeSingle();

  let claimantName = award?.ssn ?? '—';
  if (award?.ssn) {
    const { data: ip } = await db
      .from('ip_master')
      .select('firstname, middle_name, surname')
      .eq('ssn', award.ssn)
      .maybeSingle();
    if (ip) {
      claimantName =
        [ip.firstname, ip.middle_name, ip.surname].filter(Boolean).join(' ').trim() || claimantName;
    }
  }

  // Tasks + workbaskets + action log
  let tasks: WorkflowTaskRow[] = [];
  let actionLog: any[] = [];
  let wbMap: Record<string, WorkbasketRow> = {};
  if (e.workflow_instance_id) {
    try {
      tasks = await fetchTasksForInstances([e.workflow_instance_id]);
    } catch {
      warnings.push('Workflow tasks could not be loaded.');
    }
    try {
      const { data: log, error: lErr } = await db
        .from('core_workflow_action_log')
        .select(
          'id, action_type, action_name, actor_user_id, actor_name, before_status, after_status, reason, comments, action_at, metadata, workflow_task_id'
        )
        .eq('workflow_instance_id', e.workflow_instance_id)
        .order('action_at', { ascending: true });
      if (lErr) throw lErr;
      actionLog = log ?? [];
    } catch {
      warnings.push('Workflow action log could not be loaded.');
    }
    const wbIds = Array.from(
      new Set(
        tasks.map((t) => metaField(t.metadata, 'workbasket_id')).filter((v): v is string => !!v)
      )
    );
    try {
      wbMap = await fetchWorkbaskets(wbIds);
    } catch {
      warnings.push('Workbaskets could not be loaded.');
    }
  } else {
    warnings.push('This request has no linked workflow instance.');
  }

  const pvMap = award ? await fetchAwardProductVersions([award.id]).catch(() => ({})) : {};
  const productVersionId = pvMap[award?.id ?? ''] ?? null;
  const policies = productVersionId
    ? await fetchApplicablePolicies([productVersionId])
    : [];
  if (!productVersionId) {
    warnings.push(
      'Planned approval levels could not be resolved: this award has no linked product version.',
    );
  }
  const policyLevels = policies.map((p) => p.level ?? 0).filter((n) => n > 0);
  const cur = pickCurrentTask(tasks);
  const currentTaskId = cur?.id;

  // Approval route from actual tasks (ordered by approval level then created_at)
  const approvalRoute: SuspensionApprovalRouteItem[] = tasks
    .slice()
    .sort((a, b) => {
      const la = numMetaField(a.metadata, 'approval_level') ?? 0;
      const lb = numMetaField(b.metadata, 'approval_level') ?? 0;
      if (la !== lb) return la - lb;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    })
    .map((t, idx) => {
      const wbId = metaField(t.metadata, 'workbasket_id');
      const wb = wbId ? wbMap[wbId] : null;
      const st = String(t.task_status ?? '').toUpperCase();
      const outcome: SuspensionApprovalRouteItem['outcome'] =
        st === 'APPROVED' || t.outcome === 'APPROVED'
          ? 'APPROVED'
          : st === 'REJECTED' || t.outcome === 'REJECTED'
            ? 'REJECTED'
            : st === 'SKIPPED'
              ? 'SKIPPED'
              : isOpenTaskStatus(t.task_status)
                ? 'PENDING'
                : 'PENDING';
      return {
        level: numMetaField(t.metadata, 'approval_level') ?? idx + 1,
        taskId: t.id,
        taskCode: t.task_code ?? null,
        policyId: metaField(t.metadata, 'policy_id'),
        role: t.assigned_to_role_key ?? null,
        workbasketId: wbId,
        workbasketCode: wb?.basket_code ?? null,
        taskStatus: t.task_status ?? null,
        outcome,
        completedBy: t.completed_by ?? null,
        completedAt: t.completed_at ?? null,
        isCurrent: t.id === currentTaskId,
      };
    });

  // Add planned levels from policy where no task exists yet
  const existingLevels = new Set(approvalRoute.map((r) => r.level));
  for (const p of policies) {
    if (p.level != null && !existingLevels.has(p.level)) {
      approvalRoute.push({
        level: p.level,
        taskId: null,
        taskCode: null,
        policyId: p.id,
        role: null,
        workbasketId: null,
        workbasketCode: null,
        taskStatus: null,
        outcome: 'PLANNED',
        completedBy: null,
        completedAt: null,
        isCurrent: false,
      });
    }
  }
  approvalRoute.sort((a, b) => a.level - b.level);

  // Timeline: proposal + mapped action log
  const timeline: SuspensionTimelineItem[] = [
    {
      at: e.entered_at,
      actor: e.proposed_by_user_id ?? e.entered_by ?? null,
      action: 'PROPOSED',
      fromStatus: null,
      toStatus: 'PROPOSED',
      note: e.reason_text ?? null,
      correlationId: e.correlation_id ?? null,
    },
    ...actionLog.map((r: any): SuspensionTimelineItem => ({
      at: r.action_at,
      actor: r.actor_name ?? r.actor_user_id ?? null,
      action: r.action_name ?? r.action_type ?? 'ACTION',
      fromStatus: r.before_status ?? null,
      toStatus: r.after_status ?? null,
      note: r.comments ?? r.reason ?? null,
      correlationId: metaField(r.metadata, 'correlation_id') ?? e.correlation_id ?? null,
    })),
  ];

  // BN-UI-S1.2 — Audit is only fetched with explicit permission.
  let audit: SuspensionAuditEntry[] = [];
  if (includeAudit) {
    try {
      let q = db
        .from('core_audit_log')
        .select(
          'id, event_time, action, event_name, actor_user_id, actor_name, before_value, after_value, metadata, correlation_id',
        )
        .order('event_time', { ascending: true });
      q = q.or(
        [
          `and(entity_type.eq.${SUSPENSION_WORKFLOW.entity_type},entity_id.eq.${e.id})`,
          e.correlation_id ? `correlation_id.eq.${e.correlation_id}` : null,
        ]
          .filter(Boolean)
          .join(','),
      );
      const { data: rows, error: aErr } = await q;
      if (aErr) throw aErr;
      audit = (rows ?? []).map((r: any): SuspensionAuditEntry => ({
        id: r.id,
        at: r.event_time,
        actor: r.actor_name ?? r.actor_user_id ?? null,
        action: r.action ?? null,
        actionName: r.event_name ?? null,
        beforeValue: r.before_value ?? null,
        afterValue: r.after_value ?? null,
        permissionAction: metaField(r.metadata, 'permission_action'),
        workflowInstanceId:
          metaField(r.metadata, 'workflow_instance_id') ?? e.workflow_instance_id ?? null,
        workflowTaskId: metaField(r.metadata, 'workflow_task_id'),
        policyId: metaField(r.metadata, 'policy_id'),
        approvalLevel: numMetaField(r.metadata, 'approval_level'),
        workbasketId: metaField(r.metadata, 'workbasket_id'),
        correlationId: r.correlation_id ?? null,
      }));
    } catch {
      warnings.push('Audit entries could not be loaded.');
    }
  }


  const wbId = cur ? metaField(cur.metadata, 'workbasket_id') : null;
  const wb = wbId ? wbMap[wbId] : null;
  const dueAt = cur?.due_at ?? null;

  const requestSummary: SuspensionRequestListItem & { narrative: string | null; correlationId: string | null } = {
    requestId: e.id,
    awardId: e.bn_award_id,
    awardNumber: award?.award_number ?? null,
    claimantName,
    benefitCode: award?.benefit_code ?? null,
    requestedEffectiveDate: e.suspended_from,
    reasonCode: e.reason_code ?? null,
    reasonText: e.reason_text ?? null,
    proposedBy: e.proposed_by_user_id ?? e.entered_by ?? null,
    proposedByUserId: e.proposed_by_user_id ?? null,
    proposedAt: e.entered_at,
    eventStatus: normaliseEventStatus((e as any).status),
    displayStatus: resolveDisplayStatus(normaliseEventStatus((e as any).status), cur),
    status: resolveDisplayStatus(normaliseEventStatus((e as any).status), cur),
    rowVersion: (e as any).row_version ?? 1,
    caseKind: ((e as any).case_kind ?? 'SUSPENSION') as 'SUSPENSION' | 'REINSTATEMENT',
    executionStatus: (e as any).execution_status ?? null,
    currentTaskId: cur?.id ?? null,
    currentApprovalLevel: cur ? numMetaField(cur.metadata, 'approval_level') : null,
    totalApprovalLevels: deriveTotalLevels(tasks, policyLevels),
    currentTaskCode: cur?.task_code ?? null,
    assignedRole: cur?.assigned_to_role_key ?? null,
    assignedWorkbasketId: wbId,
    assignedWorkbasketCode: wb?.basket_code ?? null,
    assignedWorkbasketName: wb?.basket_name ?? null,
    directTaskOwner: cur?.assigned_to_user_id ?? null,
    claimedBy: cur?.claimed_by ?? null,
    taskStatus: cur?.task_status ?? null,
    dueAt,
    slaBreached: dueAt ? new Date(dueAt).getTime() < Date.now() : false,
    policyId: cur ? metaField(cur.metadata, 'policy_id') : null,
    ageDays: daysBetween(e.entered_at),
    lastActionAt: e.modified_at ?? e.entered_at,
    narrative: e.reason_text ?? null,
    correlationId: e.correlation_id ?? null,
  };

  const ev = e as any;
  const today = new Date().toISOString().slice(0, 10);

  // Linked reinstatement case (if one has been proposed for this suspension).
  let reinstatement: LinkedReinstatementCase | null = null;
  if ((ev.case_kind ?? 'SUSPENSION') === 'SUSPENSION') {
    try {
      const { data: r } = await db
        .from('bn_award_suspension_event')
        .select('*')
        .eq('reinstatement_of_id', e.id)
        .order('entered_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (r) {
        const rr = r as any;
        reinstatement = {
          reinstatementId: rr.id,
          status: rr.status,
          rowVersion: rr.row_version ?? 1,
          effectiveFrom: rr.suspended_to ?? null,
          proposedByUserId: rr.proposed_by_user_id ?? null,
          proposedAt: rr.entered_at,
          reasonCode: rr.reason_code ?? null,
          narrative: rr.reason_text ?? null,
          executionStatus: rr.execution_status ?? 'NOT_APPLICABLE',
          arrearsSnapshot: rr.arrears_snapshot ?? null,
        };
      }
    } catch {
      warnings.push('Reinstatement case could not be loaded.');
    }
  }

  const execution: SuspensionExecutionState = {
    caseKind: (ev.case_kind ?? 'SUSPENSION') as 'SUSPENSION' | 'REINSTATEMENT',
    rowVersion: ev.row_version ?? 1,
    executionStatus: (ev.execution_status ?? 'NOT_DUE') as SuspensionExecutionState['executionStatus'],
    executedAt: ev.executed_at ?? null,
    executedByUserId: ev.executed_by_user_id ?? null,
    executionAttempts: ev.execution_attempts ?? 0,
    lastExecutionError: ev.last_execution_error ?? null,
    effectiveFrom: e.suspended_from ?? null,
    effectiveTo: ev.suspended_to ?? null,
    due: Boolean(e.suspended_from) && String(e.suspended_from) <= today,
    reinstatementOfId: ev.reinstatement_of_id ?? null,
    arrearsSnapshot: ev.arrears_snapshot ?? null,
  };

  return {
    request: requestSummary,
    award: {
      awardId: award?.id ?? e.bn_award_id,
      awardNumber: award?.award_number ?? null,
      claimantName,
      ssnMasked: maskSsn(award?.ssn),
      benefitCode: award?.benefit_code ?? null,
      awardType: award?.award_type ?? null,
      awardStatus: award?.status ?? 'UNKNOWN',
      baseAmount: award?.base_amount ?? null,
      currency: award?.currency ?? null,
      frequency: award?.frequency ?? null,
      startDate: award?.start_date ?? '',
      nextReviewDate: award?.next_review_date ?? null,
      currentSuspensionStatus: award?.status === 'SUSPENDED' ? 'SUSPENDED' : null,
      openRequestStatus: deriveRequestStatus(e, cur),
      openRequestId: e.id,
      requestedEffectiveDate: e.suspended_from,
    },
    timeline,
    approvalRoute,
    audit,
    execution,
    reinstatement,
    warnings,
  };
}

// ─────────────────────────── Summary counts ───────────────────────────
export async function getSuspensionSummaryCounts(
  userId: string | null
): Promise<SuspensionSummaryCounts> {
  const [awards, requests, myTasks] = await Promise.all([
    listAwardsForSuspension().catch(() => []),
    listSuspensionRequests().catch(() => []),
    listMyApprovalTasks(userId).catch(() => []),
  ]);
  const openStatuses: SuspensionRequestStatus[] = [
    'PROPOSED',
    'PENDING_APPROVAL',
    'PENDING_LEVEL_1',
    'PENDING_LEVEL_2',
    'PENDING_LEVEL_N',
  ];
  return {
    activeAwards: awards.filter((a) => a.awardStatus === 'ACTIVE').length,
    openRequests: requests.filter((r) => openStatuses.includes(r.status)).length,
    pendingMyApproval: myTasks.length,
    approvedNotYetApplied: requests.filter((r) => r.status === 'APPROVED').length,
    currentlySuspended: awards.filter((a) => a.awardStatus === 'SUSPENDED').length,
    rejectedOrWithdrawn: requests.filter(
      (r) => r.status === 'REJECTED' || r.status === 'WITHDRAWN' || r.status === 'CANCELLED'
    ).length,
  };
}
