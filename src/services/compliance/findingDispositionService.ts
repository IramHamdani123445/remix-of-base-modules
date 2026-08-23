/**
 * Finding disposition (classification) service.
 *
 * Business rule (Prompt 3 closure):
 *   Inspection Finding
 *     -> classify candidate violation type
 *     -> read Violation Type configuration (ce_violation_types)
 *     -> informational only / flag for review / supervisor review / direct conversion
 *     -> authorised action
 *     -> ce_violations
 *
 * NO policy is hardcoded here: review-first, supervisor review and maker-checker
 * behaviour all come from ce_violation_types configuration. The database
 * (fn_ce_finding_conversion_guard) enforces the same policy server-side and
 * writes the audit trail to ce_audit_log.
 */
import { supabase } from '@/integrations/supabase/client';

export type FindingDisposition =
  | 'PENDING_REVIEW'
  | 'INFORMATIONAL'
  | 'FLAG_FOR_REVIEW'
  | 'VIOLATION_CANDIDATE'
  | 'CONVERTED';

export const DISPOSITION_LABELS: Record<FindingDisposition, string> = {
  PENDING_REVIEW: 'Pending review',
  INFORMATIONAL: 'Informational only',
  FLAG_FOR_REVIEW: 'Flagged for supervisor review',
  VIOLATION_CANDIDATE: 'Violation candidate',
  CONVERTED: 'Converted to violation',
};

export type ConversionPolicyCode = 'DIRECT' | 'REVIEW_REQUIRED' | 'INFORMATIONAL_ONLY';

export interface ViolationTypePolicy {
  id: string;
  code: string;
  name: string;
  conversionPolicy: ConversionPolicyCode;
  requiresSupervisorReview: boolean;
  makerCheckerRequired: boolean;
  inspectionEligible: boolean;
}

/** Policy applied when a finding has no classified candidate violation type yet. */
const UNCLASSIFIED_POLICY: Omit<ViolationTypePolicy, 'id' | 'code' | 'name'> = {
  conversionPolicy: 'DIRECT',
  requiresSupervisorReview: false,
  makerCheckerRequired: false,
  inspectionEligible: true,
};

export interface ConversionEligibility {
  allowed: boolean;
  reasons: string[];
  requiresReview: boolean;
  policy: ConversionPolicyCode;
  makerCheckerRequired: boolean;
}

function mapPolicyRow(row: any): ViolationTypePolicy {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    conversionPolicy: (row.conversion_policy ?? 'DIRECT') as ConversionPolicyCode,
    requiresSupervisorReview: !!row.requires_supervisor_review,
    makerCheckerRequired: !!row.maker_checker_required,
    inspectionEligible: row.inspection_eligible !== false,
  };
}

/**
 * Read-side eligibility used to explain (rather than hide) the convert action.
 * `policy` is the configuration of the finding's candidate violation type.
 */
export function evaluateConversionEligibility(
  finding: {
    isViolationCreated?: boolean;
    violationId?: string;
    disposition?: FindingDisposition | string | null;
  },
  policy?: Partial<ViolationTypePolicy> | null,
): ConversionEligibility {
  const reasons: string[] = [];
  const disposition = (finding.disposition ?? 'PENDING_REVIEW') as FindingDisposition;
  const conversionPolicy = (policy?.conversionPolicy ?? UNCLASSIFIED_POLICY.conversionPolicy) as ConversionPolicyCode;
  const inspectionEligible = policy?.inspectionEligible ?? UNCLASSIFIED_POLICY.inspectionEligible;
  const makerCheckerRequired = policy?.makerCheckerRequired ?? false;

  if (finding.isViolationCreated || finding.violationId) {
    reasons.push('This finding has already been converted to a violation.');
  }
  if (disposition === 'INFORMATIONAL') {
    reasons.push('Finding is classified as informational only — no violation is required.');
  }
  if (conversionPolicy === 'INFORMATIONAL_ONLY' || !inspectionEligible) {
    reasons.push('The configured violation type does not allow inspection findings to become violations.');
  }

  const requiresReview =
    conversionPolicy === 'REVIEW_REQUIRED' && disposition !== 'VIOLATION_CANDIDATE';
  if (requiresReview) {
    reasons.push(
      makerCheckerRequired
        ? 'This violation type is review-first — an independent supervisor must confirm it as a violation candidate.'
        : 'This violation type is review-first — confirm the finding as a violation candidate first.',
    );
  }
  if (conversionPolicy !== 'REVIEW_REQUIRED' && disposition === 'FLAG_FOR_REVIEW') {
    reasons.push('Finding is flagged for review — confirm it as a violation candidate first.');
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    requiresReview,
    policy: conversionPolicy,
    makerCheckerRequired,
  };
}

async function currentUserCode(): Promise<string | undefined> {
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? data.user?.id;
}

export const findingDispositionService = {
  /** Active violation types that may be raised from an inspection finding. */
  async listInspectionViolationTypes(): Promise<ViolationTypePolicy[]> {
    const { data, error } = await supabase
      .from('ce_violation_types')
      .select('id, code, name, conversion_policy, requires_supervisor_review, maker_checker_required, inspection_eligible')
      .eq('is_active', true)
      .order('name');
    if (error) throw error;
    return (data ?? []).map(mapPolicyRow).filter((t) => t.inspectionEligible);
  },

  /** Policy of a single violation type. */
  async getPolicy(violationTypeId?: string | null): Promise<ViolationTypePolicy | null> {
    if (!violationTypeId) return null;
    const { data, error } = await supabase
      .from('ce_violation_types')
      .select('id, code, name, conversion_policy, requires_supervisor_review, maker_checker_required, inspection_eligible')
      .eq('id', violationTypeId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapPolicyRow(data) : null;
  },

  /**
   * Resolve the applicable policy for a set of findings, keyed by finding id.
   * Findings with no classified candidate type are omitted (unclassified default).
   */
  async loadPoliciesForFindings(findingIds: string[]): Promise<Record<string, ViolationTypePolicy>> {
    const ids = findingIds.filter(Boolean);
    if (ids.length === 0) return {};
    const { data, error } = await supabase
      .from('ce_inspection_findings')
      .select('id, candidate_violation_type_id')
      .in('id', ids);
    if (error) throw error;

    const typeIds = Array.from(
      new Set((data ?? []).map((r: any) => r.candidate_violation_type_id).filter(Boolean)),
    ) as string[];
    if (typeIds.length === 0) return {};

    const { data: types, error: typeError } = await supabase
      .from('ce_violation_types')
      .select('id, code, name, conversion_policy, requires_supervisor_review, maker_checker_required, inspection_eligible')
      .in('id', typeIds);
    if (typeError) throw typeError;

    const byType = new Map(((types ?? []) as any[]).map((t) => [t.id, mapPolicyRow(t)]));
    const result: Record<string, ViolationTypePolicy> = {};
    for (const row of (data ?? []) as any[]) {
      const policy = row.candidate_violation_type_id ? byType.get(row.candidate_violation_type_id) : undefined;
      if (policy) result[row.id] = policy;
    }
    return result;
  },

  /**
   * Classify a finding, optionally recording the candidate violation type that
   * drives conversion policy. The DB trigger records the change in ce_audit_log
   * and enforces maker-checker where the violation type requires it.
   */
  async classify(
    findingId: string,
    disposition: Exclude<FindingDisposition, 'CONVERTED'>,
    reviewNotes?: string,
    candidateViolationTypeId?: string | null,
  ): Promise<void> {
    const userCode = await currentUserCode();
    const patch: Record<string, unknown> = {
      disposition,
      review_notes: reviewNotes ?? null,
      reviewed_by: userCode ?? null,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updated_by: userCode ?? null,
    };
    if (candidateViolationTypeId !== undefined) {
      patch.candidate_violation_type_id = candidateViolationTypeId;
    }
    const { error } = await supabase
      .from('ce_inspection_findings')
      .update(patch as any)
      .eq('id', findingId);
    if (error) throw error;
  },

  /** Authoritative server-side check before opening the conversion wizard. */
  async assertConvertible(findingId: string): Promise<void> {
    const { data, error } = await supabase
      .from('ce_inspection_findings')
      .select('id, disposition, violation_created, violation_id, candidate_violation_type_id')
      .eq('id', findingId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Finding no longer exists.');

    const policy = await this.getPolicy((data as any).candidate_violation_type_id);
    const eligibility = evaluateConversionEligibility(
      {
        isViolationCreated: (data as any).violation_created,
        violationId: (data as any).violation_id ?? undefined,
        disposition: (data as any).disposition,
      },
      policy,
    );
    if (!eligibility.allowed) throw new Error(eligibility.reasons.join(' '));
  },
};
