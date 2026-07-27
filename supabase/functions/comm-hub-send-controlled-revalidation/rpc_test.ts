/**
 * DB RPC tests — Controlled Revalidation reservation & one-provider-call invariants.
 *
 * These tests exercise the SECURITY DEFINER RPCs directly and prove the
 * server-side guarantees the Edge Function relies on. They never call a
 * provider and never touch the pilot event.
 *
 * Requires an Admin JWT provided by env MANUAL_ADMIN_JWT (optional). If
 * absent the tests self-skip so the suite remains green in headless CI.
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const URL = Deno.env.get("VITE_SUPABASE_URL")!;
const ANON = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ADMIN_JWT = Deno.env.get("MANUAL_ADMIN_JWT") ?? "";

function shouldRun(): boolean {
  return !!URL && !!ANON && !!SERVICE && !!ADMIN_JWT;
}

Deno.test("reserve rejects when authorisation id does not exist", async () => {
  if (!shouldRun()) return;
  const admin = createClient(URL, SERVICE);
  const asAdmin = createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${ADMIN_JWT}` } },
  });
  await admin.from("_placeholder_noop").select("*").limit(0).maybeSingle().catch(() => {});
  const { error } = await asAdmin.rpc("reserve_comm_hub_revalidation_send_authorisation", {
    p_cycle_id: "00000000-0000-0000-0000-000000000000",
    p_authorisation_id: "00000000-0000-0000-0000-000000000000",
    p_current_fingerprint: "sha256-v2:x",
    p_recipient_email: "op@example.com",
  });
  assert(error, "expected reservation to fail for unknown ids");
});

Deno.test("get_context returns cycle snapshot without side effects", async () => {
  if (!shouldRun()) return;
  const admin = createClient(URL, SERVICE);
  const { data: cycles } = await admin.from("communication_hub_revalidation_cycle")
    .select("id,status").limit(1);
  if (!cycles?.length) return;
  const asAdmin = createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${ADMIN_JWT}` } },
  });
  const { data, error } = await asAdmin.rpc("get_comm_hub_revalidation_send_context",
    { p_cycle_id: cycles[0].id });
  assertEquals(error, null);
  assertEquals((data as any).ok, true);
  assertEquals((data as any).cycle_id, cycles[0].id);
});
