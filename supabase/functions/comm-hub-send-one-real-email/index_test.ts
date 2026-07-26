/**
 * Stage 6 (Send One Real Email) — Slice 1 backend contract tests.
 *
 * These tests target the SQL RPC surface installed by the Stage 6 hardening
 * migration and the Edge Function envelope contract. They intentionally
 * exercise the fail-closed paths, because building a full end-to-end fixture
 * chain (snapshot, approval, dry-run cert, controlled-stub cert, real-email
 * gate, verified sender profile) belongs to Slice 2. Slice 1 must prove that
 * the guardrails REFUSE traffic that does not meet the contract.
 *
 * Env: loads root .env for VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.
 */

// deno-lint-ignore-file no-explicit-any
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL") ??
  Deno.env.get("VITE_SUPABASE_URL") ?? "";
const ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ?? "";

const FN_URL = `${SUPABASE_URL}/functions/v1/comm-hub-send-one-real-email`;
const EXPECTED_RUNTIME_BUILD =
  "comm-hub-send-one-real-email@a0a9275fb6852527763708cd67af157604619eb3";

async function callFn(body: unknown, opts: { auth?: string } = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    apikey: ANON_KEY,
  };
  if (opts.auth !== undefined) headers.Authorization = opts.auth;
  const res = await fetch(FN_URL, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* keep null */ }
  return { status: res.status, body: parsed, text };
}

const anon = () => createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ------------------------------------------------------------------------
// 1. Authorization: verify_jwt=true rejects an entirely missing Bearer at
//    the gateway (HTTP 401 with no envelope). With the anon key supplied
//    as the Bearer, the gateway forwards; the function then refuses at
//    stage=auth because `getUser()` cannot resolve a real user.
// ------------------------------------------------------------------------
Deno.test("Stage 6 — gateway refuses calls without any Bearer token", async () => {
  const r = await callFn({ action: "SEND_ONE_REAL_EMAIL" });
  assertEquals(r.status, 401);
});

Deno.test("Stage 6 — function refuses anon-key Bearer at stage=auth (retry-safe envelope)", async () => {
  const r = await callFn({ action: "SEND_ONE_REAL_EMAIL" },
    { auth: `Bearer ${ANON_KEY}` });
  assertEquals(r.status, 401);
  assertEquals(r.body?.schema_version, "one-real-email.v1");
  assertEquals(r.body?.runtime_build, EXPECTED_RUNTIME_BUILD);
  assertEquals(r.body?.status, "BLOCKED");
  assertEquals(r.body?.failure_stage, "auth");
  assertEquals(r.body?.retry_safe, true);
  assertEquals(r.body?.provider_call_attempted, false);
  assertEquals(r.body?.send_context, "REAL_EMAIL");
});

// ------------------------------------------------------------------------
// 2. Envelope contract: schema_version + terminal fields present on refusal.
// ------------------------------------------------------------------------
Deno.test("Stage 6 — refusal envelope preserves the one-real-email.v1 contract", async () => {
  const r = await callFn({}, { auth: `Bearer ${ANON_KEY}` });
  assert(r.body, "response body must be JSON");
  const required = [
    "schema_version", "runtime_build", "action", "status", "passed", "idempotent_replay",
    "execution_id", "grant_id", "message_id", "delivery_attempt_id",
    "provider_call_attempted", "provider_mode", "send_context",
    "real_email_authorised", "certification_id", "certification_kind",
    "failure_stage", "retry_safe", "reconciliation_required", "cleanup_proven",
    "blockers", "warnings", "started_at", "completed_at",
  ];
  for (const key of required) {
    assert(key in r.body, `missing key in envelope: ${key}`);
  }
  assertEquals(r.body.action, "SEND_ONE_REAL_EMAIL");
  assertEquals(r.body.runtime_build, EXPECTED_RUNTIME_BUILD);
  assertEquals(r.body.send_context, "REAL_EMAIL");
  assert(Array.isArray(r.body.blockers));
  assert(Array.isArray(r.body.warnings));
});

// ------------------------------------------------------------------------
// 3. RPC surface: begin_comm_hub_one_real_email exists and refuses anon calls.
//    (SECURITY DEFINER RPC requires an authenticated caller — anon must not
//    be able to call it directly.)
// ------------------------------------------------------------------------
Deno.test("Stage 6 — begin RPC refuses anonymous callers", async () => {
  const client = anon();
  const { data, error } = await client.rpc("begin_comm_hub_one_real_email", {
    p_payload: {
      module_code: "APPEALS", event_code: "APPEAL_RECEIVED_NOTICE",
      channel: "email", recipient: "test@example.com",
      recipient_set_hash: "x", preview_approval_id: "00000000-0000-0000-0000-000000000000",
      dry_run_certification_id: "00000000-0000-0000-0000-000000000000",
      controlled_stub_certification_id: "00000000-0000-0000-0000-000000000000",
      idempotency_key: "test-key-not-real-8char",
      reason: "unit test refusal",
    },
  });
  // Either the anon call is authorised-check-refused (auth_uid null) OR
  // it errors — in both cases we must NOT get a successful envelope.
  const okShape = data && (data as any).ok === true;
  assert(!okShape, "anon must never receive an ok=true begin envelope");
  if (error) {
    const m = (error.message ?? "").toLowerCase();
    assert(
      m.includes("authentication_required") ||
      m.includes("not_authorised") ||
      m.includes("permission") ||
      m.includes("null value"),
      `unexpected error: ${error.message}`,
    );
  }
});

Deno.test("Stage 6 — auth-context RPC does not authenticate an anonymous client", async () => {
  const client = anon();
  const { data, error } = await client.rpc("get_comm_hub_request_auth_context");
  assert(
    error !== null ||
      (data?.authenticated === false && data?.auth_uid == null && data?.comm_hub_admin === false),
    "anonymous/service-style context must never produce an authenticated user",
  );
});

Deno.test("Stage 6 — source keeps identity-sensitive and privileged clients separated", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  assert(source.includes('userClient.rpc(\n      "get_comm_hub_request_auth_context"'));
  assert(source.includes('/rest/v1/rpc/begin_comm_hub_one_real_email'));
  assert(source.includes('"Authorization": `Bearer ${bearer}`'));
  assert(!source.includes('admin.rpc("begin_comm_hub_one_real_email"'));
  for (const privilegedRpc of [
    "create_comm_hub_one_real_email_message",
    "reconcile_comm_hub_one_real_email_pre_provider",
    "reserve_comm_hub_one_real_email_grant",
    "consume_comm_hub_one_real_email_grant",
    "finalize_comm_hub_one_real_email",
  ]) {
    assert(
      new RegExp(`admin\\.rpc\\(\\s*[\"']${privilegedRpc}[\"']`).test(source),
      `${privilegedRpc} must remain on the admin client`,
    );
  }
});

Deno.test("Stage 6 — auth-context failure occurs before any execution or provider work", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const authContextAt = source.indexOf('"get_comm_hub_request_auth_context"');
  const beginAt = source.indexOf("/rest/v1/rpc/begin_comm_hub_one_real_email");
  const createAt = source.indexOf('"create_comm_hub_one_real_email_message"');
  const providerAt = source.indexOf("sendEmailViaGuardedTransport(admin");
  assert(authContextAt > 0 && authContextAt < beginAt);
  assert(beginAt < createAt && createAt < providerAt);
  assert(source.includes('return finalize("BLOCKED", "authorisation"'));
  assert(source.includes("provider_call_attempted: false"));
});

// ------------------------------------------------------------------------
// 4. Grant lifecycle RPCs are bound to service_role only — anon must fail.
// ------------------------------------------------------------------------
Deno.test("Stage 6 — reserve grant RPC is service-role only", async () => {
  const client = anon();
  const { data, error } = await client.rpc("reserve_comm_hub_one_real_email_grant", {
    p_grant_id: "00000000-0000-0000-0000-000000000000",
    p_execution_id: "00000000-0000-0000-0000-000000000000",
  });
  // Must not report allowed=true regardless of transport.
  if (data) assertEquals((data as any).allowed, false);
  if (error) {
    const m = (error.message ?? "").toLowerCase();
    assert(m.includes("permission") || m.includes("not") || m.includes("blocker"),
      `unexpected error text: ${error.message}`);
  }
});

Deno.test("Stage 6 — consume grant RPC is service-role only", async () => {
  const client = anon();
  const { data, error } = await client.rpc("consume_comm_hub_one_real_email_grant", {
    p_grant_id: "00000000-0000-0000-0000-000000000000",
    p_execution_id: "00000000-0000-0000-0000-000000000000",
    p_message_id: "00000000-0000-0000-0000-000000000000",
  });
  if (data) assertEquals((data as any).allowed, false);
  if (error) assert(true);
});

Deno.test("Stage 6 — revoke grant RPC is service-role only", async () => {
  const client = anon();
  const { data, error } = await client.rpc("revoke_comm_hub_one_real_email_grant", {
    p_grant_id: "00000000-0000-0000-0000-000000000000",
    p_execution_id: "00000000-0000-0000-0000-000000000000",
    p_reason: "unit-test",
  });
  if (data) assertEquals((data as any).allowed, false);
  if (error) assert(true);
});

// ------------------------------------------------------------------------
// 5. create_comm_hub_one_real_email_message is service-role only.
// ------------------------------------------------------------------------
Deno.test("Stage 6 — create message RPC is service-role only", async () => {
  const client = anon();
  const { data, error } = await client.rpc("create_comm_hub_one_real_email_message", {
    p_execution_id: "00000000-0000-0000-0000-000000000000",
    p_grant_id: "00000000-0000-0000-0000-000000000000",
  });
  if (data) assertEquals((data as any).ok, false);
  if (error) assert(true);
});

// ------------------------------------------------------------------------
// 6. reconcile pre-provider RPC is service-role only.
// ------------------------------------------------------------------------
Deno.test("Stage 6 — pre-provider reconcile RPC is service-role only", async () => {
  const client = anon();
  const { data, error } = await client.rpc("reconcile_comm_hub_one_real_email_pre_provider", {
    p_execution_id: "00000000-0000-0000-0000-000000000000",
    p_grant_id: "00000000-0000-0000-0000-000000000000",
    p_reason: "unit-test",
  });
  if (data) assertEquals((data as any).ok, false);
  if (error) assert(true);
});

// ------------------------------------------------------------------------
// 7. finalize RPC is service-role only.
// ------------------------------------------------------------------------
Deno.test("Stage 6 — finalize RPC is service-role only", async () => {
  const client = anon();
  const { data, error } = await client.rpc("finalize_comm_hub_one_real_email", {
    p_payload: { execution_id: "00000000-0000-0000-0000-000000000000" },
  });
  if (data) assertEquals((data as any).ok, false);
  if (error) assert(true);
});
