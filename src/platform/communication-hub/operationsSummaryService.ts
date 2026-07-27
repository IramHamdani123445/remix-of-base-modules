/**
 * A4.1.2C — Server-authoritative Operations summary + authorisation /
 * preparation hydration.
 *
 * The browser never holds authoritative revalidation state. These three
 * client wrappers project the read-only RPCs
 * `get_comm_hub_operations_summary`,
 * `get_comm_hub_active_revalidation_authorisation`, and
 * `get_comm_hub_active_revalidation_preparation`.
 *
 * All three RPCs are STABLE, admin-only, and reveal no provider
 * credentials. They never contact a provider and never mutate state.
 */
import { supabase } from "@/integrations/supabase/client";

export type ExecutionClassifiedState =
  | "PREPARING"
  | "READY_FOR_PROVIDER"
  | "FAILED_PRE_PROVIDER"
  | "RECOVERY_REQUIRED"
  | "PROVIDER_RESULT_PENDING"
  | "COMPLETE";

export type AuthorisationStatus = "ISSUED" | "EXPIRED" | "CONSUMED" | "REVOKED";

export type AuthorisationUnusableReason =
  | "revoked"
  | "consumed"
  | "expired"
  | "needs_reassessment"
  | "stale_fingerprint"
  | "wrong_event_certification"
  | "wrong_production_lineage"
  | "recipient_mismatch"
  | "no_active_cycle"
  | "no_authorisation"
  | "authorisation_unavailable"
  | null;

export interface HydratedAuthorisation {
  id: string;
  cycle_id: string;
  status: AuthorisationStatus;
  recipient: string | null;
  bound_current_fingerprint: string | null;
  bound_event_certification_id: string | null;
  bound_production_lineage_id: string | null;
  issued_at: string | null;
  expires_at: string | null;
  reserved_at: string | null;
  consumed_at: string | null;
  revoked_at: string | null;
  usable: boolean;
  unusable_reason: AuthorisationUnusableReason;
}

export interface HydratedPreparationExecution {
  execution_id: string;
  preparation_version: number;
  authorisation_id: string | null;
  state: string;
  classified_state: ExecutionClassifiedState;
  canonical_idempotency_key: string | null;
  request_id: string | null;
  message_id: string | null;
  trace_id: string | null;
  attempt_id: string | null;
  recipient_snapshot_id: string | null;
  provider_boundary_state: "NOT_ENTERED" | "ENTERED" | null;
  provider_call_attempted: boolean;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface OperationsSummary {
  evaluated_at: string;
  selection: { module_code: string; event_code: string; channel: string };
  platform: {
    operating_mode: string;
    automation_state: string;
    dispatch_enabled: boolean;
    scheduler_enabled: boolean;
    provider_boundary_approved: boolean;
  };
  event: {
    event_status: string | null;
    event_certification_id: string | null;
    ore_certification_id: string | null;
    production_lineage_id: string | null;
    evidence_authority: string;
  };
  baseline: {
    status: "ANCHORED" | "CANDIDATE_UNANCHORED" | "UNAVAILABLE";
    attestation_id: string | null;
    fingerprint: string | null;
    diagnosis_required: boolean;
    correction_required: boolean;
  };
  stages: Array<{
    code: string;
    status: string;
    certification_id: string | null;
    execution_id: string | null;
    completed_at: string | null;
    evidence_source: string;
    blocker_codes: string[];
  }>;
  revalidation: {
    active_cycle: {
      id: string;
      status: string;
      purpose: string;
      reason: string;
      required_validation_level: string;
      required_stages: string[];
      needs_reassessment: boolean;
      current_evidence_fingerprint_v2: string | null;
      recipient_email: string | null;
      started_at: string;
    } | null;
    usable_authorisation: HydratedAuthorisation | null;
    active_preparation_execution: HydratedPreparationExecution | null;
    recovery_required: boolean;
    inbox_confirmation_required: boolean;
    next_action: { code: string; label: string } | null;
  };
  sources: {
    event_status: "AVAILABLE" | "UNAVAILABLE";
    baseline_status: "AVAILABLE" | "UNAVAILABLE";
    revalidation_status: "AVAILABLE" | "IDLE";
    execution_status: "AVAILABLE" | "UNAVAILABLE";
  };
  blockers: Array<{ code: string; message?: string }>;
  warnings: Array<{ code: string; detail?: string }>;
}

export async function getOperationsSummary(input: {
  moduleCode: string;
  eventCode: string;
  channel?: string;
}): Promise<OperationsSummary> {
  const { data, error } = await (supabase as any).rpc(
    "get_comm_hub_operations_summary",
    {
      p_module_code: input.moduleCode,
      p_event_code: input.eventCode,
      p_channel: input.channel ?? "email",
    },
  );
  if (error) throw new Error(error.message ?? "get_comm_hub_operations_summary failed");
  return data as OperationsSummary;
}

export async function getActiveRevalidationAuthorisation(input: {
  moduleCode: string;
  eventCode: string;
  channel?: string;
}): Promise<{
  authorisation: HydratedAuthorisation | null;
  unusable_reason?: string;
  cycle_id?: string;
  cycle_status?: string;
}> {
  const { data, error } = await (supabase as any).rpc(
    "get_comm_hub_active_revalidation_authorisation",
    {
      p_module_code: input.moduleCode,
      p_event_code: input.eventCode,
      p_channel: input.channel ?? "email",
    },
  );
  if (error) throw new Error(error.message ?? "get_comm_hub_active_revalidation_authorisation failed");
  return data ?? { authorisation: null };
}

export async function getActiveRevalidationPreparation(cycleId: string): Promise<{
  execution: HydratedPreparationExecution | null;
  unavailable_reason?: string;
}> {
  const { data, error } = await (supabase as any).rpc(
    "get_comm_hub_active_revalidation_preparation",
    { p_cycle_id: cycleId },
  );
  if (error) throw new Error(error.message ?? "get_comm_hub_active_revalidation_preparation failed");
  return data ?? { execution: null };
}
