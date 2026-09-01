import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Shield, AlertTriangle, Eye, Edit, Trash2, Link2, Clock, XCircle, FileDown } from 'lucide-react';
import { PageShell, StandardSearchFilterBar, DataTable, StandardModal, StatusBadge, ExportDropdown } from '@/components/common';
import type { DataTableColumn, StandardFilterField } from '@/components/common';
import { MetricCard } from '@/components/shared/MetricCard';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTablePagination } from '@/hooks/useTablePagination';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  useRiskRegister, useRiskRegisterMutations,
  useRiskMitigationActions, useRiskMitigationMutations,
  useRiskReviews, useRiskReviewMutations,
  useDuplicateRiskCheck, useMitigationTemplates,
  RISK_CATEGORIES, RISK_STATUSES, CONTROL_EFFECTIVENESS,
  MITIGATION_STATUSES, MITIGATION_PRIORITIES, RISK_SOURCES,
  calculateRiskLevel, getRiskLevelVariant,
} from '@/hooks/useRiskRegister';
import { RISK_REGISTER_SCHEMA, toExportColumns } from '@/config/moduleFieldSchemas';
import { formatDateForDisplay } from '@/lib/format-config';
import { useAuditFields } from '@/hooks/useAuditTrail';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { AuditEmptyState } from '@/components/audit/workspace/AuditEmptyState';
import { buildMetadata, exportRiskDetailPDF, exportMitigationPlanPDF, type GroupByOption } from '@/lib/auditReportExports';
import { formatDepartmentLabel } from '@/lib/audit/departmentLabel';

const exportColumns = toExportColumns(RISK_REGISTER_SCHEMA);
const RISK_LEVELS = ['Critical', 'High', 'Medium', 'Low'];

const emptyRisk = {
  department_id: '',
  risk_title: '',
  risk_description: '',
  risk_category: 'Operational',
  risk_source: '',
  inherent_likelihood: 3,
  inherent_impact: 3,
  residual_likelihood: 2,
  residual_impact: 2,
  control_effectiveness: 'Moderate',
  risk_owner: '',
  review_date: '',
  due_date: '',
  status: 'Open',
  fiscal_year: new Date().getFullYear().toString(),
  linked_risk_id: '',
  notes: '',
};

const emptyAction = {
  action_title: '',
  action_description: '',
  assigned_to: '',
  due_date: '',
  status: 'Planned',
  priority: 'Medium',
  evidence_notes: '',
  template_id: '',
};

export default function RiskRegister() {
  const { data: departments = [] } = useQuery({
    queryKey: ['v_ia_departments_active'],
    queryFn: async () => {
      const { data } = await (supabase.from('v_ia_departments' as any) as any).select('id, name, office_code, display_label').eq('is_active', true).order('display_label');
      return (data || []) as any[];
    },
  });
  const [entityFilter, setEntityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [reviewDueFilter, setReviewDueFilter] = useState('all');
  const [search, setSearch] = useState('');

  const { data: risks = [], isLoading } = useRiskRegister();
  const { create, update, remove } = useRiskRegisterMutations();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyRisk);
  const [detailRisk, setDetailRisk] = useState<any>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<string | null>(null);
  const [closeRiskId, setCloseRiskId] = useState<string | null>(null);
  const [closeComment, setCloseComment] = useState('');

  // Duplicate check
  const { data: dupes = [] } = useDuplicateRiskCheck(form.department_id, form.risk_title, form.risk_category);
  const showDupeWarning = !editingId && dupes.length > 0;

  // Unique owners for filter
  const ownerOptions = useMemo(() => {
    const owners = new Set<string>();
    risks.forEach((r: any) => { if (r.risk_owner) owners.add(r.risk_owner); });
    return Array.from(owners).sort();
  }, [risks]);

  const today = new Date().toISOString().slice(0, 10);

  const filtered = useMemo(() => {
    return risks.filter((r: any) => {
      if (entityFilter !== 'all' && r.department_id !== entityFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && r.risk_category !== categoryFilter) return false;
      if (ownerFilter !== 'all' && r.risk_owner !== ownerFilter) return false;
      if (severityFilter !== 'all' && r.residual_risk_level !== severityFilter) return false;
      if (reviewDueFilter === 'overdue' && (!r.review_date || r.review_date >= today)) return false;
      if (reviewDueFilter === 'upcoming') {
        if (!r.review_date) return false;
        const diff = (new Date(r.review_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
        if (diff < 0 || diff > 30) return false;
      }
      if (search) {
        const s = search.toLowerCase();
        return (r.risk_title?.toLowerCase().includes(s) || r.risk_owner?.toLowerCase().includes(s) || r.ia_departments?.name?.toLowerCase().includes(s));
      }
      return true;
    });
  }, [risks, entityFilter, statusFilter, categoryFilter, ownerFilter, severityFilter, reviewDueFilter, search, today]);

  const { paginatedData, pagination, goToPage } = useTablePagination(filtered, 15);

  const openCount = risks.filter((r: any) => r.status === 'Open').length;
  const criticalCount = risks.filter((r: any) => r.residual_risk_level === 'Critical').length;

  const openCreate = () => { setForm(emptyRisk); setEditingId(null); setModalOpen(true); };
  const openEdit = (row: any) => {
    setForm({
      department_id: row.department_id || '',
      risk_title: row.risk_title || '',
      risk_description: row.risk_description || '',
      risk_category: row.risk_category || 'Operational',
      risk_source: row.risk_source || '',
      inherent_likelihood: row.inherent_likelihood || 3,
      inherent_impact: row.inherent_impact || 3,
      residual_likelihood: row.residual_likelihood || 2,
      residual_impact: row.residual_impact || 2,
      control_effectiveness: row.control_effectiveness || 'Moderate',
      risk_owner: row.risk_owner || '',
      review_date: row.review_date || '',
      due_date: row.due_date || '',
      status: row.status || 'Open',
      fiscal_year: row.fiscal_year || '',
      linked_risk_id: row.linked_risk_id || '',
      notes: row.notes || '',
    });
    setEditingId(row.id);
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!form.risk_title.trim() || !form.department_id) return;
    const payload = { ...form, linked_risk_id: form.linked_risk_id || null, risk_source: form.risk_source || null };
    if (editingId) {
      update.mutate({ id: editingId, ...payload }, { onSuccess: () => setModalOpen(false) });
    } else {
      create.mutate(payload, { onSuccess: () => setModalOpen(false) });
    }
  };

  const handleConfirmDeactivate = () => {
    if (confirmDeactivate) {
      remove.mutate(confirmDeactivate, { onSuccess: () => setConfirmDeactivate(null) });
    }
  };

  // Close risk workflow
  const reviewMut = useRiskReviewMutations();
  const { userCode } = useAuditFields();

  const handleCloseRisk = () => {
    if (!closeRiskId || !closeComment.trim()) return;
    const risk = risks.find((r: any) => r.id === closeRiskId);
    // Add closing review comment
    reviewMut.create.mutate({
      risk_id: closeRiskId,
      reviewed_by: userCode || 'SYSTEM',
      previous_risk_level: risk?.residual_risk_level || 'Unknown',
      new_risk_level: risk?.residual_risk_level || 'Unknown',
      previous_score: risk?.residual_risk_score || 0,
      new_score: risk?.residual_risk_score || 0,
      comments: `Risk closed: ${closeComment}`,
    });
    // Update status to Closed
    update.mutate({ id: closeRiskId, status: 'Closed', inherent_likelihood: risk?.inherent_likelihood, inherent_impact: risk?.inherent_impact, residual_likelihood: risk?.residual_likelihood, residual_impact: risk?.residual_impact }, {
      onSuccess: () => { setCloseRiskId(null); setCloseComment(''); },
    });
  };

  const columns: DataTableColumn<any>[] = [
    { key: 'risk_title', header: 'Risk Title', render: (row: any) => (
      <button className="text-left text-primary hover:underline font-medium" onClick={() => setDetailRisk(row)}>{row.risk_title}</button>
    )},
    { key: 'ia_departments', header: 'Department', render: (row: any) => row.ia_departments?.name || '—' },
    { key: 'risk_category', header: 'Category', render: (row: any) => <Badge variant="outline">{row.risk_category}</Badge> },
    { key: 'risk_source', header: 'Source', render: (row: any) => row.risk_source || '—' },
    { key: 'inherent_risk_score', header: 'Inherent', render: (row: any) => (
      <Badge variant={getRiskLevelVariant(row.inherent_risk_level)}>{row.inherent_risk_score} ({row.inherent_risk_level})</Badge>
    )},
    { key: 'residual_risk_score', header: 'Residual', render: (row: any) => (
      <Badge variant={getRiskLevelVariant(row.residual_risk_level)}>{row.residual_risk_score} ({row.residual_risk_level})</Badge>
    )},
    { key: 'risk_owner', header: 'Owner' },
    { key: 'status', header: 'Status', render: (row: any) => <StatusBadge status={row.status} /> },
    {
      key: 'actions', header: 'Actions', render: (row: any) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => openEdit(row)} title="Edit"><Edit className="h-4 w-4" /></Button>
          {row.status !== 'Closed' && (
            <Button variant="ghost" size="icon" onClick={() => setCloseRiskId(row.id)} title="Close Risk"><XCircle className="h-4 w-4 text-muted-foreground" /></Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => setConfirmDeactivate(row.id)} title="Deactivate"><Trash2 className="h-4 w-4 text-destructive" /></Button>
        </div>
      ),
    },
  ];

  const filterFields: StandardFilterField[] = [
    { key: 'entity', label: 'Department', type: 'select', options: [{ label: 'All Departments', value: 'all' }, ...departments.map((d: any) => ({ label: formatDepartmentLabel(d), value: d.id }))] },
    { key: 'status', label: 'Status', type: 'select', options: [{ label: 'All', value: 'all' }, ...RISK_STATUSES.map(s => ({ label: s, value: s }))] },
    { key: 'category', label: 'Category', type: 'select', options: [{ label: 'All', value: 'all' }, ...RISK_CATEGORIES.map(c => ({ label: c, value: c }))] },
    { key: 'owner', label: 'Owner', type: 'select', options: [{ label: 'All Owners', value: 'all' }, ...ownerOptions.map(o => ({ label: o, value: o }))] },
    { key: 'severity', label: 'Severity', type: 'select', options: [{ label: 'All', value: 'all' }, ...RISK_LEVELS.map(l => ({ label: l, value: l }))] },
    { key: 'reviewDue', label: 'Review Due', type: 'select', options: [{ label: 'All', value: 'all' }, { label: 'Overdue', value: 'overdue' }, { label: 'Next 30 Days', value: 'upcoming' }] },
  ];

  const rrGroupByOptions: GroupByOption[] = [
    { label: 'Entity', key: 'entity_name' },
    { label: 'Owner', key: 'risk_owner' },
    { label: 'Status', key: 'status' },
    { label: 'Category', key: 'risk_category' },
    { label: 'Severity', key: 'residual_risk_level' },
  ];

  const rrMetadata = useMemo(() => buildMetadata(
    'Risk Register',
    filtered.length,
    [
      { label: 'Department', value: entityFilter !== 'all' ? formatDepartmentLabel(departments.find((d: any) => d.id === entityFilter)) : 'all' },
      { label: 'Status', value: statusFilter },
      { label: 'Category', value: categoryFilter },
      { label: 'Owner', value: ownerFilter },
      { label: 'Severity', value: severityFilter },
      { label: 'Review Due', value: reviewDueFilter },
    ],
  ), [filtered.length, entityFilter, statusFilter, categoryFilter, ownerFilter, severityFilter, reviewDueFilter, departments]);

  const iScore = (form.inherent_likelihood || 0) * (form.inherent_impact || 0);
  const rScore = (form.residual_likelihood || 0) * (form.residual_impact || 0);

  return (
    <PageShell title="Risk Register" subtitle="Manage risks across the audit universe">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <MetricCard title="Total Risks" value={risks.length} icon={Shield} />
        <MetricCard title="Open Risks" value={openCount} icon={AlertTriangle} />
        <MetricCard title="Critical" value={criticalCount} icon={AlertTriangle} />
        <MetricCard title="Departments Covered" value={new Set(risks.map((r: any) => r.department_id).filter(Boolean)).size} icon={Eye} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Risk Register</CardTitle>
          <div className="flex gap-2">
            <ExportDropdown data={filtered.map((r: any) => ({ ...r, entity_name: r.ia_departments?.name || '', risk_source: r.risk_source || '' }))} columns={exportColumns} fileName="risk-register" title="Risk Register" metadata={rrMetadata} groupByOptions={rrGroupByOptions} />
            <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Risk</Button>
          </div>
        </CardHeader>
        <CardContent>
          <StandardSearchFilterBar
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search risks..."
            filters={filterFields}
            filterValues={{ entity: entityFilter, status: statusFilter, category: categoryFilter, owner: ownerFilter, severity: severityFilter, reviewDue: reviewDueFilter }}
            onFilterChange={(k, v) => {
              if (k === 'entity') setEntityFilter(v);
              if (k === 'status') setStatusFilter(v);
              if (k === 'category') setCategoryFilter(v);
              if (k === 'owner') setOwnerFilter(v);
              if (k === 'severity') setSeverityFilter(v);
              if (k === 'reviewDue') setReviewDueFilter(v);
            }}
          />
          {!isLoading && risks.length === 0 ? (
            <AuditEmptyState
              icon={Shield}
              title="No risks registered"
              description="Start by adding a risk linked to an entity in the audit universe."
              actionLabel="Add Risk"
              onAction={openCreate}
            />
          ) : (
            <DataTable columns={columns} data={paginatedData} isLoading={isLoading} emptyMessage="No risks match your filters." />
          )}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-muted-foreground">
                Showing {(pagination.page - 1) * pagination.pageSize + 1}–{Math.min(pagination.page * pagination.pageSize, pagination.totalItems)} of {pagination.totalItems}
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => goToPage(pagination.page - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => goToPage(pagination.page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* CREATE/EDIT MODAL */}
      <StandardModal open={modalOpen} onOpenChange={setModalOpen} title={editingId ? 'Edit Risk' : 'Add Risk'} size="lg"
        footer={<><Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={handleSave} disabled={create.isPending || update.isPending}>{editingId ? 'Update' : 'Create'}</Button></>}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2 md:col-span-2">
            <Label>Department *</Label>
            <Select value={form.department_id} onValueChange={v => setForm(f => ({ ...f, department_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select department..." /></SelectTrigger>
              <SelectContent>{departments.map((d: any) => <SelectItem key={d.id} value={d.id}>{formatDepartmentLabel(d)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Risk Title *</Label>
            <Input value={form.risk_title} onChange={e => setForm(f => ({ ...f, risk_title: e.target.value }))} />
          </div>
          {showDupeWarning && (
            <div className="md:col-span-2 p-3 border border-border bg-muted rounded-md">
              <p className="text-sm font-medium text-foreground flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /> Similar risks found on this entity:</p>
              <ul className="mt-1 space-y-1">
                {dupes.map((d: any) => (
                  <li key={d.id} className="text-sm flex items-center justify-between">
                    <span>{d.risk_title} ({d.status})</span>
                    <Button variant="outline" size="sm" onClick={() => setForm(f => ({ ...f, linked_risk_id: d.id }))}><Link2 className="h-3 w-3 mr-1" />Link</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="space-y-2 md:col-span-2">
            <Label>Description</Label>
            <Textarea value={form.risk_description} onChange={e => setForm(f => ({ ...f, risk_description: e.target.value }))} rows={2} />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={form.risk_category} onValueChange={v => setForm(f => ({ ...f, risk_category: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{RISK_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Risk Source</Label>
            <Select value={form.risk_source || '__none__'} onValueChange={v => setForm(f => ({ ...f, risk_source: v === '__none__' ? '' : v }))}>
              <SelectTrigger><SelectValue placeholder="Select source..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— None —</SelectItem>
                {RISK_SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Control Effectiveness</Label>
            <Select value={form.control_effectiveness} onValueChange={v => setForm(f => ({ ...f, control_effectiveness: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CONTROL_EFFECTIVENESS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Inherent Likelihood (1-5)</Label>
            <Select value={String(form.inherent_likelihood)} onValueChange={v => setForm(f => ({ ...f, inherent_likelihood: Number(v) }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Inherent Impact (1-5)</Label>
            <Select value={String(form.inherent_impact)} onValueChange={v => setForm(f => ({ ...f, inherent_impact: Number(v) }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Residual Likelihood (1-5)</Label>
            <Select value={String(form.residual_likelihood)} onValueChange={v => setForm(f => ({ ...f, residual_likelihood: Number(v) }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Residual Impact (1-5)</Label>
            <Select value={String(form.residual_impact)} onValueChange={v => setForm(f => ({ ...f, residual_impact: Number(v) }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="md:col-span-2 flex gap-4">
            <div className="flex-1 p-3 rounded-md bg-muted text-center">
              <p className="text-xs text-muted-foreground">Inherent Risk</p>
              <Badge variant={getRiskLevelVariant(calculateRiskLevel(iScore))} className="mt-1">{iScore} — {calculateRiskLevel(iScore)}</Badge>
            </div>
            <div className="flex-1 p-3 rounded-md bg-muted text-center">
              <p className="text-xs text-muted-foreground">Residual Risk</p>
              <Badge variant={getRiskLevelVariant(calculateRiskLevel(rScore))} className="mt-1">{rScore} — {calculateRiskLevel(rScore)}</Badge>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Risk Owner</Label>
            <Input value={form.risk_owner} onChange={e => setForm(f => ({ ...f, risk_owner: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{RISK_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Review Date</Label>
            <Input type="date" value={form.review_date} onChange={e => setForm(f => ({ ...f, review_date: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Due Date</Label>
            <Input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Fiscal Year</Label>
            <Input value={form.fiscal_year} onChange={e => setForm(f => ({ ...f, fiscal_year: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Linked Risk</Label>
            <Select value={form.linked_risk_id || '__none__'} onValueChange={v => setForm(f => ({ ...f, linked_risk_id: v === '__none__' ? '' : v }))}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— None —</SelectItem>
                {risks.filter((r: any) => r.id !== editingId).map((r: any) => (
                  <SelectItem key={r.id} value={r.id}>{r.risk_title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
          </div>
        </div>
      </StandardModal>

      {/* DEACTIVATION CONFIRMATION */}
      <ConfirmDialog
        open={!!confirmDeactivate}
        onOpenChange={(open) => { if (!open) setConfirmDeactivate(null); }}
        title="Deactivate Risk"
        description="This risk will be deactivated and hidden from active views. Associated mitigations and reviews will be retained. Continue?"
        confirmLabel="Deactivate"
        variant="destructive"
        onConfirm={handleConfirmDeactivate}
        isLoading={remove.isPending}
      />

      {/* CLOSE RISK DIALOG */}
      <ConfirmDialog
        open={!!closeRiskId}
        onOpenChange={(open) => { if (!open) { setCloseRiskId(null); setCloseComment(''); } }}
        title="Close Risk"
        description=""
        confirmLabel="Close Risk"
        variant="default"
        onConfirm={handleCloseRisk}
        isLoading={update.isPending || reviewMut.create.isPending}
      />
      {closeRiskId && (
        <Dialog open={!!closeRiskId} onOpenChange={(open) => { if (!open) { setCloseRiskId(null); setCloseComment(''); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Close Risk</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground mb-3">Provide a closing review comment before marking this risk as closed.</p>
            <Textarea
              placeholder="Reason for closing this risk..."
              value={closeComment}
              onChange={e => setCloseComment(e.target.value)}
              rows={3}
            />
            <div className="flex justify-end gap-2 mt-3">
              <Button variant="outline" onClick={() => { setCloseRiskId(null); setCloseComment(''); }}>Cancel</Button>
              <Button onClick={handleCloseRisk} disabled={!closeComment.trim() || update.isPending}>Close Risk</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* DETAIL PANEL */}
      {detailRisk && (
        <RiskDetailPanel risk={detailRisk} allRisks={risks} onClose={() => setDetailRisk(null)} />
      )}
    </PageShell>
  );
}

// ============= RISK DETAIL PANEL =============
function RiskDetailPanel({ risk, allRisks, onClose }: { risk: any; allRisks: any[]; onClose: () => void }) {
  const { data: actions = [] } = useRiskMitigationActions(risk.id);
  const { data: reviews = [] } = useRiskReviews(risk.id);
  const { data: templates = [] } = useMitigationTemplates(risk.risk_category);
  const mitigationMut = useRiskMitigationMutations();
  const reviewMut = useRiskReviewMutations();
  const { userCode } = useAuditFields();

  const [actionForm, setActionForm] = useState({ action_title: '', action_description: '', assigned_to: '', due_date: '', status: 'Planned', priority: 'Medium', evidence_notes: '', template_id: '' });
  const [showActionForm, setShowActionForm] = useState(false);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [confirmDeleteAction, setConfirmDeleteAction] = useState<string | null>(null);

  const handleAddAction = () => {
    if (!actionForm.action_title.trim()) return;
    const payload = { ...actionForm, risk_id: risk.id, template_id: actionForm.template_id || null };
    if (editingActionId) {
      mitigationMut.update.mutate({ id: editingActionId, ...payload }, {
        onSuccess: () => { setShowActionForm(false); setEditingActionId(null); resetActionForm(); },
      });
    } else {
      mitigationMut.create.mutate(payload, {
        onSuccess: () => { setShowActionForm(false); resetActionForm(); },
      });
    }
  };

  const resetActionForm = () => setActionForm({ action_title: '', action_description: '', assigned_to: '', due_date: '', status: 'Planned', priority: 'Medium', evidence_notes: '', template_id: '' });

  const startEditAction = (a: any) => {
    setActionForm({
      action_title: a.action_title || '',
      action_description: a.action_description || '',
      assigned_to: a.assigned_to || '',
      due_date: a.due_date || '',
      status: a.status || 'Planned',
      priority: a.priority || 'Medium',
      evidence_notes: a.evidence_notes || '',
      template_id: a.template_id || '',
    });
    setEditingActionId(a.id);
    setShowActionForm(true);
  };

  const handleDeleteAction = () => {
    if (confirmDeleteAction) {
      mitigationMut.update.mutate({ id: confirmDeleteAction, is_active: false }, {
        onSuccess: () => setConfirmDeleteAction(null),
      });
    }
  };

  const handleAddReview = () => {
    if (!reviewComment.trim()) return;
    reviewMut.create.mutate({
      risk_id: risk.id,
      reviewed_by: userCode || 'SYSTEM',
      previous_risk_level: risk.residual_risk_level,
      new_risk_level: risk.residual_risk_level,
      previous_score: risk.residual_risk_score,
      new_score: risk.residual_risk_score,
      comments: reviewComment,
    }, { onSuccess: () => setReviewComment('') });
  };

  const linkedRisk = risk.linked_risk_id ? allRisks.find((r: any) => r.id === risk.linked_risk_id) : null;

  return (
    <Dialog open onOpenChange={() => onClose()}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2"><Shield className="h-5 w-5" /> {risk.risk_title}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" className="no-print" onClick={() => exportRiskDetailPDF(risk, actions, reviews, `risk-detail-${risk.risk_title?.slice(0, 20)}`)}>
                  <FileDown className="h-3 w-3 mr-1" />PDF
                </Button>
                {actions.length > 0 && (
                  <Button variant="outline" size="sm" className="no-print" onClick={() => exportMitigationPlanPDF([risk], actions, `mitigation-plan-${risk.risk_title?.slice(0, 20)}`)}>
                    <FileDown className="h-3 w-3 mr-1" />Mitigation Plan
                  </Button>
                )}
              </div>
            </DialogTitle>
          </DialogHeader>

        <div className="grid grid-cols-2 gap-3 text-sm mb-4">
          <div><span className="text-muted-foreground">Entity:</span> {risk.ia_departments?.name || '—'}</div>
          <div><span className="text-muted-foreground">Category:</span> {risk.risk_category}</div>
          <div><span className="text-muted-foreground">Owner:</span> {risk.risk_owner || '—'}</div>
          <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={risk.status} /></div>
          <div><span className="text-muted-foreground">Inherent:</span> <Badge variant={getRiskLevelVariant(risk.inherent_risk_level)}>{risk.inherent_risk_score} ({risk.inherent_risk_level})</Badge></div>
          <div><span className="text-muted-foreground">Residual:</span> <Badge variant={getRiskLevelVariant(risk.residual_risk_level)}>{risk.residual_risk_score} ({risk.residual_risk_level})</Badge></div>
          <div><span className="text-muted-foreground">Control:</span> {risk.control_effectiveness}</div>
          <div><span className="text-muted-foreground">Source:</span> {risk.risk_source || '—'}</div>
          <div><span className="text-muted-foreground">Fiscal Year:</span> {risk.fiscal_year || '—'}</div>
          <div><span className="text-muted-foreground">Review Date:</span> {risk.review_date ? formatDateForDisplay(risk.review_date) : '—'}</div>
          {linkedRisk && (
            <div className="col-span-2"><span className="text-muted-foreground">Linked Risk:</span> <span className="font-medium">{linkedRisk.risk_title}</span></div>
          )}
        </div>
        {risk.risk_description && <p className="text-sm mb-4">{risk.risk_description}</p>}

        <Tabs defaultValue="mitigations">
          <TabsList>
            <TabsTrigger value="mitigations">Mitigations ({actions.length})</TabsTrigger>
            <TabsTrigger value="reviews">Reviews ({reviews.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="mitigations" className="space-y-3">
            {actions.length === 0 && !showActionForm && (
              <p className="text-sm text-muted-foreground text-center py-4">No mitigation actions yet.</p>
            )}
            {actions.map((a: any) => (
              <Card key={a.id}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{a.action_title}</span>
                    <div className="flex gap-2 items-center">
                      <Badge variant="outline">{a.priority}</Badge>
                      <StatusBadge status={a.status} />
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => startEditAction(a)}><Edit className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setConfirmDeleteAction(a.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                    </div>
                  </div>
                  {a.action_description && <p className="text-xs text-muted-foreground mt-1">{a.action_description}</p>}
                  <div className="flex gap-4 text-xs text-muted-foreground mt-2">
                    <span>Assigned: {a.assigned_to || '—'}</span>
                    <span>Due: {a.due_date ? formatDateForDisplay(a.due_date) : '—'}</span>
                  </div>
                </CardContent>
              </Card>
            ))}

            {!showActionForm ? (
              <Button variant="outline" size="sm" onClick={() => { resetActionForm(); setEditingActionId(null); setShowActionForm(true); }}><Plus className="h-3 w-3 mr-1" />Add Mitigation</Button>
            ) : (
              <Card>
                <CardContent className="p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    {templates.length > 0 && (
                      <div className="space-y-1 col-span-2">
                        <Label className="text-xs">From Template</Label>
                        <Select value={actionForm.template_id || '__none__'} onValueChange={v => {
                          if (v === '__none__') return;
                          const tpl = templates.find((t: any) => t.id === v);
                          if (tpl) {
                            setActionForm(f => ({ ...f, template_id: v, action_title: tpl.template_name, action_description: tpl.template_description || '', priority: tpl.default_priority || 'Medium' }));
                          }
                        }}>
                          <SelectTrigger><SelectValue placeholder="Select template (optional)..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— None —</SelectItem>
                            {templates.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.template_name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="space-y-1 col-span-2">
                      <Label className="text-xs">Title *</Label>
                      <Input value={actionForm.action_title} onChange={e => setActionForm(f => ({ ...f, action_title: e.target.value }))} />
                    </div>
                    <div className="space-y-1 col-span-2">
                      <Label className="text-xs">Description</Label>
                      <Textarea value={actionForm.action_description} onChange={e => setActionForm(f => ({ ...f, action_description: e.target.value }))} rows={2} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Assigned To</Label>
                      <Input value={actionForm.assigned_to} onChange={e => setActionForm(f => ({ ...f, assigned_to: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Due Date</Label>
                      <Input type="date" value={actionForm.due_date} onChange={e => setActionForm(f => ({ ...f, due_date: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Priority</Label>
                      <Select value={actionForm.priority} onValueChange={v => setActionForm(f => ({ ...f, priority: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{MITIGATION_PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Status</Label>
                      <Select value={actionForm.status} onValueChange={v => setActionForm(f => ({ ...f, status: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{MITIGATION_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleAddAction} disabled={mitigationMut.create.isPending || mitigationMut.update.isPending}>{editingActionId ? 'Update' : 'Save'}</Button>
                    <Button size="sm" variant="outline" onClick={() => { setShowActionForm(false); setEditingActionId(null); resetActionForm(); }}>Cancel</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <ConfirmDialog
              open={!!confirmDeleteAction}
              onOpenChange={(open) => { if (!open) setConfirmDeleteAction(null); }}
              title="Remove Mitigation Action"
              description="This action will be removed from the risk. Continue?"
              confirmLabel="Remove"
              variant="destructive"
              onConfirm={handleDeleteAction}
              isLoading={mitigationMut.update.isPending}
            />
          </TabsContent>

          <TabsContent value="reviews" className="space-y-3">
            {reviews.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No reviews yet.</p>
            )}
            {reviews.map((r: any) => (
              <div key={r.id} className="flex items-start gap-3 text-sm border-l-2 border-primary pl-3 py-1">
                <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">{r.comments}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.reviewed_by} • {r.review_date ? formatDateForDisplay(r.review_date) : '—'}
                    {r.previous_risk_level !== r.new_risk_level && (
                      <span> • {r.previous_risk_level} → {r.new_risk_level}</span>
                    )}
                  </p>
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <Input placeholder="Add review comment..." value={reviewComment} onChange={e => setReviewComment(e.target.value)} className="flex-1" />
              <Button size="sm" onClick={handleAddReview} disabled={reviewMut.create.isPending || !reviewComment.trim()}>Add Review</Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
