/**
 * canvasSyncService — derive normalized BN rows from a BuilderCanvas.
 * builder_canvas is the source of truth; on "Sync" we replace builder-owned rows in:
 *   - bn_eligibility_rule   (identified by rule_code prefix "BLD_")
 *   - bn_doc_requirement    (identified by source_note = 'BUILDER')
 *   - bn_comm_mapping       (replaced for the specific event_codes the builder owns)
 * Legacy non-builder rows are never touched.
 */
import { supabase } from '@/integrations/supabase/client';
import type { BuilderCanvas } from '@/components/bn/config-builder/types';
import { assertVersionMutable } from './config/configImpactService';

const db = supabase as any;
const BLD = 'BLD_';

export interface SyncResult {
  eligibilityRules: number;
  documentRequirements: number;
  commMappings: number;
  warnings: string[];
}

/** Compact eligibility rule_code to <= 30 chars (DB column is varchar(30)). */
function buildEligRuleCode(kind: string, idx: number): string {
  const short = kind.replace(/^eligibility\./, '').replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().slice(0, 20);
  return `${BLD}${short}_${idx}`.slice(0, 30);
}

export async function syncCanvasToNormalized(versionId: string, canvas: BuilderCanvas, userCode: string): Promise<SyncResult> {
  await assertVersionMutable(versionId);
  const warnings: string[] = [];

  // ---- 1. Eligibility rules ----
  await db.from('bn_eligibility_rule')
    .delete()
    .eq('product_version_id', versionId)
    .like('rule_code', `${BLD}%`);
  const eligBlocks = canvas.sections.eligibility ?? [];
  const eligRows = eligBlocks.map((b, idx) => ({
    product_version_id: versionId,
    rule_code: buildEligRuleCode(b.kind, idx + 1),
    rule_name: (b.kind || 'rule').slice(0, 100),
    rule_type: b.kind.replace(/^eligibility\./, '').toUpperCase().slice(0, 30),
    rule_definition: { block_id: b.id, kind: b.kind, ...b.props },
    fail_action: 'BLOCK',
    sort_order: idx + 1,
    is_active: true,
    entered_by: userCode,
  }));
  if (eligRows.length) {
    const { error } = await db.from('bn_eligibility_rule').insert(eligRows);
    if (error) warnings.push(`Eligibility: ${error.message}`);
  }

  // ---- 2. Document requirements ----
  // Dedupe by (document_type_code, stage, channel_code) to honour the unique index.
  await db.from('bn_doc_requirement')
    .delete()
    .eq('product_version_id', versionId)
    .eq('source_note', 'BUILDER');
  const docBlocks = (canvas.sections.documents ?? []).filter(
    (b) => b.kind === 'document.required' && b.props?.document_code,
  );
  const seen = new Set<string>();
  const dedupedDocBlocks: typeof docBlocks = [];
  const dupes: string[] = [];
  docBlocks.forEach((b) => {
    const stage = b.props.stage ?? 'INTAKE';
    const channel = b.props.channel_code ?? (b.props.public_upload ? 'PUBLIC' : 'BOTH');
    const key = `${b.props.document_code}|${stage}|${channel}`;
    if (seen.has(key)) {
      dupes.push(b.props.document_code);
    } else {
      seen.add(key);
      dedupedDocBlocks.push(b);
    }
  });
  if (dupes.length) {
    warnings.push(`Documents: skipped ${dupes.length} duplicate row(s): ${[...new Set(dupes)].join(', ')}`);
  }
  const docRows = dedupedDocBlocks.map((b, idx) => ({
    product_version_id: versionId,
    document_type_code: b.props.document_code,
    stage: b.props.stage ?? 'INTAKE',
    channel_code: b.props.channel_code ?? (b.props.public_upload ? 'PUBLIC' : 'BOTH'),
    requirement_level: b.props.requirement ?? 'REQUIRED',
    sort_order: idx + 1,
    is_active: true,
    public_visible: !!b.props.public_upload,
    internal_visible: true,
    upload_mode: b.props.public_upload ? 'PUBLIC' : 'INTERNAL',
    source_note: 'BUILDER',
    entered_by: userCode,
  }));
  if (docRows.length) {
    const { error } = await db.from('bn_doc_requirement').insert(docRows);
    if (error) warnings.push(`Documents: ${error.message}`);
  }

  // ---- 3. Communication mappings ----
  // event_code is a FK to bn_comm_event — never prefix it. Replace mappings
  // for this version that match the event_codes the builder is about to insert.
  const commBlocks = (canvas.sections.communications ?? []).filter(
    (b) => b.kind === 'comm.event' && b.props?.event_code,
  );
  const eventCodes = [...new Set(commBlocks.map((b) => b.props.event_code as string))];
  // Validate event codes exist in catalogue
  let validCodes = new Set<string>();
  if (eventCodes.length) {
    const { data: existing } = await db
      .from('bn_comm_event')
      .select('event_code')
      .in('event_code', eventCodes);
    validCodes = new Set((existing ?? []).map((r: any) => r.event_code));
    const missing = eventCodes.filter((c) => !validCodes.has(c));
    if (missing.length) {
      warnings.push(`Communications: unknown event_code(s) skipped — ${missing.join(', ')}`);
    }
    await db.from('bn_comm_mapping')
      .delete()
      .eq('bn_product_version_id', versionId)
      .in('event_code', [...validCodes]);
  }
  const commRows = commBlocks
    .filter((b) => validCodes.has(b.props.event_code))
    .map((b, idx) => ({
      bn_product_version_id: versionId,
      event_code: b.props.event_code,
      recipient_type: b.props.recipient_type ?? 'CLAIMANT',
      delivery_method: b.props.delivery_method ?? 'EMAIL',
      channel: b.props.delivery_method ?? 'EMAIL',
      is_required: !!b.props.mandatory,
      fallback_priority: idx + 1,
      active: true,
      created_by: userCode,
    }));
  if (commRows.length) {
    const { error } = await db.from('bn_comm_mapping').insert(commRows);
    if (error) warnings.push(`Communications: ${error.message}`);
  }

  return {
    eligibilityRules: eligRows.length,
    documentRequirements: docRows.length,
    commMappings: commRows.length,
    warnings,
  };
}

export async function cloneVersionToDraft(versionId: string, userCode: string): Promise<string> {
  const { data, error } = await db.rpc('bn_clone_product_version_to_draft', {
    p_source_id: versionId,
    p_user_code: userCode,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
