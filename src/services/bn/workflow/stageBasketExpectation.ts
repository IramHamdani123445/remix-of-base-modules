/**
 * Which workbaskets a workflow stage is expected to be served by.
 *
 * Two separate defects made this necessary:
 *
 *  1. `BN_PAYMENT_OFFICER` staffs both `BN_PAYMENT_PREPARATION` and
 *     `BN_PAYMENT_ISSUE`. Resolving a stage by role alone was therefore
 *     ambiguous, and the tie was broken alphabetically — a claim landed in
 *     Payment Issue because "I" sorts before "P", not because anyone chose it.
 *  2. A template step can name a stage code that contradicts the basket it
 *     points at (the Assistance Pension template bound its "Payment
 *     Authorization" step to the AWARD_SETUP stage and to the Payment
 *     Preparation basket). Nothing detected that, so an award-setup claim sat
 *     in a payment queue with no warning.
 *
 * This module states the expectation once so the resolver can disambiguate and
 * the queue-health reconciliation can report disagreements using exactly the
 * same rule.
 */

/**
 * Stage → basket codes that legitimately serve it, in preference order.
 * A stage absent from this map has no expectation recorded and is never
 * reported as a mismatch.
 */
export const STAGE_TO_BASKET_CODES: Record<string, string[]> = {
  INTAKE: ['BN_INTAKE_REVIEW'],
  EMPLOYER_VERIFY: ['BN_INTAKE_REVIEW'],
  ELIGIBILITY: ['BN_ELIGIBILITY_REVIEW', 'BN_ELIGIBILITY_OVERRIDE_REVIEW'],
  // Templates legitimately combine evidence review with eligibility review,
  // so both queues serve this stage.
  EVIDENCE_REVIEW: ['BN_DOCUMENT_REVIEW', 'DOCUMENT_REVIEW', 'BN_ELIGIBILITY_REVIEW'],

  MEDICAL_REVIEW: ['REVIEW_MEDICAL_CERTIFICATE'],
  MEANS_TEST: ['BN_ELIGIBILITY_REVIEW', 'BN_CALCULATION_REVIEW'],
  CALCULATION: ['BN_CALCULATION_REVIEW'],
  DECISION: [
    'BN_SUPERVISOR_APPROVAL',
    'BN_MANAGER_APPROVAL',
    'BN_DIRECTOR_APPROVAL',
    'BN_CLAIM_RECOMMENDATION',
  ],
  AWARD_SETUP: ['BN_AWARD_SETUP'],
  PAYMENT: ['BN_PAYMENT_PREPARATION', 'BN_PAYMENT_APPROVAL', 'BN_PAYMENT_ISSUE'],
};

const normalise = (value: string | null | undefined) =>
  String(value ?? '').trim().toUpperCase();

export interface BasketLike {
  id: string;
  basket_code?: string | null;
  basket_name?: string | null;
}

/** Basket codes that may serve this stage, or an empty list when unstated. */
export function expectedBasketCodesForStage(stage: string | null | undefined): string[] {
  return STAGE_TO_BASKET_CODES[normalise(stage)] ?? [];
}

/**
 * True when this basket is an acceptable owner for the stage. Stages with no
 * recorded expectation accept any basket — silence beats a false alarm.
 */
export function basketServesStage(
  basketCode: string | null | undefined,
  stage: string | null | undefined,
): boolean {
  const expected = expectedBasketCodesForStage(stage);
  if (expected.length === 0) return true;
  return expected.includes(normalise(basketCode));
}

/**
 * Choose the basket that serves this stage out of several sharing one role.
 *
 * - One candidate → that one, whatever the stage.
 * - Several candidates → the highest-preference basket the stage names.
 * - Several candidates and no stage preference → `null`, so the caller reports
 *   a configuration gap rather than guessing.
 */
export function pickBasketForStage<T extends BasketLike>(
  candidates: readonly T[],
  stage: string | null | undefined,
): T | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  for (const code of expectedBasketCodesForStage(stage)) {
    const hit = candidates.find((b) => normalise(b.basket_code) === code);
    if (hit) return hit;
  }
  return null;
}
