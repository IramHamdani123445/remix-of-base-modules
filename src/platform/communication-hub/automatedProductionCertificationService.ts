/**
 * Client for `certify_comm_hub_event_automated_production`.
 * Requires the CERTIFY AUTOMATED PRODUCTION typed phrase; server verifies
 * fresh readiness evidence, drift, config version, and manual observations.
 */
import { supabase } from "@/integrations/supabase/client";

export const AUTOMATED_CERTIFY_TYPED_PHRASE = "CERTIFY AUTOMATED PRODUCTION";
export const AUTOMATED_ACTIVATE_TYPED_PHRASE = "ACTIVATE AUTOMATED PRODUCTION";
export const AUTOMATED_ARM_TYPED_PHRASE = "ARM AUTOMATED PRODUCTION";

export interface CertifyAutomatedInput {
  moduleCode: string;
  eventCode: string;
  channel?: string;
  reason: string;
  typedConfirmation: string;
}

export async function certifyEventAutomatedProduction(
  input: CertifyAutomatedInput,
): Promise<{ ok: boolean; idempotent?: boolean; status: string; certification_row_id: string }> {
  const { data, error } = await (supabase as any).rpc(
    "certify_comm_hub_event_automated_production",
    {
      p_payload: {
        module_code: input.moduleCode,
        event_code: input.eventCode,
        channel: input.channel ?? "email",
        reason: input.reason,
        typed_confirmation: input.typedConfirmation,
      },
    },
  );
  if (error) throw new Error(error.message ?? "certify_comm_hub_event_automated_production failed");
  return data as any;
}
