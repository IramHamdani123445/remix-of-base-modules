// Omni-Comms — Print / Correspondence production worker.
//
// This is the ONLY surface that drains queued `print` dispatch jobs. It never
// contacts an external provider: acceptance means an immutable correspondence
// artefact (PDF) was rendered and archived, and the governed physical print
// item was created for the production queue.
//
// Boundaries:
//   * The caller supplies NOTHING that can influence WHAT is produced. Only a
//     bounded batch limit and a non-sensitive correlation id are accepted.
//   * The database claim transaction is the authority: it re-checks Print
//     release control (must be `live`), rendered print content and the postal
//     destination before any artefact is produced.
//   * Acceptance = artefact produced. It never means printed or dispatched;
//     those remain governed physical states on the print item.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { producePrintArtefact } from "../_shared/omni-comms/printArtefactAdapter.ts";
import { decodePngForPdf, type PrintImageAsset } from "../_shared/omni-comms/printImage.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-correlation-id, x-omni-comms-dispatch-ticket, x-omni-comms-scheduler-nonce",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DEPLOYED_REVISION = Deno.env.get("OMNI_COMMS_DEPLOYED_REVISION") ?? "";

const CHANNEL = "print";
const MAX_BATCH_LIMIT = 25;
// PDF rendering plus a private Storage write must finish inside the worker's
// execution window. Process one letter per scheduler invocation by default;
// callers may still request a larger bounded batch explicitly.
const DEFAULT_BATCH_LIMIT = 1;
const STORAGE_WRITE_TIMEOUT_MS = 20_000;
const BOUNDED_CODE = /^[a-z][a-z0-9_]{0,63}$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method === "GET" && new URL(req.url).pathname.endsWith("/health")) {
    const rev = DEPLOYED_REVISION.trim().toLowerCase();
    return json({
      function: "omni-comms-print-production",
      available: true,
      revision: /^[0-9a-f]{40}$/.test(rev) ? rev : null,
      revisionVerified: /^[0-9a-f]{40}$/.test(rev),
    });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE) {
    return json({ error: "configuration_error" }, 503);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "OC401", detail: "authentication_required" }, 401);
  }

  let raw: Record<string, unknown> = {};
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    raw = {};
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return json({ error: "OC422", detail: "dispatch_input_invalid" }, 400);
  }
  const rejected = Object.keys(raw).filter((k) => !["batchLimit", "correlationId"].includes(k));
  if (rejected.length > 0) {
    return json(
      { error: "OC422", detail: "caller_supplied_dispatch_input_forbidden", fields: rejected },
      400,
    );
  }
  if ("batchLimit" in raw && raw.batchLimit !== null) {
    const c = raw.batchLimit;
    if (typeof c !== "number" || !Number.isInteger(c) || c < 1 || c > MAX_BATCH_LIMIT) {
      return json({ error: "OC422", detail: "batch_limit_invalid" }, 400);
    }
  }
  if (
    "correlationId" in raw && raw.correlationId !== null &&
    (typeof raw.correlationId !== "string" ||
      !/^[A-Za-z0-9_.:-]{1,120}$/.test(raw.correlationId))
  ) {
    return json({ error: "OC422", detail: "correlation_id_invalid" }, 400);
  }

  const batchLimit = typeof raw.batchLimit === "number" ? raw.batchLimit : DEFAULT_BATCH_LIMIT;
  const correlationId = typeof raw.correlationId === "string" ? raw.correlationId : null;

  const service = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ── Authorisation ───────────────────────────────────────────────────────
  // A service-role caller (scheduler tick) is trusted; every other caller must
  // pass the same operator capability oracle used by Email dispatch.
  const isServiceCaller = authHeader.slice(7).trim() === SERVICE_ROLE;
  const schedulerNonce = (req.headers.get("x-omni-comms-scheduler-nonce") ?? "").trim();
  let authorised = isServiceCaller;

  if (!authorised && /^[0-9a-f]{64}$/.test(schedulerNonce)) {
    const consumed = await service.rpc("omni_comms_priv_scheduler_consume_ticket", {
      p_nonce: schedulerNonce,
      p_purpose: "dispatch",
    });
    authorised = !consumed.error && consumed.data === true;
  }

  if (!authorised) {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const auth = await userClient.rpc("omni_comms_dispatch_tick_authorize");
    if (auth.error) {
      console.error(
        `omni-comms-print-production authorization_failed correlation=${correlationId ?? "none"}`,
      );
      return json({ error: "OC403", detail: "authorization_failed" }, 403);
    }
    const authz = (auth.data ?? {}) as Record<string, unknown>;
    if (authz.allowed !== true) {
      const denied = BOUNDED_CODE.test(String(authz.code ?? ""))
        ? String(authz.code)
        : "permission_denied";
      return json({ error: "OC403", detail: denied }, 403);
    }
    authorised = true;
  }

  await service.rpc("omni_comms_priv_dispatch_reclaim_expired_leases");

  const claimed = await service.rpc("omni_comms_priv_print_production_claim", {
    p_worker: "omni-comms-print-production",
    p_batch_limit: batchLimit,
    p_correlation_id: correlationId,
    p_deployed_revision: DEPLOYED_REVISION,
  });
  if (claimed.error) {
    const claimErrorCode = BOUNDED_CODE.test(String(claimed.error.code ?? ""))
      ? String(claimed.error.code)
      : "database_error";
    const claimErrorMessage = String(claimed.error.message ?? "")
      .replace(/[^A-Za-z0-9_ .:-]/g, "")
      .slice(0, 240);
    console.error(
      `omni-comms-print-production claim_failed correlation=${correlationId ?? "none"} code=${claimErrorCode} message=${claimErrorMessage || "unavailable"}`,
    );
    return json({ error: "OC500", detail: "print_claim_failed", code: claimErrorCode }, 500);
  }

  const plan = (claimed.data ?? {}) as Record<string, unknown>;
  const claims = Array.isArray(plan.claims) ? (plan.claims as Record<string, unknown>[]) : [];

  const store = {
    upload: async (bucket: string, path: string, body: Uint8Array, contentType: string) => {
      const upload = service.storage.from(bucket).upload(path, body, {
        contentType,
        upsert: true,
      });
      const timeout = new Promise<{ data: null; error: Error }>((resolve) => {
        setTimeout(
          () => resolve({ data: null, error: new Error("Print artefact storage timed out.") }),
          STORAGE_WRITE_TIMEOUT_MS,
        );
      });
      const res = await Promise.race([upload, timeout]);
      if (res.error) {
        const timedOut = res.error.message.includes("timed out");
        return {
          ok: false as const,
          errorCode: timedOut ? "print_store_timeout" : "print_store_rejected",
          detail: res.error.message,
        };
      }
      return { ok: true as const };
    },
  };

  const results: Record<string, unknown>[] = [];
  /** Decoded letterhead logos, reused across every letter in the batch. */
  const logoCache = new Map<string, PrintImageAsset | null>();

  for (const claim of claims) {
    const attemptId = String(claim.attempt_id ?? "");
    const claimToken = String(claim.claim_token ?? "");
    if (!attemptId || !claimToken) continue;

    const lines = Array.isArray(claim.postal_address_lines)
      ? (claim.postal_address_lines as unknown[]).map((l) => String(l)).filter(Boolean)
      : [];

    // Effective stationery resolved server-side: organisation default,
    // overridden by the owning department's profile (e.g. Benefits).
    const st = (claim.stationery ?? {}) as Record<string, unknown>;
    const strings = (v: unknown) =>
      Array.isArray(v) ? v.map((l) => String(l)).filter(Boolean) : [];

    // Letterhead logo: downloaded from the branding bucket and embedded so the
    // printed letter matches the Communication & Documents template preview.
    const logoBucket = (st.logo_bucket as string | null) ?? null;
    const logoPath = (st.logo_path as string | null) ?? null;
    let logo = logoPath ? logoCache.get(`${logoBucket ?? "url"}:${logoPath}`) ?? null : null;
    if (logoPath && !logo && !logoCache.has(`${logoBucket ?? "url"}:${logoPath}`)) {
      try {
        let bytes: Uint8Array | null = null;
        if (logoBucket) {
          const dl = await service.storage.from(logoBucket).download(logoPath);
          if (!dl.error && dl.data) bytes = new Uint8Array(await dl.data.arrayBuffer());
        } else {
          const res = await fetch(logoPath);
          if (res.ok) bytes = new Uint8Array(await res.arrayBuffer());
        }
        logo = bytes ? await decodePngForPdf(bytes) : null;
      } catch (_error) {
        logo = null;
      }
      logoCache.set(`${logoBucket ?? "url"}:${logoPath}`, logo);
    }

    const outcome = await producePrintArtefact({
      idempotencyKey: `omni-comms/print/${String(claim.message_id ?? attemptId)}`,
      recipientReference: String(claim.recipient_reference ?? claim.recipient_display ?? "recipient"),
      returnReference: (claim.issuing_authority as string | null) ?? null,
      documentTitle: String(claim.subject ?? "Correspondence"),
      bodyText: String(claim.text_body ?? ""),
      postalDestination: lines,
      stationery: {
        headerLines: strings(st.header_lines),
        letterheadFooterLines: strings(st.letterhead_footer_lines),
        footerLines: strings(st.footer_lines),
        pageFooter: (st.page_footer as string | null) ?? null,
        letterheadName: (st.letterhead_name as string | null) ?? null,
        letterheadSource: (st.letterhead_source as string | null) ?? null,
        printFooterName: (st.print_footer_name as string | null) ?? null,
        printFooterSource: (st.print_footer_source as string | null) ?? null,
        logo,
        logoName: (st.logo_name as string | null) ?? null,
      },

      // Print content is ALWAYS produced from the print variant.
      sourceChannel: "print",
      store,
    });


    const artefact = (outcome.providerResponse ?? {}) as Record<string, unknown>;
    const completion = await service.rpc("omni_comms_priv_print_production_complete", {
      p_attempt_id: attemptId,
      p_claim_token: claimToken,
      p_status: outcome.status === "accepted" ? "accepted" : "failed",
      p_artefact: outcome.status === "accepted"
        ? {
          ...artefact,
          letter_reference: artefact.letter_reference ?? claim.letter_reference ?? null,
          issuing_authority: claim.issuing_authority ?? null,
          recipient_reference: claim.recipient_reference ?? null,
        }
        : null,
      p_error_code: outcome.errorCode ?? null,
      p_error_detail: outcome.errorDetail ?? null,
    });
    if (completion.error) {
      const completionMessage = String(completion.error.message ?? "")
        .replace(/[^A-Za-z0-9_ .:-]/g, "")
        .slice(0, 240);
      console.error(
        `omni-comms-print-production evidence_record_failed correlation=${correlationId ?? "none"} attempt=${attemptId} message=${completionMessage || "unavailable"}`,
      );
    }

    results.push({
      attempt_id: attemptId,
      attempt_number: claim.attempt_number ?? null,
      outcome: outcome.status,
      result_code: outcome.resultCode,
      print_item_id: (completion.data as Record<string, unknown> | null)?.print_item_id ?? null,
      recorded: !completion.error,
    });
  }

  return json({
    channel: CHANNEL,
    mode: "queued",
    batch_limit: batchLimit,
    correlation_id: correlationId,
    scanned_jobs: plan.scanned_jobs ?? 0,
    claimed_jobs: plan.claimed_jobs ?? 0,
    blocker: plan.blocker ?? null,
    blockers: plan.blockers ?? [],
    results,
  });
});
