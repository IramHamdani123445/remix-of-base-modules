/**
 * Stage vs queue reconciliation.
 *
 * A claim carries two facts at once: the lifecycle stage its status implies,
 * and the workbasket that currently owns it. They are allowed to differ while
 * a claim is deliberately parked (suspended, awaiting information), but any
 * other disagreement means the routing configuration is wrong — a workflow
 * step bound to the wrong stage code, a stage with no step at all, or a role
 * shared by several baskets.
 *
 * Nothing checked for that before, so a mis-authored template stayed invisible
 * until a user noticed an award-setup claim sitting in a payment queue. This
 * runs the same rule the resolver uses and lists every disagreement with its
 * cause.
 */
import { supabase } from '@/integrations/supabase/client';
import { stepForClaimStatus } from '@/services/bn/workflow/claimStatusStepMap';
import {
  basketServesStage,
  expectedBasketCodesForStage,
} from '@/services/bn/workflow/stageBasketExpectation';

const db = supabase as any;

export type StageQueueVerdict = 'ALIGNED' | 'EXPECTED_HOLD' | 'MISMATCH';

export interface StageQueueFinding {
  claimId: string;
  claimNumber: string | null;
  status: string | null;
  /** Stage the status implies, when a stage owns the claim. */
  stage: string | null;
  basketId: string | null;
  basketCode: string | null;
  basketName: string | null;
  verdict: StageQueueVerdict;
  /** Plain-language cause, shown to the reviewer. */
  reason: string;
  /** Baskets that should have owned this stage. */
  expectedBasketCodes: string[];
}

export interface StageQueueReport {
  checked: number;
  aligned: number;
  expectedHolds: number;
  mismatches: StageQueueFinding[];
}

/**
 * Reconcile every active queue assignment.
 * Read-only: it reports, it never re-routes.
 */
export async function reconcileStageAgainstQueues(): Promise<StageQueueReport> {
  const { data: rows, error } = await db
    .from('bn_claim_queue_assignment')
    .select('claim_id, workbasket_id, bn_claim(claim_number, status), bn_workbasket(basket_code, basket_name)')
    .eq('is_active', true)
    .limit(2000);

  if (error) throw new Error(`Could not read queue assignments — ${error.message}`);

  const findings: StageQueueFinding[] = (Array.isArray(rows) ? rows : []).map((row: any) => {
    const claim = row.bn_claim ?? {};
    const basket = row.bn_workbasket ?? {};
    const status: string | null = claim.status ?? null;
    const basketCode: string | null = basket.basket_code ?? null;
    const disposition = stepForClaimStatus(status);

    const base = {
      claimId: row.claim_id,
      claimNumber: claim.claim_number ?? null,
      status,
      basketId: row.workbasket_id ?? null,
      basketCode,
      basketName: basket.basket_name ?? null,
    };

    if (disposition.kind === 'HOLD') {
      return {
        ...base,
        stage: null,
        verdict: 'EXPECTED_HOLD' as const,
        reason: `Kept with its current owner because ${disposition.reason}.`,
        expectedBasketCodes: [],
      };
    }

    if (disposition.kind === 'TERMINAL') {
      return {
        ...base,
        stage: null,
        verdict: 'MISMATCH' as const,
        reason: `The claim is finished (${disposition.reason}) but still holds an open queue assignment.`,
        expectedBasketCodes: [],
      };
    }

    const stage = disposition.step;
    const expected = expectedBasketCodesForStage(stage);

    if (basketServesStage(basketCode, stage)) {
      return {
        ...base,
        stage,
        verdict: 'ALIGNED' as const,
        reason: 'The owning queue serves this stage.',
        expectedBasketCodes: expected,
      };
    }

    return {
      ...base,
      stage,
      verdict: 'MISMATCH' as const,
      reason:
        `Status "${status}" puts the claim at the ${stage} stage, which is served by ` +
        `${expected.join(' or ')}, but it sits in ${basketCode ?? 'an unnamed queue'}. ` +
        'The workflow step for this stage names the wrong queue, or the stage has no step.',
      expectedBasketCodes: expected,
    };
  });

  return {
    checked: findings.length,
    aligned: findings.filter((f) => f.verdict === 'ALIGNED').length,
    expectedHolds: findings.filter((f) => f.verdict === 'EXPECTED_HOLD').length,
    mismatches: findings.filter((f) => f.verdict === 'MISMATCH'),
  };
}
