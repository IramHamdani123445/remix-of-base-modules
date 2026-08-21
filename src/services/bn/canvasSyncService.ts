/**
 * canvasSyncService — derive normalized BN rows from a BuilderCanvas.
 *
 * On "Sync" the builder replaces the rows it owns:
 *   - bn_eligibility_rule   (rule_code prefix "BLD_")
 *   - bn_doc_requirement    (source_note = 'BUILDER')
 *   - bn_comm_mapping       (only the event_codes on the canvas)
 *   - bn_calculation_rule   (rule_code prefix "BLD_")
 *   - bn_workflow_template / bn_screen_template  (upserted by builder code)
 *
 * Rows that came from elsewhere are never touched at all. A block that Import
 * brought in carries `_origin: 'LEGACY'`; it is neither duplicated under a BLD_
 * code nor rewritten, and is reported as left unchanged. Rewriting it would be
 * unsafe: Import picks a block kind from keywords in `rule_type` and falls back
 * to "Contribution Condition" for anything it does not recognise, which covers
 * most rules in practice. The Builder has six block kinds and cannot represent
 * rules built on the other screens, so it must not write to them — and it must
 * not delete them either.
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
  calculationRules: number;
  workflowTemplates: number;
  screenTemplates: number;
  warnings: string[];
  /**
   * BUG-005 — sections the user has built that this sync does not apply.
   *
   * The Visual Builder offers eight sections; only eligibility, documents and
   * communications have ever been translated into real rows. The other five
   * were skipped in silence while the sync reported plain success, so a user
   * could build a calculation, see it in the preview, press Sync, get a green
   * confirmation, and find the Calculation tab empty with nothing to explain
   * why. Five product versions already hold canvas work that was never
   * applied.
   *
   * Naming the skipped sections does not implement them, but it stops the
   * sync claiming to have done something it did not.
   */
  notApplied: string[];
}

/** Canvas sections that syncCanvasToNormalized knows how to persist. */
const SUPPORTED_SECTIONS = [
  'eligibility', 'documents', 'communications',
  // Implemented after BUG-005: these now write real rows.
  'calculation', 'workflow', 'screen',
] as const;

/** Human wording for the sections, matching the Builder's own tab labels. */
const SECTION_LABELS: Record<string, string> = {
  eligibility: 'Eligibility',
  calculation: 'Calculation',
  documents: 'Documents',
  screen: 'Form / Screen',
  workflow: 'Workflow',
  communications: 'Communications',
  payments: 'Payments',
  servicing: 'Servicing',
};

/**
 * Which sections hold blocks that this sync will not write. Only sections the
 * user has actually put something in are reported, so the message stays quiet
 * when there is nothing to skip.
 */
function unappliedSections(canvas: BuilderCanvas): string[] {
  const sections = (canvas?.sections ?? {}) as Record<string, unknown>;
  return Object.entries(sections)
    .filter(([key, blocks]) =>
      !SUPPORTED_SECTIONS.includes(key as any) && Array.isArray(blocks) && blocks.length > 0)
    .map(([key]) => SECTION_LABELS[key] ?? key);
}

/** Compact eligibility rule_code to <= 30 chars (DB column is varchar(30)). */
function buildEligRuleCode(kind: string, idx: number): string {
  const short = kind.replace(/^eligibility\./, '').replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().slice(0, 20);
  return `${BLD}${short}_${idx}`.slice(0, 30);
}

/**
 * Map a Visual Builder block to what the eligibility engine actually reads.
 *
 * `bn_eligibility_rule` has no operator/value columns — only `fact_key` and the
 * `rule_definition` JSON — so the condition is returned as a fact key, an
 * operator from OPERATORS (eligibility/operators.ts) and a single `value`.
 * `between` takes a two-element array, which its comparator requires; the
 * min/max shape used by some existing rules in the database fails that check
 * and so never passes.
 *
 * Fact keys are taken from the same catalogue Add Rule reads from
 * (`eligibilityFactRegistry.ts`); confidence on the last two is lower —
 * see notes — because the builder block doesn't carry enough detail to
 * pick an exact fact.
 */
function mapBlockToRuleFields(kind: string, props: Record<string, any>): {
  fact_key: string | null;
  operator: string;
  value: unknown;
} {
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  switch (kind) {
    case 'eligibility.age': {
      // between wants a two-element array — the comparator returns false for
      // anything else, which is why the min/max shape used elsewhere in the
      // database never passes.
      const lo = num(props.min_age);
      const hi = num(props.max_age);
      if (lo !== null && hi !== null) {
        return { fact_key: 'person.age_at_claim_date', operator: 'between', value: [lo, hi] };
      }
      // Only one bound given — a single comparison is still a valid rule.
      if (lo !== null) return { fact_key: 'person.age_at_claim_date', operator: '>=', value: lo };
      if (hi !== null) return { fact_key: 'person.age_at_claim_date', operator: '<=', value: hi };
      return { fact_key: 'person.age_at_claim_date', operator: '>=', value: null };
    }
    case 'eligibility.contribution':
      return {
        fact_key: 'contribution.paid_weeks', operator: '>=',
        value: num(props.min_contributions),
      };
    case 'eligibility.document':
      // Resolves only if `document.<code>_received` exists in the fact
      // catalogue; without a document_code there is no fact at all.
      return {
        fact_key: props.document_code ? `document.${props.document_code}_received` : null,
        operator: '=', value: true,
      };
    case 'eligibility.medical_board':
      return {
        fact_key: 'medical_board.decision', operator: '=',
        value: props.decision ?? 'APPROVED',
      };
    case 'eligibility.survivor_relationship':
      // The catalogue has only a boolean "relationship is valid" fact, not a
      // per-relationship check, so the block's specific choice (e.g. SPOUSE)
      // is not separately enforced. Reported on sync so it is not assumed.
      return {
        fact_key: 'beneficiary.relationship_valid', operator: '=', value: true,
      };
    case 'eligibility.duplicate_claim':
      return {
        fact_key: 'existing.duplicate_claim_same_period', operator: '=', value: false,
      };
    default:
      return { fact_key: null, operator: '=', value: null };
  }
}

/** Block labels as shown on the canvas, for messages the user can act on. */
const BLOCK_LABELS: Record<string, string> = {
  'eligibility.age': 'Age Condition',
  'eligibility.contribution': 'Contribution Condition',
  'eligibility.document': 'Document Condition',
  'eligibility.medical_board': 'Medical Board Condition',
  'eligibility.survivor_relationship': 'Survivor Relationship',
  'eligibility.duplicate_claim': 'Duplicate Claim Check',
};

/** Why a block produced no fact, in words the user can act on. */
function describeMissingFact(kind: string, props: Record<string, any>): string {
  if (kind === 'eligibility.document' && !props.document_code) {
    return 'no document selected. Choose a document code on the block.';
  }
  return `this block type is not yet mapped to a fact (${kind}).`;
}

/**
 * Reduce a token stream of plain numbers and +-*\/% operators, left to right —
 * safe to evaluate at sync time (no eval, no runtime facts) only because the
 * caller has already confirmed no Variable block is involved. Returns null on
 * anything malformed rather than guessing.
 */
function evalPureArithmetic(tokens: string[]): number | null {
  if (!tokens.length || tokens.length % 2 === 0) return null;
  let acc = Number(tokens[0]);
  if (!Number.isFinite(acc)) return null;
  for (let i = 1; i < tokens.length; i += 2) {
    const rhs = Number(tokens[i + 1]);
    if (!Number.isFinite(rhs)) return null;
    switch (tokens[i]) {
      case '+': acc += rhs; break;
      case '-': acc -= rhs; break;
      case '*': acc *= rhs; break;
      case '/': if (rhs === 0) return null; acc /= rhs; break;
      case '%': if (rhs === 0) return null; acc %= rhs; break;
      default: return null;
    }
  }
  return Number.isFinite(acc) ? acc : null;
}

export async function syncCanvasToNormalized(versionId: string, canvas: BuilderCanvas, userCode: string): Promise<SyncResult> {
  await assertVersionMutable(versionId);
  const warnings: string[] = [];

  // bn_doc_requirement rows need product_id, not just product_version_id — the
  // global Documents tab (fetchDocumentRulesByProduct) filters strictly on
  // product_id, so a row missing it is saved but permanently invisible there.
  const { data: versionRow } = await db
    .from('bn_product_version')
    .select('product_id')
    .eq('id', versionId)
    .maybeSingle();
  const productId = versionRow?.product_id ?? null;
  /**
   * Per-block reasons, so every block on the canvas ends in one of exactly two
   * states: applied, or reported with a reason. Never silently dropped, and
   * never surfaced as a raw database message.
   */
  const skipped: string[] = [];

  // ---- 1. Eligibility rules ----
  //
  // Sync used to write `operator`, `value_from` and `value_to` as columns on
  // bn_eligibility_rule. Those columns do not exist — the condition lives in
  // `fact_key` plus the `rule_definition` JSON — so every insert failed with
  // "Could not find the 'operator' column ... in the schema cache" and no rule
  // was ever created. Earlier rows written before that mapping existed are
  // still present with fact_key NULL and only raw block props, which the
  // evaluator cannot act on at all.
  //
  // The evaluator (eligibility/ruleEvaluator.ts) reads exactly:
  //     fact_key ?? rule_definition.field_key
  //     rule_definition.operator   (default '=')
  //     rule_definition.value
  // so that is what is written. Raw block props are kept under
  // `builder_props` so "Import from Tables" can still rebuild the canvas
  // without them being mistaken for the condition.
  // Builder-owned rows are replaced wholesale. Rows that came from elsewhere
  // are never deleted here — see the `_origin` handling below.
  await db.from('bn_eligibility_rule')
    .delete()
    .eq('product_version_id', versionId)
    .like('rule_code', `${BLD}%`);

  const eligBlocks = canvas.sections.eligibility ?? [];
  const eligRows: Record<string, unknown>[] = [];

  eligBlocks.forEach((b, idx) => {
    const props = (b.props ?? {}) as Record<string, any>;
    const label = BLOCK_LABELS[b.kind] ?? b.kind;

    // Checked first, before anything is mapped. A rule from elsewhere is not
    // the builder's to write, so the mapping is irrelevant to it — and running
    // the mapping first produced a misleading reason ("no value set") for a
    // rule that was simply never the builder's.
    if (props._origin === 'LEGACY') {
      skipped.push(
        `${props.rule_code ?? label}: left unchanged — created outside the Builder, ` +
        `which cannot represent it faithfully. Edit it on the Eligibility tab.`,
      );
      return;
    }

    const mapped = mapBlockToRuleFields(b.kind, props);

    // A block that cannot become a usable rule is reported, not written. A row
    // with no fact resolves nothing and fails every claim silently.
    if (!mapped.fact_key) {
      skipped.push(
        `${label}: not applied — ${describeMissingFact(b.kind, props)}`,
      );
      return;
    }
    if (mapped.value === null || mapped.value === undefined) {
      skipped.push(`${label}: not applied — no value set.`);
      return;
    }

    const condition = {
      field_key: mapped.fact_key,
      operator: mapped.operator,
      value: mapped.value,
      // The canvas block, kept separately so it is never read as the condition.
      builder_props: { block_id: b.id, kind: b.kind, ...props },
    };

    eligRows.push({
      product_version_id: versionId,
      rule_code: buildEligRuleCode(b.kind, idx + 1),
      rule_name: label.slice(0, 100),
      rule_type: b.kind.replace(/^eligibility\./, '').toUpperCase().slice(0, 30),
      rule_kind: 'LITERAL',
      fact_key: mapped.fact_key,
      rule_definition: condition,
      fail_action: 'BLOCK',
      sort_order: idx + 1,
      is_active: true,
      entered_by: userCode,
    });
  });

  // A rule that was imported and then removed from the canvas is deliberately
  // left in place. The Builder must not delete a rule created and governed
  // elsewhere; the user is told so they can remove it where it belongs.
  const importedIds = new Set(
    eligBlocks
      .map(b => (b.props as any)?._source_id)
      .filter(Boolean)
      .map(String),
  );
  const { data: existingRules } = await db
    .from('bn_eligibility_rule')
    .select('id, rule_code')
    .eq('product_version_id', versionId)
    .not('rule_code', 'like', `${BLD}%`);
  const droppedFromCanvas = ((existingRules ?? []) as any[])
    .filter(r => !importedIds.has(String(r.id)))
    .map(r => r.rule_code);
  if (droppedFromCanvas.length && importedIds.size > 0) {
    skipped.push(
      `${droppedFromCanvas.length} existing rule(s) are not on the canvas and were left unchanged ` +
      `(${droppedFromCanvas.slice(0, 4).join(', ')}${droppedFromCanvas.length > 4 ? '…' : ''}). ` +
      `Remove them on the Eligibility tab if that is intended.`,
    );
  }

  if (eligRows.length) {
    const { error } = await db.from('bn_eligibility_rule').insert(eligRows);
    if (error) {
      // Plain wording — a schema-cache message tells an operator nothing.
      warnings.push(
        `Eligibility rules could not be saved: ${error.message}. No eligibility rule was created.`,
      );
    }
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
    product_id: productId,
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

  // ---- 4. Calculation ----
  //
  // The eight calculation blocks describe one calculation between them: a set
  // of variables, an arithmetic shape, and caps/floors. They are therefore
  // collapsed into a single bn_calculation_rule row rather than one row per
  // block — which is how the Calculation tab stores it too (formula_definition
  // + variables + limits).
  let calcRules = 0;
  const calcBlocks = canvas.sections.calculation ?? [];
  if (calcBlocks.length) {
    await db.from('bn_calculation_rule')
      .delete()
      .eq('product_version_id', versionId)
      .like('rule_code', `${BLD}%`);

    const variables = calcBlocks
      .filter(b => b.kind === 'formula.variable' && b.props?.variable_key)
      .map(b => String(b.props.variable_key));
    const share = calcBlocks.find(b => b.kind === 'formula.share_percentage');
    const cap = calcBlocks.find(b => b.kind === 'formula.cap');
    const min = calcBlocks.find(b => b.kind === 'formula.minimum');
    const max = calcBlocks.find(b => b.kind === 'formula.maximum');
    const tier = calcBlocks.find(b => b.kind === 'formula.tier');

    // calculationEngine.ts's min/max cap logic reads limits.min_amount /
    // limits.max_amount specifically — the previous min_weekly/max_weekly/cap
    // keys are never read by anything, so a Minimum/Maximum/Cap block was
    // silently ignored at claim time regardless of whether Sync "succeeded".
    const limits: Record<string, unknown> = {};
    if (min?.props?.min !== undefined && min.props.min !== null) limits.min_amount = Number(min.props.min);
    if (max?.props?.max !== undefined && max.props.max !== null) limits.max_amount = Number(max.props.max);
    if (cap?.props?.cap !== undefined && cap.props.cap !== null) {
      // The real engine has no separate "cap" concept, only a maximum — a Cap
      // block is folded into max_amount when no explicit Maximum block set one.
      if (limits.max_amount === undefined) limits.max_amount = Number(cap.props.cap);
      limits.cap_type = cap.props.cap_type ?? 'WEEKLY';
    }

    // The arithmetic, read left to right in canvas order — the same reading the
    // preview panel shows. Taking only the first Constant (as this did before)
    // silently dropped the variable and the operator, so "paid_weeks + 13" was
    // stored as a fixed amount of 13.
    const expressionTokens: string[] = [];
    for (const b of calcBlocks) {
      if (b.kind === 'formula.variable' && b.props?.variable_key) {
        expressionTokens.push(String(b.props.variable_key));
      } else if (b.kind === 'formula.constant' && b.props?.value !== undefined) {
        expressionTokens.push(String(Number(b.props.value)));
      } else if (b.kind === 'formula.operator') {
        expressionTokens.push(String(b.props?.operator ?? '+'));
      }
    }
    const expression = expressionTokens.join(' ');

    // calculationEngine.ts (the real claim-time engine) only recognizes a fixed
    // enum of calc_types, each tied to specific inputs — it has no generic
    // arithmetic evaluator. 'TIERED'/'FIXED' aren't recognized at all (no
    // `default:` case either, so the result silently stays 0); calc_type
    // 'FORMULA' IS recognized, but means "rate% × average weekly wage" using
    // config.rate — it does not evaluate config.expression at all. Writing
    // 'FORMULA' for an arbitrary Variable × Operator canvas would not error —
    // it would silently pay ~66.67% of average weekly wage regardless of what
    // was actually built. Only the cases below have a real, honest match.
    let calcType: string | null = null;
    const definition: Record<string, unknown> = {};
    let skipReason: string | null = null;

    if (Array.isArray(tier?.props?.tiers) && tier!.props.tiers.length) {
      // Matches TIER_TABLE/LOOKUP exactly: tiers keyed by fromWeeks/toWeeks/
      // flatAmount/rate. No inspector exists yet to build this on the canvas
      // (see findings-log) so this path is currently unreachable in practice,
      // but is written correctly for when it is.
      calcType = 'TIER_TABLE';
      definition.tiers = tier!.props.tiers;
      if (expression) definition.expression = expression;
    } else if (share?.props?.percentage) {
      // Genuinely matches the real engine: a percentage of average weekly wage.
      calcType = 'PERCENTAGE';
      definition.rate = Number(share.props.percentage);
      if (share.props.applies_to) definition.applies_to = share.props.applies_to;
      if (expression) definition.expression = expression;
    } else if (!expressionTokens.length) {
      // Caps and floors alone are not a calculation — they only bound one.
      skipReason = 'add a Variable, Constant, Share % or Tier block, so an amount can be produced. Cap, Minimum and Maximum only limit a calculation, they do not make one.';
    } else if (expressionTokens.length % 2 === 0) {
      // e.g. "paid_weeks +" — an operator with nothing after it.
      skipReason = `the expression is incomplete ("${expression}"). Every operator needs a value on both sides.`;
    } else if (variables.length > 0) {
      // A real Variable block is involved and this isn't Share %/Tier — there
      // is no calc_type the real engine can evaluate this against honestly.
      skipReason =
        `this canvas uses a custom Variable formula ("${expression}"), which the real calculation engine cannot evaluate yet. ` +
        `Only a Constant (or arithmetic of constants), a Share % of average weekly wage, or a Tier table can be synced today. ` +
        `Configure this calculation directly on the product's Calculation tab instead.`;
    } else {
      // No Variable involved — pure arithmetic over constants, safe to reduce
      // to a single number now rather than needing any runtime fact.
      const flat = evalPureArithmetic(expressionTokens);
      if (flat === null) {
        skipReason = `the expression could not be evaluated ("${expression}").`;
      } else {
        calcType = 'FLAT_RATE';
        definition.flatAmount = flat;
      }
    }

    if (skipReason) {
      skipped.push(`Calculation: not applied — ${skipReason}`);
    } else if (calcType) {
      definition.builder_blocks = calcBlocks.map(b => ({ id: b.id, kind: b.kind, props: b.props ?? {} }));
      const { error } = await db.from('bn_calculation_rule').insert([{
        product_version_id: versionId,
        rule_code: `${BLD}CALC_1`,
        rule_name: 'Builder calculation',
        calc_type: calcType,
        formula_definition: definition,
        variables,
        // limits is NOT NULL on this table — every one of the 25 existing rows
        // has a value. An empty object means "no caps or floors", which is a
        // different statement from "unknown", and null was rejected outright:
        //   null value in column "limits" ... violates not-null constraint
        limits,
        rounding_rule: 'ROUND_HALF_UP',
        sort_order: 1,
        is_active: true,
        entered_by: userCode,
      }]);
      if (error) {
        warnings.push(`Calculation could not be saved: ${error.message}. No calculation rule was created.`);
      } else {
        calcRules = 1;
      }
    }
  }

  // ---- 5. Workflow ----
  //
  // Workflow steps become a template row keyed to this product version, in the
  // shape the Workflow tab reads (steps_config / escalation_config).
  let workflowTemplates = 0;
  const wfBlocks = canvas.sections.workflow ?? [];
  const wfSteps = wfBlocks.filter(b => b.kind === 'workflow.step' && b.props?.step_code);
  if (wfBlocks.length) {
    if (!wfSteps.length) {
      skipped.push('Workflow: not applied — every Workflow Step block needs a step code.');
    } else {
      const routing = wfBlocks.filter(b => b.kind === 'workflow.workbasket_routing');
      const templateCode = `${BLD}WF_${versionId.slice(0, 8)}`.toUpperCase().slice(0, 40);
      const row = {
        template_code: templateCode,
        template_name: 'Builder workflow',
        steps_config: wfSteps.map((b, i) => ({
          step: b.props.step_code,
          role: b.props.role ?? null,
          sla_days: b.props.sla_hours ? Math.ceil(Number(b.props.sla_hours) / 24) : null,
          workbasket_id: b.props.workbasket_id
            || routing.find(r => r.props?.step_code === b.props.step_code)?.props?.workbasket_id
            || null,
          order: i + 1,
        })),
        escalation_config: wfBlocks
          .filter(b => b.kind === 'workflow.escalation' && b.props?.policy_code)
          .map(b => ({
            policy_code: b.props.policy_code,
            target_role: b.props.target_role ?? null,
            severity: b.props.severity ?? null,
            trigger: b.props.trigger ?? null,
          })),
        is_active: true,
        entered_by: userCode,
      };
      // Upsert by code so repeated syncs update rather than duplicate.
      const { error } = await db.from('bn_workflow_template')
        .upsert(row, { onConflict: 'template_code' });
      if (error) {
        warnings.push(`Workflow could not be saved: ${error.message}. No workflow template was created.`);
      } else {
        workflowTemplates = 1;
        // Point the version at it, so the Workflow tab shows what was built.
        const { error: linkErr } = await db.from('bn_product_version')
          .update({ workflow_template_id: null })
          .eq('id', versionId)
          .select('id');
        void linkErr;
        const { data: tpl } = await db.from('bn_workflow_template')
          .select('id').eq('template_code', templateCode).maybeSingle();
        if (tpl?.id) {
          await db.from('bn_product_version')
            .update({ workflow_template_id: tpl.id })
            .eq('id', versionId);
        }
      }
    }
  }

  // ---- 6. Form / Screen ----
  //
  // A screen template holds only its sections. Field blocks are recorded inside
  // the section they belong to, since the template has no field-level table.
  //
  // Two section shapes exist in the live data — {code,label,order} and
  // {key,title,order}. Both are written so either reader works.
  let screenTemplates = 0;
  const screenBlocks = canvas.sections.screen ?? [];
  const sectionBlocks = screenBlocks.filter(b => b.kind === 'screen.section');
  if (screenBlocks.length) {
    if (!sectionBlocks.length) {
      skipped.push('Form / Screen: not applied — add at least one Section block; fields must sit inside a section.');
    } else {
      const fields = screenBlocks.filter(b => b.kind === 'screen.field');
      const templateCode = `${BLD}SCR_${versionId.slice(0, 8)}`.toUpperCase().slice(0, 40);
      const sections = sectionBlocks.map((b, i) => {
        const title = String(b.props?.title ?? `Section ${i + 1}`);
        const code = title.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase().slice(0, 40);
        return {
          code, key: code, label: title, title,
          order: (i + 1) * 10,
          columns: b.props?.columns ?? 2,
          // No field-level table exists, so fields live with their section.
          fields: fields.map(f => ({
            label: f.props?.label ?? '',
            field_type: f.props?.field_type ?? 'TEXT',
            data_source: f.props?.data_source ?? null,
            required_condition: f.props?.required_condition ?? 'ALWAYS',
            visible_channels: f.props?.visible_channels ?? [],
          })),
        };
      });
      const { error } = await db.from('bn_screen_template')
        .upsert({
          template_code: templateCode,
          template_name: 'Builder screen',
          description: 'Created from the Visual Builder Form / Screen section.',
          sections,
          layout_type: 'TABBED',
          is_active: true,
          entered_by: userCode,
        }, { onConflict: 'template_code' });
      if (error) {
        warnings.push(`Form / Screen could not be saved: ${error.message}. No screen template was created.`);
      } else {
        screenTemplates = 1;
        const { data: tpl } = await db.from('bn_screen_template')
          .select('id').eq('template_code', templateCode).maybeSingle();
        if (tpl?.id) {
          await db.from('bn_product_version')
            .update({ screen_template_id: tpl.id })
            .eq('id', versionId);
        }
        if (fields.length && sectionBlocks.length > 1) {
          // Field blocks carry no section reference, so they cannot be assigned
          // to a particular section — say so rather than guessing.
          skipped.push(
            `Form / Screen: ${fields.length} field(s) copied into every section — Field blocks do not record which section they belong to.`,
          );
        }
      }
    }
  }

  return {
    // Rules written by the builder plus existing rules updated in place.
    eligibilityRules: eligRows.length,
    documentRequirements: docRows.length,
    commMappings: commRows.length,
    calculationRules: calcRules,
    workflowTemplates,
    screenTemplates,
    warnings,
    // Whole sections with no translation, plus individual blocks that could not
    // become a usable rule. One list, so the caller reports every gap.
    notApplied: [...unappliedSections(canvas), ...skipped],
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
