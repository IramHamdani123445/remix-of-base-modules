/**
 * Canonical Compliance rule-parameter contract.
 *
 * ONE definition of every business-policy parameter that the violation scanner
 * consumes at runtime. The Rule Engine UI renders and validates from this
 * contract, and `ce-violation-scan` resolves rule parameters through the same
 * contract, so an administrator can never configure a key the engine ignores.
 *
 * Ownership rules encoded here:
 *  - Detection-rule-specific thresholds  -> ce_detection_rules.parameters
 *  - Calculation-rule-specific values    -> ce_calculation_rules.parameters
 *  - Cross-rule statutory dates/rates    -> ce_compliance_policies (policyFallback)
 *
 * There is NO country-specific fallback in code. A required parameter that is
 * absent from configuration (and from its policy owner, where one exists) is a
 * configuration error: the rule is skipped and the error is reported on the run.
 *
 * MIRROR: supabase/functions/_shared/compliance/detectionRuleParameterSpec.ts
 * must stay byte-identical (asserted by
 * src/__tests__/compliance/rule-parameter-spec-parity.test.ts).
 */

export type CeParamType = "number" | "boolean" | "string_array";

/** Columns on the active ce_compliance_policies row usable as a policy owner. */
export type CePolicyColumn =
  | "c3_submission_deadline_day"
  | "payment_due_date_day"
  | "c3_grace_period_days";

export interface CeParamSpec {
  key: string;
  label: string;
  type: CeParamType;
  /** Required parameters block rule execution when unresolved. */
  required: boolean;
  /** Legacy/alternate keys accepted when reading existing configuration. */
  aliases?: string[];
  min?: number;
  max?: number;
  integer?: boolean;
  /** Cross-rule policy column consulted before declaring a config error. */
  policyFallback?: CePolicyColumn;
  /** Business meaning shown to administrators. */
  help: string;
  /** Suggested value offered in the UI when creating a new rule. */
  suggested?: number | boolean | string[];
}

/** Technical safety cap — not business policy. See TECHNICAL_CONSTANTS below. */
export const ABSOLUTE_CAP_MONTHS = 120;

const LOOKBACK_CAP: CeParamSpec = {
  key: "lookback_months",
  label: "Lookback safety cap (months)",
  type: "number",
  required: false,
  min: 1,
  max: ABSOLUTE_CAP_MONTHS,
  integer: true,
  help:
    "Absolute upper bound on how far back periods are evaluated. The effective window is the employer's compliance start date, bounded by this cap.",
  suggested: ABSOLUTE_CAP_MONTHS,
};

/** Detection-rule parameters keyed by ce_detection_rules.trigger_event. */
export const DETECTION_PARAM_SPEC: Record<string, CeParamSpec[]> = {
  c3_deadline_passed: [
    {
      key: "grace_period_days",
      label: "Grace period (days)",
      type: "number",
      required: true,
      min: 0,
      max: 365,
      integer: true,
      help: "Days allowed after the statutory C3 due day before a filing counts as late.",
      suggested: 14,
    },
    {
      key: "submission_due_day",
      label: "C3 due day of month",
      type: "number",
      required: true,
      min: 1,
      max: 31,
      integer: true,
      policyFallback: "c3_submission_deadline_day",
      help: "Statutory C3 submission day. Owned by the active Compliance Policy; set here only to override it for this rule.",
    },
    { ...LOOKBACK_CAP },
    {
      key: "ignore_dormant",
      label: "Ignore dormant employers",
      type: "boolean",
      required: false,
      help: "Exclude employers flagged dormant from late-filing detection.",
      suggested: false,
    },
  ],
  c3_missing_30_days: [
    {
      key: "days_past_deadline",
      label: "Days past deadline",
      type: "number",
      required: true,
      min: 0,
      max: 365,
      integer: true,
      help: "Days after the C3 due day at which an unfiled period is treated as non-filing.",
      suggested: 30,
    },
    {
      key: "submission_due_day",
      label: "C3 due day of month",
      type: "number",
      required: true,
      min: 1,
      max: 31,
      integer: true,
      policyFallback: "c3_submission_deadline_day",
      help: "Statutory C3 submission day. Owned by the active Compliance Policy unless overridden here.",
    },
    {
      key: "min_missed_months",
      label: "Minimum missed periods",
      type: "number",
      required: true,
      aliases: ["min_consecutive_gaps", "minimum_missing_periods"],
      min: 1,
      max: 60,
      integer: true,
      help: "Number of missing periods an employer must accumulate before violations are raised.",
      suggested: 1,
    },
    { ...LOOKBACK_CAP },
  ],
  contribution_gap_detected: [
    {
      key: "days_past_deadline",
      label: "Days past deadline",
      type: "number",
      required: true,
      min: 0,
      max: 365,
      integer: true,
      help: "Days after the C3 due day at which a gap period is recognised.",
      suggested: 30,
    },
    {
      key: "submission_due_day",
      label: "C3 due day of month",
      type: "number",
      required: true,
      min: 1,
      max: 31,
      integer: true,
      policyFallback: "c3_submission_deadline_day",
      help: "Statutory C3 submission day. Owned by the active Compliance Policy unless overridden here.",
    },
    {
      key: "min_missed_months",
      label: "Minimum gap periods",
      type: "number",
      required: true,
      aliases: ["min_consecutive_gaps", "gap_threshold_months"],
      min: 1,
      max: 60,
      integer: true,
      help: "Number of gap periods required before contribution-gap violations are raised.",
      suggested: 2,
    },
    { ...LOOKBACK_CAP },
  ],
  payment_not_received: [
    {
      key: "grace_period_days",
      label: "Payment grace period (days)",
      type: "number",
      required: true,
      min: 0,
      max: 365,
      integer: true,
      help: "Days after the payment due day before a declared but unpaid period is flagged.",
      suggested: 0,
    },
    {
      key: "payment_due_day",
      label: "Payment due day of month",
      type: "number",
      required: true,
      min: 1,
      max: 31,
      integer: true,
      policyFallback: "payment_due_date_day",
      help: "Statutory payment day. Owned by the active Compliance Policy unless overridden here.",
    },
    { ...LOOKBACK_CAP },
  ],
  payment_partial: [
    {
      key: "min_shortfall_amount_xcd",
      label: "Minimum shortfall amount (XCD)",
      type: "number",
      required: true,
      aliases: ["minimum_shortfall_amount"],
      min: 0,
      help: "Smallest monetary shortfall between declared and paid contributions that raises a violation.",
      suggested: 50,
    },
    {
      key: "min_shortfall_percent",
      label: "Minimum shortfall (%)",
      type: "number",
      required: true,
      aliases: ["minimum_shortfall_pct"],
      min: 0,
      max: 100,
      help: "Shortfall as a percentage of the declared amount required to raise a violation.",
      suggested: 5,
    },
    { ...LOOKBACK_CAP },
  ],
  repeat_violation_check: [
    {
      key: "violation_count_threshold",
      label: "Violation count threshold",
      type: "number",
      required: true,
      aliases: ["repeat_threshold", "minimum_violations"],
      min: 2,
      max: 100,
      integer: true,
      help: "Number of qualifying unresolved violations within the rolling window that makes an employer a repeat offender.",
      suggested: 3,
    },
    {
      key: "rolling_months",
      label: "Rolling window (months)",
      type: "number",
      required: true,
      aliases: ["rolling_period_months"],
      min: 1,
      max: ABSOLUTE_CAP_MONTHS,
      integer: true,
      help: "Only violations discovered within this many months of the scan date count toward the threshold.",
      suggested: 12,
    },
    {
      key: "same_type_only",
      label: "Count same violation type only",
      type: "boolean",
      required: true,
      help: "When on, the threshold must be reached by violations of a single type rather than any mix of types.",
      suggested: true,
    },
  ],
  installment_overdue: [
    {
      key: "grace_days_after_installment",
      label: "Grace days after installment",
      type: "number",
      required: true,
      aliases: ["grace_period_days"],
      min: 0,
      max: 180,
      integer: true,
      help: "Days after a missed installment before the arrangement is treated as breached.",
      suggested: 7,
    },
  ],
  levy_omission_check: [
    {
      key: "min_outstanding_amount_xcd",
      label: "Minimum outstanding balance (XCD)",
      type: "number",
      required: true,
      aliases: ["minimum_outstanding_amount"],
      min: 0,
      help: "Outstanding arrears above which a suspected levy/severance omission is raised.",
      suggested: 500,
    },
    {
      key: "check_funds",
      label: "Funds checked",
      type: "string_array",
      required: false,
      help: "Fund codes considered by this omission check (for example LV, SV).",
    },
  ],
  employee_underreporting: [
    {
      key: "min_employee_delta",
      label: "Minimum employee shortfall (headcount)",
      type: "number",
      required: true,
      aliases: ["min_discrepancy", "minimum_employees"],
      min: 1,
      max: 10000,
      integer: true,
      help: "How many fewer employees must be reported than registered before a discrepancy violation is raised.",
      suggested: 3,
    },
    {
      key: "min_discrepancy_percent",
      label: "Minimum discrepancy (%)",
      type: "number",
      required: false,
      aliases: ["variance_threshold_pct"],
      min: 0,
      max: 100,
      help: "Optional additional test: the shortfall must also be at least this percentage of registered headcount.",
    },
  ],
  employer_cessation: [
    {
      key: "trigger_on_status",
      label: "Employer statuses treated as ceased",
      type: "string_array",
      required: true,
      help: "Employer status codes that indicate cessation (for example I, D).",
      suggested: ["I", "D"],
    },
    {
      key: "min_outstanding_amount_xcd",
      label: "Minimum outstanding balance (XCD)",
      type: "number",
      required: true,
      aliases: ["outstanding_balance_min"],
      min: 0,
      help: "Outstanding balance above which cessation without clearance is a violation.",
      suggested: 0,
    },
  ],
};

/** Calculation-rule parameters keyed by ce_calculation_rules.rule_code. */
export const CALCULATION_PARAM_SPEC: Record<string, CeParamSpec[]> = {
  "CR-003": [
    {
      key: "history_period_count",
      label: "Historical periods used",
      type: "number",
      required: true,
      min: 1,
      max: 36,
      integer: true,
      help: "How many of the employer's most recent known C3 periods form the estimated-assessment basis.",
      suggested: 3,
    },
    {
      key: "estimate_multiplier",
      label: "Estimated assessment multiplier",
      type: "number",
      required: true,
      min: 0,
      max: 10,
      help: "Multiplier applied to the average of the historical periods to produce the estimated principal.",
      suggested: 1.5,
    },
  ],
};

/**
 * Technical/runtime constants deliberately left in code — they protect the
 * worker, they are not business policy and must not become configuration.
 */
export const TECHNICAL_CONSTANTS = [
  { name: "PAGE_SIZE (1000)", reason: "PostgREST pagination size." },
  { name: "CHUNK (100)", reason: "Employer-id chunking for .in() request-URL limits." },
  { name: "insert BATCH (200)", reason: "Insert batch size." },
  { name: "batch_size floor (25)", reason: "Employer slice floor per edge invocation." },
  { name: "watchdog 30m / resume 90s", reason: "Stranded-run detection." },
  { name: "ABSOLUTE_CAP_MONTHS (120)", reason: "Defensive absolute period cap; the business window is the employer's compliance start." },
  { name: "chain retry attempts (4)", reason: "Transient edge-runtime failure retry." },
] as const;

export interface ResolvedRuleParameters {
  values: Record<string, any>;
  /** Non-empty means the rule must NOT run. */
  errors: string[];
  /** Where each resolved value came from: rule | alias:<key> | policy:<column>. */
  sources: Record<string, string>;
}

function coerce(spec: CeParamSpec, raw: any): { ok: boolean; value?: any; message?: string } {
  if (spec.type === "boolean") {
    if (typeof raw === "boolean") return { ok: true, value: raw };
    if (raw === "true" || raw === "false") return { ok: true, value: raw === "true" };
    return { ok: false, message: `${spec.key} must be true or false` };
  }
  if (spec.type === "string_array") {
    if (Array.isArray(raw) && raw.every((v) => typeof v === "string") && raw.length > 0) {
      return { ok: true, value: raw };
    }
    return { ok: false, message: `${spec.key} must be a non-empty list of codes` };
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false, message: `${spec.key} must be a number` };
  if (spec.integer && !Number.isInteger(n)) return { ok: false, message: `${spec.key} must be a whole number` };
  if (spec.min !== undefined && n < spec.min) return { ok: false, message: `${spec.key} must be >= ${spec.min}` };
  if (spec.max !== undefined && n > spec.max) return { ok: false, message: `${spec.key} must be <= ${spec.max}` };
  return { ok: true, value: n };
}

const isBlank = (v: any) => v === undefined || v === null || v === "";

/**
 * Resolve a rule's effective parameters against the canonical contract.
 * Resolution order: rule parameter -> known alias -> owning policy column.
 * No hard-coded business defaults are ever substituted.
 */
export function resolveRuleParameters(
  specs: CeParamSpec[],
  raw: Record<string, any> | null | undefined,
  policy?: Record<string, any> | null,
): ResolvedRuleParameters {
  const params = raw ?? {};
  const values: Record<string, any> = {};
  const sources: Record<string, string> = {};
  const errors: string[] = [];

  for (const spec of specs) {
    let candidate: any = params[spec.key];
    let source = "rule";

    if (isBlank(candidate) && spec.aliases) {
      for (const alias of spec.aliases) {
        if (!isBlank(params[alias])) {
          candidate = params[alias];
          source = `alias:${alias}`;
          break;
        }
      }
    }

    if (isBlank(candidate) && spec.policyFallback && policy && !isBlank(policy[spec.policyFallback])) {
      candidate = policy[spec.policyFallback];
      source = `policy:${spec.policyFallback}`;
    }

    if (isBlank(candidate)) {
      if (spec.required) {
        errors.push(
          `Missing required parameter "${spec.key}" (${spec.label})` +
            (spec.policyFallback ? ` — set it on the rule or on the active Compliance Policy (${spec.policyFallback}).` : "."),
        );
      }
      continue;
    }

    const coerced = coerce(spec, candidate);
    if (!coerced.ok) {
      errors.push(`Invalid parameter: ${coerced.message} (source: ${source})`);
      continue;
    }
    values[spec.key] = coerced.value;
    sources[spec.key] = source;
  }

  return { values, errors, sources };
}

/** UI-side validation: returns a field-keyed error map for a parameter draft. */
export function validateRuleParameterDraft(
  specs: CeParamSpec[],
  draft: Record<string, any>,
  policy?: Record<string, any> | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of specs) {
    const value = draft[spec.key];
    if (isBlank(value)) {
      const policySupplied =
        spec.policyFallback && policy && !isBlank(policy[spec.policyFallback]);
      if (spec.required && !policySupplied) out[spec.key] = "Required — no default is applied at runtime";
      continue;
    }
    const coerced = coerce(spec, value);
    if (!coerced.ok) out[spec.key] = coerced.message!;
  }
  return out;
}
