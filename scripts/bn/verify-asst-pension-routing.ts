/**
 * ASST_PENSION lifecycle routing verification.
 *
 * Moves ONE already-registered test claim through the lifecycle statuses and
 * records, at each stage, the workbasket the platform routes it to versus the
 * workbasket the product's workflow template configures for that step.
 *
 * Read-and-route only: it changes claim status + queue assignment on the named
 * test claim and nothing else.
 *
 * Usage:
 *   CLAIM_ID=... bun --preload ./scripts/omni-comms/pilot/preload-browser-session.ts \
 *       ./scripts/bn/verify-asst-pension-routing.ts
 */
import { supabase } from '@/integrations/supabase/client';
import { routeClaimToWorkbasket } from '@/services/bn/workflow/routeClaimToWorkbasket';

const db = supabase as any;
const CLAIM_ID = process.env.CLAIM_ID ?? '5c447692-df9b-4439-8c24-99d4d5a1acf4';

const LIFECYCLE = [
  'INTAKE',
  'ELIGIBILITY_CHECK',
  'EVIDENCE_REVIEW',
  'CALCULATION',
  'DECISION',
  'APPROVED',
  'PAYMENT_QUEUE',
];

async function currentBasket(): Promise<string> {
  const { data } = await db
    .from('bn_claim_queue_assignment')
    .select('workbasket_id, due_at, workbasket:bn_workbasket(basket_code, basket_name, assigned_role)')
    .eq('claim_id', CLAIM_ID)
    .eq('is_active', true)
    .order('assigned_at', { ascending: false });
  const row = (data ?? [])[0];
  if (!row) return 'NONE';
  return `${row.workbasket?.basket_name} [${row.workbasket?.assigned_role}] due=${row.due_at ?? 'none'}`;
}

async function main() {
  for (const status of LIFECYCLE) {
    if (status !== 'INTAKE') {
      const { error } = await db.from('bn_claim').update({ status }).eq('id', CLAIM_ID);
      if (error) {
        console.log(`${status.padEnd(18)} STATUS_UPDATE_BLOCKED: ${error.message}`);
        continue;
      }
    }
    const r = await routeClaimToWorkbasket(CLAIM_ID, 'ROUTING_VERIFICATION');
    console.log(
      `${status.padEnd(18)} step=${String(r.step ?? '-').padEnd(16)} outcome=${String(r.outcome).padEnd(10)} basket=${await currentBasket()}  | ${r.reason ?? ''}`,
    );
  }
}

main().catch((e) => {
  console.error('VERIFICATION_FAILED', e?.message ?? e);
  process.exit(1);
});
