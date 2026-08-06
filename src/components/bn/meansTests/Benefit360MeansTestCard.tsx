/**
 * BN-MEANS-MT5 — Benefit 360 means-test integration.
 *
 * Read-only means-test posture for a single award. The card never mutates
 * state, never derives command availability, and never queries Means-Test
 * tables directly — it uses the governed summary query, which deliberately
 * omits household finances.
 *
 * A denied or failed read is stated explicitly so a caseworker never reads
 * "no assessment" from an unavailable source.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Scale } from 'lucide-react';
import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';

export const Benefit360MeansTestCard: React.FC<{ awardId: string | null }> = ({ awardId }) => {
  const q = useQuery({
    queryKey: ['bn-means-360', awardId],
    queryFn: () => meansQueryService.benefit360Summary({ awardId }),
    enabled: Boolean(awardId),
  });

  if (!awardId) return null;
  if (q.isLoading) return <Skeleton className="h-28" />;

  const status = q.data?.status;

  if (q.isError || (status && status !== 'OK')) {
    return (
      <Card data-testid="award360-means-unavailable">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Scale className="h-4 w-4" /> Means test
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {status === 'DENIED'
                ? 'You do not have access to means-test records, so means-test status cannot be shown for this award.'
                : 'Means-test status could not be loaded. Treat it as unknown, not as absent.'}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const summary = q.data?.data as Record<string, unknown> | null | undefined;

  if (!summary) {
    return (
      <Card data-testid="award360-means-none">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Scale className="h-4 w-4" /> Means test
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">No means-test assessment recorded for this award.</p>
        </CardContent>
      </Card>
    );
  }

  const rows: readonly (readonly [string, string])[] = [
    ['Reference', String(summary.assessment_reference ?? '—')],
    ['Reason', String(summary.assessment_reason ?? '—')],
    ['Policy version', String(summary.policy_version_id ?? '—')],
    [
      'Effective period',
      `${String(summary.effective_from ?? '—')} → ${summary.effective_to ? String(summary.effective_to) : 'open'}`,
    ],
    ['Result', summary.result ? String(summary.result) : 'Not yet determined'],
    ['Verification', String(summary.verification_status ?? '—')],
    ['Calculation', String(summary.calculation_status ?? 'NOT_CALCULATED')],
    [
      'Provisional result',
      summary.provisional_result ? String(summary.provisional_result) : 'Not yet calculated',
    ],
    ['Calculated on', summary.calculated_at ? String(summary.calculated_at) : '—'],
    ['Valid until', summary.valid_until ? String(summary.valid_until) : '—'],
    ['Reassessment due', summary.reassessment_due ? String(summary.reassessment_due) : '—'],
  ];


  return (
    <Card data-testid="award360-means-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Scale className="h-4 w-4" /> Means test
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{String(summary.status ?? '')}</Badge>
          {summary.missing_information === true && <Badge variant="secondary">Missing information</Badge>}
          {summary.pending_verification === true && <Badge variant="secondary">Pending verification</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid gap-2 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
              <dd className="text-sm">{value}</dd>
            </div>
          ))}
        </dl>
        <Button asChild size="sm" variant="ghost">
          <Link to="/bn/means-tests">Open means-test workspace</Link>
        </Button>
      </CardContent>
    </Card>
  );
};

export default Benefit360MeansTestCard;
