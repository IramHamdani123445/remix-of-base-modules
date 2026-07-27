/**
 * Controlled Revalidation Cycle client.
 *
 * Wraps the server-side RPCs that govern a controlled revalidation of a
 * production Communication Hub event. Every call is admin-authenticated
 * server-side; the browser has no authority.
 *
 * The client never sends an email itself; the controlled revalidation
 * email is dispatched by the same One Real Email transport once an
 * operator issues the one-use authorisation.
 */
import { supabase } from "@/integrations/supabase/client";

export type RevalidationPurpose =
  | "CONFIGURATION_CHANGE"
  | "PROVIDER_CHANGE"
  | "SENDER_CHANGE"
  | "TEMPLATE_CHANGE"
  | "RUNTIME_CHANGE"
  | "SECURITY_CHANGE"
  | "INCIDENT_RECOVERY"
  | "OPERATOR_ASSURANCE";

export type RevalidationStatus =
  | "DRAFT" | "ASSESSING" | "REVALIDATION_REQUIRED" | "NON_SENDING_CHECKS"
  | "READY_FOR_CONTROLLED_EMAIL" | "EMAIL_AUTHORISED" | "PROVIDER_PROCESSING"
  | "AWAITING_INBOX_CONFIRMATION" | "CONFIRMED" | "NOT_RECEIVED" | "FAILED"
  | "VOIDED" | "VERIFIED_SUPPLEMENTAL" | "READY_FOR_PROMOTION" | "PROMOTED"
  | "SUPERSEDED";

export type RevalidationLevel =
  | "NONE" | "NON_SENDING_ONLY" | "CONTROLLED_EMAIL"
  | "FULL_CONTENT_AND_DELIVERY" | "FULL_MANUAL_PRODUCTION" | "AUTOMATED_CANARY";

export type RevalidationStageCode =
  | "CHANGE_ASSESSMENT" | "CONTRACT_TESTS" | "PREVIEW" | "PREVIEW_APPROVAL"
  | "DRY_RUN" | "CONTROLLED_STUB" | "CONTROLLED_REVALIDATION_EMAIL"
  | "INBOX_CONFIRMATION" | "MANUAL_PRODUCTION_ACCEPTANCE"
  | "AUTOMATED_READINESS" | "AUTOMATED_CANARY" | "BASELINE_PROMOTION";

export type StageResultStatus =
  | "PASSED" | "FAILED" | "SKIPPED" | "ACCEPTED_UNCHANGED" | "PENDING";

export type ChangeCategory =
  | "UI_ONLY" | "MONITORING_ONLY" | "SCHEDULER_ARM_ONLY"
  | "PROVIDER_CHANGE" | "SENDER_DISPLAY_ONLY" | "SENDER_DOMAIN"
  | "TEMPLATE_CHANGE" | "PAYLOAD_SCHEMA" | "RECIPIENT_POLICY"
  | "SEND_REVIEW_POLICY" | "DISPATCHER_TRANSPORT" | "SECURITY";

export interface AssessmentEnvelope {
  ok: boolean;
  error?: string;
  module_code: string;
  event_code: string;
  channel: string;
  baseline?: any;
  current_evidence_core_v2?: any;
  baseline_fingerprint?: string;
  current_fingerprint?: string;
  drift_detected: boolean;
  changed_components: string[];
  runtime_changes: Record<string, unknown>;
  required_validation_level: RevalidationLevel;
  required_stages: RevalidationStageCode[];
  explanation: string;
  production_may_continue: boolean;
  event_must_be_suspended: boolean;
  automation_must_be_disarmed: boolean;
  assessed_at: string;
}

export interface RevalidationCycle {
  id: string;
  module_code: string;
  event_code: string;
  channel: string;
  purpose: RevalidationPurpose;
  reason: string;
  change_ticket_reference: string | null;
  status: RevalidationStatus;
  baseline_event_certification_id: string | null;
  baseline_ore_certification_id: string | null;
  baseline_production_lineage_id: string | null;
  baseline_evidence_fingerprint_v2: string | null;
  current_evidence_fingerprint_v2: string | null;
  changed_components: string[];
  required_validation_level: RevalidationLevel;
  required_stages: RevalidationStageCode[];
  recipient_email: string | null;
  controlled_email_execution_id: string | null;
  inbox_confirmation_status: "PENDING" | "CONFIRMED" | "NOT_RECEIVED" | null;
  provider_call_attempted: boolean;
  completed_at: string | null;
  promotion_status: "NONE" | "SUPPLEMENTAL" | "PROMOTED" | null;
  promoted_at: string | null;
  started_at: string;
}

function unwrap<T>(res: { data: any; error: any }, fallbackMessage: string): T {
  if (res.error) throw new Error(res.error.message ?? fallbackMessage);
  return res.data as T;
}

export async function assessRevalidationRequirement(input: {
  moduleCode: string;
  eventCode: string;
  channel?: string;
  declaredChangeCategories: ChangeCategory[];
  runtimeReleaseReference?: string | null;
}): Promise<AssessmentEnvelope> {
  return unwrap<AssessmentEnvelope>(
    await (supabase as any).rpc("assess_comm_hub_revalidation_requirement", {
      p_module_code: input.moduleCode,
      p_event_code: input.eventCode,
      p_channel: input.channel ?? "email",
      p_declared_change_categories: input.declaredChangeCategories,
      p_runtime_release_reference: input.runtimeReleaseReference ?? null,
    }),
    "assess_comm_hub_revalidation_requirement failed",
  );
}

export async function startRevalidationCycle(input: {
  moduleCode: string;
  eventCode: string;
  channel?: string;
  purpose: RevalidationPurpose;
  reason: string;
  changeTicketReference?: string | null;
  declaredChangeCategories: ChangeCategory[];
  runtimeReleaseReference?: string | null;
}): Promise<{ ok: boolean; cycle_id: string; assessment: AssessmentEnvelope }> {
  return unwrap(
    await (supabase as any).rpc("start_comm_hub_revalidation_cycle", {
      p_module_code: input.moduleCode,
      p_event_code: input.eventCode,
      p_channel: input.channel ?? "email",
      p_purpose: input.purpose,
      p_reason: input.reason,
      p_change_ticket_reference: input.changeTicketReference ?? null,
      p_declared_change_categories: input.declaredChangeCategories,
      p_runtime_release_reference: input.runtimeReleaseReference ?? null,
    }),
    "start_comm_hub_revalidation_cycle failed",
  );
}

export async function recordRevalidationStage(input: {
  cycleId: string;
  stageCode: RevalidationStageCode;
  status: StageResultStatus;
  evidence?: Record<string, unknown>;
  reusedHistorical?: boolean;
  previewSnapshotId?: string | null;
  previewApprovalId?: string | null;
  dryRunCertificationId?: string | null;
  controlledStubCertificationId?: string | null;
  oneRealEmailCertificationId?: string | null;
  manualObservationId?: string | null;
  automatedCanaryId?: string | null;
}) {
  return unwrap(
    await (supabase as any).rpc("record_comm_hub_revalidation_stage", {
      p_cycle_id: input.cycleId,
      p_stage_code: input.stageCode,
      p_status: input.status,
      p_evidence: input.evidence ?? {},
      p_reused_historical: !!input.reusedHistorical,
      p_preview_snapshot_id: input.previewSnapshotId ?? null,
      p_preview_approval_id: input.previewApprovalId ?? null,
      p_dry_run_certification_id: input.dryRunCertificationId ?? null,
      p_controlled_stub_certification_id: input.controlledStubCertificationId ?? null,
      p_one_real_email_certification_id: input.oneRealEmailCertificationId ?? null,
      p_manual_observation_id: input.manualObservationId ?? null,
      p_automated_canary_id: input.automatedCanaryId ?? null,
    }),
    "record_comm_hub_revalidation_stage failed",
  );
}

export async function issueRevalidationSendAuthorisation(input: {
  cycleId: string;
  recipientEmail: string;
  currentFingerprint: string;
  typedPhrase: string;
  expiresMinutes?: number;
}) {
  return unwrap(
    await (supabase as any).rpc("issue_comm_hub_revalidation_send_authorisation", {
      p_cycle_id: input.cycleId,
      p_recipient_email: input.recipientEmail,
      p_current_fingerprint: input.currentFingerprint,
      p_typed_phrase: input.typedPhrase,
      p_expires_minutes: input.expiresMinutes ?? 30,
    }),
    "issue_comm_hub_revalidation_send_authorisation failed",
  );
}

export async function recordRevalidationInboxConfirmation(input: {
  cycleId: string;
  status: "CONFIRMED" | "NOT_RECEIVED";
  notes?: string;
}) {
  return unwrap(
    await (supabase as any).rpc("record_comm_hub_revalidation_inbox_confirmation", {
      p_cycle_id: input.cycleId,
      p_status: input.status,
      p_notes: input.notes ?? null,
    }),
    "record_comm_hub_revalidation_inbox_confirmation failed",
  );
}

export async function voidRevalidationCycle(input: { cycleId: string; reason: string }) {
  return unwrap(
    await (supabase as any).rpc("void_comm_hub_revalidation_cycle", {
      p_cycle_id: input.cycleId,
      p_reason: input.reason,
    }),
    "void_comm_hub_revalidation_cycle failed",
  );
}

export async function markRevalidationCycleSupplemental(cycleId: string) {
  return unwrap(
    await (supabase as any).rpc("mark_comm_hub_revalidation_cycle_supplemental", {
      p_cycle_id: cycleId,
    }),
    "mark_comm_hub_revalidation_cycle_supplemental failed",
  );
}

export async function promoteRevalidationBaseline(input: {
  cycleId: string;
  typedPhrase: string;
  reason: string;
}) {
  return unwrap(
    await (supabase as any).rpc("promote_comm_hub_revalidation_baseline", {
      p_cycle_id: input.cycleId,
      p_typed_phrase: input.typedPhrase,
      p_reason: input.reason,
    }),
    "promote_comm_hub_revalidation_baseline failed",
  );
}

export async function listRevalidationCycles(input: {
  moduleCode?: string; eventCode?: string; channel?: string; limit?: number;
}): Promise<RevalidationCycle[]> {
  const res = await (supabase as any).rpc("list_comm_hub_revalidation_cycles", {
    p_module_code: input.moduleCode ?? null,
    p_event_code: input.eventCode ?? null,
    p_channel: input.channel ?? null,
    p_limit: input.limit ?? 50,
  });
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as RevalidationCycle[];
}

export const REVALIDATION_SEND_TYPED_PHRASE = "SEND ONE CONTROLLED REVALIDATION EMAIL";
export const REVALIDATION_PROMOTE_TYPED_PHRASE = "PROMOTE REVALIDATION BASELINE";

export interface ControlledRevalidationSendResult {
  status:
    | "BLOCKED" | "RESERVED" | "PROVIDER_ACCEPTED"
    | "PROVIDER_REJECTED" | "RECOVERED";
  passed: boolean;
  cycle_status: string | null;
  authorisation_status: string | null;
  provider_call_attempted: boolean;
  provider_result_recorded: boolean;
  reused_existing_execution: boolean;
  request_id: string | null;
  message_id: string | null;
  provider_message_id: string | null;
  message: string;
  blockers: Array<{ code: string; stage: string; message?: string }>;
  warnings: Array<Record<string, unknown>>;
}

/**
 * Invoke the dedicated Edge Function that consumes a one-use revalidation
 * authorisation. Contacts the provider at most once per cycle. Uses the
 * existing `comm-hub-send-controlled-revalidation` runtime — this
 * function does NOT reuse `comm-hub-send-one-real-email` and does NOT
 * reopen Stage 6.
 */
export async function sendControlledRevalidationEmail(input: {
  cycleId: string;
  authorisationId: string;
  currentFingerprint: string;
  recipient: string;
}): Promise<ControlledRevalidationSendResult> {
  const { data, error } = await supabase.functions.invoke(
    "comm-hub-send-controlled-revalidation",
    {
      body: {
        action: "SEND_CONTROLLED_REVALIDATION_EMAIL",
        cycleId: input.cycleId,
        authorisationId: input.authorisationId,
        currentFingerprint: input.currentFingerprint,
        recipient: input.recipient,
      },
    },
  );
  if (error) throw new Error(error.message ?? "controlled revalidation send failed");
  return data as ControlledRevalidationSendResult;
}

export async function recoverControlledRevalidationSend(input: {
  cycleId: string;
  authorisationId: string;
}): Promise<ControlledRevalidationSendResult> {
  const { data, error } = await supabase.functions.invoke(
    "comm-hub-send-controlled-revalidation",
    {
      body: {
        action: "RECOVER",
        cycleId: input.cycleId,
        authorisationId: input.authorisationId,
      },
    },
  );
  if (error) throw new Error(error.message ?? "controlled revalidation recover failed");
  return data as ControlledRevalidationSendResult;
}

export interface PrepareControlledRevalidationResult {
  status:
    | "BLOCKED" | "READY_FOR_PROVIDER" | "FAILED_PRE_PROVIDER"
    | "PROVIDER_ACCEPTED" | "PROVIDER_REJECTED" | "RECOVERED";
  passed: boolean;
  cycle_status: string | null;
  authorisation_status: string | null;
  execution_id: string | null;
  request_id: string | null;
  message_id: string | null;
  delivery_attempt_id: string | null;
  trace_id: string | null;
  reused_existing_execution: boolean;
  provider_boundary_state: "NOT_ENTERED" | "ENTERED" | null;
  provider_call_attempted: boolean;
  provider_name: string | null;
  message: string;
  blockers: Array<{ code: string; stage: string; message?: string }>;
  warnings: Array<Record<string, unknown>>;
}

/**
 * A4.1 — Durable Controlled Revalidation preparation.
 *
 * Reserves canonical template/sender/recipient/provider bindings and creates
 * durable evidence records via the internal service-role RPC. Never contacts
 * the email provider. Never consumes the operator's authorisation.
 */
export async function prepareControlledRevalidation(input: {
  cycleId: string;
  authorisationId: string;
  idempotencyKey?: string;
}): Promise<PrepareControlledRevalidationResult> {
  const { data, error } = await supabase.functions.invoke(
    "comm-hub-send-controlled-revalidation",
    {
      body: {
        action: "PREPARE_CONTROLLED_REVALIDATION",
        cycleId: input.cycleId,
        authorisationId: input.authorisationId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  );
  if (error) throw new Error(error.message ?? "controlled revalidation preparation failed");
  return data as PrepareControlledRevalidationResult;
}



/**
 * Checkpoint A — Server-authoritative cycle reassessment.
 *
 * Calls the admin-gated `reassess_comm_hub_revalidation_cycle` RPC, which
 * fails closed when evidence is missing. The RPC recomputes current
 * evidence fingerprints from fresh resolvers and clears the
 * `needs_reassessment` flag when it succeeds. Never masks a failure —
 * blockers surface to the operator so they can repair the underlying
 * evidence gap.
 */
export interface ReassessCycleResult {
  ok: boolean;
  cycle_id: string;
  assessment_version: number;
  needs_reassessment: boolean;
  assessed_at: string | null;
  assessed_runtime_contract_version: string | null;
  changed_components: string[];
  required_validation_level: RevalidationLevel | null;
  required_stages: RevalidationStageCode[];
  baseline_evidence_fingerprint_v2: string | null;
  current_evidence_fingerprint_v2: string | null;
  blockers: Array<{ code: string; message?: string }>;
  message: string;
}

export async function reassessRevalidationCycle(
  cycleId: string,
): Promise<ReassessCycleResult> {
  return unwrap<ReassessCycleResult>(
    await (supabase as any).rpc("reassess_comm_hub_revalidation_cycle", {
      p_cycle_id: cycleId,
    }),
    "reassess_comm_hub_revalidation_cycle failed",
  );
}

