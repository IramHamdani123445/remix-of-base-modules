/**
 * Revalidation workspace — hosts the ControlledRevalidationPanel by itself
 * so operators can run governed re-send cycles. Consumes the shared workspace
 * context — no local RuntimeContractProvider or event state.
 */
import { useQuery } from "@tanstack/react-query";
import CommunicationHubWorkspaceShell, {
  CommunicationHubSectionCard,
} from "../components/CommunicationHubWorkspaceShell";
import { CommunicationHubGoLiveTabs } from "../components/CommunicationHubGoLiveTabs";
import { ControlledRevalidationPanel } from "./ControlledRevalidationPanel";
import ModuleEventSelectors from "./ModuleEventSelectors";
import { useCommunicationHubWorkspace } from "./WorkspaceContext";
import { getEventGoLiveStatus } from "@/platform/communication-hub/eventGoLiveStatusService";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export default function RevalidationWorkspacePage() {
  const { moduleCode, eventCode, channel, hasSelection, setSelection } = useCommunicationHubWorkspace();

  const { data: goLiveStatus } = useQuery({
    queryKey: ["comm-hub-golive-status", moduleCode, eventCode, channel],
    queryFn: () => getEventGoLiveStatus({ moduleCode, eventCode, channel }),
    enabled: hasSelection,
  });

  const stage6 = goLiveStatus?.stage6 as any;
  const baselineReady = !!stage6?.one_real_email_certification_id;

  return (
    <CommunicationHubWorkspaceShell
      title="Controlled Revalidation"
      purpose="Governed re-send cycles that preserve the production baseline. Controlled delivery remains gated until the hardened runtime is approved."
      section="Go-Live"
      risk="high-risk"
    >
      <CommunicationHubGoLiveTabs />

      <CommunicationHubSectionCard title="Event context">
        <ModuleEventSelectors
          moduleCode={moduleCode}
          eventCode={eventCode}
          onModuleChange={(m) => setSelection({ moduleCode: m, eventCode: "" })}
          onSelect={(r) => setSelection({ moduleCode: r.moduleCode, eventCode: r.eventCode, channel: r.channel })}
        />
      </CommunicationHubSectionCard>

      {hasSelection && !baselineReady && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>No production baseline yet</AlertTitle>
          <AlertDescription>
            This event has not completed Stage 6 (Send One Real Email). Revalidation is only available once a
            production baseline exists. Return to Operations to complete initial certification.
          </AlertDescription>
        </Alert>
      )}

      {hasSelection && baselineReady && (
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
  );
}
