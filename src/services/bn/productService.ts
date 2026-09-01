import { supabase } from '@/integrations/supabase/client';
import type { BnProduct, BnProductVersion, BnEligibilityRule, BnCalculationRule, BnTimelineRule } from '@/types/bn';
import { assertVersionMutable } from './config/configImpactService';
import { auditConfigChange } from './audit/bnAuditService';
import { getCurrentUserCode } from './audit/getCurrentUserCode';
import { assertSafeToPublish } from './config/publishGateService';
import { findUngovernedAttachedRules, activateAttachedRules } from './governance/ruleGovernanceService';
import { registerProductRuleInCatalogue, type RegisterResult } from './governance/registerRuleInCatalogue';
import { resolveRuleFieldKey, isInformationalRule } from './eligibility/ruleFieldMapping';
import {
  resolveEffectiveRuleShape,
  collectCatalogueRuleIds,
  type CatalogueShapeSource,
  type ProductRuleShapeSource,
} from '@/lib/bn/effectiveRuleShape';

const db = supabase as any;

async function actor(): Promise<string> {
  return (await getCurrentUserCode()) ?? 'system';
}

// ---- Product CRUD ----

export async function fetchProducts(): Promise<BnProduct[]> {
  // Embed the live branch name via branch_id — the flat `branch` text column
  // is a denormalized legacy copy (kept in sync on save) and can drift if a
  // branch is renamed later; prefer this join wherever the name is displayed.
  const { data, error } = await db.from('bn_product').select('*, bn_branch:branch_id(branch_name)').order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as BnProduct[];
}

export async function fetchProductById(id: string): Promise<BnProduct | null> {
  const { data, error } = await db.from('bn_product').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as BnProduct | null;
}

export async function createProduct(product: Partial<BnProduct>): Promise<BnProduct> {
  const { data, error } = await db.from('bn_product').insert(product).select().single();
  if (error) throw error;
  await auditConfigChange({
    action: 'CREATE', entityType: 'bn_product', entityId: data.id,
    afterValue: data, performedBy: await actor(), critical: true,
  });
  return data as BnProduct;
}

export async function updateProduct(id: string, updates: Partial<BnProduct>): Promise<BnProduct> {
  const before = await fetchProductById(id);
  const { data, error } = await db.from('bn_product').update({ ...updates, modified_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error) throw error;
  await auditConfigChange({
    action: 'UPDATE', entityType: 'bn_product', entityId: id,
    beforeValue: before, afterValue: data, performedBy: await actor(),
  });
  return data as BnProduct;
}

// ---- Product Version CRUD ----

export async function fetchVersionsByProduct(productId: string): Promise<BnProductVersion[]> {
  const { data, error } = await db.from('bn_product_version').select('*').eq('product_id', productId).order('version_number', { ascending: false });
  if (error) throw error;
  return (data ?? []) as BnProductVersion[];
}

export async function fetchVersionById(id: string): Promise<BnProductVersion | null> {
  const { data, error } = await db.from('bn_product_version').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as BnProductVersion | null;
}

export async function createProductVersion(version: Partial<BnProductVersion>): Promise<BnProductVersion> {
  // Validate no overlapping active versions for same product (skip for DRAFT — overlap is only enforced at publish time)
  if (version.product_id && version.effective_from && version.status && version.status !== 'DRAFT') {
    const existing = await fetchVersionsByProduct(version.product_id);
    const overlap = existing.find(v =>
      v.status === 'ACTIVE' &&
      v.effective_from &&
      (!v.effective_to || v.effective_to >= version.effective_from!) &&
      (!version.effective_to || version.effective_to! >= v.effective_from)
    );
    if (overlap) {
      throw new Error(`Effective date range overlaps with Version ${overlap.version_number} (${overlap.effective_from} to ${overlap.effective_to || 'open'})`);
    }
  }
  const { data, error } = await db.from('bn_product_version').insert(version).select().single();
  if (error) throw error;
  await auditConfigChange({
    action: 'CREATE_VERSION', entityType: 'bn_product_version', entityId: data.id,
    afterValue: data, performedBy: await actor(), critical: true,
  });
  return data as BnProductVersion;
}

export async function updateProductVersion(id: string, updates: Partial<BnProductVersion>): Promise<BnProductVersion> {
  // Guard: ACTIVE versions are read-only EXCEPT for lifecycle changes (status, effective_to) done via publish/retire helpers.
  const current = await fetchVersionById(id);
  if (current?.status === 'ACTIVE') {
    const allowed = new Set(['status', 'effective_to', 'modified_at', 'modified_by']);
    const mutating = Object.keys(updates).filter(k => !allowed.has(k));
    if (mutating.length > 0) {
      throw new Error(
        `Version ${current.version_number} is ACTIVE and locked. Create a new DRAFT version to change: ${mutating.join(', ')}.`,
      );
    }
  }
  const { data, error } = await db.from('bn_product_version').update({ ...updates, modified_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error) throw error;
  await auditConfigChange({
    action: 'UPDATE_VERSION', entityType: 'bn_product_version', entityId: id,
    beforeValue: current, afterValue: data, performedBy: await actor(),
  });
  return data as BnProductVersion;
}

/**
 * Copy full configuration from a source version into a target (DRAFT) version.
 * Copies: eligibility, calculation, timeline rules, document requirements,
 * workflow & screen template assignments, channel configs, version-level
 * processing flags, and version-specific override policies.
 */
export async function copyVersionRules(
  sourceVersionId: string,
  targetVersionId: string,
): Promise<{
  eligibility: number;
  calculation: number;
  timeline: number;
  documents: number;
  workflow: number;
  screen_template: number;
  channels: number;
  overrides: number;
}> {
  const counts = {
    eligibility: 0, calculation: 0, timeline: 0, documents: 0,
    workflow: 0, screen_template: 0, channels: 0, overrides: 0,
  };

  const clearResults = await Promise.all([
    db.from('bn_eligibility_rule').delete().eq('product_version_id', targetVersionId),
    db.from('bn_calculation_rule').delete().eq('product_version_id', targetVersionId),
    db.from('bn_timeline_rule').delete().eq('product_version_id', targetVersionId),
    db.from('bn_approval_policy').delete().eq('product_version_id', targetVersionId),
  ]);
  const clearError = clearResults.find((r: any) => r.error)?.error;
  if (clearError) throw clearError;

  // Eligibility
  const eligRules = await fetchEligibilityRules(sourceVersionId);
  for (const rule of eligRules) {
    const { id, product_version_id, entered_at, modified_at, ...rest } = rule as any;
    // A clone keeps the source's catalogue links; it must not create catalogue
    // entries in bulk as a side effect of copying a version.
    await upsertEligibilityRule(
      { ...rest, product_version_id: targetVersionId },
      { registerInCatalogue: false },
    );
    counts.eligibility++;
  }

  // Calculation
  const calcRules = await fetchCalculationRules(sourceVersionId);
  for (const rule of calcRules) {
    const { id, product_version_id, entered_at, modified_at, ...rest } = rule as any;
    await upsertCalculationRule({ ...rest, product_version_id: targetVersionId });
    counts.calculation++;
  }

  // Timeline
  const timeRules = await fetchTimelineRules(sourceVersionId);
  for (const rule of timeRules) {
    const { id, product_version_id, entered_at, modified_at, ...rest } = rule as any;
    await upsertTimelineRule({ ...rest, product_version_id: targetVersionId });
    counts.timeline++;
  }

  // Documents
  const { copyDocumentRequirements } = await import('./configService');
  counts.documents = await copyDocumentRequirements(sourceVersionId, targetVersionId);

  // Version-level assignments and processing flags
  const { data: src } = await db.from('bn_product_version').select('*').eq('id', sourceVersionId).maybeSingle();
  if (src) {
    const updates: Record<string, unknown> = {
      workflow_template_id: src.workflow_template_id ?? null,
      screen_template_id: src.screen_template_id ?? null,
      requires_employer_verification: src.requires_employer_verification ?? false,
      requires_medical_board_review: src.requires_medical_board_review ?? false,
      requires_means_test: src.requires_means_test ?? false,
    };
    // copy any version-level JSON config fields if present
    for (const k of ['configuration', 'settings_json', 'metadata']) {
      if (src[k] !== undefined) updates[k] = src[k];
    }
    await db.from('bn_product_version').update(updates).eq('id', targetVersionId);
    if (src.workflow_template_id) counts.workflow = 1;
    if (src.screen_template_id) counts.screen_template = 1;
  }

  // Channels
  const { data: srcChannels } = await db
    .from('bn_product_channel_config')
    .select('*')
    .eq('product_version_id', sourceVersionId);
  if (srcChannels && srcChannels.length > 0) {
    const rows = srcChannels.map((r: any) => {
      const { id, entered_at, modified_at, entered_by, modified_by, ...rest } = r;
      return { ...rest, product_version_id: targetVersionId };
    });
    const { error } = await db
      .from('bn_product_channel_config')
      .upsert(rows, { onConflict: 'product_version_id,channel_code' });
    if (!error) counts.channels = rows.length;
  }

  // Approval / override policies (runtime source)
  const { data: srcPolicies } = await db
    .from('bn_approval_policy')
    .select('*')
    .eq('product_version_id', sourceVersionId);
  if (srcPolicies && srcPolicies.length > 0) {
    const performedBy = await actor();
    const rows = srcPolicies.map((r: any) => {
      const { id, created_at, updated_at, created_by, updated_by, ...rest } = r;
      return { ...rest, product_version_id: targetVersionId, created_by: performedBy, updated_by: performedBy };
    });
    const { error } = await db.from('bn_approval_policy').insert(rows);
    if (!error) counts.overrides = rows.length;
  }

  return counts;
}

/**
 * Clone a non-DRAFT product version into a brand-new DRAFT version with the
 * next version number and the full configuration copied across. Returns the
 * id of the newly created draft. Used by the UI's "Create Draft from Active"
 * flow so users never directly edit a live version.
 */
export async function cloneToNewDraft(
  productId: string,
  sourceVersionId: string,
  effectiveFrom?: string,
): Promise<{ newVersionId: string; versionNumber: number; counts: Awaited<ReturnType<typeof copyVersionRules>> }> {
  const versions = await fetchVersionsByProduct(productId);
  const nextNum = versions.length > 0 ? Math.max(...versions.map(v => v.version_number)) + 1 : 1;
  const source = versions.find(v => v.id === sourceVersionId);
  if (!source) throw new Error('Source version not found.');

  const draft = await createProductVersion({
    product_id: productId,
    version_number: nextNum,
    status: 'DRAFT',
    effective_from: effectiveFrom ?? new Date().toISOString().slice(0, 10),
    description: `Draft cloned from V${source.version_number} (${source.status})`,
  });

  const counts = await copyVersionRules(sourceVersionId, draft.id);

  await auditConfigChange({
    action: 'CLONE_TO_DRAFT',
    entityType: 'bn_product_version',
    entityId: draft.id,
    beforeValue: { source_version_id: sourceVersionId, source_version: source.version_number, source_status: source.status },
    afterValue: { new_version_id: draft.id, new_version_number: nextNum, copied: counts },
    performedBy: await actor(),
    critical: true,
  });

  return { newVersionId: draft.id, versionNumber: nextNum, counts };
}

/**
 * Lightweight audit record for "user attempted to edit/delete an ACTIVE
 * version" interactions, even when the UI intercepts and blocks them.
 */
export async function auditAttemptedActiveMutation(
  versionId: string,
  intent: 'EDIT' | 'DELETE',
  note?: string,
): Promise<void> {
  await auditConfigChange({
    action: intent === 'EDIT' ? 'ATTEMPT_EDIT_ACTIVE' : 'ATTEMPT_DELETE_ACTIVE',
    entityType: 'bn_product_version',
    entityId: versionId,
    afterValue: { note: note ?? null },
    performedBy: await actor(),
  });
}

/**
 * Publish a DRAFT/APPROVED version as ACTIVE with effective_from date.
 * Auto-closes any currently ACTIVE version for the same product by setting
 * its effective_to = newEffectiveFrom - 1 day when no end date is set.
 * Throws if overlap cannot be resolved.
 */
/**
 * BUG-31 — active rules on a version whose field cannot be resolved from any
 * registry. Informational rules are exempt: they are declared advisory on
 * purpose and never gate a claim.
 */
export async function findUnmappedEligibilityRules(
  versionId: string,
): Promise<{ rule_code: string; rule_name: string; rawKey: string | null }[]> {
  const { data, error } = await db
    .from('bn_eligibility_rule')
    .select('rule_code, rule_name, fact_key, fail_action, rule_definition')
    .eq('product_version_id', versionId)
    .eq('is_active', true);
  if (error) throw error;

  const out: { rule_code: string; rule_name: string; rawKey: string | null }[] = [];
  for (const rule of (data ?? []) as any[]) {
    if (isInformationalRule(rule)) continue;
    const { key, rawKey } = resolveRuleFieldKey(rule);
    if (!key) out.push({ rule_code: rule.rule_code, rule_name: rule.rule_name, rawKey });
  }
  return out;
}

export async function publishProductVersion(
  versionId: string,
  newEffectiveFrom: string,
): Promise<void> {
  const version = await fetchVersionById(versionId);
  if (!version) throw new Error('Version not found');

  // ─── FINAL GATE: Configuration Validation must pass ─────────────
  // Composes conflict detection + channel readiness + baseline validation.
  const gate = await assertSafeToPublish(versionId);
  if (!gate.ok) {
    throw new Error(
      `Publish blocked by Configuration Validation:\n• ${gate.errors.join('\n• ')}`,
    );
  }

  // ─── GOVERNANCE GATE: every attached catalogue rule must be at
  // LEGAL_CONFIRMED, READY_FOR_PRODUCT_USE, or ACTIVE.
  const ungoverned = await findUngovernedAttachedRules(versionId);
  if (ungoverned.length > 0) {
    // BUG-13 — report the two cases separately. A rule that was never entered
    // in the Rule Catalogue needs registering and approving; a rule already in
    // the catalogue only needs advancing. One combined message sent the user to
    // the wrong screen for half the rules listed.
    const names = (rs: typeof ungoverned) => {
      const shown = rs.slice(0, 5).map(r => r.rule_code).join(', ');
      return rs.length > 5 ? `${shown} (+${rs.length - 5} more)` : shown;
    };
    const unregistered = ungoverned.filter(r => r.reason === 'NOT_REGISTERED');
    const notApproved = ungoverned.filter(r => r.reason === 'NOT_APPROVED');

    const parts: string[] = [];
    if (unregistered.length > 0) {
      parts.push(
        `${unregistered.length} rule(s) are not registered in the Rule Catalogue and have never been approved — ${names(unregistered)}. ` +
        `Add each one to the Rule Catalogue, then take it through Rule Governance to Legal Confirmed or Ready.`,
      );
    }
    if (notApproved.length > 0) {
      parts.push(
        `${notApproved.length} rule(s) are in the Rule Catalogue but have not completed Rule Governance — ${names(notApproved)}. ` +
        `Open Rule Catalogue → Governance and advance them to Legal Confirmed or Ready.`,
      );
    }
    throw new Error(`Publish blocked:\n• ${parts.join('\n• ')}`);
  }

  // ─── MAPPING GATE (BUG-31): every rule must be evaluable ───────────
  // An unmapped rule cannot be compared against a claimant. Since BUG-29 made
  // an unevaluable rule blocking rather than silently passing, publishing one
  // means the product rejects every claimant. Catch it here instead.
  const unmappedRules = await findUnmappedEligibilityRules(versionId);
  if (unmappedRules.length > 0) {
    const shown = unmappedRules.slice(0, 8)
      .map(r => `${r.rule_code} (${r.rawKey ? `unknown field "${r.rawKey}"` : 'no field mapping'})`)
      .join('; ');
    throw new Error(
      `Publish blocked: ${unmappedRules.length} eligibility rule(s) cannot be evaluated, ` +
      `so this product would reject every claimant — ${shown}` +
      `${unmappedRules.length > 8 ? ` (+${unmappedRules.length - 8} more)` : ''}. ` +
      `Map each rule to a field in the eligibility field or fact registry, or mark it ` +
      `informational (fail_action = INFO) if it is genuinely advisory.`,
    );
  }

  const existingActive = (await fetchVersionsByProduct(version.product_id))
    .filter(v => v.status === 'ACTIVE' && v.id !== versionId);

  for (const ex of existingActive) {
    if (!ex.effective_from) continue;
    if (ex.effective_from >= newEffectiveFrom) {
      throw new Error(
        `Cannot publish: existing ACTIVE Version ${ex.version_number} starts on ${ex.effective_from}, ` +
        `which is on/after the new effective date ${newEffectiveFrom}.`,
      );
    }
    if (!ex.effective_to) {
      const dayBefore = new Date(newEffectiveFrom);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const closeDate = dayBefore.toISOString().slice(0, 10);
      await db.from('bn_product_version').update({
        effective_to: closeDate,
        modified_at: new Date().toISOString(),
      }).eq('id', ex.id);
      await auditConfigChange({
        action: 'RETIRE', entityType: 'bn_product_version', entityId: ex.id,
        afterValue: { effective_to: closeDate, superseded_by: versionId },
        performedBy: await actor(), critical: true,
      });
    } else if (ex.effective_to >= newEffectiveFrom) {
      throw new Error(
        `Cannot publish: ACTIVE Version ${ex.version_number} ends on ${ex.effective_to}, ` +
        `which overlaps the new effective date ${newEffectiveFrom}. Adjust the prior version first.`,
      );
    }
  }

  await db.from('bn_product_version').update({
    status: 'ACTIVE',
    effective_from: newEffectiveFrom,
    modified_at: new Date().toISOString(),
  }).eq('id', versionId);

  await auditConfigChange({
    action: 'PUBLISH', entityType: 'bn_product_version', entityId: versionId,
    beforeValue: { status: version.status },
    afterValue: { status: 'ACTIVE', effective_from: newEffectiveFrom, gate: gate.details },
    performedBy: await actor(), critical: true,
  });

  // Promote the product itself once it has a live version. Nothing wrote
  // bn_product.status before, so a product running on an ACTIVE version still
  // read DRAFT in the Product Catalogue — indefinitely, and misleadingly.
  // Only DRAFT and PENDING_APPROVAL are promoted: a SUSPENDED or ARCHIVED
  // product is in that state deliberately and publishing a version must not
  // quietly bring it back into service.
  const { data: productRow } = await db
    .from('bn_product')
    .select('status')
    .eq('id', version.product_id)
    .maybeSingle();
  const productStatus = String(productRow?.status ?? '').toUpperCase();
  if (productStatus === 'DRAFT' || productStatus === 'PENDING_APPROVAL') {
    await db.from('bn_product')
      .update({ status: 'ACTIVE', modified_at: new Date().toISOString() })
      .eq('id', version.product_id);
    await auditConfigChange({
      action: 'UPDATE', entityType: 'bn_product', entityId: version.product_id,
      beforeValue: { status: productStatus },
      afterValue: { status: 'ACTIVE', reason: `version ${version.version_number} published` },
      performedBy: await actor(), critical: true,
    });
  }

  // ─── POST-PUBLISH: promote READY_FOR_PRODUCT_USE attached rules to ACTIVE.
  try {
    await activateAttachedRules(versionId, await actor());
  } catch (e) {
    // Non-fatal: publish succeeded; governance promotion failure is logged.
    console.warn('[publishProductVersion] activateAttachedRules failed', e);
  }
}

/**
 * Retire an ACTIVE version. Requires either a replacement ACTIVE version to
 * exist or effective_to already set on the version being retired.
 */
export async function retireProductVersion(versionId: string): Promise<void> {
  const version = await fetchVersionById(versionId);
  if (!version) throw new Error('Version not found');
  if (version.status !== 'ACTIVE') throw new Error('Only ACTIVE versions can be retired');

  const others = (await fetchVersionsByProduct(version.product_id))
    .filter(v => v.id !== versionId);
  const replacement = others.find(v => v.status === 'ACTIVE');

  if (!replacement && !version.effective_to) {
    throw new Error('Cannot retire: set an effective_to date or publish a replacement ACTIVE version first.');
  }

  await db.from('bn_product_version').update({
    status: 'ARCHIVED',
    modified_at: new Date().toISOString(),
  }).eq('id', versionId);

  await auditConfigChange({
    action: 'RETIRE', entityType: 'bn_product_version', entityId: versionId,
    beforeValue: { status: 'ACTIVE' },
    afterValue: { status: 'ARCHIVED', replacement_id: replacement?.id ?? null },
    performedBy: await actor(), critical: true,
  });
}

// ---- Eligibility Rules ----

export async function fetchEligibilityRules(versionId: string): Promise<BnEligibilityRule[]> {
  const { data, error } = await db.from('bn_eligibility_rule').select('*').eq('product_version_id', versionId).order('sort_order');
  if (error) throw error;
  return (data ?? []) as BnEligibilityRule[];
}

/**
 * As `fetchEligibilityRules`, but with each rule's structural fields
 * (rule_kind/fact_key/start_fact_key/etc.) resolved live from its linked
 * catalogue rule where the catalogue carries one (GAP-039) — for evaluating
 * or checking rules, never for editing/cloning them. `upsertEligibilityRule`
 * and the version-clone path must keep reading/writing the product row's own
 * raw columns, or a clone would silently bake the catalogue's current values
 * into the new row and a save could overwrite a legitimate stored value with
 * a merely-displayed one.
 */
export async function fetchEligibilityRulesEffective(versionId: string): Promise<BnEligibilityRule[]> {
  const rules = await fetchEligibilityRules(versionId);
  const catalogueIds = collectCatalogueRuleIds(rules as unknown as ProductRuleShapeSource[]);
  if (catalogueIds.length === 0) return rules;
  const { data: catalogueRows, error } = await db.from('bn_rule_catalogue').select('*').in('id', catalogueIds);
  if (error) throw error;
  const catalogueById = new Map<string, CatalogueShapeSource>((catalogueRows ?? []).map((c: CatalogueShapeSource) => [c.id, c]));
  return rules.map((rule) => ({ ...rule, ...resolveEffectiveRuleShape(rule as unknown as ProductRuleShapeSource, catalogueById) })) as BnEligibilityRule[];
}

export interface UpsertEligibilityRuleOptions {
  /**
   * Register the rule in the Rule Catalogue when it is not linked to one yet,
   * and link it (GAP-01 / BUG-13). On by default: a rule created on a product
   * with no catalogue entry can never be approved or published.
   *
   * Cloning a version passes false — the copied rules keep whatever catalogue
   * link the source had, and a clone should not quietly create catalogue
   * entries in bulk.
   */
  registerInCatalogue?: boolean;
}

export async function upsertEligibilityRule(
  rule: Partial<BnEligibilityRule>,
  options: UpsertEligibilityRuleOptions = {},
): Promise<BnEligibilityRule> {
  if (rule.product_version_id) await assertVersionMutable(rule.product_version_id);

  const performedBy = await actor();

  // The row itself was never stamped with who made it, so rules created on a
  // product showed "created by NULL" while the audit trail recorded the actor.
  let payload: Partial<BnEligibilityRule> = rule.id
    ? rule
    : ({ entered_by: performedBy, ...rule } as Partial<BnEligibilityRule>);
  let registration: RegisterResult | null = null;

  // Register before saving the rule, so a refusal (a code already taken by a
  // different catalogue entry) stops the whole operation rather than leaving
  // another unregistered rule behind.
  const shouldRegister =
    options.registerInCatalogue !== false && !(rule as any).catalogue_rule_id;
  if (shouldRegister) {
    registration = await registerProductRuleInCatalogue(rule, performedBy ?? null);
    payload = {
      ...payload,
      catalogue_rule_id: registration.catalogueRuleId,
      catalogue_rule_code: registration.catalogueRuleCode,
    } as Partial<BnEligibilityRule>;
  }

  const { data, error } = await db.from('bn_eligibility_rule').upsert(payload).select().single();
  if (error) throw error;
  await auditConfigChange({
    action: rule.id ? 'UPDATE' : 'CREATE', entityType: 'bn_eligibility_rule', entityId: data.id,
    afterValue: data, performedBy,
  });

  if (registration) {
    await auditConfigChange({
      action: registration.outcome === 'CREATED' ? 'CREATE' : 'UPDATE',
      entityType: 'bn_rule_catalogue',
      entityId: registration.catalogueRuleId,
      afterValue: {
        rule_code: registration.catalogueRuleCode,
        registered_from_product_rule: data.id,
        outcome: registration.outcome,
      },
      performedBy,
    });
  }

  return data as BnEligibilityRule;
}

export async function deleteEligibilityRule(id: string): Promise<void> {
  const { data: existing } = await db.from('bn_eligibility_rule').select('*').eq('id', id).maybeSingle();
  if (existing?.product_version_id) await assertVersionMutable(existing.product_version_id);
  const { error } = await db.from('bn_eligibility_rule').delete().eq('id', id);
  if (error) throw error;
  await auditConfigChange({
    action: 'DELETE', entityType: 'bn_eligibility_rule', entityId: id,
    beforeValue: existing, performedBy: await actor(), critical: true,
  });
}

// ---- Calculation Rules ----

export async function fetchCalculationRules(versionId: string): Promise<BnCalculationRule[]> {
  const { data, error } = await db.from('bn_calculation_rule').select('*').eq('product_version_id', versionId).order('sort_order');
  if (error) throw error;
  return (data ?? []) as BnCalculationRule[];
}

export async function upsertCalculationRule(rule: Partial<BnCalculationRule>): Promise<BnCalculationRule> {
  if (rule.product_version_id) await assertVersionMutable(rule.product_version_id);
  const { data, error } = await db.from('bn_calculation_rule').upsert(rule).select().single();
  if (error) throw error;
  await auditConfigChange({
    action: rule.id ? 'UPDATE' : 'CREATE', entityType: 'bn_calculation_rule', entityId: data.id,
    afterValue: data, performedBy: await actor(),
  });
  return data as BnCalculationRule;
}

export async function deleteCalculationRule(id: string): Promise<void> {
  const { data: existing } = await db.from('bn_calculation_rule').select('*').eq('id', id).maybeSingle();
  if (existing?.product_version_id) await assertVersionMutable(existing.product_version_id);
  const { error } = await db.from('bn_calculation_rule').delete().eq('id', id);
  if (error) throw error;
  await auditConfigChange({
    action: 'DELETE', entityType: 'bn_calculation_rule', entityId: id,
    beforeValue: existing, performedBy: await actor(), critical: true,
  });
}

// ---- Timeline Rules ----

export async function fetchTimelineRules(versionId: string): Promise<BnTimelineRule[]> {
  const { data, error } = await db.from('bn_timeline_rule').select('*').eq('product_version_id', versionId).order('sort_order');
  if (error) throw error;
  return (data ?? []) as BnTimelineRule[];
}

export async function upsertTimelineRule(rule: Partial<BnTimelineRule>): Promise<BnTimelineRule> {
  if (rule.product_version_id) await assertVersionMutable(rule.product_version_id);
  const { data, error } = await db.from('bn_timeline_rule').upsert(rule).select().single();
  if (error) throw error;
  await auditConfigChange({
    action: rule.id ? 'UPDATE' : 'CREATE', entityType: 'bn_timeline_rule', entityId: data.id,
    afterValue: data, performedBy: await actor(),
  });
  return data as BnTimelineRule;
}

export async function deleteTimelineRule(id: string): Promise<void> {
  const { data: existing } = await db.from('bn_timeline_rule').select('*').eq('id', id).maybeSingle();
  if (existing?.product_version_id) await assertVersionMutable(existing.product_version_id);
  const { error } = await db.from('bn_timeline_rule').delete().eq('id', id);
  if (error) throw error;
  await auditConfigChange({
    action: 'DELETE', entityType: 'bn_timeline_rule', entityId: id,
    beforeValue: existing, performedBy: await actor(), critical: true,
  });
}
