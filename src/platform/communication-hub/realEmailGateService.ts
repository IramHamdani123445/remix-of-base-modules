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
  const { data, error } = await (supabase as any).rpc("get_comm_hub_real_email_gate", {
    p_module: input.moduleCode,
    p_event: input.eventCode,
    p_channel: input.channel,
  });
  if (error) throw new Error(error.message ?? "get_comm_hub_real_email_gate failed");
  const payload = (data ?? {}) as { ok?: boolean; present?: boolean; gate?: any };
  if (payload.ok !== true) {
    throw new Error("get_comm_hub_real_email_gate returned an unexpected envelope");
  }
  if (!payload.present || !payload.gate) {
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
  const g = payload.gate;
  return {
    moduleCode: g.module_code,
    eventCode: g.event_code,
    channel: g.channel,
    enabled: !!g.enabled,
    openedAt: g.opened_at ?? null,
    openedBy: g.opened_by ?? null,
    reason: g.reason ?? null,
    closedAt: g.closed_at ?? null,
    closedBy: g.closed_by ?? null,
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
  const reason = (input.reason ?? "").trim();
  if (reason.length < 8) {
    throw new Error("A reason of at least 8 characters is required to change the real-email gate.");
  }
  const moduleCode = input.moduleCode.trim().toLowerCase();
  const eventCode = input.eventCode.trim().toLowerCase();
  const channel = (input.channel ?? "email").trim().toLowerCase() || "email";

  const { data, error } = await (supabase as any).rpc("set_comm_hub_real_email_gate", {
    p_module: moduleCode,
    p_event: eventCode,
    p_channel: channel,
    p_enabled: input.enabled,
    p_reason: reason,
  });
  if (error) throw new Error(error.message ?? "set_comm_hub_real_email_gate failed");

  const payload = (data ?? {}) as { ok?: boolean; gate?: any };
  if (payload.ok !== true || !payload.gate) {
    throw new Error("set_comm_hub_real_email_gate returned an unexpected envelope");
  }
  const g = payload.gate;
  return {
    moduleCode: g.module_code,
    eventCode: g.event_code,
    channel: g.channel,
    enabled: !!g.enabled,
    openedAt: g.opened_at ?? null,
    openedBy: g.opened_by ?? null,
    reason: g.reason ?? null,
    closedAt: g.closed_at ?? null,
    closedBy: g.closed_by ?? null,
    present: true,
  };
}
