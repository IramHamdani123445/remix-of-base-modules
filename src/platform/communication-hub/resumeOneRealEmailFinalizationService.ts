/**
 * Stage 6 finalization RECOVERY client.
 *
 * Wraps the `comm-hub-resume-one-real-email-finalization` Edge Function.
 * This never sends an email. It only finalizes an already-sent execution
 * whose finalizer previously crashed (historical UUID/jsonb bug), returning
 * the resulting ONE_REAL_EMAIL certification for manual verification.
 */
import { getActionReadySession } from "./authSession";
import type {
  OneRealEmailCertificationRow,
} from "./oneRealEmailService";

const EDGE_FUNCTION = "comm-hub-resume-one-real-email-finalization" as const;

export interface ResumeOneRealEmailResult {
  ok: boolean;
  runtimeBuild: string;
  idempotent: boolean;
  resumed: boolean;
  certificationId: string | null;
  certificationStatus: string | null;
  providerOutcome: string | null;
  providerStatus: string | null;
  certification: OneRealEmailCertificationRow | null;
  error: string | null;
  detail: string | null;
  httpStatus: number;
  raw: any;
}

export async function resumeOneRealEmailFinalization(
  executionId: string,
): Promise<ResumeOneRealEmailResult> {
  const { session } = await getActionReadySession({ minValiditySeconds: 300 });
  const backend = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = `${backend}/functions/v1/${EDGE_FUNCTION}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ executionId }),
  });
  const httpStatus = response.status;
  let raw: any = null;
  try {
    raw = await response.json();
  } catch {
    /* ignore */
  }

  const cert = raw?.certification && typeof raw.certification === "object"
    ? mapCertification(raw.certification)
    : null;

  return {
    ok: raw?.ok === true,
    runtimeBuild:
      typeof raw?.runtime_build === "string" ? raw.runtime_build : "unavailable",
    idempotent: raw?.idempotent === true,
    resumed: raw?.resumed === true,
    certificationId: raw?.certification_id ?? null,
    certificationStatus: raw?.certification_status ?? null,
    providerOutcome: raw?.provider_outcome ?? null,
    providerStatus: raw?.provider_status ?? null,
    certification: cert,
    error: raw?.error ?? null,
    detail: raw?.detail ?? null,
    httpStatus,
    raw,
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
