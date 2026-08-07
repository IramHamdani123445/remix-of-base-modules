/**
 * BN Risk — signal detail panel.
 *
 * Shows the observation, its business context, linked signals and the full
 * history. Available actions are always taken from the governed
 * `bn_risk_available_actions_v1` query, never inferred in the browser.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { formatAuditDateTime, formatDisplayDate } from '@/lib/dateFormat';
import { riskQueryService } from '@/services/bn/risk/riskQueryService';
import { BnRiskTriageDialog } from './BnRiskTriageDialog';
import { BnRiskLinkSignalsDialog } from './BnRiskLinkSignalsDialog';
import { BnRiskDismissDialog } from './BnRiskDismissDialog';

interface Props {
  signalId: string | null;
  onOpenChange: (open: boolean) => void;
  actionsEnabled: boolean;
}

export const BnRiskSignalDetailPanel: React.FC<Props> = ({
  signalId, onOpenChange, actionsEnabled,
}) => {
  const [triageOpen, setTriageOpen] = React.useState(false);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [dismissOpen, setDismissOpen] = React.useState(false);

  const detail = useQuery({
    queryKey: ['bn-risk-signal-detail', signalId],
    queryFn: async () => {
      const result = await riskQueryService.signalDetail(signalId as string);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
    enabled: !!signalId,
  });

  const actions = useQuery({
    queryKey: ['bn-risk-signal-actions', signalId],
    queryFn: async () => {
      const result = await riskQueryService.availableActions(signalId as string);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
    enabled: !!signalId,
  });

  const d = detail.data;
  const rowVersion = d?.summary.row_version ?? 0;

  return (
    <Sheet open={!!signalId} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {detail.isLoading && (
          <div className="space-y-3 pt-8">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {detail.isError && (
          <Alert variant="destructive" className="mt-8">
            <AlertTitle>Signal unavailable</AlertTitle>
            <AlertDescription>
              This signal could not be loaded. You may not have permission to view it.
            </AlertDescription>
          </Alert>
        )}

        {d && (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                {d.summary.signal_reference}
                <Badge variant="secondary">{d.summary.status_label}</Badge>
                {d.summary.priority_label && (
                  <Badge variant="outline">{d.summary.priority_label}</Badge>
                )}
              </SheetTitle>
              <SheetDescription>{d.summary.summary}</SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-4">
              {actions.data?.notice && (
                <Alert><AlertDescription>{actions.data.notice}</AlertDescription></Alert>
              )}

              <div className="flex flex-wrap gap-2">
                {(actions.data?.actions ?? []).map((a) => (
                  <Button
                    key={a.action}
                    size="sm"
                    variant={a.action === 'DISMISS' ? 'outline' : 'default'}
                    disabled={!actionsEnabled}
                    onClick={() => {
                      if (a.action === 'TRIAGE') setTriageOpen(true);
                      if (a.action === 'LINK') setLinkOpen(true);
                      if (a.action === 'DISMISS') setDismissOpen(true);
                    }}
                  >
                    {a.label}
                  </Button>
                ))}
                {(actions.data?.actions?.length ?? 0) === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No actions are available to you for this signal.
                  </p>
                )}
              </div>

              <Card>
                <CardHeader><CardTitle className="text-base">What was observed</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p>{d.source.observation}</p>
                  <Separator />
                  <dl className="grid grid-cols-2 gap-2">
                    <dt className="text-muted-foreground">Raised by</dt>
                    <dd>{d.source.source_module_label}</dd>
                    <dt className="text-muted-foreground">Source record</dt>
                    <dd>{d.source.source_reference ?? '—'}</dd>
                    <dt className="text-muted-foreground">Category</dt>
                    <dd>{d.summary.category_label}</dd>
                    <dt className="text-muted-foreground">Detected</dt>
                    <dd>{formatAuditDateTime(d.summary.detected_at)}</dd>
                    {d.summary.observed_on && (
                      <>
                        <dt className="text-muted-foreground">Observed on</dt>
                        <dd>{formatDisplayDate(d.summary.observed_on)}</dd>
                      </>
                    )}
                  </dl>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Subject and context</CardTitle></CardHeader>
                <CardContent className="text-sm">
                  <dl className="grid grid-cols-2 gap-2">
                    <dt className="text-muted-foreground">Person</dt>
                    <dd>{d.summary.person_name ?? 'Not linked to a person'}</dd>
                    <dt className="text-muted-foreground">Identifier</dt>
                    <dd>{d.summary.person_masked_identifier ?? '—'}</dd>
                    <dt className="text-muted-foreground">Claim</dt>
                    <dd>{d.context.claim_reference ?? '—'}</dd>
                    <dt className="text-muted-foreground">Award</dt>
                    <dd>{d.context.award_reference ?? '—'}</dd>
                    <dt className="text-muted-foreground">Means-test assessment</dt>
                    <dd>{d.context.means_assessment_reference ?? '—'}</dd>
                    <dt className="text-muted-foreground">Evidence</dt>
                    <dd>{d.context.evidence_reference ?? '—'}</dd>
                  </dl>
                </CardContent>
              </Card>

              {d.triage.triaged_at && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Triage</CardTitle></CardHeader>
                  <CardContent className="text-sm">
                    <dl className="grid grid-cols-2 gap-2">
                      <dt className="text-muted-foreground">Priority</dt>
                      <dd>{d.summary.priority_label ?? '—'}</dd>
                      <dt className="text-muted-foreground">Classification</dt>
                      <dd>{d.triage.classification_code ?? '—'}</dd>
                      <dt className="text-muted-foreground">Next step</dt>
                      <dd>{d.triage.route_code ?? '—'}</dd>
                      <dt className="text-muted-foreground">Triaged</dt>
                      <dd>{formatAuditDateTime(d.triage.triaged_at)}</dd>
                    </dl>
                    {d.triage.notes && <p className="mt-2">{d.triage.notes}</p>}
                  </CardContent>
                </Card>
              )}

              {d.dismissal.dismissed_at && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Dismissal</CardTitle></CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <p>{d.dismissal.justification}</p>
                    <p className="text-muted-foreground">
                      Dismissed {formatAuditDateTime(d.dismissal.dismissed_at)}
                    </p>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Linked signals ({d.related_signals.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {d.related_signals.length === 0 && (
                    <p className="text-muted-foreground">No linked signals.</p>
                  )}
                  {d.related_signals.map((r) => (
                    <div key={r.signal_id} className="flex items-center justify-between gap-2">
                      <span>
                        <span className="font-medium">{r.signal_reference}</span>
                        <span className="block text-muted-foreground">{r.summary}</span>
                      </span>
                      <Badge variant="secondary">{r.status_label}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {d.notes.length > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {d.notes.map((n) => (
                      <div key={n.note_id}>
                        {n.note_kind === 'RESTRICTED' && (
                          <Badge variant="destructive" className="mb-1">Restricted</Badge>
                        )}
                        <p>{n.body}</p>
                        <p className="text-muted-foreground">{formatAuditDateTime(n.created_at)}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader><CardTitle className="text-base">History</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {d.history.map((h, index) => (
                    <div key={`${h.event_code}-${index}`} className="border-l-2 pl-3">
                      <p className="font-medium">{h.event_code.replace(/_/g, ' ').toLowerCase()}</p>
                      <p className="text-muted-foreground">
                        {formatAuditDateTime(h.created_at)}
                        {h.to_status ? ` — ${h.to_status}` : ''}
                      </p>
                      {h.justification && <p>{h.justification}</p>}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <BnRiskTriageDialog
              open={triageOpen}
              onOpenChange={setTriageOpen}
              signalId={d.summary.signal_id}
              signalReference={d.summary.signal_reference}
              rowVersion={rowVersion}
              onCompleted={() => { detail.refetch(); actions.refetch(); }}
            />
            <BnRiskLinkSignalsDialog
              open={linkOpen}
              onOpenChange={setLinkOpen}
              signalId={d.summary.signal_id}
              signalReference={d.summary.signal_reference}
              rowVersion={rowVersion}
              onCompleted={() => { detail.refetch(); actions.refetch(); }}
            />
            <BnRiskDismissDialog
              open={dismissOpen}
              onOpenChange={setDismissOpen}
              signalId={d.summary.signal_id}
              signalReference={d.summary.signal_reference}
              rowVersion={rowVersion}
              onCompleted={() => { detail.refetch(); actions.refetch(); }}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};
