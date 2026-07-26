/**
 * FINALIZE STEPS 6–9 OPERATOR UX AUTHORITY — resolver contract tests.
 *
 * Prove that:
 *   - Step 6 completion is derived ONLY from EventGoLiveStatus.stage6 evidence.
 *   - The banner/panel share the same pending-observation state.
 *   - The observation action mapping matches spec and TRANSPORT_UNRESOLVED
 *     never resolves to DISPATCH.
 *   - Step 8 never returns LIVE_AUTOMATED_ARMED locally.
 *   - LIVE_AUTOMATED_ARMED comes ONLY from the completion RPC.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => {
  const rpc = vi.fn();
  const functionsInvoke = vi.fn();
  return {
    supabase: {
      rpc,
      functions: { invoke: functionsInvoke },
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: "t" } } }) },
    },
  };
});

import { supabase } from "@/integrations/supabase/client";
import {
  deriveStep6,
  deriveStep8,
  deriveObservation,
  deriveLifecycle,
  composePendingObservationState,
  EMPTY_PENDING_OBSERVATION_STATE,
  OBSERVATION_STATE_TO_ACTION,
} from "../goLiveStateResolver";
import type { EventGoLiveStatus } from "@/platform/communication-hub/eventGoLiveStatusService";
import type { GoLiveCompletion } from "@/platform/communication-hub/goLiveCompletionService";
import {
  runManualProductionObservation,
} from "@/platform/communication-hub/manualProductionObservationService";

const invoke = (supabase.functions.invoke as unknown) as ReturnType<typeof vi.fn>;
const rpc = (supabase.rpc as unknown) as ReturnType<typeof vi.fn>;
beforeEach(() => { invoke.mockReset(); rpc.mockReset(); });

// ---------- fixtures ----------
function baseStatus(overrides: Partial<EventGoLiveStatus> = {}): EventGoLiveStatus {
  return {
    module_code: "APPEALS",
    event_code: "APPEAL_RECEIVED_NOTICE",
    channel: "email",
    evaluated_at: new Date().toISOString(),
    stage6: {
      one_real_email_execution_id: "exec-1",
      one_real_email_certification_id: "cert-1",
      one_real_email_certification_status: "DELIVERY_CONFIRMED_MANUALLY",
      provider_call_attempted: true,
      provider_message_id: "pmid-1",
      delivery_attempt_id: "att-1",
      trace_id: "trace-1",
      manual_verification_status: "CONFIRMED",
      manual_verified_recipient: "ops@example.com",
      manual_verified_at: new Date().toISOString(),
      reconciliation_required: false,
      real_email_gate_enabled: false,
      real_email_gate_id: null,
      latest_one_real_email_certification_id: "cert-1",
      latest_one_real_email_certification_status: "DELIVERY_CONFIRMED_MANUALLY",
      eligible_one_real_email_certification_id: "cert-1",
      eligible_one_real_email_certification_status: "DELIVERY_CONFIRMED_MANUALLY",
      stage6_ready_for_manual_production: true,
      stage6_manual_production_blockers: [],
    },
    stage7: {
      manual_event_certification_id: "mcert-1",
      manual_event_status: "live_manual_only",
      manual_approved_at: new Date().toISOString(),
      manual_approved_by: "admin",
      manual_reason: "pilot",
      drift_detected: false,
      drift_reason: null,
      manual_observation_count: 0,
      latest_manual_observation_id: null,
      latest_manual_observation_message_id: null,
      latest_manual_observation_attempt_id: null,
      latest_manual_observation_trace_id: null,
      latest_manual_observation_status: null,
      latest_manual_observation_inbox: null,
      real_email_gate_closed_at: new Date().toISOString(),
    },
    stage8: {
      automation_event_certification_status: null,
      automation_certified_at: null,
      automation_certified_by: null,
      readiness_checks: [],
      readiness_all_ok_and_fresh: false,
      automated_eligible: false,
      automated_blockers: [],
    },
    platform: {
      current_operating_mode: "MANUAL_PRODUCTION",
      configuration_version: 1,
      automation_state: "STANDBY",
      scheduler_enabled: false,
      automatic_triggers_enabled: false,
      retry_worker_enabled: false,
      batch_enabled: false,
      bulk_enabled: false,
      dispatch_enabled: true,
      eligible_manual_event_count: 1,
      eligible_automated_event_count: 0,
    },
    ...overrides,
  };
}

// ---------- Step 6 ----------
describe("deriveStep6 — server-authoritative only", () => {
  it("returns COMPLETED when all six stage6 evidence fields are present", () => {
    expect(deriveStep6(baseStatus())).toBe("COMPLETED");
  });

  it("clearing sessionStorage does not relock a server-complete Step 6", () => {
    // Simulate the caller having no browser session at all — Step 6 must
    // remain COMPLETED because the server confirms it.
    const s = baseStatus();
    // The function has ONE argument by design (no controlledLiveDone).
    expect(deriveStep6.length).toBe(1);
    expect(deriveStep6(s)).toBe("COMPLETED");
  });

  it("returns ACTION_REQUIRED when reconciliation is required, regardless of other fields", () => {
    const s = baseStatus();
    s.stage6.reconciliation_required = true;
    expect(deriveStep6(s)).toBe("ACTION_REQUIRED");
  });

  it("returns ACTION_REQUIRED when any evidence field is missing", () => {
    const s = baseStatus();
    s.stage6.provider_message_id = null;
    expect(deriveStep6(s)).toBe("ACTION_REQUIRED");
  });
});

// ---------- Observation action mapping ----------
describe("deriveObservation — explicit action per state", () => {
  it("state→action map matches spec", () => {
    expect(OBSERVATION_STATE_TO_ACTION.ACTION_REQUIRED_DISPATCH).toBe("DISPATCH");
    expect(OBSERVATION_STATE_TO_ACTION.RECOVERY_CHECK_IN_PROGRESS).toBe("NONE");
    expect(OBSERVATION_STATE_TO_ACTION.TRANSPORT_UNRESOLVED).toBe("CHECK_RECOVERY");
    expect(OBSERVATION_STATE_TO_ACTION.PROCESSING).toBe("CHECK_RECOVERY");
    expect(OBSERVATION_STATE_TO_ACTION.RECOVERY_REQUIRED_RETRY_FINALIZE).toBe("FINALIZE");
    expect(OBSERVATION_STATE_TO_ACTION.ACTION_REQUIRED_CONFIRM_INBOX).toBe("CONFIRM_INBOX");
    expect(OBSERVATION_STATE_TO_ACTION.COMPLETED).toBe("NONE");
  });

  it("AWAITING_PROVIDER shows FINALIZE (not DISPATCH)", () => {
    const status = baseStatus();
    const pending = composePendingObservationState({
      recovery: {
        hasPending: true, phase: "AWAITING_PROVIDER",
        idempotencyKey: "k", observationId: "o", messageId: "m",
      },
      recovering: false,
      lastResult: null,
    });
    const d = deriveObservation(status, pending);
    expect(d.state).toBe("RECOVERY_REQUIRED_RETRY_FINALIZE");
    expect(d.action).toBe("FINALIZE");
    expect(d.primaryLabel).not.toMatch(/dispatch/i);
  });

  it("AWAITING_INBOX_CONFIRMATION shows CONFIRM_INBOX", () => {
    const status = baseStatus();
    const pending = composePendingObservationState({
      recovery: {
        hasPending: true, phase: "AWAITING_INBOX_CONFIRMATION",
        idempotencyKey: "k", observationId: "o",
      },
      recovering: false,
      lastResult: null,
    });
    const d = deriveObservation(status, pending);
    expect(d.state).toBe("ACTION_REQUIRED_CONFIRM_INBOX");
    expect(d.action).toBe("CONFIRM_INBOX");
    expect(d.blocker).toBe("AWAITING_INBOX_CONFIRMATION");
  });

  it("banner shows RECOVERY_CHECK_IN_PROGRESS while recovering", () => {
    const status = baseStatus();
    const pending = { ...EMPTY_PENDING_OBSERVATION_STATE, recovering: true };
    const d = deriveObservation(status, pending);
    const lifecycle = deriveLifecycle({ status, observation: d, completion: null });
    expect(d.state).toBe("RECOVERY_CHECK_IN_PROGRESS");
    expect(d.action).toBe("NONE");
    expect(lifecycle.blocker).toBe("RECOVERY_CHECK_IN_PROGRESS");
  });

  it("transport-unresolved forces CHECK_RECOVERY (never DISPATCH)", () => {
    const status = baseStatus();
    const pending = composePendingObservationState({
      recovery: { hasPending: false },
      recovering: false,
      lastResult: {
        ok: false, phase: "FAILED",
        transport: { errorClass: "FunctionsFetchError", resolved: false },
      },
      lastIdempotencyKey: "reuse-me",
    });
    const d = deriveObservation(status, pending);
    expect(d.state).toBe("TRANSPORT_UNRESOLVED");
    expect(d.action).toBe("CHECK_RECOVERY");
    expect(pending.idempotency_key).toBe("reuse-me");
  });
});

// ---------- Transport-unresolved recovery via the client wrapper ----------
describe("transport unresolved — recovery path does not send another email", () => {
  it("when Functions transport fails, wrapper calls recovery and does NOT re-invoke dispatch", async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: { name: "FunctionsFetchError", message: "network", context: null },
    });
    rpc.mockResolvedValueOnce({
      data: {
        has_pending: true,
        idempotency_key: "SAME-KEY",
        phase: "AWAITING_PROVIDER",
        observation_id: "obs-x",
        message_id: "msg-x",
      },
      error: null,
    });
    const res = await runManualProductionObservation({
      moduleCode: "APPEALS", eventCode: "APPEAL_RECEIVED_NOTICE",
      recipientEmail: "ops@example.com", idempotencyKey: "SAME-KEY",
    });
    expect(res.recovered).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_comm_hub_observation_recovery", expect.any(Object));
  });
});

// ---------- Step 8 & Stage 9 completion authority ----------
describe("deriveStep8 — heartbeat inference removed", () => {
  it("readiness_all_ok_and_fresh alone cannot produce LIVE_AUTOMATED_ARMED", () => {
    const status = baseStatus({
      stage8: {
        automation_event_certification_status: "live_cron_allowed",
        automation_certified_at: new Date().toISOString(),
        automation_certified_by: "admin",
        readiness_checks: [
          { check_code: "x", result: true, source: "SERVER_PROBE", evidence: {},
            checked_at: new Date().toISOString(), checked_by: null,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            configuration_version: 1, fresh: true } as any,
        ],
        readiness_all_ok_and_fresh: true,
        automated_eligible: true,
        automated_blockers: [],
      },
      platform: {
        ...baseStatus().platform,
        current_operating_mode: "AUTOMATED_PRODUCTION",
        automation_state: "STANDBY", // NOT armed
      },
    });
    // deriveStep8 must not return LIVE_AUTOMATED_ARMED (that state was removed).
    const s8 = deriveStep8(status);
    expect(s8).not.toBe("LIVE_AUTOMATED_ARMED" as any);
    // With cron event + AUTOMATED mode + STANDBY → AUTOMATED_STANDBY.
    expect(s8).toBe("AUTOMATED_STANDBY");
  });

  it("ARMED without post-Arm heartbeat remains ARMED_PENDING_HEARTBEAT locally", () => {
    const status = baseStatus({
      stage8: {
        ...baseStatus().stage8,
        automation_event_certification_status: "live_cron_allowed",
        readiness_all_ok_and_fresh: true,
      },
      platform: {
        ...baseStatus().platform,
        current_operating_mode: "AUTOMATED_PRODUCTION",
        automation_state: "ARMED",
      },
    });
    expect(deriveStep8(status)).toBe("ARMED_PENDING_HEARTBEAT");
  });
});

describe("deriveLifecycle — Stage 9 completion is the only authority for LIVE_AUTOMATED_ARMED", () => {
  const armed = baseStatus({
    platform: { ...baseStatus().platform, current_operating_mode: "AUTOMATED_PRODUCTION", automation_state: "ARMED" },
    stage8: { ...baseStatus().stage8, automation_event_certification_status: "live_cron_allowed", readiness_all_ok_and_fresh: true },
  });
  const observation = deriveObservation(armed, {
    ...EMPTY_PENDING_OBSERVATION_STATE,
    inbox_confirmation_status: "CONFIRMED",
  });

  it("without completion RPC, lifecycle is ARMED_PENDING_HEARTBEAT", () => {
    const life = deriveLifecycle({ status: armed, observation, completion: null });
    expect(life.lifecycle).toBe("ARMED_PENDING_HEARTBEAT");
    expect(life.blocker).toBe("HEARTBEAT_NOT_FRESH");
  });

  it("only completion RPC with is_stage9_complete + outcome=LIVE_AUTOMATED_ARMED promotes to LIVE_AUTOMATED_ARMED", () => {
    const completion: GoLiveCompletion = {
      outcome: "LIVE_AUTOMATED_ARMED",
      is_stage9_complete: true,
      status: armed,
      evaluated_at: new Date().toISOString(),
    };
    const life = deriveLifecycle({ status: armed, observation, completion });
    expect(life.lifecycle).toBe("LIVE_AUTOMATED_ARMED");
    expect(life.blocker).toBeNull();
  });

  it("completion outcome=LIVE_AUTOMATED_ARMED but is_stage9_complete=false does NOT promote", () => {
    const completion: GoLiveCompletion = {
      outcome: "LIVE_AUTOMATED_ARMED",
      is_stage9_complete: false,
      status: armed,
      evaluated_at: new Date().toISOString(),
    };
    const life = deriveLifecycle({ status: armed, observation, completion });
    expect(life.lifecycle).not.toBe("LIVE_AUTOMATED_ARMED");
    expect(life.lifecycle).toBe("ARMED_PENDING_HEARTBEAT");
  });
});
