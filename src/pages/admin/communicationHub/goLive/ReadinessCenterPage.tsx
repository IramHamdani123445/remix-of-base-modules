/**
 * Readiness Center — diagnostic surface for all runtime-contract, baseline,
 * automation and CI readiness signals. This is where operators go when the
 * compact readiness strip on Operations says BLOCKED or ACTION_REQUIRED.
 *
 * Read-only. All action-capable buttons stay on Operations and are gated
 * button-by-button via RuntimeContractActionGate.
 */
import { useState } from "react";
import CommunicationHubWorkspaceShell, {
  CommunicationHubSectionCard,
} from "../components/CommunicationHubWorkspaceShell";
import { CommunicationHubGoLiveTabs } from "../components/CommunicationHubGoLiveTabs";
import { RuntimeContractProvider } from "@/platform/communication-hub/RuntimeContractContext";
import { RuntimeContractCard } from "../goLive/RuntimeContractCard";
import { DiagnosticBundlePanel } from "../goLive/DiagnosticBundlePanel";
import { LegacyBaselineAttestationPanel } from "../goLive/LegacyBaselineAttestationPanel";
import ModuleEventSelectors from "../goLive/ModuleEventSelectors";

export default function ReadinessCenterPage() {
  const [moduleCode, setModuleCode] = useState<string>("");
  const [eventCode, setEventCode] = useState<string>("");
  const channel = "email";
  const hasSelection = !!moduleCode && !!eventCode;

  return (
    <RuntimeContractProvider>
      <CommunicationHubWorkspaceShell
        title="Readiness Center"
        purpose="Runtime contract, baseline convergence, automation readiness and CI evidence."
        section="Go-Live"
        risk="read-only"
      >
        <CommunicationHubGoLiveTabs />

        <CommunicationHubSectionCard
          title="Overall runtime contract"
          description="Every capability required by any provider-touching action."
        >
          <RuntimeContractCard />
        </CommunicationHubSectionCard>

        <CommunicationHubSectionCard
          title="Event context"
          description="Choose the module and event to load event-scoped readiness."
        >
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

        {hasSelection && (
          <>
            <CommunicationHubSectionCard
              title="Baseline convergence"
              description="Current evidence fingerprint vs active legacy baseline attestation."
            >
              <LegacyBaselineAttestationPanel
                moduleCode={moduleCode}
                eventCode={eventCode}
                channel={channel}
              />
            </CommunicationHubSectionCard>

            <CommunicationHubSectionCard
              title="Diagnostic bundle"
              description="Downloadable evidence for support and audit."
            >
              <DiagnosticBundlePanel
                moduleCode={moduleCode}
                eventCode={eventCode}
                channel={channel}
              />
            </CommunicationHubSectionCard>
          </>
        )}
      </CommunicationHubWorkspaceShell>
    </RuntimeContractProvider>
  );
}
