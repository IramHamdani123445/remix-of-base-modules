/**
 * Eligibility rule message rendering.
 *
 * Every message an officer reads about a rule comes from that rule's own
 * configuration, not from a string baked into the evaluator. The catalogue
 * already carries the wording — of 250 active rules, 235 set `fail_message`,
 * 106 set `message_template` and 79 set `legislative_reference` — but the
 * evaluator only ever used `fail_message`, so the configured wording and the
 * statutory citation never reached the screen.
 *
 * A message is returned as three parts rather than one blob, so a screen can
 * lay them out instead of parsing a sentence apart:
 *
 *   requirement — what the rule demands, in the wording configured for it
 *   detail      — what the claimant's record actually showed
 *   reference   — the statutory basis, when one is configured
 *
 * `message_template` and `fail_message` may contain placeholders. Live
 * templates are mostly plain statements, so a template with no placeholder
 * renders unchanged and the comparison is carried in `detail`.
 *
 *   {{actual}} {{expected}} {{min}} {{max}} {{field}} {{operator}} {{unit}}
 *   {{rule_code}} {{rule_name}} {{claim_date}} {{ssn}} {{reference}}
 */

export type RuleMessageOutcome = 'PASS' | 'FAIL' | 'UNEVALUATED' | 'INFO';

/** Rule configuration this renderer reads. All fields optional. */
export interface MessageRule {
  rule_code: string;
  rule_name: string;
  fail_message?: string | null;
  message_template?: string | null;
  unit?: 'DAYS' | 'WEEKS' | 'MONTHS' | 'YEARS' | null;
  legislative_reference?: string | null;
  legal_reference?: string | null;
  statutory_basis?: string | null;
  source_section?: string | null;
}

export interface MessageContext {
  /** Registry label of the field the rule reads, e.g. "Age at claim date". */
  fieldLabel?: string | null;
  operator?: string | null;
  actual?: unknown;
  expected?: unknown;
  /** Set for a BETWEEN comparison. */
  min?: unknown;
  max?: unknown;
  claimDate?: string | null;
  ssn?: string | null;
  /** Why the rule could not be evaluated — UNEVALUATED only. */
  unevaluatedReason?: string | null;
}

export interface RenderedRuleMessage {
  requirement: string;
  detail: string | null;
  reference: string | null;
  /** requirement + detail, for places that can only show one line. */
  text: string;
}

const UNIT_WORD: Record<string, [string, string]> = {
  DAYS: ['day', 'days'],
  WEEKS: ['week', 'weeks'],
  MONTHS: ['month', 'months'],
  YEARS: ['year', 'years'],
};

/** Formats a value, appending the rule's configured unit when it has one. */
export function formatRuleValue(value: unknown, unit?: MessageRule['unit']): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.map((v) => formatRuleValue(v, unit)).join(' – ');

  const rounded = typeof value === 'number' && !Number.isInteger(value)
    ? Math.round(value * 100) / 100
    : value;

  const words = unit ? UNIT_WORD[unit] : undefined;
  if (words && typeof rounded === 'number') {
    return `${rounded} ${Math.abs(rounded) === 1 ? words[0] : words[1]}`;
  }
  return String(rounded);
}

/** Human-readable form of the comparison operators used in rule definitions. */
const OPERATOR_WORDS: Record<string, string> = {
  '>=': 'at least',
  '>': 'more than',
  '<=': 'at most',
  '<': 'less than',
  '==': 'exactly',
  '=': 'exactly',
  '!=': 'not',
  IN: 'one of',
  BETWEEN: 'between',
};

/**
 * The statutory citation, preferring the most specific field configured.
 * Nothing is invented — a rule with no citation returns null.
 */
export function ruleReference(rule: MessageRule): string | null {
  const parts = [
    rule.legislative_reference || rule.legal_reference || rule.statutory_basis,
    rule.source_section,
  ].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.length > 0 ? parts.join(', ') : null;
}

function substitute(template: string, rule: MessageRule, ctx: MessageContext): string {
  const map: Record<string, string> = {
    actual: formatRuleValue(ctx.actual, rule.unit),
    expected: formatRuleValue(ctx.expected, rule.unit),
    min: formatRuleValue(ctx.min, rule.unit),
    max: formatRuleValue(ctx.max, rule.unit),
    field: ctx.fieldLabel ?? '—',
    operator: ctx.operator ?? '—',
    unit: rule.unit ? UNIT_WORD[rule.unit]?.[1] ?? rule.unit : '',
    rule_code: rule.rule_code,
    rule_name: rule.rule_name,
    claim_date: ctx.claimDate ?? '—',
    ssn: ctx.ssn ?? '—',
    reference: ruleReference(rule) ?? '',
  };
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, name: string) => {
    const key = name.toLowerCase();
    return key in map ? map[key] : whole;
  });
}

/**
 * The requirement, in the rule's own configured wording. Falls back to a
 * sentence built from the field label, operator and expected value — used only
 * when the rule configures no wording at all.
 */
function requirementText(rule: MessageRule, ctx: MessageContext, outcome: RuleMessageOutcome): string {
  const configured = outcome === 'FAIL'
    ? rule.fail_message || rule.message_template
    : rule.message_template || rule.fail_message;
  if (configured && configured.trim()) return substitute(configured.trim(), rule, ctx);

  const label = ctx.fieldLabel || rule.rule_name || rule.rule_code;
  if (ctx.min !== undefined && ctx.max !== undefined && ctx.min !== null && ctx.max !== null) {
    return `${label} must be between ${formatRuleValue(ctx.min, rule.unit)} and ${formatRuleValue(ctx.max, rule.unit)}`;
  }
  if (ctx.expected !== undefined && ctx.expected !== null) {
    const word = OPERATOR_WORDS[String(ctx.operator ?? '')] ?? String(ctx.operator ?? 'must be');
    return `${label} must be ${word} ${formatRuleValue(ctx.expected, rule.unit)}`;
  }
  return label;
}

/** What the claimant's record actually showed. */
function detailText(rule: MessageRule, ctx: MessageContext, outcome: RuleMessageOutcome): string | null {
  if (outcome === 'UNEVALUATED') {
    return ctx.unevaluatedReason
      ? `Not checked — ${ctx.unevaluatedReason}.`
      : 'Not checked.';
  }
  if (ctx.actual === undefined || ctx.actual === null) return null;
  const label = ctx.fieldLabel || 'Recorded value';
  return `${label}: ${formatRuleValue(ctx.actual, rule.unit)}`;
}

export function renderRuleMessage(
  rule: MessageRule,
  outcome: RuleMessageOutcome,
  ctx: MessageContext = {},
): RenderedRuleMessage {
  const requirement = requirementText(rule, ctx, outcome);
  const detail = detailText(rule, ctx, outcome);
  const reference = ruleReference(rule);
  return {
    requirement,
    detail,
    reference,
    text: detail ? `${requirement} — ${detail}` : requirement,
  };
}

/**
 * A single sentence summarising why a step is blocked, built from the rules'
 * own configured wording rather than a list of rule codes. A code such as
 * "AGEG-CONTRIB-MIN" tells a counter officer nothing; "Claimant must have
 * between 50 and 499 contribution weeks — Total contribution weeks: 6" does.
 */
export function summariseBlockingRules(
  rendered: { rule_code: string; requirement: string; detail: string | null }[],
  limit = 3,
): string {
  const shown = rendered.slice(0, limit).map((r) => (r.detail ? `${r.requirement} (${r.detail})` : r.requirement));
  const more = rendered.length - shown.length;
  return shown.join('; ') + (more > 0 ? `; and ${more} more` : '');
}
