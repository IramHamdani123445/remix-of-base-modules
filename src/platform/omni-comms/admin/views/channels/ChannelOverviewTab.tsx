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
  TECHNICAL_TEST_PENDING,
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
}> = ({ definition, summary, readiness }) => {
  if (definition.code !== 'email') {
    const items: EmailReadinessCheck[] = [
      { key: 'account', label: 'Provider account', state: 'unmet', detail: 'No provider account configured.' },
      { key: 'identity', label: 'Identity', state: 'unmet', detail: 'No identity configured.' },
      { key: 'policy', label: 'Policy', state: 'unmet', detail: 'No policy configured.' },
      {
        key: 'technical_test',
        label: 'Technical channel test',
        state: 'not_implemented',
        detail: `${TECHNICAL_TEST_PENDING} — technical testing is not available yet.`,
      },
    ];
    return (
      <div className="space-y-4">
        <Card data-testid="omni-comms-channel-overview">
          <CardHeader>
            <CardTitle>{definition.name} readiness</CardTitle>
            <CardDescription>{definition.statusText}</CardDescription>
          </CardHeader>
          <CardContent>
            <Checklist items={items} />
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
