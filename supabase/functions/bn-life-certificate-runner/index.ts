// BN Life Certificate Runner — scheduled milestone processor.
//
// Finds obligations that have reached a reminder, grace or overdue milestone
// and calls the server-side command for each one. The runner NEVER computes a
// business outcome itself and never writes to bn_life_certificate: every
// transition, communication intent and audit record is produced inside
// `bn_life_certificate_mark_milestone_v1`, in one transaction.
//
// Idempotency: the key is derived from the obligation id, milestone and the
// milestone date, so retries of the same batch replay the stored receipt
// instead of transitioning twice.
//
// Privacy: no claimant PII (SSN, names, addresses) is logged. Only obligation
// ids, milestones and sanitized short error codes appear in the output.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { type DueRow, MAX_BATCH, planMilestoneWork } from "./plan.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Milestone = string;

type ItemResult = {
  lifeCertificateId: string;
  milestone: Milestone;
  outcome: "processed" | "replayed" | "skipped" | "failed";
  errorCode?: string;
};


function sanitize(message: string): string {
  const match = message.match(/E_[A-Z_]+/);
  return match ? match[0] : "E_UNKNOWN";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const correlationId = crypto.randomUUID();

  // Scheduler-only surface: a shared secret header is required. Without it no
  // scan and no transition happens.
  const expectedSecret = Deno.env.get("BN_LIFE_CERTIFICATE_RUNNER_SECRET");
  if (!expectedSecret || req.headers.get("x-bn-life-certificate-runner-secret") !== expectedSecret) {
    console.warn("[bn-life-certificate-runner] rejected unauthenticated invocation", correlationId);
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

    let body: { asOf?: string; limit?: number; dryRun?: boolean } = {};
    try { body = await req.json(); } catch { /* scheduler may post an empty body */ }

    const asOf = body.asOf ?? new Date().toISOString().slice(0, 10);
    const limit = Math.min(body.limit ?? MAX_BATCH, MAX_BATCH);

    const { data: due, error: dueError } = await db.rpc(
      "bn_life_certificate_due_milestones_v1",
      { p_as_of: asOf, p_limit: limit },
    );
    if (dueError) throw new Error(dueError.message);

    const rows = (due ?? []) as DueRow[];
    const plan = planMilestoneWork(rows);
    const results: ItemResult[] = [];

    for (const item of plan) {
      const row = { life_certificate_id: item.lifeCertificateId, milestone: item.milestone, milestone_date: item.milestoneDate };
      // Failure isolation: one bad obligation never aborts the batch.
      if (item.skipped) {
        results.push({
          lifeCertificateId: row.life_certificate_id,
          milestone: row.milestone,
          outcome: "skipped",
          errorCode: item.skipReason,
        });
        continue;
      }

      const idempotencyKey = item.idempotencyKey;

      try {
        const { data, error } = await db.rpc("bn_life_certificate_mark_milestone_v1", {
          p_life_certificate_id: row.life_certificate_id,
          p_milestone: row.milestone,
          p_idempotency_key: idempotencyKey,
          p_correlation_id: correlationId,
        });
        if (error) throw new Error(error.message);
        const status = (data as { status?: string } | null)?.status ?? "OK";
        // Successful and replayed commands never count as failures.
        results.push({
          lifeCertificateId: row.life_certificate_id,
          milestone: row.milestone,
          outcome: status === "REPLAYED" || status === "NO_OP" ? "replayed" : "processed",
        });
      } catch (e) {
        const errorCode = sanitize(e instanceof Error ? e.message : "");
        // Failures are counted per obligation + milestone + milestone date, in
        // a restricted operational log. Technical detail never leaves the DB.
        await db.rpc("bn_life_certificate_record_milestone_failure_v1", {
          p_life_certificate_id: row.life_certificate_id,
          p_milestone: row.milestone,
          p_milestone_date: row.milestone_date,
          p_error_code: errorCode,
          p_error_detail: e instanceof Error ? e.message : String(e),
          p_correlation_id: correlationId,
        });
        results.push({
          lifeCertificateId: row.life_certificate_id,
          milestone: row.milestone,
          outcome: "failed",
          errorCode,
        });
      }
    }

    const summary = {
      correlationId,
      asOf,
      scanned: rows.length,
      processed: results.filter((r) => r.outcome === "processed").length,
      replayed: results.filter((r) => r.outcome === "replayed").length,
      skipped: results.filter((r) => r.outcome === "skipped").length,
      failed: results.filter((r) => r.outcome === "failed").length,
      durationMs: Date.now() - startedAt,
      results,
    };

    console.log("[bn-life-certificate-runner]", JSON.stringify({ ...summary, results: undefined }));

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const errorCode = sanitize(e instanceof Error ? e.message : "");
    console.error("[bn-life-certificate-runner] batch failure", correlationId, errorCode);
    return new Response(JSON.stringify({ correlationId, error: errorCode }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
