/**
 * MEANS-TEST EPIC 10 — decision work queues.
 *
 * Five governed queues served by `bn_means_queues_v1`. Filtering, ageing
 * and ownership are all evaluated by the backend; this component only
 * chooses which queue to ask for and renders the rows it receives.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MeansGovernedSelect, MeansStateNotice } from '@/components/bn/meansTests/controls/MeansControls';
import { meansQueryService } from '@/services/bn/meansTests/meansQueryService';
import {
  BN_MEANS_DECISION_QUEUES,
  isAdjustmentQueueRow,
  type BnMeansDecisionQueueCode,
  type BnMeansDecisionQueueFilters,
} from '@/types/bn/meansTests/meansDecision';

export interface BnMeansDecisionQueueProps {
  /** Opens the assessment workspace on its Decision tab. */
  readonly onOpenAssessment: (assessmentId: string) => void;
  readonly defaultQueue?: BnMeansDecisionQueueCode;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

export const BnMeansDecisionQueue: React.FC<BnMeansDecisionQueueProps> = ({
  onOpenAssessment,
  defaultQueue = 'ASSESSMENTS_AWAITING_APPROVAL',
}) => {
  const [queueCode, setQueueCode] = React.useState<BnMeansDecisionQueueCode>(defaultQueue);
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [myWork, setMyWork] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const filters: BnMeansDecisionQueueFilters = React.useMemo(
    () => ({ ...(debounced ? { search: debounced } : {}), ...(myWork ? { my_work: true } : {}) }),
    [debounced, myWork],
  );

  const query = useQuery({
    queryKey: ['bn-means-decision-queue', queueCode, filters],
    queryFn: () => meansQueryService.decisionQueues(queueCode, filters, 50, 0),
  });

  const definition = BN_MEANS_DECISION_QUEUES.find((q) => q.code === queueCode)!;
  const envelope = query.data;
  const rows = envelope?.status === 'OK' ? (envelope.data ?? []) : [];

  return (
    <Card data-testid="means-decision-queue">
      <CardHeader className="space-y-3">
        <div>
          <CardTitle className="text-base">Decision work</CardTitle>
          <CardDescription>{definition.description}</CardDescription>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <MeansGovernedSelect
            id="means-decision-queue-select"
            label="Queue"
            optionSet={{
              state: 'SUCCESS',
              options: BN_MEANS_DECISION_QUEUES.map((q) => ({ value: q.code, label: q.label })),
            }}
            value={queueCode}
            onChange={(v) => setQueueCode(v as BnMeansDecisionQueueCode)}
          />
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="means-decision-queue-search">
              Search
            </label>
            <Input
              id="means-decision-queue-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Reference or person"
              data-testid="means-decision-queue-search"
            />
          </div>
          <div className="flex items-end">
            <Button
              variant={myWork ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMyWork((v) => !v)}
              data-testid="means-decision-queue-mywork"
            >
              {myWork ? 'Showing my work' : 'Show my work only'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : !envelope || envelope.status !== 'OK' ? (
          <MeansStateNotice
            state={envelope?.status === 'DENIED' ? 'DENIED' : 'FAILED'}
            reason={
              envelope?.status === 'DENIED'
                ? 'You do not have permission to view this queue.'
                : 'This queue could not be loaded.'
            }
            testId="means-decision-queue-unavailable"
          />
        ) : rows.length === 0 ? (
          <MeansStateNotice
            state="EMPTY"
            reason="There is no work waiting in this queue."
            testId="means-decision-queue-empty"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Work</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Waiting</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const isAdjustment = isAdjustmentQueueRow(row);
                const key = isAdjustment ? row.adjustment_id : row.assessment_id;
                return (
                  <TableRow key={key} data-testid={`means-decision-queue-row-${key}`}>
                    <TableCell className="font-medium">
                      {isAdjustment
                        ? (row.adjustment_reference ?? row.assessment_reference ?? '—')
                        : (row.assessment_reference ?? '—')}
                      <div className="text-xs text-muted-foreground">
                        {isAdjustment ? row.assessment_reference : row.person_label}
                      </div>
                    </TableCell>
                    <TableCell>
                      {definition.workType}
                      {isAdjustment && row.is_requester && (
                        <Badge variant="secondary" className="ml-2">
                          Your request
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{isAdjustment ? row.status : (row.assessment_status ?? '—')}</TableCell>
                    <TableCell>
                      {row.age_days !== null && row.age_days !== undefined
                        ? `${row.age_days} day${row.age_days === 1 ? '' : 's'}`
                        : formatDate(isAdjustment ? row.requested_at : row.updated_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onOpenAssessment(row.assessment_id)}
                        data-testid={`means-decision-queue-open-${key}`}
                      >
                        Open decision
                      </Button>
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

export default BnMeansDecisionQueue;
