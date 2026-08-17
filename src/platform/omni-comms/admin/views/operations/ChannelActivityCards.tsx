import React, { useMemo } from "react";
import {
  BellRing,
  Inbox,
  Mail,
  MessageSquare,
  MessagesSquare,
  PhoneCall,
  Printer,
  Webhook,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { BusinessEventActivityRow } from "@/platform/omni-comms/application/businessEventActivityTypes";
import { OMNI_COMMS_CHANNEL_UI_CATALOGUE } from "../channels/channelUiRegistry";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Mail,
  MessageSquare,
  MessagesSquare,
  BellRing,
  Inbox,
  Webhook,
  Printer,
  PhoneCall,
};

export interface ChannelActivityCardsProps {
  rows: readonly BusinessEventActivityRow[];
  loading: boolean;
}

/**
 * Channel coverage for the currently loaded business-activity result set.
 * These cards deliberately count business events, not provider attempts, so
 * one event using multiple channels appears once on each applicable card.
 */
export const ChannelActivityCards: React.FC<ChannelActivityCardsProps> = ({ rows, loading }) => {
  const counts = useMemo(() => {
    const next = new Map<string, number>();
    for (const row of rows) {
      for (const channel of new Set(row.channels)) {
        next.set(channel, (next.get(channel) ?? 0) + 1);
      }
    }
    return next;
  }, [rows]);

  return (
    <section className="space-y-3" data-testid="omni-comms-channel-activity-cards">
      <div>
        <h2 className="text-base font-semibold">Activity by channel</h2>
        <p className="text-xs text-muted-foreground">
          Business events in the current activity result set, shown for every supported channel.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {OMNI_COMMS_CHANNEL_UI_CATALOGUE.map((channel) => {
          const Icon = ICONS[channel.icon] ?? Inbox;
          const count = counts.get(channel.code) ?? 0;
          return (
            <Card key={channel.code} data-testid={`omni-comms-activity-channel-${channel.code}`}>
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{channel.name}</p>
                    <p className="text-xs text-muted-foreground">Recorded events</p>
                  </div>
                </div>
                <Badge variant={count > 0 ? "default" : "outline"} className="tabular-nums">
                  {loading ? "…" : count.toLocaleString()}
                </Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
};

export default ChannelActivityCards;