/**
 * One place that answers "which workbasket owns this claim right now?" and
 * makes the queue agree with the answer.
 *
 * Routing used to happen only once, inside intake, and only as a fallback when
 * no workflow started. So a claim entered the intake basket (or no basket at
 * all) and stayed there for the rest of its life regardless of status — which
 * is why /bn/queue showed 4 assignments against 64 claims and why baskets other
 * than intake were empty.
 *
 * This service is called from intake, from every status transition, and from
 * the backfill/repair action, so all three produce the same result:
 *
 *   claim.status  → workflow step        (claimStatusStepMap)
 *   product+channel → workflow template  (resolveProductWorkflow)
 *   step + template → workbasket         (resolveClaimWorkbasket)
 *   → close the stale bn_claim_queue_assignment, open the correct one
 *
 * It is idempotent: a claim already sitting in the right basket is left
 * untouched, so it is safe to call on every transition and to re-run over the
 * whole population.
 */
import { supabase } from '@/integrations/supabase/client';
import { normalizeChannelCode } from './channelNormalization';
import { stepForClaimStatus } from './claimStatusStepMap';
import { resolveClaimWorkbasket } from '@/services/bn/intake/claimWorkbasketResolver';

const db = supabase as any;

export type ClaimRoutingOutcome =
  /** Assignment created — the claim had none. */
  | 'ASSIGNED'
  /** Moved from one basket to another because the status changed. */
  | 'MOVED'
  /** Already in the right basket; nothing written. */
  | 'UNCHANGED'
  /** Terminal status — the open assignment was closed and none opened. */
  | 'CLOSED'
  /** Deliberately left where it is (draft, pending info, suspended). */
  | 'HELD'
  /** Configuration gap — reported, never guessed. */
  | 'UNROUTED'
  /** Something failed; the claim keeps whatever assignment it had. */
  | 'ERROR';

export interface ClaimRoutingResult {
  claimId: string;
  outcome: ClaimRoutingOutcome;
  status: string | null;
  step: string | null;
  fromWorkbasketId: string | null;
  toWorkbasketId: string | null;
  workbasketName: string | null;
  /** Plain-language explanation, always populated. */
  reason: string;
}

function result(partial: Partial<ClaimRoutingResult> & { claimId: string; outcome: ClaimRoutingOutcome; reason: string }): ClaimRoutingResult {
  return {
    status: null,
    step: null,
    fromWorkbasketId: null,
    toWorkbasketId: null,
    workbasketName: null,
    ...partial,
  };
}

/** Route (or re-route) a single claim to the workbasket its status implies. */
export async function routeClaimToWorkbasket(
  claimId: string,
  actorCode: string = 'SYSTEM',
): Promise<ClaimRoutingResult> {
  try {
    const { data: claim, error: claimError } = await db
      .from('bn_claim')
      .select(
        'id, claim_number, status, product_version_id, application_channel, ' +
        'product:bn_product(category)',
      )
      .eq('id', claimId)
      .maybeSingle();
    if (claimError) {
      return result({ claimId, outcome: 'ERROR', reason: `could not read the claim — ${claimError.message}` });
    }
    if (!claim) {
      return result({ claimId, outcome: 'ERROR', reason: 'claim not found' });
    }

    const status: string | null = claim.status ?? null;

    // The assignment currently in force, if any.
    const { data: activeRows } = await db
      .from('bn_claim_queue_assignment')
      .select('id, workbasket_id, assigned_at')
      .eq('claim_id', claimId)
      .eq('is_active', true)
      .order('assigned_at', { ascending: false });
    const active = (activeRows ?? [])[0] ?? null;
    const fromWorkbasketId: string | null = active?.workbasket_id ?? null;

    const disposition = stepForClaimStatus(status);

    if (disposition.kind === 'TERMINAL') {
      if (active) {
        await db
          .from('bn_claim_queue_assignment')
          .update({ is_active: false, completed_at: new Date().toISOString() })
          .eq('claim_id', claimId)
          .eq('is_active', true);
      }
      return result({
        claimId,
        outcome: 'CLOSED',
        status,
        fromWorkbasketId,
        reason: `${disposition.reason}, so it was removed from the work queue`,
      });
    }

    if (disposition.kind === 'HOLD') {
      return result({
        claimId,
        outcome: 'HELD',
        status,
        fromWorkbasketId,
        toWorkbasketId: fromWorkbasketId,
        reason: disposition.reason,
      });
    }

    const step = disposition.step;
    const channel = normalizeChannelCode(claim.application_channel);

    const target = await resolveClaimWorkbasket({
      productVersionId: claim.product_version_id ?? null,
      channelCode: channel,
      productCategory: claim.product?.category ?? null,
      targetStep: step,
    });

    if (!target.workbasketId) {
      return result({
        claimId,
        outcome: 'UNROUTED',
        status,
        step,
        fromWorkbasketId,
        toWorkbasketId: fromWorkbasketId,
        reason: target.reason ?? 'no workbasket could be resolved for this claim',
      });
    }

    if (fromWorkbasketId === target.workbasketId) {
      return result({
        claimId,
        outcome: 'UNCHANGED',
        status,
        step,
        fromWorkbasketId,
        toWorkbasketId: target.workbasketId,
        workbasketName: target.workbasketName,
        reason: `already in ${target.workbasketName ?? 'the correct workbasket'}`,
      });
    }

    // assignClaimToWorkbasket closes the stale assignment before inserting the
    // new one, so a claim is never counted in two baskets at once.
    const { assignClaimToWorkbasket } = await import('@/services/bn/approvalLevelService');
    await assignClaimToWorkbasket(
      claimId,
      target.workbasketId,
      actorCode,
      active
        ? `Re-routed to the ${step} queue after the claim moved to ${status}`
        : `Routed to the ${step} queue`,
      // Unclaimed, so every officer holding the basket's role sees it, with the
      // step's SLA so escalation has a deadline to watch.
      { assignedTo: null, dueAt: target.dueAt ?? null },
    );

    return result({
      claimId,
      outcome: active ? 'MOVED' : 'ASSIGNED',
      status,
      step,
      fromWorkbasketId,
      toWorkbasketId: target.workbasketId,
      workbasketName: target.workbasketName,
      reason: `${step} work is owned by ${target.workbasketName ?? 'this workbasket'}`,
    });
  } catch (err: any) {
    return result({
      claimId,
      outcome: 'ERROR',
      reason: err?.message ?? 'routing failed',
    });
  }
}

export interface ClaimRoutingSweepSummary {
  total: number;
  byOutcome: Record<ClaimRoutingOutcome, number>;
  results: ClaimRoutingResult[];
}

/**
 * Re-route many claims — used by the "Re-route" repair action on the queue
 * screen and to backfill claims created before routing existed.
 */
export async function routeClaims(
  claimIds: string[],
  actorCode: string = 'SYSTEM',
): Promise<ClaimRoutingSweepSummary> {
  const byOutcome: Record<ClaimRoutingOutcome, number> = {
    ASSIGNED: 0, MOVED: 0, UNCHANGED: 0, CLOSED: 0, HELD: 0, UNROUTED: 0, ERROR: 0,
  };
  const results: ClaimRoutingResult[] = [];
  // Sequential on purpose: each claim writes to the same assignment table and
  // the volumes here are operational (tens to low hundreds), not bulk.
  for (const id of claimIds) {
    const r = await routeClaimToWorkbasket(id, actorCode);
    results.push(r);
    byOutcome[r.outcome] += 1;
  }
  return { total: claimIds.length, byOutcome, results };
}

/** Claims that no active workbasket assignment covers, with the reason why. */
export async function findUnroutedClaims(limit = 200): Promise<
  Array<{ id: string; claimNumber: string | null; status: string | null; reason: string }>
> {
  const { data: claims } = await db
    .from('bn_claim')
    .select('id, claim_number, status')
    .not('status', 'in', '("CLOSED","DENIED","WITHDRAWN","DRAFT")')
    .order('entered_at', { ascending: false })
    .limit(limit);

  const rows: any[] = claims ?? [];
  if (rows.length === 0) return [];

  const { data: assigned } = await db
    .from('bn_claim_queue_assignment')
    .select('claim_id')
    .eq('is_active', true)
    .in('claim_id', rows.map((c) => c.id));
  const covered = new Set((assigned ?? []).map((a: any) => a.claim_id));

  return rows
    .filter((c) => !covered.has(c.id))
    .map((c) => ({
      id: c.id,
      claimNumber: c.claim_number ?? null,
      status: c.status ?? null,
      reason: stepForClaimStatus(c.status).kind === 'STEP'
        ? 'no active workbasket assignment — re-route to place it in a queue'
        : (stepForClaimStatus(c.status) as any).reason,
    }));
}
