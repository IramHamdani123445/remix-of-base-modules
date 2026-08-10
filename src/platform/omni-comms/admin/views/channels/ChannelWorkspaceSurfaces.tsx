/**
 * Omni-Comms UX Simplification — channel workspace SURFACES.
 *
 * Renders the surface for the currently selected `?tab=` code. Extracted from
 * the Channels coordinator so the coordinator stays a thin selector and this
 * module owns nothing but composition.
 *
 * Boundaries: no RPC of its own, no provider SDK, no send behaviour. Every
 * data read and mutation stays inside the surface components it mounts.
 */
import React from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { isTabApplicable } from "@/platform/omni-comms/domain/channelCatalogue";
import type { OmniCommsRpcClient } from "@/platform/omni-comms/application/omniCommsRpcErrors";
import type { ChannelConfigurationSummary } from "@/platform/omni-comms/application/channelConfigurationTypes";
import type { EmailConfigSummary } from "@/platform/omni-comms/application/channelManagementTypes";
import { ChannelOverviewTab } from "./ChannelOverviewTab";
import { ChannelAccountsTab } from "./ChannelAccountsTab";
import { ChannelProvidersTab } from "./ChannelProvidersTab";
import { ChannelIdentitiesTab } from "./ChannelIdentitiesTab";
import { ChannelEndpointsTab } from "./ChannelEndpointsTab";
import { ChannelBindingsTab } from "./ChannelBindingsTab";
import { ChannelPoliciesTab } from "./ChannelPoliciesTab";
import { ChannelReleaseControlTab } from "./ChannelReleaseControlTab";
import { ChannelTestCentreTab } from "./ChannelTestCentreTab";
import { ChannelDiagnosticsTab } from "./ChannelDiagnosticsTab";
import { ProviderCredentialsSection } from "./ProviderCredentialsSection";
import { ControlledRecipientsSection } from "./ControlledRecipientsSection";
import type { ChannelUiDefinition, ChannelWorkspaceTab } from "./channelUiRegistry";
import type { EmailReadinessProjection } from "./emailReadiness";
import type { ChannelReadinessProjection } from "./channelReadiness";
import type { GoLiveReadinessProjection } from "./goLiveReadiness";

export interface ChannelWorkspaceSurfacesProps {
  definition: ChannelUiDefinition;
  client: OmniCommsRpcClient;
  orgId: string;
  departmentId: string | null;
  departmentName: string | null;
  tab: ChannelWorkspaceTab;
  onSelectTab: (tab: string) => void;
  isEmail: boolean;
  summary: EmailConfigSummary | null;
  channelSummary: ChannelConfigurationSummary | null;
  readiness: EmailReadinessProjection | null;
  channelReadiness: ChannelReadinessProjection | null;
  goLiveReadiness: GoLiveReadinessProjection | null;
  dispatchDiagnosticsUnavailable: boolean;
  deliveryTransport: React.ComponentProps<
    typeof ChannelTestCentreTab
  >["deliveryTransport"];
  releaseTransport: React.ComponentProps<
    typeof ChannelReleaseControlTab
  >["transport"];
  onRefreshEmail: () => void;
  onRefreshChannel: () => void;
  onRefreshTestCentre: () => void;
}

export const ChannelWorkspaceSurfaces: React.FC<ChannelWorkspaceSurfacesProps> = ({
  definition,
  client,
  orgId,
  departmentId,
  departmentName,
  tab,
  onSelectTab,
  isEmail,
  summary,
  channelSummary,
  readiness,
  channelReadiness,
  goLiveReadiness,
  dispatchDiagnosticsUnavailable,
  deliveryTransport,
  releaseTransport,
  onRefreshEmail,
  onRefreshChannel,
  onRefreshTestCentre,
}) => {
  const applicable = (t: ChannelWorkspaceTab) => isTabApplicable(definition.code, t);
  const onChanged = isEmail ? onRefreshEmail : onRefreshChannel;

  return (
    <Tabs value={tab} onValueChange={onSelectTab} className="min-w-0">
      <TabsContent value="overview">
        <ChannelOverviewTab
          definition={definition}
          readiness={readiness}
          channelReadiness={channelReadiness}
          configuration={channelSummary}
          summary={isEmail ? summary : null}
          goLive={isEmail ? goLiveReadiness : null}
          dispatchDiagnosticsUnavailable={dispatchDiagnosticsUnavailable}
        />
      </TabsContent>

      {applicable("accounts") ? (
        <TabsContent value="accounts" className="space-y-6">
          <ChannelAccountsTab
            definition={definition} client={client} orgId={orgId}
            summary={isEmail ? summary : null} onChanged={onChanged}
          />
          {/*
            Credential administration lives with the account it belongs to.
            Values are write-only and are never returned to the browser.
          */}
          <ProviderCredentialsSection
            client={client} orgId={orgId} onChanged={onChanged}
          />
        </TabsContent>
      ) : null}

      {applicable("identities") ? (
        <TabsContent value="identities">
          <ChannelIdentitiesTab
            definition={definition} client={client} orgId={orgId}
            departmentId={departmentId} departmentName={departmentName}
            onChanged={onChanged}
          />
        </TabsContent>
      ) : null}

      {applicable("endpoints") ? (
        <TabsContent value="endpoints">
          <ChannelEndpointsTab
            definition={definition} client={client} orgId={orgId}
            departmentId={departmentId} departmentName={departmentName}
            onChanged={onChanged}
          />
        </TabsContent>
      ) : null}

      {applicable("bindings") ? (
        <TabsContent value="bindings">
          <ChannelBindingsTab
            definition={definition} client={client} orgId={orgId}
            departmentId={departmentId} departmentName={departmentName}
            onChanged={onChanged}
          />
        </TabsContent>
      ) : null}

      {applicable("policies") ? (
        <TabsContent value="policies">
          <ChannelPoliciesTab
            definition={definition} client={client} orgId={orgId}
            departmentId={departmentId} departmentName={departmentName}
            onChanged={onChanged}
          />
        </TabsContent>
      ) : null}

      {applicable("providers") ? (
        <TabsContent value="providers">
          <ChannelProvidersTab
            definition={definition} client={client} onChanged={onRefreshChannel}
          />
        </TabsContent>
      ) : null}

      {applicable("test-centre") ? (
        <TabsContent value="test-centre" className="space-y-6">
          {/*
            A controlled test can only reach an approved address, so the
            allowlist is managed on the surface that runs the test.
          */}
          <ControlledRecipientsSection
            client={client} orgId={orgId} channel={definition.code}
          />
          <ChannelTestCentreTab
            definition={definition} client={client} orgId={orgId}
            departmentId={departmentId} departmentName={departmentName}
            deliveryTransport={deliveryTransport}
            onChanged={isEmail ? onRefreshTestCentre : onRefreshChannel}
          />
        </TabsContent>
      ) : null}

      {/* Release Control is an Email-only governance contract. */}
      {applicable("release-control") ? (
        <TabsContent value="release-control">
          <ChannelReleaseControlTab
            definition={definition} client={client} orgId={orgId}
            departmentId={departmentId} departmentName={departmentName}
            transport={releaseTransport} onChanged={onRefreshEmail}
          />
        </TabsContent>
      ) : null}

      {applicable("diagnostics") ? (
        <TabsContent value="diagnostics">
          <ChannelDiagnosticsTab
            definition={definition} client={client} orgId={orgId}
            departmentId={departmentId}
          />
        </TabsContent>
      ) : null}
    </Tabs>
  );
};

export default ChannelWorkspaceSurfaces;
