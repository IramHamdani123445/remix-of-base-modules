/**
 * BN Medical Reviews — centralised, state-driven action availability.
 *
 * Availability is NEVER decided from permission + `actions_enabled` alone.
 * The record's own lifecycle state participates, so an operator sees *why* a
 * control is unavailable instead of a control that the server would reject.
 *
 * This module is presentation logic. The command RPCs remain authoritative:
 * every rule below is independently re-enforced server-side.
 */
import {
  MEDICAL_REVIEW_ACTIONS,
  medicalReviewPermissionKey,
  type MedicalReviewAction,
} from './permissions';

export type MedicalReviewActorSurface = 'BENEFITS' | 'PROVIDER' | 'BOARD';

export interface ActionAvailability {
  action: MedicalReviewAction;
  /** Rendered at all (an action outside the actor surface is not rendered). */
  visible: boolean;
  /** Rendered as an operable control. */
  enabled: boolean;
  /** Canonical `bn.medical_review.<action>` key the caller must hold. */
  permissionRequired: string;
  /** Source states in which the action is legal; `null` = state-independent. */
  requiredSourceState: string[] | null;
  /** Row version the command must carry; `null` when the command is unversioned. */
  requiredRowVersion: number | null;
  /** Whether the operator must supply a reason before submitting. */
  reasonRequired: boolean;
  /** Human explanation when `enabled` is false. */
  blockedReason: string | null;
  actorSurface: MedicalReviewActorSurface;
}

export interface AvailabilityContext {
  /** Permission probe for the signed-in caller. */
  hasPermission: (action: MedicalReviewAction) => boolean;
  /** Authoritative `app_modules.actions_enabled`. */
  actionsEnabled: boolean;
  /** Lifecycle state of the record the action targets. */
  state: string | null;
  /** Current optimistic-concurrency token of that record. */
  rowVersion: number | null;
  /** Extra business block detected by the caller (e.g. maker-checker). */
  extraBlockedReason?: string | null;
}

interface Spec {
  action: MedicalReviewAction;
  states: string[] | null;
  versioned: boolean;
  reasonRequired: boolean;
  surface: MedicalReviewActorSurface;
  /** Message when the record state does not permit the action. */
  stateMessage?: string;
  /** Result key when several controls share one permission (e.g. expire vs issue). */
  alias?: string;
}

function evaluate(spec: Spec, ctx: AvailabilityContext): ActionAvailability {
  const permissionRequired = medicalReviewPermissionKey(spec.action);
  const hasPermission = ctx.hasPermission(spec.action);
  const state = (ctx.state ?? '').toUpperCase();
  const stateOk = spec.states === null || spec.states.includes(state);

  const blockedReason = !hasPermission
    ? `You do not hold ${permissionRequired}.`
    : !ctx.actionsEnabled
      ? 'Medical Reviews is in read-only dark launch. Operational actions are disabled for this environment.'
      : !stateOk
        ? (spec.stateMessage ??
          `Not available while the record is ${state || 'in an unknown state'}. Requires: ${(spec.states ?? []).join(', ')}.`)
        : spec.versioned && ctx.rowVersion === null
          ? 'The current record version is unknown. Refresh before acting.'
          : (ctx.extraBlockedReason ?? null);

  return {
    action: spec.action,
    visible: true,
    enabled: blockedReason === null,
    permissionRequired,
    requiredSourceState: spec.states,
    requiredRowVersion: spec.versioned ? ctx.rowVersion : null,
    reasonRequired: spec.reasonRequired,
    blockedReason,
    actorSurface: spec.surface,
  };
}

function build(specs: Spec[], ctx: AvailabilityContext): Record<string, ActionAvailability> {
  const out: Record<string, ActionAvailability> = {};
  for (const spec of specs) out[spec.alias ?? spec.action] = evaluate(spec, ctx);
  return out;
}

const A = MEDICAL_REVIEW_ACTIONS;

/* ------------------------------------------------------------------ */
/* Obligation                                                           */
/* ------------------------------------------------------------------ */

export function obligationActionAvailability(ctx: AvailabilityContext) {
  return build(
    [
      { action: A.generateObligations, states: null, versioned: false, reasonRequired: false, surface: 'BENEFITS' },
      {
        action: A.assignProvider,
        states: ['DUE', 'SCHEDULED', 'PENDING', 'IN_PROGRESS', 'GRACE', 'OVERDUE'],
        versioned: false,
        reasonRequired: false,
        surface: 'BENEFITS',
        stateMessage: 'A provider can only be assigned while the obligation is open.',
      },
      {
        action: A.deferReview,
        states: ['DUE', 'SCHEDULED', 'PENDING', 'IN_PROGRESS', 'GRACE', 'OVERDUE'],
        versioned: true,
        reasonRequired: true,
        surface: 'BENEFITS',
      },
      {
        action: A.closeReview,
        states: ['DECISION_COMPLETE', 'COMPLETE', 'IN_PROGRESS', 'DEFERRED'],
        versioned: true,
        reasonRequired: true,
        surface: 'BENEFITS',
        stateMessage: 'This review is already closed or not yet ready to close.',
      },
    ],
    ctx,
  );
}

/* ------------------------------------------------------------------ */
/* Referral                                                             */
/* ------------------------------------------------------------------ */

export function referralActionAvailability(ctx: AvailabilityContext) {
  return build(
    [
      { action: A.verifyCredentials, states: ['NOMINATED', 'DRAFT'], versioned: true, reasonRequired: false, surface: 'BENEFITS' },
      { action: A.issueReferral, states: ['DRAFT', 'VERIFIED'], versioned: true, reasonRequired: false, surface: 'BENEFITS' },
      { action: A.assignProvider, states: ['ISSUED', 'DECLINED', 'EXPIRED'], versioned: true, reasonRequired: true, surface: 'BENEFITS', alias: 'reassign_provider' },
      { action: A.issueReferral, states: ['ISSUED', 'ACCEPTED'], versioned: true, reasonRequired: false, surface: 'BENEFITS', alias: 'expire_referral' },
      { action: A.requestSecondOpinion, states: ['REPORT_ACCEPTED', 'REPORT_SUBMITTED', 'COMPLETE'], versioned: false, reasonRequired: true, surface: 'BENEFITS' },
    ],
    ctx,
  );
}

/** Provider-owned referral actions (restricted portal). */
export function providerReferralActionAvailability(ctx: AvailabilityContext) {
  return build(
    [
      { action: A.submitAssessment, states: ['ISSUED'], versioned: true, reasonRequired: false, surface: 'PROVIDER', stateMessage: 'Only an issued referral can be accepted.', alias: 'accept_referral' },
      { action: A.declareConflict, states: ['ISSUED'], versioned: true, reasonRequired: true, surface: 'PROVIDER', stateMessage: 'Only an issued referral can be declined.', alias: 'decline_referral' },
      { action: A.manageAppointment, states: ['ACCEPTED', 'IN_PROGRESS'], versioned: true, reasonRequired: false, surface: 'PROVIDER' },
    ],
    ctx,
  );
}

/* ------------------------------------------------------------------ */
/* Appointment                                                          */
/* ------------------------------------------------------------------ */

export function appointmentActionAvailability(ctx: AvailabilityContext) {
  return build(
    [
      { action: A.manageAppointment, states: ['SCHEDULED', 'RESCHEDULED', 'PENDING'], versioned: true, reasonRequired: false, surface: 'BENEFITS' },
      { action: A.deferReview, states: ['MISSED', 'NON_ATTENDED'], versioned: true, reasonRequired: true, surface: 'BENEFITS', alias: 'reasonable_cause' },
    ],
    ctx,
  );
}

/* ------------------------------------------------------------------ */
/* Assessment                                                           */
/* ------------------------------------------------------------------ */

export function assessmentActionAvailability(ctx: AvailabilityContext) {
  return build(
    [
      { action: A.submitAssessment, states: ['DRAFT', 'IN_PROGRESS'], versioned: true, reasonRequired: false, surface: 'PROVIDER' },
      { action: A.validateReport, states: ['SUBMITTED', 'CLARIFIED'], versioned: true, reasonRequired: false, surface: 'BENEFITS' },
      { action: A.requestSecondOpinion, states: ['ACCEPTED', 'VALIDATED', 'LOCKED'], versioned: false, reasonRequired: true, surface: 'BENEFITS' },
      { action: A.validateReport, states: ['ACCEPTED', 'VALIDATED'], versioned: true, reasonRequired: false, surface: 'BENEFITS', alias: 'lock_assessment' },
    ],
    ctx,
  );
}

/* ------------------------------------------------------------------ */
/* Board                                                                */
/* ------------------------------------------------------------------ */

export function boardCaseActionAvailability(ctx: AvailabilityContext) {
  return build(
    [
      { action: A.manageBoardCase, states: ['OPEN', 'PENDING_BOARD', 'AWAITING_EVIDENCE', 'DEFERRED'], versioned: true, reasonRequired: false, surface: 'BOARD' },
      { action: A.manageBoardSession, states: ['OPEN', 'PENDING_BOARD', 'BOARD_SELECTED', 'AWAITING_EVIDENCE', 'DEFERRED'], versioned: true, reasonRequired: false, surface: 'BOARD' },
      { action: A.recordBoardDetermination, states: ['IN_SESSION', 'VOTING_COMPLETE', 'SESSION_HELD'], versioned: true, reasonRequired: false, surface: 'BOARD', stateMessage: 'A determination can only be finalised after a held session.' },
    ],
    ctx,
  );
}

export function boardSessionActionAvailability(ctx: AvailabilityContext) {
  return build(
    [
      { action: A.recordBoardParticipation, states: ['SCHEDULED', 'IN_SESSION', 'HELD'], versioned: false, reasonRequired: false, surface: 'BOARD' },
      { action: A.declareConflict, states: ['SCHEDULED', 'IN_SESSION'], versioned: false, reasonRequired: true, surface: 'BOARD' },
    ],
    ctx,
  );
}

/* ------------------------------------------------------------------ */
/* Administrative decision                                              */
/* ------------------------------------------------------------------ */

export function decisionActionAvailability(
  ctx: AvailabilityContext & { preparedByCurrentUser?: boolean; bindingDetermination?: boolean },
) {
  const state = (ctx.state ?? '').toUpperCase();

  const approveExtra =
    ctx.preparedByCurrentUser === true
      ? 'Maker-checker: you cannot approve a decision you prepared.'
      : (ctx.extraBlockedReason ?? null);

  const prepareExtra =
    ctx.bindingDetermination === true && state === 'NONE'
      ? null
      : (ctx.extraBlockedReason ?? null);

  return {
    ...build(
      [
        { action: A.prepareDecision, states: ['NONE', 'RETURNED', 'DRAFT'], versioned: false, reasonRequired: true, surface: 'BENEFITS', stateMessage: 'A decision already exists for this review.' },
        { action: A.closeReview, states: ['APPROVED'], versioned: true, reasonRequired: false, surface: 'BENEFITS', stateMessage: 'Only an approved decision can be completed.', alias: 'complete_decision' },
      ],
      { ...ctx, extraBlockedReason: prepareExtra },
    ),
    ...build(
      [
        { action: A.approveDecision, states: ['SUBMITTED'], versioned: true, reasonRequired: false, surface: 'BENEFITS', stateMessage: 'Only a submitted decision can be approved or returned.' },
      ],
      { ...ctx, extraBlockedReason: approveExtra },
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Award proposals (proposal only — never execution)                    */
/* ------------------------------------------------------------------ */

export function awardProposalActionAvailability(ctx: AvailabilityContext) {
  return build(
    [
      { action: A.proposeSuspension, states: ['APPROVED', 'COMPLETE'], versioned: false, reasonRequired: true, surface: 'BENEFITS', stateMessage: 'A proposal can only be raised from an approved administrative decision.' },
      { action: A.proposeReinstatement, states: ['APPROVED', 'COMPLETE'], versioned: false, reasonRequired: true, surface: 'BENEFITS', stateMessage: 'A proposal can only be raised from an approved administrative decision.' },
    ],
    ctx,
  );
}

/**
 * Mandatory statement rendered on every award-proposal confirmation. Medical
 * Reviews never suspends, reinstates or stops a payment.
 */
export const AWARD_PROPOSAL_BOUNDARY_TEXT =
  'This creates a proposal only. Award Suspension remains responsible for approval, execution, payment holds and arrears.';
