/**
 * Client for the server-side pre-arm readiness probe.
 *
 * `run_comm_hub_automation_readiness_probe` writes evidence rows for all
 * 9 checks and never arms anything. It is callable while the platform is
 * in DRY_RUN, CONTROLLED_LIVE, MANUAL_PRODUCTION, or AUTOMATED_PRODUCTION
 * (STANDBY only). Each check returns a real `status` (PASS / FAIL /
 * NOT_IMPLEMENTED / NOT_CONFIGURED / PROBE_FAILED / STALE / DRIFTED). On a
 * server-side schema mismatch the RPC returns `{ ok: false, blocker }` so
 * the UI can render an exact top-level ERROR without fabricating partial
 * PASS rows.
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

export type ReadinessCheckStatus =
  | "PASS"
  | "FAIL"
  | "NOT_IMPLEMENTED"
  | "NOT_CONFIGURED"
  | "PROBE_FAILED"
  | "STALE"
  | "DRIFTED";

export interface ReadinessProbeBlocker {
  code: string;
  object_name?: string;
  detail?: string;
  sqlstate?: string;
  fix_action?: string;
}

export interface ReadinessProbeCheck {
  check_code: AutomationReadinessCheckCode;
  result: boolean;
  status: ReadinessCheckStatus;
  evidence: Record<string, unknown>;
  blocker: string | null;
  fix_action: string | null;
  checked_at: string;
  expires_at: string;
  configuration_version: number;
  event_certification_id: string | null;
  production_lineage_id: string | null;
  evidence_fingerprint_v2: string;
}

export interface ReadinessProbeSuccess {
  ok: true;
  readiness_phase: "PRE_ARM_READINESS";
  current_operating_mode: string;
  automation_state: string;
  safe_mode: boolean;
  module_code: string;
  event_code: string;
  channel: string;
  configuration_version: number;
  event_certification_id: string | null;
  production_lineage_id: string | null;
  checked_at: string;
  checks: ReadinessProbeCheck[];
}

export interface ReadinessProbeFailure {
  ok: false;
  blocker: ReadinessProbeBlocker;
}

export type RunReadinessProbeResult = ReadinessProbeSuccess | ReadinessProbeFailure;

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
  const raw = (data ?? {}) as any;
  if (raw?.ok === false) {
    const b = raw.blocker ?? (Array.isArray(raw.blockers) ? raw.blockers[0] : undefined) ?? {};
    return {
      ok: false,
      blocker: {
        code: b.code ?? "READINESS_SCHEMA_MISMATCH",
        object_name: b.object_name,
        detail: b.detail,
        sqlstate: b.sqlstate,
        fix_action: b.fix_action,
      },
    };
  }
  return raw as ReadinessProbeSuccess;
}
