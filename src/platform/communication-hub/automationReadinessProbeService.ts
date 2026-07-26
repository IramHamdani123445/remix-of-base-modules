/**
 * Client for the server-side automation readiness probe.
 * `run_comm_hub_automation_readiness_probe` writes evidence rows for
 * all 9 checks and never arms anything.
 */
import { supabase } from "@/integrations/supabase/client";

export const AUTOMATION_READINESS_CHECK_CODES = [
  "scheduler",
  "automatic_triggers",
  "retry_worker",
  "dead_letter",
  "rate_limits",
  "batch_limits",
  "provider_circuit_breaker",
  "emergency_stop",
  "alerting_monitoring",
] as const;

export type AutomationReadinessCheckCode = (typeof AUTOMATION_READINESS_CHECK_CODES)[number];

export interface RunReadinessProbeResult {
  ok: boolean;
  module_code: string;
  event_code: string;
  channel: string;
  configuration_version: number;
  checked_at: string;
  checks: Array<{
    check_code: AutomationReadinessCheckCode;
    result: boolean;
    evidence: Record<string, unknown>;
    checked_at: string;
    expires_at: string;
    configuration_version: number;
  }>;
}

export async function runAutomationReadinessProbe(input: {
  moduleCode: string;
  eventCode: string;
  channel?: string;
}): Promise<RunReadinessProbeResult> {
  const { data, error } = await (supabase as any).rpc(
    "run_comm_hub_automation_readiness_probe",
    {
      p_module_code: input.moduleCode,
      p_event_code: input.eventCode,
      p_channel: input.channel ?? "email",
    },
  );
  if (error) throw new Error(error.message ?? "run_comm_hub_automation_readiness_probe failed");
  return data as RunReadinessProbeResult;
}
