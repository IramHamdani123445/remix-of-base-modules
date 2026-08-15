/**
 * Benefits → Omni-Comms template registry.
 *
 * Single source of truth binding a Benefits event to:
 *  - its published Email template content (composed, complete letter),
 *  - the exact payload token vocabulary that template depends on,
 *  - a deterministic sample payload used by the published event contract,
 *  - a total payload builder that can never under-supply a token.
 *
 * The runtime renderer throws when a token has no value, so a producer must
 * ALWAYS supply every token declared by the template. `buildBenefitsPayload`
 * guarantees that by filling any value the business layer did not provide
 * with an explicit, honest placeholder rather than an empty string.
 *
 * Pure data + pure functions. No Supabase client, no React, no provider SDK.
 */
import {
  BENEFITS_EMAIL_SPECS,
} from './benefitsEmailSpecs';
import {
  composeBenefitsEmail,
  entityTypeFor,
  registeredEventCode,
  specTokens,
  templateFamilyCode,
  type BenefitsEmailSpec,
  type ComposedBenefitsEmail,
} from './benefitsEmailComposer';

/** Value used when the business layer has no value for a declared token. */
export const BENEFITS_TOKEN_PLACEHOLDER = 'Not stated';

export interface BenefitsTemplateEntry {
  /** Catalogue event code (may contain a sub-domain segment). */
  eventCode: string;
  /** Three-segment code registered in the Omni-Comms event registry. */
  registeredEventCode: string;
  entityType: string;
  templateFamily: string;
  templateFamilyCode: string;
  recipientRole: string;
  name: string;
  description: string;
  communicationClass: BenefitsEmailSpec['communicationClass'];
  priority: BenefitsEmailSpec['priority'];
  tokens: string[];
  content: ComposedBenefitsEmail;
  samplePayload: Record<string, string>;
  spec: BenefitsEmailSpec;
}

/** Human-plausible sample values so the published contract is reviewable. */
const SAMPLE_VALUES: Record<string, string> = {
  subjectName: 'Alicia Warner',
  reference: 'CLM-2026-000141',
  claimType: 'Sickness Benefit',
  benefitType: 'Invalidity Pension',
  claimStatus: 'Awaiting assessment',
  submittedOn: '12 August 2026',
  withdrawnOn: '18 August 2026',
  withdrawalReason: 'Requested by the claimant',
  correctedOn: '20 August 2026',
  correctionSummary: 'Date of birth corrected to 4 March 1961',
  correctionReason: 'Supporting document supplied by the claimant',
  evidenceRequested: 'Medical certificate covering 1–31 July 2026',
  evidenceReceived: 'Medical certificate dated 2 August 2026',
  receivedOn: '21 August 2026',
  rejectionReason: 'The copy supplied was not legible',
  dueDate: '5 September 2026',
  submissionChannel: 'In person at any Social Security office, or by post',
  decisionDate: '28 August 2026',
  decisionReason: 'The contribution condition for this benefit was not satisfied',
  legalBasis: 'Social Security Act, contribution conditions',
  awardSummary: 'Sickness Benefit payable for 13 weeks',
  benefitRate: 'XCD 480.00 per week',
  effectiveFrom: '1 September 2026',
  previousRate: 'XCD 450.00 per week',
  adjustmentReason: 'Recalculation following corrected earnings',
  terminationDate: '31 August 2026',
  terminationReason: 'Maximum benefit duration reached',
  finalPaymentSummary: 'One final payment of XCD 480.00',
  upratingCycle: '2026 annual uprating',
  suspensionFrom: '1 September 2026',
  suspensionReason: 'Life certificate outstanding',
  resolutionRequirement: 'Return a completed and witnessed life certificate',
  reinstatementFrom: '15 September 2026',
  withheldAmount: 'XCD 960.00',
  arrearsSchedule: 'With your next scheduled payment',
  paymentAmount: 'XCD 480.00',
  paymentFrequency: 'Every two weeks',
  firstPaymentDate: '15 September 2026',
  paymentMethod: 'Direct bank transfer',
  paymentDate: '15 September 2026',
  paymentPeriod: '1–14 September 2026',
  paymentReference: 'PAY-2026-004512',
  cancellationReason: 'Bank account details were rejected by the bank',
  reissueReason: 'Original payment returned unpaid',
  certificationCycle: '2026 annual certification',
  graceEndsOn: '30 September 2026',
  daysRemaining: '10',
  daysOverdue: '14',
  consequenceSummary: 'Payments will be suspended until certification is completed',
  verifiedOn: '22 September 2026',
  nextDueDate: '1 September 2027',
  waiverReason: 'Certified in person at a Board office',
  deferralReason: 'Hospital admission confirmed by the treating physician',
  caseReference: 'BN-2026-000318',
  assessmentType: 'Capacity for work assessment',
  referralQuestion: 'Is the person capable of returning to their usual occupation?',
  appointmentDate: '10 September 2026',
  appointmentTime: '10:30',
  appointmentLocation: 'Social Security Medical Suite, Basseterre',
  examinerName: 'Dr. M. Phillip',
  bringItems: 'Photo identification and any current medication list',
  rescheduleReason: 'The examiner was unavailable on the original date',
  nextActionSummary: 'A new appointment will be arranged and sent to you',
  materialProvided: 'Referral report dated 20 August 2026 and claim file summary',
  clarificationRequest: 'Please confirm the expected duration of incapacity',
  sessionDate: '18 September 2026',
  sessionTime: '09:00',
  sessionLocation: 'Board Room, Social Security Headquarters',
  caseCount: '12',
  decisionUnderAppeal: 'Disallowance of claim CLM-2026-000141',
  appealGrounds: 'New medical evidence not considered in the original decision',
  acknowledgedOn: '2 September 2026',
  appealStage: 'Case preparation',
  nextMilestone: 'Admissibility decision',
  admissibilityDate: '9 September 2026',
  inadmissibilityReason: 'The appeal was lodged outside the statutory period',
  hearingDate: '14 October 2026',
  hearingTime: '11:00',
  hearingVenue: 'Appeals Tribunal Room, Basseterre',
  hearingType: 'Oral hearing',
  appealOutcome: 'Appeal allowed',
  implementationSummary: 'Your claim will be reassessed and any arrears paid',
  overpaidAmount: 'XCD 1,240.00',
  overpaymentPeriod: '1 March 2026 to 30 June 2026',
  overpaymentCause: 'Benefit paid after return to employment',
  representationSummary: 'Statement of earnings and hardship submitted',
  instalmentAmount: 'XCD 100.00',
  instalmentFrequency: 'Monthly',
  firstInstalmentDate: '1 October 2026',
  balanceOutstanding: 'XCD 1,140.00',
  revisionReason: 'Change in your reported income',
  waivedAmount: 'XCD 620.00',
  recoveredAmount: 'XCD 1,240.00',
  finalPaymentDate: '1 August 2027',
  householdSize: '4',
  assessmentPeriod: '1 January 2026 to 31 December 2026',
  informationRequested: 'Bank statements for the last three months',
  assessedIncome: 'XCD 1,850.00 per month',
  assessedMeans: 'XCD 2,050.00 per month',
  meansThreshold: 'XCD 1,900.00 per month',
  nextReviewDate: '1 September 2027',
  reportedOn: '3 September 2026',
  subjectSummary: 'Pensioner record P-2026-0042',
  caseStatus: 'Awaiting verification',
  assessmentStartedOn: '6 September 2026',
};

function sampleFor(token: string): string {
  return SAMPLE_VALUES[token] ?? BENEFITS_TOKEN_PLACEHOLDER;
}

function buildEntry(spec: BenefitsEmailSpec): BenefitsTemplateEntry {
  const tokens = specTokens(spec);
  const samplePayload: Record<string, string> = {};
  for (const token of tokens) samplePayload[token] = sampleFor(token);
  return {
    eventCode: spec.eventCode,
    registeredEventCode: registeredEventCode(spec.eventCode),
    entityType: entityTypeFor(spec.eventCode),
    templateFamily: spec.templateFamily,
    templateFamilyCode: templateFamilyCode(spec.templateFamily),
    recipientRole: spec.recipientRole,
    name: spec.name,
    description: spec.description,
    communicationClass: spec.communicationClass,
    priority: spec.priority,
    tokens,
    content: composeBenefitsEmail(spec),
    samplePayload,
    spec,
  };
}

export const BENEFITS_TEMPLATE_ENTRIES: BenefitsTemplateEntry[] =
  BENEFITS_EMAIL_SPECS.map(buildEntry);

const BY_EVENT = new Map<string, BenefitsTemplateEntry>(
  BENEFITS_TEMPLATE_ENTRIES.map((e) => [e.eventCode, e]),
);

export function benefitsTemplateEntry(
  eventCode: string,
): BenefitsTemplateEntry | undefined {
  return BY_EVENT.get(eventCode);
}

export function benefitsTemplateEventCodes(): string[] {
  return BENEFITS_TEMPLATE_ENTRIES.map((e) => e.eventCode);
}

/**
 * Total payload builder.
 *
 * Returns EXACTLY the token vocabulary of the event's template: no unknown
 * key can leak into the runtime payload (the published contract forbids
 * additional properties) and no declared token can be missing (the renderer
 * throws on a missing value).
 */
export function buildBenefitsPayload(
  eventCode: string,
  values: Record<string, unknown> = {},
): Record<string, string> {
  const entry = BY_EVENT.get(eventCode);
  if (!entry) return {};
  const payload: Record<string, string> = {};
  for (const token of entry.tokens) {
    const raw = values[token];
    const text =
      raw === null || raw === undefined
        ? ''
        : typeof raw === 'string'
          ? raw.trim()
          : String(raw);
    payload[token] = text.length > 0 ? text : BENEFITS_TOKEN_PLACEHOLDER;
  }
  return payload;
}
