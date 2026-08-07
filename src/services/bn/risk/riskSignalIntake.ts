/**
 * BN Risk / Fraud — governed producer boundary (EPIC 0).
 *
 * Business modules (Means-Test, Mortality, Payments, …) MUST NOT write to
 * `bn_risk_*` tables. They call one of the helpers below, which issue
 * `BN_RISK_GENERATE_SIGNAL` through the governed command boundary with a
 * deterministic de-duplication key derived from the source record. Repeated
 * hand-offs for the same source observation return the existing signal
 * (`status: 'DUPLICATE'`) instead of creating a second one.
 */
import {
  newRiskUuid,
  riskCommandService,
  type BnRiskCommandResult,
} from '@/services/bn/risk/riskCommandService';

export type BnRiskProducerModule =
  | 'BN_MEANS_TEST'
  | 'BN_MORTALITY'
  | 'BN_PAYMENT'
  | 'BN_CLAIM'
  | 'BN_AWARD'
  | 'BN_OVERPAYMENT'
  | 'IP'
  | 'EMPLOYER'
  | 'OTHER';

export interface BnRiskSignalHandoff {
  /** Owning module raising the observation. */
  readonly sourceModule: BnRiskProducerModule;
  /** Business event that produced it, e.g. `MEANS_VERIFICATION_MISMATCH`. */
  readonly sourceEventCode: string;
  /** Human-usable reference of the source record (assessment reference, …). */
  readonly sourceReference: string;
  /** Technical identifier of the source record, when one exists. */
  readonly sourceRecordId?: string | null;
  /** Version/revision of the source record so re-emission after a genuine
   *  change produces a new signal rather than a silent duplicate. */
  readonly sourceVersion?: string | number | null;
  readonly personId?: number | null;
  readonly claimId?: string | null;
  readonly awardId?: string | null;
  readonly paymentId?: string | null;
  readonly meansAssessmentId?: string | null;
  readonly categoryCode: string;
  readonly ruleCode?: string | null;
  readonly severityCode?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  readonly summary: string;
  /** Business-readable explanation of why this was raised. */
  readonly observation?: string | null;
  readonly observedOn?: string | null;
  readonly detectedAt?: string | null;
  readonly facts?: Record<string, unknown>;
  readonly evidenceReference?: string | null;
  readonly correlationId?: string;
}

function handoffPayload(handoff: BnRiskSignalHandoff): Record<string, unknown> {
  return {
    source_module: handoff.sourceModule,
    source_event_code: handoff.sourceEventCode,
    source_reference: handoff.sourceReference,
    source_record_id: handoff.sourceRecordId ?? null,
    source_version:
      handoff.sourceVersion === null || handoff.sourceVersion === undefined
        ? null
        : String(handoff.sourceVersion),
    person_id: handoff.personId ?? null,
    claim_id: handoff.claimId ?? null,
    award_id: handoff.awardId ?? null,
    payment_id: handoff.paymentId ?? null,
    means_assessment_id: handoff.meansAssessmentId ?? null,
    category_code: handoff.categoryCode,
    rule_code: handoff.ruleCode ?? null,
    severity_code: handoff.severityCode ?? null,
    summary: handoff.summary,
    observation: handoff.observation ?? null,
    observed_on: handoff.observedOn ?? null,
    detected_at: handoff.detectedAt ?? null,
    facts: handoff.facts ?? {},
    evidence_reference: handoff.evidenceReference ?? null,
  };
}

/**
 * Governed hand-off used by every producing module. The backend derives the
 * de-duplication key from source module, source reference, person, category,
 * rule and source version, so callers do not have to manage duplicates.
 */
export async function raiseRiskSignal(
  handoff: BnRiskSignalHandoff,
): Promise<BnRiskCommandResult> {
  return riskCommandService.execute({
    command: 'BN_RISK_GENERATE_SIGNAL',
    payload: handoffPayload(handoff),
    correlationId: handoff.correlationId ?? newRiskUuid(),
  });
}

/** Means-Test hand-off (undeclared income, asset inconsistency, …). */
export async function raiseMeansTestRiskSignal(
  handoff: Omit<BnRiskSignalHandoff, 'sourceModule'>,
): Promise<BnRiskCommandResult> {
  return raiseRiskSignal({ ...handoff, sourceModule: 'BN_MEANS_TEST' });
}

/** Mortality hand-off (date-of-death conflict, payment after death, …). */
export async function raiseMortalityRiskSignal(
  handoff: Omit<BnRiskSignalHandoff, 'sourceModule'>,
): Promise<BnRiskCommandResult> {
  return raiseRiskSignal({ ...handoff, sourceModule: 'BN_MORTALITY' });
}

/** Payments hand-off (shared bank account, redirection, anomalies, …). */
export async function raisePaymentRiskSignal(
  handoff: Omit<BnRiskSignalHandoff, 'sourceModule'>,
): Promise<BnRiskCommandResult> {
  return raiseRiskSignal({ ...handoff, sourceModule: 'BN_PAYMENT' });
}

export const riskSignalIntake = {
  raiseRiskSignal,
  raiseMeansTestRiskSignal,
  raiseMortalityRiskSignal,
  raisePaymentRiskSignal,
};
