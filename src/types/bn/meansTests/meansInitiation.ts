/**
 * MEANS-TEST EPIC 1 — assessment initiation contract.
 *
 * Pure, dependency-free description of the guided initiation process:
 * entry contexts, wizard steps, the draft an officer builds, and the
 * mapping from backend reason codes onto the step that can fix them.
 *
 * NOTHING here decides whether an assessment may be created. That single
 * decision belongs to `bn_means_initiation_check_v1`; the client only
 * decides which step is still incomplete so the officer is not sent to
 * the review step with an empty form.
 */

/* ------------------------------------------------------------------ */
/* entry contexts                                                      */
/* ------------------------------------------------------------------ */

export type BnMeansEntryContextCode =
  | 'STANDALONE_ASSESSMENT'
  | 'NEW_CLAIM_ASSESSMENT'
  | 'EXISTING_CLAIM_REVIEW'
  | 'EXISTING_AWARD_REVIEW';

export interface BnMeansEntryContextDefinition {
  readonly code: BnMeansEntryContextCode;
  readonly label: string;
  readonly description: string;
  readonly requiresClaim: boolean;
  readonly requiresAward: boolean;
  /** Reasons the officer may choose in this context. */
  readonly allowedReasons: readonly string[];
  readonly defaultReason: string;
}

export const MEANS_ENTRY_CONTEXTS: readonly BnMeansEntryContextDefinition[] = [
  {
    code: 'NEW_CLAIM_ASSESSMENT',
    label: 'Assessment for a new claim',
    description: 'The person has applied for a benefit and the claim needs a means test before a decision.',
    requiresClaim: true,
    requiresAward: false,
    allowedReasons: ['NEW_CLAIM', 'INITIAL_ASSESSMENT'],
    defaultReason: 'NEW_CLAIM',
  },
  {
    code: 'EXISTING_CLAIM_REVIEW',
    label: 'Review linked to an existing claim',
    description: 'A claim already exists and its means test must be repeated or corrected.',
    requiresClaim: true,
    requiresAward: false,
    allowedReasons: ['CHANGE_OF_CIRCUMSTANCE', 'DATA_CORRECTION', 'APPEAL_DIRECTION', 'COMPLIANCE_REVIEW'],
    defaultReason: 'CHANGE_OF_CIRCUMSTANCE',
  },
  {
    code: 'EXISTING_AWARD_REVIEW',
    label: 'Review of an award in payment',
    description: 'A benefit is already in payment and the household’s means must be reassessed.',
    requiresClaim: false,
    requiresAward: true,
    allowedReasons: [
      'ANNUAL_REVIEW',
      'AWARD_REVIEW',
      'CHANGE_OF_CIRCUMSTANCE',
      'POLICY_DIRECTED_REVIEW',
      'COMPLIANCE_REVIEW',
      'APPEAL_DIRECTION',
    ],
    defaultReason: 'AWARD_REVIEW',
  },
  {
    code: 'STANDALONE_ASSESSMENT',
    label: 'Standalone assessment',
    description: 'A means test that is not yet tied to a claim or an award.',
    requiresClaim: false,
    requiresAward: false,
    allowedReasons: ['INITIAL_ASSESSMENT', 'CHANGE_OF_CIRCUMSTANCE', 'COMPLIANCE_REVIEW', 'DATA_CORRECTION'],
    defaultReason: 'INITIAL_ASSESSMENT',
  },
];

export function meansEntryContext(
  code: BnMeansEntryContextCode | string | null | undefined,
): BnMeansEntryContextDefinition | undefined {
  return MEANS_ENTRY_CONTEXTS.find((c) => c.code === code);
}

/** Reasons permitted for one entry context (empty when the context is unknown). */
export function reasonCodesForContext(
  code: BnMeansEntryContextCode | string | null | undefined,
): readonly string[] {
  return meansEntryContext(code)?.allowedReasons ?? [];
}

/* ------------------------------------------------------------------ */
/* backend read shapes                                                 */
/* ------------------------------------------------------------------ */

export interface BnMeansPersonSearchRow {
  readonly person_id: number | null;
  readonly full_name: string;
  /** Masked identifier — the raw SSN is never returned to the browser. */
  readonly masked_identifier: string | null;
  readonly date_of_birth: string | null;
  readonly address_summary: string | null;
  readonly person_status: string | null;
  readonly is_deceased: boolean;
  readonly open_claim_count: number;
  readonly active_award_count: number;
}

export interface BnMeansPersonClaimRow {
  readonly claim_id: string;
  readonly claim_reference: string | null;
  readonly benefit_programme: string | null;
  readonly programme_label: string | null;
  readonly claim_status: string | null;
  readonly claim_date: string | null;
  readonly effective_date: string | null;
  readonly existing_assessment_reference: string | null;
}

export interface BnMeansPersonAwardRow {
  readonly award_id: string;
  readonly award_reference: string | null;
  readonly benefit_programme: string | null;
  readonly programme_label: string | null;
  readonly award_status: string | null;
  readonly start_date: string | null;
  readonly end_date: string | null;
  readonly claim_id: string | null;
  readonly payment_frequency: string | null;
  readonly next_review_date: string | null;
  readonly existing_assessment_reference: string | null;
}

export interface BnMeansPersonAssessmentRow {
  readonly assessment_id: string;
  readonly assessment_reference: string;
  readonly benefit_programme: string;
  readonly assessment_reason: string;
  readonly status: string;
  readonly result: string | null;
  readonly effective_from: string;
  readonly valid_until: string | null;
  readonly reassessment_due: string | null;
  readonly claim_id: string | null;
  readonly award_id: string | null;
}

export interface BnMeansPersonSummary {
  readonly person_id: number;
  readonly full_name: string;
  readonly masked_identifier: string | null;
  readonly date_of_birth: string | null;
  readonly address_summary: string | null;
  readonly person_status: string | null;
  readonly is_deceased: boolean;
}

export interface BnMeansPersonContext {
  readonly person: BnMeansPersonSummary;
  readonly claims: readonly BnMeansPersonClaimRow[];
  readonly awards: readonly BnMeansPersonAwardRow[];
  readonly assessments: readonly BnMeansPersonAssessmentRow[];
}

export interface BnMeansProgrammeOption {
  readonly value: string;
  readonly label: string;
  readonly description: string | null;
  readonly is_active: boolean;
}

export type BnMeansPolicyResolutionState = 'RESOLVED' | 'NONE' | 'OVERLAPPING' | 'UNRESOLVED';

export interface BnMeansPolicyResolution {
  readonly state: BnMeansPolicyResolutionState;
  readonly reason_code?: string;
  readonly policy_id?: string;
  readonly policy_code?: string;
  readonly policy_name?: string;
  readonly benefit_programme?: string;
  readonly authority_reference?: string | null;
  readonly policy_version_id?: string;
  readonly version_label?: string;
  readonly effective_from?: string;
  readonly effective_to?: string | null;
  readonly currency_code?: string;
  readonly validity_months?: number | null;
  readonly reassessment_months?: number | null;
  readonly candidate_count?: number;
  readonly support_reference?: string;
}

export interface BnMeansInitiationMessage {
  readonly code: string;
  readonly message: string;
}

export interface BnMeansInitiationCheck {
  readonly can_create: boolean;
  readonly reason_codes: readonly string[];
  readonly blockers: readonly BnMeansInitiationMessage[];
  readonly warnings: readonly BnMeansInitiationMessage[];
  readonly existing_open_assessments: readonly BnMeansPersonAssessmentRow[];
  readonly existing_active_assessment: BnMeansPersonAssessmentRow | null;
  readonly overlapping_assessments: readonly BnMeansPersonAssessmentRow[];
  readonly reassessment_due: string | null;
  readonly policy_resolution: BnMeansPolicyResolution | null;
}

/* ------------------------------------------------------------------ */
/* the draft an officer builds                                         */
/* ------------------------------------------------------------------ */

export interface BnMeansInitiationDraft {
  entryContext: BnMeansEntryContextCode;
  personId: number | null;
  personLabel: string | null;
  personSecondary: string | null;
  claimId: string | null;
  awardId: string | null;
  benefitProgramme: string;
  assessmentReason: string;
  effectiveFrom: string;
}

/** Prefill supplied by a Claim workspace, Award 360 or Benefit 360 entry point. */
export interface BnMeansInitiationPrefill {
  readonly entryContext?: BnMeansEntryContextCode;
  readonly personId?: number | null;
  readonly personLabel?: string | null;
  readonly personSecondary?: string | null;
  readonly claimId?: string | null;
  readonly awardId?: string | null;
  readonly benefitProgramme?: string | null;
  readonly assessmentReason?: string | null;
  readonly effectiveFrom?: string | null;
  /** Where the officer came from — recorded for the audit narrative. */
  readonly originSurface?: string;
}

export function emptyInitiationDraft(
  prefill: BnMeansInitiationPrefill = {},
): BnMeansInitiationDraft {
  const entryContext = prefill.entryContext ?? 'STANDALONE_ASSESSMENT';
  return {
    entryContext,
    personId: prefill.personId ?? null,
    personLabel: prefill.personLabel ?? null,
    personSecondary: prefill.personSecondary ?? null,
    claimId: prefill.claimId ?? null,
    awardId: prefill.awardId ?? null,
    benefitProgramme: prefill.benefitProgramme ?? '',
    assessmentReason: prefill.assessmentReason ?? meansEntryContext(entryContext)?.defaultReason ?? '',
    effectiveFrom: prefill.effectiveFrom ?? '',
  };
}

/**
 * The context object sent to BOTH the initiation check and the create
 * command. One shape, one source of truth — the command re-validates it
 * server-side, so the two can never disagree.
 */
export function buildInitiationContext(
  draft: BnMeansInitiationDraft,
): Record<string, unknown> {
  const def = meansEntryContext(draft.entryContext);
  return {
    entry_context: draft.entryContext,
    person_id: draft.personId ?? null,
    claim_id: def?.requiresAward ? null : draft.claimId || null,
    award_id: def?.requiresClaim ? null : draft.awardId || null,
    benefit_programme: draft.benefitProgramme || null,
    assessment_reason: draft.assessmentReason || null,
    effective_from: draft.effectiveFrom || null,
  };
}

/* ------------------------------------------------------------------ */
/* wizard steps                                                        */
/* ------------------------------------------------------------------ */

export type BnMeansInitiationStep =
  | 'CONTEXT'
  | 'PERSON'
  | 'LINK'
  | 'DETAILS'
  | 'POLICY'
  | 'REVIEW';

export interface BnMeansInitiationStepDefinition {
  readonly step: BnMeansInitiationStep;
  readonly label: string;
  readonly description: string;
}

export const MEANS_INITIATION_STEPS: readonly BnMeansInitiationStepDefinition[] = [
  { step: 'CONTEXT', label: 'Context', description: 'Why this assessment is being started.' },
  { step: 'PERSON', label: 'Person', description: 'Who is being assessed.' },
  { step: 'LINK', label: 'Claim or award', description: 'What the assessment supports.' },
  { step: 'DETAILS', label: 'Assessment details', description: 'Programme, reason and effective date.' },
  { step: 'POLICY', label: 'Policy resolution', description: 'The policy version in force on that date.' },
  { step: 'REVIEW', label: 'Review and create', description: 'Confirm everything before creating.' },
];

/** Backend reason codes mapped onto the step that can resolve them. */
export const MEANS_REASON_CODE_STEP: Record<string, BnMeansInitiationStep> = {
  PERSON_REQUIRED: 'PERSON',
  CLAIM_REQUIRED: 'LINK',
  AWARD_REQUIRED: 'LINK',
  CONTEXT_PERSON_MISMATCH: 'LINK',
  CLAIM_PROGRAMME_MISMATCH: 'DETAILS',
  AWARD_PROGRAMME_MISMATCH: 'DETAILS',
  PROGRAMME_REQUIRED: 'DETAILS',
  REASON_REQUIRED: 'DETAILS',
  EFFECTIVE_DATE_REQUIRED: 'DETAILS',
  EFFECTIVE_DATE_CONFLICT: 'DETAILS',
  NO_EFFECTIVE_POLICY: 'POLICY',
  OVERLAPPING_POLICY: 'POLICY',
  OPEN_ASSESSMENT_EXISTS: 'REVIEW',
  ACTIVE_ASSESSMENT_EXISTS: 'REVIEW',
  PERMISSION_DENIED: 'CONTEXT',
};

export function stepForReasonCode(code: string): BnMeansInitiationStep {
  return MEANS_REASON_CODE_STEP[code] ?? 'REVIEW';
}

export function blockersForStep(
  check: BnMeansInitiationCheck | null,
  step: BnMeansInitiationStep,
): readonly BnMeansInitiationMessage[] {
  if (!check) return [];
  return check.blockers.filter((b) => stepForReasonCode(b.code) === step);
}

/** Steps that do not apply to the chosen entry context are skipped. */
export function visibleInitiationSteps(
  draft: BnMeansInitiationDraft,
): readonly BnMeansInitiationStepDefinition[] {
  const def = meansEntryContext(draft.entryContext);
  return MEANS_INITIATION_STEPS.filter((s) => {
    if (s.step !== 'LINK') return true;
    return Boolean(def?.requiresClaim || def?.requiresAward);
  });
}

/**
 * Local completeness only: has the officer supplied enough to move on?
 * Never an authorisation or eligibility decision.
 */
export function stepComplete(
  step: BnMeansInitiationStep,
  draft: BnMeansInitiationDraft,
  check: BnMeansInitiationCheck | null = null,
): boolean {
  const def = meansEntryContext(draft.entryContext);
  switch (step) {
    case 'CONTEXT':
      return Boolean(def);
    case 'PERSON':
      return draft.personId != null;
    case 'LINK':
      if (def?.requiresClaim) return Boolean(draft.claimId);
      if (def?.requiresAward) return Boolean(draft.awardId);
      return true;
    case 'DETAILS':
      return Boolean(draft.benefitProgramme && draft.assessmentReason && draft.effectiveFrom);
    case 'POLICY':
      return check?.policy_resolution?.state === 'RESOLVED';
    case 'REVIEW':
      return check?.can_create === true;
    default:
      return false;
  }
}

export function firstIncompleteStep(
  draft: BnMeansInitiationDraft,
  check: BnMeansInitiationCheck | null = null,
): BnMeansInitiationStep {
  const steps = visibleInitiationSteps(draft);
  for (const s of steps) {
    if (!stepComplete(s.step, draft, check)) return s.step;
  }
  return 'REVIEW';
}
