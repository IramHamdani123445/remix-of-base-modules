/**
 * BN-MORT-M4 — Benefit 360 mortality integration.
 *
 * Read-only mortality posture for a single award. Rendered inside Award 360.
 * The card never mutates mortality state and never derives command
 * availability — it links back to the Mortality workspace for any action.
 *
 * Absent mortality access (DENIED) or a failed read is stated explicitly so
 * a caseworker never reads "no mortality event" from an unavailable source.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, HeartPulse } from 'lucide-react';
import { useMortalityAwardSnapshot } from '@/hooks/bn/mortality/useMortalityQueries';

function money(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

export const Benefit360MortalityCard: React.FC<{ awardId: string | null }> = ({ awardId }) => {
  const q = useMortalityAwardSnapshot(awardId);

  if (!awardId) return null;
  if (q.isLoading) return <Skeleton className="h-28" />;

  if (q.isError || q.data?.status === 'DENIED') {
    return (
      <Card data-testid="award360-mortality-unavailable">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <HeartPulse className="h-4 w-4" /> Mortality
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {q.data?.status === 'DENIED'
                ? 'You do not have access to mortality records, so mortality status cannot be shown for this award.'
                : 'Mortality status could not be loaded. Treat it as unknown, not as absent.'}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const snap = q.data?.data;
  if (!snap || !snap.hasMortalityEvent) {
    return (
      <Card data-testid="award360-mortality-none">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <HeartPulse className="h-4 w-4" /> Mortality
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          No mortality event is linked to this award.
        </CardContent>
      </Card>
    );
  }

  const { event, impact } = snap;
  return (
    <Card data-testid="award360-mortality-card">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <HeartPulse className="h-4 w-4" /> Mortality
        </CardTitle>
        {event && <Badge variant="destructive">{event.status}</Badge>}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="grid gap-1.5 sm:grid-cols-2">
          <div><span className="text-muted-foreground">Date of death:</span> {event?.deathDate ?? '—'}</div>
          <div><span className="text-muted-foreground">Event:</span> <span className="font-mono text-xs">{event?.eventReference ?? '—'}</span></div>
          <div><span className="text-muted-foreground">Impact action:</span> {impact?.action ?? '—'}</div>
          <div><span className="text-muted-foreground">Hold:</span> {impact?.holdStatus ?? '—'}</div>
          <div><span className="text-muted-foreground">Termination:</span> {impact?.terminationStatus ?? '—'}</div>
          <div><span className="text-muted-foreground">Approval:</span> {impact?.approvalState ?? '—'}</div>
        </div>
        {impact && impact.estimatedPadMinor > 0 && (
          <div className="rounded-md border p-2 text-xs">
            <div className="flex items-center justify-between">
              <span>Estimated payment after death</span>
              <span className="font-semibold tabular-nums">
                {money(impact.estimatedPadMinor, impact.currencyCode)}
              </span>
            </div>
            <p className="mt-1 text-muted-foreground">
              Indicative exposure only — not a confirmed debt until an overpayment case is raised.
            </p>
            {impact.overpaymentReference && (
              <p className="mt-1">Overpayment: <span className="font-mono">{impact.overpaymentReference}</span></p>
            )}
          </div>
        )}
        {event && (
          <Button asChild size="sm" variant="outline">
            <Link to={event.route}>Open mortality event</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default Benefit360MortalityCard;
