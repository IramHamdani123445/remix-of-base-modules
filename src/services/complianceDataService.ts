import { supabase } from "@/integrations/supabase/client";

// ============================================
// CASES
// ============================================
export async function fetchComplianceCases(filters?: {
  status?: string;
  caseType?: string;
  search?: string;
}) {
  let query = supabase
    .from("ce_cases")
    .select("*")
    .eq("is_deleted", false)
    .order("created_at", { ascending: false });

  if (filters?.status && filters.status !== "ALL") {
    query = query.eq("status", filters.status);
  }
  if (filters?.caseType && filters.caseType !== "ALL") {
    query = query.eq("case_type", filters.caseType);
  }
  if (filters?.search) {
    query = query.or(
      `case_number.ilike.%${filters.search}%,employer_name.ilike.%${filters.search}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function fetchCaseById(id: string) {
  const { data, error } = await supabase
    .from("ce_cases")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchCasesByEmployer(employerId: string, excludeCaseId?: string) {
  let query = supabase
    .from("ce_cases")
    .select("*")
    .eq("employer_id", employerId)
    .eq("is_deleted", false);
  if (excludeCaseId) query = query.neq("id", excludeCaseId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// ============================================
// CASE HISTORY
// ============================================
export async function fetchCaseHistory(caseId: string) {
  const { data, error } = await supabase
    .from("ce_case_history")
    .select("*")
    .eq("case_id", caseId)
    .order("performed_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ============================================
// NOTICES
// ============================================
export async function fetchNotices(filters?: { search?: string; caseId?: string }) {
  let query = supabase
    .from("ce_notices")
    .select("*")
    .order("created_at", { ascending: false });

  if (filters?.caseId) {
    query = query.eq("case_id", filters.caseId);
  }
  if (filters?.search) {
    query = query.or(
      `employer_name.ilike.%${filters.search}%,notice_number.ilike.%${filters.search}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// ============================================
// PAYMENT ARRANGEMENTS
// ============================================
export async function fetchPaymentArrangements(filters?: { status?: string }) {
  let query = supabase
    .from("ce_payment_arrangements")
    .select("*")
    .order("created_at", { ascending: false });

  if (filters?.status && filters.status !== "ALL") {
    query = query.eq("status", filters.status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function fetchInstallments(arrangementId: string) {
  const { data, error } = await supabase
    .from("ce_installments")
    .select("*")
    .eq("arrangement_id", arrangementId)
    .order("installment_number", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ============================================
// WEEKLY PLANS & INSPECTORS
// ============================================
export async function fetchInspectors() {
  const { data, error } = await supabase
    .from("ce_inspectors")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function fetchWeeklyPlans(filters?: { inspectorId?: string }) {
  let query = supabase
    .from("ce_weekly_plans")
    .select("*, ce_weekly_plan_items(*)")
    .order("week_start_date", { ascending: false });

  if (filters?.inspectorId && filters.inspectorId !== "ALL") {
    query = query.eq("inspector_id", filters.inspectorId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// ============================================
// FIELD ACTIVITIES
// ============================================
export async function fetchFieldActivities(filters?: { status?: string; search?: string }) {
  let query = supabase
    .from("ce_field_activities")
    .select("*")
    .order("created_at", { ascending: false });

  if (filters?.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }
  if (filters?.search) {
    query = query.or(
      `employer_name.ilike.%${filters.search}%,case_number.ilike.%${filters.search}%`
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

// ============================================
// EMPLOYER STATEMENTS (from financial ledger)
// ============================================
export async function fetchEmployerStatementSummaries() {
  const { data, error } = await supabase
    .from("ce_employer_financial_ledger")
    .select("employer_id, employer_name, fund_type, debit_amount, credit_amount, posted_at")
    .eq("status", "POSTED")
    .order("posted_at", { ascending: true });
  if (error) throw error;

  // Group by employer
  const employerMap = new Map<string, any>();
  (data ?? []).forEach((row) => {
    if (!employerMap.has(row.employer_id)) {
      employerMap.set(row.employer_id, {
        id: row.employer_id,
        employerId: row.employer_id,
        employerName: row.employer_name,
        asOfDate: new Date().toISOString().split("T")[0],
        totalDue: 0,
        totalPaid: 0,
        penalties: 0,
        outstanding: 0,
        complianceStatus: "compliant" as const,
      });
    }
    const emp = employerMap.get(row.employer_id)!;
    emp.totalDue += Number(row.debit_amount) || 0;
    emp.totalPaid += Number(row.credit_amount) || 0;
  });

  return Array.from(employerMap.values()).map((e) => ({
    ...e,
    outstanding: e.totalDue - e.totalPaid,
    complianceStatus: e.totalDue - e.totalPaid > 0 ? "non_compliant" : "compliant",
  }));
}

export async function fetchEmployerStatementTransactions(employerId: string) {
  const { data, error } = await supabase
    .from("ce_employer_financial_ledger")
    .select("*")
    .eq("employer_id", employerId)
    .eq("status", "POSTED")
    .order("posted_at", { ascending: true });
  if (error) throw error;

  // Group by fund_type into statement sections
  const transactions = data ?? [];
  const grouped: Record<string, any[]> = {};
  
  transactions.forEach((txn) => {
    const fund = txn.fund_type as string;
    if (!grouped[fund]) grouped[fund] = [];
    grouped[fund].push({
      date: txn.posted_at?.split("T")[0] ?? "",
      period: txn.period,
      description: txn.description,
      transactionType: Number(txn.debit_amount) > 0 ? "DEBIT" : "CREDIT",
      amount: Number(txn.debit_amount) > 0 ? Number(txn.debit_amount) : Number(txn.credit_amount),
    });
  });

  const employerName = transactions[0]?.employer_name ?? employerId;

  return {
    employerId,
    employerName,
    statementPeriodFrom: transactions[0]?.posted_at?.split("T")[0] ?? "",
    statementPeriodTo: transactions[transactions.length - 1]?.posted_at?.split("T")[0] ?? "",
    generatedDate: new Date().toISOString().split("T")[0],
    ssc: grouped["SS"] ?? [],
    ssf: grouped["SS_PENALTY"] ?? [],
    lvc: grouped["LEVY"] ?? [],
    lvf: grouped["LEVY_PENALTY"] ?? [],
    pec: grouped["EI"] ?? [],
    pef: grouped["EI_PENALTY"] ?? [],
  };
}

// ============================================
// VIOLATIONS (ce_violations)
// ============================================

export interface ViolationFilters {
  status?: string;
  priority?: string;
  search?: string;
  month?: string;
  page?: number;
  pageSize?: number;
  // Extended filters (Violations completion)
  fund?: string;            // ce_violations.fund_type
  violationTypeId?: string; // ce_violations.violation_type_id
  severity?: string;        // ce_violations.severity
  source?: string;          // ce_violations.source_type
  assignedOfficer?: string; // ce_violations.assigned_to_user_id ('UNASSIGNED' = NULL)
  verification?: string;    // ce_violations.verification_decision ('PENDING' = NULL)
  employerId?: string;      // exact employer match
}

export interface ViolationPage {
  rows: any[];
  totalCount: number;
  page: number;
  pageSize: number;
}

function buildViolationFilterConditions(filters: ViolationFilters) {
  const searchValue = filters.search?.trim();
  // Only filter by month when the caller explicitly supplies one.
  // Previously this defaulted to the current month when no other filter was
  // active, which hid all historic auto-generated DETECTION_RULE violations
  // from the All Violations screen.
  const targetMonth = filters.month || undefined;
  return { searchValue, targetMonth };
}


async function resolveEmployerSearch(searchValue: string): Promise<string[]> {
  const [masterResult, locationResult] = await Promise.all([
    supabase
      .from('er_master')
      .select('regno')
      .or(`regno.ilike.%${searchValue}%,name.ilike.%${searchValue}%`)
      .limit(50),
    supabase
      .from('er_locations')
      .select('regno')
      .ilike('trade_name', `%${searchValue}%`)
      .limit(50),
  ]);
  const ids = new Set<string>();
  masterResult.data?.forEach((r: any) => r.regno && ids.add(r.regno));
  locationResult.data?.forEach((r: any) => r.regno && ids.add(r.regno));
  return Array.from(ids);
}

function applyViolationFilters(
  query: any,
  filters: ViolationFilters,
  searchValue: string | undefined,
  targetMonth: string | undefined,
  employerIds: string[],
) {
  if (filters.status && filters.status !== "ALL") query = query.eq("status", filters.status);
  if (filters.priority && filters.priority !== "ALL") query = query.eq("priority", filters.priority);
  if (filters.fund && filters.fund !== "ALL") query = query.eq("fund_type", filters.fund);
  if (filters.violationTypeId && filters.violationTypeId !== "ALL") query = query.eq("violation_type_id", filters.violationTypeId);
  if (filters.severity && filters.severity !== "ALL") query = query.eq("severity", filters.severity);
  if (filters.source && filters.source !== "ALL") query = query.eq("source_type", filters.source);
  if (filters.assignedOfficer && filters.assignedOfficer !== "ALL") {
    if (filters.assignedOfficer === 'UNASSIGNED') query = query.is("assigned_to_user_id", null);
    else query = query.eq("assigned_to_user_id", filters.assignedOfficer);
  }
  if (filters.verification && filters.verification !== "ALL") {
    if (filters.verification === 'PENDING') query = query.is("verification_decision", null);
    else query = query.eq("verification_decision", filters.verification);
  }
  if (filters.employerId) query = query.eq("employer_id", filters.employerId);
  if (searchValue) {
    const escaped = searchValue.replace(/,/g, ' ');
    const orParts = [
      `violation_number.ilike.%${escaped}%`,
      `employer_id.ilike.%${escaped}%`,
      `employer_name.ilike.%${escaped}%`,
      `summary.ilike.%${escaped}%`,
    ];
    if (employerIds.length > 0) orParts.push(`employer_id.in.(${employerIds.join(',')})`);
    query = query.or(orParts.join(','));
  }
  if (targetMonth) {
    const startDate = `${targetMonth}-01`;
    const nextMonth = new Date(`${targetMonth}-01T00:00:00Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const endDate = nextMonth.toISOString().slice(0, 10);
    query = query.gte("created_at", startDate).lt("created_at", endDate);
  }
  return query;
}

export async function fetchViolationsPaginated(filters: ViolationFilters = {}): Promise<ViolationPage> {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const { searchValue, targetMonth } = buildViolationFilterConditions(filters);
  const employerIds = searchValue ? await resolveEmployerSearch(searchValue) : [];

  let countQuery = supabase
    .from("ce_violations")
    .select("id", { count: "exact", head: true })
    .eq("is_deleted", false);

  let dataQuery = supabase
    .from("ce_violations")
    .select("id, violation_number, employer_id, employer_name, status, priority, severity, fund_type, source_type, source_rule_id, verification_decision, assigned_to_user_id, period_from, total_amount, assigned_to_name, discovered_date, created_at, ce_violation_types(code, name, category), ce_zones(zone_code), ce_assignment_queues(queue_code)")
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  countQuery = applyViolationFilters(countQuery, filters, searchValue, targetMonth, employerIds);
  dataQuery = applyViolationFilters(dataQuery, filters, searchValue, targetMonth, employerIds);

  const [countResult, dataResult] = await Promise.all([countQuery, dataQuery]);
  if (countResult.error) throw countResult.error;
  if (dataResult.error) throw dataResult.error;

  return {
    rows: dataResult.data ?? [],
    totalCount: countResult.count ?? 0,
    page,
    pageSize,
  };
}

export async function fetchViolationSummaryCounts(filters: ViolationFilters = {}): Promise<Record<string, number>> {
  const { searchValue, targetMonth } = buildViolationFilterConditions(filters);
  const employerIds = searchValue ? await resolveEmployerSearch(searchValue) : [];

  // Use the count query per status to avoid fetching all rows
  const statuses = ['OPEN', 'UNDER_REVIEW', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED', 'CANCELLED'];

  // Single query fetching only status column, then count client-side (lightweight - only 1 column)
  let query = supabase
    .from("ce_violations")
    .select("status", { count: "exact" })
    .eq("is_deleted", false);

  // Apply filters but skip status filter for summary (we want counts per status across all)
  const filtersWithoutStatus = { ...filters, status: 'ALL' };
  query = applyViolationFilters(query, filtersWithoutStatus, searchValue, targetMonth, employerIds);

  const { count, error } = await query;
  if (error) throw error;

  const total = count ?? 0;

  // Now get per-status counts in parallel
  const statusCountPromises = statuses.map(async (s) => {
    // NOTE: `head: true` count requests are aborted by the client transport on
    // this deployment (response arrives, request reports ERR_ABORTED), which
    // silently zeroed every status card. Use a normal 1-row exact count instead.
    let sq = supabase
      .from("ce_violations")
      .select("id", { count: "exact" })
      .eq("is_deleted", false)
      .eq("status", s)
      .limit(1);
    sq = applyViolationFilters(sq, filtersWithoutStatus, searchValue, targetMonth, employerIds);
    const { count: c, error: e } = await sq;
    if (e) return [s, 0] as [string, number];
    return [s, c ?? 0] as [string, number];
  });


  const statusResults = await Promise.all(statusCountPromises);
  const counts: Record<string, number> = { total };
  statusResults.forEach(([s, c]) => { counts[s] = c; });
  return counts;
}

export async function fetchViolations(filters?: ViolationFilters) {
  const result = await fetchViolationsPaginated({ ...filters, page: 1, pageSize: 1000 });
  return result.rows;
}

export async function fetchViolationById(id: string) {
  const { data, error } = await supabase
    .from("ce_violations")
    .select("*, ce_violation_types(code, name, category), ce_zones(zone_code, zone_name), ce_assignment_queues(queue_code, queue_name, queue_type)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

