import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle, CheckCircle2, ChevronRight, ExternalLink, FileText, History,
  Loader2, Paperclip, Send, ShieldCheck, Trash2,
} from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import ReferralDocumentSelector from '@/components/legal/lg/ReferralDocumentSelector';
import { insertReferralDocuments, type ReferralDocumentDraft } from '@/services/legal/coreLegalReferralDocumentService';
import { formatCurrency } from '@/utils/formatCurrency';
import { useUserCode } from '@/hooks/useUserCode';
import {
  useLegalPackDetail, usePackCommands, READINESS_LABEL, READINESS_TONE,
} from '@/hooks/compliance/useLegalPackRegister';

interface Props {
  referralId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function fmtDate(v?: string | null) {
  return v ? new Date(v).toLocaleString() : '—';
}

export function LegalPackAssemblyDialog({ referralId, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { userCode } = useUserCode();
  const { data, isLoading, error } = useLegalPackDetail(open ? referralId : null);
  const { confirmItem, detachDocument, submitPack } = usePackCommands(referralId);

  const [notes, setNotes] = useState('');
  const [drafts, setDrafts] = useState<ReferralDocumentDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitKey] = useState(() => crypto.randomUUID());

  const ref = data?.referral;
  const readiness = data?.readiness ?? 'NOT_STARTED';
  const canEdit = !!data?.can_edit;

  const grouped = useMemo(() => {
    if (!data) return [];
    return (data.groups ?? [])
      .map((g) => ({ ...g, items: data.checklist.filter((i) => i.group_code === g.code) }))
      .filter((g) => g.items.length > 0);
  }, [data]);

  async function attachSelected() {
    if (!referralId || drafts.length === 0) return;
    setSaving(true);
    try {
      await insertReferralDocuments(referralId, drafts, userCode ?? null);
      setDrafts([]);
      toast.success('Documents attached to the pack');
      qc.invalidateQueries({ queryKey: ['ce-legal-pack-detail', referralId] });
      qc.invalidateQueries({ queryKey: ['ce-legal-pack-register'] });
    } catch (e: any) {
      toast.error('Attach failed', { description: e?.message });
    } finally {
      setSaving(false);
    }
  }

  function onSubmit() {
    submitPack.mutate(
      { notes: notes || undefined, idempotencyKey: submitKey },
      {
        onSuccess: (res) => {
          toast.success(
            res.status === 'ALREADY_SUBMITTED'
              ? `Pack version ${res.version_no} was already sent for approval`
              : `Pack version ${res.version_no} sent for approval`,
            {
              description: res.workflow?.enabled
                ? `Approval route: ${res.workflow.workflow_name} (${res.workflow.levels} level(s)).`
                : 'No approval workflow is mapped for legal.escalation_approval — this is recorded on the pack version.',
            },
          );
          onOpenChange(false);
        },
        onError: (e: any) =>
          toast.error('Cannot send for approval', { description: e?.message }),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {ref?.referral_number ?? 'Legal pack'}
            <Badge variant="outline" className={READINESS_TONE[readiness]}>
              {READINESS_LABEL[readiness]}
            </Badge>
            {ref?.status && <Badge variant="secondary">{ref.status}</Badge>}
          </DialogTitle>
          <DialogDescription>
            {ref?.employer_name ?? '—'}
            {ref?.employer_id ? ` · ${ref.employer_id}` : ''}
            {ref?.case_number ? ` · Case ${ref.case_number}` : ''}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="py-16 text-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Loading pack…
          </div>
        )}
        {error && (
          <div className="py-10 text-center text-destructive text-sm">{(error as Error).message}</div>
        )}

        {data && (
          <Tabs defaultValue="checklist" className="flex-1 overflow-hidden flex flex-col">
            <TabsList>
              <TabsTrigger value="checklist">Checklist</TabsTrigger>
              <TabsTrigger value="documents">Documents ({data.documents.length})</TabsTrigger>
              <TabsTrigger value="context">Case context</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="submit">Send for approval</TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1 pr-3">
              {/* Readiness strip */}
              <div className="grid gap-3 md:grid-cols-4 py-3">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Readiness</div>
                  <div className="text-lg font-semibold">{data.rollup.completion_pct}%</div>
                  <Progress value={data.rollup.completion_pct} className="h-1.5 mt-2" />
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Mandatory outstanding</div>
                  <div className="text-lg font-semibold">{data.rollup.missing_required}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Exposure</div>
                  <div className="text-lg font-semibold">{formatCurrency(Number(ref?.amount ?? 0))}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Approval route</div>
                  <div className="text-sm font-medium">
                    {data.workflow?.enabled ? data.workflow.workflow_name : 'No workflow mapped'}
                  </div>
                </div>
              </div>

              <TabsContent value="checklist" className="space-y-4 mt-0">
                {grouped.map((g) => (
                  <div key={g.code} className="rounded-lg border">
                    <div className="px-3 py-2 bg-muted/40 text-sm font-medium">{g.label}</div>
                    <div className="divide-y">
                      {g.items.map((it) => (
                        <div key={it.id} className="flex items-start gap-3 p-3">
                          {it.completion_mode === 'MANUAL' ? (
                            <Checkbox
                              className="mt-1"
                              checked={it.is_satisfied}
                              disabled={!canEdit || confirmItem.isPending}
                              onCheckedChange={(v) =>
                                confirmItem.mutate(
                                  { itemKey: it.item_key, satisfied: !!v },
                                  { onError: (e: any) => toast.error(e.message) },
                                )
                              }
                            />
                          ) : it.is_satisfied ? (
                            <CheckCircle2 className="h-4 w-4 text-success mt-1" />
                          ) : (
                            <AlertTriangle
                              className={`h-4 w-4 mt-1 ${it.is_required ? 'text-destructive' : 'text-muted-foreground'}`}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-sm">{it.item_label}</span>
                              {it.is_required ? (
                                <Badge variant="secondary" className="text-[10px]">Required</Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px]">Optional</Badge>
                              )}
                              <Badge variant="outline" className="text-[10px]">
                                {it.completion_mode === 'MANUAL' ? 'Manual confirmation' : 'System validated'}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {it.auto_evidence?.detail ??
                                (it.is_satisfied ? 'Confirmed' : 'Not yet satisfied')}
                            </div>
                            {it.satisfied_by_name && (
                              <div className="text-xs text-muted-foreground">
                                Confirmed by {it.satisfied_by_name} on {fmtDate(it.satisfied_at)}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="documents" className="space-y-4 mt-0">
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Document</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Attached</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.documents.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                            No documents attached to this pack yet.
                          </TableCell>
                        </TableRow>
                      )}
                      {data.documents.map((d: any) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-medium">
                            {d.display_title || d.file_name || 'Document'}
                            {!d.accessible && (
                              <Badge variant="destructive" className="ml-2 text-[10px]">File missing</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">{d.document_type_code ?? '—'}</TableCell>
                          <TableCell className="text-xs">{d.source_entity_type ?? d.source_module ?? '—'}</TableCell>
                          <TableCell className="text-xs">{fmtDate(d.selected_at)}</TableCell>
                          <TableCell>
                            {canEdit && (
                              <Button
                                variant="ghost" size="icon"
                                onClick={() =>
                                  detachDocument.mutate(d.id, {
                                    onSuccess: () => toast.success('Document detached'),
                                    onError: (e: any) => toast.error(e.message),
                                  })
                                }
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {canEdit && (
                  <div className="space-y-3">
                    <ReferralDocumentSelector
                      sourceModule="COMPLIANCE"
                      employerId={ref?.employer_id}
                      ceCaseId={ref?.case_id}
                      documents={drafts}
                      onChange={setDrafts}
                    />
                    <Button onClick={attachSelected} disabled={drafts.length === 0 || saving}>
                      <Paperclip className="h-4 w-4 mr-2" />
                      Attach {drafts.length || ''} selected document(s)
                    </Button>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="context" className="space-y-4 mt-0">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border p-3 space-y-1 text-sm">
                    <div className="font-medium mb-1">Financial breakdown</div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Principal</span><span>{formatCurrency(Number(ref?.total_principal ?? 0))}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Penalties</span><span>{formatCurrency(Number(ref?.total_penalties ?? 0))}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Interest</span><span>{formatCurrency(Number(ref?.total_interest ?? 0))}</span></div>
                    <Separator className="my-1" />
                    <div className="flex justify-between font-semibold"><span>Total referred</span><span>{formatCurrency(Number(ref?.amount ?? 0))}</span></div>
                    <div className="text-xs text-muted-foreground pt-1">
                      Periods {ref?.period_from ?? '—'} → {ref?.period_to ?? '—'} ({ref?.periods_count ?? 0})
                    </div>
                  </div>
                  <div className="rounded-lg border p-3 space-y-2 text-sm">
                    <div className="font-medium">Traceability</div>
                    <Button variant="outline" size="sm" className="w-full justify-between"
                      onClick={() => ref?.employer_id && navigate(`/compliance/employers/${ref.employer_id}`)}>
                      Employer 360 <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="outline" size="sm" className="w-full justify-between"
                      disabled={!ref?.case_id}
                      onClick={() => navigate(`/compliance/cases/${ref?.case_id}`)}>
                      Case {ref?.case_number ?? ''} <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                    <div className="text-xs text-muted-foreground">
                      Reason: {ref?.reason_code ?? '—'} {ref?.reason_text ? `— ${ref.reason_text}` : ''}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border">
                  <div className="px-3 py-2 bg-muted/40 text-sm font-medium">
                    Linked violations ({data.violations.length})
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Violation</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.violations.length === 0 && (
                        <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No violations linked.</TableCell></TableRow>
                      )}
                      {data.violations.map((v: any) => (
                        <TableRow key={v.id} className="cursor-pointer"
                          onClick={() => navigate(`/compliance/violations/${v.id}`)}>
                          <TableCell className="font-mono text-xs">{v.violation_number}</TableCell>
                          <TableCell className="text-xs">{v.type}</TableCell>
                          <TableCell className="text-xs">{v.severity}</TableCell>
                          <TableCell className="text-xs">{v.status}</TableCell>
                          <TableCell className="text-right text-xs">{formatCurrency(Number(v.amount ?? 0))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="history" className="space-y-4 mt-0">
                {data.versions.length > 0 && (
                  <div className="rounded-lg border">
                    <div className="px-3 py-2 bg-muted/40 text-sm font-medium">Submitted versions</div>
                    <div className="divide-y">
                      {data.versions.map((v: any) => (
                        <div key={v.version_no} className="p-3 text-sm">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">v{v.version_no}</Badge>
                            <span className="font-medium">{v.status}</span>
                            <span className="text-xs text-muted-foreground">
                              {fmtDate(v.submitted_at)} · {v.submitted_by_name ?? '—'}
                            </span>
                          </div>
                          {v.return_reason && (
                            <div className="text-xs text-destructive mt-1">Returned: {v.return_reason}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="rounded-lg border">
                  <div className="px-3 py-2 bg-muted/40 text-sm font-medium flex items-center gap-2">
                    <History className="h-4 w-4" /> Activity
                  </div>
                  <div className="divide-y">
                    {data.timeline.length === 0 && (
                      <div className="p-4 text-sm text-muted-foreground">No activity recorded yet.</div>
                    )}
                    {data.timeline.map((e: any) => (
                      <div key={e.id} className="p-3 text-sm flex items-start gap-2">
                        <ChevronRight className="h-4 w-4 mt-0.5 text-muted-foreground" />
                        <div>
                          <div className="font-medium">{e.event_code}</div>
                          <div className="text-xs text-muted-foreground">
                            {e.description} · {e.actor_name ?? '—'} · {fmtDate(e.created_at)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="submit" className="space-y-4 mt-0">
                <div className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="h-4 w-4 text-primary" /> Approval governance
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {data.workflow?.enabled
                      ? `${data.workflow.workflow_name} — ${data.workflow.levels} approval level(s). A different officer must approve before the referral reaches Legal.`
                      : 'No approval workflow is mapped for legal.escalation_approval. The pack will still be recorded as submitted and the missing route is stored on the pack version for audit.'}
                  </p>
                  {data.rollup.missing_required > 0 && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                      <span className="font-medium">{data.rollup.missing_required} mandatory item(s) outstanding:</span>{' '}
                      {data.rollup.missing_keys.join(', ')}
                    </div>
                  )}
                  <Textarea
                    placeholder="Submission note for the approver (optional)"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                  <Button
                    onClick={onSubmit}
                    disabled={!canEdit || data.rollup.missing_required > 0 || submitPack.isPending}
                  >
                    {submitPack.isPending
                      ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      : <Send className="h-4 w-4 mr-2" />}
                    Send for approval
                  </Button>
                  {!canEdit && (
                    <p className="text-xs text-muted-foreground">
                      This pack is read-only in its current state or you do not hold legal enforcement authority.
                    </p>
                  )}
                </div>
              </TabsContent>
            </ScrollArea>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default LegalPackAssemblyDialog;
