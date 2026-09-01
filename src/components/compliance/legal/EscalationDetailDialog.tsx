import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatCurrency } from '@/utils/formatCurrency';
import { formatDisplayDate, formatAuditDateTime } from '@/lib/dateFormat';
import {
  useApprovedEscalationDetail,
  formatWaiting,
  type EscalationTimelineEvent,
} from '@/hooks/compliance/useApprovedEscalationRegister';
import { Building2, ExternalLink, Gavel, Scale, AlertTriangle, Loader2, ArrowLeftRight } from 'lucide-react';

/**
 * Compliance-side, read-only referral tracking detail.
 * Legal-owned fields (Legal case, court reference, current Legal status,
 * recovery) are displayed for monitoring only — this dialog never writes them.
 */
interface Props {
  referralId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canOpenLegal?: boolean;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{value ?? '—'}</div>
    </div>
  );
}

const SOURCE_TONE: Record<string, string> = {
  COMPLIANCE: 'bg-primary/10 text-primary',
  LEGAL: 'bg-secondary text-secondary-foreground',
};

export default function EscalationDetailDialog({ referralId, open, onOpenChange, canOpenLegal }: Props) {
  const navigate = useNavigate();
  const { data, isLoading, error } = useApprovedEscalationDetail(open ? referralId : null);

  const r: any = data?.referral;
  const money = data?.actor?.can_view_financials ?? false;
  const amount = (v: any) => (money ? formatCurrency(Number(v ?? 0)) : 'Restricted');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            {r?.referral_number ?? 'Referral tracking'}
            {r?.status_label && <Badge variant="outline">{r.status_label}</Badge>}
            <Badge variant="secondary" className="ml-auto mr-6">Owner: Legal</Badge>
          </DialogTitle>
          <DialogDescription>
            Post-handover tracking. Compliance monitors this referral; Legal owns the matter and its status.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="py-16 text-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            Loading referral tracking…
          </div>
        )}

        {error && (
          <div className="py-12 text-center space-y-2">
            <AlertTriangle className="h-6 w-6 text-destructive mx-auto" />
            <p className="text-sm font-medium">Unable to load this referral</p>
            <p className="text-xs text-muted-foreground">{(error as Error).message}</p>
          </div>
        )}

        {r && (
          <Tabs defaultValue="overview" className="flex-1 overflow-hidden flex flex-col">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="legal">Legal &amp; recovery</TabsTrigger>
              <TabsTrigger value="items">Referred items</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1 mt-3 pr-3">
              <TabsContent value="overview" className="space-y-4 m-0">
                <section className="space-y-2">
                  <h4 className="text-sm font-semibold">Compliance origin</h4>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field
                      label="Employer"
                      value={
                        r.employer_reg_no ? (
                          <button
                            className="text-primary hover:underline inline-flex items-center gap-1 text-left"
                            onClick={() => navigate(`/employers/${r.employer_reg_no}`)}
                          >
                            <Building2 className="h-3.5 w-3.5" />
                            {r.employer_name ?? r.employer_reg_no}
                          </button>
                        ) : (
                          r.employer_name
                        )
                      }
                    />
                    <Field label="Registration No." value={r.employer_reg_no} />
                    <Field label="Zone / Territory" value={r.zone} />
                    <Field
                      label="Compliance Case"
                      value={
                        r.ce_case_id ? (
                          <button
                            className="text-primary hover:underline"
                            onClick={() => navigate(`/compliance/cases/${r.ce_case_id}`)}
                          >
                            {r.ce_case_number ?? 'Open case'}
                          </button>
                        ) : (
                          r.ce_case_number
                        )
                      }
                    />
                    <Field label="Referral reason" value={r.referral_reason_text ?? r.reason_code} />
                    <Field label="Origin" value={r.origin_label ?? r.origin_code} />
                  </div>
                </section>

                <Separator />

                <section className="space-y-2">
                  <h4 className="text-sm font-semibold">Financial exposure referred</h4>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Field label="Principal" value={amount(r.principal_amount)} />
                    <Field label="Penalty" value={amount(r.penalty_amount)} />
                    <Field label="Interest" value={amount(r.interest_amount)} />
                    <Field label="Total referred" value={<span className="font-semibold">{amount(r.total_referred)}</span>} />
                  </div>
                </section>

                <Separator />

                <section className="space-y-2">
                  <h4 className="text-sm font-semibold">Handover</h4>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Field label="Approved by" value={r.approved_by} />
                    <Field label="Approved on" value={r.approved_at ? formatAuditDateTime(r.approved_at) : '—'} />
                    <Field label="Submitted by" value={r.submitted_by} />
                    <Field label="Submitted to Legal" value={r.submitted_date ? formatAuditDateTime(r.submitted_date) : '—'} />
                    <Field label="Pack versions" value={data?.versions?.length ?? 0} />
                    <Field label="Documents in pack" value={data?.documents?.length ?? 0} />
                  </div>
                </section>
              </TabsContent>

              <TabsContent value="legal" className="space-y-4 m-0">
                <section className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Gavel className="h-4 w-4" /> Legal matter
                  </h4>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Legal Intake No." value={r.lg_intake_no} />
                    <Field label="Legal Case No." value={r.lg_case_no} />
                    <Field label="Court Case No." value={r.court_case_no} />
                    <Field label="Court" value={r.court_name} />
                    <Field label="Legal officer / team" value={r.legal_officer} />
                    <Field label="Next hearing" value={r.next_hearing_date ? formatDisplayDate(r.next_hearing_date) : '—'} />
                    <Field label="Accepted by Legal" value={r.accepted_date ? formatAuditDateTime(r.accepted_date) : '—'} />
                    <Field label="Accepted by" value={r.accepted_by} />
                    <Field
                      label="Waiting for acceptance"
                      value={r.accepted_date ? 'Accepted' : formatWaiting(r.waiting_hours)}
                    />
                    <Field label="Latest Legal status" value={<Badge variant="outline">{r.legal_status_label}</Badge>} />
                    <Field label="Last Legal update" value={r.last_legal_update ? formatAuditDateTime(r.last_legal_update) : '—'} />
                  </div>
                </section>

                <Separator />

                <section className="space-y-2">
                  <h4 className="text-sm font-semibold">Recovery</h4>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Recovery status" value={r.recovery_label} />
                    <Field label="Recovered" value={amount(r.recovered_amount)} />
                    <Field label="Current outstanding" value={amount(r.outstanding_amount ?? r.total_referred)} />
                  </div>
                </section>

                {(r.returned_at || r.referral_returned_at) && (
                  <>
                    <Separator />
                    <section className="space-y-2">
                      <h4 className="text-sm font-semibold flex items-center gap-2 text-warning">
                        <ArrowLeftRight className="h-4 w-4" /> Returned by Legal
                      </h4>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field
                          label="Returned on"
                          value={formatAuditDateTime(r.returned_at ?? r.referral_returned_at)}
                        />
                        <Field label="Reason" value={r.return_reason ?? r.referral_return_reason} />
                        <Field label="Rework status" value={r.return_resolution_status ?? 'OPEN'} />
                      </div>
                      <Button size="sm" variant="outline" onClick={() => navigate('/compliance/legal/returned-from-legal')}>
                        Open rework queue
                      </Button>
                    </section>
                  </>
                )}

                <div className="flex flex-wrap gap-2 pt-2">
                  {r.referral_status === 'IN_LEGAL_PROCEEDINGS' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        navigate(`/compliance/enforcement/proceedings?q=${encodeURIComponent(r.lg_case_no ?? r.referral_number)}`)
                      }
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open proceedings
                    </Button>
                  )}
                  {canOpenLegal && r.legal_case_id && (
                    <Button size="sm" variant="outline" onClick={() => navigate(`/legal/cases/${r.legal_case_id}`)}>
                      <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open Legal matter
                    </Button>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="items" className="m-0">
                {(data?.items?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No individual referred items were recorded on this referral.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {data!.items.map((it: any) => (
                      <div key={it.id} className="rounded-md border p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{it.case_number ?? it.case_type ?? 'Referred item'}</span>
                          <span className="font-semibold">{amount(it.amount)}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {it.period_from ?? '—'} – {it.period_to ?? '—'} · Principal {amount(it.principal)} · Penalty{' '}
                          {amount(it.penalty)} · Interest {amount(it.interest)}
                        </div>
                        {it.notes && <div className="text-xs mt-1">{it.notes}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="timeline" className="m-0">
                {(data?.timeline?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">No recorded events for this referral.</p>
                ) : (
                  <ol className="relative border-l pl-4 space-y-4">
                    {data!.timeline.map((e: EscalationTimelineEvent, i) => (
                      <li key={`${e.code}-${i}`} className="space-y-0.5">
                        <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-primary" />
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{e.label}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${SOURCE_TONE[e.source] ?? ''}`}>
                            {e.source === 'LEGAL' ? 'Legal' : 'Compliance'}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatAuditDateTime(e.at)}
                          {e.actor ? ` · ${e.actor}` : ''}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </TabsContent>
            </ScrollArea>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
