/**
 * Omni-Comms — the only navigation a normal administrator sees.
 *
 * Overview · Settings · Activity. The former five-stage workflow
 * (Delivery Setup / Test & Verify / Go Live / Health) is not advertised.
 *
 * Presentation only: no RPC, no mutation, no provider contact.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import {
  CHANNEL_SIMPLE_SECTION_DEFINITIONS,
  type ChannelSimpleSection,
} from '../../../navigation/channelSimpleSections';

export interface ChannelSimpleNavProps {
  activeSection: ChannelSimpleSection;
  onSelectSection: (section: ChannelSimpleSection) => void;
}

export const ChannelSimpleNav: React.FC<ChannelSimpleNavProps> = ({
  activeSection,
  onSelectSection,
}) => (
  <nav
    aria-label="Channel sections"
    data-testid="omni-comms-channel-simple-nav"
    className="flex flex-wrap gap-2 rounded-lg border bg-muted/40 p-1.5"
  >
    {CHANNEL_SIMPLE_SECTION_DEFINITIONS.map((section) => {
      const isActive = section.id === activeSection;
      return (
        <button
          key={section.id}
          type="button"
          aria-current={isActive ? 'page' : undefined}
          title={section.description}
          onClick={() => onSelectSection(section.id)}
          data-testid={`omni-comms-channel-simple-${section.id}`}
          className={cn(
            'min-h-11 rounded-md px-4 text-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isActive
              ? 'bg-background font-medium text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {section.label}
        </button>
      );
    })}
  </nav>
);

export default ChannelSimpleNav;
