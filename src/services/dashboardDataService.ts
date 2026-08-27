import { supabase } from '@/integrations/supabase/client';

/** One cache identity per database view so every dashboard shares results. */
export const DASHBOARD_QUERY_KEYS = {
  adminKpis: ['dashboard-view', 'admin-kpis'] as const,
  financialSummary: ['dashboard-view', 'financial-summary'] as const,
  contributionTrend: ['dashboard-view', 'contribution-trend'] as const,
  benefitsDistribution: ['dashboard-view', 'benefits-distribution'] as const,
};

const DASHBOARD_REQUEST_TIMEOUT_MS = 8_000;

// ── Types ──

export interface AdminKPIs {
  total_employers: number;
  insured_persons: number;
  active_claims: number;
  compliance_issues: number;
}

export interface FinancialSummary {
  monthly_contributions: number;
  benefits_paid_mtd: number;
  net_surplus: number;
  outstanding_arrears: number;
}

export interface ContributionTrendPoint {
  month: string;
  month_key: string;
  contributions: number;
  benefits: number;
}

export interface ComplianceDistributionItem {
  name: string;
  value: number;
  color: string;
}

export interface PipelineItem {
  stage: string;
  count: number;
  fill: string;
}

export interface BenefitsDistributionItem {
  type: string;
  amount: number;
  claim_count: number;
}

export interface AlertItem {
  severity: string;
  title: string;
  detail: string;
  time_label: string;
}

export interface RecentActivityItem {
  activity_type: string;
  action: string;
  entity: string;
  occurred_at: string;
}

export interface ComplianceMetrics {
  total_employers: number;
  compliant_employers: number;
  active_violations: number;
  pending_audits: number;
}

export interface SectorComplianceItem {
  sector: string;
  total: number;
  compliant: number;
  rate: number;
}

export interface PaymentArrangementRiskItem {
  risk_status: string;
  arrangement_count: number;
  total_debt: number;
  total_paid: number;
  total_missed_payments: number;
}

export interface LegalEscalationSummaryItem {
  escalation_stage: string;
  escalation_count: number;
  total_amount_in_dispute: number;
}

export interface EmployerComplianceAlert {
  employer_id: string;
  employer_name: string;
  overall_compliance_status: string | null;
  risk_score: number | null;
  risk_band: string | null;
  active_violation_count: number | null;
  current_arrears_amount: number | null;
  last_computed_at: string | null;
}

export interface RecentViolation {
  id: string;
  violation_number: string;
  employer_name: string | null;
  employer_id: string | null;
  summary: string | null;
  severity: string | null;
  status: string | null;
  total_amount: number | null;
  created_at: string;
  due_date: string | null;
  assigned_to_name: string | null;
}

export interface UpcomingInspection {
  id: string;
  inspection_number: string;
  employer_name: string | null;
  employer_id: string | null;
  inspection_type: string;
  status: string;
  inspector_name: string | null;
  scheduled_date: string;
}

// ── Helpers ──

async function fetchView<T>(viewName: string): Promise<T[]> {
  const abortController = new AbortController();
  const timeoutId = window.setTimeout(
    () => abortController.abort(),
    DASHBOARD_REQUEST_TIMEOUT_MS,
  );
  const { data, error } = await supabase
    .from(viewName as any)
    .select('*')
    .abortSignal(abortController.signal)
    .then((result) => {
      window.clearTimeout(timeoutId);
      return result;
    }, (requestError) => {
      window.clearTimeout(timeoutId);
      throw requestError;
    });
  if (error) throw error;
  return (data ?? []) as T[];
}

async function fetchSingleRow<T>(viewName: string, fallback?: T): Promise<T> {
  const rows = await fetchView<T>(viewName);
  if (rows.length === 0) {
    if (fallback !== undefined) return fallback;
    throw new Error(`No data from ${viewName}`);
  }
  return rows[0];
}

// ── Admin / Global Dashboard ──

export const fetchAdminKPIs = () => fetchSingleRow<AdminKPIs>('dashboard_v_admin_kpis');
export const fetchFinancialSummary = () => fetchSingleRow<FinancialSummary>('dashboard_v_financial_summary');
export const fetchContributionTrend = () => fetchView<ContributionTrendPoint>('dashboard_v_contribution_trend');
export const fetchComplianceDistribution = () => fetchView<ComplianceDistributionItem>('dashboard_v_compliance_distribution');
export const fetchRegistrationPipeline = () => fetchView<PipelineItem>('dashboard_v_registration_pipeline');
export const fetchBenefitsDistribution = () => fetchView<BenefitsDistributionItem>('dashboard_v_benefits_distribution');
export const fetchActiveAlerts = () => fetchView<AlertItem>('dashboard_v_active_alerts');
export const fetchRecentActivity = () => fetchView<RecentActivityItem>('dashboard_v_recent_activity');

/** Aggregated summary for the main admin dashboard */
export async function getDashboardSummary(): Promise<{ kpis: AdminKPIs; financials: FinancialSummary }> {
  const [kpis, financials] = await Promise.all([fetchAdminKPIs(), fetchFinancialSummary()]);
  return { kpis, financials };
}

/** Recent activity feed for the main dashboard */
export const getDashboardRecentActivity = fetchRecentActivity;

// ── Compliance Dashboard ──

export const fetchComplianceMetrics = () => fetchSingleRow<ComplianceMetrics>('dashboard_v_compliance_metrics');
export const fetchSectorCompliance = () => fetchView<SectorComplianceItem>('dashboard_v_sector_compliance');

/** Full compliance dashboard summary (KPIs + sector breakdown) */
export async function getComplianceDashboardSummary(): Promise<{
  metrics: ComplianceMetrics;
  sectors: SectorComplianceItem[];
}> {
  const [metrics, sectors] = await Promise.all([fetchComplianceMetrics(), fetchSectorCompliance()]);
  return { metrics, sectors };
}

/** Recent violations — active/open/escalated, ordered newest-first */
export async function getRecentViolations(limit = 10): Promise<RecentViolation[]> {
  const { data, error } = await supabase
    .from('ce_violations')
    .select('id, violation_number, employer_name, employer_id, summary, severity, status, total_amount, created_at, due_date, assigned_to_name')
    .in('status', ['OPEN', 'ACTIVE', 'UNDER_REVIEW', 'ESCALATED'])
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as RecentViolation[];
}

/** Upcoming/pending inspections, soonest first */
export async function getRecentInspections(limit = 10): Promise<UpcomingInspection[]> {
  const { data, error } = await supabase
    .from('ce_inspections')
    .select('id, inspection_number, employer_name, employer_id, inspection_type, status, inspector_name, scheduled_date')
    .in('status', ['SCHEDULED', 'PENDING'])
    .order('scheduled_date', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as UpcomingInspection[];
}

/** High-risk or flagged employers that need attention */
export const getEmployerComplianceAlerts = () =>
  fetchView<EmployerComplianceAlert>('dashboard_v_employer_compliance_alerts');

/** Payment arrangement risk breakdown by status */
export const getPaymentArrangementRiskSummary = () =>
  fetchView<PaymentArrangementRiskItem>('dashboard_v_payment_arrangement_risk');

/** Legal escalation counts by stage */
export const getLegalEscalationSummary = () =>
  fetchView<LegalEscalationSummaryItem>('dashboard_v_legal_escalation_summary');

// ── Legacy aliases (keep existing consumers working) ──

export const fetchRecentViolations = () => getRecentViolations();
export const fetchUpcomingInspections = () => getRecentInspections();

/** Recent claims for benefits dashboard */
export async function fetchRecentClaims() {
  const { data, error } = await supabase
    .from('cl_head')
    .select('claim_number, claim_type_code, status, benefit_amount, date_received, date_approved, insured_ssn, payee_firstname, payee_surname')
    .order('date_entered', { ascending: false })
    .limit(10);
  if (error) throw error;
  return data ?? [];
}
