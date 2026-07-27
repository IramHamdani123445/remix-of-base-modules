/**
 * Readiness Center — diagnostic surface for all runtime-contract, baseline,
 * automation and CI readiness signals. Consumes the shared workspace context
 * mounted by CommunicationHubWorkspaceLayout — this page no longer wraps
 * RuntimeContractProvider or owns local module/event state.
 */
import CommunicationHubWorkspaceShell, {
  CommunicationHubSectionCard,
} from "../components/CommunicationHubWorkspaceShell";
import { CommunicationHubGoLiveTabs } from "../components/CommunicationHubGoLiveTabs";
import { RuntimeContractCard } from "./RuntimeContractCard";
import { DiagnosticBundlePanel } from "./DiagnosticBundlePanel";
import { LegacyBaselineAttestationPanel } from "./LegacyBaselineAttestationPanel";
import ModuleEventSelectors from "./ModuleEventSelectors";
import { useCommunicationHubWorkspace } from "./WorkspaceContext";

export default function ReadinessCenterPage() {
  const { moduleCode, eventCode, channel, hasSelection, setSelection } = useCommunicationHubWorkspace();

  return (
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
          onModuleChange={(m) => setSelection({ moduleCode: m, eventCode: "" })}
          onSelect={(r) => setSelection({ moduleCode: r.moduleCode, eventCode: r.eventCode, channel: r.channel })}
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
  );
}
