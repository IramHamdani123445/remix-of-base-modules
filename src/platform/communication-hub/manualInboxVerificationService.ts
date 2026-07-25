/**
 * Stage 6 — Manual inbox verification client.
 *
 * Delegates to `record_controlled_live_manual_verification(p_payload jsonb)`
 * on the server. The RPC independently re-verifies
 * `certification_kind='ONE_REAL_EMAIL'` — the client is not the authority.
 */
import { supabase } from "@/integrations/supabase/client";

export type ManualInboxVerificationDecision = "CONFIRMED" | "NOT_RECEIVED";

export async function recordManualInboxVerification(input: {
  certificationId: string;
  decision: ManualInboxVerificationDecision;
  verifiedRecipient: string;
  note: string;
}): Promise<{ ok: boolean; status: string; certificationId: string }> {
  if (!input.certificationId) throw new Error("certificationId is required");
  if (!input.verifiedRecipient) throw new Error("verifiedRecipient is required");
  const { data, error } = await (supabase as any).rpc(
    "record_controlled_live_manual_verification",
    {
      p_payload: {
        certification_id: input.certificationId,
        decision: input.decision,
        verified_recipient: input.verifiedRecipient,
        note: input.note ?? "",
        require_certification_kind: "ONE_REAL_EMAIL",
      },
    },
  );
  if (error) throw new Error(error.message ?? "manual verification RPC failed");
  const row = (data ?? {}) as any;
  return {
    ok: row.ok === true,
    status: row.status ?? "UNKNOWN",
    certificationId: row.certification_id ?? input.certificationId,
  };
}
