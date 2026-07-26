// comm-hub-automation-tick@2026-07-26-slice-b
// Real scheduler worker for Communication Hub Automated Production.
//
// Two actions:
//   - action=probe : writes a `scheduler` readiness evidence row; performs no
//     queue claim, no provider call. Requires only the scheduler secret.
//   - action=run   : opens a scheduler tick lease, invokes the canonical
//     queue dispatcher (comm-hub-dispatch, operation=queue) bounded by
//     batch_size, then completes the lease. A heartbeat is only recorded on
//     a successful tick with no error.
//
// This function NEVER contacts a provider directly. All provider I/O is
// delegated to `comm-hub-dispatch`.

import { createClient } from "npm:@supabase/supabase-js@2";

const RUNTIME_BUILD = "comm-hub-automation-tick@2026-07-26-slice-b";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, apikey, x-client-info, x-scheduler-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SCHEDULER_SECRET = Deno.env.get("COMMUNICATION_HUB_SCHEDULER_SECRET") ?? "";
    const DISPATCH_SECRET = Deno.env.get("COMMUNICATION_HUB_DISPATCH_SECRET") ?? "";

    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return json({ ok: false, runtime_build: RUNTIME_BUILD, error: "misconfigured" }, 503);
    }
    if (!SCHEDULER_SECRET) {
      return json({
        ok: false, runtime_build: RUNTIME_BUILD,
        error: "scheduler_secret_not_configured",
      }, 503);
    }

    const provided = req.headers.get("x-scheduler-secret") ?? "";
    if (provided !== SCHEDULER_SECRET) {
      return json({ ok: false, runtime_build: RUNTIME_BUILD, error: "unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({} as any));
    const action: string = typeof body?.action === "string" ? body.action : "";
    const moduleCode: string = body?.module_code ?? "";
    const eventCode: string = body?.event_code ?? "";
    const channel: string = body?.channel ?? "email";
    const workerVersion: string = body?.worker_version ?? RUNTIME_BUILD;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ---------- action=probe ----------
    if (action === "probe") {
      const probedAt = new Date().toISOString();
      // Best-effort evidence write; the row is scoped when module/event provided.
      const { error: insErr } = await admin
        .from("comm_hub_automation_readiness_results")
        .insert({
          module_code: moduleCode || "*",
          event_code: eventCode || "*",
          channel,
          check_code: "scheduler",
          configuration_version: 0,
          result: true,
          source: "SERVER_PROBE",
          evidence: {
            runtime_build: RUNTIME_BUILD,
            worker_version: workerVersion,
            probed_at: probedAt,
            probe_kind: "scheduler_runtime_probe",
          },
          checked_at: probedAt,
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        });
      return json({
        ok: !insErr,
        runtime_build: RUNTIME_BUILD,
        probed_at: probedAt,
        worker_version: workerVersion,
        evidence_write_error: insErr?.message ?? null,
      });
    }

    // ---------- action=run ----------
    if (action === "run") {
      // Ask permission to run.
      const { data: beginData, error: beginErr } = await admin.rpc(
        "begin_comm_hub_scheduler_tick",
        { p_worker_version: workerVersion },
      );
      if (beginErr) {
        return json({
          ok: false, runtime_build: RUNTIME_BUILD,
          error: "begin_tick_failed", detail: beginErr.message,
        }, 500);
      }
      const begin = beginData as any;
      if (!begin?.allowed) {
        return json({
          ok: true, runtime_build: RUNTIME_BUILD,
          allowed: false, blockers: begin?.blockers ?? [],
          note: "no heartbeat recorded — tick refused before any claim",
        });
      }

      // Invoke the canonical queue dispatcher under this lease.
      let counts = { processed: 0, sent: 0, retried: 0, failed: 0, skipped: 0 };
      let tickError: any = null;

      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/comm-hub-dispatch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SERVICE_ROLE}`,
            "x-comm-hub-dispatch-secret": DISPATCH_SECRET,
            "x-scheduler-lease-id": begin.lease_id,
            "x-scheduler-arm-audit-id": begin.current_arm_audit_id,
            "x-scheduler-generation": String(begin.automation_generation),
          },
          body: JSON.stringify({
            operation: "queue",
            module_code: moduleCode || null,
            event_code: eventCode || null,
            channel,
            scheduler_lease_id: begin.lease_id,
          }),
        });
        const txt = await resp.text();
        let parsed: any = null;
        try { parsed = JSON.parse(txt); } catch { /* keep raw */ }
        if (!resp.ok) {
          tickError = { http_status: resp.status, body: parsed ?? txt };
        } else if (parsed) {
          counts = {
            processed: Number(parsed.processed ?? 0),
            sent:      Number((parsed.sentLive ?? 0) + (parsed.sentDryRun ?? 0)),
            retried:   Number(parsed.retried ?? 0),
            failed:    Number(parsed.failed ?? 0),
            skipped:   Number(parsed.skipped ?? 0),
          };
        }
      } catch (e) {
        tickError = { transport_error: String(e?.message ?? e) };
      }

      const { data: doneData, error: doneErr } = await admin.rpc(
        "complete_comm_hub_scheduler_tick",
        {
          p_lease_id: begin.lease_id,
          p_arm_audit_id: begin.current_arm_audit_id,
          p_automation_generation: begin.automation_generation,
          p_readiness_hash: begin.readiness_hash,
          p_counts: counts,
          p_error: tickError,
        },
      );

      return json({
        ok: !tickError && !(doneErr),
        runtime_build: RUNTIME_BUILD,
        allowed: true,
        lease_id: begin.lease_id,
        arm_audit_id: begin.current_arm_audit_id,
        automation_generation: begin.automation_generation,
        readiness_hash: begin.readiness_hash,
        counts,
        tick_error: tickError,
        complete_error: doneErr?.message ?? null,
        heartbeat_recorded: (doneData as any)?.heartbeat_recorded === true,
        complete_blockers: (doneData as any)?.blockers ?? [],
      });
    }

    return json({
      ok: false, runtime_build: RUNTIME_BUILD,
      error: "unknown_action",
      supported: ["probe", "run"],
    }, 400);
  } catch (e: any) {
    return json({
      ok: false, runtime_build: RUNTIME_BUILD,
      error: "unhandled_exception",
      message: String(e?.message ?? e),
    }, 500);
  }
});
