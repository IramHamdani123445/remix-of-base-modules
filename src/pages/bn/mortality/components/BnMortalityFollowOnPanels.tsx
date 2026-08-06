/**
 * BN-MORT-M3 / M5 — Follow-on closure surfaces for the Mortality workspace.
 *
 * Two read-only panels:
 *   • Required follow-on actions — the closure gate.
 *   • Cross-module handoffs — the governed lifecycle to Survivor, Funeral,
 *     Overpayment, and Legal.
 *
 * Both fail loudly: a failed query renders an error with a retry, never an
 * empty list that could be misread as "nothing outstanding".
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AlertTriangle } from 'lucide-react';
import {
  useMortalityHandoffs,
  useMortalityRequiredActions,
} from '@/hooks/bn/mortality/useMortalityQueries';

function handoffBadge(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (['COMPLETED'].includes(status)) return 'secondary';
  if (['REJECTED', 'FAILED', 'CANCELLED'].includes(status)) return 'destructive';
  return 'default';
}

function targetRoute(targetModule: string, targetRecordId: string | null): string | null {
  if (!targetRecordId) return null;
  switch (targetModule) {
    case 'bn_overpayments':
      return `/bn/overpayments/${targetRecordId}`;
    case 'bn_claims':
      return `/bn/claims/${targetRecordId}`;
    case 'bn_awards':
      return `/bn/awards/${targetRecordId}`;
    default:
      return null;
  }
}

export const BnMortalityRequiredActionsPanel: React.FC<{ eventId: string }> = ({ eventId }) => {
  const q = useMortalityRequiredActions(eventId);
  if (q.isLoading) return <Skeleton className="h-32" />;
  if (q.isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Required actions could not be loaded.</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-2">
          <span>Closure readiness is unknown until this loads.</span>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>
        </AlertDescription>
      </Alert>
    );
  }
  const rows = q.data?.data ?? [];
  const blocking = rows.filter((r) => r.blocksClosure).length;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Required follow-on actions</CardTitle>
        {blocking > 0 ? (
          <Badge variant="destructive" data-testid="mort-closure-blocked">
            {blocking} blocking closure
          </Badge>
        ) : (
          <Badge variant="secondary" data-testid="mort-closure-clear">No blocking actions</Badge>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No follow-on actions are registered for this event.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Mandatory</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Resolved</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} data-testid={`mort-required-action-${r.actionCode}`}>
                  <TableCell className="text-xs font-mono">{r.actionCode}</TableCell>
                  <TableCell className="text-xs">{r.isMandatory ? 'Yes' : 'No'}</TableCell>
                  <TableCell>
                    <Badge variant={r.blocksClosure ? 'destructive' : 'outline'} className="text-[10px]">
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.resolvedAt ? new Date(r.resolvedAt).toLocaleString() : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export const BnMortalityHandoffsPanel: React.FC<{ eventId: string }> = ({ eventId }) => {
  const q = useMortalityHandoffs(eventId);
  if (q.isLoading) return <Skeleton className="h-32" />;
  if (q.isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Cross-module handoffs could not be loaded.</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-2">
          <span>Downstream processing status is unknown until this loads.</span>
          <Button size="sm" variant="outline" onClick={() => q.refetch()}>Retry</Button>
        </AlertDescription>
      </Alert>
    );
  }
  const rows = q.data?.data ?? [];
  const outstanding = rows.filter((r) => r.isOutstanding).length;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm">Cross-module handoffs</CardTitle>
        <Badge variant={outstanding > 0 ? 'default' : 'secondary'} data-testid="mort-handoff-outstanding">
          {outstanding} outstanding
        </Badge>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No handoffs have been raised from this event.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Target module</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Target reference</TableHead>
                <TableHead>Raised</TableHead>
                <TableHead>Accepted</TableHead>
                <TableHead className="text-right">Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const route = targetRoute(r.targetModule, r.targetRecordId);
                return (
                  <TableRow key={r.handoffId} data-testid={`mort-handoff-${r.handoffType}`}>
                    <TableCell className="text-xs"><Badge variant="outline">{r.handoffType}</Badge></TableCell>
                    <TableCell className="text-xs">{r.targetModule}</TableCell>
                    <TableCell>
                      <Badge variant={handoffBadge(r.status)} className="text-[10px]">{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono">{r.targetReference ?? '—'}</TableCell>
                    <TableCell className="text-xs">{new Date(r.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-xs">
                      {r.acceptedAt ? new Date(r.acceptedAt).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {route ? (
                        <Button asChild size="sm" variant="ghost"><Link to={route}>Open</Link></Button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};
