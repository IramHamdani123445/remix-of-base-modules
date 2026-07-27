/**
 * CH Slice 0 — Readiness RPC schema hotfix.
 *
 * Guarantees:
 *  - runAutomationReadinessProbe surfaces the server's structured
 *    READINESS_SCHEMA_MISMATCH blocker as { ok:false, blocker } rather than
 *    swallowing it or presenting nine "not run" tiles.
 *  - Success responses pass through unchanged.
 *
 * SQL-level guardrails (only executed when PGHOST is available):
 *  - The deployed RPC no longer queries public.communication_hub_operating_mode.
 *  - The RPC does not confuse the audit table with current state.
 *  - Running the probe never toggles operating_mode or arms automation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args: any) => rpcMock(name, args) },
}));

import { runAutomationReadinessProbe } from "@/platform/communication-hub/automationReadinessProbeService";

const HAS_PG = !!process.env.PGHOST || !!process.env.DATABASE_URL;
const CONN = process.env.DATABASE_URL ?? "";
function psql(sql: string): string {
  return execFileSync("psql", [CONN || "postgres://", "-Atc", sql], {
    encoding: "utf8",
    timeout: 30_000,
  }).trim();
}

describe("Slice 0 — readiness probe service envelope", () => {
  beforeEach(() => rpcMock.mockReset());

  it("returns { ok:false, blocker } when server reports READINESS_SCHEMA_MISMATCH", async () => {
    rpcMock.mockResolvedValue({
      data: {
        ok: false,
        blocker: {
          code: "READINESS_SCHEMA_MISMATCH",
          object_name: "communication_hub_operating_mode",
          detail: 'relation "public.communication_hub_operating_mode" does not exist',
          sqlstate: "42P01",
          fix_action: "Redeploy run_comm_hub_automation_readiness_probe.",
        },
      },
      error: null,
    });
    const res = await runAutomationReadinessProbe({
      moduleCode: "APPEALS",
      eventCode: "APPEAL_RECEIVED_NOTICE",
    });
    expect(res.ok).toBe(false);
    if (res.ok === false) {
      expect(res.blocker.code).toBe("READINESS_SCHEMA_MISMATCH");
      expect(res.blocker.object_name).toBe("communication_hub_operating_mode");
      expect(res.blocker.detail).toMatch(/does not exist/);
    }
  });

  it("falls back to the legacy `blockers[]` shape when `blocker` is absent", async () => {
    rpcMock.mockResolvedValue({
      data: {
        ok: false,
        blockers: [{ code: "READINESS_SCHEMA_MISMATCH", detail: "legacy shape" }],
      },
      error: null,
    });
    const res = await runAutomationReadinessProbe({ moduleCode: "M", eventCode: "E" });
    expect(res.ok).toBe(false);
    if (res.ok === false) expect(res.blocker.code).toBe("READINESS_SCHEMA_MISMATCH");
  });

  it("passes success envelopes through unchanged", async () => {
    rpcMock.mockResolvedValue({
      data: {
        ok: true,
        module_code: "APPEALS",
        event_code: "APPEAL_RECEIVED_NOTICE",
        channel: "email",
        configuration_version: 42,
        checked_at: new Date().toISOString(),
        checks: [],
      },
      error: null,
    });
    const res = await runAutomationReadinessProbe({ moduleCode: "APPEALS", eventCode: "E" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.configuration_version).toBe(42);
  });
});

describe("Slice 0 — deployed RPC schema guardrails (DB-backed)", () => {
  it.runIf(HAS_PG)("RPC body no longer queries public.communication_hub_operating_mode", () => {
    const def = psql(
      `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='run_comm_hub_automation_readiness_probe'`,
    );
    // Comments referencing the stale name are allowed; live SQL is not.
    // Strip PL/pgSQL line comments before checking.
    const stripped = def.replace(/--[^\n]*/g, "");
    expect(stripped).not.toMatch(/FROM\s+public\.communication_hub_operating_mode\b/);
    expect(stripped).not.toMatch(/JOIN\s+public\.communication_hub_operating_mode\b/);
  });

  it.runIf(HAS_PG)("does not treat communication_hub_operating_mode_audit as current state", () => {
    const def = psql(
      `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='run_comm_hub_automation_readiness_probe'`,
    );
    const stripped = def.replace(/--[^\n]*/g, "");
    expect(stripped).not.toMatch(/FROM\s+public\.communication_hub_operating_mode_audit\b/);
  });

  it.runIf(HAS_PG)(
    "invoking the probe does not toggle operating_mode or arm automation",
    () => {
      const before = psql(
        `SELECT operating_mode||'|'||automation_state FROM public.communication_hub_control_settings WHERE singleton_guard='primary'`,
      );
      // Call as service_role via psql (bypasses auth.uid checks); we only care
      // that side-effect columns are stable regardless of RPC success/failure.
      try {
        psql(
          `SELECT public.run_comm_hub_automation_readiness_probe('APPEALS','APPEAL_RECEIVED_NOTICE','email')`,
        );
      } catch {
        /* auth-required is fine — we still assert no mutation happened */
      }
      const after = psql(
        `SELECT operating_mode||'|'||automation_state FROM public.communication_hub_control_settings WHERE singleton_guard='primary'`,
      );
      expect(after).toBe(before);
    },
  );

  it.skipIf(HAS_PG)("PG not available — DB guardrails skipped (not silently passing)", () => {
    expect(true).toBe(true);
  });
});
