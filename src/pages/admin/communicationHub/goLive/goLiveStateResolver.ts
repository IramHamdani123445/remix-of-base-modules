/**
 * Server-authoritative lifecycle derivation for Go-Live Steps 6–9.
 *
 * Pure functions over EventGoLiveStatus + a composed PendingObservationState
 * (server recovery RPC + client transport outcome) + optional Stage 9
 * completion RPC result. No sessionStorage; no browser-inferred production
 * authority; heartbeat-fresh readiness alone can never yield LIVE_AUTOMATED_ARMED.
 */
import type { EventGoLiveStatus } from "@/platform/communication-hub/eventGoLiveStatusService";
import type { GoLiveCompletion } from "@/platform/communication-hub/goLiveCompletionService";
import type {
  ObservationPhase,
  ObservationRecovery,
  RunObservationResult,
  TransportErrorClass,
} from "@/platform/communication-hub/manualProductionObservationService";

/** Steps 6/7 mode. */
export type Step6State = "ACTION_REQUIRED" | "COMPLETED";
export type Step7ModeState = "PENDING" | "COMPLETED";

/** Local Step 8 states — LIVE_AUTOMATED_ARMED is NEVER derived locally. */
export type Step8State =
  | "WAITING_FOR_MANUAL_OBSERVATION"
  | "READY_FOR_READINESS_PROBES"
  | "READINESS_INCOMPLETE"
  | "READY_TO_CERTIFY"
  | "AUTOMATED_CERTIFIED"
  | "AUTOMATED_STANDBY"
  | "ARMED_PENDING_HEARTBEAT";

/** Observation states — pure server-authoritative view. */
export type ObservationActionState =
  | "LOCKED"
  | "RECOVERY_CHECK_IN_PROGRESS"
  | "ACTION_REQUIRED_DISPATCH"
  | "PROCESSING"
  | "TRANSPORT_UNRESOLVED"
  | "RECOVERY_REQUIRED_RETRY_FINALIZE"
  | "ACTION_REQUIRED_CONFIRM_INBOX"
  | "COMPLETED";

/** Explicit operator action mapped from state. */
export type ObservationAction =
  | "DISPATCH"
  | "CHECK_RECOVERY"
  | "FINALIZE"
  | "CONFIRM_INBOX"
  | "NONE";

export const OBSERVATION_STATE_TO_ACTION: Record<ObservationActionState, ObservationAction> = {
  LOCKED: "NONE",
  RECOVERY_CHECK_IN_PROGRESS: "NONE",
  ACTION_REQUIRED_DISPATCH: "DISPATCH",
  PROCESSING: "CHECK_RECOVERY",
  TRANSPORT_UNRESOLVED: "CHECK_RECOVERY",
  RECOVERY_REQUIRED_RETRY_FINALIZE: "FINALIZE",
  ACTION_REQUIRED_CONFIRM_INBOX: "CONFIRM_INBOX",
  COMPLETED: "NONE",
};

export type BlockerCode =
  | "EVENT_NOT_MANUALLY_CERTIFIED"
  | "RECOVERY_CHECK_IN_PROGRESS"
  | "EXISTING_INTENT_PENDING"
  | "TRANSPORT_OUTCOME_UNRESOLVED"
  | "AWAITING_PROVIDER"
  | "AWAITING_INBOX_CONFIRMATION"
  | "ALREADY_CONFIRMED"
  | "RECIPIENT_NOT_APPROVED"
  | "EDGE_FUNCTION_UNAVAILABLE";

export interface ObservationDerived {
  state: ObservationActionState;
  action: ObservationAction;
  blocker: BlockerCode | null;
  primaryLabel: string;
  primaryEnabled: boolean;
}

/**
 * Composed server-authoritative pending-observation state.
 *
 * `has_pending`, `phase`, `idempotency_key`, `intent_id`, `observation_id`,
 * `request_id`, `message_id`, `inbox_confirmation_status`, `recipient_email`,
 * `created_at` come from `get_comm_hub_observation_recovery` (server RPC).
 *
 * `transport_unresolved` and `last_transport_error_class` are contributed by
 * the client wrapper when a dispatch invocation could not confirm whether the
 * request reached the server. The same key is reused on retry.
 */
export interface PendingObservationState {
  has_pending: boolean;
  phase: ObservationPhase | null;
  idempotency_key: string | null;
  /** Recovery RPC returns observation_id — treat that as the durable intent id. */
  intent_id: string | null;
  observation_id: string | null;
  request_id: string | null;
  message_id: string | null;
  inbox_confirmation_status: "CONFIRMED" | "NOT_RECEIVED" | null;
  recipient_email: string | null;
  created_at: string | null;
  transport_unresolved: boolean;
  last_transport_error_class: TransportErrorClass | null;
  recovering: boolean;
}

export const EMPTY_PENDING_OBSERVATION_STATE: PendingObservationState = {
  has_pending: false,
  phase: null,
  idempotency_key: null,
  intent_id: null,
  observation_id: null,
  request_id: null,
  message_id: null,
  inbox_confirmation_status: null,
  recipient_email: null,
  created_at: null,
  transport_unresolved: false,
  last_transport_error_class: null,
  recovering: false,
};

/** Compose the shared pending-observation state from recovery + last transport. */
export function composePendingObservationState(input: {
  recovery: ObservationRecovery | null;
  recovering: boolean;
  lastResult: RunObservationResult | null;
  lastIdempotencyKey?: string | null;
}): PendingObservationState {
  const { recovery, recovering, lastResult, lastIdempotencyKey } = input;
  const transportUnresolved = !!(lastResult?.transport && !lastResult.transport.resolved);
  if (recovery?.hasPending) {
    return {
      has_pending: true,
      phase: (recovery.phase ?? null) as ObservationPhase | null,
      idempotency_key: recovery.idempotencyKey ?? lastIdempotencyKey ?? null,
      intent_id: recovery.observationId ?? null,
      observation_id: recovery.observationId ?? null,
      request_id: recovery.requestId ?? null,
      message_id: recovery.messageId ?? null,
      inbox_confirmation_status: recovery.inboxConfirmationStatus ?? null,
      recipient_email: recovery.recipientEmail ?? null,
      created_at: recovery.createdAt ?? null,
      transport_unresolved: transportUnresolved,
      last_transport_error_class: lastResult?.transport?.errorClass ?? null,
      recovering,
    };
  }
  return {
    has_pending: false,
    phase: (lastResult?.phase && lastResult.phase !== "IDLE" ? lastResult.phase : null) as ObservationPhase | null,
    idempotency_key: lastIdempotencyKey ?? null,
    intent_id: lastResult?.observation_id ?? null,
    observation_id: lastResult?.observation_id ?? null,
    request_id: lastResult?.request_id ?? null,
    message_id: lastResult?.message_id ?? null,
    inbox_confirmation_status: (lastResult?.inbox_confirmation_status ?? null) as
      | "CONFIRMED"
      | "NOT_RECEIVED"
      | null,
    recipient_email: null,
    created_at: null,
    transport_unresolved: transportUnresolved,
    last_transport_error_class: lastResult?.transport?.errorClass ?? null,
    recovering,
  };
}

// ---------------------------------------------------------------------------
// Step 6 — server-authoritative ONLY. `controlledLiveDone` is intentionally
// NOT a parameter here. Session state must not relock a server-complete Step 6.
// ---------------------------------------------------------------------------
export function deriveStep6(status: EventGoLiveStatus | null): Step6State {
  const s6 = status?.stage6;
  if (!s6) return "ACTION_REQUIRED";
  const confirmed = s6.manual_verification_status === "CONFIRMED";
  const eligibleCert =
    !!s6.eligible_one_real_email_certification_id ||
    s6.one_real_email_certification_status === "DELIVERY_CONFIRMED_MANUALLY";
  const hasProvider = !!s6.provider_message_id;
  const hasAttempt = !!s6.delivery_attempt_id;
  const hasTrace = !!s6.trace_id;
  const noReconciliation = s6.reconciliation_required !== true;
  return confirmed && eligibleCert && hasProvider && hasAttempt && hasTrace && noReconciliation
    ? "COMPLETED"
    : "ACTION_REQUIRED";
}

// ---------------------------------------------------------------------------
// Step 7 helpers — mode + event certification derived from server state.
// ---------------------------------------------------------------------------
export function deriveStep7Mode(status: EventGoLiveStatus | null): Step7ModeState {
  const mode = status?.platform?.current_operating_mode;
  return mode === "MANUAL_PRODUCTION" || mode === "AUTOMATED_PRODUCTION" ? "COMPLETED" : "PENDING";
}

export function deriveStep7EventCertified(status: EventGoLiveStatus | null): boolean {
  const es = status?.stage7?.manual_event_status;
  return es === "live_manual_only" || es === "live_cron_allowed";
}

// ---------------------------------------------------------------------------
// Observation state derivation — pure over server state + pending state.
// ---------------------------------------------------------------------------
export function deriveObservation(
  status: EventGoLiveStatus | null,
  pending: PendingObservationState,
): ObservationDerived {
  const shell = (
    state: ObservationActionState,
    blocker: BlockerCode | null,
    primaryLabel: string,
    primaryEnabled: boolean,
  ): ObservationDerived => ({
    state,
    action: OBSERVATION_STATE_TO_ACTION[state],
    blocker,
    primaryLabel,
    primaryEnabled,
  });

  if (!deriveStep7EventCertified(status)) {
    return shell("LOCKED", "EVENT_NOT_MANUALLY_CERTIFIED", "Dispatch observation", false);
  }
  if (pending.recovering) {
    return shell("RECOVERY_CHECK_IN_PROGRESS", "RECOVERY_CHECK_IN_PROGRESS", "Checking pending…", false);
  }

  // Transport-unresolved dispatches must NEVER re-invoke the edge function
  // until recovery proves the original operation never reached the server.
  if (pending.transport_unresolved) {
    return shell(
      "TRANSPORT_UNRESOLVED",
      "TRANSPORT_OUTCOME_UNRESOLVED",
      "Check recovery status",
      true,
    );
  }

  const phase = pending.phase;
  if (phase === "AWAITING_PROVIDER") {
    return shell(
      "RECOVERY_REQUIRED_RETRY_FINALIZE",
      "AWAITING_PROVIDER",
      "Finalize pending observation",
      true,
    );
  }
  if (phase === "AWAITING_INBOX_CONFIRMATION") {
    return shell(
      "ACTION_REQUIRED_CONFIRM_INBOX",
      "AWAITING_INBOX_CONFIRMATION",
      "Confirm inbox receipt",
      true,
    );
  }
  if (phase === "ENQUEUED" || phase === "DISPATCHED") {
    return shell("PROCESSING", "EXISTING_INTENT_PENDING", "Check recovery", true);
  }

  const inbox = status?.stage7?.latest_manual_observation_inbox;
  if (inbox === "CONFIRMED" || pending.inbox_confirmation_status === "CONFIRMED") {
    return shell("COMPLETED", "ALREADY_CONFIRMED", "Confirmed", false);
  }

  return shell("ACTION_REQUIRED_DISPATCH", null, "Dispatch observation", true);
}

// ---------------------------------------------------------------------------
// Step 8 — local derivation NEVER returns LIVE_AUTOMATED_ARMED. Heartbeat
// evidence is NOT inferred from readiness. Only the completion RPC can
// promote the lifecycle to LIVE_AUTOMATED_ARMED.
// ---------------------------------------------------------------------------
export function deriveStep8(status: EventGoLiveStatus | null): Step8State {
  const s7 = status?.stage7;
  const s8 = status?.stage8;
  const p = status?.platform;
  const armed = p?.automation_state === "ARMED";
  const cronEvent = s8?.automation_event_certification_status === "live_cron_allowed";
  const automatedMode = p?.current_operating_mode === "AUTOMATED_PRODUCTION";

  if (armed && automatedMode) return "ARMED_PENDING_HEARTBEAT";
  if (automatedMode && cronEvent) return "AUTOMATED_STANDBY";
  if (cronEvent) return "AUTOMATED_CERTIFIED";

  const inboxConfirmed = s7?.latest_manual_observation_inbox === "CONFIRMED";
  if (!inboxConfirmed) return "WAITING_FOR_MANUAL_OBSERVATION";
  if (!s8) return "READY_FOR_READINESS_PROBES";
  const anyRun = (s8.readiness_checks ?? []).length > 0;
  if (!anyRun) return "READY_FOR_READINESS_PROBES";
  if (!s8.readiness_all_ok_and_fresh) return "READINESS_INCOMPLETE";
  return "READY_TO_CERTIFY";
}

// ---------------------------------------------------------------------------
// Lifecycle summary — LIVE_AUTOMATED_ARMED comes ONLY from completion RPC.
// ---------------------------------------------------------------------------
export interface LifecycleSummary {
  lifecycle: string;
  nextAction: string;
  blocker: string | null;
  moduleCode: string;
  eventCode: string;
  channel: string;
  operatingMode: string;
  automationState: string;
}

export function deriveLifecycle(input: {
  status: EventGoLiveStatus | null;
  observation: ObservationDerived;
  completion: GoLiveCompletion | null;
}): LifecycleSummary {
  const { status, observation, completion } = input;
  const step6 = deriveStep6(status);
  const step7Mode = deriveStep7Mode(status);
  const step7Cert = deriveStep7EventCertified(status);
  const step8 = deriveStep8(status);

  let lifecycle = "INCOMPLETE";
  let nextAction = "Complete earlier steps first";
  let blocker: string | null = null;

  // Authoritative Stage 9 completion trumps any local derivation for the
  // fully-live outcomes. Only the completion RPC may report LIVE_AUTOMATED_ARMED.
  if (completion?.is_stage9_complete && completion.outcome === "LIVE_AUTOMATED_ARMED") {
    lifecycle = "LIVE_AUTOMATED_ARMED";
    nextAction = "None — automation live";
    blocker = null;
  } else if (completion?.is_stage9_complete && completion.outcome === "LIVE_MANUAL") {
    lifecycle = "LIVE_MANUAL";
    nextAction = "None — event live under Manual Production";
    blocker = null;
  } else if (step6 !== "COMPLETED") {
    lifecycle = "STAGE_6_PENDING";
    nextAction = "Send & verify one real email";
    blocker = "STAGE_6_NOT_VERIFIED";
  } else if (!step7Cert) {
    lifecycle = "STAGE_7_PENDING_CERTIFICATION";
    nextAction = "Certify event for Manual Production";
    blocker = "EVENT_NOT_MANUALLY_CERTIFIED";
  } else if (step7Mode !== "COMPLETED") {
    lifecycle = "STAGE_7_PENDING_MODE";
    nextAction = "Switch platform mode to MANUAL_PRODUCTION";
    blocker = "OPERATING_MODE_NOT_MANUAL";
  } else if (observation.state !== "COMPLETED") {
    lifecycle = "STAGE_7_PENDING_OBSERVATION";
    nextAction = observation.primaryLabel;
    blocker = observation.blocker;
  } else if (step8 === "ARMED_PENDING_HEARTBEAT") {
    lifecycle = "ARMED_PENDING_HEARTBEAT";
    nextAction = "Wait for scheduler heartbeat";
    blocker = "HEARTBEAT_NOT_FRESH";
  } else if (step8 === "AUTOMATED_STANDBY") {
    lifecycle = "AUTOMATED_STANDBY";
    nextAction = "Arm automation (Step 8)";
    blocker = null;
  } else {
    lifecycle = "LIVE_MANUAL";
    nextAction = `Step 8: ${step8}`;
    blocker = null;
  }

  return {
    lifecycle,
    nextAction,
    blocker,
    moduleCode: status?.module_code ?? "—",
    eventCode: status?.event_code ?? "—",
    channel: status?.channel ?? "email",
    operatingMode: status?.platform?.current_operating_mode ?? "—",
    automationState: status?.platform?.automation_state ?? "—",
  };
}

export const STEP8_STATE_LABELS: Record<Step8State, string> = {
  WAITING_FOR_MANUAL_OBSERVATION: "Waiting for a confirmed Manual observation",
  READY_FOR_READINESS_PROBES: "Ready to run readiness probes",
  READINESS_INCOMPLETE: "Readiness incomplete or stale",
  READY_TO_CERTIFY: "Ready to certify as live_cron_allowed",
  AUTOMATED_CERTIFIED: "Event certified · mode not yet AUTOMATED",
  AUTOMATED_STANDBY: "AUTOMATED_PRODUCTION · STANDBY (not armed)",
  ARMED_PENDING_HEARTBEAT: "ARMED · waiting for fresh scheduler heartbeat",
};
