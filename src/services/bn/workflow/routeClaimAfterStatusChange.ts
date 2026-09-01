/**
 * The hook every claim status writer calls immediately after a successful
 * status update.
 *
 * Routing itself lives in `routeClaimToWorkbasket`; this wrapper exists so that
 * a routing gap (a product with no workflow, a step whose role has no basket)
 * can never fail or roll back a legitimate business transition. The transition
 * is already committed by the time we get here — the worst acceptable outcome
 * is a claim that stays in its previous basket and is reported by the
 * "Not in any queue" panel, never a transition that appears to have failed.
 */
import {
  routeClaimToWorkbasket,
  type ClaimRoutingResult,
} from './routeClaimToWorkbasket';

export async function routeClaimAfterStatusChange(
  claimId: string | null | undefined,
  actorCode: string = 'SYSTEM',
): Promise<ClaimRoutingResult | null> {
  if (!claimId) return null;
  try {
    const outcome = await routeClaimToWorkbasket(claimId, actorCode);
    if (outcome.outcome === 'UNROUTED' || outcome.outcome === 'ERROR') {
      console.warn(
        `[bn] claim ${claimId} was not re-routed after its status change: ${outcome.reason}`,
      );
    }
    return outcome;
  } catch (err) {
    console.warn(`[bn] workbasket routing failed for claim ${claimId}`, err);
    return null;
  }
}
