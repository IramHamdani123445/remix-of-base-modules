// Omni-Comms Slice 2c-i — Trusted Runtime Boundary (Deno edge function).
//
// This is the ONLY authorised server-side entrypoint for the runtime
// pipeline. The public façade at src/platform/omni-comms/sendCommunication.ts
// delegates here through the internal transport. This function:
//
//   1. Authenticates the caller via JWT (getClaims).
//   2. Validates minimal request shape.
//   3. Canonicalizes the request server-side.
//   4. Computes the SHA-256 fingerprint server-side.
//   5. If the caller supplied an optional clientFingerprint, compares it
//      to the server fingerprint and rejects on mismatch as
//      `canonical_fingerprint_mismatch`.
//   6. Invokes the SECURITY DEFINER RPC
//      public.omni_comms_priv_send_communication via service_role,
//      passing the SERVER fingerprint (never any caller-supplied value).
//   7. Returns only the bounded SendCommunicationResult.
//
// Slice 2c-i scope: request persistence + idempotency only (Slice 2b
// runtime behaviour), now enforced through the trusted boundary. The
// full resolution / rendering / mode-aware persistence pipeline arrives
// in 2c-ii and 2c-iii and remains bounded by this same function.
//
// No provider SDK, no email dispatch, no queue consumer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  canonicalizeRequest,
  CanonicalizationError,
  computeRequestFingerprint,
} from "./canonicalize.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-correlation-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OMNI_COMMS_DEFAULT_CALLER_MODULE = "OMNI_COMMS_DIRECT";
const BUILD_TAG = "omni-comms-runtime@2c-i";

type Mode = "dry_run" | "shadow" | "queued";

interface PublicResult {
  requestId: string;
  idempotencyKey: string;
  mode: Mode;
  status: string;
  recipients: unknown[];
  messages: unknown[];
  blockers: string[];
  createdAt: string;
  replayed: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function blocked(
  input: Record<string, unknown> | null,
  blocker: string,
  status = 200,
): Response {
  return json(
    {
      requestId: "",
      idempotencyKey: (input?.idempotencyKey as string) ?? "",
      mode: (input?.mode as Mode) ?? "dry_run",
      status: "blocked",
      recipients: [],
      messages: [],
      blockers: [blocker],
      createdAt: new Date(0).toISOString(),
      replayed: false,
    } satisfies PublicResult,
    status,
  );
}

/** Map an RPC error object into a bounded controlled blocker code. */
function mapRpcErrorToCode(raw: {
  message?: string;
  details?: string;
  code?: string;
} | null | undefined): string {
  if (!raw) return "runtime_persistence_failed";
  const text = `${raw.message ?? ""} ${raw.details ?? ""}`;
  const slugMatch = text.match(/OC\d{3}\s+([a-z_]+)/);
  if (slugMatch) return slugMatch[1];
  const codeMatch = text.match(/\bOC(\d{3})\b/);
  if (codeMatch) {
    const c = codeMatch[1];
    if (c === "401") return "authentication_required";
    if (c === "403") return "permission_denied";
    if (c === "404") return "event_code_not_found";
    if (c === "409") return "idempotency_payload_mismatch";
    if (c === "422") return "invalid_input";
  }
  return "runtime_persistence_failed";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return blocked(null, "invalid_input", 405);
  }

  // 1. Authenticate caller — JWT is required.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return blocked(null, "authentication_required", 401);
  }
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await anon.auth.getClaims(token);
  if (claimsError || !claimsData?.claims?.sub) {
    return blocked(null, "authentication_required", 401);
  }
  const userId = claimsData.claims.sub as string;

  // 2. Parse body — controlled failure on malformed JSON.
  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return blocked(null, "invalid_input", 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return blocked(null, "invalid_input", 400);
  }

  // 3. Extract optional caller-supplied fingerprint (never trusted).
  const clientFingerprint =
    typeof input.clientFingerprint === "string"
      ? (input.clientFingerprint as string).toLowerCase()
      : null;

  // 4. Canonicalize + fingerprint server-side. The server value is
  //    authoritative; any caller-supplied value is only used for a
  //    disagreement check.
  let canonical;
  try {
    canonical = canonicalizeRequest(input);
  } catch (err) {
    if (err instanceof CanonicalizationError) {
      return blocked(input, err.code);
    }
    return blocked(input, "invalid_input");
  }

  // 5. Public-shape idempotency-key validation before the RPC.
  const idempotencyKey = typeof input.idempotencyKey === "string"
    ? input.idempotencyKey
    : "";
  if (!idempotencyKey || idempotencyKey.length < 8) {
    return blocked(input, "idempotency_key_required");
  }
  if (idempotencyKey.length > 200) {
    return blocked(input, "idempotency_key_too_long");
  }
  if (!["dry_run", "shadow", "queued"].includes(canonical.mode)) {
    return blocked(input, "mode_invalid");
  }

  const serverFingerprint = await computeRequestFingerprint(canonical);

  // 6. False-fingerprint rejection.
  if (clientFingerprint && clientFingerprint !== serverFingerprint) {
    return blocked(input, "canonical_fingerprint_mismatch");
  }

  // 7. Persistence via service_role.
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const callerModule = canonical.callerContext.moduleCode ??
    OMNI_COMMS_DEFAULT_CALLER_MODULE;
  const correlationId =
    typeof input.correlationId === "string" && input.correlationId.trim() !== ""
      ? (input.correlationId as string).trim()
      : null;

  const { data, error } = await admin.rpc(
    "omni_comms_priv_send_communication",
    {
      p_actor_id: userId,
      p_organization_id: canonical.organizationId,
      p_department_id: canonical.departmentId,
      p_event_code: canonical.eventCode,
      p_mode: canonical.mode,
      p_idempotency_key: idempotencyKey,
      p_caller_module_code: callerModule,
      p_caller_entity_type: canonical.callerContext.entityType,
      p_caller_entity_id: canonical.callerContext.entityId,
      p_correlation_id: correlationId,
      p_request_fingerprint: serverFingerprint,
      p_payload: canonical.payload,
      p_requested_channels: canonical.requestedChannels,
    },
  );

  if (error) {
    console.log(
      `[${BUILD_TAG}] rpc_error code=${(error as { code?: string }).code ?? ""}`,
    );
    return blocked(input, mapRpcErrorToCode(error));
  }

  const row = data as {
    request_id: string;
    idempotency_key: string;
    mode: Mode;
    status: string;
    created_at: string;
    replayed: boolean;
  } | null;

  if (!row || typeof row !== "object" || !row.request_id) {
    return blocked(input, "runtime_persistence_failed");
  }

  return json({
    requestId: row.request_id,
    idempotencyKey: row.idempotency_key,
    mode: row.mode,
    status: row.status,
    recipients: [],
    messages: [],
    blockers: ["runtime_resolution_pending"],
    createdAt: row.created_at,
    replayed: row.replayed === true,
  } satisfies PublicResult);
});
