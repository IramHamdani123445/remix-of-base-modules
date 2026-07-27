/**
 * Controlled Revalidation — canonical atomic preparation runtime (A4.1.3).
 *
 * This Edge Function is service-role only and NEVER contacts an email
 * provider. Provider boundary remains sealed until A4.2. All durable
 * evidence (request / recipient / message / trace / trace-step / delivery
 * attempt) is created inside ONE database transaction by the canonical
 * RPC `_comm_hub_revalidation_prepare_delivery`. If any step fails the
 * sub-transaction is rolled back and the execution row is transitioned
 * to FAILED_PRE_PROVIDER — no orphans.
 *
 * Actions:
 *   - PREPARE_CONTROLLED_REVALIDATION           — canonical atomic prepare
 *   - RETRY_CONTROLLED_REVALIDATION_PREPARATION — new preparation version
 *   - RECOVER_CONTROLLED_REVALIDATION_PREPARATION — admin no-send recovery
 *   - SEND_CONTROLLED_REVALIDATION_EMAIL        — HARD STOP (403)
 *   - probe                                     — no-side-effect health probe
 */
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ACTION_PREPARE = "PREPARE_CONTROLLED_REVALIDATION";
const ACTION_RETRY = "RETRY_CONTROLLED_REVALIDATION_PREPARATION";
const ACTION_RECOVER = "RECOVER_CONTROLLED_REVALIDATION_PREPARATION";
const ACTION_SEND = "SEND_CONTROLLED_REVALIDATION_EMAIL";
const ACTION_PROBE = "probe";
const RUNTIME_BUILD = "comm-hub-send-controlled-revalidation@2026-07-27-a4.1.3-atomic";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}
const errStr = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Envelope {
  schema_version: "controlled-revalidation.v2";
  runtime_build: string;
  action: string;
  status:
    | "READY_FOR_PROVIDER" | "FAILED_PRE_PROVIDER" | "RECOVERY_REQUIRED"
    | "RECOVERED" | "BLOCKED";
  passed: boolean;
  send_context: "CONTROLLED_REVALIDATION";
  cycle_id: string | null;
  authorisation_id: string | null;
  execution_id: string | null;
  request_id: string | null;
  message_id: string | null;
  recipient_id: string | null;
  trace_id: string | null;
  delivery_attempt_id: string | null;
  preparation_version: number | null;
  canonical_idempotency_key: string | null;
  reused_existing_execution: boolean;
  provider_boundary_state: "NOT_ENTERED";
  provider_call_attempted: false;
  message: string;
  blockers: Array<{ code: string; stage?: string; message?: string; detail?: unknown }>;
  warnings: unknown[];
  failure_code: string | null;
  failure_detail: unknown | null;
  started_at: string;
  completed_at: string | null;
}

function emptyEnvelope(action: string, started: string): Envelope {
  return {
    schema_version: "controlled-revalidation.v2",
    runtime_build: RUNTIME_BUILD,
    action, status: "BLOCKED", passed: false,
    send_context: "CONTROLLED_REVALIDATION",
    cycle_id: null, authorisation_id: null, execution_id: null,
    request_id: null, message_id: null, recipient_id: null,
    trace_id: null, delivery_attempt_id: null,
    preparation_version: null, canonical_idempotency_key: null,
    reused_existing_execution: false,
    provider_boundary_state: "NOT_ENTERED",
    provider_call_attempted: false,
    message: "", blockers: [], warnings: [],
    failure_code: null, failure_detail: null,
    started_at: started, completed_at: null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const started = new Date().toISOString();
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const action: string = body.action ?? "";
  const env = emptyEnvelope(action, started);

  const addBlocker = (code: string, stage: string, message?: string, detail?: unknown) => {
    if (!env.blockers.some((b) => b.code === code && b.stage === stage)) {
      env.blockers.push({ code, stage, ...(message ? { message } : {}), ...(detail !== undefined ? { detail } : {}) });
    }
  };
  const finalize = (status: Envelope["status"], http = 200, message?: string): Response => {
    env.status = status;
    env.passed = status === "READY_FOR_PROVIDER" || status === "RECOVERED";
    if (message) env.message = message;
    env.completed_at = new Date().toISOString();
    return json(env, http);
  };

  if (action === ACTION_PROBE) return finalize("RECOVERED", 200, "probe_ok");

  if (![ACTION_PREPARE, ACTION_RETRY, ACTION_RECOVER, ACTION_SEND].includes(action)) {
    addBlocker("action_invalid", "input_validation",
      `action must be one of ${ACTION_PREPARE}, ${ACTION_RETRY}, ${ACTION_RECOVER}, ${ACTION_SEND}, or ${ACTION_PROBE}`);
    return finalize("BLOCKED", 400);
  }

  // ---- Auth (JWT-pinned Comm Hub admin) ----
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ") || authHeader.length < 10) {
    addBlocker("authentication_header_missing", "auth");
    return finalize("BLOCKED", 401);
  }
  const bearer = authHeader.slice("Bearer ".length).trim();
  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  let operatorId: string | null = null;
  try {
    const { data, error } = await authClient.auth.getUser(bearer);
    if (error || !data?.user?.id) {
      addBlocker("authentication_token_invalid", "auth", error?.message);
      return finalize("BLOCKED", 401);
    }
    operatorId = data.user.id;
  } catch (e) {
    addBlocker("authentication_service_unavailable", "auth", errStr(e));
    return finalize("BLOCKED", 503);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Prove operator is a Comm Hub admin as seen by PostgREST.
  {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_comm_hub_request_auth_context`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: ANON_KEY,
                   Authorization: `Bearer ${bearer}` },
        body: "{}",
      });
    const ctx = await r.json().catch(() => ({} as any));
    if (!r.ok || ctx?.authenticated !== true || ctx?.comm_hub_admin !== true) {
      addBlocker("not_authorised", "auth",
        "Communication Hub administrator authority is required.",
        { rpc_auth_uid: ctx?.auth_uid, expected_operator_id: operatorId });
      return finalize("BLOCKED", 403);
    }
    if (ctx.auth_uid !== operatorId) {
      addBlocker("operator_identity_mismatch", "auth");
      return finalize("BLOCKED", 400);
    }
  }

  // ============================================================
  // HARD STOP — provider boundary not approved
  // ============================================================
  if (action === ACTION_SEND) {
    addBlocker("provider_boundary_not_approved", "provider_boundary",
      "SEND is disabled until the A4.2 provider-boundary runtime is approved. No provider was contacted. Authorisation preserved.");
    return finalize("BLOCKED", 403,
      "SEND is disabled. Provider boundary not approved. No email has been sent. Authorisation preserved.");
  }

  const cycleId: string = body.cycleId ?? body.cycle_id ?? "";
  const authorisationId: string = body.authorisationId ?? body.authorisation_id ?? "";
  if (!cycleId) {
    addBlocker("missing_parameters", "input_validation", "cycleId is required");
    return finalize("BLOCKED", 400);
  }
  env.cycle_id = cycleId;
  env.authorisation_id = authorisationId || null;

  // ============================================================
  // RECOVER — dedicated no-send admin recovery path
  // ============================================================
  if (action === ACTION_RECOVER) {
    const executionId: string = body.executionId ?? body.execution_id ?? "";
    const reason: string = String(body.reason ?? "").trim();
    if (!executionId) {
      addBlocker("missing_parameters", "input_validation",
        "executionId is required for recovery");
      return finalize("BLOCKED", 400);
    }
    const { data, error } = await admin.rpc(
      "_comm_hub_revalidation_recover_execution",
      { p_execution_id: executionId, p_admin_id: operatorId, p_reason: reason });
    if (error) {
      addBlocker(String((error as any).code ?? "recovery_failed"), "recovery",
        error.message);
      return finalize("BLOCKED", 400);
    }
    env.execution_id = (data as any)?.execution_id ?? executionId;
    return finalize("RECOVERED", 200,
      "Recovery-required execution transitioned to VOIDED. A fresh preparation may now start. No email has been sent.");
  }

  // ============================================================
  // PREPARE / RETRY — atomic canonical preparation (no provider)
  // ============================================================
  if (!authorisationId) {
    addBlocker("missing_parameters", "input_validation",
      "authorisationId is required to prepare");
    return finalize("BLOCKED", 400);
  }

  const { data, error } = await admin.rpc(
    "_comm_hub_revalidation_prepare_delivery",
    {
      p_cycle_id: cycleId,
      p_authorisation_id: authorisationId,
      p_operator_id: operatorId,
      p_runtime_build: RUNTIME_BUILD,
    });
  if (error) {
    addBlocker(String((error as any).code ?? "prepare_rpc_failed"), "execution",
      error.message);
    return finalize("BLOCKED", 500,
      "Atomic preparation RPC failed. No email has been sent.");
  }
  const r = (data ?? {}) as any;
  env.execution_id            = r.execution_id ?? null;
  env.request_id              = r.request_id ?? null;
  env.message_id              = r.message_id ?? null;
  env.recipient_id            = r.recipient_id ?? null;
  env.trace_id                = r.trace_id ?? null;
  env.delivery_attempt_id     = r.delivery_attempt_id ?? null;
  env.preparation_version     = r.preparation_version ?? null;
  env.canonical_idempotency_key = r.canonical_idempotency_key ?? null;
  env.reused_existing_execution = !!r.reused;
  env.blockers = Array.isArray(r.blockers) ? r.blockers : [];
  env.warnings = Array.isArray(r.warnings) ? r.warnings : [];
  env.failure_code   = r.failure_code ?? null;
  env.failure_detail = r.failure_detail ?? null;

  if (r.ok === true) {
    return finalize("READY_FOR_PROVIDER", 200,
      env.reused_existing_execution
        ? "Existing atomic preparation reused. No email has been sent."
        : "Atomic preparation complete. No email has been sent. Provider delivery remains disabled until the provider-boundary runtime is approved.");
  }

  // Not-OK envelope from RPC.
  if (r.state === "FAILED_PRE_PROVIDER") {
    return finalize("FAILED_PRE_PROVIDER", 500,
      "Atomic preparation failed before any provider call. Authorisation preserved. Dependent evidence rolled back. No orphans.");
  }
  if (r.state === "RECOVERY_REQUIRED"
      || env.blockers.some((b) => b.code === "recovery_required")) {
    return finalize("RECOVERY_REQUIRED", 409,
      "An execution requires admin recovery before a new preparation may start.");
  }
  return finalize("BLOCKED", 400,
    "Atomic preparation blocked. No email has been sent. Authorisation preserved.");
});
