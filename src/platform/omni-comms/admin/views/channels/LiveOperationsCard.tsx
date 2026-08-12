/**
 * Omni-Comms — production LIVE operations panel.
 *
 * Read-only evidence plus the two live governance actions (propose / approve).
 * It contacts no provider itself: sending is performed automatically by the
 * server-side dispatcher once an approved live release exists.
 */
import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, CircleDashed, Radio } from 'lucide-react';
import type { LiveOperationsSummary } from '@/platform/omni-comms/application/liveOperationsService';

export const LiveOperationsCard: React.FC<{
  live: LiveOperationsSummary | null;
  busy?: boolean;
  canPropose: boolean;
  canApproveLive: boolean;
  onProposeLive: () => void;
  onApproveLive: () => void;
}> = ({ live, busy, canPropose, canApproveLive, onProposeLive, onApproveLive }) => {
  const checks = live?.readiness.checks ?? [];
  const ready = live?.readiness.ready_count ?? 0;
  const evidence = live?.delivery_evidence;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Radio className="h-4 w-4" /> Production live sending
          </CardTitle>
          <CardDescription>
            Live operation sends configured Benefits business Email automatically. The
            recipient always comes from the Benefits transaction.
          </CardDescription>
        </div>
        <Badge variant={live?.live ? 'default' : 'secondary'}>
          {live?.live ? 'LIVE' : (live?.release_state ?? 'not configured')}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm font-medium">Live capability readiness: {ready}/7</div>
        <ul className="space-y-1 text-sm">
          {checks.map((c) => (
            <li key={c.key} className="flex items-start gap-2">
              {c.ready
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                : <CircleDashed className="mt-0.5 h-4 w-4 text-muted-foreground" />}
              <span className={c.ready ? '' : 'text-muted-foreground'}>{c.detail}</span>
            </li>
          ))}
        </ul>

        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <div className="font-medium">Automatic dispatcher</div>
            <div className="text-muted-foreground">
              {live?.scheduler.installed ? 'Runs every minute.' : 'Not installed.'}
              {live?.scheduler.last_run_at
                ? ` Last run ${new Date(live.scheduler.last_run_at).toLocaleString()}`
                : ' No run recorded yet.'}
              {live?.scheduler.last_run_blocker ? ` — ${live.scheduler.last_run_blocker}` : ''}
            </div>
          </div>
          <div>
            <div className="font-medium">Production quotas</div>
            <div className="text-muted-foreground">
              {live?.quotas.max_recipients_per_request ?? '—'} recipient per message,{' '}
              {live?.quotas.max_messages_per_hour ?? '—'}/hour,{' '}
              {live?.quotas.max_messages_per_day ?? '—'}/day,{' '}
              {live?.quotas.max_messages_total === null
                ? 'no lifetime cap'
                : `${live?.quotas.max_messages_total ?? '—'} lifetime`}
            </div>
          </div>
          <div>
            <div className="font-medium">Delivery evidence</div>
            <div className="text-muted-foreground">
              {evidence
                ? `${evidence.attempts} attempts, ${evidence.accepted} accepted, `
                  + `${evidence.delivered} delivered, queue depth ${evidence.queue_depth}`
                : 'No production delivery recorded yet.'}
            </div>
          </div>
          <div>
            <div className="font-medium">Scope</div>
            <div className="text-muted-foreground">
              {(live?.scope.permitted_caller_modules ?? []).join(', ') || '—'} —{' '}
              {(live?.scope.permitted_event_codes ?? []).join(', ') || '—'}
            </div>
          </div>
        </div>

        {!live?.live && (
          <Alert>
            <AlertTitle>Two people are required to go live</AlertTitle>
            <AlertDescription>
              One administrator proposes production live; a different administrator
              approves it. Approval attaches the live authorisation to every safe held
              Benefits message and the automatic dispatcher takes over from there.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!canPropose || busy} onClick={onProposeLive}>
            Propose production live
          </Button>
          <Button disabled={!canApproveLive || busy} onClick={onApproveLive}>
            Approve and go live
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
