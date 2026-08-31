import { runClaimEligibility } from '@/services/bn/claimActionRunner';
const r: any = await runClaimEligibility(process.env.CLAIM_ID!, 'ROUTING_VERIFICATION');
console.log(JSON.stringify(r, null, 2).slice(0, 6000));
