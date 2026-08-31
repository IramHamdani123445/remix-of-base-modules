/**
 * Compliance Executive Workbench — data layer.
 *
 * Every metric resolves to a discriminated `MetricResult` so a failed or
 * unauthorised query renders an explicit "unavailable" state instead of a
 * misleading zero. Technical errors are logged, never surfaced to users.
 *
 * All aggregates come from existing Compliance tables/views — no mock data.
 */
import { useQueries, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Compliance tables are not in the generated Supabase types.
const sb: any = supabase;

export const OPEN_VIOLATION_STATUSES = ['OPEN', 'IN_PROGRESS', 'UNDER_REVIEW', 'ESCALATED'];
export const OPEN_CASE_STATUSES = [
  'OPEN',
  'ACTIVE',
  'INVESTIGATION',
  'IN_ARRANGEMENT',
  'CSTG_PAYMENT_ARRANGEMENT_ACTIVE',
  'ESCALATED',
  'ESCALATED_LEGAL',
  'RECOMMENDED_FOR_LEGAL',
];
const HIGH_PRIORITIES = ['Critical', 'High', 'CRITICAL', 'HIGH'];

export type MetricResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'unavailable' };

export interface ExecFilters {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  zoneId: string;
  officerId: string;
  employer: string; // free-text employer name match
  violationTypeId: string;
  riskBand: string;
}

export function defaultExecFilters(): ExecFilters {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    from: iso(start),
    to: iso(now),
    zoneId: '',
    officerId: '',
    employer: '',
    violationTypeId: '',
    riskBand: '',
  };
}

/** True when any filter narrows the module-wide picture. */
export function hasActiveFilters(f: ExecFilters, base = defaultExecFilters()) {
  return (
    f.from !== base.from ||
    f.to !== base.to ||
    !!f.zoneId ||
    !!f.officerId ||
    !!f.employer ||
    !!f.violationTypeId ||
    !!f.riskBand
  );
}

const endOfDay = (d: string) => `${d}T23:59:59.999Z`;

function violationScope(f: ExecFilters, opts: { dateFiltered?: boolean } = {}) {
  let q = sb
    .from('ce_violations')
    .select('id', { count: 'exact', head: true })
    .eq('is_deleted', false);
  if (opts.dateFiltered !== false) {
    if (f.from) q = q.gte('created_at', f.from);
    if (f.to) q = q.lte('created_at', endOfDay(f.to));
  }
  if (f.zoneId) q = q.eq('zone_id', f.zoneId);
  if (f.officerId) q = q.eq('assigned_to_user_id', f.officerId);
  if (f.employer) q = q.ilike('employer_name', `%${f.employer}%`);
  if (f.violationTypeId) q = q.eq('violation_type_id', f.violationTypeId);
  return q;
}

async function runCount(builder: any): Promise<number> {
  const { count, error } = await builder;
  if (error) throw error;
  return count ?? 0;
}

function toResult<T>(query: { isSuccess: boolean; isError: boolean; data: any }): MetricResult<T> {
  if (query.isError) return { status: 'unavailable' };
  if (!query.isSuccess) return { status: 'unavailable' };
  return { status: 'ok', value: query.data as T };
}

export interface ExecKpi {
  key: string;
  label: string;
  href: string;
  hint: string;
  format: 'number' | 'currency';
  tone: 'default' | 'warning' | 'danger' | 'success';
  moduleWide?: boolean;
  result: MetricResult<number>;
  isLoading: boolean;
  delta?: { value: number; label: string };
}

/** Executive KPI strip. Each tile is an independent query. */
export function useExecutiveKpis(f: ExecFilters) {
  const today = new Date().toISOString().slice(0, 10);
  const key = ['ce-exec-kpi', f] as const;

  const defs: Array<{
    key: string;
    label: string;
    href: string;
    hint: string;
    format?: 'number' | 'currency';
    tone?: ExecKpi['tone'];
    moduleWide?: boolean;
    fn: () => Promise<number>;
  }> = [
    {
      key: 'open-violations',
      label: 'Open Violations',
      href: '/compliance/violations',
      hint: 'Violations in OPEN, IN PROGRESS, UNDER REVIEW or ESCALATED status created in the selected period.',
      fn: () => runCount(violationScope(f).in('status', OPEN_VIOLATION_STATUSES)),
    },
    {
      key: 'critical-violations',
      label: 'Critical / High',
      href: '/compliance/violations',
      hint: 'Open violations flagged Critical or High priority.',
      tone: 'danger',
      fn: () =>
        runCount(
          violationScope(f).in('status', OPEN_VIOLATION_STATUSES).in('priority', HIGH_PRIORITIES),
        ),
    },
    {
      key: 'overdue-violations',
      label: 'Overdue Violations',
      href: '/compliance/violations',
      hint: 'Open violations whose due date has passed.',
      tone: 'warning',
      fn: () =>
        runCount(
          violationScope(f).in('status', OPEN_VIOLATION_STATUSES).lt('due_date', today),
        ),
    },
    {
      key: 'open-cases',
      label: 'Open Cases',
      href: '/compliance/cases',
      hint: 'Compliance cases that are not closed or completed.',
      fn: () => {
        let q = sb
          .from('ce_cases')
          .select('id', { count: 'exact', head: true })
          .eq('is_deleted', false)
          .in('status', OPEN_CASE_STATUSES);
        if (f.employer) q = q.ilike('employer_name', `%${f.employer}%`);
        if (f.officerId) q = q.eq('assigned_officer_id', f.officerId);
        if (f.riskBand) q = q.eq('risk_band', f.riskBand);
        return runCount(q);
      },
    },
    {
      key: 'pending-approvals',
      label: 'Pending Approvals',
      href: '/compliance/field/pending-review',
      hint: 'Weekly plans and payment arrangements awaiting management approval.',
      tone: 'warning',
      moduleWide: true,
      fn: async () => {
        const plans = await runCount(
          sb
            .from('ce_weekly_plans')
            .select('id', { count: 'exact', head: true })
            .in('status', ['SUBMITTED', 'REVISION_SUBMITTED']),
        );
        const arrangements = await runCount(
          sb
            .from('ce_payment_arrangements')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'PENDING_APPROVAL'),
        );
        return plans + arrangements;
      },
    },
    {
      key: 'active-arrangements',
      label: 'Active Arrangements',
      href: '/compliance/arrangements/active',
      hint: 'Payment arrangements currently in force.',
      moduleWide: true,
      fn: () =>
        runCount(
          sb
            .from('ce_payment_arrangements')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'ACTIVE'),
        ),
    },
    {
      key: 'arrangement-breaches',
      label: 'Arrangement Breaches',
      href: '/compliance/arrangements/breaches',
      hint: 'Detected arrangement breaches that have not been resolved.',
      tone: 'danger',
      moduleWide: true,
      fn: () =>
        runCount(
          sb
            .from('ce_arrangement_breaches')
            .select('id', { count: 'exact', head: true })
            .is('resolved_at', null),
        ),
    },
    {
      key: 'legal-recommendations',
      label: 'Legal Recommendations',
      href: '/compliance/legal-recommendation-queue',
      hint: 'Legal escalation recommendations awaiting a management decision.',
      tone: 'warning',
      moduleWide: true,
      fn: () =>
        runCount(
          sb
            .from('ce_legal_recommendations')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'PENDING_REVIEW'),
        ),
    },
    {
      key: 'exposure',
      label: 'Outstanding Exposure',
      href: '/compliance/reports/arrears',
      hint: 'Sum of outstanding principal, penalty and interest across employers with arrears.',
      format: 'currency',
      moduleWide: true,
      fn: async () => {
        const { data, error } = await sb
          .from('ce_v_employer_outstanding')
          .select('total_outstanding');
        if (error) throw error;
        return (data || []).reduce(
          (sum: number, r: any) => sum + Number(r.total_outstanding || 0),
          0,
        );
      },
    },
  ];

  const results = useQueries({
    queries: defs.map((d) => ({
      queryKey: [...key, d.key],
      staleTime: 60_000,
      retry: 0,
      queryFn: d.fn,
    })),
  });

  const kpis: ExecKpi[] = defs.map((d, i) => {
    const q = results[i];
    if (q.isError) console.warn(`[compliance-workbench] metric ${d.key} unavailable`, q.error);
    return {
      key: d.key,
      label: d.label,
      href: d.href,
      hint: d.hint,
      format: d.format ?? 'number',
      tone: d.tone ?? 'default',
      moduleWide: d.moduleWide,
      isLoading: q.isLoading,
      result: toResult<number>(q as any),
    };
  });

  return { kpis, isLoading: results.some((r) => r.isLoading) };
}

/* ------------------------------------------------------------------ */
/* Requires Attention                                                  */
/* ------------------------------------------------------------------ */

export interface AttentionItem {
  id: string;
  employer: string;
  item: string;
  type: string;
  priority: string | null;
  assignee: string | null;
  since: string | null;
  stage: string;
  action: string;
  href: string;
}

export function useAttentionQueue(f: ExecFilters) {
  return useQuery({
    queryKey: ['ce-exec-attention', f],
    staleTime: 60_000,
    retry: 0,
    queryFn: async () => {
      const unavailable: string[] = [];
      const items: AttentionItem[] = [];
      const today = new Date().toISOString().slice(0, 10);

      // Overdue violations
      try {
        let q = sb
          .from('ce_violations')
          .select(
            'id, violation_number, employer_name, priority, assigned_to_name, due_date, status',
          )
          .eq('is_deleted', false)
          .in('status', OPEN_VIOLATION_STATUSES)
          .lt('due_date', today)
          .order('due_date', { ascending: true })
          .limit(10);
        if (f.zoneId) q = q.eq('zone_id', f.zoneId);
        if (f.officerId) q = q.eq('assigned_to_user_id', f.officerId);
        if (f.employer) q = q.ilike('employer_name', `%${f.employer}%`);
        if (f.violationTypeId) q = q.eq('violation_type_id', f.violationTypeId);
        const { data, error } = await q;
        if (error) throw error;
        (data || []).forEach((v: any) =>
          items.push({
            id: `viol-${v.id}`,
            employer: v.employer_name || '—',
            item: v.violation_number || v.id.slice(0, 8),
            type: 'Overdue violation',
            priority: v.priority,
            assignee: v.assigned_to_name,
            since: v.due_date,
            stage: String(v.status || '').replace(/_/g, ' '),
            action: 'Review',
            href: `/compliance/violations`,
          }),
        );
      } catch (e) {
        console.warn('[compliance-workbench] overdue violations unavailable', e);
        unavailable.push('Overdue violations');
      }

      // Unresolved arrangement breaches
      try {
        const { data, error } = await sb
          .from('ce_v_arrangement_health')
          .select('arrangement_id, employer_name, health_status, missed_payments, next_due_date, unresolved_breach_count')
          .gt('unresolved_breach_count', 0)
          .limit(10);
        if (error) throw error;
        (data || [])
          .filter((r: any) => !f.employer || String(r.employer_name || '').toLowerCase().includes(f.employer.toLowerCase()))
          .forEach((r: any) =>
            items.push({
              id: `arr-${r.arrangement_id}`,
              employer: r.employer_name || '—',
              item: 'Arrangement in default',
              type: 'Arrangement breach',
              priority: 'High',
              assignee: null,
              since: r.next_due_date,
              stage: r.health_status || 'BREACHED',
              action: 'Open',
              href: `/compliance/enforcement/arrangements/${r.arrangement_id}`,
            }),
          );
      } catch (e) {
        console.warn('[compliance-workbench] arrangement breaches unavailable', e);
        unavailable.push('Arrangement breaches');
      }

      // Plans awaiting approval
      try {
        const { data, error } = await sb
          .from('ce_weekly_plans')
          .select('id, plan_number, inspector_name, status, submitted_date, week_start_date')
          .in('status', ['SUBMITTED', 'REVISION_SUBMITTED'])
          .limit(10);
        if (error) throw error;
        (data || []).forEach((p: any) =>
          items.push({
            id: `plan-${p.id}`,
            employer: '—',
            item: p.plan_number || `Weekly plan ${String(p.id).slice(0, 8)}`,
            type: 'Plan approval',
            priority: null,
            assignee: p.inspector_name ?? null,
            since: p.submitted_date || p.week_start_date || null,
            stage: String(p.status || '').replace(/_/g, ' '),
            action: 'Approve',
            href: `/compliance/field/pending-review/${p.id}`,
          }),
        );
      } catch (e) {
        console.warn('[compliance-workbench] plan approvals unavailable', e);
        unavailable.push('Plans awaiting approval');
      }

      // Legal recommendations awaiting decision
      try {
        const { data, error } = await sb
          .from('ce_legal_recommendations')
          .select('id, employer_name, risk_band, grand_total, recommended_date, status')
          .eq('status', 'PENDING_REVIEW')
          .order('recommended_date', { ascending: true })
          .limit(10);
        if (error) throw error;
        (data || []).forEach((r: any) =>
          items.push({
            id: `reco-${r.id}`,
            employer: r.employer_name || '—',
            item: 'Legal escalation recommendation',
            type: 'Legal decision',
            priority: r.risk_band,
            assignee: null,
            since: r.recommended_date,
            stage: 'PENDING REVIEW',
            action: 'Decide',
            href: '/compliance/legal-recommendation-queue',
          }),
        );
      } catch (e) {
        console.warn('[compliance-workbench] legal recommendations unavailable', e);
        unavailable.push('Legal recommendations');
      }

      // Open review flags (repeat offender / high risk flags)
      try {
        const { data, error } = await sb
          .from('ce_compliance_review_flags')
          .select('id, flag_number, subject_name, flag_type, severity, status, created_at, assigned_to_name')
          .in('status', ['OPEN', 'PENDING', 'PENDING_REVIEW'])
          .limit(10);
        if (error) throw error;
        (data || []).forEach((r: any) =>
          items.push({
            id: `flag-${r.id}`,
            employer: r.subject_name || '—',
            item: r.flag_number || 'Review flag',
            type: String(r.flag_type || 'Review flag').replace(/_/g, ' '),
            priority: r.severity,
            assignee: r.assigned_to_name ?? null,
            since: r.created_at,
            stage: String(r.status || '').replace(/_/g, ' '),
            action: 'Review',
            href: '/compliance/admin/settings/review-flag-queue',
          }),
        );
      } catch (e) {
        console.warn('[compliance-workbench] review flags unavailable', e);
        unavailable.push('Review flags');
      }

      return { items, unavailable };
    },
  });
}

/* ------------------------------------------------------------------ */
/* Enforcement pipeline                                                */
/* ------------------------------------------------------------------ */

export interface PipelineStage {
  key: string;
  label: string;
  href: string;
  result: MetricResult<number>;
}

export function useEnforcementPipeline(f: ExecFilters) {
  const defs = [
    {
      key: 'detection',
      label: 'Detection flags',
      href: '/compliance/admin/settings/review-flag-queue',
      fn: () =>
        runCount(
          sb
            .from('ce_compliance_review_flags')
            .select('id', { count: 'exact', head: true })
            .in('status', ['OPEN', 'PENDING', 'PENDING_REVIEW']),
        ),
    },
    {
      key: 'violation',
      label: 'Open violations',
      href: '/compliance/violations',
      fn: () => runCount(violationScope(f).eq('status', 'OPEN')),
    },
    {
      key: 'investigation',
      label: 'Investigation',
      href: '/compliance/violations',
      fn: () => runCount(violationScope(f).in('status', ['IN_PROGRESS', 'UNDER_REVIEW'])),
    },
    {
      key: 'notice',
      label: 'Notices issued',
      href: '/compliance/notices/register',
      fn: () =>
        runCount(
          sb
            .from('ce_notices')
            .select('id', { count: 'exact', head: true })
            .in('status', ['GENERATED', 'SENT', 'DELIVERED'])
            .gte('created_at', f.from)
            .lte('created_at', endOfDay(f.to)),
        ),
    },
    {
      key: 'case',
      label: 'Active cases',
      href: '/compliance/cases',
      fn: () =>
        runCount(
          sb
            .from('ce_cases')
            .select('id', { count: 'exact', head: true })
            .eq('is_deleted', false)
            .in('status', OPEN_CASE_STATUSES),
        ),
    },
    {
      key: 'escalation',
      label: 'Escalated',
      href: '/compliance/violations',
      fn: () => runCount(violationScope(f, { dateFiltered: false }).eq('status', 'ESCALATED')),
    },
    {
      key: 'recommendation',
      label: 'Legal recommendation',
      href: '/compliance/legal-recommendation-queue',
      fn: () =>
        runCount(
          sb
            .from('ce_legal_recommendations')
            .select('id', { count: 'exact', head: true })
            .in('status', ['PENDING_REVIEW', 'APPROVED_FOR_REFERRAL']),
        ),
    },
    {
      key: 'legal',
      label: 'With Legal',
      href: '/compliance/legal/queue',
      fn: () =>
        runCount(
          sb
            .from('ce_legal_referrals')
            .select('id', { count: 'exact', head: true })
            .in('status', ['SUBMITTED_TO_LEGAL', 'ACCEPTED_BY_LEGAL']),
        ),
    },
  ];

  const results = useQueries({
    queries: defs.map((d) => ({
      queryKey: ['ce-exec-pipeline', f, d.key],
      staleTime: 60_000,
      retry: 0,
      queryFn: d.fn,
    })),
  });

  const stages: PipelineStage[] = defs.map((d, i) => ({
    key: d.key,
    label: d.label,
    href: d.href,
    result: toResult<number>(results[i] as any),
  }));

  return { stages, isLoading: results.some((r) => r.isLoading) };
}

/* ------------------------------------------------------------------ */
/* Violation intelligence                                              */
/* ------------------------------------------------------------------ */

export function useViolationMix() {
  const types = useQuery({
    queryKey: ['ce_v_violation_type_mix'],
    staleTime: 120_000,
    retry: 0,
    queryFn: async () => {
      const { data, error } = await sb
        .from('ce_v_violation_type_mix')
        .select('*')
        .order('open_count', { ascending: false })
        .limit(8);
      if (error) throw error;
      return (data || []) as Array<{ type_name: string; open_count: number }>;
    },
  });

  const ageing = useQuery({
    queryKey: ['ce_v_violation_ageing'],
    staleTime: 120_000,
    retry: 0,
    queryFn: async () => {
      const { data, error } = await sb
        .from('ce_v_violation_ageing')
        .select('*')
        .order('bucket_order', { ascending: true });
      if (error) throw error;
      return (data || []) as Array<{ bucket: string; open_count: number }>;
    },
  });

  return { types, ageing };
}

/* ------------------------------------------------------------------ */
/* Risk overview                                                       */
/* ------------------------------------------------------------------ */

export function useRiskOverview() {
  return useQuery({
    queryKey: ['ce_v_risk_band_summary'],
    staleTime: 120_000,
    retry: 0,
    queryFn: async () => {
      const { data, error } = await sb.from('ce_v_risk_band_summary').select('*');
      if (error) throw error;
      return (data || []) as Array<{ risk_band: string; employer_count: number; avg_score: number }>;
    },
  });
}

/* ------------------------------------------------------------------ */
/* Financial exposure                                                  */
/* ------------------------------------------------------------------ */

export function useFinancialExposure() {
  const outstanding = useQuery({
    queryKey: ['ce-exec-outstanding'],
    staleTime: 120_000,
    retry: 0,
    queryFn: async () => {
      const { data, error } = await sb
        .from('ce_v_employer_outstanding')
        .select('principal_outstanding, penalty_outstanding, interest_outstanding, total_outstanding');
      if (error) throw error;
      const rows = data || [];
      const sum = (k: string) => rows.reduce((s: number, r: any) => s + Number(r[k] || 0), 0);
      return {
        principal: sum('principal_outstanding'),
        penalty: sum('penalty_outstanding'),
        interest: sum('interest_outstanding'),
        total: sum('total_outstanding'),
        employers: rows.length,
      };
    },
  });

  const arrangements = useQuery({
    queryKey: ['ce-exec-arrangement-financials'],
    staleTime: 120_000,
    retry: 0,
    queryFn: async () => {
      const { data, error } = await sb
        .from('ce_v_arrangement_health')
        .select('status, total_debt, total_paid, health_status, overdue_installment_count, unresolved_breach_count');
      if (error) throw error;
      const rows = (data || []) as any[];
      const active = rows.filter((r) => r.status === 'ACTIVE');
      const breached = rows.filter(
        (r) => r.status === 'BREACHED' || r.status === 'DEFAULTED' || Number(r.unresolved_breach_count || 0) > 0,
      );
      const overdue = rows.filter((r) => Number(r.overdue_installment_count || 0) > 0);
      const sum = (list: any[], k: string) => list.reduce((s, r) => s + Number(r[k] || 0), 0);
      return {
        activeCount: active.length,
        underArrangement: sum(active, 'total_debt') - sum(active, 'total_paid'),
        overdueCount: overdue.length,
        overdueAmount: sum(overdue, 'total_debt') - sum(overdue, 'total_paid'),
        breachedCount: breached.length,
        breachedAmount: sum(breached, 'total_debt') - sum(breached, 'total_paid'),
      };
    },
  });

  return { outstanding, arrangements };
}

/* ------------------------------------------------------------------ */
/* Field operations                                                    */
/* ------------------------------------------------------------------ */

export function useFieldOperations() {
  return useQuery({
    queryKey: ['ce-exec-field-ops'],
    staleTime: 60_000,
    retry: 0,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const weekAhead = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
      const unavailable: string[] = [];
      const metric = async (fn: () => Promise<number>, label: string) => {
        try {
          return await fn();
        } catch (e) {
          console.warn(`[compliance-workbench] ${label} unavailable`, e);
          unavailable.push(label);
          return null;
        }
      };

      const scheduledToday = await metric(
        () =>
          runCount(
            sb
              .from('ce_weekly_plan_items')
              .select('id', { count: 'exact', head: true })
              .eq('scheduled_date', today),
          ),
        'Visits today',
      );
      const scheduledWeek = await metric(
        () =>
          runCount(
            sb
              .from('ce_weekly_plan_items')
              .select('id', { count: 'exact', head: true })
              .gte('scheduled_date', today)
              .lte('scheduled_date', weekAhead),
          ),
        'Visits this week',
      );
      const completed = await metric(
        () =>
          runCount(
            sb
              .from('ce_weekly_plan_items')
              .select('id', { count: 'exact', head: true })
              .eq('execution_status', 'COMPLETED'),
          ),
        'Visits completed',
      );
      const overdue = await metric(
        () =>
          runCount(
            sb
              .from('ce_weekly_plan_items')
              .select('id', { count: 'exact', head: true })
              .lt('scheduled_date', today)
              .not('execution_status', 'in', '("COMPLETED","CANCELLED")'),
          ),
        'Overdue visits',
      );
      const plansPending = await metric(
        () =>
          runCount(
            sb
              .from('ce_weekly_plans')
              .select('id', { count: 'exact', head: true })
              .in('status', ['SUBMITTED', 'REVISION_SUBMITTED']),
          ),
        'Plans awaiting approval',
      );
      const inspections = await metric(
        () => runCount(sb.from('ce_inspections').select('id', { count: 'exact', head: true })),
        'Inspections',
      );

      return {
        scheduledToday,
        scheduledWeek,
        completed,
        overdue,
        plansPending,
        inspections,
        unavailable,
      };
    },
  });
}

/* ------------------------------------------------------------------ */
/* Top priority employers                                              */
/* ------------------------------------------------------------------ */

export function usePriorityEmployers(f: ExecFilters) {
  return useQuery({
    queryKey: ['ce_v_priority_employers', f.riskBand, f.employer],
    staleTime: 120_000,
    retry: 0,
    queryFn: async () => {
      let q = sb
        .from('ce_v_priority_employers')
        .select('*')
        .order('outstanding_exposure', { ascending: false })
        .order('open_violations', { ascending: false })
        .limit(10);
      if (f.riskBand) q = q.eq('risk_band', f.riskBand);
      if (f.employer) q = q.ilike('employer_name', `%${f.employer}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as Array<{
        employer_id: string;
        employer_name: string;
        risk_band: string | null;
        open_violations: number;
        outstanding_exposure: number;
        oldest_issue: string | null;
        assigned_officer: string | null;
        arrangement_status: string | null;
        legal_status: string | null;
      }>;
    },
  });
}

/* ------------------------------------------------------------------ */
/* Legal snapshot                                                      */
/* ------------------------------------------------------------------ */

export function useLegalSnapshot() {
  return useQuery({
    queryKey: ['ce-exec-legal-snapshot'],
    staleTime: 60_000,
    retry: 0,
    queryFn: async () => {
      const { data: recos, error: rErr } = await sb
        .from('ce_legal_recommendations')
        .select('status, recommended_date');
      if (rErr) throw rErr;
      const { data: refs, error: fErr } = await sb
        .from('ce_legal_referrals')
        .select('status, created_at, submitted_date, returned_at');
      if (fErr) throw fErr;

      const countBy = (rows: any[], statuses: string[]) =>
        rows.filter((r) => statuses.includes(r.status)).length;

      const pendingRecos = (recos || []).filter((r: any) => r.status === 'PENDING_REVIEW');
      const ageDays = (d?: string | null) =>
        d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null;
      const ages = pendingRecos
        .map((r: any) => ageDays(r.recommended_date))
        .filter((n): n is number => n !== null);

      return {
        pendingRecommendations: pendingRecos.length,
        approvedForReferral: countBy(recos || [], ['APPROVED_FOR_REFERRAL']),
        rejectedRecommendations: countBy(recos || [], ['REJECTED']),
        beingPrepared: countBy(refs || [], ['DRAFT', 'PENDING_APPROVAL']),
        withLegal: countBy(refs || [], ['SUBMITTED_TO_LEGAL', 'ACCEPTED_BY_LEGAL']),
        returned: (refs || []).filter((r: any) => r.status === 'REJECTED' || r.returned_at).length,
        oldestPendingDays: ages.length ? Math.max(...ages) : null,
      };
    },
  });
}

/* ------------------------------------------------------------------ */
/* Filter option sources                                               */
/* ------------------------------------------------------------------ */

export function useExecFilterOptions() {
  return useQuery({
    queryKey: ['ce-exec-filter-options'],
    staleTime: 300_000,
    retry: 0,
    queryFn: async () => {
      const [zones, types, officers, bands] = await Promise.all([
        sb.from('ce_zones').select('id, zone_name').eq('is_active', true).order('zone_name'),
        sb.from('ce_violation_types').select('id, name').eq('is_active', true).order('name'),
        sb.from('ce_v_officer_performance').select('officer_id, officer_name'),
        sb.from('ce_risk_bands').select('band_name').order('score_range_min'),
      ]);
      return {
        zones: (zones.data || []).map((z: any) => ({ value: z.id, label: z.zone_name })),
        violationTypes: (types.data || []).map((t: any) => ({ value: t.id, label: t.name })),
        officers: (officers.data || [])
          .filter((o: any) => o.officer_id)
          .map((o: any) => ({ value: o.officer_id, label: o.officer_name || 'Unnamed officer' })),
        riskBands: Array.from(
          new Set((bands.data || []).map((b: any) => String(b.band_name || '').toUpperCase())),
        )
          .filter(Boolean)
          .map((b) => ({ value: b as string, label: b as string })),
      };
    },
  });
}

/* ------------------------------------------------------------------ */
/* Team performance                                                    */
/* ------------------------------------------------------------------ */

export function useTeamPerformance() {
  return useQuery({
    queryKey: ['ce-exec-team-performance'],
    staleTime: 120_000,
    retry: 0,
    queryFn: async () => {
      const { data, error } = await sb
        .from('ce_v_officer_performance')
        .select('*')
        .order('total_assigned', { ascending: false })
        .limit(15);
      if (error) throw error;
      return (data || []) as Array<{
        officer_id: string | null;
        officer_name: string | null;
        total_assigned: number;
        resolved_count: number;
        open_count: number;
        avg_resolution_days: number | null;
        resolution_rate: number | null;
      }>;
    },
  });
}
