/**
 * Revalidation workspace — hosts the ControlledRevalidationPanel by itself
 * so operators can run governed re-send cycles without the noise of the
 * Operations lifecycle.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import CommunicationHubWorkspaceShell, {
  CommunicationHubSectionCard,
} from "../components/CommunicationHubWorkspaceShell";
import { CommunicationHubGoLiveTabs } from "../components/CommunicationHubGoLiveTabs";
import { RuntimeContractProvider } from "@/platform/communication-hub/RuntimeContractContext";
import { ControlledRevalidationPanel } from "../goLive/ControlledRevalidationPanel";
import ModuleEventSelectors from "../goLive/ModuleEventSelectors";
import { getEventGoLiveStatus } from "@/platform/communication-hub/eventGoLiveStatusService";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export default function RevalidationWorkspacePage() {
  const [moduleCode, setModuleCode] = useState<string>("");
  const [eventCode, setEventCode] = useState<string>("");
  const channel = "email";

  const { data: goLiveStatus } = useQuery({
    queryKey: ["comm-hub-golive-status", moduleCode, eventCode, channel],
    queryFn: () => getEventGoLiveStatus({ moduleCode, eventCode, channel }),
    enabled: !!moduleCode && !!eventCode,
  });

  const stage6 = goLiveStatus?.stage6 as any;
  const baselineReady = !!stage6?.one_real_email_certification_id;

  return (
    <RuntimeContractProvider>
      <CommunicationHubWorkspaceShell
        title="Controlled Revalidation"
        purpose="Governed re-send cycles that preserve the production baseline."
        section="Go-Live"
        risk="high-risk"
      >
        <CommunicationHubGoLiveTabs />

        <CommunicationHubSectionCard title="Event context">
          <ModuleEventSelectors
            moduleCode={moduleCode}
            eventCode={eventCode}
            onModuleChange={(m) => { setModuleCode(m); setEventCode(""); }}
            onSelect={(r) => {
              setModuleCode(r.moduleCode);
              setEventCode(r.eventCode);
            }}
          />
        </CommunicationHubSectionCard>

        {moduleCode && eventCode && !baselineReady && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>No production baseline yet</AlertTitle>
            <AlertDescription>
              This event has not completed Stage 6 (Send One Real Email). Revalidation is only available once a
              production baseline exists. Return to Operations to complete initial certification.
            </AlertDescription>
          </Alert>
        )}

        {moduleCode && eventCode && baselineReady && (
          <ControlledRevalidationPanel
            moduleCode={moduleCode}
            eventCode={eventCode}
            channel={channel}
            productionAnchor={{
              oreCertificationId: stage6?.one_real_email_certification_id ?? null,
              verifiedRecipient: stage6?.manual_verified_recipient ?? null,
              verifiedAt: stage6?.manual_verified_at ?? null,
              productionLineageId: stage6?.production_lineage_id ?? null,
              baselineFingerprint: stage6?.evidence_fingerprint_v2 ?? null,
            }}
          />
        )}
      </CommunicationHubWorkspaceShell>
    </RuntimeContractProvider>
  );
}
