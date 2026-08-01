/**
 * Omni-Comms C1 — channel Overview tab.
 *
 * Email shows a readiness checklist derived from GENUINE (non-reference)
 * configuration only, plus read-only provider adapter information. No provider
 * registration action is offered to ordinary organisation administrators.
 */
import React from 'react';
import { CheckCircle2, CircleDashed, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  EmailConfigSummary,
} from '@/platform/omni-comms/application/channelManagementTypes';
import { DeferredCapabilityCard } from './channelFormPrimitives';
import { partitionEmailConfig, readinessCounts } from './channelReferenceData';
import type { ChannelUiDefinition } from './channelUiRegistry';

export type ChecklistState = 'met' | 'unmet' | 'not_implemented';

export interface ChecklistItem {
  readonly label: string;
  readonly state: ChecklistState;
  readonly detail: string;
}

/**
 * Pure readiness projection. Reference/simulation records never contribute.
 * The technical test item is always `not_implemented` in C1 because nothing
 * is sent.
 */
export function buildEmailReadinessChecklist(
  summary: EmailConfigSummary | null,
): ChecklistItem[] {
  const part = partitionEmailConfig({
    accounts: summary?.provider_accounts,
    senders: summary?.sender_identities,
    bindings: summary?.bindings,
  });
  const counts = readinessCounts(part);
  const provider = summary?.provider ?? null;
  const verified = part.accounts.some((a) => a.verification_status === 'verified');
  const setting = summary?.channel_setting ?? null;

  const yn = (ok: boolean): ChecklistState => (ok ? 'met' : 'unmet');

  return [
    {
      label: 'Resend adapter present and active',
      state: yn(Boolean(provider) && provider?.status === 'active'),
      detail: provider
        ? `Adapter ${provider.code} — ${provider.status}`
        : 'Resend adapter is not installed in this environment.',
    },
    {
      label: 'Provider account present',
      state: yn(counts.accounts > 0),
      detail: `${counts.accounts} organisation provider account(s).`,
    },
    {
      label: 'Credential verification status',
      state: yn(verified),
      detail: verified
        ? 'At least one account has verified Resend credentials.'
        : 'No account has verified credentials.',
    },
    {
      label: 'Active sender identity present',
      state: yn(counts.activeSenders > 0),
      detail: `${counts.activeSenders} active identity(ies).`,
    },
    {
      label: 'Active verified binding present',
      state: yn(counts.activeVerifiedBindings > 0),
      detail: `${counts.activeVerifiedBindings} active verified binding(s).`,
    },
    {
      label: 'Email channel setting present',
      state: yn(Boolean(setting)),
      detail: setting ? 'Channel policy record exists.' : 'No channel policy saved.',
    },
    {
      label: 'Email channel enabled',
      state: yn(Boolean(setting?.enabled)),
      detail: setting?.enabled ? 'Channel flag is enabled.' : 'Channel flag is disabled.',
    },
    {
      label: 'Successful technical test',
      state: 'not_implemented',
      detail: 'Not implemented — C1 sends nothing.',
    },
  ];
}

const StateIcon: React.FC<{ state: ChecklistState }> = ({ state }) => {
  if (state === 'met') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (state === 'unmet') return <XCircle className="h-4 w-4 text-destructive" />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
};

const Checklist: React.FC<{ items: ChecklistItem[] }> = ({ items }) => (
  <ul className="space-y-3" data-testid="omni-comms-readiness-checklist">
    {items.map((item) => (
      <li key={item.label} className="flex items-start gap-3 text-sm">
        <StateIcon state={item.state} />
        <span>
          <span className="font-medium">{item.label}</span>
          <span className="block text-muted-foreground">
            {item.state === 'not_implemented' ? 'Not implemented' : item.detail}
          </span>
        </span>
      </li>
    ))}
  </ul>
);

export const ChannelOverviewTab: React.FC<{
  definition: ChannelUiDefinition;
  summary: EmailConfigSummary | null;
}> = ({ definition, summary }) => {
  if (definition.code !== 'email') {
    const items: ChecklistItem[] = [
      { label: 'Provider account', state: 'unmet', detail: 'No provider account configured.' },
      { label: 'Identity', state: 'unmet', detail: 'No identity configured.' },
      { label: 'Policy', state: 'unmet', detail: 'No policy configured.' },
      {
        label: 'Technical test',
        state: 'not_implemented',
        detail: 'Technical test not available yet.',
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

  const provider = summary?.provider ?? null;

  return (
    <div className="space-y-4">
      <Card data-testid="omni-comms-channel-overview">
        <CardHeader>
          <CardTitle>Email readiness checklist</CardTitle>
          <CardDescription>
            Derived from genuine organisation configuration. Reference simulation
            records are excluded and manual evidence is never authoritative.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Checklist items={buildEmailReadinessChecklist(summary)} />
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
