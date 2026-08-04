// BN Award Suspension Runner — scheduled / on-demand
//
// Executes future-dated award suspensions once their effective date arrives.
// The runner NEVER computes business outcomes itself: it only asks the database
// which cases are due and then calls the server-side execution command, which
// performs the award mutation, payment holds, audit and idempotency receipt in
// a single transaction.
//
// Idempotency: the key is derived from the suspension id and the effective date
// (stable across retries of the same due item), so a retried batch replays the
// stored receipt instead of executing twice.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type DueRow = {
  id: string;
  bn_award_id: string;
  suspended_from: string | null;
  row_version: number | null;
  execution_attempts: number | null;
  status: string;
};

type ItemResult = {
  suspensionId: string;
  awardId: string;
  outcome: "executed" | "replayed" | "failed";
  error?: string;
};

/** Attempts beyond this are left for manual intervention. */
const MAX_ATTEMPTS = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const correlationId = crypto.randomUUID();

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    let limit = 50;
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const raw = Number((body as Record<string, unknown>)?.limit);
      if (Number.isFinite(raw) && raw > 0) limit = Math.min(Math.floor(raw), 200);
    }

    const { data: due, error: dueError } = await db.rpc(
      "bn_award_suspension_due_for_execution_v1",
      { p_limit: limit },
    );
    if (dueError) throw new Error(`due_scan_failed: ${dueError.message}`);

    const rows = (due ?? []) as DueRow[];
    const results: ItemResult[] = [];

    for (const row of rows) {
      if ((row.execution_attempts ?? 0) >= MAX_ATTEMPTS) {
        results.push({
          suspensionId: row.id,
          awardId: row.bn_award_id,
          outcome: "failed",
          error: "max_attempts_exceeded",
        });
        continue;
      }

      const idempotencyKey =
        `suspension_execute_scheduled:${row.id}:${row.suspended_from ?? "na"}`;

      const { data, error } = await db.rpc("bn_award_suspension_execute_scheduled_v1", {
        p_suspension_id: row.id,
        p_idempotency_key: idempotencyKey,
        p_correlation_id: correlationId,
      });

      if (error) {
        // The command persists its own EXECUTION_FAILED state; the runner only
        // records the outcome so the batch continues with the next case.
        results.push({
          suspensionId: row.id,
          awardId: row.bn_award_id,
          outcome: "failed",
          error: error.message,
        });
        continue;
      }

      const replayed = Boolean((data as Record<string, unknown> | null)?.replayed);
      results.push({
        suspensionId: row.id,
        awardId: row.bn_award_id,
        outcome: replayed ? "replayed" : "executed",
      });
    }

    const summary = {
      correlationId,
      scanned: rows.length,
      executed: results.filter((r) => r.outcome === "executed").length,
      replayed: results.filter((r) => r.outcome === "replayed").length,
      failed: results.filter((r) => r.outcome === "failed").length,
      durationMs: Date.now() - startedAt,
    };

    console.log("[bn-award-suspension-runner]", JSON.stringify(summary));

    return new Response(JSON.stringify({ ...summary, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unexpected_error";
    console.error("[bn-award-suspension-runner] failed", message);
    return new Response(JSON.stringify({ correlationId, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
