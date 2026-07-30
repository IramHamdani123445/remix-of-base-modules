/**
 * Omni-Comms Operations console — read-only.
 *
 * Route: /admin/omnichannel-communications/operations (existing permanent
 * route; the request detail view is a panel driven by `?request=<id>` so the
 * permanent route count stays at exactly seven).
 *
 * Everything on this page is an observation of real database records read
 * through `omni_comms_ops_*` SECURITY DEFINER RPCs. There is no retry, resend,
 * cancel, suppress or dispatch action anywhere in this surface.
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
import { useOmniCommsTenant } from "../../context/OmniCommsTenantContext";
import { useOmniCommsRpcClient } from "../hooks/useOmniCommsRpcClient";
import {
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
import OperationsPosture from "./operations/OperationsPosture";
import OperationsSummaryCards from "./operations/OperationsSummaryCards";
import RequestDetailPanel from "./operations/RequestDetailPanel";

const ALL = "__all__";

function ts(v: string | null): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return v;
  }
}

export const OmniCommsOperationsPage: React.FC = () => {
  const { organizationId, departmentId, loading: tenantLoading } = useOmniCommsTenant();
  const client = useOmniCommsRpcClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [summary, setSummary] = useState<OpsSummary | null>(null);
  const [page, setPage] = useState<OpsRequestPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);

  const selectedRequestId = searchParams.get("request");

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const [s, p] = await Promise.all([
        getOpsSummary(client, { organizationId, departmentId }),
        listOpsRequests(client, {
          organizationId,
          departmentId,
          mode: mode === ALL ? null : (mode as RequestMode),
          status: status === ALL ? null : (status as RequestStatus),
          search: debouncedSearch.length > 0 ? debouncedSearch : null,
          limit: OPS_PAGE_SIZE_DEFAULT,
          offset,
        }),
      ]);
      setSummary(s);
      setPage(p);
    } catch (e: unknown) {
      setSummary(null);
      setPage(null);
      setError(e instanceof Error ? e.message : "Unable to load operations data");
    } finally {
      setLoading(false);
    }
  }, [client, organizationId, departmentId, mode, status, debouncedSearch, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setOffset(0);
  }, [mode, status, debouncedSearch, organizationId, departmentId]);

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

  const pageInfo = useMemo(() => {
    if (!page) return null;
    const from = page.total === 0 ? 0 : page.offset + 1;
    const to = Math.min(page.offset + page.limit, page.total);
    return { from, to, total: page.total };
  }, [page]);

  if (!tenantLoading && !organizationId) {
    return (
      <div className="p-6">
        <OmniCommsEmptyState
          title="Select an organisation"
          description="Operations records are scoped to a single organisation. Choose one from the tenant selector to view runtime activity."
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="omni-comms-operations-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Operations</h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Read-only console over Omnichannel Communications runtime records.
            Retry, resend, cancel, suppress and provider dispatch are not
            implemented in this build.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          data-testid="omni-comms-ops-refresh"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <OperationsPosture />

      <OperationsSummaryCards summary={summary} loading={loading && !summary} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Request register</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Search event, module, correlation or idempotency key"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
              data-testid="omni-comms-ops-search"
            />
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger className="w-[160px]" data-testid="omni-comms-ops-mode-filter">
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
              <SelectTrigger className="w-[200px]" data-testid="omni-comms-ops-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {OPS_REQUEST_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error ? (
            <OmniCommsEmptyState
              variant="error"
              title="Operations data unavailable"
              description={error}
              actionLabel="Retry"
              onAction={() => void load()}
            />
          ) : loading && !page ? (
            <OmniCommsEmptyState variant="loading" title="Loading requests…" />
          ) : !page || page.items.length === 0 ? (
            <OmniCommsEmptyState
              title="No communication requests"
              description="Nothing has been submitted through the send façade for this organisation yet, or no record matches the current filters."
            />
          ) : (
            <>
              <Table data-testid="omni-comms-ops-request-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Created</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Module</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Recipients</TableHead>
                    <TableHead className="text-right">Messages</TableHead>
                    <TableHead className="text-right">Held jobs</TableHead>
                    <TableHead className="text-right">Blockers</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.items.map((r) => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => openRequest(r.id)}
                      data-testid={`omni-comms-ops-request-row-${r.id}`}
                    >
                      <TableCell className="text-xs">{ts(r.created_at)}</TableCell>
                      <TableCell className="text-xs">{r.event_code ?? "—"}</TableCell>
                      <TableCell className="text-xs">{r.caller_module_code}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline">{r.mode}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline">{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-right">{r.recipient_count}</TableCell>
                      <TableCell className="text-xs text-right">{r.message_count}</TableCell>
                      <TableCell className="text-xs text-right">{r.held_job_count}</TableCell>
                      <TableCell className="text-xs text-right">{r.blocker_count}</TableCell>
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
                    onClick={() => setOffset(Math.max(0, offset - OPS_PAGE_SIZE_DEFAULT))}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={loading || !page || page.offset + page.limit >= page.total}
                    onClick={() => setOffset(offset + OPS_PAGE_SIZE_DEFAULT)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {organizationId ? (
        <RequestDetailPanel
          requestId={selectedRequestId}
          organizationId={organizationId}
          onClose={closeRequest}
        />
      ) : null}
    </div>
  );
};

export default OmniCommsOperationsPage;
