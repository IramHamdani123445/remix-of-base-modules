// ============================================================
// BN Calculation Engine - Types & Contracts
// ============================================================

// --- Engine Layers ---
export type BnEngineLayer =
  | 'ELIGIBILITY'
  | 'CONTRIBUTION_WINDOW'
  | 'WAGE_AGGREGATION'
  | 'FORMULA'
  | 'BENEFICIARY_ALLOCATION'
  | 'PAYMENT_SCHEDULE'
  | 'VALIDATION'
  | 'OVERRIDE'
  | 'SIMULATION'
  | 'COMPARISON';

export type BnCalcRunMode = 'LIVE' | 'SIMULATION' | 'COMPARISON';
export type BnCalcRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'OVERRIDDEN';
export type BnTraceSeverity = 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
export type BnOverrideApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

// --- Input Contract ---
export interface BnCalcEngineInput {
  claimId: string;
  ssn: string;
  productId: string;
  productVersionId: string;
  claimDate: string;
  countryCode: string;
  mode: BnCalcRunMode;
  /** Authenticated user_code that triggered the run (required at runtime — see requireUserCode). */
  triggeredBy?: string;
  // optional overrides for simulation
  overrideParams?: Record<string, unknown>;
  // legacy snapshot id for comparison mode
  legacySnapshotId?: string;
}

// --- Output Contract ---
export interface BnCalcEngineOutput {
  runId: string;
  status: BnCalcRunStatus;
  /**
   * Whether the SSN exists in the member register, and whether it has any
   * contribution history. The simulator showed a confident amount for an SSN
   * with no member record at all, because a flat-amount formula does not
   * depend on member data and so never noticed. Reported so the figures can be
   * labelled for what they are.
   */
  subject?: {
    ssn: string;
    memberFound: boolean;
    hasContributionHistory: boolean;
  };
  eligibility: BnEligibilityResult;
  contributionWindow: BnContributionWindow;
  wageAggregation: BnWageAggregation;
  formulaResult: BnFormulaResult;
  beneficiarySplits: BnBeneficiarySplit[];
  paymentSchedule: BnPaymentScheduleEntry[];
  validation: BnValidationResult;
  trace: BnCalcTraceEntry[];
  comparison?: BnLegacyComparison;
  variables: Record<string, unknown>;
  startedAt: string;
  completedAt: string;
}

// --- Layer Results ---

export interface BnEligibilityResult {
  passed: boolean;
  rules: BnEligibilityRuleResult[];
  overrideApplied: boolean;
}

export interface BnEligibilityRuleResult {
  ruleCode: string;
  ruleName: string;
  ruleGroup: string;
  passed: boolean;
  actualValue: unknown;
  requiredValue: unknown;
  failAction: 'REJECT' | 'WARN' | 'REFER';
  message: string;
  severity: BnTraceSeverity;
}

export interface BnContributionWindow {
  fromDate: string;
  toDate: string;
  windowType: string; // e.g. 'LAST_52_WEEKS', 'LAST_3_YEARS', 'LIFETIME'
  totalWeeks: number;
  qualifyingWeeks: number;
  requiredWeeks: number;
  met: boolean;
}

export interface BnWageAggregation {
  totalWages: number;
  totalWeeks: number;
  averageWeeklyWage: number;
  averageAnnualWage: number;
  wagesCapped: boolean;
  cappedAmount?: number;
  bestPeriod?: { from: string; to: string; amount: number };
}

export interface BnFormulaResult {
  calcType: string; // FORMULA, TIER_TABLE, FLAT_RATE, PERCENTAGE, LOOKUP
  formulaExpression: string;
  steps: BnFormulaStep[];
  rawResult: number;
  afterMinMax: number;
  afterRounding: number;
  finalWeeklyRate: number;
  finalMonthlyRate: number;
  finalLumpSum: number;
  finalAnnualAmount: number;
  roundingRule: string;
  minApplied: boolean;
  maxApplied: boolean;
  minAmount?: number;
  maxAmount?: number;
}

export interface BnFormulaStep {
  stepNumber: number;
  description: string;
  formula: string;
  inputs: Record<string, number>;
  result: number;
}

export interface BnBeneficiarySplit {
  beneficiarySSN: string;
  beneficiaryName: string;
  relationship: string;
  percentage: number;
  amount: number;
  startDate: string;
  endDate?: string;
  conditions?: string;
}

export interface BnPaymentScheduleEntry {
  sequenceNumber: number;
  paymentDate: string;
  periodFrom: string;
  periodTo: string;
  grossAmount: number;
  deductions: number;
  netAmount: number;
  paymentType: 'ONE_OFF' | 'WEEKLY' | 'MONTHLY';
  isRetroactive: boolean;
}

// --- Validation ---

export interface BnValidationResult {
  isValid: boolean;
  errors: BnValidationMessage[];
  warnings: BnValidationMessage[];
}

export interface BnValidationMessage {
  code: string;
  layer: BnEngineLayer;
  field?: string;
  message: string;
  severity: BnTraceSeverity;
  ruleCode?: string;
}

// --- Trace ---

export interface BnCalcTraceEntry {
  id?: string;
  calcRunId?: string;
  engineLayer: BnEngineLayer;
  stepNumber: number;
  stepCode: string;
  stepLabel: string;
  ruleCode?: string;
  formulaExpression?: string;
  inputs: Record<string, unknown>;
  outputValue?: number;
  outputText?: string;
  passed?: boolean;
  severity: BnTraceSeverity;
  message?: string;
  durationMs?: number;
}

// --- Override ---

export interface BnCalcOverride {
  id: string;
  calcRunId: string;
  overrideTarget: string;
  fieldPath: string;
  originalValue: string;
  overrideValue: string;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  approvalStatus: BnOverrideApprovalStatus;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
}

// --- Legacy Comparison ---

export interface BnLegacyComparison {
  legacyWeeklyRate?: number;
  legacyMonthlyRate?: number;
  legacyLumpSum?: number;
  legacyRawOutput: Record<string, unknown>;
  diffs: BnComparisonDiff[];
  overallMatch: boolean;
  matchPercentage: number;
}

export interface BnComparisonDiff {
  field: string;
  label: string;
  engineValue: unknown;
  legacyValue: unknown;
  match: boolean;
  tolerancePercent?: number;
}

// --- Simulation Preset ---

export interface BnCalcSimulationPreset {
  id: string;
  presetName: string;
  description?: string;
  productId?: string;
  productVersionId?: string;
  inputParameters: Record<string, unknown>;
  expectedOutput: Record<string, unknown>;
  countryCode: string;
  isActive: boolean;
  enteredBy?: string;
  enteredAt: string;
  modifiedBy?: string;
  modifiedAt: string;
}

// --- Legacy Snapshot ---

export interface BnCalcLegacySnapshot {
  id: string;
  claimId: string;
  legacySystem: string;
  legacyClaimRef?: string;
  legacyWeeklyRate?: number;
  legacyMonthlyRate?: number;
  legacyLumpSum?: number;
  legacyRawOutput: Record<string, unknown>;
  capturedAt: string;
  capturedBy?: string;
  notes?: string;
}

// --- DB Row type (matches bn_calc_run table) ---

export interface BnCalcRun {
  id: string;
  claim_id: string;
  product_version_id?: string;
  run_mode: BnCalcRunMode;
  run_status: BnCalcRunStatus;
  triggered_by?: string;
  started_at: string;
  completed_at?: string;
  eligibility_passed?: boolean;
  eligibility_results: unknown[];
  contribution_window: Record<string, unknown>;
  wage_summary: Record<string, unknown>;
  weekly_rate?: number;
  monthly_rate?: number;
  lump_sum?: number;
  annual_amount?: number;
  beneficiary_splits: unknown[];
  payment_schedule: unknown[];
  payment_frequency?: string;
  payment_start_date?: string;
  payment_end_date?: string;
  variables_snapshot: Record<string, unknown>;
  errors: unknown[];
  warnings: unknown[];
  override_applied: boolean;
  override_by?: string;
  override_reason?: string;
  override_approved_by?: string;
  override_approved_at?: string;
  legacy_result?: Record<string, unknown>;
  comparison_diff?: Record<string, unknown>;
  comparison_match?: boolean;
  country_code: string;
  entered_by?: string;
  entered_at: string;
  modified_by?: string;
  modified_at: string;
}

// --- Formula Configuration Shapes (stored in bn_calculation_rule.formula_definition) ---

export interface BnFormulaConfig {
  type: 'PERCENTAGE_AWW' | 'PERCENTAGE_AAW' | 'FLAT_GRANT' | 'CONTRIBUTION_SCHEDULE' | 'TIER_TABLE' | 'CUSTOM';
  expression?: string; // e.g. "avg_weekly_wage * rate / 100"
  rate?: number; // percentage
  flatAmount?: number;
  tiers?: BnFormulaTier[];
  scheduleRules?: BnScheduleRule[];
  minAmount?: number;
  maxAmount?: number;
  waitingPeriodDays?: number;
  retroactiveLimitDays?: number;
  roundingRule: 'ROUND_HALF_UP' | 'ROUND_DOWN' | 'ROUND_UP' | 'ROUND_NEAREST_CENT' | 'ROUND_NEAREST_DOLLAR';
  paymentConstruction: 'ONE_OFF' | 'WEEKLY' | 'MONTHLY';
  maxDurationWeeks?: number;
  maxDurationMonths?: number;
}

export interface BnFormulaTier {
  fromWeeks: number;
  toWeeks: number | null;
  rate: number;
  flatAmount?: number;
}

export interface BnScheduleRule {
  weekRange: [number, number | null];
  rate: number;
  description: string;
}

// --- Sample Formula Config Examples ---
export const SAMPLE_FORMULA_CONFIGS: Record<string, BnFormulaConfig> = {
  SICKNESS_BENEFIT: {
    type: 'PERCENTAGE_AWW',
    expression: 'avg_weekly_wage * 0.6667',
    rate: 66.67,
    minAmount: 50,
    maxAmount: 500,
    waitingPeriodDays: 3,
    retroactiveLimitDays: 180,
    roundingRule: 'ROUND_NEAREST_CENT',
    paymentConstruction: 'WEEKLY',
    maxDurationWeeks: 26,
  },
  MATERNITY_GRANT: {
    type: 'FLAT_GRANT',
    flatAmount: 500,
    roundingRule: 'ROUND_NEAREST_DOLLAR',
    paymentConstruction: 'ONE_OFF',
  },
  AGE_PENSION: {
    type: 'CONTRIBUTION_SCHEDULE',
    scheduleRules: [
      { weekRange: [500, 749], rate: 16, description: '500-749 weeks: 16% of avg annual wage' },
      { weekRange: [750, 999], rate: 25, description: '750-999 weeks: 25% of avg annual wage' },
      { weekRange: [1000, null], rate: 40, description: '1000+ weeks: 40% of avg annual wage' },
    ],
    minAmount: 200,
    roundingRule: 'ROUND_NEAREST_CENT',
    paymentConstruction: 'MONTHLY',
  },
  FUNERAL_GRANT: {
    type: 'FLAT_GRANT',
    flatAmount: 2500,
    roundingRule: 'ROUND_NEAREST_DOLLAR',
    paymentConstruction: 'ONE_OFF',
  },
  SURVIVORS_PENSION: {
    type: 'PERCENTAGE_AAW',
    expression: 'annual_amount * rate / 100',
    rate: 50,
    minAmount: 150,
    roundingRule: 'ROUND_NEAREST_CENT',
    paymentConstruction: 'MONTHLY',
  },
};
