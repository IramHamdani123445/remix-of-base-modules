/**
 * Compliance detection EVENT RUNNER.
 *
 * Drains `ce_detection_event_queue` (populated by the configurable
 * `ce_detection_event_triggers` mapping — e.g. EMPLOYER_REGISTERED) and runs
 * the SAME production detection engine used by the scheduled job and by
 * "Run Detection Now": the `ce-violation-scan` edge function, scoped to the
 * employer so it always completes inside the worker budget.
 *
 * The runner never persists violations itself — persistence, duplicate
 * protection and audit all stay in `ce-violation-scan`.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_ATTEMPTS = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(url, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const batch: number = Math.min(25, Math.max(1, Number(body.batch ?? 10)));

    const { data: pending, error } = await supabase
      .from("ce_detection_event_queue")
      .select("id, event_code, employer_id, attempts")
      .eq("status", "PENDING")
      .order("requested_at", { ascending: true })
      .limit(batch);

    if (error) throw error;

    const results: Array<Record<string, unknown>> = [];

    for (const row of pending ?? []) {
      // Claim the row first so concurrent ticks cannot double-dispatch.
      const { data: claimed } = await supabase
        .from("ce_detection_event_queue")
        .update({ status: "RUNNING", attempts: (row.attempts ?? 0) + 1 })
        .eq("id", row.id)
        .eq("status", "PENDING")
        .select("id")
        .maybeSingle();

      if (!claimed) continue;

      try {
        const scanRes = await fetch(`${url}/functions/v1/ce-violation-scan`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            employer_id: row.employer_id,
            force: true,
            dry_run: false,
            triggered_by: `EVENT:${row.event_code}`,
          }),
        });

        const payload = await scanRes.json().catch(() => ({}));
        if (!scanRes.ok) {
          throw new Error(
            payload?.error || `ce-violation-scan returned ${scanRes.status}`,
          );
        }

        await supabase
          .from("ce_detection_event_queue")
          .update({
            status: "DISPATCHED",
            detection_run_id: payload?.run_id ?? null,
            processed_at: new Date().toISOString(),
            error_message: null,
          })
          .eq("id", row.id);

        results.push({
          queue_id: row.id,
          employer_id: row.employer_id,
          run_id: payload?.run_id ?? null,
          status: "DISPATCHED",
        });
      } catch (err) {
        const attempts = (row.attempts ?? 0) + 1;
        await supabase
          .from("ce_detection_event_queue")
          .update({
            status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
            error_message: (err as Error).message,
            processed_at:
              attempts >= MAX_ATTEMPTS ? new Date().toISOString() : null,
          })
          .eq("id", row.id);

        results.push({
          queue_id: row.id,
          employer_id: row.employer_id,
          status: attempts >= MAX_ATTEMPTS ? "FAILED" : "RETRY",
          error: (err as Error).message,
        });
      }
    }

    return new Response(
      JSON.stringify({ processed: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
