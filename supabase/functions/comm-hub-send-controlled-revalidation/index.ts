/**
 * Controlled Revalidation — send exactly one revalidation email.
 *
 * Consumed by ControlledRevalidationPanel after an admin has issued a
 * one-use send authorisation for a revalidation cycle. This function is
 * the ONLY runtime path that turns a revalidation authorisation into a
 * provider call. It never sends more than one provider request per
 * cycle, never mutates the production anchor, and never reopens
 * Stage 6.
 *
 * Send context: CONTROLLED_REVALIDATION
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import {
  lookupActiveEmailProvider,
  redactProviderForLog,
} from "../_shared/communication-hub/provider-lookup.ts";
import {
  sendEmailViaGuardedTransport,
  isGuardRefusal,
} from "../_shared/communication-hub/transport-guard.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ACTION_SEND = "SEND_CONTROLLED_REVALIDATION_EMAIL";
const ACTION_RECOVER = "RECOVER";
const ACTION_PROBE = "probe";
// A4.1 durable preparation. Never invokes the provider.
const ACTION_PREPARE = "PREPARE_CONTROLLED_REVALIDATION";
const SEND_CONTEXT = "CONTROLLED_REVALIDATION";
const RUNTIME_BUILD =
  "comm-hub-send-controlled-revalidation@2026-07-27-a4.1-prepare";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}
function errStr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface Envelope {
  schema_version: "controlled-revalidation.v1";
  runtime_build: string;
  action: string;
  status:
    | "BLOCKED" | "RESERVED" | "PROVIDER_ACCEPTED"
    | "PROVIDER_REJECTED" | "RECOVERED"
    | "READY_FOR_PROVIDER" | "FAILED_PRE_PROVIDER";
  passed: boolean;
  send_context: "CONTROLLED_REVALIDATION";
  cycle_id: string | null;
  cycle_status: string | null;
  authorisation_id: string | null;
  authorisation_status: string | null;
  request_id: string | null;
  message_id: string | null;
  delivery_attempt_id: string | null;
  execution_id: string | null;
  trace_id: string | null;
  provider_boundary_state: "NOT_ENTERED" | "ENTERED" | null;
  provider_call_attempted: boolean;
  provider_name: string | null;
  provider_message_id: string | null;
  provider_status: string | null;
  provider_result_recorded: boolean;
  reused_existing_execution: boolean;
  message: string;
  blockers: Array<{ code: string; stage: string; message?: string; detail?: unknown }>;
  warnings: Array<Record<string, unknown>>;
  started_at: string;
  completed_at: string | null;
  provider_redacted: Record<string, unknown> | null;
}

function emptyEnvelope(action: string, started: string): Envelope {
  return {
    schema_version: "controlled-revalidation.v1",
    runtime_build: RUNTIME_BUILD,
    action,
    status: "BLOCKED",
    passed: false,
    send_context: "CONTROLLED_REVALIDATION",
    cycle_id: null,
    cycle_status: null,
    authorisation_id: null,
    authorisation_status: null,
    request_id: null,
    message_id: null,
    delivery_attempt_id: null,
    provider_call_attempted: false,
    provider_name: null,
    provider_message_id: null,
    provider_status: null,
    provider_result_recorded: false,
    reused_existing_execution: false,
    message: "",
    blockers: [],
    warnings: [],
    started_at: started,
    completed_at: null,
    provider_redacted: null,
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
    env.passed = status === "PROVIDER_ACCEPTED" || status === "RECOVERED"
      || status === "RESERVED";
    if (message) env.message = message;
    env.completed_at = new Date().toISOString();
    return json(env, http);
  };

  // ---- Probe (no side effects) ----
  if (action === ACTION_PROBE) {
    env.message = "probe_ok";
    return finalize("RECOVERED", 200, "probe_ok");
  }

  if (action !== ACTION_SEND && action !== ACTION_RECOVER) {
    addBlocker("action_invalid", "input_validation",
      `action must be ${ACTION_SEND}, ${ACTION_RECOVER}, or ${ACTION_PROBE}`);
    return finalize("BLOCKED", 400);
  }

  // ---- Auth ----
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
    const authCtxResp = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_comm_hub_request_auth_context`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: ANON_KEY,
          Authorization: `Bearer ${bearer}`,
        },
        body: "{}",
      },
    );
    const ctx = await authCtxResp.json().catch(() => ({}));
    if (!authCtxResp.ok || ctx?.authenticated !== true || ctx?.comm_hub_admin !== true) {
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

  // ---- Input ----
  const cycleId: string = body.cycleId ?? body.cycle_id ?? "";
  const authorisationId: string = body.authorisationId ?? body.authorisation_id ?? "";
  if (!cycleId || !authorisationId) {
    addBlocker("missing_parameters", "input_validation",
      "cycleId and authorisationId are required");
    return finalize("BLOCKED", 400);
  }
  env.cycle_id = cycleId;
  env.authorisation_id = authorisationId;

  // ---- Recovery action: report state, never contact provider ----
  if (action === ACTION_RECOVER) {
    const { data, error } = await admin.rpc("get_comm_hub_revalidation_send_context",
      { p_cycle_id: cycleId });
    if (error) {
      addBlocker("recovery_query_failed", "recovery", error.message);
      return finalize("BLOCKED", 500);
    }
    const ctx: any = data ?? {};
    env.cycle_status = ctx.cycle_status ?? null;
    env.authorisation_status = ctx.authorisation?.consumed_at
      ? "CONSUMED"
      : ctx.authorisation?.revoked_at
        ? "REVOKED"
        : ctx.authorisation?.id
          ? "ACTIVE"
          : null;
    env.provider_call_attempted = !!ctx.provider_call_attempted;
    env.reused_existing_execution = !!ctx.controlled_email_execution_id;
    env.request_id = ctx.controlled_email_execution_id ?? null;
    env.message = "recovery_snapshot";
    return finalize("RECOVERED", 200);
  }

  const currentFingerprint: string = body.currentFingerprint ?? body.current_fingerprint ?? "";
  const recipient: string = String(body.recipient ?? body.recipient_email ?? "").trim().toLowerCase();
  if (!currentFingerprint || !recipient || !recipient.includes("@")) {
    addBlocker("missing_parameters", "input_validation",
      "currentFingerprint and recipient are required");
    return finalize("BLOCKED", 400);
  }

  // ---- Stage A: atomic reserve ----
  let reserved: any = null;
  {
    const { data, error } = await admin.rpc(
      "reserve_comm_hub_revalidation_send_authorisation",
      {
        p_cycle_id: cycleId,
        p_authorisation_id: authorisationId,
        p_current_fingerprint: currentFingerprint,
        p_recipient_email: recipient,
      },
    );
    if (error) {
      addBlocker(String(error.code ?? "reserve_failed"), "reservation",
        error.message ?? "reserve rpc failed");
      return finalize("BLOCKED", 400);
    }
    reserved = data ?? {};
    if (!reserved.ok) {
      addBlocker("reserve_refused", "reservation", JSON.stringify(reserved));
      return finalize("BLOCKED", 400);
    }
    env.cycle_status = "PROVIDER_PROCESSING";
    env.authorisation_status = "RESERVED";
    if (reserved.already_reserved && reserved.controlled_email_execution_id) {
      env.reused_existing_execution = true;
      env.request_id = reserved.controlled_email_execution_id;
      env.provider_call_attempted = true;
      env.message = "authorisation_already_consumed; refusing second provider call.";
      return finalize("RECOVERED", 200);
    }
  }

  // ---- Stage B: create durable request/message/attempt ----
  let providerRow: any = null;
  try {
    const { data } = await admin
      .from("notification_providers")
      .select("id,provider_name,email_provider_type")
      .eq("channel", "email").eq("is_active", true).eq("is_default", true)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    providerRow = data;
    env.provider_name = providerRow?.provider_name ?? null;
  } catch (e) {
    env.warnings.push({ code: "provider_probe_error", message: errStr(e) });
  }

  const requestNo = `CREV-${cycleId.slice(0, 8)}-${Date.now().toString(36)}`;
  let requestId: string | null = null;
  let messageId: string | null = null;
  let attemptId: string | null = null;
  try {
    const { data: reqRow, error: reqErr } = await admin
      .from("communication_request")
      .insert({
        request_no: requestNo,
        module_code: reserved.module_code,
        event_code: reserved.event_code,
        channels: [reserved.channel ?? "email"],
        priority: "normal",
        status: "processing",
        payload: {
          cycle_id: cycleId,
          authorisation_id: authorisationId,
          purpose: "CONTROLLED_REVALIDATION",
        },
        context: {
          send_context: SEND_CONTEXT,
          event_certification_id: reserved.event_certification_id,
          production_lineage_id: reserved.production_lineage_id,
          baseline_ore_certification_id: reserved.baseline_ore_certification_id,
          current_fingerprint: reserved.current_fingerprint,
        },
        idempotency_key: `crev:${cycleId}:${authorisationId}`,
        requested_by: operatorId,
        approved_by: operatorId,
        approved_at: new Date().toISOString(),
        decision_send_context: "controlled_revalidation",
        targeted_dispatch_only: true,
      })
      .select("id").single();
    if (reqErr || !reqRow?.id) throw reqErr ?? new Error("request insert failed");
    requestId = reqRow.id;
    env.request_id = requestId;

    const subject = `[Controlled revalidation] ${reserved.module_code} / ${reserved.event_code}`;
    const bodyText =
      `This is a controlled revalidation email issued by the Communication Hub.\n\n` +
      `Cycle: ${cycleId}\nAuthorisation: ${authorisationId}\n` +
      `Fingerprint: ${reserved.current_fingerprint}\n` +
      `Production lineage: ${reserved.production_lineage_id}\n` +
      `Event certification: ${reserved.event_certification_id}\n\n` +
      `No production anchor has been altered by this send.`;
    const { data: msgRow, error: msgErr } = await admin
      .from("communication_message")
      .insert({
        request_id: requestId,
        channel: reserved.channel ?? "email",
        provider_id: providerRow?.id ?? null,
        subject,
        body_text: bodyText,
        body_html: `<pre>${bodyText.replace(/</g, "&lt;")}</pre>`,
        status: "queued",
        send_context: "controlled_revalidation",
        from_email: null,
      })
      .select("id").single();
    if (msgErr || !msgRow?.id) throw msgErr ?? new Error("message insert failed");
    messageId = msgRow.id;
    env.message_id = messageId;

    const { data: attemptRow, error: attemptErr } = await admin
      .from("communication_delivery_attempt")
      .insert({
        message_id: messageId,
        attempt_no: 1,
        status: "pending",
        provider_id: providerRow?.id ?? null,
        provider_call_attempted: false,
        send_context: "controlled_revalidation",
        attempt_type: "controlled_revalidation",
      })
      .select("id").single();
    if (attemptErr || !attemptRow?.id) throw attemptErr ?? new Error("attempt insert failed");
    attemptId = attemptRow.id;
    env.delivery_attempt_id = attemptId;
  } catch (e) {
    addBlocker("evidence_creation_failed", "pre_provider_evidence", errStr(e));
    // Mark cycle FAILED via record_provider_result REJECTED to release auth.
    await admin.rpc("record_comm_hub_revalidation_provider_result", {
      p_cycle_id: cycleId,
      p_execution_id: requestId,
      p_outcome: "REJECTED",
    }).catch(() => {});
    env.provider_result_recorded = true;
    return finalize("BLOCKED", 500);
  }

  // ---- Stage C: provider lookup + guarded transport ----
  const providerRes = await lookupActiveEmailProvider(admin);
  if (!providerRes.ok) {
    addBlocker(providerRes.errorCode, "pre_provider_evidence", providerRes.errorMessage);
    await admin.rpc("record_comm_hub_revalidation_provider_result", {
      p_cycle_id: cycleId, p_execution_id: requestId, p_outcome: "REJECTED",
    }).catch(() => {});
    env.provider_result_recorded = true;
    return finalize("BLOCKED", 400);
  }
  const provider = providerRes.provider;
  env.provider_redacted = redactProviderForLog(provider);
  if ((provider.type as any) === "stub") {
    addBlocker("provider_stub_not_allowed_revalidation", "pre_provider_evidence");
    await admin.rpc("record_comm_hub_revalidation_provider_result", {
      p_cycle_id: cycleId, p_execution_id: requestId, p_outcome: "REJECTED",
    }).catch(() => {});
    env.provider_result_recorded = true;
    return finalize("BLOCKED", 400);
  }

  // Load message for transport.
  const { data: msg } = await admin
    .from("communication_message")
    .select("subject,body_text,body_html,from_email,from_display_name,reply_to_email")
    .eq("id", messageId!).maybeSingle();

  // Provider boundary flip (irreversible for retry).
  await admin.from("communication_message").update({ status: "sending" }).eq("id", messageId!);

  const transportResult = await sendEmailViaGuardedTransport(admin, {
    guard: {
      messageId: messageId!,
      requestId: requestId!,
      attemptedProvider: provider.type,
      callerFunction: "comm-hub-send-controlled-revalidation",
      callerContext: SEND_CONTEXT,
      correlationId: cycleId,
      traceId: null,
    },
    provider,
    payload: {
      to: recipient,
      subject: msg?.subject ?? "Controlled revalidation",
      html: msg?.body_html ?? "",
      text: msg?.body_text ?? undefined,
      fromName: msg?.from_display_name ?? provider.fromName,
      fromEmail: msg?.from_email ?? provider.fromEmail,
      replyTo: msg?.reply_to_email ?? undefined,
    },
  });

  const nowIso = new Date().toISOString();

  if (isGuardRefusal(transportResult)) {
    addBlocker("transport_guard_refused", "provider", transportResult.code);
    await admin.from("communication_delivery_attempt").update({
      status: "failure",
      error_code: transportResult.code,
      provider_call_attempted: false,
      finished_at: nowIso, updated_at: nowIso,
    }).eq("id", attemptId!);
    await admin.from("communication_message").update({
      status: "failed",
      error_code: transportResult.code,
      error_message: "transport_guard_refused",
      updated_at: nowIso,
    }).eq("id", messageId!);
    await admin.rpc("record_comm_hub_revalidation_provider_result", {
      p_cycle_id: cycleId, p_execution_id: requestId, p_outcome: "REJECTED",
    });
    env.provider_result_recorded = true;
    return finalize("BLOCKED", 400);
  }

  env.provider_call_attempted = true;
  const providerOk = transportResult.ok;
  const providerMsgId = transportResult.providerMessageId ?? null;
  const rawStatus = transportResult.rawStatus ?? (providerOk ? "success" : "failure");
  const attemptStatus: string = providerOk
    ? "success"
    : (transportResult.retryable ? "pending" : "failure");

  await admin.from("communication_delivery_attempt").update({
    status: attemptStatus,
    provider_call_attempted: true,
    provider_message_id: providerMsgId,
    provider_response: transportResult.providerResponseSafe ?? null,
    error_code: transportResult.errorCode ?? null,
    error_message: transportResult.errorMessage ?? null,
    finished_at: nowIso, provider_call_completed_at: nowIso, updated_at: nowIso,
  }).eq("id", attemptId!);

  await admin.from("communication_message").update({
    status: providerOk ? "sent" : "failed",
    provider_message_id: providerMsgId,
    sent_at: providerOk ? nowIso : null,
    error_code: providerOk ? null : (transportResult.errorCode ?? null),
    error_message: providerOk ? null : (transportResult.errorMessage ?? null),
    updated_at: nowIso,
  }).eq("id", messageId!);

  env.provider_message_id = providerMsgId;
  env.provider_status = rawStatus;

  // Record provider result on the revalidation cycle. This is the ONE place
  // that transitions cycle → AWAITING_INBOX_CONFIRMATION and consumes the
  // one-use authorisation atomically. Inbox confirmation is separate.
  {
    const { error: recErr } = await admin.rpc(
      "record_comm_hub_revalidation_provider_result",
      {
        p_cycle_id: cycleId,
        p_execution_id: requestId,
        p_outcome: providerOk ? "ACCEPTED" : "REJECTED",
      },
    );
    if (recErr) {
      env.warnings.push({ code: "provider_result_record_failed", message: recErr.message });
    } else {
      env.provider_result_recorded = true;
      env.authorisation_status = "CONSUMED";
      env.cycle_status = providerOk ? "AWAITING_INBOX_CONFIRMATION" : "FAILED";
    }
  }

  return finalize(
    providerOk ? "PROVIDER_ACCEPTED" : "PROVIDER_REJECTED",
    200,
    providerOk
      ? "Provider accepted the controlled revalidation email. Awaiting inbox confirmation."
      : "Provider rejected the controlled revalidation email.",
  );
});
