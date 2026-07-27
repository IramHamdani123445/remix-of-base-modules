/**
 * Gate 3 — Runtime Contract card for the Go-Live page.
 *
 * Displays the result of audit_comm_hub_runtime_contract() so operators can
 * see, per capability, whether the deployed schema/RPCs match what the
 * Communication Hub runtime expects. This card never sends, enqueues,
 * changes mode, or arms automation.
 *
 * Provider-contacting actions elsewhere on the page should read the report
 * via `capabilityPasses()` and remain disabled unless the relevant
 * capability is PASS.
 */
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  RuntimeContractCheck,
} from "@/platform/communication-hub/runtimeContractService";
import { useRuntimeContract } from "@/platform/communication-hub/RuntimeContractContext";

function statusBadge(status: RuntimeContractCheck["status"]) {
  if (status === "PASS") {
    return (
      <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
        PASS
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-red-300 bg-red-50 text-red-800">
      {status}
    </Badge>
  );
}

export function RuntimeContractCard() {
  const { report, loading, error, refresh } = useRuntimeContract();
  const run = () => { void refresh(); };


  const failing = (report?.checks ?? []).filter((c) => c.status !== "PASS");
  const passing = (report?.checks ?? []).filter((c) => c.status === "PASS");

  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Communication Hub runtime contract</h3>
          {report && (
            <Badge variant={report.ok ? "outline" : "destructive"} className={report.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : ""}>
              {report.ok ? "READY" : `${report.summary.fail} FAILING`}
            </Badge>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => void run()} disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          <span className="ml-1">Re-check</span>
        </Button>
      </header>

      <p className="text-xs text-muted-foreground">
        Read-only diagnostic. Verifies every table, column, and RPC the Communication Hub
        runtime depends on. Provider-contacting actions remain disabled unless the relevant
        capability is <span className="font-mono">PASS</span>.
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Audit failed</AlertTitle>
          <AlertDescription className="font-mono text-xs">{error}</AlertDescription>
        </Alert>
      )}

      {report && (
        <>
          {report.ok ? (
            <Alert className="bg-emerald-50 border-emerald-200">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertTitle className="text-emerald-800">
                All {report.summary.total} contract checks pass
              </AlertTitle>
              <AlertDescription className="text-emerald-700 text-xs">
                Checked at {new Date(report.checked_at).toLocaleString()}.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>
                {report.summary.fail} of {report.summary.total} checks failing
              </AlertTitle>
              <AlertDescription className="text-xs">
                Repair failing items below before enabling provider-contacting actions.
              </AlertDescription>
            </Alert>
          )}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Status</TableHead>
                  <TableHead className="w-[160px]">Capability</TableHead>
                  <TableHead>Requirement</TableHead>
                  <TableHead className="font-mono text-[11px]">Object</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...failing, ...passing].map((c, i) => (
                  <TableRow key={i}>
                    <TableCell>{statusBadge(c.status)}</TableCell>
                    <TableCell className="text-xs">{c.capability}</TableCell>
                    <TableCell className="text-xs">
                      {c.requirement}
                      {c.fix_action && (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          Fix: {c.fix_action}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {c.object_name}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}
