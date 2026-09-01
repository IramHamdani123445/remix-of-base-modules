/**
 * One-off repair sweep: re-route every claim so its workbasket matches the
 * stage it has actually reached, and close assignments left active on claims
 * that are already terminal.
 *
 * Uses the same routing service the UI's "Route" action uses — no bulk
 * mechanism of its own, so the repair and normal operation cannot diverge.
 *
 * Usage:
 *   bun --preload ./scripts/omni-comms/pilot/preload-browser-session.ts \
 *       ./scripts/bn/repair-claim-workbasket-routing.ts
 */
import { supabase } from '@/integrations/supabase/client';
import { routeClaims } from '@/services/bn/workflow/routeClaimToWorkbasket';

const db = supabase as any;

async function main() {
  const { data, error } = await db
    .from('bn_claim')
    .select('id, claim_number, status')
    .order('entered_at', { ascending: false })
    .limit(1000);
  if (error) throw error;

  const claims: any[] = data ?? [];
  console.log(`Re-routing ${claims.length} claims…`);
  const summary = await routeClaims(claims.map((c) => c.id), 'ROUTING_REPAIR');
  console.log(JSON.stringify(summary.byOutcome, null, 2));

  for (const r of summary.results) {
    if (r.outcome === 'UNROUTED' || r.outcome === 'ERROR') {
      const c = claims.find((x) => x.id === r.claimId);
      console.log(`  ${r.outcome} ${c?.claim_number ?? r.claimId} [${r.status}] — ${r.reason}`);
    }
  }
}

main().catch((e) => {
  console.error('REPAIR_FAILED', e?.message ?? e);
  process.exit(1);
});
