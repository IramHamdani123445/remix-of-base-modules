import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert, ShieldCheck, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageShell, DataTable, StatusBadge } from '@/components/common';
import type { DataTableColumn } from '@/components/common';
import { formatDateForDisplay } from '@/lib/format-config';
import { useIADepartments } from '@/hooks/useAuditData';
import {
  useOfficeHolders, useOfficeHolderHealth, useUnresolvedEscalationRoles, useEscalationProfiles,
  useProposeOfficeHolder, useApproveOfficeHolder, useRevokeOfficeHolder,
  type OfficeHolderRow, type UnresolvedRoleRow,
} from '@/hooks/useEscalationRoles';

const FUNCTION_CODES = [
  { value: 'HEAD_OF_INTERNAL_AUDIT', label: 'Head of Internal Audit' },
  { value: 'DEPARTMENT_HEAD', label: 'Department Head' },
];

const today = () => new Date().toISOString().slice(0, 10);

export default function EscalationRoles() {
  const { data: holders = [], isLoading } = useOfficeHolders();
  const { data: health } = useOfficeHolderHealth();
  const { data: unresolved = [] } = useUnresolvedEscalationRoles();
  const { data: profiles = [] } = useEscalationProfiles();
  const { data: departments = [] } = useIADepartments();

  const propose = useProposeOfficeHolder();
  const approve = useApproveOfficeHolder();
  const revoke = useRevokeOfficeHolder();

  const [proposeOpen, setProposeOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<{ row: OfficeHolderRow; mode: 'approve' | 'revoke' } | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [form, setForm] = useState({
    function_code: 'HEAD_OF_INTERNAL_AUDIT',
    profile_id: '',
    department_id: '',
    effective_from: today(),
    effective_to: '',
    reason: '',
  });

  const profileMap = useMemo(
    () => Object.fromEntries(profiles.map((p) => [p.id, p])),
    [profiles],
  );
  const deptMap = useMemo(
    () => Object.fromEntries((departments || []).map((d: any) => [d.id, d])),
    [departments],
  );

  const hiaOutcome = String((health as any)?.hia?.outcome ?? 'UNKNOWN');
  const hiaName = (health as any)?.hia?.display_name as string | undefined;
  const deptGaps = ((health as any)?.departments_unresolved ?? []) as any[];

  const holderColumns: DataTableColumn<OfficeHolderRow>[] = [
    {
      key: 'function_code',
      header: 'Role',
      render: (row) => FUNCTION_CODES.find((f) => f.value === row.function_code)?.label ?? row.function_code,
    },
    {
      key: 'department_id',
      header: 'Scope',
      render: (row) => (row.department_id ? (deptMap[row.department_id]?.name ?? 'Department') : 'Organisation'),
    },
    {
      key: 'profile_id',
      header: 'Office holder',
      render: (row) => profileMap[row.profile_id]?.full_name ?? row.profile_id,
    },
    {
      key: 'effective_from',
      header: 'In office from',
      render: (row) => formatDateForDisplay(row.effective_from),
    },
    {
      key: 'effective_to',
      header: 'Until',
      render: (row) => (row.effective_to ? formatDateForDisplay(row.effective_to) : 'Open-ended'),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (row) => (
        <div className="flex gap-2">
          {row.status === 'proposed' && (
            <Button size="sm" variant="outline" onClick={() => { setActionTarget({ row, mode: 'approve' }); setActionReason(''); }}>
              Approve
            </Button>
          )}
          {row.status === 'active' && (
            <Button size="sm" variant="outline" onClick={() => { setActionTarget({ row, mode: 'revoke' }); setActionReason(''); }}>
              Revoke
            </Button>
          )}
        </div>
      ),
    },
  ];

  const unresolvedColumns: DataTableColumn<UnresolvedRoleRow>[] = [
    { key: 'run_at', header: 'Detected', render: (row) => formatDateForDisplay(row.run_at) },
    { key: 'required_role', header: 'Required role', render: (row) => row.required_role ?? '—' },
    { key: 'reason', header: 'Why it could not be resolved', render: (row) => row.reason ?? '—' },
    { key: 'event_code', header: 'Communication', render: (row) => row.event_code ?? '—' },
    { key: 'occurrence', header: 'Occurrence', render: (row) => row.occurrence ?? '—' },
    {
      key: 'department_id',
      header: 'Department',
      render: (row) => (row.department_id ? (deptMap[row.department_id]?.name ?? row.department_id) : '—'),
    },
    { key: 'resolution_source', header: 'Looked up in', render: (row) => row.resolution_source ?? '—' },
  ];

  const submitPropose = () => {
    if (!form.profile_id || !form.reason.trim()) return;
    if (form.function_code === 'DEPARTMENT_HEAD' && !form.department_id) return;
    propose.mutate(
      {
        function_code: form.function_code,
        profile_id: form.profile_id,
        department_id: form.function_code === 'DEPARTMENT_HEAD' ? form.department_id : null,
        effective_from: form.effective_from,
        effective_to: form.effective_to || null,
        reason: form.reason.trim(),
      },
      {
        onSuccess: () => {
          setProposeOpen(false);
          setForm({ function_code: 'HEAD_OF_INTERNAL_AUDIT', profile_id: '', department_id: '', effective_from: today(), effective_to: '', reason: '' });
        },
      },
    );
  };

  const submitAction = () => {
    if (!actionTarget || !actionReason.trim()) return;
    const payload = { id: actionTarget.row.id, reason: actionReason.trim() };
    const mutation = actionTarget.mode === 'approve' ? approve : revoke;
    mutation.mutate(payload as never, { onSuccess: () => setActionTarget(null) });
  };

  return (
    <PageShell
      title="Escalation Roles"
      description="Designate who holds the Head of Internal Audit and Department Head offices. Escalations are only sent to explicitly designated, currently serving office holders."
      actions={
        <Button onClick={() => setProposeOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" /> Propose designation
        </Button>
      }
    >
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card>
          <CardContent className="pt-6 flex items-start gap-3">
            {hiaOutcome === 'RESOLVED' ? (
              <ShieldCheck className="h-5 w-5 text-primary" />
            ) : (
              <ShieldAlert className="h-5 w-5 text-destructive" />
            )}
            <div>
              <p className="text-sm text-muted-foreground">Head of Internal Audit</p>
              <p className="font-medium">
                {hiaOutcome === 'RESOLVED' ? hiaName : hiaOutcome === 'CONFLICT' ? 'Conflicting designations' : 'Not designated'}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-start gap-3">
            {deptGaps.length === 0 ? (
              <CheckCircle2 className="h-5 w-5 text-primary" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            )}
            <div>
              <p className="text-sm text-muted-foreground">Departments without a resolvable head</p>
              <p className="font-medium">
                {deptGaps.length} of {String((health as any)?.departments_total ?? '—')}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-start gap-3">
            {unresolved.length === 0 ? (
              <CheckCircle2 className="h-5 w-5 text-primary" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            )}
            <div>
              <p className="text-sm text-muted-foreground">Escalations missing a recipient</p>
              <p className="font-medium">{unresolved.length} recorded</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="register">
        <TabsList>
          <TabsTrigger value="register">Designations</TabsTrigger>
          <TabsTrigger value="gaps">Configuration gaps</TabsTrigger>
          <TabsTrigger value="evidence">Unresolved escalations</TabsTrigger>
        </TabsList>

        <TabsContent value="register" className="mt-4">
          <DataTable data={holders} columns={holderColumns} loading={isLoading} emptyMessage="No office holders designated yet." />
        </TabsContent>

        <TabsContent value="gaps" className="mt-4">
          <Card>
            <CardContent className="pt-6 space-y-2">
              {deptGaps.length === 0 ? (
                <p className="text-sm text-muted-foreground">Every department has a resolvable head.</p>
              ) : (
                deptGaps.map((gap: any) => (
                  <div key={gap.department_id} className="flex items-center justify-between border-b py-2 last:border-0">
                    <span className="font-medium">{gap.name}</span>
                    <span className="text-sm text-muted-foreground">{gap.resolution?.reason ?? gap.resolution?.outcome}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="evidence" className="mt-4">
          <DataTable
            data={unresolved}
            columns={unresolvedColumns}
            emptyMessage="No escalation has been skipped for a missing recipient."
          />
        </TabsContent>
      </Tabs>

      <Dialog open={proposeOpen} onOpenChange={setProposeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Propose office holder designation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Role</Label>
              <Select value={form.function_code} onValueChange={(v) => setForm({ ...form, function_code: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FUNCTION_CODES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {form.function_code === 'DEPARTMENT_HEAD' && (
              <div>
                <Label>Department</Label>
                <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {(departments || []).map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Office holder</Label>
              <Select value={form.profile_id} onValueChange={(v) => setForm({ ...form, profile_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select person" /></SelectTrigger>
                <SelectContent>
                  {profiles.filter((p) => p.is_active !== false).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.full_name ?? p.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>In office from</Label>
                <Input type="date" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
              </div>
              <div>
                <Label>Until (optional)</Label>
                <Input type="date" value={form.effective_to} onChange={(e) => setForm({ ...form, effective_to: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Reason</Label>
              <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Basis for this designation" />
            </div>
            <p className="text-xs text-muted-foreground">
              A different authorised officer must approve this designation before escalations use it.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setProposeOpen(false)}>Cancel</Button>
              <Button onClick={submitPropose} disabled={propose.isPending}>Propose</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!actionTarget} onOpenChange={(open) => !open && setActionTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionTarget?.mode === 'approve' ? 'Approve designation' : 'Revoke designation'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea value={actionReason} onChange={(e) => setActionReason(e.target.value)} placeholder="Reason (recorded in the audit event log)" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setActionTarget(null)}>Cancel</Button>
              <Button onClick={submitAction} disabled={approve.isPending || revoke.isPending || !actionReason.trim()}>
                Confirm
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
