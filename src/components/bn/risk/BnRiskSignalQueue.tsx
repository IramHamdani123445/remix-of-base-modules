/**
 * BN Risk — signal work queue.
 *
 * Server-side filtering, paging and counts. Every column value and every
 * action wording comes from the governed query result.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatAuditDate } from '@/lib/dateFormat';
import { riskQueryService } from '@/services/bn/risk/riskQueryService';
import type { BnRiskSignalQueueFilters } from '@/types/bn/risk/riskSignals';
import { referenceItems, useRiskReferenceData } from './useRiskReference';

const PAGE_SIZE = 25;
const ANY = '__ANY__';

interface Props {
  onOpenSignal: (signalId: string) => void;
  initialStatus?: string;
}

export const BnRiskSignalQueue: React.FC<Props> = ({ onOpenSignal, initialStatus }) => {
  const { data: reference } = useRiskReferenceData();
  const [filters, setFilters] = React.useState<BnRiskSignalQueueFilters>(
    initialStatus ? ({ status: initialStatus } as BnRiskSignalQueueFilters) : {},
  );
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => { setPage(1); }, [filters, debounced]);

  const queue = useQuery({
    queryKey: ['bn-risk-signal-queue', filters, debounced, page],
    queryFn: async () => {
      const result = await riskQueryService.signalQueue(
        { ...filters, search: debounced || undefined },
        page,
        PAGE_SIZE,
      );
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
  });

  const setFilter = (key: keyof BnRiskSignalQueueFilters, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value === ANY ? undefined : value }));

  const totalPages = Math.max(1, Math.ceil((queue.data?.total_count ?? 0) / PAGE_SIZE));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Signal queue</CardTitle>
        <CardDescription>
          Detected and referred observations awaiting triage or review.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="space-y-1 xl:col-span-2">
            <Label>Search</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Signal reference, source reference, person"
            />
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={filters.status ?? ANY} onValueChange={(v) => setFilter('status', v)}>
              <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All statuses</SelectItem>
                {referenceItems(reference, 'SIGNAL_STATUS').map((i) => (
                  <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Category</Label>
            <Select
              value={filters.category_code ?? ANY}
              onValueChange={(v) => setFilter('category_code', v)}
            >
              <SelectTrigger><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value={ANY}>All categories</SelectItem>
                {referenceItems(reference, 'CATEGORY').map((i) => (
                  <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Ownership</Label>
            <Select
              value={filters.ownership ?? 'ALL'}
              onValueChange={(v) => setFilter('ownership', v)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All signals</SelectItem>
                <SelectItem value="MINE">Assigned to me</SelectItem>
                <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {queue.isError && (
          <Alert variant="destructive">
            <AlertTitle>Queue unavailable</AlertTitle>
            <AlertDescription>
              The signal queue could not be loaded. This is not an empty queue — please
              retry, or contact an administrator if it continues.
            </AlertDescription>
          </Alert>
        )}

        {queue.isLoading && <Skeleton className="h-48 w-full" />}

        {queue.data && (
          <>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Signal</TableHead>
                    <TableHead>Person</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Raised by</TableHead>
                    <TableHead>Detected</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Next step</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.data.rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground">
                        No signals match the current filters.
                      </TableCell>
                    </TableRow>
                  )}
                  {queue.data.rows.map((row) => (
                    <TableRow key={row.signal_id}>
                      <TableCell className="font-medium">
                        {row.signal_reference}
                        {row.linked_signal_count > 0 && (
                          <Badge variant="outline" className="ml-2">
                            {row.linked_signal_count} linked
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.person_name ?? '—'}
                        <span className="block text-xs text-muted-foreground">
                          {row.person_masked_identifier ?? ''}
                        </span>
                      </TableCell>
                      <TableCell>{row.category_label}</TableCell>
                      <TableCell>{row.source_module_label}</TableCell>
                      <TableCell>
                        {formatAuditDate(row.detected_at, false)}
                        <span className="block text-xs text-muted-foreground">
                          {row.age_days} day{row.age_days === 1 ? '' : 's'} old
                        </span>
                      </TableCell>
                      <TableCell>{row.priority_label ?? '—'}</TableCell>
                      <TableCell><Badge variant="secondary">{row.status_label}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.action_required}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => onOpenSignal(row.signal_id)}>
                          Open
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{queue.data.total_count} signal(s)</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm" variant="outline" disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span>Page {page} of {totalPages}</span>
                <Button
                  size="sm" variant="outline" disabled={page >= totalPages}
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
  );
};
