/**
 * Omni-Comms Activity — business-event detail panel (read-only).
 *
 * Opened via the `?event=<id>` query parameter so the record is linkable
 * without adding a permanent route. The panel answers, in business language:
 * what happened, when, to whom (masked), and what became of it. Raw codes,
 * identifiers and blockers live under Technical details only.
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
  businessEventStatusLabel,
  businessEventStatusTone,
  getBusinessEventActivityDetail,
  type BusinessEventActivityDetail,
} from '@/platform/omni-comms/application/businessEventActivityService';

export interface BusinessEventDetailPanelProps {
  eventId: string | null;
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

export const BusinessEventDetailPanel: React.FC<BusinessEventDetailPanelProps> = ({
  eventId,
  organizationId,
  onClose,
}) => {
  const client = useOmniCommsRpcClient();
  const [detail, setDetail] = useState<BusinessEventActivityDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    try {
      setDetail(
        await getBusinessEventActivityDetail(client, { organizationId, eventId }),
      );
    } catch (e: unknown) {
      setDetail(null);
      setError(e instanceof Error ? e.message : 'Unable to load this business event');
    } finally {
      setLoading(false);
    }
  }, [client, organizationId, eventId]);

  useEffect(() => {
    if (eventId) void load();
    else setDetail(null);
  }, [eventId, load]);

  return (
    <Sheet open={Boolean(eventId)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl"
        data-testid="omni-comms-business-event-detail"
      >
        <SheetHeader>
          <SheetTitle>
            {detail ? businessEventLabel(detail.event_code) : 'Business event'}
          </SheetTitle>
          <SheetDescription>
            What the organisation recorded, and what Omni-Comms did about it.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="mt-4 h-[calc(100vh-9rem)] pr-4">
          {error ? (
            <OmniCommsEmptyState
              variant="error"
              title="Business event unavailable"
              description={error}
              actionLabel="Retry"
              onAction={() => void load()}
            />
          ) : loading && !detail ? (
            <OmniCommsEmptyState variant="loading" title="Loading business event…" />
          ) : !detail ? null : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={businessEventStatusTone(detail.status)}>
                  {businessEventStatusLabel(detail.status)}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {detail.module_code} · {ts(detail.occurred_at)}
                </span>
              </div>

              {detail.entity_id ? (
                <p className="text-sm text-muted-foreground">
                  Business record: {detail.entity_type ?? 'record'} {detail.entity_id}
                </p>
              ) : null}

              <section className="space-y-3" data-testid="omni-comms-business-event-timeline">
                <h3 className="text-sm font-medium">What happened</h3>
                {detail.timeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing has happened beyond recording the event yet.
                  </p>
                ) : (
                  <ol className="space-y-3 border-l pl-4">
                    {detail.timeline.map((entry, i) => (
                      <li key={`${entry.at}-${i}`} className="space-y-0.5">
                        <p className="text-sm font-medium">{entry.label}</p>
                        <p className="text-xs text-muted-foreground">{entry.detail}</p>
                        <p className="text-xs text-muted-foreground">{ts(entry.at)}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-medium">Messages</h3>
                {!detail.has_communication ? (
                  <p className="text-sm text-muted-foreground">
                    No communication has been created for this event.
                  </p>
                ) : detail.messages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    A communication was created but no message has been prepared yet.
                  </p>
                ) : (
                  <div className="divide-y rounded border">
                    {detail.messages.map((m) => (
                      <div key={m.id} className="flex items-center justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm">
                            {m.recipient ?? 'Recipient hidden'}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {m.channel} · {m.recipient_role ?? 'recipient'} ·{' '}
                            {ts(m.prepared_at)}
                          </p>
                        </div>
                        <Badge variant="outline">{m.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <details data-testid="omni-comms-business-event-technical">
                <summary className="cursor-pointer text-sm font-medium">
                  Technical details
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-[11px]">
                  {JSON.stringify(detail.technical ?? null, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};

export default BusinessEventDetailPanel;
