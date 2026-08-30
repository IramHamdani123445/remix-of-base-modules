/**
 * Omni-Comms — ACTIVITY & AUTOMATION (the canonical operations surface).
 *
 * Route: /admin/omnichannel-communications/operations
 *
 * This is the normal destination reached from the main Omni-Comms menu. It
 * answers, in this order:
 *   1. Are the automatic workers healthy? (Automation, at the very top)
 *   2. What business events happened, and what became of them?
 *   3. (Technical details) the full request register for support engineers.
 *
 * Activity is BUSINESS-EVENT-FIRST. Every row is a business fact the
 * organisation recorded, visible from the moment it was recorded — before any
 * communication request, message, dispatch job, provider attempt or delivery
 * evidence exists. The internal request register is technical evidence, not
 * the activity model.
 *
 * Scope is the top-level organisation workspace. Department is NEVER used to
 * narrow this page — it only appears as historical evidence inside a record.
 *
 * Everything here is observational. No retry, resend, cancel, suppress, "run
 * scheduler now" or dispatch action exists on this surface: production
 * delivery is automatic.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import OmniCommsEmptyState from "../components/OmniCommsEmptyState";
import { useOmniCommsScope } from "../../context/OmniCommsScopeContext";
import { useOmniCommsRpcClient } from "../hooks/useOmniCommsRpcClient";
import { useAutomationStatus } from "../hooks/useAutomationStatus";
import AutomationSection from "./channels/simple/AutomationSection";
import {
  getOpsAttentionSummary,
  getOpsSummary,

  listOpsRequests,
  OPS_PAGE_SIZE_DEFAULT,
  OPS_REQUEST_MODES,
  OPS_REQUEST_STATUSES,
  type OpsRequestPage,
  type OpsSummary,
  type RequestMode,
  type RequestStatus,
} from "@/platform/omni-comms/application/operationsService";
import {
  needsAttentionCount,
} from "@/platform/omni-comms/application/activityStatusLabels";
import {
  BUSINESS_EVENT_PAGE_SIZE_DEFAULT,
  businessEventStatusLabel,
  businessEventStatusTone,
  listBusinessEventActivity,
  type BusinessEventActivityPage,
} from "@/platform/omni-comms/application/businessEventActivityService";
import { businessEventLabel } from "@/platform/omni-comms/domain/businessEventLabels";
import OperationsSummaryCards from "./operations/OperationsSummaryCards";
import RequestDetailPanel from "./operations/RequestDetailPanel";
import BusinessEventDetailPanel from "./operations/BusinessEventDetailPanel";
import EmailJourneySection from "./operations/EmailJourneySection";
import PrintProductionQueue from "./operations/PrintProductionQueue";
import PrinterStatusPanel from "./operations/PrinterStatusPanel";
import PrintAuditPanel from "./operations/PrintAuditPanel";
import EmailJourneyDetailPanel from "./operations/EmailJourneyDetailPanel";
import ChannelActivityCards from "./operations/ChannelActivityCards";
import WorkerHealthPanel from "./operations/WorkerHealthPanel";

/** Normal-operator filter chips, expressed in business-event vocabulary. */
const EVENT_FILTERS = [
  { id: "all", label: "All" },
  { id: "waiting", label: "Waiting" },
  { id: "sending", label: "Sending" },
  { id: "delivered", label: "Delivered" },
  { id: "needs_attention", label: "Needs attention" },
  { id: "historical", label: "Historical (not sent)" },
] as const;

type EventFilterId = (typeof EVENT_FILTERS)[number]["id"];

/**
 * "Waiting" means work that is still expected to go out. A permanently held
 * historical record (recorded before delivery was switched on) is audit
 * evidence, never pending work, so it has its own filter and is deliberately
 * excluded from "Waiting".
 */
const EVENT_FILTER_STATUSES: Record<EventFilterId, readonly string[] | null> = {
  all: null,
  waiting: ["event_recorded", "preparing_communication", "waiting_to_send", "retrying"],
  sending: ["sending", "provider_accepted"],
  delivered: ["delivered"],
  needs_attention: ["needs_configuration", "needs_review", "failed"],
  historical: ["not_sent_historical"],
};



const ALL = "__all__";

/** Registered business caller modules (mirrors omni_comms_caller_module_registry). */
const OPS_CALLER_MODULES = [
  "EMPLOYER_REGISTRATION",
  "BENEFITS",
  "COMPLIANCE",
  "FINANCE",
  "INSURED_PERSON",
  "LEGAL",
  "OMNI_COMMS_DIRECT",
  "OMNI_COMMS_ADMIN_DRY_RUN",
  "PLATFORM",
] as const;

/** Quick relative windows offered instead of a free-form date picker. */
const RANGES = [
  { id: "24h", label: "Last 24 hours", hours: 24 },
  { id: "7d", label: "Last 7 days", hours: 24 * 7 },
  { id: "30d", label: "Last 30 days", hours: 24 * 30 },
  { id: "all", label: "All time", hours: null },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

/** Explicit timezone rendering — operators must never guess the zone. */
function ts(v: string | null, zone: "local" | "utc"): string {
  if (!v) return "—";
  try {
    const d = new Date(v);
    if (zone === "utc") {
      return `${d.toISOString().replace("T", " ").slice(0, 19)} UTC`;
    }
    return d.toLocaleString(undefined, { timeZoneName: "short" });
  } catch {
    return v;
  }
}

export const OmniCommsOperationsPage: React.FC = () => {
  // Top-level organisation workspace only. departmentId is deliberately NULL.
  const { organizationId, loading: tenantLoading } = useOmniCommsScope();
  const client = useOmniCommsRpcClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [summary, setSummary] = useState<OpsSummary | null>(null);
  const [holdBreakdown, setHoldBreakdown] = useState<OmniCommsAttentionSummary | null>(null);
  const [page, setPage] = useState<OpsRequestPage | null>(null);
  const [events, setEvents] = useState<BusinessEventActivityPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);


  const automation = useAutomationStatus(organizationId, true);

  const [activityFilter, setActivityFilter] = useState<EventFilterId>("all");
  const [mode, setMode] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [range, setRange] = useState<RangeId>("30d");
  const [zone, setZone] = useState<"local" | "utc">("local");
  const [callerModule, setCallerModule] = useState<string>(
    searchParams.get("module") ?? ALL,
  );
  const [search, setSearch] = useState(searchParams.get("event") ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(
    searchParams.get("event") ?? "",
  );
  const [offset, setOffset] = useState(0);

  const filtersActive =
    mode !== ALL ||
    status !== ALL ||
    callerModule !== ALL ||
    activityFilter !== "all" ||
    range !== "30d" ||
    search.trim().length > 0;

  const clearFilters = () => {
    setMode(ALL);
    setStatus(ALL);
    setCallerModule(ALL);
    setActivityFilter("all");
    setRange("30d");
    setSearch("");
  };

  const selectedRequestId = searchParams.get("request");
  const selectedEventId = searchParams.get("businessEvent");
  const selectedEmailId = searchParams.get("email");

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(t);
  }, [search]);

  const dateFrom = useMemo(() => {
    const hours = RANGES.find((r) => r.id === range)?.hours ?? null;
    if (hours === null) return null;
    return new Date(Date.now() - hours * 3600_000).toISOString();
  }, [range]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const [s, p, ev, holds] = await Promise.all([
        getOpsSummary(client, { organizationId, departmentId: null }),
        listOpsRequests(client, {
          organizationId,
          departmentId: null,
          mode: mode === ALL ? null : (mode as RequestMode),
          status: status === ALL ? null : (status as RequestStatus),
          dateFrom,
          callerModuleCode: callerModule === ALL ? null : callerModule,
          search: debouncedSearch.length > 0 ? debouncedSearch : null,
          limit: OPS_PAGE_SIZE_DEFAULT,
          offset,
        }),
        listBusinessEventActivity(client, {
          organizationId,
          moduleCode: callerModule === ALL ? null : callerModule,
          search: debouncedSearch.length > 0 ? debouncedSearch : null,
          limit: BUSINESS_EVENT_PAGE_SIZE_DEFAULT,
          offset,
        }),
        // The hold breakdown is supplementary: it must never fail the page.
        getOpsAttentionSummary(client, { organizationId, departmentId: null }).catch(
          () => null,
        ),
      ]);
      setSummary(s);
      setPage(p);
      setEvents(ev);
      setHoldBreakdown(holds);
    } catch (e: unknown) {
      setSummary(null);
      setPage(null);
      setEvents(null);
      setHoldBreakdown(null);
      setError(e instanceof Error ? e.message : "Unable to load activity data");
    } finally {

      setLoading(false);
    }
  }, [client, organizationId, mode, status, callerModule, dateFrom, debouncedSearch, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [mode, status, callerModule, dateFrom, debouncedSearch, organizationId]);

  const openRequest = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("request", id);
    setSearchParams(next, { replace: false });
  };

  const closeRequest = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("request");
    setSearchParams(next, { replace: true });
  };

  const openBusinessEvent = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("businessEvent", id);
    setSearchParams(next, { replace: false });
  };

  const closeBusinessEvent = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("businessEvent");
    setSearchParams(next, { replace: true });
  };

  const openEmail = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("email", id);
    setSearchParams(next, { replace: false });
  };

  const closeEmail = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("email");
    setSearchParams(next, { replace: true });
  };

  const rows = useMemo(() => {
    const allowed = EVENT_FILTER_STATUSES[activityFilter];
    const items = events?.items ?? [];
    return allowed === null ? items : items.filter((r) => allowed.includes(r.status));
  }, [events, activityFilter]);



  const pageInfo = useMemo(() => {
    if (!events) return null;
    const from = events.total === 0 ? 0 : events.offset + 1;
    const to = Math.min(events.offset + events.limit, events.total);
    return { from, to, total: events.total };
  }, [events]);


  const attention = useMemo(
    () =>
      needsAttentionCount({
        blockedRequests: summary?.blocked_requests ?? 0,
        failedRequests: summary?.failed_requests ?? 0,
        needsReviewEvents:
          automation.status?.business_event_processor.needs_review_events ?? 0,
        outcomeUnknown:
          automation.status?.delivery_processor.last_outcome_unknown_at != null,
        staleWorker:
          automation.status != null &&
          (!automation.status.business_event_processor.healthy ||
            !automation.status.delivery_processor.healthy),
        callbackProblem: automation.status?.callback_receiver.healthy === false,
      }),
    [summary, automation.status],
  );

  if (!tenantLoading && !organizationId) {
    return (
      <OmniCommsEmptyState
        title="Select an organisation"
        description="Activity is scoped to a single organisation. Choose one in the module header to view automation and communication activity."
      />
    );
  }

  return (
    <div className="space-y-6" data-testid="omni-comms-operations-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Activity &amp; Automation</h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            See automatic processing, queued communications and delivery
            outcomes.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void load();
            automation.refresh();
          }}
          disabled={loading}
          data-testid="omni-comms-ops-refresh"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {automation.refreshError ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="omni-comms-automation-refresh-warning"
        >
          {automation.refreshError}
        </p>
      ) : null}

      <AutomationSection
        status={automation.status}
        loading={automation.loading}
        onRefresh={automation.refresh}
      />

      <WorkerHealthPanel />

      <ChannelActivityCards rows={events?.items ?? []} loading={loading && !events} />


      <Card data-testid="omni-comms-needs-attention">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm text-muted-foreground">Needs attention</p>
            <p className="text-2xl font-semibold tabular-nums">{attention}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setActivityFilter("needs_attention")}
            data-testid="omni-comms-needs-attention-filter"
          >
            Show items needing attention
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Business activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="flex flex-wrap items-center gap-2"
            data-testid="omni-comms-activity-filters"
          >
            {EVENT_FILTERS.map((f) => (

              <Button
                key={f.id}
                size="sm"
                variant={activityFilter === f.id ? "default" : "outline"}
                onClick={() => setActivityFilter(f.id)}
                data-testid={`omni-comms-activity-filter-${f.id}`}
              >
                {f.label}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search event or module"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
              aria-label="Search activity"
              data-testid="omni-comms-ops-search"
            />
            <Select value={callerModule} onValueChange={setCallerModule}>
              <SelectTrigger
                className="w-[220px]"
                aria-label="Filter by module"
                data-testid="omni-comms-ops-caller-filter"
              >
                <SelectValue placeholder="Module" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All modules</SelectItem>
                {OPS_CALLER_MODULES.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={range} onValueChange={(v) => setRange(v as RangeId)}>
              <SelectTrigger
                className="w-[170px]"
                aria-label="Filter by time range"
                data-testid="omni-comms-ops-range-filter"
              >
                <SelectValue placeholder="Date" />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={zone} onValueChange={(v) => setZone(v as "local" | "utc")}>
              <SelectTrigger
                className="w-[150px]"
                aria-label="Timestamp timezone"
                data-testid="omni-comms-ops-timezone"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local time</SelectItem>
                <SelectItem value="utc">UTC</SelectItem>
              </SelectContent>
            </Select>
            {filtersActive ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                data-testid="omni-comms-ops-clear-filters"
              >
                Clear filters
              </Button>
            ) : null}
          </div>

          {error ? (
            <OmniCommsEmptyState
              variant="error"
              title="Activity data unavailable"
              description={error}
              actionLabel="Retry"
              onAction={() => void load()}
            />
          ) : loading && !events ? (
            <OmniCommsEmptyState variant="loading" title="Loading activity…" />
          ) : rows.length === 0 ? (
            <OmniCommsEmptyState
              title="No business activity"
              description="No recorded business event matches the current filters for this organisation."
            />
          ) : (
            <>
              <Table data-testid="omni-comms-ops-request-table">
                <caption className="caption-bottom pt-3 text-left text-xs text-muted-foreground">
                  Timestamps are shown in {zone === "utc" ? "UTC" : "your local time"}.
                  Every row is a business event the organisation recorded. Select
                  a row to open its full timeline.
                </caption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Module</TableHead>
                    <TableHead>Business event</TableHead>
                    <TableHead>Business record</TableHead>
                    <TableHead className="text-right">Recipients</TableHead>
                    <TableHead>Channels</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open business event ${r.event_code}`}
                      className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => openBusinessEvent(r.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openBusinessEvent(r.id);
                        }
                      }}
                      data-testid={`omni-comms-ops-event-row-${r.id}`}
                    >
                      <TableCell className="text-xs whitespace-nowrap">
                        {ts(r.occurred_at, zone)}
                      </TableCell>
                      <TableCell className="text-xs">{r.module_code}</TableCell>
                      <TableCell className="text-xs">
                        {businessEventLabel(r.event_code)}
                      </TableCell>
                      <TableCell className="text-xs">{r.entity_id ?? "—"}</TableCell>
                      <TableCell className="text-xs text-right">{r.recipient_count}</TableCell>
                      <TableCell className="text-xs">
                        {r.channels.length > 0 ? r.channels.join(", ") : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant={businessEventStatusTone(r.status)}>
                          {businessEventStatusLabel(r.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            openBusinessEvent(r.id);
                          }}
                          data-testid={`omni-comms-ops-event-view-${r.id}`}
                          aria-label={`View business event ${r.event_code}`}
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
                  {pageInfo
                    ? `Showing ${pageInfo.from}–${pageInfo.to} of ${pageInfo.total}`
                    : ""}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={offset === 0 || loading}
                    onClick={() =>
                      setOffset(Math.max(0, offset - BUSINESS_EVENT_PAGE_SIZE_DEFAULT))
                    }
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      loading || !events || events.offset + events.limit >= events.total
                    }
                    onClick={() => setOffset(offset + BUSINESS_EVENT_PAGE_SIZE_DEFAULT)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}

        </CardContent>
      </Card>

      <EmailJourneySection organizationId={organizationId} onOpenEmail={openEmail} />

      {/* Print / Correspondence physical production queue (Phase 3A). */}
      <PrinterStatusPanel />
      <PrintProductionQueue />
      <PrintAuditPanel />

      {/*
        Technical details — the support-engineer register. Kept, but BELOW the
        business-friendly activity view.
      */}
      <details data-testid="omni-comms-ops-technical-details">
        <summary className="cursor-pointer text-sm font-medium">
          Technical details
        </summary>
        <div className="space-y-4 pt-4">
          <OperationsSummaryCards
            summary={summary}
            loading={loading && !summary}
            attention={holdBreakdown}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger
                className="w-[160px]"
                aria-label="Filter by mode"
                data-testid="omni-comms-ops-mode-filter"
              >
                <SelectValue placeholder="Mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All modes</SelectItem>
                {OPS_REQUEST_MODES.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger
                className="w-[200px]"
                aria-label="Filter by technical status"
                data-testid="omni-comms-ops-status-filter"
              >
                <SelectValue placeholder="Technical status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {OPS_REQUEST_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p
            className="text-xs text-muted-foreground"
            data-testid="omni-comms-ops-active-filters"
          >
            {filtersActive
              ? `Filtered by ${[
                  mode !== ALL ? `mode ${mode}` : null,
                  status !== ALL ? `status ${status}` : null,
                  `time range ${RANGES.find((r) => r.id === range)?.label.toLowerCase()}`,
                  search.trim() ? `search "${search.trim()}"` : null,
                ]
                  .filter(Boolean)
                  .join(", ")}.`
              : "No filters applied beyond the default last 30 days."}
          </p>
          <p className="text-xs text-muted-foreground">
            Request register: correlation identifiers, idempotency keys, modes
            and raw statuses are available in each request record.
          </p>

          {(page?.items ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No communication requests match the technical filters.
            </p>
          ) : (
            <Table data-testid="omni-comms-ops-request-register">
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Raw status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(page?.items ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {ts(r.created_at, zone)}
                    </TableCell>
                    <TableCell className="text-xs">{r.event_code ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.mode}</TableCell>
                    <TableCell className="text-xs">{r.status}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openRequest(r.id)}
                        data-testid={`omni-comms-ops-request-view-${r.id}`}
                        aria-label={`View request ${r.event_code ?? r.id}`}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </details>

      {organizationId ? (
        <>
          <BusinessEventDetailPanel
            eventId={selectedEventId}
            organizationId={organizationId}
            onClose={closeBusinessEvent}
          />
          <EmailJourneyDetailPanel
            messageId={selectedEmailId}
            organizationId={organizationId}
            onClose={closeEmail}
          />
          <RequestDetailPanel
            requestId={selectedRequestId}
            organizationId={organizationId}
            onClose={closeRequest}
          />
        </>
      ) : null}

    </div>
  );
};

export default OmniCommsOperationsPage;
