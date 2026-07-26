/**
 * Client for `certify_comm_hub_event_manual_production`.
 * The server derives every lineage field; the browser only supplies
 * module/event/channel, the ONE_REAL_EMAIL certification id, the reason,
 * and the typed confirmation phrase.
 */
import { supabase } from "@/integrations/supabase/client";

export const MANUAL_PRODUCTION_TYPED_PHRASE = "CERTIFY MANUAL PRODUCTION";

export interface CertifyManualProductionInput {
  moduleCode: string;
  eventCode: string;
  channel?: string;
  oneRealEmailCertificationId: string;
  reason: string;
  typedConfirmation: string;
}

export interface CertifyManualProductionResult {
  ok: boolean;
  idempotent?: boolean;
  status: "live_manual_only" | "live_cron_allowed";
  certification_row_id: string;
  derived?: Record<string, unknown>;
}

export async function certifyEventManualProduction(
  input: CertifyManualProductionInput,
): Promise<CertifyManualProductionResult> {
  const { data, error } = await (supabase as any).rpc(
    "certify_comm_hub_event_manual_production",
    {
      p_payload: {
        module_code: input.moduleCode,
        event_code: input.eventCode,
        channel: input.channel ?? "email",
        one_real_email_certification_id: input.oneRealEmailCertificationId,
        reason: input.reason,
        typed_confirmation: input.typedConfirmation,
      },
    },
  );
  if (error) throw new Error(error.message ?? "certify_comm_hub_event_manual_production failed");
  return data as CertifyManualProductionResult;
}

export interface CloseOneRealEmailGateInput {
  moduleCode: string;
  eventCode: string;
  channel?: string;
  reason: string;
}

export async function closeOneRealEmailGateAfterStage6(
  input: CloseOneRealEmailGateInput,
): Promise<{ ok: boolean; gate_closed: boolean }> {
  const { data, error } = await (supabase as any).rpc(
    "close_comm_hub_one_real_email_gate_after_stage6",
    {
      p_module_code: input.moduleCode,
      p_event_code: input.eventCode,
      p_channel: input.channel ?? "email",
      p_reason: input.reason,
    },
  );
  if (error) throw new Error(error.message ?? "close_comm_hub_one_real_email_gate_after_stage6 failed");
  return data as { ok: boolean; gate_closed: boolean };
}
