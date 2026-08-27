/**
 * What must be true before a claim can be approved. (BUG-34)
 *
 * Approval creates the record the claimant is paid from, so these are the
 * controls that stand between a claim and public money. They are checked here,
 * in the service, rather than by disabling a button — a UI guard is bypassed by
 * any other caller of `executeClaimAction`.
 *
 * Gates already existed further up the chain: `runClaimCalculation` refuses
 * without passing eligibility, and SUBMIT_DECISION refuses without a
 * calculation. But `executeClaimAction` takes `fromStatus` from its caller and
 * never validates the transition, so APPROVE can be invoked directly and skip
 * the whole chain. These checks therefore re-assert the chain at the last step
 * instead of trusting that it was walked.
 *
 * Every check is FAIL-CLOSED. "Found nothing to inspect" is a refusal, not a
 * pass — the defect behind BUG-02, 03, 13, 22, 29, 30 and 33.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  resolveApprovalControls,
  type ApprovalControls,
} from './approvalPolicyResolver';

const db = supabase as any;

export interface ApprovalBlocker {
  code:
    | 'DOCUMENTS_OUTSTANDING'
    | 'DOCUMENTS_UNVERIFIABLE'
    | 'ELIGIBILITY_MISSING'
    | 'ELIGIBILITY_NOT_PASSED'
    | 'ELIGIBILITY_STALE'
    | 'CALCULATION_MISSING'
    | 'CALCULATION_STALE'
    | 'CALCULATION_ZERO'
    | 'MAKER_CHECKER'
    | 'REASON_CODE_REQUIRED'
    | 'JUSTIFICATION_REQUIRED'
    | 'DOCUMENT_WAIVER_NOT_PERMITTED';
  /** Sentence naming what failed and what to do about it. */
  message: string;
}

export interface ApprovalPreconditionReport {
  ok: boolean;
  blockers: ApprovalBlocker[];
  /** Which controls were applied, and whether from policy or the strict default. */
  controls: ApprovalControls;
  /**
   * Set when the approver recommended the claim and was allowed to approve it
   * anyway, naming why. Null when maker-checker did not arise.
   */
  selfApprovalReason?: 'ADMIN_EXEMPT' | 'PERMITTED_BY_POLICY' | null;
}

/**
 * Is this approver exempt from maker-checker?
 *
 * Administrators are, deliberately: they are the break-glass route when no
 * second approver is available. Recorded on the report as
 * `selfApprovalReason` so an audit can see WHY separation of duties did not
 * apply to a given approval, rather than finding it silently absent.
 */
async function approverIsAdmin(approverUserCode: string): Promise<boolean> {
  const code = String(approverUserCode ?? '').trim();
  if (!code) return false;
  const { data, error } = await db
    .from('user_roles')
    .select('role, user_id')
    .eq('user_id', code);
  // A failed role lookup must not grant the exemption.
  if (error || !Array.isArray(data)) return false;
  return data.some((r: any) => String(r.role ?? '').toLowerCase() === 'admin');
}

/**
 * `claimId` is checked against every control. Pass `approverUserCode` so
 * maker-checker can compare the approver against whoever recommended.
 */
export async function checkApprovalPreconditions(
  claimId: string,
  approverUserCode: string,
  decision: { reasonCode?: string | null; narrative?: string | null } = {},
): Promise<ApprovalPreconditionReport> {
  const blockers: ApprovalBlocker[] = [];
  let selfApprovalReason: ApprovalPreconditionReport['selfApprovalReason'] = null;

  // ── the claim itself, for the staleness flags and the policy lookup ──
  const { data: claim, error: claimError } = await db
    .from('bn_claim')
    .select('id, product_version_id, eligibility_stale, calculation_stale')
    .eq('id', claimId)
    .maybeSingle();
  const strict = await resolveApprovalControls(null, 'AWARD');
  if (claimError) {
    return {
      ok: false,
      controls: strict,
      blockers: [{
        code: 'ELIGIBILITY_MISSING',
        message: `Could not read the claim to verify approval conditions (${claimError.message}). Approval refused.`,
      }],
    };
  }
  if (!claim) {
    return {
      ok: false,
      controls: strict,
      blockers: [{ code: 'ELIGIBILITY_MISSING', message: 'Claim not found. Approval refused.' }],
    };
  }

  // The controls that apply to this product. Configuration decides WHICH
  // controls are in force; the strict default decides what happens when
  // configuration is silent.
  const controls = await resolveApprovalControls(claim.product_version_id, 'AWARD');

  // ── 1. mandatory documents ──────────────────────────────────────────
  // A failed query used to yield `(blocking || [])` → zero unmet → approved.
  // An unreadable checklist is now a refusal.
  const { data: blocking, error: blockingError } = await db
    .from('bn_evidence_checklist')
    .select('id, status, requirement_id')
    .eq('claim_id', claimId)
    .eq('is_blocking', true);
  if (blockingError) {
    blockers.push({
      code: 'DOCUMENTS_UNVERIFIABLE',
      message:
        `The mandatory document checklist could not be read (${blockingError.message}), ` +
        'so it cannot be confirmed that required documents are present. Approval refused.',
    });
  } else {
    const rows: any[] = Array.isArray(blocking) ? blocking : [];
    // Whether a waiver satisfies a mandatory document is the product's call
    // (`non_waivable`), not this function's.
    const satisfying = controls.documentsNonWaivable
      ? ['VERIFIED']
      : ['VERIFIED', 'WAIVED'];
    const unmet = rows.filter(
      (r) => !satisfying.includes(String(r.status ?? '').toUpperCase()),
    );
    const waivedButNotPermitted = controls.documentsNonWaivable
      ? rows.filter((r) => String(r.status ?? '').toUpperCase() === 'WAIVED')
      : [];
    if (waivedButNotPermitted.length > 0) {
      blockers.push({
        code: 'DOCUMENT_WAIVER_NOT_PERMITTED',
        message:
          `${waivedButNotPermitted.length} document(s) are marked waived, but this product's ` +
          'approval policy states they cannot be waived. They must be verified.',
      });
    }
    if (unmet.length > 0) {
      const codes = unmet.map((r) => r.requirement_id ?? r.id).slice(0, 5).join(', ');
      blockers.push({
        code: 'DOCUMENTS_OUTSTANDING',
        message:
          `${unmet.length} mandatory document(s) are neither verified nor formally waived: ${codes}` +
          `${unmet.length > 5 ? ' (and more)' : ''}. Verify or waive them before approving.`,
      });
    }
  }

  // ── 2. eligibility ──────────────────────────────────────────────────
  const { data: elig, error: eligError } = await db
    .from('bn_claim_eligibility')
    .select('id, overall_result, override_applied, check_date')
    .eq('claim_id', claimId)
    .order('check_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (eligError) {
    blockers.push({
      code: 'ELIGIBILITY_MISSING',
      message:
        `The eligibility result could not be read (${eligError.message}), so entitlement ` +
        'cannot be confirmed. Approval refused.',
    });
  } else if (!elig) {
    blockers.push({
      code: 'ELIGIBILITY_MISSING',
      message:
        'Eligibility has never been evaluated for this claim. Run the eligibility check before approving.',
    });
  } else if (!elig.overall_result && !elig.override_applied) {
    blockers.push({
      code: 'ELIGIBILITY_NOT_PASSED',
      message:
        'Eligibility did not pass — the claimant is not established as entitled. ' +
        'A recorded supervisor override is required before this claim can be approved.',
    });
  }

  // Amending a claim marks its eligibility stale. Approving on a stale result
  // approves against facts that have since changed.
  if (claim.eligibility_stale) {
    blockers.push({
      code: 'ELIGIBILITY_STALE',
      message:
        'The claim was amended after its eligibility was evaluated, so the result no longer ' +
        'reflects the claim. Re-run the eligibility check before approving.',
    });
  }

  // ── 3. calculation ──────────────────────────────────────────────────
  const { data: calc, error: calcError } = await db
    .from('bn_claim_calculation')
    .select('id, weekly_rate, monthly_rate, lump_sum, calc_date')
    .eq('claim_id', claimId)
    .order('calc_date', { ascending: false })
    .limit(1);
  if (calcError) {
    blockers.push({
      code: 'CALCULATION_MISSING',
      message:
        `The calculation could not be read (${calcError.message}), so the payable amount ` +
        'cannot be confirmed. Approval refused.',
    });
  } else if (!Array.isArray(calc) || calc.length === 0) {
    blockers.push({
      code: 'CALCULATION_MISSING',
      message:
        'No calculation exists for this claim, so there is no amount to approve. ' +
        'Run the calculation before approving.',
    });
  } else {
    // A calculation that produced nothing is not an entitlement. 12 of the 36
    // calculations in this database are zero on every rate, and approving one
    // creates an ACTIVE entitlement worth nothing — which is what happened to
    // BN-20260606-65755.
    //
    // Checked as "every amount is zero", not "the weekly rate is zero": a
    // lump-sum benefit legitimately has no weekly or monthly rate, and a
    // periodic one legitimately has no lump sum.
    const latest = calc[0] as any;
    const amount = (v: unknown) => {
      const n = Number(v ?? 0);
      return Number.isFinite(n) ? n : 0;
    };
    const weekly = amount(latest.weekly_rate);
    const monthly = amount(latest.monthly_rate);
    const lump = amount(latest.lump_sum);
    if (weekly === 0 && monthly === 0 && lump === 0) {
      blockers.push({
        code: 'CALCULATION_ZERO',
        message:
          'The calculation produced no payable amount — weekly, monthly and lump sum are all ' +
          'zero. There is nothing to award. Re-run the calculation and check the product’s ' +
          'formula and the claimant’s contribution record before approving.',
      });
    }
  }

  if (claim.calculation_stale) {
    blockers.push({
      code: 'CALCULATION_STALE',
      message:
        'The claim was amended after its calculation was run, so the amount no longer ' +
        'reflects the claim. Re-run the calculation before approving.',
    });
  }

  // ── 4. maker-checker ────────────────────────────────────────────────
  // Whether an officer may approve their own recommendation is configuration
  // (`self_approval_allowed`). The default refuses it, matching the control the
  // product version workflow already enforces on publish.
  const { data: recommendation, error: recError } = await db
    .from('bn_claim_decision')
    .select('id, performed_by, action_code, performed_at')
    .eq('claim_id', claimId)
    .eq('action_code', 'SUBMIT_DECISION')
    .order('performed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recError) {
    blockers.push({
      code: 'MAKER_CHECKER',
      message:
        `The recommendation could not be read (${recError.message}), so it cannot be ` +
        'confirmed that a second person is approving. Approval refused.',
    });
  } else if (!recommendation) {
    blockers.push({
      code: 'MAKER_CHECKER',
      message:
        'No recommendation has been submitted for this claim. Submit it for decision first, ' +
        'so that approval is made by a second person.',
    });
  } else if (
    String(recommendation.performed_by ?? '').trim().toUpperCase() ===
    String(approverUserCode ?? '').trim().toUpperCase()
  ) {
    // The approver recommended this claim. Two things can permit it anyway:
    // the product's policy, or the approver being an administrator.
    if (controls.selfApprovalAllowed) {
      selfApprovalReason = 'PERMITTED_BY_POLICY';
    } else if (await approverIsAdmin(approverUserCode)) {
      selfApprovalReason = 'ADMIN_EXEMPT';
    } else {
      blockers.push({
        code: 'MAKER_CHECKER',
        message:
          `Maker-checker violation: ${approverUserCode} recommended this claim and cannot also ` +
          'approve it. It must be approved by a different officer.',
      });
    }
  }

  // ── 5. reason code and justification, where the policy requires them ──
  if (controls.requiresReasonCode && !String(decision.reasonCode ?? '').trim()) {
    blockers.push({
      code: 'REASON_CODE_REQUIRED',
      message: "This product's approval policy requires a reason code on the decision.",
    });
  }
  if (controls.requiresJustification && !String(decision.narrative ?? '').trim()) {
    blockers.push({
      code: 'JUSTIFICATION_REQUIRED',
      message: "This product's approval policy requires a written justification on the decision.",
    });
  }

  return { ok: blockers.length === 0, blockers, controls, selfApprovalReason };
}

/** One refusal sentence naming every failed condition, for the officer. */
export function describeApprovalBlockers(blockers: ApprovalBlocker[]): string {
  if (blockers.length === 0) return '';
  const lines = blockers.map((b, i) => `${i + 1}. ${b.message}`);
  return (
    `Cannot approve — ${blockers.length} condition${blockers.length === 1 ? '' : 's'} not met:\n` +
    lines.join('\n')
  );
}
