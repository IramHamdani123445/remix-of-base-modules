/**
 * Approval Level Service (Phase 4)
 *
 * Multi-tier approval routing for BN claims, driven by
 * `bn_approval_policy` rows (area = AWARD or PAYMENT) ordered by `level`,
 * matched against the claim amount and the actor's roles.
 *
 * Responsibilities:
 *  - Resolve the chain of approval levels for a product version.
 *  - Pick the *next* required level for an amount.
 *  - Decide whether the current actor can fully approve, or only recommend
 *    and forward to the next level workbasket.
 *  - Look up a transition rule's `creates_task_type` so post-approve routing
 *    (AWARD_SETUP vs PAYMENT_QUEUE) is configuration, not hardcoded.
 */
import { supabase } from '@/integrations/supabase/client';

const db = supabase as any;

export interface ApprovalLevel {
  id: string;
  product_version_id: string;
  policy_area: string;
  level: number;
  approval_role: string | null;
  approval_workbasket_id: string | null;
  next_level_workbasket_id: string | null;
  min_amount: number | null;
  max_amount: number | null;
  self_approval_allowed: boolean | null;
  is_enabled: boolean | null;
}

export interface ApprovalRouting {
  /** Maximum required level for this amount. */
  maxLevel: number;
  /** All applicable levels in ascending order. */
  levels: ApprovalLevel[];
  /** Highest level the actor's roles satisfy. 0 if none. */
  actorMaxLevel: number;
  /** True if actor can approve at or above maxLevel. */
  canFullyApprove: boolean;
  /** If !canFullyApprove, the level the claim should advance to next. */
  nextLevel: ApprovalLevel | null;
  /** Workbasket to assign to next reviewer. */
  nextWorkbasketId: string | null;
}

const norm = (s: string | null | undefined) => String(s || '').toUpperCase();

export async function getUserRoleNames(userCode: string): Promise<string[]> {
  if (!userCode) return [];
  const { data } = await db.from('user_roles').select('role').eq('user_id', userCode);
  return (data ?? []).map((r: any) => norm(r.role));
}

export async function getApprovalLevels(
  productVersionId: string,
  area: 'AWARD' | 'PAYMENT' = 'AWARD',
): Promise<ApprovalLevel[]> {
  if (!productVersionId) return [];
  const { data, error } = await db
    .from('bn_approval_policy')
    .select('id, product_version_id, policy_area, level, approval_role, approval_workbasket_id, next_level_workbasket_id, min_amount, max_amount, self_approval_allowed, is_enabled')
    .eq('product_version_id', productVersionId)
    .eq('policy_area', area)
    .order('level', { ascending: true });
  if (error) throw new Error(`getApprovalLevels failed: ${error.message}`);
  return ((data ?? []) as ApprovalLevel[]).filter((l) => l.is_enabled !== false);
}

function amountMatches(level: ApprovalLevel, amount: number): boolean {
  if (level.min_amount != null && amount < Number(level.min_amount)) return false;
  if (level.max_amount != null && amount > Number(level.max_amount)) return false;
  return true;
}

export async function resolveApprovalRouting(params: {
  productVersionId: string;
  amount: number;
  userRoles: string[];
  area?: 'AWARD' | 'PAYMENT';
}): Promise<ApprovalRouting> {
  const area = params.area ?? 'AWARD';
  const all = await getApprovalLevels(params.productVersionId, area);
  if (all.length === 0) {
    // No policy configured → single-level legacy behaviour: always allow.
    return {
      maxLevel: 0, levels: [], actorMaxLevel: 0,
      canFullyApprove: true, nextLevel: null, nextWorkbasketId: null,
    };
  }

  const applicable = all.filter((l) => amountMatches(l, params.amount));
  const maxLevel = applicable.length ? Math.max(...applicable.map((l) => l.level)) : 0;
  const userRoles = params.userRoles.map(norm);
  const satisfiedLevels = applicable
    .filter((l) => !l.approval_role || userRoles.includes(norm(l.approval_role)))
    .map((l) => l.level);
  const actorMaxLevel = satisfiedLevels.length ? Math.max(...satisfiedLevels) : 0;
  const canFullyApprove = actorMaxLevel >= maxLevel;

  let nextLevel: ApprovalLevel | null = null;
  if (!canFullyApprove) {
    nextLevel = applicable.find((l) => l.level === actorMaxLevel + 1)
      ?? applicable.find((l) => l.level > actorMaxLevel)
      ?? null;
  }

  return {
    maxLevel,
    levels: applicable,
    actorMaxLevel,
    canFullyApprove,
    nextLevel,
    nextWorkbasketId: nextLevel?.approval_workbasket_id
      ?? applicable.find((l) => l.level === actorMaxLevel)?.next_level_workbasket_id
      ?? null,
  };
}

/**
 * Resolve the side-effect for an action via `bn_claim_transition_rule`.
 * Returns `creates_task_type` (e.g. 'AWARD_SETUP', 'PAYMENT_QUEUE') and
 * the next workbasket if configured.
 */
export async function getTransitionSideEffect(params: {
  fromStatus: string;
  actionCode: string;
  productCategory?: string | null;
}): Promise<{ createsTaskType: string | null; nextWorkbasketId: string | null; toStatus: string | null }> {
  const q = db
    .from('bn_claim_transition_rule')
    .select('to_status, creates_task_type, next_workbasket_id, product_category')
    .eq('from_status', params.fromStatus)
    .eq('action_code', params.actionCode)
    .eq('is_active', true);
  const { data } = await q;
  const rows = (data ?? []) as any[];
  // Prefer category-specific row, fall back to wildcard.
  const cat = norm(params.productCategory);
  const match = rows.find((r) => norm(r.product_category) === cat)
    ?? rows.find((r) => !r.product_category);
  return {
    createsTaskType: match?.creates_task_type ?? null,
    nextWorkbasketId: match?.next_workbasket_id ?? null,
    toStatus: match?.to_status ?? null,
  };
}

/**
 * Assign the claim to a workbasket (idempotent — closes prior active row).
 *
 * `options.dueAt` sets the SLA deadline on the assignment. The escalation runner
 * watches that column, so an assignment created without it can never be
 * escalated — it simply sits in the queue (BUG-33 / BUG-24).
 *
 * `options.assignedTo` leaves the row unclaimed when null, which is what a
 * queue assignment should be: visible to everyone holding the basket's role
 * until an officer picks it.
 */
export async function assignClaimToWorkbasket(
  claimId: string,
  workbasketId: string,
  performedBy: string,
  _note?: string,
  options?: { dueAt?: string | null; assignedTo?: string | null },
): Promise<void> {
  if (!workbasketId) return;
  await db
    .from('bn_claim_queue_assignment')
    .update({ is_active: false, completed_at: new Date().toISOString() })
    .eq('claim_id', claimId)
    .eq('is_active', true);

  await db.from('bn_claim_queue_assignment').insert({
    claim_id: claimId,
    workbasket_id: workbasketId,
    assigned_to: options && 'assignedTo' in options ? options.assignedTo : performedBy,
    assigned_at: new Date().toISOString(),
    due_at: options?.dueAt ?? null,
    is_active: true,
  });
}

