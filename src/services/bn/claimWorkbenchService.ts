/**
 * Claim Workbench Service — Extended claim operations for the full workbench
 * 
 * Sources:
 *   - bn_claim (claim header orchestration)
 *   - bn_claim_detail (JSONB benefit-specific data — future: cl_detail_*)
 *   - bn_claim_evidence (documents/evidence)
 *   - bn_claim_event (timeline / status history)
 *   - bn_claim_note (notes/worklog)
 *   - bn_claim_decision (decision records)
 *   - ip_master via personAdapter (contributor)
 *   - er_master via employerAdapter (employer)
 * 
 * Future integration:
 *   - cl_head (legacy claim header) — every bn_claim maps to cl_head.claim_no
 *   - cl_detail_* (typed benefit-specific tables) — currently bn_claim_detail.detail_json
 *   - bn_claim_status_history (formal status audit trail)
 * 
 * OUTBOUND PAYMENTS: cl_cheques only. cn_payment* NEVER used.
 */
import { supabase } from '@/integrations/supabase/client';

const db = supabase as any;

// ─── Linked Claims ─────────────────────────────────────────────────
export interface LinkedClaim {
  id: string;
  claim_number: string | null;
  ssn: string;
  status: string;
  claim_date: string;
  benefit_type: string;
  relationship: 'PARENT' | 'CHILD' | 'SIBLING' | 'CONTINUATION';
}

export async function fetchLinkedClaims(claimId: string, ssn: string, claimNumber?: string): Promise<LinkedClaim[]> {
  // Find claims with same SSN (siblings/continuations)
  const { data, error } = await db
    .from('bn_claim')
    .select('id, claim_number, ssn, status, claim_date, legacy_benefit_type, bn_product(benefit_name, category)')
    .eq('ssn', ssn)
    .neq('id', claimId)
    .order('claim_date', { ascending: false })
    .limit(20);

  if (error) throw error;

  return (data ?? []).map((c: any) => ({
    id: c.id,
    claim_number: c.claim_number,
    ssn: c.ssn,
    status: c.status,
    claim_date: c.claim_date,
    benefit_type: c.bn_product?.benefit_name || c.legacy_benefit_type || 'Unknown',
    relationship: 'SIBLING' as const,
  }));
}

// ─── Status History ────────────────────────────────────────────────
export interface ClaimStatusHistoryEntry {
  id: string;
  from_status: string | null;
  to_status: string;
  event_type: string;
  notes: string | null;
  performed_by: string;
  performed_at: string;
}

export async function fetchClaimStatusHistory(claimId: string): Promise<ClaimStatusHistoryEntry[]> {
  // Use bn_claim_event with status transitions, future: bn_claim_status_history
  const { data, error } = await db
    .from('bn_claim_event')
    .select('*')
    .eq('claim_id', claimId)
    .not('to_status', 'is', null)
    .order('performed_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((e: any) => ({
    id: e.id,
    from_status: e.from_status,
    to_status: e.to_status,
    event_type: e.event_type || 'STATUS_CHANGE',
    notes: e.notes,
    performed_by: e.performed_by || 'System',
    performed_at: e.performed_at,
  }));
}

// ─── Claim Detail (Benefit-Specific) ───────────────────────────────
export async function fetchClaimDetailJson(claimId: string): Promise<Record<string, any> | null> {
  const { data, error } = await db
    .from('bn_claim_detail')
    .select('detail_json')
    .eq('claim_id', claimId)
    .maybeSingle();

  if (error) throw error;
  return data?.detail_json ?? null;
}

export async function upsertClaimDetailJson(claimId: string, detailJson: Record<string, any>, userCode: string): Promise<void> {
  const { error } = await db
    .from('bn_claim_detail')
    .upsert({
      claim_id: claimId,
      detail_json: detailJson,
      modified_by: userCode,
      modified_at: new Date().toISOString(),
    }, { onConflict: 'claim_id' });

  if (error) throw error;
}

// ─── Claim Actions (Workflow Transitions) ──────────────────────────
export interface ClaimActionResult {
  success: boolean;
  newStatus?: string;
  message: string;
  /** Optional payload from a side-effect (eligibility id, calc id, etc). */
  data?: Record<string, any>;
}

/**
 * Execute a claim action with REAL side-effects, not just a status flip.
 *
 * Side-effects per action:
 *   START_REVIEW       → status + CLAIM_REVIEW_STARTED event
 *   CHECK_ELIGIBILITY  → run eligibility engine, persist bn_claim_eligibility
 *   RUN_CALCULATION    → require passing eligibility, run calc engine, persist bn_claim_calculation
 *   SUBMIT_DECISION    → require calculation exists, draft recommendation in bn_claim_decision
 *   APPROVE / DENY     → create final bn_claim_decision row
 *   REQUEST_EVIDENCE / REQUEST_INFO / SUSPEND / REOPEN / WITHDRAW / CLOSE
 *                      → status + audit event (+ specific preconditions)
 *
 * Every action also writes a bn_claim_event row for the timeline.
 */
export async function executeClaimAction(
  claimId: string,
  action: string,
  fromStatus: string,
  toStatus: string,
  userCode: string,
  narrative?: string,
  reasonCode?: string,
): Promise<ClaimActionResult> {
  try {
    const sideEffect: Record<string, any> = {};

    // ── 0. The transition itself must be legal (BUG-34) ──
    // `fromStatus` and `toStatus` arrive from the caller and used to be trusted.
    // bn_claim_transition_rule is the runtime source of truth for claim
    // transitions — e.g. APPROVE is only DECISION → APPROVED — so an action
    // that skips the chain (straight to APPROVE without calculation or
    // recommendation) is refused here rather than relying on the UI to sequence
    // it. The claim's stored status is used, not the caller's claim about it.
    const { data: currentClaim, error: currentErr } = await db
      .from('bn_claim')
      .select('status')
      .eq('id', claimId)
      .maybeSingle();
    if (currentErr) {
      throw new Error(`Could not read the claim's current status: ${currentErr.message}`);
    }
    const actualFrom = (currentClaim as any)?.status ?? null;
    if (!actualFrom) throw new Error('Claim not found.');

    const { data: rules, error: ruleErr } = await db
      .from('bn_claim_transition_rule')
      .select('action_code, from_status, to_status')
      .eq('action_code', action);
    if (ruleErr) {
      throw new Error(`Could not read transition rules: ${ruleErr.message}`);
    }
    const allowed: any[] = Array.isArray(rules) ? rules : [];
    if (allowed.length === 0) {
      throw new Error(`"${action}" is not a configured claim action.`);
    }
    if (!allowed.some((r) => String(r.from_status) === String(actualFrom))) {
      const froms = [...new Set(allowed.map((r) => r.from_status))].join(', ');
      throw new Error(
        `Cannot ${action} a claim in status ${actualFrom}. ` +
        `This action is only permitted from: ${froms}.`,
      );
    }

    // ── 1. Preconditions & side-effects BEFORE status change ──
    switch (action) {
      case 'CHECK_ELIGIBILITY': {
        const { runClaimEligibility } = await import('./claimActionRunner');
        const res = await runClaimEligibility(claimId, userCode);
        sideEffect.eligibilityId = res.eligibilityId;
        sideEffect.overallResult = res.overallResult;
        sideEffect.ruleCount = res.rules.length;
        break;
      }
      case 'RUN_CALCULATION': {
        const { runClaimCalculation } = await import('./claimActionRunner');
        const res = await runClaimCalculation(claimId, userCode);
        sideEffect.calculationId = res.calculationId;
        sideEffect.weeklyRate = res.weeklyRate;
        sideEffect.monthlyRate = res.monthlyRate;
        sideEffect.lumpSum = res.lumpSum;
        break;
      }
      case 'SUBMIT_DECISION': {
        const { data: calc } = await db
          .from('bn_claim_calculation')
          .select('id')
          .eq('claim_id', claimId)
          .limit(1);
        if (!calc || calc.length === 0) {
          throw new Error('No calculation exists. Run calculation before submitting for decision.');
        }
        const { createClaimDecision } = await import('./claimActionRunner');
        const dec = await createClaimDecision({
          claimId,
          decisionType: 'RECOMMENDATION',
          userCode,
          narrative,
          fromStatus,
          toStatus,
        });
        sideEffect.decisionId = dec.id;
        break;
      }
      case 'APPROVE': {
        // BUG-34 — approval creates the record the claimant is paid from, so
        // every control is asserted here, in the service. The previous check
        // looked only at blocking documents, discarded its own query error, and
        // treated an empty checklist as satisfied.
        const { checkApprovalPreconditions, describeApprovalBlockers } = await import(
          './claims/approvalPreconditions'
        );
        const pre = await checkApprovalPreconditions(claimId, userCode, { reasonCode, narrative });
        if (!pre.ok) {
          // Named conditions, so the officer knows what to correct. Not a
          // warning — approval does not proceed.
          throw new Error(describeApprovalBlockers(pre.blockers));
        }
        // Recorded so an audit can see WHICH controls were applied, and whether
        // they came from the product's policy or the strict default.
        sideEffect.approvalControls = pre.controls;
        const { createClaimDecision } = await import('./claimActionRunner');
        const dec = await createClaimDecision({
          claimId,
          decisionType: 'APPROVED',
          userCode,
          narrative,
          reasonCode,
          fromStatus,
          toStatus,
        });
        sideEffect.decisionId = dec.id;
        break;
      }
      case 'DENY': {
        if (!reasonCode) throw new Error('Reason code is required to deny a claim.');
        if (!narrative) throw new Error('Narrative is required to deny a claim.');
        const { createClaimDecision } = await import('./claimActionRunner');
        const dec = await createClaimDecision({
          claimId,
          decisionType: 'DENIED',
          userCode,
          narrative,
          reasonCode,
          fromStatus,
          toStatus,
        });
        sideEffect.decisionId = dec.id;
        break;
      }
      case 'CLOSE': {
        // Refuse to close if any payment instruction is still active.
        const { data: pending } = await db
          .from('bn_payment_instruction')
          .select('id')
          .eq('claim_id', claimId)
          .in('status', ['PENDING', 'SCHEDULED', 'IN_PROGRESS'])
          .limit(1);
        if (pending && pending.length > 0) {
          throw new Error('Cannot close — pending payment instructions exist.');
        }
        break;
      }
      // The remaining actions (START_REVIEW, REQUEST_EVIDENCE, REQUEST_INFO,
      // SUSPEND, REOPEN, WITHDRAW) have no pre-status side-effect beyond the
      // event row we always write below.
      default:
        break;
    }

    // ── 2. Update claim status (optimistic on fromStatus) ──
    const { error: updateErr, data: updateRows } = await db
      .from('bn_claim')
      .update({
        status: toStatus,
        modified_by: userCode,
        modified_at: new Date().toISOString(),
      })
      .eq('id', claimId)
      .eq('status', fromStatus)
      .select('id');
    if (updateErr) throw updateErr;
    if (!updateRows || updateRows.length === 0) {
      throw new Error(`Status changed under us — expected ${fromStatus}. Refresh and retry.`);
    }

    // ── 3. Record event for the timeline ──
    await db.from('bn_claim_event').insert({
      claim_id: claimId,
      event_type: action,
      from_status: fromStatus,
      to_status: toStatus,
      notes: narrative,
      performed_by: userCode,
      performed_at: new Date().toISOString(),
      metadata: { reason_code: reasonCode ?? null, ...sideEffect },
    });

    // ── 3b. Re-route the claim to the workbasket its new status implies ──
    // Without this a claim keeps the basket it was given at intake for its
    // whole life, so every queue except intake stays empty. Non-blocking: a
    // routing failure must not undo a legitimate status change.
    try {
      const { routeClaimToWorkbasket } = await import('./workflow/routeClaimToWorkbasket');
      const routed = await routeClaimToWorkbasket(claimId, userCode);
      sideEffect.workbasketOutcome = routed.outcome;
      sideEffect.workbasketName = routed.workbasketName;
      sideEffect.workbasketReason = routed.reason;
    } catch (e) { /* non-blocking */ }

    // ── 4. Fire configured communications via bridge (non-blocking) ──

    try {
      const { onWorkflowActionExecuted } = await import('./communication/workflowCommunicationBridge');
      await onWorkflowActionExecuted({
        claimId, actionCode: action, userCode, reasonCode, narrative, sideEffect,
      });
    } catch (e) { /* non-blocking */ }

    // ── 5. Mirror to central workflow engine (Phase 3) — non-blocking ──
    try {
      const { mirrorClaimActionToCentralEngine } = await import('./bnWorkflowRuntimeService');
      const { data: claimMeta } = await db
        .from('bn_claim')
        .select('claim_number, ssn')
        .eq('id', claimId)
        .maybeSingle();
      await mirrorClaimActionToCentralEngine({
        claimId,
        claimNumber: claimMeta?.claim_number ?? null,
        ssn: claimMeta?.ssn ?? null,
        action,
        fromStatus,
        toStatus,
        userCode,
        narrative,
      });
    } catch (e) { /* non-blocking */ }


    const friendly =
      action === 'CHECK_ELIGIBILITY'
        ? `Eligibility evaluated — ${sideEffect.overallResult ? 'PASS' : 'FAIL'} (${sideEffect.ruleCount ?? 0} rules)`
        : action === 'RUN_CALCULATION'
          ? `Calculation completed${sideEffect.weeklyRate ? ` — weekly $${sideEffect.weeklyRate}` : ''}`
          : action === 'APPROVE'
            ? 'Claim approved and decision recorded'
            : action === 'DENY'
              ? 'Claim denied and decision recorded'
              : `Claim ${action.toLowerCase().replace(/_/g, ' ')} successfully`;

    return { success: true, newStatus: toStatus, message: friendly, data: sideEffect };
  } catch (err: any) {
    return { success: false, message: err?.message || 'Action failed' };
  }
}

// ─── Claim Transition Rules ────────────────────────────────────────
export interface ClaimTransition {
  action: string;
  label: string;
  fromStatuses: string[];
  toStatus: string;
  requiresNarrative: boolean;
  requiresReasonCode: boolean;
  requiredRoles: string[];
  preconditions: string[];
  auditEvent: string;
  notificationTrigger?: string;
}

export const CLAIM_TRANSITIONS: ClaimTransition[] = [
  {
    action: 'SUBMIT',
    label: 'Submit',
    fromStatuses: ['DRAFT'],
    toStatus: 'SUBMITTED',
    requiresNarrative: false,
    requiresReasonCode: false,
    requiredRoles: ['CLAIMS_OFFICER', 'SUPERVISOR', 'ADMIN'],
    preconditions: ['SSN must be provided', 'Product must be selected'],
    auditEvent: 'CLAIM_SUBMITTED',
    notificationTrigger: 'bn_claim_registered',
  },
  {
    action: 'START_REVIEW',
    label: 'Start Review',
    fromStatuses: ['SUBMITTED'],
    toStatus: 'INTAKE_REVIEW',
    requiresNarrative: false,
    requiresReasonCode: false,
    requiredRoles: ['CLAIMS_OFFICER', 'SUPERVISOR', 'ADMIN'],
    preconditions: [],
    auditEvent: 'CLAIM_REVIEW_STARTED',
  },
  {
    action: 'CHECK_ELIGIBILITY',
    label: 'Check Eligibility',
    fromStatuses: ['INTAKE_REVIEW'],
    toStatus: 'ELIGIBILITY_CHECK',
    requiresNarrative: false,
    requiresReasonCode: false,
    requiredRoles: ['CLAIMS_OFFICER', 'SUPERVISOR', 'ADMIN'],
    preconditions: ['Identity must be verified'],
    auditEvent: 'ELIGIBILITY_CHECK_STARTED',
  },
  {
    action: 'REQUEST_EVIDENCE',
    label: 'Request Evidence',
    fromStatuses: ['ELIGIBILITY_CHECK', 'INTAKE_REVIEW'],
    toStatus: 'EVIDENCE_REVIEW',
    requiresNarrative: true,
    requiresReasonCode: false,
    requiredRoles: ['CLAIMS_OFFICER', 'SUPERVISOR', 'ADMIN'],
    preconditions: [],
    auditEvent: 'EVIDENCE_REQUESTED',
    notificationTrigger: 'bn_evidence_requested',
  },
  {
    action: 'RUN_CALCULATION',
    label: 'Run Calculation',
    fromStatuses: ['ELIGIBILITY_CHECK', 'EVIDENCE_REVIEW'],
    toStatus: 'CALCULATION',
    requiresNarrative: false,
    requiresReasonCode: false,
    requiredRoles: ['CLAIMS_OFFICER', 'SUPERVISOR', 'ADMIN'],
    preconditions: ['Eligibility check must pass'],
    auditEvent: 'CALCULATION_STARTED',
  },
  {
    action: 'SUBMIT_DECISION',
    label: 'Submit for Decision',
    fromStatuses: ['CALCULATION'],
    toStatus: 'DECISION',
    requiresNarrative: false,
    requiresReasonCode: false,
    requiredRoles: ['CLAIMS_OFFICER', 'SUPERVISOR', 'ADMIN'],
    preconditions: ['Calculation must be completed'],
    auditEvent: 'DECISION_SUBMITTED',
  },
  {
    action: 'APPROVE',
    label: 'Approve',
    fromStatuses: ['DECISION'],
    toStatus: 'APPROVED',
    requiresNarrative: true,
    requiresReasonCode: false,
    requiredRoles: ['SUPERVISOR', 'ADMIN'],
    preconditions: ['All required evidence verified', 'Calculation completed'],
    auditEvent: 'CLAIM_APPROVED',
    notificationTrigger: 'bn_claim_approved',
  },
  {
    action: 'DENY',
    label: 'Deny',
    fromStatuses: ['DECISION', 'ELIGIBILITY_CHECK'],
    toStatus: 'DENIED',
    requiresNarrative: true,
    requiresReasonCode: true,
    requiredRoles: ['SUPERVISOR', 'ADMIN'],
    preconditions: [],
    auditEvent: 'CLAIM_DENIED',
    notificationTrigger: 'bn_claim_denied',
  },
  {
    action: 'REQUEST_INFO',
    label: 'Request Info',
    fromStatuses: ['INTAKE_REVIEW', 'ELIGIBILITY_CHECK', 'EVIDENCE_REVIEW', 'CALCULATION', 'DECISION'],
    toStatus: 'PENDING_INFO',
    requiresNarrative: true,
    requiresReasonCode: false,
    requiredRoles: ['CLAIMS_OFFICER', 'SUPERVISOR', 'ADMIN'],
    preconditions: [],
    auditEvent: 'INFO_REQUESTED',
    notificationTrigger: 'bn_evidence_requested',
  },
  {
    action: 'SUSPEND',
    label: 'Suspend',
    fromStatuses: ['SUBMITTED', 'INTAKE_REVIEW', 'ELIGIBILITY_CHECK', 'EVIDENCE_REVIEW', 'CALCULATION', 'DECISION', 'APPROVED', 'IN_PAYMENT'],
    toStatus: 'SUSPENDED',
    requiresNarrative: true,
    requiresReasonCode: true,
    requiredRoles: ['SUPERVISOR', 'ADMIN'],
    preconditions: [],
    auditEvent: 'CLAIM_SUSPENDED',
  },
  {
    action: 'REOPEN',
    label: 'Reopen',
    fromStatuses: ['SUSPENDED', 'DENIED', 'CLOSED', 'PENDING_INFO'],
    toStatus: 'INTAKE_REVIEW',
    requiresNarrative: true,
    requiresReasonCode: true,
    requiredRoles: ['SUPERVISOR', 'ADMIN'],
    preconditions: [],
    auditEvent: 'CLAIM_REOPENED',
  },
  {
    action: 'WITHDRAW',
    label: 'Withdraw',
    fromStatuses: ['DRAFT', 'SUBMITTED', 'INTAKE_REVIEW', 'PENDING_INFO'],
    toStatus: 'WITHDRAWN',
    requiresNarrative: true,
    requiresReasonCode: true,
    requiredRoles: ['CLAIMS_OFFICER', 'SUPERVISOR', 'ADMIN'],
    preconditions: [],
    auditEvent: 'CLAIM_WITHDRAWN',
  },
  {
    action: 'CLOSE',
    label: 'Close',
    fromStatuses: ['APPROVED', 'DENIED', 'IN_PAYMENT', 'WITHDRAWN'],
    toStatus: 'CLOSED',
    requiresNarrative: false,
    requiresReasonCode: false,
    requiredRoles: ['SUPERVISOR', 'ADMIN'],
    preconditions: ['No pending payables'],
    auditEvent: 'CLAIM_CLOSED',
  },
];

export function getAvailableTransitions(currentStatus: string, userRoles: string[]): ClaimTransition[] {
  return CLAIM_TRANSITIONS.filter(t =>
    t.fromStatuses.includes(currentStatus) &&
    t.requiredRoles.some(r => userRoles.includes(r))
  );
}
