/**
 * Post-Approval Orchestrator
 *
 * When a claim decision is APPROVED, this service creates the downstream
 * entitlement and/or payment instruction records and transitions the claim
 * to the correct post-decision status (AWARD_SETUP / IN_PAYMENT / PAYMENT_QUEUE).
 *
 * Branching:
 *   - PERIODIC / LONG_TERM / PENSION / SURVIVOR / INVALIDITY → create
 *     bn_entitlement (+ optional first bn_payment_instruction) and move
 *     claim to AWARD_SETUP.
 *   - LUMP_SUM / GRANT / SHORT_TERM (one-off) → create bn_payment_instruction
 *     directly and move claim to PAYMENT_QUEUE.
 *
 * Every step is audited (bn_claim_event + system_audit_trail).
 */
import { supabase } from '@/integrations/supabase/client';
import { auditClaimAction, auditAwardAction } from '@/services/bn/audit/bnAuditService';
import { routeClaimAfterStatusChange } from '@/services/bn/workflow/routeClaimAfterStatusChange';
import {
  resolveApprovalRouting,
  getUserRoleNames,
  getTransitionSideEffect,
  assignClaimToWorkbasket,
} from '@/services/bn/approvalLevelService';


const db = supabase as any;

export type OrchestrationResult = {
  success: boolean;
  toStatus: string;
  entitlementId?: string;
  paymentInstructionId?: string;
  message: string;
};

const PERIODIC_CATEGORIES = new Set([
  'LONG_TERM', 'PENSION', 'SURVIVOR', 'INVALIDITY', 'NON_CONTRIBUTORY',
]);

function isPeriodic(category: string | null | undefined, paymentType: string | null | undefined): boolean {
  if (paymentType === 'LUMP_SUM') return false;
  if (paymentType === 'PERIODIC') return true;
  if (paymentType === 'BOTH') return true;
  return PERIODIC_CATEGORIES.has(String(category || '').toUpperCase());
}

export async function orchestrateApproval(
  claimId: string,
  performedBy: string,
): Promise<OrchestrationResult> {
  // 1. Load claim + product
  const { data: claim, error: claimErr } = await db
    .from('bn_claim')
    .select('id, claim_number, ssn, product_id, product_version_id, status, bank_account, bank_routing_number')
    .eq('id', claimId)
    .single();
  if (claimErr || !claim) throw new Error('Claim not found');

  const { data: product, error: prodErr } = await db
    .from('bn_product')
    .select('id, benefit_code, benefit_name, category, payment_type')
    .eq('id', claim.product_id)
    .single();
  if (prodErr || !product) throw new Error('Product not found');

  // Load product version to honour its configured payment_frequency / duration type.
  const { data: pv } = await db
    .from('bn_product_version')
    .select('payment_frequency, benefit_duration_type')
    .eq('id', claim.product_version_id)
    .maybeSingle();


  // 2. Latest calculation
  const { data: calcs } = await db
    .from('bn_claim_calculation')
    .select('*')
    .eq('claim_id', claimId)
    .order('calc_date', { ascending: false })
    .limit(1);
  const calc = calcs?.[0];

  // 3. Guard: existing entitlement / instruction already created? idempotent.
  const { data: existingEnt } = await db
    .from('bn_entitlement')
    .select('id')
    .eq('claim_id', claimId)
    .limit(1);
  const { data: existingPi } = await db
    .from('bn_payment_instruction')
    .select('id')
    .eq('claim_id', claimId)
    .limit(1);

  if (existingEnt?.[0]?.id || existingPi?.[0]?.id) {
    return {
      success: true,
      toStatus: claim.status,
      entitlementId: existingEnt?.[0]?.id,
      paymentInstructionId: existingPi?.[0]?.id,
      message: 'Entitlement / payable already exists for this claim.',
    };
  }

  const periodicDefault = isPeriodic(product.category, product.payment_type);
  const weekly = Number(calc?.weekly_rate || 0);
  const monthlyFromCalc = Number(calc?.monthly_rate || 0);
  const lump = Number(calc?.lump_sum || 0);
  const today = new Date().toISOString().slice(0, 10);

  // Resolve payment frequency: respect product version config; otherwise infer
  // from benefit duration (short-term benefits — e.g. Sickness, Maternity,
  // Employment Injury — pay WEEKLY; long-term/pension defaults to MONTHLY).
  const configuredFreq = (pv?.payment_frequency || '').toString().toUpperCase();
  const durationType = (pv?.benefit_duration_type || '').toString().toUpperCase();
  const frequency: 'WEEKLY' | 'MONTHLY' = (configuredFreq === 'WEEKLY' || configuredFreq === 'MONTHLY')
    ? (configuredFreq as 'WEEKLY' | 'MONTHLY')
    : (durationType === 'SHORT_TERM' && weekly > 0 ? 'WEEKLY' : (weekly > 0 || monthlyFromCalc > 0 ? 'MONTHLY' : 'WEEKLY'));
  const monthly = monthlyFromCalc > 0 ? monthlyFromCalc : Math.round(weekly * 52 / 12);

  // ─── Phase 4: transition-rule drives post-approve routing ─────
  // If a `bn_claim_transition_rule` row for (current status, APPROVE)
  // declares `creates_task_type`, it wins over the legacy in-code
  // periodic/lump-sum branching.
  const sideEffect = await getTransitionSideEffect({
    fromStatus: claim.status,
    actionCode: 'APPROVE',
    productCategory: product.category,
  });
  const taskType = sideEffect.createsTaskType
    ?? (periodicDefault ? 'AWARD_SETUP' : 'PAYMENT_QUEUE');
  const periodic = taskType === 'AWARD_SETUP';

  let entitlementId: string | undefined;
  let paymentInstructionId: string | undefined;
  let toStatus = taskType;


  if (periodic) {
    // ─── Periodic / long-term ────────────────────────────────────
    // Total entitlement: respect explicit lump if provided, else compute from
    // the resolved frequency × 1-year duration (52 weeks / 12 months).
    const total = lump > 0
      ? lump
      : (frequency === 'WEEKLY' ? weekly * 52 : monthly * 12);
    const { data: ent, error: entErr } = await db
      .from('bn_entitlement')
      .insert({
        claim_id: claimId,
        ssn: claim.ssn,
        claim_number: claim.claim_number,
        product_id: claim.product_id,
        product_version_id: claim.product_version_id,
        calculation_id: calc?.id ?? null,
        entitlement_type: 'PERIODIC',
        payment_frequency: frequency,
        weekly_rate: weekly,
        monthly_rate: frequency === 'MONTHLY' ? monthly : null,
        lump_sum_amount: lump || null,
        total_entitlement: total,
        remaining_amount: total,
        duration_weeks: frequency === 'WEEKLY' ? 52 : null,
        effective_from: today,
        status: 'ACTIVE',
        activated_at: new Date().toISOString(),
        activated_by: performedBy,
        entered_by: performedBy,
      })
      .select('id')
      .single();
    if (entErr) throw entErr;
    entitlementId = ent.id;

    await auditAwardAction({
      entityType: 'bn_entitlement',
      entityId: entitlementId,
      action: 'AWARD_CREATED',
      afterValue: { claim_id: claimId, frequency, weekly_rate: weekly, monthly_rate: frequency === 'MONTHLY' ? monthly : null, total },
      performedBy,
      critical: true,
    });

    // Also raise the first periodic payment instruction so the claim
    // becomes visible in the Payables Queue and in the Workbench
    // Payments tab immediately after activation.
    const firstAmt = frequency === 'WEEKLY' ? weekly : monthly;
    if (firstAmt > 0) {
      const { data: firstPi } = await db
        .from('bn_payment_instruction')
        .insert({
          entitlement_id: entitlementId,
          claim_id: claimId,
          ssn: claim.ssn,
          amount: firstAmt,
          currency: 'XCD',
          payment_method: claim.bank_account ? 'EFT' : 'CHEQUE',
          bank_code: claim.bank_routing_number || null,
          account_number: claim.bank_account || null,
          due_date: today,
          frequency,
          status: 'READY',

          description: `${product.benefit_name} — first periodic payment`,
        })
        .select('id')
        .single();
      paymentInstructionId = firstPi?.id;
      if (paymentInstructionId) {
        await auditClaimAction({
          entityType: 'bn_payment_instruction',
          entityId: paymentInstructionId,
          action: 'PAYMENT_INSTRUCTION_CREATED',
          afterValue: { claim_id: claimId, entitlement_id: entitlementId, amount: firstAmt, kind: 'PERIODIC_FIRST', frequency },
          performedBy,
          critical: true,
        });
      }
    }
    toStatus = 'AWARD_SETUP';

  } else {
    // ─── Lump-sum / short-term one-off payable ───────────────────
    const amt = lump > 0 ? lump : (weekly > 0 ? weekly : monthly);

    if (amt <= 0) {
      throw new Error(
        'No payable amount was produced by the latest calculation. For medical expense (reimbursement) claims, capture the expense receipt lines on the Calculation tab, then re-run the calculation before approving.',
      );
    }

    const { data: pi, error: piErr } = await db
      .from('bn_payment_instruction')
      .insert({
        claim_id: claimId,
        ssn: claim.ssn,
        amount: amt,
        currency: 'XCD',
        payment_method: claim.bank_account ? 'EFT' : 'CHEQUE',
        bank_code: claim.bank_routing_number || null,
        account_number: claim.bank_account || null,
        due_date: today,
        frequency: 'ONE_OFF',
        status: 'READY',

        description: `${product.benefit_name} — ${claim.claim_number}`,
      })
      .select('id')
      .single();
    if (piErr) throw piErr;
    paymentInstructionId = pi.id;

    await auditClaimAction({
      entityType: 'bn_payment_instruction',
      entityId: paymentInstructionId,
      action: 'PAYMENT_INSTRUCTION_CREATED',
      afterValue: { claim_id: claimId, amount: amt },
      performedBy,
      critical: true,
    });
    toStatus = 'PAYMENT_QUEUE';
  }

  // ─── Transition claim status ───────────────────────────────────
  const fromStatus = claim.status;
  await db
    .from('bn_claim')
    .update({ status: toStatus, modified_by: performedBy, modified_at: new Date().toISOString() })
    .eq('id', claimId);

  // Phase 4: an explicit transition rule wins; otherwise the claim's new status
  // decides its workbasket via the product's workflow.
  if (sideEffect.nextWorkbasketId) {
    await assignClaimToWorkbasket(claimId, sideEffect.nextWorkbasketId, performedBy, `Auto-routed by ${taskType}`);
  } else {
    await routeClaimAfterStatusChange(claimId, performedBy);
  }


  await db.from('bn_claim_event').insert({
    claim_id: claimId,
    event_type: periodic ? 'AWARD_CREATED' : 'PAYABLE_QUEUED',
    from_status: fromStatus,
    to_status: toStatus,
    performed_by: performedBy,
    metadata: { entitlement_id: entitlementId, payment_instruction_id: paymentInstructionId },
  });

  await auditClaimAction({
    entityType: 'bn_claim',
    entityId: claimId,
    action: periodic ? 'AWARD_CREATED' : 'PAYABLE_QUEUED',
    beforeValue: { status: fromStatus },
    afterValue: { status: toStatus, entitlement_id: entitlementId, payment_instruction_id: paymentInstructionId },
    performedBy,
    critical: true,
  });

  return {
    success: true,
    toStatus,
    entitlementId,
    paymentInstructionId,
    message: periodic
      ? `Entitlement created. Claim moved to ${toStatus}.`
      : `Payable queued. Claim moved to ${toStatus}.`,
  };
}

/**
 * Submit a claim for decision. Moves CALCULATION → DECISION.
 * Independent of bn_claim_transition_rule so it works even when the
 * transition matrix has not been seeded for this product.
 */
export async function submitClaimForDecision(claimId: string, performedBy: string): Promise<void> {
  const { data: claim } = await db
    .from('bn_claim')
    .select('id, status')
    .eq('id', claimId)
    .single();
  if (!claim) throw new Error('Claim not found');

  const from = claim.status;
  await db
    .from('bn_claim')
    .update({ status: 'DECISION', modified_by: performedBy, modified_at: new Date().toISOString() })
    .eq('id', claimId);

  // The claim now belongs to the decision stage's workbasket, not intake.
  await routeClaimAfterStatusChange(claimId, performedBy);



  await db.from('bn_claim_event').insert({
    claim_id: claimId,
    event_type: 'SUBMITTED_FOR_DECISION',
    from_status: from,
    to_status: 'DECISION',
    performed_by: performedBy,
  });

  await auditClaimAction({
    entityType: 'bn_claim',
    entityId: claimId,
    action: 'SUBMITTED_FOR_DECISION',
    beforeValue: { status: from },
    afterValue: { status: 'DECISION' },
    performedBy,
    critical: true,
  });
}

/**
 * Approve a claim. Multi-level routing (Phase 4):
 *  - Loads claim + latest calculation + applicable approval-level policies.
 *  - If the actor satisfies the highest required level for the amount,
 *    records a final APPROVE decision and runs orchestrateApproval.
 *  - Otherwise records a RECOMMEND_APPROVAL decision, moves the claim to
 *    PENDING_APPROVAL, and routes it to the next-level workbasket.
 */
export async function approveClaim(
  claimId: string,
  performedBy: string,
  narrative?: string,
  reasonCodeId?: string | null,
): Promise<OrchestrationResult> {
  const { data: claim } = await db
    .from('bn_claim')
    .select('id, status, product_version_id, product_id')
    .eq('id', claimId)
    .single();
  if (!claim) throw new Error('Claim not found');

  // Pull latest calculated amount for level threshold matching.
  const { data: calcRows } = await db
    .from('bn_claim_calculation')
    .select('weekly_rate, monthly_rate, lump_sum')
    .eq('claim_id', claimId)
    .order('calc_date', { ascending: false })
    .limit(1);
  const c = calcRows?.[0];
  const amount = Number(c?.lump_sum || c?.monthly_rate || (Number(c?.weekly_rate || 0) * 52) || 0);

  const userRoles = await getUserRoleNames(performedBy);
  const routing = await resolveApprovalRouting({
    productVersionId: claim.product_version_id,
    amount,
    userRoles,
    area: 'AWARD',
  });

  // ── Recommendation path: actor cannot fully approve ──
  if (!routing.canFullyApprove && routing.nextLevel) {
    const fromStatus = claim.status;
    const recStatus = 'PENDING_APPROVAL';

    await db.from('bn_claim_decision').insert({
      claim_id: claimId,
      action_code: 'RECOMMEND_APPROVAL',
      from_status: fromStatus,
      to_status: recStatus,
      reason_code_id: reasonCodeId || null,
      narrative: narrative || null,
      performed_by: performedBy,
    });

    await db.from('bn_claim').update({
      status: recStatus,
      modified_by: performedBy,
      modified_at: new Date().toISOString(),
    }).eq('id', claimId);

    if (routing.nextWorkbasketId) {
      await assignClaimToWorkbasket(
        claimId, routing.nextWorkbasketId, performedBy,
        `Recommended for level ${routing.nextLevel.level} approval`,
      );
    } else {
      await routeClaimAfterStatusChange(claimId, performedBy);
    }

    await db.from('bn_claim_event').insert({
      claim_id: claimId,
      event_type: 'RECOMMENDED_FOR_APPROVAL',
      from_status: fromStatus,
      to_status: recStatus,
      performed_by: performedBy,
      metadata: {
        next_level: routing.nextLevel.level,
        approval_role: routing.nextLevel.approval_role,
        amount,
      },
    });

    await auditClaimAction({
      entityType: 'bn_claim',
      entityId: claimId,
      action: 'CLAIM_RECOMMENDED',
      beforeValue: { status: fromStatus },
      afterValue: { status: recStatus, next_level: routing.nextLevel.level },
      notes: narrative,
      performedBy,
      critical: true,
    });

    return {
      success: true,
      toStatus: recStatus,
      message: `Recommended. Awaiting level ${routing.nextLevel.level} approval (${routing.nextLevel.approval_role || 'reviewer'}).`,
    };
  }

  // ── Full approve path ──
  await db.from('bn_claim_decision').insert({
    claim_id: claimId,
    action_code: 'APPROVE',
    from_status: claim.status,
    to_status: 'APPROVED',
    reason_code_id: reasonCodeId || null,
    narrative: narrative || null,
    performed_by: performedBy,
  });

  await db
    .from('bn_claim')
    .update({
      status: 'APPROVED',
      decision_date: new Date().toISOString(),
      modified_by: performedBy,
      modified_at: new Date().toISOString(),
    })
    .eq('id', claimId);

  await auditClaimAction({
    entityType: 'bn_claim',
    entityId: claimId,
    action: 'CLAIM_APPROVED',
    beforeValue: { status: claim.status },
    afterValue: { status: 'APPROVED', actor_level: routing.actorMaxLevel },
    notes: narrative,
    performedBy,
    critical: true,
  });

  return orchestrateApproval(claimId, performedBy);
}


/** Manually generate the payable / entitlement for an already-approved
 *  claim where the orchestrator didn't fire. */
export async function generatePayableForApprovedClaim(
  claimId: string,
  performedBy: string,
): Promise<OrchestrationResult> {
  return orchestrateApproval(claimId, performedBy);
}
