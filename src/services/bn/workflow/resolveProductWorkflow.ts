/**
 * Resolve the active workflow template for a benefit product version + channel.
 *
 * Resolution order:
 *   1. bn_product_version_workflow row whose channel matches (normalised),
 *      active and within effective dates
 *   2. bn_product_channel_config.workflow_template_id for that channel
 *      — this is what the Product Editor's Application Channels tab writes.
 *        It was previously never read, which is why setting a workflow template
 *        there appeared to do nothing.
 *   3. bn_product_version_workflow row marked is_default = true
 *   4. bn_product_version.workflow_template_id (legacy product-level fallback)
 *
 * Channel comparison always goes through `normalizeChannelCode`: the three
 * tables and the intake code each spell channels differently, so a raw string
 * comparison can never match.
 *
 * Returns the resolved template (including workflow_definition_id) and the
 * source of the match so callers can surface it for diagnostics / UI.
 */
import { supabase } from '@/integrations/supabase/client';
import { normalizeChannelCode } from './channelNormalization';

export type WorkflowResolutionSource =
  | 'CHANNEL_MAPPING'
  | 'CHANNEL_CONFIG'
  | 'DEFAULT_MAPPING'
  | 'LEGACY_VERSION'
  | 'NONE';

/** Human-readable description of where a workflow template came from. */
export const WORKFLOW_SOURCE_LABELS: Record<WorkflowResolutionSource, string> = {
  CHANNEL_MAPPING: 'product version workflow mapping for this channel',
  CHANNEL_CONFIG: 'application channel configuration on the product version',
  DEFAULT_MAPPING: 'default product version workflow mapping',
  LEGACY_VERSION: 'workflow template set directly on the product version',
  NONE: 'no workflow configured',
};

export interface ResolvedProductWorkflow {
  source: WorkflowResolutionSource;
  workflowTemplateId: string | null;
  workflowDefinitionId: string | null;
  /** Human-readable description of the source, for UI and diagnostics. */
  sourceLabel: string;
  template: {
    id: string;
    template_code: string;
    template_name: string;
    channel_code: string | null;
    workflow_definition_id: string | null;
    is_active: boolean;
  } | null;
}

const EMPTY: ResolvedProductWorkflow = {
  source: 'NONE',
  workflowTemplateId: null,
  workflowDefinitionId: null,
  sourceLabel: WORKFLOW_SOURCE_LABELS.NONE,
  template: null,
};

async function loadTemplate(id: string | null) {
  if (!id) return null;
  const { data } = await (supabase as any)
    .from('bn_workflow_template')
    .select('id, template_code, template_name, channel_code, workflow_definition_id, is_active')
    .eq('id', id)
    .maybeSingle();
  return data ?? null;
}

async function answer(
  source: Exclude<WorkflowResolutionSource, 'NONE'>,
  templateId: string,
  /** Definition already known from the row, when the row carries one. */
  definitionIdFromRow?: string | null,
): Promise<ResolvedProductWorkflow> {
  const template = await loadTemplate(templateId);
  return {
    source,
    sourceLabel: WORKFLOW_SOURCE_LABELS[source],
    workflowTemplateId: templateId,
    workflowDefinitionId: definitionIdFromRow ?? template?.workflow_definition_id ?? null,
    template,
  };
}

export async function resolveProductWorkflow(
  productVersionId: string | null | undefined,
  channelCode: string | null | undefined,
): Promise<ResolvedProductWorkflow> {
  if (!productVersionId) return EMPTY;

  const db = supabase as any;
  const today = new Date().toISOString().slice(0, 10);
  const channel = normalizeChannelCode(channelCode);

  // 1. Channel-specific active mapping (normalised comparison, done in code —
  //    the stored spellings vary, so the filter cannot be pushed to SQL).
  if (channel) {
    const { data: mappings } = await db
      .from('bn_product_version_workflow')
      .select('workflow_template_id, channel_code, effective_from, effective_to')
      .eq('product_version_id', productVersionId)
      .eq('is_active', true)
      .order('effective_from', { ascending: false, nullsFirst: false });

    const match = (mappings ?? []).find(
      (r: any) =>
        normalizeChannelCode(r.channel_code) === channel &&
        (!r.effective_from || r.effective_from <= today) &&
        (!r.effective_to || r.effective_to >= today),
    );
    if (match?.workflow_template_id) {
      return answer('CHANNEL_MAPPING', match.workflow_template_id);
    }

    // 2. The Application Channels tab on the product version.
    const { data: configs } = await db
      .from('bn_product_channel_config')
      .select('channel_code, workflow_template_id, workflow_definition_id, is_enabled')
      .eq('product_version_id', productVersionId);

    const cfg = (configs ?? []).find(
      (c: any) =>
        normalizeChannelCode(c.channel_code) === channel &&
        c.is_enabled !== false &&
        (c.workflow_template_id || c.workflow_definition_id),
    );
    if (cfg?.workflow_template_id) {
      return answer('CHANNEL_CONFIG', cfg.workflow_template_id, cfg.workflow_definition_id ?? null);
    }
  }

  // 3. Default mapping
  const { data: byDefault } = await db
    .from('bn_product_version_workflow')
    .select('workflow_template_id')
    .eq('product_version_id', productVersionId)
    .eq('is_default', true)
    .eq('is_active', true)
    .maybeSingle();
  if (byDefault?.workflow_template_id) {
    return answer('DEFAULT_MAPPING', byDefault.workflow_template_id);
  }

  // 4. Legacy fallback on the product version row itself
  const { data: ver } = await db
    .from('bn_product_version')
    .select('workflow_template_id')
    .eq('id', productVersionId)
    .maybeSingle();
  if (ver?.workflow_template_id) {
    return answer('LEGACY_VERSION', ver.workflow_template_id);
  }

  return EMPTY;
}
