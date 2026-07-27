/**
 * Client for baseline convergence RPCs.
 *
 * Backing RPCs (server-owned; do not duplicate here):
 *   - diagnose_comm_hub_legacy_attestation_fingerprint
 *   - correct_comm_hub_legacy_baseline_attestation
 *
 * The correct RPC supersedes the ACTIVE attestation and creates a new ACTIVE
 * row storing the canonical evidence_core_v2 and the sha256-v2 fingerprint.
 * The diagnose RPC must return all four booleans true after correction.
 */
import { supabase } from "@/integrations/supabase/client";

export const CORRECT_BASELINE_TYPED_PHRASE = "CORRECT LEGACY BASELINE ATTESTATION";

export interface BaselineDiagnosis {
  current_rpc_matches_current_core_rehash: boolean;
  attestation_stored_matches_attestation_core_rehash: boolean;
  current_core_matches_attestation_core: boolean;
  current_fingerprint_matches_attestation_fingerprint: boolean;
  active_attestation_id?: string;
  current_fingerprint_v2?: string;
  attestation_fingerprint_v2?: string;
  [k: string]: unknown;
}

export interface CorrectBaselineResult {
  ok: boolean;
  idempotent?: boolean;
  active_attestation_id?: string;
  superseded_attestation_id?: string;
  current_evidence_fingerprint_v2?: string;
  [k: string]: unknown;
}

export interface BaselineScope {
  moduleCode: string;
  eventCode: string;
  channel?: string;
}

export async function diagnoseLegacyAttestation(
  scope: BaselineScope,
): Promise<BaselineDiagnosis> {
  const { data, error } = await (supabase as any).rpc(
    "diagnose_comm_hub_legacy_attestation_fingerprint",
    {
      p_module_code: scope.moduleCode,
      p_event_code: scope.eventCode,
      p_channel: scope.channel ?? "email",
    },
  );
  if (error) throw new Error(error.message ?? "diagnose_comm_hub_legacy_attestation_fingerprint failed");
  return (data ?? {}) as BaselineDiagnosis;
}

export async function correctLegacyAttestation(
  scope: BaselineScope,
  reason: string,
  typedConfirmation: string,
): Promise<CorrectBaselineResult> {
  const { data, error } = await (supabase as any).rpc(
    "correct_comm_hub_legacy_baseline_attestation",
    {
      p_module_code: scope.moduleCode,
      p_event_code: scope.eventCode,
      p_channel: scope.channel ?? "email",
      p_reason: reason,
      p_typed_confirmation: typedConfirmation,
    },
  );
  if (error) throw new Error(error.message ?? "correct_comm_hub_legacy_baseline_attestation failed");
  return (data ?? { ok: false }) as CorrectBaselineResult;
}

export function isBaselineConverged(d: BaselineDiagnosis | null | undefined): boolean {
  if (!d) return false;
  return Boolean(
    d.current_rpc_matches_current_core_rehash &&
      d.attestation_stored_matches_attestation_core_rehash &&
      d.current_core_matches_attestation_core &&
      d.current_fingerprint_matches_attestation_fingerprint,
  );
}
