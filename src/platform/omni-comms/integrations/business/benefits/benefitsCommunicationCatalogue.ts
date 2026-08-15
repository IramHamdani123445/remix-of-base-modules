/**
 * BENEFITS → OMNI-COMMS canonical communication catalogue (machine-testable).
 *
 * This module is the single source of truth for:
 *  - which Benefits business transitions exist,
 *  - how each transition is classified for communication,
 *  - which canonical Omni-Comms event code (if any) it publishes,
 *  - which semantic recipient roles apply,
 *  - whether Email is a valid channel and its default policy.
 *
 * It contains NO runtime transport code, imports no Supabase client, no React,
 * no provider SDK and nothing from any superseded communication runtime. Facts
 * are taken from current Benefits business source only.

 *
 * Canonical event naming: BENEFITS.<DOMAIN>.<BUSINESS_EVENT> (uppercase dotted).
 *
 * DECISION VOCABULARY (see §5 of the closure brief): the executable Benefits
 * decision vocabulary uses DISALLOW / DISALLOWED (bn workflow statuses,
 * determinationService DISALLOW_READY, approvalConsoleService DISALLOW,
 * legacy bn.claim.disallowed). Therefore the canonical future event code is
 * BENEFITS.CLAIM.DISALLOWED. The pre-existing BENEFITS.CLAIM.REJECTED
 * definition is retained ONLY as historical/compatibility metadata and must
 * never be an active live route — enforced by the catalogue tests.
 */

/** Communication classification for a business transition. */
export type BenefitsCommunicationClassification =
  | 'COMMUNICATION_REQUIRED'
  | 'COMMUNICATION_OPTIONAL'
  | 'INTERNAL_ONLY'
  | 'NO_COMMUNICATION_REQUIRED';

/** Email routing policy for an event. */
export type BenefitsEmailPolicy =
  | 'EXTERNAL_EMAIL_DEFAULT_ON'
  | 'EXTERNAL_EMAIL_CONFIGURABLE'
  | 'INTERNAL_EMAIL_DEFAULT_OFF'
  | 'AUDIT_ONLY';

/** Benefits business domains covered by the catalogue. */
export const BENEFITS_COMMUNICATION_DOMAINS = [
  'CLAIM',
  'EVIDENCE',
  'ELIGIBILITY',
  'CALCULATION',
  'DETERMINATION',
  'ENTITLEMENT',
  'AWARD',
  'SUSPENSION',
  'REINSTATEMENT',
  'PAYMENT',
  'LIFE_CERTIFICATE',
  'MEDICAL_REVIEW',
  'APPEAL',
  'OVERPAYMENT',
  'MEANS_TEST',
  'MORTALITY',
  'RISK',
  'UPRATING',
] as const;
export type BenefitsCommunicationDomain =
  (typeof BENEFITS_COMMUNICATION_DOMAINS)[number];

/** Semantic recipient roles. Never a persistence type, never a template choice. */
export const BENEFITS_RECIPIENT_ROLES = [
  'claimant',
  'beneficiary',
  'payee',
  'appellant',
  'debtor',
  'survivor',
  'estate_representative',
  'reporter',
  'funeral_claimant',
  'medical_provider',
  'board_member',
  'assigned_officer',
  'approver',
  'finance_officer',
] as const;
export type BenefitsRecipientRole = (typeof BENEFITS_RECIPIENT_ROLES)[number];

export interface BenefitsCommunicationEntry {
  /** Business domain. */
  readonly domain: BenefitsCommunicationDomain;
  /** Executable command / RPC / scheduler boundary that owns the transition. */
  readonly command: string;
  /** Source lifecycle state (or '*' when the command is state-agnostic). */
  readonly sourceState: string;
  /** Target lifecycle state produced by a successful transition. */
  readonly targetState: string;
  readonly classification: BenefitsCommunicationClassification;
  /** Canonical Omni event code. Null only for NO_COMMUNICATION_REQUIRED. */
  readonly eventCode: string | null;
  readonly recipientRoles: readonly BenefitsRecipientRole[];
  readonly emailApplicable: boolean;
  readonly emailPolicy: BenefitsEmailPolicy;
  /** Template family code; null when Email is not a valid channel. */
  readonly templateFamily: string | null;
  /** True when the event may carry product-specific statutory wording. */
  readonly productSpecific: boolean;
  /** Producer module path when wired, otherwise null (pending). */
  readonly producer: string | null;
  /** Why this transition is not communicated (required when classification is NO_COMMUNICATION_REQUIRED). */
  readonly reason?: string;
}

const e = (entry: BenefitsCommunicationEntry): BenefitsCommunicationEntry => entry;

/**
 * Event code retained ONLY for historical evidence. It must not be an active
 * live route and must not appear as an `eventCode` in this catalogue.
 */
export const BENEFITS_COMPATIBILITY_EVENT_CODES: readonly string[] = [
  'BENEFITS.CLAIM.REJECTED',
];

export const BENEFITS_COMMUNICATION_CATALOGUE: readonly BenefitsCommunicationEntry[] = [
  // ---------------------------------------------------------------- CLAIM
  e({
    domain: 'CLAIM',
    command: 'BN_CLAIM_CREATE',
    sourceState: 'NONE',
    targetState: 'DRAFT',
    classification: 'INTERNAL_ONLY',
    eventCode: 'BENEFITS.CLAIM.CREATED',
    recipientRoles: ['assigned_officer'],
    emailApplicable: false,
    emailPolicy: 'INTERNAL_EMAIL_DEFAULT_OFF',
    templateFamily: null,
    productSpecific: false,
    producer: null,
  }),
  e({
    domain: 'CLAIM',
    command: 'BN_CLAIM_SUBMIT',
    sourceState: 'DRAFT',
    targetState: 'SUBMITTED',
    classification: 'COMMUNICATION_REQUIRED',
    eventCode: 'BENEFITS.CLAIM.SUBMITTED',
    recipientRoles: ['claimant'],
    emailApplicable: true,
    emailPolicy: 'EXTERNAL_EMAIL_DEFAULT_ON',
    templateFamily: 'BENEFITS_CLAIM_SUBMITTED',
    productSpecific: true,
    producer:
      'src/platform/omni-comms/integrations/business/benefitsClaimSubmittedProducer.ts',
  }),
  e({
    domain: 'CLAIM',
    command: 'BN_CLAIM_VERIFY',
    sourceState: 'SUBMITTED',
    targetState: 'VERIFIED',
    classification: 'INTERNAL_ONLY',
    eventCode: 'BENEFITS.CLAIM.VERIFIED',
    recipientRoles: ['assigned_officer'],
    emailApplicable: false,
    emailPolicy: 'INTERNAL_EMAIL_DEFAULT_OFF',
    templateFamily: null,
    productSpecific: false,
    producer: null,
  }),
  e({
    domain: 'CLAIM',
    command: 'BN_CLAIM_WITHDRAW',
    sourceState: '*',
    targetState: 'WITHDRAWN',
    classification: 'COMMUNICATION_OPTIONAL',
    eventCode: 'BENEFITS.CLAIM.WITHDRAWN',
    recipientRoles: ['claimant'],
    emailApplicable: true,
    emailPolicy: 'EXTERNAL_EMAIL_CONFIGURABLE',
    templateFamily: 'BENEFITS_CLAIM_WITHDRAWN',
    productSpecific: false,
    producer: null,
  }),
  e({
    domain: 'CLAIM',
    command: 'BN_CLAIM_CORRECTION_COMPLETE',
    sourceState: 'CORRECTION_IN_PROGRESS',
    targetState: 'CORRECTED',
    classification: 'COMMUNICATION_OPTIONAL',
    eventCode: 'BENEFITS.CLAIM.CORRECTION.COMPLETED',
    recipientRoles: ['claimant'],
    emailApplicable: true,
    emailPolicy: 'EXTERNAL_EMAIL_CONFIGURABLE',
    templateFamily: 'BENEFITS_CLAIM_CORRECTION_COMPLETED',
    productSpecific: false,
    producer: null,
  }),
  e({
    domain: 'CLAIM',
    command: 'BN_CLAIM_SLA_ESCALATE',
    sourceState: '*',
    targetState: 'ESCALATED',
    classification: 'INTERNAL_ONLY',
    eventCode: 'BENEFITS.CLAIM.SLA.ESCALATED',
    recipientRoles: ['assigned_officer', 'approver'],
    emailApplicable: false,
    emailPolicy: 'INTERNAL_EMAIL_DEFAULT_OFF',
    templateFamily: null,
    productSpecific: false,
    producer: null,
  }),

  // ------------------------------------------------------------- EVIDENCE
  e({
    domain: 'EVIDENCE',
    command: 'BN_CLAIM_REQUEST_EVIDENCE',
    sourceState: 'UNDER_REVIEW',
    targetState: 'AWAITING_EVIDENCE',
    classification: 'COMMUNICATION_REQUIRED',
    eventCode: 'BENEFITS.CLAIM.EVIDENCE.REQUESTED',
    recipientRoles: ['claimant'],
    emailApplicable: true,
    emailPolicy: 'EXTERNAL_EMAIL_DEFAULT_ON',
    templateFamily: 'BENEFITS_CLAIM_EVIDENCE_REQUESTED',
    productSpecific: true,
    producer: null,
  }),
  e({
    domain: 'EVIDENCE',
    command: 'BN_CLAIM_RECORD_EVIDENCE',
    sourceState: 'AWAITING_EVIDENCE',
    targetState: 'EVIDENCE_RECEIVED',
    classification: 'COMMUNICATION_OPTIONAL',
    eventCode: 'BENEFITS.CLAIM.EVIDENCE.RECEIVED',
    recipientRoles: ['claimant'],
    emailApplicable: true,
    emailPolicy: 'EXTERNAL_EMAIL_CONFIGURABLE',
    templateFamily: 'BENEFITS_CLAIM_EVIDENCE_RECEIVED',
    productSpecific: false,
    producer: null,
  }),
  e({
    domain: 'EVIDENCE',
    command: 'BN_CLAIM_REJECT_EVIDENCE',
    sourceState: 'EVIDENCE_RECEIVED',
    targetState: 'AWAITING_EVIDENCE',
    classification: 'COMMUNICATION_REQUIRED',
    eventCode: 'BENEFITS.CLAIM.EVIDENCE.RESUBMISSION_REQUIRED',
    recipientRoles: ['claimant'],
    emailApplicable: true,
    emailPolicy: 'EXTERNAL_EMAIL_DEFAULT_ON',
    templateFamily: 'BENEFITS_CLAIM_EVIDENCE_RESUBMISSION_REQUIRED',
    productSpecific: false,
    producer: null,
  }),

  // ---------------------------------------------------------- ELIGIBILITY
  e({
    domain: 'ELIGIBILITY',
    command: 'BN_ELIGIBILITY_EVALUATE',
    sourceState: 'VERIFIED',
    targetState: 'ELIGIBILITY_ASSESSED',
    classification: 'NO_COMMUNICATION_REQUIRED',
    eventCode: null,
    recipientRoles: [],
    emailApplicable: false,
    emailPolicy: 'AUDIT_ONLY',
    templateFamily: null,
    productSpecific: false,
    producer: null,
    reason:
      'Intermediate assessment step with no claimant-facing outcome; the outcome is communicated at determination.',
  }),

  // ---------------------------------------------------------- CALCULATION
  e({
    domain: 'CALCULATION',
    command: 'BN_CLAIM_CALCULATE',
    sourceState: 'ELIGIBILITY_ASSESSED',
    targetState: 'CALCULATED',
    classification: 'INTERNAL_ONLY',
    eventCode: 'BENEFITS.CLAIM.CALCULATION.COMPLETED',
    recipientRoles: ['assigned_officer'],
    emailApplicable: false,
    emailPolicy: 'INTERNAL_EMAIL_DEFAULT_OFF',
    templateFamily: null,
    productSpecific: false,
    producer: null,
  }),

  // -------------------------------------------------------- DETERMINATION
  e({
    domain: 'DETERMINATION',
    command: 'BN_DETERMINATION_READY',
    sourceState: 'CALCULATED',
    targetState: 'DECISION_PENDING',
    classification: 'INTERNAL_ONLY',
    eventCode: 'BENEFITS.CLAIM.DECISION.PENDING',
    recipientRoles: ['approver'],
    emailApplicable: false,
    emailPolicy: 'INTERNAL_EMAIL_DEFAULT_OFF',
    templateFamily: null,
    productSpecific: false,
    producer: null,
  }),
  e({
    domain: 'DETERMINATION',
    command: 'BN_CLAIM_APPROVE',
    sourceState: 'DECISION_PENDING',
    targetState: 'APPROVED',
    classification: 'COMMUNICATION_REQUIRED',
    eventCode: 'BENEFITS.CLAIM.APPROVED',
    recipientRoles: ['claimant'],
    emailApplicable: true,
    emailPolicy: 'EXTERNAL_EMAIL_DEFAULT_ON',
    templateFamily: 'BENEFITS_CLAIM_APPROVED',
    productSpecific: true,
    producer: null,
  }),
  e({
    domain: 'DETERMINATION',
    command: 'BN_CLAIM_DISALLOW',
    sourceState: 'DECISION_PENDING',
    targetState: 'DISALLOWED',
    classification: 'COMMUNICATION_REQUIRED',
    eventCode: 'BENEFITS.CLAIM.DISALLOWED',
    recipientRoles: ['claimant'],
    emailApplicable: true,
    emailPolicy: 'EXTERNAL_EMAIL_DEFAULT_ON',
    templateFamily: 'BENEFITS_CLAIM_DISALLOWED',
    productSpecific: true,
    producer: null,
  }),

  // ---------------------------------------------------- ENTITLEMENT/AWARD
  e({
    domain: 'ENTITLEMENT',
    command: 'BN_ENTITLEMENT_CREATE',
    sourceState: 'APPROVED',
    targetState: 'ENTITLED',
    classification: 'INTERNAL_ONLY',
    eventCode: 'BENEFITS.ENTITLEMENT.CREATED',
    recipientRoles: ['assigned_officer'],
    emailApplicable: false,
    emailPolicy: 'INTERNAL_EMAIL_DEFAULT_OFF',
    templateFamily: null,
    productSpecific: false,
    producer: null,
  }),
  e({
    domain: 'AWARD',
    command: 'BN_AWARD_CREATE',
    sourceState: 'ENTITLED',
    targetState: 'AWARD_ACTIVE',
    classification: 'COMMUNICATION_REQUIRED',
    eventCode: 'BENEFITS.AWARD.CREATED',
    recipientRoles: ['beneficiary'],
    emailApplicable: true,
    emailPolicy: 'EXTERNAL_EMAIL_DEFAULT_ON',
    templateFamily: 'BENEFITS_AWARD_CREATED',
    productSpecific: true,
    producer: null,
  }),
  e({
    domain: 'AWARD',
    command: 'BN_AWARD_ADJUST',
    sourceState: 'AWARD_ACTIVE',
    targetState: 'AWARD_ACTIVE',
    classification: 'COMMUNICATION_REQUIRED',
    eventCode: 'BENEFITS.AWARD.ADJUSTED',
    recipientRoles: ['beneficiary'],
    emailApplicable: true,
    emailPolicy: 'EXTERNAL_EMAIL_DEFAULT_ON',
    templateFamily: 'BENEFITS_AWARD_ADJUSTED',
    productSpecific: false,
    producer: null,
  }),
  e({
    domain: 'AWARD',
    command: 'BN_AWARD_TERMINATE',
    sourceState: 'AWARD_ACTIVE',
    targetState: 'AWARD_TERMINATED',
    classification: 'COMMUNICATION_REQUIRED',
    eventCode: 'BENEFITS.AWARD.TERMINATED',
    recipientRoles: ['beneficiary'],
    emailApplicable: true,
    emailPolicy: 'EXTERNAL_EMAIL_DEFAULT_ON',
    templateFamily: 'BENEFITS_AWARD_TERMINATED',
    productSpecific: false,
    producer: null,
  }),
  e({
    domain: 'AWARD',
    command: 'BN_UPRATING_EXECUTE_BATCH (per-award effect)',
    sourceState: 'AWARD_ACTIVE',
    targetState: 'AWARD_ACTIVE',
    classification: 'COMMUNICATION_REQUIRED',
    eventCode: 'BENEFITS.AWARD.UPRATED',
    recipientRoles: ['beneficiary'],
    emailApplicable: true,
    emailPolicy: 'EXTERNAL_EMAIL_DEFAULT_ON',
    templateFamily: 'BENEFITS_AWARD_UPRATED',
    productSpecific: false,
    producer: null,
  }),

  // ----------------------------------------------------------- SUSPENSION
  ...(
    [
      ['BN_AWARD_SUSPENSION_PROPOSE', 'PROPOSED'],
      ['BN_AWARD_SUSPENSION_APPROVE', 'APPROVED'],
      ['BN_AWARD_SUSPENSION_REJECT', 'REJECTED'],
    ] as const
  ).map(([command, step]) =>
    e({
      domain: 'SUSPENSION',
      command,
      sourceState: 'AWARD_ACTIVE',
      targetState: `SUSPENSION_${step}`,
      classification: 'INTERNAL_ONLY',
      eventCode: `BENEFITS.AWARD.SUSPENSION.${step}`,
      recipientRoles: ['assigned_officer', 'approver'],
      emailApplicable: false,
      emailPolicy: 'INTERNAL_EMAIL_DEFAULT_OFF',
      templateFamily: null,
      productSpecific: false,
      producer: null,
    }),
  ),
  e({
    domain: 'SUSPENSION',
    command: 'BN_AWARD_SUSPENSION_EXECUTE',
    sourceState: 'SUSPENSION_APPROVED',
    targetState: 'AWARD_SUSPENDED',
    classification: 'COMMUNICATION_REQUIRED',
    eventCode: 'BENEFITS.AWARD.SUSPENSION.EXECUTED',
    recipientRoles: ['beneficiary'],
    emailApplicable: true,
    emailPolicy: 'EXTERNAL_EMAIL_DEFAULT_ON',
    templateFamily: 'BENEFITS_AWARD_SUSPENSION_EXECUTED',
    productSpecific: false,
    producer: null,
  }),
  e({
    domain: 'SUSPENSION',
    command: 'BN_AWARD_SUSPENSION_EXECUTION_FAIL',
    sourceState: 'SUSPENSION_APPROVED',
    targetState: 'SUSPENSION_EXECUTION_FAILED',
    classification: 'INTERNAL_ONLY',
    eventCode: 'BENEFITS.AWARD.SUSPENSION.EXECUTION_FAILED',
    recipientRoles: ['assigned_officer'],
    emailApplicable: false,
    emailPolicy: 'INTERNAL_EMAIL_DEFAULT_OFF',
    templateFamily: null,
    productSpecific: false,
    producer: null,
  }),

  // -------------------------------------------------------- REINSTATEMENT
  ...(
    [
      ['BN_AWARD_REINSTATEMENT_PROPOSE', 'PROPOSED'],
      ['BN_AWARD_REINSTATEMENT_APPROVE', 'APPROVED'],
      ['BN_AWARD_REINSTATEMENT_REJECT', 'REJECTED'],
    ] as const
  ).map(([command, step]) =>
    e({
      domain: 'REINSTATEMENT',
      command,
      sourceState: 'AWARD_SUSPENDED',
      targetState: `REINSTATEMENT_${step}`,
      classification: 'INTERNAL_ONLY',
      eventCode: `BENEFITS.AWARD.REINSTATEMENT.${step}`,
      recipientRoles: ['assigned_officer', 'approver'],
      emailApplicable: false,
      emailPolicy: 'INTERNAL_EMAIL_DEFAULT_OFF',
      templateFamily: null,
      productSpecific: false,
      producer: null,
    }),
  ),
  e({
    domain: 'REINSTATEMENT',
    command: 'BN_AWARD_REINSTATEMENT_EXECUTE',
    sourceState: 'REINSTATEMENT_APPROVED',
    targetState: 'AWARD_ACTIVE',
    classification: 'COMMUNICATION_REQUIRED',
    eventCode: 'BENEFITS.AWARD.REINSTATEMENT.EXECUTED',
    recipientRoles: ['beneficiary'],
    emailApplicable: true,
    emailPolicy: 'EXTERNAL_EMAIL_DEFAULT_ON',
    templateFamily: 'BENEFITS_AWARD_REINSTATEMENT_EXECUTED',
    productSpecific: false,
    producer: null,
  }),

  // -------------------------------------------------------------- PAYMENT
  e({
    domain: 'PAYMENT',
    command: 'BN_PAYABLE_BLOCK',
    sourceState: 'PAYABLE_PENDING',
    targetState: 'PAYABLE_BLOCKED',
    classification: 'INTERNAL_ONLY',
    eventCode: 'BENEFITS.PAYABLE.BLOCKED',
    recipientRoles: ['finance_officer'],
    emailApplicable: false,
    emailPolicy: 'INTERNAL_EMAIL_DEFAULT_OFF',
    templateFamily: null,
    productSpecific: false,
    producer: null,
  }),
  e({
    domain: 'PAYMENT',
    command: 'BN_PAYABLE_READY',
    sourceState: 'PAYABLE_PENDING',
    targetState: 'PAYABLE_READY',
    classification: 'INTERNAL_ONLY',
    eventCode: 'BENEFITS.PAYABLE.READY',
    recipientRoles: ['finance_officer'],
    emailApplicable: false,
    emailPolicy: 'INTERNAL_EMAIL_DEFAULT_OFF',
    templateFamily: null,
    productSpecific: false,
    producer: null,
  }),
  e({
    domain: 'PAYMENT',
    command: 'BN_PAYMENT_SCHEDULE_CREATE',
    sourceState: 'PAYABLE_READY',
    targetState: 'SCHEDULED',
    classification: 'COMMUNICATION_OPTIONAL',
    eventCode: 'BENEFITS.PAYMENT.SCHEDULE.CREATED',
    recipientRoles: ['payee'],
    emailApplicable: true,
    emailPolicy: 'EXTERNAL_EMAIL_CONFIGURABLE',
    templateFamily: 'BENEFITS_PAYMENT_SCHEDULE_CREATED',
    productSpecific: false,
    producer: null,
  }),
  ...(
    [
      ['BN_PAYMENT_BATCH_CREATE', 'BATCH.CREATED', 'BATCH_DRAFT'],
      ['BN_PAYMENT_BATCH_APPROVE', 'BATCH.APPROVED', 'BATCH_APPROVED'],
      ['BN_PAYMENT_ISSUE_START', 'ISSUE.STARTED', 'ISSUE_IN_PROGRESS'],
      ['BN_PAYMENT_ISSUE_FAIL', 'ISSUE.FAILED', 'ISSUE_FAILED'],
      [
        'BN_PAYMENT_CANCELLATION_REQUEST',
        'CANCELLATION.REQUESTED',
        'CANCELLATION_REQUESTED',
      ],
      ['BN_PAYMENT_REISSUE_REQUEST', 'REISSUE.REQUESTED', 'REISSUE_REQUESTED'],
      ['BN_POST_ISSUE_COMPLETE', 'POST_ISSUE.COMPLETED', 'POST_ISSUE_COMPLETE'],
    ] as const
  ).map(([command, suffix, target]) =>
    e({
      domain: 'PAYMENT',
      command,
      sourceState: '*',
      targetState: target,
      classification: 'INTERNAL_ONLY',
      eventCode: suffix.startsWith('POST_ISSUE')
        ? `BENEFITS.${suffix}`
        : `BENEFITS.PAYMENT.${suffix}`,
      recipientRoles: ['finance_officer'],
      emailApplicable: false,
      emailPolicy: 'INTERNAL_EMAIL_DEFAULT_OFF',
      templateFamily: null,
      productSpecific: false,
      producer: null,
    }),
  ),
  ...(
    [
      ['BN_PAYMENT_ISSUE', 'ISSUED', 'ISSUED', 'BENEFITS_PAYMENT_ISSUED'],
      ['BN_PAYMENT_CANCEL', 'CANCELLED', 'CANCELLED', 'BENEFITS_PAYMENT_CANCELLED'],
      ['BN_PAYMENT_REISSUE', 'REISSUED', 'REISSUED', 'BENEFITS_PAYMENT_REISSUED'],
      [
        'BN_PAYMENT_CORRECTION_COMPLETE',
        'CORRECTION.COMPLETED',
        'CORRECTED',
        'BENEFITS_PAYMENT_CORRECTION_COMPLETED',
      ],
    ] as const
  ).map(([command, suffix, target, family]) =>
    e({
      domain: 'PAYMENT',
      command,
      sourceState: '*',
      targetState: target,
      classification: 'COMMUNICATION_REQUIRED',
      eventCode: `BENEFITS.PAYMENT.${suffix}`,
      recipientRoles: ['payee'],
      emailApplicable: true,
      emailPolicy: 'EXTERNAL_EMAIL_DEFAULT_ON',
      templateFamily: family,
      productSpecific: false,
      producer: null,
    }),
  ),

  // ----------------------------------------------------- LIFE CERTIFICATE
  ...(
    [
      ['BN_LC_CREATE_OBLIGATION', 'OBLIGATION.CREATED', true, 'BENEFITS_LC_OBLIGATION_CREATED'],
      ['BN_LC_MARK_DUE', 'DUE', true, 'BENEFITS_LC_DUE'],
      ['BN_LC_SEND_REMINDER', 'REMINDER.DUE', true, 'BENEFITS_LC_REMINDER'],
      ['BN_LC_START_GRACE', 'GRACE.STARTED', true, 'BENEFITS_LC_GRACE_STARTED'],
      ['BN_LC_MARK_OVERDUE', 'OVERDUE', true, 'BENEFITS_LC_OVERDUE'],
      ['BN_LC_RECORD_RECEIPT', 'RECEIVED', true, 'BENEFITS_LC_RECEIVED'],
      ['BN_LC_VERIFY', 'VERIFIED', true, 'BENEFITS_LC_VERIFIED'],
      ['BN_LC_REJECT', 'REJECTED', true, 'BENEFITS_LC_REJECTED'],
      [
        'BN_LC_REQUEST_RESUBMISSION',
        'RESUBMISSION_REQUIRED',
        true,
        'BENEFITS_LC_RESUBMISSION_REQUIRED',
      ],
      ['BN_LC_WAIVE', 'WAIVED', true, 'BENEFITS_LC_WAIVED'],
      ['BN_LC_DEFER', 'DEFERRED', true, 'BENEFITS_LC_DEFERRED'],
      [
        'BN_LC_CREATE_SUSPENSION_PROPOSAL',
        'SUSPENSION.PROPOSAL.CREATED',
        false,
        null,
      ],
      [
        'BN_LC_CREATE_REINSTATEMENT_PROPOSAL',
        'REINSTATEMENT.PROPOSAL.CREATED',
        false,
        null,
      ],
    ] as const
  ).map(([command, suffix, external, family]) =>
    e({
      domain: 'LIFE_CERTIFICATE',
      command,
      sourceState: '*',
      targetState: suffix.replace(/\./g, '_'),
      classification: external ? 'COMMUNICATION_REQUIRED' : 'INTERNAL_ONLY',
      eventCode: `BENEFITS.LIFE_CERTIFICATE.${suffix}`,
      recipientRoles: external ? ['beneficiary'] : ['assigned_officer'],
      emailApplicable: external,
      emailPolicy: external
        ? 'EXTERNAL_EMAIL_DEFAULT_ON'
        : 'INTERNAL_EMAIL_DEFAULT_OFF',
      templateFamily: family,
      productSpecific: false,
      producer: null,
    }),
  ),

  // -------------------------------------------------------- MEDICAL REVIEW
  ...(
    [
      ['BN_MR_CREATE_OBLIGATION', 'OBLIGATION.CREATED', null, null],
      ['BN_MR_ISSUE_REFERRAL', 'REFERRAL.ISSUED', 'medical_provider', 'BENEFITS_MR_REFERRAL_ISSUED'],
      ['BN_MR_ACCEPT_REFERRAL', 'REFERRAL.ACCEPTED', null, null],
      ['BN_MR_DECLINE_REFERRAL', 'REFERRAL.DECLINED', null, null],
      ['BN_MR_EXPIRE_REFERRAL', 'REFERRAL.EXPIRED', null, null],
      [
        'BN_MR_SCHEDULE_APPOINTMENT',
        'APPOINTMENT.SCHEDULED',
        'claimant',
        'BENEFITS_MR_APPOINTMENT_SCHEDULED',
      ],
      [
        'BN_MR_RESCHEDULE_APPOINTMENT',
        'APPOINTMENT.RESCHEDULED',
        'claimant',
        'BENEFITS_MR_APPOINTMENT_RESCHEDULED',
      ],
      [
        'BN_MR_CANCEL_APPOINTMENT',
        'APPOINTMENT.CANCELLED',
        'claimant',
        'BENEFITS_MR_APPOINTMENT_CANCELLED',
      ],
      [
        'BN_MR_RECORD_NON_ATTENDANCE',
        'APPOINTMENT.NON_ATTENDANCE',
        'claimant',
        'BENEFITS_MR_NON_ATTENDANCE',
      ],
      [
        'BN_MR_REQUEST_SECOND_OPINION',
        'SECOND_OPINION.REQUESTED',
        'medical_provider',
        'BENEFITS_MR_SECOND_OPINION_REQUESTED',
      ],
      [
        'BN_MR_REQUEST_CLARIFICATION',
        'CLARIFICATION.REQUESTED',
        'medical_provider',
        'BENEFITS_MR_CLARIFICATION_REQUESTED',
      ],
      [
        'BN_MR_SCHEDULE_BOARD_SESSION',
        'BOARD.SESSION.SCHEDULED',
        'board_member',
        'BENEFITS_MR_BOARD_SESSION_SCHEDULED',
      ],
      [
        'BN_MR_REQUEST_BOARD_EVIDENCE',
        'BOARD.EVIDENCE.REQUESTED',
        'claimant',
        'BENEFITS_MR_BOARD_EVIDENCE_REQUESTED',
      ],
      ['BN_MR_COMPLETE_DECISION', 'DECISION.COMPLETED', null, null],
    ] as const
  ).map(([command, suffix, role, family]) =>
    e({
      domain: 'MEDICAL_REVIEW',
      command,
      sourceState: '*',
      targetState: suffix.replace(/\./g, '_'),
      classification: role ? 'COMMUNICATION_REQUIRED' : 'INTERNAL_ONLY',
      eventCode: `BENEFITS.MEDICAL_REVIEW.${suffix}`,
      recipientRoles: role
        ? [role as BenefitsRecipientRole]
        : ['assigned_officer'],
      emailApplicable: Boolean(role),
      emailPolicy: role
        ? 'EXTERNAL_EMAIL_DEFAULT_ON'
        : 'INTERNAL_EMAIL_DEFAULT_OFF',
      templateFamily: family,
      productSpecific: false,
      producer: null,
    }),
  ),

  // --------------------------------------------------------------- APPEAL
  ...(
    [
      ['BN_APPEAL_SUBMIT_CLAIMANT', 'SUBMITTED', true, 'BENEFITS_APPEAL_SUBMITTED'],
      ['BN_APPEAL_ACKNOWLEDGE', 'ACKNOWLEDGED', true, 'BENEFITS_APPEAL_ACKNOWLEDGED'],
      ['BN_APPEAL_REVIEW_ADMISSIBILITY', 'ADMISSIBLE', true, 'BENEFITS_APPEAL_ADMISSIBLE'],
      ['BN_APPEAL_REVIEW_ADMISSIBILITY', 'INADMISSIBLE', true, 'BENEFITS_APPEAL_INADMISSIBLE'],
      ['BN_APPEAL_SCHEDULE_HEARING', 'HEARING.SCHEDULED', true, 'BENEFITS_APPEAL_HEARING_SCHEDULED'],
      ['BN_APPEAL_DECIDE', 'DECIDED', true, 'BENEFITS_APPEAL_DECIDED'],
      ['BN_APPEAL_WITHDRAW', 'WITHDRAWN', true, 'BENEFITS_APPEAL_WITHDRAWN'],
      ['BN_APPEAL_IMPLEMENT', 'IMPLEMENTED', false, null],
      ['BN_APPEAL_REFER_LEGAL', 'REFERRED_TO_LEGAL', false, null],
      ['BN_APPEAL_CLOSE', 'CLOSED', false, null],
    ] as const
  ).map(([command, suffix, external, family]) =>
    e({
      domain: 'APPEAL',
      command,
      sourceState: '*',
      targetState: suffix.replace(/\./g, '_'),
      classification: external ? 'COMMUNICATION_REQUIRED' : 'INTERNAL_ONLY',
      eventCode: `BENEFITS.APPEAL.${suffix}`,
      recipientRoles: external ? ['appellant'] : ['assigned_officer'],
      emailApplicable: external,
      emailPolicy: external
        ? 'EXTERNAL_EMAIL_DEFAULT_ON'
        : 'INTERNAL_EMAIL_DEFAULT_OFF',
      templateFamily: family,
      productSpecific: false,
      producer: null,
    }),
  ),

  // ---------------------------------------------------------- OVERPAYMENT
  ...(
    [
      ['BN_OVP_ISSUE_NOTICE', 'NOTICE.ISSUED', true, 'BENEFITS_OVP_NOTICE_ISSUED'],
      ['BN_OVP_RECORD_REPRESENTATION', 'REPRESENTATION.RECEIVED', true, 'BENEFITS_OVP_REPRESENTATION_RECEIVED'],
      ['BN_OVP_CONFIRM_LIABILITY', 'LIABILITY.CONFIRMED', true, 'BENEFITS_OVP_LIABILITY_CONFIRMED'],
      ['BN_OVP_PROPOSE_RECOVERY_PLAN', 'RECOVERY_PLAN.PROPOSED', true, 'BENEFITS_OVP_RECOVERY_PLAN_PROPOSED'],
      ['BN_OVP_APPROVE_RECOVERY_PLAN', 'RECOVERY_PLAN.APPROVED', true, 'BENEFITS_OVP_RECOVERY_PLAN_APPROVED'],
      ['BN_OVP_REJECT_RECOVERY_PLAN', 'RECOVERY_PLAN.REJECTED', true, 'BENEFITS_OVP_RECOVERY_PLAN_REJECTED'],
      ['BN_OVP_REVISE_RECOVERY_PLAN', 'RECOVERY_PLAN.REVISED', true, 'BENEFITS_OVP_RECOVERY_PLAN_REVISED'],
      ['BN_OVP_REQUEST_WAIVER', 'WAIVER.REQUESTED', false, null],
      ['BN_OVP_APPROVE_WAIVER', 'WAIVER.APPROVED', true, 'BENEFITS_OVP_WAIVER_APPROVED'],
      ['BN_OVP_REJECT_WAIVER', 'WAIVER.REJECTED', true, 'BENEFITS_OVP_WAIVER_REJECTED'],
      ['BN_OVP_REQUEST_WRITEOFF', 'WRITEOFF.REQUESTED', false, null],
      ['BN_OVP_APPROVE_WRITEOFF', 'WRITEOFF.APPROVED', false, null],
      ['BN_OVP_REJECT_WRITEOFF', 'WRITEOFF.REJECTED', false, null],
      ['BN_OVP_SUSPEND_RECOVERY', 'RECOVERY.SUSPENDED', false, null],
      ['BN_OVP_RESUME_RECOVERY', 'RECOVERY.RESUMED', false, null],
      ['BN_OVP_REFER_LEGAL', 'REFERRED_TO_LEGAL', false, null],
      ['BN_OVP_REFER_ESTATE', 'REFERRED_TO_ESTATE', false, null],
      ['BN_OVP_RECONCILE', 'RECOVERED', true, 'BENEFITS_OVP_RECOVERED'],
      ['BN_OVP_CLOSE', 'CLOSED', false, null],
    ] as const
  ).map(([command, suffix, external, family]) =>
    e({
      domain: 'OVERPAYMENT',
      command,
      sourceState: '*',
      targetState: suffix.replace(/\./g, '_'),
      classification: external ? 'COMMUNICATION_REQUIRED' : 'INTERNAL_ONLY',
      eventCode: `BENEFITS.OVERPAYMENT.${suffix}`,
      recipientRoles: external ? ['debtor'] : ['assigned_officer'],
      emailApplicable: external,
      emailPolicy: external
        ? 'EXTERNAL_EMAIL_DEFAULT_ON'
        : 'INTERNAL_EMAIL_DEFAULT_OFF',
      templateFamily: family,
      productSpecific: false,
      producer: null,
    }),
  ),

  // ----------------------------------------------------------- MEANS TEST
  ...(
    [
      ['BN_MEANS_SUBMIT', 'SUBMITTED', true, 'BENEFITS_MEANS_TEST_SUBMITTED'],
      ['BN_MEANS_REQUEST_INFORMATION', 'INFORMATION.REQUESTED', true, 'BENEFITS_MEANS_TEST_INFORMATION_REQUESTED'],
      ['BN_MEANS_APPROVE', 'APPROVED', true, 'BENEFITS_MEANS_TEST_APPROVED'],
      ['BN_MEANS_REJECT', 'REJECTED', true, 'BENEFITS_MEANS_TEST_REJECTED'],
      ['BN_MEANS_SCHEDULE_REASSESSMENT', 'REASSESSMENT.SCHEDULED', false, null],
      ['BN_MEANS_REASSESSMENT_DUE', 'REASSESSMENT.DUE', true, 'BENEFITS_MEANS_TEST_REASSESSMENT_DUE'],
      ['BN_MEANS_SUPERSEDE', 'SUPERSEDED', false, null],
      ['BN_MEANS_CLOSE', 'CLOSED', false, null],
    ] as const
  ).map(([command, suffix, external, family]) =>
    e({
      domain: 'MEANS_TEST',
      command,
      sourceState: '*',
      targetState: suffix.replace(/\./g, '_'),
      classification: external ? 'COMMUNICATION_REQUIRED' : 'INTERNAL_ONLY',
      eventCode: `BENEFITS.MEANS_TEST.${suffix}`,
      recipientRoles: external ? ['claimant'] : ['assigned_officer'],
      emailApplicable: external,
      emailPolicy: external
        ? 'EXTERNAL_EMAIL_CONFIGURABLE'
        : 'INTERNAL_EMAIL_DEFAULT_OFF',
      templateFamily: family,
      productSpecific: true,
      producer: null,
    }),
  ),

  // ------------------------------------------------------------ MORTALITY
  ...(
    [
      ['BN_MORTALITY_REGISTER_REPORT', 'REPORTED', 'reporter', 'BENEFITS_MORTALITY_REPORTED'],
      ['BN_MORTALITY_SUBMIT_FOR_VERIFICATION', 'VERIFICATION.REQUESTED', 'reporter', 'BENEFITS_MORTALITY_VERIFICATION_REQUESTED'],
      ['BN_MORTALITY_CONFIRM_VERIFICATION', 'VERIFIED', null, null],
      ['BN_MORTALITY_RECORD_CONFLICT', 'DISPUTED', null, null],
      ['BN_MORTALITY_REJECT_REPORT', 'REJECTED', 'reporter', 'BENEFITS_MORTALITY_REJECTED'],
      ['BN_MORTALITY_PLACE_PROVISIONAL_HOLD', 'AWARDS.HELD', null, null],
      ['BN_MORTALITY_TERMINATE_AWARD', 'AWARDS.TERMINATED', 'estate_representative', 'BENEFITS_MORTALITY_AWARDS_TERMINATED'],
      ['BN_MORTALITY_INITIATE_SURVIVOR_ASSESSMENT', 'SURVIVOR_ASSESSMENT.STARTED', 'survivor', 'BENEFITS_MORTALITY_SURVIVOR_ASSESSMENT_STARTED'],
      ['BN_MORTALITY_INITIATE_FUNERAL_GRANT', 'FUNERAL_BENEFIT.OPPORTUNITY', 'funeral_claimant', 'BENEFITS_MORTALITY_FUNERAL_BENEFIT_OPPORTUNITY'],
      ['BN_MORTALITY_REFER_LEGAL', 'ESTATE.REFERRAL', null, null],
      ['BN_MORTALITY_CLOSE_EVENT', 'CLOSED', null, null],
    ] as const
  ).map(([command, suffix, role, family]) =>
    e({
      domain: 'MORTALITY',
      command,
      sourceState: '*',
      targetState: suffix.replace(/\./g, '_'),
      classification: role ? 'COMMUNICATION_REQUIRED' : 'INTERNAL_ONLY',
      eventCode: `BENEFITS.MORTALITY.${suffix}`,
      recipientRoles: role
        ? [role as BenefitsRecipientRole]
        : ['assigned_officer'],
      emailApplicable: Boolean(role),
      emailPolicy: role
        ? 'EXTERNAL_EMAIL_CONFIGURABLE'
        : 'INTERNAL_EMAIL_DEFAULT_OFF',
      templateFamily: family,
      productSpecific: false,
      producer: null,
    }),
  ),

  // ----------------------------------------------------------------- RISK
  ...(
    [
      ['BN_RISK_GENERATE_SIGNAL', 'DETECTED'],
      ['BN_RISK_TRIAGE_SIGNAL', 'TRIAGED'],
      ['BN_RISK_REFER_TO_INVESTIGATION', 'INVESTIGATION'],
      ['BN_RISK_PLACE_PAYMENT_HOLD', 'PAYMENT_HELD'],
      ['BN_RISK_RECORD_OUTCOME', 'SYSTEM_ERROR_CONFIRMED'],
      ['BN_RISK_RECORD_OUTCOME', 'CLAIM_CORRECTED'],
      ['BN_RISK_RECORD_OUTCOME', 'OVERPAYMENT_AVOIDED'],
      ['BN_RISK_APPROVE_CONTROL', 'HOLD_RELEASED'],
      ['BN_RISK_REFER_TO_LEGAL', 'REFERRED_TO_LEGAL'],
    ] as const
  ).map(([command, suffix]) =>
    e({
      domain: 'RISK',
      command,
      sourceState: '*',
      targetState: suffix,
      classification: 'INTERNAL_ONLY',
      eventCode: `BENEFITS.RISK.${suffix}`,
      recipientRoles: ['assigned_officer'],
      emailApplicable: false,
      emailPolicy: 'INTERNAL_EMAIL_DEFAULT_OFF',
      templateFamily: null,
      productSpecific: false,
      producer: null,
    }),
  ),
  e({
    domain: 'RISK',
    command: 'BN_RISK_REQUEST_ENH_VERIFICATION',
    sourceState: '*',
    targetState: 'ENHANCED_VERIFICATION',
    classification: 'COMMUNICATION_REQUIRED',
    eventCode: 'BENEFITS.RISK.VERIFICATION.REQUESTED',
    recipientRoles: ['claimant'],
    emailApplicable: true,
    emailPolicy: 'EXTERNAL_EMAIL_CONFIGURABLE',
    templateFamily: 'BENEFITS_RISK_VERIFICATION_REQUESTED',
    productSpecific: false,
    producer: null,
  }),

  // ------------------------------------------------------------- UPRATING
  ...(
    [
      ['BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL', 'AWAITING_APPROVAL'],
      ['BN_UPRATING_APPROVE_RUN', 'APPROVED'],
      ['BN_UPRATING_RETRY_FAILED', 'FAILED'],
      ['BN_UPRATING_ROLLBACK_ELIGIBLE', 'ROLLED_BACK'],
      ['BN_UPRATING_RECONCILE_RUN', 'RECONCILED'],
    ] as const
  ).map(([command, suffix]) =>
    e({
      domain: 'UPRATING',
      command,
      sourceState: '*',
      targetState: suffix,
      classification: 'INTERNAL_ONLY',
      eventCode: `BENEFITS.UPRATING.${suffix}`,
      recipientRoles: ['approver'],
      emailApplicable: false,
      emailPolicy: 'INTERNAL_EMAIL_DEFAULT_OFF',
      templateFamily: null,
      productSpecific: false,
      producer: null,
    }),
  ),

  // ------------------------------- APPEALS (remaining source transitions)
  ...(
    [
      ['BN_APPEAL_REGISTER_RECEIVED_APPEAL', 'REGISTERED'],
      ['BN_APPEAL_START_CASE_PREPARATION', 'CASE_PREPARATION'],
      ['BN_APPEAL_RECOMMEND_OUTCOME', 'RECOMMENDATION_MADE'],
      ['BN_APPEAL_RETURN_RECOMMENDATION', 'RECOMMENDATION_RETURNED'],
      ['BN_APPEAL_RECORD_HEARING_OUTCOME', 'HEARING_HELD'],
      ['BN_APPEAL_MARK_PARTIALLY_IMPLEMENTED', 'PARTIALLY_IMPLEMENTED'],
      ['BN_APPEAL_CANCEL', 'CANCELLED'],
      ['BN_APPEAL_REOPEN', 'REOPENED'],
    ] as const
  ).map(([command, state]) =>
    e({
      domain: 'APPEAL',
      command,
      sourceState: '*',
      targetState: state,
      classification: 'INTERNAL_ONLY',
      eventCode: `BENEFITS.APPEAL.${state}`,
      recipientRoles: ['assigned_officer'],
      emailApplicable: false,
      emailPolicy: 'INTERNAL_EMAIL_DEFAULT_OFF',
      templateFamily: null,
      productSpecific: false,
      producer: null,
    }),
  ),
  ...(
    [
      ['BN_APPEAL_ASSIGN', 'ASSIGNED'],
      ['BN_APPEAL_ATTACH_EVIDENCE', 'EVIDENCE_ATTACHED'],
    ] as const
  ).map(([command, state]) =>
    e({
      domain: 'APPEAL',
      command,
      sourceState: '*',
      targetState: state,
      classification: 'NO_COMMUNICATION_REQUIRED',
      eventCode: null,
      recipientRoles: [],
      emailApplicable: false,
      emailPolicy: 'AUDIT_ONLY',
      templateFamily: null,
      productSpecific: false,
      producer: null,
      reason:
        'Internal case-handling housekeeping with no external or operational communication meaning; the appeal audit trail is the record of the action.',
    }),
  ),

  // ----------------------------- MORTALITY (remaining source transitions)
  ...(
    [
      ['BN_MORTALITY_MATCH_PERSON', 'MATCHED'],
      ['BN_MORTALITY_RESOLVE_CONFLICT', 'CONFLICT_RESOLVED'],
      ['BN_MORTALITY_RELEASE_HOLD', 'HOLD_RELEASED'],
      ['BN_MORTALITY_PREPARE_IMPACT', 'IMPACT_REVIEW'],
      ['BN_MORTALITY_SUBMIT_IMPACT', 'APPROVAL_PENDING'],
      ['BN_MORTALITY_RETURN_IMPACT', 'IMPACT_RETURNED'],
      ['BN_MORTALITY_APPROVE_IMPACT', 'IMPACT_APPROVED'],
      ['BN_MORTALITY_COMPLETE_FOLLOWON', 'FOLLOW_ON_COMPLETED'],
      ['BN_MORTALITY_CREATE_PAD_OVERPAYMENT', 'PAD_OVERPAYMENT_CREATED'],
      ['BN_MORTALITY_REVERSE_CONFIRMATION', 'CONFIRMATION_REVERSED'],
      ['BN_MORTALITY_CANCEL', 'CANCELLED'],
    ] as const
  ).map(([command, state]) =>
    e({
      domain: 'MORTALITY',
      command,
      sourceState: '*',
      targetState: state,
      classification: 'INTERNAL_ONLY',
      eventCode: `BENEFITS.MORTALITY.${state}`,
      recipientRoles: ['assigned_officer'],
      emailApplicable: false,
      emailPolicy: 'INTERNAL_EMAIL_DEFAULT_OFF',
      templateFamily: null,
      productSpecific: false,
      producer: null,
    }),
  ),
  ...(
    [
      ['BN_MORTALITY_DRAFT_SAVE', 'DRAFT'],
      ['BN_MORTALITY_ASSIGN', 'ASSIGNED'],
      ['BN_MORTALITY_ATTACH_EVIDENCE', 'EVIDENCE_ATTACHED'],
      ['BN_MORTALITY_MARK_DUPLICATE', 'DUPLICATE'],
    ] as const
  ).map(([command, state]) =>
    e({
      domain: 'MORTALITY',
      command,
      sourceState: '*',
      targetState: state,
      classification: 'NO_COMMUNICATION_REQUIRED',
      eventCode: null,
      recipientRoles: [],
      emailApplicable: false,
      emailPolicy: 'AUDIT_ONLY',
      templateFamily: null,
      productSpecific: false,
      producer: null,
      reason:
        'Internal record-keeping on a mortality report that changes no external obligation; no living recipient has an interest in this step and the mortality audit trail records it.',
    }),
  ),
];


/** Every distinct canonical event code in the catalogue. */
export function benefitsCatalogueEventCodes(): string[] {
  return Array.from(
    new Set(
      BENEFITS_COMMUNICATION_CATALOGUE.map((row) => row.eventCode).filter(
        (code): code is string => Boolean(code),
      ),
    ),
  ).sort();
}

/** Email-capable events (Email is a valid current/future channel). */
export function benefitsEmailCapableEntries(): BenefitsCommunicationEntry[] {
  return BENEFITS_COMMUNICATION_CATALOGUE.filter((row) => row.emailApplicable);
}

/** Entries that must eventually have a transactional producer. */
export function benefitsProducerRequiredEntries(): BenefitsCommunicationEntry[] {
  return BENEFITS_COMMUNICATION_CATALOGUE.filter(
    (row) =>
      row.classification === 'COMMUNICATION_REQUIRED' ||
      row.classification === 'COMMUNICATION_OPTIONAL',
  );
}

/** Coverage summary used by the admin coverage projection and the tests. */
export interface BenefitsCoverageSummary {
  total: number;
  communicationRequired: number;
  communicationOptional: number;
  internalOnly: number;
  noCommunicationRequired: number;
  unclassified: number;
  emailCapable: number;
  producersWired: number;
  producersPending: number;
}

export function benefitsCoverageSummary(): BenefitsCoverageSummary {
  const rows = BENEFITS_COMMUNICATION_CATALOGUE;
  const byClass = (c: BenefitsCommunicationClassification) =>
    rows.filter((r) => r.classification === c).length;
  const producerRequired = benefitsProducerRequiredEntries();
  return {
    total: rows.length,
    communicationRequired: byClass('COMMUNICATION_REQUIRED'),
    communicationOptional: byClass('COMMUNICATION_OPTIONAL'),
    internalOnly: byClass('INTERNAL_ONLY'),
    noCommunicationRequired: byClass('NO_COMMUNICATION_REQUIRED'),
    unclassified: 0,
    emailCapable: benefitsEmailCapableEntries().length,
    producersWired: producerRequired.filter((r) => r.producer).length,
    producersPending: producerRequired.filter((r) => !r.producer).length,
  };
}
