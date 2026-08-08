/**
 * BN Uprating — module overview ("what is happening, and what needs me?").
 *
 * The overview is a routing surface only. It counts governed run records
 * returned by `bn_uprating_run_list_v1` and sends the officer to the
 * destination that owns the work. It never recomputes lifecycle rules, and a
 * failed read is shown as unavailable — never as zero.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle } from 'lucide-react';
import { BnQueueSummaryCards, type BnQueueSummaryItem } from '@/components/bn/ux';
import { fetchUpratingRunList } from '@/services/bn/uprating/upratingRunService';
import type { BnUpratingRunListRow } from '@/types/bn/uprating/upratingRun';

export const UPRATING_OVERVIEW_TILES: readonly {
  id: string;
  label: string;
  description: string;
  statuses: readonly string[];
  destination: string;
}[] = [
  {
    id: 'preparation',
    label: 'In preparation',
    description: 'Population, exceptions and simulation',
    statuses: ['DRAFT', 'PARAMETERISED', 'POPULATION_BUILT', 'SIMULATED'],
    destination: '/bn/uprating/runs',
  },
  {
    id: 'approval',
    label: 'Awaiting approval',
    description: 'Independent approval required',
    statuses: ['PENDING_APPROVAL', 'SUBMITTED_FOR_APPROVAL'],
    destination: '/bn/uprating/approvals',
  },
  {
    id: 'scheduled',
    label: 'Approved & scheduled',
    description: 'Waiting for the execution window',
    statuses: ['APPROVED', 'SCHEDULED'],
    destination: '/bn/uprating/approvals',
  },
  {
    id: 'execution',
    label: 'In execution',
    description: 'Batches applying the approved result',
    statuses: ['EXECUTING', 'PARTIALLY_EXECUTED', 'EXECUTED'],
    destination: '/bn/uprating/operations?stage=execution',
  },
  {
    id: 'post_execution',
    label: 'Post-execution',
    description: 'Rebuilds, notices, reconciliation and rollback',
    statuses: ['REBUILDING', 'NOTIFYING', 'RECONCILING', 'RECONCILED', 'ROLLING_BACK', 'ROLLED_BACK'],
    destination: '/bn/uprating/operations?stage=operations',
  },
];

export const BnUpratingOverview: React.FC = () => {
  const navigate = useNavigate();

  const runs = useQuery({
    queryKey: ['bn-uprating-run-list', 'overview'],
    queryFn: async () => {
      const result = await fetchUpratingRunList({}, 100, 0);
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data.rows as readonly BnUpratingRunListRow[];
    },
  });

  const rows = runs.data ?? [];

  const items: readonly BnQueueSummaryItem[] = UPRATING_OVERVIEW_TILES.map((tile) => ({
    id: tile.id,
    label: tile.label,
    description: tile.description,
    loading: runs.isLoading,
    unavailable: runs.isError,
    count: runs.isError ? undefined : rows.filter((r) => tile.statuses.includes(r.status)).length,
    onSelect: () => navigate(tile.destination),
  }));

  const attention = rows.filter((r) => r.simulation_state === 'STALE').slice(0, 5);
  const recent = [...rows]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 5);

  return (
    <div className="space-y-6" data-testid="bn-uprating-overview">
      <BnQueueSummaryCards
        ariaLabel="Uprating pipeline"
        items={items}
        className="xl:grid-cols-5"
      />

      {runs.isError && (
        <Alert variant="destructive" data-testid="bn-uprating-overview-unavailable">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Run information could not be loaded</AlertTitle>
          <AlertDescription>
            Counts are shown as unavailable rather than zero. Nothing has been changed.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Needs attention</CardTitle>
            <CardDescription>
              Runs whose simulation no longer matches the population or exception decisions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {runs.isLoading && <Skeleton className="h-16 w-full" />}
            {!runs.isLoading && !runs.isError && attention.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No run currently reports a stale simulation.
              </p>
            )}
            {attention.map((r) => (
              <div
                key={r.run_id}
                className="flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.run_reference}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.policy_code} · effective {r.target_effective_date}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/bn/uprating/runs/${r.run_id}?section=simulation`)}
                >
                  Open run
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent runs</CardTitle>
            <CardDescription>The most recently created uprating runs.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {runs.isLoading && <Skeleton className="h-16 w-full" />}
            {!runs.isLoading && !runs.isError && recent.length === 0 && (
              <p className="text-sm text-muted-foreground">No uprating run has been created yet.</p>
            )}
            {recent.map((r) => (
              <div
                key={r.run_id}
                className="flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.run_reference}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.policy_code} · effective {r.target_effective_date}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{r.status_label ?? r.status}</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => navigate(`/bn/uprating/runs/${r.run_id}`)}
                  >
                    Open
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default BnUpratingOverview;
