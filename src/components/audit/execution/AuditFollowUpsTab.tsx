import React, { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Loader2, Eye, CalendarCheck, X, ShieldCheck } from 'lucide-react';
import { StatusBadge, DataTable } from '@/components/common';
import type { DataTableColumn } from '@/components/common';
import { useEngagementFollowUps, useEngagementActions } from '@/hooks/useEngagementData';
import { useIaFollowUpSchedule, useIaFollowUpRecordOutcome } from '@/hooks/useAuditActionCentre';
import { AuditEmptyState } from '@/components/audit/workspace/AuditEmptyState';
import { formatDateForDisplay } from '@/lib/format-config';

/**
 * IA-POST-UAT-02 — Follow-Up UI convergence.
 *
 * The generic `useIAFollowUpMutations()` create/update path (with an arbitrary
 * Status dropdown) bypassed the governed commands. This surface now speaks only
 * to the canonical corrective-action commands:
 *   ia_followup_schedule       (Engagement → Finding → Action → Follow-Up)
 *   ia_followup_record_outcome (canonical outcome vocabulary only)
 * Derived states (Resolved / Closed / Overdue) are never set from the UI.
 */

const FOLLOW_UP_TYPES = ['Action Verification', 'Implementation Check', 'Evidence Collection', 'Re-Test', 'Management Meeting', 'Other'];

/** Canonical outcome vocabulary enforced by ia_followup_record_outcome. */
const OUTCOMES = ['In Verification', 'Implemented', 'Partially Implemented', 'Not Implemented', 'Reopened'] as const;
const OUTCOMES_REQUIRING_NOTES = ['Partially Implemented', 'Not Implemented'];

const TERMINAL_ACTION_STATUSES = ['Cancelled', 'Closed', 'Superseded'];

interface AuditFollowUpsTabProps {
  auditId: string;
  auditFindings?: any[];
  departmentId?: string;
}

export function AuditFollowUpsTab({ auditId, auditFindings = [] }: AuditFollowUpsTabProps) {
  const { data: followUps = [], isLoading } = useEngagementFollowUps(auditId);
  const { data: actions = [] } = useEngagementActions(auditId);
  const schedule = useIaFollowUpSchedule();
  const recordOutcome = useIaFollowUpRecordOutcome();

  const [mode, setMode] = useState<'schedule' | 'outcome' | 'view' | null>(null);
  const [active, setActive] = useState<any>(null);
  const [scheduleForm, setScheduleForm] = useState({ action_id: '', scheduled_date: '', follow_up_type: 'Action Verification', notes: '', fiscal_year: '' });
  const [outcomeForm, setOutcomeForm] = useState({ outcome: '', notes: '' });

  const findingTitle = (id?: string | null) =>
    (auditFindings as any[]).find(f => f.id === id)?.title || (id ? id.slice(0, 8) : '—');

  /** Only actions belonging to THIS engagement and not in a terminal state are eligible. */
  const eligibleActions = useMemo(
    () => (actions as any[]).filter(a => a.engagement_id === auditId && !TERMINAL_ACTION_STATUSES.includes(a.status || '')),
    [actions, auditId],
  );

  const selectedAction = eligibleActions.find(a => a.id === scheduleForm.action_id);

  const close = () => { setMode(null); setActive(null); };

  const openSchedule = () => {
    setScheduleForm({ action_id: '', scheduled_date: '', follow_up_type: 'Action Verification', notes: '', fiscal_year: '' });
    setActive(null);
    setMode('schedule');
  };

  const openOutcome = (row: any) => {
    setOutcomeForm({ outcome: '', notes: '' });
    setActive(row);
    setMode('outcome');
  };

  const openView = (row: any) => { setActive(row); setMode('view'); };

  const submitSchedule = () => {
    if (!scheduleForm.action_id || !scheduleForm.scheduled_date) return;
    schedule.mutate({
      actionId: scheduleForm.action_id,
      scheduledDate: scheduleForm.scheduled_date,
      followUpType: scheduleForm.follow_up_type || null,
      notes: scheduleForm.notes.trim() || null,
      fiscalYear: scheduleForm.fiscal_year.trim() || null,
    }, { onSuccess: close });
  };

  const submitOutcome = () => {
    if (!active?.id || !outcomeForm.outcome) return;
    if (OUTCOMES_REQUIRING_NOTES.includes(outcomeForm.outcome) && !outcomeForm.notes.trim()) return;
    recordOutcome.mutate({
      followUpId: active.id,
      outcome: outcomeForm.outcome,
      notes: outcomeForm.notes.trim() || null,
    }, { onSuccess: close });
  };

  const isOverdue = (r: any) =>
    r.due_date && !['Implemented', 'Closed', 'Resolved'].includes(r.lifecycle_status || r.status || '') && new Date(r.due_date) < new Date();

  const columns: DataTableColumn<any>[] = [
    { key: 'action_required', header: 'Verification', render: (r) => <span className="text-sm max-w-[220px] truncate block font-medium">{r.action_required || '—'}</span> },
    { key: 'action_id', header: 'Action', render: (r) => <span className="font-mono text-xs">{r.action_id ? r.action_id.slice(0, 8) : '—'}</span> },
    { key: 'finding_id', header: 'Finding', render: (r) => <span className="text-xs">{findingTitle(r.finding_id)}</span> },
    { key: 'follow_up_type', header: 'Type', render: (r) => <span className="text-xs">{r.follow_up_type || '—'}</span> },
    { key: 'responsible_name', header: 'Responsible', render: (r) => <span className="text-xs">{r.responsible_name || '—'}</span> },
    { key: 'due_date', header: 'Scheduled', render: (r) => (
      <span className={`text-xs ${isOverdue(r) ? 'text-destructive font-medium' : ''}`}>
        {r.scheduled_follow_up_date || r.due_date ? formatDateForDisplay(r.scheduled_follow_up_date || r.due_date) : '—'}
      </span>
    )},
    { key: 'lifecycle_status', header: 'Lifecycle', render: (r) => (
      <div className="flex gap-1">
        <StatusBadge status={r.lifecycle_status || r.status || 'Scheduled'} />
        {isOverdue(r) && <StatusBadge status="Overdue" />}
      </div>
    )},
    { key: 'outcome', header: 'Outcome', render: (r) => r.outcome ? <StatusBadge status={r.outcome} /> : <span className="text-muted-foreground text-xs">—</span> },
  ];

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const notesMissing = OUTCOMES_REQUIRING_NOTES.includes(outcomeForm.outcome) && !outcomeForm.notes.trim();

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{followUps.length} follow-up(s)</p>
        <Button size="sm" onClick={openSchedule}><Plus className="h-4 w-4 mr-1" />Schedule Follow-Up</Button>
      </div>

      {mode === 'schedule' && (
        <Card className="border-primary/20">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold flex items-center gap-1.5"><CalendarCheck className="h-4 w-4" />Schedule Follow-Up</p>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={close}><X className="h-4 w-4" /></Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Follow-ups verify a corrective action. Finding, department and responsible owner are derived from the action.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Corrective Action *</Label>
                <Select value={scheduleForm.action_id} onValueChange={v => setScheduleForm(f => ({ ...f, action_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select an action from this engagement" /></SelectTrigger>
                  <SelectContent>
                    {eligibleActions.length === 0 && <SelectItem value="__none__" disabled>No eligible actions</SelectItem>}
                    {eligibleActions.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {(a.action_id || a.id.slice(0, 8))} — {(a.action_description || 'Corrective action').slice(0, 60)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Scheduled Date *</Label><Input type="date" value={scheduleForm.scheduled_date} onChange={e => setScheduleForm(f => ({ ...f, scheduled_date: e.target.value }))} /></div>
            </div>

            {selectedAction && (
              <div className="rounded-md border border-border/60 bg-muted/30 p-3 grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">Finding: </span>{findingTitle(selectedAction.finding_id)}</div>
                <div><span className="text-muted-foreground">Owner: </span>{selectedAction.responsible_person || '—'}</div>
                <div><span className="text-muted-foreground">Target date: </span>{selectedAction.target_date ? formatDateForDisplay(selectedAction.target_date) : '—'}</div>
                <div><span className="text-muted-foreground">Action status: </span>{selectedAction.status || '—'}</div>
                <div><span className="text-muted-foreground">Verification: </span>{selectedAction.verification_status || 'Not verified'}</div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div><Label>Follow-Up Type</Label>
                <Select value={scheduleForm.follow_up_type} onValueChange={v => setScheduleForm(f => ({ ...f, follow_up_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FOLLOW_UP_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Fiscal Year</Label><Input value={scheduleForm.fiscal_year} onChange={e => setScheduleForm(f => ({ ...f, fiscal_year: e.target.value }))} placeholder="Defaults to scheduled year" /></div>
            </div>
            <div><Label>Notes</Label><Textarea rows={2} value={scheduleForm.notes} onChange={e => setScheduleForm(f => ({ ...f, notes: e.target.value }))} className="text-sm" /></div>
            <div className="flex gap-2">
              <Button onClick={submitSchedule} disabled={!scheduleForm.action_id || !scheduleForm.scheduled_date || schedule.isPending}>
                {schedule.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Scheduling...</> : 'Schedule Follow-Up'}
              </Button>
              <Button variant="outline" onClick={close}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {mode === 'outcome' && active && (
        <Card className="border-primary/20">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold flex items-center gap-1.5"><ShieldCheck className="h-4 w-4" />Record Follow-Up Outcome</p>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={close}><X className="h-4 w-4" /></Button>
            </div>
            <p className="text-xs text-muted-foreground">{active.action_required}</p>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Outcome *</Label>
                <Select value={outcomeForm.outcome} onValueChange={v => setOutcomeForm(f => ({ ...f, outcome: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select outcome" /></SelectTrigger>
                  <SelectContent>{OUTCOMES.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Verification Notes{OUTCOMES_REQUIRING_NOTES.includes(outcomeForm.outcome) ? ' *' : ''}</Label>
              <Textarea rows={3} value={outcomeForm.notes} onChange={e => setOutcomeForm(f => ({ ...f, notes: e.target.value }))} className="text-sm" />
              {notesMissing && <p className="text-xs text-destructive mt-1">Notes are required when implementation is incomplete.</p>}
            </div>
            <div className="flex gap-2">
              <Button onClick={submitOutcome} disabled={!outcomeForm.outcome || notesMissing || recordOutcome.isPending}>
                {recordOutcome.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Recording...</> : 'Record Outcome'}
              </Button>
              <Button variant="outline" onClick={close}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {mode === 'view' && active && (
        <Card className="border-primary/20">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Follow-Up Detail</p>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={close}><X className="h-4 w-4" /></Button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><Label className="text-xs text-muted-foreground">Verification</Label><p>{active.action_required || '—'}</p></div>
              <div><Label className="text-xs text-muted-foreground">Finding</Label><p>{findingTitle(active.finding_id)}</p></div>
              <div><Label className="text-xs text-muted-foreground">Type</Label><p>{active.follow_up_type || '—'}</p></div>
              <div><Label className="text-xs text-muted-foreground">Scheduled</Label><p>{active.scheduled_follow_up_date ? formatDateForDisplay(active.scheduled_follow_up_date) : '—'}</p></div>
              <div><Label className="text-xs text-muted-foreground">Lifecycle</Label><p>{active.lifecycle_status || active.status || '—'}</p></div>
              <div><Label className="text-xs text-muted-foreground">Outcome</Label><p>{active.outcome || '—'}</p></div>
              <div className="col-span-2"><Label className="text-xs text-muted-foreground">Outcome Notes</Label><p className="whitespace-pre-wrap">{active.outcome_notes || active.description || '—'}</p></div>
            </div>
          </CardContent>
        </Card>
      )}

      {followUps.length === 0 && !mode ? (
        <AuditEmptyState icon={CalendarCheck} title="No follow-ups" description="Schedule a verification follow-up against a corrective action" actionLabel="Schedule Follow-Up" onAction={openSchedule} />
      ) : (
        <Card><CardContent className="pt-4">
          <DataTable columns={columns} data={followUps} emptyMessage="No follow-ups."
            renderActions={(row) => (
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openView(row)}><Eye className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openOutcome(row)} title="Record outcome"><ShieldCheck className="h-3.5 w-3.5" /></Button>
              </div>
            )}
          />
        </CardContent></Card>
      )}
    </div>
  );
}
