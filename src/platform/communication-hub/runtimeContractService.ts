/**
 * Gate 3 — Communication Hub runtime contract audit client.
 *
 * Backing RPC: audit_comm_hub_runtime_contract() — read-only, admin-only.
 * Never sends, enqueues, changes mode, or arms automation.
 */
import { supabase } from "@/integrations/supabase/client";

export type RuntimeCheckStatus =
  | "PASS"
  | "MISSING_TABLE"
  | "MISSING_COLUMN"
  | "MISSING_FUNCTION"
  | "SIGNATURE_MISMATCH"
  | "ENUM_MISMATCH"
  | "NOT_IMPLEMENTED";

export interface RuntimeContractCheck {
  capability: string;
  requirement: string;
  object_name: string;
  status: RuntimeCheckStatus;
  detail: string | null;
  fix_action: string | null;
}

export interface RuntimeContractReport {
  ok: boolean;
  checked_at: string;
  checks: RuntimeContractCheck[];
  summary: { total: number; pass: number; fail: number };
}

export async function auditRuntimeContract(): Promise<RuntimeContractReport> {
  const { data, error } = await (supabase as any).rpc("audit_comm_hub_runtime_contract");
  if (error) throw new Error(error.message ?? "audit_comm_hub_runtime_contract failed");
  return (data ?? { ok: false, checked_at: new Date().toISOString(), checks: [], summary: { total: 0, pass: 0, fail: 0 } }) as RuntimeContractReport;
}

/**
 * Return whether the runtime contract has at least one check for the given
 * capability and every matched check is PASS. Zero matched checks fails
 * closed (defence-in-depth: an unknown or misnamed capability must never
 * silently permit a provider-contacting action).
 */
export function capabilityPasses(report: RuntimeContractReport | null | undefined, capability: string): boolean {
  if (!report) return false;
  const matched = report.checks.filter((c) => c.capability === capability);
  if (matched.length === 0) return false;
  return matched.every((c) => c.status === "PASS");
}
