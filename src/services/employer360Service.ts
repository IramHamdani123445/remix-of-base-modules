import { supabase } from '@/integrations/supabase/client';

export interface Employer360Summary {
  employer_id: string;
  employer_name: string;
  status: string | null;
  office_code: string | null;
  village_code: string | null;
  registration_date: string | null;
  males_employed: number | null;
  females_employed: number | null;
}

export interface Employer360Filing {
  regno: string;
  employer_name: string | null;
  total_filings_12m: number | null;
  missed_filings_12m: number | null;
  last_filing_period: string | null;
  last_filing_date: string | null;
  is_current: boolean | null;
}

export interface Employer360Arrears {
  regno: string;
  current_arrears: number | null;
  current_penalty: number | null;
  total_outstanding: number | null;
  has_arrears: boolean | null;
}

export interface Employer360Payment {
  regno: string;
  total_payments_12m: number | null;
  total_amount_12m: number | null;
  last_payment_date: string | null;
  has_recent_payment: boolean | null;
}

export interface Employer360Legal {
  regno: string;
  active_escalation_count: number | null;
  active_suit_count: number | null;
  latest_stage: string | null;
  has_active_legal: boolean | null;
}

export interface Employer360Workforce {
  regno: string;
  registered_males: number | null;
  registered_females: number | null;
  registered_total: number | null;
  last_reported_employees: number | null;
  last_reported_period: string | null;
  employee_delta: number | null;
}

export interface Employer360Risk {
  id: string;
  employer_id: string;
  total_score: number | null;
  risk_band: string | null;
  arrears_score: number | null;
  violation_score: number | null;
  filing_score: number | null;
  payment_behavior_score: number | null;
  legal_history_score: number | null;
  last_calculated_at: string | null;
  override_band: string | null;
  override_reason: string | null;
}

export interface Employer360TimelineEvent {
  employer_id: string;
  event_date: string;
  event_type: string;
  event_category: string;
  title: string;
  description: string;
  status: string | null;
  reference_id: string;
  source_table: string;
}

// ── Fetch employer master data ──
export async function fetchEmployerMaster(employerId: string): Promise<Employer360Summary | null> {
  const { data, error } = await supabase
    .from('er_master')
    .select('regno, name, status, office_code, village_code, registration_date, males_employed, females_employed')
    .eq('regno', employerId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    employer_id: data.regno,
    employer_name: data.name || 'Unknown',
    status: data.status,
    office_code: data.office_code,
    village_code: data.village_code,
    registration_date: data.registration_date,
    males_employed: data.males_employed,
    females_employed: data.females_employed,
  };
}

// ── Fact-layer views ──
export async function fetchEmployerFiling(employerId: string): Promise<Employer360Filing | null> {
  const { data } = await supabase
    .from('ce_v_employer_filing_status')
    .select('*')
    .eq('regno', employerId)
    .maybeSingle();
  return (data as unknown as Employer360Filing) ?? null;
}

export async function fetchEmployerArrears(employerId: string): Promise<Employer360Arrears | null> {
  const { data } = await supabase
    .from('ce_v_employer_arrears_summary')
    .select('*')
    .eq('regno', employerId)
    .maybeSingle();
  return (data as unknown as Employer360Arrears) ?? null;
}

export async function fetchEmployerPayments(employerId: string): Promise<Employer360Payment | null> {
  const { data } = await supabase
    .from('ce_v_employer_payment_status')
    .select('*')
    .eq('regno', employerId)
    .maybeSingle();
  return (data as unknown as Employer360Payment) ?? null;
}

export async function fetchEmployerLegal(employerId: string): Promise<Employer360Legal | null> {
  const { data } = await supabase
    .from('ce_v_employer_legal_status')
    .select('*')
    .eq('regno', employerId)
    .maybeSingle();
  return (data as unknown as Employer360Legal) ?? null;
}

export async function fetchEmployerWorkforce(employerId: string): Promise<Employer360Workforce | null> {
  const { data } = await supabase
    .from('ce_v_employer_workforce')
    .select('*')
    .eq('regno', employerId)
    .maybeSingle();
  return (data as unknown as Employer360Workforce) ?? null;
}

export async function fetchEmployerRisk(employerId: string): Promise<Employer360Risk | null> {
  const { data } = await supabase
    .from('ce_risk_profiles')
    .select('id, employer_id, total_score, risk_band, arrears_score, violation_score, filing_score, payment_behavior_score, legal_history_score, last_calculated_at, override_band, override_reason')
    .eq('employer_id', employerId)
    .maybeSingle();
  return (data as unknown as Employer360Risk) ?? null;
}

// ── Violations ──
export interface EmployerViolationsPage {
  /** The rows rendered in the tab (bounded page). */
  rows: any[];
  /** Full matching population, from a real count query — NOT rows.length. */
  total: number;
  /** Open/active subset of the full population. */
  openTotal: number;
  /** True when `rows` is a truncated view of `total`. */
  truncated: boolean;
}

const EMPLOYER_VIOLATIONS_PAGE_SIZE = 50;
const CLOSED_VIOLATION_STATUSES = ['RESOLVED', 'CLOSED', 'CANCELLED'];

export async function fetchEmployerViolations(
  employerId: string,
  limit: number = EMPLOYER_VIOLATIONS_PAGE_SIZE,
): Promise<EmployerViolationsPage> {
  // Page of rows + exact count of the whole matching population in one request.
  const { data, error, count } = await supabase
    .from('ce_violations')
    .select('*, ce_violation_types(code, name, category)', { count: 'exact' })
    .eq('employer_id', employerId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .range(0, Math.max(limit - 1, 0));
  if (error) throw error;

  // Open count is a separate head-only count so it reflects all matching rows,
  // not just the loaded page.
  const { count: openCount, error: openError } = await supabase
    .from('ce_violations')
    .select('id', { count: 'exact', head: true })
    .eq('employer_id', employerId)
    .eq('is_deleted', false)
    .not('status', 'in', `(${CLOSED_VIOLATION_STATUSES.join(',')})`);
  if (openError) throw openError;

  const rows = data ?? [];
  const total = count ?? rows.length;
  return { rows, total, openTotal: openCount ?? 0, truncated: total > rows.length };
}


// ── Notices ──
export async function fetchEmployerNotices(employerId: string) {
  const { data, error } = await supabase
    .from('ce_notices')
    .select('*')
    .eq('employer_id', employerId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

// ── Follow-ups ──
export async function fetchEmployerFollowUps(employerId: string) {
  const { data, error } = await supabase
    .from('ce_follow_up_actions')
    .select('*')
    .eq('employer_id', employerId)
    .eq('is_deleted', false)
    .order('due_date', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

// ── Timeline ──
export async function fetchEmployerTimeline(employerId: string): Promise<Employer360TimelineEvent[]> {
  const { data, error } = await supabase
    .from('ce_v_employer_timeline')
    .select('*')
    .eq('employer_id', employerId)
    .order('event_date', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as unknown as Employer360TimelineEvent[];
}
