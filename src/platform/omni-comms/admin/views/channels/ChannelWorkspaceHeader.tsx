/**
 * Omni-Comms C1 — selected-channel workspace header.
 *
 * Renders the channel identity, truthful status, readiness badge, refresh and
 * the tenant scope TEXT. The authoritative organisation/department selector
 * lives in OmniCommsModuleHeader and is never duplicated here.
 */
import React from 'react';
import { AlertCircle, ArrowLeft, CircleDashed, Loader2, RefreshCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CHANNEL_IMPLEMENTATION_LABEL,
  type ChannelUiDefinition,
} from './channelUiRegistry';
import type { EmailReadinessProjection } from './emailReadiness';
import type { ChannelReadinessProjection } from './channelReadiness';

export interface ChannelWorkspaceHeaderProps {
  definition: ChannelUiDefinition;
  organizationName?: string | null;
  departmentName?: string | null;
  loading?: boolean;
  /**
   * Shared readiness projection. Supplied only for channels with a real
   * readiness signal (email in C1); null for every other channel.
   */
  readiness?: EmailReadinessProjection | null;
  /**
   * CG1 — the generic two-facet readiness projection. Configuration readiness
   * and delivery readiness are rendered SEPARATELY and never merged.
   */
  channelReadiness?: ChannelReadinessProjection | null;
  onBack: () => void;
  onRefresh?: () => void;
}

export const ChannelWorkspaceHeader: React.FC<ChannelWorkspaceHeaderProps> = ({
  definition,
  organizationName,
  departmentName,
  loading,
  readiness,
  channelReadiness,
  onBack,
  onRefresh,
}) => (
  <div
    className="flex flex-wrap items-start justify-between gap-4"
    data-testid="omni-comms-channel-workspace-header"
  >
    <div className="space-y-1">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        onClick={onBack}
        data-testid="omni-comms-back-to-channels"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to all channels
      </Button>
      <h1 className="text-2xl font-semibold">{definition.name}</h1>
      <p className="text-sm text-muted-foreground">{definition.description}</p>
      <p className="text-sm text-muted-foreground">
        {CHANNEL_IMPLEMENTATION_LABEL[definition.implementationState]} ·{' '}
        {definition.statusText}
      </p>
      <p className="text-xs text-muted-foreground">
        {organizationName ?? 'No organisation selected'}
        {departmentName ? ` · ${departmentName}` : ' · All departments'}
      </p>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      {channelReadiness ? (
        <Badge
          variant={
            channelReadiness.configuration.state === 'ready'
              ? 'secondary'
              : channelReadiness.configuration.state === 'incomplete'
                ? 'destructive'
                : 'outline'
          }
          title={channelReadiness.configuration.detail}
          data-testid="omni-comms-configuration-readiness-badge"
        >
          {channelReadiness.configuration.label}
        </Badge>
      ) : null}
      {channelReadiness ? (
        <Badge
          variant="outline"
          title={channelReadiness.delivery.detail}
          data-testid="omni-comms-delivery-readiness-badge"
        >
          {channelReadiness.delivery.label}
        </Badge>
      ) : null}
      {!readiness || readiness.state === 'unknown' ? (
        <Badge variant="secondary" data-testid="omni-comms-readiness-badge">
          Readiness unknown
        </Badge>
      ) : readiness.state === 'prerequisites_met' ? (
        <Badge variant="secondary" data-testid="omni-comms-readiness-badge">
          <CircleDashed className="h-3 w-3 mr-1" />
          {readiness.label} · {readiness.explanation}
        </Badge>
      ) : (
        <Badge variant="destructive" data-testid="omni-comms-readiness-badge">
          <AlertCircle className="h-3 w-3 mr-1" />
          {readiness.label} · {readiness.explanation}
        </Badge>
      )}
      {onRefresh ? (
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="h-4 w-4" />
          )}
          <span className="ml-2">Refresh</span>
        </Button>
      ) : null}
    </div>
  </div>
);

export default ChannelWorkspaceHeader;
