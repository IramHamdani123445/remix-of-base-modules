/**
 * Omni-Comms C1 / CG1 — channel catalogue (default Channels view).
 *
 * Truthful, read-only cards. Counts come from the GENERIC configuration
 * summary for every channel whose approved workflow exposes the resource.
 * Unloaded or unreadable counts are shown as explicit states — never zero.
 */
import React from 'react';
import {
  BellRing, Inbox, Mail, MessageSquare, MessagesSquare, PhoneCall, Printer,
  Radio, Webhook,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  CHANNEL_IMPLEMENTATION_LABEL,
  OMNI_COMMS_CHANNEL_UI_CATALOGUE,
  type ChannelUiDefinition,
} from './channelUiRegistry';
import {
  formatResourceCount,
  type ChannelConfigurationSummary,
} from '@/platform/omni-comms/application/channelConfigurationTypes';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Mail, MessageSquare, MessagesSquare, BellRing, Inbox, Webhook, Printer, PhoneCall,
};

export interface ChannelCatalogueReadiness {
  /** Configuration readiness label (never a delivery claim). */
  configurationLabel: string;
  /** Delivery readiness label, reported separately and always truthfully. */
  deliveryLabel: string;
  /** Optional supporting explanation for configuration readiness. */
  explanation?: string;
}

export interface ChannelCatalogueProps {
  onSelect: (channel: string) => void;
  /** Generic per-channel configuration summaries, keyed by channel code. */
  summaries?: Record<string, ChannelConfigurationSummary> | null;
  /** Readiness per channel, keyed by channel code. */
  readiness?: Record<string, ChannelCatalogueReadiness> | null;
  /** True while the catalogue counts are still being read. */
  loading?: boolean;
}

function stateVariant(def: ChannelUiDefinition) {
  if (def.implementationState === 'configuring') return 'default' as const;
  if (def.implementationState === 'planned') return 'outline' as const;
  return 'secondary' as const;
}

const LOADING = 'Loading…';

export const ChannelCatalogue: React.FC<ChannelCatalogueProps> = ({
  onSelect,
  summaries,
  readiness,
  loading = false,
}) => (
  <div
    className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
    data-testid="omni-comms-channel-catalogue"
  >
    {OMNI_COMMS_CHANNEL_UI_CATALOGUE.map((def) => {
      const Icon = ICONS[def.icon] ?? Radio;
      const planned = def.implementationState === 'planned';
      const summary = summaries?.[def.code] ?? null;
      const channelReadiness = readiness?.[def.code] ?? null;

      const accountsText = loading && !summary
        ? LOADING
        : formatResourceCount(summary?.resources.accounts);
      const identitiesText = loading && !summary
        ? LOADING
        : formatResourceCount(summary?.resources.identities, 'active');

      return (
        <Card key={def.code} data-testid={`omni-comms-channel-card-${def.code}`}>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">{def.name}</CardTitle>
              </div>
              <Badge variant={stateVariant(def)}>
                {CHANNEL_IMPLEMENTATION_LABEL[def.implementationState]}
              </Badge>
            </div>
            <CardDescription>{def.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{def.statusText}</p>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Accounts</dt>
                <dd data-testid={`omni-comms-channel-accounts-${def.code}`}>
                  {accountsText}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Active identities</dt>
                <dd data-testid={`omni-comms-channel-identities-${def.code}`}>
                  {identitiesText}
                </dd>
              </div>
            </dl>
            <dl className="text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Readiness</dt>
                <dd data-testid={`omni-comms-channel-readiness-${def.code}`}>
                  {channelReadiness
                    ? channelReadiness.configurationLabel
                    : loading
                      ? LOADING
                      : 'Configuration readiness unknown'}
                  <span className="block text-xs text-muted-foreground">
                    {channelReadiness
                      ? channelReadiness.deliveryLabel
                      : 'Delivery adapter not installed'}
                  </span>
                  {channelReadiness?.explanation ? (
                    <span className="block text-xs text-muted-foreground">
                      {channelReadiness.explanation}
                    </span>
                  ) : null}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              {def.databaseSupported
                ? 'Database schema supports this channel.'
                : 'Database extension required.'}
            </p>
            <Button
              size="sm"
              variant={planned ? 'outline' : 'default'}
              onClick={() => onSelect(def.code)}
              data-testid={`omni-comms-channel-open-${def.code}`}
            >
              {planned ? 'View plan' : 'Configure'}
            </Button>
          </CardContent>
        </Card>
      );
    })}
  </div>
);

export default ChannelCatalogue;
