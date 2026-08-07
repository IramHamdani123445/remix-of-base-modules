/**
 * BN Means-Test — EPIC 13 operational overview.
 *
 * Counts, configuration health and queue navigation. Nothing is computed
 * here: a queue whose count failed is shown as unavailable, never as zero.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react';
import { meansOperationsService } from '@/services/bn/meansTests/meansOperationsService';
import {
  BN_MEANS_QUEUE_GROUPS,
  meansQueueLabel,
  type BnMeansOperationalQueueCode,
} from '@/types/bn/meansTests/meansOperations';

export interface BnMeansOperationalOverviewProps {
  onOpenQueue: (queueCode: BnMeansOperationalQueueCode) => void;
}

export const BnMeansOperationalOverview: React.FC<BnMeansOperationalOverviewProps> = ({
  onOpenQueue,
}) => {
  const counts = useQuery({
    queryKey: ['bn-means-ops-counts'],
    queryFn: () => meansOperationsService.counts(),
  });

  const payload = counts.data?.status === 'OK' ? counts.data.data : null;
  const health = payload?.configuration_health ?? null;

  return (
    <div className="space-y-6" data-testid="means-ops-overview">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Operational position</CardTitle>
            <CardDescription>
              {payload
                ? `Counts generated ${new Date(payload.generated_at).toLocaleString()}`
                : 'Counts are unavailable until the operational query loads.'}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => counts.refetch()}
            disabled={counts.isFetching}
            data-testid="means-ops-refresh"
          >
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {counts.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : counts.data?.status === 'DENIED' ? (
            <Alert variant="destructive" data-testid="means-ops-counts-denied">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Access denied</AlertTitle>
              <AlertDescription>
                You do not hold read permission for Means-Test operational queues.
              </AlertDescription>
            </Alert>
          ) : counts.isError || (counts.data && counts.data.status !== 'OK') ? (
            <Alert variant="destructive" data-testid="means-ops-counts-failed">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Operational counts could not be loaded</AlertTitle>
              <AlertDescription>
                {counts.data?.detail ?? counts.data?.code ?? 'Unknown error'}
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-6">
              {health && (
                <div
                  className="rounded-md border p-3 text-sm"
                  data-testid="means-ops-configuration-health"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Configuration health</span>
                    <Badge variant={health.status === 'OK' ? 'secondary' : 'destructive'}>
                      {health.status === 'OK' ? 'Healthy' : 'Attention required'}
                    </Badge>
                  </div>
                  <p className="pt-1 text-muted-foreground">
                    {health.active_policies} active polic
                    {health.active_policies === 1 ? 'y' : 'ies'}, {health.draft_versions} draft
                    version(s), {health.policies_without_active_version} polic
                    {health.policies_without_active_version === 1 ? 'y' : 'ies'} without an active
                    version.
                  </p>
                </div>
              )}

              {BN_MEANS_QUEUE_GROUPS.map((group) => (
                <section key={group.code} className="space-y-2" aria-label={group.label}>
                  <div>
                    <h3 className="text-sm font-semibold">{group.label}</h3>
                    <p className="text-xs text-muted-foreground">{group.description}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {group.queues.map((queue) => {
                      const entry = payload?.counts?.[queue];
                      return (
                        <button
                          key={queue}
                          type="button"
                          onClick={() => onOpenQueue(queue)}
                          data-testid={`means-ops-tile-${queue}`}
                          className="rounded-md border p-3 text-left transition-colors hover:border-primary hover:bg-accent/40"
                        >
                          <span className="block text-sm font-medium">{meansQueueLabel(queue)}</span>
                          <span className="block pt-1 text-2xl font-semibold">
                            {!entry
                              ? '—'
                              : entry.status === 'OK'
                                ? (entry.count ?? 0)
                                : 'Unavailable'}
                          </span>
                          {entry && entry.status !== 'OK' && (
                            <span className="block text-xs text-destructive">
                              Count could not be produced ({entry.status})
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BnMeansOperationalOverview;
