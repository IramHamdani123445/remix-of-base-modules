/**
 * Field operations snapshot — inspections and weekly plan execution.
 */
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { MapPin } from 'lucide-react';
import { MetricValue } from './MetricValue';
import {
  useFieldOperations,
  type ExecFilters,
} from '@/hooks/compliance/useExecutiveWorkbench';

export function FieldOperationsPanel({ filters }: { filters: ExecFilters }) {
  const { tiles, execution, isLoading } = useFieldOperations(filters);

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
        <div className="grid grid-cols-2 gap-2">
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
                className="text-lg font-semibold"
              />
            </Link>
          ))}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Weekly plan execution</span>
            <span className="font-medium tabular-nums">
              {execution.status === 'unavailable' ? 'Unavailable' : `${execution.value}%`}
            </span>
          </div>
          <Progress value={execution.status === 'ok' ? execution.value : 0} className="h-2" />
        </div>
      </CardContent>
    </Card>
  );
}
