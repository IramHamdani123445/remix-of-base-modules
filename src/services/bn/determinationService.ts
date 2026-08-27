/**
 * Benefit Determination Service
 * 
 * Business Purpose:
 *   Supports benefit application review, rule versioning, eligibility validation,
 *   calculation execution, explanation, and decision preparation.
 * 
 * Existing tables used:
 *   - bn_claim (claim context)
 *   - bn_product / bn_product_version (rule versioning)
 *   - bn_eligibility_rule / bn_calculation_rule / bn_timeline_rule (rules)
 *   - bn_claim_eligibility (eligibility results)
 *   - bn_claim_calculation (calc snapshots)
 *   - bn_claim_decision (decisions)
 *   - bn_claim_event (audit trail)
 *   - bn_claim_evidence (evidence state)
 *   - ip_master / er_master (via adapters)
 * 
 * OUTBOUND PAYMENTS: cl_cheques only. cn_payment* NEVER used.
 * Approval here does NOT directly issue payment — it marks APPROVE_READY.
 */
import { supabase } from '@/integrations/supabase/client';
import type { BnClaim, BnProduct, BnProductVersion, BnClaimDecision } from '@/types/bn';
import type { BnCalcEngineOutput } from '@/types/bnCalcEngine';

const db = supabase as any;

// ─── Types ──────────────────────────────────────────────────────────

export interface DeterminationContext {
  claim: BnClaim;
  product: BnProduct | null;
  productVersion: BnProductVersion | null;
  eligibilityResults: EligibilitySnapshot[];
  calculationSnapshots: CalculationSnapshot[];
  warnings: DeterminationWarning[];
  decisions: BnClaimDecision[];
  linkedClaims: LinkedClaimRef[];
  evidenceSummary: EvidenceSummary;
  contributionSummary: ContributionSummary | null;
}

export interface EligibilitySnapshot {
  id: string;
  claim_id: string;
  product_version_id: string | null;
  check_date: string;
  overall_result: boolean;
  rule_results: Record<string, unknown>[];
  override_applied: boolean;
  override_reason: string | null;
  override_by: string | null;
  performed_by: string;
  notes: string | null;
}

export interface CalculationSnapshot {
  id: string;
  claim_id: string;
  calc_run_id: string | null;
  product_version_id: string | null;
  calc_date: string;
  calc_type: string;
  input_params: Record<string, unknown>;
  output_summary: Record<string, unknown>;
  weekly_rate: number | null;
  lump_sum: number | null;
  total_payable: number | null;
  duration_weeks: number | null;
  status: string;
  performed_by: string;
  notes: string | null;
  lines: CalculationLine[];
}

export interface CalculationLine {
  id: string;
  calculation_id: string;
  line_number: number;
  line_code: string;
  line_label: string;
  formula_expression: string | null;
  input_values: Record<string, unknown>;
  output_value: number;
  explanation: string | null;
}

export interface DeterminationWarning {
  code: string;
  severity: 'INFO' | 'WARN' | 'ERROR' | 'BLOCK';
  message: string;
  source: string; // eligibility, calculation, evidence, contribution, rule
  actionRequired: boolean;
  suggestedAction?: string;
}

export interface LinkedClaimRef {
  id: string;
  claim_number: string | null;
  status: string;
  benefit_type: string;
  claim_date: string;
  relationship: string;
}

export interface EvidenceSummary {
  total: number;
  verified: number;
  pending: number;
  rejected: number;
  missing: number;
  complete: boolean;
}

export interface ContributionSummary {
  ssn: string;
  totalWeeks: number;
  totalAmount: number;
  averageWeeklyWage: number;
  windowStart: string;
  windowEnd: string;
}

export interface DeterminationAction {
  action: string;
  label: string;
  icon?: string;
  requiresNarrative: boolean;
  requiresReasonCode: boolean;
  preconditions: string[];
  auditEvent: string;
  workflowEffect: string;
  notificationTrigger: string | null;
}

// ─── Actions Definition ─────────────────────────────────────────────

export const DETERMINATION_ACTIONS: DeterminationAction[] = [
  {
    action: 'CALCULATE',
    label: 'Calculate',
    icon: 'Calculator',
    requiresNarrative: false,
    requiresReasonCode: false,
    preconditions: ['eligibility_checked'],
    auditEvent: 'determination.calculated',
    workflowEffect: 'Stores calc snapshot; claim stays in CALCULATION',
    notificationTrigger: null,
  },
  {
    action: 'RECALCULATE',
    label: 'Recalculate',
    icon: 'RefreshCw',
    requiresNarrative: true,
    requiresReasonCode: false,
    preconditions: ['has_previous_calculation'],
    auditEvent: 'determination.recalculated',
    workflowEffect: 'Creates new calc snapshot; supersedes previous',
    notificationTrigger: null,
  },
  {
    action: 'RECOMMEND',
    label: 'Recommend',
    icon: 'ThumbsUp',
    requiresNarrative: true,
    requiresReasonCode: false,
    preconditions: ['has_calculation', 'evidence_complete'],
    auditEvent: 'determination.recommended',
    workflowEffect: 'Sets claim to DECISION status for supervisor review',
    notificationTrigger: 'claim.recommended',
  },
  {
    action: 'APPROVE_READY',
    label: 'Mark Approve-Ready',
    icon: 'CheckCircle',
    requiresNarrative: true,
    requiresReasonCode: false,
    preconditions: ['has_calculation', 'evidence_complete', 'eligibility_passed'],
    auditEvent: 'determination.approve_ready',
    workflowEffect: 'Sets claim to APPROVED; does NOT issue payment',
    notificationTrigger: 'claim.approved',
  },
  {
    action: 'DISALLOW_READY',
    label: 'Mark Disallow-Ready',
    icon: 'XCircle',
    requiresNarrative: true,
    requiresReasonCode: true,
    preconditions: ['has_eligibility_check'],
    auditEvent: 'determination.disallow_ready',
    workflowEffect: 'Sets claim to DENIED status',
    notificationTrigger: 'claim.denied',
  },
  {
    action: 'REQUEST_EVIDENCE',
    label: 'Request Evidence',
    icon: 'FileSearch',
    requiresNarrative: true,
    requiresReasonCode: false,
    preconditions: [],
    auditEvent: 'determination.evidence_requested',
    workflowEffect: 'Sets claim to PENDING_INFO',
    notificationTrigger: 'claim.evidence_requested',
  },
  {
    action: 'OVERRIDE',
    label: 'Override with Reason',
    icon: 'ShieldAlert',
    requiresNarrative: true,
    requiresReasonCode: true,
    preconditions: ['role_supervisor_or_admin'],
    auditEvent: 'determination.overridden',
    workflowEffect: 'Creates override record; requires approval',
    notificationTrigger: 'claim.override_requested',
  },
];

// ─── Fetch Full Determination Context ────────────────────────────────

export async function fetchDeterminationContext(claimId: string): Promise<DeterminationContext> {
  // Parallel fetches for all determination data
  const [
    claimRes,
    eligRes,
    calcRes,
    decisionRes,
    linkedRes,
    evidenceRes,
  ] = await Promise.all([
    db.from('bn_claim')
      .select('*, bn_product(*), bn_product_version:product_version_id(*)')
      .eq('id', claimId)
      .single(),
    db.from('bn_claim_eligibility')
      .select('*')
      .eq('claim_id', claimId)
      .order('check_date', { ascending: false }),
    db.from('bn_claim_calculation')
      .select('*, bn_claim_calculation_line(*)')
      .eq('claim_id', claimId)
      .order('calc_date', { ascending: false }),
    db.from('bn_claim_decision')
      .select('*, bn_reason_code(*)')
      .eq('claim_id', claimId)
      .order('performed_at', { ascending: false }),
    fetchLinkedForDetermination(claimId),
    fetchEvidenceSummary(claimId),
  ]);

  if (claimRes.error) throw claimRes.error;

  const claim = claimRes.data;
  const product = claim?.bn_product || null;
  const productVersion = claim?.bn_product_version || null;

  // Map eligibility
  const eligibilityResults: EligibilitySnapshot[] = (eligRes.data ?? []).map((e: any) => ({
    id: e.id,
    claim_id: e.claim_id,
    product_version_id: e.product_version_id,
    check_date: e.check_date,
    overall_result: e.overall_result,
    rule_results: e.rule_results ?? [],
    override_applied: e.override_applied ?? false,
    override_reason: e.override_reason,
    override_by: e.override_by,
    performed_by: e.performed_by ?? '',
    notes: e.notes,
  }));

  // Map calc snapshots with lines
  const calculationSnapshots: CalculationSnapshot[] = (calcRes.data ?? []).map((c: any) => ({
    id: c.id,
    claim_id: c.claim_id,
    calc_run_id: c.calc_run_id,
    product_version_id: c.product_version_id,
    calc_date: c.calc_date,
    calc_type: c.calc_type ?? 'STANDARD',
    input_params: c.input_params ?? {},
    output_summary: c.output_summary ?? {},
    weekly_rate: c.weekly_rate,
    lump_sum: c.lump_sum,
    total_payable: c.total_payable,
    duration_weeks: c.duration_weeks,
    status: c.status ?? 'COMPLETED',
    performed_by: c.performed_by ?? '',
    notes: c.notes,
    lines: (c.bn_claim_calculation_line ?? []).map((l: any) => ({
      id: l.id,
      calculation_id: l.calculation_id,
      line_number: l.line_number ?? 0,
      line_code: l.line_code ?? '',
      line_label: l.line_label ?? '',
      formula_expression: l.formula_expression,
      input_values: l.input_values ?? {},
      output_value: l.output_value ?? 0,
      explanation: l.explanation,
    })),
  }));

  // Generate warnings
  const warnings = generateWarnings(claim, eligibilityResults, calculationSnapshots, evidenceRes);

  // Contribution summary from claim metadata
  let contributionSummary: ContributionSummary | null = null;
  if (claim.ssn) {
    try {
      const contribRes = await db.rpc('bn_get_contribution_summary', {
        p_ssn: claim.ssn.trim(),
        p_window_start: new Date(new Date().setFullYear(new Date().getFullYear() - 3)).toISOString().split('T')[0],
        p_window_end: new Date().toISOString().split('T')[0],
      });
      if (contribRes.data) {
        const row = Array.isArray(contribRes.data) ? contribRes.data[0] : contribRes.data;
        contributionSummary = {
          ssn: claim.ssn,
          totalWeeks: row?.total_weeks ?? 0,
          totalAmount: row?.total_amount ?? 0,
          averageWeeklyWage: row?.avg_weekly_wage ?? 0,
          windowStart: new Date(new Date().setFullYear(new Date().getFullYear() - 3)).toISOString().split('T')[0],
          windowEnd: new Date().toISOString().split('T')[0],
        };
      }
    } catch {
      // Contribution data optional
    }
  }

  return {
    claim,
    product,
    productVersion,
    eligibilityResults,
    calculationSnapshots,
    warnings,
    decisions: decisionRes.data ?? [],
    linkedClaims: linkedRes,
    evidenceSummary: evidenceRes,
    contributionSummary,
  };
}

// ─── Evidence Summary ─────────────────────────────────────────────

async function fetchEvidenceSummary(claimId: string): Promise<EvidenceSummary> {
  const { data, error } = await db
    .from('bn_claim_evidence')
    .select('status')
    .eq('claim_id', claimId);

  if (error || !data) return { total: 0, verified: 0, pending: 0, rejected: 0, missing: 0, complete: false };

  const total = data.length;
  const verified = data.filter((e: any) => e.status === 'VERIFIED').length;
  const pending = data.filter((e: any) => ['PENDING', 'UPLOADED'].includes(e.status)).length;
  const rejected = data.filter((e: any) => e.status === 'REJECTED').length;
  const missing = data.filter((e: any) => e.status === 'MISSING').length;

  return { total, verified, pending, rejected, missing, complete: missing === 0 && pending === 0 && rejected === 0 && total > 0 };
}

// ─── Linked Claims ───────────────────────────────────────────────

async function fetchLinkedForDetermination(claimId: string): Promise<LinkedClaimRef[]> {
  // Get current claim SSN
  const { data: claim } = await db.from('bn_claim').select('ssn, parent_claim_id').eq('id', claimId).single();
  if (!claim?.ssn) return [];

  const { data, error } = await db
    .from('bn_claim')
    .select('id, claim_number, status, claim_date, legacy_benefit_type, bn_product(benefit_name)')
    .eq('ssn', claim.ssn)
    .neq('id', claimId)
    .order('claim_date', { ascending: false })
    .limit(10);

  if (error) return [];

  return (data ?? []).map((c: any) => ({
    id: c.id,
    claim_number: c.claim_number,
    status: c.status,
    benefit_type: c.bn_product?.benefit_name || c.legacy_benefit_type || 'Unknown',
    claim_date: c.claim_date,
    relationship: c.id === claim.parent_claim_id ? 'PARENT' : 'SIBLING',
  }));
}

// ─── Warning Generation ──────────────────────────────────────────

function generateWarnings(
  claim: any,
  eligibility: EligibilitySnapshot[],
  calculations: CalculationSnapshot[],
  evidence: EvidenceSummary
): DeterminationWarning[] {
  const warnings: DeterminationWarning[] = [];

  // No eligibility check yet
  if (eligibility.length === 0) {
    warnings.push({
      code: 'NO_ELIGIBILITY',
      severity: 'WARN',
      message: 'No eligibility check has been performed for this claim.',
      source: 'eligibility',
      actionRequired: true,
      suggestedAction: 'Run eligibility check before proceeding.',
    });
  }

  // Eligibility failed
  const latestElig = eligibility[0];
  if (latestElig && !latestElig.overall_result && !latestElig.override_applied) {
    warnings.push({
      code: 'ELIGIBILITY_FAILED',
      severity: 'ERROR',
      message: 'Claimant did not pass eligibility requirements.',
      source: 'eligibility',
      actionRequired: true,
      suggestedAction: 'Review failed rules or apply override with supervisor approval.',
    });
  }

  // No calculation
  if (calculations.length === 0 && ['CALCULATION', 'DECISION', 'APPROVED'].includes(claim.status)) {
    warnings.push({
      code: 'NO_CALCULATION',
      severity: 'WARN',
      message: 'No benefit calculation has been performed.',
      source: 'calculation',
      actionRequired: true,
      suggestedAction: 'Run calculation engine.',
    });
  }

  // Missing evidence
  if (evidence.missing > 0) {
    warnings.push({
      code: 'MISSING_EVIDENCE',
      severity: 'WARN',
      message: `${evidence.missing} required document(s) are missing.`,
      source: 'evidence',
      actionRequired: true,
      suggestedAction: 'Request missing documents from claimant.',
    });
  }

  // Pending evidence
  if (evidence.pending > 0) {
    warnings.push({
      code: 'PENDING_EVIDENCE',
      severity: 'INFO',
      message: `${evidence.pending} document(s) pending verification.`,
      source: 'evidence',
      actionRequired: false,
    });
  }

  // Rejected evidence
  if (evidence.rejected > 0) {
    warnings.push({
      code: 'REJECTED_EVIDENCE',
      severity: 'ERROR',
      message: `${evidence.rejected} document(s) were rejected.`,
      source: 'evidence',
      actionRequired: true,
      suggestedAction: 'Request re-submission of rejected documents.',
    });
  }

  // Priority escalation
  if (claim.priority === 'URGENT') {
    warnings.push({
      code: 'URGENT_PRIORITY',
      severity: 'WARN',
      message: 'This claim has URGENT priority.',
      source: 'rule',
      actionRequired: false,
    });
  }

  return warnings;
}

// ─── Execute Determination Action ────────────────────────────────

export interface ExecuteDeterminationParams {
  claimId: string;
  action: string;
  narrative?: string;
  reasonCodeId?: string;
  performedBy: string;
  overrideField?: string;
  overrideValue?: unknown;
  overrideJustification?: string;
}

export async function executeDeterminationAction(params: ExecuteDeterminationParams): Promise<{ success: boolean; newStatus?: string }> {
  const { claimId, action, narrative, reasonCodeId, performedBy } = params;

  // Fetch current claim
  const { data: claim, error: claimErr } = await db
    .from('bn_claim')
    .select('id, status')
    .eq('id', claimId)
    .single();

  if (claimErr || !claim) throw new Error('Claim not found');

  const statusMap: Record<string, string> = {
    'RECOMMEND': 'DECISION',
    'APPROVE_READY': 'APPROVED',
    'DISALLOW_READY': 'DENIED',
    'REQUEST_EVIDENCE': 'PENDING_INFO',
  };

  const newStatus = statusMap[action];

  // If status transition needed
  if (newStatus) {
    // Update claim status
    const { error: updateErr } = await db
      .from('bn_claim')
      .update({ status: newStatus, modified_by: performedBy, modified_at: new Date().toISOString() })
      .eq('id', claimId);

    if (updateErr) throw updateErr;

    // Create decision record
    await db.from('bn_claim_decision').insert({
      claim_id: claimId,
      action_code: action,
      from_status: claim.status,
      to_status: newStatus,
      reason_code_id: reasonCodeId || null,
      narrative: narrative || null,
      performed_by: performedBy,
      performed_at: new Date().toISOString(),
      evidence_snapshot: {},
    });

    // Create audit event
    await db.from('bn_claim_event').insert({
      claim_id: claimId,
      event_type: `DETERMINATION_${action}`,
      from_status: claim.status,
      to_status: newStatus,
      notes: narrative || `Determination action: ${action}`,
      performed_by: performedBy,
      performed_at: new Date().toISOString(),
    });

    // Create long-term award if product is configured for it (non-blocking)
    if (newStatus === 'APPROVED') {
      try {
        const { createAwardOnApproval } = await import('@/services/bn/awards/awardCreationService');
        await createAwardOnApproval(claimId, performedBy);
      } catch (e) {
        console.warn('[determinationService] award creation skipped:', e);
      }
    }
  } else {
    // Non-status-changing action (CALCULATE, RECALCULATE, OVERRIDE)
    await db.from('bn_claim_event').insert({
      claim_id: claimId,
      event_type: `DETERMINATION_${action}`,
      notes: narrative || `Determination action: ${action}`,
      performed_by: performedBy,
      performed_at: new Date().toISOString(),
    });
  }

  return { success: true, newStatus };
}

// ─── Fetch Rule Version for Display ──────────────────────────────

export async function fetchActiveRuleVersion(productVersionId: string): Promise<{
  eligibilityRules: any[];
  calculationRules: any[];
  timelineRules: any[];
  version: any;
}> {
  const [verRes, eligRes, calcRes, timeRes] = await Promise.all([
    db.from('bn_product_version').select('*').eq('id', productVersionId).single(),
    db.from('bn_eligibility_rule').select('*').eq('product_version_id', productVersionId).eq('is_active', true).order('sort_order'),
    db.from('bn_calculation_rule').select('*').eq('product_version_id', productVersionId).eq('is_active', true).order('sort_order'),
    db.from('bn_timeline_rule').select('*').eq('product_version_id', productVersionId).eq('is_active', true).order('sort_order'),
  ]);

  return {
    version: verRes.data,
    eligibilityRules: eligRes.data ?? [],
    calculationRules: calcRes.data ?? [],
    timelineRules: timeRes.data ?? [],
  };
}

// ─── Save Calculation Snapshot ───────────────────────────────────

export async function saveCalculationSnapshot(
  claimId: string,
  calcOutput: BnCalcEngineOutput,
  performedBy: string
): Promise<string> {
  const snapshotData = {
    claim_id: claimId,
    calc_run_id: calcOutput.runId,
    calc_date: new Date().toISOString(),
    calc_type: 'ENGINE',
    input_params: calcOutput.variables ?? {},
    output_summary: {
      eligibility: calcOutput.eligibility,
      contributionWindow: calcOutput.contributionWindow,
      wageAggregation: calcOutput.wageAggregation,
      formulaResult: calcOutput.formulaResult,
      validation: calcOutput.validation,
    },
    weekly_rate: calcOutput.formulaResult?.finalWeeklyRate ?? calcOutput.formulaResult?.rawResult ?? null,
    lump_sum: calcOutput.formulaResult?.finalLumpSum ?? null,
    total_payable: calcOutput.formulaResult?.finalWeeklyRate ?? calcOutput.formulaResult?.rawResult ?? null,
    duration_weeks: calcOutput.contributionWindow?.totalWeeks ?? null,
    status: calcOutput.status === 'COMPLETED' ? 'ACTIVE' : 'FAILED',
    performed_by: performedBy,
  };

  const { data, error } = await db
    .from('bn_claim_calculation')
    .insert(snapshotData)
    .select('id')
    .single();

  if (error) throw error;

  // Save calculation lines from trace
  if (calcOutput.formulaResult?.steps?.length) {
    const lines = calcOutput.formulaResult.steps.map((step, i) => ({
      calculation_id: data.id,
      line_number: i + 1,
      line_code: `STEP_${step.stepNumber ?? i + 1}`,
      line_label: step.description || `Step ${i + 1}`,
      formula_expression: step.formula || null,
      input_values: step.inputs ?? {},
      output_value: step.result ?? 0,
      explanation: step.description || null,
    }));

    await db.from('bn_claim_calculation_line').insert(lines);
  }

  return data.id;
}
