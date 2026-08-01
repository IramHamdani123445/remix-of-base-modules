/**
 * Omni-Comms C1 — selected-channel workspace header.
 *
 * Renders the channel identity, truthful status, readiness badge, refresh and
 * the tenant scope TEXT. The authoritative organisation/department selector
 * lives in OmniCommsModuleHeader and is never duplicated here.
 */
import React from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, RefreshCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CHANNEL_IMPLEMENTATION_LABEL,
  type ChannelUiDefinition,
} from './channelUiRegistry';

export interface ChannelWorkspaceHeaderProps {
  definition: ChannelUiDefinition;
  organizationName?: string | null;
  departmentName?: string | null;
  loading?: boolean;
  /** Only supplied for channels with a real readiness signal (email). */
  ready?: boolean | null;
  onBack: () => void;
  onRefresh?: () => void;
}

export const ChannelWorkspaceHeader: React.FC<ChannelWorkspaceHeaderProps> = ({
  definition,
  organizationName,
  departmentName,
  loading,
  ready,
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
    <div className="flex items-center gap-3">
      {ready === null || ready === undefined ? (
        <Badge variant="secondary">Readiness unknown</Badge>
      ) : ready ? (
        <Badge className="bg-emerald-600 hover:bg-emerald-700">
          <CheckCircle2 className="h-3 w-3 mr-1" /> Configuration complete
        </Badge>
      ) : (
        <Badge variant="destructive">
          <AlertCircle className="h-3 w-3 mr-1" /> Not ready
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
