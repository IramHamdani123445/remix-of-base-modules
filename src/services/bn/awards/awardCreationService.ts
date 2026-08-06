/**
 * Award Creation Service
 * Creates a long-term award (bn_award) when a claim is APPROVED for a
 * product version that declares benefit_duration_type=LONG_TERM and
 * award_creation_rule=ON_APPROVAL.
 *
 * Idempotent: returns existing award if one already exists for the claim.
 */
import { supabase as db } from '@/integrations/supabase/client';
import { medicalReviewLegacyScheduleCommands } from '@/services/bn/medicalReviewLegacyScheduleCommands';

export interface AwardCreationResult {
  created: boolean;
  awardId?: string;
  awardNumber?: string;
  reason?: string;
}

function generateAwardNumber(benefitCode: string): string {
  const yr = new Date().getFullYear();
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `AWD-${(benefitCode || 'BN').toUpperCase().slice(0, 6)}-${yr}-${rand}`;
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export async function createAwardOnApproval(
  claimId: string,
  performedBy: string,
): Promise<AwardCreationResult> {
  // Idempotency check
  const { data: existing } = await db
    .from('bn_award')
    .select('id, award_number')
    .eq('bn_claim_id', claimId)
    .maybeSingle();
  if (existing) {
    return {
      created: false,
      awardId: existing.id,
      awardNumber: existing.award_number ?? undefined,
      reason: 'EXISTS',
    };
  }

  // Fetch claim context
  const { data: claim, error: claimErr } = await db
    .from('bn_claim')
    .select('id, ssn, product_id, product_version_id, status, decision_date, legacy_benefit_type')
    .eq('id', claimId)
    .single();
  if (claimErr || !claim) return { created: false, reason: 'CLAIM_NOT_FOUND' };
  if (claim.status !== 'APPROVED') return { created: false, reason: 'CLAIM_NOT_APPROVED' };

  // Resolve product version with servicing config
  let pv: any = null;
  if (claim.product_version_id) {
    const { data } = await db
      .from('bn_product_version')
      .select('id, product_id, benefit_duration_type, award_creation_rule, payment_frequency, life_certificate_policy, medical_review_policy, survivor_beneficiary_policy, review_policy')
      .eq('id', claim.product_version_id)
      .maybeSingle();
    pv = data;
  }
  if (!pv && claim.product_id) {
    const { data } = await db
      .from('bn_product_version')
      .select('id, product_id, benefit_duration_type, award_creation_rule, payment_frequency, life_certificate_policy, medical_review_policy, survivor_beneficiary_policy, review_policy')
      .eq('product_id', claim.product_id)
      .eq('status', 'ACTIVE')
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    pv = data;
  }

  const duration = pv?.benefit_duration_type ?? 'SHORT_TERM';
  const rule = pv?.award_creation_rule ?? 'NONE';
  if (duration !== 'LONG_TERM' || rule !== 'ON_APPROVAL') {
    return { created: false, reason: 'PRODUCT_NOT_LONG_TERM' };
  }

  // Resolve benefit code from product
  let benefitCode = claim.legacy_benefit_type || 'BN';
  if (claim.product_id) {
    const { data: prod } = await db
      .from('bn_product')
      .select('benefit_code')
      .eq('id', claim.product_id)
      .maybeSingle();
    if (prod?.benefit_code) benefitCode = prod.benefit_code;
  }

  // Latest calculation for base amount
  const { data: calc } = await db
    .from('bn_claim_calculation')
    .select('monthly_rate, weekly_rate, lump_sum')
    .eq('claim_id', claimId)
    .order('calc_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const frequency = (pv?.payment_frequency as string) || 'MONTHLY';
  const baseAmount =
    calc?.monthly_rate ?? calc?.weekly_rate ?? calc?.lump_sum ?? null;
  const awardNumber = generateAwardNumber(benefitCode);
  const startDate = (claim.decision_date as string | null) || new Date().toISOString().slice(0, 10);

  const { data: inserted, error: insErr } = await db
    .from('bn_award')
    .insert({
      award_number: awardNumber,
      bn_claim_id: claimId,
      bn_product_id: claim.product_id,
      ssn: claim.ssn,
      benefit_code: benefitCode,
      award_type: benefitCode,
      status: 'ACTIVE',
      start_date: startDate,
      base_amount: baseAmount,
      currency: 'XCD',
      frequency,
      entered_by: performedBy,
      modified_by: performedBy,
      metadata: { source: 'claim_approval', product_version_id: pv?.id ?? null },
    })
    .select('id, award_number')
    .single();
  if (insErr || !inserted) return { created: false, reason: `INSERT_FAILED:${insErr?.message ?? 'unknown'}` };

  // First payment schedule row (best effort)
  await db.from('bn_payment_schedule').insert({
    bn_award_id: inserted.id,
    schedule_period: startDate.slice(0, 7),
    due_date: startDate,
    gross_amount: Number(baseAmount ?? 0),
    net_amount: Number(baseAmount ?? 0),
    status: 'PENDING',
    entered_by: performedBy,
  } as any).then(() => undefined, () => undefined);

  // Survivor beneficiaries (best effort)
  const survivorPolicy = (pv?.survivor_beneficiary_policy ?? {}) as any;
  const isSurvivor = /SURV/i.test(benefitCode) || survivorPolicy?.required === true;
  if (isSurvivor) {
    const { data: deps } = await db
      .from('bn_claim_person_snapshot')
      .select('full_name, person_status, ssn')
      .eq('claim_id', claimId);
    if (deps && deps.length > 0) {
      const rows = deps
        .filter((d: any) => d.full_name)
        .map((d: any) => ({
          bn_award_id: inserted.id,
          full_name: d.full_name,
          relationship: d.person_status || 'DEPENDANT',
          beneficiary_ssn: d.ssn || null,
          start_date: startDate,
          status: 'ACTIVE',
          entered_by: performedBy,
        }));
      if (rows.length > 0) {
        await db.from('bn_award_beneficiary').insert(rows as any).then(() => undefined, () => undefined);
      }
    }
  }

  // Life certificate schedule
  const lcPolicy = (pv?.life_certificate_policy ?? {}) as any;
  if (lcPolicy?.required) {
    const months = Number(lcPolicy.frequency_months ?? 12);
    await db.from('bn_life_certificate').insert({
      bn_award_id: inserted.id,
      due_date: addMonths(startDate, months),
      required_for_period: new Date(startDate).getFullYear().toString(),
      status: 'PENDING',
      entered_by: performedBy,
    } as any).then(() => undefined, () => undefined);
  }

  // Medical review schedule
  const mrPolicy = (pv?.medical_review_policy ?? {}) as any;
  if (mrPolicy?.required) {
    const months = Number(mrPolicy.frequency_months ?? 12);
    // Governed boundary: the browser holds no INSERT privilege on
    // `bn_medical_review_schedule`. Provisioning runs through the versioned
    // Medical Review command.
    await medicalReviewLegacyScheduleCommands
      .provision({
        awardId: inserted.id,
        scheduledDate: addMonths(startDate, months),
        reviewType: mrPolicy.review_type || 'PERIODIC',
        reason: 'Award creation medical review provisioning',
      })
      .then(() => undefined, () => undefined);
  }

  // Audit event on claim
  await db.from('bn_claim_event').insert({
    claim_id: claimId,
    event_type: 'AWARD_CREATED',
    description: `Award ${awardNumber} created on approval`,
    performed_by: performedBy,
    performed_at: new Date().toISOString(),
  } as any).then(() => undefined, () => undefined);

  return { created: true, awardId: inserted.id, awardNumber };
}
