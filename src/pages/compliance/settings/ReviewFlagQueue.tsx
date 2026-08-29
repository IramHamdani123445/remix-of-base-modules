import { useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Loader2, ChevronDown, ChevronUp, AlertOctagon, CheckCircle2, XCircle, MessageSquarePlus, ShieldQuestion } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useHasCapability } from '@/hooks/useHasCapability';
import { COMPLIANCE_CAPABILITIES } from '@/lib/compliance/capabilities';

interface ReviewFlag {
  id: string;
  flag_number: string;
  flag_type: string;
  rule_code: string | null;
  dedupe_key: string;
  subject_type: string;
  subject_id: string;
  subject_name: string | null;
  employer_id: string | null;
  period_key: string | null;
  severity: string;
  status: string;
  summary: string;
  evidence: any;
  triggering_violation_ids: string[];
  disposition: string | null;
  disposition_notes: string | null;
  converted_violation_id: string | null;
  assigned_to_user_id: string | null;
  assigned_to_name: string | null;
  assigned_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

interface FlagEvent {
  id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  actor: string | null;
  notes: string | null;
  payload: any;
  created_at: string;
}

function severityVariant(sev: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch ((sev || '').toUpperCase()) {
    case 'CRITICAL': return 'destructive';
    case 'HIGH': return 'destructive';
    case 'MEDIUM': return 'default';
    default: return 'secondary';
  }
}

/**
 * Canonical dispositions accepted by `ce_review_flag_disposition_v1`.
 * The UI previously sent lowercase verbs ('confirm' / 'dismiss' / 'annotate')
 * which the governed command rejected with CE-FLAG-422, leaving every flag
 * stranded. The vocabulary below is the database vocabulary.
 */
type Disposition = 'CONFIRMED' | 'DISMISSED' | 'RESOLVED' | 'UNDER_REVIEW' | 'ANNOTATE';

const CLOSED_STATUSES = new Set(['CONFIRMED', 'DISMISSED', 'RESOLVED']);

const DISPOSITION_LABEL: Record<Disposition, string> = {
  CONFIRMED: 'Confirm Flag',
  DISMISSED: 'Dismiss as False Positive',
  RESOLVED: 'Resolve Flag',
  UNDER_REVIEW: 'Start Investigation',
  ANNOTATE: 'Add Note / Evidence',
};

const DISPOSITION_SUCCESS: Record<Disposition, string> = {
  CONFIRMED: 'Flag confirmed. It can now be converted to a violation.',
  DISMISSED: 'Flag dismissed and excluded from risk scoring.',
  RESOLVED: 'Flag resolved.',
  UNDER_REVIEW: 'Flag moved to investigation.',
  ANNOTATE: 'Note recorded on the flag history.',
};

export default function ReviewFlagQueue() {
  const canReview = useHasCapability(COMPLIANCE_CAPABILITIES.REVIEW_FLAG_REVIEW);
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [actionTarget, setActionTarget] = useState<{ flag: ReviewFlag; disposition: Disposition } | null>(null);
  const [convertTarget, setConvertTarget] = useState<ReviewFlag | null>(null);
  const [assignTarget, setAssignTarget] = useState<ReviewFlag | null>(null);
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [notes, setNotes] = useState('');

  const { data: flags = [], isLoading } = useQuery({
    queryKey: ['ce_compliance_review_flags'],
    queryFn: async (): Promise<ReviewFlag[]> => {
      const { data, error } = await supabase
        .from('ce_compliance_review_flags')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ReviewFlag[];
    },
  });

  const { data: eventsByFlag = {} } = useQuery({
    queryKey: ['ce_review_flag_events', expandedId],
    enabled: !!expandedId,
    queryFn: async (): Promise<Record<string, FlagEvent[]>> => {
      const { data, error } = await supabase
        .from('ce_review_flag_events')
        .select('*')
        .eq('flag_id', expandedId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return { [expandedId!]: (data || []) as unknown as FlagEvent[] };
    },
  });

  /** Officers that a flag may be assigned to. */
  const { data: officers = [] } = useQuery({
    queryKey: ['ce_review_flag_assignable_officers'],
    enabled: !!assignTarget,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_inspectors')
        .select('id, inspector_code, profile_id')
        .eq('is_active', true)
        .eq('status', 'ACTIVE')
        .order('inspector_code');
      if (error) throw error;
      const rows = (data || []).filter((r: any) => r.profile_id);
      const ids = rows.map((r: any) => r.profile_id);
      const nameMap = new Map<string, string>();
      if (ids.length) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids);
        (profs || []).forEach((p: any) => p.full_name && nameMap.set(p.id, p.full_name));
      }
      return rows.map((r: any) => ({
        userId: r.profile_id as string,
        label: nameMap.get(r.profile_id) ? `${nameMap.get(r.profile_id)} (${r.inspector_code})` : r.inspector_code,
      }));
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ce_compliance_review_flags'] });
    qc.invalidateQueries({ queryKey: ['ce_review_flag_events'] });
  };

  const dispositionMutation = useMutation({
    mutationFn: async ({ flag, disposition, notes }: { flag: ReviewFlag; disposition: Disposition; notes: string }) => {
      if (disposition !== 'UNDER_REVIEW' && !notes.trim()) {
        throw new Error('A written reason is required for this action');
      }
      const { error } = await supabase.rpc('ce_review_flag_disposition_v1', {
        p_flag_id: flag.id,
        p_disposition: disposition,
        p_notes: notes || undefined,
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      invalidate();
      toast.success(DISPOSITION_SUCCESS[vars.disposition]);
      setActionTarget(null);
      setNotes('');
    },
    onError: (e: any) => toast.error('Action failed', { description: e.message }),
  });

  const convertMutation = useMutation({
    mutationFn: async ({ flag, notes }: { flag: ReviewFlag; notes: string }) => {
      if (!notes.trim()) throw new Error('A conversion justification is required');
      const { data, error } = await supabase.rpc('ce_review_flag_convert_to_violation_v1', {
        p_flag_id: flag.id,
        p_notes: notes,
      });
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Violation raised from the confirmed flag');
      setConvertTarget(null);
      setNotes('');
    },
    onError: (e: any) => toast.error('Conversion failed', { description: e.message }),
  });

  const assignMutation = useMutation({
    mutationFn: async ({ flag, userId, notes }: { flag: ReviewFlag; userId: string; notes: string }) => {
      if (!userId) throw new Error('Select an officer');
      const { error } = await supabase.rpc('ce_review_flag_assign_v1', {
        p_flag_id: flag.id,
        p_assignee_user_id: userId,
        p_assignee_name: officers.find(o => o.userId === userId)?.label ?? null,
        p_notes: notes || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success('Flag assigned');
      setAssignTarget(null);
      setAssigneeId('');
      setNotes('');
    },
    onError: (e: any) => toast.error('Assignment failed', { description: e.message }),
  });

  const flagTypes = [...new Set(flags.map(f => f.flag_type))];
  const statuses = [...new Set(flags.map(f => f.status))];

  const filtered = flags.filter(f =>
    (typeFilter === 'ALL' || f.flag_type === typeFilter) &&
    (statusFilter === 'ALL' || f.status === statusFilter)
  );

  const openAction = (flag: ReviewFlag, disposition: Disposition) => {
    setNotes('');
    setActionTarget({ flag, disposition });
  };

  if (isLoading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Review Flag Queue"
        subtitle="Review-first surface for signals that require human confirmation before becoming violations"
        breadcrumbs={[{ label: 'Compliance', href: '/compliance/dashboard' }, { label: 'Settings', href: '/compliance/admin/settings' }, { label: 'Review Flag Queue' }]}
      />

      <Card className="border-warning/40 bg-warning/5">
        <CardContent className="py-4 flex gap-3 items-start">
          <ShieldQuestion className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">A FLAG is not a confirmed violation.</p>
            <p>Every row below is a system-raised signal awaiting human review. It carries no penalty and creates no obligation. Confirming a flag records the reviewer's judgement only — a violation is raised solely by the explicit <span className="font-medium text-foreground">Convert to violation</span> action, which carries the originating rule code and de-duplication key onto the violation. Dismissing requires a documented reason and excludes the flag from risk scoring; notes are for context and never change status.</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Flag Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All flag types</SelectItem>
            {flagTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {statuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Flags</CardTitle>
          <CardDescription>{filtered.length} flag{filtered.length !== 1 ? 's' : ''} shown</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Flag #</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Summary</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(f => (
                <>
                  <TableRow key={f.id}>
                    <TableCell className="font-mono text-xs">{f.flag_number}</TableCell>
                    <TableCell><Badge variant="outline" className="gap-1"><AlertOctagon className="h-3 w-3" />{f.flag_type}</Badge></TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium text-foreground">{f.subject_name || f.subject_id}</div>
                      <div className="text-xs text-muted-foreground">{f.subject_type}</div>
                    </TableCell>
                    <TableCell className="text-xs">{f.period_key || '—'}</TableCell>
                    <TableCell><Badge variant={severityVariant(f.severity)}>{f.severity}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={CLOSED_STATUSES.has(f.status) ? 'outline' : 'secondary'} className="uppercase text-[10px]">
                        {f.status}
                      </Badge>
                      {f.converted_violation_id && (
                        <Badge variant="destructive" className="ml-1 text-[10px]">VIOLATION</Badge>
                      )}
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {f.assigned_to_name ? `→ ${f.assigned_to_name}` : 'Unassigned'}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs max-w-[240px] truncate" title={f.summary}>{f.summary}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canReview && !CLOSED_STATUSES.has(f.status) && (
                          <>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Assign / reassign officer" onClick={() => { setNotes(''); setAssigneeId(f.assigned_to_user_id ?? ''); setAssignTarget(f); }}>
                              <UserCheck className="h-4 w-4" />
                            </Button>
                            {f.status !== 'UNDER_REVIEW' && (
                              <Button variant="ghost" size="icon" className="h-8 w-8" title="Start investigation" onClick={() => openAction(f, 'UNDER_REVIEW')}>
                                <Search className="h-4 w-4" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Confirm flag" onClick={() => openAction(f, 'CONFIRMED')}>
                              <CheckCircle2 className="h-4 w-4 text-success" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Dismiss as false positive" onClick={() => openAction(f, 'DISMISSED')}>
                              <XCircle className="h-4 w-4 text-destructive" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Resolve without violation" onClick={() => openAction(f, 'RESOLVED')}>
                              <ShieldQuestion className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        {canReview && f.status === 'CONFIRMED' && !f.converted_violation_id && f.subject_type === 'EMPLOYER' && (
                          <Button variant="outline" size="sm" className="h-8" title="Convert this confirmed flag into a violation" onClick={() => { setNotes(''); setConvertTarget(f); }}>
                            <AlertOctagon className="h-3.5 w-3.5 mr-1" />Convert
                          </Button>
                        )}
                        {canReview && (
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Add note / evidence" onClick={() => openAction(f, 'ANNOTATE')}>
                            <MessageSquarePlus className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}>
                          {expandedId === f.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedId === f.id && (
                    <TableRow>
                      <TableCell colSpan={8} className="bg-muted/30">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
                          <div>
                            <h4 className="text-xs font-semibold text-foreground mb-1">Evidence</h4>
                            <pre className="text-[11px] bg-background border border-border rounded p-2 overflow-x-auto max-h-56">{JSON.stringify(f.evidence, null, 2)}</pre>
                          </div>
                          <div>
                            <h4 className="text-xs font-semibold text-foreground mb-1">Source &amp; De-duplication</h4>
                            <div className="text-[11px] text-muted-foreground mb-3 space-y-0.5">
                              <div>Rule: <span className="font-mono text-foreground">{f.rule_code || '—'}</span></div>
                              <div className="break-all">Dedupe key: <span className="font-mono text-foreground">{f.dedupe_key}</span></div>
                              {f.converted_violation_id && (
                                <div>Converted violation: <span className="font-mono text-foreground">{f.converted_violation_id}</span></div>
                              )}
                            </div>
                            <h4 className="text-xs font-semibold text-foreground mb-1">Triggering Violation IDs</h4>
                            {f.triggering_violation_ids?.length ? (
                              <div className="flex flex-wrap gap-1">
                                {f.triggering_violation_ids.map(id => <Badge key={id} variant="outline" className="font-mono text-[10px]">{id}</Badge>)}
                              </div>
                            ) : <p className="text-xs text-muted-foreground">None recorded</p>}
                            {f.disposition && (
                              <div className="mt-3 text-xs">
                                <span className="text-muted-foreground">Disposition:</span> <span className="font-medium text-foreground">{f.disposition}</span>
                                {f.disposition_notes && <p className="text-muted-foreground mt-1">{f.disposition_notes}</p>}
                              </div>
                            )}
                            <h4 className="text-xs font-semibold text-foreground mt-3 mb-1">Event History</h4>
                            <div className="space-y-1 max-h-40 overflow-y-auto">
                              {(eventsByFlag[f.id] || []).map(ev => (
                                <div key={ev.id} className="text-[11px] text-muted-foreground border-b border-border/50 pb-1">
                                  <span className="font-medium text-foreground">{ev.event_type}</span>
                                  {ev.from_status && ev.to_status && <span> — {ev.from_status} → {ev.to_status}</span>}
                                  {ev.actor && <span> by {ev.actor}</span>}
                                  <span> · {new Date(ev.created_at).toLocaleString()}</span>
                                  {ev.notes && <p className="italic">{ev.notes}</p>}
                                </div>
                              ))}
                              {(!eventsByFlag[f.id] || eventsByFlag[f.id].length === 0) && (
                                <p className="text-xs text-muted-foreground">No events recorded.</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No flags match the current filters.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Disposition */}
      <Dialog open={!!actionTarget} onOpenChange={(o) => !o && setActionTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{actionTarget ? DISPOSITION_LABEL[actionTarget.disposition] : ''}</DialogTitle>
            <DialogDescription>
              {actionTarget?.flag.flag_number} — {actionTarget?.flag.summary}
              {actionTarget && actionTarget.disposition !== 'UNDER_REVIEW' && ' A written reason is mandatory.'}
              {actionTarget?.disposition === 'CONFIRMED' && ' Confirming does not itself raise a violation — use Convert afterwards.'}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder={actionTarget?.disposition === 'UNDER_REVIEW' ? 'Notes (optional)...' : 'Reason (required)...'}
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionTarget(null)}>Cancel</Button>
            <Button
              onClick={() => actionTarget && dispositionMutation.mutate({ flag: actionTarget.flag, disposition: actionTarget.disposition, notes })}
              disabled={dispositionMutation.isPending}
            >
              {dispositionMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert to violation */}
      <Dialog open={!!convertTarget} onOpenChange={(o) => !o && setConvertTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Convert Flag to Violation</DialogTitle>
            <DialogDescription>
              {convertTarget?.flag_number} — a new violation will be raised against employer{' '}
              <span className="font-mono">{convertTarget?.employer_id}</span>, carrying rule{' '}
              <span className="font-mono">{convertTarget?.rule_code || '—'}</span> and the flag's de-duplication key.
              This is audited and cannot be undone from this screen.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Justification for raising a violation (required)..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertTarget(null)}>Cancel</Button>
            <Button
              onClick={() => convertTarget && convertMutation.mutate({ flag: convertTarget, notes })}
              disabled={convertMutation.isPending}
            >
              {convertMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Raise Violation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign */}
      <Dialog open={!!assignTarget} onOpenChange={(o) => !o && setAssignTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Assign Review Flag</DialogTitle>
            <DialogDescription>
              {assignTarget?.flag_number} — {assignTarget?.summary}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger><SelectValue placeholder="Select an officer" /></SelectTrigger>
              <SelectContent>
                {officers.map(o => <SelectItem key={o.userId} value={o.userId}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Textarea placeholder="Assignment note (optional)..." value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignTarget(null)}>Cancel</Button>
            <Button
              onClick={() => assignTarget && assignMutation.mutate({ flag: assignTarget, userId: assigneeId, notes })}
              disabled={assignMutation.isPending || !assigneeId}
            >
              {assignMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
