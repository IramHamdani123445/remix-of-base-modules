/**
 * Claim status → workflow step.
 *
 * Routing resolves the workbasket from the workflow step that owns the claim
 * right now. Status names and step names are two different vocabularies —
 * only EVIDENCE_REVIEW, CALCULATION and DECISION are spelled identically — so
 * matching them by name would silently unroute most claims. The mapping is
 * therefore stated explicitly here.
 *
 * `INTAKE` is included deliberately: `bn_submit_claim_application` currently
 * inserts that status even though no transition rule references it. Any claim
 * created since must still route, and the backfill must not skip them.
 *
 * A status that maps to nothing is NOT an error. It means "no step owns this
 * claim" — the claim keeps its current basket and the reason is recorded. It is
 * never dropped out of every queue.
 */

/** Step names seen in `bn_workflow_template.steps_config`. */
export type WorkflowStepName =
  | 'INTAKE'
  | 'EMPLOYER_VERIFY'
  | 'ELIGIBILITY'
  | 'EVIDENCE_REVIEW'
  | 'MEDICAL_REVIEW'
  | 'MEANS_TEST'
  | 'CALCULATION'
  | 'DECISION'
  | 'AWARD_SETUP'
  | 'PAYMENT';

export type ClaimStepDisposition =
  /** A step owns the claim; route to that step's basket. */
  | { kind: 'STEP'; step: WorkflowStepName }
  /** No step owns it right now; keep the current basket and record why. */
  | { kind: 'HOLD'; reason: string }
  /** The claim is finished; close any active assignment, open none. */
  | { kind: 'TERMINAL'; reason: string };

const STEP_BY_STATUS: Record<string, ClaimStepDisposition> = {
  // Pre-submission
  DRAFT: { kind: 'HOLD', reason: 'the claim is still a draft and has not been submitted' },

  // Intake
  SUBMITTED: { kind: 'STEP', step: 'INTAKE' },
  // Written by bn_submit_claim_application; not in the transition matrix yet.
  INTAKE: { kind: 'STEP', step: 'INTAKE' },
  INTAKE_REVIEW: { kind: 'STEP', step: 'INTAKE' },

  // Assessment
  ELIGIBILITY_CHECK: { kind: 'STEP', step: 'ELIGIBILITY' },
  EVIDENCE_REVIEW: { kind: 'STEP', step: 'EVIDENCE_REVIEW' },
  CALCULATION: { kind: 'STEP', step: 'CALCULATION' },
  DECISION: { kind: 'STEP', step: 'DECISION' },

  // Post-decision
  APPROVED: { kind: 'STEP', step: 'AWARD_SETUP' },
  AWARD_SETUP: { kind: 'STEP', step: 'AWARD_SETUP' },
  PAYMENT_QUEUE: { kind: 'STEP', step: 'PAYMENT' },
  IN_PAYMENT: { kind: 'STEP', step: 'PAYMENT' },

  // Paused — an officer still owns it, so the basket must not change.
  PENDING_INFO: {
    kind: 'HOLD',
    reason: 'the claim is waiting on information and stays with its current owner',
  },
  SUSPENDED: {
    kind: 'HOLD',
    reason: 'the claim is suspended and stays with its current owner',
  },

  // Finished
  APPROVED_CLOSED: { kind: 'TERMINAL', reason: 'the claim is closed' },
  CLOSED: { kind: 'TERMINAL', reason: 'the claim is closed' },
  DENIED: { kind: 'TERMINAL', reason: 'the claim was denied' },
  WITHDRAWN: { kind: 'TERMINAL', reason: 'the claim was withdrawn' },
};

/**
 * Which workflow step owns a claim in this status.
 * An unrecognised status HOLDs — never silently unroutes.
 */
export function stepForClaimStatus(status: string | null | undefined): ClaimStepDisposition {
  const key = String(status ?? '').trim().toUpperCase();
  if (!key) {
    return { kind: 'HOLD', reason: 'the claim has no status recorded' };
  }
  return (
    STEP_BY_STATUS[key] ?? {
      kind: 'HOLD',
      reason: `claim status "${key}" is not mapped to a workflow step`,
    }
  );
}

/** Every status the mapping knows — used by tests and diagnostics. */
export function mappedClaimStatuses(): string[] {
  return Object.keys(STEP_BY_STATUS).sort();
}
