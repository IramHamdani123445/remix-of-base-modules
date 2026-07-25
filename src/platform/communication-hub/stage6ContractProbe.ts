/**
 * Stage 6 pre-frontend contract probe (Slice 2 §2 — repaired).
 *
 * Signature-only probe. Delegates entirely to the read-only server RPC
 * `probe_comm_hub_one_real_email_contracts`, which uses `to_regprocedure`
 * to verify each backend function's exact identity.
 *
 * Guarantees:
 *   - creates no execution
 *   - creates no grant
 *   - creates no request/message/attempt
 *   - performs no provider call
 *   - reports every missing exact signature as its own check
 *
 * Every check ID intentionally mirrors the underlying function name so
 * callers can pin assertions in tests.
 */
import { supabase } from "@/integrations/supabase/client";

export interface ContractProbeCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface ContractProbeResult {
  ok: boolean;
  checks: ContractProbeCheck[];
  evaluatedAt: string;
}

interface ProbeRow {
  id: string;
  signature: string;
  present: boolean;
}

export async function runStage6ContractProbe(_input?: {
  moduleCode?: string;
  eventCode?: string;
  channel?: string;
}): Promise<ContractProbeResult> {
  const { data, error } = await (supabase as any).rpc(
    "probe_comm_hub_one_real_email_contracts",
  );
  if (error) {
    return {
      ok: false,
      checks: [
        {
          id: "probe_rpc",
          label: "probe_comm_hub_one_real_email_contracts is callable",
          ok: false,
          detail: error.message ?? String(error),
        },
      ],
      evaluatedAt: new Date().toISOString(),
    };
  }
  const payload = (data ?? {}) as {
    ok?: boolean;
    checks?: ProbeRow[];
    evaluated_at?: string;
  };
  const rows = Array.isArray(payload.checks) ? payload.checks : [];
  const checks: ContractProbeCheck[] = rows.map((r) => ({
    id: r.id,
    label: `${r.id} — exact signature required`,
    ok: r.present === true,
    detail: r.present
      ? `present · ${r.signature}`
      : `MISSING · expected ${r.signature}`,
  }));
  return {
    ok: payload.ok === true && checks.every((c) => c.ok),
    checks,
    evaluatedAt: payload.evaluated_at ?? new Date().toISOString(),
  };
}
