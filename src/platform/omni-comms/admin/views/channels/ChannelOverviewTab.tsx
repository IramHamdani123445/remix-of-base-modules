/**
 * Omni-Comms C1 — channel Overview tab.
 *
 * Email readiness comes from the ONE shared projection in emailReadiness.ts,
 * so the catalogue card, the workspace header and this checklist can never
 * disagree. Reference/simulation records never contribute and
 * `summary.email_send_ready` is never consulted.
 */
import React from 'react';
import { CheckCircle2, CircleDashed, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  EmailConfigSummary,
} from '@/platform/omni-comms/application/channelManagementTypes';
import { DeferredCapabilityCard } from './channelFormPrimitives';
import {
  projectEmailReadiness,
  CONFIGURATION_PREFLIGHT_PENDING,
  PROVIDER_DELIVERY_TEST_DETAIL,
  type EmailReadinessCheck,
  type EmailReadinessCheckState,
  type EmailReadinessProjection,
} from './emailReadiness';
import type { ChannelUiDefinition } from './channelUiRegistry';

const StateIcon: React.FC<{ state: EmailReadinessCheckState }> = ({ state }) => {
  if (state === 'met') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (state === 'unmet') return <XCircle className="h-4 w-4 text-destructive" />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
};

const Checklist: React.FC<{ items: readonly EmailReadinessCheck[] }> = ({ items }) => (
  <ul className="space-y-3" data-testid="omni-comms-readiness-checklist">
    {items.map((item) => (
      <li key={item.key} className="flex items-start gap-3 text-sm">
        <StateIcon state={item.state} />
        <span>
          <span className="font-medium">{item.label}</span>
          <span className="block text-muted-foreground">{item.detail}</span>
        </span>
      </li>
    ))}
  </ul>
);

export const ChannelOverviewTab: React.FC<{
  definition: ChannelUiDefinition;
  summary: EmailConfigSummary | null;
  /** Shared projection supplied by the page for email; recomputed if absent. */
  readiness?: EmailReadinessProjection | null;
  /** CG1 — generic two-facet readiness for any channel. */
  channelReadiness?: ChannelReadinessProjection | null;
  /** CG1 — generic configuration summary for non-Email channels. */
  configuration?: ChannelConfigurationSummary | null;
}> = ({ definition, summary, readiness, channelReadiness, configuration }) => {
  if (definition.code !== 'email') {
    /*
     * CG1 — truthful non-Email overview. Counts come from the generic summary
     * and unloaded/unreadable resources are reported as such, never as zero.
     * Nothing here claims provider contact or delivery readiness.
     */
    const resources = OMNI_COMMS_CHANNEL_RESOURCES.filter(
      (r) => channelCapability(definition.code, r).uiApplicable
        && r !== 'release-control' && r !== 'diagnostics' && r !== 'test-centre',
    );

    return (
      <div className="space-y-4">
        <Card data-testid="omni-comms-channel-overview">
          <CardHeader>
            <CardTitle>{definition.name} readiness</CardTitle>
            <CardDescription>{definition.statusText}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Configuration readiness</p>
                <p className="text-sm font-medium" data-testid="omni-comms-configuration-readiness">
                  {channelReadiness?.configuration.label ?? 'Configuration readiness unknown'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {channelReadiness?.configuration.detail
                    ?? 'No configuration summary has been loaded for this scope yet.'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Delivery readiness</p>
                <p className="text-sm font-medium" data-testid="omni-comms-delivery-readiness">
                  {channelReadiness?.delivery.label ?? 'Delivery adapter not installed'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {channelReadiness?.delivery.detail
                    ?? 'No delivery adapter is installed for this channel.'}
                </p>
              </div>
            </div>

            {definition.databaseSupported ? (
              <ul className="space-y-2 text-sm" data-testid="omni-comms-channel-resource-counts">
                {resources.map((resource) => (
                  <li key={resource} className="flex items-center justify-between gap-3">
                    <span className="capitalize">{resource.replace('-', ' ')}</span>
                    <span
                      className="text-muted-foreground"
                      data-testid={`omni-comms-overview-count-${resource}`}
                    >
                      {formatResourceCount(configuration?.resources[resource], 'active')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                The shared database objects do not yet represent this channel, so
                no configuration can be recorded for it.
              </p>
            )}
          </CardContent>
        </Card>
        <DeferredCapabilityCard
          title="Provider adapters"
          description={`No provider adapter is installed for ${definition.name}.`}
          bullets={definition.accounts.examples}
          footer={`Delivery will be implemented in ${definition.accounts.futureBuild}.`}
        />
      </div>
    );
  }


  const projection = readiness ?? projectEmailReadiness(summary);
  const provider = summary?.provider ?? null;

  return (
    <div className="space-y-4">
      <Card data-testid="omni-comms-channel-overview">
        <CardHeader>
          <CardTitle>Email readiness checklist</CardTitle>
          <CardDescription>
            {projection.label} · {projection.explanation}. Derived from genuine
            organisation configuration; reference simulation records are
            excluded and manual evidence is never authoritative.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Checklist items={projection.checks} />
        </CardContent>
      </Card>

      <Card data-testid="omni-comms-email-adapter">
        <CardHeader>
          <CardTitle>Email adapter (read-only)</CardTitle>
          <CardDescription>
            Provider adapters are system-level software installations, not an
            ordinary organisation configuration action.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {provider ? (
            <>
              <div>
                Adapter: <code>{provider.code}</code>
              </div>
              <div className="flex items-center gap-2">
                Status: <Badge>{provider.status}</Badge>
              </div>
              <div className="text-muted-foreground">
                Resend is the available email adapter.
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">
              Resend adapter is not installed in this environment.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ChannelOverviewTab;
