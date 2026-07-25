/**
 * Phase 4B3 — Compact Go Live Gate Monitor.
 *
 * Server-driven. Renders the snapshot returned by
 * `get_comm_hub_go_live_gate_snapshot`. Does NOT determine pass/fail
 * itself. Re-check is read-only and produces zero runtime rows.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchGoLiveGateSnapshot,
  safeActionKind,
  GATE_GROUPS,
  type GoLiveGateSnapshot,
  type GateEntry,
  type GateStatus,
  type GateGroup,
} from "@/platform/communication-hub/goLiveGateMonitorService";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Circle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ShieldAlert,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface GoLiveGateMonitorProps {
  moduleCode: string | null;
  eventCode: string | null;
  channel: string | null;
  previewSnapshotId?: string | null;
  previewApprovalId?: string | null;
  dryRunExecutionId?: string | null;
  /** Historical IDs stashed in sessionStorage that no longer match server state. */
  historicalAttempts?: Array<{ label: string; id: string; note?: string }>;
  className?: string;
}

function statusIcon(status: GateStatus) {
  switch (status) {
    case "PASSED":
      return <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Passed" />;
    case "BLOCKED":
      return <XCircle className="h-4 w-4 text-destructive" aria-label="Blocked" />;
    case "WARNING":
      return <AlertTriangle className="h-4 w-4 text-amber-600" aria-label="Warning" />;
    case "CHECKING":
      return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Checking" />;
    case "EXPIRED":
    case "SUPERSEDED":
      return <Clock className="h-4 w-4 text-amber-600" aria-label={status} />;
    case "UNAVAILABLE":
      return <ShieldAlert className="h-4 w-4 text-muted-foreground" aria-label="Unavailable" />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground" aria-label={status} />;
  }
}

function groupStatus(gates: GateEntry[], group: GateGroup): GateStatus {
  const inGroup = gates.filter((g) => g.group === group);
  if (inGroup.length === 0) return "NOT_STARTED";
  if (inGroup.some((g) => ["BLOCKED", "EXPIRED", "SUPERSEDED"].includes(g.status))) return "BLOCKED";
  if (inGroup.some((g) => g.status === "CHECKING")) return "CHECKING";
  if (inGroup.every((g) => g.status === "PASSED")) return "PASSED";
  if (inGroup.some((g) => g.status === "WARNING")) return "WARNING";
  return "NOT_STARTED";
}

function groupIcon(status: GateStatus) {
  switch (status) {
    case "PASSED":
      return "✓";
    case "BLOCKED":
    case "EXPIRED":
    case "SUPERSEDED":
      return "✕";
    case "CHECKING":
      return "…";
    case "WARNING":
      return "!";
    default:
      return "○";
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

export default function GoLiveGateMonitor(props: GoLiveGateMonitorProps) {
  const [snapshot, setSnapshot] = useState<GoLiveGateSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await fetchGoLiveGateSnapshot({
        moduleCode: props.moduleCode,
        eventCode: props.eventCode,
        channel: props.channel,
        previewSnapshotId: props.previewSnapshotId,
        previewApprovalId: props.previewApprovalId,
        dryRunExecutionId: props.dryRunExecutionId,
      });
      setSnapshot(snap);
      setLastCheckedAt(new Date().toISOString());
    } catch (e: any) {
      setError(e?.message ?? "Failed to load gate snapshot.");
    } finally {
      setLoading(false);
    }
  }, [
    props.moduleCode,
    props.eventCode,
    props.channel,
    props.previewSnapshotId,
    props.previewApprovalId,
    props.dryRunExecutionId,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  // Optional refresh while expanded panel is open. Stop when tab hidden.
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    const tick = () => {
      if (!cancelled && !document.hidden) void load();
    };
    const t = window.setInterval(tick, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [expanded, load]);

  const firstBlocker = useMemo<GateEntry | null>(() => {
    if (!snapshot?.first_blocking_gate_id) return null;
    return snapshot.gates.find((g) => g.id === snapshot.first_blocking_gate_id) ?? null;
  }, [snapshot]);

  const firstBlockerSeq = firstBlocker?.sequence ?? Infinity;

  return (
    <div
      className={cn(
        "rounded-md border bg-card px-3 py-2 text-sm",
        snapshot?.overall_status === "BLOCKED" && "border-destructive/50",
        props.className
      )}
      aria-live="polite"
    >
      {/* Collapsed compact row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex items-center gap-2 font-medium">
          {loading && !snapshot ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            statusIcon(snapshot?.overall_status ?? "NOT_STARTED")
          )}
          <span>Gate Monitor</span>
          {snapshot && (
            <span className="text-muted-foreground">
              · {snapshot.passed_gate_count} of {snapshot.total_gate_count} passed
            </span>
          )}
        </div>

        {snapshot && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {GATE_GROUPS.map((g) => {
              const s = groupStatus(snapshot.gates, g.id);
              return (
                <span
                  key={g.id}
                  aria-label={`${g.label}: ${s}`}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-1.5 py-0.5",
                    s === "PASSED" && "bg-emerald-50 text-emerald-700",
                    (s === "BLOCKED" || s === "EXPIRED" || s === "SUPERSEDED") && "bg-destructive/10 text-destructive",
                    s === "CHECKING" && "bg-muted text-muted-foreground",
                    s === "WARNING" && "bg-amber-50 text-amber-700",
                    s === "NOT_STARTED" && "bg-muted/50 text-muted-foreground"
                  )}
                >
                  <span aria-hidden>{groupIcon(s)}</span>
                  {g.label}
                </span>
              );
            })}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2 text-xs">
          {lastCheckedAt && (
            <span className="text-muted-foreground">Last checked: {formatTime(lastCheckedAt)}</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Re-check gate snapshot"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            <span className="ml-1">Re-check</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls="gate-monitor-details"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            <span className="ml-1">Details</span>
          </Button>
        </div>
      </div>

      {/* First-blocker line */}
      {snapshot && firstBlocker && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
          <span className="font-medium text-destructive">Blocked at: {firstBlocker.name}</span>
          <span className="text-muted-foreground">
            Action: {snapshot.recommended_action.label}
          </span>
        </div>
      )}

      {error && (
        <Alert variant="destructive" className="mt-2">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Expanded details */}
      {expanded && snapshot && (
        <div id="gate-monitor-details" className="mt-3 space-y-3">
          <Separator />

          {/* Journey summary */}
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div><span className="text-muted-foreground">Module:</span> {snapshot.module_code ?? "—"}</div>
            <div><span className="text-muted-foreground">Event:</span> {snapshot.event_code ?? "—"}</div>
            <div><span className="text-muted-foreground">Channel:</span> {snapshot.channel ?? "—"}</div>
            <div><span className="text-muted-foreground">Correlation:</span> <code className="text-[10px]">{snapshot.correlation_id ?? "—"}</code></div>
            <div><span className="text-muted-foreground">Current attempt:</span> <code className="text-[10px]">{snapshot.current_attempt_id ?? "—"}</code></div>
            <div><span className="text-muted-foreground">Evaluated at:</span> {formatTime(snapshot.evaluated_at)}</div>
          </div>

          {/* First-blocker card */}
          {firstBlocker && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>First blocker: {firstBlocker.name}</AlertTitle>
              <AlertDescription className="space-y-1 text-xs">
                <div>{firstBlocker.summary}</div>
                {firstBlocker.why_it_blocks && (
                  <div className="text-muted-foreground">{firstBlocker.why_it_blocks}</div>
                )}
                <div>
                  <Badge variant="outline">Action: {snapshot.recommended_action.label}</Badge>
                  <Badge variant="outline" className="ml-2">
                    Kind: {safeActionKind(snapshot.recommended_action.kind)}
                  </Badge>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Groups */}
          {GATE_GROUPS.map((group) => {
            const gates = snapshot.gates.filter((g) => g.group === group.id);
            if (gates.length === 0) return null;
            const gs = groupStatus(snapshot.gates, group.id);
            return (
              <div key={group.id} className="rounded border p-2">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="flex items-center gap-2">
                    {statusIcon(gs)} {group.label}
                  </span>
                  <span className="text-muted-foreground">{gs}</span>
                </div>
                <ul className="mt-1 space-y-1">
                  {gates.map((gate) => {
                    const isWaiting =
                      firstBlocker && gate.sequence > firstBlockerSeq && gate.status === "NOT_STARTED";
                    const shouldExpand =
                      ["BLOCKED", "EXPIRED", "SUPERSEDED", "WARNING"].includes(gate.status);
                    return (
                      <li key={gate.id} className="rounded border-l-2 pl-2 text-xs" aria-label={`${gate.name}: ${gate.status}`}>
                        <div className="flex items-center gap-2">
                          {statusIcon(gate.status)}
                          <span className="font-medium">{gate.name}</span>
                          <span className="text-muted-foreground">
                            {isWaiting ? `WAITING — blocked by ${firstBlocker!.name}` : gate.status}
                          </span>
                        </div>
                        {(shouldExpand || isWaiting) && (
                          <div className="ml-6 mt-0.5 space-y-0.5 text-muted-foreground">
                            <div>{gate.summary}</div>
                            {gate.current_value && (
                              <div>
                                <span>Current:</span> <code>{gate.current_value}</code>{" "}
                                <span>· Required:</span> <code>{gate.required_value ?? "—"}</code>
                              </div>
                            )}
                            {gate.blocker_codes && gate.blocker_codes.length > 0 && (
                              <div>
                                Blocker codes:{" "}
                                {gate.blocker_codes.map((c) => (
                                  <code key={c} className="mr-1">{c}</code>
                                ))}
                              </div>
                            )}
                            <details className="mt-0.5">
                              <summary className="cursor-pointer">Technical Details</summary>
                              <div className="ml-2 mt-0.5 space-y-0.5">
                                <div>Function: <code>{gate.source.function}</code></div>
                                <div>Layer: {gate.source.layer}</div>
                                <div>Evaluator: {gate.source.evaluator_version}</div>
                                <div>Checked at: {formatTime(gate.source.checked_at)}</div>
                                {gate.source.source_record_id && (
                                  <div>Source record: <code>{gate.source.source_record_id}</code></div>
                                )}
                                <div>Retry-safe: {String(gate.retry_safe ?? true)}</div>
                                <div>Mutation started: {String(gate.mutation_started ?? false)}</div>
                              </div>
                            </details>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          {/* Historical attempts */}
          {props.historicalAttempts && props.historicalAttempts.length > 0 && (
            <div className="rounded border border-dashed p-2 text-xs">
              <div className="mb-1 font-medium text-muted-foreground">Historical attempts (informational only)</div>
              <ul className="space-y-0.5">
                {props.historicalAttempts.map((h) => (
                  <li key={h.id} className="text-muted-foreground">
                    <Badge variant="outline" className="mr-1">STALE</Badge>
                    {h.label}: <code>{h.id}</code>
                    {h.note && <span> · {h.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="text-[10px] text-muted-foreground">
            Read-only diagnostic. Re-check creates no Preview, approval, execution, request,
            message, delivery-attempt, provider, or simulator rows.
          </div>
        </div>
      )}
    </div>
  );
}
