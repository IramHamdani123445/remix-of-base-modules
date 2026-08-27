/**
 * Claim Action Runner
 *
 * Bridges workbench actions to the underlying business engines.
 * Phase 2 makes these actions actually DO something instead of
 * only updating bn_claim.status.
 *
 *  - runClaimEligibility  → loads product-version rules, resolves each
 *    rule's field, evaluates the operator, persists a row in
 *    bn_claim_eligibility with a full rule trace and contribution summary.
 *
 *  - runClaimCalculation  → invokes the existing 10-layer calculation
 *    engine, then mirrors the relevant outputs into bn_claim_calculation
 *    so the workbench Calculation tab and downstream entitlement logic
 *    have a typed, query-friendly record.
 *
 *  - createClaimDecision  → drafts/finalises a bn_claim_decision row for
 *    SUBMIT_DECISION / APPROVE / DENY actions.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  evaluateEligibilityRules,
  summariseEligibility,
  type EligibilityRuleTrace,
} from '@/services/bn/eligibility/eligibilityEvaluator';
import { runCalculationEngine } from '@/services/bn/calculationEngine';

const db = supabase as any;

export interface ClaimContext {
  id: string;
  ssn: string;
  claim_date: string;
  product_id: string | null;
  product_version_id: string | null;
  employer_regno: string | null;
  status: string | null;
}

async function loadClaimContext(claimId: string): Promise<ClaimContext> {
  const { data, error } = await db
    .from('bn_claim')
    .select('id, ssn, claim_date, product_id, product_version_id, employer_regno, status')
    .eq('id', claimId)
    .single();
  if (error) throw error;
  if (!data) throw new Error('Claim not found');
  return data as ClaimContext;
}

/**
 * For pre-decision claims, auto-rebind to the currently ACTIVE product version
 * so newly added rules take effect. Decided claims stay pinned for audit.
 */
const PRE_DECISION_STATUSES = new Set([
  'DRAFT', 'INTAKE', 'SUBMITTED', 'UNDER_REVIEW', 'PENDING_DOCS', 'PENDING_REVIEW',
]);

async function resolveEvaluationVersionId(claim: ClaimContext): Promise<string> {
  if (!claim.product_id) {
    if (!claim.product_version_id) throw new Error('Claim has no product/version.');
    return claim.product_version_id;
  }
  const isPreDecision = !claim.status || PRE_DECISION_STATUSES.has(String(claim.status).toUpperCase());
  if (!isPreDecision) {
    if (!claim.product_version_id) throw new Error('Decided claim missing product_version_id.');
    return claim.product_version_id;
  }
  const { data: active } = await db
    .from('bn_product_version')
    .select('id')
    .eq('product_id', claim.product_id)
    .eq('status', 'ACTIVE')
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  const targetId = active?.id || claim.product_version_id;
  if (!targetId) throw new Error('No ACTIVE product version found for this product.');
  if (targetId !== claim.product_version_id) {
    await db.from('bn_claim').update({ product_version_id: targetId }).eq('id', claim.id);
    claim.product_version_id = targetId;
  }
  return targetId;
}

// ─── Eligibility ────────────────────────────────────────────────────

export type { EligibilityRuleTrace } from '@/services/bn/eligibility/eligibilityEvaluator';

export interface EligibilityRunResult {
  eligibilityId: string;
  overallResult: boolean;
  rules: EligibilityRuleTrace[];
}

async function resolveEmployerForClaim(claim: ClaimContext): Promise<string | null> {
  if (claim.employer_regno) return claim.employer_regno;
  // Latest wage row gives us the most recent employer (payer_id) for this SSN.
  const { data } = await db
    .from('ip_wages')
    .select('payer_id, period')
    .eq('ssn', claim.ssn)
    .order('period', { ascending: false })
    .limit(1);
  return data?.[0]?.payer_id ?? null;
}

export async function runClaimEligibility(
  claimId: string,
  userCode: string,
): Promise<EligibilityRunResult> {
  const claim = await loadClaimContext(claimId);
  const versionId = await resolveEvaluationVersionId(claim);

  const { data: rules, error: rulesErr } = await db
    .from('bn_eligibility_rule')
    .select('*')
    .eq('product_version_id', versionId)
    .eq('is_active', true)
    .order('sort_order');
  if (rulesErr) throw rulesErr;

  const resolvedEmployer = await resolveEmployerForClaim(claim);

  const ctx = {
    ssn: claim.ssn,
    claimId: claim.id,
    claimDate: claim.claim_date,
    employerRegNo: resolvedEmployer ?? undefined,
  };

  // BUG-29 — evaluation is delegated to the shared evaluator so intake and the
  // workbench cannot diverge, and so a rule that cannot be evaluated is recorded
  // as UNEVALUATED (blocking) instead of being reported as passed.
  const traces: EligibilityRuleTrace[] = await evaluateEligibilityRules(rules ?? [], ctx);

  // ─── Apply ACTIVE APPROVED eligibility overrides ───────────────────
  // Rule per spec: re-run evaluates every rule, but any failure that has an
  // ACTIVE approved override is downgraded to OVERRIDDEN (passed=true) so
  // the claim does not regress. Only explicit revoke removes an override.
  const { data: activeOverrides } = await db
    .from('bn_override_request')
    .select('id, rule_code, reason_code, justification, reviewed_by, reviewed_at, requested_by, current_value, requested_value')
    .eq('claim_id', claim.id)
    .eq('policy_area', 'ELIGIBILITY')
    .eq('status', 'APPROVED');

  const overrideByRule = new Map<string, any>();
  for (const ov of (activeOverrides ?? [])) {
    if (ov.rule_code && !overrideByRule.has(ov.rule_code)) overrideByRule.set(ov.rule_code, ov);
  }

  let anyOverrideApplied = false;
  const overrideReasons: string[] = [];
  let firstOverrideBy: string | null = null;

  for (const t of traces) {
    if (!t.passed && overrideByRule.has(t.rule_code)) {
      const ov = overrideByRule.get(t.rule_code);
      anyOverrideApplied = true;
      firstOverrideBy = firstOverrideBy || ov.reviewed_by || ov.requested_by;
      if (ov.justification || ov.reason_code) {
        overrideReasons.push(`${t.rule_code}: ${ov.justification || ov.reason_code}`);
      }
      (t as any).original_actual_value = t.actual_value;
      (t as any).original_passed = false;
      t.passed = true;
      (t as any).result_state = 'OVERRIDDEN';
      (t as any).status = 'OVERRIDDEN';
      (t as any).override_request_id = ov.id;
      (t as any).overridden_by = ov.reviewed_by || ov.requested_by;
      (t as any).override_approved_by = ov.reviewed_by;
      (t as any).override_approved_at = ov.reviewed_at;
      (t as any).override_reason_code = ov.reason_code;
      (t as any).override_justification = ov.justification;
      t.message = `${t.message} — OVERRIDDEN by ${ov.reviewed_by || ov.requested_by} (${ov.reason_code || 'policy override'})`;
    }
  }

  const overall = summariseEligibility(traces).overall;

  const { data: inserted, error: insErr } = await db
    .from('bn_claim_eligibility')
    .insert({
      claim_id: claim.id,
      product_version_id: claim.product_version_id,
      overall_result: overall,
      rule_results: traces,
      contribution_summary: {},
      entered_by: userCode,
      override_applied: anyOverrideApplied,
      override_by: anyOverrideApplied ? firstOverrideBy : null,
      override_reason: anyOverrideApplied ? overrideReasons.join(' | ') || 'Active approved override applied' : null,
    })
    .select('id')
    .single();
  if (insErr) throw insErr;

  return {
    eligibilityId: inserted.id,
    overallResult: overall,
    rules: traces,
  };
}

// ─── Calculation ────────────────────────────────────────────────────

export interface CalculationRunResult {
  calculationId: string;
  weeklyRate: number | null;
  monthlyRate: number | null;
  lumpSum: number | null;
  averageWeeklyWage: number | null;
}

export async function runClaimCalculation(
  claimId: string,
  userCode: string,
  options: { allowWithoutPassingEligibility?: boolean } = {},
): Promise<CalculationRunResult> {
  const claim = await loadClaimContext(claimId);
  if (!claim.product_id) {
    throw new Error('Claim is missing product — cannot run calculation.');
  }
  await resolveEvaluationVersionId(claim);
  if (!claim.product_version_id) {
    throw new Error('Claim is missing product_version — cannot run calculation.');
  }

  // Precondition: latest eligibility must have passed (or override).
  if (!options.allowWithoutPassingEligibility) {
    const { data: latest } = await db
      .from('bn_claim_eligibility')
      .select('overall_result, override_applied')
      .eq('claim_id', claimId)
      .order('check_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest) throw new Error('Run eligibility check before calculation.');
    if (!latest.overall_result && !latest.override_applied) {
      throw new Error('Eligibility did not pass — supervisor override required before calculation.');
    }
  }

  const out = await runCalculationEngine({
    claimId: claim.id,
    ssn: claim.ssn,
    productId: claim.product_id,
    productVersionId: claim.product_version_id,
    claimDate: claim.claim_date,
    countryCode: 'SKN',
    mode: 'LIVE',
    triggeredBy: userCode,
  });

  const formula = out.formulaResult;
  const wage = out.wageAggregation;

  const { data: inserted, error: insErr } = await db
    .from('bn_claim_calculation')
    .insert({
      claim_id: claim.id,
      product_version_id: claim.product_version_id,
      weekly_rate: formula?.finalWeeklyRate ?? null,
      monthly_rate: formula?.finalMonthlyRate ?? null,
      lump_sum: formula?.finalLumpSum ?? null,
      annual_rate: formula?.finalAnnualAmount ?? null,
      average_weekly_wage: (wage as any)?.averageWeeklyWage ?? null,
      total_contributions: (out.contributionWindow as any)?.totalWeeks ?? null,
      qualifying_weeks: (out.contributionWindow as any)?.qualifyingWeeks ?? null,
      formula_code: (formula as any)?.formulaCode ?? null,
      formula_version: (formula as any)?.formulaVersion ?? null,
      inputs: { wageAggregation: wage, contributionWindow: out.contributionWindow },
      outputs: { formulaResult: formula, paymentSchedule: out.paymentSchedule, trace: out.trace.slice(0, 200) },
      entered_by: userCode,
    })
    .select('id')
    .single();
  if (insErr) throw insErr;

  return {
    calculationId: inserted.id,
    weeklyRate: formula?.finalWeeklyRate ?? null,
    monthlyRate: formula?.finalMonthlyRate ?? null,
    lumpSum: formula?.finalLumpSum ?? null,
    averageWeeklyWage: (wage as any)?.averageWeeklyWage ?? null,
  };
}

// ─── Decisions ──────────────────────────────────────────────────────

export type DecisionType = 'RECOMMENDATION' | 'APPROVED' | 'DENIED';

/**
 * `bn_claim_decision` action codes, taken from `bn_claim_transition_rule`,
 * which is the runtime source of truth for claim transitions.
 */
const DECISION_ACTION_CODE: Record<DecisionType, string> = {
  RECOMMENDATION: 'SUBMIT_DECISION',
  APPROVED: 'APPROVE',
  DENIED: 'DENY',
};

/**
 * Writes the decision row.
 *
 * This used to insert `decision_type`, `decision_date`, `decision_narrative`,
 * `reason_code`, `calculation_id`, `decided_by` and `entered_by` — none of
 * which exist on bn_claim_decision. Every insert therefore threw, so no claim
 * could be approved, denied, or submitted for decision at all. The real columns
 * are action_code / from_status / to_status / performed_by / performed_at /
 * narrative / reason_code_id, plus the snapshot columns below.
 *
 * The snapshots matter: they freeze WHICH eligibility result and WHICH
 * calculation the decision was taken against, so a later re-run cannot change
 * the basis of a decision already made.
 */
export async function createClaimDecision(args: {
  claimId: string;
  decisionType: DecisionType;
  userCode: string;
  narrative?: string;
  reasonCode?: string;
  fromStatus?: string;
  toStatus?: string;
}): Promise<{ id: string }> {
  const actionCode = DECISION_ACTION_CODE[args.decisionType];

  // Snapshot the evidence the decision rests on (best effort — the approval
  // preconditions are what REFUSE a decision; this only records the basis).
  const { data: latestCalc } = await db
    .from('bn_claim_calculation')
    .select('id')
    .eq('claim_id', args.claimId)
    .order('calc_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: latestElig } = await db
    .from('bn_claim_eligibility')
    .select('id')
    .eq('claim_id', args.claimId)
    .order('check_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  // reason_code_id is a foreign key; callers pass a human code, so resolve it.
  // An unresolvable code is left null rather than failing the decision — the
  // reason text is still carried in the narrative.
  let reasonCodeId: string | null = null;
  if (args.reasonCode) {
    const { data: rc } = await db
      .from('bn_reason_code')
      .select('id')
      .eq('reason_code', args.reasonCode)
      .maybeSingle();
    reasonCodeId = (rc as any)?.id ?? null;
  }

  const { data: claim } = await db
    .from('bn_claim')
    .select('status')
    .eq('id', args.claimId)
    .maybeSingle();

  const { data, error } = await db
    .from('bn_claim_decision')
    .insert({
      claim_id: args.claimId,
      action_code: actionCode,
      from_status: args.fromStatus ?? (claim as any)?.status ?? null,
      to_status: args.toStatus ?? null,
      narrative: args.narrative ?? null,
      reason_code_id: reasonCodeId,
      calculation_snapshot_id: latestCalc?.id ?? null,
      eligibility_snapshot_id: latestElig?.id ?? null,
      evidence_snapshot: {},
      performed_by: args.userCode,
      performed_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) throw error;

  // Mandatory audit: decision creation is a critical claim action.
  const { auditClaimAction } = await import('@/services/bn/audit/bnAuditService');
  await auditClaimAction({
    action:
      args.decisionType === 'APPROVED'
        ? 'APPROVE_CLAIM'
        : args.decisionType === 'DENIED'
          ? 'DENY_CLAIM'
          : 'SUBMIT_DECISION',
    entityType: 'bn_claim_decision',
    entityId: data.id,
    performedBy: args.userCode,
    afterValue: {
      claim_id: args.claimId,
      action_code: actionCode,
      reason_code_id: reasonCodeId,
      calculation_snapshot_id: latestCalc?.id ?? null,
      eligibility_snapshot_id: latestElig?.id ?? null,
    },
    notes: args.narrative ?? null,
    critical: true,
  });

  return { id: data.id };
}
