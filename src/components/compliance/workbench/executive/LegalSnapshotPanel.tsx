/**
 * Legal snapshot — read-only view of the Legal handoff pipeline. The Legal
 * module remains the system of record; this panel only links into it.
 */
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Gavel } from 'lucide-react';
import { MetricValue } from './MetricValue';
import { useLegalSnapshot, type MetricResult } from '@/hooks/compliance/useExecutiveWorkbench';

export function LegalSnapshotPanel() {
  const { data, isLoading, isError } = useLegalSnapshot();

  const asResult = (v: number | undefined): MetricResult<number> =>
    isError || !data ? { status: 'unavailable' } : { status: 'ok', value: Number(v ?? 0) };

  const tiles = [
    {
      key: 'pending',
      label: 'Recommendations pending review',
      value: data?.pendingRecommendations,
      href: '/compliance/enforcement/legal-recommendations',
    },
    {
      key: 'approved',
      label: 'Approved for referral',
      value: data?.approvedForReferral,
      href: '/compliance/enforcement/legal-recommendations',
    },
    {
      key: 'preparing',
      label: 'Referrals being prepared',
      value: data?.beingPrepared,
      href: '/compliance/enforcement/legal-referrals',
    },
    {
      key: 'with-legal',
      label: 'With Legal',
      value: data?.withLegal,
      href: '/compliance/enforcement/proceedings',
    },
    {
      key: 'returned',
      label: 'Returned by Legal',
      value: data?.returned,
      href: '/compliance/enforcement/legal-referrals',
    },
    {
      key: 'oldest',
      label: 'Oldest pending (days)',
      value: data?.oldestPendingDays ?? 0,
      href: '/compliance/enforcement/legal-recommendations',
    },
  ];

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gavel className="h-4 w-4 text-primary" />
          Legal Snapshot
        </CardTitle>
        <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
          <Link to="/compliance/enforcement/proceedings">Proceedings</Link>
        </Button>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {tiles.map((t) => (
          <Link
            key={t.key}
            to={t.href}
            className="rounded-md border p-3 transition-colors hover:border-primary"
          >
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <MetricValue
              result={asResult(t.value as number | undefined)}
              isLoading={isLoading}
              className="text-lg font-semibold"
            />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
