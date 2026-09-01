import React from 'react';
import { Link } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ExternalLink, Gavel, RefreshCw } from 'lucide-react';
import { formatDate, formatDateTime } from '@/lib/culture/culture';
import { formatXCD } from '@/utils/formatCurrency';
import { useLegalProceedingDetail } from '@/hooks/compliance/useLegalProceedingRegister';

interface Props {
  rowKey: string | null;
  onClose: () => void;
  canOpenLegal: boolean;
}

const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="space-y-0.5">
    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <div className="text-sm font-medium text-foreground break-words">{value ?? '—'}</div>
  </div>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-2">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
    {children}
  </div>
);

const money = (v: unknown) =>
  v === null || v === undefined ? '—' : formatXCD(Number(v));

/**
 * Compliance-side proceeding detail. Everything here is READ-ONLY: stage,
 * court, hearings, orders and enforcement are owned by the Legal module and
 * arrive through the register projection.
 */
export function ProceedingDetailDialog({ rowKey, onClose, canOpenLegal }: Props) {
  const { data, isLoading, isError, error, refetch } = useLegalProceedingDetail(rowKey);
  const p = data?.proceeding;
  const canMoney = data?.can_view_financials ?? false;

  return (
    <Dialog open={Boolean(rowKey)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gavel className="h-4 w-4 text-primary" />
            Legal Proceeding {p?.proceeding_no ?? ''}
          </DialogTitle>
          <DialogDescription>
            Compliance-side tracking view. Stage, court, hearing, judgment and enforcement data are
            maintained by the Legal module and are read-only here.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <div>
              <p className="font-medium">Unable to load this proceeding</p>
              <p className="text-sm text-muted-foreground">{error?.message}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-1 h-4 w-4" /> Retry
            </Button>
          </div>
        )}

        {p && (
          <div className="space-y-5">
            {p.is_legacy && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                <span>
                  Legacy record — captured on the Compliance side before Legal integration. It is not
                  linked to a Legal case, so hearing, judgment and recovery data are unavailable.
                </span>
              </div>
            )}

            <Section title="Identity">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <Field label="Proceeding / Case No." value={p.proceeding_no} />
                <Field
                  label="Employer"
                  value={
                    p.employer_id ? (
                      <Link
                        className="text-primary hover:underline"
                        to={`/compliance/field/employer-360/${encodeURIComponent(p.employer_id)}`}
                      >
                        {p.employer_name ?? p.employer_id}
                      </Link>
                    ) : (
                      p.employer_name
                    )
                  }
                />
                <Field label="Registration No." value={p.employer_id} />
                <Field
                  label="Compliance Case"
                  value={
                    p.ce_case_id ? (
                      <Link className="text-primary hover:underline" to={`/compliance/cases/${p.ce_case_id}`}>
                        {p.ce_case_number ?? 'Open case'}
                      </Link>
                    ) : (
                      '—'
                    )
                  }
                />
                <Field
                  label="Legal Referral"
                  value={
                    p.referral_number ? (
                      <Link
                        className="text-primary hover:underline"
                        to={`/compliance/enforcement/legal-queue?q=${encodeURIComponent(p.referral_number)}`}
                      >
                        {p.referral_number}
                      </Link>
                    ) : (
                      '—'
                    )
                  }
                />
                <Field label="Legal Intake No." value={p.lg_intake_no} />
                <Field
                  label="Legal Case No."
                  value={
                    p.lg_case_id && canOpenLegal ? (
                      <Link className="text-primary hover:underline" to={`/legal/cases/${p.lg_case_id}`}>
                        {p.lg_case_no} <ExternalLink className="inline h-3 w-3" />
                      </Link>
                    ) : (
                      p.lg_case_no
                    )
                  }
                />
                <Field label="Court Case No." value={p.court_case_no} />
                <Field label="Referral Status" value={p.referral_status} />
              </div>
            </Section>

            <Separator />

            <Section title="Proceeding">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Field label="Stage" value={<Badge variant="outline">{p.stage_label}</Badge>} />
                <Field label="Court" value={p.court_name} />
                <Field label="Filed Date" value={p.filed_date ? formatDate(p.filed_date) : '—'} />
                <Field label="Legal Officer" value={p.legal_officer} />
                <Field
                  label="Next Hearing"
                  value={p.next_hearing_date ? formatDate(p.next_hearing_date) : 'None scheduled'}
                />
                <Field label="Next Action" value={p.next_action} />
                <Field
                  label="Next Action Due"
                  value={p.next_action_due ? formatDate(p.next_action_due) : '—'}
                />
                <Field
                  label="Last Legal Update"
                  value={p.last_legal_update ? formatDateTime(p.last_legal_update) : '—'}
                />
              </div>
              {p.next_hearing_source === 'CASE_CACHE' && (
                <p className="text-xs text-muted-foreground">
                  Next hearing shown from the Legal case summary field (no hearing record found) — it may
                  be a cached value.
                </p>
              )}
            </Section>

            {canMoney && (
              <>
                <Separator />
                <Section title="Financial">
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <Field label="Referred Amount" value={money(p.referred_amount)} />
                    <Field label="Judgment Amount" value={money(p.judgment_amount)} />
                    <Field label="Recovered" value={money(p.recovered_amount)} />
                    <Field label="Outstanding Exposure" value={money(p.outstanding_amount)} />
                  </div>
                </Section>
              </>
            )}

            <Separator />

            <Section title="Outcome & Recovery">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Field label="Outcome" value={<Badge variant="outline">{p.outcome_label}</Badge>} />
                <Field label="Recovery Status" value={<Badge variant="secondary">{p.recovery_label}</Badge>} />
                <Field label="Enforcement Actions" value={p.enforcement_count} />
                <Field label="Hearings Recorded" value={p.hearing_count} />
              </div>
            </Section>

            {(data?.hearings?.length ?? 0) > 0 && (
              <>
                <Separator />
                <Section title="Hearing History">
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Date</th>
                          <th className="px-3 py-2 text-left font-medium">Stage</th>
                          <th className="px-3 py-2 text-left font-medium">Court</th>
                          <th className="px-3 py-2 text-left font-medium">Status</th>
                          <th className="px-3 py-2 text-left font-medium">Outcome</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data!.hearings.map((h) => (
                          <tr key={h.id} className="border-t">
                            <td className="px-3 py-2">{h.hearing_date ? formatDate(h.hearing_date) : '—'}</td>
                            <td className="px-3 py-2">{h.hearing_stage ?? '—'}</td>
                            <td className="px-3 py-2">{h.court_name ?? '—'}</td>
                            <td className="px-3 py-2">{h.status ?? '—'}</td>
                            <td className="px-3 py-2">{h.outcome_code ?? h.outcome_notes ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              </>
            )}

            {canMoney && (data?.orders?.length ?? 0) > 0 && (
              <>
                <Separator />
                <Section title="Judgments & Orders">
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Order</th>
                          <th className="px-3 py-2 text-left font-medium">Type</th>
                          <th className="px-3 py-2 text-left font-medium">Issued</th>
                          <th className="px-3 py-2 text-right font-medium">Amount</th>
                          <th className="px-3 py-2 text-right font-medium">Costs / Interest</th>
                          <th className="px-3 py-2 text-left font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data!.orders.map((o) => (
                          <tr key={o.id} className="border-t">
                            <td className="px-3 py-2 font-mono">{o.order_no ?? '—'}</td>
                            <td className="px-3 py-2">{o.order_type_code ?? '—'}</td>
                            <td className="px-3 py-2">{o.issued_date ? formatDate(o.issued_date) : '—'}</td>
                            <td className="px-3 py-2 text-right">{money(o.ordered_amount)}</td>
                            <td className="px-3 py-2 text-right">
                              {money(Number(o.costs_awarded || 0) + Number(o.interest_awarded || 0))}
                            </td>
                            <td className="px-3 py-2">{o.status ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              </>
            )}

            {(data?.enforcement?.length ?? 0) > 0 && (
              <>
                <Separator />
                <Section title="Enforcement & Recovery">
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Action</th>
                          <th className="px-3 py-2 text-left font-medium">Type</th>
                          <th className="px-3 py-2 text-left font-medium">Executed</th>
                          <th className="px-3 py-2 text-right font-medium">Targeted</th>
                          <th className="px-3 py-2 text-right font-medium">Recovered</th>
                          <th className="px-3 py-2 text-left font-medium">Next Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data!.enforcement.map((e) => (
                          <tr key={e.id} className="border-t">
                            <td className="px-3 py-2 font-mono">{e.enforcement_no ?? '—'}</td>
                            <td className="px-3 py-2">{e.enforcement_type ?? '—'}</td>
                            <td className="px-3 py-2">
                              {e.execution_date ? formatDate(e.execution_date) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right">{money(e.amount_targeted)}</td>
                            <td className="px-3 py-2 text-right">{money(e.amount_recovered)}</td>
                            <td className="px-3 py-2">{e.next_action ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              </>
            )}

            {(data?.history?.length ?? 0) > 0 && (
              <>
                <Separator />
                <Section title="Lifecycle History">
                  <ol className="space-y-2">
                    {data!.history.map((h, i) => (
                      <li key={i} className="flex gap-3 text-sm">
                        <span className="w-32 shrink-0 text-xs text-muted-foreground">
                          {h.at ? formatDate(h.at) : '—'}
                        </span>
                        <span className="flex-1">
                          <Badge variant="outline" className="mr-2 text-[10px]">
                            {h.type}
                          </Badge>
                          {h.label}
                          {h.notes && <span className="ml-2 text-muted-foreground">— {h.notes}</span>}
                        </span>
                        <span className="text-xs text-muted-foreground">{h.actor ?? h.source}</span>
                      </li>
                    ))}
                  </ol>
                </Section>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ProceedingDetailDialog;
