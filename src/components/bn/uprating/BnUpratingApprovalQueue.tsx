/**
 * BN Uprating — Approval and scheduling queues (Epic 2).
 *
 * Operational surfaces for approvers and schedulers: runs awaiting an
 * independent decision, and approved runs with or without an execution
 * schedule. Both queues are backend-driven reads.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  fetchUpratingApprovalQueue,
  fetchUpratingScheduledRunQueue,
} from '@/services/bn/uprating/upratingRunService';
import { formatMinor } from '@/types/bn/uprating/upratingRun';

interface Props {
  readonly onOpenRun?: (runId: string) => void;
}

export const BnUpratingApprovalQueue: React.FC<Props> = ({ onOpenRun }) => {
  const [search, setSearch] = React.useState('');

  const approvalQuery = useQuery({
    queryKey: ['bn-uprating-approval-queue', search],
    queryFn: () => fetchUpratingApprovalQueue(search ? { search } : {}),
  });
  const scheduledQuery = useQuery({
    queryKey: ['bn-uprating-scheduled-queue'],
    queryFn: () => fetchUpratingScheduledRunQueue({}),
  });

  const approvals = approvalQuery.data?.data?.rows ?? [];
  const scheduled = scheduledQuery.data?.data?.rows ?? [];

  return (
    <Tabs defaultValue="awaiting">
      <TabsList>
        <TabsTrigger value="awaiting">
          Awaiting approval{approvals.length ? ` (${approvals.length})` : ''}
        </TabsTrigger>
        <TabsTrigger value="scheduling">
          Approved &amp; scheduling{scheduled.length ? ` (${scheduled.length})` : ''}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="awaiting" className="pt-4">
        <Card>
          <CardHeader>
            <CardTitle>Runs awaiting an approval decision</CardTitle>
            <CardDescription>
              Each row is an immutable package submitted for independent approval.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by run reference or name"
              className="max-w-sm"
            />
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>Policy</TableHead>
                    <TableHead>Effective</TableHead>
                    <TableHead className="text-right">Included</TableHead>
                    <TableHead className="text-right">Simulated change</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead className="text-right">Waiting</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {approvals.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        No runs are awaiting an approval decision.
                      </TableCell>
                    </TableRow>
                  )}
                  {approvals.map((r) => (
                    <TableRow key={r.approval_id}>
                      <TableCell>
                        <div className="font-medium">{r.run_reference}</div>
                        <div className="text-xs text-muted-foreground">Cycle #{r.cycle_no}</div>
                      </TableCell>
                      <TableCell>
                        <div>{r.policy_code}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.policy_version_reference ?? '—'}
                        </div>
                      </TableCell>
                      <TableCell>{r.target_effective_date}</TableCell>
                      <TableCell className="text-right">
                        {r.included_count}/{r.population_total}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMinor(r.simulated_change_minor)}
                      </TableCell>
                      <TableCell>
                        <div>{r.submitted_by_name ?? '—'}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(r.submitted_at).toLocaleString()}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{r.age_hours}h</TableCell>
                      <TableCell className="text-right">
                        {onOpenRun && (
                          <Button size="sm" variant="outline" onClick={() => onOpenRun(r.run_id)}>
                            Open
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="scheduling" className="pt-4">
        <Card>
          <CardHeader>
            <CardTitle>Approved runs and execution scheduling</CardTitle>
            <CardDescription>
              Approved runs, whether or not an execution schedule has been recorded. Nothing here has
              executed.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead>Approved</TableHead>
                  <TableHead>Planned execution</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {scheduled.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No approved runs.
                    </TableCell>
                  </TableRow>
                )}
                {scheduled.map((r) => (
                  <TableRow key={r.run_id}>
                    <TableCell>
                      <div className="font-medium">{r.run_reference}</div>
                      <div className="text-xs text-muted-foreground">{r.run_name ?? '—'}</div>
                    </TableCell>
                    <TableCell>{r.target_effective_date}</TableCell>
                    <TableCell>
                      <div>{r.approved_by_name ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.approved_at ? new Date(r.approved_at).toLocaleString() : '—'}
                      </div>
                    </TableCell>
                    <TableCell>
                      {r.planned_execution_at
                        ? `${new Date(r.planned_execution_at).toLocaleString()} (${r.time_zone ?? ''})`
                        : 'Not scheduled'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.queue_state === 'APPROVED_NOT_SCHEDULED' ? 'outline' : 'secondary'}>
                        {r.queue_state === 'APPROVED_NOT_SCHEDULED'
                          ? 'Awaiting scheduling'
                          : r.queue_state === 'DUE'
                            ? 'Due'
                            : 'Scheduled'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {onOpenRun && (
                        <Button size="sm" variant="outline" onClick={() => onOpenRun(r.run_id)}>
                          Open
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
};
