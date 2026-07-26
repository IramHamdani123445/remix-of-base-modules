// deno-lint-ignore-file no-explicit-any
// Server-coordinated Manual Production observation.
//
// Guarantees:
// - Requires operator auth + Communication Hub administrator authority checked
//   through the operator-authenticated client BEFORE any service-role action.
// - Fails closed when the recipient policy returns zero approved recipients or
//   the supplied recipient is not on the approved list.
// - Persists an observation intent (idempotency key + recipient + module/event)
//   before any enqueue, so a browser refresh can recover without sending twice.
// - Finalize recovery accepts message_id alone; on recovery, no new message is
//   enqueued or dispatched — only durable evidence is bound.
// - Every response — including uncaught exceptions — is JSON with CORS headers
//   and an x-comm-hub-runtime-build header so the client can distinguish a
//   deployment/transport issue from a business blocker.
import { createClient } from "npm:@supabase/supabase-js@2";

const RUNTIME_BUILD =
  "comm-hub-run-manual-production-observation@2026-07-26-admin-param-and-transport-fix";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
// Canonical secret name shared with comm-hub-dispatch.
const DISPATCH_SECRET =
  Deno.env.get("COMMUNICATION_HUB_DISPATCH_SECRET") ??
  Deno.env.get("COMM_HUB_DISPATCH_SECRET") ??
  "";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, x-comm-hub-idempotency-key",
  "access-control-allow-methods": "POST, OPTIONS",
  "x-comm-hub-runtime-build": RUNTIME_BUILD,
};
function json(status: number, body: any) {
  return new Response(
    JSON.stringify({ runtime_build: RUNTIME_BUILD, ...body }),
    { status, headers: { ...cors, "content-type": "application/json" } },
  );
}
function safeErr(e: unknown): string {
  try {
    if (!e) return "unknown_error";
    if (typeof e === "string") return e.slice(0, 500);
    const anyE = e as any;
    return String(anyE?.message ?? anyE?.error ?? anyE).slice(0, 500);
  } catch { return "unknown_error"; }
}
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST")
      return json(405, { ok: false, blockers: [{ code: "method_not_allowed" }] });

    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer "))
      return json(401, { ok: false, blockers: [{ code: "unauthorised" }] });

    let payload: any;
    try { payload = await req.json(); }
    catch { return json(400, { ok: false, blockers: [{ code: "invalid_json" }] }); }

    const action = String(payload?.action ?? "run").trim();

    const asOperator = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: auth } },
    });
    const asService = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Verify operator identity
    const { data: claims, error: claimErr } = await asOperator.auth.getClaims(auth.slice(7));
    if (claimErr || !claims?.claims?.sub)
      return json(401, { ok: false, blockers: [{ code: "unauthorised", detail: claimErr?.message }] });
    const operatorId = claims.claims.sub as string;

    // Admin authority — correct parameter contract is `_uid uuid`.
    const { data: adminOk, error: adminErr } = await asOperator.rpc("is_comm_hub_admin", {
      _uid: operatorId,
    });
    if (adminErr)
      return json(403, { ok: false, blockers: [{ code: "admin_check_failed", detail: adminErr.message }] });
    if (adminOk !== true)
      return json(403, { ok: false, blockers: [{ code: "not_comm_hub_admin" }] });

    // ============ PROBE (non-sending) ============
    if (action === "probe") {
      const secretsPresent = {
        SUPABASE_URL: !!SUPABASE_URL,
        SUPABASE_ANON_KEY: !!ANON,
        SUPABASE_SERVICE_ROLE_KEY: !!SERVICE_ROLE,
        COMMUNICATION_HUB_DISPATCH_SECRET: !!DISPATCH_SECRET,
      };
      const moduleCode = String(payload?.moduleCode ?? "").trim();
      const eventCode = String(payload?.eventCode ?? "").trim();
      const channel = String(payload?.channel ?? "email").trim().toLowerCase();
      let statusOk = false, recipientOk = false;
      let statusErr: string | null = null, recipientErr: string | null = null;
      if (moduleCode && eventCode) {
        const { error: se } = await asService.rpc("get_comm_hub_event_go_live_status", {
          p_module_code: moduleCode, p_event_code: eventCode, p_channel: channel,
        });
        statusOk = !se; statusErr = se?.message ?? null;
        const { error: re } = await asService.rpc("list_comm_hub_approved_recipients", {
          p_module_code: moduleCode, p_event_code: eventCode, p_channel: channel,
        });
        recipientOk = !re; recipientErr = re?.message ?? null;
      }
      return json(200, {
        ok: true,
        probe: {
          reachable: true,
          jwt_valid: true,
          admin_rpc_callable: true,
          admin_param_contract: "_uid",
          status_rpc_callable: statusOk,
          status_rpc_error: statusErr,
          recipient_policy_rpc_callable: recipientOk,
          recipient_policy_error: recipientErr,
          secrets: secretsPresent,
          operator_id: operatorId,
        },
      });
    }

    // ============ RUN ============
    const moduleCode = String(payload?.moduleCode ?? "").trim();
    const eventCode = String(payload?.eventCode ?? "").trim();
    const channel = String(payload?.channel ?? "email").trim().toLowerCase();
    const recipientEmail = String(payload?.recipientEmail ?? "").trim().toLowerCase();
    const idempotencyKey = String(payload?.idempotencyKey ?? "").trim();
    const data = payload?.data ?? {};

    if (!moduleCode || !eventCode || !recipientEmail || !idempotencyKey)
      return json(400, { ok: false, blockers: [{ code: "missing_required_fields" }] });

    // Authoritative go-live status
    const { data: status, error: statErr } = await asService.rpc(
      "get_comm_hub_event_go_live_status",
      { p_module_code: moduleCode, p_event_code: eventCode, p_channel: channel },
    );
    if (statErr)
      return json(500, { ok: false, blockers: [{ code: "status_lookup_failed", detail: statErr.message }] });
    const s7 = (status as any)?.stage7;
    if (!s7 || (s7.manual_event_status !== "live_manual_only" && s7.manual_event_status !== "live_cron_allowed")) {
      return json(409, { ok: false, blockers: [{ code: "event_not_manually_certified", detail: s7?.manual_event_status ?? null }] });
    }
    const platform = (status as any)?.platform;
    if (platform?.current_operating_mode !== "MANUAL_PRODUCTION" && platform?.current_operating_mode !== "AUTOMATED_PRODUCTION") {
      return json(409, { ok: false, blockers: [{ code: "operating_mode_not_production", detail: platform?.current_operating_mode ?? null }] });
    }

    // Approved-recipient policy — fail closed on empty or non-matching.
    const { data: approved, error: apprErr } = await asService.rpc(
      "list_comm_hub_approved_recipients",
      { p_module_code: moduleCode, p_event_code: eventCode, p_channel: channel },
    );
    if (apprErr)
      return json(500, { ok: false, blockers: [{ code: "recipient_policy_lookup_failed", detail: apprErr.message }] });
    const approvedList = ((approved as any[]) ?? [])
      .map((r) => String(r.email ?? "").toLowerCase())
      .filter((s) => s.length > 0);
    if (approvedList.length === 0)
      return json(409, { ok: false, blockers: [{ code: "recipient_policy_empty", detail: "No approved recipients are configured for this event/channel." }] });
    if (!approvedList.includes(recipientEmail))
      return json(409, { ok: false, blockers: [{ code: "recipient_not_approved", detail: recipientEmail }] });

    // Persist observation intent BEFORE enqueue
    const { data: intentRec, error: intentErr } = await asOperator.rpc(
      "record_comm_hub_observation_intent",
      {
        p_idempotency_key: idempotencyKey,
        p_module_code: moduleCode,
        p_event_code: eventCode,
        p_channel: channel,
        p_recipient_email: recipientEmail,
      },
    );
    if (intentErr)
      return json(403, { ok: false, blockers: [{ code: "intent_record_failed", detail: intentErr.message }] });
    const intent = (intentRec as any) ?? {};

    if (intent.finalized_observation_id) {
      return json(200, {
        ok: true,
        phase: "AWAITING_INBOX_CONFIRMATION",
        recovered: true,
        request_id: intent.request_id,
        message_id: intent.message_id,
        observation_id: intent.finalized_observation_id,
      });
    }

    let messageId: string | undefined = intent.message_id ?? undefined;
    let requestId: string | undefined = intent.request_id ?? undefined;

    if (!messageId) {
      const enqueueRes = await fetch(`${SUPABASE_URL}/functions/v1/send-communication-v1`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: auth,
          apikey: ANON,
          "x-comm-hub-idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          moduleCode, eventCode,
          channels: [channel.toUpperCase()],
          recipient: { email: recipientEmail, role: "to" },
          data, idempotencyKey,
          sendContext: "manual_production",
          testMode: false,
          metadata: { context: "manual_production_observation", operatorId },
        }),
      });
      const enqueueText = await enqueueRes.text();
      let enqueueBody: any = {};
      try { enqueueBody = JSON.parse(enqueueText); } catch {}
      if (!enqueueRes.ok) {
        await asService.rpc("update_comm_hub_observation_intent", {
          p_idempotency_key: idempotencyKey, p_phase: "FAILED",
          p_last_error: `enqueue_failed: ${enqueueBody?.error ?? enqueueText.slice(0, 200)}`,
        });
        return json(502, { ok: false, blockers: [{ code: "enqueue_failed", detail: enqueueBody?.error ?? enqueueText.slice(0, 500) }] });
      }
      messageId = enqueueBody?.messages?.[0]?.id ?? enqueueBody?.messageIds?.[0] ?? enqueueBody?.messageId;
      requestId = enqueueBody?.requestId ?? enqueueBody?.request_id;
      if (!messageId) {
        await asService.rpc("update_comm_hub_observation_intent", {
          p_idempotency_key: idempotencyKey, p_phase: "FAILED", p_last_error: "enqueue_no_message_id",
        });
        return json(502, { ok: false, blockers: [{ code: "enqueue_no_message_id" }] });
      }
      await asService.rpc("update_comm_hub_observation_intent", {
        p_idempotency_key: idempotencyKey,
        p_message_id: messageId, p_request_id: requestId ?? null,
        p_phase: "AWAITING_PROVIDER",
      });

      await fetch(`${SUPABASE_URL}/functions/v1/comm-hub-dispatch`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-comm-hub-dispatch-secret": DISPATCH_SECRET,
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
        },
        body: JSON.stringify({ targetMessageId: messageId, manual: true, initiatedBy: operatorId }),
      }).catch(() => {});
    }

    // Bounded poll for durable delivery evidence (~12s)
    let attempt: any = null;
    let message: any = null;
    for (let i = 0; i < 12; i++) {
      const [{ data: m }, { data: a }] = await Promise.all([
        asService.from("communication_message").select("id,status,send_context,test_mode,trace_id").eq("id", messageId).maybeSingle(),
        asService.from("communication_delivery_attempt").select("id,status,provider_id,provider_message_id,created_at").eq("message_id", messageId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      message = m; attempt = a;
      if (a && ["success","delivered","sent","failure","failed"].includes(String(a.status))) break;
      await sleep(1000);
    }

    if (!attempt || !["success","delivered","sent"].includes(String(attempt?.status))) {
      return json(202, {
        ok: false,
        phase: "AWAITING_PROVIDER",
        request_id: requestId,
        message_id: messageId,
        message_status: message?.status ?? null,
        attempt_status: attempt?.status ?? null,
        blockers: [{ code: "provider_evidence_pending", detail: "Provider evidence not durable yet — retry finalize when message is sent." }],
      });
    }

    const { data: finalized, error: finErr } = await asService.rpc(
      "finalize_comm_hub_manual_production_observation",
      { p_message_id: messageId, p_idempotency_key: idempotencyKey },
    );
    if (finErr) {
      await asService.rpc("update_comm_hub_observation_intent", {
        p_idempotency_key: idempotencyKey, p_phase: "AWAITING_PROVIDER", p_last_error: finErr.message,
      });
      return json(500, { ok: false, blockers: [{ code: "finalize_failed", detail: finErr.message }] });
    }
    const fin: any = finalized ?? {};
    if (fin.observation_id) {
      await asService.rpc("update_comm_hub_observation_intent", {
        p_idempotency_key: idempotencyKey,
        p_finalized_observation_id: fin.observation_id,
        p_phase: "AWAITING_INBOX_CONFIRMATION",
      });
    }

    return json(200, {
      ok: true,
      phase: fin.phase ?? "AWAITING_INBOX_CONFIRMATION",
      request_id: requestId,
      message_id: messageId,
      ...fin,
    });
  } catch (e) {
    return json(500, {
      ok: false,
      blockers: [{ code: "edge_runtime_exception", detail: safeErr(e) }],
    });
  }
});
