/**
 * Checkpoint A — Communication Hub Diagnostic Bundle.
 *
 * Runs, under the authenticated operator JWT, exactly two admin-gated RPCs:
 *   - audit_comm_hub_runtime_contract()
 *   - diagnose_comm_hub_legacy_attestation_fingerprint(module,event,channel)
 *
 * plus a set of read-only queries against the protected production state.
 *
 * The bundle is intentionally READ-ONLY. It never:
 *   - creates a request, message, delivery attempt, or trace,
 *   - contacts a provider,
 *   - mutates mode, automation, anchor, or attestations.
 *
 * There is no service-role bypass, no sandbox route, no diagnostic RPC that
 * avoids auth.uid(). The operator session is the authority.
 */
import { supabase } from "@/integrations/supabase/client";
import type { RuntimeContractReport } from "./runtimeContractService";
import { auditRuntimeContract } from "./runtimeContractService";
import {
  diagnoseLegacyAttestation,
  type BaselineDiagnosis,
} from "./legacyBaselineAttestationService";

export interface DiagnosticBundleScope {
  moduleCode: string;
  eventCode: string;
  channel: string;
}

export interface ProtectedProductionState {
  event_certification_id: string | null;
  ore_certification_id: string | null;
  production_lineage_id: string | null;
  event_authority: string | null;
  operating_mode: string | null;
  automation_state: string | null;
  batch_enabled: boolean | null;
  bulk_enabled: boolean | null;
  emergency_stop_active: boolean | null;
  active_revalidation_cycle_id: string | null;
  active_revalidation_status: string | null;
  needs_reassessment: boolean | null;
  assessment_version: number | null;
  assessed_runtime_contract_version: string | null;
}

export interface DiagnosticBundle {
  generated_at: string;
  operator_id: string | null;
  scope: DiagnosticBundleScope;
  runtime_contract: RuntimeContractReport | { error: string };
  baseline_diagnostic: BaselineDiagnosis | { error: string };
  protected_state: ProtectedProductionState | { error: string };
}

/** Mask any inline recipient string to first char + domain (or `***`). */
function maskEmail(v: string | null | undefined): string | null {
  if (!v) return v ?? null;
  const s = String(v);
  const at = s.indexOf("@");
  if (at <= 0) return "***";
  return `${s[0]}***@${s.slice(at + 1)}`;
}

/**
 * Walks the bundle and masks any obvious credential / token / recipient
 * value the RPCs might otherwise return, without changing PASS/FAIL fields.
 */
export function maskDiagnosticBundle(b: DiagnosticBundle): DiagnosticBundle {
  const clone = JSON.parse(JSON.stringify(b)) as DiagnosticBundle;
  const walk = (obj: unknown): void => {
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v == null) continue;
      const lk = k.toLowerCase();
      if (typeof v === "string") {
        if (
          lk.includes("api_key") ||
          lk.includes("secret") ||
          lk.includes("token") ||
          lk.includes("password") ||
          lk.includes("client_secret") ||
          lk.includes("service_role")
        ) {
          (obj as Record<string, unknown>)[k] = "***REDACTED***";
        } else if (lk.includes("recipient_email") || lk === "email" || lk === "to_address") {
          (obj as Record<string, unknown>)[k] = maskEmail(v);
        }
      } else if (typeof v === "object") {
        walk(v);
      }
    }
  };
  walk(clone);
  return clone;
}

async function loadProtectedState(
  scope: DiagnosticBundleScope,
): Promise<ProtectedProductionState | { error: string }> {
  try {
    // All queries run under the operator JWT + existing RLS.
    // `get_comm_hub_event_go_live_status` is admin-gated and returns the
    // authoritative pinned anchor + operating state.
    const { data, error } = await (supabase as any).rpc(
      "get_comm_hub_event_go_live_status",
      {
        p_module_code: scope.moduleCode,
        p_event_code: scope.eventCode,
        p_channel: scope.channel,
      },
    );
    if (error) throw new Error(error.message ?? "status_rpc_failed");
    const d = (data ?? {}) as any;

    // Unresolved revalidation cycle (single query, admin-scoped via RLS).
    const cycleRes = await (supabase as any)
      .from("communication_hub_revalidation_cycle")
      .select(
        "id, status, needs_reassessment, assessment_version, assessed_runtime_contract_version",
      )
      .eq("module_code", scope.moduleCode)
      .eq("event_code", scope.eventCode)
      .eq("channel", scope.channel)
      .not("status", "in", "(CONFIRMED,NOT_RECEIVED,FAILED,VOIDED,VERIFIED_SUPPLEMENTAL,PROMOTED,SUPERSEDED)")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const cyc = cycleRes.data as any;
    return {
      event_certification_id: d?.production_anchor?.event_certification_id ?? null,
      ore_certification_id: d?.production_anchor?.ore_certification_id ?? null,
      production_lineage_id: d?.production_anchor?.production_lineage_id ?? null,
      event_authority: d?.production_anchor?.event_authority ?? d?.event_authority ?? null,
      operating_mode: d?.operating_mode ?? d?.mode ?? null,
      automation_state: d?.automation_state ?? null,
      batch_enabled: d?.batch_enabled ?? null,
      bulk_enabled: d?.bulk_enabled ?? null,
      emergency_stop_active: d?.emergency_stop_active ?? null,
      active_revalidation_cycle_id: cyc?.id ?? null,
      active_revalidation_status: cyc?.status ?? null,
      needs_reassessment: cyc?.needs_reassessment ?? null,
      assessment_version: cyc?.assessment_version ?? null,
      assessed_runtime_contract_version: cyc?.assessed_runtime_contract_version ?? null,
    };
  } catch (e: any) {
    return { error: e?.message ?? "protected_state_failed" };
  }
}

export async function runDiagnosticBundle(
  scope: DiagnosticBundleScope,
): Promise<DiagnosticBundle> {
  const { data: userData } = await supabase.auth.getUser();
  const operatorId = userData?.user?.id ?? null;

  let runtime: RuntimeContractReport | { error: string };
  try {
    runtime = await auditRuntimeContract();
  } catch (e: any) {
    runtime = { error: e?.message ?? "runtime_contract_failed" };
  }

  let baseline: BaselineDiagnosis | { error: string };
  try {
    baseline = await diagnoseLegacyAttestation({
      moduleCode: scope.moduleCode,
      eventCode: scope.eventCode,
      channel: scope.channel,
    });
  } catch (e: any) {
    baseline = { error: e?.message ?? "baseline_diagnostic_failed" };
  }

  const protectedState = await loadProtectedState(scope);

  const bundle: DiagnosticBundle = {
    generated_at: new Date().toISOString(),
    operator_id: operatorId,
    scope,
    runtime_contract: runtime,
    baseline_diagnostic: baseline,
    protected_state: protectedState,
  };

  return maskDiagnosticBundle(bundle);
}

/**
 * Convenience: are the four baseline booleans all true?
 * Returns null when the diagnostic itself failed.
 */
export function baselineConverged(d: DiagnosticBundle["baseline_diagnostic"]): boolean | null {
  if (!d || typeof d !== "object" || (d as any).error) return null;
  const b = d as BaselineDiagnosis;
  return Boolean(
    b.current_rpc_matches_current_core_rehash &&
      b.attestation_stored_matches_attestation_core_rehash &&
      b.current_core_matches_attestation_core &&
      b.current_fingerprint_matches_attestation_fingerprint,
  );
}
