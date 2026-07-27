/**
 * Manual Production continuity — reconcile and atomic promote.
 *
 * These wrap the server RPCs added by the mode-transition-continuity
 * migration. They MUST NOT try to re-send email; they only decide, based
 * on server-authoritative Stage 6 evidence, whether:
 *   - the event is already ready to dispatch,
 *   - a fresh event certification can be upserted from valid ORE evidence,
 *   - or a genuine safety-relevant input has drifted and a retest is due.
 */
import { supabase } from "@/integrations/supabase/client";

export type ManualProductionEntryStatus =
  | "READY_TO_DISPATCH"
  | "EVENT_CERTIFICATION_REQUIRED"
  | "EVIDENCE_DRIFT_REQUIRES_RETEST"
  | "PENDING_OBSERVATION_RECOVERY"
  | "EMERGENCY_STOP_ACTIVE";

export interface ReconcileManualProductionResult {
  status: ManualProductionEntryStatus;
  certification_row_id?: string;
  event_status?: string;
  one_real_email_certification_id?: string;
  evidence_fingerprint?: string;
  evidence_fingerprint_v2?: string;
  runtime_mode_version?: number;
  stored?: string;
  current?: string;
  current_v2?: string;
  intent_id?: string;
  phase?: string;
  idempotency_key?: string;
  reason?: string;
}

export interface ManualObservationEligibility {
  eligible: boolean;
  blockers: Array<{ code: string; [key: string]: unknown }>;
  runtime_mode_version?: number;
  automation_generation?: number;
  operating_mode?: string;
  event_status?: string;
  evidence_fingerprint?: string;
}

export async function checkManualObservationEligibility(input: {
  moduleCode: string;
  eventCode: string;
  channel?: string;
}): Promise<ManualObservationEligibility> {
  const { data, error } = await (supabase as any).rpc(
    "check_comm_hub_manual_observation_eligibility",
    {
      p_module_code: input.moduleCode,
      p_event_code: input.eventCode,
      p_channel: input.channel ?? "email",
    },
  );
  if (error) throw new Error(error.message ?? "check_comm_hub_manual_observation_eligibility failed");
  return data as ManualObservationEligibility;
}


export async function reconcileManualProductionEntry(input: {
  moduleCode: string;
  eventCode: string;
  channel?: string;
}): Promise<ReconcileManualProductionResult> {
  const { data, error } = await (supabase as any).rpc(
    "reconcile_comm_hub_manual_production_entry",
    {
      p_module_code: input.moduleCode,
      p_event_code: input.eventCode,
      p_channel: input.channel ?? "email",
    },
  );
  if (error) throw new Error(error.message ?? "reconcile_comm_hub_manual_production_entry failed");
  return data as ReconcileManualProductionResult;
}

export interface PromoteToManualProductionInput {
  moduleCode: string;
  eventCode: string;
  channel?: string;
  reason: string;
  typedConfirmation: string;
  expectedRuntimeModeVersion?: number;
  oneRealEmailCertificationId?: string;
}

export interface PromoteToManualProductionResult {
  ok: boolean;
  /**
   * Non-mutating structured result codes returned by the server:
   *   - RUNTIME_MODE_VERSION_CONFLICT: expected != current runtime_mode_version.
   *     The UI must NOT auto-retry; refresh state and show the operator.
   *   - certify_event / normalize_failed / EMERGENCY_STOP_ACTIVE /
   *     AUTOMATED_PRODUCTION_ACTIVE_REQUIRES_EXPLICIT_TRANSITION /
   *     NOT_MANUAL_PRODUCTION
   */
  phase?:
    | "RUNTIME_MODE_VERSION_CONFLICT"
    | "certify_event"
    | "normalize_failed"
    | "EMERGENCY_STOP_ACTIVE"
    | "AUTOMATED_PRODUCTION_ACTIVE_REQUIRES_EXPLICIT_TRANSITION"
    | "NOT_MANUAL_PRODUCTION"
    | string;
  next_action?: "DISPATCH_MANUAL_OBSERVATION" | "REFRESH_AND_RECONCILE";
  idempotent?: boolean;
  no_change?: boolean;
  event_certification_id?: string;
  event_status?: "live_manual_only";
  controls_normalized?: boolean;
  changed_fields?: string[];
  runtime_mode_version?: number;
  configuration_version?: number;
  automation_generation?: number;
  operating_mode?: string;
  automation_state?: string;
  // Populated only on RUNTIME_MODE_VERSION_CONFLICT.
  expected_runtime_mode_version?: number;
  current_runtime_mode_version?: number;
  current_operating_mode?: string;
  certification?: Record<string, unknown>;
  mode?: Record<string, unknown>;
  normalize?: Record<string, unknown>;
  error?: string;
  result?: unknown;
}

export async function promoteEventToManualProduction(
  input: PromoteToManualProductionInput,
): Promise<PromoteToManualProductionResult> {
  const { data, error } = await (supabase as any).rpc(
    "promote_comm_hub_event_to_manual_production",
    {
      p_module_code: input.moduleCode,
      p_event_code: input.eventCode,
      p_channel: input.channel ?? "email",
      p_reason: input.reason,
      p_typed_confirmation: input.typedConfirmation,
      p_expected_runtime_mode_version: input.expectedRuntimeModeVersion ?? null,
      p_one_real_email_certification_id: input.oneRealEmailCertificationId ?? null,
    },
  );
  if (error) throw new Error(error.message ?? "promote_comm_hub_event_to_manual_production failed");
  return data as PromoteToManualProductionResult;
}
