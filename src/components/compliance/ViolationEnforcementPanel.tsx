/**
 * Checkpoint D / Wave H–J — the UI surface for the governed enforcement ladder.
 *
 * Warning → Demand → Legal eligibility → Recommend Legal, all evaluated and
 * executed through `escalationStageService` / `legalReferralGovernance`.
 * No stage delay, template or threshold is hard-coded here: an unconfigured
 * stage fails visibly with the reason returned by the database.
 */
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient, useQueries } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Clock, Gavel, Loader2, Send } from 'lucide-react';
import {
  listActiveStages, evaluateStage, generateStageNotice,
  type EscalationStageConfig, type StageEligibility,
} from '@/services/compliance/escalationStageService';
import { recommendLegal } from '@/services/compliance/legalReferralGovernance';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  violationId: string;
  employerId: string;
  caseId?: string | null;
}

const statusTone: Record<string, string> = {
  eligible: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  waiting: 'bg-amber-100 text-amber-800 border-amber-300',
  prerequisite_missing: 'bg-muted text-muted-foreground',
  configuration_error: 'bg-red-100 text-red-800 border-red-300',
  stage_disabled: 'bg-muted text-muted-foreground',
  not_found: 'bg-red-100 text-red-800 border-red-300',
};

export function ViolationEnforcementPanel({ violationId, employerId, caseId }: Props) {
  const qc = useQueryClient();
  const [recommendOpen, setRecommendOpen] = useState(false);
  const [reason, setReason] = useState('');
  // Synchronous in-flight latch: React state updates are async, so a fast
  // double-click could dispatch two RPCs before the button re-renders disabled.
  const inFlight = useRef<string | null>(null);

  const { data: stages = [], isLoading: stagesLoading } = useQuery({
    queryKey: ['ce_escalation_stages_active'],
    queryFn: listActiveStages,
  });

  const evaluations = useQueries({
    queries: stages.map((s) => ({
      queryKey: ['ce_stage_eligibility', violationId, s.stage_code],
      queryFn: () => evaluateStage(violationId, s.stage_code),
    })),
  });

  const { data: notices = [] } = useQuery({
    queryKey: ['ce_stage_notices', violationId],
    queryFn: async () => {
      const { data, error } = await (supabase.from('ce_notices' as any) as any)
        .select('id, notice_number, stage_code, status, effective_date, delivery_method, created_at, stage_config_snapshot')
        .eq('violation_id', violationId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const issueMut = useMutation({
    mutationFn: (stageCode: string) => generateStageNotice(violationId, stageCode, 'EMAIL'),
    onSettled: () => { inFlight.current = null; },
    onSuccess: (res: any, stageCode) => {
      if (res?.generated) {
        toast.success(`${stageCode} notice ${res.notice_number} generated`);
      } else if (res?.status === 'already_generated') {
        toast.info(`A ${stageCode} notice already exists for this violation — no duplicate created.`);
      } else if (res?.status === 'template_missing') {
        toast.error(`No active template configured for ${stageCode}.`);
      } else {
        toast.error(
          res?.evaluation?.reasons?.[0] || `${stageCode} is not eligible yet (${res?.status}).`,
        );
      }
      qc.invalidateQueries({ queryKey: ['ce_stage_notices', violationId] });
      qc.invalidateQueries({ queryKey: ['ce_stage_eligibility', violationId] });
      qc.invalidateQueries({ queryKey: ['ce_notices_violation_count', violationId] });
    },
    onError: (e: any) => toast.error(e?.message || 'Notice generation failed'),
  });

  const recommendMut = useMutation({
    mutationFn: () => recommendLegal({
      employerId,
      violationId,
      caseId: caseId ?? null,
      reason: reason.trim(),
      entryPath: 'RECOMMEND_LEGAL',
    }),
    onSuccess: (res) => {
      toast.success('Legal recommendation submitted for Management approval', {
        description: `Recommendation ${res.recommendation_id} — ${res.recommendation_type}. It does not refer the case by itself.`,
      });
      setRecommendOpen(false);
      setReason('');
      qc.invalidateQueries({ queryKey: ['legal-recommendations'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to submit recommendation'),
  });

  const legalIndex = stages.findIndex((s) => s.stage_code === 'LEGAL_ELIGIBLE');
  const legalEligibility = legalIndex >= 0 ? (evaluations[legalIndex]?.data as StageEligibility | undefined) : undefined;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" /> Enforcement Escalation
          </CardTitle>
          <CardDescription>
            Stages, waiting periods and templates come from Escalation Stage Configuration.
            Nothing is issued automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {stagesLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading stages…</div>}
          {stages.map((s: EscalationStageConfig, i: number) => {
            const q = evaluations[i];
            const ev = q?.data as StageEligibility | undefined;
            const issued = notices.find((n) => n.stage_code === s.stage_code);
            const isNoticeStage = Boolean(s.notice_template_code);
            const busy = issueMut.isPending && issueMut.variables === s.stage_code;
            return (
              <div key={s.id} data-testid={`stage-${s.stage_code}`} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-medium">{s.stage_order}. {s.stage_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.stage_code}
                      {s.prerequisite_stage_code ? ` · after ${s.prerequisite_stage_code}` : ''}
                      {' · '}
                      {s.delay_days === null ? 'waiting period not configured' : `${s.delay_days} day(s) from ${s.delay_basis.replace(/_/g, ' ').toLowerCase()}`}
                      {s.notice_template_code ? ` · template ${s.notice_template_code}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {q?.isLoading ? (
                      <Badge variant="outline"><Loader2 className="h-3 w-3 animate-spin mr-1" />Evaluating</Badge>
                    ) : (
                      <Badge variant="outline" className={statusTone[ev?.status || ''] || ''}>
                        {ev?.status === 'eligible' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                        {ev?.status === 'waiting' && <Clock className="h-3 w-3 mr-1" />}
                        {ev?.status === 'configuration_error' && <AlertTriangle className="h-3 w-3 mr-1" />}
                        {(ev?.status || 'unknown').replace(/_/g, ' ')}
                      </Badge>
                    )}
                    {issued && (
                      <Badge variant="secondary" data-testid={`issued-${s.stage_code}`}>
                        {issued.notice_number} · {issued.effective_date}
                      </Badge>
                    )}
                    {isNoticeStage && (
                      <Button
                        size="sm"
                        data-testid={`issue-${s.stage_code}`}
                        disabled={Boolean(issued) || busy || issueMut.isPending || !ev?.eligible}
                        onClick={() => {
                          if (inFlight.current) return;
                          inFlight.current = s.stage_code;
                          issueMut.mutate(s.stage_code);
                        }}
                      >
                        {busy ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Generating…</> : issued ? 'Issued' : `Issue ${s.stage_name}`}
                      </Button>
                    )}
                  </div>
                </div>
                {ev?.reasons?.length ? (
                  <ul className="text-xs text-muted-foreground list-disc pl-5">
                    {ev.reasons.map((r, k) => <li key={k}>{r}</li>)}
                  </ul>
                ) : null}
                {ev?.open_decision && (
                  <div className="text-xs rounded bg-amber-50 border border-amber-200 px-2 py-1 text-amber-900">
                    Blocked by open policy decision <strong>{ev.open_decision}</strong> — the waiting period must be
                    decided by the client before this stage can be used.
                  </div>
                )}
                {ev?.eligible_from && (
                  <div className="text-xs text-muted-foreground">
                    Basis {ev.basis_date} · eligible from {ev.eligible_from}
                    {ev.requires_approval ? ' · requires approval' : ''}
                  </div>
                )}
                {issued?.stage_config_snapshot && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">Configuration snapshot used</summary>
                    <pre className="mt-1 whitespace-pre-wrap bg-muted/40 p-2 rounded">
                      {JSON.stringify(issued.stage_config_snapshot, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Gavel className="h-4 w-4" /> Legal Recommendation</CardTitle>
          <CardDescription>
            Legal eligibility never refers a case automatically. An officer must recommend, and
            Management must approve, before any referral exists.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-sm">
            Eligibility:{' '}
            <Badge variant="outline" className={statusTone[legalEligibility?.status || ''] || ''} data-testid="legal-eligibility">
              {(legalEligibility?.status || 'unknown').replace(/_/g, ' ')}
            </Badge>
          </div>
          {legalEligibility?.reasons?.map((r, k) => (
            <p key={k} className="text-xs text-muted-foreground">{r}</p>
          ))}
          <Button
            size="sm"
            variant="outline"
            data-testid="recommend-legal"
            disabled={!legalEligibility?.eligible || recommendMut.isPending}
            onClick={() => setRecommendOpen(true)}
          >
            Recommend Legal Action
          </Button>
        </CardContent>
      </Card>

      <Dialog open={recommendOpen} onOpenChange={(o) => !recommendMut.isPending && setRecommendOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recommend Legal Action</DialogTitle>
            <DialogDescription>
              This creates a recommendation for Management approval. It does not create a legal referral.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason / justification *</Label>
            <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Why should this employer be referred to Legal?" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecommendOpen(false)} disabled={recommendMut.isPending}>Cancel</Button>
            <Button
              data-testid="submit-recommendation"
              disabled={reason.trim().length < 10 || recommendMut.isPending}
              onClick={() => recommendMut.mutate()}
            >
              {recommendMut.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Submitting…</> : 'Submit Recommendation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ViolationEnforcementPanel;
