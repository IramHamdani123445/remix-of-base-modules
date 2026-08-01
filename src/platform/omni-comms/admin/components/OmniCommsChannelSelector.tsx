/**
 * Omni-Comms C1 — channel selector.
 *
 * Renders the canonical channel catalogue as a segmented selector. Channels
 * that are not yet implemented remain selectable (so operators can see the
 * roadmap and the reserved surface) but are visibly marked as reserved; the
 * generic tab shell then renders a fail-closed placeholder.
 */
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  OMNI_COMMS_CHANNEL_CATALOGUE,
  type OmniCommsChannel,
} from '@/platform/omni-comms/domain/channelCatalogue';

export interface OmniCommsChannelSelectorProps {
  value: OmniCommsChannel;
  onChange: (next: OmniCommsChannel) => void;
}

export const OmniCommsChannelSelector: React.FC<OmniCommsChannelSelectorProps> = ({
  value,
  onChange,
}) => (
  <div
    className="flex flex-wrap gap-2"
    role="tablist"
    aria-label="Communication channel"
    data-testid="omni-comms-channel-selector"
  >
    {OMNI_COMMS_CHANNEL_CATALOGUE.map((d) => {
      const active = d.channel === value;
      return (
        <Button
          key={d.channel}
          type="button"
          role="tab"
          aria-selected={active}
          variant={active ? 'default' : 'outline'}
          size="sm"
          className="gap-2"
          data-testid={`omni-comms-channel-option-${d.channel}`}
          onClick={() => onChange(d.channel)}
        >
          <span>{d.label}</span>
          {!d.implemented && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-medium">
              {d.chunk}
            </Badge>
          )}
        </Button>
      );
    })}
  </div>
);

export default OmniCommsChannelSelector;
