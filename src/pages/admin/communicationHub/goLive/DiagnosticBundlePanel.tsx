/**
 * Checkpoint A — Communication Hub Diagnostic Bundle panel.
 *
 * One authenticated admin action that runs the runtime-contract audit and
 * baseline diagnostic under the operator JWT and returns one combined,
 * masked JSON envelope for view / copy / download. No mutations, no
 * provider contact.
 */
import { useCallback, useMemo, useState } from "react";
import {
  ClipboardCopy,
  Download,
  FileJson,
  Loader2,
  Play,
  ShieldCheck,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  baselineConverged,
  runDiagnosticBundle,
  type DiagnosticBundle,
} from "@/platform/communication-hub/diagnosticBundleService";

interface Props {
  moduleCode: string;
  eventCode: string;
  channel: string;
}

export function DiagnosticBundlePanel({ moduleCode, eventCode, channel }: Props) {
  const [bundle, setBundle] = useState<DiagnosticBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = !moduleCode || !eventCode || !channel;

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const b = await runDiagnosticBundle({ moduleCode, eventCode, channel });
      setBundle(b);
    } catch (e: any) {
      setError(e?.message ?? "diagnostic bundle failed");
    } finally {
      setLoading(false);
    }
  }, [moduleCode, eventCode, channel]);

  const json = useMemo(() => (bundle ? JSON.stringify(bundle, null, 2) : ""), [bundle]);

  const converged = bundle ? baselineConverged(bundle.baseline_diagnostic) : null;
  const runtimeOk =
    bundle &&
    typeof bundle.runtime_contract === "object" &&
    !("error" in bundle.runtime_contract) &&
    (bundle.runtime_contract as any).ok === true;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      toast.success("Diagnostic JSON copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  const download = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `comm-hub-diagnostic-${moduleCode}-${eventCode}-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Diagnostic bundle</h3>
          {bundle && (
            <>
              <Badge
                variant="outline"
                className={
                  runtimeOk
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : "border-red-300 bg-red-50 text-red-800"
                }
              >
                Runtime contract: {runtimeOk ? "READY" : "FAIL"}
              </Badge>
              <Badge
                variant="outline"
                className={
                  converged === true
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : converged === false
                    ? "border-red-300 bg-red-50 text-red-800"
                    : "border-slate-300 bg-slate-50 text-slate-700"
                }
              >
                Baseline: {converged === true ? "CONVERGED" : converged === false ? "DIVERGENT" : "UNKNOWN"}
              </Badge>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void run()} disabled={disabled || loading}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            <span className="ml-1">Run diagnostic bundle</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShowJson((v) => !v)} disabled={!bundle}>
            <FileJson className="h-3 w-3" />
            <span className="ml-1">{showJson ? "Hide" : "View"} JSON</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void copy()} disabled={!bundle}>
            <ClipboardCopy className="h-3 w-3" />
            <span className="ml-1">Copy</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={download} disabled={!bundle}>
            <Download className="h-3 w-3" />
            <span className="ml-1">Download</span>
          </Button>
        </div>
      </header>

      <p className="text-xs text-muted-foreground">
        Runs read-only under the current operator JWT:
        <span className="font-mono"> audit_comm_hub_runtime_contract()</span> and
        <span className="font-mono"> diagnose_comm_hub_legacy_attestation_fingerprint({moduleCode || "…"}, {eventCode || "…"}, {channel})</span>.
        Combines protected state. Credentials, secrets, and recipient addresses are masked. No mutations.
      </p>

      {disabled && (
        <Alert>
          <AlertTitle>Select a module and event above</AlertTitle>
          <AlertDescription className="text-xs">
            The diagnostic bundle needs an event scope to run the baseline diagnostic.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Bundle failed</AlertTitle>
          <AlertDescription className="font-mono text-xs">{error}</AlertDescription>
        </Alert>
      )}

      {bundle && (
        <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
          <div>
            <span className="text-muted-foreground">Generated at:</span>{" "}
            <span className="font-mono">{bundle.generated_at}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Operator:</span>{" "}
            <span className="font-mono">{bundle.operator_id ?? "—"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Scope:</span>{" "}
            <span className="font-mono">
              {bundle.scope.moduleCode} / {bundle.scope.eventCode} / {bundle.scope.channel}
            </span>
          </div>
          {"error" in (bundle.protected_state as any) ? (
            <div className="text-red-700">
              Protected state error: {(bundle.protected_state as any).error}
            </div>
          ) : (
            <>
              <div>
                <span className="text-muted-foreground">Anchor:</span>{" "}
                <span className="font-mono">
                  cert={String((bundle.protected_state as any).event_certification_id ?? "—").slice(0, 8)}… /
                  ore={String((bundle.protected_state as any).ore_certification_id ?? "—").slice(0, 8)}… /
                  lineage={String((bundle.protected_state as any).production_lineage_id ?? "—").slice(0, 8)}…
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Mode / Automation:</span>{" "}
                <span className="font-mono">
                  {(bundle.protected_state as any).operating_mode ?? "?"} /
                  {" "}{(bundle.protected_state as any).automation_state ?? "?"}
                </span>
              </div>
              {(bundle.protected_state as any).active_revalidation_cycle_id && (
                <div>
                  <span className="text-muted-foreground">Active cycle:</span>{" "}
                  <span className="font-mono">
                    {(bundle.protected_state as any).active_revalidation_cycle_id.slice(0, 8)}…
                    &nbsp;· {(bundle.protected_state as any).active_revalidation_status}
                    &nbsp;· needs_reassessment={String((bundle.protected_state as any).needs_reassessment)}
                    &nbsp;· v{(bundle.protected_state as any).assessment_version ?? 0}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showJson && bundle && (
        <pre className="max-h-[400px] overflow-auto rounded border bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">
{json}
        </pre>
      )}
    </section>
  );
}
