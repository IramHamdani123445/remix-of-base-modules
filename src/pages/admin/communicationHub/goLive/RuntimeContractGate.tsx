/**
 * Checkpoint A — Runtime contract gate.
 *
 * Wrap a provider-contacting panel or button with this gate. When the
 * required runtime-contract capabilities are not all PASS, the children
 * are hidden and a blocker card is rendered instead. Fail-closed while
 * the contract report is loading or errored.
 *
 * This is the only shared surface panels should use to gate provider
 * actions — individual panels must not fetch or interpret the contract
 * report independently.
 */
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useRuntimeCapabilities } from "@/platform/communication-hub/RuntimeContractContext";
import type { ReactNode } from "react";

interface Props {
  capabilities: string[];
  action: string;
  children: ReactNode;
}

export function RuntimeContractGate({ capabilities, action, children }: Props) {
  const status = useRuntimeCapabilities(capabilities);

  if (status.passes) {
    return <>{children}</>;
  }

  return (
    <Alert variant="destructive" className="border-amber-300 bg-amber-50 text-amber-900 [&>svg]:text-amber-800">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>
        Communication Hub runtime contract is not satisfied.
      </AlertTitle>
      <AlertDescription className="space-y-2 text-xs">
        <div>
          Action <span className="font-mono">{action}</span> is blocked because
          one or more required capabilities are not passing.
          {status.loading && " (Runtime contract still loading — action fails closed.)"}
          {status.error && ` Runtime contract error: ${status.error}`}
        </div>
        {status.failing.length > 0 && (
          <ul className="space-y-1">
            {status.failing.map((f, i) => (
              <li key={i} className="rounded border border-amber-200 bg-white/60 p-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-red-300 bg-red-50 text-red-800">
                    {f.status}
                  </Badge>
                  <span className="font-mono text-[11px]">{f.object_name}</span>
                </div>
                <div className="mt-1">{f.requirement}</div>
                {f.fix_action && (
                  <div className="mt-1 text-[11px] text-amber-800">Fix: {f.fix_action}</div>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="text-[11px] italic">
          Provider-contacting UI stays disabled until every listed capability
          is <span className="font-mono">PASS</span>. Repair the failing
          objects and re-run the runtime contract from the Runtime Contract
          card.
        </div>
      </AlertDescription>
    </Alert>
  );
}
