/**
 * Team performance — officer workload and closure metrics from the
 * existing ce_v_officer_performance view.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Users } from 'lucide-react';
import { useTeamPerformance } from '@/hooks/compliance/useExecutiveWorkbench';

export function TeamPerformancePanel() {
  const { data, isLoading, isError } = useTeamPerformance();
  const rows = data || [];

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4 text-primary" />
          Team Performance
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="p-6 text-sm text-muted-foreground">
            Officer performance could not be loaded — this is not an empty result.
          </p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No officer activity recorded.</p>
        ) : (
          <div className="max-h-[320px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Officer</TableHead>
                  <TableHead className="text-right">Assigned</TableHead>
                  <TableHead className="text-right">Resolved</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead className="text-right">Avg days</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const rate = Number(r.resolution_rate ?? 0);
                  return (
                    <TableRow key={r.officer_id || r.officer_name}>
                      <TableCell className="max-w-[180px] truncate font-medium">
                        {r.officer_name || 'Unassigned'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(r.total_assigned ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(r.resolved_count ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(r.open_count ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.avg_resolution_days ?? '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={rate >= 70 ? 'secondary' : 'outline'}>{rate}%</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
