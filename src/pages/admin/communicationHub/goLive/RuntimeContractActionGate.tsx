/**
 * A4.0 — Action-level runtime-contract gate.
 *
 * Wrap a SPECIFIC provider-touching button (send, authorise, canary, dispatch)
 * so it becomes disabled+annotated when the required capabilities are not all
 * PASS. Never hides sibling controls (recovery, reconciliation, inbox
 * confirmation, Emergency Stop, disarm, diagnostics, evidence, history).
 *
 * Fail-closed while loading, when the report is absent, or on audit error.
 *
 * This replaces panel-level `RuntimeContractGate` wrapping. Panels MUST stay
 * mounted; only the specific action button is disabled.
 */
import { AlertTriangle, ShieldOff } from "lucide-react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useRuntimeCapabilities } from "@/platform/communication-hub/RuntimeContractContext";
import {
  getRuntimeRequirements,
  type RuntimeActionCode,
} from "@/platform/communication-hub/runtimeActionRequirements";
import type { ReactElement, ReactNode } from "react";
import { cloneElement, isValidElement } from "react";

interface RenderProps {
  disabled: boolean;
  loading: boolean;
  blockedReason: string | null;
}

interface Props {
  action: RuntimeActionCode;
  children: ReactElement | ((r: RenderProps) => ReactNode);
  actionLabel?: string;
  suppressBlockerNote?: boolean;
  extraCapabilities?: string[];
  /**
   * "full"    — legacy: dump the failing-capability table beneath the button.
   * "compact" — operator UX: one plain-language line + "Open Readiness Center".
   * Default is "compact"; Readiness Center opts into "full".
   */
  variant?: "compact" | "full";
}

export function RuntimeContractActionGate({
  action,
  children,
  actionLabel,
  suppressBlockerNote,
  extraCapabilities,
  variant = "compact",
}: Props) {
  const capabilities = [
    ...getRuntimeRequirements(action),
    ...(extraCapabilities ?? []),
  ];
  const status = useRuntimeCapabilities(capabilities);

  const disabled = !status.passes;
  const loading = status.loading;
  const blockedReason = disabled
    ? status.loading
      ? "Runtime contract loading — action fails closed."
      : status.error
      ? `Runtime contract error: ${status.error}`
      : `Runtime contract missing PASS on: ${status.failing.map((f) => f.object_name).join(", ") || "unknown capability"}`
    : null;

  const rendered =
    typeof children === "function"
      ? children({ disabled, loading, blockedReason })
      : isValidElement(children) && disabled
      ? cloneElement(children as ReactElement<any>, {
          disabled: true,
          "aria-disabled": true,
          "data-runtime-contract-blocked": "true",
        })
      : children;

  return (
    <div className="space-y-2" data-runtime-contract-action={action}>
      {rendered}
      {disabled && !suppressBlockerNote && variant === "compact" && (
        <Alert
          role="status"
          variant="destructive"
          className="border-amber-300 bg-amber-50 py-2 text-amber-900 [&>svg]:text-amber-800"
          data-runtime-contract-blocker="compact"
        >
          <ShieldOff className="h-3.5 w-3.5" />
          <AlertDescription className="text-xs">
            Action unavailable —{" "}
            <strong>{status.failing.length || "runtime"}</strong>{" "}
            readiness requirement{status.failing.length === 1 ? "" : "s"} need
            attention.{" "}
            <Link
              to="/admin/communication-hub/readiness"
              className="font-medium underline underline-offset-2"
            >
              Open Readiness Center
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}
      {disabled && !suppressBlockerNote && variant === "full" && (
        <Alert
          role="status"
          variant="destructive"
          className="border-amber-300 bg-amber-50 text-amber-900 [&>svg]:text-amber-800"
          data-runtime-contract-blocker="full"
        >
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="space-y-1 text-xs">
            <div className="flex items-center gap-2 font-medium">
              <ShieldOff className="h-3 w-3" />
              <span>
                {actionLabel ?? action} is disabled by the Communication Hub
                runtime contract.
              </span>
            </div>
            {status.failing.length > 0 && (
              <ul className="space-y-1">
                {status.failing.slice(0, 5).map((f, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className="border-red-300 bg-red-50 text-[10px] text-red-800"
                    >
                      {f.status}
                    </Badge>
                    <span className="font-mono text-[11px]">{f.object_name}</span>
                    <span className="text-[11px]">{f.requirement}</span>
                    {f.fix_action && (
                      <span className="text-[11px] italic">
                        Fix: {f.fix_action}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="text-[11px] italic">
              Recovery, inbox confirmation, Emergency Stop, disarm, diagnostics
              and evidence remain available on this panel.
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
