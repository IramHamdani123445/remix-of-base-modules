/**
 * Omni-Comms C1 — channel catalogue (default Channels view).
 *
 * Truthful, read-only cards. Only Email reports real counts; every other
 * channel shows an explicit empty/planned state and never invented numbers.
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

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Mail, MessageSquare, MessagesSquare, BellRing, Inbox, Webhook, Printer, PhoneCall,
};

export interface ChannelCatalogueCounts {
  /** Genuine (non-reference) provider accounts. */
  providerAccounts: number;
  /** Genuine active sender identities. */
  activeIdentities: number;
  readiness: string;
  /** Supporting explanation (technical test pending). */
  readinessExplanation?: string;
}

export interface ChannelCatalogueProps {
  onSelect: (channel: string) => void;
  /** Counts are supplied for email only; other channels stay truthful. */
  emailCounts?: ChannelCatalogueCounts | null;
}

function stateVariant(def: ChannelUiDefinition) {
  if (def.implementationState === 'configuring') return 'default' as const;
  if (def.implementationState === 'planned') return 'outline' as const;
  return 'secondary' as const;
}

export const ChannelCatalogue: React.FC<ChannelCatalogueProps> = ({
  onSelect,
  emailCounts,
}) => (
  <div
    className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
    data-testid="omni-comms-channel-catalogue"
  >
    {OMNI_COMMS_CHANNEL_UI_CATALOGUE.map((def) => {
      const Icon = ICONS[def.icon] ?? Radio;
      const planned = def.implementationState === 'planned';
      const counts = def.code === 'email' ? emailCounts ?? null : null;
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
            <dl className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Accounts</dt>
                <dd>{counts ? counts.providerAccounts : 'Not configured'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Active identities</dt>
                <dd>{counts ? counts.activeIdentities : 'Not configured'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Readiness</dt>
                <dd>
                  {counts ? counts.readiness : 'Unknown'}
                  {counts?.readinessExplanation ? (
                    <span className="block text-xs text-muted-foreground">
                      {counts.readinessExplanation}
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
