/**
 * BnModuleTrail — the shared breadcrumb builder for Benefits modules.
 *
 * Each module used to hand-roll the same "Benefit Management → module →
 * screen" derivation. One implementation guarantees identical wording,
 * ordering and link behaviour across Means-Test, Risk, Uprating and
 * Overpayment Recovery.
 */
import React from 'react';
import { useLocation } from 'react-router-dom';
import { BnModuleBreadcrumbs, type BnBreadcrumb } from './BnModuleBreadcrumbs';

export const BN_PRODUCT_LABEL = 'Benefit Management';

/** First path segment after the module base, e.g. `signals`. */
export function bnScreenSegment(pathname: string, base: string): string {
  return pathname.replace(base, '').replace(/^\/+|\/+$/g, '').split('/')[0] ?? '';
}

interface TrailProps {
  readonly moduleLabel: string;
  readonly moduleBase: string;
  readonly screenLabels: Record<string, string>;
  /** Appended after the derived screen crumb (record workspaces). */
  readonly trailing?: readonly BnBreadcrumb[];
  readonly fallbackLabel?: string;
}

export const BnModuleTrail: React.FC<TrailProps> = ({
  moduleLabel,
  moduleBase,
  screenLabels,
  trailing,
  fallbackLabel = 'Overview',
}) => {
  const { pathname } = useLocation();
  const segment = bnScreenSegment(pathname, moduleBase);
  const screenLabel = screenLabels[segment] ?? fallbackLabel;
  const hasTrailing = Boolean(trailing && trailing.length > 0);

  const items: BnBreadcrumb[] = [
    { label: BN_PRODUCT_LABEL },
    { label: moduleLabel, to: moduleBase },
    hasTrailing && segment
      ? { label: screenLabel, to: `${moduleBase}/${segment}` }
      : { label: screenLabel },
    ...(trailing ?? []),
  ];

  return <BnModuleBreadcrumbs items={items} />;
};
