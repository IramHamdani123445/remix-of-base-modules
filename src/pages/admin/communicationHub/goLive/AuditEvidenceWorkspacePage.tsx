/**
 * Audit & Evidence workspace — technical identifiers, fingerprints and
 * lineage anchors for the selected event. Read-only. Consumes the shared
 * workspace context — no local RuntimeContractProvider or event state.
 */
import { useQuery } from "@tanstack/react-query";
import CommunicationHubWorkspaceShell, {
  CommunicationHubSectionCard,
} from "../components/CommunicationHubWorkspaceShell";
import { CommunicationHubGoLiveTabs } from "../components/CommunicationHubGoLiveTabs";
import ModuleEventSelectors from "./ModuleEventSelectors";
import { useCommunicationHubWorkspace } from "./WorkspaceContext";
import { getEventGoLiveStatus } from "@/platform/communication-hub/eventGoLiveStatusService";

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[240px_1fr] gap-3 py-1 text-sm">
      <div className="text-muted-foreground">{label}</div>
      <code className="font-mono text-xs break-all">{value ?? "—"}</code>
    </div>
  );
}

export default function AuditEvidenceWorkspacePage() {
  const { moduleCode, eventCode, channel, hasSelection, setSelection } = useCommunicationHubWorkspace();

  const { data: goLiveStatus } = useQuery({
    queryKey: ["comm-hub-audit-golive-status", moduleCode, eventCode, channel],
    queryFn: () => getEventGoLiveStatus({ moduleCode, eventCode, channel }),
    enabled: hasSelection,
  });

  const s6 = goLiveStatus?.stage6 as any;
  const s7 = (goLiveStatus as any)?.stage7;
  const s8 = (goLiveStatus as any)?.stage8;

  return (
    <CommunicationHubWorkspaceShell
      title="Audit & Evidence"
      purpose="Technical identifiers, fingerprints and lineage for the selected event."
      section="Go-Live"
      risk="read-only"
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

      {hasSelection && (
        <>
          <CommunicationHubSectionCard title="Stage 6 — One Real Email">
            <KV label="Execution ID" value={s6?.one_real_email_execution_id} />
            <KV label="Certification ID" value={s6?.one_real_email_certification_id} />
            <KV label="Certification status" value={s6?.one_real_email_certification_status} />
            <KV label="Provider message ID" value={s6?.provider_message_id} />
            <KV label="Delivery attempt ID" value={s6?.delivery_attempt_id} />
            <KV label="Trace ID" value={s6?.trace_id} />
            <KV label="Verified recipient" value={s6?.manual_verified_recipient} />
            <KV label="Verified at" value={s6?.manual_verified_at} />
            <KV label="Production lineage ID" value={s6?.production_lineage_id} />
            <KV label="Evidence fingerprint v2" value={s6?.evidence_fingerprint_v2} />
          </CommunicationHubSectionCard>

          <CommunicationHubSectionCard title="Stage 7 — Manual Production">
            <KV label="Event certification ID" value={s7?.manual_event_certification_id} />
            <KV label="Event status" value={s7?.manual_event_status} />
            <KV label="Approved at" value={s7?.manual_approved_at} />
            <KV label="Latest observation ID" value={s7?.latest_manual_observation_id} />
            <KV label="Latest observation message ID" value={s7?.latest_manual_observation_message_id} />
            <KV label="Latest observation attempt ID" value={s7?.latest_manual_observation_attempt_id} />
            <KV label="Latest observation trace ID" value={s7?.latest_manual_observation_trace_id} />
          </CommunicationHubSectionCard>

          <CommunicationHubSectionCard title="Stage 8 — Automated Production">
            <KV label="Automation arm audit ID" value={s8?.arm_audit_id} />
            <KV label="Armed at" value={s8?.automation_armed_at} />
            <KV label="Last heartbeat" value={s8?.last_scheduler_heartbeat_at} />
          </CommunicationHubSectionCard>
        </>
      )}
    </CommunicationHubWorkspaceShell>
  );
}
