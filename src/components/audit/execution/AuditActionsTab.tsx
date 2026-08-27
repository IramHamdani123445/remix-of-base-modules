import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, CheckCircle, Lock, Clock, AlertTriangle } from 'lucide-react';
import { StatusBadge, DataTable } from '@/components/common';
import type { DataTableColumn } from '@/components/common';
import { useIAActionTrackingMutations } from '@/hooks/useAuditData';
import { AuditEmptyState } from '@/components/audit/workspace/AuditEmptyState';
import { AuditReadinessPanel } from '@/components/audit/workspace/AuditReadinessPanel';
import { formatDateForDisplay } from '@/lib/format-config';
import { useUserCode } from '@/hooks/useUserCode';
import { useToast } from '@/hooks/use-toast';
import { notifyActionAssigned } from '@/services/auditNotificationService';

interface AuditActionsTabProps {
  auditId: string;
  audit: any;
  auditFindings: any[];
  auditActions: any[];
  auditResponses: any[];
  onClose: () => void;
}

const ACTION_STATUSES = ['Open', 'In Progress', 'Completed', 'Verified', 'Closed'];

export function AuditActionsTab({ auditId, audit, auditFindings, auditActions, auditResponses, onClose }: AuditActionsTabProps) {
  const { create, update } = useIAActionTrackingMutations();
  const { userCode } = useUserCode();
  const { toast } = useToast();
  const { can } = useInternalAuditPermissions();
  const canProgress = can('progress_audit_actions');
  const canCloseActions = can('close_audit_actions');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ finding_id: '', action_description: '', responsible_person: '', target_date: '' });
  const [closureNotes, setClosureNotes] = useState(audit?.closure_notes || '');
  const [progressAction, setProgressAction] = useState<any>(null);
  const [progressForm, setProgressForm] = useState({ status: 'Open', target_date: '', responsible_person: '', notes: '' });

  const isOverdue = (action: any) => {
    if (!action.target_date) return false;
    if (['Completed', 'Closed'].includes(action.status || '')) return false;
    return new Date(action.target_date) < new Date();
  };

  const overdueCount = auditActions.filter(isOverdue).length;
  const openFindingsCount = auditFindings.filter((f: any) => !['Closed', 'Resolved'].includes(f.status || '')).length;
  const isClosed = audit?.status === 'Closed' || audit?.execution_status === 'Closed';

  const openProgress = (row: any) => {
    setProgressAction(row);
    setProgressForm({
      status: row.status || 'Open',
      target_date: row.target_date || '',
      responsible_person: row.responsible_person || '',
      notes: row.notes || '',
    });
  };

  const handleProgressSave = () => {
    if (!progressAction) return;
    const closing = ['Verified', 'Closed'].includes(progressForm.status);
    if (closing && !canCloseActions) {
      toast({ title: 'Not permitted', description: 'You do not have permission to close or verify audit actions.', variant: 'destructive' });
      return;
    }
    if (closing && !progressForm.notes.trim()) {
      toast({ title: 'Validation', description: 'Closure evidence notes are required before verifying or closing an action.', variant: 'destructive' });
      return;
    }
    update.mutate({
      id: progressAction.id,
      status: progressForm.status,
      action_status: progressForm.status,
      target_date: progressForm.target_date || null,
      responsible_person: progressForm.responsible_person || null,
      notes: progressForm.notes || null,
      updated_by: userCode || null,
      ...(closing ? { verified_by: userCode || null, verified_date: new Date().toISOString() } : {}),
    } as any, { onSuccess: () => setProgressAction(null) });
  };

  const handleCreate = () => {
    if (!form.finding_id || !form.action_description) {
      toast({ title: 'Validation', description: 'Finding and action description are required', variant: 'destructive' });
      return;
    }
    create.mutate({
      finding_id: form.finding_id, engagement_id: auditId,
      action_description: form.action_description,
      responsible_person: form.responsible_person || null,
      target_date: form.target_date || null, status: 'Open', created_by: userCode || null,
    } as any, {
      onSuccess: () => {
        setShowForm(false);
        setForm({ finding_id: '', action_description: '', responsible_person: '', target_date: '' });
        if (form.responsible_person) notifyActionAssigned(form.action_description, form.responsible_person, form.target_date);
      },
    });
  };

  const columns: DataTableColumn<any>[] = [
    { key: 'finding', header: 'Finding', render: (r) => {
      const finding = auditFindings.find((f: any) => f.id === r.finding_id);
      return <span className="text-sm">{finding?.title || r.finding_id?.slice(0, 8)}</span>;
    }},
    { key: 'action_description', header: 'Action', render: (r) => <span className="text-sm max-w-[200px] truncate block">{r.action_description || '—'}</span> },
    { key: 'responsible_person', header: 'Assigned To', render: (r) => <span className="text-xs">{r.responsible_person || '—'}</span> },
    { key: 'target_date', header: 'Due Date', render: (r) => r.target_date ? formatDateForDisplay(r.target_date) : '—' },
    { key: 'status', header: 'Status', render: (r) => (
      <div className="flex items-center gap-1">
        <StatusBadge status={r.status || 'Open'} />
        {isOverdue(r) && <StatusBadge status="Overdue" />}
      </div>
    )},
    { key: 'row_actions', header: 'Update', render: (r) => (
      <Button size="sm" variant="outline" disabled={!canProgress || isClosed} onClick={() => openProgress(r)}>
        Update
      </Button>
    )},
  ];


  return (
    <div className="space-y-5">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="flex items-center gap-2 p-3 rounded-lg border border-border/50">
          <CheckCircle className="h-4 w-4 text-primary shrink-0" /><div><p className="text-xs text-muted-foreground">Total</p><p className="text-lg font-bold">{auditActions.length}</p></div>
        </div>
        <div className="flex items-center gap-2 p-3 rounded-lg border border-border/50">
          <Clock className="h-4 w-4 text-amber-500 shrink-0" /><div><p className="text-xs text-muted-foreground">Open</p><p className="text-lg font-bold">{auditActions.filter((a: any) => a.status === 'Open').length}</p></div>
        </div>
        <div className={`flex items-center gap-2 p-3 rounded-lg border ${overdueCount > 0 ? 'border-destructive/30 bg-destructive/5' : 'border-border/50'}`}>
          <AlertTriangle className={`h-4 w-4 ${overdueCount > 0 ? 'text-destructive' : 'text-muted-foreground'} shrink-0`} /><div><p className="text-xs text-muted-foreground">Overdue</p><p className="text-lg font-bold">{overdueCount}</p></div>
        </div>
        <div className="flex items-center gap-2 p-3 rounded-lg border border-border/50">
          <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" /><div><p className="text-xs text-muted-foreground">Completed</p><p className="text-lg font-bold">{auditActions.filter((a: any) => ['Completed', 'Closed'].includes(a.status || '')).length}</p></div>
        </div>
      </div>

      {/* Actions Table */}
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{auditActions.length} action(s)</p>
        <Button size="sm" onClick={() => setShowForm(!showForm)}><Plus className="h-4 w-4 mr-1" />New Action</Button>
      </div>

      {showForm && (
        <Card className="border-primary/20">
          <CardContent className="p-4 space-y-3">
            <div><Label>Finding *</Label>
              <Select value={form.finding_id} onValueChange={v => setForm(f => ({ ...f, finding_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select finding" /></SelectTrigger>
                <SelectContent>{auditFindings.map((f: any) => <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Action Description *</Label><Textarea value={form.action_description} onChange={e => setForm(f => ({ ...f, action_description: e.target.value }))} rows={3} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Assigned To</Label><Input value={form.responsible_person} onChange={e => setForm(f => ({ ...f, responsible_person: e.target.value }))} /></div>
              <div><Label>Due Date</Label><Input type="date" value={form.target_date} onChange={e => setForm(f => ({ ...f, target_date: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={create.isPending}>Create Action</Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {auditActions.length === 0 && !showForm ? (
        <AuditEmptyState icon={CheckCircle} title="No corrective actions yet" description="Actions will be created from audit findings" actionLabel="Create Action" onAction={() => setShowForm(true)} />
      ) : (
        <Card><CardContent className="pt-4">
          <DataTable columns={columns} data={auditActions} emptyMessage="No corrective actions assigned."
            rowClassName={(row) => isOverdue(row) ? 'bg-destructive/5 border-l-2 border-l-destructive' : ''}
          />
        </CardContent></Card>
      )}

      {/* Closure Section */}
      <AuditReadinessPanel
        title="Closure Readiness"
        checks={[
          { label: 'All checklist items assessed', passed: true, required: true },
          { label: `All findings resolved (${openFindingsCount} open)`, passed: openFindingsCount === 0, required: true },
          { label: `Management responses received (${auditResponses.length})`, passed: auditFindings.length === 0 || auditResponses.length >= auditFindings.length, required: true },
          { label: `Actions assigned (${auditActions.length})`, passed: auditFindings.length === 0 || auditActions.length > 0, required: true },
        ]}
      />
      {isClosed ? (
        <Card className="border-primary/30">
          <CardContent className="pt-6 space-y-2">
            <div className="flex items-center gap-2 text-primary"><Lock className="h-4 w-4" /><span className="font-medium">Audit Closed</span></div>
            {audit?.closure_date && <p className="text-sm text-muted-foreground">Closed on: {formatDateForDisplay(audit.closure_date)}</p>}
            {audit?.closed_by && <p className="text-sm text-muted-foreground">Closed by: {audit.closed_by}</p>}
            {audit?.closure_notes && <p className="text-sm mt-2">{audit.closure_notes}</p>}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div><Label>Closure Notes</Label><Textarea value={closureNotes} onChange={e => setClosureNotes(e.target.value)} placeholder="Final remarks..." /></div>
            <Button onClick={onClose} disabled={openFindingsCount > 0}>
              {openFindingsCount === 0 ? <><Lock className="h-4 w-4 mr-1" />Close Audit</> : 'Cannot close — resolve open findings first'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
