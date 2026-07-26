/**
 * Stage 6 — Send One Real Email (Slice 1: backend spine).
 *
 * Dedicated, audited runtime boundary that authorises and performs ONE real
 * provider email send after a successful Controlled Stub certification.
 *
 * This function NEVER falls back to the provider stub. If the guarded
 * transport refuses, if the provider is unhealthy, or if evidence cannot be
 * persisted before consumption, the grant is either kept unconsumed (retry
 * safe via pre-provider reconciliation) or locked (retry unsafe, requires
 * operator reconciliation) — the provider is not invoked twice under any
 * circumstance.
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

const CONFIRMATION_PHRASE = "SEND ONE REAL EMAIL";
const ACTION = "SEND_ONE_REAL_EMAIL";
const RUNTIME_BUILD =
  "comm-hub-send-one-real-email@a0a9275fb6852527763708cd67af157604619eb3";

type Status =
  | "BLOCKED"
  | "PROVIDER_REJECTED"
  | "PROVIDER_ACCEPTED"
  | "DELIVERY_PENDING"
  | "FAILED";

interface Envelope {
  schema_version: "one-real-email.v1";
  runtime_build: typeof RUNTIME_BUILD;
  action: "SEND_ONE_REAL_EMAIL";
  status: Status;
  passed: boolean;
  message: string;
  idempotent_replay: boolean;
  execution_id: string | null;
  grant_id: string | null;
  grant_status: string | null;
  request_id: string | null;
  request_number: string | null;
  message_id: string | null;
  delivery_attempt_id: string | null;
  trace_id: string | null;
  provider_call_attempted: boolean;
  provider_name: string | null;
  provider_message_id: string | null;
  provider_status: string | null;
  provider_mode: "real" | "inactive";
  send_context: "REAL_EMAIL";
  real_email_authorised: boolean;
  certification_id: string | null;
  certification_kind: "ONE_REAL_EMAIL" | null;
  certification_status: string | null;
  failure_stage: string | null;
  retry_safe: boolean;
  automatic_retry_allowed: boolean;
  reconciliation_required: boolean;
  cleanup_proven: boolean;
  blockers: Array<{ code: string; stage: string; message?: string; detail?: unknown }>;
  warnings: Array<Record<string, unknown>>;
  started_at: string;
  completed_at: string | null;
  provider_redacted: Record<string, unknown> | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

function emptyEnvelope(started: string): Envelope {
  return {
    schema_version: "one-real-email.v1",
    runtime_build: RUNTIME_BUILD,
    action: "SEND_ONE_REAL_EMAIL",
    status: "BLOCKED",
    passed: false,
    message: "",
    idempotent_replay: false,
    execution_id: null,
    grant_id: null,
    grant_status: null,
    request_id: null,
    request_number: null,
    message_id: null,
    delivery_attempt_id: null,
    trace_id: null,
    provider_call_attempted: false,
    provider_name: null,
    provider_message_id: null,
    provider_status: null,
    provider_mode: "inactive",
    send_context: "REAL_EMAIL",
    real_email_authorised: false,
    certification_id: null,
    certification_kind: null,
    certification_status: null,
    failure_stage: null,
    retry_safe: false,
    automatic_retry_allowed: false,
    reconciliation_required: false,
    cleanup_proven: false,
    blockers: [],
    warnings: [],
    started_at: started,
    completed_at: null,
    provider_redacted: null,
  };
}

function errStr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const started = new Date().toISOString();
  const env = emptyEnvelope(started);

  const addBlocker = (
    code: string,
    stage: string,
    message?: string,
    detail?: unknown,
  ) => {
    if (!env.blockers.some((b) => b.code === code && b.stage === stage)) {
      env.blockers.push({ code, stage, ...(message ? { message } : {}), ...(detail !== undefined ? { detail } : {}) });
    }
  };

  const finalize = (
    status: Status,
    stage: string | null,
    opts: { retrySafe: boolean; reconciliationRequired?: boolean; cleanupProven?: boolean; http?: number; message?: string } = { retrySafe: false },
  ): Response => {
    env.status = status;
    env.failure_stage = stage;
    env.passed = status === "PROVIDER_ACCEPTED"
      || status === "DELIVERY_PENDING";
    // Any post-provider outcome (provider was invoked, evidence persisted or
    // otherwise) MUST forbid automatic retry regardless of caller intent.
    const postProvider = env.provider_call_attempted
      || status === "PROVIDER_ACCEPTED"
      || status === "DELIVERY_PENDING"
      || status === "PROVIDER_REJECTED";
    env.retry_safe = postProvider ? false : !!opts.retrySafe;
    env.automatic_retry_allowed = env.retry_safe;
    env.reconciliation_required = !!opts.reconciliationRequired;
    env.cleanup_proven = !!opts.cleanupProven;
    if (opts.message) env.message = opts.message;
    env.completed_at = new Date().toISOString();
    return json(env, opts.http ?? 200);
  };

  // ---- Auth ----
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ") || authHeader.length < 10) {
    addBlocker("authentication_header_missing", "auth",
      "Authorization Bearer token is required.");
    return finalize("BLOCKED", "auth", { retrySafe: true, http: 401 });
  }
  const bearer = authHeader.slice("Bearer ".length).trim();
  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    accessToken: async () => bearer,
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  let operatorId: string | null = null;
  try {
    const { data, error } = await authClient.auth.getUser(bearer);
    if (error || !data?.user?.id) {
      addBlocker("authentication_token_invalid", "auth",
        error?.message ?? "Login session could not be verified.");
      return finalize("BLOCKED", "auth", { retrySafe: true, http: 401 });
    }
    operatorId = data.user.id;
  } catch (e) {
    addBlocker("authentication_service_unavailable", "auth", errStr(e));
    return finalize("BLOCKED", "auth", { retrySafe: true, http: 503 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ---- Input validation ----
  const body = await req.json().catch(() => ({} as any));
  if (body.action !== ACTION) {
    addBlocker("action_invalid", "input_validation",
      "action must be SEND_ONE_REAL_EMAIL");
    return finalize("BLOCKED", "input_validation", { retrySafe: true, http: 400 });
  }
  if (body.confirmation !== CONFIRMATION_PHRASE) {
    addBlocker("confirmation_mismatch", "input_validation",
      `Confirmation phrase must be exactly "${CONFIRMATION_PHRASE}".`);
    return finalize("BLOCKED", "input_validation", { retrySafe: true, http: 400 });
  }
  const required = [
    "moduleCode", "eventCode", "recipient",
    "previewApprovalId", "dryRunCertificationId",
    "controlledStubCertificationId",
    "recipientSetHash", "idempotencyKey", "reason",
  ];
  for (const key of required) {
    if (typeof body[key] !== "string" || body[key].length === 0) {
      addBlocker(`missing_${key}`, "input_validation", `${key} is required`);
      return finalize("BLOCKED", "input_validation", { retrySafe: true, http: 400 });
    }
  }
  const channel = typeof body.channel === "string" && body.channel.length > 0
    ? body.channel : "email";
  if (Array.isArray(body.cc) && body.cc.length > 0) {
    addBlocker("cc_not_allowed", "input_validation");
    return finalize("BLOCKED", "input_validation", { retrySafe: true, http: 400 });
  }
  if (Array.isArray(body.bcc) && body.bcc.length > 0) {
    addBlocker("bcc_not_allowed", "input_validation");
    return finalize("BLOCKED", "input_validation", { retrySafe: true, http: 400 });
  }

  // ---- Stage A: begin_comm_hub_one_real_email ----
  const beginPayload = {
    module_code: body.moduleCode,
    event_code: body.eventCode,
    channel,
    recipient: body.recipient,
    recipient_set_hash: body.recipientSetHash,
    preview_approval_id: body.previewApprovalId,
    dry_run_certification_id: body.dryRunCertificationId,
    controlled_stub_certification_id: body.controlledStubCertificationId,
    preview_snapshot_id: body.previewSnapshotId ?? null,
    configuration_version: body.configurationVersion ?? null,
    recipient_policy_version: body.recipientPolicyVersion ?? null,
    idempotency_key: body.idempotencyKey,
    reason: body.reason,
    cc: [], bcc: [],
  };
  let begin: any = null;
  {
    // Prove that PostgREST sees the same operator identity as Auth before any
    // execution/grant/message/provider state can be created.
    const { data: authContext, error: authContextError } = await userClient.rpc(
      "get_comm_hub_request_auth_context",
    );
    const rpcAuthUid = typeof authContext?.auth_uid === "string"
      ? authContext.auth_uid
      : null;
    const authenticated = authContext?.authenticated === true;
    const commHubAdmin = authContext?.comm_hub_admin === true;
    if (
      authContextError ||
      !authenticated ||
      rpcAuthUid !== operatorId ||
      !commHubAdmin
    ) {
      const code = authContextError
        ? "auth_context_rpc_failed"
        : !authenticated || !rpcAuthUid
          ? "authentication_required"
          : rpcAuthUid !== operatorId
            ? "operator_identity_mismatch"
            : "not_authorised";
      addBlocker(
        code,
        "authorisation",
        authContextError?.message ??
          (code === "not_authorised"
            ? "Communication Hub administrator authority is required."
            : "Operator JWT was not propagated to the database auth context."),
        {
          runtime_build: RUNTIME_BUILD,
          expected_operator_id: operatorId,
          rpc_auth_uid: rpcAuthUid,
          authenticated,
          comm_hub_admin: commHubAdmin,
          supabase_error_code: authContextError?.code ?? null,
          supabase_error_message: authContextError?.message ?? null,
        },
      );
      return finalize("BLOCKED", "authorisation", {
        retrySafe: true,
        cleanupProven: true,
        http: code === "not_authorised" ? 403 : 400,
      });
    }

    // Call PostgREST directly with the operator's bearer token so auth.uid()
    // resolves inside the SECURITY DEFINER RPC. supabase-js v2 can override
    // global.headers.Authorization with its own (anon) token when no session
    // is set via setSession, which would cause auth.uid() to be null.
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/begin_comm_hub_one_real_email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": ANON_KEY,
        "Authorization": `Bearer ${bearer}`,
      },
      body: JSON.stringify({ p_payload: beginPayload }),
    });
    const raw = await resp.text();
    let parsed: any = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = { message: raw }; }
    if (!resp.ok) {
      addBlocker(parsed?.code || "authorisation_failed", "authorisation",
        parsed?.message ?? `begin_comm_hub_one_real_email failed (HTTP ${resp.status})`,
        {
          runtime_build: RUNTIME_BUILD,
          expected_operator_id: operatorId,
          rpc_auth_uid: rpcAuthUid,
          authenticated,
          comm_hub_admin: commHubAdmin,
          supabase_error_code: parsed?.code ?? null,
          supabase_error_message: parsed?.message ?? null,
        });
      return finalize("BLOCKED", "authorisation", { retrySafe: true, http: 400 });
    }
    begin = parsed ?? {};
  }
  env.execution_id = begin.execution_id ?? null;
  env.grant_id = begin.grant_id ?? null;
  env.grant_status = begin.grant_status ?? null;
  env.provider_mode = "real";
  env.real_email_authorised = !!begin.real_email_authorised;
  env.provider_name = begin.provider_name ?? null;

  // Idempotent terminal replay → return immediately without provider invocation.
  if (begin.idempotent_replay === true && begin.terminal === true) {
    env.idempotent_replay = true;
    env.message = "Existing terminal execution replayed; provider not re-invoked.";
    // Fetch existing certification if any.
    if (env.execution_id) {
      const { data: certRow } = await admin
        .from("communication_controlled_live_certification")
        .select("id,status,provider_outcome,provider_status,provider_message_id,trace_id,request_id,message_id,delivery_attempt_id,certification_kind")
        .eq("execution_id", env.execution_id)
        .eq("certification_kind", "ONE_REAL_EMAIL")
        .maybeSingle();
      if (certRow) {
        env.certification_id = certRow.id;
        env.certification_kind = "ONE_REAL_EMAIL";
        env.certification_status = certRow.status;
        env.provider_message_id = certRow.provider_message_id ?? null;
        env.provider_status = certRow.provider_status ?? null;
        env.trace_id = certRow.trace_id ?? null;
        env.request_id = certRow.request_id ?? null;
        env.message_id = certRow.message_id ?? null;
        env.delivery_attempt_id = certRow.delivery_attempt_id ?? null;
        env.provider_call_attempted = true;
      }
    }
    const replayStatus: Status = env.certification_status === "PROVIDER_ACCEPTED"
      || env.certification_status === "DELIVERED"
      ? "PROVIDER_ACCEPTED"
      : env.certification_status === "DELIVERY_PENDING"
        ? "DELIVERY_PENDING" : "BLOCKED";
    return finalize(replayStatus, null, { retrySafe: false });
  }
  if (begin.idempotent_replay === true) {
    env.idempotent_replay = true;
    env.warnings.push({ code: "idempotency_replay_in_progress",
      message: "An in-flight execution matched the idempotency key; continuing without minting a new grant." });
  }

  if (!env.execution_id || !env.grant_id) {
    addBlocker("authorisation_contract_invalid", "authorisation",
      "begin_comm_hub_one_real_email did not return execution or grant identifiers.");
    return finalize("BLOCKED", "authorisation", { retrySafe: true, http: 500 });
  }

  // Pre-provider reconciliation helper.
  const preProviderReconcile = async (reason: string) => {
    try {
      const { data } = await admin.rpc(
        "reconcile_comm_hub_one_real_email_pre_provider",
        { p_execution_id: env.execution_id, p_grant_id: env.grant_id, p_reason: reason },
      );
      const ok = !!(data && (data as any).ok);
      env.cleanup_proven = ok;
      env.grant_status = "REVOKED";
    } catch (e) {
      env.warnings.push({ code: "pre_provider_reconciliation_error", message: errStr(e) });
    }
  };

  // ---- Stage B: create_comm_hub_one_real_email_message ----
  let created: any = null;
  {
    const { data, error } = await admin.rpc(
      "create_comm_hub_one_real_email_message",
      { p_execution_id: env.execution_id, p_grant_id: env.grant_id },
    );
    if (error) {
      addBlocker("message_creation_rpc_error", "request_creation", error.message);
      await preProviderReconcile("message_creation_rpc_error");
      return finalize("BLOCKED", "request_creation",
        { retrySafe: true, cleanupProven: env.cleanup_proven });
    }
    created = data ?? {};
    if (created.ok !== true) {
      addBlocker(String(created.code ?? "message_creation_refused"), "request_creation");
      await preProviderReconcile(String(created.code ?? "message_creation_refused"));
      return finalize("BLOCKED", "request_creation",
        { retrySafe: true, cleanupProven: env.cleanup_proven });
    }
  }
  env.request_id = created.request_id ?? null;
  env.request_number = created.request_no ?? null;
  env.message_id = created.message_id ?? null;
  env.provider_name = created.provider_name ?? env.provider_name;
  (env as any).preview_approval_id = created.preview_approval_id ?? null;
  (env as any).dry_run_certification_id = created.dry_run_certification_id ?? null;
  (env as any).original_decision_id = created.original_decision_id ?? null;
  (env as any).recipient_set_hash = created.recipient_set_hash ?? null;
  (env as any).subject_hash = created.subject_hash ?? null;
  (env as any).body_hash = created.body_hash ?? null;

  if (!env.request_id || !env.message_id) {
    addBlocker("message_creation_contract_invalid", "request_creation");
    await preProviderReconcile("message_creation_contract_invalid");
    return finalize("BLOCKED", "request_creation",
      { retrySafe: true, cleanupProven: env.cleanup_proven });
  }

  // ---- Stage C: canonical send-decision revalidation (best-effort) ----
  try {
    if (created.original_decision_id) {
      const { data, error } = await admin.rpc("revalidate_comm_hub_send_decision", {
        p_decision_id: created.original_decision_id,
        p_context: { source: "comm-hub-send-one-real-email", stage: "pre_provider" } as any,
      } as any);
      if (error) {
        env.warnings.push({ code: "revalidation_error", message: error.message });
      } else if (data && (data as any).allowed === false) {
        addBlocker("canonical_send_decision_revoked", "canonical_send_decision",
          (data as any).reason ?? "canonical decision no longer allowed");
        await preProviderReconcile("canonical_send_decision_revoked");
        return finalize("BLOCKED", "canonical_send_decision",
          { retrySafe: true, cleanupProven: env.cleanup_proven });
      }
    }
  } catch (e) {
    env.warnings.push({ code: "revalidation_skipped", message: errStr(e) });
  }

  // ---- Stage D: reserve grant ----
  {
    const { data, error } = await admin.rpc(
      "reserve_comm_hub_one_real_email_grant",
      { p_grant_id: env.grant_id, p_execution_id: env.execution_id },
    );
    if (error || !(data && (data as any).allowed === true)) {
      addBlocker("grant_reserve_failed", "grant_validation",
        error?.message ?? "grant reservation refused",
        (data as any)?.blockers ?? undefined);
      await preProviderReconcile("grant_reserve_failed");
      return finalize("BLOCKED", "grant_validation",
        { retrySafe: true, cleanupProven: env.cleanup_proven });
    }
    env.grant_status = "RESERVED";
  }

  // ---- Stage E: durable pending delivery-attempt row ----
  let attemptId: string | null = null;
  try {
    const { data: providerRow } = await admin
      .from("notification_providers")
      .select("id,provider_name,email_provider_type")
      .eq("channel", "email").eq("is_active", true).eq("is_default", true)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    const providerId = providerRow?.id ?? null;
    env.provider_name = env.provider_name ?? providerRow?.provider_name ?? null;

    const { data: attemptRow, error: attemptErr } = await admin
      .from("communication_delivery_attempt")
      .insert({
        message_id: env.message_id,
        attempt_no: 1,
        status: "pending",
        provider_id: providerId,
        provider_call_attempted: false,
        send_context: "controlled_live",
        attempt_type: "controlled_live",
        controlled_live_execution_id: env.execution_id,
        grant_id: env.grant_id,
        preview_approval_id: (env as any).preview_approval_id ?? null,
        dry_run_certification_id: (env as any).dry_run_certification_id ?? null,
        recipient_set_hash: (env as any).recipient_set_hash ?? null,
        subject_hash: (env as any).subject_hash ?? null,
        body_hash: (env as any).body_hash ?? null,
        original_decision_id: (env as any).original_decision_id ?? null,
      })
      .select("id")
      .single();
    if (attemptErr || !attemptRow?.id) {
      addBlocker("attempt_insert_failed", "pre_provider_evidence",
        attemptErr?.message ?? "delivery attempt row could not be created");
      await preProviderReconcile("attempt_insert_failed");
      return finalize("BLOCKED", "pre_provider_evidence",
        { retrySafe: true, cleanupProven: env.cleanup_proven });
    }
    attemptId = attemptRow.id;
    env.delivery_attempt_id = attemptId;
  } catch (e) {
    addBlocker("attempt_insert_exception", "pre_provider_evidence", errStr(e));
    await preProviderReconcile("attempt_insert_exception");
    return finalize("BLOCKED", "pre_provider_evidence",
      { retrySafe: true, cleanupProven: env.cleanup_proven });
  }

  // ---- Stage F: provider lookup + guarded transport ----
  const providerRes = await lookupActiveEmailProvider(admin);
  if (!providerRes.ok) {
    addBlocker(providerRes.errorCode, "pre_provider_evidence", providerRes.errorMessage);
    await preProviderReconcile(providerRes.errorCode);
    return finalize("BLOCKED", "pre_provider_evidence",
      { retrySafe: true, cleanupProven: env.cleanup_proven });
  }
  const provider = providerRes.provider;
  env.provider_redacted = redactProviderForLog(provider);

  // Reject stub adapter — Stage 6 must never fall back to the simulator.
  if ((provider.type as any) === "stub") {
    addBlocker("provider_stub_not_allowed_stage_6", "pre_provider_evidence",
      "Stub provider is not permitted for Send One Real Email.");
    await preProviderReconcile("provider_stub_not_allowed_stage_6");
    return finalize("BLOCKED", "pre_provider_evidence",
      { retrySafe: true, cleanupProven: env.cleanup_proven });
  }

  // Load the authoritative message content for transport.
  const { data: msgRow, error: msgErr } = await admin
    .from("communication_message")
    .select("subject,body_html,body_text,from_email,from_display_name,reply_to_email")
    .eq("id", env.message_id).maybeSingle();
  if (msgErr || !msgRow) {
    addBlocker("message_load_failed", "pre_provider_evidence", msgErr?.message);
    await preProviderReconcile("message_load_failed");
    return finalize("BLOCKED", "pre_provider_evidence",
      { retrySafe: true, cleanupProven: env.cleanup_proven });
  }
  const recipient = String(body.recipient).trim().toLowerCase();

  // Message lifecycle: queued -> sending. This MUST succeed before we go near
  // the provider — any failure is treated as a hard pre-provider blocker.
  {
    const { data: lc, error: lcErr } = await admin.rpc(
      "set_comm_hub_one_real_email_message_status",
      { p_message_id: env.message_id, p_target_status: "sending" });
    if (lcErr || !(lc && (lc as any).ok === true)) {
      addBlocker("message_lifecycle_sending_failed", "pre_provider_evidence",
        lcErr?.message ?? JSON.stringify(lc));
      await preProviderReconcile("message_lifecycle_sending_failed");
      return finalize("BLOCKED", "pre_provider_evidence",
        { retrySafe: false, cleanupProven: env.cleanup_proven });
    }
  }

  // Provider-boundary assertion — proves every invariant before the wire.
  {
    const { data: boundary, error: boundaryErr } = await admin.rpc(
      "assert_comm_hub_one_real_email_provider_boundary",
      {
        p_execution_id: env.execution_id,
        p_grant_id: env.grant_id,
        p_message_id: env.message_id,
        p_attempt_id: attemptId,
      });
    if (boundaryErr || !(boundary && (boundary as any).ok === true)) {
      const bblockers = (boundary as any)?.blockers ?? [];
      addBlocker("provider_boundary_assertion_failed", "pre_provider_evidence",
        boundaryErr?.message ?? "provider-boundary invariants not satisfied",
        bblockers);
      await preProviderReconcile("provider_boundary_assertion_failed");
      return finalize("BLOCKED", "pre_provider_evidence",
        { retrySafe: false, cleanupProven: env.cleanup_proven });
    }
  }

  // Irreversible provider boundary — flip execution.provider_call_attempted
  // ONLY here. A crash between this point and evidence persistence must route
  // through the post-provider (retry-unsafe) branch.
  await admin.from("communication_controlled_live_execution")
    .update({ provider_call_attempted: true, updated_at: new Date().toISOString() })
    .eq("id", env.execution_id);

  const transportResult = await sendEmailViaGuardedTransport(admin, {
    guard: {
      messageId: env.message_id!,
      requestId: env.request_id ?? null,
      attemptedProvider: provider.type,
      callerFunction: "comm-hub-send-one-real-email",
      callerContext: "SEND_ONE_REAL_EMAIL",
      correlationId: env.execution_id,
      traceId: env.trace_id ?? null,
    },
    provider,
    payload: {
      to: recipient,
      subject: msgRow.subject,
      html: msgRow.body_html ?? "",
      text: msgRow.body_text ?? undefined,
      fromName: msgRow.from_display_name ?? provider.fromName,
      fromEmail: msgRow.from_email ?? provider.fromEmail,
      replyTo: msgRow.reply_to_email ?? undefined,
    },
  });

  // ---- Stage G: persist provider evidence, then consume + finalise ----
  if (isGuardRefusal(transportResult)) {
    // The guard PROVES the provider was not invoked. Reset the pre-boundary
    // flip on the execution row and pre-provider reconcile the grant.
    addBlocker("transport_guard_refused", "pre_provider_evidence",
      transportResult.code);
    await admin.from("communication_delivery_attempt").update({
      status: "failure",
      error_code: transportResult.code,
      provider_call_attempted: false,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", attemptId);
    await admin.from("communication_controlled_live_execution")
      .update({ provider_call_attempted: false, updated_at: new Date().toISOString() })
      .eq("id", env.execution_id);
    await admin.rpc("set_comm_hub_one_real_email_message_status", {
      p_message_id: env.message_id, p_target_status: "failed",
      p_error_code: transportResult.code,
      p_error_message: "transport_guard_refused",
    });
    await preProviderReconcile("transport_guard_refused");
    return finalize("BLOCKED", "pre_provider_evidence",
      { retrySafe: false, cleanupProven: env.cleanup_proven });
  }

  // The wire was touched — from here on every path is retry-unsafe.
  env.provider_call_attempted = true;

  // Map durable provider outcome onto the attempt row.
  const providerOk = transportResult.ok;
  const providerMsgId = transportResult.providerMessageId ?? null;
  const rawStatus = transportResult.rawStatus ?? (providerOk ? "success" : "failure");
  // Attempt status must satisfy communication_delivery_attempt_status_chk:
  //   pending | success | failure | timeout | throttled | skipped
  let attemptStatus: "success" | "failure" | "pending" | "timeout" | "throttled" | "skipped" = "failure";
  if (providerOk) attemptStatus = "success";
  else if (transportResult.retryable) attemptStatus = "pending";
  else if ((transportResult.errorCode ?? "").toLowerCase().includes("timeout")) attemptStatus = "timeout";
  else if ((transportResult.errorCode ?? "").toLowerCase().includes("throttl")) attemptStatus = "throttled";

  const nowIso = new Date().toISOString();
  let evidenceOk = true;
  try {
    const { error: attemptUpdErr } = await admin
      .from("communication_delivery_attempt")
      .update({
        status: attemptStatus,
        provider_call_attempted: true,
        provider_message_id: providerMsgId,
        provider_status: rawStatus,
        provider_response_safe: transportResult.providerResponseSafe ?? null,
        provider_response: transportResult.providerResponseSafe ?? null,
        error_code: transportResult.errorCode ?? null,
        error_message: transportResult.errorMessage ?? null,
        finished_at: nowIso,
        provider_call_completed_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", attemptId);
    if (attemptUpdErr) throw attemptUpdErr;

    await admin.from("communication_controlled_live_execution").update({
      provider_message_id: providerMsgId,
      provider_status: rawStatus,
      provider_name: env.provider_name,
      provider_call_attempted: true,
      updated_at: nowIso,
    }).eq("id", env.execution_id);
  } catch (e) {
    evidenceOk = false;
    env.warnings.push({ code: "post_provider_evidence_persist_failed", message: errStr(e) });
  }

  env.provider_message_id = providerMsgId;
  env.provider_status = rawStatus;

  if (!evidenceOk) {
    addBlocker("post_provider_evidence_incomplete", "provider_invocation",
      "Provider invocation completed but evidence could not be persisted; operator reconciliation required.");
    return finalize("BLOCKED", "provider_invocation",
      { retrySafe: false, reconciliationRequired: true });
  }

  // Consume the one-use grant — evidence is durable at this point.
  // Rejection MUST also consume the grant so the same session cannot re-send.
  {
    const { data, error } = await admin.rpc(
      "consume_comm_hub_one_real_email_grant",
      { p_grant_id: env.grant_id, p_execution_id: env.execution_id, p_message_id: env.message_id },
    );
    if (error || !(data && (data as any).allowed === true)) {
      env.warnings.push({
        code: "grant_consume_failed",
        message: error?.message ?? "grant consumption refused after provider evidence persisted",
      });
    } else {
      env.grant_status = "CONSUMED";
    }
  }

  // Drive targeted-message lifecycle to a terminal state.
  {
    const target = providerOk ? "sent" : "failed";
    const { data: lc, error: lcErr } = await admin.rpc(
      "set_comm_hub_one_real_email_message_status", {
        p_message_id: env.message_id,
        p_target_status: target,
        p_provider_message_id: providerMsgId,
        p_error_code: providerOk ? null : (transportResult.errorCode ?? null),
        p_error_message: providerOk ? null : (transportResult.errorMessage ?? null),
      });
    if (lcErr || !(lc && (lc as any).ok === true)) {
      env.warnings.push({
        code: "message_lifecycle_terminal_failed",
        message: lcErr?.message ?? JSON.stringify(lc),
      });
    }
  }

  // ---- Stage H: finalise ----
  {
    const { data, error } = await admin.rpc("finalize_comm_hub_one_real_email", {
      p_payload: { execution_id: env.execution_id },
    });
    if (error) {
      addBlocker("finalization_failed", "finalization", error.message);
      return finalize(
        providerOk ? "PROVIDER_ACCEPTED" : "PROVIDER_REJECTED",
        "finalization",
        { retrySafe: false, reconciliationRequired: true,
          message: "Provider evidence persisted; final certificate could not be recorded." });
    }
    const f: any = data ?? {};
    env.certification_id = f.certification_id ?? null;
    env.certification_kind = "ONE_REAL_EMAIL";
    env.certification_status = f.certification_status ?? null;
    if (f.idempotent_replay === true) env.idempotent_replay = true;
  }

  const finalStatus: Status =
    attemptStatus === "success" ? "PROVIDER_ACCEPTED"
    : attemptStatus === "pending" ? "DELIVERY_PENDING"
    : "PROVIDER_REJECTED";

  // Every post-provider outcome — accepted, pending, rejected — is retry-unsafe.
  const retrySafeFinal = false;

  env.message = finalStatus === "PROVIDER_ACCEPTED"
    ? "Provider accepted the one real email."
    : finalStatus === "DELIVERY_PENDING"
      ? "Provider outcome pending; delivery evidence will surface asynchronously."
      : "Provider rejected the one real email.";

  return finalize(finalStatus, null, { retrySafe: retrySafeFinal, cleanupProven: true });
});

