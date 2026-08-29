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

export type CeParamType = "number" | "boolean" | "string_array" | "date";

/** Columns on the active ce_compliance_policies row usable as a policy owner. */
export type CePolicyColumn =
  | "c3_submission_deadline_day"
  | "payment_due_date_day"
  | "c3_grace_period_days"
  | "payment_grace_period_days"
  | "deadline_fixed_day";

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
      policyFallback: "c3_grace_period_days",
      help: "Days allowed after the resolved C3 due date before a filing counts as late. Leave unset to inherit the Compliance Policy filing grace days.",
      suggested: 0,
    },
    {
      key: "submission_due_day",
      label: "C3 due day of month (fixed-day basis only)",
      type: "number",
      required: false,
      min: 1,
      max: 31,
      integer: true,
      policyFallback: "c3_submission_deadline_day",
      help: "Only used when the Compliance Policy deadline basis is 'fixed_day_of_month'. Under the current calendar-month-end basis the deadline is resolved from the calendar and this value is ignored.",
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
      help: "Additional days after the resolved obligation deadline (including policy grace) at which an unfiled period becomes Unreported C3.",
      suggested: 30,
    },
    {
      key: "submission_due_day",
      label: "C3 due day of month (fixed-day basis only)",
      type: "number",
      required: false,
      min: 1,
      max: 31,
      integer: true,
      policyFallback: "c3_submission_deadline_day",
      help: "Only used when the Compliance Policy deadline basis is 'fixed_day_of_month'. Under the current calendar-month-end basis the deadline is resolved from the calendar and this value is ignored.",
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
      help: "Additional days after the resolved obligation deadline (including policy grace) at which a gap period is recognised.",
      suggested: 30,
    },
    {
      key: "submission_due_day",
      label: "C3 due day of month (fixed-day basis only)",
      type: "number",
      required: false,
      min: 1,
      max: 31,
      integer: true,
      policyFallback: "c3_submission_deadline_day",
      help: "Only used when the Compliance Policy deadline basis is 'fixed_day_of_month'. Under the current calendar-month-end basis the deadline is resolved from the calendar and this value is ignored.",
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
      policyFallback: "payment_grace_period_days",
      help: "Days allowed after the resolved payment due date before a declared but unpaid period is flagged. Leave unset to inherit the Compliance Policy payment grace days.",
      suggested: 0,
    },
    {
      key: "payment_due_day",
      label: "Payment due day of month (fixed-day basis only)",
      type: "number",
      required: false,
      min: 1,
      max: 31,
      integer: true,
      policyFallback: "payment_due_date_day",
      help: "Only used when the Compliance Policy deadline basis is 'fixed_day_of_month'. Under the current calendar-month-end basis the payment deadline is resolved from the calendar and this value is ignored.",
    },
    { ...LOOKBACK_CAP },
  ],
  payment_partial: [
    {
      key: "grace_period_days",
      label: "Payment grace period (days)",
      type: "number",
      required: false,
      aliases: ["payment_grace_period_days", "grace_days"],
      min: 0,
      max: 180,
      integer: true,
      help: "Days after the resolved payment deadline before an unsettled shortfall is enforceable. Inherits the Compliance Policy value when left blank.",
    },
    {
      key: "payment_due_day",
      label: "Payment due day of month",
      type: "number",
      required: false,
      min: 1,
      max: 31,
      integer: true,
      help: "Only used when the Compliance Policy deadline basis is 'fixed_day_of_month'. Ignored under the calendar-month-end basis.",
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
      help: "When on, the threshold must be reached by occurrences of a single violation type rather than any mix of types. Each violation type then carries its own repeat-offender flag.",
      suggested: true,
    },
    {
      key: "require_consecutive",
      label: "Occurrences must be consecutive",
      type: "boolean",
      required: true,
      help: "St Kitts policy is OFF: qualifying occurrences inside the rolling window count even when they are not in consecutive periods.",
      suggested: false,
    },
    {
      key: "include_resolved_occurrences",
      label: "Count resolved occurrences too",
      type: "boolean",
      required: true,
      help: "When on, every qualifying occurrence discovered in the window counts, whether or not it has since been resolved. When off, only unresolved violations count.",
      suggested: true,
    },
  ],
  installment_overdue: [
    {
      key: "grace_days_after_installment",
      label: "Grace days after installment due date",
      type: "number",
      required: true,
      aliases: ["grace_period_days"],
      min: 0,
      max: 180,
      integer: true,
      help: "Days after a contractual installment due date before the arrangement is treated as breached. St Kitts policy is 0 — a missed installment breaches immediately.",
      suggested: 0,
    },
    {
      key: "reminder_lead_days",
      label: "Reminder lead time (days before installment)",
      type: "number",
      required: true,
      min: 0,
      max: 90,
      integer: true,
      help: "How many days before each installment due date the arrangement reminder is generated. A reminder never postpones the contractual due date.",
      suggested: 15,
    },
    {
      key: "partial_installment_is_breach",
      label: "Partial installment counts as a breach",
      type: "boolean",
      required: true,
      help: "When on, an installment paid short on or after its due date breaches the arrangement immediately.",
      suggested: true,
    },
  ],
  levy_omission_check: [
    {
      key: "check_funds",
      label: "Funds checked for omission",
      type: "string_array",
      required: true,
      help: "Fund codes tested on each applicable C3 person line — LV (Levy), SV (Severance), SS (Social Security). A zero or absent contribution on an applicable person/fund combination is flagged unless a valid exemption covers that person AT THAT EMPLOYER for the period.",
      suggested: ["LV", "SV"],
    },
    {
      key: "zero_threshold",
      label: "Omission threshold (XCD)",
      type: "number",
      required: true,
      min: 0,
      help: "A contribution at or below this amount on an applicable person/fund line is treated as omitted. This is a per-line test, not an employer arrears balance.",
      suggested: 0,
    },
    { ...LOOKBACK_CAP },
  ],
  registration_not_found: [
    {
      key: "registration_response_days",
      label: "Registration response period (days)",
      type: "number",
      required: true,
      min: 1,
      max: 180,
      integer: true,
      help: "Days the business is given to register after it is instructed following an inspection or scouting visit.",
      suggested: 14,
    },
    {
      key: "management_escalation_days",
      label: "Management escalation threshold (days)",
      type: "number",
      required: true,
      min: 1,
      max: 365,
      integer: true,
      help: "Days after instruction, without registration, at which the lead moves to the Compliance Management queue.",
      suggested: 21,
    },
    {
      key: "match_on_trade_name",
      label: "Match leads on trade/business name",
      type: "boolean",
      required: true,
      help: "Compare the observed trade name against the employer register before raising a lead.",
      suggested: true,
    },
    {
      key: "match_on_address",
      label: "Match leads on address",
      type: "boolean",
      required: true,
      help: "Compare the observed business address against the employer register before raising a lead.",
      suggested: true,
    },
  ],
  employee_underreporting: [
    {
      key: "use_size_tiers",
      label: "Use employer-size tiers",
      type: "boolean",
      required: true,
      help: "When on, the allowed headcount change comes from the Headcount Tier table (employer-size slabs) instead of one universal threshold.",
      suggested: true,
    },
    {
      key: "min_employee_delta",
      label: "Fallback minimum shortfall (headcount)",
      type: "number",
      required: false,
      aliases: ["min_discrepancy", "minimum_employees"],
      min: 1,
      max: 10000,
      integer: true,
      help: "Only used when employer-size tiers are switched off, or when no tier matches the employer's size.",
    },
    {
      key: "min_discrepancy_percent",
      label: "Fallback minimum discrepancy (%)",
      type: "number",
      required: false,
      aliases: ["variance_threshold_pct"],
      min: 0,
      max: 100,
      help: "Optional percentage test applied with the fallback shortfall when no tier matches.",
    },
    {
      key: "historical_baseline_periods",
      label: "Historical baseline periods",
      type: "number",
      required: true,
      min: 1,
      max: 60,
      integer: true,
      help: "How many previous reported periods form the average headcount baseline for the increase/decrease anomaly flag.",
      suggested: 6,
    },
    {
      key: "min_employer_size_for_percentage",
      label: "Minimum employer size before percentage logic",
      type: "number",
      required: true,
      min: 0,
      max: 10000,
      integer: true,
      help: "Employers smaller than this are tested on absolute change only — a percentage swing on a tiny payroll is not meaningful.",
      suggested: 5,
    },
    {
      key: "historical_change_percent",
      label: "Historical change threshold (%)",
      type: "number",
      required: true,
      min: 0,
      max: 1000,
      help: "Percentage increase or decrease against the historical baseline that raises a headcount anomaly review flag.",
      suggested: 30,
    },
    {
      key: "historical_change_absolute",
      label: "Historical change threshold (headcount)",
      type: "number",
      required: true,
      min: 1,
      max: 10000,
      integer: true,
      help: "Absolute increase or decrease against the historical baseline that raises a headcount anomaly review flag.",
      suggested: 5,
    },
  ],
  wage_underreporting: [
    {
      key: "enable_sector_benchmark",
      label: "Enable sector / minimum-wage benchmarking",
      type: "boolean",
      required: true,
      help: "Compare declared wages against the sector benchmark register (calculated minimum/average, or an authorised override).",
      suggested: true,
    },
    {
      key: "enable_historical_variance",
      label: "Enable historical wage variance",
      type: "boolean",
      required: true,
      help: "Compare declared wages against the employer's own recent history to catch sudden inflation or deflation, such as an accidental extra zero.",
      suggested: true,
    },
    {
      key: "benchmark_variance_percent",
      label: "Sector benchmark variance (%)",
      type: "number",
      required: true,
      min: 0,
      max: 100,
      help: "How far below the effective sector benchmark a declared wage must fall before a wage anomaly review flag is raised.",
      suggested: 30,
    },
    {
      key: "historical_variance_percent",
      label: "Historical wage variance (%)",
      type: "number",
      required: true,
      aliases: ["historical_variance_threshold_percent"],
      min: 0,
      max: 10000,
      help: "Percentage swing against the employer's own wage baseline (up or down) that raises a wage anomaly review flag.",
      suggested: 30,
    },
    {
      key: "lookback_periods",
      label: "Wage baseline periods",
      type: "number",
      required: true,
      min: 1,
      max: 60,
      integer: true,
      help: "How many previous periods form the employer's own wage baseline.",
      suggested: 6,
    },
    {
      key: "benchmark_recalc_months",
      label: "Benchmark recalculation cadence (months)",
      type: "number",
      required: true,
      min: 1,
      max: 24,
      integer: true,
      help: "How often sector benchmarks are recalculated. A benchmark older than this is reported as stale on the run.",
      suggested: 1,
    },
  ],
  severance_omission_check: [
    {
      key: "check_funds",
      label: "Funds checked for omission",
      type: "string_array",
      required: true,
      help: "Fund codes tested on each applicable C3 person line — LV (Levy), SV (Severance), SS (Social Security). A zero or absent contribution on an applicable person/fund combination is flagged unless a valid exemption covers that person AT THAT EMPLOYER for the period.",
      suggested: ["SV"],
    },
    {
      key: "zero_threshold",
      label: "Omission threshold (XCD)",
      type: "number",
      required: true,
      min: 0,
      help: "A contribution at or below this amount on an applicable person/fund line is treated as omitted. This is a per-line test, not an employer arrears balance.",
      suggested: 0,
    },
    { ...LOOKBACK_CAP },
  ],
  employer_cessation: [
    {
      key: "trigger_on_status",
      label: "Employer statuses treated as cessation/closure",
      type: "string_array",
      required: true,
      help: "Authoritative employer statuses that indicate cessation or closure — ACTIVE, INACTIVE, CLOSED, CEASED.",
      suggested: ["CLOSED", "CEASED", "INACTIVE"],
    },
    {
      key: "require_clearance_certificate",
      label: "Require a clearance certificate",
      type: "boolean",
      required: true,
      help: "When on, a cessation recorded without a clearance certificate reference is improper even when nothing is outstanding.",
      suggested: true,
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
  self_employed_non_compliance: [
    {
      key: "include_voluntary",
      label: "Include voluntary contributors",
      type: "boolean",
      required: true,
      help: "Apply the same obligation timeline to voluntary contributors as to self-employed persons.",
      suggested: true,
    },
    {
      key: "consolidate_reminders",
      label: "Consolidate multi-period reminders",
      type: "boolean",
      required: true,
      help: "Send one communication covering every outstanding period rather than one per period.",
      suggested: true,
    },
    {
      key: "auto_legal_escalation",
      label: "Automatic legal escalation",
      type: "boolean",
      required: true,
      help: "St Kitts policy is OFF: self-employed cases are never sent to Legal automatically. Legal referral stays a manual action.",
      suggested: false,
    },
    {
      key: "over_contribution_creates_credit",
      label: "Over-contribution becomes a credit",
      type: "boolean",
      required: true,
      help: "Over-contribution is recorded as a credit/offset on the contributor's account rather than a cash refund. Refund handling is a Finance hand-off.",
      suggested: true,
    },
    {
      key: "flag_employer_overlap",
      label: "Flag periods also reported by an employer",
      type: "boolean",
      required: true,
      help: "Raise a review flag when the same person and period is also reported by an employer, so Compliance can suppress the self-employed obligation where appropriate.",
      suggested: true,
    },
    { ...LOOKBACK_CAP },
  ],
};


/**
 * Calculation-rule parameters keyed by ce_calculation_rules.rule_code.
 *
 * Checkpoint C ownership:
 *  - CR-001 (generic late-payment penalty) is RETIRED. The client does not
 *    want a blanket penalty for lateness; fines/penalties come only from the
 *    fund-specific rules CR-005 (SS), CR-006 (Levy) and CR-007 (Severance).
 *    It therefore has no parameter contract and must stay disabled.
 *  - CR-004 (under-declaration surcharge) is NOT activated. Its contract is
 *    kept so the capability stays configurable, but the rule is disabled and
 *    no runtime consumer may execute it.
 */
export const CALCULATION_PARAM_SPEC: Record<string, CeParamSpec[]> = {
  "CR-002": [
    {
      key: "annual_rate_percent",
      label: "Annual interest rate (%)",
      type: "number",
      required: true,
      min: 0,
      max: 100,
      help: "Nominal annual interest rate charged on overdue contribution balances. St Kitts & Nevis currently operates at 5%.",
      suggested: 5,
    },
    {
      key: "compounding_basis",
      label: "Compounding basis",
      type: "string_array",
      required: true,
      help: "One of monthly_compound, monthly_simple or annual_compound. St Kitts & Nevis compounds monthly.",
      suggested: ["monthly_compound"],
    },
    {
      key: "minimum_interest_principal",
      label: "Minimum balance attracting interest (EC$)",
      type: "number",
      required: true,
      min: 0,
      help: "Outstanding balances below this amount never attract interest. St Kitts & Nevis currently uses EC$10.",
      suggested: 10,
    },
    {
      key: "accrual_start",
      label: "Accrual anchor",
      type: "string_array",
      required: true,
      help: "grace_end (interest starts after the statutory grace period) or due_date. Dates always come from the obligation resolver — interest never recomputes the calendar.",
      suggested: ["grace_end"],
    },
    {
      key: "max_accrual_months",
      label: "Maximum accrual months",
      type: "number",
      required: false,
      min: 1,
      max: ABSOLUTE_CAP_MONTHS,
      integer: true,
      help: "Optional cap on how many months of interest a single balance can accrue. NOT CLIENT APPROVED — leave unset until the CR-002-RETROACTIVITY decision is confirmed. No default is applied at runtime.",
    },
    {
      key: "max_interest_amount",
      label: "Maximum interest per balance (EC$)",
      type: "number",
      required: false,
      min: 0,
      help: "Optional ceiling on the cumulative interest a single balance can attract. Disabled unless approved (CR-002-RETROACTIVITY). No default is applied at runtime.",
    },
    {
      key: "interest_effective_from",
      label: "Interest effective from (date)",
      type: "date",
      required: false,
      help: "Date from which the 5% interest policy is in force. Liabilities whose accrual anchor predates this date are governed by the retroactivity mode below. Unset means no approved effective date exists yet.",
    },
    {
      key: "apply_to_pre_existing_liabilities",
      label: "Retroactivity mode for pre-existing liabilities",
      type: "string_array",
      required: false,
      help:
        "Governed policy mode: not_approved (default behaviour — pre-effective liabilities are classified INTEREST_POLICY_REVIEW_REQUIRED and never posted in production), " +
        "exclude_pre_effective (accrue only from the effective date forward), or apply_retrospectively (accrue from the original statutory anchor). " +
        "Open business decision CR-002-RETROACTIVITY.",
    },
  ],
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
    {
      key: "minimum_history_periods",
      label: "Minimum usable periods before estimating",
      type: "number",
      required: true,
      min: 1,
      max: 36,
      integer: true,
      help: "Fewest valid periods required before an estimate may be raised. Below this the case goes to the review/exception queue instead of being estimated from unusable data.",
      suggested: 2,
    },
    {
      key: "exclude_zero_periods",
      label: "Exclude nil/negative periods",
      type: "boolean",
      required: true,
      help: "Leave periods with no declared liability out of the estimate basis rather than averaging them in.",
      suggested: true,
    },
    {
      key: "exclude_amended_periods",
      label: "Exclude amended periods",
      type: "boolean",
      required: true,
      help: "Leave amended C3 periods out of the estimate basis.",
      suggested: false,
    },
    {
      key: "exclude_statuses",
      label: "Excluded submission statuses",
      type: "string_array",
      required: true,
      help: "Source C3 statuses that disqualify a period from the estimate basis.",
      suggested: ["DRAFT", "REJECTED", "CANCELLED"],
    },
    {
      key: "outlier_deviation_multiple",
      label: "Outlier tolerance (× median)",
      type: "number",
      required: false,
      min: 1,
      max: 100,
      help: "Exclude a period whose declared liability deviates from the median of the candidates by more than this multiple. Leave unset to disable outlier screening.",
    },
  ],
  "CR-004": [
    {
      key: "surcharge_rate_percent",
      label: "Under-declaration surcharge (%)",
      type: "number",
      required: true,
      min: 0,
      max: 100,
      help: "NOT ACTIVE. The client has not approved an under-declaration surcharge; CR-004 stays disabled. The contract exists only so the capability remains configurable if Finance later approves it.",
    },
  ],
  "CR-008": [
    {
      key: "allocation_class_order",
      label: "Payment allocation order",
      type: "string_array",
      required: true,
      help: "Order in which a payment settles liability classes. Client direction: contributions first (oldest outstanding period first), then fines/penalties. Interest is accounted separately.",
      suggested: ["contribution", "fine", "penalty"],
    },
    {
      key: "within_class_order",
      label: "Order within a class",
      type: "string_array",
      required: true,
      help: "oldest_period_first or newest_period_first. Client direction: oldest outstanding first.",
      suggested: ["oldest_period_first"],
    },
    {
      key: "interest_settlement",
      label: "Interest settlement",
      type: "string_array",
      required: true,
      help: "separate keeps interest out of the contribution waterfall and settles it as its own component; inline lets it take a position in the class order.",
      suggested: ["separate"],
    },
    {
      key: "respect_partial_payment_authority",
      label: "Honour approved partial-payment allocations",
      type: "boolean",
      required: true,
      help: "Allocations approved through the B1 partial-payment workflow are applied exactly and are never overridden by the generic allocation engine.",
      suggested: true,
    },
    {
      key: "over_payment_creates_credit",
      label: "Over-payment becomes a credit",
      type: "boolean",
      required: true,
      help: "Money left after all liabilities are settled is recorded as a traceable credit that offsets future liabilities. Cash refunds remain a later Finance process.",
      suggested: true,
    },
    {
      key: "allow_cross_fund_transfer",
      label: "Allow cross-fund transfer",
      type: "boolean",
      required: true,
      help: "OPEN — awaiting Finance/CFO approval. Must remain false: a credit in one fund may not be moved to another fund automatically. Enabling it requires privileged approval and is fully audited.",
      suggested: false,
    },
  ],
};

/** Calculation rules that must never execute at runtime in this deployment. */
export const RETIRED_CALCULATION_RULES: Record<string, string> = {
  "CR-001":
    "Retired at Checkpoint C — the client does not require a generic universal late-payment penalty. Fines/penalties come only from the applicable fund-specific rules (CR-005/CR-006/CR-007).",
  "CR-004":
    "Not activated — the proposed 2.5% under-declaration surcharge is not approved. The capability stays configurable but disabled.",
};

export function isRetiredCalculationRule(ruleCode: string): boolean {
  return Object.prototype.hasOwnProperty.call(RETIRED_CALCULATION_RULES, ruleCode);
}


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
  if (spec.type === "date") {
    const s = String(raw).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) {
      return { ok: false, message: `${spec.key} must be a calendar date (YYYY-MM-DD)` };
    }
    return { ok: true, value: s };
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
