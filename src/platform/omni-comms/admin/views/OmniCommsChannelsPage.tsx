/**
 * Omni-Comms C1 — Channels page coordinator.
 *
 * Provider-independent omnichannel workspace. Default view is the channel
 * catalogue; `?channel=` opens a selected-channel workspace with the common
 * tabs. All email behaviour is preserved and delegated to the tab components
 * under ./channels, which call the existing SECURITY DEFINER RPC wrappers.
 *
 * Boundaries: no provider SDK import, no send facade call, no dispatch, no
 * runtime mutation, no database migration.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOmniCommsChannelWorkspaceTab } from "../hooks/useOmniCommsTabParam";
import { useOmniCommsRpcClient } from "../hooks/useOmniCommsRpcClient";
import { useOmniCommsSelectedChannel } from "../hooks/useOmniCommsChannelParam";
import { useOmniCommsTenant } from "../../context/OmniCommsTenantContext";
import { getEmailConfigSummary } from "@/platform/omni-comms/application/channelManagementService";
import type { EmailConfigSummary } from "@/platform/omni-comms/application/channelManagementTypes";
import { ChannelCatalogue } from "./channels/ChannelCatalogue";
import { ChannelWorkspaceHeader } from "./channels/ChannelWorkspaceHeader";
import { ChannelOverviewTab } from "./channels/ChannelOverviewTab";
import { ChannelAccountsTab } from "./channels/ChannelAccountsTab";
import { ChannelIdentitiesTab } from "./channels/ChannelIdentitiesTab";
import { ChannelEndpointsTab } from "./channels/ChannelEndpointsTab";
import { ChannelBindingsTab } from "./channels/ChannelBindingsTab";
import { ChannelPoliciesTab } from "./channels/ChannelPoliciesTab";
import { ChannelTestCentreTab } from "./channels/ChannelTestCentreTab";
import { ChannelDiagnosticsTab } from "./channels/ChannelDiagnosticsTab";
import {
  CHANNEL_WORKSPACE_TAB_LABELS,
  isTabDisabled,
  resolveChannelUi,
  type ChannelWorkspaceTab,
} from "./channels/channelUiRegistry";
import { projectEmailReadiness } from "./channels/emailReadiness";
import { toastError } from "./channels/channelFormPrimitives";

export const OmniCommsChannelsPage: React.FC = () => {
  const client = useOmniCommsRpcClient();
  const { organizationId: orgId, organizationName, departmentName } = useOmniCommsTenant();
  const [summary, setSummary] = useState<EmailConfigSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const { selected, selectChannel, clearChannel } = useOmniCommsSelectedChannel();
  const definition = selected ? resolveChannelUi(selected.channel) : null;
  const [tab, setTab] = useOmniCommsChannelWorkspaceTab();

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      setSummary(await getEmailConfigSummary(client, orgId));
    } catch (e) {
      toastError(e, "Failed to load email configuration");
    } finally {
      setLoading(false);
    }
  }, [client, orgId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!orgId) {
    return (
      <div className="space-y-4" data-testid="omni-comms-channels-page">
        <h1 className="text-2xl font-semibold">Channels</h1>
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Select an organisation</AlertTitle>
          <AlertDescription>
            Channel configuration is scoped to a specific organisation. Use the
            organisation selector in the module header above.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // ── Catalogue (default view) ──────────────────────────────────────
  if (!definition) {
    const emailReadiness = projectEmailReadiness(summary);
    return (
      <div className="space-y-6" data-testid="omni-comms-channels-page">
        <div>
          <h1 className="text-2xl font-semibold">Channels</h1>
          <p className="text-sm text-muted-foreground">
            Omnichannel Communications · configuration only. No provider
            dispatch is implemented.
            {organizationName ? ` · ${organizationName}` : ""}
          </p>
        </div>
        <ChannelCatalogue
          onSelect={selectChannel}
          emailCounts={{
            providerAccounts: emailReadiness.counts.accounts,
            activeIdentities: emailReadiness.counts.activeSenders,
            readiness: emailReadiness.label,
            readinessExplanation: emailReadiness.explanation,
          }}
        />
      </div>
    );
  }

  // ── Selected channel workspace ────────────────────────────────────
  const isEmail = definition.code === "email";
  const readiness = isEmail ? projectEmailReadiness(summary) : null;

  return (
    <div className="space-y-6" data-testid="omni-comms-channels-page">
      <ChannelWorkspaceHeader
        definition={definition}
        organizationName={organizationName}
        departmentName={departmentName}
        loading={loading}
        readiness={readiness}
        onBack={clearChannel}
        onRefresh={isEmail ? () => void refresh() : undefined}
      />

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          {(definition.tabs as ChannelWorkspaceTab[]).map((t) => (
            <TabsTrigger
              key={t}
              value={t}
              disabled={isTabDisabled(definition, t)}
            >
              {CHANNEL_WORKSPACE_TAB_LABELS[t]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <ChannelOverviewTab
            definition={definition}
            readiness={readiness}
            summary={isEmail ? summary : null}
          />
        </TabsContent>
        <TabsContent value="accounts">
          <ChannelAccountsTab
            definition={definition} client={client} orgId={orgId}
            summary={isEmail ? summary : null} onChanged={refresh}
          />
        </TabsContent>
        <TabsContent value="identities">
          <ChannelIdentitiesTab
            definition={definition} client={client} orgId={orgId}
            summary={isEmail ? summary : null} onChanged={refresh}
          />
        </TabsContent>
        <TabsContent value="endpoints">
          <ChannelEndpointsTab definition={definition} />
        </TabsContent>
        <TabsContent value="bindings">
          <ChannelBindingsTab
            definition={definition} client={client}
            summary={isEmail ? summary : null} onChanged={refresh}
          />
        </TabsContent>
        <TabsContent value="policies">
          <ChannelPoliciesTab
            definition={definition} client={client} orgId={orgId}
            summary={isEmail ? summary : null} onChanged={refresh}
          />
        </TabsContent>
        <TabsContent value="test-centre">
          <ChannelTestCentreTab definition={definition} />
        </TabsContent>
        <TabsContent value="diagnostics">
          <ChannelDiagnosticsTab definition={definition} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default OmniCommsChannelsPage;
