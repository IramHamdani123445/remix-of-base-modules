/**
 * Product Approval Service
 *
 * Drives the multi-level CONFIG_PUBLISH approval workflow for a
 * `bn_product_version` (which bundles the product's eligibility,
 * calculation and other rule changes).
 *
 * Levels are configurable per product via:
 *   bn_approval_policy WHERE policy_area = 'CONFIG_PUBLISH'
 *
 * Decisions are recorded in bn_version_approval (one row per level
 * decision: SUBMIT / REVIEW / APPROVE / REJECT / WITHDRAW / PUBLISH).
 *
 * Status transitions on bn_product_version.status:
 *   DRAFT → IN_REVIEW → APPROVED → ACTIVE
 *     (any stage) ─ REJECT ─→ DRAFT
 */
import { supabase } from '@/integrations/supabase/client';

export type ProductApprovalAction =
  | 'SUBMIT' | 'REVIEW' | 'APPROVE' | 'REJECT' | 'WITHDRAW' | 'PUBLISH';

export interface ApprovalLevelPolicy {
  id: string;
  level: number;
  stage_code: string | null;
  action_code: string;
  approval_role: string | null;
  approval_workbasket_id: string | null;
  requires_justification: boolean;
}

export interface ApprovalEvent {
  id: string;
  product_version_id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  level: number | null;
  stage_code: string | null;
  approver_role: string | null;
  decision: string | null;
  reason_code: string | null;
  comments: string | null;
  performed_by: string | null;
  performed_at: string;
}

/** Ordered list of CONFIG_PUBLISH approval levels for a product version. */
export async function getApprovalChain(productVersionId: string): Promise<ApprovalLevelPolicy[]> {
  const { data, error } = await supabase
    .from('bn_approval_policy')
    .select('id, level, stage_code, action_code, approval_role, approval_workbasket_id, requires_justification')
    .eq('product_version_id', productVersionId)
    .eq('policy_area', 'CONFIG_PUBLISH')
    .eq('is_enabled', true)
    .order('level', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(r => ({
    id: r.id,
    level: r.level ?? 1,
    stage_code: r.stage_code,
    action_code: r.action_code,
    approval_role: r.approval_role,
    approval_workbasket_id: r.approval_workbasket_id,
    requires_justification: !!r.requires_justification,
  }));
}

/** Approval history for the version, ordered chronologically. */
export async function getApprovalHistory(productVersionId: string): Promise<ApprovalEvent[]> {
  const { data, error } = await supabase
    .from('bn_version_approval')
    .select('*')
    .eq('product_version_id', productVersionId)
    .order('performed_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ApprovalEvent[];
}

/**
 * Resolve the next pending level for a product version:
 *  - Highest level that has been APPROVED in history → next level above it.
 *  - If none approved yet → first level.
 *  - If all levels approved → null (ready to PUBLISH).
 */
export async function getNextPendingLevel(productVersionId: string): Promise<ApprovalLevelPolicy | null> {
  const [chain, history] = await Promise.all([
    getApprovalChain(productVersionId),
    getApprovalHistory(productVersionId),
  ]);
  if (chain.length === 0) return null;
  const approvedLevels = new Set(
    history.filter(h => h.decision === 'APPROVED' && h.level != null).map(h => h.level as number),
  );
  for (const level of chain) {
    if (!approvedLevels.has(level.level)) return level;
  }
  return null;
}

interface DecisionInput {
  productVersionId: string;
  action: ProductApprovalAction;
  level?: number;
  stageCode?: string | null;
  approverRole?: string | null;
  reasonCode?: string | null;
  comments?: string | null;
  performedBy: string; // user_code
  ruleDiffSnapshot?: unknown;
}

/** Persist a decision row + transition bn_product_version.status when warranted. */
export async function recordDecision(input: DecisionInput): Promise<void> {
  const { data: pv, error: pvErr } = await supabase
    .from('bn_product_version')
    .select('status')
    .eq('id', input.productVersionId)
    .maybeSingle();
  if (pvErr) throw pvErr;
  const fromStatus = pv?.status ?? null;

  let toStatus = fromStatus;
  let decision: string | null = null;
  switch (input.action) {
    // PENDING_APPROVAL, not IN_REVIEW: one vocabulary for the lifecycle, and it
    // is the one the Versions tab and the type definitions already use.
    case 'SUBMIT':
      toStatus = 'PENDING_APPROVAL'; decision = 'SUBMITTED'; break;
    case 'REVIEW':
    case 'APPROVE':
      decision = 'APPROVED';
      break;
    case 'REJECT':
      toStatus = 'DRAFT'; decision = 'REJECTED'; break;
    case 'WITHDRAW':
      toStatus = 'DRAFT'; decision = 'WITHDRAWN'; break;
    case 'PUBLISH':
      toStatus = 'ACTIVE'; decision = 'PUBLISHED'; break;
  }

  // Approving the last level does NOT change the version's status. The
  // lifecycle has no APPROVED state, and inventing one here produced a value
  // the rest of the application never recognises. The version stays at
  // PENDING_APPROVAL until it is published; "fully approved" is derived from
  // the approval history instead — see isFullyApproved().

  const { error: insertErr } = await (supabase.from('bn_version_approval') as any).insert({
    product_version_id: input.productVersionId,
    action: input.action,
    from_status: fromStatus,
    to_status: toStatus,
    level: input.level ?? null,
    stage_code: input.stageCode ?? null,
    approver_role: input.approverRole ?? null,
    decision,
    reason_code: input.reasonCode ?? null,
    comments: input.comments ?? null,
    performed_by: input.performedBy,
    rule_diff_snapshot: input.ruleDiffSnapshot ?? null,
  });
  if (insertErr) throw insertErr;

  if (toStatus && toStatus !== fromStatus) {
    const { error: updErr } = await supabase
      .from('bn_product_version')
      .update({ status: toStatus, modified_by: input.performedBy, modified_at: new Date().toISOString() })
      .eq('id', input.productVersionId);
    if (updErr) throw updErr;
  }
}

/**
 * Why a version cannot be acted on, when it cannot.
 *
 * getNextPendingLevel() returns null in two completely different situations —
 * every level has signed off, and no approval chain exists at all. Both used to
 * render as "Ready to Publish", so a version nobody can ever approve looked
 * finished. They are now told apart.
 */
export type ApprovalReadiness =
  | 'AWAITING_LEVEL'    // a level is pending; nextLevel names the role
  | 'READY_TO_PUBLISH'  // every configured level has approved
  | 'NO_CHAIN';         // no CONFIG_PUBLISH policy — stuck, nobody can approve

export interface PendingApprovalRow {
  productVersion: any;
  nextLevel: ApprovalLevelPolicy | null;
  canAct: boolean;
  readiness: ApprovalReadiness;
}

/**
 * Every product version awaiting approval, with the role each is waiting on.
 *
 * BUG-22 — this queried status IN_REVIEW / APPROVED. The Versions tab, which is
 * the route people actually use, submits a version as PENDING_APPROVAL, so the
 * console's queue was always empty while versions sat waiting. (Contrary to the
 * original write-up, recordDecision below *does* write IN_REVIEW and APPROVED —
 * the problem is two paths using two different vocabularies for one lifecycle,
 * not a value nothing writes. IN_REVIEW is still accepted here so anything
 * submitted through the old path stays visible.)
 *
 * Every pending version is returned, not only the ones the caller can act on:
 * a version waiting on a role nobody holds, or with no chain configured, was
 * invisible to everyone and so could sit unnoticed indefinitely. `canAct` tells
 * the UI which ones this user may decide.
 */
export async function listPendingForRoles(userRoles: string[]): Promise<PendingApprovalRow[]> {
  const { data: pvs, error } = await supabase
    .from('bn_product_version')
    .select(`
      id, version_number, status, effective_from, effective_to, description,
      bn_product:product_id ( benefit_code, benefit_name, category )
    `)
    .in('status', ['PENDING_APPROVAL', 'IN_REVIEW'])
    .order('modified_at', { ascending: false })
    .limit(500);
  if (error) throw error;

  const result: PendingApprovalRow[] = [];
  for (const pv of pvs ?? []) {
    const chain = await getApprovalChain(pv.id);
    const next = chain.length === 0 ? null : await getNextPendingLevel(pv.id);
    const readiness: ApprovalReadiness =
      chain.length === 0 ? 'NO_CHAIN' : next ? 'AWAITING_LEVEL' : 'READY_TO_PUBLISH';
    const canAct = !!next?.approval_role && userRoles.includes(next.approval_role);
    result.push({ productVersion: pv, nextLevel: next, canAct, readiness });
  }
  return result;
}

/**
 * Whether every configured approval level has signed off, so the version may be
 * published.
 *
 * Derived from the approval history rather than from a status, because the
 * version lifecycle deliberately has no separate APPROVED state — it is
 * DRAFT → PENDING_APPROVAL → ACTIVE → ARCHIVED. Publish used to be gated on
 * status === 'APPROVED', which the lifecycle never reaches, so the button could
 * never become available.
 *
 * A version with no configured chain is NOT publishable here: nobody has
 * approved it, and treating "no rule" as "no objection" is how an unapproved
 * version reaches production.
 */
export async function isFullyApproved(productVersionId: string): Promise<boolean> {
  const chain = await getApprovalChain(productVersionId);
  if (chain.length === 0) return false;
  return (await getNextPendingLevel(productVersionId)) === null;
}
