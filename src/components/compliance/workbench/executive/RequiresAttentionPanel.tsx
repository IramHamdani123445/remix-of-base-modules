/**
 * Consolidated management attention queue. Actions link into the owning
 * workflow screens — no workflow logic is duplicated here.
 */
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useAttentionQueue, type ExecFilters } from '@/hooks/compliance/useExecutiveWorkbench';

const ageDays = (since?: string | null) =>
  since ? Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86400000)) : null;

const priorityVariant = (p?: string | null) => {
  const v = (p || '').toUpperCase();
  if (v === 'CRITICAL' || v === 'HIGH') return 'destructive' as const;
  if (v === 'MEDIUM') return 'secondary' as const;
  return 'outline' as const;
};

export function RequiresAttentionPanel({ filters }: { filters: ExecFilters }) {
  const { data, isLoading, isError } = useAttentionQueue(filters);
  const items = data?.items ?? [];
  const unavailable = data?.unavailable ?? [];

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Requires Attention
          {items.length > 0 && <Badge variant="secondary">{items.length}</Badge>}
        </CardTitle>
        {unavailable.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Some sources could not be loaded: {unavailable.join(', ')}.
          </p>
        )}
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
            The attention queue could not be loaded. This is not an empty queue.
          </p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
            Nothing currently requires management attention.
          </div>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employer</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Officer</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const age = ageDays(item.since);
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="max-w-[180px] truncate font-medium">
                        {item.employer}
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate">{item.item}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{item.type}</TableCell>
                      <TableCell>
                        {item.priority ? (
                          <Badge variant={priorityVariant(item.priority)}>{item.priority}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate text-xs">
                        {item.assignee || 'Unassigned'}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {age === null ? '—' : `${age}d`}
                      </TableCell>
                      <TableCell className="text-xs capitalize">
                        {item.stage.toLowerCase()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline" className="h-7">
                          <Link to={item.href}>{item.action}</Link>
                        </Button>
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
