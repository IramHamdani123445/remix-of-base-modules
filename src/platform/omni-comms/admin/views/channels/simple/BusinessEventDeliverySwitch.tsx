/**
 * Omni-Comms — one business event, one plain switch.
 *
 * Shows the friendly event name ("Claim submitted") and a single
 * "Send Email" switch. The event CODE is never shown on the normal surface.
 *
 * When no `onChange` is supplied the switch reflects server truth and cannot
 * be moved — the channel Overview never edits event routing.
 */
import React from 'react';
import { Switch } from '@/components/ui/switch';
import { businessEventLabel } from '@/platform/omni-comms/domain/businessEventLabels';

export interface BusinessEventDeliverySwitchProps {
  eventCode: string;
  channelLabel?: string;
  enabled: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
}

export const BusinessEventDeliverySwitch: React.FC<BusinessEventDeliverySwitchProps> = ({
  eventCode,
  channelLabel = 'Email',
  enabled,
  disabled,
  onChange,
}) => {
  const readOnly = typeof onChange !== 'function';
  return (
    <div
      className="rounded-md border px-3 py-3"
      data-testid={`omni-comms-business-event-${eventCode}`}
    >
      <div className="text-sm font-medium">{businessEventLabel(eventCode)}</div>
      <div className="mt-2 flex items-center justify-between gap-4">
        <span className="text-sm text-muted-foreground">Send {channelLabel}</span>
        <Switch
          checked={enabled}
          disabled={readOnly || disabled === true}
          aria-label={`Send ${channelLabel} for ${businessEventLabel(eventCode)}`}
          onCheckedChange={(next) => onChange?.(next)}
        />
      </div>
    </div>
  );
};

export default BusinessEventDeliverySwitch;
