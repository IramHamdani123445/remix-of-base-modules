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

type Disposition = 'confirm' | 'dismiss' | 'annotate';

export default function ReviewFlagQueue() {
  const canReview = useHasCapability(COMPLIANCE_CAPABILITIES.REVIEW_FLAG_REVIEW);
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [actionTarget, setActionTarget] = useState<{ flag: ReviewFlag; disposition: Disposition } | null>(null);
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

  const dispositionMutation = useMutation({
    mutationFn: async ({ flag, disposition, notes }: { flag: ReviewFlag; disposition: Disposition; notes: string }) => {
      if (disposition === 'dismiss' && !notes.trim()) throw new Error('A reason is required to dismiss a flag');
      const { error } = await supabase.rpc('ce_review_flag_disposition_v1', {
        p_flag_id: flag.id,
        p_disposition: disposition,
        p_notes: notes || undefined,
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['ce_compliance_review_flags'] });
      qc.invalidateQueries({ queryKey: ['ce_review_flag_events'] });
      toast.success(
        vars.disposition === 'confirm' ? 'Flag confirmed — violation raised'
        : vars.disposition === 'dismiss' ? 'Flag dismissed'
        : 'Note added to flag'
      );
      setActionTarget(null);
      setNotes('');
    },
    onError: (e: any) => toast.error('Action failed', { description: e.message }),
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
            <p>Every row below is a system-raised signal awaiting human review. It carries no penalty and creates no obligation until an authorized reviewer confirms it, at which point a violation is raised. Dismissing a flag requires a documented reason; annotations are for context only and do not change the flag's status.</p>
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
                      <Badge variant={f.status === 'open' || f.status === 'pending' ? 'secondary' : 'outline'} className="uppercase text-[10px]">
                        {f.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs max-w-[240px] truncate" title={f.summary}>{f.summary}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canReview && f.status !== 'confirmed' && f.status !== 'dismissed' && (
                          <>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Confirm — raise violation" onClick={() => openAction(f, 'confirm')}>
                              <CheckCircle2 className="h-4 w-4 text-success" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Dismiss" onClick={() => openAction(f, 'dismiss')}>
                              <XCircle className="h-4 w-4 text-destructive" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" title="Annotate" onClick={() => openAction(f, 'annotate')}>
                              <MessageSquarePlus className="h-4 w-4" />
                            </Button>
                          </>
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

      <Dialog open={!!actionTarget} onOpenChange={(o) => !o && setActionTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {actionTarget?.disposition === 'confirm' && 'Confirm Flag — Raise Violation'}
              {actionTarget?.disposition === 'dismiss' && 'Dismiss Flag'}
              {actionTarget?.disposition === 'annotate' && 'Annotate Flag'}
            </DialogTitle>
            <DialogDescription>
              {actionTarget?.flag.flag_number} — {actionTarget?.flag.summary}
              {actionTarget?.disposition === 'dismiss' && ' A reason is mandatory.'}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder={actionTarget?.disposition === 'dismiss' ? 'Reason for dismissal (required)...' : 'Notes (optional)...'}
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
    </div>
  );
}
