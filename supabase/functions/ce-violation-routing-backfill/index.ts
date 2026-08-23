/**
 * Compliance violation ROUTING BACKFILL worker.
 *
 * Assigns historical violations that were created before `fn_ce_route_violation`
 * was corrected. Each batch is a separate RPC call (its own transaction), so the
 * job is:
 *   - idempotent      — only ever selects violations with no queue and no owner
 *   - resumable       — interruption loses at most one in-flight batch
 *   - safe to rerun   — already routed rows are skipped by the selection predicate
 *   - observable      — every batch is written to ce_violation_routing_backfill_log
 *
 * POST body: { batchSize?: number, maxBatches?: number, budgetMs?: number, runKey?: string }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, serviceKey);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const batchSize = Math.max(100, Math.min(Number(body.batchSize ?? 1000), 5000));
  const maxBatches = Math.max(1, Math.min(Number(body.maxBatches ?? 50), 500));
  const budgetMs = Math.max(5000, Math.min(Number(body.budgetMs ?? 110000), 240000));
  const runKey = String(body.runKey ?? `backfill-${new Date().toISOString().slice(0, 10)}`);

  const startedAt = Date.now();

  const remainingCount = async (): Promise<number> => {
    const { data, error } = await supabase.rpc(
      "fn_ce_unassigned_violation_count",
    );
    if (error) {
      errors.push(`count: ${error.message}`);
      return -1;
    }
    return Number(data ?? 0);
  };

  const errors: string[] = [];
  const startingUnassigned = await remainingCount();
  let routed = 0;
  let failed = 0;
  let batches = 0;
  let remaining = startingUnassigned;

  let consecutiveErrors = 0;

  while (
    batches < maxBatches &&
    remaining !== 0 &&
    Date.now() - startedAt < budgetMs
  ) {
    batches += 1;
    const { data, error } = await supabase.rpc(
      "fn_ce_route_unassigned_violations",
      { p_limit: batchSize },
    );

    if (error) {
      errors.push(error.message);
      consecutiveErrors += 1;
      // Transient timeouts must not abort the whole run — previous batches are
      // already committed, so retry until the failures become persistent.
      if (consecutiveErrors >= 3) break;
      continue;
    }
    consecutiveErrors = 0;

    const batchRouted = Number((data as any)?.routed ?? 0);
    const batchFailed = Number((data as any)?.failed ?? 0);
    routed += batchRouted;
    failed += batchFailed;
    remaining = await remainingCount();

    await supabase.from("ce_violation_routing_backfill_log").insert({
      run_key: runKey,
      batch_no: batches,
      batch_size: batchSize,
      routed: batchRouted,
      failed: batchFailed,
      remaining,
    });

    // No forward progress: everything left is permanently unroutable.
    if (batchRouted === 0) break;
  }

  return new Response(
    JSON.stringify({
      ok: errors.length === 0,
      runKey,
      startingUnassigned,
      batches,
      batchSize,
      routed,
      failed,
      remaining,
      elapsedMs: Date.now() - startedAt,
      complete: remaining === 0,
      errors,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
