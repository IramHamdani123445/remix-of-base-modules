/**
 * Omni-Comms C1 / CG1 — Channels page COORDINATOR.
 *
 * Provider-independent omnichannel workspace. Default view is the channel
 * catalogue; `?channel=` opens a selected-channel workspace with the tabs the
 * canonical capability matrix declares for that channel.
 *
 * CG1 rules honoured here:
 *   - The coordinator selects and renders. All channel-aware summary
 *     composition lives in `loadChannelConfigurationSummary(...)`.
 *   - Email behaviour is preserved verbatim (same RPCs, same projection).
 *   - Release Control summary/mutation contracts are invoked for Email ONLY.
 *   - A tab outside the channel's capability falls back to Overview.
 *   - Unloaded/unavailable data is never rendered as zero.
 *
 * Boundaries: no provider SDK import, no send facade call, no dispatch, no
 * runtime mutation, no database migration.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useOmniCommsChannelWorkspaceTab } from "../hooks/useOmniCommsTabParam";
import { useOmniCommsCertificationPosture } from "../hooks/useOmniCommsCertificationPosture";
import { useChannelTestDeliveryTransport } from "@/platform/omni-comms/admin/hooks/useChannelTestDeliveryTransport";

import { useChannelReleaseControlTransport } from "@/platform/omni-comms/admin/hooks/useChannelReleaseControlTransport";
import { useOmniCommsRpcClient } from "../hooks/useOmniCommsRpcClient";
import { useOmniCommsSelectedChannel } from "../hooks/useOmniCommsChannelParam";
import { useOmniCommsTenant } from "../../context/OmniCommsTenantContext";
import { getEmailConfigSummary } from "@/platform/omni-comms/application/channelManagementService";
import { getChannelPolicySummary } from "@/platform/omni-comms/application/channelPolicyService";
import { getChannelTestCentreSummary } from "@/platform/omni-comms/application/channelTestCentreService";
import { getChannelReleaseControlSummary } from "@/platform/omni-comms/application/channelReleaseControlService";
import {
  loadChannelCatalogueCounts,
  loadChannelConfigurationSummary,
} from "@/platform/omni-comms/application/channelConfigurationService";
import type { ChannelConfigurationSummary } from "@/platform/omni-comms/application/channelConfigurationTypes";
import type { ChannelReleaseControlSummary } from "@/platform/omni-comms/application/channelReleaseControlTypes";
import type { ChannelTestCentreSummary } from "@/platform/omni-comms/application/channelTestCentreTypes";
import type { ChannelPolicySummary } from "@/platform/omni-comms/application/channelPolicyTypes";
import type { EmailConfigSummary } from "@/platform/omni-comms/application/channelManagementTypes";
import {
  OMNI_COMMS_CHANNEL_CATALOGUE,
  isTabApplicable,
  type OmniCommsChannel,
} from "@/platform/omni-comms/domain/channelCatalogue";
import { ChannelCatalogue, type ChannelCatalogueReadiness } from "./channels/ChannelCatalogue";
import { ChannelWorkspaceHeader } from "./channels/ChannelWorkspaceHeader";
import { ChannelWorkspaceRail } from "./channels/ChannelWorkspaceRail";

import { ChannelOverviewTab } from "./channels/ChannelOverviewTab";
import { ChannelAccountsTab } from "./channels/ChannelAccountsTab";
import { ChannelProvidersTab } from "./channels/ChannelProvidersTab";
import { ChannelIdentitiesTab } from "./channels/ChannelIdentitiesTab";
import { ChannelEndpointsTab } from "./channels/ChannelEndpointsTab";
import { ChannelBindingsTab } from "./channels/ChannelBindingsTab";
import { ChannelPoliciesTab } from "./channels/ChannelPoliciesTab";
import { ChannelReleaseControlTab } from "./channels/ChannelReleaseControlTab";
import { ChannelTestCentreTab } from "./channels/ChannelTestCentreTab";
import { ChannelDiagnosticsTab } from "./channels/ChannelDiagnosticsTab";
import {
  isTabDisabled,
  resolveChannelUi,
  type ChannelWorkspaceTab,
} from "./channels/channelUiRegistry";

import { projectEmailReadiness } from "./channels/emailReadiness";
import { projectChannelReadiness } from "./channels/channelReadiness";
import { getChannelTestDeliveryDiagnostics } from "@/platform/omni-comms/application/channelTestDeliveryService";
import type { ChannelTestDeliveryDiagnostics } from "@/platform/omni-comms/application/channelTestDeliveryTypes";
import { toastError } from "./channels/channelFormPrimitives";

/** Channels whose counts are worth reading for the catalogue cards. */
const COUNTABLE_CHANNELS: readonly OmniCommsChannel[] = OMNI_COMMS_CHANNEL_CATALOGUE
  .filter((d) => d.databaseSupported && d.channel !== "email")
  .map((d) => d.channel);

export const OmniCommsChannelsPage: React.FC = () => {
  const client = useOmniCommsRpcClient();
  const deliveryTransport = useChannelTestDeliveryTransport();
  const releaseTransport = useChannelReleaseControlTransport();
  const { organizationId: orgId, organizationName, departmentId, departmentName } = useOmniCommsTenant();
  // Environment only decides whether the non-production Safe Test rail link is
  // offered. No probe is triggered from this page.
  const { environment } = useOmniCommsCertificationPosture({ autoProbe: false });

  const [summary, setSummary] = useState<EmailConfigSummary | null>(null);
  // C4B — the shared Email readiness projection resolves policy state from the
  // generic policy summary (genuine records only; reference never contributes).
  const [emailPolicy, setEmailPolicy] = useState<ChannelPolicySummary | null>(null);
  // C5A — readiness requires a CURRENT passed configuration preflight. Loading
  // this summary performs no send and contacts no provider.
  const [testCentre, setTestCentre] = useState<ChannelTestCentreSummary | null>(null);
  // Controlled test delivery evidence. Read-only; loading it sends nothing.
  const [deliveryDiagnostics, setDeliveryDiagnostics] =
    useState<ChannelTestDeliveryDiagnostics | null>(null);
  // C6 — genuine Release Control governance (EMAIL ONLY). Reading it sends nothing.
  const [releaseSummary, setReleaseSummary] = useState<ChannelReleaseControlSummary | null>(null);
  const [loading, setLoading] = useState(false);

  // CG1 — generic, channel-aware configuration summaries.
  const [channelSummary, setChannelSummary] = useState<ChannelConfigurationSummary | null>(null);
  const [channelLoading, setChannelLoading] = useState(false);
  const [catalogueSummaries, setCatalogueSummaries] =
    useState<Record<string, ChannelConfigurationSummary> | null>(null);
  const [catalogueLoading, setCatalogueLoading] = useState(false);

  const { selected, selectChannel, clearChannel } = useOmniCommsSelectedChannel();
  const definition = selected ? resolveChannelUi(selected.channel) : null;
  const [rawTab, setTab] = useOmniCommsChannelWorkspaceTab();

  // An out-of-capability tab (stale deep link, hand-edited URL) resolves to
  // Overview rather than mounting a surface the channel does not support.
  const tab: ChannelWorkspaceTab = definition && !isTabApplicable(definition.code, rawTab)
    ? "overview"
    : rawTab;

  const isEmail = definition?.code === "email";
  const showCatalogue = !definition;

  // ── Email data (unchanged C1–C7 behaviour) ────────────────────────
  const refresh = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [config, policy, test, deliveries, release] = await Promise.all([
        getEmailConfigSummary(client, orgId),
        getChannelPolicySummary(client, {
          organizationId: orgId,
          departmentId: departmentId ?? null,
          channel: "email",
          includeReference: false,
        }),
        getChannelTestCentreSummary(client, orgId, "email", departmentId ?? null),
        getChannelTestDeliveryDiagnostics(
          client, orgId, "email", departmentId ?? null, null, 20,
        ),
        getChannelReleaseControlSummary(client, {
          organizationId: orgId,
          departmentId: departmentId ?? null,
          channel: "email",
        }).catch(() => null),
      ]);
      setSummary(config);
      setEmailPolicy(policy);
      setTestCentre(test);
      setDeliveryDiagnostics(deliveries);
      setReleaseSummary(release);
    } catch (e) {
      toastError(e, "Failed to load email configuration");
    } finally {
      setLoading(false);
    }
  }, [client, orgId, departmentId]);

  // ── Generic channel data (CG1) ────────────────────────────────────
  const refreshChannel = useCallback(async () => {
    if (!orgId || !definition || definition.code === "email") return;
    if (!definition.databaseSupported) {
      setChannelSummary(null);
      return;
    }
    setChannelLoading(true);
    try {
      setChannelSummary(
        await loadChannelConfigurationSummary(client, {
          organizationId: orgId,
          departmentId: departmentId ?? null,
          channel: definition.code,
        }),
      );
    } finally {
      setChannelLoading(false);
    }
  }, [client, orgId, departmentId, definition]);

  const refreshCatalogue = useCallback(async () => {
    if (!orgId) return;
    setCatalogueLoading(true);
    try {
      setCatalogueSummaries(
        await loadChannelCatalogueCounts(
          client,
          { organizationId: orgId, departmentId: departmentId ?? null },
          COUNTABLE_CHANNELS,
        ),
      );
    } finally {
      setCatalogueLoading(false);
    }
  }, [client, orgId, departmentId]);

  const refreshTestCentre = useCallback(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (showCatalogue || isEmail) void refresh();
  }, [refresh, showCatalogue, isEmail]);

  useEffect(() => { void refreshChannel(); }, [refreshChannel]);

  useEffect(() => {
    if (showCatalogue) void refreshCatalogue();
  }, [refreshCatalogue, showCatalogue]);

  const emailReadiness = useMemo(
    () => projectEmailReadiness(summary, emailPolicy, testCentre, deliveryDiagnostics, releaseSummary),
    [summary, emailPolicy, testCentre, deliveryDiagnostics, releaseSummary],
  );

  const channelReadiness = useMemo(
    () =>
      definition
        ? projectChannelReadiness({
            channel: definition.code,
            emailProjection: definition.code === "email" ? emailReadiness : null,
            configurationSummary: channelSummary,
            loading: definition.code === "email" ? loading : channelLoading,
          })
        : null,
    [definition, emailReadiness, channelSummary, loading, channelLoading],
  );

  const catalogueReadiness = useMemo(() => {
    const out: Record<string, ChannelCatalogueReadiness> = {};
    for (const d of OMNI_COMMS_CHANNEL_CATALOGUE) {
      const projection = projectChannelReadiness({
        channel: d.channel,
        emailProjection: d.channel === "email" ? emailReadiness : null,
        configurationSummary: catalogueSummaries?.[d.channel] ?? null,
        loading: d.channel === "email" ? loading : catalogueLoading,
      });
      out[d.channel] = {
        configurationLabel: projection.configuration.label,
        deliveryLabel: projection.delivery.label,
        explanation: projection.configuration.detail,
      };
    }
    return out;
  }, [emailReadiness, catalogueSummaries, loading, catalogueLoading]);

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
    return (
      <div className="space-y-6" data-testid="omni-comms-channels-page">
        <div>
          <h1 className="text-2xl font-semibold">Channels</h1>
          <p className="text-sm text-muted-foreground">
            Omnichannel Communications · configuration only. Delivery is
            reported separately and is never implied by configuration.
            {organizationName ? ` · ${organizationName}` : ""}
          </p>
        </div>
        <ChannelCatalogue
          onSelect={selectChannel}
          summaries={catalogueSummaries}
          readiness={catalogueReadiness}
          loading={catalogueLoading || loading}
        />
      </div>
    );
  }

  // ── Selected channel workspace ────────────────────────────────────
  const readiness = isEmail ? emailReadiness : null;
  const applicable = (t: ChannelWorkspaceTab) => isTabApplicable(definition.code, t);

  return (
    <div className="space-y-6" data-testid="omni-comms-channels-page">
      <ChannelWorkspaceHeader
        definition={definition}
        organizationName={organizationName}
        departmentName={departmentName}
        loading={isEmail ? loading : channelLoading}
        readiness={readiness}
        channelReadiness={channelReadiness}
        onBack={clearChannel}
        onRefresh={isEmail ? () => void refresh() : () => void refreshChannel()}
      />

      {/*
        UI Phase 1 — the workspace destinations are presented by a grouped
        vertical rail (drawer below lg). CG1 — the rail only ever offers the
        tabs the capability matrix declares for the selected channel.
      */}
      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <ChannelWorkspaceRail
          tabs={definition.tabs as ChannelWorkspaceTab[]}
          activeTab={tab}
          environment={environment}
          isTabDisabled={(t) => isTabDisabled(definition, t)}
          onSelectTab={setTab}
        />

        <Tabs value={tab} onValueChange={setTab} className="min-w-0">
        <TabsContent value="overview">
          <ChannelOverviewTab
            definition={definition}
            readiness={readiness}
            channelReadiness={channelReadiness}
            configuration={channelSummary}
            summary={isEmail ? summary : null}
          />
        </TabsContent>
        {applicable("providers") ? (
        <TabsContent value="providers">
          <ChannelProvidersTab
            definition={definition} client={client} onChanged={refreshChannel}
          />
        </TabsContent>
        ) : null}
        {applicable("accounts") ? (
        <TabsContent value="accounts">
          <ChannelAccountsTab
            definition={definition} client={client} orgId={orgId}
            summary={isEmail ? summary : null}
            onChanged={isEmail ? refresh : refreshChannel}
          />
        </TabsContent>
        ) : null}
        {applicable("identities") ? (
        <TabsContent value="identities">
          <ChannelIdentitiesTab
            definition={definition} client={client} orgId={orgId}
            departmentId={departmentId} departmentName={departmentName}
            onChanged={isEmail ? refresh : refreshChannel}
          />
        </TabsContent>
        ) : null}
        {applicable("endpoints") ? (
        <TabsContent value="endpoints">
          <ChannelEndpointsTab
            definition={definition} client={client} orgId={orgId}
            departmentId={departmentId} departmentName={departmentName}
            onChanged={isEmail ? refresh : refreshChannel}
          />
        </TabsContent>
        ) : null}
        {applicable("bindings") ? (
        <TabsContent value="bindings">
          <ChannelBindingsTab
            definition={definition} client={client} orgId={orgId}
            departmentId={departmentId} departmentName={departmentName}
            onChanged={isEmail ? refresh : refreshChannel}
          />
        </TabsContent>
        ) : null}
        {applicable("policies") ? (
        <TabsContent value="policies">
          <ChannelPoliciesTab
            definition={definition} client={client} orgId={orgId}
            departmentId={departmentId} departmentName={departmentName}
            onChanged={isEmail ? refresh : refreshChannel}
          />
        </TabsContent>
        ) : null}
        {/* Release Control is an Email-only governance contract. */}
        {applicable("release-control") ? (
        <TabsContent value="release-control">
          <ChannelReleaseControlTab
            definition={definition} client={client} orgId={orgId}
            departmentId={departmentId} departmentName={departmentName}
            transport={releaseTransport}
            onChanged={refresh}
          />
        </TabsContent>
        ) : null}
        {applicable("test-centre") ? (
        <TabsContent value="test-centre">
          <ChannelTestCentreTab
            definition={definition} client={client} orgId={orgId}
            departmentId={departmentId} departmentName={departmentName}
            deliveryTransport={deliveryTransport}
            onChanged={isEmail ? refreshTestCentre : refreshChannel}
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
      </div>
    </div>

  );
};

export default OmniCommsChannelsPage;
