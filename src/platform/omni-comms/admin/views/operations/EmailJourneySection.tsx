/**
 * Omni-Comms Activity — Email journeys (read-only).
 *
 * One row per Email. The pipeline metrics and the table are driven by the
 * SAME server-side filters, so the counts always describe exactly the rows on
 * screen. Nothing on this surface mutates state: there is no retry, resend,
 * cancel or "send now" action — production delivery is automatic.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import OmniCommsEmptyState from '../../components/OmniCommsEmptyState';
import { useOmniCommsRpcClient } from '../../hooks/useOmniCommsRpcClient';
import { businessEventLabel } from '@/platform/omni-comms/domain/businessEventLabels';
import {
  EMAIL_JOURNEY_PAGE_SIZE_DEFAULT,
  EMAIL_JOURNEY_STAGES,
  emailJourneyStageLabel,
  emailJourneyStageTone,
  getEmailJourneySummary,
  listEmailJourneys,
  type EmailJourneyPage,
  type EmailJourneySummary,
} from '@/platform/omni-comms/application/emailJourneyService';

export interface EmailJourneySectionProps {
  organizationId: string | null;
  /** Opens the per-Email journey panel. */
  onOpenEmail: (messageId: string) => void;
}

const RANGES = [
  { id: '24h', label: 'Last 24 hours', hours: 24 },
  { id: '7d', label: 'Last 7 days', hours: 24 * 7 },
  { id: '30d', label: 'Last 30 days', hours: 24 * 30 },
  { id: 'all', label: 'All time', hours: null as number | null },
] as const;

type RangeId = (typeof RANGES)[number]['id'];

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

const Metric: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({
  label,
  value,
  hint,
}) => (
  <div className="rounded-md border p-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-lg font-semibold">{value}</p>
    {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
  </div>
);

export const EmailJourneySection: React.FC<EmailJourneySectionProps> = ({
  organizationId,
  onOpenEmail,
}) => {
  const client = useOmniCommsRpcClient();
  const [page, setPage] = useState<EmailJourneyPage | null>(null);
  const [summary, setSummary] = useState<EmailJourneySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [range, setRange] = useState<RangeId>('7d');
  const [stage, setStage] = useState<string>('all');
  const [moduleCode, setModuleCode] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const from = useMemo(() => {
    const r = RANGES.find((x) => x.id === range);
    if (!r || r.hours === null) return null;
    return new Date(Date.now() - r.hours * 3600_000).toISOString();
  }, [range]);

  const filters = useMemo(
    () => ({
      organizationId: organizationId ?? '',
      stage: stage === 'all' ? null : stage,
      moduleCode: moduleCode === 'all' ? null : moduleCode,
      from,
      search: debounced || null,
    }),
    [organizationId, stage, moduleCode, from, debounced],
  );

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const [p, s] = await Promise.all([
        listEmailJourneys(client, {
          ...filters,
          organizationId,
          limit: EMAIL_JOURNEY_PAGE_SIZE_DEFAULT,
          offset,
        }),
        getEmailJourneySummary(client, { ...filters, organizationId }),
      ]);
      setPage(p);
      setSummary(s);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unable to load Email activity');
    } finally {
      setLoading(false);
    }
  }, [client, organizationId, filters, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any filter change restarts pagination.
  useEffect(() => {
    setOffset(0);
  }, [range, stage, moduleCode, debounced]);

  const rows = page?.items ?? [];
  const modules = summary?.modules ?? [];

  if (!organizationId) return null;

  return (
    <Card data-testid="omni-comms-email-journeys">
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-base">Email journeys</CardTitle>
          <p className="text-xs text-muted-foreground">
            One row per Email, from the business event through to the delivery
            outcome. Observational only — delivery runs automatically.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh Email journeys"
          data-testid="omni-comms-email-journeys-refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="omni-comms-email-journey-filters"
        >
          <Select value={range} onValueChange={(v) => setRange(v as RangeId)}>
            <SelectTrigger className="w-[170px]" aria-label="Time range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={stage} onValueChange={setStage}>
            <SelectTrigger className="w-[190px]" aria-label="Stage">
              <SelectValue placeholder="All stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {EMAIL_JOURNEY_STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  {emailJourneyStageLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={moduleCode} onValueChange={setModuleCode}>
            <SelectTrigger className="w-[190px]" aria-label="Module">
              <SelectValue placeholder="All modules" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modules</SelectItem>
              {modules.map((m) => (
                <SelectItem key={m.module_code} value={m.module_code}>
                  {m.module_code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            className="w-[240px]"
            placeholder="Search reference, event or recipient"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search Email journeys"
          />
        </div>

        <div
          className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6"
          data-testid="omni-comms-email-journey-pipeline"
        >
          <Metric label="Initiated" value={summary?.initiated ?? '—'} />
          <Metric label="Prepared" value={summary?.prepared ?? '—'} />
          <Metric label="Queued" value={summary?.queued ?? '—'} />
          <Metric label="Picked up" value={summary?.picked_up ?? '—'} />
          <Metric
            label="Provider accepted"
            value={summary?.provider_accepted ?? '—'}
          />
          <Metric
            label="Delivered"
            value={summary?.delivered ?? '—'}
            hint={
              summary?.delivery_rate !== null && summary?.delivery_rate !== undefined
                ? `${summary.delivery_rate}% of initiated`
                : undefined
            }
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="Event → prepared"
            value={duration(summary?.avg_event_to_prepared_ms)}
            hint="Average"
          />
          <Metric
            label="Queue → accepted"
            value={duration(summary?.avg_queue_to_accepted_ms)}
            hint="Average"
          />
          <Metric
            label="Accepted → delivered"
            value={duration(summary?.avg_accepted_to_delivered_ms)}
            hint="Average"
          />
          <Metric
            label="Needs attention"
            value={summary?.needs_attention ?? '—'}
            hint={
              summary?.oldest_waiting_at
                ? `Oldest waiting since ${ts(summary.oldest_waiting_at)}`
                : 'Nothing waiting'
            }
          />
        </div>

        {error ? (
          <OmniCommsEmptyState
            variant="error"
            title="Email activity unavailable"
            description={error}
            actionLabel="Retry"
            onAction={() => void load()}
          />
        ) : loading && !page ? (
          <OmniCommsEmptyState variant="loading" title="Loading Email activity…" />
        ) : rows.length === 0 ? (
          <OmniCommsEmptyState
            title="No Emails"
            description="No Email matches the current filters for this organisation."
          />
        ) : (
          <>
            <Table data-testid="omni-comms-email-journey-table">
              <caption className="caption-bottom pt-3 text-left text-xs text-muted-foreground">
                Recipient addresses are masked. Select a row to open the full
                journey, attempt history and delivery callbacks.
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead>Event time</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Business event</TableHead>
                  <TableHead>Business record</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Last action</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={r.message_id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open Email ${r.business_reference ?? r.message_id}`}
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onOpenEmail(r.message_id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onOpenEmail(r.message_id);
                      }
                    }}
                    data-testid={`omni-comms-email-journey-row-${r.message_id}`}
                  >
                    <TableCell className="whitespace-nowrap text-xs">
                      {ts(r.event_recorded_at)}
                    </TableCell>
                    <TableCell className="text-xs">{r.module_code ?? '—'}</TableCell>
                    <TableCell className="text-xs">
                      {r.event_code ? businessEventLabel(r.event_code) : '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.business_reference ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.masked_recipient ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge variant={emailJourneyStageTone(r.current_stage)}>
                        {emailJourneyStageLabel(r.current_stage)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{r.last_action ?? '—'}</TableCell>
                    <TableCell className="text-right text-xs">
                      {r.attempt_count}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenEmail(r.message_id);
                        }}
                        data-testid={`omni-comms-email-journey-view-${r.message_id}`}
                        aria-label={`View Email ${r.business_reference ?? r.message_id}`}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {page
                  ? `Showing ${page.total === 0 ? 0 : page.offset + 1}–${Math.min(
                      page.offset + page.limit,
                      page.total,
                    )} of ${page.total}`
                  : ''}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={offset === 0 || loading}
                  onClick={() =>
                    setOffset(Math.max(0, offset - EMAIL_JOURNEY_PAGE_SIZE_DEFAULT))
                  }
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    loading || !page || page.offset + page.limit >= page.total
                  }
                  onClick={() => setOffset(offset + EMAIL_JOURNEY_PAGE_SIZE_DEFAULT)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default EmailJourneySection;
