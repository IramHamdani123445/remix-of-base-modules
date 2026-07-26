/**
 * Checkpoint 0 — void_comm_hub_manual_production_observation client contract.
 *
 * Authoritative server predicates are covered here as consumed by the client
 * wrapper. `dispatched_at` alone (NOT NULL DEFAULT now()) is NOT provider
 * evidence; real linkage (request/message/attempt/trace/provider/
 * provider_message_id/provider_call_attempted) blocks the void.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => {
  const rpc = vi.fn();
  return { supabase: { rpc, auth: { getSession: vi.fn() } } };
});

import { supabase } from "@/integrations/supabase/client";
import { voidManualProductionObservation } from "@/platform/communication-hub/manualProductionObservationService";

const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => rpc.mockReset());

describe("void_comm_hub_manual_production_observation — client contract", () => {
  it("voids an empty observation whose only server-side timestamp is the default dispatched_at", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        ok: true,
        observation_id: "obs-1",
        observation_status: "SUPERSEDED",
        intent_idempotency_key: "mprod-obs-abc",
        intent_phase: "VOIDED",
        provider_evidence_found: false,
        audit_id: "aud-1",
      },
      error: null,
    });
    const r = await voidManualProductionObservation({
      observationId: "obs-1", reason: "empty checkpoint 0", confirmation: "VOID EMPTY OBSERVATION",
    });
    expect(r.ok).toBe(true);
    expect(r.observationStatus).toBe("SUPERSEDED");
    expect(r.intentPhase).toBe("VOIDED");
    expect(r.providerEvidenceFound).toBe(false);
    expect(r.auditId).toBe("aud-1");
  });

  it.each([
    ["delivery_attempt_id present",  "observation_has_provider_evidence"],
    ["delivery attempt row exists",  "observation_has_provider_evidence"],
    ["provider_call_attempted=true", "observation_has_provider_evidence"],
    ["provider_message_id set",      "observation_has_provider_evidence"],
    ["real request_id linkage",      "observation_has_provider_evidence"],
    ["real message_id linkage",      "observation_has_provider_evidence"],
    ["trace_id set",                 "observation_has_provider_evidence"],
    ["provider_id set",              "observation_has_provider_evidence"],
  ])("refuses to void when %s (surfaces %s)", async (_label, code) => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: code } });
    const r = await voidManualProductionObservation({
      observationId: "obs-9", reason: "attempted", confirmation: "VOID EMPTY OBSERVATION",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(code);
  });

  it("is idempotent when the observation is already SUPERSEDED", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        ok: true, idempotent: true,
        observation_id: "obs-2", observation_status: "SUPERSEDED",
        provider_evidence_found: false,
      },
      error: null,
    });
    const r = await voidManualProductionObservation({
      observationId: "obs-2", reason: "re-void", confirmation: "VOID EMPTY OBSERVATION",
    });
    expect(r.ok).toBe(true);
    expect(r.idempotent).toBe(true);
  });

  it("enforces the exact confirmation phrase", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "confirmation_phrase_mismatch" } });
    const r = await voidManualProductionObservation({
      observationId: "obs-3", reason: "typo", confirmation: "void empty observation",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("confirmation_phrase_mismatch");
  });

  it("recovery excludes VOIDED (server contract): has_pending=false after void", async () => {
    rpc.mockResolvedValueOnce({ data: { ok: true, has_pending: false }, error: null });
    const { data } = await (supabase as any).rpc("get_comm_hub_observation_recovery", {
      p_module_code: "APPEALS", p_event_code: "APPEAL_RECEIVED_NOTICE", p_channel: "email",
    });
    expect(data.has_pending).toBe(false);
  });

  it("SUPERSEDED observations do not count as CONFIRMED Manual Production evidence", async () => {
    // Evidence RPC returns a non-CONFIRMED status for a superseded row.
    rpc.mockResolvedValueOnce({
      data: {
        ok: true,
        evidence: { observation_id: "obs-1", observation_status: "SUPERSEDED", inbox_confirmation_status: null },
      },
      error: null,
    });
    const { data } = await (supabase as any).rpc("get_comm_hub_manual_production_evidence", {
      p_observation_id: "obs-1",
    });
    expect(data.evidence.observation_status).not.toBe("CONFIRMED");
    expect(data.evidence.inbox_confirmation_status).toBeNull();
  });
});
