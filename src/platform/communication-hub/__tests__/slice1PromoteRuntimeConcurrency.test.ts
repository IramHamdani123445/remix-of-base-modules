/**
 * Slice 1 — service-contract tests for runtime_mode_version concurrency
 * inside promote_comm_hub_event_to_manual_production and for the
 * normalization result shape.
 *
 * These tests deliberately exercise only the client contract. Server-side
 * DB-backed proofs (mode-only mutation preserves ORE evidence, actual
 * transition increments runtime_mode_version, stale arm cleared, etc.) run
 * against the migration via psql and are reported in the acceptance block.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import { promoteEventToManualProduction } from "../manualProductionContinuityService";

describe("Slice 1 — promote runtime_mode_version concurrency contract", () => {
  beforeEach(() => rpcMock.mockReset());

  it("returns RUNTIME_MODE_VERSION_CONFLICT without mutating on version mismatch", async () => {
    rpcMock.mockResolvedValue({
      data: {
        ok: false,
        phase: "RUNTIME_MODE_VERSION_CONFLICT",
        expected_runtime_mode_version: 41,
        current_runtime_mode_version: 44,
        configuration_version: 44,
        current_operating_mode: "MANUAL_PRODUCTION",
        next_action: "REFRESH_AND_RECONCILE",
      },
      error: null,
    });
    const res = await promoteEventToManualProduction({
      moduleCode: "APPEALS",
      eventCode: "APPEAL_RECEIVED_NOTICE",
      reason: "stale expected version",
      typedConfirmation: "CERTIFY MANUAL PRODUCTION",
      expectedRuntimeModeVersion: 41,
    });
    expect(res.ok).toBe(false);
    expect(res.phase).toBe("RUNTIME_MODE_VERSION_CONFLICT");
    expect(res.next_action).toBe("REFRESH_AND_RECONCILE");
    expect(res.expected_runtime_mode_version).toBe(41);
    expect(res.current_runtime_mode_version).toBe(44);
    // Client never retries — a conflict is a terminal, non-mutating response
    // and the RPC must have been called exactly once.
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("returns idempotent no_change=true when controls are already normalized", async () => {
    rpcMock.mockResolvedValue({
      data: {
        ok: true,
        idempotent: true,
        no_change: true,
        next_action: "DISPATCH_MANUAL_OBSERVATION",
        event_status: "live_manual_only",
        controls_normalized: true,
        changed_fields: [],
        runtime_mode_version: 44,
        configuration_version: 44,
        automation_generation: 0,
        operating_mode: "MANUAL_PRODUCTION",
        automation_state: "STANDBY",
      },
      error: null,
    });
    const res = await promoteEventToManualProduction({
      moduleCode: "APPEALS",
      eventCode: "APPEAL_RECEIVED_NOTICE",
      reason: "already normalized",
      typedConfirmation: "CERTIFY MANUAL PRODUCTION",
      expectedRuntimeModeVersion: 44,
    });
    expect(res.ok).toBe(true);
    expect(res.no_change).toBe(true);
    expect(res.idempotent).toBe(true);
    expect(res.changed_fields).toEqual([]);
    expect(res.operating_mode).toBe("MANUAL_PRODUCTION");
    expect(res.automation_state).toBe("STANDBY");
  });

  it("returns changed_fields on same-mode normalization", async () => {
    rpcMock.mockResolvedValue({
      data: {
        ok: true,
        no_change: false,
        next_action: "DISPATCH_MANUAL_OBSERVATION",
        event_status: "live_manual_only",
        controls_normalized: true,
        changed_fields: ["scheduler_enabled", "batch_enabled"],
        runtime_mode_version: 44,
        configuration_version: 45,
        automation_generation: 0,
        operating_mode: "MANUAL_PRODUCTION",
        automation_state: "STANDBY",
      },
      error: null,
    });
    const res = await promoteEventToManualProduction({
      moduleCode: "APPEALS",
      eventCode: "APPEAL_RECEIVED_NOTICE",
      reason: "normalize scheduler/batch",
      typedConfirmation: "CERTIFY MANUAL PRODUCTION",
      expectedRuntimeModeVersion: 44,
    });
    expect(res.ok).toBe(true);
    expect(res.changed_fields).toEqual(["scheduler_enabled", "batch_enabled"]);
    // configuration_version incremented; runtime_mode_version unchanged.
    expect(res.configuration_version).toBe(45);
    expect(res.runtime_mode_version).toBe(44);
  });

  it("passes expected_runtime_mode_version into the correct RPC parameter, never into p_expected_version", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    await promoteEventToManualProduction({
      moduleCode: "APPEALS",
      eventCode: "APPEAL_RECEIVED_NOTICE",
      reason: "check argument contract",
      typedConfirmation: "CERTIFY MANUAL PRODUCTION",
      expectedRuntimeModeVersion: 44,
    });
    const args = rpcMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args.p_expected_runtime_mode_version).toBe(44);
    // Guard against ever re-introducing the legacy misuse:
    expect(args).not.toHaveProperty("p_expected_version");
  });
});
