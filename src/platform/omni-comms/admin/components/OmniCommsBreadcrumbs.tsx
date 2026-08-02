/**
 * Omni-Comms UI Phase 1 — breadcrumb renderer.
 *
 * Rendered once, by `OmniCommsShell`, above the module header. Reads the
 * canonical trail from `omniCommsBreadcrumbs.ts`; every link preserves the
 * operator's current scope via `mergeOmniCommsHref`.
 *
 * Presentation only: no RPC, no mutation, no provider contact.
 */
import React from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { findChannelDescriptor } from '@/platform/omni-comms/domain/channelCatalogue';
import { buildOmniCommsBreadcrumbs } from '../navigation/omniCommsBreadcrumbs';
import { mergeOmniCommsHref } from '../navigation/searchParamMerge';

export const OmniCommsBreadcrumbs: React.FC = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const rawChannel = searchParams.get('channel');
  const descriptor = React.useMemo(
    () => findChannelDescriptor(rawChannel),
    [rawChannel],
  );

  const crumbs = React.useMemo(
    () =>
      buildOmniCommsBreadcrumbs({
        pathname: location.pathname,
        view: searchParams.get('view'),
        channel: descriptor?.channel ?? null,
        channelLabel: descriptor?.label ?? null,
        tab: searchParams.get('tab'),
      }),
    [location.pathname, searchParams, descriptor],
  );

  return (
    <Breadcrumb data-testid="omni-comms-breadcrumbs">
      <BreadcrumbList>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <React.Fragment key={crumb.id}>
              <BreadcrumbItem>
                {isLast || !crumb.href ? (
                  <BreadcrumbPage
                    data-testid={`omni-comms-breadcrumb-${crumb.id}`}
                    className={isLast ? undefined : 'text-muted-foreground'}
                  >
                    {crumb.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link
                      to={mergeOmniCommsHref(crumb.href, location.search)}
                      data-testid={`omni-comms-breadcrumb-${crumb.id}`}
                    >
                      {crumb.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {isLast ? null : <BreadcrumbSeparator />}
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
};

export default OmniCommsBreadcrumbs;
