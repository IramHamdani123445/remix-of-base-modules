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
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const DISPATCH_SECRET = Deno.env.get("COMM_HUB_DISPATCH_SECRET") ?? "";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
function json(status: number, body: any) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
}
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, blockers: [{ code: "method_not_allowed" }] });

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json(401, { ok: false, blockers: [{ code: "unauthorised" }] });

  let payload: any;
  try { payload = await req.json(); } catch { return json(400, { ok: false, blockers: [{ code: "invalid_json" }] }); }

  const moduleCode = String(payload?.moduleCode ?? "").trim();
  const eventCode = String(payload?.eventCode ?? "").trim();
  const channel = String(payload?.channel ?? "email").trim().toLowerCase();
  const recipientEmail = String(payload?.recipientEmail ?? "").trim().toLowerCase();
  const idempotencyKey = String(payload?.idempotencyKey ?? "").trim();
  const data = payload?.data ?? {};

  if (!moduleCode || !eventCode || !recipientEmail || !idempotencyKey) {
    return json(400, { ok: false, blockers: [{ code: "missing_required_fields" }] });
  }

  const asOperator = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
  const asService = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 1) Verify operator identity
  const { data: claims, error: claimErr } = await asOperator.auth.getClaims(auth.slice(7));
  if (claimErr || !claims?.claims?.sub) return json(401, { ok: false, blockers: [{ code: "unauthorised" }] });
  const operatorId = claims.claims.sub as string;

  // 2) REQUIRE Communication Hub admin using the operator-authenticated client.
  //    is_comm_hub_admin is SECURITY DEFINER but relies on auth.uid() from the
  //    JWT — running it via asOperator ensures it evaluates the operator, not
  //    the service role. This must succeed BEFORE any service-role RPC.
  const { data: adminOk, error: adminErr } = await asOperator.rpc("is_comm_hub_admin", { _user_id: operatorId });
  if (adminErr) {
    return json(403, { ok: false, blockers: [{ code: "admin_check_failed", detail: adminErr.message }] });
  }
  if (adminOk !== true) {
    return json(403, { ok: false, blockers: [{ code: "not_comm_hub_admin" }] });
  }

  // 3) Authoritative go-live status
  const { data: status, error: statErr } = await asService.rpc("get_comm_hub_event_go_live_status", {
    p_module_code: moduleCode, p_event_code: eventCode, p_channel: channel,
  });
  if (statErr) return json(500, { ok: false, blockers: [{ code: "status_lookup_failed", detail: statErr.message }] });
  const s7 = (status as any)?.stage7;
  if (!s7 || (s7.manual_event_status !== "live_manual_only" && s7.manual_event_status !== "live_cron_allowed")) {
    return json(409, { ok: false, blockers: [{ code: "event_not_manually_certified", detail: s7?.manual_event_status ?? null }] });
  }
  const platform = (status as any)?.platform;
  if (platform?.current_operating_mode !== "MANUAL_PRODUCTION" && platform?.current_operating_mode !== "AUTOMATED_PRODUCTION") {
    return json(409, { ok: false, blockers: [{ code: "operating_mode_not_production", detail: platform?.current_operating_mode ?? null }] });
  }

  // 4) Validate recipient against approved list — FAIL CLOSED on empty list.
  const { data: approved, error: apprErr } = await asService.rpc("list_comm_hub_approved_recipients", {
    p_module_code: moduleCode, p_event_code: eventCode, p_channel: channel,
  });
  if (apprErr) return json(500, { ok: false, blockers: [{ code: "recipient_policy_lookup_failed", detail: apprErr.message }] });
  const approvedList = ((approved as any[]) ?? []).map((r) => String(r.email ?? "").toLowerCase()).filter((s) => s.length > 0);
  if (approvedList.length === 0) {
    return json(409, { ok: false, blockers: [{ code: "recipient_policy_empty", detail: "No approved recipients are configured for this event/channel." }] });
  }
  if (!approvedList.includes(recipientEmail)) {
    return json(409, { ok: false, blockers: [{ code: "recipient_not_approved", detail: recipientEmail }] });
  }

  // 5) Persist observation intent BEFORE enqueue (admin-only RPC via operator client)
  const { data: intentRec, error: intentErr } = await asOperator.rpc("record_comm_hub_observation_intent", {
    p_idempotency_key: idempotencyKey,
    p_module_code: moduleCode,
    p_event_code: eventCode,
    p_channel: channel,
    p_recipient_email: recipientEmail,
  });
  if (intentErr) {
    return json(403, { ok: false, blockers: [{ code: "intent_record_failed", detail: intentErr.message }] });
  }
  const intent = (intentRec as any) ?? {};

  // 6) Recovery paths
  if (intent.finalized_observation_id) {
    // Already finalized on a prior invocation — do not send again.
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
    // 7) Enqueue exactly once via canonical façade
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

    // 8) Targeted dispatch — only for a freshly enqueued message.
    await fetch(`${SUPABASE_URL}/functions/v1/comm-hub-dispatch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-comm-hub-dispatch-secret": DISPATCH_SECRET,
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({ targetMessageId: messageId, manual: true, initiatedBy: operatorId }),
    });
  }
  // else: recovery — messageId already exists, do NOT dispatch again.

  // 9) Bounded poll for durable delivery evidence (~12s)
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

  // 10) Finalize (service-role RPC)
  const { data: finalized, error: finErr } = await asService.rpc("finalize_comm_hub_manual_production_observation", {
    p_message_id: messageId, p_idempotency_key: idempotencyKey,
  });
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
});
