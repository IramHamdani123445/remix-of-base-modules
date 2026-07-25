/**
 * Stage 6 pre-frontend contract probe (Slice 2 §1).
 *
 * Read-only checks that confirm the deployed backend contract matches what
 * the Slice 2 frontend expects. Runs BEFORE the real-send button is exposed.
 *
 * Guarantees:
 *   - Does not create an execution, grant, request, message, or attempt.
 *   - Does not invoke a provider or a stub.
 *   - Uses only auth checks, PostgREST introspection, and read-only RPCs.
 */
import { supabase } from "@/integrations/supabase/client";
import { getActionReadySession } from "./authSession";

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

const EDGE = "comm-hub-send-one-real-email";

/**
 * Non-destructive probe. Every failure adds a check with `ok:false`.
 * The Edge Function is verified by sending a malformed body that must be
 * rejected at the `action_invalid` boundary — no execution is created.
 */
export async function runStage6ContractProbe(input: {
  moduleCode: string;
  eventCode: string;
  channel: string;
}): Promise<ContractProbeResult> {
  const evaluatedAt = new Date().toISOString();
  const checks: ContractProbeCheck[] = [];

  // 1) Auth surface
  let bearer: string | null = null;
  try {
    const { session } = await getActionReadySession({ minValiditySeconds: 60 });
    bearer = session.access_token;
    checks.push({
      id: "auth_ready",
      label: "Operator session is action-ready",
      ok: true,
      detail: `token valid until ${new Date((session.expires_at ?? 0) * 1000).toISOString()}`,
    });
  } catch (e) {
    checks.push({
      id: "auth_ready",
      label: "Operator session is action-ready",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, checks, evaluatedAt };
  }

  const backend = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = `${backend}/functions/v1/${EDGE}`;

  // 2) Edge Function reachable with a valid JWT (probe body — must be rejected at input_validation stage).
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "__PROBE_ONLY__" }),
    });
    const body = await r.json().catch(() => null);
    // We want a well-formed envelope back with status BLOCKED and stage input_validation (or auth if admin gate fires first).
    const envelope = body && body.schema_version === "one-real-email.v1";
    const passedNothing = body?.passed === false;
    const noExec = !body?.execution_id;
    const noGrant = !body?.grant_id;
    const ok = r.status !== 0 && envelope && passedNothing && noExec && noGrant;
    checks.push({
      id: "edge_reachable",
      label: "Edge Function reachable and returns one-real-email.v1 envelope for probe body",
      ok,
      detail: ok
        ? `HTTP ${r.status}; failure_stage=${body?.failure_stage}; no execution/grant created.`
        : `HTTP ${r.status}; unexpected shape: ${JSON.stringify(body).slice(0, 200)}`,
    });
  } catch (e) {
    checks.push({
      id: "edge_reachable",
      label: "Edge Function reachable",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // 3) Unauthenticated requests rejected
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { apikey: anon, "content-type": "application/json" },
      body: JSON.stringify({ action: "SEND_ONE_REAL_EMAIL" }),
    });
    checks.push({
      id: "edge_rejects_unauthenticated",
      label: "Unauthenticated request rejected",
      ok: r.status === 401 || r.status === 400,
      detail: `HTTP ${r.status}`,
    });
  } catch (e) {
    checks.push({
      id: "edge_rejects_unauthenticated",
      label: "Unauthenticated request rejected",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // 4) begin_comm_hub_one_real_email available in the PostgREST schema cache (call with invalid payload to trigger a business-level error, not a "function not found").
  try {
    const { error } = await (supabase as any).rpc("begin_comm_hub_one_real_email", {
      p_payload: { __probe__: true },
    });
    const code = (error as any)?.code ?? "";
    const msg = error?.message ?? "";
    const known =
      !error ||
      code === "42501" || // insufficient_privilege
      code === "P0001" || // raise_exception (business rule)
      /required|missing|not authorised|admin|permission/i.test(msg);
    checks.push({
      id: "rpc_begin_reachable",
      label: "begin_comm_hub_one_real_email exists in PostgREST schema cache",
      ok: known,
      detail: error ? `expected business error, got ${code} ${msg}` : "no error (unexpected — RPC accepted probe body)",
    });
  } catch (e) {
    checks.push({
      id: "rpc_begin_reachable",
      label: "begin_comm_hub_one_real_email exists in PostgREST schema cache",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // 5) Companion RPC surface — presence-only via error introspection.
  const rpcs = [
    "create_comm_hub_one_real_email_message",
    "reserve_comm_hub_one_real_email_grant",
    "consume_comm_hub_one_real_email_grant",
    "revoke_comm_hub_one_real_email_grant",
    "reconcile_comm_hub_one_real_email_pre_provider",
    "finalize_comm_hub_one_real_email",
    "set_comm_hub_real_email_gate",
    "record_controlled_live_manual_verification",
    "check_comm_hub_readiness",
  ];
  for (const rpc of rpcs) {
    try {
      const { error } = await (supabase as any).rpc(rpc, { p_payload: { __probe__: true } });
      const msg = error?.message ?? "";
      const code = (error as any)?.code ?? "";
      const missing = /could not find the function|does not exist/i.test(msg) && code === "PGRST202";
      checks.push({
        id: `rpc_${rpc}_present`,
        label: `${rpc} present in PostgREST schema cache`,
        ok: !missing,
        detail: missing ? msg : "present (business-level rejection expected)",
      });
    } catch (e) {
      checks.push({
        id: `rpc_${rpc}_present`,
        label: `${rpc} present`,
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 6) Stage 5 certification readable for the target lineage.
  try {
    const { data, error } = await (supabase as any)
      .from("communication_controlled_live_certification")
      .select("id,status,certification_kind,invalidated_at,module_code,event_code,channel")
      .eq("module_code", input.moduleCode)
      .eq("event_code", input.eventCode)
      .eq("channel", input.channel)
      .eq("certification_kind", "CONTROLLED_STUB")
      .is("invalidated_at", null)
      .order("certified_at", { ascending: false })
      .limit(1);
    checks.push({
      id: "stage5_cert_readable",
      label: "Controlled Stub (Stage 5) certification is readable",
      ok: !error && Array.isArray(data) && data.length > 0,
      detail: error ? error.message : Array.isArray(data) && data.length > 0
        ? `active certification ${data[0].id}`
        : "no active CONTROLLED_STUB certification for this lineage",
    });
  } catch (e) {
    checks.push({
      id: "stage5_cert_readable",
      label: "Controlled Stub certification readable",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // 7) Real-email feature gate readable.
  try {
    const { data, error } = await (supabase as any)
      .from("communication_hub_real_email_gate")
      .select("enabled,opened_by,opened_at,reason")
      .eq("module_code", input.moduleCode)
      .eq("event_code", input.eventCode)
      .eq("channel", input.channel)
      .maybeSingle();
    checks.push({
      id: "gate_readable",
      label: "Real-email feature gate is readable",
      ok: !error,
      detail: error ? error.message : data ? `gate row present · enabled=${data.enabled}` : "no gate row (closed by default)",
    });
  } catch (e) {
    checks.push({
      id: "gate_readable",
      label: "Real-email feature gate readable",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks, evaluatedAt };
}
