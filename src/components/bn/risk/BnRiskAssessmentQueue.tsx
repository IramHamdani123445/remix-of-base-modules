/**
 * BN Risk — risk assessment work queue (EPIC 1).
 *
 * Server-side filtering, paging and counts. Officers open an assessment
 * from here; the workspace itself is a deep link on the governed Risk
 * route, so no new route is introduced.
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
import { riskAssessmentService } from '@/services/bn/risk/riskAssessmentService';
import type { BnRiskAssessmentQueueFilters } from '@/types/bn/risk/riskAssessment';
import { referenceItems, useRiskReferenceData } from './useRiskReference';

const PAGE_SIZE = 25;
const ANY = '__ANY__';

interface Props {
  onOpenAssessment: (assessmentId: string) => void;
}

export const BnRiskAssessmentQueue: React.FC<Props> = ({ onOpenAssessment }) => {
  const { data: reference } = useRiskReferenceData();
  const [filters, setFilters] = React.useState<BnRiskAssessmentQueueFilters>({});
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => { setPage(1); }, [filters, debounced]);

  const queue = useQuery({
    queryKey: ['bn-risk-assessment-queue', filters, debounced, page],
    queryFn: async () => {
      const result = await riskAssessmentService.queue(
        { ...filters, search: debounced || undefined },
        page,
        PAGE_SIZE,
      );
      if (result.status !== 'OK' || !result.data) throw new Error(result.code ?? result.status);
      return result.data;
    },
  });

  const totalPages = Math.max(1, Math.ceil((queue.data?.total_count ?? 0) / PAGE_SIZE));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Risk assessments</CardTitle>
        <CardDescription>
          Open reviews built from confirmed signals. Information gathering only —
          no assessment here changes a benefit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1 xl:col-span-2">
            <Label>Search</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Assessment reference or description"
            />
          </div>
          <div className="space-y-1">
            <Label>Stage</Label>
            <Select
              value={filters.status ?? ANY}
              onValueChange={(v) =>
                setFilters((p) => ({
                  ...p,
                  status: v === ANY ? undefined : (v as BnRiskAssessmentQueueFilters['status']),
                }))
              }
            >
              <SelectTrigger><SelectValue placeholder="All stages" /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value={ANY}>All stages</SelectItem>
                {referenceItems(reference, 'ASSESSMENT_STATUS').map((i) => (
                  <SelectItem key={i.code} value={i.code}>{i.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Ownership</Label>
            <Select
              value={filters.ownership ?? 'ALL'}
              onValueChange={(v) =>
                setFilters((p) => ({
                  ...p,
                  ownership: v as BnRiskAssessmentQueueFilters['ownership'],
                }))
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All assessments</SelectItem>
                <SelectItem value="MINE">Assigned to me</SelectItem>
                <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {queue.isError && (
          <Alert variant="destructive">
            <AlertTitle>Assessment queue unavailable</AlertTitle>
            <AlertDescription>
              The queue could not be loaded. This is not an empty queue — please retry.
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
                    <TableHead>Assessment</TableHead>
                    <TableHead>Person</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Opened</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Next step</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.data.rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        No assessments match the current filters.
                      </TableCell>
                    </TableRow>
                  )}
                  {queue.data.rows.map((row) => (
                    <TableRow key={row.assessment_id}>
                      <TableCell className="font-medium">
                        {row.assessment_reference}
                        {row.linked_signal_count > 0 && (
                          <Badge variant="outline" className="ml-2">
                            {row.linked_signal_count} signal
                            {row.linked_signal_count === 1 ? '' : 's'}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.person_name ?? '—'}
                        <span className="block text-xs text-muted-foreground">
                          {row.person_masked_identifier ?? ''}
                        </span>
                      </TableCell>
                      <TableCell>{row.primary_category_label}</TableCell>
                      <TableCell>
                        {formatAuditDate(row.opened_at, false)}
                        <span className="block text-xs text-muted-foreground">
                          {row.age_days} day{row.age_days === 1 ? '' : 's'} old
                        </span>
                      </TableCell>
                      <TableCell>{row.assigned_owner_name ?? 'Unassigned'}</TableCell>
                      <TableCell><Badge variant="secondary">{row.status_label}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.action_required}
                        {row.outstanding_information > 0 && (
                          <span className="block text-xs">
                            {row.outstanding_information} outstanding request(s)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onOpenAssessment(row.assessment_id)}
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
              <span>{queue.data.total_count} assessment(s)</span>
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
