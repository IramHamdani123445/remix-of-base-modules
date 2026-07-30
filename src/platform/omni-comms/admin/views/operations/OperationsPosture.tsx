/**
 * Omni-Comms Operations — runtime posture badges and certification banner.
 *
 * The posture is DERIVED from the readiness manifest / registries. It is not
 * a second, hand-maintained product status.
 */
import React from "react";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { OMNI_COMMS_OPERATIONAL_POSTURE } from "@/platform/omni-comms/registry/readinessManifest";

const YES = "bg-primary/10 text-primary";
const NO = "bg-muted text-muted-foreground";

export const OperationsPosture: React.FC = () => {
  const p = OMNI_COMMS_OPERATIONAL_POSTURE;
  const rows: Array<[string, boolean]> = [
    ["Schema available", p.schemaAvailable],
    ["Runtime implemented", p.runtimeImplemented],
    ["Runtime certified", p.runtimeCertified],
    ["Live delivery enabled", p.liveDeliveryEnabled],
  ];

  return (
    <div className="space-y-3" data-testid="omni-comms-operations-posture">
      {!p.runtimeCertified && (
        <Alert data-testid="omni-comms-certification-warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Runtime certification pending</AlertTitle>
          <AlertDescription className="text-sm">
            Runtime implementation is present, but privileged end-to-end
            certification is still pending. No live provider delivery is enabled.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {rows.map(([label, value]) => (
          <Badge
            key={label}
            variant="outline"
            className={value ? YES : NO}
            data-testid={`omni-comms-posture-${label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {label}: {value ? "Yes" : "No"}
          </Badge>
        ))}
      </div>
    </div>
  );
};

export default OperationsPosture;
