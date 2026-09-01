import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatCurrency } from '@/utils/formatCurrency';
import { formatDisplayDate, formatAuditDateTime } from '@/lib/dateFormat';
import {
  useLegalRecommendationDetail,
  formatWaiting,
} from '@/hooks/compliance/useLegalRecommendationRegister';
import { approveLegalReferral, rejectLegalReferral } from '@/services/compliance/legalReferralGovernance';
import {
  AlertTriangle, Building2, CheckCircle2, ExternalLink, FileText, Gavel,
  Loader2, Scale, ShieldAlert, XCircle,
} from 'lucide-react';

/**
 * Management review panel for a legal escalation recommendation.
 *
 * Decisions are executed only by the governed RPCs (`ce_approve_legal_referral_v1`
 * / `ce_reject_legal_referral_v1`), which enforce authority and separation of
 * duties and mint the referral on approval. There is no "create referral"
 * action here — approval already produces it.
 */
interface Props {
  recommendationId: string | null;
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

export default function RecommendationReviewDialog({ recommendationId, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useLegalRecommendationDetail(open ? recommendationId : null);
  const [decisionNote, setDecisionNote] = useState('');
  const [mode, setMode] = useState<'none' | 'approve' | 'reject'>('none');

  const r: any = data?.recommendation;
  const canDecide = data?.actor?.can_decide ?? false;
  const isOwn = Boolean(r?.is_own_recommendation);
  const isPending = r?.status_code === 'PENDING_REVIEW';

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['ce-legal-recommendations'] });
    queryClient.invalidateQueries({ queryKey: ['ce-legal-recommendation-detail'] });
  };

  const approveMut = useMutation({
    mutationFn: () => approveLegalReferral(recommendationId!, decisionNote || null),
    onSuccess: (res) => {
      invalidate();
      setMode('none');
      setDecisionNote('');
      toast.success('Recommendation approved', {
        description: `Referral ${res.referral_number} created. Legal Pack preparation is the next step.`,
        action: {
          label: 'Open pack preparation',
          onClick: () => navigate(`/compliance/legal/pack-preparation?referral=${res.referral_id}`),
        },
      });
    },
    onError: (e: any) => toast.error('Approval blocked', { description: e?.message || 'Unable to approve.' }),
  });

  const rejectMut = useMutation({
    mutationFn: () => rejectLegalReferral(recommendationId!, decisionNote.trim()),
    onSuccess: () => {
      invalidate();
      setMode('none');
      setDecisionNote('');
      toast.success('Recommendation rejected', { description: 'The employer stays in compliance-managed enforcement.' });
    },
    onError: (e: any) => toast.error('Rejection failed', { description: e?.message || 'Unable to reject.' }),
  });

  const busy = approveMut.isPending || rejectMut.isPending;
  const rules: any[] = Array.isArray(r?.triggered_rules) ? r.triggered_rules : [];
  const subcases: any[] = Array.isArray(r?.subcase_summary) ? r.subcase_summary : [];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v); setMode('none'); setDecisionNote(''); } }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            {r?.employer_name ?? 'Recommendation review'}
            {r?.status_label && <Badge variant="outline">{r.status_label}</Badge>}
            {r?.risk_label && <Badge variant="secondary">{r.risk_label} risk</Badge>}
            {r?.review_overdue && <Badge variant="destructive">Review overdue</Badge>}
          </DialogTitle>
          <DialogDescription>
            Management review of a legal escalation recommendation. Approval creates the legal referral and moves it to pack preparation.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading review detail…
          </div>
        )}
        {error && (
          <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>
        )}

        {r && (
          <ScrollArea className="flex-1 pr-3">
            <Tabs defaultValue="review" className="w-full">
              <TabsList>
                <TabsTrigger value="review">Review</TabsTrigger>
                <TabsTrigger value="rules">Why escalate ({rules.length})</TabsTrigger>
                <TabsTrigger value="cases">Qualifying cases ({subcases.length})</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
              </TabsList>

              <TabsContent value="review" className="space-y-4 pt-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Field label="Employer" value={r.employer_name} />
                  <Field label="Registration no." value={r.employer_id} />
                  <Field label="Zone" value={r.zone} />
                  <Field label="Escalation source" value={r.source_label} />
                  <Field label="Recommended by" value={r.recommended_by || 'System detection'} />
                  <Field label="Recommended" value={formatDisplayDate(r.recommended_date || r.recommended_at)} />
                  <Field label="Waiting" value={formatWaiting(r.waiting_hours)} />
                  <Field label="Risk score" value={r.risk_score ?? '—'} />
                </div>

                <Separator />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Field label="Principal" value={formatCurrency(Number(r.total_principal || 0))} />
                  <Field label="Penalties" value={formatCurrency(Number(r.total_penalties || 0))} />
                  <Field label="Interest" value={formatCurrency(Number(r.total_interest || 0))} />
                  <Field label="Total exposure" value={<span className="font-semibold">{formatCurrency(Number(r.grand_total || 0))}</span>} />
                </div>

                <Separator />
                <Field label="Recommendation reason" value={r.recommendation_reason || 'Not recorded'} />

                <div className="flex flex-wrap gap-2">
                  {r.employer_id && (
                    <Button variant="outline" size="sm" onClick={() => navigate(`/employers-management/view/${r.employer_id}`)}>
                      <Building2 className="h-4 w-4 mr-1" /> Employer 360
                    </Button>
                  )}
                  {r.source_case_id && (
                    <Button variant="outline" size="sm" onClick={() => navigate(`/compliance/cases/${r.source_case_id}`)}>
                      <FileText className="h-4 w-4 mr-1" /> {r.source_case_number || 'Compliance case'}
                    </Button>
                  )}
                  {r.referral_id && (
                    <Button variant="outline" size="sm" onClick={() => navigate(`/compliance/legal/pack-preparation?referral=${r.referral_id}`)}>
                      <Gavel className="h-4 w-4 mr-1" /> {r.referral_number} — {r.legal_state_label}
                      <ExternalLink className="h-3 w-3 ml-1" />
                    </Button>
                  )}
                </div>

                {r.status_code !== 'PENDING_REVIEW' && (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription>
                      Decision recorded {r.reviewed_date ? `on ${formatAuditDateTime(r.reviewed_date)}` : ''}
                      {r.reviewed_by ? ` by ${r.reviewed_by}` : ''}. {r.review_notes ? `Note: ${r.review_notes}` : ''}
                    </AlertDescription>
                  </Alert>
                )}

                {isPending && isOwn && (
                  <Alert variant="destructive">
                    <ShieldAlert className="h-4 w-4" />
                    <AlertDescription>
                      Separation of duties: you raised this recommendation, so it must be decided by another authorised reviewer.
                    </AlertDescription>
                  </Alert>
                )}
                {isPending && !canDecide && (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      You can review this recommendation but not decide it. Approval authority requires the legal escalation approval capability.
                    </AlertDescription>
                  </Alert>
                )}

                {isPending && canDecide && !isOwn && (
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="text-sm font-medium">
                      {mode === 'reject' ? 'Rejection reason (required)' : 'Approval comments (optional)'}
                    </div>
                    <Textarea
                      value={decisionNote}
                      onChange={(e) => setDecisionNote(e.target.value)}
                      rows={3}
                      placeholder={mode === 'reject'
                        ? 'Explain why legal escalation is not appropriate…'
                        : 'Context for the approval decision…'}
                    />
                  </div>
                )}
              </TabsContent>

              <TabsContent value="rules" className="pt-4 space-y-3">
                {rules.length === 0 && <p className="text-sm text-muted-foreground">No escalation rules recorded on this recommendation.</p>}
                {rules.map((rule, i) => (
                  <div key={i} className="rounded-md border p-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{rule.ruleCode || rule.rule_code || `Rule ${i + 1}`}</Badge>
                      <span className="text-sm font-medium">{rule.ruleName || rule.rule_name || 'Escalation rule'}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {rule.description || rule.reason || rule.detail || 'Threshold met.'}
                    </p>
                  </div>
                ))}
                {r.eligibility_snapshot && (
                  <details className="rounded-md border p-3">
                    <summary className="text-sm font-medium cursor-pointer">Eligibility evaluation</summary>
                    <pre className="text-xs mt-2 whitespace-pre-wrap text-muted-foreground">
                      {JSON.stringify(r.eligibility_snapshot, null, 2)}
                    </pre>
                  </details>
                )}
              </TabsContent>

              <TabsContent value="cases" className="pt-4 space-y-2">
                {subcases.length === 0 && <p className="text-sm text-muted-foreground">No qualifying cases were captured with this recommendation.</p>}
                {subcases.map((c: any, i: number) => (
                  <div key={i} className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <div className="text-sm font-medium">{c.caseNumber || c.case_number || `Case ${i + 1}`}</div>
                      <div className="text-xs text-muted-foreground">{c.violationType || c.type || c.status || 'Compliance case'}</div>
                    </div>
                    <div className="text-sm">{formatCurrency(Number(c.amount ?? c.grandTotal ?? 0))}</div>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="history" className="pt-4 space-y-2">
                {(data?.timeline ?? []).map((e, i) => (
                  <div key={i} className="flex gap-3 rounded-md border p-3">
                    <div className="text-xs text-muted-foreground w-40 shrink-0">{formatAuditDateTime(e.at)}</div>
                    <div>
                      <div className="text-sm font-medium">{e.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {e.actor ? `By ${e.actor}` : 'System'}{e.note ? ` — ${e.note}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
                {(data?.timeline ?? []).length === 0 && <p className="text-sm text-muted-foreground">No history recorded.</p>}
              </TabsContent>
            </Tabs>
          </ScrollArea>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>
          {isPending && canDecide && !isOwn && (
            <>
              <Button
                variant="destructive"
                disabled={busy || (mode === 'reject' && decisionNote.trim().length < 5)}
                onClick={() => (mode === 'reject' ? rejectMut.mutate() : setMode('reject'))}
              >
                {rejectMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <XCircle className="h-4 w-4 mr-1" />}
                {mode === 'reject' ? 'Confirm rejection' : 'Reject'}
              </Button>
              <Button
                disabled={busy}
                onClick={() => (mode === 'approve' ? approveMut.mutate() : setMode('approve'))}
              >
                {approveMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                {mode === 'approve' ? 'Confirm approval & create referral' : 'Approve for referral'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
