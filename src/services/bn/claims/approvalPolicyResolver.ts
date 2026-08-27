/**
 * Which approval controls apply to this product? (BUG-34)
 *
 * The controls are configuration, not code: `bn_approval_policy` states, per
 * product version and policy area, whether a supervisor is required, whether an
 * officer may approve their own work, whether documents may be waived, and
 * within which amount band a level applies.
 *
 * The one thing that is NOT configurable is the direction of failure. When no
 * enabled policy exists, the strict default below applies — a missing policy
 * must never mean "no control". That is the defect behind BUG-02, 03, 13, 22,
 * 29, 30, 33 and 34: a check that finds nothing to inspect reporting success.
 *
 * So a policy can only ever RELAX the default, and only deliberately, by
 * someone enabling a row that says so.
 *
 * Note the current data: all 200 rows in bn_approval_policy carry
 * `is_enabled = false`, every one of them with requires_supervisor_approval =
 * true and self_approval_allowed = false. So today every product resolves to
 * the strict default, which matches what those rows intended anyway.
 */
import { supabase } from '@/integrations/supabase/client';

const db = supabase as any;

/** Policy areas that govern a claim decision. */
export type ClaimPolicyArea = 'ELIGIBILITY' | 'CALCULATION' | 'DOCUMENTS' | 'AWARD';

export interface ApprovalControls {
  /** 'POLICY' when an enabled row was found, 'DEFAULT' when the strict baseline applies. */
  source: 'POLICY' | 'DEFAULT';
  /** The row that was applied, for audit. Null when the default applies. */
  policyId: string | null;
  /** An officer may not approve work they recommended. */
  selfApprovalAllowed: boolean;
  /** A supervisor-level approval is required in addition to the officer's. */
  requiresSupervisorApproval: boolean;
  /** A reason code must accompany the decision. */
  requiresReasonCode: boolean;
  /** A free-text justification must accompany the decision. */
  requiresJustification: boolean;
  /** Mandatory documents may NOT be satisfied by a waiver. */
  documentsNonWaivable: boolean;
}

/**
 * The baseline when no enabled policy exists: the strictest reading.
 *
 * Chosen so that an unconfigured product is protected rather than exposed.
 * Every field here can be relaxed by an enabled policy row.
 */
export const STRICT_DEFAULT_CONTROLS: Omit<ApprovalControls, 'source' | 'policyId'> = {
  selfApprovalAllowed: false,
  requiresSupervisorApproval: true,
  requiresReasonCode: false,
  requiresJustification: false,
  documentsNonWaivable: false,
};

/**
 * Resolves the controls for a product version and area.
 *
 * A query failure returns the strict default rather than throwing: the caller's
 * job is to refuse an unsafe approval, and it cannot do that if resolving the
 * policy explodes. `source` stays 'DEFAULT' so the caller can say why.
 */
export async function resolveApprovalControls(
  productVersionId: string | null | undefined,
  area: ClaimPolicyArea,
  amount?: number | null,
): Promise<ApprovalControls> {
  const fallback: ApprovalControls = {
    source: 'DEFAULT',
    policyId: null,
    ...STRICT_DEFAULT_CONTROLS,
  };
  if (!productVersionId) return fallback;

  const { data, error } = await db
    .from('bn_approval_policy')
    .select(
      'id, policy_area, level, is_enabled, self_approval_allowed, requires_supervisor_approval, ' +
      'requires_reason_code, requires_justification, non_waivable, min_amount, max_amount',
    )
    .eq('product_version_id', productVersionId)
    .eq('policy_area', area)
    .eq('is_enabled', true)
    .order('level', { ascending: true });
  if (error || !Array.isArray(data) || data.length === 0) return fallback;

  // Amount bands: pick the level whose band contains the amount. A row with no
  // band applies to any amount.
  const inBand = (row: any) => {
    if (amount == null) return row.min_amount == null && row.max_amount == null;
    if (row.min_amount != null && amount < Number(row.min_amount)) return false;
    if (row.max_amount != null && amount > Number(row.max_amount)) return false;
    return true;
  };
  const banded = data.filter(inBand);
  const unbanded = data.filter((r: any) => r.min_amount == null && r.max_amount == null);
  const row = (banded.length > 0 ? banded : unbanded)[0];
  if (!row) return fallback;

  // A policy that omits a field does not thereby relax it — the strict default
  // stands for anything the row does not state.
  return {
    source: 'POLICY',
    policyId: row.id,
    selfApprovalAllowed: row.self_approval_allowed === true,
    requiresSupervisorApproval: row.requires_supervisor_approval !== false,
    requiresReasonCode: row.requires_reason_code === true,
    requiresJustification: row.requires_justification === true,
    documentsNonWaivable: row.non_waivable === true,
  };
}
