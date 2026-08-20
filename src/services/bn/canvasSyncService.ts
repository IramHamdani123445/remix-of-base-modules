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

/**
 * Map a Visual Builder block to the fields a manually-created rule (via
 * Add Rule / Rule Catalogue) would have: a top-level fact_key/operator/
 * value_from/value_to (validated by the Conflict Checker and the real
 * eligibility engine) and a matching rule_definition.field_key/operator/
 * value shape (read by the friendly-sentence renderer and the Product
 * Parameters missing-value panel). Without this mapping, Sync only wrote
 * the block's own raw props, which none of those consumers understand.
 *
 * Fact keys are taken from the same catalogue Add Rule reads from
 * (`eligibilityFactRegistry.ts`); confidence on the last two is lower —
 * see notes — because the builder block doesn't carry enough detail to
 * pick an exact fact.
 */
function mapBlockToRuleFields(kind: string, props: Record<string, any>): {
  fact_key: string | null;
  operator: string;
  value_from: string | number | null;
  value_to: string | number | null;
  rd: Record<string, unknown>;
} {
  switch (kind) {
    case 'eligibility.age':
      return {
        fact_key: 'person.age_at_claim_date', operator: 'BETWEEN',
        value_from: props.min_age ?? null, value_to: props.max_age ?? null,
        rd: { field_key: 'person.age_at_claim_date', operator: 'BETWEEN', range_from: props.min_age, range_to: props.max_age },
      };
    case 'eligibility.contribution':
      return {
        fact_key: 'contribution.paid_weeks', operator: 'GREATER_OR_EQUAL',
        value_from: props.min_contributions ?? null, value_to: null,
        rd: { field_key: 'contribution.paid_weeks', operator: '>=', value: props.min_contributions },
      };
    case 'eligibility.document':
      // Best-effort: only matches if `document.<code>_received` exists in the
      // fact catalogue for this document_code (confirmed to exist for at
      // least medical_certificate/death_certificate/birth_certificate/employer_report).
      return {
        fact_key: props.document_code ? `document.${props.document_code}_received` : null, operator: 'EQUALS',
        value_from: 'true', value_to: null,
        rd: { field_key: props.document_code ? `document.${props.document_code}_received` : null, operator: '==', value: true },
      };
    case 'eligibility.medical_board':
      return {
        fact_key: 'medical_board.decision', operator: 'EQUALS',
        value_from: props.decision ?? 'APPROVED', value_to: null,
        rd: { field_key: 'medical_board.decision', operator: '==', value: props.decision ?? 'APPROVED' },
      };
    case 'eligibility.survivor_relationship':
      // Lower confidence: the catalogue only has a boolean "relationship is
      // valid" fact, not a per-relationship-type check, so the block's
      // specific `relationship` choice (e.g. SPOUSE) isn't separately
      // enforced by this mapping — flagged for follow-up if that distinction
      // turns out to matter.
      return {
        fact_key: 'beneficiary.relationship_valid', operator: 'EQUALS',
        value_from: 'true', value_to: null,
        rd: { field_key: 'beneficiary.relationship_valid', operator: '==', value: true },
      };
    case 'eligibility.duplicate_claim':
      return {
        fact_key: 'existing.duplicate_claim_same_period', operator: 'EQUALS',
        value_from: 'false', value_to: null,
        rd: { field_key: 'existing.duplicate_claim_same_period', operator: '==', value: false },
      };
    default:
      return { fact_key: null, operator: 'EQUALS', value_from: null, value_to: null, rd: {} };
  }
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
  const eligRows = eligBlocks.map((b, idx) => {
    const mapped = mapBlockToRuleFields(b.kind, b.props ?? {});
    return {
      product_version_id: versionId,
      rule_code: buildEligRuleCode(b.kind, idx + 1),
      rule_name: (b.kind || 'rule').slice(0, 100),
      rule_type: b.kind.replace(/^eligibility\./, '').toUpperCase().slice(0, 30),
      fact_key: mapped.fact_key,
      operator: mapped.operator,
      value_from: mapped.value_from,
      value_to: mapped.value_to,
      // Keep the raw block props alongside the proper field_key/operator/value
      // shape — nothing from the canvas is lost, it's just no longer the only thing saved.
      rule_definition: { block_id: b.id, kind: b.kind, ...b.props, ...mapped.rd },
      fail_action: 'BLOCK',
      sort_order: idx + 1,
      is_active: true,
      entered_by: userCode,
    };
  });
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
