/**
 * Omni-Comms — read-only health row rendered as a toggle-style indicator.
 *
 * The state comes ONLY from server truth. It is deliberately not editable: a
 * user can never make a failed gate green by clicking it. When a row is
 * unhealthy, clicking it navigates to the settings surface that can fix it.
 */
import React from 'react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export interface ReadOnlyHealthSwitchProps {
  /** Server indicator key, e.g. `provider`. Used only for navigation. */
  indicatorKey: string;
  label: string;
  ready: boolean;
  /** Word shown to the right: Ready / Healthy / Needs attention. */
  statusWord: string;
  onFix?: (indicatorKey: string) => void;
}

export const ReadOnlyHealthSwitch: React.FC<ReadOnlyHealthSwitchProps> = ({
  indicatorKey,
  label,
  ready,
  statusWord,
  onFix,
}) => {
  const actionable = !ready && typeof onFix === 'function';
  const Row = actionable ? 'button' : 'div';
  return (
    <Row
      {...(actionable
        ? { type: 'button' as const, onClick: () => onFix?.(indicatorKey) }
        : {})}
      data-testid={`omni-comms-health-row-${indicatorKey}`}
      data-ready={ready ? 'true' : 'false'}
      className={cn(
        'flex w-full items-center justify-between gap-4 rounded-md border px-3 py-2 text-left',
        actionable ? 'hover:border-primary/50 hover:bg-muted/40' : '',
      )}
    >
      <span className="text-sm">{label}</span>
      <span className="flex items-center gap-3">
        <span
          className={cn(
            'text-xs',
            ready ? 'text-muted-foreground' : 'font-medium text-destructive',
          )}
        >
          {statusWord}
        </span>
        {/*
          Presentation only. `disabled` plus a no-op handler guarantees the row
          can never be used to fake readiness.
        */}
        <Switch
          checked={ready}
          disabled
          aria-readonly
          aria-label={`${label} status`}
          tabIndex={-1}
        />
      </span>
    </Row>
  );
};

export default ReadOnlyHealthSwitch;
