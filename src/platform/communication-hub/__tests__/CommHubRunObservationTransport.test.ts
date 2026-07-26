/**
 * Client-observable transport contract for
 * comm-hub-run-manual-production-observation.
 *
 * Covers the FunctionsFetchError / FunctionsHttpError / structured-blocker
 * distinction, runtime build surfacing, idempotency-key preservation on
 * transport failure, and the non-sending probe action.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => {
  const invoke = vi.fn();
  const rpc = vi.fn();
  return { supabase: { functions: { invoke }, rpc, auth: {} } };
});

import { supabase } from "@/integrations/supabase/client";
import {
  runManualProductionObservation,
  probeManualProductionObservation,
} from "@/platform/communication-hub/manualProductionObservationService";

const invoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;
const rpc = (supabase as any).rpc as ReturnType<typeof vi.fn>;

beforeEach(() => { invoke.mockReset(); rpc.mockReset(); });

describe("comm-hub-run-manual-production-observation client transport", () => {
  it("probe returns runtime build without sending", async () => {
    invoke.mockResolvedValueOnce({
      data: { ok: true, runtime_build: "comm-hub-run-manual-production-observation@2026-07-26-admin-param-and-transport-fix", probe: { reachable: true, admin_param_contract: "_uid" } },
      error: null,
    });
    const res = await probeManualProductionObservation({ moduleCode: "BN", eventCode: "AWARD_APPROVED" });
    expect(res.ok).toBe(true);
    expect(res.runtimeBuild).toContain("admin-param-and-transport-fix");
    expect(res.probe.admin_param_contract).toBe("_uid");
    // Probe body carries action=probe
    expect((invoke.mock.calls[0][1] as any).body.action).toBe("probe");
  });

  it("surfaces a structured business blocker with runtime build", async () => {
    const headers = new Map<string, string>([
      ["x-comm-hub-runtime-build", "comm-hub-run-manual-production-observation@2026-07-26-admin-param-and-transport-fix"],
    ]);
    invoke.mockResolvedValueOnce({
      data: null,
      error: {
        name: "FunctionsHttpError",
        message: "conflict",
        context: {
          status: 409,
          headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
          clone: () => ({
            json: async () => ({ ok: false, runtime_build: "comm-hub-run-manual-production-observation@2026-07-26-admin-param-and-transport-fix", blockers: [{ code: "recipient_policy_empty" }] }),
          }),
        },
      },
    });
    const res = await runManualProductionObservation({
      moduleCode: "BN", eventCode: "AWARD_APPROVED", recipientEmail: "u@x.com", idempotencyKey: "k-1",
    });
    expect(res.ok).toBe(false);
    expect(res.blockers?.[0].code).toBe("recipient_policy_empty");
    expect(res.transport?.errorClass).toBe("FunctionsHttpError");
    expect(res.transport?.httpStatus).toBe(409);
    expect(res.transport?.resolved).toBe(true);
  });

  it("on FunctionsFetchError with no body, recovers by idempotency key without redispatching", async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: { name: "FunctionsFetchError", message: "network" },
    });
    // getObservationRecovery -> rpc
    rpc.mockResolvedValueOnce({
      data: {
        has_pending: true,
        idempotency_key: "k-abc",
        phase: "AWAITING_PROVIDER",
        message_id: "msg-1",
        request_id: "req-1",
        observation_id: null,
        inbox_confirmation_status: null,
        recipient_email: "u@x.com",
        created_at: new Date().toISOString(),
      },
      error: null,
    });
    const res = await runManualProductionObservation({
      moduleCode: "BN", eventCode: "AWARD_APPROVED", recipientEmail: "u@x.com", idempotencyKey: "k-abc",
    });
    expect(res.recovered).toBe(true);
    expect(res.phase).toBe("AWAITING_PROVIDER");
    expect(res.message_id).toBe("msg-1");
    expect(res.transport?.resolved).toBe(true);
    // No second invoke happened — only recovery RPC.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("on FunctionsFetchError with no matching recovery, marks transport unresolved", async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: { name: "FunctionsFetchError", message: "network" },
    });
    rpc.mockResolvedValueOnce({ data: { has_pending: false }, error: null });
    const res = await runManualProductionObservation({
      moduleCode: "BN", eventCode: "AWARD_APPROVED", recipientEmail: "u@x.com", idempotencyKey: "k-2",
    });
    expect(res.ok).toBe(false);
    expect(res.transport?.errorClass).toBe("FunctionsFetchError");
    expect(res.transport?.resolved).toBe(false);
    expect(res.blockers?.[0].code).toBe("invoke_failed");
  });
});
