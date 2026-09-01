import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatCurrency } from '@/utils/formatCurrency';
import { formatDisplayDate } from '@/lib/dateFormat';
import {
  useLegalCandidatePreview, useInitiateLegalEscalation,
} from '@/hooks/compliance/useLegalReferralCandidateRegister';
import {
  AlertTriangle, CheckCircle2, Loader2, ExternalLink, ShieldAlert, Gavel, Building2, Info,
} from 'lucide-react';

/**
 * Eligibility preview + governed initiation.
 * The list can be minutes stale, so eligibility is always revalidated
 * server-side here before any action is offered.
 */
export default function LegalCandidateInitiationDialog({
  caseId, open, onOpenChange,
}: { caseId: string | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch, isFetching } = useLegalCandidatePreview(open ? caseId : null);
  const initiate = useInitiateLegalEscalation();
  const [reason, setReason] = useState('');

  useEffect(() => { if (open) setReason(''); }, [open, caseId]);

  const c = data?.case;
  const route = data?.route;

  const defaultReason = useMemo(() => {
    if (!data) return '';
    const parts = (data.reasons ?? []).map((r) => r.label).filter(Boolean);
    return parts.length ? parts.join('; ') : 'Unresolved compliance violation requiring legal escalation';
  }, [data]);

  const go = (path: string) => { onOpenChange(false); navigate(path); };

  const submit = async () => {
    if (!data || !c) return;
    const res = await initiate.mutateAsync({
      employerId: c.employer_id ?? c.employer_reg_no,
      caseId: c.case_id,
      reason: (reason || defaultReason).trim(),
      violationId: c.principal_violation_id ?? null,
      entryPath: 'RECOMMEND_LEGAL',
      earlyRuleCode: data.rule?.mode === 'EARLY' ? data.rule?.code ?? null : null,
    });
    onOpenChange(false);
    if (res?.recommendation_id) navigate('/compliance/enforcement/recommendation-queue');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gavel className="h-4 w-4" />
            Legal escalation eligibility
          </DialogTitle>
          <DialogDescription>
            Eligibility is re-checked against live case facts before anything is raised.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="py-12 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Checking eligibility…
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Eligibility could not be checked</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}

        {data && c && (
          <div className="space-y-4">
            <div className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-semibold">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    {c.employer_name ?? 'Employer not recorded'}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {c.employer_reg_no ?? '—'} · Case {c.case_number ?? '—'} · {c.zone ?? 'No zone'} ·
                    {' '}Officer {c.assigned_officer_name ?? 'unassigned'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] uppercase text-muted-foreground">Outstanding</div>
                  <div className="text-lg font-semibold">{formatCurrency(data.exposure?.total ?? 0)}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
                <Fact label="Principal" value={formatCurrency(data.exposure?.principal ?? 0)} />
                <Fact label="Penalties" value={formatCurrency(data.exposure?.penalty ?? 0)} />
                <Fact label="Interest" value={formatCurrency(data.exposure?.interest ?? 0)} />
                <Fact label="Collected" value={formatCurrency(data.exposure?.collected ?? 0)} />
                <Fact label="Open violations" value={`${c.open_violations ?? 0} of ${c.total_violations ?? 0}`} />
                <Fact label="Notices issued" value={String(c.notices_sent ?? 0)} />
                <Fact
                  label="Final notice"
                  value={c.final_notice_at ? `${formatDisplayDate(c.final_notice_at)} (${c.days_since_final_notice ?? 0} days)` : 'Not served'}
                />
                <Fact
                  label="Arrangement"
                  value={c.arrangement_number
                    ? `${c.arrangement_number} — ${c.arrangement_breach ? 'in default' : c.arrangement_status ?? '—'}`
                    : 'None'}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{data.eligibility?.label}</Badge>
              <Badge variant="outline">{data.referral_state?.label}</Badge>
              {data.rule?.name && (
                <span className="text-xs text-muted-foreground">
                  Policy applied: {data.rule.name} ({data.rule.code})
                </span>
              )}
            </div>

            {!!data.reasons?.length && (
              <div>
                <div className="text-xs font-medium mb-1">Why this case qualifies</div>
                <ul className="space-y-1">
                  {data.reasons.map((r, i) => (
                    <li key={i} className="text-xs flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" />
                      <span>{r.label}{r.detail ? ` — ${r.detail}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!!data.blocks?.length && (
              <Alert>
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>Outstanding requirements</AlertTitle>
                <AlertDescription>
                  <ul className="space-y-1 mt-1">
                    {data.blocks.map((b, i) => (
                      <li key={i} className="text-xs">
                        <span className="font-medium">{b.label}</span>
                        {b.detail ? ` — ${b.detail}` : ''}
                        {b.description ? <div className="text-muted-foreground">{b.description}</div> : null}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {data.existing?.referral_number && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Existing legal record</AlertTitle>
                <AlertDescription className="text-xs">
                  Referral {data.existing.referral_number} ({data.existing.referral_status ?? '—'})
                  {data.existing.lg_case_no ? ` · Legal case ${data.existing.lg_case_no}` : ''}
                  {data.existing.court_case_number ? ` · Court ${data.existing.court_case_number}` : ''}
                  {Number(data.existing.open_returns) > 0
                    ? ` · ${data.existing.open_returns} open return(s) awaiting rework`
                    : ''}
                </AlertDescription>
              </Alert>
            )}

            {route?.can_initiate && (
              <>
                <Separator />
                <div className="space-y-2">
                  <Label htmlFor="escalation-reason">Escalation justification</Label>
                  <Textarea
                    id="escalation-reason"
                    rows={3}
                    placeholder={defaultReason}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    A recommendation is raised for management approval. Referrals are only created after
                    approval — the approver must be a different person.
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Re-check'}
          </Button>
          {c?.case_id && (
            <Button variant="outline" onClick={() => go(`/compliance/cases/${c.case_id}`)}>
              Open case <ExternalLink className="h-3.5 w-3.5 ml-1" />
            </Button>
          )}
          {data?.action?.code === 'PREPARE_PACK' && (
            <Button onClick={() => go('/compliance/legal/pack-preparation')}>Prepare legal pack</Button>
          )}
          {data?.action?.code === 'AWAIT_APPROVAL' && (
            <Button onClick={() => go('/compliance/enforcement/recommendation-queue')}>
              Open recommendation queue
            </Button>
          )}
          {data?.action?.code === 'REWORK_RETURN' && (
            <Button onClick={() => go('/compliance/legal/returned-from-legal')}>Open rework queue</Button>
          )}
          {data?.action?.code === 'TRACK_LEGAL' && (
            <Button onClick={() => go('/compliance/legal/approved-escalations')}>Track with Legal</Button>
          )}
          {route?.can_initiate && (
            <Button onClick={submit} disabled={initiate.isPending}>
              {initiate.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Recommend legal escalation
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
