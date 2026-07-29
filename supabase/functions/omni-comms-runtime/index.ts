// Omni-Comms Runtime — Slice 2c-ii Batch B trusted boundary.
//
// End-to-end pipeline:
//   1. Authenticate caller via JWT.
//   2. Canonicalize + fingerprint server-side (Slice 2c-i).
//   3. Persist request through the SECURITY DEFINER RPC
//      omni_comms_priv_send_communication.
//   4. New request → fetch aggregate snapshot via
//      omni_comms_priv_runtime_resolution_snapshot (service_role), run the
//      Batch B resolver pipeline, then finalize via
//      omni_comms_priv_finalize_resolution.
//   5. Replay → load persisted resolution via
//      omni_comms_priv_load_persisted_resolution.
// Return only bounded, PII-safe projections. No provider is contacted.
// No message / dispatch_job / delivery_attempt rows are created.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  canonicalizeRequest,
  CanonicalizationError,
  computeRequestFingerprint,
} from "./canonicalize.ts";
import {
  orchestrateResolution,
  recipientEligibilityStatus,
  validateSnapshotShape,
} from "./resolution/snapshotOrchestrator.ts";
import type { RecipientInput } from "./resolution/resolutionTypes.ts";
import { RuntimeResolutionError } from "./resolution/runtimeResolutionErrors.ts";

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
const BUILD_TAG = "omni-comms-runtime@2c-ii-b";

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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return blocked(null, "invalid_input", 405);

  // 1. Auth.
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

  // 2. Body.
  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return blocked(null, "invalid_input", 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return blocked(null, "invalid_input", 400);
  }

  const clientFingerprint = typeof input.clientFingerprint === "string"
    ? (input.clientFingerprint as string).toLowerCase()
    : null;

  let canonical;
  try {
    canonical = canonicalizeRequest(input);
  } catch (err) {
    if (err instanceof CanonicalizationError) return blocked(input, err.code);
    return blocked(input, "invalid_input");
  }

  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey : "";
  if (!idempotencyKey || idempotencyKey.length < 8) return blocked(input, "idempotency_key_required");
  if (idempotencyKey.length > 200) return blocked(input, "idempotency_key_too_long");
  if (!["dry_run", "shadow", "queued"].includes(canonical.mode)) {
    return blocked(input, "mode_invalid");
  }

  const serverFingerprint = await computeRequestFingerprint(canonical);
  if (clientFingerprint && clientFingerprint !== serverFingerprint) {
    return blocked(input, "canonical_fingerprint_mismatch");
  }

  // 3. Persistence.
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const callerModule = canonical.callerContext.moduleCode ?? OMNI_COMMS_DEFAULT_CALLER_MODULE;
  const correlationId = typeof input.correlationId === "string" && input.correlationId.trim() !== ""
    ? (input.correlationId as string).trim()
    : null;

  const { data: sendData, error: sendError } = await admin.rpc(
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

  if (sendError) {
    console.log(`[${BUILD_TAG}] send_rpc_error code=${(sendError as { code?: string }).code ?? ""}`);
    return blocked(input, mapRpcErrorToCode(sendError));
  }

  const row = sendData as {
    request_id: string;
    idempotency_key: string;
    mode: Mode;
    status: string;
    created_at: string;
    replayed: boolean;
  } | null;

  if (!row?.request_id) return blocked(input, "runtime_persistence_failed");

  // 4. Replay path: load persisted resolution + return.
  if (row.replayed === true) {
    const { data: loaded, error: loadErr } = await admin.rpc(
      "omni_comms_priv_load_persisted_resolution",
      {
        p_actor_id: userId,
        p_request_id: row.request_id,
        p_organization_id: canonical.organizationId,
      },
    );
    if (loadErr) {
      return blocked(input, mapRpcErrorToCode(loadErr));
    }
    return json(buildReplayResponse(row, loaded));
  }

  // 5. Fresh resolution.
  const { data: snapData, error: snapErr } = await admin.rpc(
    "omni_comms_priv_runtime_resolution_snapshot",
    {
      p_actor_id: userId,
      p_organization_id: canonical.organizationId,
      p_department_id: canonical.departmentId,
      p_event_code: canonical.eventCode,
      p_requested_channels: canonical.requestedChannels ?? null,
    },
  );
  if (snapErr) {
    console.log(`[${BUILD_TAG}] snapshot_rpc_error`);
    return finalizeBlocked(admin, userId, row, canonical, mapRpcErrorToCode(snapErr));
  }

  let snapshot;
  try {
    snapshot = validateSnapshotShape(snapData);
  } catch {
    return finalizeBlocked(admin, userId, row, canonical, "resolution_snapshot_invalid");
  }

  const inputRecipients = Array.isArray(input.recipients)
    ? (input.recipients as RecipientInput[])
    : [];

  let result;
  try {
    result = await orchestrateResolution({
      snapshot,
      organizationId: canonical.organizationId,
      departmentId: canonical.departmentId,
      requestedChannels: canonical.requestedChannels ?? [],
      payload: canonical.payload,
      recipients: inputRecipients,
      mode: canonical.mode,
    });
  } catch (err) {
    const code = err instanceof RuntimeResolutionError ? err.code : "runtime_persistence_failed";
    return finalizeBlocked(admin, userId, row, canonical, code);
  }

  // Build finalize payload.
  const anyRenderable = result.recipients.some((r) => r.resolvedChannels.length > 0);
  const finalStatus = anyRenderable && result.blockers.length === 0 ? "processing" : "blocked";

  const requestBlockers = [...result.blockers];
  if (finalStatus === "processing") requestBlockers.push("runtime_rendering_pending");

  const finalizeRecipients = result.recipients.map((r) => {
    const status = recipientEligibilityStatus(r);
    return {
      recipient_type: r.recipientType,
      recipient_reference: r.recipientReference,
      display_name: r.displayName,
      locale: r.normalizedLocale,
      email_destination: r.normalizedDestinations.email,
      phone_destination: r.normalizedDestinations.phone,
      push_destination: r.normalizedDestinations.push,
      destination_snapshot: r.normalizedDestinations,
      eligibility_status: status,
      resolved_channels: r.resolvedChannels,
      blockers: r.blockers,
      per_recipient_snapshot: {
        fingerprint: r.fingerprint,
        input_index: r.inputIndex,
        channel_resolutions: r.channelResolutions.map((c) => ({
          channel: c.channel,
          route_id: c.eventRouteId,
          template_family_id: c.templateFamilyId ?? null,
          template_family_scope: c.templateFamilyScope ?? null,
          template_version_id: c.templateVersionId ?? null,
          template_version_number: c.templateVersionNumber ?? null,
          template_version_checksum: c.templateVersionChecksum ?? null,
          layout_id: c.layoutId ?? null,
          layout_version_id: c.layoutVersionId ?? null,
          layout_inheritance: c.layoutInheritance ?? null,
          layout_checksum: c.layoutChecksum ?? null,
          assets: c.assets.map((a) => ({
            slot: a.slot,
            required: a.required,
            asset_id: a.assetId,
            asset_version_id: a.assetVersionId,
            asset_type: a.assetType,
            asset_checksum: a.assetChecksum,
            inheritance_source: a.inheritanceSource,
          })),
          sender_identity_id: c.senderIdentityId ?? null,
          sender_provider_binding_id: c.senderProviderBindingId ?? null,
          provider_id: c.providerId ?? null,
          provider_account_id: c.providerAccountId ?? null,
          sender_channel_ready: c.senderChannelReady,
          live_delivery_ready: c.liveDeliveryReady,
          blockers: c.blockers,
        })),
      },
    };
  });

  const { data: finData, error: finErr } = await admin.rpc(
    "omni_comms_priv_finalize_resolution",
    {
      p_actor_id: userId,
      p_request_id: row.request_id,
      p_organization_id: canonical.organizationId,
      p_resolution_snapshot: {
        snapshot_at: snapshot.snapshot_at,
        event_definition_id: result.event.eventDefinitionId,
        event_contract_id: result.event.eventContractId,
        event_contract_version: result.event.eventContractVersion,
        event_contract_checksum: result.event.eventContractChecksum,
        requested_channels: result.requestedChannels,
      },
      p_recipients: finalizeRecipients,
      p_request_blockers: requestBlockers,
      p_final_status: finalStatus,
    },
  );
  if (finErr) {
    console.log(`[${BUILD_TAG}] finalize_error`);
    return blocked(input, mapRpcErrorToCode(finErr));
  }

  return json(buildResolvedResponse(row, finData, result, requestBlockers));
});

function projectRecipients(result: {
  recipients: Array<{
    inputIndex: number;
    recipientReference: string | null;
    resolvedChannels: string[];
    blockers: string[];
    channelResolutions: Array<{ senderChannelReady: boolean; liveDeliveryReady: boolean; blockers: string[] }>;
  }>;
}) {
  return result.recipients.map((r) => ({
    inputIndex: r.inputIndex,
    recipientReference: r.recipientReference,
    resolvedChannels: r.resolvedChannels,
    blockers: r.blockers,
    eligibilityStatus:
      r.blockers.includes("recipient_destination_invalid")
        ? "invalid"
        : r.resolvedChannels.length === 0
          ? "blocked"
          : r.resolvedChannels.length < r.channelResolutions.length
            ? "partially_eligible"
            : "eligible",
  }));
}

function buildResolvedResponse(
  row: { request_id: string; idempotency_key: string; mode: Mode; created_at: string },
  finData: unknown,
  result: Parameters<typeof projectRecipients>[0],
  requestBlockers: string[],
) {
  const fin = (finData ?? {}) as { status?: string };
  return {
    requestId: row.request_id,
    idempotencyKey: row.idempotency_key,
    mode: row.mode,
    status: fin.status ?? "processing",
    recipients: projectRecipients(result),
    messages: [],
    blockers: requestBlockers,
    createdAt: row.created_at,
    replayed: false,
  } satisfies PublicResult;
}

function buildReplayResponse(
  row: { request_id: string; idempotency_key: string; mode: Mode; status: string; created_at: string },
  loaded: unknown,
): PublicResult {
  const l = (loaded ?? {}) as { recipients?: unknown[]; blockers?: unknown };
  const recipients = Array.isArray(l.recipients) ? l.recipients : [];
  const projected = recipients.map((rec, i) => {
    const r = rec as Record<string, unknown>;
    const rc = Array.isArray(r.resolved_channels) ? (r.resolved_channels as string[]) : [];
    const bl = Array.isArray(r.blockers) ? (r.blockers as string[]) : [];
    return {
      inputIndex: typeof r.input_index === "number" ? (r.input_index as number) : i,
      recipientReference: (r.recipient_reference as string | null) ?? null,
      resolvedChannels: rc,
      blockers: bl,
      eligibilityStatus: (r.eligibility_status as string) ?? "eligible",
    };
  });
  const blockers = Array.isArray(l.blockers) ? (l.blockers as string[]) : [];
  return {
    requestId: row.request_id,
    idempotencyKey: row.idempotency_key,
    mode: row.mode,
    status: row.status,
    recipients: projected,
    messages: [],
    blockers,
    createdAt: row.created_at,
    replayed: true,
  };
}

async function finalizeBlocked(
  admin: ReturnType<typeof createClient>,
  actorId: string,
  row: { request_id: string; idempotency_key: string; mode: Mode; created_at: string },
  canonical: { organizationId: string },
  blocker: string,
): Promise<Response> {
  await admin.rpc("omni_comms_priv_finalize_resolution", {
    p_actor_id: actorId,
    p_request_id: row.request_id,
    p_organization_id: canonical.organizationId,
    p_resolution_snapshot: { snapshot_at: new Date().toISOString(), abort_reason: blocker },
    p_recipients: [],
    p_request_blockers: [blocker],
    p_final_status: "blocked",
  });
  return json({
    requestId: row.request_id,
    idempotencyKey: row.idempotency_key,
    mode: row.mode,
    status: "blocked",
    recipients: [],
    messages: [],
    blockers: [blocker],
    createdAt: row.created_at,
    replayed: false,
  } satisfies PublicResult);
}
