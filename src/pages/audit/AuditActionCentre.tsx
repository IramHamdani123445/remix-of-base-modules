import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle2, ClipboardList, Filter, ListChecks, Printer,
  RefreshCw, ShieldCheck, Target, Users, CalendarClock, Gavel,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageShell, DataTable, StatusBadge, ExportDropdown } from '@/components/common';
import type { DataTableColumn, ExportColumn } from '@/components/common';
import { formatDateForDisplay } from '@/lib/format-config';
import { useIADepartments, useIAAnnualPlans } from '@/hooks/useAuditData';
import { ActionLifecycleDialog } from '@/components/audit/actions/ActionLifecycleDialog';
import {
  useIaActionRegister, useIaFindingRegister, useIaMyAuditWork, useIaManagementActionsQueue,
  useIaHeadOfAuditAttention, useIaQualityReviewQueue, useIaFollowUpQueue, useIaClosureBlockers,
  useIaActionCentreCounts, useIaFollowUpRecordOutcome, normalizeAuditLink,
  type IaFilters,
} from '@/hooks/useAuditActionCentre';
import {
  ActionCentrePrintView, AuditActionSummaryPrintView, type AppliedFilter,
} from '@/components/audit/actions/ActionCentrePrintView';

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const ACTION_STATUSES = [
  'Open', 'Assigned', 'In Progress', 'Completed by Management',
  'Verification Required', 'In Verification', 'Returned', 'Verified', 'Closed', 'Cancelled',
];
const FINDING_STATUSES = ['Draft', 'Under Review', 'Confirmed', 'Released', 'Responded', 'Closed'];


export default function AuditActionCentre() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'my-work';

  const { data: departments = [] } = useIADepartments();
  const { data: plans = [] } = useIAAnnualPlans();

  const [filters, setFilters] = useState<IaFilters>({});
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedAction, setSelectedAction] = useState<any | null>(null);
  const [followUpTarget, setFollowUpTarget] = useState<any | null>(null);
  const [printMode, setPrintMode] = useState<'list' | 'summary'>('list');

  const setTab = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', value);
    setSearchParams(next, { replace: true });
  };

  const counts = useIaActionCentreCounts(filters);
  const myWork = useIaMyAuditWork();
  const management = useIaManagementActionsQueue();
  const attention = useIaHeadOfAuditAttention();
  const actions = useIaActionRegister(filters);
  const findings = useIaFindingRegister(filters);
  const verification = useIaActionRegister({ ...filters, status: 'Verification Required' });
  const followUps = useIaFollowUpQueue(filters);
  const qaQueue = useIaQualityReviewQueue();
  const closure = useIaClosureBlockers(filters);

  /* Unfiltered, server-scoped populations used only to build filter option lists. */
  const scopeEngagements = useIaClosureBlockers({});
  const scopeActions = useIaActionRegister({});

  const auditOptions = useMemo(() => {
    const map = new Map<string, string>();
    (scopeEngagements.data ?? []).forEach((e: any) => {
      if (e.engagement_id) map.set(e.engagement_id, `${e.engagement_code || ''} ${e.engagement_name || ''}`.trim());
    });
    (scopeActions.data ?? []).forEach((a: any) => {
      if (a.engagement_id && !map.has(a.engagement_id)) {
        map.set(a.engagement_id, `${a.engagement_code || ''} ${a.engagement_name || ''}`.trim());
      }
    });
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [scopeEngagements.data, scopeActions.data]);

  const ownerOptions = useMemo(() => {
    const map = new Map<string, string>();
    (scopeActions.data ?? []).forEach((a: any) => {
      if (a.responsible_profile_id) map.set(a.responsible_profile_id, a.action_owner || 'Unnamed owner');
    });
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [scopeActions.data]);

  const functionOptions = useMemo(() => {
    const map = new Map<string, string>();
    (scopeEngagements.data ?? []).forEach((e: any) => {
      if (e.function_id) map.set(e.function_id, e.function_name || 'Function');
    });
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [scopeEngagements.data]);

  const recordOutcome = useIaFollowUpRecordOutcome();
  const [outcome, setOutcome] = useState('Implemented');
  const [outcomeNotes, setOutcomeNotes] = useState('');

  const applyText = <T extends Record<string, any>>(rows: T[]): T[] => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => JSON.stringify(r).toLowerCase().includes(q));
  };

  const go = (link?: string | null) => {
    const target = normalizeAuditLink(link);
    if (target) navigate(target);
  };

  const c = counts.data ?? {};
  const isRefreshing =
    counts.isFetching || myWork.isFetching || actions.isFetching || findings.isFetching;

  const refreshAll = () => {
    [counts, myWork, management, attention, actions, findings, verification, followUps, qaQueue, closure]
      .forEach(q => q.refetch());
  };

  const labelFor = (list: { value: string; label: string }[], value?: string | null) =>
    list.find(o => o.value === value)?.label || value || '';

  /** Human-readable description of the server filters actually applied to the population. */
  const appliedFilters: AppliedFilter[] = useMemo(() => {
    const out: AppliedFilter[] = [];
    if (filters.plan_id) out.push({ label: 'Plan', value: labelFor((plans as any[]).map(p => ({ value: p.id, label: `${p.fiscal_year || ''} ${p.title || ''}`.trim() })), filters.plan_id) });
    if (filters.engagement_id) out.push({ label: 'Audit', value: labelFor(auditOptions, filters.engagement_id) });
    if (filters.department_id) out.push({ label: 'Department', value: labelFor((departments as any[]).map(d => ({ value: d.id, label: d.name })), filters.department_id) });
    if (filters.function_id) out.push({ label: 'Function', value: labelFor(functionOptions, filters.function_id) });
    if (filters.owner_profile_id) out.push({ label: 'Owner', value: labelFor(ownerOptions, filters.owner_profile_id) });
    if (filters.severity) out.push({ label: 'Severity', value: filters.severity });
    if (filters.high_critical) out.push({ label: 'Severity', value: 'High / Critical' });
    if (filters.status) out.push({ label: 'Status', value: filters.status });
    if (filters.due_from) out.push({ label: 'Due from', value: filters.due_from });
    if (filters.due_to) out.push({ label: 'Due to', value: filters.due_to });
    if (filters.overdue) out.push({ label: 'Overdue only', value: 'Yes' });
    if (filters.due_soon) out.push({ label: 'Due in 14 days', value: 'Yes' });
    if (filters.open_only) out.push({ label: 'Open only', value: 'Yes' });
    if (filters.disputed) out.push({ label: 'Disputed', value: 'Yes' });
    if (filters.response_outstanding) out.push({ label: 'Response outstanding', value: 'Yes' });
    if (search.trim()) out.push({ label: 'Search', value: search.trim() });
    return out;
  }, [filters, search, plans, departments, auditOptions, ownerOptions, functionOptions]);

  const printList = () => { setPrintMode('list'); setTimeout(() => window.print(), 50); };
  const printSummary = () => { setPrintMode('summary'); setTimeout(() => window.print(), 50); };


  /* ---------------- Column definitions ---------------- */

  const workColumns: DataTableColumn<any>[] = [
    { key: 'required_action', header: 'Required action', render: r => <span className="font-medium">{r.required_action}</span> },
    { key: 'reference', header: 'Reference' },
    { key: 'audit', header: 'Audit' },
    { key: 'department_name', header: 'Department' },
    { key: 'stage', header: 'Stage' },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status || '—'} /> },
    { key: 'due_date', header: 'Due', render: r => formatDateForDisplay(r.due_date) },
    { key: 'overdue_days', header: 'Overdue', render: r => overdueCell(r.overdue_days) },
  ];

  const managementColumns: DataTableColumn<any>[] = [
    { key: 'bucket', header: 'Queue' },
    { key: 'required_action', header: 'Required action', render: r => <span className="font-medium">{r.required_action}</span> },
    { key: 'reference', header: 'Reference' },
    { key: 'audit', header: 'Audit' },
    { key: 'department_name', header: 'Department' },
    { key: 'severity', header: 'Severity', render: r => (r.severity ? <StatusBadge status={r.severity} /> : '—') },
    { key: 'due_date', header: 'Due', render: r => formatDateForDisplay(r.due_date) },
    { key: 'overdue_days', header: 'Overdue', render: r => overdueCell(r.overdue_days) },
  ];

  const attentionColumns: DataTableColumn<any>[] = [
    { key: 'bucket', header: 'Attention area', render: r => <span className="font-medium">{r.bucket}</span> },
    { key: 'reference', header: 'Reference' },
    { key: 'context', header: 'Audit / context' },
    { key: 'required_action', header: 'Why it needs attention' },
    { key: 'severity', header: 'Risk', render: r => (r.severity ? <StatusBadge status={r.severity} /> : '—') },
    { key: 'due_date', header: 'Date', render: r => formatDateForDisplay(r.due_date) },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status || '—'} /> },
  ];

  const actionColumns: DataTableColumn<any>[] = [
    { key: 'action_ref', header: 'Action', render: r => <span className="font-mono text-xs">{r.action_ref || '—'}</span> },
    { key: 'action_description', header: 'Description', render: r => <span className="line-clamp-2 max-w-[280px]">{r.action_description}</span> },
    { key: 'engagement_code', header: 'Audit' },
    { key: 'plan_fiscal_year', header: 'Plan year' },
    { key: 'department_name', header: 'Department' },
    { key: 'finding_title', header: 'Finding' },
    { key: 'finding_severity', header: 'Severity', render: r => (r.finding_severity ? <StatusBadge status={r.finding_severity} /> : '—') },
    { key: 'action_owner', header: 'Owner' },
    { key: 'original_target_date', header: 'Original target', render: r => formatDateForDisplay(r.original_target_date) },
    { key: 'current_target_date', header: 'Current target', render: r => formatDateForDisplay(r.current_target_date) },
    { key: 'extension_count', header: 'Ext.', render: r => String(r.extension_count ?? 0) },
    { key: 'progress_pct', header: 'Progress', render: r => `${r.progress_pct ?? 0}%` },
    { key: 'evidence_state', header: 'Evidence' },
    { key: 'lifecycle_status', header: 'Status', render: r => <StatusBadge status={r.lifecycle_status || 'Open'} /> },
    { key: 'overdue_days', header: 'Overdue days', render: r => overdueCell(r.overdue_days) },
  ];

  const findingColumns: DataTableColumn<any>[] = [
    { key: 'finding_ref', header: 'Finding', render: r => <span className="font-mono text-xs">{r.finding_ref || '—'}</span> },
    { key: 'title', header: 'Title', render: r => <span className="line-clamp-2 max-w-[280px]">{r.title}</span> },
    { key: 'engagement_code', header: 'Audit' },
    { key: 'department_name', header: 'Department' },
    { key: 'function_name', header: 'Function' },
    { key: 'severity', header: 'Severity', render: r => (r.severity ? <StatusBadge status={r.severity} /> : '—') },
    { key: 'management_position', header: 'Management position', render: r => r.management_position || '—' },
    { key: 'lifecycle_status', header: 'Status', render: r => <StatusBadge status={r.lifecycle_status || 'Draft'} /> },
    { key: 'response_status', header: 'Response', render: r => (r.response_outstanding ? <span className="text-destructive text-xs font-semibold">Outstanding</span> : (r.management_position || r.response_status || '—')) },

    { key: 'open_action_count', header: 'Open actions', render: r => `${r.open_action_count ?? 0} / ${r.action_count ?? 0}` },
    { key: 'overdue_action_count', header: 'Overdue actions', render: r => overdueCell(r.overdue_action_count) },
    { key: 'reported_date', header: 'Reported', render: r => formatDateForDisplay(r.reported_date) },
  ];

  const followUpColumns: DataTableColumn<any>[] = [
    { key: 'action_ref', header: 'Action', render: r => <span className="font-mono text-xs">{r.action_ref || '—'}</span> },
    { key: 'action_required', header: 'Follow-up', render: r => <span className="line-clamp-2 max-w-[260px]">{r.action_required}</span> },
    { key: 'engagement_code', header: 'Audit' },
    { key: 'department_name', header: 'Department' },
    { key: 'plan_fiscal_year', header: 'Plan year' },
    { key: 'follow_up_type', header: 'Type' },
    { key: 'due_date', header: 'Due', render: r => formatDateForDisplay(r.due_date) },
    { key: 'lifecycle_status', header: 'Status', render: r => <StatusBadge status={r.lifecycle_status || 'Scheduled'} /> },
    { key: 'outcome', header: 'Outcome' },
    { key: 'overdue_days', header: 'Overdue', render: r => overdueCell(r.overdue_days) },
  ];

  const qaColumns: DataTableColumn<any>[] = [
    { key: 'bucket', header: 'QA state', render: r => <span className="font-medium">{r.bucket}</span> },
    { key: 'engagement_code', header: 'Audit' },
    { key: 'engagement_name', header: 'Title' },
    { key: 'department_name', header: 'Department' },
    { key: 'review_type', header: 'Review type' },
    { key: 'review_date', header: 'Review date', render: r => formatDateForDisplay(r.review_date) },
    { key: 'quality_rating', header: 'Rating' },
    { key: 'final_disposition', header: 'Disposition', render: r => (r.final_disposition ? <StatusBadge status={r.final_disposition} /> : '—') },
  ];

  const closureColumns: DataTableColumn<any>[] = [
    { key: 'engagement_code', header: 'Audit' },
    { key: 'engagement_name', header: 'Title' },
    { key: 'department_name', header: 'Department' },
    { key: 'function_name', header: 'Function' },
    { key: 'risk', header: 'Risk', render: r => (r.risk ? <StatusBadge status={r.risk} /> : '—') },
    { key: 'status', header: 'Status', render: r => <StatusBadge status={r.status || 'Planned'} /> },
    {
      key: 'can_close', header: 'Closure', render: r => r.can_close
        ? <span className="text-xs font-semibold text-primary inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Ready</span>
        : <span className="text-xs font-semibold text-destructive">{r.blocker_count} blocker(s)</span>,
    },
    {
      key: 'blockers', header: 'What is blocking closure',
      render: r => (
        <ul className="text-xs text-muted-foreground list-disc pl-4 max-w-[360px]">
          {(Array.isArray(r.blockers) ? r.blockers : []).slice(0, 4).map((b: string, i: number) => <li key={i}>{b}</li>)}
        </ul>
      ),
    },
  ];

  const exportCols = (cols: DataTableColumn<any>[]): ExportColumn[] =>
    cols.map(col => ({ key: col.key, header: col.header }));

  const tabs = [
    { value: 'my-work', label: 'My Audit Work', icon: ListChecks, rows: applyText(myWork.data ?? []), cols: workColumns, q: myWork, onView: (r: any) => go(r.link) },
    { value: 'management', label: 'Management Actions', icon: Users, rows: applyText(management.data ?? []), cols: managementColumns, q: management, onView: (r: any) => go(r.link) },
    { value: 'attention', label: 'Head of Audit', icon: Target, rows: applyText(attention.data ?? []), cols: attentionColumns, q: attention, onView: (r: any) => go(r.link) },
    { value: 'register', label: 'Action Register', icon: ClipboardList, rows: applyText(actions.data ?? []), cols: actionColumns, q: actions, onView: (r: any) => setSelectedAction(r) },
    { value: 'findings', label: 'Findings Register', icon: AlertTriangle, rows: applyText(findings.data ?? []), cols: findingColumns, q: findings, onView: (r: any) => navigate(`/audit/audits/${r.engagement_id}?tab=findings`) },
    { value: 'verification', label: 'Verification', icon: ShieldCheck, rows: applyText(verification.data ?? []), cols: actionColumns, q: verification, onView: (r: any) => setSelectedAction(r) },
    { value: 'followup', label: 'Follow-Up', icon: CalendarClock, rows: applyText(followUps.data ?? []), cols: followUpColumns, q: followUps, onView: (r: any) => setFollowUpTarget(r) },
    { value: 'qa', label: 'Quality Review', icon: Gavel, rows: applyText(qaQueue.data ?? []), cols: qaColumns, q: qaQueue, onView: (r: any) => go(r.link) },
    { value: 'closure', label: 'Closure Readiness', icon: CheckCircle2, rows: applyText(closure.data ?? []), cols: closureColumns, q: closure, onView: (r: any) => go(r.link) },
  ];

  const active = tabs.find(t => t.value === tab) ?? tabs[0];

  /**
   * Metric tiles are drill-downs: clicking one applies the same server filter that
   * produced the number and lands on the list that holds exactly that population.
   */
  const metrics: { label: string; value: any; tone: string; target: string; patch: IaFilters }[] = [
    { label: 'Open findings', value: c.open_findings, tone: 'default', target: 'findings', patch: { open_only: true } },
    { label: 'High / critical', value: c.high_findings, tone: 'danger', target: 'findings', patch: { open_only: true, high_critical: true } },
    { label: 'Responses outstanding', value: c.pending_management_responses, tone: 'warning', target: 'findings', patch: { response_outstanding: true } },
    { label: 'Open actions', value: c.open_actions, tone: 'default', target: 'register', patch: { open_only: true } },
    { label: 'Overdue actions', value: c.overdue_actions, tone: 'danger', target: 'register', patch: { overdue: true } },
    { label: 'Awaiting verification', value: c.verification_required, tone: 'warning', target: 'verification', patch: { status: 'Verification Required' } },
    { label: 'Follow-ups due', value: c.followups_due, tone: 'warning', target: 'followup', patch: {} },
    { label: 'Awaiting QA', value: c.audits_ready_for_qa, tone: 'warning', target: 'qa', patch: {} },
    { label: 'Audits ready to close', value: c.audits_ready_for_closure, tone: 'success', target: 'closure', patch: {} },
    { label: 'Closure blocked', value: c.audits_blocked_from_closure, tone: 'danger', target: 'closure', patch: {} },
  ];

  const drillDown = (m: { target: string; patch: IaFilters }) => {
    setSearch('');
    setFilters(f => ({ ...f, ...m.patch }));
    setTab(m.target);
  };

  const summaryAudit = filters.engagement_id
    ? labelFor(auditOptions, filters.engagement_id)
    : '';

  return (
    <PageShell
      title="Audit Action Centre"
      subtitle="One operating surface for audit work queues, corrective actions, follow-up and closure readiness"
      breadcrumbs={[{ label: 'Internal Audit', href: '/audit/dashboard' }, { label: 'Action Centre' }]}
      actions={
        <div className="flex items-center gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={isRefreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={printList}>
            <Printer className="h-4 w-4 mr-2" />Print / PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={printSummary}
            disabled={!filters.engagement_id}
            title={filters.engagement_id ? 'Print the audit action summary' : 'Select an audit in the filters first'}
          >
            <ClipboardList className="h-4 w-4 mr-2" />Audit action summary
          </Button>
          <ExportDropdown
            data={active.rows}
            columns={exportCols(active.cols)}
            fileName={`internal-audit-${active.value}`}
            title={`Internal Audit — ${active.label}`}
            metadata={{
              title: `Internal Audit — ${active.label}`,
              generatedDate: new Date().toLocaleString(),
              filtersApplied: appliedFilters,
              totalRecords: active.rows.length,
            }}
          />
        </div>
      }
    >
      {/* Print / PDF output — full filtered population, no interactive chrome */}
      {printMode === 'list' ? (
        <ActionCentrePrintView
          title={active.label}
          columns={exportCols(active.cols)}
          rows={active.rows}
          filters={appliedFilters}
        />
      ) : (
        <AuditActionSummaryPrintView
          engagementLabel={summaryAudit}
          findings={findings.data ?? []}
          actions={actions.data ?? []}
          followUps={followUps.data ?? []}
        />
      )}

      <div className="space-y-4 print:hidden">
      {/* Metrics — every number drills into the exact population behind it */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {metrics.map(m => (
          <button key={m.label} onClick={() => drillDown(m)} className="text-left">
            <Card className="hover:border-primary/50 transition-colors h-full">
              <CardContent className="p-3">
                <p className="text-[11px] text-muted-foreground leading-tight">{m.label}</p>
                <p className={`text-2xl font-bold ${
                  m.tone === 'danger' ? 'text-destructive'
                    : m.tone === 'warning' ? 'text-amber-600 dark:text-amber-400'
                    : m.tone === 'success' ? 'text-primary' : 'text-foreground'
                }`}>{m.value ?? 0}</p>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>


      {/* Filter contract shared by every register and queue */}
      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search across the current list..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="max-w-sm h-9"
            />
            <Button variant="outline" size="sm" onClick={() => setShowFilters(v => !v)}>
              <Filter className="h-4 w-4 mr-2" />{showFilters ? 'Hide filters' : 'Filters'}
            </Button>
            <Button variant={filters.overdue ? 'default' : 'outline'} size="sm"
              onClick={() => setFilters(f => ({ ...f, overdue: !f.overdue }))}>
              Overdue only
            </Button>
            <Button variant={filters.due_soon ? 'default' : 'outline'} size="sm"
              onClick={() => setFilters(f => ({ ...f, due_soon: !f.due_soon }))}>
              Due in 14 days
            </Button>
            <Button variant={filters.open_only ? 'default' : 'outline'} size="sm"
              onClick={() => setFilters(f => ({ ...f, open_only: !f.open_only }))}>
              Open only
            </Button>
            <Button variant={filters.high_critical ? 'default' : 'outline'} size="sm"
              onClick={() => setFilters(f => ({ ...f, high_critical: !f.high_critical }))}>
              High / critical
            </Button>
            <Button variant={filters.disputed ? 'default' : 'outline'} size="sm"
              onClick={() => setFilters(f => ({ ...f, disputed: !f.disputed }))}>
              Disputed
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setFilters({}); setSearch(''); }}>Clear</Button>
          </div>

          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <FilterSelect label="Annual plan" value={filters.plan_id} onChange={v => setFilters(f => ({ ...f, plan_id: v }))}
                options={(plans as any[]).map(p => ({ value: p.id, label: `${p.fiscal_year || ''} ${p.title || ''}`.trim() }))} />
              <FilterSelect label="Audit" value={filters.engagement_id} onChange={v => setFilters(f => ({ ...f, engagement_id: v }))}
                options={auditOptions} />
              <FilterSelect label="Department" value={filters.department_id} onChange={v => setFilters(f => ({ ...f, department_id: v }))}
                options={(departments as any[]).map(d => ({ value: d.id, label: d.name }))} />
              <FilterSelect label="Function area" value={filters.function_id} onChange={v => setFilters(f => ({ ...f, function_id: v }))}
                options={functionOptions} />
              <FilterSelect label="Action owner" value={filters.owner_profile_id} onChange={v => setFilters(f => ({ ...f, owner_profile_id: v }))}
                options={ownerOptions} />
              <FilterSelect label="Severity" value={filters.severity} onChange={v => setFilters(f => ({ ...f, severity: v }))}
                options={SEVERITIES.map(s => ({ value: s, label: s }))} />
              <FilterSelect label="Action status" value={filters.status} onChange={v => setFilters(f => ({ ...f, status: v }))}
                options={ACTION_STATUSES.map(s => ({ value: s, label: s }))} />
              <FilterSelect label="Finding status" value={filters.finding_status} onChange={v => setFilters(f => ({ ...f, finding_status: v }))}
                options={FINDING_STATUSES.map(s => ({ value: s, label: s }))} />
              <div>
                <Label className="text-[11px] text-muted-foreground">Due from</Label>
                <Input type="date" className="h-9" value={filters.due_from || ''} onChange={e => setFilters(f => ({ ...f, due_from: e.target.value }))} />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Due to</Label>
                <Input type="date" className="h-9" value={filters.due_to || ''} onChange={e => setFilters(f => ({ ...f, due_to: e.target.value }))} />
              </div>
            </div>
          )}

        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto">
          {tabs.map(t => (
            <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              <span className="ml-1 text-[10px] text-muted-foreground">{t.rows.length}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map(t => (
          <TabsContent key={t.value} value={t.value} className="mt-4">
            <DataTable
              columns={t.cols}
              data={t.rows}
              isLoading={t.q.isLoading}
              emptyMessage="Nothing in this queue"
              onView={t.onView}
              keyField={t.value === 'register' || t.value === 'verification' ? 'action_id'
                : t.value === 'findings' ? 'finding_id'
                : t.value === 'followup' ? 'follow_up_id'
                : t.value === 'qa' ? 'review_id'
                : t.value === 'closure' ? 'engagement_id' : 'record_id'}
              pageSize={20}
            />
          </TabsContent>
        ))}
      </Tabs>
      </div>



      <ActionLifecycleDialog
        action={selectedAction}
        open={!!selectedAction}
        onOpenChange={o => { if (!o) setSelectedAction(null); }}
      />

      {/* Follow-up outcome */}
      <Dialog open={!!followUpTarget} onOpenChange={o => { if (!o) { setFollowUpTarget(null); setOutcomeNotes(''); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record follow-up outcome</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{followUpTarget?.action_required}</p>
            <div>
              <Label className="text-xs">Outcome</Label>
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-background z-50">
                  {['Implemented', 'Partially Implemented', 'Not Implemented', 'Superseded', 'Carried Forward'].map(o => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea rows={3} value={outcomeNotes} onChange={e => setOutcomeNotes(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setFollowUpTarget(null)}>Cancel</Button>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await recordOutcome.mutateAsync({
                      followUpId: followUpTarget.follow_up_id,
                      outcome,
                      notes: outcomeNotes,
                    });
                    setFollowUpTarget(null);
                    setOutcomeNotes('');
                  } catch { /* surfaced by the hook */ }
                }}
              >
                Record outcome
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function overdueCell(days?: number | null) {
  const d = Number(days || 0);
  if (d <= 0) return <span className="text-muted-foreground">—</span>;
  return <span className="text-destructive font-semibold text-xs">{d}d</span>;
}

function FilterSelect({ label, value, onChange, options }: {
  label: string;
  value?: string | null;
  onChange: (value: string | null) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Select value={value || 'all'} onValueChange={v => onChange(v === 'all' ? null : v)}>
        <SelectTrigger className="h-9"><SelectValue placeholder="All" /></SelectTrigger>
        <SelectContent className="bg-background z-50 max-h-64">
          <SelectItem value="all">All</SelectItem>
          {options.filter(o => o.value).map(o => (
            <SelectItem key={o.value} value={o.value}>{o.label || '—'}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
