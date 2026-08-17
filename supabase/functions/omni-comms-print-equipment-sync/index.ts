// Omni-Comms Print — network printer discovery sync.
//
// Browsers cannot enumerate operating-system or network printers, so the
// governed equipment register is the only place a physical device can be
// named. This worker closes that gap for sites that run a print agent or a
// CUPS/IPP-Everywhere front end: it asks the registered discovery source for
// its available print queues and hands them to the database, which reconciles
// the register (adds new queues, refreshes known ones, retires queues that
// have disappeared).
//
// Boundaries:
//   * The caller only names WHICH registered source to sync. Endpoint,
//     credentials and tenancy come from the database row.
//   * The database RPC is the authority for what the register becomes.
//   * Nothing is printed here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-correlation-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_PRINTERS = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface DiscoveredPrinter {
  queue_name: string;
  display_name?: string;
  location?: string;
  device_uri?: string;
  device_type?: string;
  paper_sizes?: string[];
  duplex_capable?: boolean;
  colour_capable?: boolean;
  metadata?: Record<string, unknown>;
}

/** Accepts either `{ printers: [...] }` or a bare array; CUPS-ish keys mapped. */
function normalisePrinters(payload: unknown): DiscoveredPrinter[] {
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { printers?: unknown })?.printers)
      ? ((payload as { printers: unknown[] }).printers)
      : [];

  const out: DiscoveredPrinter[] = [];
  for (const entry of raw.slice(0, MAX_PRINTERS)) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const queue = String(
      row.queue_name ?? row.queue ?? row.name ?? row["printer-name"] ?? "",
    ).trim();
    if (!queue) continue;
    out.push({
      queue_name: queue.slice(0, 120),
      display_name: String(
        row.display_name ?? row["printer-info"] ?? row.description ?? queue,
      ).trim().slice(0, 200),
      location: row.location || row["printer-location"]
        ? String(row.location ?? row["printer-location"]).trim().slice(0, 200)
        : undefined,
      device_uri: row.device_uri || row["device-uri"] || row.uri
        ? String(row.device_uri ?? row["device-uri"] ?? row.uri).trim().slice(0, 300)
        : undefined,
      device_type: typeof row.device_type === "string" ? row.device_type : undefined,
      paper_sizes: Array.isArray(row.paper_sizes)
        ? (row.paper_sizes as unknown[]).map((s) => String(s).slice(0, 20)).slice(0, 12)
        : undefined,
      duplex_capable: typeof row.duplex_capable === "boolean" ? row.duplex_capable : undefined,
      colour_capable: typeof row.colour_capable === "boolean" ? row.colour_capable : undefined,
      metadata: row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : undefined,
    });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method === "GET" && new URL(req.url).pathname.endsWith("/health")) {
    return json({ function: "omni-comms-print-equipment-sync", available: true });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization) return json({ error: "unauthorized" }, 401);

  let body: { sourceId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const sourceId = String(body?.sourceId ?? "").trim();
  if (!UUID.test(sourceId)) return json({ error: "invalid_source_id" }, 400);

  // The caller's own JWT is used for the governed sync RPC, so the database
  // enforces the `configure` capability and tenant access for this operator.
  const asCaller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData } = await asCaller.auth.getUser();
  if (!userData?.user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: source, error: sourceError } = await admin
    .from("omni_comms_print_discovery_source")
    .select("id, endpoint_url, mode, status, auth_secret_ref")
    .eq("id", sourceId)
    .maybeSingle();

  if (sourceError) return json({ error: "source_lookup_failed", details: sourceError.message }, 500);
  if (!source) return json({ error: "print_discovery_source_not_found" }, 404);
  if (source.status !== "active") return json({ error: "print_discovery_source_inactive" }, 409);

  let printers: DiscoveredPrinter[] = [];
  let syncStatus = "ok";
  let detail: string | null = null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (source.auth_secret_ref) {
      const token = Deno.env.get(String(source.auth_secret_ref));
      if (!token) {
        throw new Error(`Configured credential ${source.auth_secret_ref} is not available.`);
      }
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(String(source.endpoint_url), {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Print agent responded ${response.status}: ${text.slice(0, 300)}`);
    }
    printers = normalisePrinters(await response.json());
    if (printers.length === 0) {
      syncStatus = "empty";
      detail = "The print agent reported no print queues.";
    }
  } catch (error) {
    syncStatus = "failed";
    detail = error instanceof Error ? error.message : "Print agent unreachable.";
  } finally {
    clearTimeout(timer);
  }

  const { data: result, error: rpcError } = await asCaller.rpc(
    "omni_comms_priv_print_equipment_sync",
    {
      p_source_id: sourceId,
      p_printers: printers,
      p_sync_status: syncStatus,
      p_detail: detail,
    },
  );

  if (rpcError) {
    return json({ error: "sync_rejected", details: rpcError.message }, 400);
  }

  return json({
    ok: syncStatus === "ok",
    status: syncStatus,
    detail,
    discovered: printers.length,
    result,
  }, syncStatus === "failed" ? 502 : 200);
});
