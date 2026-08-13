/**
 * Omni-Comms — the SIMPLE Email operator workspace.
 *
 * Overview / Settings / Activity. The detailed workspace surfaces are still
 * mounted underneath: a Settings card opens the same surface, and Technical
 * details exposes the governance and evidence tabs, so every legacy `?tab=`
 * deep link resolves to exactly the same screen it always did.
 *
 * Presentation only. The single delivery switch sends scope and intent to the
 * trusted Edge boundary; every safety decision stays server-side.
 */
import React from 'react';
import { ChannelWorkspaceHeader } from '../ChannelWorkspaceHeader';
import { ChannelWorkspaceSurfaces } from '../ChannelWorkspaceSurfaces';
import { toastError } from '../channelFormPrimitives';
import type { ChannelWorkspaceTab } from '../channelUiRegistry';
import {
  buildDeliveryRequestBody,
  type DeliveryToggleSnapshot,
} from '@/platform/omni-comms/application/deliveryToggleService';
import {
  CHANNEL_SETTINGS_TABS,
  CHANNEL_TECHNICAL_TABS,
  landingTabForSimpleSection,
  simpleSectionForTab,
  type ChannelSimpleSection,
} from '../../../navigation/channelSimpleSections';
import { ChannelSimpleNav } from './ChannelSimpleNav';
import { SimpleOverviewSurface } from './SimpleOverviewSurface';
import { SimpleSettingsSurface, type SimpleSettingsCard } from './SimpleSettingsSurface';
import { SimpleActivitySurface, type SimpleActivityRow } from './SimpleActivitySurface';
import { SimpleTestDeliveryCard } from './SimpleTestDeliveryCard';
import { TechnicalDetailsPanel } from './TechnicalDetailsPanel';

type SurfaceProps = React.ComponentProps<typeof ChannelWorkspaceSurfaces>;

export interface ChannelSimpleWorkspaceProps {
  definition: SurfaceProps['definition'];
  client: SurfaceProps['client'];
  orgId: string;
  departmentId: string | null;
  departmentName: string | null;
  organizationName: string | null;
  tab: ChannelWorkspaceTab;
  setTab: (tab: ChannelWorkspaceTab) => void;
  applicable: (tab: ChannelWorkspaceTab) => boolean;
  loading: boolean;
  summary: SurfaceProps['summary'];
  channelSummary: SurfaceProps['channelSummary'];
  readiness: SurfaceProps['readiness'];
  channelReadiness: SurfaceProps['channelReadiness'];
  goLiveReadiness: SurfaceProps['goLiveReadiness'];
  dispatchRow: unknown;
  deliveryTransport: SurfaceProps['deliveryTransport'];
  releaseTransport: SurfaceProps['releaseTransport'];
  testCentre: { selected_binding_id: string | null } | null;
  deliveryDiagnostics:
  { can_execute?: boolean; deliveries: readonly {
    id: string; target_masked: string; status: string;
    completed_at: string | null; requested_at: string;
  }[] } | null;
  deliveryToggle: DeliveryToggleSnapshot | null;
  toggleBusy: boolean;
  setToggleBusy: (busy: boolean) => void;
  refresh: () => Promise<void>;
  refreshChannel: () => Promise<void>;
  refreshTestCentre: () => void;
  clearChannel: () => void;
}

export const ChannelSimpleWorkspace: React.FC<ChannelSimpleWorkspaceProps> = ({
  definition, client, orgId, departmentId, departmentName, organizationName,
  tab, setTab, applicable, loading, summary, channelSummary, readiness,
  channelReadiness, goLiveReadiness, dispatchRow, deliveryTransport,
  releaseTransport, testCentre, deliveryDiagnostics, deliveryToggle,
  toggleBusy, setToggleBusy, refresh, refreshChannel, refreshTestCentre,
  clearChannel,
}) => {
  const simpleSection = simpleSectionForTab(tab);
  const goToSection = (section: ChannelSimpleSection) => setTab(landingTabForSimpleSection(section));

  const surfaceFor = (t: ChannelWorkspaceTab) => (
    <ChannelWorkspaceSurfaces
      definition={definition}
      client={client}
      orgId={orgId}
      departmentId={departmentId}
      departmentName={departmentName}
      tab={t}
      onSelectTab={setTab}
      isEmail
      summary={summary}
      channelSummary={channelSummary}
      readiness={readiness}
      channelReadiness={channelReadiness}
      goLiveReadiness={goLiveReadiness}
      dispatchDiagnosticsUnavailable={dispatchRow === null}
      deliveryTransport={deliveryTransport}
      releaseTransport={releaseTransport}
      onRefreshEmail={refresh}
      onRefreshChannel={refreshChannel}
      onRefreshTestCentre={refreshTestCentre}
    />
  );

  const technicalDetails = (
    <TechnicalDetailsPanel>
      {CHANNEL_TECHNICAL_TABS.filter(applicable).map((t) => (
        <div key={t}>{surfaceFor(t as ChannelWorkspaceTab)}</div>
      ))}
    </TechnicalDetailsPanel>
  );

  const indicatorReady = (key: string) =>
    (deliveryToggle?.indicators ?? []).find((i) => i.key === key)?.ready === true;

  const SETTINGS_INDICATOR: Record<string, string> = {
    accounts: 'provider',
    identities: 'sender_domain',
    endpoints: 'sender_domain',
    bindings: 'events_templates',
    policies: 'safety',
    providers: 'provider',
  };

  const settingsCards: SimpleSettingsCard[] = CHANNEL_SETTINGS_TABS
    .filter((t) => applicable(t as ChannelWorkspaceTab))
    .map((t) => {
      const ready = indicatorReady(SETTINGS_INDICATOR[t] ?? '');
      return {
        tab: t,
        value: ready ? 'Configured' : 'Not configured yet',
        status: ready ? 'Ready' : 'Needs attention',
        ready,
      };
    });

  const activityRows: SimpleActivityRow[] = (deliveryDiagnostics?.deliveries ?? [])
    .slice(0, 20)
    .map((d) => ({
      id: d.id,
      eventCode: null,
      recipient: d.target_masked,
      outcome:
        d.status === 'accepted' ? 'accepted'
          : d.status === 'failed' ? 'failed'
            : 'waiting',
      occurredAt: d.completed_at ?? d.requested_at,
    }));

  const requestDelivery = (next: boolean) => {
    if (!releaseTransport) return;
    setToggleBusy(true);
    void (async () => {
      try {
        const res = await releaseTransport.invoke(buildDeliveryRequestBody({
          organizationId: orgId,
          departmentId: departmentId ?? null,
          channel: 'email',
          intent: next ? 'enable' : 'disable',
        }));
        if (res.error) throw new Error(res.error.message ?? 'Delivery request failed');
        await refresh();
      } catch (e) {
        toastError(e, 'The delivery switch could not be changed');
      } finally {
        setToggleBusy(false);
      }
    })();
  };

  return (
    <div className="space-y-6" data-testid="omni-comms-channels-page">
      <ChannelWorkspaceHeader
        definition={definition}
        organizationName={organizationName}
        departmentName={departmentName}
        loading={loading}
        readiness={readiness}
        channelReadiness={channelReadiness}
        onBack={clearChannel}
        onRefresh={() => void refresh()}
      />

      <ChannelSimpleNav activeSection={simpleSection} onSelectSection={goToSection} />

      {simpleSection === 'overview' ? (
        <SimpleOverviewSurface
          channelLabel={definition.name}
          moduleLabel={departmentName ?? organizationName ?? null}
          snapshot={deliveryToggle}
          loading={loading}
          busy={toggleBusy}
          onToggleDelivery={requestDelivery}
          onFix={(t) => setTab(t as ChannelWorkspaceTab)}
          testCard={
            <SimpleTestDeliveryCard
              client={client}
              transport={deliveryTransport}
              organizationId={orgId}
              departmentId={departmentId ?? null}
              channel="email"
              channelLabel={definition.name}
              bindingId={testCentre?.selected_binding_id ?? null}
              canExecute={deliveryDiagnostics?.can_execute !== false}
            />
          }
          technicalDetails={technicalDetails}
        />
      ) : null}

      {simpleSection === 'settings' ? (
        <SimpleSettingsSurface
          cards={settingsCards}
          manageTab={CHANNEL_SETTINGS_TABS.includes(tab) ? tab : null}
          onManage={(t) => setTab(t as ChannelWorkspaceTab)}
          onCloseManage={() => setTab(landingTabForSimpleSection('settings') as ChannelWorkspaceTab)}
          manageSurface={
            CHANNEL_SETTINGS_TABS.includes(tab) ? surfaceFor(tab) : null
          }
          onManageEvents={() => setTab('bindings')}
          technicalDetails={technicalDetails}
        />
      ) : null}

      {simpleSection === 'activity' ? (
        <SimpleActivitySurface
          loading={loading}
          healthy={deliveryToggle?.evidence.schedulerHealthy === true}
          queueDepth={deliveryToggle?.evidence.queueDepth ?? null}
          schedulerLastRunAt={deliveryToggle?.evidence.schedulerLastRunAt ?? null}
          lastAcceptedAt={deliveryToggle?.evidence.lastAcceptedAt ?? null}
          lastDeliveredAt={deliveryToggle?.evidence.lastDeliveredAt ?? null}
          rows={activityRows}
          technicalDetails={technicalDetails}
        />
      ) : null}
    </div>
  );
};

export default ChannelSimpleWorkspace;
