/**
 * Omni-Comms UX Simplification — channel workspace section navigation.
 *
 * Replaces the ten-item vertical rail with five task-shaped sections rendered
 * as a wrapping segmented control. Nothing is clipped, nothing hides behind an
 * invisible scroll, and the destination names describe jobs rather than
 * database objects.
 *
 * Presentation only: no RPC, no mutation, no provider contact. Selection is
 * delegated to the caller, which owns the canonical `?tab=` binding.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import type { OmniCommsGenericTab } from '@/platform/omni-comms/domain/channelCatalogue';
import {
  CHANNEL_SECTION_TAB_HINTS,
  CHANNEL_SECTION_TAB_LABELS,
  buildChannelSections,
  sectionForTab,
  type ChannelWorkspaceSection,
} from '../../navigation/channelWorkspaceSections';

export interface ChannelWorkspaceSectionNavProps {
  /** Tabs offered by the selected channel definition, in canonical order. */
  tabs: readonly OmniCommsGenericTab[];
  /** Currently selected `?tab=` code. */
  activeTab: OmniCommsGenericTab;
  /** Tabs that must render as unavailable for this channel. */
  isTabDisabled?: (tab: OmniCommsGenericTab) => boolean;
  onSelectTab: (tab: string) => void;
}

export const ChannelWorkspaceSectionNav: React.FC<
  ChannelWorkspaceSectionNavProps
> = ({ tabs, activeTab, isTabDisabled, onSelectTab }) => {
  const sections = React.useMemo(() => buildChannelSections(tabs), [tabs]);
  const activeSection: ChannelWorkspaceSection = sectionForTab(activeTab);

  return (
    <nav
      aria-label="Channel workspace sections"
      data-testid="omni-comms-channel-section-nav"
      className="flex flex-wrap gap-2 rounded-lg border bg-muted/40 p-1.5"
    >
      {sections.map((section) => {
        const target = section.availableTabs[0];
        const disabled = section.availableTabs.every(
          (t) => isTabDisabled?.(t) ?? false,
        );
        const isActive = section.id === activeSection;
        return (
          <button
            key={section.id}
            type="button"
            disabled={disabled}
            aria-current={isActive ? 'page' : undefined}
            title={section.description}
            onClick={() => onSelectTab(target)}
            data-testid={`omni-comms-channel-section-${section.id}`}
            className={cn(
              'min-h-11 rounded-md px-4 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              disabled && 'cursor-not-allowed opacity-50',
              !disabled && isActive
                ? 'bg-background text-foreground font-medium shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {section.label}
          </button>
        );
      })}
    </nav>
  );
};

export interface ChannelSectionStepsProps {
  /** Steps of the active section, already filtered to supported tabs. */
  steps: readonly OmniCommsGenericTab[];
  activeTab: OmniCommsGenericTab;
  isTabDisabled?: (tab: OmniCommsGenericTab) => boolean;
  onSelectTab: (tab: string) => void;
}

/**
 * Numbered step strip shown inside Delivery Setup. Setup is a sequence, so it
 * is presented as one — not as a bag of equally weighted tabs.
 */
export const ChannelSectionSteps: React.FC<ChannelSectionStepsProps> = ({
  steps,
  activeTab,
  isTabDisabled,
  onSelectTab,
}) => {
  if (steps.length < 2) return null;
  return (
    <ol
      className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
      data-testid="omni-comms-channel-section-steps"
    >
      {steps.map((tab, index) => {
        const disabled = isTabDisabled?.(tab) ?? false;
        const isActive = tab === activeTab;
        return (
          <li key={tab}>
            <button
              type="button"
              disabled={disabled}
              aria-current={isActive ? 'step' : undefined}
              onClick={() => onSelectTab(tab)}
              data-testid={`omni-comms-channel-step-${tab}`}
              className={cn(
                'flex min-h-16 w-full flex-col justify-center rounded-lg border px-4 py-2 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                disabled && 'cursor-not-allowed opacity-50',
                !disabled && isActive
                  ? 'border-primary bg-primary/5'
                  : 'hover:border-primary/40 hover:bg-muted/50',
              )}
            >
              <span className="text-sm font-medium">
                {index + 1}. {CHANNEL_SECTION_TAB_LABELS[tab]}
              </span>
              <span className="text-xs text-muted-foreground">
                {CHANNEL_SECTION_TAB_HINTS[tab]}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
};

export default ChannelWorkspaceSectionNav;
