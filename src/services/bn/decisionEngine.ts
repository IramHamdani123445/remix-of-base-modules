import { routeClaimAfterStatusChange } from '@/services/bn/workflow/routeClaimAfterStatusChange';
import { supabase } from '@/integrations/supabase/client';
import { isEvidenceComplete } from '@/services/bn/evidenceService';
import type {
  BnClaimTransitionRule,
  BnAvailableAction,
  BnClaimDecision,
  BnReasonCode,
} from '@/types/bn';

const db = supabase as any;

// ── Fetch available transitions for a claim ──

export async function getAvailableTransitions(
  claimId: string,
  userRoles: string[],
  productCategory?: string | null,
  countryCode?: string | null
): Promise<BnAvailableAction[]> {
  // 1. Get claim current status + evidence/eligibility/calc state
  const { data: claim, error: claimErr } = await db
    .from('bn_claim')
    .select('id, status, product_id')
    .eq('id', claimId)
    .single();

  if (claimErr || !claim) throw new Error('Claim not found');

  const currentStatus = claim.status as string;

  // 2. Fetch all active transition rules from this status
  let query = db
    .from('bn_claim_transition_rule')
    .select('*')
    .eq('from_status', currentStatus)
    .eq('is_active', true)
    .order('sort_order');

  const { data: rules, error: rulesErr } = await query;
  if (rulesErr) throw rulesErr;

  // 3. Check preconditions in parallel
  const [eligResults, calcResults, evidenceComplete] = await Promise.all([
    db.from('bn_claim_eligibility').select('overall_result').eq('claim_id', claimId).order('check_date', { ascending: false }).limit(1),
    db.from('bn_claim_calculation').select('id').eq('claim_id', claimId).limit(1),
    isEvidenceComplete(claimId),
  ]);

  const hasEligibilityPass = eligResults.data?.[0]?.overall_result === true;
  const hasCalculation = (calcResults.data?.length || 0) > 0;

  // 4. Evaluate each rule
  const isAdmin = userRoles.some(r => r.toLowerCase() === 'admin');

  return (rules || []).map((rule: BnClaimTransitionRule) => {
    // Role check
    const roleAllowed = isAdmin || rule.allowed_roles.some(r => userRoles.includes(r));
    if (!roleAllowed) {
      return { rule, blocked: true, blockedReason: 'Insufficient role permissions' };
    }

    // Product category filter
    if (rule.product_category && productCategory && rule.product_category !== productCategory) {
      return null; // Not applicable
    }

    // Country filter
    if (rule.country_code && countryCode && rule.country_code !== countryCode) {
      return null;
    }

    // Precondition checks
    if (rule.requires_eligibility_pass && !hasEligibilityPass) {
      return { rule, blocked: true, blockedReason: 'Eligibility check must pass first' };
    }
    if (rule.requires_calculation && !hasCalculation) {
      return { rule, blocked: true, blockedReason: 'Calculation must be completed first' };
    }
    if (rule.requires_evidence_complete && !evidenceComplete) {
      return { rule, blocked: true, blockedReason: 'All mandatory documents must be verified first' };
    }

    return { rule, blocked: false, blockedReason: null };
  }).filter(Boolean) as BnAvailableAction[];
}

// ── Execute a transition ──

export interface ExecuteTransitionParams {
  claimId: string;
  actionCode: string;
  ruleId: string;
  reasonCodeId?: string | null;
  narrative?: string | null;
  effectiveDate?: string | null;
  overrideId?: string | null;
  performedBy: string;
}

export async function executeTransition(params: ExecuteTransitionParams): Promise<BnClaimDecision> {
  const { claimId, actionCode, ruleId, reasonCodeId, narrative, effectiveDate, overrideId, performedBy } = params;

  // 1. Get current claim status
  const { data: claim, error: claimErr } = await db
    .from('bn_claim')
    .select('id, status')
    .eq('id', claimId)
    .single();

  if (claimErr || !claim) throw new Error('Claim not found');

  // 2. Get the transition rule
  const { data: rule, error: ruleErr } = await db
    .from('bn_claim_transition_rule')
    .select('*')
    .eq('id', ruleId)
    .single();

  if (ruleErr || !rule) throw new Error('Transition rule not found');

  // 3. Validate current status matches
  if (claim.status !== rule.from_status) {
    throw new Error(`Claim status "${claim.status}" does not match expected "${rule.from_status}"`);
  }

  // 4. Validate reason if required
  if (rule.requires_reason && !reasonCodeId) {
    throw new Error('A reason code is required for this action');
  }

  // 5. Validate narrative if required
  if (rule.requires_narrative && (!narrative || !narrative.trim())) {
    throw new Error('A narrative justification is required for this action');
  }

  // 6. Build evidence snapshot from bn_claim_evidence
  const { data: docs } = await db
    .from('bn_claim_evidence')
    .select('id, document_type_code, status, document_name')
    .eq('claim_id', claimId);

  const evidenceSnapshot = {
    documents: (docs || []).map((d: any) => ({
      id: d.id,
      type: d.document_type_code,
      name: d.document_name,
      status: d.status,
    })),
    snapshot_at: new Date().toISOString(),
  };

  // 7. Get latest eligibility & calculation IDs
  const { data: latestElig } = await db
    .from('bn_claim_eligibility')
    .select('id')
    .eq('claim_id', claimId)
    .order('check_date', { ascending: false })
    .limit(1);

  const { data: latestCalc } = await db
    .from('bn_claim_calculation')
    .select('id')
    .eq('claim_id', claimId)
    .order('calc_date', { ascending: false })
    .limit(1);

  // 8. Insert decision record
  const decisionRecord = {
    claim_id: claimId,
    transition_rule_id: ruleId,
    action_code: actionCode,
    from_status: rule.from_status,
    to_status: rule.to_status,
    reason_code_id: reasonCodeId || null,
    narrative: narrative || null,
    effective_date: effectiveDate || null,
    override_id: overrideId || null,
    evidence_snapshot: evidenceSnapshot,
    eligibility_snapshot_id: latestElig?.[0]?.id || null,
    calculation_snapshot_id: latestCalc?.[0]?.id || null,
    performed_by: performedBy,
  };

  const { data: decision, error: decisionErr } = await db
    .from('bn_claim_decision')
    .insert(decisionRecord)
    .select()
    .single();

  if (decisionErr) throw decisionErr;

  // 9. Update claim status
  const claimUpdate: Record<string, any> = {
    status: rule.to_status,
    modified_by: performedBy,
    modified_at: new Date().toISOString(),
  };

  if (actionCode === 'APPROVE') {
    claimUpdate.decision_date = new Date().toISOString();
  }

  const { error: updateErr } = await db
    .from('bn_claim')
    .update(claimUpdate)
    .eq('id', claimId);

  if (updateErr) throw updateErr;

  // The claim's new status decides which workbasket owns it next.
  await routeClaimAfterStatusChange(claimId, performedBy);

  // 10. Insert claim event
  await db.from('bn_claim_event').insert({
    claim_id: claimId,
    event_type: `STATUS_CHANGE_${actionCode}`,
    from_status: rule.from_status,
    to_status: rule.to_status,
    notes: narrative || rule.action_label,
    performed_by: performedBy,
    metadata: { decision_id: decision.id, reason_code_id: reasonCodeId },
  });

  return decision as BnClaimDecision;
}

// ── Fetch decisions for a claim ──

export async function fetchClaimDecisions(claimId: string): Promise<BnClaimDecision[]> {
  const { data, error } = await db
    .from('bn_claim_decision')
    .select('*, bn_reason_code(*)')
    .eq('claim_id', claimId)
    .order('performed_at', { ascending: false });

  if (error) throw error;
  return (data || []) as BnClaimDecision[];
}

// ── Fetch reason codes for an action ──

export async function fetchReasonCodesForAction(actionCode: string): Promise<BnReasonCode[]> {
  const { data, error } = await db
    .from('bn_reason_code')
    .select('*')
    .eq('is_active', true)
    .contains('applicable_actions', [actionCode])
    .order('reason_label');

  if (error) throw error;
  return (data || []) as BnReasonCode[];
}

// ── Export decisions as JSON ──

export async function exportDecisionAudit(claimId: string) {
  const decisions = await fetchClaimDecisions(claimId);

  // Get eligibility and calculation snapshots
  const { data: eligibility } = await db
    .from('bn_claim_eligibility')
    .select('*')
    .eq('claim_id', claimId)
    .order('check_date', { ascending: false });

  const { data: calculations } = await db
    .from('bn_claim_calculation')
    .select('*')
    .eq('claim_id', claimId)
    .order('calc_date', { ascending: false });

  return {
    claim_id: claimId,
    exported_at: new Date().toISOString(),
    decisions,
    eligibility_snapshots: eligibility || [],
    calculation_snapshots: calculations || [],
  };
}
