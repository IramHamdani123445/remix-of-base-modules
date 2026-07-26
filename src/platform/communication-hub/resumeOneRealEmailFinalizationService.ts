/**
 * Stage 6 finalization RECOVERY client.
 *
 * Wraps the `comm-hub-resume-one-real-email-finalization` Edge Function.
 * This never sends an email. It only finalizes an already-sent execution
 * whose finalizer previously crashed, returning the resulting
 * ONE_REAL_EMAIL certification for manual verification.
 */
import { supabase } from "@/integrations/supabase/client";
import { getActionReadySession } from "./authSession";
import type { OneRealEmailCertificationRow } from "./oneRealEmailService";

const EDGE_FUNCTION = "comm-hub-resume-one-real-email-finalization" as const;
const RESUME_TIMEOUT_MS = 20_000;

export interface ResumeOneRealEmailResult {
  ok: boolean;
  runtimeBuild: string;
  idempotent: boolean;
  resumed: boolean;
  timedOut: boolean;
  traceInserted: boolean;
  certificationId: string | null;
  certificationStatus: string | null;
  providerOutcome: string | null;
  providerStatus: string | null;
  certification: OneRealEmailCertificationRow | null;
  error: string | null;
  detail: string | null;
  safeDetail: string | null;
  httpStatus: number;
  raw: unknown;
}

export interface OneRealEmailRecoveryStatus {
  executionId: string | null;
  providerCallAttempted: boolean | null;
  providerMessageId: string | null;
  grantId: string | null;
  grantStatus: string | null;
  messageId: string | null;
  messageStatus: string | null;
  deliveryAttemptId: string | null;
  attemptStatus: string | null;
  traceId: string | null;
  certificationId: string | null;
  certificationStatus: string | null;
  certificationKind: string | null;
  canResume: boolean;
  blockers: Array<{ code: string; stage: string; message?: string; detail?: unknown }>;
  raw: unknown;
}

export async function resumeOneRealEmailFinalization(
  executionId: string,
): Promise<ResumeOneRealEmailResult> {
  const { session } = await getActionReadySession({ minValiditySeconds: 300 });
  const backend = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = `${backend}/functions/v1/${EDGE_FUNCTION}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESUME_TIMEOUT_MS);
  let httpStatus = 0;
  let raw: any = null;
  let timedOut = false;
  let transportError: string | null = null;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ executionId }),
      signal: controller.signal,
    });
    httpStatus = response.status;
    try {
      raw = await response.json();
    } catch {
      raw = null;
    }
  } catch (e: any) {
    if (e?.name === "AbortError") {
      timedOut = true;
      transportError = `Resume request timed out after ${RESUME_TIMEOUT_MS / 1000}s.`;
    } else {
      transportError = e?.message ?? String(e);
    }
  } finally {
    clearTimeout(timer);
  }

  const cert =
    raw?.certification && typeof raw.certification === "object"
      ? mapCertification(raw.certification)
      : null;

  return {
    ok: raw?.ok === true,
    runtimeBuild:
      typeof raw?.runtime_build === "string" ? raw.runtime_build : "unavailable",
    idempotent: raw?.idempotent === true,
    resumed: raw?.resumed === true,
    timedOut,
    traceInserted: raw?.trace_inserted === true,
    certificationId: raw?.certification_id ?? null,
    certificationStatus: raw?.certification_status ?? null,
    providerOutcome: raw?.provider_outcome ?? null,
    providerStatus: raw?.provider_status ?? null,
    certification: cert,
    error: raw?.error ?? (transportError ? "transport_error" : null),
    detail: raw?.detail ?? transportError,
    safeDetail: raw?.safe_detail ?? null,
    httpStatus,
    raw,
  };
}

export async function fetchOneRealEmailRecoveryStatus(
  executionId: string,
): Promise<OneRealEmailRecoveryStatus> {
  const { data, error } = await (supabase as any).rpc(
    "get_comm_hub_one_real_email_recovery_status",
    { p_execution_id: executionId },
  );
  if (error) {
    return {
      executionId,
      providerCallAttempted: null,
      providerMessageId: null,
      grantId: null,
      grantStatus: null,
      messageId: null,
      messageStatus: null,
      deliveryAttemptId: null,
      attemptStatus: null,
      traceId: null,
      certificationId: null,
      certificationStatus: null,
      certificationKind: null,
      canResume: false,
      blockers: [
        { code: "recovery_status_rpc_failed", stage: "lookup", message: error.message },
      ],
      raw: null,
    };
  }
  const r = (data ?? {}) as any;
  return {
    executionId: r.execution_id ?? executionId,
    providerCallAttempted: r.provider_call_attempted ?? null,
    providerMessageId: r.provider_message_id ?? null,
    grantId: r.grant_id ?? null,
    grantStatus: r.grant_status ?? null,
    messageId: r.message_id ?? null,
    messageStatus: r.message_status ?? null,
    deliveryAttemptId: r.delivery_attempt_id ?? null,
    attemptStatus: r.attempt_status ?? null,
    traceId: r.trace_id ?? null,
    certificationId: r.certification_id ?? null,
    certificationStatus: r.certification_status ?? null,
    certificationKind: r.certification_kind ?? null,
    canResume: r.can_resume === true,
    blockers: Array.isArray(r.blockers) ? r.blockers : [],
    raw: r,
  };
}

function mapCertification(r: any): OneRealEmailCertificationRow | null {
  if (!r) return null;
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
