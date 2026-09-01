import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, ExternalLink, Gavel, Loader2, ShieldCheck, UserPlus } from 'lucide-react';
import { formatXCD } from '@/components/compliance/arrangements/arrangementFormat';
import { formatDateForDisplay } from '@/lib/format-config';
import type { BreachFacets } from '@/hooks/compliance/useBreachRegister';

const sb = supabase as any;

interface Props {
  breachId: string | null;
  facets?: BreachFacets;
  onClose: () => void;
}

function toneClass(tone?: string | null) {
  switch (tone) {
    case 'destructive':
      return 'bg-destructive/10 text-destructive border-destructive/30';
    case 'warning':
      return 'bg-warning/10 text-warning border-warning/30';
    case 'success':
      return 'bg-success/10 text-success border-success/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

export function BreachDetailDialog({ breachId, facets, onClose }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [assignee, setAssignee] = useState('');
  const [resolutionType, setResolutionType] = useState('');
  const [resolutionReason, setResolutionReason] = useState('');
  const [resolutionDate, setResolutionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentReference, setPaymentReference] = useState('');
  const [referralId, setReferralId] = useState('');

  const detail = useQuery({
    queryKey: ['ce-breach-detail', breachId],
    enabled: Boolean(breachId),
    queryFn: async () => {
      const { data, error } = await sb.rpc('ce_breach_detail_v1', { p_breach_id: breachId });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data as any;
    },
  });

  const breach = detail.data?.breach;
  const actor = detail.data?.actor ?? {};

  const referrals = useQuery({
    queryKey: ['ce-breach-referral-options', breach?.employer_id],
    enabled: Boolean(breach?.employer_id) && Boolean(actor.can_refer_legal) && !breach?.legal_referral_id,
    queryFn: async () => {
      const { data, error } = await sb
        .from('ce_legal_referrals')
        .select('id, referral_number, status, submitted_date')
        .eq('employer_id', breach.employer_id)
        .order('submitted_date', { ascending: false })
        .limit(25);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; referral_number: string; status: string }[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ce-breach-register'] });
    qc.invalidateQueries({ queryKey: ['ce-breach-detail', breachId] });
    qc.invalidateQueries({ queryKey: ['ce-arrangement-register'] });
  };

  const runAction = async (fn: string, payload: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, payload);
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.message || data.error);
    return data;
  };

  const assign = useMutation({
    mutationFn: () =>
      runAction('ce_breach_assign_v1', { p_breach_id: breachId, p_assignee: assignee, p_notes: null }),
    onSuccess: () => {
      toast.success('Breach assigned and moved to Under review');
      setAssignee('');
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || 'Unable to assign breach'),
  });

  const resolve = useMutation({
    mutationFn: () =>
      runAction('ce_breach_resolve_v1', {
        p_breach_id: breachId,
        p_resolution_type: resolutionType,
        p_resolution_reason: resolutionReason,
        p_resolution_date: resolutionDate,
        p_payment_reference: paymentReference || null,
        p_notes: null,
      }),
    onSuccess: () => {
      toast.success('Breach resolved');
      setResolutionType('');
      setResolutionReason('');
      setPaymentReference('');
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || 'Unable to resolve breach'),
  });

  const linkReferral = useMutation({
    mutationFn: () => runAction('ce_breach_link_referral_v1', { p_breach_id: breachId, p_referral_id: referralId }),
    onSuccess: () => {
      toast.success('Legal referral linked to breach');
      setReferralId('');
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || 'Unable to link referral'),
  });

  const installments = (detail.data?.installments ?? []) as any[];
  const notices = (detail.data?.notices ?? []) as any[];
  const history = (detail.data?.history ?? []) as any[];

  const canResolve = Boolean(actor.can_resolve) && breach && !['RESOLVED', 'CLOSED'].includes(breach.breach_status);
  const resolutionTypes = useMemo(() => facets?.resolution_types ?? [], [facets]);

  return (
    <Dialog open={Boolean(breachId)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        {detail.isLoading || !breach ? (
          <div className="space-y-3 py-6">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span>{breach.breach_reference}</span>
                <Badge variant="outline" className={toneClass(breach.severity === 'CRITICAL' ? 'destructive' : 'warning')}>
                  {breach.severity_label ?? breach.severity}
                </Badge>
                <Badge variant="outline">{breach.breach_status_label ?? breach.breach_status}</Badge>
                <Badge variant="outline">{breach.escalation_status_label ?? breach.escalation_status}</Badge>
              </DialogTitle>
              <DialogDescription>
                {breach.breach_type_label} detected {formatDateForDisplay(breach.breach_date)} on arrangement{' '}
                {breach.arrangement_number ?? '—'} for {breach.employer_name ?? breach.employer_id}
                {breach.detection_method ? ` — ${breach.detection_method_label}` : ''}
              </DialogDescription>
            </DialogHeader>

            {/* Breach evidence summary */}
            <div className="grid gap-3 md:grid-cols-4">
              <Card className="shadow-none">
                <CardContent className="p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">Instalment</p>
                  <p className="text-sm font-medium">
                    {breach.installment_number ? `#${breach.installment_number}` : 'Arrangement level'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {breach.installment_due_date ? `Due ${formatDateForDisplay(breach.installment_due_date)}` : '—'}
                  </p>
                </CardContent>
              </Card>
              <Card className="shadow-none">
                <CardContent className="p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">Shortfall</p>
                  <p className="text-sm font-semibold text-destructive">{formatXCD(breach.shortfall ?? 0)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Paid {formatXCD(breach.installment_paid ?? 0)} of {formatXCD(breach.installment_amount ?? 0)}
                  </p>
                </CardContent>
              </Card>
              <Card className="shadow-none">
                <CardContent className="p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">Arrangement exposure</p>
                  <p className="text-sm font-medium">{formatXCD(breach.arrangement_outstanding ?? 0)}</p>
                  <p className="text-[11px] text-destructive">
                    {formatXCD(breach.arrangement_past_due ?? 0)} past due
                  </p>
                </CardContent>
              </Card>
              <Card className="shadow-none">
                <CardContent className="p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">Age / misses</p>
                  <p className="text-sm font-medium">{breach.age_days} day(s)</p>
                  <p className="text-[11px] text-muted-foreground">
                    {breach.consecutive_misses} missed · threshold {breach.max_missed_before_breach ?? '—'} · grace{' '}
                    {breach.grace_days_at_breach ?? 0}d
                  </p>
                </CardContent>
              </Card>
            </div>

            {breach.description && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <span className="font-medium">Why this was raised: </span>
                {breach.description}
                {breach.detection_rule && (
                  <span className="text-muted-foreground"> (rule {breach.detection_rule})</span>
                )}
              </div>
            )}

            {/* Linked records */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/compliance/enforcement/arrangements/${breach.arrangement_id}`)}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Arrangement {breach.arrangement_number ?? ''}
              </Button>
              {breach.case_number && (
                <Button variant="outline" size="sm" onClick={() => navigate(`/compliance/cases?q=${breach.case_number}`)}>
                  Case {breach.case_number}
                </Button>
              )}
              {breach.violation_number && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/compliance/violations?q=${breach.violation_number}`)}
                >
                  Violation {breach.violation_number}
                </Button>
              )}
              {breach.legal_referral_number && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/compliance/enforcement/legal-queue?q=${breach.legal_referral_number}`)}
                >
                  <Gavel className="h-3.5 w-3.5 mr-1.5" />
                  Referral {breach.legal_referral_number} ({breach.legal_referral_status})
                </Button>
              )}
              {breach.assigned_to_name && (
                <span className="text-muted-foreground">Assigned to {breach.assigned_to_name}</span>
              )}
            </div>

            <Separator />

            <Tabs defaultValue="schedule">
              <TabsList>
                <TabsTrigger value="schedule">Instalments</TabsTrigger>
                <TabsTrigger value="notices">Notices</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
                <TabsTrigger value="actions">Actions</TabsTrigger>
              </TabsList>

              <TabsContent value="schedule">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Shortfall</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {installments.map((i) => (
                      <TableRow key={`${i.installment_number}`} className={i.is_breached_installment ? 'bg-destructive/5' : ''}>
                        <TableCell className="text-xs">{i.installment_number}</TableCell>
                        <TableCell className="text-xs">{formatDateForDisplay(i.due_date)}</TableCell>
                        <TableCell className="text-xs text-right">{formatXCD(i.amount ?? 0)}</TableCell>
                        <TableCell className="text-xs text-right">{formatXCD(i.paid_amount ?? 0)}</TableCell>
                        <TableCell className="text-xs text-right">{formatXCD(i.shortfall ?? 0)}</TableCell>
                        <TableCell className="text-xs">{i.status}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{i.payment_reference ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                    {installments.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-6">
                          No instalment schedule found for this arrangement.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="notices" className="space-y-2">
                {notices.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4">No notice has been issued on the linked case.</p>
                ) : (
                  notices.map((n) => (
                    <div key={n.notice_number} className="rounded-md border p-2 text-xs flex justify-between">
                      <span className="font-medium">
                        {n.notice_number} · {n.notice_type}
                      </span>
                      <span className="text-muted-foreground">
                        {n.status}
                        {n.sent_at ? ` · sent ${formatDateForDisplay(n.sent_at)}` : ''}
                      </span>
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="history" className="space-y-2">
                {history.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4">No recorded activity yet.</p>
                ) : (
                  history.map((h, idx) => (
                    <div key={idx} className="rounded-md border p-2 text-xs">
                      <div className="flex justify-between">
                        <span className="font-medium">{h.action}</span>
                        <span className="text-muted-foreground">{formatDateForDisplay(h.at)}</span>
                      </div>
                      <div className="text-muted-foreground">{h.description}</div>
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="actions" className="space-y-4">
                {breach.breach_status === 'RESOLVED' || breach.breach_status === 'CLOSED' ? (
                  <div className="rounded-md border border-success/40 bg-success/5 p-3 text-xs space-y-1">
                    <div className="flex items-center gap-2 font-medium text-success">
                      <ShieldCheck className="h-4 w-4" />
                      Resolved {breach.resolved_at ? formatDateForDisplay(breach.resolved_at) : ''}
                    </div>
                    <div>Resolution: {breach.resolution_type_label ?? breach.resolution_type ?? breach.resolution}</div>
                    {breach.resolution_reason && <div>Reason: {breach.resolution_reason}</div>}
                    {breach.payment_reference && <div>Payment reference: {breach.payment_reference}</div>}
                  </div>
                ) : (
                  <>
                    {actor.can_assign && (
                      <div className="space-y-2">
                        <Label className="text-xs">Assign officer</Label>
                        <div className="flex gap-2">
                          <Select value={assignee} onValueChange={setAssignee}>
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Select officer" />
                            </SelectTrigger>
                            <SelectContent className="bg-popover z-50">
                              {(facets?.officers ?? []).map((o) => (
                                <SelectItem key={o.code} value={o.code}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button size="sm" disabled={!assignee || assign.isPending} onClick={() => assign.mutate()}>
                            {assign.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                    )}

                    {canResolve && (
                      <div className="space-y-2 rounded-md border p-3">
                        <Label className="text-xs font-semibold">Resolve breach</Label>
                        <div className="grid gap-2 md:grid-cols-3">
                          <Select value={resolutionType} onValueChange={setResolutionType}>
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Resolution type" />
                            </SelectTrigger>
                            <SelectContent className="bg-popover z-50">
                              {resolutionTypes.map((r) => (
                                <SelectItem key={r.code} value={r.code}>
                                  {r.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            type="date"
                            className="h-9"
                            value={resolutionDate}
                            onChange={(e) => setResolutionDate(e.target.value)}
                          />
                          <Input
                            className="h-9"
                            placeholder="Payment reference (if any)"
                            value={paymentReference}
                            onChange={(e) => setPaymentReference(e.target.value)}
                          />
                        </div>
                        <Textarea
                          rows={2}
                          placeholder="Resolution reason (required — recorded in the audit trail)"
                          value={resolutionReason}
                          onChange={(e) => setResolutionReason(e.target.value)}
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            disabled={!resolutionType || !resolutionReason.trim() || resolve.isPending}
                            onClick={() => resolve.mutate()}
                          >
                            {resolve.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                            Resolve breach
                          </Button>
                          <span className="text-[11px] text-muted-foreground">
                            Payment-based resolution requires the instalment to be settled in the ledger. Waiver and
                            detection-error resolutions require senior authority.
                          </span>
                        </div>
                      </div>
                    )}

                    {actor.can_refer_legal && !breach.legal_referral_id && (
                      <div className="space-y-2 rounded-md border p-3">
                        <Label className="text-xs font-semibold">Escalate to legal</Label>
                        <p className="text-[11px] text-muted-foreground">
                          Referrals are raised from the arrangement record so the correct default context is carried.
                          Link an existing referral here to track the escalation against this breach.
                        </p>
                        <div className="flex gap-2">
                          <Select value={referralId} onValueChange={setReferralId}>
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="Select existing referral" />
                            </SelectTrigger>
                            <SelectContent className="bg-popover z-50">
                              {(referrals.data ?? []).map((r) => (
                                <SelectItem key={r.id} value={r.id}>
                                  {r.referral_number} · {r.status}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!referralId || linkReferral.isPending}
                            onClick={() => linkReferral.mutate()}
                          >
                            Link
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => navigate(`/compliance/enforcement/arrangements/${breach.arrangement_id}`)}
                          >
                            <Gavel className="h-3.5 w-3.5 mr-1.5" />
                            Raise referral
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="flex items-start gap-2 rounded-md bg-muted/40 border p-2 text-[11px] text-muted-foreground">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      Next recommended action: {breach.next_action ?? 'Review breach'}
                    </div>
                  </>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default BreachDetailDialog;
