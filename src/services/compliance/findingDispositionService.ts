/**
 * Finding disposition (classification) service.
 *
 * Business rule (Prompt 3):
 *   Inspection -> Finding -> classify/evaluate -> Flag or Confirmed Violation
 *
 * Not every finding becomes a violation. A finding must be classified before
 * it can be converted, and the database (fn_ce_finding_conversion_guard)
 * enforces the same rule server-side, blocking duplicate conversions and
 * writing the audit trail to ce_audit_log.
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

export interface ConversionEligibility {
  allowed: boolean;
  reasons: string[];
  requiresReview: boolean;
}

/**
 * Read-side eligibility used to explain (rather than hide) the convert action.
 */
export function evaluateConversionEligibility(finding: {
  isViolationCreated?: boolean;
  violationId?: string;
  disposition?: FindingDisposition | string | null;
}): ConversionEligibility {
  const reasons: string[] = [];
  const disposition = (finding.disposition ?? 'PENDING_REVIEW') as FindingDisposition;

  if (finding.isViolationCreated || finding.violationId) {
    reasons.push('This finding has already been converted to a violation.');
  }
  if (disposition === 'INFORMATIONAL') {
    reasons.push('Finding is classified as informational only — no violation is required.');
  }
  const requiresReview = disposition === 'FLAG_FOR_REVIEW';
  if (requiresReview) {
    reasons.push('Finding is flagged for supervisor review — confirm it as a violation candidate first.');
  }

  return { allowed: reasons.length === 0, reasons, requiresReview };
}

async function currentUserCode(): Promise<string | undefined> {
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? data.user?.id;
}

export const findingDispositionService = {
  /**
   * Classify a finding. The DB trigger records the change in ce_audit_log.
   */
  async classify(
    findingId: string,
    disposition: Exclude<FindingDisposition, 'CONVERTED'>,
    reviewNotes?: string,
  ): Promise<void> {
    const userCode = await currentUserCode();
    const { error } = await supabase
      .from('ce_inspection_findings')
      .update({
        disposition,
        review_notes: reviewNotes ?? null,
        reviewed_by: userCode ?? null,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by: userCode ?? null,
      } as any)
      .eq('id', findingId);
    if (error) throw error;
  },

  /** Authoritative server-side check before opening the conversion wizard. */
  async assertConvertible(findingId: string): Promise<void> {
    const { data, error } = await supabase
      .from('ce_inspection_findings')
      .select('id, disposition, violation_created, violation_id')
      .eq('id', findingId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Finding no longer exists.');

    const eligibility = evaluateConversionEligibility({
      isViolationCreated: (data as any).violation_created,
      violationId: (data as any).violation_id ?? undefined,
      disposition: (data as any).disposition,
    });
    if (!eligibility.allowed) throw new Error(eligibility.reasons.join(' '));
  },
};
