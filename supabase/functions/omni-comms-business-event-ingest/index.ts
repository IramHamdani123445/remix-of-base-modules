// Omni-Comms — durable business-event ingest worker.
//
// The bridge between a business transaction and the communication runtime.
//
// A business module records its communication obligation INSIDE its own
// database transaction (`omni_comms_priv_enqueue_business_event`). This
// worker is the only surface that drains that outbox: it claims a bounded
// batch, hands each event to `omni-comms-runtime` through the SAME canonical
// contract the browser façade uses, and records the outcome back on the
// outbox row.
//
// Boundaries:
//   * It contacts NO provider and sends NO email. The runtime persists a
//     dispatch job; the governed dispatcher decides delivery.
//   * A caller can never choose WHAT is ingested. The only accepted input is
//     a bounded batch limit; the database claim transaction selects the rows.
//   * It is callable only by the automatic scheduler: the service-role
//     credential (never held by a browser) plus a single-use, purpose-bound
//     scheduler ticket minted by the database.
//   * Every failure is recorded as a bounded code on the outbox row. Nothing
//     is ever lost and nothing is ever double-sent: the runtime is idempotent
//     on the outbox's deterministic idempotency key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-omni-comms-ingest-ticket, x-omni-comms-scheduler-nonce",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MAX_BATCH_LIMIT = 25;
const SCHEDULER_PURPOSE = "business_event_ingest";

interface OutboxRow {
  id: string;
  organization_id: string;
  module_code: string;
  event_code: string;
  entity_type: string;
  entity_id: string;
  product_id: string | null;
  department_context_id: string | null;
  recipient_facts: Record<string, Record<string, unknown>> | null;
  payload_snapshot: Record<string, unknown> | null;
  idempotency_key: string;
  correlation_id: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function str(value: unknown): string | null {
  const v = typeof value === "string" ? value.trim() : "";
  return v === "" ? null : v;
}

/**
 * Recipient facts are stored as a role-keyed object so the business meaning
 * (`claimant`) is preserved without inventing a persisted recipient type.
 */
export function buildRecipients(row: OutboxRow): Array<Record<string, unknown>> {
  const facts = row.recipient_facts && typeof row.recipient_facts === "object"
    ? row.recipient_facts
    : {};
  return Object.entries(facts).map(([role, fact]) => ({
    recipientType: str(fact?.recipient_type) ?? "external",
    recipientRole: str(fact?.recipient_role) ?? role,
    recipientReference: str(fact?.recipient_reference),
    displayName: str(fact?.display_name),
    locale: str(fact?.locale),
    email: str(fact?.email),
    phone: str(fact?.phone),
  }));
}

/**
 * The canonical runtime request. Identical in shape to the browser façade.
 *
 * NO channel is requested. Which channels a business event uses is a
 * CONFIGURATION decision owned by the server-authoritative effective plan —
 * never by the worker, never by the business module and never by a template.
 */
export function buildRuntimeRequest(row: OutboxRow): Record<string, unknown> {
  const recipients = buildRecipients(row);
  return {
    eventCode: row.event_code,
    organizationId: row.organization_id,
    departmentId: row.department_context_id,
    mode: "queued",
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    payload: row.payload_snapshot ?? {},
    recipients,
    resolutionContext: {
      productId: row.product_id,
      recipientRoles: recipients
        .map((r) => r.recipientRole)
        .filter((r): r is string => typeof r === "string"),
    },
    callerContext: {
      moduleCode: row.module_code,
      entityType: row.entity_type,
      entityId: row.entity_id,
    },
  };
}

/**
 * Terminal "nothing to send" outcomes. Communication being switched OFF is a
 * legitimate configured answer, not a failure and not something to retry.
 */
const NO_COMMUNICATION_BLOCKERS = new Set([
  "no_communication_configured",
  "no_channel_configured",
  "communication_disabled",
  "channel_delivery_off",
]);


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method === "GET" && new URL(req.url).pathname.endsWith("/health")) {
    return json({ function: "omni-comms-business-event-ingest", available: true });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: "configuration_error" }, 503);

  // Trust model. The scheduler runs inside the database and holds NO secret:
  // it presents the publishable key plus a single-use, purpose-bound ticket
  // minted by the database itself. The ticket — consumed below — is the proof
  // of caller identity. A service-role bearer is deliberately NOT required,
  // and would be a secret the scheduler must never carry.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "OC401", detail: "authentication_required" }, 401);
  }
  if (req.headers.get("x-omni-comms-ingest-ticket") !== "scheduler") {
    return json({ error: "OC403", detail: "ingest_ticket_required" }, 403);
  }


  let raw: Record<string, unknown> = {};
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    raw = {};
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return json({ error: "OC422", detail: "ingest_input_invalid" }, 400);
  }
  const rejected = Object.keys(raw).filter((k) => k !== "batchLimit");
  if (rejected.length > 0) {
    return json({ error: "OC422", detail: "caller_supplied_ingest_input_forbidden" }, 400);
  }
  let batchLimit = 10;
  if ("batchLimit" in raw && raw.batchLimit !== null) {
    const c = raw.batchLimit;
    if (typeof c !== "number" || !Number.isInteger(c) || c < 1 || c > MAX_BATCH_LIMIT) {
      return json({ error: "OC422", detail: "ingest_batch_limit_invalid" }, 400);
    }
    batchLimit = c;
  }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Single-use, purpose-bound scheduler ticket. A ticket minted for dispatch
  // can never be replayed here, and vice versa.
  const nonce = (req.headers.get("x-omni-comms-scheduler-nonce") ?? "").trim();
  if (!/^[0-9a-f]{64}$/.test(nonce)) {
    return json({ error: "OC403", detail: "scheduler_ticket_invalid" }, 403);
  }
  const { data: ticketOk, error: ticketErr } = await service.rpc(
    "omni_comms_priv_scheduler_consume_ticket",
    { p_nonce: nonce, p_purpose: SCHEDULER_PURPOSE },
  );
  if (ticketErr || ticketOk !== true) {
    return json({ error: "OC403", detail: "scheduler_ticket_invalid" }, 403);
  }

  const { data: claimed, error: claimErr } = await service.rpc(
    "omni_comms_priv_claim_business_events",
    { p_limit: batchLimit },
  );
  if (claimErr) {
    return json({ error: "OC500", detail: "business_event_claim_failed" }, 500);
  }
  const rows = (claimed ?? []) as OutboxRow[];

  let processed = 0;
  let blocked = 0;
  let needsReview = 0;

  for (const row of rows) {
    let status = "blocked";
    let requestId: string | null = null;
    let blockerCode = "runtime_unavailable";

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/omni-comms-runtime`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_ROLE}`,
          "apikey": SERVICE_ROLE,
          // Trusted system emission: no operator identity, authorised solely
          // by the ACTIVE producer-event binding.
          "x-omni-comms-system-actor": "business-event-ingest",
        },
        body: JSON.stringify(buildRuntimeRequest(row)),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      requestId = str(body.requestId);

      if (res.ok && (body.status === "accepted" || body.status === "queued")) {
        status = "processed";
        blockerCode = "";
      } else if (res.status >= 500) {
        // Transient: leave it recoverable so the next tick retries.
        status = "needs_review";
        blockerCode = "runtime_unavailable";
      } else {
        status = "blocked";
        const blockers = Array.isArray(body.blockers) ? body.blockers : [];
        blockerCode = str(blockers[0]) ?? str(body.detail) ?? "runtime_blocked";
      }
    } catch {
      status = "needs_review";
      blockerCode = "runtime_unavailable";
    }

    await service.rpc("omni_comms_priv_complete_business_event", {
      p_id: row.id,
      p_status: status,
      p_request_id: requestId,
      p_blocker_code: blockerCode === "" ? null : blockerCode,
    });

    if (status === "processed") processed += 1;
    else if (status === "blocked") blocked += 1;
    else needsReview += 1;
  }

  return json({
    function: "omni-comms-business-event-ingest",
    claimed: rows.length,
    processed,
    blocked,
    needsReview,
  });
});
