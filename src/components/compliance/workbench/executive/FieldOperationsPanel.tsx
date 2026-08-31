/**
 * Field operations snapshot — visits, plan approvals and inspections.
 */
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { MapPin } from 'lucide-react';
import { MetricValue } from './MetricValue';
import { useFieldOperations, type MetricResult } from '@/hooks/compliance/useExecutiveWorkbench';

const toResult = (value: number | null | undefined): MetricResult<number> =>
  value === null || value === undefined ? { status: 'unavailable' } : { status: 'ok', value };

export function FieldOperationsPanel() {
  const { data, isLoading, isError } = useFieldOperations();

  const tiles = [
    { key: 'today', label: 'Visits today', value: data?.scheduledToday, href: '/compliance/field/planning' },
    { key: 'week', label: 'Visits this week', value: data?.scheduledWeek, href: '/compliance/field/planning' },
    { key: 'overdue', label: 'Overdue visits', value: data?.overdue, href: '/compliance/field/planning' },
    { key: 'plans', label: 'Plans awaiting approval', value: data?.plansPending, href: '/compliance/field/pending-review' },
    { key: 'inspections', label: 'Inspections recorded', value: data?.inspections, href: '/compliance/field/inspections' },
    { key: 'completed', label: 'Visits completed', value: data?.completed, href: '/compliance/field/planning' },
  ];

  const scheduled = Number(data?.scheduledWeek ?? 0);
  const completed = Number(data?.completed ?? 0);
  const execution: MetricResult<number> =
    isError || !data
      ? { status: 'unavailable' }
      : { status: 'ok', value: scheduled > 0 ? Math.min(100, Math.round((completed / scheduled) * 100)) : 0 };

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPin className="h-4 w-4 text-primary" />
          Field Operations
        </CardTitle>
        <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
          <Link to="/compliance/field/inspections">Inspections</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {tiles.map((t) => (
            <Link
              key={t.key}
              to={t.href}
              className="rounded-md border p-3 transition-colors hover:border-primary"
            >
              <p className="text-xs text-muted-foreground">{t.label}</p>
              <MetricValue
                result={isError ? { status: 'unavailable' } : toResult(t.value as number | null | undefined)}
                isLoading={isLoading}
                className="text-lg font-semibold"
              />
            </Link>
          ))}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Plan execution (completed vs scheduled)</span>
            <span className="font-medium tabular-nums">
              {execution.status === 'unavailable' ? 'Unavailable' : `${execution.value}%`}
            </span>
          </div>
          <Progress value={execution.status === 'ok' ? execution.value : 0} className="h-2" />
        </div>

        {data?.unavailable?.length ? (
          <p className="text-[11px] text-muted-foreground">
            Some field metrics could not be loaded: {data.unavailable.join(', ')}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
