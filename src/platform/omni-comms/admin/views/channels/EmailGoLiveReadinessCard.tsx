/**
 * Omni-Comms — Email Go-Live Readiness card.
 *
 * Presentation only. Every state shown here is derived by
 * `projectEmailGoLiveReadiness` from server-projected readiness and dispatch
 * diagnostics. Nothing on this screen sends a message, contacts a provider or
 * displays a credential, secret value or recipient.
 */
import React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  GO_LIVE_STATUS_LABEL,
  type GoLiveReadinessProjection,
  type GoLiveStatus,
} from './goLiveReadiness';

const TONE: Record<GoLiveStatus, string> = {
  READY: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700',
  BLOCKED: 'border-destructive/40 bg-destructive/10 text-destructive',
  NOT_CONFIGURED: 'border-muted-foreground/30 bg-muted text-muted-foreground',
  NOT_VERIFIED: 'border-amber-600/40 bg-amber-600/10 text-amber-700',
  SUSPENDED: 'border-destructive/40 bg-destructive/10 text-destructive',
};

const StatusBadge: React.FC<{ status: GoLiveStatus }> = ({ status }) => (
  <Badge variant="outline" className={`shrink-0 font-mono text-[10px] ${TONE[status]}`}>
    {GO_LIVE_STATUS_LABEL[status]}
  </Badge>
);

export const EmailGoLiveReadinessCard: React.FC<{
  projection: GoLiveReadinessProjection;
  /** True when dispatch diagnostics could not be read for this scope. */
  diagnosticsUnavailable?: boolean;
}> = ({ projection, diagnosticsUnavailable }) => (
  <Card data-testid="omni-comms-email-go-live-readiness">
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        Email go-live readiness
        <span className="text-xs font-normal text-muted-foreground">
          {projection.readyCount}/{projection.totalCount} ready
        </span>
      </CardTitle>
      <CardDescription>
        Controlled email business dispatch is implemented. Provider delivery
        happens only when Release Control and the producer/runtime prerequisites
        below allow it. Unrestricted live delivery is
        {projection.liveDeliveryAvailable ? ' available' : ' not enabled'}.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4 text-sm">
      {diagnosticsUnavailable ? (
        <p className="rounded-md border border-muted-foreground/30 bg-muted p-3 text-muted-foreground">
          Dispatch diagnostics could not be read for this scope, so business
          dispatch items cannot be evaluated. They are reported as blocked
          rather than assumed ready.
        </p>
      ) : null}

      <div
        className="rounded-md border p-3"
        data-testid="omni-comms-email-next-blocker"
      >
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Next blocker
        </div>
        {projection.nextBlocker ? (
          <div className="mt-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{projection.nextBlocker.label}</span>
              <StatusBadge status={projection.nextBlocker.status} />
            </div>
            <p className="text-muted-foreground">{projection.nextBlocker.nextAction}</p>
          </div>
        ) : (
          <p className="mt-1 text-muted-foreground">
            No outstanding prerequisite. This does not enable unrestricted live
            delivery: dispatch remains governed by Release Control.
          </p>
        )}
      </div>

      <ul className="space-y-3" data-testid="omni-comms-go-live-items">
        {projection.items.map((item) => (
          <li key={item.key} className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="font-medium">{item.label}</span>
              <span className="block text-muted-foreground">{item.detail}</span>
              {item.status === 'READY' ? null : (
                <span className="mt-1 block text-xs text-foreground/80">
                  Next action: {item.nextAction}
                </span>
              )}
            </span>
            <StatusBadge status={item.status} />
          </li>
        ))}
      </ul>
    </CardContent>
  </Card>
);

export default EmailGoLiveReadinessCard;
