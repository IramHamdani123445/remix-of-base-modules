/**
 * Entitlement Management Service
 *
 * Business Purpose:
 *   Represents the approved benefit right separately from claim processing
 *   and separately from issued payment. Entitlements are created only after
 *   approval and bridge claim → payable → payment lifecycle.
 *
 * Existing tables used:
 *   - bn_claim (claim context, linked-claim refs)
 *   - bn_claim_calculation (calc snapshot that seeded the entitlement)
 *   - bn_claim_decision (decision that triggered activation)
 *   - bn_claim_event (audit trail)
 *   - bn_product / bn_product_version (benefit type metadata)
 *   - cl_head (legacy claim header — soft join via claim_number)
 *   - cl_cheques / cl_cheques_holding / cl_cheques_survivor (outbound payment — read-only from here)
 *
 * New tables used:
 *   - bn_entitlement (this module's primary table)
 *   - bn_payment_instruction (payable instructions linked to entitlement)
 *   - bn_payment_schedule (recurring schedule linked to entitlement)
 *
 * Outbound payments: cl_cheques ONLY. cn_payment* NEVER used.
 * This module does NOT write to cl_cheques — the payment batch process does.
 */
import { supabase } from '@/integrations/supabase/client';
import { routeClaimAfterStatusChange } from '@/services/bn/workflow/routeClaimAfterStatusChange';

const db = supabase as any;

// ─── Types ──────────────────────────────────────────────────────────

export type BnEntitlementStatus =
  | 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'EXHAUSTED'
  | 'TERMINATED' | 'CANCELLED' | 'CLOSED' | 'REOPENED';

export type BnEntitlementType = 'PERIODIC' | 'LUMP_SUM' | 'BOTH';

export type BnPaymentFrequency = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY' | 'ONE_TIME';

export interface BnEntitlement {
  id: string;
  claim_id: string;
  ssn: string;
  claim_number: string | null;
  product_id: string | null;
  product_version_id: string | null;
  calculation_id: string | null;

  // Entitlement definition
  entitlement_type: BnEntitlementType;
  payment_frequency: BnPaymentFrequency;
  weekly_rate: number;
  monthly_rate: number | null;
  lump_sum_amount: number | null;
  total_entitlement: number;
  remaining_amount: number;
  duration_weeks: number | null;
  weeks_paid: number;

  // Effective dates
  effective_from: string;
  effective_to: string | null;
  next_review_date: string | null;

  // Status
  status: BnEntitlementStatus;
  override_applied: boolean;
  override_reason: string | null;

  // Suspension tracking
  suspended_at: string | null;
  suspended_by: string | null;
  suspension_reason: string | null;
  suspension_reason_code_id: string | null;

  // Termination tracking
  terminated_at: string | null;
  terminated_by: string | null;
  termination_reason: string | null;
  termination_reason_code_id: string | null;

  // Activation
  activated_at: string | null;
  activated_by: string | null;

  // Legacy references
  legacy_award_id: string | null;
  cl_head_claim_no: string | null;

  // Audit
  entered_by: string | null;
  entered_at: string;
  modified_by: string | null;
  modified_at: string | null;
}

export interface BnEntitlementEvent {
  id: string;
  entitlement_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  narrative: string | null;
  reason_code_id: string | null;
  performed_by: string;
  performed_at: string;
  metadata: Record<string, unknown>;
}

export interface EntitlementFilters {
  status?: string[];
  ssn?: string;
  claimId?: string;
  benefitCategory?: string;
  search?: string;
}

export interface EntitlementWithContext extends BnEntitlement {
  benefit_name: string | null;
  product_category: string | null;
  claimant_name: string | null;
  active_instructions: number;
  total_disbursed: number;
}

// ─── Lifecycle Status Transitions ───────────────────────────────────

export interface EntitlementAction {
  action: string;
  label: string;
  variant: 'default' | 'destructive' | 'outline' | 'secondary';
  fromStatuses: BnEntitlementStatus[];
  toStatus: BnEntitlementStatus;
  requiresNarrative: boolean;
  requiresReasonCode: boolean;
  roles: string[];
  notificationTrigger: string | null;
  auditEvent: string;
  payableImpact: string;
  claimImpact: string;
}

export const ENTITLEMENT_ACTIONS: EntitlementAction[] = [
  {
    action: 'ACTIVATE',
    label: 'Activate',
    variant: 'default',
    fromStatuses: ['DRAFT'],
    toStatus: 'ACTIVE',
    requiresNarrative: false,
    requiresReasonCode: false,
    roles: ['SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN'],
    notificationTrigger: 'entitlement.activated',
    auditEvent: 'entitlement.activated',
    payableImpact: 'Creates initial bn_payment_instruction',
    claimImpact: 'Claim status → AWARD_SETUP',
  },
  {
    action: 'SUSPEND',
    label: 'Suspend',
    variant: 'destructive',
    fromStatuses: ['ACTIVE', 'REOPENED'],
    toStatus: 'SUSPENDED',
    requiresNarrative: true,
    requiresReasonCode: true,
    roles: ['SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN'],
    notificationTrigger: 'entitlement.suspended',
    auditEvent: 'entitlement.suspended',
    payableImpact: 'Holds all PENDING payment instructions',
    claimImpact: 'Claim status → SUSPENDED',
  },
  {
    action: 'RESUME',
    label: 'Resume',
    variant: 'default',
    fromStatuses: ['SUSPENDED'],
    toStatus: 'ACTIVE',
    requiresNarrative: true,
    requiresReasonCode: false,
    roles: ['SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN'],
    notificationTrigger: 'entitlement.resumed',
    auditEvent: 'entitlement.resumed',
    payableImpact: 'Releases held payment instructions',
    claimImpact: 'Claim status → IN_PAYMENT',
  },
  {
    action: 'TERMINATE',
    label: 'Terminate',
    variant: 'destructive',
    fromStatuses: ['ACTIVE', 'SUSPENDED', 'REOPENED'],
    toStatus: 'TERMINATED',
    requiresNarrative: true,
    requiresReasonCode: true,
    roles: ['MANAGER', 'DIRECTOR', 'ADMIN'],
    notificationTrigger: 'entitlement.terminated',
    auditEvent: 'entitlement.terminated',
    payableImpact: 'Cancels all PENDING payment instructions; no further payments',
    claimImpact: 'Claim status → CLOSED',
  },
  {
    action: 'CANCEL',
    label: 'Cancel',
    variant: 'destructive',
    fromStatuses: ['DRAFT'],
    toStatus: 'CANCELLED',
    requiresNarrative: true,
    requiresReasonCode: false,
    roles: ['SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN'],
    notificationTrigger: null,
    auditEvent: 'entitlement.cancelled',
    payableImpact: 'None (draft has no instructions)',
    claimImpact: 'None',
  },
  {
    action: 'CLOSE',
    label: 'Close (Exhausted)',
    variant: 'outline',
    fromStatuses: ['ACTIVE', 'REOPENED'],
    toStatus: 'EXHAUSTED',
    requiresNarrative: false,
    requiresReasonCode: false,
    roles: ['SUPERVISOR', 'MANAGER', 'DIRECTOR', 'ADMIN'],
    notificationTrigger: 'entitlement.exhausted',
    auditEvent: 'entitlement.exhausted',
    payableImpact: 'Marks remaining_amount = 0; final payment instruction generated',
    claimImpact: 'Claim status → CLOSED',
  },
  {
    action: 'REOPEN',
    label: 'Reopen',
    variant: 'secondary',
    fromStatuses: ['EXHAUSTED', 'TERMINATED', 'CLOSED'],
    toStatus: 'REOPENED',
    requiresNarrative: true,
    requiresReasonCode: true,
    roles: ['MANAGER', 'DIRECTOR', 'ADMIN'],
    notificationTrigger: 'entitlement.reopened',
    auditEvent: 'entitlement.reopened',
    payableImpact: 'May generate new payment instructions upon recalculation',
    claimImpact: 'Claim status → IN_PAYMENT',
  },
];

export const ENTITLEMENT_STATUS_LABELS: Record<BnEntitlementStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  EXHAUSTED: 'Exhausted',
  TERMINATED: 'Terminated',
  CANCELLED: 'Cancelled',
  CLOSED: 'Closed',
  REOPENED: 'Reopened',
};

export const ENTITLEMENT_ROLE_MATRIX: Record<string, { canView: boolean; canAct: boolean; actions: string[] }> = {
  CLAIMS_OFFICER: { canView: true, canAct: false, actions: [] },
  SUPERVISOR: { canView: true, canAct: true, actions: ['ACTIVATE', 'SUSPEND', 'RESUME', 'CANCEL', 'CLOSE'] },
  MANAGER: { canView: true, canAct: true, actions: ['ACTIVATE', 'SUSPEND', 'RESUME', 'TERMINATE', 'CANCEL', 'CLOSE', 'REOPEN'] },
  DIRECTOR: { canView: true, canAct: true, actions: ['ACTIVATE', 'SUSPEND', 'RESUME', 'TERMINATE', 'CANCEL', 'CLOSE', 'REOPEN'] },
  ADMIN: { canView: true, canAct: true, actions: ['ACTIVATE', 'SUSPEND', 'RESUME', 'TERMINATE', 'CANCEL', 'CLOSE', 'REOPEN'] },
  AUDITOR: { canView: true, canAct: false, actions: [] },
};

// ─── Fetch Entitlements ─────────────────────────────────────────────

export async function fetchEntitlements(filters: EntitlementFilters = {}): Promise<EntitlementWithContext[]> {
  let query = db
    .from('bn_entitlement')
    .select(`
      *,
      bn_claim(claim_number, ssn, status, bn_product(benefit_name, category)),
      bn_payment_instruction(id, status)
    `)
    .order('entered_at', { ascending: false })
    .limit(200);

  if (filters.status?.length) {
    query = query.in('status', filters.status);
  }
  if (filters.ssn) {
    query = query.eq('ssn', filters.ssn);
  }
  if (filters.claimId) {
    query = query.eq('claim_id', filters.claimId);
  }
  if (filters.search) {
    query = query.or(`ssn.ilike.%${filters.search}%,claim_number.ilike.%${filters.search}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((e: any) => {
    const instructions = e.bn_payment_instruction ?? [];
    return {
      ...e,
      claim_number: e.bn_claim?.claim_number || e.claim_number,
      benefit_name: e.bn_claim?.bn_product?.benefit_name || null,
      product_category: e.bn_claim?.bn_product?.category || null,
      claimant_name: null,
      active_instructions: instructions.filter((i: any) => ['PENDING', 'SCHEDULED'].includes(i.status)).length,
      total_disbursed: (e.total_entitlement ?? 0) - (e.remaining_amount ?? 0),
    } as EntitlementWithContext;
  });
}

// ─── Fetch Single Entitlement ───────────────────────────────────────

/**
 * Note the column names: `bn_entitlement` has `entered_at`, but
 * `bn_payment_instruction` does not — it has `created_at`. Asking the embedded
 * select for `entered_at` made PostgREST reject the whole query, so the
 * Entitlement Detail drawer rendered empty. That drawer is the only place
 * ENTITLEMENT_ACTIONS is used, so Suspend, Terminate and Cancel were all
 * unreachable while it failed.
 */
export async function fetchEntitlementDetail(entitlementId: string): Promise<EntitlementWithContext | null> {
  const { data, error } = await db
    .from('bn_entitlement')
    .select(`
      *,
      bn_claim(claim_number, ssn, status, priority, bn_product(benefit_name, category)),
      bn_payment_instruction(id, status, amount, instruction_type, created_at)
    `)
    .eq('id', entitlementId)
    .single();

  if (error) throw error;
  if (!data) return null;

  const instructions = data.bn_payment_instruction ?? [];
  return {
    ...data,
    claim_number: data.bn_claim?.claim_number || data.claim_number,
    benefit_name: data.bn_claim?.bn_product?.benefit_name || null,
    product_category: data.bn_claim?.bn_product?.category || null,
    claimant_name: null,
    active_instructions: instructions.filter((i: any) => ['PENDING', 'SCHEDULED'].includes(i.status)).length,
    total_disbursed: (data.total_entitlement ?? 0) - (data.remaining_amount ?? 0),
  };
}

// ─── Fetch Entitlement Events ───────────────────────────────────────

export async function fetchEntitlementEvents(entitlementId: string): Promise<BnEntitlementEvent[]> {
  const { data, error } = await db
    .from('bn_claim_event')
    .select('*')
    .or(`metadata->>entitlement_id.eq.${entitlementId},metadata->>entity_type.eq.ENTITLEMENT`)
    .order('performed_at', { ascending: false });

  if (error) return [];
  return data ?? [];
}

// ─── Execute Entitlement Action ─────────────────────────────────────

export interface ExecuteEntitlementActionParams {
  entitlementId: string;
  action: string;
  narrative?: string;
  reasonCodeId?: string;
  performedBy: string;
}

export async function executeEntitlementAction(params: ExecuteEntitlementActionParams): Promise<{ success: boolean; newStatus: BnEntitlementStatus }> {
  const { entitlementId, action, narrative, reasonCodeId, performedBy } = params;

  const actionDef = ENTITLEMENT_ACTIONS.find(a => a.action === action);
  if (!actionDef) throw new Error(`Unknown entitlement action: ${action}`);

  // Get current entitlement
  const { data: ent, error: entErr } = await db
    .from('bn_entitlement')
    .select('id, status, claim_id, ssn')
    .eq('id', entitlementId)
    .single();
  if (entErr || !ent) throw new Error('Entitlement not found');

  // Validate transition
  if (!actionDef.fromStatuses.includes(ent.status)) {
    throw new Error(`Cannot ${action} from status ${ent.status}. Allowed from: ${actionDef.fromStatuses.join(', ')}`);
  }

  // Validate required fields
  if (actionDef.requiresNarrative && !narrative?.trim()) {
    throw new Error('Narrative/justification is required for this action.');
  }
  if (actionDef.requiresReasonCode && !reasonCodeId) {
    throw new Error('Reason code is required for this action.');
  }

  const now = new Date().toISOString();
  const newStatus = actionDef.toStatus;

  // Build update payload
  const update: Record<string, any> = {
    status: newStatus,
    modified_by: performedBy,
    modified_at: now,
  };

  switch (action) {
    case 'ACTIVATE':
      update.activated_at = now;
      update.activated_by = performedBy;
      break;
    case 'SUSPEND':
      update.suspended_at = now;
      update.suspended_by = performedBy;
      update.suspension_reason = narrative;
      update.suspension_reason_code_id = reasonCodeId;
      break;
    case 'RESUME':
      update.suspended_at = null;
      update.suspended_by = null;
      update.suspension_reason = null;
      update.suspension_reason_code_id = null;
      break;
    case 'TERMINATE':
      update.terminated_at = now;
      update.terminated_by = performedBy;
      update.termination_reason = narrative;
      update.termination_reason_code_id = reasonCodeId;
      break;
    case 'CLOSE':
      update.remaining_amount = 0;
      break;
    case 'REOPEN':
      update.terminated_at = null;
      update.terminated_by = null;
      update.termination_reason = null;
      break;
  }

  // Update entitlement
  const { error: updErr } = await db
    .from('bn_entitlement')
    .update(update)
    .eq('id', entitlementId);
  if (updErr) throw updErr;

  // Write audit event to bn_claim_event
  await db.from('bn_claim_event').insert({
    claim_id: ent.claim_id,
    event_type: `ENTITLEMENT_${action}`,
    from_status: ent.status,
    to_status: newStatus,
    notes: narrative || `Entitlement action: ${action}`,
    performed_by: performedBy,
    performed_at: now,
    metadata: {
      entitlement_id: entitlementId,
      entity_type: 'ENTITLEMENT',
      reason_code_id: reasonCodeId,
      action,
    },
  });

  // Downstream payable impact
  if (action === 'SUSPEND') {
    await db.from('bn_payment_instruction')
      .update({ status: 'HELD', modified_by: performedBy })
      .eq('claim_id', ent.claim_id)
      .eq('status', 'PENDING');
  }
  if (action === 'RESUME') {
    await db.from('bn_payment_instruction')
      .update({ status: 'PENDING', modified_by: performedBy })
      .eq('claim_id', ent.claim_id)
      .eq('status', 'HELD');
  }
  if (action === 'TERMINATE' || action === 'CANCEL') {
    await db.from('bn_payment_instruction')
      .update({ status: 'CANCELLED', modified_by: performedBy })
      .eq('claim_id', ent.claim_id)
      .in('status', ['PENDING', 'HELD', 'SCHEDULED']);
  }

  // Update claim status if applicable
  if (actionDef.claimImpact && actionDef.claimImpact !== 'None') {
    const claimStatusMap: Record<string, string> = {
      'Claim status → AWARD_SETUP': 'AWARD_SETUP',
      'Claim status → SUSPENDED': 'SUSPENDED',
      'Claim status → IN_PAYMENT': 'IN_PAYMENT',
      'Claim status → CLOSED': 'CLOSED',
    };
    const claimStatus = claimStatusMap[actionDef.claimImpact];
    if (claimStatus) {
      await db.from('bn_claim')
        .update({ status: claimStatus, modified_by: performedBy, modified_at: now })
        .eq('id', ent.claim_id);
      await routeClaimAfterStatusChange(ent.claim_id, performedBy);
    }
  }

  return { success: true, newStatus };
}

// ─── Update Entitlement Fields (rate adjustments, review dates) ─────

export interface UpdateEntitlementParams {
  entitlementId: string;
  updates: {
    weekly_rate?: number;
    monthly_rate?: number;
    lump_sum_amount?: number;
    total_entitlement?: number;
    remaining_amount?: number;
    duration_weeks?: number;
    effective_to?: string;
    next_review_date?: string;
    payment_frequency?: BnPaymentFrequency;
  };
  narrative: string;
  performedBy: string;
}

export async function updateEntitlementFields(params: UpdateEntitlementParams): Promise<void> {
  const { entitlementId, updates, narrative, performedBy } = params;

  // Get current for audit snapshot
  const { data: current } = await db
    .from('bn_entitlement')
    .select('*')
    .eq('id', entitlementId)
    .single();

  if (!current) throw new Error('Entitlement not found');

  const now = new Date().toISOString();

  await db.from('bn_entitlement')
    .update({
      ...updates,
      modified_by: performedBy,
      modified_at: now,
    })
    .eq('id', entitlementId);

  // Audit trail
  await db.from('bn_claim_event').insert({
    claim_id: current.claim_id,
    event_type: 'ENTITLEMENT_UPDATED',
    notes: narrative,
    performed_by: performedBy,
    performed_at: now,
    metadata: {
      entitlement_id: entitlementId,
      entity_type: 'ENTITLEMENT',
      changed_fields: Object.keys(updates),
      before: Object.fromEntries(
        Object.keys(updates).map(k => [k, current[k]])
      ),
      after: updates,
    },
  });
}
