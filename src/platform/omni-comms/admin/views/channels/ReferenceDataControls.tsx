/**
 * Omni-Comms C1 — reference/simulation data controls.
 *
 * Reference records are hidden by default. The "Show reference data" switch is
 * rendered ONLY in non-production environments and never changes readiness.
 */
import React from 'react';
import { Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  currentOmniCommsEnvironment,
  isNonProduction,
} from '@/platform/omni-comms/admin/posture/omniCommsPosture';
import {
  REFERENCE_DATA_BADGE,
  REFERENCE_DATA_BANNER,
} from './channelReferenceData';

export function referenceSwitchAllowed(): boolean {
  return isNonProduction(currentOmniCommsEnvironment());
}

export const ReferenceDataBadge: React.FC = () => (
  <Badge variant="outline" data-testid="omni-comms-reference-data-badge">
    {REFERENCE_DATA_BADGE}
  </Badge>
);

export const ReferenceDataControls: React.FC<{
  hiddenCount: number;
  showReference: boolean;
  onToggle: (next: boolean) => void;
}> = ({ hiddenCount, showReference, onToggle }) => {
  if (hiddenCount <= 0) return null;
  const allowSwitch = referenceSwitchAllowed();

  return (
    <Alert data-testid="omni-comms-reference-data-banner">
      <Info className="h-4 w-4" />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>
          {REFERENCE_DATA_BANNER} ({hiddenCount} hidden)
        </span>
        {allowSwitch ? (
          <span className="flex items-center gap-2">
            <Switch
              checked={showReference}
              onCheckedChange={onToggle}
              data-testid="omni-comms-show-reference-data"
            />
            <Label>Show reference data</Label>
          </span>
        ) : null}
      </AlertDescription>
    </Alert>
  );
};

export default ReferenceDataControls;
