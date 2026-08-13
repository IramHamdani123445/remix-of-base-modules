/**
 * Omni-Comms — the single operator control for automatic delivery.
 *
 * ONE shared Switch. No "Turn on" / "Turn off" buttons, no proposal button, no
 * approval button, no release vocabulary. The server owns every decision; this
 * component renders the server's verdict and forwards one intent.
 *
 * Safety: rendering, mounting or refreshing NEVER mutates anything. A mutation
 * happens only when a human moves the switch.
 */
import React from 'react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ShieldAlert } from 'lucide-react';
import type {
  DeliveryToggleSnapshot,
  DeliveryToggleState,
} from '@/platform/omni-comms/application/deliveryToggleService';

/** Plain state words. No release, pilot or governance vocabulary. */
export const SIMPLE_STATE_LABEL: Record<DeliveryToggleState, string> = {
  on: 'LIVE',
  off: 'OFF',
  awaiting_approval: 'Waiting for a second person',
  action_required: 'Needs attention',
  suspended: 'OFF',
};

export interface ChannelDeliverySwitchProps {
  /** e.g. "Automatic Email delivery". */
  label: string;
  snapshot: DeliveryToggleSnapshot | null;
  busy?: boolean;
  loading?: boolean;
  onChange: (next: boolean) => void;
}

export const ChannelDeliverySwitch: React.FC<ChannelDeliverySwitchProps> = ({
  label,
  snapshot,
  busy,
  loading,
  onChange,
}) => {
  const state = snapshot?.state ?? 'action_required';
  const on = state === 'on';
  const awaitingSelf = state === 'awaiting_approval' && snapshot?.awaitingSelfApproval === true;
  const disabled = Boolean(busy)
    || Boolean(loading)
    || snapshot === null
    || (on ? snapshot?.canDisable !== true : snapshot?.canEnable !== true)
    || awaitingSelf;

  return (
    <div className="space-y-3" data-testid="omni-comms-delivery-switch">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Label htmlFor="omni-comms-delivery-switch-control" className="text-base font-medium">
          {label}
        </Label>
        <div className="flex items-center gap-3">
          <Badge
            variant={on ? 'default' : state === 'action_required' ? 'destructive' : 'secondary'}
            data-testid="omni-comms-delivery-state"
          >
            {SIMPLE_STATE_LABEL[state]}
          </Badge>
          <Switch
            id="omni-comms-delivery-switch-control"
            checked={on}
            disabled={disabled}
            aria-label={label}
            onCheckedChange={onChange}
          />
        </div>
      </div>

      {awaitingSelf ? (
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>A second person must confirm</AlertTitle>
          <AlertDescription>
            You asked for automatic sending. For safety, a different administrator
            has to move this switch to confirm it.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
};

export default ChannelDeliverySwitch;
