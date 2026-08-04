// BN Communication Adapter Runner.
//
// Drains Benefits communication outboxes into the shared communication hub.
// It never renders a template, never picks a sender and never writes to a
// Benefits obligation table: every effect happens inside the server-side
// adapter commands, in one transaction each.
//
// Privacy: no claimant PII is logged. Only intent ids, event codes and short
// sanitized error codes appear in the output.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_BATCH = 100;

function sanitize(message: string): string {
  return message.match(/E_[A-Z_]+/)?.[0] ?? "E_UNKNOWN";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const correlationId = crypto.randomUUID();

  const expectedSecret = Deno.env.get("BN_COMMUNICATION_ADAPTER_SECRET");
  if (!expectedSecret || req.headers.get("x-bn-communication-adapter-secret") !== expectedSecret) {
    console.warn("[bn-communication-adapter] rejected unauthenticated invocation", correlationId);
    return new Response(JSON.stringify({ correlationId, error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    let body: { limit?: number } = {};
    try { body = await req.json(); } catch { /* scheduler may post an empty body */ }
    const limit = Math.min(Math.max(body.limit ?? MAX_BATCH, 1), MAX_BATCH);

    const { data: pending, error: pendingError } = await db.rpc(
      "bn_communication_adapter_pending_v1",
      { p_limit: limit },
    );
    if (pendingError) throw new Error(pendingError.message);

    const rows = (pending ?? []) as Array<{
      source_module: string;
      source_intent_id: string;
      event_code: string;
    }>;

    let dispatched = 0;
    let replayed = 0;
    let noop = 0;
    let failed = 0;

    // Terminal, intentional outcomes. The adapter must never record another
    // failure for these: the intent is already in a final state (cancelled,
    // delivered, terminally failed) and retrying would be incorrect.
    const TERMINAL_NO_OP_CODES = new Set([
      "E_INTENT_CANCELLED",
      "E_INTENT_ALREADY_DELIVERED",
      "E_INTENT_TERMINAL_FAILED",
      "E_INTENT_NOT_DISPATCHABLE",
    ]);

    for (const row of rows) {
      // Failure isolation: one bad intent never aborts the batch.
      try {
        const { data, error } = await db.rpc("bn_communication_adapter_dispatch_v1", {
          p_source_module: row.source_module,
          p_source_intent_id: row.source_intent_id,
        });
        if (error) throw new Error(error.message);
        const result = (data as { status?: string; error_code?: string } | null) ?? {};
        const status = result.status ?? "FAILED";
        if (status === "DISPATCHED") dispatched += 1;
        else if (status === "REPLAYED") replayed += 1;
        else if (status === "NO_OP" && TERMINAL_NO_OP_CODES.has(result.error_code ?? "")) {
          // Successful non-retry outcome — no failure is recorded.
          noop += 1;
        } else failed += 1;
      } catch (e) {
        failed += 1;
        await db.rpc("bn_communication_adapter_record_failure_v1", {
          p_source_module: row.source_module,
          p_source_intent_id: row.source_intent_id,
          p_error_code: sanitize(e instanceof Error ? e.message : ""),
        });
      }
    }

    const { data: syncData } = await db.rpc("bn_communication_adapter_sync_v1", { p_limit: 500 });

    const summary = {
      correlationId,
      scanned: rows.length,
      dispatched,
      replayed,
      noop,
      failed,
      synced: Number((syncData as { synced?: number } | null)?.synced ?? 0),
      durationMs: Date.now() - startedAt,
    };
    console.log("[bn-communication-adapter]", JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const errorCode = sanitize(e instanceof Error ? e.message : "");
    console.error("[bn-communication-adapter] batch failure", correlationId, errorCode);
    return new Response(JSON.stringify({ correlationId, error: errorCode }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
