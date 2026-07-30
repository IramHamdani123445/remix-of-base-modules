/**
 * Omni-Comms Operations — request detail panel (read-only).
 *
 * Opened from the request register via the `?request=<id>` query parameter so
 * the detail view is linkable WITHOUT adding an eighth permanent route.
 * No mutation is possible from this panel.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import OmniCommsEmptyState from "../../components/OmniCommsEmptyState";
import OpsTimeline from "./OpsTimeline";
import MessageContentDialog from "./MessageContentDialog";
import { useOmniCommsRpcClient } from "../../hooks/useOmniCommsRpcClient";
import {
  getOpsRequestDetail,
  type OpsRequestDetail,
} from "@/platform/omni-comms/application/operationsService";

export interface RequestDetailPanelProps {
  requestId: string | null;
  organizationId: string;
  onClose: () => void;
}

function ts(v: string | null | undefined): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return v;
  }
}

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="space-y-0.5">
    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="text-sm break-all">{value ?? "—"}</p>
  </div>
);

const Json: React.FC<{ value: unknown }> = ({ value }) => (
  <pre className="text-[11px] whitespace-pre-wrap break-words rounded bg-muted/50 p-2">
    {JSON.stringify(value ?? null, null, 2)}
  </pre>
);

export const RequestDetailPanel: React.FC<RequestDetailPanelProps> = ({
  requestId,
  organizationId,
  onClose,
}) => {
  const client = useOmniCommsRpcClient();
  const [detail, setDetail] = useState<OpsRequestDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [contentMessageId, setContentMessageId] = useState<string | null>(null);

  const load = useCallback(
    async (revealSensitive: boolean) => {
      if (!requestId) return;
      setLoading(true);
      setError(null);
      try {
        const res = await getOpsRequestDetail(client, {
          requestId,
          organizationId,
          revealSensitive,
        });
        setDetail(res);
      } catch (e: unknown) {
        setDetail(null);
        setError(e instanceof Error ? e.message : "Unable to load request");
      } finally {
        setLoading(false);
      }
    },
    [client, requestId, organizationId],
  );

  useEffect(() => {
    setReveal(false);
    if (requestId) void load(false);
    else setDetail(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  const req = detail?.request;

  return (
    <Sheet open={!!requestId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-3xl overflow-y-auto"
        data-testid="omni-comms-ops-request-detail"
      >
        <SheetHeader>
          <SheetTitle>Request detail</SheetTitle>
          <SheetDescription>
            Read-only inspection. No retry, resend, cancel or suppress action
            exists in this build.
          </SheetDescription>
        </SheetHeader>

        {loading && <OmniCommsEmptyState variant="loading" title="Loading request…" />}
        {error && !loading && (
          <OmniCommsEmptyState
            variant="error"
            title="Request unavailable"
            description={error}
            actionLabel="Retry"
            onAction={() => void load(reveal)}
          />
        )}

        {detail && req && !loading && !error && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{req.mode}</Badge>
              <Badge variant="outline">{req.status}</Badge>
              {detail.sensitive_visible ? (
                <Badge variant="outline">Sensitive content visible</Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Masked
                </Badge>
              )}
              {detail.can_view_sensitive && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  data-testid="omni-comms-ops-reveal-toggle"
                  onClick={() => {
                    const next = !reveal;
                    setReveal(next);
                    void load(next);
                  }}
                >
                  {reveal ? "Hide sensitive values" : "Reveal sensitive values"}
                </Button>
              )}
            </div>

            <Tabs defaultValue="overview">
              <TabsList className="flex-wrap">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="recipients">
                  Recipients ({detail.recipients.length})
                </TabsTrigger>
                <TabsTrigger value="messages">
                  Messages ({detail.messages.length})
                </TabsTrigger>
                <TabsTrigger value="jobs">
                  Jobs ({detail.dispatch_jobs.length})
                </TabsTrigger>
                <TabsTrigger value="timeline">
                  Timeline ({detail.timeline.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Request ID" value={<span className="font-mono text-xs">{req.id}</span>} />
                  <Field label="Event" value={req.event_code ?? "—"} />
                  <Field label="Caller module" value={req.caller_module_code} />
                  <Field label="Caller entity" value={`${req.caller_entity_type ?? "—"} ${req.caller_entity_id ?? ""}`} />
                  <Field label="Correlation ID" value={<span className="font-mono text-xs">{req.correlation_id ?? "—"}</span>} />
                  <Field label="Idempotency key" value={<span className="font-mono text-xs">{req.idempotency_key}</span>} />
                  <Field label="Fingerprint" value={<span className="font-mono text-xs">{req.request_fingerprint ?? "—"}</span>} />
                  <Field label="Requested channels" value={(req.requested_channels ?? []).join(", ") || "—"} />
                  <Field label="Created" value={ts(req.created_at)} />
                  <Field label="Completed" value={ts(req.completed_at)} />
                </div>
                <div>
                  <p className="text-xs font-medium mb-1">Blockers</p>
                  <Json value={req.blockers} />
                </div>
                <div>
                  <p className="text-xs font-medium mb-1">
                    Payload snapshot {req.payload_redacted ? "(redacted)" : ""}
                  </p>
                  <ScrollArea className="h-56 rounded border">
                    <div className="p-1">
                      <Json value={req.payload_snapshot} />
                    </div>
                  </ScrollArea>
                </div>
              </TabsContent>

              <TabsContent value="recipients">
                {detail.recipients.length === 0 ? (
                  <OmniCommsEmptyState title="No recipients recorded" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Recipient</TableHead>
                        <TableHead>Destinations</TableHead>
                        <TableHead>Eligibility</TableHead>
                        <TableHead>Channels</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.recipients.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs">
                            {r.display_name ?? r.recipient_reference ?? r.recipient_type}
                          </TableCell>
                          <TableCell className="text-xs font-mono">
                            {[r.email_destination, r.phone_destination, r.push_destination]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </TableCell>
                          <TableCell className="text-xs">{r.eligibility_status}</TableCell>
                          <TableCell className="text-xs">
                            {(r.resolved_channels ?? []).join(", ") || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>

              <TabsContent value="messages">
                {detail.messages.length === 0 ? (
                  <OmniCommsEmptyState title="No messages rendered" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Channel</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Template</TableHead>
                        <TableHead>Sender</TableHead>
                        <TableHead>Checksum</TableHead>
                        <TableHead className="text-right">Content</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.messages.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="text-xs">{m.channel}</TableCell>
                          <TableCell className="text-xs">{m.status}</TableCell>
                          <TableCell className="text-xs">
                            {m.template_family_code ?? "—"}
                            {m.template_version_number != null ? ` v${m.template_version_number}` : ""}
                          </TableCell>
                          <TableCell className="text-xs">{m.sender_identity_code ?? "—"}</TableCell>
                          <TableCell className="text-[11px] font-mono truncate max-w-[140px]">
                            {m.rendered_checksum ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!m.content_available || !detail.can_view_sensitive}
                              onClick={() => setContentMessageId(m.id)}
                            >
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>

              <TabsContent value="jobs" className="space-y-4">
                {detail.dispatch_jobs.length === 0 ? (
                  <OmniCommsEmptyState title="No dispatch jobs" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Channel</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Runnable</TableHead>
                        <TableHead>Hold reason</TableHead>
                        <TableHead>Attempts</TableHead>
                        <TableHead>Lease</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.dispatch_jobs.map((j) => (
                        <TableRow key={j.id}>
                          <TableCell className="text-xs">{j.channel}</TableCell>
                          <TableCell className="text-xs">{j.status}</TableCell>
                          <TableCell className="text-xs">
                            {j.is_runnable ? (
                              <Badge variant="destructive">Runnable</Badge>
                            ) : (
                              "No"
                            )}
                          </TableCell>
                          <TableCell className="text-xs">{j.hold_reason ?? "—"}</TableCell>
                          <TableCell className="text-xs">
                            {j.attempt_count}/{j.max_attempts}
                          </TableCell>
                          <TableCell className="text-xs">{j.lease_state}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}

                <div>
                  <p className="text-xs font-medium mb-1">
                    Delivery attempts ({detail.delivery_attempts.length})
                  </p>
                  {detail.delivery_attempts.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      None. No provider dispatch exists in this build.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>#</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Provider</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Latency</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.delivery_attempts.map((a) => (
                          <TableRow key={a.id}>
                            <TableCell className="text-xs">{a.attempt_number}</TableCell>
                            <TableCell className="text-xs">{a.status}</TableCell>
                            <TableCell className="text-xs">{a.provider_code ?? "—"}</TableCell>
                            <TableCell className="text-xs">
                              {a.response_category ?? a.failure_category ?? "—"}
                            </TableCell>
                            <TableCell className="text-xs">{a.latency_ms ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="timeline">
                <OpsTimeline
                  entries={detail.timeline}
                  warnings={detail.timeline_warnings}
                />
              </TabsContent>
            </Tabs>
          </div>
        )}

        <MessageContentDialog
          messageId={contentMessageId}
          organizationId={organizationId}
          open={!!contentMessageId}
          onOpenChange={(o) => { if (!o) setContentMessageId(null); }}
        />
      </SheetContent>
    </Sheet>
  );
};

export default RequestDetailPanel;
