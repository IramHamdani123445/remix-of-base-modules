import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import {
  reconcileManualProductionEntry,
  promoteEventToManualProduction,
  checkManualObservationEligibility,
} from "../manualProductionContinuityService";

describe("manualProductionContinuityService", () => {
  beforeEach(() => rpcMock.mockReset());

  it("reconcile returns READY_TO_DISPATCH with runtime_mode_version", async () => {
    rpcMock.mockResolvedValue({
      data: { status: "READY_TO_DISPATCH", certification_row_id: "c1", event_status: "live_manual_only", runtime_mode_version: 42 },
      error: null,
    });
    const res = await reconcileManualProductionEntry({ moduleCode: "APPEALS", eventCode: "APPEAL_RECEIVED_NOTICE" });
    expect(rpcMock).toHaveBeenCalledWith("reconcile_comm_hub_manual_production_entry", {
      p_module_code: "APPEALS",
      p_event_code: "APPEAL_RECEIVED_NOTICE",
      p_channel: "email",
    });
    expect(res.status).toBe("READY_TO_DISPATCH");
    expect(res.runtime_mode_version).toBe(42);
  });

  it("reconcile surfaces EMERGENCY_STOP_ACTIVE and PENDING_OBSERVATION_RECOVERY", async () => {
    rpcMock.mockResolvedValueOnce({ data: { status: "EMERGENCY_STOP_ACTIVE" }, error: null });
    const stop = await reconcileManualProductionEntry({ moduleCode: "M", eventCode: "E" });
    expect(stop.status).toBe("EMERGENCY_STOP_ACTIVE");

    rpcMock.mockResolvedValueOnce({
      data: { status: "PENDING_OBSERVATION_RECOVERY", intent_id: "i1", phase: "ENQUEUED" },
      error: null,
    });
    const pending = await reconcileManualProductionEntry({ moduleCode: "M", eventCode: "E" });
    expect(pending.status).toBe("PENDING_OBSERVATION_RECOVERY");
    expect(pending.phase).toBe("ENQUEUED");
  });

  it("reconcile flags EVIDENCE_DRIFT_REQUIRES_RETEST with stored/current fingerprints", async () => {
    rpcMock.mockResolvedValue({
      data: {
        status: "EVIDENCE_DRIFT_REQUIRES_RETEST",
        stored: "old-fp",
        current: "new-fp",
        current_v2: "new-fp-v2",
      },
      error: null,
    });
    const res = await reconcileManualProductionEntry({ moduleCode: "M", eventCode: "E" });
    expect(res.status).toBe("EVIDENCE_DRIFT_REQUIRES_RETEST");
    expect(res.stored).toBe("old-fp");
    expect(res.current_v2).toBe("new-fp-v2");
  });

  it("promote passes expected_runtime_mode_version + typed confirmation and returns next_action", async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, next_action: "DISPATCH_MANUAL_OBSERVATION" },
      error: null,
    });
    const res = await promoteEventToManualProduction({
      moduleCode: "APPEALS",
      eventCode: "APPEAL_RECEIVED_NOTICE",
      reason: "reconcile after mode-only change",
      typedConfirmation: "CERTIFY MANUAL PRODUCTION",
      expectedRuntimeModeVersion: 42,
      oneRealEmailCertificationId: "cert-1",
    });
    expect(res.ok).toBe(true);
    expect(res.next_action).toBe("DISPATCH_MANUAL_OBSERVATION");
    expect(rpcMock).toHaveBeenCalledWith(
      "promote_comm_hub_event_to_manual_production",
      expect.objectContaining({
        p_expected_runtime_mode_version: 42,
        p_typed_confirmation: "CERTIFY MANUAL PRODUCTION",
        p_one_real_email_certification_id: "cert-1",
      }),
    );
  });

  it("eligibility reports blockers for missing certification and unresolved observation", async () => {
    rpcMock.mockResolvedValue({
      data: {
        eligible: false,
        blockers: [
          { code: "EVENT_NOT_CERTIFIED" },
          { code: "UNRESOLVED_OBSERVATION_INTENT", intent_id: "i1", phase: "ENQUEUED" },
        ],
        runtime_mode_version: 7,
        operating_mode: "MANUAL_PRODUCTION",
      },
      error: null,
    });
    const res = await checkManualObservationEligibility({ moduleCode: "M", eventCode: "E" });
    expect(res.eligible).toBe(false);
    expect(res.blockers.map((b) => b.code)).toEqual([
      "EVENT_NOT_CERTIFIED",
      "UNRESOLVED_OBSERVATION_INTENT",
    ]);
    expect(res.runtime_mode_version).toBe(7);
  });

  it("eligibility permits dispatch when all conditions are met", async () => {
    rpcMock.mockResolvedValue({
      data: {
        eligible: true,
        blockers: [],
        operating_mode: "MANUAL_PRODUCTION",
        event_status: "live_manual_only",
        evidence_fingerprint: "fp-1",
        runtime_mode_version: 11,
      },
      error: null,
    });
    const res = await checkManualObservationEligibility({ moduleCode: "M", eventCode: "E" });
    expect(res.eligible).toBe(true);
    expect(res.blockers).toHaveLength(0);
    expect(res.event_status).toBe("live_manual_only");
  });
});
