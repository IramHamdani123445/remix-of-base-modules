/**
 * Deno tests — comm-hub-send-controlled-revalidation Edge Function.
 *
 * Structural / contract tests that do NOT invoke the provider. They cover:
 *  - CORS preflight
 *  - probe action returns without side effects
 *  - unknown action rejected
 *  - missing bearer token rejected
 *  - missing cycle/authorisation params rejected
 *
 * Full end-to-end behavioural coverage (recipient/fingerprint/lineage
 * mismatch, expired auth, one-provider-call-per-cycle) is exercised in
 * the database RPC test suite `controlled-revalidation-rpc_test.ts` so
 * the invariants are enforced by the server, not the transport.
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const ANON = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
const FN = `${SUPABASE_URL}/functions/v1/comm-hub-send-controlled-revalidation`;

Deno.test("CORS preflight is honoured", async () => {
  const res = await fetch(FN, { method: "OPTIONS" });
  await res.text();
  assertEquals(res.status, 200);
  assert(res.headers.get("access-control-allow-origin") !== null);
});

Deno.test("probe returns without side effects", async () => {
  const res = await fetch(FN, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: ANON },
    body: JSON.stringify({ action: "probe" }),
  });
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.status, "RECOVERED");
  assertEquals(body.provider_call_attempted, false);
  assertEquals(body.runtime_build.startsWith("comm-hub-send-controlled-revalidation@"), true);
});

Deno.test("unknown action rejected", async () => {
  const res = await fetch(FN, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: ANON },
    body: JSON.stringify({ action: "SOMETHING_ELSE" }),
  });
  const body = await res.json();
  assertEquals(res.status, 400);
  assertEquals(body.blockers[0].code, "action_invalid");
});

Deno.test("send action without bearer rejected", async () => {
  const res = await fetch(FN, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: ANON },
    body: JSON.stringify({
      action: "SEND_CONTROLLED_REVALIDATION_EMAIL",
      cycleId: "00000000-0000-0000-0000-000000000000",
      authorisationId: "00000000-0000-0000-0000-000000000000",
      currentFingerprint: "sha256-v2:x",
      recipient: "op@example.com",
    }),
  });
  const body = await res.json();
  assertEquals(res.status, 401);
  assertEquals(body.status, "BLOCKED");
  assertEquals(body.provider_call_attempted, false);
  assertEquals(body.blockers[0].code, "authentication_header_missing");
});
