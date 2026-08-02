/**
 * Omni-Comms UI Phase 1 — channel workspace navigation rail.
 *
 * Replaces the single horizontal `TabsList` that clipped Release Control,
 * Test Centre and Diagnostics out of view below ~1500px.
 *
 *   - Desktop (lg+): a persistent vertical rail grouped by operator intent.
 *   - Below lg: a drawer opened from a full-width trigger that names the
 *     current destination. Nothing is ever clipped or hidden behind an
 *     invisible horizontal scroll.
 *
 * Presentation only: no RPC, no mutation, no provider contact. Tab selection
 * is delegated to the caller, which owns the canonical `?tab=` binding.
 */
import React from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link, useLocation } from 'react-router-dom';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { OmniCommsGenericTab } from '@/platform/omni-comms/domain/channelCatalogue';
import {
  buildChannelRailGroups,
  CHANNEL_RAIL_TAB_LABELS,
  type ChannelRailGroup,
} from '../../navigation/channelWorkspaceRail';
import { mergeOmniCommsHref } from '../../navigation/searchParamMerge';

export interface ChannelWorkspaceRailProps {
  /** Tabs offered by the selected channel definition, in canonical order. */
  tabs: readonly OmniCommsGenericTab[];
  /** Currently selected `?tab=` code. */
  activeTab: OmniCommsGenericTab;
  /** Tabs that must render as unavailable for this channel. */
  isTabDisabled?: (tab: OmniCommsGenericTab) => boolean;
  environment?: 'production' | 'non_production' | 'unknown';
  onSelectTab: (tab: string) => void;
}

const RailGroups: React.FC<{
  groups: readonly ChannelRailGroup[];
  activeTab: OmniCommsGenericTab;
  isTabDisabled?: (tab: OmniCommsGenericTab) => boolean;
  currentSearch: string;
  onSelectTab: (tab: string) => void;
  idPrefix: string;
}> = ({ groups, activeTab, isTabDisabled, currentSearch, onSelectTab, idPrefix }) => (
  <div className="space-y-5">
    {groups.map((group) => (
      <div key={group.intent} className="space-y-1">
        <p className="px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {group.label}
        </p>
        <ul className="space-y-0.5">
          {group.items.map((item) => {
            if (item.kind === 'link') {
              return (
                <li key={item.id}>
                  <Link
                    to={mergeOmniCommsHref(item.href, currentSearch)}
                    title={item.description}
                    data-testid={`${idPrefix}-link-${item.id}`}
                    className="flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {item.label}
                  </Link>
                </li>
              );
            }

            const disabled = isTabDisabled?.(item.tab) ?? false;
            const isActive = item.tab === activeTab;
            return (
              <li key={item.tab}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-current={isActive ? 'page' : undefined}
                  title={item.description}
                  onClick={() => onSelectTab(item.tab)}
                  data-testid={`${idPrefix}-tab-${item.tab}`}
                  className={cn(
                    'flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    disabled && 'cursor-not-allowed opacity-50',
                    !disabled && isActive
                      ? 'bg-primary text-primary-foreground font-medium'
                      : !disabled
                        ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        : 'text-muted-foreground',
                  )}
                >
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    ))}
  </div>
);

export const ChannelWorkspaceRail: React.FC<ChannelWorkspaceRailProps> = ({
  tabs,
  activeTab,
  isTabDisabled,
  environment = 'unknown',
  onSelectTab,
}) => {
  const location = useLocation();
  const [open, setOpen] = React.useState(false);
  const groups = React.useMemo(
    () => buildChannelRailGroups(tabs, environment),
    [tabs, environment],
  );

  const handleSelect = React.useCallback(
    (tab: string) => {
      onSelectTab(tab);
      setOpen(false);
    },
    [onSelectTab],
  );

  return (
    <>
      {/* Compact viewports — drawer, never a clipped strip. */}
      <div className="lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              className="w-full justify-start"
              data-testid="omni-comms-channel-rail-trigger"
            >
              <Menu className="mr-2 h-4 w-4" aria-hidden="true" />
              {CHANNEL_RAIL_TAB_LABELS[activeTab]}
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-80 overflow-y-auto"
            data-testid="omni-comms-channel-rail-drawer"
          >
            <SheetHeader className="mb-4 text-left">
              <SheetTitle>Channel workspace</SheetTitle>
            </SheetHeader>
            <nav aria-label="Channel workspace sections">
              <RailGroups
                groups={groups}
                activeTab={activeTab}
                isTabDisabled={isTabDisabled}
                currentSearch={location.search}
                onSelectTab={handleSelect}
                idPrefix="omni-comms-channel-rail-mobile"
              />
            </nav>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop — persistent rail. */}
      <nav
        aria-label="Channel workspace sections"
        data-testid="omni-comms-channel-rail"
        className="hidden lg:block lg:sticky lg:top-4 lg:self-start"
      >
        <RailGroups
          groups={groups}
          activeTab={activeTab}
          isTabDisabled={isTabDisabled}
          currentSearch={location.search}
          onSelectTab={onSelectTab}
          idPrefix="omni-comms-channel-rail"
        />
      </nav>
    </>
  );
};

export default ChannelWorkspaceRail;
