// ============================================
// WEEKLY PLANNING - UNIFIED TYPE DEFINITIONS
// ============================================

export enum WeeklyPlanStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  NEEDS_CHANGES = 'NEEDS_CHANGES',
  RESUBMITTED = 'RESUBMITTED',
  APPROVED = 'APPROVED',
  IN_EXECUTION = 'IN_EXECUTION',
  OUTCOME_SUBMITTED = 'OUTCOME_SUBMITTED',
  COMPLETED = 'COMPLETED',
  WITHDRAWN = 'WITHDRAWN',
  // Phase 3 — revision lifecycle
  REVISION_DRAFT = 'REVISION_DRAFT',
  REVISION_SUBMITTED = 'REVISION_SUBMITTED',
  REVISION_QUERIED = 'REVISION_QUERIED',
  REVISION_APPROVED = 'REVISION_APPROVED',
  REVISION_REJECTED = 'REVISION_REJECTED',
  SUPERSEDED = 'SUPERSEDED',
}

export enum PlanItemType {
  EMPLOYER_VISIT = 'EMPLOYER_VISIT',
  SCOUTING = 'SCOUTING',
  DESK_REVIEW = 'DESK_REVIEW',
  CALL = 'CALL',
  NOTICE_FOLLOW_UP = 'NOTICE_FOLLOW_UP',
  MEETING = 'MEETING'
}

export enum PlanItemSourceType {
  VIOLATION = 'VIOLATION',
  FOLLOW_UP = 'FOLLOW_UP',
  CASE = 'CASE',
  NOTICE = 'NOTICE',
  RISK_REVIEW = 'RISK_REVIEW',
  SCOUTING_LEAD = 'SCOUTING_LEAD',
  SUPERVISOR = 'SUPERVISOR',
  CARRY_FORWARD = 'CARRY_FORWARD',
  MANUAL = 'MANUAL'
}

export enum PlanItemExecutionStatus {
  PLANNED = 'PLANNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  RESCHEDULED = 'RESCHEDULED',
  CANCELLED = 'CANCELLED',
  NOT_DONE = 'NOT_DONE'
}

export enum PlanVisitType {
  AUDIT = 'AUDIT',
  C3_FOLLOW_UP = 'C3_FOLLOW_UP',
  PAYMENT_FOLLOW_UP = 'PAYMENT_FOLLOW_UP',
  INSPECTION = 'INSPECTION',
  RISK_BASED_AUDIT = 'RISK_BASED_AUDIT',
  COMPLAINT_INVESTIGATION = 'COMPLAINT_INVESTIGATION',
  SCOUTING = 'SCOUTING'
}

export enum PlanItemDuration {
  FULL_DAY = 'FULL_DAY',
  HALF_DAY_AM = 'HALF_DAY_AM',
  HALF_DAY_PM = 'HALF_DAY_PM',
  SHORT = 'SHORT'
}

export enum PlanItemPriority {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW'
}

export enum ScoutingType {
  UNREGISTERED_EMPLOYER = 'UNREGISTERED_EMPLOYER',
  UNDER_DECLARATION = 'UNDER_DECLARATION',
  AREA_PATROL = 'AREA_PATROL',
  MARKET_SCOUTING = 'MARKET_SCOUTING',
  ANONYMOUS_LEAD = 'ANONYMOUS_LEAD'
}

export enum ScoutingConfidence {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW'
}

export enum ScoutingLeadType {
  UNREGISTERED_EMPLOYER = 'UNREGISTERED_EMPLOYER',
  UNDER_DECLARATION = 'UNDER_DECLARATION',
  ANONYMOUS_TIP = 'ANONYMOUS_TIP',
  FIELD_OBSERVATION = 'FIELD_OBSERVATION',
  MARKET_INTEL = 'MARKET_INTEL'
}

export enum ScoutingLeadSource {
  FIELD_SCOUTING = 'FIELD_SCOUTING',
  ANONYMOUS = 'ANONYMOUS',
  REFERRAL = 'REFERRAL',
  DATA_ANALYSIS = 'DATA_ANALYSIS',
  PUBLIC_RECORD = 'PUBLIC_RECORD'
}

export enum ScoutingLeadStatus {
  NEW = 'NEW',
  UNDER_INVESTIGATION = 'UNDER_INVESTIGATION',
  CONFIRMED = 'CONFIRMED',
  DISMISSED = 'DISMISSED',
  CONVERTED_TO_VIOLATION = 'CONVERTED_TO_VIOLATION'
}

export enum PlanReviewAction {
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  RESUBMITTED = 'RESUBMITTED',
  OUTCOME_SUBMITTED = 'OUTCOME_SUBMITTED',
  OUTCOME_APPROVED = 'OUTCOME_APPROVED',
  OUTCOME_REJECTED = 'OUTCOME_REJECTED'
}

// ============================================
// INTERFACES
// ============================================

export interface WeeklyPlan {
  id: string;
  plan_number: string;
  inspector_id: string | null;
  inspector_name: string | null;
  week_start_date: string;
  week_end_date: string;
  status: string;
  submitted_date: string | null;
  approved_date: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  supervisor_comments: string | null;
  total_planned_visits: number;
  completed_visits: number;
  // Extended fields
  reviewer_id: string | null;
  reviewer_comments: string | null;
  rejected_date: string | null;
  rejection_count: number;
  carry_forward_from: string | null;
  narrative: string | null;
  outcome_narrative: string | null;
  outcome_submitted_at: string | null;
  outcome_reviewed_at: string | null;
  outcome_reviewed_by: string | null;
  // Audit
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  ce_weekly_plan_items?: WeeklyPlanItem[];
  ce_weekly_plan_reviews?: WeeklyPlanReview[];
}

export interface WeeklyPlanItem {
  id: string;
  plan_id: string;
  item_type: string;
  day_of_week: string | null;
  scheduled_date: string | null;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  duration: string | null;
  source_type: string | null;
  source_id: string | null;
  source_ref: string | null;
  employer_id: string | null;
  employer_name: string | null;
  area_name: string | null;
  territory: string | null;
  scouting_type: string | null;
  scouting_confidence: string | null;
  visit_type: string | null;
  purpose: string | null;
  priority: string;
  recommendation_score: number | null;
  is_mandatory: boolean;
  execution_status: string;
  check_in_time: string | null;
  check_in_gps_lat: number | null;
  check_in_gps_lng: number | null;
  check_out_time: string | null;
  check_out_gps_lat: number | null;
  check_out_gps_lng: number | null;
  outcome_notes: string | null;
  findings: string | null;
  rescheduled_to: string | null;
  reschedule_reason: string | null;
  not_done_reason: string | null;
  carried_forward_to: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface WeeklyPlanReview {
  id: string;
  plan_id: string;
  action: string;
  comments: string | null;
  performed_by: string;
  performed_at: string;
}

export interface ScoutingLead {
  id: string;
  lead_number: string;
  lead_type: string;
  business_name: string | null;
  location_description: string | null;
  territory: string | null;
  zone_id: string | null;
  estimated_employees: number | null;
  activity_type: string | null;
  confidence_level: string;
  source: string | null;
  source_details: string | null;
  reported_by: string | null;
  reported_date: string;
  status: string;
  assigned_to_user_id: string | null;
  investigation_notes: string | null;
  linked_violation_id: string | null;
  linked_employer_id: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScoutingLeadHistory {
  id: string;
  lead_id: string;
  old_status: string | null;
  new_status: string;
  changed_by: string;
  change_reason: string | null;
  changed_at: string;
}

export interface PlanCandidate {
  source_type: string;
  source_id: string;
  source_ref: string;
  employer_id: string | null;
  employer_name: string | null;
  territory: string | null;
  priority: string | null;
  source_status: string | null;
  financial_exposure: number | null;
  due_date: string | null;
  assigned_to_user_id: string | null;
  source_created_at: string;
  description: string;
  // Client-computed
  recommendation_score?: number;
}

// ============================================
// V2 CANDIDATE — Fact-Driven Engine
// ============================================

/** Explicit reason codes explaining why a candidate was selected */
export type CandidateReasonCode =
  | 'ESCALATED_VIOLATION'
  | 'AGING_VIOLATION'
  | 'MULTIPLE_VIOLATIONS'
  | 'OPEN_VIOLATION'
  | 'OVERDUE_FOLLOW_UP'
  | 'ARRANGEMENT_DEFAULT'
  | 'ARRANGEMENT_AT_RISK'
  | 'NOTICE_RESPONSE_DUE'
  | 'HIGH_RISK_NO_VISIT'
  | 'LAST_AUDIT_EXCEEDED'
  | 'CARRY_FORWARD_INCOMPLETE'
  | 'SCOUTING_LEAD';

/** Employer-level candidate with real compliance facts */
export interface PlanCandidateV2 {
  employer_id: string;
  employer_name: string | null;
  territory: string | null;
  candidate_source: string;
  candidate_reason: CandidateReasonCode;
  derived_priority: string;
  risk_band: string | null;
  risk_score: number | null;
  days_since_last_inspection: number | null;
  open_violation_count: number;
  escalated_violation_count: number;
  overdue_followup_count: number;
  financial_exposure: number;
  notice_days_remaining: number | null;
  any_breach_detected: boolean;
  carry_forward_count: number;
  recommendation_score: number;
}

/** A single explainability reason emitted by fn_ce_score_candidates_v3 */
export interface RecommendationReason {
  code: string;
  label: string;
  weight: number;
  detail?: string;
}

/** V3: zone-aware, audit-cycle-aware, explainable candidate (Phase 2 extended) */
export interface PlanCandidateV3 extends PlanCandidateV2 {
  zone_id: string | null;
  audit_program: string | null;
  /** Long-term employer profile score (0-100) */
  inherent_risk_score: number;
  /** Short-term planning priority score (0-100) — used by weekly planner */
  audit_priority_score: number;
  last_audit_date: string | null;
  next_due_date: string | null;
  overdue_days: number;
  violation_count: number;
  case_count: number;
  audit_cycle_due_date: string | null;
  cycle_overdue_days: number;
  is_cycle_overdue: boolean;
  recommendation_reasons: RecommendationReason[];
  /** One-line "why this employer was selected" summary for UI */
  why_selected: string | null;
  /** Phase 3 — class for ranking and gating */
  mandatory_class: 'MANDATORY' | 'PRIORITY' | 'WATCHLIST';
  /** Phase 3 — operational bucket for allocation */
  bucket:
    | 'MUST_SCHEDULE'
    | 'REACTIVE_ENFORCEMENT'
    | 'RISK_MONITORING'
    | 'ROUTINE_COVERAGE'
    | 'CAMPAIGN_INTEL';
  /** Phase 3 — estimated visit effort in hours */
  estimated_effort: number;
  /**
   * Data-quality findings recorded by the service-boundary normaliser when the
   * candidate engine returned missing or unconfigured values. Present only when
   * the record needs correction.
   */
  data_issues?: { field: string; code: string; message: string }[];
}

export type PlannerBucketKey = PlanCandidateV3['bucket'];

export interface PlannerBucketPolicy {
  id: string;
  bucket_key: PlannerBucketKey;
  label: string;
  description: string | null;
  target_pct: number;
  min_priority_score: number;
  enabled: boolean;
  sort_order: number;
}

// ============================================
// REQUEST TYPES
// ============================================

export interface CreateWeeklyPlanRequest {
  inspector_id: string;
  inspector_name: string;
  week_start_date: string;
  week_end_date: string;
  narrative?: string;
  created_by: string;
}

export interface CreatePlanItemRequest {
  plan_id: string;
  item_type: string;
  day_of_week?: string;
  scheduled_date?: string;
  scheduled_start_time?: string;
  scheduled_end_time?: string;
  duration?: string;
  source_type?: string;
  source_id?: string;
  source_ref?: string;
  employer_id?: string;
  employer_name?: string;
  area_name?: string;
  territory?: string;
  scouting_type?: string;
  scouting_confidence?: string;
  visit_type?: string;
  purpose?: string;
  priority?: string;
  recommendation_score?: number;
  is_mandatory?: boolean;
  created_by: string;
}

export interface CreateScoutingLeadRequest {
  lead_type: string;
  business_name?: string;
  location_description?: string;
  territory?: string;
  zone_id?: string;
  estimated_employees?: number;
  activity_type?: string;
  confidence_level?: string;
  source?: string;
  source_details?: string;
  reported_by: string;
  assigned_to_user_id?: string;
  gps_lat?: number;
  gps_lng?: number;
  created_by: string;
}
