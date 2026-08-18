/**
 * Omni-Comms — shared module header.
 *
 * Rendered by `OmniCommsShell` on every Omni-Comms administration screen so
 * the administrator always sees the same product identity, the selected
 * tenant, the environment and the truthful runtime / delivery / Legacy
 * posture, plus module-local navigation.
 *
 * Presentation only: no RPC, no mutation, no provider contact.
 */
import React from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Radio } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { OmniCommsScopeSelector } from './OmniCommsScopeSelector';
import { OmniCommsPostureBadgeList } from './OmniCommsPostureBadge';
import {
  buildHeaderPosture,
  ENVIRONMENT_LABEL,
} from '../posture/omniCommsPosture';
import {
  omniCommsNavGroups,
  OMNI_COMMS_PLANNED_NAV_ITEMS,
  resolveActiveNavItem,

} from '../navigation/omniCommsNavigation';
import { mergeOmniCommsHref } from '../navigation/searchParamMerge';

import { useOmniCommsCertificationPosture } from '../hooks/useOmniCommsCertificationPosture';
import { useOmniCommsScope } from '../../context/OmniCommsScopeContext';

export const OmniCommsModuleHeader: React.FC = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { organizationName } = useOmniCommsScope();

  // Certification wording is derived ONCE, from the shared hook, so the
  // header, the Dashboard, Operations, Health and Safe test can never
  // disagree about the certification state of the deployed runtime.
  const { posture: certification, environment } = useOmniCommsCertificationPosture();
  const posture = React.useMemo(
    () =>
      buildHeaderPosture({
        certification:
          certification.state === 'certified'
            ? 'certified'
            : certification.state === 'pending'
              ? 'pending'
              : 'unknown',
        environment,
      }),
    [certification.state, environment],
  );

  // Non-production-only destinations are withheld in production.
  const navGroups = React.useMemo(() => omniCommsNavGroups(environment), [environment]);
  const active = resolveActiveNavItem(location.pathname, searchParams.get('view'));

  // Primary working destinations stay in the header; grouped configuration
  // surfaces (Stationery, Setup & health) are reached from the left menu and
  // only announce themselves here as a breadcrumb.
  const primaryItems = React.useMemo(
    () =>
      navGroups
        .filter((g) => g.id === 'operate' || g.id === 'configure')
        .flatMap((g) => g.items),
    [navGroups],
  );
  const secondaryGroup = React.useMemo(
    () =>
      navGroups.find(
        (g) =>
          (g.id === 'stationery' || g.id === 'setup') &&
          g.items.some((i) => i.id === active.id),
      ) ?? null,
    [navGroups, active.id],
  );




  return (
    <header
      data-testid="omni-comms-module-header"
      className="border-b bg-card/40"
    >
      <div className="container mx-auto space-y-4 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <Radio className="mt-1 h-6 w-6 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Administration
              </p>
              <h1 className="truncate text-xl font-semibold sm:text-2xl">
                Omnichannel Communications
              </h1>
              <p
                className="text-xs text-muted-foreground"
                data-testid="omni-comms-active-scope"
              >
                {organizationName ?? 'Resolving workspace…'}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-start gap-2 lg:items-end">
            <Badge
              variant={environment === 'production' ? 'destructive' : 'outline'}
              data-testid="omni-comms-environment-badge"
              className="font-normal"
            >
              {ENVIRONMENT_LABEL[environment]}
            </Badge>
            <OmniCommsPostureBadgeList facets={posture} className="lg:justify-end" />
          </div>
        </div>

        <OmniCommsScopeSelector />

        {/*
          The left Omni-Comms menu is the single destination navigation
          mechanism. The header no longer repeats route links on every page —
          it states only where you are.
        */}
        <nav aria-label="Omnichannel Communications location" className="space-y-2">
          <p
            className="text-xs text-muted-foreground"
            data-testid="omni-comms-nav-breadcrumb"
          >
            {secondaryGroup ? (
              <>
                {secondaryGroup.label} <span aria-hidden="true">›</span>{' '}
              </>
            ) : null}
            <span className="font-medium text-foreground">{active.label}</span>
          </p>

          <ul className="flex flex-wrap items-center gap-1">
            {OMNI_COMMS_PLANNED_NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <span
                  aria-disabled="true"
                  data-testid={`omni-comms-nav-planned-${item.id}`}
                  className="inline-flex min-h-11 cursor-not-allowed items-center gap-2 rounded-md px-3 text-sm text-muted-foreground/70"
                >
                  {item.label}
                  <Badge variant="outline" className="font-normal">
                    {item.plannedLabel}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
};

export default OmniCommsModuleHeader;
