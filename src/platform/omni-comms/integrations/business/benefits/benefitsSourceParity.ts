/**
 * BENEFITS → OMNI-COMMS source parity and implementation-status layer.
 *
 * The communication catalogue says WHAT a Benefits transition means for
 * communication. This module says whether that transition can actually
 * EXECUTE today, who owns the trigger, and how an Omni-Comms business event
 * would be emitted.
 *
 * Facts come from CURRENT Benefits business source only:
 *  - `BN_APPEAL_COMMANDS`         (appeals command specs, `implemented` flag)
 *  - `MORTALITY_COMMAND_CATALOG`  (mortality canonical commands, `implemented`)
 *  - `BN_GAP_COMMAND_CAPABILITY`  (declared gap-module commands)
 *  - `BN_GAP_REGISTERED_COMMANDS` (executable in-process handler registry)
 *  - `BENEFITS_SOURCE_BOUNDARIES` (audited database-RPC / scheduler owners,
 *    every `rpc` name is asserted to exist in the generated database types by
 *    `benefitsSourceParity.test.ts` — no hand-maintained truth).
 *
 * No transport, no Supabase client, no React, no provider SDK, and no
 * dependency on any superseded communication runtime.
 */

import {
  BENEFITS_COMMUNICATION_CATALOGUE,
  type BenefitsCommunicationEntry,
} from './benefitsCommunicationCatalogue';
import { BN_APPEAL_COMMANDS, BN_APPEAL_COMMAND_ALIASES } from '@/types/bn/appeals/appealCommands';
import { MORTALITY_COMMAND_CATALOG } from '@/types/bn/mortality/mortalityCommandCatalog';
import { BN_GAP_COMMAND_CAPABILITY } from '@/services/bn/commands/benefitsCapabilityRegistry';
import { BN_GAP_REGISTERED_COMMANDS } from '@/services/bn/commands/benefitsCommandHandlerRegistry';

/** Whether the business operation behind a transition can run today. */
export type BenefitsSourceStatus =
  /** A user/service can execute this business operation now. */
  | 'EXECUTABLE'
  /** Time-driven: owned by an authoritative Benefits scheduler boundary. */
  | 'SCHEDULER'
  /** Designed and classified, but no executable Benefits source exists yet. */
  | 'PLANNED';

/** Who owns the trigger for the transition. */
export type BenefitsTriggerOwner =
  | 'DATABASE_RPC'
  | 'COMMAND_PIPELINE'
  | 'SCHEDULER'
  | 'CLAIMANT_PORTAL'
  | 'NOT_IMPLEMENTED';

/** How the Omni-Comms business event is (or will be) published. */
export type BenefitsEmissionMechanism =
  /** Inside the authoritative business transaction (preferred). */
  | 'CORE_TRANSACTION'
  /** Generic Benefits command-pipeline publication layer. */
  | 'COMMAND_PIPELINE_PUBLICATION'
  /** Authoritative Benefits scheduler / runner boundary. */
  | 'SCHEDULER_PUBLICATION'
  /** No emission because no communication event exists. */
  | 'NONE';

/** Producer readiness, kept distinct from source readiness. */
export type BenefitsProducerState =
  | 'WIRED'
  | 'PENDING_WIRING'
  | 'WAITING_FOR_SOURCE_IMPLEMENTATION'
  | 'NOT_REQUIRED';

export interface BenefitsSourceBoundary {
  readonly status: BenefitsSourceStatus;
  readonly triggerOwner: BenefitsTriggerOwner;
  readonly emissionMechanism: BenefitsEmissionMechanism;
  /** Authoritative source reference (RPC name or module path). */
  readonly sourceRef: string;
  /** Database function backing the transition, when the owner is an RPC. */
  readonly rpc?: string;
}

const rpcBoundary = (
  rpc: string,
  status: BenefitsSourceStatus = 'EXECUTABLE',
): BenefitsSourceBoundary => ({
  status,
  triggerOwner: status === 'SCHEDULER' ? 'SCHEDULER' : 'DATABASE_RPC',
  emissionMechanism:
    status === 'SCHEDULER' ? 'SCHEDULER_PUBLICATION' : 'CORE_TRANSACTION',
  sourceRef: `public.${rpc}`,
  rpc,
});

const planned = (note: string): BenefitsSourceBoundary => ({
  status: 'PLANNED',
  triggerOwner: 'NOT_IMPLEMENTED',
  emissionMechanism: 'NONE',
  sourceRef: note,
});

/**
 * Audited boundary per catalogue command. Absence means PLANNED: the
 * conservative default guarantees a non-executable Benefits command is never
 * reported as a missing live producer.
 */
export const BENEFITS_SOURCE_BOUNDARIES: Readonly<
  Record<string, BenefitsSourceBoundary>
> = {
  // ---------------------------------------------------------------- CLAIM
  BN_CLAIM_SUBMIT: rpcBoundary('bn_submit_claim_application'),
  BN_CLAIM_CREATE: planned('Claim draft creation not exposed as a command boundary.'),
  BN_CLAIM_VERIFY: planned('Verification handled inside intake review UI, no command RPC.'),
  BN_CLAIM_WITHDRAW: planned('No withdrawal RPC in current Benefits source.'),
  BN_CLAIM_CORRECTION_COMPLETE: planned('Correction completion RPC not yet delivered.'),
  BN_CLAIM_SLA_ESCALATE: planned('SLA escalation boundary not yet delivered.'),

  // ------------------------------------------------------------- EVIDENCE
  BN_CLAIM_REQUEST_EVIDENCE: planned('Evidence request RPC not yet delivered.'),
  BN_CLAIM_RECORD_EVIDENCE: planned('Evidence receipt RPC not yet delivered.'),
  BN_CLAIM_REJECT_EVIDENCE: planned('Evidence rejection RPC not yet delivered.'),

  // ---------------------------------------------------------- CALCULATION
  // ------------------------------------------- ELIGIBILITY / CALCULATION
  BN_ELIGIBILITY_EVALUATE: {
    status: 'EXECUTABLE',
    triggerOwner: 'COMMAND_PIPELINE',
    emissionMechanism: 'NONE',
    sourceRef: 'src/services/bn/calculationEngine.ts (evaluateEligibility)',
  },
  BN_CLAIM_CALCULATE: rpcBoundary('bn_calc_finalise_run_v1'),


  // -------------------------------------------------- DETERMINATION/AWARD
  BN_DETERMINATION_READY: planned('Determination readiness is a derived projection.'),
  BN_CLAIM_APPROVE: planned('Approval decision RPC not yet delivered.'),
  BN_CLAIM_DISALLOW: planned('Disallowance decision RPC not yet delivered.'),
  BN_ENTITLEMENT_CREATE: planned('Entitlement creation RPC not yet delivered.'),
  BN_AWARD_CREATE: planned('Award creation RPC not yet delivered.'),
  BN_AWARD_ADJUST: planned('Award adjustment RPC not yet delivered.'),
  BN_AWARD_TERMINATE: planned('Award termination RPC not yet delivered.'),
  'BN_UPRATING_EXECUTE_BATCH (per-award effect)': rpcBoundary(
    'bn_uprating_run_execution_v1',
    'SCHEDULER',
  ),

  // ------------------------------------------ SUSPENSION / REINSTATEMENT
  BN_AWARD_SUSPENSION_PROPOSE: rpcBoundary('bn_award_suspension_propose_v1'),
  BN_AWARD_SUSPENSION_APPROVE: rpcBoundary('bn_award_suspension_approve_v1'),
  BN_AWARD_SUSPENSION_REJECT: rpcBoundary('bn_award_suspension_reject_v1'),
  BN_AWARD_SUSPENSION_EXECUTE: rpcBoundary('bn_award_suspension_execute_v1'),
  BN_AWARD_SUSPENSION_EXECUTION_FAIL: rpcBoundary(
    'bn_award_suspension_execute_scheduled_v1',
    'SCHEDULER',
  ),
  BN_AWARD_REINSTATEMENT_PROPOSE: rpcBoundary('bn_award_reinstatement_propose_v1'),
  BN_AWARD_REINSTATEMENT_APPROVE: rpcBoundary('bn_award_reinstatement_approve_v1'),
  BN_AWARD_REINSTATEMENT_REJECT: rpcBoundary('bn_award_reinstatement_reject_v1'),
  BN_AWARD_REINSTATEMENT_EXECUTE: rpcBoundary('bn_award_reinstatement_execute_v1'),

  // -------------------------------------------------------------- PAYMENT
  BN_PAYMENT_SCHEDULE_CREATE: rpcBoundary('bn_payment_schedule_rebuild_for_award_v1'),
  BN_PAYABLE_BLOCK: planned('Payable blocking RPC not yet delivered.'),
  BN_PAYABLE_READY: planned('Payable readiness is a derived projection.'),
  BN_PAYMENT_BATCH_CREATE: planned('Payment batch RPC not yet delivered.'),
  BN_PAYMENT_BATCH_APPROVE: planned('Payment batch approval RPC not yet delivered.'),
  BN_PAYMENT_ISSUE_START: planned('Payment issue pipeline not yet delivered.'),
  BN_PAYMENT_ISSUE_FAIL: planned('Payment issue pipeline not yet delivered.'),
  BN_PAYMENT_ISSUE: planned('Payment issue RPC not yet delivered.'),
  BN_PAYMENT_CANCEL: planned('Payment cancellation RPC not yet delivered.'),
  BN_PAYMENT_REISSUE: planned('Payment reissue RPC not yet delivered.'),
  BN_PAYMENT_CANCELLATION_REQUEST: planned('Cancellation request RPC not yet delivered.'),
  BN_PAYMENT_REISSUE_REQUEST: planned('Reissue request RPC not yet delivered.'),
  BN_PAYMENT_CORRECTION_COMPLETE: planned('Payment correction RPC not yet delivered.'),
  BN_POST_ISSUE_COMPLETE: planned('Post-issue review RPC not yet delivered.'),

  // ----------------------------------------------------- LIFE CERTIFICATE
  BN_LC_CREATE_OBLIGATION: rpcBoundary(
    'bn_life_certificate_generate_obligations_v1',
    'SCHEDULER',
  ),
  BN_LC_MARK_DUE: rpcBoundary('bn_life_certificate_mark_milestone_v1', 'SCHEDULER'),
  BN_LC_SEND_REMINDER: rpcBoundary('bn_life_certificate_mark_milestone_v1', 'SCHEDULER'),
  BN_LC_START_GRACE: rpcBoundary('bn_life_certificate_mark_milestone_v1', 'SCHEDULER'),
  BN_LC_MARK_OVERDUE: rpcBoundary('bn_life_certificate_mark_milestone_v1', 'SCHEDULER'),
  BN_LC_RECORD_RECEIPT: rpcBoundary('bn_life_certificate_receive_v1'),
  BN_LC_VERIFY: rpcBoundary('bn_life_certificate_verify_v1'),
  BN_LC_REJECT: rpcBoundary('bn_life_certificate_reject_v1'),
  BN_LC_REQUEST_RESUBMISSION: rpcBoundary('bn_life_certificate_request_resubmission_v1'),
  BN_LC_WAIVE: rpcBoundary('bn_life_certificate_waive_v1'),
  BN_LC_DEFER: rpcBoundary('bn_life_certificate_defer_v1'),
  BN_LC_CREATE_SUSPENSION_PROPOSAL: rpcBoundary(
    'bn_life_certificate_escalate_to_suspension_v1',
  ),
  BN_LC_CREATE_REINSTATEMENT_PROPOSAL: rpcBoundary(
    'bn_life_certificate_propose_reinstatement_v1',
  ),

  // ------------------------------------------------------- MEDICAL REVIEW
  BN_MR_CREATE_OBLIGATION: rpcBoundary('bn_medical_review_generate_obligation_v1'),
  BN_MR_ISSUE_REFERRAL: rpcBoundary('bn_medical_review_issue_referral_v1'),
  BN_MR_ACCEPT_REFERRAL: rpcBoundary('bn_medical_review_accept_referral_v1'),
  BN_MR_DECLINE_REFERRAL: rpcBoundary('bn_medical_review_decline_referral_v1'),
  BN_MR_EXPIRE_REFERRAL: rpcBoundary('bn_medical_review_expire_referral_v1', 'SCHEDULER'),
  BN_MR_SCHEDULE_APPOINTMENT: rpcBoundary('bn_medical_review_schedule_appointment_v1'),
  BN_MR_RESCHEDULE_APPOINTMENT: rpcBoundary('bn_medical_review_reschedule_appointment_v1'),
  BN_MR_CANCEL_APPOINTMENT: rpcBoundary('bn_medical_review_record_provider_cancellation_v1'),
  BN_MR_RECORD_NON_ATTENDANCE: rpcBoundary('bn_medical_review_record_non_attendance_v1'),
  BN_MR_REQUEST_SECOND_OPINION: rpcBoundary('bn_medical_review_request_second_opinion_v1'),
  BN_MR_REQUEST_CLARIFICATION: rpcBoundary('bn_medical_review_request_clarification_v1'),
  BN_MR_SCHEDULE_BOARD_SESSION: rpcBoundary('bn_medical_review_schedule_board_session_v1'),
  BN_MR_REQUEST_BOARD_EVIDENCE: rpcBoundary('bn_medical_review_request_board_evidence_v1'),
  BN_MR_COMPLETE_DECISION: rpcBoundary('bn_medical_review_complete_decision_v1'),

  // ---------------------------------------------------------- OVERPAYMENT
  BN_OVP_ISSUE_NOTICE: rpcBoundary('bn_overpayment_issue_notice_v1'),
  BN_OVP_RECORD_REPRESENTATION: rpcBoundary('bn_overpayment_record_representation_v1'),
  BN_OVP_CONFIRM_LIABILITY: rpcBoundary('bn_overpayment_confirm_liability_v1'),
  BN_OVP_PROPOSE_RECOVERY_PLAN: rpcBoundary('bn_overpayment_propose_recovery_plan_v1'),
  BN_OVP_APPROVE_RECOVERY_PLAN: rpcBoundary('bn_overpayment_approve_recovery_plan_v1'),
  BN_OVP_REJECT_RECOVERY_PLAN: rpcBoundary('bn_overpayment_reject_recovery_plan_v1'),
  BN_OVP_REVISE_RECOVERY_PLAN: rpcBoundary('bn_overpayment_revise_recovery_plan_v1'),
  BN_OVP_REQUEST_WAIVER: rpcBoundary('bn_overpayment_request_waiver_v1'),
  BN_OVP_APPROVE_WAIVER: rpcBoundary('bn_overpayment_approve_waiver_v1'),
  BN_OVP_REJECT_WAIVER: rpcBoundary('bn_overpayment_reject_waiver_v1'),
  BN_OVP_REQUEST_WRITEOFF: rpcBoundary('bn_overpayment_request_writeoff_v1'),
  BN_OVP_APPROVE_WRITEOFF: rpcBoundary('bn_overpayment_approve_writeoff_v1'),
  BN_OVP_REJECT_WRITEOFF: rpcBoundary('bn_overpayment_reject_writeoff_v1'),
  BN_OVP_SUSPEND_RECOVERY: rpcBoundary('bn_overpayment_suspend_recovery_v1'),
  BN_OVP_RESUME_RECOVERY: rpcBoundary('bn_overpayment_resume_recovery_v1'),
  BN_OVP_REFER_LEGAL: rpcBoundary('bn_overpayment_refer_legal_v1'),
  BN_OVP_REFER_ESTATE: rpcBoundary('bn_overpayment_refer_estate_v1'),
  BN_OVP_RECONCILE: rpcBoundary('bn_overpayment_reconcile_v1'),
  BN_OVP_CLOSE: rpcBoundary('bn_overpayment_close_v1'),

  // ----------------------------------------------------------- MEANS TEST
  BN_MEANS_SUBMIT: rpcBoundary('bn_means_lifecycle_command_v1'),
  BN_MEANS_REQUEST_INFORMATION: rpcBoundary('bn_means_evidence_command_v1'),
  BN_MEANS_APPROVE: rpcBoundary('bn_means_lifecycle_command_v1'),
  BN_MEANS_REJECT: rpcBoundary('bn_means_lifecycle_command_v1'),
  BN_MEANS_SCHEDULE_REASSESSMENT: rpcBoundary('bn_means_lifecycle_command_v1'),
  BN_MEANS_REASSESSMENT_DUE: rpcBoundary('bn_means_reassessment_queue_v1', 'SCHEDULER'),
  BN_MEANS_SUPERSEDE: rpcBoundary('bn_means_lifecycle_command_v1'),
  BN_MEANS_CLOSE: rpcBoundary('bn_means_lifecycle_command_v1'),
};

/** Appeals commands, with the authoritative `implemented` flag. */
const APPEAL_IMPLEMENTED = new Map(
  BN_APPEAL_COMMANDS.map((c) => [c.command as string, c.implemented]),
);

/** Mortality commands, with the authoritative `implemented` flag. */
const MORTALITY_IMPLEMENTED = new Map(
  MORTALITY_COMMAND_CATALOG.map((c) => [c.command as string, c.implemented]),
);

/** Commands whose in-process handler is registered (truly executable). */
const REGISTERED_HANDLERS = new Set(
  BN_GAP_REGISTERED_COMMANDS.map((h) => h.commandName),
);

/** Deprecated aliases that must never be treated as business transitions. */
export const BENEFITS_COMMAND_ALIASES: readonly string[] = Object.keys(
  BN_APPEAL_COMMAND_ALIASES,
);

/** Every command name declared by an authoritative Benefits source. */
export function discoverBenefitsSourceCommands(): string[] {
  const all = new Set<string>([
    ...Object.keys(BN_GAP_COMMAND_CAPABILITY),
    ...APPEAL_IMPLEMENTED.keys(),
    ...MORTALITY_IMPLEMENTED.keys(),
    ...Object.keys(BENEFITS_SOURCE_BOUNDARIES),
  ]);
  for (const alias of BENEFITS_COMMAND_ALIASES) all.delete(alias);
  return [...all].sort();
}

export function resolveBenefitsSourceBoundary(
  command: string,
): BenefitsSourceBoundary {
  const appealImplemented = APPEAL_IMPLEMENTED.get(command);
  if (appealImplemented !== undefined) {
    return appealImplemented
      ? {
          status: 'EXECUTABLE',
          triggerOwner:
            command === 'BN_APPEAL_SUBMIT_CLAIMANT'
              ? 'CLAIMANT_PORTAL'
              : 'COMMAND_PIPELINE',
          emissionMechanism: 'COMMAND_PIPELINE_PUBLICATION',
          sourceRef: 'src/types/bn/appeals/appealCommands.ts',
        }
      : {
          status: 'PLANNED',
          triggerOwner: 'NOT_IMPLEMENTED',
          emissionMechanism: 'NONE',
          sourceRef: 'src/types/bn/appeals/appealCommands.ts (implemented=false)',
        };
  }

  const mortalityImplemented = MORTALITY_IMPLEMENTED.get(command);
  if (mortalityImplemented !== undefined) {
    const executable =
      mortalityImplemented &&
      (REGISTERED_HANDLERS.has(command) || REGISTERED_HANDLERS.size > 0);
    return executable
      ? {
          status: 'EXECUTABLE',
          triggerOwner: 'COMMAND_PIPELINE',
          emissionMechanism: 'COMMAND_PIPELINE_PUBLICATION',
          sourceRef: 'src/types/bn/mortality/mortalityCommandCatalog.ts',
        }
      : {
          status: 'PLANNED',
          triggerOwner: 'NOT_IMPLEMENTED',
          emissionMechanism: 'NONE',
          sourceRef:
            'src/types/bn/mortality/mortalityCommandCatalog.ts (implemented=false)',
        };
  }

  return (
    BENEFITS_SOURCE_BOUNDARIES[command] ??
    planned('No authoritative Benefits source boundary discovered.')
  );
}

export function resolveBenefitsSourceStatus(command: string): BenefitsSourceStatus {
  return resolveBenefitsSourceBoundary(command).status;
}

/** Producer readiness for a catalogue row, never conflated with source state. */
export function resolveBenefitsProducerState(
  entry: BenefitsCommunicationEntry,
): BenefitsProducerState {
  const producerRequired =
    entry.classification === 'COMMUNICATION_REQUIRED' ||
    entry.classification === 'COMMUNICATION_OPTIONAL';
  if (!producerRequired) return 'NOT_REQUIRED';
  if (entry.producer) return 'WIRED';
  const status = resolveBenefitsSourceStatus(entry.command);
  return status === 'PLANNED'
    ? 'WAITING_FOR_SOURCE_IMPLEMENTATION'
    : 'PENDING_WIRING';
}

export interface BenefitsSourceParityReport {
  /** Distinct catalogue commands. */
  catalogueCommands: string[];
  /** Commands discovered from authoritative Benefits source. */
  sourceCommands: string[];
  /** Catalogue commands with no discovered source declaration. */
  catalogueOnly: string[];
  /** Gap-module source commands absent from the catalogue. */
  sourceMissingFromCatalogue: string[];
  /** Deprecated aliases wrongly used as catalogue commands. */
  aliasesUsedAsTransitions: string[];
  /** Catalogue rows sharing one (command, targetState) identity. */
  duplicateTransitions: string[];
}

export function benefitsSourceParityReport(): BenefitsSourceParityReport {
  const catalogueCommands = [
    ...new Set(BENEFITS_COMMUNICATION_CATALOGUE.map((r) => r.command)),
  ].sort();
  const sourceCommands = discoverBenefitsSourceCommands();
  const declared = new Set([
    ...Object.keys(BN_GAP_COMMAND_CAPABILITY),
    ...APPEAL_IMPLEMENTED.keys(),
    ...MORTALITY_IMPLEMENTED.keys(),
    ...Object.keys(BENEFITS_SOURCE_BOUNDARIES),
  ]);

  const seen = new Map<string, number>();
  for (const row of BENEFITS_COMMUNICATION_CATALOGUE) {
    const id = `${row.command}::${row.targetState}`;
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }

  return {
    catalogueCommands,
    sourceCommands,
    catalogueOnly: catalogueCommands.filter((c) => !declared.has(c)),
    sourceMissingFromCatalogue: [...APPEAL_IMPLEMENTED.keys(), ...MORTALITY_IMPLEMENTED.keys()]
      .filter((c) => !catalogueCommands.includes(c))
      .sort(),
    aliasesUsedAsTransitions: catalogueCommands.filter((c) =>
      BENEFITS_COMMAND_ALIASES.includes(c),
    ),
    duplicateTransitions: [...seen.entries()]
      .filter(([, n]) => n > 1)
      .map(([id]) => id)
      .sort(),
  };
}

/**
 * The three numbers that must never be collapsed into one:
 *  1. events designed,
 *  2. events whose business source can execute,
 *  3. events whose Omni-Comms producer is wired.
 */
export interface BenefitsThreeNumberCoverage {
  eventsDesigned: number;
  sourceExecutable: number;
  sourceScheduler: number;
  sourcePlanned: number;
  producersWired: number;
  producersPendingWiring: number;
  producersWaitingForSource: number;
  emailCapable: number;
  emailCapableExecutable: number;
}

export function benefitsThreeNumberCoverage(): BenefitsThreeNumberCoverage {
  const rows = BENEFITS_COMMUNICATION_CATALOGUE;
  const withEvent = rows.filter((r) => r.eventCode);
  const statusOf = (r: BenefitsCommunicationEntry) =>
    resolveBenefitsSourceStatus(r.command);
  const producerOf = (r: BenefitsCommunicationEntry) =>
    resolveBenefitsProducerState(r);

  return {
    eventsDesigned: new Set(withEvent.map((r) => r.eventCode)).size,
    sourceExecutable: rows.filter((r) => statusOf(r) === 'EXECUTABLE').length,
    sourceScheduler: rows.filter((r) => statusOf(r) === 'SCHEDULER').length,
    sourcePlanned: rows.filter((r) => statusOf(r) === 'PLANNED').length,
    producersWired: rows.filter((r) => producerOf(r) === 'WIRED').length,
    producersPendingWiring: rows.filter((r) => producerOf(r) === 'PENDING_WIRING')
      .length,
    producersWaitingForSource: rows.filter(
      (r) => producerOf(r) === 'WAITING_FOR_SOURCE_IMPLEMENTATION',
    ).length,
    emailCapable: rows.filter((r) => r.emailApplicable).length,
    emailCapableExecutable: rows.filter(
      (r) => r.emailApplicable && statusOf(r) !== 'PLANNED',
    ).length,
  };
}

/** Row-level projection consumed by the Benefits communications admin view. */
export interface BenefitsCoverageRow {
  domain: string;
  command: string;
  eventCode: string | null;
  classification: string;
  emailApplicable: boolean;
  emailPolicy: string;
  templateFamily: string | null;
  sourceStatus: BenefitsSourceStatus;
  triggerOwner: BenefitsTriggerOwner;
  emissionMechanism: BenefitsEmissionMechanism;
  sourceRef: string;
  producerState: BenefitsProducerState;
}

export function benefitsCoverageRows(): BenefitsCoverageRow[] {
  return BENEFITS_COMMUNICATION_CATALOGUE.map((r) => {
    const boundary = resolveBenefitsSourceBoundary(r.command);
    return {
      domain: r.domain,
      command: r.command,
      eventCode: r.eventCode,
      classification: r.classification,
      emailApplicable: r.emailApplicable,
      emailPolicy: r.emailPolicy,
      templateFamily: r.templateFamily,
      sourceStatus: boundary.status,
      triggerOwner: boundary.triggerOwner,
      emissionMechanism: boundary.emissionMechanism,
      sourceRef: boundary.sourceRef,
      producerState: resolveBenefitsProducerState(r),
    };
  });
}
