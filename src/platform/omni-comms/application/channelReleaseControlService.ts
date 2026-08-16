/**
 * Omni-Comms C6 — typed adapter over the bounded Release Control RPCs.
 *
 * Boundaries (permanent):
 *   - Uses the bound Omni-Comms RPC client only; never the browser Supabase
 *     singleton and never a direct table query (both release tables deny
 *     direct authenticated access).
 *   - No provider SDK, no provider fetch, no sendCommunication, no runtime
 *     delivery writes. This module governs release state and nothing else.
 *   - Approval/activation is NOT available here: it is performed only by the
 *     trusted `omni-comms-release-control` Edge boundary, which reads the
 *     deployed revision server-side.
 */
import { callOmniCommsRpc, type OmniCommsRpcClient } from './omniCommsRpcErrors';
import type {
  ReleaseControlChannel,
  ChannelReleaseControl,
  ChannelReleaseControlSummary,
  ReleaseBasicState,
  UpsertReleaseConfigurationInput,
} from './channelReleaseControlTypes';

export interface GetReleaseControlSummaryInput {
  organizationId: string;
  departmentId?: string | null;
  /** Channels with a deployed delivery adapter. */
  channel: ReleaseControlChannel;
  historyLimit?: number;
}

export function getChannelReleaseControlSummary(
  client: OmniCommsRpcClient,
  input: GetReleaseControlSummaryInput,
): Promise<ChannelReleaseControlSummary> {
  return callOmniCommsRpc<ChannelReleaseControlSummary>(
    client,
    'omni_comms_channel_release_control_summary',
    {
      p_organization_id: input.organizationId,
      p_department_id: input.departmentId ?? null,
      p_channel: input.channel,
      p_history_limit: input.historyLimit ?? 25,
    },
  );
}

export function upsertChannelReleaseConfiguration(
  client: OmniCommsRpcClient,
  input: UpsertReleaseConfigurationInput,
): Promise<ChannelReleaseControl> {
  return callOmniCommsRpc<ChannelReleaseControl>(
    client,
    'omni_comms_channel_release_control_upsert_configuration',
    {
      p_id: input.id ?? null,
      p_expected_updated_at: input.expectedUpdatedAt ?? null,
      p_organization_id: input.organizationId,
      p_department_id: input.departmentId ?? null,
      p_channel: input.channel,
      p_permitted_event_codes: input.permittedEventCodes,
      p_permitted_caller_modules: input.permittedCallerModules,
      p_permitted_modes: input.permittedModes,
      p_recipient_input: input.recipientInput,
      p_max_recipients_per_request: input.maxRecipientsPerRequest,
      p_max_messages_per_hour: input.maxMessagesPerHour,
      p_max_messages_per_day: input.maxMessagesPerDay,
      p_max_messages_total: input.maxMessagesTotal,
      p_release_starts_at: input.releaseStartsAt ?? null,
      p_release_expires_at: input.releaseExpiresAt ?? null,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

export function setChannelReleaseBasicState(
  client: OmniCommsRpcClient,
  input: {
    id: string;
    expectedUpdatedAt: string;
    targetState: ReleaseBasicState;
    reason?: string | null;
    correlationId?: string | null;
  },
): Promise<ChannelReleaseControl> {
  return callOmniCommsRpc<ChannelReleaseControl>(
    client,
    'omni_comms_channel_release_control_set_basic_state',
    {
      p_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_target_state: input.targetState,
      p_reason: input.reason ?? null,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

export function proposeControlledPilot(
  client: OmniCommsRpcClient,
  input: {
    id: string;
    expectedUpdatedAt: string;
    reason: string;
    correlationId?: string | null;
  },
): Promise<ChannelReleaseControl> {
  return callOmniCommsRpc<ChannelReleaseControl>(
    client,
    'omni_comms_channel_release_control_propose_pilot',
    {
      p_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_reason: input.reason,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

export function cancelReleaseProposal(
  client: OmniCommsRpcClient,
  input: {
    id: string;
    expectedUpdatedAt: string;
    reason?: string | null;
    correlationId?: string | null;
  },
): Promise<ChannelReleaseControl> {
  return callOmniCommsRpc<ChannelReleaseControl>(
    client,
    'omni_comms_channel_release_control_cancel_proposal',
    {
      p_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_reason: input.reason ?? null,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

export function suspendChannelRelease(
  client: OmniCommsRpcClient,
  input: {
    id: string;
    expectedUpdatedAt: string;
    reason: string;
    correlationId?: string | null;
  },
): Promise<ChannelReleaseControl> {
  return callOmniCommsRpc<ChannelReleaseControl>(
    client,
    'omni_comms_channel_release_control_suspend',
    {
      p_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_reason: input.reason,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

/**
 * Approve and activate a controlled pilot through the trusted Edge boundary.
 * The deployed revision is read server-side; the browser cannot supply it.
 * This function contacts no provider and sends nothing.
 */
export const RELEASE_CONTROL_EDGE_FUNCTION = 'omni-comms-release-control';

export interface ApproveActivateInput {
  releaseControlId: string;
  expectedUpdatedAt: string;
  expectedFingerprint: string;
  approvalNote?: string | null;
  correlationId?: string | null;
}

export function buildApproveActivateBody(input: ApproveActivateInput) {
  return {
    action: 'approve_activate' as const,
    releaseControlId: input.releaseControlId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    expectedFingerprint: input.expectedFingerprint,
    approvalNote: input.approvalNote ?? null,
    correlationId: input.correlationId ?? null,
  };
}

/**
 * Bounded, read-only deployment identity request. The revisions are resolved
 * SERVER-SIDE only; the browser supplies nothing.
 */
export function buildDeploymentStatusBody() {
  return { action: 'deployment_status' as const };
}

export interface DeploymentStatus {
  environment: string | null;
  runtime_revision: string | null;
  dispatcher_revision: string | null;
  release_identity: string | null;
  deployment_revision_mismatch: boolean;
  certification: {
    certification_state?: string | null;
    certified_commit?: string | null;
    workflow_run_id?: string | null;
    certified_at?: string | null;
  } | null;
}

/**
 * Trusted environment confirmation. The browser may only ever REQUEST a
 * classification; the Edge boundary re-checks privileged capability, refuses a
 * `non_production` claim unless trusted deployment metadata declares it, writes
 * the protected singleton and records an audit event. It never certifies a
 * commit and never enables delivery.
 */
export function buildConfirmEnvironmentBody(input: {
  environment: 'production' | 'non_production';
  reason?: string | null;
  correlationId?: string | null;
}) {
  return {
    action: 'confirm_environment' as const,
    environment: input.environment,
    reason: input.reason ?? null,
    correlationId: input.correlationId ?? null,
  };
}

/**
 * Trusted deployment certification request. The browser supplies NOTHING: the
 * Edge boundary resolves both deployed revisions server-side, requires an
 * exact full 40-character match and refuses while the environment is unknown.
 * Certification enables no delivery and contacts no provider.
 */
export function buildCertifyDeploymentBody() {
  return { action: 'certify_deployment' as const };
}

/**
 * Bounded, read-only request for the single held business message so the
 * controlled pilot can be prefilled from real governing facts instead of being
 * retyped. It claims nothing and creates no delivery.
 *
 * The scope is REVALIDATED server-side: naming an organisation (or department)
 * the actor may not operate is refused, and the response carries a masked
 * recipient plus a one-way hash only — never a raw address.
 */
export function buildHeldPilotCandidateBody(
  organizationId: string,
  departmentId?: string | null,
) {
  return {
    action: 'held_pilot_candidate' as const,
    organizationId,
    ...(departmentId ? { departmentId } : {}),
  };
}

/**
 * FINAL controlled business send request. The browser names ONLY the Release
 * Control it is looking at; the trusted boundary revalidates the release,
 * resolves EXACTLY ONE authorised held job and dispatches it. Passing
 * `confirmOnly` renders the pre-send confirmation without dispatching.
 */
export function buildControlledSendBody(
  releaseControlId: string,
  options?: { confirmOnly?: boolean; correlationId?: string | null },
) {
  return {
    action: 'release_one_controlled_message' as const,
    releaseControlId,
    ...(options?.confirmOnly ? { confirmOnly: true } : {}),
    ...(options?.correlationId ? { correlationId: options.correlationId } : {}),
  };
}

export interface ControlledSendConfirmation {
  module: string | null;
  event_code: string | null;
  release_state: string | null;
  held_authorized_messages: number;
  recipient_masked: string | null;
  attempts: number;
  provider_calls: number;
  remaining_total_allowance: number;
  certification: string;
  release_snapshot: string;
  pilot_safety: string;
  live_delivery_enabled: boolean;
}

export interface ControlledSendResult {
  ok: boolean;
  code: string;
  confirmation: ControlledSendConfirmation | null;
  dispatched: boolean;
  live_delivery_enabled: boolean;
  dispatch?: {
    claimed_jobs: number;
    blocker: string | null;
    blockers: string[];
    results: Record<string, unknown>[];
    error: string | null;
    detail: string | null;
  };
}

export interface HeldPilotCandidate {
  held_job_count: number;
  candidate: {
    job_id: string;
    hold_reason: string | null;
    mode: string | null;
    attempt_count: number;
    is_runnable: boolean;
    event_code: string | null;
    caller_module_code: string | null;
    department_id: string | null;
    /** Masked only. A raw recipient never crosses the trusted boundary. */
    recipient_masked: string | null;
    /** One-way hash used to configure the pilot recipient rule. */
    recipient_hash: string | null;
  } | null;
}

/**
 * Bounded review of every held (never-attempted) Email job in the caller's own
 * tenant scope. Read-only, masked recipients only.
 */
export function buildHeldJobReviewBody(
  organizationId: string,
  departmentId?: string | null,
) {
  return {
    action: 'held_job_review' as const,
    organizationId,
    ...(departmentId ? { departmentId } : {}),
  };
}

/**
 * Retire exactly ONE obsolete held Email job. Nothing is deleted and no
 * provider is contacted: the trusted boundary refuses the request when the job
 * was ever attempted or a provider was ever called.
 */
export function buildRetireHeldJobBody(
  organizationId: string,
  jobId: string,
  options?: { departmentId?: string | null; reason?: string },
) {
  return {
    action: 'retire_held_job' as const,
    organizationId,
    jobId,
    ...(options?.departmentId ? { departmentId: options.departmentId } : {}),
    ...(options?.reason ? { reason: options.reason } : {}),
  };
}

export interface HeldJobReviewEntry {
  job_id: string;
  message_id: string;
  request_id: string;
  created_at: string;
  status: string;
  hold_reason: string | null;
  attempt_count: number;
  event_code: string | null;
  caller_module_code: string | null;
  mode: string | null;
  entity_type: string | null;
  entity_id: string | null;
  claim_reference: string | null;
  release_state_at_decision: string | null;
  /** Masked only. A raw recipient never crosses the trusted boundary. */
  recipient_masked: string | null;
  provider_contacted: boolean;
  retirable: boolean;
}

export interface HeldJobReview {
  held_job_count: number;
  jobs: HeldJobReviewEntry[];
}

export interface RetireHeldJobResult {
  retired: boolean;
  job_id: string | null;
  message_id: string | null;
  reason: string | null;
  live_delivery_enabled: boolean;
}




