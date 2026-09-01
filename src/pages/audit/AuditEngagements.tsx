import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Briefcase, Clock, CheckCircle, AlertTriangle, Search, ExternalLink } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { PageShell, StandardSearchFilterBar, DataTable, StandardModal, StatusBadge } from '@/components/common';
import type { DataTableColumn, StandardFilterField } from '@/components/common';
import { useIAEngagements } from '@/hooks/useAuditDataPhase2';
import { useIADepartments, useIAAnnualPlans, useIAActiveAuditors, useIADepartmentFunctions, useIAFindings, useIAActionTracking } from '@/hooks/useAuditData';
import { useAuditFields } from '@/hooks/useAuditTrail';
import { MetricCard } from '@/components/shared/MetricCard';
import { formatDateForDisplay } from '@/lib/format-config';
import { useTeamAvailabilityCheck } from '@/hooks/useAuditWorkflowGates';
import { ConflictAlertPanel } from '@/components/audit/ConflictAlertPanel';
import { formatDepartmentLabel } from '@/lib/audit/departmentLabel';
import { useToast } from '@/hooks/use-toast';
import { useHasPermission } from '@/hooks/useNavigationMenu';
import { Progress } from '@/components/ui/progress';

const STATUSES = ['Planned', 'In Progress', 'Findings Raised', 'Management Response', 'Closed'];
const RISK_RATINGS = ['Critical', 'High', 'Medium', 'Low'];
const PLAN_STATUS_OPTIONS = ['All Plans', 'Approved', 'Draft', 'Active', 'Superseded', 'Archived'];
const ENGAGEMENT_TYPES = ['Planned Audit', 'Ad Hoc', 'Supplementary', 'Follow-up'];

const generateEngagementCode = () => {
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `AUD-${dateStr}-${rand}`;
};

const emptyForm = {
  engagement_name: '', engagement_code: '', annual_plan_id: '', department_id: '',
  function_id: '', lead_auditor_id: '', supportive_auditor_ids: [] as string[],
  scope: '', objectives: '',
  engagement_risk_rating: 'Medium',
  planned_start_date: '', planned_end_date: '', status: 'Planned',
  engagement_type: 'Planned Audit',
};

export default function AuditEngagements() {
  const navigate = useNavigate();
  const canCreateEngagement = useHasPermission('audit_engagements', 'create');
  const { toast } = useToast();
  const { data = [], isLoading, isError, create, update } = useIAEngagements();
  const { data: departments = [] } = useIADepartments();
  const { data: plans = [] } = useIAAnnualPlans();
  const { data: auditors = [] } = useIAActiveAuditors();
  const { data: allFunctions = [] } = useIADepartmentFunctions('all');
  const { data: allFindings = [] } = useIAFindings();
  const { data: allActions = [] } = useIAActionTracking();
  const { getCreateFields, getUpdateFields } = useAuditFields();
  const checkAvailability = useTeamAvailabilityCheck();
  const [searchTerm, setSearchTerm] = useState('');
  // DEF-S1B-36: default to all plan statuses so audits belonging to closed or
  // carried-forward annual plans remain discoverable without changing filters.
  const [filters, setFilters] = useState<Record<string, string>>({ status: 'all', risk: 'all', plan_status: 'All Plans', plan_id: 'all' });
  const [modalState, setModalState] = useState<{ mode: 'create' | 'edit' | null; record?: any }>({ mode: null });
  const [form, setForm] = useState(emptyForm);
  const [conflictResult, setConflictResult] = useState<any>(null);

  const { data: deptFunctions = [] } = useIADepartmentFunctions(form.department_id || undefined);

  const functionMap = useMemo(() => Object.fromEntries((allFunctions || []).map((fn: any) => [fn.id, fn])), [allFunctions]);
  const departmentMap = useMemo(() => Object.fromEntries((departments || []).map((d: any) => [d.id, d])), [departments]);
  const planMap = useMemo(() => Object.fromEntries((plans || []).map((p: any) => [p.id, p])), [plans]);

  const filteredPlanOptions = useMemo(() => {
    return (plans || []).filter((p: any) => {
      if (filters.plan_status === 'All Plans') return true;
      return p.status === filters.plan_status;
    });
  }, [plans, filters.plan_status]);

  const enrichedData = useMemo(() => {
    return data.map((r: any) => {
      const plan = r.annual_plan_id ? planMap[r.annual_plan_id] : null;
      const engFindings = allFindings.filter((f: any) => f.engagement_id === r.id);
      const engActions = allActions.filter((a: any) => a.engagement_id === r.id);
      const openFindings = engFindings.filter((f: any) => !['Closed', 'Resolved'].includes(f.status || ''));
      const openActions = engActions.filter((a: any) => !['Completed', 'Closed'].includes(a.status || ''));

      // Source label
      let source = 'Annual Plan';
      if (r.engagement_type === 'Ad Hoc') source = 'Ad Hoc';
      else if (r.engagement_type === 'Supplementary') source = 'Supplementary';
      else if (!r.annual_plan_id) source = 'Ad Hoc';

      return {
        ...r,
        _plan_name: plan?.title || plan?.plan_name || '—',
        _plan_status: plan?.status || 'Unknown',
        _fiscal_year: plan?.fiscal_year || '—',
        _source: source,
        _open_findings: openFindings.length,
        _open_actions: openActions.length,
        _total_findings: engFindings.length,
      };
    });
  }, [data, planMap, allFindings, allActions]);

  const filtered = enrichedData.filter((r: any) => {
    const s = searchTerm.toLowerCase();
    const ms = !s || r.engagement_name?.toLowerCase().includes(s) || r.engagement_code?.toLowerCase().includes(s);
    const mSt = filters.status === 'all' || r.status === filters.status;
    const mR = filters.risk === 'all' || r.engagement_risk_rating === filters.risk;
    const mPs = filters.plan_status === 'All Plans' || r._plan_status === filters.plan_status;
    const mPl = filters.plan_id === 'all' || r.annual_plan_id === filters.plan_id;
    return ms && mSt && mR && mPs && mPl;
  });

  const stats = {
    total: filtered.length,
    inProgress: filtered.filter((d: any) => d.status === 'In Progress').length,
    completed: filtered.filter((d: any) => d.status === 'Closed').length,
    planned: filtered.filter((d: any) => d.status === 'Planned').length,
  };

  const getDeptName = (id: string) => formatDepartmentLabel(departmentMap[id]);
  const getAuditorName = (id: string) => auditors?.find((a: any) => a.id === id)?.name || '—';

  const openAdd = () => {
    setForm({ ...emptyForm, engagement_code: generateEngagementCode() });
    setModalState({ mode: 'create' });
  };
  const openEdit = (r: any) => {
    setForm({
      engagement_name: r.engagement_name || '', engagement_code: r.engagement_code || '',
      annual_plan_id: r.annual_plan_id || '', department_id: r.department_id || '',
      function_id: r.function_id || '', lead_auditor_id: r.lead_auditor_id || '',
      supportive_auditor_ids: Array.isArray(r.supportive_auditor_ids) ? r.supportive_auditor_ids : [],
      scope: r.scope || '', objectives: r.objectives || '',
      engagement_risk_rating: r.engagement_risk_rating || 'Medium',
      planned_start_date: r.planned_start_date || '', planned_end_date: r.planned_end_date || '',
      status: r.status || 'Planned',
      engagement_type: r.engagement_type || 'Planned Audit',
    });
    setModalState({ mode: 'edit', record: r });
  };

  const handleSave = async () => {
    if (!form.engagement_name) return;
    const payload = {
      engagement_name: form.engagement_name,
      engagement_code: form.engagement_code,
      annual_plan_id: form.annual_plan_id || null,
      department_id: form.department_id || null,
      function_id: form.function_id || null,
      lead_auditor_id: form.lead_auditor_id || null,
      supportive_auditor_ids: form.supportive_auditor_ids,
      scope: form.scope,
      objectives: form.objectives,
      engagement_risk_rating: form.engagement_risk_rating,
      planned_start_date: form.planned_start_date || null,
      planned_end_date: form.planned_end_date || null,
      status: form.status,
      engagement_type: form.engagement_type,
    };

    if (form.planned_start_date && form.planned_end_date && form.lead_auditor_id) {
      try {
        const teamIds = [form.lead_auditor_id, ...form.supportive_auditor_ids];
        const conflicts = await checkAvailability.mutateAsync({
          auditorIds: teamIds,
          dateFrom: form.planned_start_date,
          dateTo: form.planned_end_date,
        });
        setConflictResult(conflicts);
        if (conflicts.has_blocking) {
          toast({ title: 'Blocking Conflicts', description: 'Resolve blocking conflicts before saving.', variant: 'destructive' });
          return;
        }
      } catch { /* Non-critical */ }
    }

    if (modalState.mode === 'create') {
      create.mutate({ ...payload, ...getCreateFields() } as any, { onSuccess: () => { setModalState({ mode: null }); setConflictResult(null); } });
    } else if (modalState.mode === 'edit' && modalState.record) {
      update.mutate({ id: modalState.record.id, ...payload, ...getUpdateFields() } as any, { onSuccess: () => { setModalState({ mode: null }); setConflictResult(null); } });
    }
  };

  const toggleSupportiveAuditor = (auditorId: string) => {
    setForm(f => {
      const current = f.supportive_auditor_ids;
      return { ...f, supportive_auditor_ids: current.includes(auditorId) ? current.filter(id => id !== auditorId) : [...current, auditorId] };
    });
  };

  const columns: DataTableColumn<any>[] = [
    { key: 'engagement_name', header: 'Audit Name', render: (r) => (
      <button onClick={() => navigate(`/audit/audits/${r.id}`)} className="text-left hover:text-primary transition-colors">
        <span className="font-medium text-sm block">{r.engagement_name}</span>
        <span className="text-xs text-muted-foreground font-mono">{r.engagement_code}</span>
      </button>
    )},
    { key: '_source', header: 'Source', render: (r) => (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
        r._source === 'Annual Plan' ? 'bg-primary/10 text-primary' :
        r._source === 'Supplementary' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
        'bg-muted text-muted-foreground'
      }`}>{r._source}</span>
    )},
    { key: 'department_id', header: 'Department / Function', render: (r) => (
      <div>
        <span className="text-sm">{r.department_id ? getDeptName(r.department_id) : '—'}</span>
        {r.function_id && functionMap[r.function_id] && (
          <span className="text-xs text-muted-foreground block">{functionMap[r.function_id]?.function_name}</span>
        )}
      </div>
    )},
    { key: 'lead_auditor_id', header: 'Lead Auditor', render: (r) => <span className="text-sm">{r.lead_auditor_id ? getAuditorName(r.lead_auditor_id) : <span className="text-muted-foreground">—</span>}</span> },
    { key: 'engagement_risk_rating', header: 'Risk', render: (r) => <StatusBadge status={r.engagement_risk_rating} /> },
    { key: 'planned_start_date', header: 'Audit Period', render: (r) => (
      <span className="text-xs">
        {r.planned_start_date ? formatDateForDisplay(r.planned_start_date) : '—'}
        {r.planned_end_date ? ` — ${formatDateForDisplay(r.planned_end_date)}` : ''}
      </span>
    )},
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: '_open_findings', header: 'Findings', render: (r) => (
      <span className={`text-sm font-medium ${r._open_findings > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
        {r._open_findings > 0 ? `${r._open_findings} open` : r._total_findings > 0 ? `${r._total_findings} (closed)` : '—'}
      </span>
    )},
    { key: '_open_actions', header: 'Actions', render: (r) => (
      <span className={`text-sm font-medium ${r._open_actions > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
        {r._open_actions > 0 ? `${r._open_actions} open` : '—'}
      </span>
    )},
  ];

  const filterFields: StandardFilterField[] = [
    { key: 'plan_status', label: 'Plan Status', type: 'select', options: PLAN_STATUS_OPTIONS.map(s => ({ label: s, value: s })) },
    { key: 'plan_id', label: 'Annual Plan', type: 'select', options: [{ label: 'All Plans', value: 'all' }, ...filteredPlanOptions.map((p: any) => ({ label: `${p.title || p.plan_name} (${p.fiscal_year})`, value: p.id }))] },
    { key: 'status', label: 'Status', type: 'select', options: [{ label: 'All', value: 'all' }, ...STATUSES.map(s => ({ label: s, value: s }))] },
    { key: 'risk', label: 'Risk', type: 'select', options: [{ label: 'All', value: 'all' }, ...RISK_RATINGS.map(r => ({ label: r, value: r }))] },
  ];

  return (
    <PageShell title="Audits" subtitle="Select an audit to open its workspace"
      breadcrumbs={[{ label: 'Internal Audit', href: '/audit/dashboard' }, { label: 'Audits' }]}
      actions={canCreateEngagement ? <Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" />New Audit</Button> : null}
      isLoading={isLoading} error={isError ? 'Failed to load' : null}>

      {filters.plan_status !== 'All Plans' && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 text-sm">
          <span className="font-medium">Showing audits from</span>
          <StatusBadge status={filters.plan_status} />
          <span>plans.</span>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setFilters(f => ({ ...f, plan_status: 'All Plans', plan_id: 'all' }))}>
            Show all
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Audits" value={stats.total} icon={Briefcase} variant="info" />
        <MetricCard title="In Progress" value={stats.inProgress} icon={Clock} variant="warning" />
        <MetricCard title="Completed" value={stats.completed} icon={CheckCircle} variant="success" />
        <MetricCard title="Planned" value={stats.planned} icon={AlertTriangle} variant="default" />
      </div>

      <Card><CardContent className="p-4">
        <StandardSearchFilterBar searchValue={searchTerm} onSearchChange={setSearchTerm} searchPlaceholder="Search audits..."
          filterValues={filters}
          onFilterChange={(k, v) => {
            setFilters(f => {
              const next = { ...f, [k]: v };
              if (k === 'plan_status') next.plan_id = 'all';
              return next;
            });
          }}
          filters={filterFields}
          onReset={() => { setSearchTerm(''); setFilters({ status: 'all', risk: 'all', plan_status: 'All Plans', plan_id: 'all' }); }}
        />
      </CardContent></Card>

      {conflictResult && conflictResult.total_conflicts > 0 && (
        <ConflictAlertPanel conflicts={conflictResult.conflicts} onDismiss={() => setConflictResult(null)} />
      )}

      <Card><CardContent>
        <DataTable columns={columns} data={filtered}
          renderActions={(row) => (
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/audit/audits/${row.id}`);
                    }}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open Workspace</TooltipContent>
              </Tooltip>
            </div>
          )} />
      </CardContent></Card>

      {/* Create/Edit Modal - preserved with all fields */}
      <StandardModal open={modalState.mode !== null} onOpenChange={() => setModalState({ mode: null })}
        title={modalState.mode === 'create' ? 'New Audit' : 'Edit Audit'}
        mode={modalState.mode || 'create'} onSave={handleSave} saveLabel="Save" isSaving={create.isPending || update.isPending} size="4xl">
        <div className="space-y-4">
          {/* Identity */}
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Identity</p>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Audit Title *</Label><Input value={form.engagement_name} onChange={e => setForm(f => ({ ...f, engagement_name: e.target.value }))} /></div>
            <div><Label>Audit Code <span className="text-xs text-muted-foreground">(auto)</span></Label><Input value={form.engagement_code} disabled className="bg-muted" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Audit Type</Label>
              <Select value={form.engagement_type} onValueChange={v => setForm(f => ({ ...f, engagement_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ENGAGEMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Annual Plan <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Select value={form.annual_plan_id} onValueChange={v => setForm(f => ({ ...f, annual_plan_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Link to annual plan" /></SelectTrigger>
                <SelectContent>{(plans || []).map((p: any) => <SelectItem key={p.id} value={p.id}>{p.title} ({p.fiscal_year})</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          {/* Coverage */}
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2">Coverage</p>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Department *</Label>
              <Select value={form.department_id} onValueChange={v => setForm(f => ({ ...f, department_id: v, function_id: '' }))}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>{departments.map((d: any) => <SelectItem key={d.id} value={d.id}>{formatDepartmentLabel(d)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Function *</Label>
              <Select value={form.function_id} onValueChange={v => setForm(f => ({ ...f, function_id: v }))} disabled={!form.department_id}>
                <SelectTrigger><SelectValue placeholder={form.department_id ? 'Select function' : 'Select department first'} /></SelectTrigger>
                <SelectContent>{deptFunctions.map((fn: any) => <SelectItem key={fn.id} value={fn.id}>{fn.function_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          {/* Team */}
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2">Team</p>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Lead Auditor</Label>
              <Select value={form.lead_auditor_id} onValueChange={v => setForm(f => ({ ...f, lead_auditor_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select lead auditor" /></SelectTrigger>
                <SelectContent>{(auditors || []).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Supportive Auditor(s)</Label>
              <div className="border rounded-md p-2 max-h-[100px] overflow-y-auto space-y-1 bg-background">
                {(auditors || []).filter((a: any) => a.id !== form.lead_auditor_id).map((a: any) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted rounded px-1 py-0.5">
                    <Checkbox checked={form.supportive_auditor_ids.includes(a.id)} onCheckedChange={() => toggleSupportiveAuditor(a.id)} />
                    {a.name}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Risk & Schedule */}
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2">Risk & Schedule</p>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Risk Rating</Label>
              <Select value={form.engagement_risk_rating} onValueChange={v => setForm(f => ({ ...f, engagement_risk_rating: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{RISK_RATINGS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Start Date</Label><Input type="date" value={form.planned_start_date} onChange={e => setForm(f => ({ ...f, planned_start_date: e.target.value }))} /></div>
            <div><Label>End Date</Label><Input type="date" value={form.planned_end_date} onChange={e => setForm(f => ({ ...f, planned_end_date: e.target.value }))} /></div>
          </div>

          {/* Scope & Objectives */}
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2">Scope & Objectives</p>
          <div><Label>Scope</Label><Textarea value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))} className="text-sm leading-relaxed" /></div>
          <div><Label>Objectives</Label><Textarea value={form.objectives} onChange={e => setForm(f => ({ ...f, objectives: e.target.value }))} className="text-sm leading-relaxed" /></div>
        </div>
      </StandardModal>
    </PageShell>
  );
}
