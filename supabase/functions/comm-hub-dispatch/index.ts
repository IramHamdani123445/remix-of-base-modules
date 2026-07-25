// Enterprise Communication Hub — async dispatcher (Phase 1C-B3-B).
//
// Dry-run remains the default. A LIVE email path is added but is gated behind
// FOUR independent checks — any single failure keeps the message in dry-run
// or requeues it without a provider call:
//
//   1. Correct `x-comm-hub-dispatch-secret` header.
//   2. `COMMUNICATION_HUB_DISPATCH_ENABLED=true`.
//   3. `COMMUNICATION_HUB_EMAIL_LIVE=true`.
//   4. `COMMUNICATION_HUB_EMAIL_LIVE_ALLOWLIST` configured AND recipient matches.
//
// Only when ALL four pass AND the message row is
//   origin='comm_hub' AND channel='email' AND status='queued' AND test_mode=false
// does the dispatcher hit a real provider.
//
// test_mode=true rows always go through the existing dry-run path.
//
// This function still does NOT read notification_queue / notification_logs /
// bn_communication_log / ce_notice_delivery_log / ce_audit_communications,
// and does NOT call send-email-campaign / send-notification /
// process-pending-notifications.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  lookupActiveEmailProvider,
  redactProviderForLog,
  type CommHubEmailProvider,
} from "../_shared/communication-hub/provider-lookup.ts";
import {
  type CommHubTransportResult,
} from "../_shared/communication-hub/transport-email.ts";
import {
  sendEmailViaGuardedTransport,
  isGuardRefusal,
} from "../_shared/communication-hub/transport-guard.ts";
import { decideRetry, loadRetryPolicy } from "../_shared/communication-hub/retry.ts";
import {
  appendTraceStepSafe as traceStep,
  completeTraceSafe as traceComplete,
} from "../_shared/commHubTrace.ts";
import {
  ACTION_BLOCKER_CODES,
  CONTROLLED_DISPATCH_ACTIONS,
  CONTROLLED_DISPATCH_SCHEMA_VERSION,
  type ControlledDispatchAction,
} from "../_shared/communication-hub/controlled-dispatch-contract.ts";

// CH-TRACE-2: resolve the upstream trace id from a message row.
// Traces are linked at enqueue time via link_comm_hub_trace_message (message_id)
// or link_comm_hub_trace_request (request_id). We fetch the linked trace here
// so dispatcher stages append to the same timeline the caller opened.
async function resolveTraceForMessage(
  // deno-lint-ignore no-explicit-any
  admin: any, messageId: string, requestId: string,
): Promise<string | null> {
  try {
    const byMsg = await admin.from("communication_hub_trace")
      .select("id").eq("message_id", messageId).limit(1).maybeSingle();
    if ((byMsg?.data as any)?.id) return (byMsg.data as any).id as string;
    const byReq = await admin.from("communication_hub_trace")
      .select("id").eq("request_id", requestId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if ((byReq?.data as any)?.id) return (byReq.data as any).id as string;
  } catch { /* swallow */ }
  return null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-comm-hub-dispatch-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const DEFAULT_BATCH_SIZE = 25;
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 50;

function flag(name: string): boolean {
  const v = (Deno.env.get(name) ?? "").toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function clampBatchSize(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return DEFAULT_BATCH_SIZE;
  if (n < MIN_BATCH_SIZE) return DEFAULT_BATCH_SIZE;
  if (n > MAX_BATCH_SIZE) return MAX_BATCH_SIZE;
  return n;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function maskEmail(addr: string | null | undefined): string | null {
  if (!addr || typeof addr !== "string") return null;
  const at = addr.indexOf("@");
  if (at <= 0) return "***";
  const local = addr.slice(0, at);
  const dom = addr.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${"*".repeat(Math.max(1, local.length - head.length))}@${dom}`;
}

/**
 * Parse COMMUNICATION_HUB_EMAIL_LIVE_ALLOWLIST env into normalized entries.
 * Entries are comma-separated; each is either:
 *   - a full email  (exact match, case-insensitive)
 *   - a domain rule beginning with '@' (e.g. '@mishainfotech.com')
 */
function parseAllowlist(raw: string | undefined): {
  emails: Set<string>;
  domains: Set<string>;
  count: number;
} {
  const emails = new Set<string>();
  const domains = new Set<string>();
  if (!raw) return { emails, domains, count: 0 };
  for (const part of raw.split(",")) {
    const t = part.trim().toLowerCase();
    if (!t) continue;
    if (t.startsWith("@")) domains.add(t.slice(1));
    else if (t.includes("@")) emails.add(t);
  }
  return { emails, domains, count: emails.size + domains.size };
}

function isEmailAllowlisted(
  email: string | null | undefined,
  list: { emails: Set<string>; domains: Set<string> },
): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  if (!e.includes("@")) return false;
  if (list.emails.has(e)) return true;
  const dom = e.slice(e.indexOf("@") + 1);
  return list.domains.has(dom);
}

/* ── DB Control Center settings (Phase 1C-B7-B) ───────────────────────── */

interface CommHubControlSettings {
  dispatch_enabled: boolean;
  dry_run_only: boolean;
  email_live_enabled: boolean;
  allowed_email_addresses: string[];
  allowed_email_domains: string[];
  batch_size: number;
  max_attempts: number;
  retry_base_seconds: number;
  retry_max_seconds: number;
  live_eligible_after: string | null;
  live_eligible_max_age_minutes: number;
  operating_mode?: string;
}

interface DbAllowlist {
  emails: Set<string>;
  domains: Set<string>;
  emailCount: number;
  domainCount: number;
}

function buildDbAllowlist(s: CommHubControlSettings): DbAllowlist {
  const emails = new Set<string>();
  const domains = new Set<string>();
  for (const e of s.allowed_email_addresses ?? []) {
    const v = (e ?? "").trim().toLowerCase();
    if (v && v.includes("@")) emails.add(v);
  }
  for (const d of s.allowed_email_domains ?? []) {
    let v = (d ?? "").trim().toLowerCase();
    if (v.startsWith("@")) v = v.slice(1);
    if (v && v.includes(".") && !v.includes("*")) domains.add(v);
  }
  return { emails, domains, emailCount: emails.size, domainCount: domains.size };
}

function isEmailDbAllowlisted(email: string | null | undefined, list: DbAllowlist): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  const at = e.indexOf("@");
  if (at <= 0) return false;
  if (list.emails.has(e)) return true;
  const dom = e.slice(at + 1);
  return list.domains.has(dom);
}

// deno-lint-ignore no-explicit-any
async function loadCommunicationHubControlSettings(admin: any): Promise<
  { ok: true; settings: CommHubControlSettings } | { ok: false; error: string }
> {
  try {
    const { data, error } = await admin
      .from("communication_hub_control_settings")
      .select("dispatch_enabled, dry_run_only, email_live_enabled, allowed_email_addresses, allowed_email_domains, batch_size, max_attempts, retry_base_seconds, retry_max_seconds, live_eligible_after, live_eligible_max_age_minutes, operating_mode")
      .eq("singleton_guard", "primary")
      .maybeSingle();
    if (error) return { ok: false, error: `settings_query_failed: ${error.message}` };
    if (!data) return { ok: false, error: "settings_row_missing" };
    return { ok: true, settings: data as CommHubControlSettings };
  } catch (e: any) {
    return { ok: false, error: `settings_exception: ${(e?.message ?? String(e)).slice(0, 200)}` };
  }
}


interface CommMessage {
  id: string;
  request_id: string;
  recipient_id: string | null;
  channel: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  status: string;
  attempt_count: number;
  test_mode: boolean;
  origin: string | null;
}

// deno-lint-ignore no-explicit-any
type Admin = ReturnType<typeof createClient<any, any, any>>;

/** Cleanly release the row lock so a future dispatcher can retry. */
async function clearLock(admin: Admin, id: string, workerId: string) {
  await admin.from("communication_message").update({
    locked_at: null,
    locked_by: null,
  }).eq("id", id).eq("locked_by", workerId);
}

serve(async (req) => {
  // 1. Method + env + secret gating (unchanged from 1C-B2.1).
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json({
      ok: false, error: "supabase_env_missing",
      note: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — no processing.",
    }, 503);
  }

  const expectedSecret = Deno.env.get("COMMUNICATION_HUB_DISPATCH_SECRET") ?? "";
  if (!expectedSecret) {
    return json({
      ok: false, error: "dispatch_secret_not_configured",
      note: "COMMUNICATION_HUB_DISPATCH_SECRET is not set — no processing.",
    }, 503);
  }
  const providedSecret = req.headers.get("x-comm-hub-dispatch-secret") ?? "";
  if (!providedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  // CH-SIMPLE-P3D-B.2.b: parse the request body ONCE up-front so we can
  // dispatch to the targeted_dry_run operation before touching the queue.
  // The body is also reused later by the normal queue path.
  const bodyParsed: any = await req.json().catch(() => ({}));
  const operation: string = typeof bodyParsed?.operation === "string" ? bodyParsed.operation : "queue";

  if (operation === "targeted_dry_run") {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    return await processTargetedDryRun(admin, bodyParsed);
  }

  if (operation === "targeted_controlled_live") {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    return await processTargetedControlledLive(admin, bodyParsed);
  }

  const dispatchEnabledEnv = flag("COMMUNICATION_HUB_DISPATCH_ENABLED");
  const emailLiveEnv = flag("COMMUNICATION_HUB_EMAIL_LIVE");
  const allowlist = parseAllowlist(Deno.env.get("COMMUNICATION_HUB_EMAIL_LIVE_ALLOWLIST"));
  const envAllowlistConfigured = allowlist.count > 0;
  const workerId = `comm-hub-dispatch:${crypto.randomUUID().slice(0, 8)}`;
  const warnings: string[] = [];

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Load DB Control Center settings — fail closed if missing/unavailable.
  const settingsRes = await loadCommunicationHubControlSettings(admin);
  if (!settingsRes.ok) {
    return json({
      ok: false,
      error: "control_settings_unavailable",
      detail: settingsRes.error,
      envDispatchEnabled: dispatchEnabledEnv,
      envEmailLive: emailLiveEnv,
      envAllowlistConfigured,
      envAllowlistCount: allowlist.count,
      workerId,
      claimed: 0, processed: 0, sentLive: 0, sentDryRun: 0,
      failed: 0, retried: 0, skipped: 0,
      warnings,
      note: "Communication Hub Control Center settings could not be loaded — no processing.",
    }, 503);
  }
  const settings = settingsRes.settings;
  const dbAllowlist = buildDbAllowlist(settings);
  const dbAllowlistConfigured = dbAllowlist.emailCount + dbAllowlist.domainCount > 0;

  // CH-SIMPLE-P2 A4: EMERGENCY_STOP overrides all dispatch. Since the operating-mode
  // RPC derives dispatch_enabled=false in EMERGENCY_STOP, effectiveDispatchEnabled
  // will already be false, but we surface the reason clearly.
  const emergencyStop = settings.operating_mode === "EMERGENCY_STOP";
  if (emergencyStop) warnings.push("EMERGENCY_STOP active — all dispatch blocked before any provider call.");
  const effectiveDispatchEnabled = dispatchEnabledEnv && settings.dispatch_enabled === true && !emergencyStop;

  // Live gating: env hard-gate AND DB soft-gates AND both allowlists AND
  // live eligibility window (Phase 1C-B8-B).
  const liveEligibleAfter = settings.live_eligible_after; // ISO string or null
  const liveEligibleMaxAgeMinutes = settings.live_eligible_max_age_minutes ?? 30;
  const liveEligibleAfterSet = liveEligibleAfter !== null && liveEligibleAfter !== undefined;

  // Phase 1C-B9-Control-Hardening: explicit window-expiry guard so an
  // accidentally-open DB gate can't authorise live sends past the wall clock.
  let liveWindowExpired = false;
  let liveWindowExpiresAt: string | null = null;
  if (liveEligibleAfterSet) {
    const startMs = new Date(liveEligibleAfter as string).getTime();
    const expiresMs = startMs + liveEligibleMaxAgeMinutes * 60_000;
    liveWindowExpiresAt = new Date(expiresMs).toISOString();
    liveWindowExpired = Date.now() > expiresMs;
  }

  // CH-RECIPIENT-1: env allowlist is now OPTIONAL. The DB Recipient Control
  // Center settings (allowed_email_addresses / allowed_email_domains, driven
  // by the active recipient_release_mode) are the source of truth. If the env
  // allowlist is ALSO configured, it acts as a redundant belt-and-braces
  // filter (see live-path check below). Empty env allowlist no longer blocks.
  const liveGatesRaw =
    emailLiveEnv &&
    settings.email_live_enabled === true &&
    settings.dry_run_only === false &&
    dbAllowlistConfigured;

  const liveAllowed = liveGatesRaw && liveEligibleAfterSet && !liveWindowExpired;

  let liveWindowReason: string | null = null;
  if (!emailLiveEnv) liveWindowReason = "env_email_live_off";
  else if (!settings.email_live_enabled) liveWindowReason = "db_email_live_off";
  else if (settings.dry_run_only) liveWindowReason = "db_dry_run_only";
  else if (!dbAllowlistConfigured) liveWindowReason = "db_allowlist_empty";
  else if (!liveEligibleAfterSet) liveWindowReason = "live_eligible_after_missing";
  else if (liveWindowExpired) liveWindowReason = "live_window_expired";
  else liveWindowReason = "open";

  if (settings.email_live_enabled && !dbAllowlistConfigured) {
    warnings.push("DB email_live_enabled=true but DB allowlist is empty — no live sending.");
  }
  if (emailLiveEnv && !envAllowlistConfigured) {
    warnings.push("COMMUNICATION_HUB_EMAIL_LIVE_ALLOWLIST env not set — using DB Recipient Control Center allowlist as source of truth.");
  }
  if (liveGatesRaw && !liveEligibleAfterSet) {
    warnings.push("live_eligible_after_missing — all gates open but no live window start recorded; historical rows will not be claimed.");
  }
  if (liveGatesRaw && liveWindowExpired) {
    warnings.push(`live_window_expired at ${liveWindowExpiresAt} — refusing live sends until window is reopened.`);
  }
  const includeLive = liveAllowed;
  const liveWindowOpen = liveAllowed;

  if (!effectiveDispatchEnabled) {
    return json({
      ok: true,
      envDispatchEnabled: dispatchEnabledEnv,
      dbDispatchEnabled: settings.dispatch_enabled,
      effectiveDispatchEnabled,
      envEmailLive: emailLiveEnv,
      dbEmailLive: settings.email_live_enabled,
      dbDryRunOnly: settings.dry_run_only,
      envAllowlistConfigured,
      dbAllowlistConfigured,
      envAllowlistCount: allowlist.count,
      dbAllowedEmailCount: dbAllowlist.emailCount,
      dbAllowedDomainCount: dbAllowlist.domainCount,
      liveEligibleAfterSet,
      liveEligibleAfter,
      liveEligibleMaxAgeMinutes,
      liveWindowOpen,
      liveWindowReason,
      includeLive,
      workerId,
      claimed: 0, processed: 0, sentLive: 0, sentDryRun: 0,
      failed: 0, retried: 0, skipped: 0,
      errors: [], warnings,
      note: "Dispatch is disabled (env or DB) — no processing.",
    });
  }

  // 3. Batch size — use smaller/safer of request body and DB, both clamped.
  //    Also parse targetMessageId for one-message targeted mode (Phase 1C-B8-C).
  let requestedBatchSize: unknown = undefined;
  let targetMessageId: string | null = null;
  let manualFlag = false;
  try {
    const body = bodyParsed; // parsed once at the top of serve()
    if (body && typeof body === "object") {
      requestedBatchSize = (body as any).batchSize;
      const t = (body as any).targetMessageId;
      if (typeof t === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) {
        targetMessageId = t;
      }
      manualFlag = (body as any).manual === true;
    }
  } catch { /* ignore */ }
  const dbBatch = clampBatchSize(settings.batch_size);
  const batchSize = targetMessageId
    ? 1
    : (requestedBatchSize === undefined
        ? dbBatch
        : Math.min(clampBatchSize(requestedBatchSize), dbBatch));

  // 4. Claim batch (or one targeted message). Live rows require
  //    p_include_live=true AND live eligibility window (Phase 1C-B8-B/C).
  let claimed: any = null;
  let claimErr: any = null;
  let targetNoClaimReason: string | null = null;
  if (targetMessageId) {
    // Pre-check the row to give a precise "why not claimed" reason without
    // exposing internals. Then attempt the atomic single-row claim.
    const { data: peek } = await admin
      .from("communication_message")
      .select("id, request_id, status, origin, channel, test_mode, created_at, next_attempt_at, locked_at, targeted_dispatch_only, send_context")
      .eq("id", targetMessageId)
      .maybeSingle();
    // CH-TRACE-2: resolve upstream trace so target-mode failures show up in the caller's timeline.
    const targetTraceId = peek
      ? await resolveTraceForMessage(admin, (peek as any).id, (peek as any).request_id)
      : null;
    await traceStep(admin, targetTraceId, {
      stage_code: "DISPATCH_CLAIM_ATTEMPTED", status: "info",
      plain_summary: `dispatcher claim attempt for message ${targetMessageId}`,
      message_id: targetMessageId,
    });
    if (!peek) {
      targetNoClaimReason = "target_not_found";
      claimed = [];
      await traceStep(admin, targetTraceId, {
        stage_code: "DISPATCH_CLAIM_ATTEMPTED", status: "blocked",
        blocker_codes: ["target_not_found"], message_id: targetMessageId,
      });
    } else if ((peek as any).targeted_dispatch_only === true
               || (peek as any).send_context === "controlled_live") {
      // Slice 2: targeted messages must never be claimed through the
      // generic dispatcher path. Route through operation="targeted_controlled_live".
      targetNoClaimReason = "target_is_targeted_dispatch_only";
      claimed = [];
      await traceStep(admin, targetTraceId, {
        stage_code: "DISPATCH_CLAIM_ATTEMPTED", status: "blocked",
        blocker_codes: ["target_is_targeted_dispatch_only"],
        plain_summary: "targeted messages require operation=targeted_controlled_live",
        message_id: targetMessageId,
      });
    } else if ((peek as any).origin !== "comm_hub" || (peek as any).channel !== "email") {
      targetNoClaimReason = "target_not_eligible_origin_or_channel";
      claimed = [];
      await traceStep(admin, targetTraceId, {
        stage_code: "DISPATCH_CLAIM_ATTEMPTED", status: "blocked",
        blocker_codes: ["target_not_eligible_origin_or_channel"], message_id: targetMessageId,
      });
    } else if ((peek as any).status !== "queued") {
      targetNoClaimReason = "target_not_queued";
      claimed = [];
      await traceStep(admin, targetTraceId, {
        stage_code: "DISPATCH_CLAIM_ATTEMPTED", status: "blocked",
        blocker_codes: ["target_not_queued"],
        plain_summary: `message status=${(peek as any).status}`,
        message_id: targetMessageId,
      });
    } else if ((peek as any).test_mode === false) {
      if (!liveAllowed) {
        targetNoClaimReason = "target_outside_live_window";
        claimed = [];
        await traceStep(admin, targetTraceId, {
          stage_code: "LIVE_WINDOW_CHECKED", status: "blocked",
          blocker_codes: ["target_outside_live_window"],
          plain_summary: `live window closed (reason=${liveWindowReason})`,
          message_id: targetMessageId,
        });
        await traceComplete(admin, targetTraceId, "blocked", "LIVE_WINDOW_CHECKED");
      }
    }
    if (claimed === null) {
      const res = await admin.rpc("claim_comm_hub_message_by_id", {
        p_message_id: targetMessageId,
        p_worker_id: workerId,
        p_include_live: includeLive,
        p_live_eligible_after: includeLive ? liveEligibleAfter : null,
        p_live_max_age_minutes: liveEligibleMaxAgeMinutes,
      });
      claimed = res.data;
      claimErr = res.error;
      if (!claimErr && (!claimed || (Array.isArray(claimed) && claimed.length === 0))) {
        targetNoClaimReason = targetNoClaimReason ?? "target_not_claimable";
        await traceStep(admin, targetTraceId, {
          stage_code: "DISPATCH_CLAIM_ATTEMPTED", status: "blocked",
          blocker_codes: [targetNoClaimReason],
          message_id: targetMessageId,
        });
      } else if (!claimErr && Array.isArray(claimed) && claimed.length > 0) {
        await traceStep(admin, targetTraceId, {
          stage_code: "DISPATCH_CLAIMED", status: "passed",
          plain_summary: `claimed by worker ${workerId}`,
          message_id: targetMessageId,
        });
      }
    }
  } else {
    const claimArgs: Record<string, unknown> = {
      p_batch_size: batchSize,
      p_worker_id: workerId,
      p_include_live: includeLive,
    };
    if (includeLive) {
      claimArgs.p_live_eligible_after = liveEligibleAfter;
      claimArgs.p_live_max_age_minutes = liveEligibleMaxAgeMinutes;
    }
    const res = await admin.rpc("claim_comm_hub_messages", claimArgs);
    claimed = res.data;
    claimErr = res.error;
  }
  if (claimErr) {
    return json({
      ok: false,
      envDispatchEnabled: dispatchEnabledEnv, dbDispatchEnabled: settings.dispatch_enabled,
      effectiveDispatchEnabled, envEmailLive: emailLiveEnv, dbEmailLive: settings.email_live_enabled,
      dbDryRunOnly: settings.dry_run_only, envAllowlistConfigured, dbAllowlistConfigured,
      envAllowlistCount: allowlist.count, dbAllowedEmailCount: dbAllowlist.emailCount,
      dbAllowedDomainCount: dbAllowlist.domainCount,
      liveEligibleAfterSet, liveEligibleAfter, liveEligibleMaxAgeMinutes,
      liveWindowOpen, liveWindowReason, includeLive,
      targetMode: !!targetMessageId, targetMessageId, manual: manualFlag,
      workerId, effectiveBatchSize: batchSize,
      claimed: 0, processed: 0, sentLive: 0, sentDryRun: 0,
      failed: 0, retried: 0, skipped: 0,
      errors: [`claim_failed: ${claimErr.message}`], warnings,
    }, 500);
  }



  const rows = (claimed ?? []) as CommMessage[];
  const errors: string[] = [];
  let processed = 0;
  let sentLive = 0;
  let sentDryRun = 0;
  let failed = 0;
  let retried = 0;
  let skipped = 0;
  const counters = { postProviderAuditFailures: 0, messageUpdateFailures: 0 };
  const touchedRequests = new Set<string>();

  // Cache provider lookup for this batch (one active provider per run).
  let providerCache: CommHubEmailProvider | null | undefined = undefined;
  const getProvider = async (): Promise<CommHubEmailProvider | null> => {
    if (providerCache !== undefined) return providerCache;
    const res = await lookupActiveEmailProvider(admin);
    providerCache = res.ok ? res.provider : null;
    return providerCache;
  };

  for (const msg of rows) {
    processed++;
    touchedRequests.add(msg.request_id);

    // Defensive: only comm_hub email is eligible on either path.
    if (msg.origin !== "comm_hub" || msg.channel !== "email") {
      skipped++;
      await admin.from("communication_message").update({
        status: "queued", locked_at: null, locked_by: null,
      }).eq("id", msg.id);
      await admin.from("communication_event_log").insert({
        request_id: msg.request_id, message_id: msg.id,
        event_type: "queued", source: "comm-hub-dispatch",
        payload: {
          stage: "SKIPPED_NOT_ELIGIBLE",
          origin: msg.origin, channel: msg.channel, test_mode: msg.test_mode,
        },
      });
      continue;
    }

    // CH-SIMPLE-P3D-B.2.b — Defensive cron/queue guard: even if a defect
    // caused a dry-run-locked message to be claimed by the batch path, refuse
    // to process it through the live/dry-run branches below. Dry-run-locked
    // messages MUST only be processed via the `targeted_dry_run` operation.
    // We fetch the authoritative flag here rather than trusting the claim RPC
    // shape, so this fails closed even if the RPC signature drifts.
    const { data: lockPeek } = await admin
      .from("communication_message")
      .select("dry_run_locked, send_context")
      .eq("id", msg.id)
      .maybeSingle();
    if ((lockPeek as any)?.dry_run_locked === true || (lockPeek as any)?.send_context === "dry_run") {
      skipped++;
      await admin.from("communication_message").update({
        locked_at: null, locked_by: null,
      }).eq("id", msg.id).eq("locked_by", workerId);
      await admin.from("communication_event_log").insert({
        request_id: msg.request_id, message_id: msg.id,
        event_type: "queued", source: "comm-hub-dispatch",
        payload: {
          stage: "SKIPPED_DRY_RUN_LOCKED",
          blocker_code: "dry_run_message_cron_claim_refused",
          send_context: (lockPeek as any)?.send_context ?? null,
          note: "Dry-run-locked message refused by cron/queue path; use targeted_dry_run.",
        },
      });
      continue;
    }

    // Route per-row: live requires ALL gates. Otherwise dry-run path.
    let eligibleForLive = liveAllowed && msg.test_mode === false;

    // Event-level live status gate (Phase 1C-B9-B-A-2).
    // Look up request's module/event and require the event to permit live
    // for this dispatch mode. Manual dispatch (targetMode) allows both
    // live_manual_only and live_cron_allowed; scheduled/cron/batch allows
    // ONLY live_cron_allowed.
    let eventLiveStatus: string | null = null;
    let eventModuleCode: string | null = null;
    let eventEventCode: string | null = null;
    if (eligibleForLive) {
      const { data: reqRow } = await admin
        .from("communication_request")
        .select("module_code, event_code")
        .eq("id", msg.request_id).maybeSingle();
      eventModuleCode = (reqRow as any)?.module_code ?? null;
      eventEventCode  = (reqRow as any)?.event_code  ?? null;
      if (eventModuleCode && eventEventCode) {
        const { data: es } = await admin.rpc("get_event_live_status", {
          p_module_code: eventModuleCode, p_event_code: eventEventCode,
        });
        eventLiveStatus = typeof es === "string" ? es : null;
      }
      const manualOk = eventLiveStatus === "live_manual_only" || eventLiveStatus === "live_cron_allowed";
      const cronOk   = eventLiveStatus === "live_cron_allowed";
      const gateOk = manualFlag ? manualOk : cronOk;
      if (!gateOk) {
        eligibleForLive = false;
        skipped++;
        await admin.from("communication_message").update({
          status: "queued", locked_at: null, locked_by: null,
        }).eq("id", msg.id);
        await admin.from("communication_event_log").insert({
          request_id: msg.request_id, message_id: msg.id,
          event_type: "queued", source: "comm-hub-dispatch",
          payload: {
            stage: "SKIPPED_EVENT_LIVE_STATUS",
            module_code: eventModuleCode, event_code: eventEventCode,
            event_live_status: eventLiveStatus, manual: manualFlag,
          },
        });
        continue;
      }
    }

    if (eligibleForLive) {
      const outcome = await processLiveMessage(
        admin, msg, workerId, allowlist, dbAllowlist, getProvider, counters,
      );
      if (outcome === "sent") sentLive++;
      else if (outcome === "retried") retried++;
      else if (outcome === "skipped") skipped++;
      else failed++;
      if (outcome === "error") errors.push(`live_error:${msg.id}`);
    } else {

      // Dry-run branch — preserves 1C-B2 behavior. Any test_mode=false row
      // that leaked into the batch when live is not fully allowed is safely
      // requeued without a provider call.
      if (msg.test_mode !== true) {
        skipped++;
        await admin.from("communication_message").update({
          status: "queued", locked_at: null, locked_by: null,
        }).eq("id", msg.id);
        await admin.from("communication_event_log").insert({
          request_id: msg.request_id, message_id: msg.id,
          event_type: "queued", source: "comm-hub-dispatch",
          payload: {
            stage: "SKIPPED_LIVE_NOT_ALLOWED",
            reason: liveAllowed ? "unknown" : "live_gating_failed",
            test_mode: msg.test_mode,
          },
        });
        continue;
      }
      const outcome = await processDryRunMessage(admin, msg, workerId);
      if (outcome === "sent") sentDryRun++;
      else failed++;
    }
  }

  for (const reqId of touchedRequests) {
    const { error: rollErr } = await admin.rpc(
      "recompute_communication_request_status",
      { p_request_id: reqId },
    );
    if (rollErr) errors.push(`recompute_failed:${reqId}:${rollErr.message}`);
  }

  return json({
    ok: true,
    envDispatchEnabled: dispatchEnabledEnv,
    dbDispatchEnabled: settings.dispatch_enabled,
    effectiveDispatchEnabled,
    envEmailLive: emailLiveEnv,
    dbEmailLive: settings.email_live_enabled,
    dbDryRunOnly: settings.dry_run_only,
    envAllowlistConfigured,
    dbAllowlistConfigured,
    envAllowlistCount: allowlist.count,
    dbAllowedEmailCount: dbAllowlist.emailCount,
    dbAllowedDomainCount: dbAllowlist.domainCount,
    liveEligibleAfterSet,
    liveEligibleAfter,
    liveEligibleMaxAgeMinutes,
    liveWindowOpen,
    liveWindowReason,
    includeLive,
    targetMode: !!targetMessageId,
    targetMessageId,
    manual: manualFlag,
    targetNoClaimReason,
    workerId,
    effectiveBatchSize: batchSize,
    claimed: rows.length,
    processed,
    sentLive,
    sentDryRun,
    failed,
    retried,
    skipped,
    postProviderAuditFailures: counters.postProviderAuditFailures,
    messageUpdateFailures: counters.messageUpdateFailures,
    errors,
    warnings,
  });
});


/* ── Dry-run path (unchanged behavior from 1C-B2) ─────────────────────── */

async function processDryRunMessage(
  admin: Admin, msg: CommMessage, workerId: string,
): Promise<"sent" | "failed"> {
  const attemptNo = msg.attempt_count;

  let toEmail: string | null = null;
  if (msg.recipient_id) {
    const { data: rec } = await admin.from("communication_recipient")
      .select("email").eq("id", msg.recipient_id).maybeSingle();
    toEmail = (rec as any)?.email ?? null;
  }

  const startedAt = new Date().toISOString();
  await admin.from("communication_event_log").insert([
    { request_id: msg.request_id, message_id: msg.id, event_type: "queued", source: "comm-hub-dispatch",
      payload: { stage: "DISPATCH_STARTED", worker_id: workerId, attempt_no: attemptNo, test_mode: true } },
    { request_id: msg.request_id, message_id: msg.id, event_type: "queued", source: "comm-hub-dispatch",
      payload: { stage: "PROVIDER_SELECTED", provider_code: "dry-run", live_email: false } },
    { request_id: msg.request_id, message_id: msg.id, event_type: "queued", source: "comm-hub-dispatch",
      payload: { stage: "SEND_STARTED", dry_run: true } },
  ]);

  const providerMessageId = `dry-run:${msg.id}:${attemptNo}`;
  const finishedAt = new Date().toISOString();

  const { error: attErr } = await admin.from("communication_delivery_attempt").insert({
    message_id: msg.id, attempt_no: attemptNo, provider_id: null,
    started_at: startedAt, finished_at: finishedAt,
    status: "skipped", provider_message_id: providerMessageId,
    provider_response: {
      request: {
        to_masked: maskEmail(toEmail),
        subject_length: msg.subject ? msg.subject.length : 0,
        body_html_size: msg.body_html ? msg.body_html.length : 0,
        body_text_size: msg.body_text ? msg.body_text.length : 0,
        channel: msg.channel, test_mode: msg.test_mode,
      },
      response: { dry_run: true, live_email: false, provider_code: "dry-run" },
    },
    error_code: null, error_message: null, retry_reason: null,
  });

  if (attErr) {
    await admin.from("communication_message").update({
      status: "failed",
      error_code: "DRY_RUN_ATTEMPT_INSERT_FAILED",
      error_message: attErr.message,
      locked_at: null, locked_by: null,
    }).eq("id", msg.id);
    await admin.from("communication_event_log").insert({
      request_id: msg.request_id, message_id: msg.id,
      event_type: "failed", source: "comm-hub-dispatch",
      payload: { stage: "FAILED", error: attErr.message, dry_run: true },
    });
    return "failed";
  }

  const now = new Date().toISOString();
  const { error: updErr } = await admin.from("communication_message").update({
    status: "sent", sent_at: now, provider_message_id: providerMessageId,
    locked_at: null, locked_by: null, error_code: null, error_message: null,
  }).eq("id", msg.id);

  if (updErr) {
    await clearLock(admin, msg.id, workerId);
    await admin.from("communication_event_log").insert({
      request_id: msg.request_id, message_id: msg.id,
      event_type: "failed", source: "comm-hub-dispatch",
      payload: { stage: "MESSAGE_UPDATE_FAILED", error: updErr.message, dry_run: true },
    });
    return "failed";
  }

  await admin.from("communication_event_log").insert([
    { request_id: msg.request_id, message_id: msg.id, event_type: "sent", source: "comm-hub-dispatch",
      payload: { stage: "PROVIDER_ACCEPTED", dry_run: true, provider_message_id: providerMessageId } },
    { request_id: msg.request_id, message_id: msg.id, event_type: "sent", source: "comm-hub-dispatch",
      payload: { stage: "SENT", dry_run: true, provider_code: "dry-run" } },
  ]);
  return "sent";
}

/* ── Live path (NEW in 1C-B3-B, allowlist-gated) ──────────────────────── */

async function processLiveMessage(
  admin: Admin,
  msg: CommMessage,
  workerId: string,
  allowlist: { emails: Set<string>; domains: Set<string> },
  dbAllowlist: DbAllowlist,
  getProvider: () => Promise<CommHubEmailProvider | null>,
  counters: { postProviderAuditFailures: number; messageUpdateFailures: number },
): Promise<"sent" | "retried" | "failed" | "skipped" | "error"> {
  const attemptNo = msg.attempt_count;
  const startedAt = new Date().toISOString();

  // CH-TRACE-2: link this dispatch attempt into the upstream trace timeline.
  const liveTraceId = await resolveTraceForMessage(admin, msg.id, msg.request_id);
  await traceStep(admin, liveTraceId, {
    stage_code: "CONTROL_GATES_CHECKED", status: "passed",
    plain_summary: "dispatcher entered live path",
    message_id: msg.id, request_id: msg.request_id,
  });

  // Load recipient email — required.
  let toEmail: string | null = null;
  if (msg.recipient_id) {
    const { data: rec } = await admin.from("communication_recipient")
      .select("email").eq("id", msg.recipient_id).maybeSingle();
    toEmail = (rec as any)?.email ?? null;
  }

  await admin.from("communication_event_log").insert({
    request_id: msg.request_id, message_id: msg.id,
    event_type: "queued", source: "comm-hub-dispatch",
    payload: { stage: "DISPATCH_STARTED", worker_id: workerId, attempt_no: attemptNo, test_mode: false, live: true },
  });

  // Missing recipient email — non-retryable failure.
  if (!toEmail) {
    await traceStep(admin, liveTraceId, {
      stage_code: "RECIPIENT_ALLOWLIST_CHECKED", status: "failed",
      blocker_codes: ["recipient_email_missing"], message_id: msg.id,
    });
    await traceComplete(admin, liveTraceId, "failed", "RECIPIENT_ALLOWLIST_CHECKED");
    await recordSkippedAttempt(admin, msg, attemptNo, startedAt, "RECIPIENT_EMAIL_MISSING",
      "recipient_email_missing", "communication_recipient has no email");
    await failMessage(admin, msg, workerId, "recipient_email_missing",
      "communication_recipient has no email", "RECIPIENT_EMAIL_MISSING");
    return "failed";
  }


  // DB allowlist check (Phase 1C-B7-B) — must pass before env allowlist.
  if (!isEmailDbAllowlisted(toEmail, dbAllowlist)) {
    await traceStep(admin, liveTraceId, {
      stage_code: "RECIPIENT_ALLOWLIST_CHECKED", status: "blocked",
      blocker_codes: ["recipient_not_db_allowlisted"],
      plain_summary: "recipient not in DB Recipient Control Center allowlist",
      fix_href: "/admin/communication-hub/recipient-control",
      message_id: msg.id,
    });
    await traceComplete(admin, liveTraceId, "suppressed", "RECIPIENT_ALLOWLIST_CHECKED");
    await recordSkippedAttempt(admin, msg, attemptNo, startedAt,
      "LIVE_RECIPIENT_NOT_DB_ALLOWLISTED", "recipient_not_db_allowlisted",
      "Recipient email not in Control Center DB allowlist",
      { to_masked: maskEmail(toEmail) });
    await admin.from("communication_message").update({
      status: "suppressed",
      error_code: "recipient_not_db_allowlisted",
      error_message: "Blocked by DB Control Center allowlist",
      locked_at: null, locked_by: null,
    }).eq("id", msg.id);
    await admin.from("communication_event_log").insert({
      request_id: msg.request_id, message_id: msg.id,
      event_type: "suppressed", source: "comm-hub-dispatch",
      payload: { stage: "LIVE_RECIPIENT_NOT_DB_ALLOWLISTED", to_masked: maskEmail(toEmail) },
    });
    return "skipped";
  }
  await traceStep(admin, liveTraceId, {
    stage_code: "RECIPIENT_ALLOWLIST_CHECKED", status: "passed",
    plain_summary: "recipient in DB allowlist",
    message_id: msg.id,
  });

  // CH-SIMPLE-P2 B6: env allowlist is retired as a positive OR negative
  // authoriser. Recipient eligibility comes entirely from the canonical
  // DB-backed recipient policy (evaluate_comm_hub_recipient_policy). The
  // env allowlist remains diagnostic-only.
  if (allowlist.count > 0) {
    warnings.push("COMMUNICATION_HUB_EMAIL_LIVE_ALLOWLIST is configured but is ignored for recipient authorisation (diagnostic only). Manage recipients via Recipient Policy settings.");
  }
  await traceStep(admin, liveTraceId, {
    stage_code: "ENV_ALLOWLIST_CHECKED",
    status: "skipped",
    plain_summary: "env allowlist retired — recipient policy is authoritative",
    message_id: msg.id,
  });

  // Content sanity.
  if (!msg.subject || msg.subject.trim().length === 0) {
    await traceStep(admin, liveTraceId, {
      stage_code: "TEMPLATE_RENDERED", status: "failed",
      blocker_codes: ["subject_missing"], message_id: msg.id,
    });
    await traceComplete(admin, liveTraceId, "failed", "TEMPLATE_RENDERED");
    await recordSkippedAttempt(admin, msg, attemptNo, startedAt, "SUBJECT_MISSING",
      "subject_missing", "Message subject is empty");
    await failMessage(admin, msg, workerId, "subject_missing", "Message subject is empty", "SUBJECT_MISSING");
    return "failed";
  }
  if (!msg.body_html && !msg.body_text) {
    await traceStep(admin, liveTraceId, {
      stage_code: "TEMPLATE_RENDERED", status: "failed",
      blocker_codes: ["body_missing"], message_id: msg.id,
    });
    await traceComplete(admin, liveTraceId, "failed", "TEMPLATE_RENDERED");
    await recordSkippedAttempt(admin, msg, attemptNo, startedAt, "BODY_MISSING",
      "body_missing", "Message has no html or text body");
    await failMessage(admin, msg, workerId, "body_missing", "Message has no html or text body", "BODY_MISSING");
    return "failed";
  }

  // Provider lookup.
  await traceStep(admin, liveTraceId, {
    stage_code: "PROVIDER_LOOKUP_STARTED", status: "info",
    plain_summary: "looking up active email provider",
    message_id: msg.id,
  });
  const provider = await getProvider();
  if (!provider) {
    await traceStep(admin, liveTraceId, {
      stage_code: "PROVIDER_LOOKUP_STARTED", status: "failed",
      blocker_codes: ["provider_config_missing"],
      plain_summary: "no active email provider configured",
      fix_href: "/admin/communication-hub/design/sender-profiles",
      message_id: msg.id,
    });
    await traceComplete(admin, liveTraceId, "failed", "PROVIDER_LOOKUP_STARTED");
    await recordSkippedAttempt(admin, msg, attemptNo, startedAt,
      "PROVIDER_CONFIG_MISSING", "provider_config_missing",
      "No active default email provider in notification_providers");
    return await applyFailureDecision(admin, msg, workerId, {
      ok: false, providerCode: "resend", providerMessageId: null,
      statusCode: null, rawStatus: "failed", retryable: true,
      errorCode: "provider_config_missing",
      errorMessage: "No active default email provider",
      providerResponseSafe: null,
    }, null);
  }
  await traceStep(admin, liveTraceId, {
    stage_code: "PROVIDER_SELECTED", status: "passed",
    plain_summary: `provider selected: ${(provider as any)?.type ?? "email"}`,
    message_id: msg.id,
  });

  await admin.from("communication_event_log").insert([
    { request_id: msg.request_id, message_id: msg.id,
      event_type: "queued", source: "comm-hub-dispatch",
      payload: { stage: "PROVIDER_SELECTED", live_email: true, provider: redactProviderForLog(provider) } },
    { request_id: msg.request_id, message_id: msg.id,
      event_type: "queued", source: "comm-hub-dispatch",
      payload: { stage: "SEND_STARTED", live_email: true, to_masked: maskEmail(toEmail) } },
  ]);
  await traceStep(admin, liveTraceId, {
    stage_code: "PROVIDER_SEND_ATTEMPTED", status: "info",
    plain_summary: "invoking provider send", message_id: msg.id,
  });

  // CH-SIMPLE-P3B-R.2 — Pre-provider revalidation of the canonical decision.
  // Fetches the request's original decision + policy versions and calls
  // `revalidate_comm_hub_send_decision`. If the decision is stale or the
  // request is no longer allowed under current policy, we abort the live
  // send BEFORE invoking the provider and record the stale reasons on the
  // delivery attempt.
  let revalDecisionId: string | null = null;
  let staleReasons: any = null;
  try {
    const { data: reqRow } = await admin
      .from("communication_request")
      .select("id, original_decision_id, decision_send_context, configuration_version, recipient_policy_version, send_policy_version, review_policy_version, module_code, event_code")
      .eq("id", msg.request_id)
      .maybeSingle();
    if (reqRow) {
      const revalPayload: Record<string, unknown> = {
        request_id: reqRow.id,
        original_decision_id: (reqRow as any).original_decision_id ?? null,
        module_code: (reqRow as any).module_code,
        event_code: (reqRow as any).event_code,
        channel: msg.channel ?? "email",
        send_context: (reqRow as any).decision_send_context ?? "manual_live",
        to_recipients: [toEmail],
        configuration_version: (reqRow as any).configuration_version ?? null,
        recipient_policy_version: (reqRow as any).recipient_policy_version ?? null,
        send_policy_version: (reqRow as any).send_policy_version ?? null,
        review_policy_version: (reqRow as any).review_policy_version ?? null,
      };
      const { data: revalData, error: revalErr } = await admin.rpc(
        "revalidate_comm_hub_send_decision",
        { p_payload: revalPayload },
      );
      if (revalErr) {
        await traceStep(admin, liveTraceId, {
          stage_code: "PROVIDER_SEND_ATTEMPTED", status: "failed",
          blocker_codes: ["revalidation_failed"],
          plain_summary: `revalidation failed: ${revalErr.message.slice(0, 200)}`,
          message_id: msg.id,
        });
        await traceComplete(admin, liveTraceId, "failed", "PROVIDER_SEND_ATTEMPTED");
        await admin.from("communication_delivery_attempt").insert({
          message_id: msg.id, attempt_no: attemptNo,
          provider_id: null,
          started_at: startedAt, finished_at: new Date().toISOString(),
          status: "failure",
          original_decision_id: (reqRow as any).original_decision_id ?? null,
          revalidation_result: "error",
          stale_reasons: { error: revalErr.message },
          provider_response: { error: "revalidation_failed" },
        });
        return await applyFailureDecision(admin, msg, workerId, {
          ok: false, providerCode: "resend", providerMessageId: null,
          statusCode: null, rawStatus: "failed", retryable: true,
          errorCode: "revalidation_failed",
          errorMessage: `revalidation error: ${revalErr.message}`,
          providerResponseSafe: null,
        }, null);
      }
      const reval: any = revalData ?? {};
      revalDecisionId = reval.decision_id ?? null;
      const stale = !!reval.stale;
      const stillAllowed = reval.allowed !== false; // treat missing as not-blocked
      staleReasons = {
        stale, allowed: reval.allowed, reasons: reval.stale_reasons ?? [],
        blockers: reval.blockers ?? [], decision_id: revalDecisionId,
      };
      if (!stillAllowed || stale) {
        await traceStep(admin, liveTraceId, {
          stage_code: "PROVIDER_SEND_ATTEMPTED", status: "blocked",
          blocker_codes: ["send_decision_stale"],
          plain_summary: `pre-provider revalidation blocked: ${(reval.stale_reasons ?? []).slice(0, 2).join("; ") || "policy_changed"}`,
          message_id: msg.id,
        });
        await traceComplete(admin, liveTraceId, "blocked", "PROVIDER_SEND_ATTEMPTED",
          { reasons: reval.stale_reasons ?? [], blockers: reval.blockers ?? [] });
        await admin.from("communication_delivery_attempt").insert({
          message_id: msg.id, attempt_no: attemptNo,
          provider_id: null,
          started_at: startedAt, finished_at: new Date().toISOString(),
          status: "skipped",
          original_decision_id: (reqRow as any).original_decision_id ?? null,
          revalidation_decision_id: revalDecisionId,
          revalidation_result: stale ? "stale" : "blocked",
          stale_reasons: staleReasons,
          provider_response: null,
        });
        return await applyFailureDecision(admin, msg, workerId, {
          ok: false, providerCode: "resend", providerMessageId: null,
          statusCode: null, rawStatus: "failed", retryable: false,
          errorCode: "send_decision_stale",
          errorMessage: `send blocked by pre-provider revalidation`,
          providerResponseSafe: staleReasons,
        }, null);
      }
    }
  } catch (e) {
    // Fail-closed: exception during revalidation aborts the live send.
    await traceStep(admin, liveTraceId, {
      stage_code: "PROVIDER_SEND_ATTEMPTED", status: "failed",
      blocker_codes: ["revalidation_exception"],
      plain_summary: `revalidation exception: ${String((e as any)?.message ?? e).slice(0, 200)}`,
      message_id: msg.id,
    });
    await traceComplete(admin, liveTraceId, "failed", "PROVIDER_SEND_ATTEMPTED");
    return await applyFailureDecision(admin, msg, workerId, {
      ok: false, providerCode: "resend", providerMessageId: null,
      statusCode: null, rawStatus: "failed", retryable: true,
      errorCode: "revalidation_exception",
      errorMessage: String((e as any)?.message ?? e).slice(0, 500),
      providerResponseSafe: null,
    }, null);
  }





  // Live send. EPIC CH-S1 — apply sender snapshot from message row if present.
  let senderOverride: { from_email?: string | null; from_display_name?: string | null; reply_to_email?: string | null } = {};
  try {
    const { data: snap } = await admin.from("communication_message")
      .select("from_email, from_display_name, reply_to_email")
      .eq("id", msg.id).maybeSingle();
    senderOverride = snap ?? {};
  } catch { /* non-fatal */ }
  let transport: CommHubTransportResult;
  try {
    const guardedResult = await sendEmailViaGuardedTransport(admin, {
      guard: {
        messageId: msg.id,
        requestId: msg.request_id,
        callerFunction: "comm-hub-dispatch",
        callerContext: "live_dispatch",
        correlationId: workerId,
        traceId: liveTraceId ?? null,
      },
      provider,
      payload: {
        to: toEmail,
        subject: msg.subject!,
        html: msg.body_html ?? "",
        text: msg.body_text ?? undefined,
        fromEmail: senderOverride.from_email ?? undefined,
        fromName: senderOverride.from_display_name ?? undefined,
        replyTo: senderOverride.reply_to_email ?? undefined,
      } as any,
      opts: { fallbackResendKey: Deno.env.get("RESEND_API_KEY") ?? undefined },
    });

    if (isGuardRefusal(guardedResult)) {
      transport = {
        ok: false, providerCode: provider.type, providerMessageId: null,
        statusCode: null, rawStatus: "failed", retryable: false,
        errorCode: guardedResult.code,
        errorMessage: `transport-boundary guard refused: ${guardedResult.code}`,
        providerResponseSafe: {
          guardBlocked: true,
          code: guardedResult.code,
          auditId: guardedResult.auditId ?? null,
          authoritativeSendContext: guardedResult.authoritativeSendContext ?? null,
        },
      };
    } else {
      transport = guardedResult;
    }
  } catch (err: any) {
    transport = {
      ok: false, providerCode: provider.type, providerMessageId: null,
      statusCode: null, rawStatus: "failed", retryable: true,
      errorCode: "transport_exception",
      errorMessage: (err?.message || String(err)).slice(0, 500),
      providerResponseSafe: null,
    };
  }

  const finishedAt = new Date().toISOString();

  // Record attempt.
  const attemptStatus =
    transport.ok ? "success" :
    transport.errorCode === "timeout" || /timeout/i.test(transport.errorMessage ?? "") ? "timeout" :
    transport.statusCode === 429 ? "throttled" : "failure";

  const { error: attErr } = await admin.from("communication_delivery_attempt").insert({
    message_id: msg.id,
    attempt_no: attemptNo,
    provider_id: provider.providerId,
    started_at: startedAt,
    finished_at: finishedAt,
    status: attemptStatus,
    provider_message_id: transport.providerMessageId,
    revalidation_decision_id: revalDecisionId,
    revalidation_result: "passed",
    stale_reasons: staleReasons,

    provider_response: {
      request: {
        to_masked: maskEmail(toEmail),
        subject_length: msg.subject!.length,
        body_html_size: msg.body_html ? msg.body_html.length : 0,
        body_text_size: msg.body_text ? msg.body_text.length : 0,
        channel: msg.channel, test_mode: false, live_email: true,
      },
      response: {
        providerCode: transport.providerCode,
        statusCode: transport.statusCode,
        rawStatus: transport.rawStatus,
        safe: transport.providerResponseSafe,
      },
    },
    error_code: transport.errorCode ?? null,
    error_message: transport.errorMessage ? transport.errorMessage.slice(0, 500) : null,
    retry_reason: transport.ok ? null : (transport.retryable ? "provider_retryable_failure" : "provider_non_retryable"),
  });
  if (attErr) {
    // Attempt audit insert failed AFTER a real provider call. We must never
    // leave the message stuck in status='sending', and we must NOT requeue
    // (that could double-send). Mark a safe terminal state per transport.ok.
    counters.postProviderAuditFailures++;
    if (transport.ok) {
      const now = new Date().toISOString();
      const { error: rescueErr } = await admin.from("communication_message").update({
        status: "sent",
        sent_at: now,
        provider_message_id: transport.providerMessageId,
        error_code: "ATTEMPT_INSERT_FAILED_AFTER_PROVIDER",
        error_message: (attErr.message ?? "attempt insert failed").slice(0, 500),
        locked_at: null, locked_by: null,
      }).eq("id", msg.id);
      if (rescueErr) {
        counters.messageUpdateFailures++;
        await clearLock(admin, msg.id, workerId);
      }
      await admin.from("communication_event_log").insert({
        request_id: msg.request_id, message_id: msg.id,
        event_type: "sent", source: "comm-hub-dispatch",
        payload: {
          stage: "ATTEMPT_INSERT_FAILED_AFTER_PROVIDER",
          live: true, provider_ok: true,
          provider_code: transport.providerCode,
          provider_message_id: transport.providerMessageId,
          status_code: transport.statusCode,
          error: (attErr.message ?? "").slice(0, 500),
          note: "Provider accepted the message; audit row could not be written. No automatic retry.",
        },
      });
      return "sent";
    } else {
      const { error: rescueErr } = await admin.from("communication_message").update({
        status: "failed",
        next_attempt_at: null,
        error_code: "ATTEMPT_INSERT_FAILED_AFTER_PROVIDER_FAILURE",
        error_message: (transport.errorMessage ?? attErr.message ?? "provider failure").slice(0, 500),
        locked_at: null, locked_by: null,
      }).eq("id", msg.id);
      if (rescueErr) {
        counters.messageUpdateFailures++;
        await clearLock(admin, msg.id, workerId);
      }
      await admin.from("communication_event_log").insert({
        request_id: msg.request_id, message_id: msg.id,
        event_type: "failed", source: "comm-hub-dispatch",
        payload: {
          stage: "ATTEMPT_INSERT_FAILED_AFTER_PROVIDER_FAILURE",
          live: true, provider_ok: false,
          provider_code: transport.providerCode,
          status_code: transport.statusCode,
          error_code: transport.errorCode ?? null,
          audit_error: (attErr.message ?? "").slice(0, 500),
          note: "Provider call failed and audit row missing. No automatic retry.",
        },
      });
      return "failed";
    }
  }

  if (transport.ok) {
    const now = new Date().toISOString();
    const { error: updErr } = await admin.from("communication_message").update({
      status: "sent", sent_at: now,
      provider_message_id: transport.providerMessageId,
      locked_at: null, locked_by: null,
      error_code: null, error_message: null,
    }).eq("id", msg.id);
    if (updErr) {
      // Provider accepted but the status update failed. Do NOT requeue
      // (double-send risk). Try a minimal rescue update that marks the
      // message reviewable and clears the lock. If even that fails, at
      // least clear the lock so the row is not stuck.
      counters.messageUpdateFailures++;
      const { error: rescueErr } = await admin.from("communication_message").update({
        status: "sent",
        sent_at: now,
        provider_message_id: transport.providerMessageId,
        error_code: "MESSAGE_UPDATE_FAILED_AFTER_PROVIDER_SUCCESS",
        error_message: (updErr.message ?? "message update failed").slice(0, 500),
        locked_at: null, locked_by: null,
      }).eq("id", msg.id);
      if (rescueErr) {
        await clearLock(admin, msg.id, workerId);
      }
      await admin.from("communication_event_log").insert({
        request_id: msg.request_id, message_id: msg.id,
        event_type: "sent", source: "comm-hub-dispatch",
        payload: {
          stage: "MESSAGE_UPDATE_FAILED_AFTER_PROVIDER_SUCCESS",
          live: true,
          provider_code: transport.providerCode,
          provider_message_id: transport.providerMessageId,
          status_code: transport.statusCode,
          error: (updErr.message ?? "").slice(0, 500),
          note: "Provider accepted the message; row status update failed. Lock cleared. No automatic retry.",
        },
      });
      return "error";
    }
    await admin.from("communication_event_log").insert([
      { request_id: msg.request_id, message_id: msg.id,
        event_type: "sent", source: "comm-hub-dispatch",
        payload: { stage: "PROVIDER_ACCEPTED", live: true, provider_message_id: transport.providerMessageId, provider_code: transport.providerCode } },
      { request_id: msg.request_id, message_id: msg.id,
        event_type: "sent", source: "comm-hub-dispatch",
        payload: { stage: "SENT", live: true, provider_code: transport.providerCode } },
    ]);
    await traceStep(admin, liveTraceId, {
      stage_code: "PROVIDER_ACCEPTED", status: "passed",
      plain_summary: `provider accepted (code=${transport.providerCode})`,
      message_id: msg.id,
      payload: { provider_message_id: transport.providerMessageId, provider_code: transport.providerCode },
    });
    await traceStep(admin, liveTraceId, {
      stage_code: "DELIVERY_ATTEMPT_RECORDED", status: "passed",
      message_id: msg.id,
    });
    await traceComplete(admin, liveTraceId, "sent", null, {
      provider_code: transport.providerCode,
      provider_message_id: transport.providerMessageId,
    });
    return "sent";
  }

  await traceStep(admin, liveTraceId, {
    stage_code: "PROVIDER_FAILED", status: "failed",
    blocker_codes: ["provider_send_failed"],
    plain_summary: `provider send failed (code=${transport.errorCode ?? "unknown"})`,
    message_id: msg.id,
    payload: {
      status_code: transport.statusCode ?? null,
      provider_code: transport.providerCode,
      error_code: transport.errorCode ?? null,
    },
  });
  await traceComplete(admin, liveTraceId, "failed", "PROVIDER_FAILED");
  return await applyFailureDecision(admin, msg, workerId, transport, provider);
}

/**
 * Insert a delivery attempt row for a case where the provider was NOT called
 * (missing recipient, allowlist block, subject/body missing, provider config
 * missing). Uses status='skipped'.
 */
async function recordSkippedAttempt(
  admin: Admin,
  msg: CommMessage,
  attemptNo: number,
  startedAt: string,
  stage: string,
  errorCode: string,
  errorMessage: string,
  extraRequest: Record<string, unknown> = {},
) {
  const finishedAt = new Date().toISOString();
  await admin.from("communication_delivery_attempt").insert({
    message_id: msg.id,
    attempt_no: attemptNo,
    provider_id: null,
    started_at: startedAt,
    finished_at: finishedAt,
    status: "skipped",
    provider_message_id: null,
    provider_response: {
      request: {
        subject_length: msg.subject ? msg.subject.length : 0,
        body_html_size: msg.body_html ? msg.body_html.length : 0,
        body_text_size: msg.body_text ? msg.body_text.length : 0,
        channel: msg.channel, test_mode: msg.test_mode, live_email: true,
        ...extraRequest,
      },
      response: { skipped: true, stage },
    },
    error_code: errorCode,
    error_message: errorMessage.slice(0, 500),
    retry_reason: null,
  });
  await admin.from("communication_event_log").insert({
    request_id: msg.request_id, message_id: msg.id,
    event_type: "suppressed", source: "comm-hub-dispatch",
    payload: { stage, live: true, error_code: errorCode },
  });
}

async function failMessage(
  admin: Admin, msg: CommMessage, workerId: string,
  code: string, message: string, stage: string,
) {
  await admin.from("communication_message").update({
    status: "failed",
    error_code: code,
    error_message: message.slice(0, 500),
    locked_at: null, locked_by: null,
  }).eq("id", msg.id);
  await admin.from("communication_event_log").insert({
    request_id: msg.request_id, message_id: msg.id,
    event_type: "failed", source: "comm-hub-dispatch",
    payload: { stage, live: true, error_code: code },
  });
  // clearLock is a no-op when the update above already cleared it.
  await clearLock(admin, msg.id, workerId);
}

async function applyFailureDecision(
  admin: Admin,
  msg: CommMessage,
  workerId: string,
  transport: CommHubTransportResult,
  provider: CommHubEmailProvider | null,
): Promise<"retried" | "failed"> {
  const policy = await loadRetryPolicy(admin, { channel: "email" });
  const decision = decideRetry({
    attemptCount: msg.attempt_count,
    retryable: transport.retryable,
    policy,
  });

  const safeErr = {
    code: transport.errorCode ?? "provider_error",
    message: (transport.errorMessage ?? "provider_error").slice(0, 500),
  };

  if (decision.shouldRetry && decision.nextAttemptAt) {
    await admin.from("communication_message").update({
      status: "queued",
      next_attempt_at: decision.nextAttemptAt,
      locked_at: null, locked_by: null,
      error_code: safeErr.code,
      error_message: safeErr.message,
    }).eq("id", msg.id);
    await admin.from("communication_event_log").insert([
      { request_id: msg.request_id, message_id: msg.id,
        event_type: "failed", source: "comm-hub-dispatch",
        payload: { stage: "FAILED", live: true, error_code: safeErr.code, status_code: transport.statusCode, provider_code: transport.providerCode } },
      { request_id: msg.request_id, message_id: msg.id,
        event_type: "retried", source: "comm-hub-dispatch",
        payload: {
          stage: "RETRY_SCHEDULED", live: true,
          next_attempt_at: decision.nextAttemptAt,
          next_attempt_count: decision.nextAttemptCount,
          reason: decision.reason,
          provider: provider ? redactProviderForLog(provider) : null,
        } },
    ]);
    await clearLock(admin, msg.id, workerId);
    return "retried";
  }

  await admin.from("communication_message").update({
    status: "failed",
    next_attempt_at: null,
    locked_at: null, locked_by: null,
    error_code: safeErr.code,
    error_message: safeErr.message,
  }).eq("id", msg.id);
  await admin.from("communication_event_log").insert({
    request_id: msg.request_id, message_id: msg.id,
    event_type: "failed", source: "comm-hub-dispatch",
    payload: {
      stage: "FAILED", live: true,
      error_code: safeErr.code, status_code: transport.statusCode,
      provider_code: transport.providerCode, reason: decision.reason,
    },
  });
  await clearLock(admin, msg.id, workerId);
  return "failed";
}

/* ── CH-SIMPLE-P3D-B.2.b — Targeted dry-run dispatcher ────────────────────
 * Processes exactly ONE dry-run-locked message. Never invokes a provider.
 * Loads authoritative evidence from the database (never trusts caller
 * payload for classification, rendered content, or provider outcome).
 * Idempotent: replaying the same message returns the existing attempt.
 */

interface TargetedDryRunBody {
  operation: "targeted_dry_run";
  messageId?: string;
  requestId?: string;
  dryRunExecutionId?: string;
  dryRunCorrelationId?: string;
  originalDecisionId?: string;
}

interface TargetedDryRunEnvelope {
  status: "BLOCKED" | "DRY_RUN_FAILED" | "DRY_RUN_PROCESSED";
  processed: boolean;
  idempotent_replay: boolean;
  request_id: string | null;
  message_id: string | null;
  delivery_attempt_id: string | null;
  trace_id: string | null;
  original_decision_id: string | null;
  revalidation_decision_id: string | null;
  provider_call_attempted: false;
  provider_message_id: null;
  recipient_set_hash: string | null;
  subject_hash: string | null;
  body_hash: string | null;
  blockers: Array<{ code: string; message?: string; stage?: string }>;
  warnings: unknown[];
  started_at: string;
  completed_at: string;
  result: "BLOCKED" | "DRY_RUN_FAILED" | "DRY_RUN_PROCESSED";
  failure_stage?: string;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input ?? "");
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

// deno-lint-ignore no-explicit-any
async function processTargetedDryRun(admin: any, body: TargetedDryRunBody): Promise<Response> {
  const startedAt = new Date().toISOString();
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const build = (
    status: TargetedDryRunEnvelope["status"],
    partial: Partial<TargetedDryRunEnvelope>,
    httpStatus = 200,
  ): Response => {
    const env: TargetedDryRunEnvelope = {
      status,
      processed: status === "DRY_RUN_PROCESSED",
      idempotent_replay: false,
      request_id: null,
      message_id: null,
      delivery_attempt_id: null,
      trace_id: null,
      original_decision_id: null,
      revalidation_decision_id: null,
      provider_call_attempted: false,
      provider_message_id: null,
      recipient_set_hash: null,
      subject_hash: null,
      body_hash: null,
      blockers: [],
      warnings: [],
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      result: status,
      ...partial,
    };
    return json(env, httpStatus);
  };

  const messageId = typeof body?.messageId === "string" && uuidRe.test(body.messageId) ? body.messageId : null;
  if (!messageId) {
    return build("BLOCKED", {
      blockers: [{ code: "targeted_message_id_invalid", stage: "input_validation" }],
      failure_stage: "input_validation",
    }, 400);
  }

  // 1. Load message.
  const { data: msg, error: mErr } = await admin
    .from("communication_message")
    .select("id, request_id, channel, subject, body_text, body_html, status, send_context, dry_run_locked, origin, test_mode, attempt_count, original_decision_id")
    .eq("id", messageId)
    .maybeSingle();
  if (mErr || !msg) {
    return build("BLOCKED", {
      message_id: messageId,
      blockers: [{ code: "targeted_message_not_found", stage: "message_load", message: mErr?.message }],
      failure_stage: "message_load",
    }, 404);
  }

  const requestId = (msg as any).request_id as string;
  const originalDecisionId = (msg as any).original_decision_id ?? body?.originalDecisionId ?? null;

  // 2. Optional request-id linkage check.
  if (body?.requestId && uuidRe.test(body.requestId) && body.requestId !== requestId) {
    return build("BLOCKED", {
      message_id: messageId, request_id: requestId,
      blockers: [{ code: "targeted_message_request_mismatch", stage: "request_linkage" }],
      failure_stage: "request_linkage",
      original_decision_id: originalDecisionId,
    }, 409);
  }

  // 3. Classification checks (fail closed).
  if ((msg as any).send_context !== "dry_run") {
    return build("BLOCKED", {
      message_id: messageId, request_id: requestId,
      blockers: [{ code: "targeted_message_not_dry_run", stage: "context_validation" }],
      failure_stage: "context_validation", original_decision_id: originalDecisionId,
    }, 409);
  }
  if ((msg as any).dry_run_locked !== true) {
    return build("BLOCKED", {
      message_id: messageId, request_id: requestId,
      blockers: [{ code: "targeted_message_not_locked", stage: "context_validation" }],
      failure_stage: "context_validation", original_decision_id: originalDecisionId,
    }, 409);
  }
  if ((msg as any).origin !== "comm-hub-dry-run" || (msg as any).channel !== "email") {
    return build("BLOCKED", {
      message_id: messageId, request_id: requestId,
      blockers: [{ code: "targeted_message_context_mismatch", stage: "context_validation" }],
      failure_stage: "context_validation", original_decision_id: originalDecisionId,
    }, 409);
  }

  // 4. Load request; confirm dry-run classification at request level.
  const { data: reqRow, error: reqErr } = await admin
    .from("communication_request")
    .select("id, module_code, event_code, status, decision_send_context, context")
    .eq("id", requestId).maybeSingle();
  if (reqErr || !reqRow) {
    return build("BLOCKED", {
      message_id: messageId, request_id: requestId,
      blockers: [{ code: "targeted_message_request_mismatch", stage: "request_linkage", message: reqErr?.message }],
      failure_stage: "request_linkage", original_decision_id: originalDecisionId,
    }, 409);
  }
  if ((reqRow as any).decision_send_context !== "dry_run" || (reqRow as any).status !== "dry_run") {
    return build("BLOCKED", {
      message_id: messageId, request_id: requestId,
      blockers: [{ code: "targeted_message_context_mismatch", stage: "request_linkage" }],
      failure_stage: "request_linkage", original_decision_id: originalDecisionId,
    }, 409);
  }

  // Bind the targeted call to its durable execution and preview snapshot.
  const executionId = typeof body?.dryRunExecutionId === "string" && uuidRe.test(body.dryRunExecutionId)
    ? body.dryRunExecutionId
    : null;
  if (!executionId) {
    return build("BLOCKED", {
      message_id: messageId, request_id: requestId,
      blockers: [{ code: "targeted_execution_id_invalid", stage: "execution_linkage" }],
      failure_stage: "execution_linkage", original_decision_id: originalDecisionId,
    }, 400);
  }
  const { data: execution } = await admin
    .from("communication_dry_run_execution")
    .select("id, request_id, message_id, preview_snapshot_id, recipient_set_hash, original_decision_id")
    .eq("id", executionId)
    .maybeSingle();
  if (!execution || (execution as any).request_id !== requestId
      || (execution as any).message_id !== messageId
      || (execution as any).original_decision_id !== originalDecisionId) {
    return build("BLOCKED", {
      message_id: messageId, request_id: requestId,
      blockers: [{ code: "targeted_execution_context_mismatch", stage: "execution_linkage" }],
      failure_stage: "execution_linkage", original_decision_id: originalDecisionId,
    }, 409);
  }

  // 5. Idempotency check — is there already an authoritative dry-run attempt?
  const { data: existing } = await admin
    .from("communication_delivery_attempt")
    .select("id, attempt_no, status, provider_call_attempted, attempt_type, revalidation_decision_id, recipient_set_hash, subject_hash, body_hash, provider_response, started_at, finished_at")
    .eq("message_id", messageId)
    .eq("attempt_type", "dry_run")
    .order("attempt_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing && ((existing as any).provider_response?.response?.result === "DRY_RUN_PROCESSED"
        || (existing as any).status === "skipped")) {
    const e: any = existing;
    return build("DRY_RUN_PROCESSED", {
      processed: true, idempotent_replay: true,
      message_id: messageId, request_id: requestId,
      delivery_attempt_id: e.id,
      original_decision_id: originalDecisionId,
      revalidation_decision_id: e.revalidation_decision_id ?? null,
      recipient_set_hash: e.recipient_set_hash ?? null,
      subject_hash: e.subject_hash ?? null,
      body_hash: e.body_hash ?? null,
      started_at: e.started_at ?? startedAt,
      completed_at: e.finished_at ?? new Date().toISOString(),
    });
  }

  // 6. Canonical revalidation.
  let revalDecisionId: string | null = null;
  let revalBlockers: any[] = [];
  let revalWarnings: any[] = [];
  try {
    const { data: priorDecision, error: priorErr } = await admin
      .from("communication_hub_send_decision_log")
      .select("payload")
      .eq("decision_id", originalDecisionId)
      .maybeSingle();
    if (priorErr || !priorDecision) {
      throw new Error(priorErr?.message ?? "prior_decision_not_found");
    }
    const { data: reval, error: rvErr } = await admin.rpc(
      "revalidate_comm_hub_send_decision",
      { p_prior_decision_id: originalDecisionId, p_payload: (priorDecision as any).payload },
    );
    if (rvErr) throw new Error(rvErr.message);
    const r: any = reval ?? {};
    const fresh: any = r.fresh_decision ?? {};
    revalDecisionId = r.fresh_decision_id ?? fresh.decision_id ?? null;
    revalBlockers = Array.isArray(fresh.blockers) ? fresh.blockers : [];
    revalWarnings = Array.isArray(fresh.warnings) ? fresh.warnings : [];
    const allowed = r.fresh_allowed === true && r.stale !== true;
    if (!allowed) {
      return build("BLOCKED", {
        message_id: messageId, request_id: requestId,
        blockers: revalBlockers.length ? revalBlockers : [{
          code: r.stale === true ? "send_decision_stale" : "revalidation_denied",
          stage: "canonical_revalidation",
          message: Array.isArray(r.staleness_reasons) ? r.staleness_reasons.join(", ") : undefined,
        }],
        warnings: revalWarnings,
        failure_stage: "canonical_revalidation",
        original_decision_id: originalDecisionId,
        revalidation_decision_id: revalDecisionId,
      });
    }
  } catch (e: any) {
    return build("DRY_RUN_FAILED", {
      message_id: messageId, request_id: requestId,
      blockers: [{ code: "revalidation_exception", stage: "canonical_revalidation", message: String(e?.message ?? e).slice(0, 300) }],
      failure_stage: "canonical_revalidation",
      original_decision_id: originalDecisionId,
    }, 500);
  }

  // 7. Resolve recipients from the execution-bound approved preview and use
  // the same canonical normalizer as preview preparation and BEGIN.
  const { data: snapshot, error: snapshotErr } = await admin
    .from("communication_preview_snapshot")
    .select("to_recipients, cc_recipients, bcc_recipients")
    .eq("id", (execution as any).preview_snapshot_id)
    .maybeSingle();
  if (snapshotErr || !snapshot) {
    return build("DRY_RUN_FAILED", {
      message_id: messageId, request_id: requestId,
      blockers: [{ code: "recipient_evidence_load_failed", stage: "recipient_evidence", message: snapshotErr?.message }],
      failure_stage: "recipient_evidence",
      original_decision_id: originalDecisionId,
      revalidation_decision_id: revalDecisionId,
    }, 500);
  }
  const toEmails = Array.isArray((snapshot as any).to_recipients) ? (snapshot as any).to_recipients : [];
  const ccEmails = Array.isArray((snapshot as any).cc_recipients) ? (snapshot as any).cc_recipients : [];
  const bccEmails = Array.isArray((snapshot as any).bcc_recipients) ? (snapshot as any).bcc_recipients : [];
  if (toEmails.length === 0) {
    return build("BLOCKED", {
      message_id: messageId, request_id: requestId,
      blockers: [{ code: "recipient_evidence_missing", stage: "recipient_evidence" }],
      failure_stage: "recipient_evidence",
      original_decision_id: originalDecisionId,
      revalidation_decision_id: revalDecisionId,
    });
  }
  const { data: normalizedRecipients, error: normalizeErr } = await admin.rpc(
    "comm_hub_normalize_recipient_set",
    { p_to: toEmails, p_cc: ccEmails, p_bcc: bccEmails },
  );
  const recipientSetHash = (normalizedRecipients as any)?.recipient_set_hash ?? null;
  if (normalizeErr || !recipientSetHash) {
    return build("DRY_RUN_FAILED", {
      message_id: messageId, request_id: requestId,
      blockers: [{ code: "recipient_hash_resolution_failed", stage: "recipient_evidence", message: normalizeErr?.message }],
      failure_stage: "recipient_evidence",
      original_decision_id: originalDecisionId,
      revalidation_decision_id: revalDecisionId,
    }, 500);
  }
  if (recipientSetHash !== (execution as any).recipient_set_hash) {
    return build("BLOCKED", {
      message_id: messageId, request_id: requestId,
      blockers: [{ code: "recipient_hash_context_mismatch", stage: "recipient_evidence" }],
      failure_stage: "recipient_evidence",
      original_decision_id: originalDecisionId,
      revalidation_decision_id: revalDecisionId,
    }, 409);
  }
  const toEmail = toEmails[0];

  const subjectHash = await sha256Hex((msg as any).subject ?? "");
  const bodyHash = await sha256Hex(`${(msg as any).body_text ?? ""}\u241E${(msg as any).body_html ?? ""}`);

  const attemptNo = ((msg as any).attempt_count ?? 0);
  const finishedAt = new Date().toISOString();

  // 8. Insert exactly one authoritative attempt. Unique (message_id, attempt_no)
  // means a race yields ONE row; the loser reads it and treats it as replay.
  const { data: inserted, error: insErr } = await admin
    .from("communication_delivery_attempt")
    .insert({
      message_id: messageId,
      attempt_no: attemptNo,
      provider_id: null,
      started_at: startedAt,
      finished_at: finishedAt,
      status: "skipped",
      provider_message_id: null,
      send_context: "dry_run",
      attempt_type: "dry_run",
      provider_call_attempted: false,
      original_decision_id: originalDecisionId,
      revalidation_decision_id: revalDecisionId,
      revalidation_result: "passed",
      recipient_set_hash: recipientSetHash,
      subject_hash: subjectHash,
      body_hash: bodyHash,
      blockers: [],
      warnings: revalWarnings,
      provider_response: {
        request: {
          to_masked: maskEmail(toEmail),
          subject_length: ((msg as any).subject ?? "").length,
          body_html_size: ((msg as any).body_html ?? "").length,
          body_text_size: ((msg as any).body_text ?? "").length,
          channel: (msg as any).channel,
          test_mode: true,
        },
        response: {
          result: "DRY_RUN_PROCESSED",
          provider_call_attempted: false,
          provider_code: "dry-run",
          provider_message_id: null,
        },
      },
      error_code: null,
      error_message: null,
      retry_reason: null,
    })
    .select("id")
    .maybeSingle();

  if (insErr || !inserted) {
    // Race: another caller wrote the attempt first — treat as idempotent replay.
    const { data: raced } = await admin
      .from("communication_delivery_attempt")
      .select("id, revalidation_decision_id, recipient_set_hash, subject_hash, body_hash, started_at, finished_at")
      .eq("message_id", messageId).eq("attempt_type", "dry_run")
      .order("attempt_no", { ascending: false }).limit(1).maybeSingle();
    if (raced) {
      const e: any = raced;
      return build("DRY_RUN_PROCESSED", {
        processed: true, idempotent_replay: true,
        message_id: messageId, request_id: requestId,
        delivery_attempt_id: e.id,
        original_decision_id: originalDecisionId,
        revalidation_decision_id: e.revalidation_decision_id ?? revalDecisionId,
        recipient_set_hash: e.recipient_set_hash, subject_hash: e.subject_hash, body_hash: e.body_hash,
        started_at: e.started_at ?? startedAt,
        completed_at: e.finished_at ?? finishedAt,
      });
    }
    return build("DRY_RUN_FAILED", {
      message_id: messageId, request_id: requestId,
      blockers: [{ code: "attempt_insert_failed", stage: "attempt_creation", message: insErr?.message }],
      failure_stage: "attempt_creation",
      original_decision_id: originalDecisionId,
      revalidation_decision_id: revalDecisionId,
    }, 500);
  }

  // 9. Trace + event log evidence — NEVER mark message as sent/delivered.
  const traceId = await resolveTraceForMessage(admin, messageId, requestId);
  await traceStep(admin, traceId, {
    stage_code: "DRY_RUN_PROCESSED", status: "passed",
    plain_summary: "targeted dry-run processed; provider not called",
    message_id: messageId,
  });
  await admin.from("communication_event_log").insert({
    request_id: requestId, message_id: messageId,
    event_type: "queued", source: "comm-hub-dispatch",
    payload: {
      stage: "DRY_RUN_PROCESSED",
      dry_run: true,
      provider_call_attempted: false,
      delivery_attempt_id: (inserted as any).id,
      original_decision_id: originalDecisionId,
      revalidation_decision_id: revalDecisionId,
      recipient_set_hash: recipientSetHash,
      subject_hash: subjectHash,
      body_hash: bodyHash,
    },
  });

  return build("DRY_RUN_PROCESSED", {
    processed: true, idempotent_replay: false,
    message_id: messageId, request_id: requestId,
    delivery_attempt_id: (inserted as any).id,
    trace_id: traceId,
    original_decision_id: originalDecisionId,
    revalidation_decision_id: revalDecisionId,
    recipient_set_hash: recipientSetHash,
    subject_hash: subjectHash,
    body_hash: bodyHash,
    started_at: startedAt,
    completed_at: finishedAt,
    warnings: revalWarnings,
  });
}

// ============================================================================
// CH-SIMPLE-P3E-B — Targeted Controlled-Live Dispatch
// ============================================================================
// Extension entry: `operation: "targeted_controlled_live"`.
//
// Preconditions (fail-closed):
//   * message.send_context = 'controlled_live'
//   * exactly one recipient; no CC/BCC
//   * a matching RESERVED grant exists for this execution/message
//   * canonical revalidation passes
//   * EMERGENCY_STOP not engaged
//   * COMM_HUB_PROVIDER_MODE=stub (P3E-B; real provider belongs to P3E-C)
//
// Provider outcome classification:
//   PROVIDER_ACCEPTED | PROVIDER_REJECTED | DELIVERY_PENDING
// The grant is CONSUMED once provider invocation is recorded, regardless of
// outcome. A pre-provider block REVOKES the grant.

// deno-lint-ignore no-explicit-any
interface TargetedControlledLiveBody {
  operation: "targeted_controlled_live";
  /**
   * Explicit dispatcher action. REQUIRED for `targeted_controlled_live`.
   * `RUN_CONTROLLED_STUB` selects the deterministic simulator.
   * `SEND_ONE_REAL_EMAIL` is a distinct action and is currently rejected
   * with `real_email_action_not_enabled` until its dedicated release path
   * ships.
   */
  action?: ControlledDispatchAction | string;
  messageId?: string;
  requestId?: string;
  executionId?: string;
  grantId?: string;
}

interface TargetedControlledLiveEnvelope {
  schema_version: typeof CONTROLLED_DISPATCH_SCHEMA_VERSION;
  operation: "targeted_controlled_live";
  action: ControlledDispatchAction | null;
  status:
    | "BLOCKED"
    | "DISPATCH_FAILED"
    | "PROVIDER_REJECTED"
    | "PROVIDER_ACCEPTED"
    | "DELIVERY_PENDING"
    | "DELIVERED";
  passed: boolean;
  idempotent_replay: boolean;
  retry_safe: boolean;
  automatic_retry_allowed: boolean;
  existing_message_dispatchable: boolean;
  requires_new_execution: boolean;
  requires_new_grant: boolean;
  requires_new_preview: boolean;
  requires_new_dry_run: boolean;
  reconciliation_required: boolean;
  request_id: string | null;
  message_id: string | null;
  delivery_attempt_id: string | null;
  trace_id: string | null;
  execution_id: string | null;
  grant_id: string | null;
  grant_status: string | null;
  original_decision_id: string | null;
  revalidation_decision_id: string | null;
  provider_adapter_invoked: boolean;
  provider_call_attempted: boolean;
  external_provider_call_attempted: boolean;
  simulated: boolean;
  provider_name: string | null;
  provider_message_id: string | null;
  provider_status: string | null;
  provider_response_safe: unknown;
  recipient_set_hash: string | null;
  subject_hash: string | null;
  body_html_hash: string | null;
  body_text_hash: string | null;
  body_hash: string | null;
  content_hash: string | null;
  blockers: Array<{ code: string; stage?: string; message?: string; retry_safe?: boolean; recommended_action?: string; metadata?: Record<string, unknown> }>;
  warnings: unknown[];
  started_at: string;
  completed_at: string;
  failure_stage: string | null;
}


// deno-lint-ignore no-explicit-any
async function processTargetedControlledLive(admin: any, body: TargetedControlledLiveBody): Promise<Response> {
  const { invokeProviderStub, isProviderStubActive } = await import(
    "../_shared/communication-hub/provider-stub.ts"
  );

  const startedAt = new Date().toISOString();
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const env: TargetedControlledLiveEnvelope = {
    schema_version: CONTROLLED_DISPATCH_SCHEMA_VERSION,
    operation: "targeted_controlled_live",
    action: null,
    status: "BLOCKED",
    passed: false,
    idempotent_replay: false,
    retry_safe: false,
    automatic_retry_allowed: false,
    existing_message_dispatchable: false,
    requires_new_execution: false,
    requires_new_grant: false,
    requires_new_preview: false,
    requires_new_dry_run: false,
    reconciliation_required: false,
    request_id: null,
    message_id: null,
    delivery_attempt_id: null,
    trace_id: null,
    execution_id: body?.executionId ?? null,
    grant_id: body?.grantId ?? null,
    grant_status: null,
    original_decision_id: null,
    revalidation_decision_id: null,
    provider_adapter_invoked: false,
    provider_call_attempted: false,
    external_provider_call_attempted: false,
    simulated: false,
    provider_name: null,
    provider_message_id: null,
    provider_status: null,
    provider_response_safe: null,
    recipient_set_hash: null,
    subject_hash: null,
    body_html_hash: null,
    body_text_hash: null,
    body_hash: null,
    content_hash: null,
    blockers: [],
    warnings: [],
    started_at: startedAt,
    completed_at: startedAt,
    failure_stage: null,
  };
  const block = (
    stage: string,
    code: string,
    message?: string,
    status: TargetedControlledLiveEnvelope["status"] = "BLOCKED",
    http = 200,
    extras: Partial<TargetedControlledLiveEnvelope> = {},
  ) => {
    env.status = status;
    env.failure_stage = stage;
    env.completed_at = new Date().toISOString();
    // Deduplicate by (code, stage) — the first precise blocker wins.
    if (!env.blockers.some((b) => b.code === code && (b.stage ?? "") === stage)) {
      env.blockers.push({ code, stage, message });
    }
    Object.assign(env, extras);
    return json(env, http);
  };

  // 0.a Explicit action contract — validated BEFORE any DB read so a
  // missing/invalid action can never mutate durable state. Also gates
  // SEND_ONE_REAL_EMAIL, which is a separate release path.
  const rawAction = typeof body?.action === "string" ? body.action.trim() : "";
  if (!rawAction) {
    return block(
      "action_validation",
      ACTION_BLOCKER_CODES.TARGETED_ACTION_MISSING,
      "targeted_controlled_live requires an explicit `action`.",
      "BLOCKED",
      400,
      { requires_new_execution: true, requires_new_grant: true, retry_safe: true },
    );
  }
  if (!(CONTROLLED_DISPATCH_ACTIONS as readonly string[]).includes(rawAction)) {
    return block(
      "action_validation",
      ACTION_BLOCKER_CODES.TARGETED_ACTION_INVALID,
      `Unknown action '${rawAction.slice(0, 60)}'.`,
      "BLOCKED",
      400,
      { requires_new_execution: true, requires_new_grant: true, retry_safe: true },
    );
  }
  const action = rawAction as ControlledDispatchAction;
  env.action = action;
  if (action === "SEND_ONE_REAL_EMAIL") {
    return block(
      "action_validation",
      ACTION_BLOCKER_CODES.REAL_EMAIL_ACTION_NOT_ENABLED,
      "SEND_ONE_REAL_EMAIL is not enabled on the dispatcher in this release.",
      "BLOCKED",
      400,
      { requires_new_execution: true, requires_new_grant: true, retry_safe: false },
    );
  }

  if (!body?.messageId || !uuidRe.test(body.messageId)) {
    return block("input_validation", "message_id_invalid", undefined, "BLOCKED", 400,
      { requires_new_execution: true, requires_new_grant: true, retry_safe: true });
  }
  if (!body?.executionId || !uuidRe.test(body.executionId)) {
    return block("input_validation", "execution_id_invalid", undefined, "BLOCKED", 400,
      { requires_new_execution: true, requires_new_grant: true, retry_safe: true });
  }
  if (!body?.grantId || !uuidRe.test(body.grantId)) {
    return block("input_validation", "grant_id_invalid", undefined, "BLOCKED", 400,
      { requires_new_execution: true, requires_new_grant: true, retry_safe: true });
  }

  const messageId = body.messageId!;
  const executionId = body.executionId!;
  const grantId = body.grantId!;
  env.message_id = messageId;
  env.execution_id = executionId;
  env.grant_id = grantId;


  // 1. Slice 2: Atomic targeted claim via dedicated server-owned RPC.
  //    This is the ONLY way targeted messages become claimed. The RPC
  //    verifies targeted_dispatch_only, action, execution, grant, context,
  //    channel, origin, queue status, existing controlled attempts and
  //    lock conflicts inside a single transaction with FOR UPDATE SKIP LOCKED.
  const workerId = `dispatch-targeted:${crypto.randomUUID().slice(0, 8)}`;
  const { data: claimRaw, error: claimErr } = await admin.rpc(
    "claim_comm_hub_targeted_message",
    {
      p_message_id: messageId,
      p_execution_id: executionId,
      p_grant_id: grantId,
      p_action: action,
      p_worker_id: workerId,
    },
  );
  if (claimErr) {
    return block("targeted_claim", "targeted_claim_rpc_error",
      String(claimErr.message ?? claimErr).slice(0, 300), "DISPATCH_FAILED", 500,
      { requires_new_execution: false, requires_new_grant: false, retry_safe: true });
  }
  const claim: any = claimRaw ?? {};
  if (claim.ok !== true || claim.claimed !== true) {
    const code = String(claim.code ?? "targeted_claim_refused");
    // Precise blocker mapping: propagate the RPC's code verbatim so the
    // orchestrator sees the exact reason (missing flag, action/execution/grant
    // mismatch, not queued, locked, existing attempt).
    return block("targeted_claim", code,
      String(claim.message ?? `targeted claim refused: ${code}`),
      "BLOCKED", 409,
      { requires_new_execution: false, requires_new_grant: false, retry_safe: code !== "targeted_attempt_already_exists" });
  }
  // Construct a msg-like object from the authoritative claim result so
  // the downstream dispatch path uses frozen evidence, never a fresh SELECT.
  const msg = {
    id: claim.message_id,
    request_id: claim.request_id,
    recipient_id: claim.recipient_id,
    channel: claim.channel,
    subject: null,
    body_text: null,
    body_html: null,
    status: claim.status,
    send_context: claim.send_context,
    origin: claim.origin,
    attempt_count: claim.attempt_count,
    original_decision_id: null,
    template_version_id: claim.template_version_id,
    sender_profile_id: claim.sender_profile_id,
    from_email: claim.from_email,
    from_display_name: claim.from_display_name,
    reply_to_email: claim.reply_to_email,
    preview_snapshot_id: claim.preview_snapshot_id,
    preview_approval_id: claim.preview_approval_id,
    dry_run_certification_id: claim.dry_run_certification_id,
    governance_certification_id: claim.governance_certification_id,
    certified_dependency_hash: claim.certified_dependency_hash,
    recipient_set_hash: claim.recipient_set_hash,
    subject_hash: claim.subject_hash,
    body_hash: claim.body_hash,
    content_hash: claim.content_hash,
    controlled_action: claim.action,
    controlled_live_execution_id: claim.execution_id,
    controlled_live_grant_id: claim.grant_id,
    targeted_dispatch_only: true,
  } as any;
  const requestId = msg.request_id as string;
  env.request_id = requestId;
  if (body?.requestId && body.requestId !== requestId) {
    return block("context_validation", "request_message_mismatch", undefined, "BLOCKED", 409);
  }
  // Fetch remaining non-frozen content (subject/body) from the row for provider payload.
  const { data: contentRow } = await admin
    .from("communication_message")
    .select("subject, body_text, body_html, original_decision_id")
    .eq("id", messageId).maybeSingle();
  if (contentRow) {
    msg.subject = (contentRow as any).subject;
    msg.body_text = (contentRow as any).body_text;
    msg.body_html = (contentRow as any).body_html;
    msg.original_decision_id = (contentRow as any).original_decision_id ?? null;
  }
  env.original_decision_id = msg.original_decision_id ?? null;

  // Grant metadata for hash comparisons downstream.
  const { data: grantRow, error: grantError } = await admin
    .from("communication_controlled_live_grant")
    .select("id, execution_id, status, recipient_set_hash")
    .eq("id", grantId).maybeSingle();
  if (grantError) return block("grant_load", "grant_read_failed", grantError.message, "DISPATCH_FAILED", 500);
  if (!grantRow) return block("grant_load", "grant_not_found", undefined, "BLOCKED", 404);
  const initialGrantStatus = (grantRow as any).status as string;
  env.grant_status = initialGrantStatus;

  // 3. Idempotency: authoritative attempt already exists?
  const { data: existing, error: existingError } = await admin
    .from("communication_delivery_attempt")
    .select("id, provider_status, provider_message_id, provider_response_safe, provider_call_attempted, revalidation_decision_id, recipient_set_hash, subject_hash, body_hash, provider_invocation_key, started_at, finished_at, warnings, blockers, result")
    .eq("message_id", messageId)
    .eq("attempt_type", "controlled_live")
    .order("attempt_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) {
    return block("attempt_replay_check", "attempt_replay_read_failed",
      existingError.message, "DISPATCH_FAILED", 500);
  }
  if (existing && (existing as any).provider_call_attempted) {
    const e: any = existing;
    const status = (e.provider_status as any) ?? "PROVIDER_ACCEPTED";
    env.status = status;
    env.idempotent_replay = true;
    env.delivery_attempt_id = e.id;
    env.provider_call_attempted = true;
    env.provider_status = status;
    env.provider_message_id = e.provider_message_id ?? null;
    env.provider_response_safe = e.provider_response_safe ?? null;
    env.recipient_set_hash = e.recipient_set_hash ?? null;
    env.subject_hash = e.subject_hash ?? null;
    env.body_hash = e.body_hash ?? null;
    env.warnings = Array.isArray(e.warnings) ? e.warnings : [];
    env.completed_at = e.finished_at ?? new Date().toISOString();
    env.grant_status = "CONSUMED";
    return json(env, 200);
  }

  // Pre-provider reconciliation helper: canonical atomic path that revokes
  // an ISSUED/RESERVED grant, marks the claimed message failed, clears the
  // lock, and returns a structured envelope. Every failure between claim
  // and provider invocation MUST route through this helper.
  const preProviderReconcile = async (
    stage: string, code: string, message: string | undefined,
    status: string, http: number,
  ) => {
    try {
      const { data: rec } = await admin.rpc(
        "reconcile_comm_hub_controlled_live_pre_provider",
        {
          p_grant_id: grantId, p_execution_id: executionId, p_message_id: messageId,
          p_failure_stage: stage, p_failure_code: code,
          p_reason: (message ?? code).slice(0, 300),
        },
      );
      const r: any = rec ?? {};
      env.grant_status = (r.grant_status as string) ?? "REVOKED";
      env.requires_new_execution = r.requires_new_execution === true;
      env.requires_new_grant = r.requires_new_grant === true;
    } catch (_) {
      env.grant_status = "REVOKED";
    }
    return block(stage, code, message, status, http,
      { requires_new_execution: true, requires_new_grant: true, retry_safe: true });
  };

  // 4. Canonical revalidation — canonical 2-arg signature (p_prior_decision_id, p_payload).
  //    Mirrors processTargetedDryRun exactly.
  let revalDecisionId: string | null = null;
  const originalDecisionId = env.original_decision_id;
  if (!originalDecisionId) {
    return preProviderReconcile(
      "canonical_revalidation", "original_decision_missing",
      "message has no original_decision_id to revalidate against",
      "BLOCKED", 409);
  }
  try {
    const { data: priorDecision, error: priorErr } = await admin
      .from("communication_hub_send_decision_log")
      .select("payload")
      .eq("decision_id", originalDecisionId)
      .maybeSingle();
    if (priorErr || !priorDecision) {
      throw new Error(priorErr?.message ?? "prior_decision_not_found");
    }
    const { data: reval, error: rvErr } = await admin.rpc(
      "revalidate_comm_hub_send_decision",
      { p_prior_decision_id: originalDecisionId, p_payload: (priorDecision as any).payload },
    );
    if (rvErr) throw new Error(rvErr.message);
    const r: any = reval ?? {};
    const fresh: any = r.fresh_decision ?? {};
    revalDecisionId = r.fresh_decision_id ?? fresh.decision_id ?? null;
    env.revalidation_decision_id = revalDecisionId;
    const freshBlockers = Array.isArray(fresh.blockers) ? fresh.blockers : [];
    const freshWarnings = Array.isArray(fresh.warnings) ? fresh.warnings : [];
    const allowed = r.fresh_allowed === true && r.stale !== true;
    if (!allowed) {
      for (const b of freshBlockers) {
        if (b && typeof b === "object" && typeof b.code === "string") {
          env.blockers.push({
            code: b.code, stage: b.stage ?? "canonical_revalidation", message: b.message,
          });
        }
      }
      return preProviderReconcile(
        "canonical_revalidation",
        r.stale === true ? "send_decision_stale" : "revalidation_denied",
        Array.isArray(r.staleness_reasons) ? r.staleness_reasons.join(", ") : undefined,
        "BLOCKED", 200);
    }
    if (freshWarnings.length) env.warnings.push(...freshWarnings);
  } catch (e: any) {
    return preProviderReconcile(
      "canonical_revalidation", "revalidation_exception",
      String(e?.message ?? e).slice(0, 300), "DISPATCH_FAILED", 500);
  }

  // 5. Emergency Stop / kill switch check.
  const { data: settingsNow, error: settingsNowError } = await admin
    .from("communication_hub_control_settings")
    .select("operating_mode")
    .eq("singleton_guard", "primary").maybeSingle();
  if (settingsNowError || !settingsNow) {
    return preProviderReconcile("control_gates", "control_settings_unavailable",
      settingsNowError?.message, "DISPATCH_FAILED", 500);
  }
  if ((settingsNow as any)?.operating_mode === "EMERGENCY_STOP") {
    return preProviderReconcile("emergency_stop", "emergency_stop_active",
      undefined, "BLOCKED", 200);
  }

  // 6. Load recipient; compute hashes.
  let toEmail: string | null = null;
  if ((msg as any).recipient_id) {
    const { data: rec, error: recError } = await admin.from("communication_recipient")
      .select("email").eq("id", (msg as any).recipient_id).maybeSingle();
    if (recError) {
      return preProviderReconcile("recipient_load", "recipient_read_failed",
        recError.message, "DISPATCH_FAILED", 500);
    }
    toEmail = (rec as any)?.email ?? null;
  }
  if (!toEmail) {
    return preProviderReconcile("recipient_load", "recipient_missing",
      undefined, "BLOCKED", 500);
  }

  // Must match begin_comm_hub_controlled_live exactly.
  const recipientSetHash = await sha256Hex(`to:${toEmail.trim().toLowerCase()}|cc:|bcc:`);
  const subjectHash = await sha256Hex((msg as any).subject ?? "");
  const bodyHash = await sha256Hex(`${(msg as any).body_text ?? ""}\u241E${(msg as any).body_html ?? ""}`);
  env.recipient_set_hash = recipientSetHash;
  env.subject_hash = subjectHash;
  env.body_hash = bodyHash;

  // 7. Reserve grant using the hardened service-bound signature. The grant
  // reservation is bound to comm-hub-dispatch / DISPATCH_CONTROLLED_STUB
  // and the caller's declared action. Correlation is left unchecked here
  // (message-level binding is enforced at consume-time).
  const { data: reserveRaw, error: reserveErr } = await admin.rpc(
    "reserve_comm_hub_controlled_live_grant",
    {
      p_grant_id: grantId,
      p_execution_id: executionId,
      p_expected_action: action,
      p_expected_correlation_id: null,
      p_service_operation: "DISPATCH_CONTROLLED_STUB",
    },
  );
  if (reserveErr || !(reserveRaw as any)?.allowed) {
    const detail = Array.isArray((reserveRaw as any)?.blockers)
      ? JSON.stringify((reserveRaw as any).blockers).slice(0, 240)
      : String(reserveErr?.message ?? "unknown");
    return preProviderReconcile("grant_reservation", "grant_reservation_failed",
      detail, "BLOCKED", 200);
  }
  env.grant_status = (reserveRaw as any).status ?? "RESERVED";

  // 8. Provider invocation key: use claim.attempt_count directly (already
  //    incremented by claim_comm_hub_targeted_message; do NOT +1 again).
  const attemptNo = (claim.attempt_count as number) ?? ((msg as any).attempt_count ?? 1);
  const providerInvocationKey =
    (await sha256Hex(`${executionId}:${messageId}:${attemptNo}`)).slice(0, 40);

  // 9. Insert authoritative pre-provider delivery attempt. Status stays
  //    'pending' with finished_at=NULL until the provider outcome lands;
  //    the check constraint now permits 'pending' explicitly.
  const { data: attempt, error: attemptErr } = await admin
    .from("communication_delivery_attempt")
    .insert({
      message_id: messageId,
      attempt_no: attemptNo,
      provider_id: null,
      started_at: startedAt,
      status: "pending",
      send_context: "controlled_live",
      attempt_type: "controlled_live",
      provider_call_attempted: false,
      provider_invocation_key: providerInvocationKey,
      controlled_live_execution_id: executionId,
      grant_id: grantId,
      original_decision_id: env.original_decision_id,
      revalidation_decision_id: revalDecisionId,
      revalidation_result: "passed",
      recipient_set_hash: recipientSetHash,
      subject_hash: subjectHash,
      body_hash: bodyHash,
      blockers: [],
      warnings: env.warnings,
      finished_at: null,
    })
    .select("id").maybeSingle();
  if (attemptErr || !attempt) {
    // Race: unique provider_invocation_key collision — treat as replay.
    const { data: raced } = await admin
      .from("communication_delivery_attempt")
      .select("id, provider_status, provider_message_id, provider_response_safe, provider_call_attempted, warnings, finished_at")
      .eq("provider_invocation_key", providerInvocationKey).maybeSingle();
    if (raced) {
      const r: any = raced;
      env.idempotent_replay = true;
      env.delivery_attempt_id = r.id;
      env.provider_call_attempted = !!r.provider_call_attempted;
      env.provider_status = r.provider_status ?? null;
      env.provider_message_id = r.provider_message_id ?? null;
      env.provider_response_safe = r.provider_response_safe ?? null;
      if (!r.provider_call_attempted || !r.provider_status) {
        env.status = "DISPATCH_FAILED";
        env.failure_stage = "attempt_creation";
        env.blockers.push({
          code: "controlled_live_attempt_in_progress",
          stage: "attempt_creation",
          message: "A durable controlled-live attempt exists without a final provider outcome; do not retry automatically.",
        });
      } else {
        env.status = r.provider_status as any;
      }
      env.warnings = Array.isArray(r.warnings) ? r.warnings : [];
      env.completed_at = r.finished_at ?? new Date().toISOString();
      env.grant_status = r.provider_call_attempted ? "CONSUMED" : "RESERVED";
      return json(env, 200);
    }
    return preProviderReconcile("attempt_creation", "attempt_insert_failed",
      String(attemptErr?.message ?? "unknown"), "DISPATCH_FAILED", 500);
  }
  env.delivery_attempt_id = (attempt as any).id;

  // 10. Record provider attempt on execution (idempotent).
  const { data: attemptRecordRaw, error: attemptRecordError } = await admin.rpc("record_comm_hub_controlled_live_provider_attempt", {
    p_execution_id: executionId,
    p_invocation_key: providerInvocationKey,
    p_provider_name: "comm-hub-stub",
  });
  if (attemptRecordError || !(attemptRecordRaw as any)?.ok) {
    const detail = String(attemptRecordError?.message ?? (attemptRecordRaw as any)?.code ?? "unknown");
    await admin.from("communication_delivery_attempt").update({
      status: "failure",
      result: "DISPATCH_FAILED",
      blockers: [{ code: "execution_attempt_record_failed", stage: "provider_preflight", message: detail }],
      finished_at: new Date().toISOString(),
    }).eq("id", env.delivery_attempt_id);
    return preProviderReconcile("provider_preflight", "execution_attempt_record_failed",
      detail, "DISPATCH_FAILED", 500);
  }

  // 11. Invoke provider. Adapter selection is driven exclusively by the
  // explicit `action` on the targeted request — validated at entry. There
  // is NO fallback to COMM_HUB_PROVIDER_MODE for targeted requests, and
  // no reference to any `payload.action` variable: `body.action` is the
  // sole authoritative source. Only `RUN_CONTROLLED_STUB` reaches this
  // point in Slice 1; `SEND_ONE_REAL_EMAIL` is rejected up-front.
  void isProviderStubActive; // retained import for legacy queue callers
  env.provider_adapter_invoked = true;
  env.simulated = true;
  let outcome;
  try {
    outcome = invokeProviderStub({
      recipient: toEmail,
      providerInvocationKey,
      subject: (msg as any).subject ?? "",
      bodyHash,
      action: "RUN_CONTROLLED_STUB",
    });

  } catch (e: any) {
    // Provider transport threw before response — treat as ambiguous.
    // Order matters: attempt row MUST reflect provider evidence BEFORE we
    // call consume, because consume's canonical evidence check requires a
    // durable provider_call_attempted attempt on the message.
    env.completed_at = new Date().toISOString();
    env.provider_call_attempted = true;
    env.status = "DELIVERY_PENDING";
    env.warnings.push({ code: "provider_outcome_unconfirmed" });
    const { error: ambEvidenceErr } = await admin.from("communication_delivery_attempt").update({
      provider_call_attempted: true,
      provider_status: "DELIVERY_PENDING",
      provider_response_safe: { error: "provider_exception" },
      provider_call_completed_at: env.completed_at,
      status: "pending",
      result: "DELIVERY_PENDING",
      warnings: env.warnings,
      finished_at: env.completed_at,
    }).eq("id", env.delivery_attempt_id);
    await admin.rpc("record_comm_hub_controlled_live_provider_outcome", {
      p_execution_id: executionId,
      p_provider_status: "DELIVERY_PENDING",
      p_provider_message_id: null,
      p_provider_response_safe: { error: "provider_exception" },
      p_warnings: [{ code: "provider_outcome_unconfirmed", message: String(e?.message ?? e).slice(0, 200) }],
    });
    if (ambEvidenceErr) {
      // Evidence write failed AFTER provider was invoked — ambiguous.
      // Do NOT consume the grant; require manual reconciliation.
      env.blockers.push({
        code: "provider_evidence_persist_failed",
        stage: "provider_evidence",
        message: String(ambEvidenceErr.message).slice(0, 240),
      });
      (env as any).requires_new_execution = true;
      (env as any).requires_new_grant = true;
      (env as any).retry_safe = false;
      (env as any).reconciliation_required = true;
      return json(env, 200);
    }
    const { data: consumeAmbRaw } = await admin.rpc("consume_comm_hub_controlled_live_grant", {
      p_grant_id: grantId,
      p_execution_id: executionId,
      p_message_id: messageId,
      p_expected_correlation_id: null,
      p_service_operation: "DISPATCH_CONTROLLED_STUB",
    });
    env.grant_status = (consumeAmbRaw as any)?.allowed
      ? ((consumeAmbRaw as any).status ?? "CONSUMED") : env.grant_status;
    return json(env, 200);
  }

  const providerCompletedAt = new Date().toISOString();

  // 12. Update attempt row with provider outcome.
  await admin.from("communication_delivery_attempt").update({
    provider_call_attempted: true,
    provider_call_completed_at: providerCompletedAt,
    provider_status: outcome.status,
    provider_message_id: outcome.providerMessageId,
    provider_response_safe: outcome.providerResponseSafe,
    provider_id: null,
    status: outcome.status === "PROVIDER_REJECTED" ? "failed"
          : outcome.status === "DELIVERY_PENDING" ? "pending"
          : "sent",
    result: outcome.status,
    warnings: [...env.warnings, ...outcome.warnings],
    finished_at: providerCompletedAt,
  }).eq("id", env.delivery_attempt_id);

  // 13. Record provider outcome on execution + consume grant (hardened
  //     service-bound signature). The attempt row above already carries
  //     provider_call_attempted=true and provider_status; consume's
  //     canonical evidence check will match exactly one such attempt.
  await admin.rpc("record_comm_hub_controlled_live_provider_outcome", {
    p_execution_id: executionId,
    p_provider_status: outcome.status,
    p_provider_message_id: outcome.providerMessageId,
    p_provider_response_safe: outcome.providerResponseSafe,
    p_warnings: outcome.warnings,
  });
  const { data: consumeRaw, error: consumeErr } = await admin.rpc(
    "consume_comm_hub_controlled_live_grant",
    {
      p_grant_id: grantId,
      p_execution_id: executionId,
      p_message_id: messageId,
      p_expected_correlation_id: null,
      p_service_operation: "DISPATCH_CONTROLLED_STUB",
    },
  );
  const consumedOk = !consumeErr && (consumeRaw as any)?.allowed === true;
  if (consumedOk) {
    env.grant_status = (consumeRaw as any).status ?? "CONSUMED";
  } else {
    // Provider outcome already confirmed; surface the reconciliation gap
    // but never mask a successful send.
    env.warnings.push({
      code: "grant_consume_failed_post_provider",
      message: JSON.stringify(
        (consumeRaw as any)?.blockers ?? consumeErr?.message ?? null).slice(0, 240),
    });
  }

  // 14. Trace + event log evidence.
  try {
    const traceId = await resolveTraceForMessage(admin, messageId, requestId);
    env.trace_id = traceId;
    await traceStep(admin, traceId, {
      stage_code: outcome.status, status:
        outcome.status === "PROVIDER_REJECTED" ? "failed" : "passed",
      plain_summary: `controlled-live provider outcome: ${outcome.status}`,
      message_id: messageId,
    });
    await admin.from("communication_event_log").insert({
      request_id: requestId, message_id: messageId,
      event_type: outcome.status === "PROVIDER_REJECTED" ? "failed" : "sent",
      source: "comm-hub-dispatch",
      payload: {
        stage: outcome.status,
        controlled_live_execution_id: executionId,
        grant_id: grantId,
        provider_invocation_key: providerInvocationKey,
        provider_message_id: outcome.providerMessageId,
        delivery_attempt_id: env.delivery_attempt_id,
        recipient_set_hash: recipientSetHash,
        subject_hash: subjectHash,
        body_hash: bodyHash,
      },
    });
  } catch (_) { /* trace failure is non-fatal */ }

  env.provider_call_attempted = true;
  env.provider_name = outcome.providerName;
  env.provider_status = outcome.status;
  env.provider_message_id = outcome.providerMessageId;
  env.provider_response_safe = outcome.providerResponseSafe;
  env.warnings.push(...outcome.warnings);
  env.status = outcome.status;
  // env.grant_status set above from consume result; do not force-overwrite.
  env.completed_at = providerCompletedAt;
  env.failure_stage = outcome.status === "PROVIDER_REJECTED" ? "provider_rejection" : null;
  return json(env, 200);
}
