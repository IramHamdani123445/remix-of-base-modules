/**
 * Omni-Comms — the normal Settings area.
 *
 * One page of compact configuration cards instead of six sub-tabs. Each card
 * states what is configured and whether it is ready; [Manage] opens the
 * existing detailed surface below the cards, so every legacy `?tab=` deep link
 * still resolves to exactly the same screen.
 *
 * Presentation only: this surface performs no RPC of its own.
 */
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { OmniCommsGenericTab } from '@/platform/omni-comms/domain/channelCatalogue';
import {
  CHANNEL_SETTINGS_CARD_HINTS,
  CHANNEL_SETTINGS_CARD_LABELS,
} from '../../../navigation/channelSimpleSections';

export interface SimpleSettingsCard {
  readonly tab: OmniCommsGenericTab;
  /** What is configured today, e.g. "Resend" or "secureserve.biz". */
  readonly value: string;
  /** Ready / Needs attention / a short factual limit summary. */
  readonly status: string;
  readonly ready: boolean;
  readonly actionLabel?: string;
}

export interface SimpleSettingsSurfaceProps {
  cards: readonly SimpleSettingsCard[];
  /** Currently opened detailed surface, if any. */
  manageTab: OmniCommsGenericTab | null;
  onManage: (tab: OmniCommsGenericTab) => void;
  onCloseManage: () => void;
  /** The detailed surface for `manageTab`. Composed by the coordinator. */
  manageSurface: React.ReactNode;
  /** Business communications entry point (events and templates). */
  onManageEvents: () => void;
  technicalDetails: React.ReactNode;
}

export const SimpleSettingsSurface: React.FC<SimpleSettingsSurfaceProps> = ({
  cards,
  manageTab,
  onManage,
  onCloseManage,
  manageSurface,
  onManageEvents,
  technicalDetails,
}) => (
  <div className="space-y-6" data-testid="omni-comms-simple-settings">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.tab} data-testid={`omni-comms-settings-card-${card.tab}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {CHANNEL_SETTINGS_CARD_LABELS[card.tab]}
            </CardTitle>
            <CardDescription>{CHANNEL_SETTINGS_CARD_HINTS[card.tab]}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm font-medium">{card.value}</div>
            <Badge variant={card.ready ? 'secondary' : 'destructive'}>{card.status}</Badge>
            <div>
              <Button variant="outline" size="sm" onClick={() => onManage(card.tab)}>
                {card.actionLabel ?? 'Manage'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <Card data-testid="omni-comms-settings-card-events">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Business communications</CardTitle>
          <CardDescription>
            Which business moments send a message, and with which letter.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={onManageEvents}>
            Manage events
          </Button>
        </CardContent>
      </Card>
    </div>

    {manageTab ? (
      <Card data-testid="omni-comms-settings-manage-surface">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">
            {CHANNEL_SETTINGS_CARD_LABELS[manageTab]}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onCloseManage}>
            Close
          </Button>
        </CardHeader>
        <CardContent>{manageSurface}</CardContent>
      </Card>
    ) : null}

    <div>{technicalDetails}</div>
  </div>
);

export default SimpleSettingsSurface;
