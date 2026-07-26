/**
 * Stage 6 — Manual inbox verification client.
 *
 * Delegates to `record_controlled_live_manual_verification(p_payload jsonb)`
 * on the server. The RPC independently re-verifies
 * `certification_kind='ONE_REAL_EMAIL'` — the client is not the authority.
 */
import { supabase } from "@/integrations/supabase/client";

export type ManualInboxVerificationDecision = "CONFIRMED" | "NOT_RECEIVED";

export interface ManualInboxVerificationResult {
  ok: boolean;
  idempotent: boolean;
  status: string;
  manualVerificationStatus: string | null;
  manualVerificationRecipient: string | null;
  manualVerifiedAt: string | null;
  certificationId: string;
}

export async function recordManualInboxVerification(input: {
  certificationId: string;
  decision: ManualInboxVerificationDecision;
  verifiedRecipient: string;
  note: string;
  receivedAt?: string;
}): Promise<ManualInboxVerificationResult> {
  if (!input.certificationId) throw new Error("certificationId is required");
  if (input.decision === "CONFIRMED" && !input.verifiedRecipient) {
    throw new Error("verifiedRecipient is required");
  }
  const received = input.decision === "CONFIRMED";
  const payload: Record<string, unknown> = {
    certification_id: input.certificationId,
    decision: input.decision,
    // Backward-compatible boolean for older server versions
    received,
    verified_recipient: input.verifiedRecipient,
    note: input.note ?? "",
    require_certification_kind: "ONE_REAL_EMAIL",
  };
  if (received) {
    payload.received_at = input.receivedAt ?? new Date().toISOString();
  }
  const { data, error } = await (supabase as any).rpc(
    "record_controlled_live_manual_verification",
    { p_payload: payload },
  );
  if (error) throw new Error(error.message ?? "manual verification RPC failed");
  const row = (data ?? {}) as any;
  return {
    ok: row.ok === true,
    idempotent: row.idempotent === true,
    status: row.status ?? "UNKNOWN",
    manualVerificationStatus: row.manual_verification_status ?? null,
    manualVerificationRecipient: row.manual_verification_recipient ?? null,
    manualVerifiedAt: row.manual_verified_at ?? null,
    certificationId: row.certification_id ?? input.certificationId,
  };
}
