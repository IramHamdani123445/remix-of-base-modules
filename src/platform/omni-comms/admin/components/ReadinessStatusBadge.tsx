/**
 * Accessible readiness-state badge. Communicates state via icon + text label,
 * never colour alone. Used across the Omni-Comms Readiness page.
 */
import React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2, CircleDashed, Clock, ShieldAlert, MinusCircle,
  Lock, PackageOpen,
} from 'lucide-react';

export type ReadinessState =
  | 'Verified'
  | 'In progress'
  | 'Planned'
  | 'Blocked'
  | 'Not applicable'
  | 'Available'
  | 'Placeholder'
  | 'Not implemented'
  | 'Registered'
  | 'Mapped to Admin'
  | 'Unmapped'
  | 'Reserved'
  | 'Not created'
  | 'Reused';

interface Props {
  state: ReadinessState;
  className?: string;
}

const CONFIG: Record<ReadinessState, { icon: React.ComponentType<{ className?: string }>; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  Verified:         { icon: CheckCircle2, variant: 'default' },
  Available:        { icon: CheckCircle2, variant: 'default' },
  Registered:       { icon: CheckCircle2, variant: 'default' },
  'Mapped to Admin':{ icon: CheckCircle2, variant: 'default' },
  'In progress':    { icon: Clock,        variant: 'secondary' },
  Placeholder:      { icon: PackageOpen,  variant: 'secondary' },
  Planned:          { icon: CircleDashed, variant: 'outline' },
  Reserved:         { icon: Lock,         variant: 'outline' },
  Reused:           { icon: CheckCircle2, variant: 'secondary' },
  Unmapped:         { icon: CircleDashed, variant: 'outline' },
  'Not implemented':{ icon: MinusCircle,  variant: 'outline' },
  'Not created':    { icon: MinusCircle,  variant: 'outline' },
  'Not applicable': { icon: MinusCircle,  variant: 'outline' },
  Blocked:          { icon: ShieldAlert,  variant: 'destructive' },
};

export const ReadinessStatusBadge: React.FC<Props> = ({ state, className }) => {
  const { icon: Icon, variant } = CONFIG[state];
  return (
    <Badge
      variant={variant}
      className={className}
      aria-label={`Status: ${state}`}
      data-state={state}
    >
      <Icon className="h-3 w-3 mr-1" aria-hidden="true" />
      <span>{state}</span>
    </Badge>
  );
};

export default ReadinessStatusBadge;
