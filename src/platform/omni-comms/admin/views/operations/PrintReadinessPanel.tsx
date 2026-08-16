/**
 * Omni-Comms — the ONE authoritative Print readiness panel.
 *
 * Every Print control gate is shown here with a truthful status:
 * READY / BLOCKED / NOT APPLICABLE. Controls that belong to external
 * providers (API credentials, sending domains, DNS, webhooks, external
 * authentication) are NOT APPLICABLE for the internal print spool — they are
 * never shown as red, and never hidden.
 *
 * Nothing on this panel touches Email (Resend) or SMS (Twilio) controls.
 */
import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  MinusCircle,
  Printer,
  RefreshCw,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

import { useOmniCommsTenant } from "@/platform/omni-comms/context/OmniCommsTenantContext";
import { useOmniCommsRpcClient } from "@/platform/omni-comms/admin/hooks/useOmniCommsRpcClient";
import {
  getPrintReadiness,
  provisionPrintDefaults,
  setPrintRelease,
} from "@/platform/omni-comms/application/printReadinessService";
import {
  describePrintError,
  PRINT_GATE_STATUS_LABEL,
  type PrintGateStatus,
  type PrintReadinessGate,
} from "@/platform/omni-comms/application/printReadinessTypes";

export const PRINT_READINESS_QUERY_KEY = ["omni-comms", "print-readiness"];

const STATUS_TONE: Record<PrintGateStatus, string> = {
  ready: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  blocked: "bg-destructive/10 text-destructive",
  not_applicable: "bg-muted text-muted-foreground",
};

const StatusIcon: React.FC<{ status: PrintGateStatus }> = ({ status }) => {
  if (status === "ready")
    return (
      <CheckCircle2
        className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
        aria-hidden="true"
      />
    );
  if (status === "blocked")
    return <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />;
  return <MinusCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
};

const GateRow: React.FC<{
  gate: PrintReadinessGate;
  onFix: (gate: PrintReadinessGate) => void;
  busy: boolean;
}> = ({ gate, onFix, busy }) => {
  const guidance = gate.error_code ? describePrintError(gate.error_code) : null;
  return (
    <div
      className="flex items-start justify-between gap-3 rounded-md border p-3"
      data-testid={`print-gate-${gate.key}`}
    >
      <div className="flex items-start gap-3">
        <StatusIcon status={gate.status} />
        <div>
          <div className="text-sm font-medium">{gate.label}</div>
          <p className="text-xs text-muted-foreground">{gate.reason}</p>
          {guidance && (
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-medium">Fix:</span> {guidance.action}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {gate.fix_action === "provision" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onFix(gate)}>
            <Wrench className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            Provision
          </Button>
        )}
        <Badge variant="outline" className={STATUS_TONE[gate.status]}>
          {PRINT_GATE_STATUS_LABEL[gate.status]}
        </Badge>
      </div>
    </div>
  );
};

export const PrintReadinessPanel: React.FC = () => {
  const { organizationId, departmentId } = useOmniCommsTenant();
  const client = useOmniCommsRpcClient();
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);

  const readiness = useQuery({
    queryKey: [...PRINT_READINESS_QUERY_KEY, organizationId, departmentId],
    enabled: Boolean(organizationId),
    queryFn: () =>
      getPrintReadiness(client, organizationId as string, departmentId ?? null),
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: PRINT_READINESS_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ["omni-comms", "print-queue"] });
  };

  const provision = useMutation({
    mutationFn: () =>
      provisionPrintDefaults(client, organizationId as string, departmentId ?? null),
    onSuccess: () => {
      toast.success("Print configuration provisioned.");
      refreshAll();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Provisioning failed."),
  });

  const release = useMutation({
    mutationFn: (enabled: boolean) =>
      setPrintRelease(
        client,
        organizationId as string,
        enabled,
        enabled ? "Operator enabled print production." : "Operator paused print production.",
      ),
    onSuccess: (result) => {
      toast.success(
        result.release_state === "live"
          ? "Print production is ON."
          : "Print production is OFF — no letter can be opened for printing.",
      );
      refreshAll();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not change print production."),
  });

  const data = readiness.data;
  const gates = data?.gates ?? [];
  const blocked = gates.filter((g) => g.status === "blocked");
  const visible = showAll ? gates : blocked.length > 0 ? blocked : gates;
  const releaseGate = gates.find((g) => g.key === "release_control");
  const productionOn =
    releaseGate?.status === "ready" && releaseGate.error_code === null;

  return (
    <Card data-testid="omni-comms-print-readiness">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Printer className="mt-1 h-5 w-5 text-primary" aria-hidden="true" />
            <div>
              <CardTitle className="text-base">Print readiness</CardTitle>
              <CardDescription>
                The single place that says whether letters can be printed right
                now. External-provider controls do not apply to the internal
                print spool and are shown as NOT APPLICABLE, never as failures.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void readiness.refetch()}
              disabled={readiness.isFetching}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${readiness.isFetching ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              Re-check
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {readiness.isLoading && (
          <p className="text-sm text-muted-foreground">Checking Print readiness…</p>
        )}
        {readiness.isError && (
          <p className="text-sm text-destructive">
            Print readiness could not be read:{" "}
            {readiness.error instanceof Error
              ? readiness.error.message
              : "unknown error"}
          </p>
        )}

        {data && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <div className="text-sm font-semibold">
                  {data.ready_to_print
                    ? "Print is ready — letters can be opened and printed."
                    : `Print is blocked — ${data.blocked_count} control(s) need attention.`}
                </div>
                <p className="text-xs text-muted-foreground">
                  {data.queue_count} letter(s) in the physical queue · checked{" "}
                  {new Date(data.generated_at).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {!data.ready_to_print && data.can_configure && (
                  <Button
                    size="sm"
                    onClick={() => provision.mutate()}
                    disabled={provision.isPending}
                  >
                    <Wrench className="mr-2 h-4 w-4" aria-hidden="true" />
                    Provision print configuration
                  </Button>
                )}
                <div className="flex items-center gap-2">
                  <Switch
                    id="print-production-switch"
                    checked={productionOn}
                    disabled={!data.can_operate || release.isPending}
                    onCheckedChange={(v) => release.mutate(v === true)}
                    aria-label="Print production"
                  />
                  <Label htmlFor="print-production-switch" className="text-sm">
                    Print production {productionOn ? "ON" : "OFF"}
                  </Label>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              {visible.map((gate) => (
                <GateRow
                  key={gate.key}
                  gate={gate}
                  busy={provision.isPending}
                  onFix={() => provision.mutate()}
                />
              ))}
            </div>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowAll((v) => !v)}
              data-testid="print-readiness-toggle-all"
            >
              {showAll
                ? "Show blocking controls only"
                : `Show all ${gates.length} Print controls`}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default PrintReadinessPanel;
