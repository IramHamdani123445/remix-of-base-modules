/**
 * Approval Console Service
 * 
 * Business Purpose:
 *   Supervisor/approver review of benefit decisions before entitlement
 *   creation and payment orchestration. Approval does NOT directly
 *   create issued payments in cl_cheques*.
 * 
 * Existing tables used:
 *   - bn_claim, bn_claim_decision, bn_claim_event, bn_claim_evidence
 *   - bn_claim_eligibility, bn_claim_calculation
 *   - bn_product, bn_product_version
 *   - bn_workbasket, bn_claim_queue_assignment
 *   - bn_reason_code, bn_claim_transition_rule
 *   - workflow_instances (existing workflow process)
 * 
 * New orchestration on approval:
 *   - bn_entitlement (activate)
 *   - bn_payment_instruction (create payable)
 * 
 * OUTBOUND PAYMENTS: cl_cheques only. cn_payment* NEVER used.
 * Approval here creates/activates entitlement — does NOT issue payment.
 */
import { routeClaimAfterStatusChange } from '@/services/bn/workflow/routeClaimAfterStatusChange';
import { supabase } from '@/integrations/supabase/client';
import type { BnClaim, BnClaimDecision } from '@/types/bn';

const db = supabase as any;

// ─── Types ──────────────────────────────────────────────────────────

export interface ApprovalQueueItem {
  id: string; // queue assignment id
  claim_id: string;
  claim_number: string | null;
  ssn: string;
  claimant_name?: string;
  benefit_type: string;
  product_category: string;
  status: string;
  priority: string;
  claim_date: string;
  submission_date: string | null;
  assigned_to: string | null;
  assigned_at: string;
  due_at: string | null;
  workbasket_name: string;
  entered_by: string | null;
  age_days: number;
  has_calculation: boolean;
  has_eligibility: boolean;
  evidence_complete: boolean;
  latest_decision_action: string | null;
}

export interface ApprovalFilters {
  status?: string[];
  priority?: string[];
  benefitCategory?: string;
  workbasketId?: string;
  assignedTo?: string;
  minAgeDays?: number;
  maxAgeDays?: number;
  search?: string;
}

export interface ApprovalCaseSummary {
  claim: BnClaim;
  product: { benefit_name: string; category: string } | null;
  eligibility: { overall_result: boolean; check_date: string; override_applied: boolean } | null;
  calculation: { weekly_rate: number | null; lump_sum: number | null; total_payable: number | null; calc_date: string } | null;
  evidence: { total: number; verified: number; pending: number; missing: number };
  latestDecision: BnClaimDecision | null;
  makerUserCode: string | null; // for maker-checker
}

export interface ApprovalAction {
  action: string;
  label: string;
  variant: 'default' | 'destructive' | 'outline' | 'secondary';
  requiresNarrative: boolean;
  requiresReasonCode: boolean;
  resultStatus: string;
  supportsBulk: boolean;
  preconditions: string[];
  workflowTransition: string;
  notificationTrigger: string | null;
  auditEvent: string;
  entitlementImpact: string;
  roles: string[];
}

// ─── Actions ────────────────────────────────────────────────────────

export const APPROVAL_ACTIONS: ApprovalAction[] = [
  {
    action: 'APPROVE',
    label: 'Approve',
    variant: 'default',
    requiresNarrative: true,
    requiresReasonCode: false,
    resultStatus: 'APPROVED',
    supportsBulk: true,
    preconditions: ['has_calculation', 'has_eligibility_pass', 'evidence_complete', 'maker_checker'],
    workflowTransition: 'DECISION → APPROVED',
    notificationTrigger: 'claim.approved',
    auditEvent: 'approval.approved',
    entitlementImpact: 'Creates/activates bn_entitlement; creates bn_payment_instruction with status PENDING',
    roles: ['SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN'],
  },
  {
    action: 'DISALLOW',
    label: 'Disallow',
    variant: 'destructive',
    requiresNarrative: true,
    requiresReasonCode: true,
    resultStatus: 'DENIED',
    supportsBulk: false,
    preconditions: ['maker_checker'],
    workflowTransition: 'DECISION → DENIED',
    notificationTrigger: 'claim.denied',
    auditEvent: 'approval.disallowed',
    entitlementImpact: 'No entitlement created; existing draft entitlement cancelled',
    roles: ['SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN'],
  },
  {
    action: 'REQUEST_EVIDENCE',
    label: 'Request Evidence',
    variant: 'outline',
    requiresNarrative: true,
    requiresReasonCode: false,
    resultStatus: 'PENDING_INFO',
    supportsBulk: false,
    preconditions: [],
    workflowTransition: 'DECISION → PENDING_INFO',
    notificationTrigger: 'claim.evidence_requested',
    auditEvent: 'approval.evidence_requested',
    entitlementImpact: 'None',
    roles: ['SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN', 'CLAIMS_OFFICER'],
  },
  {
    action: 'OVERRIDE',
    label: 'Override',
    variant: 'secondary',
    requiresNarrative: true,
    requiresReasonCode: true,
    resultStatus: 'APPROVED',
    supportsBulk: false,
    preconditions: ['maker_checker'],
    workflowTransition: 'DECISION → APPROVED (with override flag)',
    notificationTrigger: 'claim.override_approved',
    auditEvent: 'approval.overridden',
    entitlementImpact: 'Creates entitlement with override_applied flag',
    roles: ['MANAGER', 'DIRECTOR', 'ADMIN'],
  },
  {
    action: 'SEND_BACK',
    label: 'Send Back',
    variant: 'outline',
    requiresNarrative: true,
    requiresReasonCode: false,
    resultStatus: 'CALCULATION',
    supportsBulk: false,
    preconditions: [],
    workflowTransition: 'DECISION → CALCULATION',
    notificationTrigger: 'claim.sent_back',
    auditEvent: 'approval.sent_back',
    entitlementImpact: 'None; claim returns for recalculation',
    roles: ['SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN'],
  },
];

// ─── Role Matrix ────────────────────────────────────────────────────

export const APPROVAL_ROLE_MATRIX: Record<string, { canView: boolean; canAct: boolean; actions: string[] }> = {
  CLAIMS_OFFICER: { canView: true, canAct: true, actions: ['REQUEST_EVIDENCE'] },
  SUPERVISOR: { canView: true, canAct: true, actions: ['APPROVE', 'DISALLOW', 'REQUEST_EVIDENCE', 'SEND_BACK'] },
  MANAGER: { canView: true, canAct: true, actions: ['APPROVE', 'DISALLOW', 'REQUEST_EVIDENCE', 'OVERRIDE', 'SEND_BACK'] },
  DIRECTOR: { canView: true, canAct: true, actions: ['APPROVE', 'DISALLOW', 'REQUEST_EVIDENCE', 'OVERRIDE', 'SEND_BACK'] },
  ADMIN: { canView: true, canAct: true, actions: ['APPROVE', 'DISALLOW', 'REQUEST_EVIDENCE', 'OVERRIDE', 'SEND_BACK'] },
  AUDITOR: { canView: true, canAct: false, actions: [] },
};

// ─── Fetch Approval Queue ───────────────────────────────────────────

export async function fetchApprovalQueue(filters: ApprovalFilters = {}): Promise<ApprovalQueueItem[]> {
  let query = db
    .from('bn_claim')
    .select(`
      id, claim_number, ssn, status, priority, claim_date, submission_date,
      assigned_to, entered_by, 
      bn_product(benefit_name, category),
      bn_claim_eligibility(overall_result),
      bn_claim_calculation(id, calc_date),
      bn_claim_evidence(status)
    `)
    .in('status', filters.status?.length ? filters.status : ['DECISION', 'APPROVED'])
    .order('claim_date', { ascending: true });

  if (filters.priority?.length) {
    query = query.in('priority', filters.priority);
  }
  if (filters.benefitCategory) {
    query = query.eq('bn_product.category', filters.benefitCategory);
  }
  if (filters.assignedTo) {
    query = query.eq('assigned_to', filters.assignedTo);
  }
  if (filters.search) {
    query = query.or(`claim_number.ilike.%${filters.search}%,ssn.ilike.%${filters.search}%`);
  }

  const { data, error } = await query.limit(200);
  if (error) throw error;

  const now = Date.now();

  return (data ?? []).map((c: any) => {
    const evidenceArr = c.bn_claim_evidence ?? [];
    const verified = evidenceArr.filter((e: any) => e.status === 'VERIFIED').length;
    const pending = evidenceArr.filter((e: any) => ['PENDING', 'UPLOADED'].includes(e.status)).length;
    const missing = evidenceArr.filter((e: any) => e.status === 'MISSING').length;
    const eligArr = c.bn_claim_eligibility ?? [];
    const calcArr = c.bn_claim_calculation ?? [];

    return {
      id: c.id,
      claim_id: c.id,
      claim_number: c.claim_number,
      ssn: c.ssn,
      benefit_type: c.bn_product?.benefit_name || 'Unknown',
      product_category: c.bn_product?.category || '',
      status: c.status,
      priority: c.priority,
      claim_date: c.claim_date,
      submission_date: c.submission_date,
      assigned_to: c.assigned_to,
      assigned_at: c.claim_date,
      due_at: null,
      workbasket_name: '',
      entered_by: c.entered_by,
      age_days: Math.floor((now - new Date(c.claim_date).getTime()) / (1000 * 60 * 60 * 24)),
      has_calculation: calcArr.length > 0,
      has_eligibility: eligArr.some((e: any) => e.overall_result === true),
      evidence_complete: missing === 0 && pending === 0 && evidenceArr.length > 0,
      latest_decision_action: null,
    } as ApprovalQueueItem;
  });
}

// ─── Fetch Single Case Summary ──────────────────────────────────────

export async function fetchApprovalCaseSummary(claimId: string): Promise<ApprovalCaseSummary> {
  const [claimRes, eligRes, calcRes, evidRes, decRes] = await Promise.all([
    db.from('bn_claim').select('*, bn_product(benefit_name, category)').eq('id', claimId).single(),
    db.from('bn_claim_eligibility').select('overall_result, check_date, override_applied').eq('claim_id', claimId).order('check_date', { ascending: false }).limit(1),
    db.from('bn_claim_calculation').select('weekly_rate, lump_sum, total_payable, calc_date').eq('claim_id', claimId).order('calc_date', { ascending: false }).limit(1),
    db.from('bn_claim_evidence').select('status').eq('claim_id', claimId),
    db.from('bn_claim_decision').select('*, bn_reason_code(*)').eq('claim_id', claimId).order('performed_at', { ascending: false }).limit(1),
  ]);

  if (claimRes.error) throw claimRes.error;

  const evidData = evidRes.data ?? [];

  return {
    claim: claimRes.data,
    product: claimRes.data?.bn_product || null,
    eligibility: eligRes.data?.[0] || null,
    calculation: calcRes.data?.[0] || null,
    evidence: {
      total: evidData.length,
      verified: evidData.filter((e: any) => e.status === 'VERIFIED').length,
      pending: evidData.filter((e: any) => ['PENDING', 'UPLOADED'].includes(e.status)).length,
      missing: evidData.filter((e: any) => e.status === 'MISSING').length,
    },
    latestDecision: decRes.data?.[0] || null,
    makerUserCode: claimRes.data?.entered_by || null,
  };
}

// ─── Execute Approval Action ────────────────────────────────────────

export interface ExecuteApprovalParams {
  claimId: string;
  action: string;
  narrative: string;
  reasonCodeId?: string;
  performedBy: string;
}

export async function executeApprovalAction(params: ExecuteApprovalParams): Promise<{ success: boolean; newStatus: string }> {
  const { claimId, action, narrative, reasonCodeId, performedBy } = params;

  const actionDef = APPROVAL_ACTIONS.find(a => a.action === action);
  if (!actionDef) throw new Error(`Unknown approval action: ${action}`);

  // Get current claim
  const { data: claim, error: claimErr } = await db
    .from('bn_claim')
    .select('id, status, entered_by')
    .eq('id', claimId)
    .single();
  if (claimErr || !claim) throw new Error('Claim not found');

  // ─── Approval preconditions ────────────────────────────────────────
  // APPROVE declares four preconditions — has_calculation,
  // has_eligibility_pass, evidence_complete, maker_checker — but only
  // maker-checker was enforced, and it compared `entered_by`, i.e. whoever
  // REGISTERED the claim rather than whoever recommended it. So a clerk could
  // register, an officer recommend, and that same officer approve.
  //
  // The other three were computed for the queue's badges and never checked, so
  // this console approved claims with outstanding documents, no passing
  // eligibility and no calculation — the same claims the Claim Workbench
  // refuses. Both paths now use one shared gate.
  if (action === 'APPROVE' || action === 'OVERRIDE') {
    const { checkApprovalPreconditions, describeApprovalBlockers } = await import(
      './claims/approvalPreconditions'
    );
    const pre = await checkApprovalPreconditions(claimId, performedBy, {
      reasonCode: reasonCodeId ?? null,
      narrative: narrative ?? null,
    });
    if (!pre.ok) {
      // Recorded so a refused approval is visible on the claim, as the previous
      // maker-checker block did.
      await db.from('bn_claim_event').insert({
        claim_id: claimId,
        event_type: 'APPROVAL_BLOCKED',
        notes:
          `User ${performedBy} blocked from ${action} — ` +
          pre.blockers.map(b => b.code).join(', '),
        performed_by: performedBy,
      });
      throw new Error(describeApprovalBlockers(pre.blockers));
    }
    // Self-approval that was permitted rather than absent: record WHY, so an
    // audit can see that separation of duties was waived and on what grounds.
    if (pre.selfApprovalReason) {
      await db.from('bn_claim_event').insert({
        claim_id: claimId,
        event_type: 'SELF_APPROVAL_PERMITTED',
        notes:
          `${performedBy} approved a claim they recommended — permitted: ${pre.selfApprovalReason}`,
        performed_by: performedBy,
      });
    }
  }

  const newStatus = actionDef.resultStatus;

  // Update claim status
  const claimUpdate: Record<string, any> = {
    status: newStatus,
    modified_by: performedBy,
    modified_at: new Date().toISOString(),
  };
  if (action === 'APPROVE' || action === 'OVERRIDE') {
    claimUpdate.decision_date = new Date().toISOString();
  }

  const { error: updateErr } = await db
    .from('bn_claim')
    .update(claimUpdate)
    .eq('id', claimId);
  if (updateErr) throw updateErr;

  // The claim's new status decides which workbasket owns it next.
  await routeClaimAfterStatusChange(claimId, performedBy);

  // Create decision record
  await db.from('bn_claim_decision').insert({
    claim_id: claimId,
    action_code: action,
    from_status: claim.status,
    to_status: newStatus,
    reason_code_id: reasonCodeId || null,
    narrative: narrative || null,
    performed_by: performedBy,
    performed_at: new Date().toISOString(),
    evidence_snapshot: {},
  });

  // Create audit event
  await db.from('bn_claim_event').insert({
    claim_id: claimId,
    event_type: `APPROVAL_${action}`,
    from_status: claim.status,
    to_status: newStatus,
    notes: narrative || `Approval action: ${action}`,
    performed_by: performedBy,
    metadata: { reason_code_id: reasonCodeId },
  });

  // Downstream entitlement impact
  if (action === 'APPROVE' || action === 'OVERRIDE') {
    await activateEntitlementOnApproval(claimId, performedBy, action === 'OVERRIDE');
  }

  if (action === 'DISALLOW') {
    await cancelDraftEntitlement(claimId, performedBy);
  }

  return { success: true, newStatus };
}

// ─── Bulk Approve ───────────────────────────────────────────────────

export async function executeBulkApproval(
  claimIds: string[],
  narrative: string,
  performedBy: string
): Promise<{ succeeded: string[]; failed: { claimId: string; error: string }[] }> {
  const succeeded: string[] = [];
  const failed: { claimId: string; error: string }[] = [];

  for (const claimId of claimIds) {
    try {
      await executeApprovalAction({
        claimId,
        action: 'APPROVE',
        narrative,
        performedBy,
      });
      succeeded.push(claimId);
    } catch (err: any) {
      failed.push({ claimId, error: err.message });
    }
  }

  return { succeeded, failed };
}

// ─── Entitlement Orchestration ──────────────────────────────────────
// On approval: create/activate entitlement + create payable instruction
// Does NOT create cl_cheques — that happens in payment batch processing

async function activateEntitlementOnApproval(claimId: string, performedBy: string, isOverride: boolean) {
  // Get calc data for entitlement
  const { data: calc } = await db
    .from('bn_claim_calculation')
    .select('weekly_rate, lump_sum, total_payable, duration_weeks')
    .eq('claim_id', claimId)
    .order('calc_date', { ascending: false })
    .limit(1);

  const latestCalc = calc?.[0];

  // Check for existing draft entitlement
  const { data: existing } = await db
    .from('bn_entitlement')
    .select('id')
    .eq('claim_id', claimId)
    .eq('status', 'DRAFT')
    .limit(1);

  if (existing?.length) {
    // Activate existing draft
    await db.from('bn_entitlement')
      .update({
        status: 'ACTIVE',
        activated_at: new Date().toISOString(),
        activated_by: performedBy,
        weekly_rate: latestCalc?.weekly_rate,
        lump_sum_amount: latestCalc?.lump_sum,
        total_entitlement: latestCalc?.total_payable,
        duration_weeks: latestCalc?.duration_weeks,
        override_applied: isOverride,
      })
      .eq('id', existing[0].id);
  } else {
    // Create new active entitlement
    await db.from('bn_entitlement').insert({
      claim_id: claimId,
      status: 'ACTIVE',
      weekly_rate: latestCalc?.weekly_rate ?? 0,
      lump_sum_amount: latestCalc?.lump_sum,
      total_entitlement: latestCalc?.total_payable ?? 0,
      duration_weeks: latestCalc?.duration_weeks,
      activated_at: new Date().toISOString(),
      activated_by: performedBy,
      override_applied: isOverride,
      entered_by: performedBy,
    });
  }

  // Spin up the BN payment intent chain: award → schedule → instruction.
  // Finance/Cashier owns execution (paymentIssueService / cl_cheques);
  // approval here only creates the intent.
  try {
    const { provisionPaymentIntent } = await import('@/services/bn/paymentBoundaryService');
    await provisionPaymentIntent(claimId, performedBy);
  } catch {
    // boundary unavailable — leave entitlement created; intent can be backfilled
  }
}

async function cancelDraftEntitlement(claimId: string, performedBy: string) {
  await db.from('bn_entitlement')
    .update({
      status: 'CANCELLED',
      cancelled_at: new Date().toISOString(),
      cancelled_by: performedBy,
    })
    .eq('claim_id', claimId)
    .eq('status', 'DRAFT');
}
