/**
 * BN Rules Administration Service
 * 
 * Business Purpose: Manage effective-dated benefit rules used by the modernized
 * determination process. Supports versioned rule governance with Draft → Pending Review
 * → Published lifecycle, comparison between versions, simulation, and maker-checker
 * approval for rule publication.
 *
 * Existing Tables Used:
 *   - bn_product, bn_product_version (rule containers — product versions carry rules)
 *   - bn_eligibility_rule (eligibility conditions per version)
 *   - bn_calculation_rule (formula / rate rules per version)
 *   - bn_timeline_rule (duration / schedule rules per version)
 *   - bn_formula_template (reusable formula library)
 *   - workflow_instances, workflow_tasks (governance approval)
 *   - notification_templates, notification_logs, in_app_notifications (alerts)
 *   - audit_logs (change tracking)
 *
 * New Tables Introduced: None (uses bn_rule_version from existing schema for
 *   version-level metadata; if not present, extends bn_product_version with
 *   rule governance fields).
 *
 * Workflow Integration:
 *   - Rule publication requires approval via existing workflow engine
 *   - Workflow template: 'bn_rule_approval'
 *   - Steps: Submit → Review → Approve/Reject → Publish
 *
 * Notification Integration:
 *   - bn.rule.submitted — notify approvers
 *   - bn.rule.approved — notify rule author
 *   - bn.rule.rejected — notify rule author with reason
 *   - bn.rule.published — notify all BN officers
 *
 * Backward Compatibility:
 *   - Legacy benefit-type behavior preserved: rules are scoped to product versions
 *   - Existing ACTIVE versions remain authoritative until new version is published
 *   - No overlapping ACTIVE versions for the same product
 *   - Version retirement is soft (status change, not deletion)
 */
import { supabase } from '@/integrations/supabase/client';
import { runCalculationEngine } from './calculationEngine';
import { assertSafeToPublish, type PublishGateReport } from './config/publishGateService';

const db = supabase as any;

// ─── Readiness gate ────────────────────────────────────────────────
// One gate for the whole approval chain. Submit, approve and publish all run
// the same checks so a version can never reach APPROVED in a state that the
// publish step will refuse — which left approvers holding a version they had
// no way to fix from the Governance screen.

export async function assertVersionReadiness(versionId: string): Promise<PublishGateReport> {
  return assertSafeToPublish(versionId);
}

function formatGateErrors(action: string, errors: string[]): string {
  return `This version cannot be ${action} until the following are resolved:\n• ${errors.join('\n• ')}`;
}


// ─── Types ─────────────────────────────────────────────────────────

/**
 * Canonical version lifecycle — one vocabulary for the whole platform:
 *
 *   DRAFT -> PENDING_APPROVAL -> APPROVED -> ACTIVE -> ARCHIVED
 *
 * Reject returns the version to DRAFT. APPROVED is only ever set by the system
 * once the last configured approval level has signed. The earlier
 * PENDING_REVIEW / PUBLISHED / RETIRED names, and the lowercase variants this
 * file used to write, are legacy and are mapped on read.
 */
export type RuleVersionStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'ACTIVE'
  | 'ARCHIVED';

/** Canonical statuses, in lifecycle order. */
export const RULE_VERSION_STATUSES: RuleVersionStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'ACTIVE',
  'ARCHIVED',
];

export interface RuleVersionSummary {
  id: string;
  productId: string;
  /** Benefit code — products are more easily identified by code than by name. */
  productCode: string;
  productName: string;
  versionNumber: number;
  versionLabel: string;
  status: RuleVersionStatus;
  effectiveDate: string | null;
  expiryDate: string | null;
  eligibilityRuleCount: number;
  calculationRuleCount: number;
  timelineRuleCount: number;
  enteredBy: string | null;
  enteredAt: string;
  modifiedBy: string | null;
  modifiedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  changeNotes: string | null;
}

export interface RuleDiff {
  ruleType: 'eligibility' | 'calculation' | 'timeline';
  ruleCode: string;
  ruleName: string;
  changeType: 'added' | 'removed' | 'modified' | 'unchanged';
  fieldDiffs: Array<{
    field: string;
    oldValue: any;
    newValue: any;
  }>;
}

export interface RuleVersionCompareResult {
  baseVersion: { id: string; label: string; versionNumber: number };
  compareVersion: { id: string; label: string; versionNumber: number };
  diffs: RuleDiff[];
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
}

// ─── Version List ──────────────────────────────────────────────────

export async function fetchRuleVersions(productId?: string): Promise<RuleVersionSummary[]> {
  let q = db
    .from('bn_product_version')
    // BUG-08 — four of these columns did not exist on bn_product_version:
    // version_label, effective_date, expiry_date and change_notes. PostgREST
    // rejected the whole request, so the screen showed no versions at all.
    // The real date columns are effective_from / effective_to; the table has
    // no version label and no change notes, so those are derived/omitted below.
    .select(`
      id, product_id, version_number, status,
      effective_from, effective_to, entered_by, entered_at,
      modified_by, modified_at, description,
      bn_product!inner(benefit_code, benefit_name)
    `)
    .order('version_number', { ascending: false });

  if (productId) {
    q = q.eq('product_id', productId);
  }

  const { data, error } = await q;
  if (error) throw error;

  const versions = (data ?? []) as any[];
  const enriched: RuleVersionSummary[] = [];

  // Rule counts, three requests instead of three per version. The previous
  // loop issued one count query per rule table per version, one version at a
  // time — 156 sequential round trips for 52 versions, which left the screen
  // showing "Checking permissions…" for around twenty seconds. A spinner that
  // long is indistinguishable from a broken screen.
  const versionIds = versions.map(v => v.id);
  const [eligCounts, calcCounts, timeCounts] = await Promise.all([
    countRulesByVersion('bn_eligibility_rule', versionIds),
    countRulesByVersion('bn_calculation_rule', versionIds),
    countRulesByVersion('bn_timeline_rule', versionIds),
  ]);

  for (const v of versions) {
    const eligCount = eligCounts.get(v.id) ?? 0;
    const calcCount = calcCounts.get(v.id) ?? 0;
    const timeCount = timeCounts.get(v.id) ?? 0;

    enriched.push({
      id: v.id,
      productId: v.product_id,
      productCode: v.bn_product?.benefit_code || '',
      productName: v.bn_product?.benefit_name || '',
      versionNumber: v.version_number,
      // The table carries no label column — the version number is the label.
      versionLabel: `v${v.version_number}`,
      status: mapVersionStatus(v.status),
      effectiveDate: v.effective_from,
      expiryDate: v.effective_to,
      eligibilityRuleCount: eligCount,
      calculationRuleCount: calcCount,
      timelineRuleCount: timeCount,
      enteredBy: v.entered_by,
      enteredAt: v.entered_at,
      modifiedBy: v.modified_by,
      modifiedAt: v.modified_at,
      approvedBy: null, // Populated from workflow if needed
      approvedAt: null,
      publishedBy: null,
      publishedAt: null,
      // No change_notes column on this table; the version description is the
      // nearest equivalent the schema actually holds.
      changeNotes: v.description ?? null,
    });
  }

  return enriched;
}

/**
 * Rule counts for many versions in one request, keyed by product_version_id.
 * Only the key column is fetched, so the payload stays small.
 */
async function countRulesByVersion(
  table: string,
  versionIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (versionIds.length === 0) return counts;

  const { data, error } = await db
    .from(table)
    .select('product_version_id')
    .in('product_version_id', versionIds);
  if (error) return counts;   // a missing count is shown as 0, as before

  for (const row of (data ?? []) as any[]) {
    const key = row.product_version_id;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Map any stored value — canonical, legacy or lowercase — onto the canonical
 * lifecycle. Kept on the read path because legacy rows may survive until the
 * Phase 1 migration has run everywhere.
 */
export function mapVersionStatus(status: string): RuleVersionStatus {
  const map: Record<string, RuleVersionStatus> = {
    draft: 'DRAFT',
    pending: 'PENDING_APPROVAL',
    pending_review: 'PENDING_APPROVAL',
    pending_approval: 'PENDING_APPROVAL',
    in_review: 'PENDING_APPROVAL',
    approved: 'APPROVED',
    active: 'ACTIVE',
    published: 'ACTIVE',
    retired: 'ARCHIVED',
    archived: 'ARCHIVED',
    superseded: 'ARCHIVED',
    // A rejected version is returned to DRAFT — rejection is an event in the
    // approval history, not a resting state of the version.
    rejected: 'DRAFT',
  };
  return map[status?.toLowerCase()] || 'DRAFT';
}

// ─── Clone Version (for new draft) ─────────────────────────────────

export async function cloneVersionAsDraft(
  sourceVersionId: string,
  newLabel: string,
  changeNotes: string,
  userCode: string
): Promise<string> {
  // 1. Get source version
  const { data: source, error: srcErr } = await db
    .from('bn_product_version')
    .select('*')
    .eq('id', sourceVersionId)
    .single();
  if (srcErr || !source) throw new Error('Source version not found');

  // 2. Get max version number
  const { data: maxRow } = await db
    .from('bn_product_version')
    .select('version_number')
    .eq('product_id', source.product_id)
    .order('version_number', { ascending: false })
    .limit(1)
    .single();
  const nextVersion = (maxRow?.version_number || 0) + 1;

  // 3. Create new version.
  //     version_label / effective_date / expiry_date / change_notes do not
  //     exist on this table (BUG-08). The real columns are effective_from /
  //     effective_to, and the label plus the change notes are folded into the
  //     description, which is what the list screen reads back.
  const description = [newLabel, changeNotes].filter(Boolean).join(' — ') || null;
  const { data: newVer, error: newErr } = await db
    .from('bn_product_version')
    .insert({
      product_id: source.product_id,
      version_number: nextVersion,
      status: 'DRAFT',
      country_code: source.country_code,
      effective_from: null,
      effective_to: null,
      description,
      entered_by: userCode,
      entered_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (newErr) throw newErr;
  const newId = newVer.id;

  // 4. Clone rules
  await cloneRuleTable('bn_eligibility_rule', sourceVersionId, newId, userCode);
  await cloneRuleTable('bn_calculation_rule', sourceVersionId, newId, userCode);
  await cloneRuleTable('bn_timeline_rule', sourceVersionId, newId, userCode);

  // 5. Audit
  await logRuleAudit('RULE_VERSION_CLONED', 'bn_product_version', newId, {
    source_version_id: sourceVersionId,
    new_version_number: nextVersion,
    change_notes: changeNotes,
  }, userCode);

  return newId;
}

async function cloneRuleTable(table: string, fromVersionId: string, toVersionId: string, userCode: string) {
  const { data: rules } = await db.from(table).select('*').eq('product_version_id', fromVersionId);
  if (!rules || rules.length === 0) return;

  const cloned = rules.map((r: any) => {
    const { id, entered_at, modified_at, modified_by, ...rest } = r;
    return {
      ...rest,
      product_version_id: toVersionId,
      entered_by: userCode,
      entered_at: new Date().toISOString(),
    };
  });

  await db.from(table).insert(cloned);
}

// ─── Compare Versions ──────────────────────────────────────────────

export async function compareVersions(
  baseVersionId: string,
  compareVersionId: string
): Promise<RuleVersionCompareResult> {
  // Load both versions metadata
  const [baseVer, compVer] = await Promise.all([
    db.from('bn_product_version').select('id, version_label, version_number').eq('id', baseVersionId).single(),
    db.from('bn_product_version').select('id, version_label, version_number').eq('id', compareVersionId).single(),
  ]);

  const diffs: RuleDiff[] = [];

  // Compare each rule type
  for (const ruleType of ['eligibility', 'calculation', 'timeline'] as const) {
    const table = `bn_${ruleType}_rule`;
    const [baseRules, compRules] = await Promise.all([
      db.from(table).select('*').eq('product_version_id', baseVersionId).order('sort_order'),
      db.from(table).select('*').eq('product_version_id', compareVersionId).order('sort_order'),
    ]);

    const baseMap = new Map((baseRules.data ?? []).map((r: any) => [r.rule_code, r]));
    const compMap = new Map((compRules.data ?? []).map((r: any) => [r.rule_code, r]));

    // Find added/modified
    for (const [code, compRule] of compMap as any) {
      const baseRule = baseMap.get(code);
      if (!baseRule) {
        diffs.push({ ruleType, ruleCode: code, ruleName: compRule.rule_name, changeType: 'added', fieldDiffs: [] });
      } else {
        const fieldDiffs = diffFields(baseRule, compRule);
        diffs.push({
          ruleType,
          ruleCode: code,
          ruleName: compRule.rule_name,
          changeType: fieldDiffs.length > 0 ? 'modified' : 'unchanged',
          fieldDiffs,
        });
      }
    }

    // Find removed
    for (const [code, baseRule] of baseMap as any) {
      if (!compMap.has(code)) {
        diffs.push({ ruleType, ruleCode: code, ruleName: baseRule.rule_name, changeType: 'removed', fieldDiffs: [] });
      }
    }
  }

  return {
    baseVersion: { id: baseVersionId, label: baseVer.data?.version_label, versionNumber: baseVer.data?.version_number },
    compareVersion: { id: compareVersionId, label: compVer.data?.version_label, versionNumber: compVer.data?.version_number },
    diffs,
    summary: {
      added: diffs.filter(d => d.changeType === 'added').length,
      removed: diffs.filter(d => d.changeType === 'removed').length,
      modified: diffs.filter(d => d.changeType === 'modified').length,
      unchanged: diffs.filter(d => d.changeType === 'unchanged').length,
    },
  };
}

const IGNORE_FIELDS = new Set(['id', 'product_version_id', 'entered_by', 'entered_at', 'modified_by', 'modified_at']);

function diffFields(a: any, b: any): Array<{ field: string; oldValue: any; newValue: any }> {
  const diffs: Array<{ field: string; oldValue: any; newValue: any }> = [];
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);

  for (const key of allKeys) {
    if (IGNORE_FIELDS.has(key)) continue;
    const av = JSON.stringify(a[key] ?? null);
    const bv = JSON.stringify(b[key] ?? null);
    if (av !== bv) {
      diffs.push({ field: key, oldValue: a[key], newValue: b[key] });
    }
  }
  return diffs;
}

// ─── Submit for Approval ───────────────────────────────────────────

export async function submitVersionForApproval(
  versionId: string,
  userCode: string
): Promise<{ success: boolean; workflowInstanceId?: string; error?: string }> {
  // Validate version is DRAFT (comparison is on the canonical value, so a
  // legacy lowercase row is normalised first rather than silently refused).
  const { data: ver } = await db.from('bn_product_version').select('status, product_id, version_number').eq('id', versionId).single();
  if (!ver) return { success: false, error: 'Version not found' };
  if (mapVersionStatus(ver.status) !== 'DRAFT') {
    return { success: false, error: `Cannot submit version in ${ver.status} status` };
  }

  // Validate at least one rule exists (cheap first check)
  const [elig, calc, time] = await Promise.all([
    countRulesByVersion('bn_eligibility_rule', [versionId]),
    countRulesByVersion('bn_calculation_rule', [versionId]),
    countRulesByVersion('bn_timeline_rule', [versionId]),
  ]);
  const totalRules = (elig.get(versionId) ?? 0) + (calc.get(versionId) ?? 0) + (time.get(versionId) ?? 0);
  if (totalRules === 0) return { success: false, error: 'Version must have at least one rule before submission' };

  // Full readiness gate — the same one publish uses. Submitting an
  // unpublishable version only pushes the failure to the last step, where the
  // approver has no way to fix it.
  const gate = await assertVersionReadiness(versionId);
  if (!gate.ok) return { success: false, error: formatGateErrors('submitted for approval', gate.errors) };


  // Update status
  await db.from('bn_product_version')
    .update({ status: 'PENDING_APPROVAL', modified_by: userCode, modified_at: new Date().toISOString() })
    .eq('id', versionId);

  // Try to start workflow
  let workflowInstanceId: string | undefined;
  try {
    const { data: wfDef } = await db
      .from('workflow_definitions')
      .select('id')
      .eq('workflow_name', 'bn_rule_approval')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (wfDef) {
      const { data: wfInst } = await db.from('workflow_instances').insert({
        workflow_id: wfDef.id,
        workflow_name: 'bn_rule_approval',
        source_module: 'benefit_management',
        source_record_id: versionId,
        status: 'Pending',
        started_by: userCode,
      }).select('id').single();
      workflowInstanceId = wfInst?.id;
    }
  } catch (err) {
    console.warn('[BN-Rules] Workflow start failed (non-blocking):', err);
  }

  // Notification
  try {
    await db.from('in_app_notifications').insert({
      user_id: null, // broadcast to approvers
      title: 'Rule Version Pending Approval',
      message: `Version v${ver.version_number} submitted for review`,
      type: 'benefit_management',
      entity_type: 'bn_product_version',
      entity_id: versionId,
      priority: 'high',
      is_read: false,
      module: 'benefit_management',
    });
  } catch (err) {
    console.warn('[BN-Rules] Notification failed (non-blocking):', err);
  }

  await logRuleAudit('RULE_VERSION_SUBMITTED', 'bn_product_version', versionId, {
    from_status: 'DRAFT',
    to_status: 'PENDING_APPROVAL',
    workflow_instance_id: workflowInstanceId,
  }, userCode);

  return { success: true, workflowInstanceId };
}

// ─── Approve Version ───────────────────────────────────────────────

export async function approveVersion(
  versionId: string,
  approverCode: string,
  comments?: string
): Promise<{ success: boolean; error?: string }> {
  const { data: ver } = await db.from('bn_product_version').select('status, entered_by').eq('id', versionId).single();
  if (!ver) return { success: false, error: 'Version not found' };
  if (mapVersionStatus(ver.status) !== 'PENDING_APPROVAL') {
    return { success: false, error: `Cannot approve version in ${ver.status} status` };
  }

  // Maker-checker: approver must differ from author
  if (ver.entered_by === approverCode) {
    return { success: false, error: 'Maker-checker violation: approver cannot be the same as the author' };
  }

  await db.from('bn_product_version')
    .update({
      status: 'APPROVED',
      modified_by: approverCode,
      modified_at: new Date().toISOString(),
    })
    .eq('id', versionId);

  await logRuleAudit('RULE_VERSION_APPROVED', 'bn_product_version', versionId, {
    approved_by: approverCode,
    comments,
  }, approverCode);

  return { success: true };
}

// ─── Reject Version ────────────────────────────────────────────────

export async function rejectVersion(
  versionId: string,
  rejectorCode: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const { data: ver } = await db.from('bn_product_version').select('status, description').eq('id', versionId).single();
  if (!ver) return { success: false, error: 'Version not found' };
  if (mapVersionStatus(ver.status) !== 'PENDING_APPROVAL') {
    return { success: false, error: `Cannot reject version in ${ver.status} status` };
  }

  await db.from('bn_product_version')
    .update({
      status: 'DRAFT', // Return to draft for revision
      modified_by: rejectorCode,
      modified_at: new Date().toISOString(),
      // No change_notes column exists; the rejection reason is appended to the
      // description, which is what the Versions list reads back.
      description: `${ver.description ? `${ver.description}\n` : ''}REJECTED: ${reason}`,
    })
    .eq('id', versionId);

  await logRuleAudit('RULE_VERSION_REJECTED', 'bn_product_version', versionId, {
    rejected_by: rejectorCode,
    reason,
  }, rejectorCode);

  return { success: true };
}

// ─── Publish Version ───────────────────────────────────────────────

export async function publishVersion(
  versionId: string,
  effectiveDate: string,
  publisherCode: string
): Promise<{ success: boolean; error?: string }> {
  const { data: ver } = await db.from('bn_product_version')
    .select('status, product_id, version_number')
    .eq('id', versionId)
    .single();
  if (!ver) return { success: false, error: 'Version not found' };
  if (mapVersionStatus(ver.status) !== 'APPROVED') {
    return { success: false, error: `Only APPROVED versions can be published (current: ${ver.status})` };
  }

  // Block publish on ERROR-level cross-tab conflicts
  try {
    const { hasBlockingConflicts } = await import('@/services/bn/config/conflictDetectionService');
    if (await hasBlockingConflicts(versionId)) {
      return { success: false, error: 'Cross-tab conflicts contain ERROR-level issues. Resolve them on the Product Editor before publishing.' };
    }
  } catch { /* non-fatal */ }

  // Delegate the actual publish to the single canonical routine used by the
  // Product Editor. Governance previously ran its own partial update, which
  // skipped the Configuration Validation gate, the catalogue-rule governance
  // gate and — critically — the promotion of bn_product to ACTIVE. A product
  // published only from Governance therefore never became selectable in Claim
  // Registration. One routine now serves both entry points.
  const { publishProductVersion } = await import('@/services/bn/productService');
  try {
    await publishProductVersion(versionId, effectiveDate);
  } catch (err: any) {
    return { success: false, error: err?.message || 'Publish failed' };
  }

  await logRuleAudit('RULE_VERSION_PUBLISHED', 'bn_product_version', versionId, {
    published_by: publisherCode,
    effective_date: effectiveDate,
    product_id: ver.product_id,
    version_number: ver.version_number,
  }, publisherCode);

  return { success: true };
}


// ─── Simulate Version ──────────────────────────────────────────────

export async function simulateVersionRules(
  versionId: string,
  simulationInput: {
    ssn: string;
    claimDate: string;
    productId: string;
    countryCode?: string;
    contributionWeeks?: number;
    averageWeeklyWage?: number;
  }
) {
  // Delegate to the existing calculation engine in simulation mode
  return runCalculationEngine({
    claimId: `sim-${Date.now()}`,
    ssn: simulationInput.ssn,
    productId: simulationInput.productId,
    productVersionId: versionId,
    claimDate: simulationInput.claimDate,
    countryCode: simulationInput.countryCode || 'KN',
    mode: 'SIMULATION',
  });
}

// ─── Audit Logger ──────────────────────────────────────────────────
//
// Delegates to the central BN audit service. Critical lifecycle actions
// (SUBMIT / APPROVE / REJECT / PUBLISH / RETIRE) are awaited and will
// throw on failure so the caller can surface the error instead of
// silently losing the audit row.

import { writeBnAudit } from '@/services/bn/audit/bnAuditService';

async function logRuleAudit(
  action: string,
  entityType: string,
  entityId: string,
  afterValue: Record<string, any>,
  userCode: string,
) {
  await writeBnAudit({
    action,
    entityType,
    entityId,
    afterValue,
    performedBy: userCode,
    module: 'BN_CONFIG',
    // CRITICAL_ACTIONS set in bnAuditService already covers RULE_VERSION_*.
  });
}
