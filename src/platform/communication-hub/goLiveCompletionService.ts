/**
 * Client for the server-authoritative Stage 9 completion RPC.
 * Never trust sessionStorage — the outcome comes from the server.
 */
import { supabase } from "@/integrations/supabase/client";
import type { EventGoLiveStatus } from "./eventGoLiveStatusService";

export type GoLiveOutcome =
  | "STAGE_6_COMPLETE"
  | "LIVE_MANUAL"
  | "LIVE_AUTOMATED_STANDBY"
  | "LIVE_AUTOMATED_ARMED"
  | "SUSPENDED"
  | "EMERGENCY_STOP"
  | "DRIFT_DETECTED"
  | "INCOMPLETE";

export interface GoLiveCompletion {
  outcome: GoLiveOutcome;
  is_stage9_complete: boolean;
  status: EventGoLiveStatus;
  evaluated_at: string;
}

export async function getGoLiveCompletion(input: {
  moduleCode: string;
  eventCode: string;
  channel?: string;
}): Promise<GoLiveCompletion> {
  const { data, error } = await (supabase as any).rpc(
    "get_comm_hub_go_live_completion",
    {
      p_module_code: input.moduleCode,
      p_event_code: input.eventCode,
      p_channel: input.channel ?? "email",
    },
  );
  if (error) throw new Error(error.message ?? "get_comm_hub_go_live_completion failed");
  return data as GoLiveCompletion;
}
