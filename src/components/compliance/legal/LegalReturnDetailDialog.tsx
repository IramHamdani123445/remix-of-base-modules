import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency } from '@/utils/formatCurrency';
import { formatDisplayDate, formatAuditDateTime } from '@/lib/dateFormat';
import {
  useLegalReturnDetail,
  useLegalReturnActions,
  formatReworkAge,
} from '@/hooks/compliance/useLegalReturnRegister';
import {
  ArrowLeftRight, Building2, ExternalLink, Gavel, AlertTriangle, Loader2,
  CheckCircle2, ClipboardList, FileText, History, UserPlus, Send,
} from 'lucide-react';

/**
 * Rework control detail for a single Legal return.
 * Legal-owned facts (reason, required action, pack version) are read-only.
 * Compliance-owned rework state (owner, status, completion, resubmission)
 * is written through governed RPCs which re-check capability server-side.
 */
interface Props {
  returnId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{value ?? '—'}</div>
    </div>
  );
}

const REWORK_STATUS_OPTIONS = [
  { value: 'NOT_STARTED', label: 'Not started' },
  { value: 'IN_REWORK', label: 'In rework' },
  { value: 'WAITING_DOCUMENTS', label: 'Waiting on documents' },
  { value: 'READY_FOR_RESUBMISSION', label: 'Ready for resubmission' },
];

export default function LegalReturnDetailDialog({ returnId, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { data, isLoading, error } = useLegalReturnDetail(open ? returnId : null);
  const { assign, setStatus, complete } = useLegalReturnActions(returnId);

  const r: any = data?.return ?? {};
  const corrections = data?.corrections ?? [];
  const outstanding = useMemo(
    () => corrections.filter((c: any) => c.is_required && !c.is_satisfied),
    [corrections],
  );

  const [assignee, setAssignee] = useState('');
  const [assigneeName, setAssigneeName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [createTask, setCreateTask] = useState(true);
  const [summary, setSummary] = useState('');
  const [resubmit, setResubmit] = useState(true);
  const [idemKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    setAssignee(r.assigned_to ?? '');
    setAssigneeName(r.assigned_to_name ?? '');
    setDueDate(r.due_date ?? '');
    setSummary('');
  }, [open, r.assigned_to, r.assigned_to_name, r.due_date]);

  const isOpenReturn = r.status_code === 'OPEN' || r.status_code === 'IN_PROGRESS';
  const canComplete = !!data?.actor?.can_complete && isOpenReturn;
  const blockedByPack = (r.pack_missing_required ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <ArrowLeftRight className="h-5 w-5 text-primary" />
            {r?.referral_number ?? 'Legal return'}
            {r?.status_label && <Badge variant="outline">{r.status_label}</Badge>}
            {r?.rework_label && <Badge variant="secondary">{r.rework_label}</Badge>}
            {r?.total_returns > 1 && (
              <Badge variant="destructive" className="text-[10px]">
                Return {r.return_seq} of {r.total_returns}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Legal returned this referral to Compliance. Correct the pack, then resubmit through the governed
            path — Legal owns the return reason and required action.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="py-16 text-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            Loading return…
          </div>
        )}

        {error && (
          <div className="py-12 text-center space-y-2">
            <AlertTriangle className="h-6 w-6 text-destructive mx-auto" />
            <p className="text-sm font-medium">Unable to load this return</p>
            <p className="text-xs text-muted-foreground">{(error as Error).message}</p>
          </div>
        )}

        {data && !isLoading && (
          <Tabs defaultValue="overview" className="flex-1 overflow-hidden flex flex-col">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="corrections">Corrections ({corrections.length})</TabsTrigger>
              <TabsTrigger value="rework">Rework</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1 pr-3">
              {/* OVERVIEW */}
              <TabsContent value="overview" className="space-y-4 mt-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <Field
                    label="Employer"
                    value={
                      r.employer_reg_no ? (
                        <button
                          className="text-primary hover:underline inline-flex items-center gap-1 text-left"
                          onClick={() => navigate(`/compliance/employer/${r.employer_reg_no}`)}
                        >
                          <Building2 className="h-3 w-3" />
                          {r.employer_name ?? r.employer_reg_no}
                        </button>
                      ) : (r.employer_name ?? '—')
                    }
                  />
                  <Field
                    label="Compliance case"
                    value={
                      r.ce_case_id ? (
                        <button
                          className="text-primary hover:underline inline-flex items-center gap-1"
                          onClick={() => navigate(`/compliance/cases/${r.ce_case_id}`)}
                        >
                          <ExternalLink className="h-3 w-3" />
                          {r.ce_case_number ?? 'Open case'}
                        </button>
                      ) : '—'
                    }
                  />
                  <Field
                    label="Legal reference"
                    value={
                      <span className="inline-flex items-center gap-1">
                        <Gavel className="h-3 w-3 text-muted-foreground" />
                        {r.lg_case_no ?? r.lg_intake_no ?? r.court_case_no ?? '—'}
                      </span>
                    }
                  />
                  <Field label="Returned on" value={formatAuditDateTime(r.returned_at)} />
                  <Field label="Returned by (Legal)" value={r.returned_by_display} />
                  <Field label="Rework age" value={formatReworkAge(r.rework_hours)} />
                  <Field label="Return reason" value={r.reason_label ?? r.reason_code} />
                  <Field label="Pack version returned" value={r.returned_pack_version ?? '—'} />
                  <Field label="Current pack version" value={r.current_pack_version ?? '—'} />
                  <Field label="Principal" value={formatCurrency(Number(r.principal ?? 0))} />
                  <Field label="Penalty + interest" value={formatCurrency(Number(r.penalty ?? 0) + Number(r.interest ?? 0))} />
                  <Field label="Total referred" value={formatCurrency(Number(r.total_referred ?? 0))} />
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Legal's reason for return
                  </div>
                  <div className="rounded-md border p-3 text-sm whitespace-pre-wrap">{r.reason_text || '—'}</div>
                </div>

                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Required action from Legal
                  </div>
                  <div className="rounded-md border p-3 text-sm whitespace-pre-wrap">
                    {r.required_action || 'Legal did not record a specific required action.'}
                  </div>
                </div>

                {r.comments && (
                  <div className="space-y-2">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Legal comments</div>
                    <div className="rounded-md border p-3 text-sm whitespace-pre-wrap">{r.comments}</div>
                  </div>
                )}

                {(data.documents ?? []).length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                      <FileText className="h-3 w-3" /> Pack documents ({data.documents.length})
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {data.documents.map((d: any) => (
                        <div key={d.id} className="rounded-md border p-2 text-xs">
                          <div className="font-medium truncate">{d.title ?? '—'}</div>
                          <div className="text-muted-foreground">
                            {d.document_type ?? 'Document'} · {formatDisplayDate(d.uploaded_at)}
                            {d.is_required ? ' · Required' : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* CORRECTIONS */}
              <TabsContent value="corrections" className="space-y-3 mt-3">
                <div className="rounded-md border p-3 text-sm flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-muted-foreground" />
                  {r.pack_required_complete ?? 0} of {r.pack_required_items ?? 0} mandatory pack items complete
                  {blockedByPack && (
                    <Badge variant="destructive" className="ml-auto">
                      {r.pack_missing_required} outstanding
                    </Badge>
                  )}
                </div>

                {corrections.length === 0 && (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No pack checklist has been assembled for this referral yet.
                  </p>
                )}

                <div className="space-y-2">
                  {corrections.map((c: any) => (
                    <div key={c.item_key} className="rounded-md border p-3 flex items-start gap-3">
                      <CheckCircle2
                        className={`h-4 w-4 mt-0.5 ${c.is_satisfied ? 'text-success' : 'text-muted-foreground/40'}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium flex items-center gap-2">
                          {c.item_label ?? c.item_key}
                          {c.is_required && <Badge variant="outline" className="text-[10px]">Mandatory</Badge>}
                        </div>
                        {c.notes && <div className="text-xs text-muted-foreground">{c.notes}</div>}
                        {c.is_satisfied && (
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            Completed {formatDisplayDate(c.satisfied_at)} by {c.satisfied_by ?? '—'}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/compliance/legal/pack-preparation?referral=${r.referral_id}`)}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open Legal Pack Preparation
                </Button>
              </TabsContent>

              {/* REWORK */}
              <TabsContent value="rework" className="space-y-4 mt-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="Rework owner" value={r.assigned_to_name ?? r.assigned_to ?? 'Unassigned'} />
                  <Field label="Assigned on" value={r.assigned_at ? formatAuditDateTime(r.assigned_at) : '—'} />
                  <Field
                    label={`Due (SLA ${data.thresholds?.rework_sla_days ?? 5}d)`}
                    value={r.due_date ? formatDisplayDate(r.due_date) : '—'}
                  />
                </div>

                {isOpenReturn && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <div className="text-sm font-medium flex items-center gap-2">
                        <UserPlus className="h-4 w-4" /> Assign rework owner
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Officer code</Label>
                          <Input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="e.g. CO-014" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Officer name</Label>
                          <Input value={assigneeName} onChange={(e) => setAssigneeName(e.target.value)} placeholder="Display name" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Due date</Label>
                          <Input type="date" value={dueDate ?? ''} onChange={(e) => setDueDate(e.target.value)} />
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox checked={createTask} onCheckedChange={(v) => setCreateTask(!!v)} />
                        Create a follow-up task for the owner
                      </label>
                      <Button
                        size="sm"
                        disabled={!assignee.trim() || assign.isPending}
                        onClick={() =>
                          assign.mutate({
                            assignee_code: assignee.trim(),
                            assignee_name: assigneeName.trim() || null,
                            due_date: dueDate || null,
                            create_task: createTask,
                          })
                        }
                      >
                        {assign.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Assign owner
                      </Button>
                    </div>

                    <Separator />
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Rework progress</div>
                      <div className="flex items-center gap-2">
                        <Select
                          value={r.rework_status}
                          onValueChange={(v) => setStatus.mutate({ rework_status: v })}
                        >
                          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {REWORK_STATUS_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {setStatus.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                      </div>
                    </div>

                    <Separator />
                    <div className="space-y-3">
                      <div className="text-sm font-medium flex items-center gap-2">
                        <Send className="h-4 w-4" /> Complete rework
                      </div>
                      {blockedByPack && (
                        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                          {r.pack_missing_required} mandatory pack item(s) are still outstanding. Complete them in
                          Legal Pack Preparation before resubmitting.
                        </div>
                      )}
                      <div className="space-y-1">
                        <Label className="text-xs">Resolution summary (required)</Label>
                        <Textarea
                          rows={4}
                          value={summary}
                          onChange={(e) => setSummary(e.target.value)}
                          placeholder="Describe how each point raised by Legal was addressed."
                        />
                      </div>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox checked={resubmit} onCheckedChange={(v) => setResubmit(!!v)} />
                        Resubmit the corrected pack to Legal on completion
                      </label>
                      <Button
                        size="sm"
                        disabled={!canComplete || !summary.trim() || complete.isPending || (resubmit && blockedByPack)}
                        onClick={() => complete.mutate({ summary: summary.trim(), resubmit, idempotencyKey: idemKey })}
                      >
                        {complete.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        {resubmit ? 'Complete and resubmit' : 'Complete rework'}
                      </Button>
                      {!data.actor?.can_complete && (
                        <p className="text-xs text-muted-foreground">
                          You do not hold the approval capability required to close a Legal return.
                        </p>
                      )}
                    </div>
                  </>
                )}

                {!isOpenReturn && (
                  <div className="rounded-md border p-3 text-sm space-y-1">
                    <div className="font-medium">Return closed</div>
                    <div className="text-xs text-muted-foreground">
                      Resolved {formatAuditDateTime(r.resolved_at)} by {r.resolved_by ?? '—'}
                      {r.resubmitted_at ? ` · Resubmitted ${formatAuditDateTime(r.resubmitted_at)}` : ''}
                    </div>
                    {r.resolution_summary && (
                      <div className="text-sm whitespace-pre-wrap pt-2">{r.resolution_summary}</div>
                    )}
                  </div>
                )}

                {(data.tasks ?? []).length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Follow-up tasks</div>
                    {data.tasks.map((t: any) => (
                      <div key={t.id} className="rounded-md border p-2 text-xs flex items-center justify-between gap-2">
                        <span className="truncate">{t.description}</span>
                        <span className="text-muted-foreground shrink-0">
                          {t.status} · {t.due_date ? formatDisplayDate(t.due_date) : 'No due date'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* HISTORY */}
              <TabsContent value="history" className="space-y-4 mt-3">
                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                    <History className="h-3 w-3" /> Return history for this referral ({(data.history ?? []).length})
                  </div>
                  {(data.history ?? []).map((h: any) => (
                    <div key={h.return_id} className="rounded-md border p-3 text-sm space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">Return {h.return_seq}</Badge>
                        <span className="text-xs text-muted-foreground">{formatAuditDateTime(h.returned_at)}</span>
                        <Badge variant="secondary" className="text-[10px] ml-auto">{h.status_label}</Badge>
                      </div>
                      <div className="text-xs"><strong>{h.reason_label ?? h.reason_code}</strong> — {h.reason_text}</div>
                      {h.required_action && <div className="text-xs text-muted-foreground">Action: {h.required_action}</div>}
                      {h.resolution_summary && (
                        <div className="text-xs text-muted-foreground">Resolved: {h.resolution_summary}</div>
                      )}
                    </div>
                  ))}
                </div>

                {(data.versions ?? []).length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Pack versions</div>
                    {data.versions.map((v: any) => (
                      <div key={v.version_no} className="rounded-md border p-2 text-xs flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">v{v.version_no}</Badge>
                        <span>{v.status}</span>
                        <span className="text-muted-foreground ml-auto">
                          {v.submitted_at ? `Submitted ${formatDisplayDate(v.submitted_at)}` : 'Not submitted'}
                          {v.returned_at ? ` · Returned ${formatDisplayDate(v.returned_at)}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {(data.timeline ?? []).length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Rework timeline</div>
                    {data.timeline.map((e: any, i: number) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className="text-muted-foreground w-40 shrink-0">{formatAuditDateTime(e.created_at)}</span>
                        <span className="flex-1">
                          <strong>{e.event_code}</strong> {e.description ? `— ${e.description}` : ''}
                        </span>
                        <span className="text-muted-foreground shrink-0">{e.actor ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </ScrollArea>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
