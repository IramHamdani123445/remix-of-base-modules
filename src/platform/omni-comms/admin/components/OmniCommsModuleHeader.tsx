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
import { OmniCommsTenantSelector } from './OmniCommsTenantSelector';
import { OmniCommsPostureBadgeList } from './OmniCommsPostureBadge';
import {
  buildHeaderPosture,
  currentOmniCommsEnvironment,
  ENVIRONMENT_LABEL,
} from '../posture/omniCommsPosture';
import {
  OMNI_COMMS_NAV_ITEMS,
  OMNI_COMMS_PLANNED_NAV_ITEMS,
  resolveActiveNavItem,
} from '../navigation/omniCommsNavigation';
import { useOmniCommsTenant } from '../../context/OmniCommsTenantContext';

export const OmniCommsModuleHeader: React.FC = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { organizationName, departmentName } = useOmniCommsTenant();

  const environment = React.useMemo(() => currentOmniCommsEnvironment(), []);
  // Privileged certification is executed outside this interface and has not
  // been recorded as complete for the deployed runtime.
  const posture = React.useMemo(
    () => buildHeaderPosture({ certification: 'pending', environment }),
    [environment],
  );

  const active = resolveActiveNavItem(location.pathname, searchParams.get('view'));

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
                {organizationName ?? 'No organisation selected'}
                {departmentName ? ` · ${departmentName}` : ' · All departments'}
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

        <OmniCommsTenantSelector />

        <nav aria-label="Omnichannel Communications sections">
          <ul className="flex flex-wrap items-center gap-1">
            {OMNI_COMMS_NAV_ITEMS.map((item) => {
              const isActive = item.id === active.id;
              return (
                <li key={item.id}>
                  <Link
                    to={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    title={item.description}
                    data-testid={`omni-comms-nav-${item.id}`}
                    className={cn(
                      'inline-flex min-h-11 items-center rounded-md px-3 text-sm transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isActive
                        ? 'bg-primary text-primary-foreground font-medium'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
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
