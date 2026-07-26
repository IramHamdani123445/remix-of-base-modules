/**
 * Client for the read-only Stage 6/7/8 aggregator RPC
 * `get_comm_hub_event_go_live_status`. Never mutates and never contacts
 * a provider.
 */
import { supabase } from "@/integrations/supabase/client";

export interface Stage6Blocker {
  code: string;
  message?: string;
  status?: string | null;
}

export interface Stage6Status {
  one_real_email_execution_id: string | null;
  one_real_email_certification_id: string | null;
  one_real_email_certification_status: string | null;
  provider_call_attempted: boolean | null;
  provider_message_id: string | null;
  delivery_attempt_id: string | null;
  trace_id: string | null;
  manual_verification_status: string | null;
  manual_verified_recipient: string | null;
  manual_verified_at: string | null;
  reconciliation_required: boolean;
  real_email_gate_enabled: boolean;
  real_email_gate_id: string | null;
  // Authoritative Stage 7 gating fields (server-derived)
  latest_one_real_email_certification_id: string | null;
  latest_one_real_email_certification_status: string | null;
  eligible_one_real_email_certification_id: string | null;
  eligible_one_real_email_certification_status: string | null;
  stage6_ready_for_manual_production: boolean;
  stage6_manual_production_blockers: Stage6Blocker[];
}

export interface Stage7Status {
  manual_event_certification_id: string | null;
  manual_event_status: string | null;
  manual_approved_at: string | null;
  manual_approved_by: string | null;
  manual_reason: string | null;
  drift_detected: boolean;
  drift_reason: string | null;
  manual_observation_count: number;
  latest_manual_observation_id: string | null;
  latest_manual_observation_message_id: string | null;
  latest_manual_observation_attempt_id: string | null;
  latest_manual_observation_trace_id: string | null;
  latest_manual_observation_status: string | null;
  latest_manual_observation_inbox: string | null;
  real_email_gate_closed_at: string | null;
}

export interface ReadinessCheck {
  check_code: string;
  result: boolean;
  source: "SERVER_PROBE" | "ADMIN_ATTESTATION";
  evidence: Record<string, unknown>;
  checked_at: string;
  checked_by: string | null;
  expires_at: string;
  configuration_version: number;
  fresh: boolean;
}

export interface Stage8Status {
  automation_event_certification_status: string | null;
  automation_certified_at: string | null;
  automation_certified_by: string | null;
  readiness_checks: ReadinessCheck[];
  readiness_all_ok_and_fresh: boolean;
  automated_eligible: boolean;
  automated_blockers: Array<{ code: string }>;
}

export interface PlatformStatus {
  current_operating_mode: string;
  configuration_version: number;
  automation_state: string;
  scheduler_enabled: boolean;
  automatic_triggers_enabled: boolean;
  retry_worker_enabled: boolean;
  batch_enabled: boolean;
  bulk_enabled: boolean;
  dispatch_enabled: boolean;
  eligible_manual_event_count: number;
  eligible_automated_event_count: number;
}

export interface EventGoLiveStatus {
  module_code: string;
  event_code: string;
  channel: string;
  evaluated_at: string;
  stage6: Stage6Status;
  stage7: Stage7Status;
  stage8: Stage8Status;
  platform: PlatformStatus;
}

export async function getEventGoLiveStatus(input: {
  moduleCode: string;
  eventCode: string;
  channel?: string;
}): Promise<EventGoLiveStatus> {
  const { data, error } = await (supabase as any).rpc(
    "get_comm_hub_event_go_live_status",
    {
      p_module_code: input.moduleCode,
      p_event_code: input.eventCode,
      p_channel: input.channel ?? "email",
    },
  );
  if (error) throw new Error(error.message ?? "get_comm_hub_event_go_live_status failed");
  return data as EventGoLiveStatus;
}
