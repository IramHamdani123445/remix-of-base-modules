/**
 * Server-authoritative lifecycle derivation for Go-Live Steps 6–9.
 *
 * These are PURE functions over EventGoLiveStatus + (client) observation
 * recovery + transport state. No sessionStorage; no "trust the browser".
 *
 * Blocker codes are the canonical strings the user asked to see verbatim.
 */
import type {
  EventGoLiveStatus,
} from "@/platform/communication-hub/eventGoLiveStatusService";
import type {
  ObservationPhase,
  ObservationRecovery,
  RunObservationResult,
} from "@/platform/communication-hub/manualProductionObservationService";

export type Step6State =
  | "LOCKED"
  | "ACTION_REQUIRED"
  | "COMPLETED";

export type Step7ModeState = "PENDING" | "COMPLETED";

export type ObservationActionState =
  | "LOCKED"
  | "RECOVERY_CHECK_IN_PROGRESS"
  | "ACTION_REQUIRED_DISPATCH"
  | "PROCESSING"
  | "RECOVERY_REQUIRED_RETRY_FINALIZE"
  | "ACTION_REQUIRED_CONFIRM_INBOX"
  | "TRANSPORT_UNRESOLVED"
  | "COMPLETED";

export type Step8State =
  | "WAITING_FOR_MANUAL_OBSERVATION"
  | "READY_FOR_READINESS_PROBES"
  | "READINESS_INCOMPLETE"
  | "READY_TO_CERTIFY"
  | "AUTOMATED_CERTIFIED"
  | "AUTOMATED_STANDBY"
  | "ARMED_PENDING_HEARTBEAT"
  | "LIVE_AUTOMATED_ARMED";

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
  /** The single most specific blocker to display next to the primary button. */
  blocker: BlockerCode | null;
  /** Label for the primary button visible to the operator. */
  primaryLabel: string;
  /** Whether the primary button should be enabled at all. */
  primaryEnabled: boolean;
}

export function deriveStep6(status: EventGoLiveStatus | null, controlledLiveDone: boolean): Step6State {
  if (!controlledLiveDone) return "LOCKED";
  const s6 = status?.stage6;
  if (!s6) return "ACTION_REQUIRED";
  const confirmed =
    s6.manual_verification_status === "CONFIRMED" ||
    s6.one_real_email_certification_status === "DELIVERY_CONFIRMED_MANUALLY" ||
    s6.stage6_ready_for_manual_production === true;
  return confirmed ? "COMPLETED" : "ACTION_REQUIRED";
}

export function deriveStep7Mode(status: EventGoLiveStatus | null): Step7ModeState {
  const mode = status?.platform?.current_operating_mode;
  if (mode === "MANUAL_PRODUCTION" || mode === "AUTOMATED_PRODUCTION") return "COMPLETED";
  return "PENDING";
}

export function deriveStep7EventCertified(status: EventGoLiveStatus | null): boolean {
  const es = status?.stage7?.manual_event_status;
  return es === "live_manual_only" || es === "live_cron_allowed";
}

export function deriveObservation(
  status: EventGoLiveStatus | null,
  recovery: ObservationRecovery | null,
  recovering: boolean,
  lastResult: RunObservationResult | null,
): ObservationDerived {
  if (!deriveStep7EventCertified(status)) {
    return {
      state: "LOCKED",
      blocker: "EVENT_NOT_MANUALLY_CERTIFIED",
      primaryLabel: "Dispatch observation",
      primaryEnabled: false,
    };
  }
  if (recovering) {
    return {
      state: "RECOVERY_CHECK_IN_PROGRESS",
      blocker: "RECOVERY_CHECK_IN_PROGRESS",
      primaryLabel: "Checking pending…",
      primaryEnabled: false,
    };
  }
  // Transport unresolved wins over server phase — same idem key must be reused.
  if (lastResult?.transport && !lastResult.transport.resolved) {
    return {
      state: "TRANSPORT_UNRESOLVED",
      blocker: "TRANSPORT_OUTCOME_UNRESOLVED",
      primaryLabel: "Retry dispatch (same key)",
      primaryEnabled: true,
    };
  }
  // Server-authoritative pending intent takes precedence.
  const phase: ObservationPhase | undefined = recovery?.hasPending
    ? (recovery.phase ?? undefined)
    : (lastResult?.phase && lastResult.phase !== "IDLE" ? lastResult.phase : undefined);

  if (phase === "AWAITING_PROVIDER") {
    return {
      state: "RECOVERY_REQUIRED_RETRY_FINALIZE",
      blocker: "AWAITING_PROVIDER",
      primaryLabel: "Retry finalize",
      primaryEnabled: true,
    };
  }
  if (phase === "AWAITING_INBOX_CONFIRMATION") {
    return {
      state: "ACTION_REQUIRED_CONFIRM_INBOX",
      blocker: "AWAITING_INBOX_CONFIRMATION",
      primaryLabel: "Confirm inbox receipt",
      primaryEnabled: true,
    };
  }
  if (phase === "ENQUEUED" || phase === "DISPATCHED") {
    return {
      state: "PROCESSING",
      blocker: "EXISTING_INTENT_PENDING",
      primaryLabel: "Processing…",
      primaryEnabled: false,
    };
  }

  const inbox = status?.stage7?.latest_manual_observation_inbox;
  if (inbox === "CONFIRMED") {
    return {
      state: "COMPLETED",
      blocker: "ALREADY_CONFIRMED",
      primaryLabel: "Confirmed",
      primaryEnabled: false,
    };
  }

  return {
    state: "ACTION_REQUIRED_DISPATCH",
    blocker: null,
    primaryLabel: "Dispatch observation",
    primaryEnabled: true,
  };
}

export function deriveStep8(status: EventGoLiveStatus | null): Step8State {
  const s7 = status?.stage7;
  const s8 = status?.stage8;
  const p = status?.platform;
  const armed = p?.automation_state === "ARMED";
  const heartbeatFresh = s8?.readiness_all_ok_and_fresh === true; // best proxy the RPC exposes here
  const cronEvent = s8?.automation_event_certification_status === "live_cron_allowed";
  const automatedMode = p?.current_operating_mode === "AUTOMATED_PRODUCTION";

  if (armed && automatedMode && cronEvent && heartbeatFresh) return "LIVE_AUTOMATED_ARMED";
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

export function deriveLifecycle(
  status: EventGoLiveStatus | null,
  controlledLiveDone: boolean,
  observation: ObservationDerived,
): LifecycleSummary {
  const step6 = deriveStep6(status, controlledLiveDone);
  const step7Mode = deriveStep7Mode(status);
  const step7Cert = deriveStep7EventCertified(status);
  const step8 = deriveStep8(status);

  let lifecycle = "INCOMPLETE";
  let nextAction = "Complete earlier steps first";
  let blocker: string | null = null;

  if (step6 !== "COMPLETED") {
    lifecycle = "STAGE_6_PENDING";
    nextAction = step6 === "LOCKED" ? "Complete Controlled Stub (Step 5)" : "Send & verify one real email";
    blocker = step6 === "LOCKED" ? "STAGE_5_NOT_COMPLETE" : "STAGE_6_NOT_VERIFIED";
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
  } else if (step8 === "LIVE_AUTOMATED_ARMED") {
    lifecycle = "LIVE_AUTOMATED_ARMED";
    nextAction = "None — automation live";
    blocker = null;
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
  LIVE_AUTOMATED_ARMED: "LIVE_AUTOMATED_ARMED",
};
