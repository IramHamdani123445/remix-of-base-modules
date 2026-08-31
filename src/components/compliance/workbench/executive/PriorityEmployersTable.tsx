/**
 * Top priority employers — ranked by exposure and open violations.
 */
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Building2 } from 'lucide-react';
import { formatCurrency } from '@/utils/formatCurrency';
import { usePriorityEmployers, type ExecFilters } from '@/hooks/compliance/useExecutiveWorkbench';

export function PriorityEmployersTable({ filters }: { filters: ExecFilters }) {
  const { data, isLoading, isError } = usePriorityEmployers(filters);
  const rows = data || [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-primary" />
          Top Priority Employers
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="p-6 text-sm text-muted-foreground">
            Priority employers could not be loaded — this is not an empty result.
          </p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            No employers match the current filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employer</TableHead>
                  <TableHead>Risk band</TableHead>
                  <TableHead className="text-right">Open violations</TableHead>
                  <TableHead className="text-right">Exposure</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead>Arrangement</TableHead>
                  <TableHead>Legal</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.employer_id}>
                    <TableCell className="max-w-[220px] truncate font-medium">
                      {r.employer_name || r.employer_id}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          ['CRITICAL', 'HIGH'].includes((r.risk_band || '').toUpperCase())
                            ? 'destructive'
                            : 'outline'
                        }
                      >
                        {r.risk_band || 'UNRATED'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(r.open_violations ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(Number(r.outstanding_exposure ?? 0))}
                    </TableCell>
                    <TableCell className="max-w-[150px] truncate text-xs">
                      {r.assigned_officer || 'Unassigned'}
                    </TableCell>
                    <TableCell className="text-xs">{r.arrangement_status || '—'}</TableCell>
                    <TableCell className="text-xs">{r.legal_status || '—'}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline" className="h-7">
                        <Link to={`/compliance/employers/${r.employer_id}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
