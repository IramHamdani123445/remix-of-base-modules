/**
 * Real-email feature-gate client (Stage 6).
 *
 * Reads the `communication_hub_real_email_gate` row for a lineage and calls
 * the audited `set_comm_hub_real_email_gate(p_module,p_event,p_channel,
 * p_enabled,p_reason)` RPC to open or close it. Every call requires a reason
 * and is audited server-side.
 */
import { supabase } from "@/integrations/supabase/client";

export interface RealEmailGateState {
  moduleCode: string;
  eventCode: string;
  channel: string;
  enabled: boolean;
  openedAt: string | null;
  openedBy: string | null;
  reason: string | null;
  closedAt: string | null;
  closedBy: string | null;
  present: boolean;
}

export async function fetchRealEmailGate(input: {
  moduleCode: string;
  eventCode: string;
  channel: string;
}): Promise<RealEmailGateState> {
  const { data, error } = await (supabase as any)
    .from("communication_hub_real_email_gate")
    .select("module_code,event_code,channel,enabled,opened_at,opened_by,reason,closed_at,closed_by")
    .eq("module_code", input.moduleCode)
    .eq("event_code", input.eventCode)
    .eq("channel", input.channel)
    .maybeSingle();
  if (error && (error as any).code !== "PGRST116") throw new Error(error.message);
  if (!data) {
    return {
      moduleCode: input.moduleCode,
      eventCode: input.eventCode,
      channel: input.channel,
      enabled: false,
      openedAt: null,
      openedBy: null,
      reason: null,
      closedAt: null,
      closedBy: null,
      present: false,
    };
  }
  return {
    moduleCode: data.module_code,
    eventCode: data.event_code,
    channel: data.channel,
    enabled: !!data.enabled,
    openedAt: data.opened_at ?? null,
    openedBy: data.opened_by ?? null,
    reason: data.reason ?? null,
    closedAt: data.closed_at ?? null,
    closedBy: data.closed_by ?? null,
    present: true,
  };
}

export async function setRealEmailGate(input: {
  moduleCode: string;
  eventCode: string;
  channel: string;
  enabled: boolean;
  reason: string;
}): Promise<RealEmailGateState> {
  if (!input.reason || input.reason.trim().length < 8) {
    throw new Error("A reason of at least 8 characters is required to change the real-email gate.");
  }
  const { error } = await (supabase as any).rpc("set_comm_hub_real_email_gate", {
    p_module: input.moduleCode,
    p_event: input.eventCode,
    p_channel: input.channel,
    p_enabled: input.enabled,
    p_reason: input.reason.trim(),
  });
  if (error) throw new Error(error.message ?? "set_comm_hub_real_email_gate failed");
  return fetchRealEmailGate(input);
}
