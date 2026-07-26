/**
 * Stage 6 finalization RECOVERY endpoint.
 *
 * This endpoint NEVER sends an email.
 * It exists exclusively to recover an already-sent Stage 6 execution whose
 * `finalize_comm_hub_one_real_email` call failed after the provider had
 * already accepted the message (e.g., the historical UUID/jsonb bug).
 *
 * Guarantees:
 *   - never begins a new execution
 *   - never creates a new grant, message, or delivery attempt
 *   - never invokes the provider or a provider lookup
 *   - binds a fresh trace row if the execution has none
 *   - delegates to the corrected finalizer only
 *   - fully idempotent: if a certification already exists, returns it as-is
 */

// deno-lint-ignore-file no-explicit-any

import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const RUNTIME_BUILD =
  "comm-hub-resume-one-real-email-finalization@2026-07-26-admin-flag-fix";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return json(
      { ok: false, runtime_build: RUNTIME_BUILD, error: "method_not_allowed" },
      405,
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!bearer) {
    return json(
      {
        ok: false,
        runtime_build: RUNTIME_BUILD,
        error: "authentication_required",
      },
      401,
    );
  }

  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify operator identity + admin capability via SECURITY DEFINER RPC.
  const { data: userInfo, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userInfo?.user) {
    return json(
      {
        ok: false,
        runtime_build: RUNTIME_BUILD,
        error: "invalid_operator_jwt",
        detail: userErr?.message ?? "no user for token",
      },
      401,
    );
  }

  // Identity/admin check — same shape as the send function.
  const { data: authCtx, error: ctxErr } = await authClient.rpc(
    "get_comm_hub_request_auth_context",
  );
  const ctxAny = authCtx as any;
  const isAdmin = ctxAny?.is_admin === true || ctxAny?.comm_hub_admin === true;
  if (ctxErr || !authCtx || !isAdmin) {
    return json(
      {
        ok: false,
        runtime_build: RUNTIME_BUILD,
        error: "admin_role_required",
        detail: ctxErr?.message ?? "operator is not an admin",
        auth_context: authCtx ?? null,
      },
      403,
    );
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return json(
      {
        ok: false,
        runtime_build: RUNTIME_BUILD,
        error: "invalid_json_body",
      },
      400,
    );
  }

  const executionId: string | null =
    typeof body?.executionId === "string"
      ? body.executionId
      : typeof body?.execution_id === "string"
        ? body.execution_id
        : null;

  if (!executionId) {
    return json(
      {
        ok: false,
        runtime_build: RUNTIME_BUILD,
        error: "execution_id_required",
      },
      400,
    );
  }

  const { data, error } = await admin.rpc(
    "resume_comm_hub_one_real_email_finalization",
    { p_execution_id: executionId },
  );
  if (error) {
    return json(
      {
        ok: false,
        runtime_build: RUNTIME_BUILD,
        error: "resume_rpc_failed",
        detail: error.message,
      },
      400,
    );
  }

  const result = (data ?? {}) as any;
  if (result.ok !== true) {
    return json(
      { runtime_build: RUNTIME_BUILD, ...result },
      400,
    );
  }

  // Re-read the authoritative certification via the read RPC so the caller
  // gets a canonical row (never fabricated in this function).
  let certification: any = null;
  if (result.certification_id) {
    const { data: certRows } = await admin.rpc(
      "get_controlled_live_certification",
      { p_certification_id: result.certification_id },
    );
    const rows = Array.isArray(certRows) ? certRows : [];
    certification = rows.length > 0 ? rows[0] : null;
  }

  return json({
    runtime_build: RUNTIME_BUILD,
    ...result,
    certification,
  });
});
