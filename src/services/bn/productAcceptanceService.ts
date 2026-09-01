import { supabase } from '@/integrations/supabase/client';
import type { BnChannelCode, BnDocumentRule, BnProductChannelConfig } from '@/types/bn';
import { fetchEligibilityRulesEffective, fetchCalculationRules, fetchTimelineRules } from './productService';
import { getChannelConfig } from './productChannelConfigService';

const db = supabase as any;

export interface ApplicationConfig {
  product: any;
  version: any;
  channelConfig: BnProductChannelConfig | null;
  eligibility: any[];
  calculation: any[];
  timelines: any[];
  documents: BnDocumentRule[];
  screenTemplateId: string | null;
  workflowTemplateId: string | null;
  workflowDefinitionId: string | null;
}

/**
 * Resolve the active product version for a product at a given claim date.
 */
async function resolveActiveVersion(productId: string, claimDate: string) {
  const { data, error } = await db
    .from('bn_product_version')
    .select('*')
    .eq('product_id', productId)
    .eq('status', 'ACTIVE')
    .lte('effective_from', claimDate)
    .order('effective_from', { ascending: false });
  if (error) throw error;
  const candidates = (data ?? []) as any[];
  return candidates.find(v => !v.effective_to || v.effective_to >= claimDate) ?? null;
}

async function fetchDocsForProduct(productId: string): Promise<BnDocumentRule[]> {
  const { data, error } = await db
    .from('bn_doc_requirement')
    .select('*')
    .eq('product_id', productId)
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []) as BnDocumentRule[];
}

/**
 * Returns the full application config for a (product, claim date, channel).
 * Same contract for internal staff intake and public portal UIs.
 */
export async function getProductApplicationConfig(
  productCode: string,
  claimDate: string,
  channel: BnChannelCode,
  _applicantContext?: Record<string, unknown>
): Promise<ApplicationConfig> {
  const { data: product, error: prodErr } = await db
    .from('bn_product')
    .select('*')
    .eq('benefit_code', productCode)
    .maybeSingle();
  if (prodErr) throw prodErr;
  if (!product) throw new Error(`Benefit product not found: ${productCode}`);

  const version = await resolveActiveVersion(product.id, claimDate);
  if (!version) throw new Error(`No active version for ${productCode} on ${claimDate}`);

  const channelConfig = await getChannelConfig(version.id, channel);
  if (!channelConfig || !channelConfig.is_enabled) {
    throw new Error(`Channel ${channel} not enabled for ${productCode}`);
  }

  const [eligibility, calculation, timelines, allDocs] = await Promise.all([
    fetchEligibilityRulesEffective(version.id),
    fetchCalculationRules(version.id),
    fetchTimelineRules(version.id),
    fetchDocsForProduct(product.id),
  ]);

  const documents = filterDocsForChannel(allDocs, channel, /*isPublic*/ channel === 'ONLINE');

  return {
    product,
    version,
    channelConfig,
    eligibility,
    calculation,
    timelines,
    documents,
    screenTemplateId: channelConfig.screen_template_id,
    workflowTemplateId: channelConfig.workflow_template_id,
    workflowDefinitionId: channelConfig.workflow_definition_id,
  };
}

function filterDocsForChannel(
  docs: BnDocumentRule[],
  channel: BnChannelCode,
  isPublic: boolean
): BnDocumentRule[] {
  return docs.filter(d => {
    const ch = (d.channel_code ?? 'BOTH') as string;
    const channelMatch = ch === 'BOTH' || ch === channel;
    if (!channelMatch) return false;
    if (isPublic && d.public_visible === false) return false;
    if (!isPublic && d.internal_visible === false) return false;
    return true;
  });
}

export async function getApplicationRequirements(
  productCode: string,
  claimDate: string,
  channel: BnChannelCode,
  applicantContext?: Record<string, unknown>
) {
  const cfg = await getProductApplicationConfig(productCode, claimDate, channel, applicantContext);
  return {
    documents: cfg.documents,
    eligibility: cfg.eligibility,
    timelines: cfg.timelines,
    channelConfig: cfg.channelConfig,
  };
}

export interface CreateApplicationPayload {
  productCode: string;
  claimDate: string;
  channel: BnChannelCode;
  applicantSsn?: string;
  applicantContext?: Record<string, unknown>;
  uploadedDocumentCodes?: string[];
  prechecksPassed?: boolean;
  enteredBy?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Array<{ field: string; message: string }>;
}

export async function validateApplicationBeforeCreate(
  payload: CreateApplicationPayload
): Promise<ValidationResult> {
  const errors: Array<{ field: string; message: string }> = [];
  const cfg = await getProductApplicationConfig(
    payload.productCode,
    payload.claimDate,
    payload.channel,
    payload.applicantContext
  );

  if (cfg.channelConfig?.blocks_submission_if_precheck_fails && payload.prechecksPassed === false) {
    errors.push({ field: 'precheck', message: 'Precheck failed for this application.' });
  }
  if (cfg.channelConfig?.blocks_submission_if_documents_missing) {
    const uploaded = new Set(payload.uploadedDocumentCodes ?? []);
    const blockingMissing = cfg.documents.filter(
      d => d.blocks_submission && d.is_mandatory && !uploaded.has(d.document_type_code)
    );
    for (const d of blockingMissing) {
      errors.push({ field: d.document_type_code, message: `${d.document_name} is required to submit.` });
    }
  }
  return { ok: errors.length === 0, errors };
}

export async function createApplicationFromConfig(payload: CreateApplicationPayload) {
  const validation = await validateApplicationBeforeCreate(payload);
  if (!validation.ok) throw new Error(validation.errors.map(e => e.message).join(' / '));

  const cfg = await getProductApplicationConfig(
    payload.productCode,
    payload.claimDate,
    payload.channel,
    payload.applicantContext
  );
  const source =
    cfg.channelConfig?.default_source ?? (payload.channel === 'ONLINE' ? 'ONLINE' : 'WALK_IN');

  const claimPayload = {
    product_id: cfg.product.id,
    product_version_id: cfg.version.id,
    claim_date: payload.claimDate,
    status: 'DRAFT',
    source,
    channel_code: payload.channel,
    submitted_via: source,
    screen_template_id: cfg.screenTemplateId,
    workflow_definition_id: cfg.workflowDefinitionId,
    channel_config_id: cfg.channelConfig?.id ?? null,
    applicant_ssn: payload.applicantSsn ?? null,
    entered_by: payload.enteredBy ?? null,
  };
  const { data, error } = await db.from('bn_claim').insert(claimPayload).select().single();
  if (error) throw error;
  return data;
}

/**
 * Build an evidence checklist for a claim based on the channel-aware document requirements.
 */
export async function generateEvidenceChecklist(
  claimId: string,
  productVersionId: string,
  channel: BnChannelCode
) {
  // Resolve product id from version
  const { data: version, error: vErr } = await db
    .from('bn_product_version')
    .select('product_id')
    .eq('id', productVersionId)
    .maybeSingle();
  if (vErr) throw vErr;
  if (!version) throw new Error('Product version not found');

  const allDocs = await fetchDocsForProduct(version.product_id);
  const docs = filterDocsForChannel(allDocs, channel, /*isPublic*/ channel === 'ONLINE');

  const rows = docs.map(d => ({
    claim_id: claimId,
    document_type_code: d.document_type_code,
    document_name: d.document_name,
    is_mandatory: d.is_mandatory,
    stage: d.stage,
    status: 'PENDING',
    metadata: {
      channel,
      blocks_submission: !!d.blocks_submission,
      blocks_decision: !!d.blocks_decision,
      blocks_payment: !!d.blocks_payment,
      public_visible: d.public_visible !== false,
      internal_visible: d.internal_visible !== false,
    },
  }));

  if (rows.length === 0) return [];
  // bn_evidence_checklist or bn_claim_evidence — fall back gracefully
  const { data, error } = await db.from('bn_evidence_checklist').insert(rows).select();
  if (error) {
    // Non-fatal: surface as warning, return constructed rows
    console.warn('Failed to insert evidence checklist', error);
    return rows;
  }
  return data ?? rows;
}

/**
 * Start the channel-appropriate workflow for a claim.
 * If a workflow_definition_id is configured on the channel, use the central workflow engine.
 * Otherwise rely on bn_claim_transition_rule fallback.
 */
export async function startProductWorkflow(
  claimId: string,
  productVersionId: string,
  channel: BnChannelCode
) {
  const cfg = await getChannelConfig(productVersionId, channel);
  if (!cfg) throw new Error(`Channel ${channel} not configured for version ${productVersionId}`);

  if (cfg.workflow_definition_id) {
    // Hand off to central workflow engine
    const { data, error } = await db.from('workflow_instances').insert({
      definition_id: cfg.workflow_definition_id,
      source_module: 'BN_CLAIM',
      source_id: claimId,
      status: 'ACTIVE',
      metadata: { channel, channel_config_id: cfg.id },
    }).select().single();
    if (error) {
      console.warn('Workflow engine handoff failed; fallback to bn transitions.', error);
      return { engine: 'BN_FALLBACK', instance: null };
    }
    return { engine: 'CENTRAL_WORKFLOW', instance: data };
  }
  return { engine: 'BN_FALLBACK', instance: null };
}

/**
 * Public-readiness check (used by configuration validation dashboard).
 */
export async function checkPublicReadiness(productVersionId: string) {
  const cfg = await getChannelConfig(productVersionId, 'ONLINE');
  const issues: string[] = [];
  if (!cfg || !cfg.is_enabled) issues.push('Online channel not enabled');
  else {
    if (!cfg.screen_template_id) issues.push('No screen template');
    if (!cfg.workflow_definition_id && !cfg.workflow_template_id) issues.push('No workflow configured');
    if (!cfg.confirmation_template_id) issues.push('No confirmation template (default will be used)');
  }
  return { ok: issues.length === 0, issues, config: cfg };
}

export async function checkStaffReadiness(productVersionId: string) {
  const cfg = await getChannelConfig(productVersionId, 'OFFLINE');
  const issues: string[] = [];
  if (!cfg || !cfg.is_enabled) issues.push('Offline channel not enabled');
  else {
    if (!cfg.screen_template_id) issues.push('No staff screen template');
    if (!cfg.workflow_definition_id && !cfg.workflow_template_id) issues.push('No workflow configured');
  }
  return { ok: issues.length === 0, issues, config: cfg };
}
