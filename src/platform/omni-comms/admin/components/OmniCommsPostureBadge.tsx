/**
 * Omni-Comms — posture badge.
 *
 * State is conveyed by an icon AND a text label, never by colour alone.
 */
import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  MinusCircle,
  ShieldOff,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { PostureFacet, PostureTone } from '../posture/omniCommsPosture';

const TONE: Record<
  PostureTone,
  {
    Icon: React.ComponentType<{ className?: string }>;
    variant: 'default' | 'secondary' | 'outline' | 'destructive';
  }
> = {
  positive: { Icon: CheckCircle2, variant: 'default' },
  neutral: { Icon: MinusCircle, variant: 'outline' },
  pending: { Icon: Clock, variant: 'secondary' },
  blocked: { Icon: ShieldOff, variant: 'outline' },
};

export interface OmniCommsPostureBadgeProps {
  facet: PostureFacet;
  className?: string;
}

export const OmniCommsPostureBadge: React.FC<OmniCommsPostureBadgeProps> = ({
  facet,
  className,
}) => {
  const tone = TONE[facet.tone] ?? TONE.neutral;
  return (
    <Badge
      variant={tone.variant}
      className={cn('gap-1 font-normal', className)}
      data-testid={`omni-comms-posture-${facet.id}`}
      data-tone={facet.tone}
      title={facet.detail}
      aria-label={`${facet.label}: ${facet.value}`}
    >
      <tone.Icon className="h-3 w-3" aria-hidden="true" />
      <span>{facet.value}</span>
    </Badge>
  );
};

export interface OmniCommsPostureBadgeListProps {
  facets: readonly PostureFacet[];
  className?: string;
}

export const OmniCommsPostureBadgeList: React.FC<OmniCommsPostureBadgeListProps> = ({
  facets,
  className,
}) => (
  <div
    className={cn('flex flex-wrap items-center gap-2', className)}
    data-testid="omni-comms-posture-badges"
  >
    {facets.map((f) => (
      <OmniCommsPostureBadge key={f.id} facet={f} />
    ))}
  </div>
);

export interface WarningNoticeProps {
  children: React.ReactNode;
}

/** Text + icon warning used for non-production and prohibited actions. */
export const OmniCommsInlineWarning: React.FC<WarningNoticeProps> = ({ children }) => (
  <p className="flex items-start gap-2 text-xs text-muted-foreground">
    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
    <span>{children}</span>
  </p>
);

export default OmniCommsPostureBadge;
