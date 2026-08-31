/**
 * Legal snapshot — read-only view of the Legal handoff pipeline. The Legal
 * module remains the system of record; this panel only links into it.
 */
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Gavel } from 'lucide-react';
import { MetricValue } from './MetricValue';
import { useLegalSnapshot, type ExecFilters } from '@/hooks/compliance/useExecutiveWorkbench';

export function LegalSnapshotPanel({ filters }: { filters: ExecFilters }) {
  const { tiles, isLoading } = useLegalSnapshot(filters);

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gavel className="h-4 w-4 text-primary" />
          Legal Snapshot
        </CardTitle>
        <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
          <Link to="/compliance/enforcement/proceedings">Proceedings</Link>
        </Button>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        {tiles.map((t) => (
          <Link
            key={t.key}
            to={t.href}
            className="rounded-md border p-3 transition-colors hover:border-primary"
          >
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <MetricValue
              result={t.result}
              isLoading={isLoading}
              format={t.format}
              className="text-lg font-semibold"
            />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
