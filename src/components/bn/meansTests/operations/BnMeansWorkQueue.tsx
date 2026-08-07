/**
 * BN Means-Test — EPIC 13 generic operational queue table.
 *
 * A single governed surface renders every queue family (assessment,
 * information request, integration). Column choice follows the backend's
 * `row_kind`; membership, ageing, overdue state and the action wording are
 * always taken verbatim from the query result.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { meansOperationsService } from '@/services/bn/meansTests/meansOperationsService';
import {
  BN_MEANS_QUEUE_SORTS,
  meansQueueLabel,
  type BnMeansOperationalFilters,
  type BnMeansOperationalQueueCode,
  type BnMeansOperationalRow,
  type BnMeansQueueSort,
} from '@/types/bn/meansTests/meansOperations';
import { humaniseMeansCode } from '@/types/bn/meansTests/meansFieldContract';

const PAGE_SIZE = 25;

export interface BnMeansWorkQueueProps {
  queueCode: BnMeansOperationalQueueCode;
  /** Deep-link into the assessment workspace, honouring the backend section. */
  onOpen: (assessmentId: string, section?: string | null) => void;
  /** Assignment controls are only offered where the module permits writes. */
  canAssign?: boolean;
  actionsEnabled?: boolean;
  description?: string;
}

export const BnMeansWorkQueue: React.FC<BnMeansWorkQueueProps> = ({
  queueCode,
  onOpen,
  canAssign = false,
  actionsEnabled = false,
  description,
}) => {
  const queryClient = useQueryClient();
  const [filters, setFilters] = React.useState<BnMeansOperationalFilters>({});
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState<BnMeansQueueSort>('OLDEST');
  const [page, setPage] = React.useState(0);
  const [assignError, setAssignError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPage(0);
  }, [queueCode, filters, search, sort]);

  const effectiveFilters = React.useMemo<BnMeansOperationalFilters>(
    () => ({ ...filters, search: search || undefined }),
    [filters, search],
  );

  const queue = useQuery({
    queryKey: ['bn-means-ops-queue', queueCode, effectiveFilters, sort, page],
    queryFn: () =>
      meansOperationsService.queue(queueCode, effectiveFilters, PAGE_SIZE, page * PAGE_SIZE, sort),
  });

  const assign = useMutation({
    mutationFn: (input: { assessmentId: string; action: 'CLAIM' | 'RELEASE' }) =>
      meansOperationsService.assign(input.assessmentId, input.action),
    onSuccess: (result) => {
      if (result.status !== 'OK') {
        setAssignError(result.code ?? result.detail ?? 'The assignment could not be recorded.');
        return;
      }
      setAssignError(null);
      queryClient.invalidateQueries({ queryKey: ['bn-means-ops-queue'] });
      queryClient.invalidateQueries({ queryKey: ['bn-means-ops-counts'] });
      queryClient.invalidateQueries({ queryKey: ['bn-means-queue'] });
    },
  });

  const payload = queue.data?.status === 'OK' ? queue.data.data : null;
  const rows: readonly BnMeansOperationalRow[] = payload?.rows ?? [];
  const total = payload?.total ?? 0;
  const kind = rows[0]?.row_kind ?? 'ASSESSMENT';
  const showAssignment = canAssign && actionsEnabled && kind === 'ASSESSMENT';

  return (
    <div className="space-y-4" data-testid={`means-ops-queue-${queueCode}`}>
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Narrow this queue. Filtering is applied server-side.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor={`ops-search-${queueCode}`}>Search</Label>
            <Input
              id={`ops-search-${queueCode}`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Reference, name or identifier"
              data-testid="means-ops-search"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`ops-prog-${queueCode}`}>Benefit programme</Label>
            <Input
              id={`ops-prog-${queueCode}`}
              value={filters.benefit_programme ?? ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, benefit_programme: e.target.value || undefined }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`ops-assigned-${queueCode}`}>Assignment</Label>
            <select
              id={`ops-assigned-${queueCode}`}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={filters.assigned_to ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, assigned_to: e.target.value || undefined }))}
            >
              <option value="">Anyone</option>
              <option value="ME">Assigned to me</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`ops-sort-${queueCode}`}>Sort</Label>
            <select
              id={`ops-sort-${queueCode}`}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={sort}
              onChange={(e) => setSort(e.target.value as BnMeansQueueSort)}
              data-testid="means-ops-sort"
            >
              {BN_MEANS_QUEUE_SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {assignError && (
        <Alert variant="destructive" data-testid="means-ops-assign-error">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>The assignment was not applied</AlertTitle>
          <AlertDescription>{humaniseMeansCode(assignError)}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{meansQueueLabel(queueCode)}</CardTitle>
          <CardDescription>
            {queue.data?.status === 'OK'
              ? `${total} item(s)`
              : description ?? 'The item count is unavailable until the queue loads.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {queue.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : queue.data?.status === 'DENIED' ? (
            <Alert variant="destructive" data-testid="means-ops-queue-denied">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Access denied</AlertTitle>
              <AlertDescription>
                You do not hold read permission for Means-Test assessments.
              </AlertDescription>
            </Alert>
          ) : queue.isError || (queue.data && queue.data.status !== 'OK') ? (
            <Alert variant="destructive" data-testid="means-ops-queue-failed">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>This queue could not be loaded</AlertTitle>
              <AlertDescription>
                {queue.data?.detail ?? queue.data?.code ?? 'Unknown error'}
              </AlertDescription>
            </Alert>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="means-ops-queue-empty">
              Nothing is waiting in this queue.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Claimant</TableHead>
                      {kind === 'INFORMATION_REQUEST' && <TableHead>Information required</TableHead>}
                      {kind === 'INTEGRATION' && <TableHead>Integration step</TableHead>}
                      <TableHead>Status</TableHead>
                      <TableHead>Action required</TableHead>
                      <TableHead>Age</TableHead>
                      {kind !== 'INTEGRATION' && <TableHead>Due</TableHead>}
                      {kind === 'ASSESSMENT' && <TableHead>Owner</TableHead>}
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={`${row.row_kind}-${row.record_id}`}>
                        <TableCell className="font-medium">
                          {row.assessment_reference}
                          {row.record_reference && row.row_kind !== 'ASSESSMENT' && (
                            <span className="block text-xs text-muted-foreground">
                              {row.record_reference}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.person_label}
                          {row.person_masked_identifier && (
                            <span className="block text-xs text-muted-foreground">
                              {row.person_masked_identifier}
                            </span>
                          )}
                        </TableCell>
                        {kind === 'INFORMATION_REQUEST' && (
                          <TableCell>
                            {row.information_required ?? humaniseMeansCode(row.requirement_code ?? '—')}
                            {row.request_status_label && (
                              <span className="block text-xs text-muted-foreground">
                                {row.request_status_label}
                              </span>
                            )}
                          </TableCell>
                        )}
                        {kind === 'INTEGRATION' && (
                          <TableCell>
                            {row.integration_step ?? '—'}
                            {row.failure_code && (
                              <span className="block text-xs text-destructive">
                                {humaniseMeansCode(row.failure_code)}
                                {row.retryable ? ' — retryable' : ''}
                              </span>
                            )}
                          </TableCell>
                        )}
                        <TableCell>
                          <Badge variant="outline">{row.status_label}</Badge>
                        </TableCell>
                        <TableCell className="max-w-[220px] text-sm">
                          {row.action_required ?? '—'}
                        </TableCell>
                        <TableCell>
                          {row.age_days == null ? '—' : `${row.age_days} day(s)`}
                        </TableCell>
                        {kind !== 'INTEGRATION' && (
                          <TableCell>
                            {row.due_date ?? row.reassessment_due ?? '—'}
                            {row.days_overdue != null && (
                              <span className="block text-xs text-destructive">
                                {row.days_overdue} day(s) overdue
                              </span>
                            )}
                          </TableCell>
                        )}
                        {kind === 'ASSESSMENT' && (
                          <TableCell className="text-sm">
                            {row.is_mine ? 'You' : (row.assigned_to_label ?? 'Unassigned')}
                          </TableCell>
                        )}
                        <TableCell className="whitespace-nowrap text-right">
                          {showAssignment && !row.is_read_only && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mr-2"
                              disabled={assign.isPending || (!row.is_mine && row.assigned_to != null)}
                              onClick={() =>
                                assign.mutate({
                                  assessmentId: row.assessment_id,
                                  action: row.is_mine ? 'RELEASE' : 'CLAIM',
                                })
                              }
                              data-testid={`means-ops-assign-${row.record_id}`}
                            >
                              {row.is_mine ? 'Release' : 'Claim'}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onOpen(row.assessment_id, row.deep_link_section)}
                          >
                            Open
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={(page + 1) * PAGE_SIZE >= total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BnMeansWorkQueue;
