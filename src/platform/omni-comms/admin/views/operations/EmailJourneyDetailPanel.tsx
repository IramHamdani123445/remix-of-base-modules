/**
 * Omni-Comms Activity — Email journey detail panel (read-only).
 *
 * Opened via the `?email=<message id>` query parameter so an individual Email
 * is linkable without adding a permanent route. Shows the full timestamped
 * audit trail, provider attempt history and delivery callback history for one
 * Email. Recipient addresses arrive masked; no Email body, provider payload or
 * credential is ever displayed.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import OmniCommsEmptyState from '../../components/OmniCommsEmptyState';
import { useOmniCommsRpcClient } from '../../hooks/useOmniCommsRpcClient';
import { businessEventLabel } from '@/platform/omni-comms/domain/businessEventLabels';
import {
  emailJourneyStageLabel,
  emailJourneyStageTone,
  getEmailJourneyDetail,
  type EmailJourneyDetail,
} from '@/platform/omni-comms/application/emailJourneyService';

export interface EmailJourneyDetailPanelProps {
  messageId: string | null;
  organizationId: string;
  onClose: () => void;
}

function ts(v: string | null | undefined): string {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString();
  } catch {
    return v;
  }
}

function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 90) return `${s.toFixed(1)} s`;
  const m = s / 60;
  if (m < 90) return `${m.toFixed(1)} min`;
  return `${(m / 60).toFixed(1)} h`;
}

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="space-y-0.5">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-sm">{value ?? '—'}</p>
  </div>
);

export const EmailJourneyDetailPanel: React.FC<EmailJourneyDetailPanelProps> = ({
  messageId,
  organizationId,
  onClose,
}) => {
  const client = useOmniCommsRpcClient();
  const [detail, setDetail] = useState<EmailJourneyDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!messageId) return;
    setLoading(true);
    setError(null);
    try {
      setDetail(await getEmailJourneyDetail(client, { organizationId, messageId }));
    } catch (e: unknown) {
      setDetail(null);
      setError(e instanceof Error ? e.message : 'Unable to load this Email');
    } finally {
      setLoading(false);
    }
  }, [client, organizationId, messageId]);

  useEffect(() => {
    if (messageId) void load();
    else setDetail(null);
  }, [messageId, load]);

  return (
    <Sheet
      open={Boolean(messageId)}
      onOpenChange={(open) => (!open ? onClose() : undefined)}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl"
        data-testid="omni-comms-email-journey-detail"
      >
        <SheetHeader>
          <SheetTitle>
            {detail ? businessEventLabel(detail.event_code ?? '') : 'Email'}
          </SheetTitle>
          <SheetDescription>
            The full journey of one Email, from the business event to the
            delivery outcome.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="mt-4 h-[calc(100vh-9rem)] pr-4">
          {error ? (
            <OmniCommsEmptyState
              variant="error"
              title="Email unavailable"
              description={error}
              actionLabel="Retry"
              onAction={() => void load()}
            />
          ) : loading && !detail ? (
            <OmniCommsEmptyState variant="loading" title="Loading Email…" />
          ) : !detail ? null : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={emailJourneyStageTone(detail.current_stage)}>
                  {emailJourneyStageLabel(detail.current_stage)}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {detail.last_action ?? '—'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Module" value={detail.module_code ?? '—'} />
                <Field
                  label="Business record"
                  value={detail.business_reference ?? detail.entity_id ?? '—'}
                />
                <Field label="Recipient" value={detail.masked_recipient ?? '—'} />
                <Field label="Recipient role" value={detail.recipient_role ?? '—'} />
                <Field
                  label="Template"
                  value={
                    detail.template_name
                      ? `${detail.template_name}${
                          detail.template_version ? ` v${detail.template_version}` : ''
                        }`
                      : '—'
                  }
                />
                <Field label="Sender" value={detail.sender_display ?? '—'} />
                <Field label="Provider" value={detail.provider_name ?? '—'} />
                <Field label="Attempts" value={detail.attempt_count} />
                <Field
                  label="End-to-end time"
                  value={duration(detail.end_to_end_duration_ms)}
                />
                <Field label="Next retry" value={ts(detail.next_attempt_at)} />
              </div>

              <section className="space-y-2" data-testid="omni-comms-email-journey-audit">
                <h3 className="text-sm font-medium">Audit trail</h3>
                {detail.audit.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No recorded steps yet.
                  </p>
                ) : (
                  <ol className="space-y-2 border-l pl-4">
                    {detail.audit.map((a, i) => (
                      <li key={`${a.at}-${i}`} className="text-sm">
                        <span className="text-xs text-muted-foreground">
                          {ts(a.at)} · {a.stage}
                        </span>
                        <p>
                          {a.action}{' '}
                          <span className="text-xs text-muted-foreground">
                            ({a.result})
                          </span>
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section
                className="space-y-2"
                data-testid="omni-comms-email-journey-attempts"
              >
                <h3 className="text-sm font-medium">Provider attempts</h3>
                {detail.attempts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No provider attempt has been made yet.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {detail.attempts.map((a) => (
                      <li key={a.attempt_number} className="text-sm">
                        Attempt {a.attempt_number}: {a.outcome ?? 'unknown'}
                        {a.failure_category ? ` — ${a.failure_category}` : ''}
                        <span className="text-xs text-muted-foreground">
                          {' '}
                          · {ts(a.completed_at ?? a.started_at)} ·{' '}
                          {duration(a.latency_ms)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section
                className="space-y-2"
                data-testid="omni-comms-email-journey-callbacks"
              >
                <h3 className="text-sm font-medium">Delivery callbacks</h3>
                {detail.callbacks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No delivery callback has been received yet.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {detail.callbacks.map((c, i) => (
                      <li key={`${c.at}-${i}`} className="text-sm">
                        {c.event_type}
                        <span className="text-xs text-muted-foreground">
                          {' '}
                          · {ts(c.at)}
                        </span>
                        {c.summary ? (
                          <span className="text-xs text-muted-foreground">
                            {' '}
                            — {c.summary}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section
                className="space-y-2"
                data-testid="omni-comms-email-journey-evidence"
              >
                <h3 className="text-sm font-medium">Record copy (evidence)</h3>
                <p className="text-xs text-muted-foreground">
                  The exact content that was sent is archived with a content
                  fingerprint, so it can be produced later as a record of what
                  the recipient received.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setContentOpen(true)}
                  data-testid="omni-comms-email-journey-evidence-open"
                >
                  View archived copy
                </Button>
              </section>

              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Technical details</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(detail.technical, null, 2)}
                </pre>
              </details>
            </div>
          )}

        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};

export default EmailJourneyDetailPanel;
