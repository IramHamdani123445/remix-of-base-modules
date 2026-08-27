/**
 * canvasHydrationService — reverse of canvasSyncService.
 * Reads normalized BN rows for a product version and produces a BuilderCanvas
 * so the Visual Builder reflects existing configuration (eligibility,
 * calculation, documents, communications) for the selected version.
 *
 * Used in two ways:
 *   1. Auto-hydrate on first load when builder_canvas is empty.
 *   2. Explicit "Import from Tables" action to re-sync canvas from DB.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  EMPTY_CANVAS,
  type BuilderBlock,
  type BuilderBlockKind,
  type BuilderCanvas,
  type BuilderSectionKey,
} from '@/components/bn/config-builder/types';

const db = supabase as any;

function block(kind: BuilderBlockKind, props: Record<string, any>): BuilderBlock {
  return {
    id: `imp_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`,
    kind,
    props,
  };
}

function eligibilityKind(rule: any): BuilderBlockKind {
  const t = String(rule.rule_type || '').toUpperCase();
  if (t.includes('AGE')) return 'eligibility.age';
  if (t.includes('CONTRIB')) return 'eligibility.contribution';
  if (t.includes('DOC')) return 'eligibility.document';
  if (t.includes('MEDICAL')) return 'eligibility.medical_board';
  if (t.includes('SURVIVOR') || t.includes('RELATION')) return 'eligibility.survivor_relationship';
  if (t.includes('DUPLICATE')) return 'eligibility.duplicate_claim';
  return 'eligibility.contribution';
}

export async function hydrateCanvasFromNormalized(versionId: string): Promise<BuilderCanvas> {
  const out: BuilderCanvas = {
    ...EMPTY_CANVAS,
    sections: { ...EMPTY_CANVAS.sections },
  };

  const [elig, calc, docs, comms, version] = await Promise.all([
    db.from('bn_eligibility_rule').select('*').eq('product_version_id', versionId).order('sort_order', { ascending: true }),
    db.from('bn_calculation_rule').select('*').eq('product_version_id', versionId).order('sort_order', { ascending: true }),
    db.from('bn_doc_requirement').select('*').eq('product_version_id', versionId).order('sort_order', { ascending: true }),
    db.from('bn_comm_mapping').select('*').eq('bn_product_version_id', versionId).order('fallback_priority', { ascending: true }),
    db.from('bn_product_version').select('workflow_template_id, screen_template_id').eq('id', versionId).maybeSingle(),
  ]);

  // Eligibility
  out.sections.eligibility = (elig.data ?? []).map((r: any) => block(eligibilityKind(r), {
    label: r.rule_name,
    rule_code: r.rule_code,
    rule_type: r.rule_type,
    fail_action: r.fail_action,
    fail_message: r.fail_message,
    ...(r.rule_definition ?? {}),
    _origin: r.rule_code?.startsWith('BLD_') ? 'BUILDER' : 'LEGACY',
    _source_id: r.id,
  }));

  // Calculation — map each rule to a variable block plus nested limits.
  const calcBlocks: BuilderBlock[] = [];
  for (const r of (calc.data ?? [])) {
    calcBlocks.push(block('formula.variable', {
      label: r.rule_name,
      variable_key: r.rule_code,
      calc_type: r.calc_type,
      formula: r.formula_definition,
      _origin: 'LEGACY',
      _source_id: r.id,
    }));
    const limits = r.limits ?? {};
    if (limits.cap != null) calcBlocks.push(block('formula.cap', { label: `${r.rule_code} cap`, value: limits.cap, _origin: 'LEGACY' }));
    if (limits.min != null) calcBlocks.push(block('formula.minimum', { label: `${r.rule_code} min`, value: limits.min, _origin: 'LEGACY' }));
    if (limits.max != null) calcBlocks.push(block('formula.maximum', { label: `${r.rule_code} max`, value: limits.max, _origin: 'LEGACY' }));
  }
  out.sections.calculation = calcBlocks;

  // Documents
  out.sections.documents = (docs.data ?? []).map((d: any) => block('document.required', {
    label: d.document_type_code,
    document_code: d.document_type_code,
    stage: d.stage,
    requirement: d.requirement_level,
    public_upload: !!d.public_visible,
    blocks_decision: d.blocks_decision,
    _origin: d.source_note === 'BUILDER' ? 'BUILDER' : 'LEGACY',
    _source_id: d.id,
  }));

  // Communications
  out.sections.communications = (comms.data ?? []).map((c: any) => block('comm.event', {
    label: c.event_code,
    event_code: c.event_code?.replace(/^BLD_/, ''),
    recipient_type: c.recipient_type,
    delivery_method: c.delivery_method || c.channel,
    mandatory: c.is_required,
    _origin: c.event_code?.startsWith('BLD_') ? 'BUILDER' : 'LEGACY',
    _source_id: c.id,
  }));

  // Workflow — read the actual bn_workflow_template this version points at
  // (steps_config/escalation_config), the same shape canvasSyncService.ts
  // writes. bn_timeline_rule (SLA/day-count rules) is a different concept
  // entirely and was never what Sync produces for this section — reading it
  // here made Import show unrelated data after Sync had already moved on.
  const workflowTemplateId = version.data?.workflow_template_id ?? null;
  if (workflowTemplateId) {
    const { data: tpl } = await db
      .from('bn_workflow_template')
      .select('id, steps_config, escalation_config')
      .eq('id', workflowTemplateId)
      .maybeSingle();
    const steps = (tpl?.steps_config ?? []) as any[];
    const escalations = (tpl?.escalation_config ?? []) as any[];
    out.sections.workflow = [
      ...steps.map((s) => block('workflow.step', {
        label: s.step,
        step_code: s.step,
        role: s.role,
        sla_hours: s.sla_days != null ? Number(s.sla_days) * 24 : undefined,
        workbasket_id: s.workbasket_id,
        _origin: 'LEGACY',
        _source_id: tpl?.id,
      })),
      ...escalations.map((e) => block('workflow.escalation', {
        label: e.policy_code,
        policy_code: e.policy_code,
        target_role: e.target_role,
        severity: e.severity,
        trigger: e.trigger,
        _origin: 'LEGACY',
        _source_id: tpl?.id,
      })),
    ];
  }

  // Form / Screen — read the actual bn_screen_template this version points
  // at. This section was never hydrated at all before, so Import always
  // showed it empty regardless of what had been saved.
  const screenTemplateId = version.data?.screen_template_id ?? null;
  if (screenTemplateId) {
    const { data: tpl } = await db
      .from('bn_screen_template')
      .select('id, sections')
      .eq('id', screenTemplateId)
      .maybeSingle();
    const sections = (tpl?.sections ?? []) as any[];
    const screenBlocks: BuilderBlock[] = [];
    sections.forEach((s) => {
      screenBlocks.push(block('screen.section', {
        title: s.title ?? s.label ?? 'Section',
        columns: s.columns ?? 2,
        _origin: 'LEGACY',
        _source_id: tpl?.id,
      }));
      (s.fields ?? []).forEach((f: any) => {
        screenBlocks.push(block('screen.field', {
          label: f.label,
          field_type: f.field_type,
          data_source: f.data_source,
          required_condition: f.required_condition,
          visible_channels: f.visible_channels ?? [],
          _origin: 'LEGACY',
          _source_id: tpl?.id,
        }));
      });
    });
    out.sections.screen = screenBlocks;
  }

  out.updatedAt = new Date().toISOString();
  return out;
}

export function canvasIsEmpty(c: Partial<BuilderCanvas> | undefined): boolean {
  if (!c?.sections) return true;
  return (Object.keys(c.sections) as BuilderSectionKey[])
    .every((k) => !c.sections?.[k] || c.sections[k]!.length === 0);
}
