/**
 * BN-MORT-M3 — Worklist operational indicators.
 *
 * Renders the per-event signals an officer needs before opening a record:
 * open mandatory actions, outstanding cross-module handoffs, active holds,
 * awaiting-approval impacts, and payment-after-death exposure.
 *
 * Read-only. Never derives availability of any command — action availability
 * remains server-authoritative via BN_MORTALITY_GET_ACTION_AVAILABILITY.
 */
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { MortalityWorklistIndicator } from '@/types/bn/mortality/mortalityDtos';

export function formatMinor(minor: number, currency = 'XCD'): string {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

interface Props {
  indicator?: MortalityWorklistIndicator;
  /** True while the indicator query is still resolving. */
  isLoading?: boolean;
  /** True when the indicator query failed — signals are unknown, not zero. */
  isError?: boolean;
}

export const BnMortalityWorklistIndicators: React.FC<Props> = ({ indicator, isLoading, isError }) => {
  if (isError) {
    return (
      <span className="text-[11px] text-muted-foreground" data-testid="mort-signals-unavailable">
        Signals unavailable
      </span>
    );
  }
  if (isLoading && !indicator) {
    return <span className="text-[11px] text-muted-foreground">…</span>;
  }
  if (!indicator) return <span className="text-[11px] text-muted-foreground">—</span>;

  const chips: Array<{ key: string; label: string; hint: string; variant: 'destructive' | 'secondary' | 'outline' }> = [];

  if (indicator.openMandatoryActions > 0) {
    chips.push({
      key: 'actions',
      label: `${indicator.openMandatoryActions} action${indicator.openMandatoryActions > 1 ? 's' : ''}`,
      hint: 'Mandatory follow-on actions still open — closure is blocked.',
      variant: 'destructive',
    });
  }
  if (indicator.failedHandoffs > 0) {
    chips.push({
      key: 'handoff-failed',
      label: `${indicator.failedHandoffs} failed`,
      hint: 'Cross-module handoffs reported a failure and need attention.',
      variant: 'destructive',
    });
  }
  if (indicator.outstandingHandoffs > 0) {
    chips.push({
      key: 'handoffs',
      label: `${indicator.outstandingHandoffs} handoff${indicator.outstandingHandoffs > 1 ? 's' : ''}`,
      hint: 'Outstanding cross-module handoffs awaiting the target module.',
      variant: 'secondary',
    });
  }
  if (indicator.awaitingApprovalImpacts > 0) {
    chips.push({
      key: 'approval',
      label: `${indicator.awaitingApprovalImpacts} approval`,
      hint: 'Award impacts awaiting approval.',
      variant: 'secondary',
    });
  }
  if (indicator.activeHolds > 0) {
    chips.push({
      key: 'holds',
      label: `${indicator.activeHolds} hold${indicator.activeHolds > 1 ? 's' : ''}`,
      hint: 'Awards currently held under this event.',
      variant: 'outline',
    });
  }
  if (indicator.padExposureMinor > 0) {
    chips.push({
      key: 'pad',
      label: formatMinor(indicator.padExposureMinor, indicator.currencyCode ?? 'XCD'),
      hint: 'Estimated payment-after-death exposure. Indicative only — not a confirmed debt.',
      variant: 'outline',
    });
  }
  if (indicator.impactCount > 0 && indicator.evidenceCount === 0) {
    chips.push({
      key: 'no-evidence',
      label: 'No evidence',
      hint: 'No attached or received evidence is recorded on this event.',
      variant: 'secondary',
    });
  }

  if (chips.length === 0) {
    return <span className="text-[11px] text-muted-foreground" data-testid="mort-signals-clear">Clear</span>;
  }

  return (
    <TooltipProvider>
      <div className="flex flex-wrap gap-1" data-testid="mort-signals">
        {chips.map((c) => (
          <Tooltip key={c.key}>
            <TooltipTrigger asChild>
              {/* span wrapper: Badge is not a forwardRef component. */}
              <span>
                <Badge variant={c.variant} className="text-[10px] font-normal" data-signal={c.key}>
                  {c.label}
                </Badge>
              </span>
            </TooltipTrigger>
            <TooltipContent>{c.hint}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
};

export default BnMortalityWorklistIndicators;
