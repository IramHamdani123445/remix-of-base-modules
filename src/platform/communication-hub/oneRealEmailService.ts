/**
 * Stage 6 — Send One Real Email service (Slice 2).
 *
 * Thin, strict client for the `comm-hub-send-one-real-email` Edge Function.
 * Responsibilities:
 *   - obtain an action-ready authenticated session (5-minute validity window)
 *   - invoke the Edge Function with the mandatory envelope (action, phrase, ids)
 *   - preserve one idempotency key per logical execution
 *   - normalise the `one-real-email.v1` envelope into camelCase
 *   - NEVER convert absent evidence, HTTP 200, or missing certification into success
 *
 * Business success is derived from `envelope.status` + `envelope.passed`, NOT
 * from HTTP status. A 200 with status=BLOCKED is a failure.
 */
import { supabase } from "@/integrations/supabase/client";
import { getActionReadySession } from "./authSession";

const CONFIRMATION_PHRASE = "SEND ONE REAL EMAIL" as const;
const ACTION = "SEND_ONE_REAL_EMAIL" as const;
const EDGE_FUNCTION = "comm-hub-send-one-real-email" as const;

export type OneRealEmailStatus =
  | "BLOCKED"
  | "PROVIDER_REJECTED"
  | "PROVIDER_ACCEPTED"
  | "DELIVERY_PENDING"
  | "FAILED";

export interface OneRealEmailBlocker {
  code: string;
  stage: string;
  message?: string;
  detail?: unknown;
}

export interface OneRealEmailEnvelope {
  schemaVersion: "one-real-email.v1";
  runtimeBuild: string;
  action: typeof ACTION;
  status: OneRealEmailStatus;
  passed: boolean;
  message: string;
  idempotentReplay: boolean;
  executionId: string | null;
  grantId: string | null;
  grantStatus: string | null;
  requestId: string | null;
  requestNumber: string | null;
  messageId: string | null;
  deliveryAttemptId: string | null;
  traceId: string | null;
  providerCallAttempted: boolean;
  providerName: string | null;
  providerStatus: string | null;
  providerMessageId: string | null;
  providerMode: "real" | "inactive";
  sendContext: "REAL_EMAIL";
  realEmailAuthorised: boolean;
  certificationId: string | null;
  certificationKind: "ONE_REAL_EMAIL" | null;
  certificationStatus: string | null;
  retrySafe: boolean;
  reconciliationRequired: boolean;
  cleanupProven: boolean;
  failureStage: string | null;
  blockers: OneRealEmailBlocker[];
  warnings: Array<Record<string, unknown>>;
  startedAt: string;
  completedAt: string | null;
  providerRedacted: Record<string, unknown> | null;
  httpStatus: number;
}

export interface OneRealEmailInvocation {
  moduleCode: string;
  eventCode: string;
  channel: string;
  recipient: string;
  previewSnapshotId: string | null;
  previewApprovalId: string;
  dryRunCertificationId: string;
  controlledStubCertificationId: string;
  recipientSetHash: string;
  configurationVersion: number | null;
  recipientPolicyVersion: number | null;
  idempotencyKey: string;
  reason: string;
}

function emptyEnvelope(httpStatus: number, startedAt: string): OneRealEmailEnvelope {
  return {
    schemaVersion: "one-real-email.v1",
    runtimeBuild: "unavailable",
    action: ACTION,
    status: "FAILED",
    passed: false,
    message: "",
    idempotentReplay: false,
    executionId: null,
    grantId: null,
    grantStatus: null,
    requestId: null,
    requestNumber: null,
    messageId: null,
    deliveryAttemptId: null,
    traceId: null,
    providerCallAttempted: false,
    providerName: null,
    providerStatus: null,
    providerMessageId: null,
    providerMode: "inactive",
    sendContext: "REAL_EMAIL",
    realEmailAuthorised: false,
    certificationId: null,
    certificationKind: null,
    certificationStatus: null,
    retrySafe: false,
    reconciliationRequired: false,
    cleanupProven: false,
    failureStage: "client_transport",
    blockers: [],
    warnings: [],
    startedAt,
    completedAt: new Date().toISOString(),
    providerRedacted: null,
    httpStatus,
  };
}

/** Normalise the server `one-real-email.v1` snake_case envelope to camelCase. */
export function normaliseOneRealEmailEnvelope(
  raw: any,
  httpStatus: number,
  fallbackStartedAt: string,
): OneRealEmailEnvelope {
  if (!raw || typeof raw !== "object" || raw.schema_version !== "one-real-email.v1") {
    const env = emptyEnvelope(httpStatus, fallbackStartedAt);
    env.blockers.push({
      code: "envelope_schema_mismatch",
      stage: "client_transport",
      message: "Edge Function did not return a one-real-email.v1 envelope.",
    });
    return env;
  }
  const status: OneRealEmailStatus = raw.status ?? "FAILED";
  return {
    schemaVersion: "one-real-email.v1",
    runtimeBuild:
      typeof raw.runtime_build === "string" ? raw.runtime_build : "unavailable",
    action: ACTION,
    status,
    // Never derive `passed` from anything other than the server field.
    passed: raw.passed === true,
    message: typeof raw.message === "string" ? raw.message : "",
    idempotentReplay: raw.idempotent_replay === true,
    executionId: raw.execution_id ?? null,
    grantId: raw.grant_id ?? null,
    grantStatus: raw.grant_status ?? null,
    requestId: raw.request_id ?? null,
    requestNumber: raw.request_number ?? null,
    messageId: raw.message_id ?? null,
    deliveryAttemptId: raw.delivery_attempt_id ?? null,
    traceId: raw.trace_id ?? null,
    providerCallAttempted: raw.provider_call_attempted === true,
    providerName: raw.provider_name ?? null,
    providerStatus: raw.provider_status ?? null,
    providerMessageId: raw.provider_message_id ?? null,
    providerMode: raw.provider_mode === "real" ? "real" : "inactive",
    sendContext: "REAL_EMAIL",
    realEmailAuthorised: raw.real_email_authorised === true,
    certificationId: raw.certification_id ?? null,
    certificationKind: raw.certification_kind ?? null,
    certificationStatus: raw.certification_status ?? null,
    retrySafe: raw.retry_safe === true,
    reconciliationRequired: raw.reconciliation_required === true,
    cleanupProven: raw.cleanup_proven === true,
    failureStage: raw.failure_stage ?? null,
    blockers: Array.isArray(raw.blockers) ? raw.blockers : [],
    warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
    startedAt: typeof raw.started_at === "string" ? raw.started_at : fallbackStartedAt,
    completedAt: raw.completed_at ?? null,
    providerRedacted: raw.provider_redacted ?? null,
    httpStatus,
  };
}

export function generateOneRealEmailIdempotencyKey(
  moduleCode: string,
  eventCode: string,
  channel: string,
): string {
  const nonce =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `stage6::${moduleCode}::${eventCode}::${channel}::${nonce}`;
}

export const ONE_REAL_EMAIL_CONFIRMATION_PHRASE = CONFIRMATION_PHRASE;

/**
 * Invoke the Stage 6 Edge Function.
 *
 * Callers MUST hold a stable idempotency key for the logical execution; a
 * retry of the same logical send MUST reuse the key so the server can replay.
 * A new user-initiated run MUST use a new key from
 * `generateOneRealEmailIdempotencyKey`.
 */
export async function invokeSendOneRealEmail(
  input: OneRealEmailInvocation,
): Promise<OneRealEmailEnvelope> {
  const startedAt = new Date().toISOString();
  // Fresh, verified operator session — the Edge Function itself pins the JWT
  // to the operator identity, but we still guarantee ≥5 minutes of validity.
  const { session } = await getActionReadySession({ minValiditySeconds: 300 });
  const backend = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = `${backend}/functions/v1/${EDGE_FUNCTION}`;
  const payload = {
    action: ACTION,
    confirmation: CONFIRMATION_PHRASE,
    moduleCode: input.moduleCode,
    eventCode: input.eventCode,
    channel: input.channel,
    recipient: input.recipient,
    cc: [],
    bcc: [],
    previewSnapshotId: input.previewSnapshotId,
    previewApprovalId: input.previewApprovalId,
    dryRunCertificationId: input.dryRunCertificationId,
    controlledStubCertificationId: input.controlledStubCertificationId,
    recipientSetHash: input.recipientSetHash,
    configurationVersion: input.configurationVersion,
    recipientPolicyVersion: input.recipientPolicyVersion,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
  };
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const env = emptyEnvelope(0, startedAt);
    env.blockers.push({
      code: "network_error",
      stage: "client_transport",
      message: e instanceof Error ? e.message : String(e),
    });
    return env;
  }
  const httpStatus = response.status;
  let raw: any = null;
  try {
    raw = await response.json();
  } catch {
    const env = emptyEnvelope(httpStatus, startedAt);
    env.blockers.push({
      code: "invalid_json_response",
      stage: "client_transport",
      message: `HTTP ${httpStatus}: response body was not JSON.`,
    });
    return env;
  }
  // Even on non-200s the Edge Function may return a well-formed envelope; if
  // it does not, we synthesise one so callers always see the same shape.
  const envelope = normaliseOneRealEmailEnvelope(raw, httpStatus, startedAt);
  if (envelope.schemaVersion !== "one-real-email.v1") {
    envelope.blockers.push({
      code: `http_${httpStatus}`,
      stage: "client_transport",
      message: typeof raw?.error === "string" ? raw.error : `HTTP ${httpStatus}`,
    });
  }
  return envelope;
}

/**
 * Fetch the durable ONE_REAL_EMAIL certification (post-send).
 * Uses the security-definer `get_controlled_live_certification` RPC and
 * confirms `certification_kind='ONE_REAL_EMAIL'` — a CONTROLLED_STUB
 * certification is NEVER treated as a Stage 6 result.
 */
export interface OneRealEmailCertificationRow {
  id: string;
  status: string;
  certificationKind: string;
  providerStatus: string | null;
  providerMessageId: string | null;
  providerOutcome: string | null;
  traceId: string | null;
  requestId: string | null;
  messageId: string | null;
  deliveryAttemptId: string | null;
  manualVerificationStatus: string | null;
  manualVerifiedRecipient: string | null;
  manualVerifiedBy: string | null;
  manualVerifiedAt: string | null;
  manualVerificationNote: string | null;
}

/**
 * Reads a ONE_REAL_EMAIL certification via the security-definer RPC
 * `get_controlled_live_certification`. Direct table access is not used so
 * that RLS + role-scope stay authoritative on the server. Returns null when
 * the certification does not exist OR is not of kind ONE_REAL_EMAIL.
 */
export async function fetchOneRealEmailCertification(
  certificationId: string,
): Promise<OneRealEmailCertificationRow | null> {
  const { data, error } = await (supabase as any).rpc(
    "get_controlled_live_certification",
    { p_certification_id: certificationId },
  );
  if (error) throw new Error(error.message ?? "certification lookup failed");
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return null;
  const r = rows[0] as any;
  if (r.certification_kind !== "ONE_REAL_EMAIL") return null;
  return {
    id: r.id,
    status: r.status,
    certificationKind: r.certification_kind,
    providerStatus: r.provider_status ?? null,
    providerMessageId: r.provider_message_id ?? null,
    providerOutcome: r.provider_outcome ?? null,
    traceId: r.trace_id ?? null,
    requestId: r.request_id ?? null,
    messageId: r.message_id ?? null,
    deliveryAttemptId: r.delivery_attempt_id ?? null,
    manualVerificationStatus: r.manual_verification_status ?? null,
    manualVerifiedRecipient: r.manual_verification_recipient ?? null,
    manualVerifiedBy: r.manual_verified_by ?? null,
    manualVerifiedAt: r.manual_verified_at ?? null,
    manualVerificationNote: r.manual_verification_note ?? null,
  };
}
