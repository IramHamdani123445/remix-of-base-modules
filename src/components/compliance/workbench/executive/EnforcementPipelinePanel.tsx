/**
 * Enforcement pipeline — stage counts derived from the configured
 * violation / case / notice / legal status models. Each stage drills into
 * the corresponding operational list.
 */
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronRight, GitBranch } from 'lucide-react';
import { MetricValue } from './MetricValue';
import {
  useEnforcementPipeline,
  type ExecFilters,
} from '@/hooks/compliance/useExecutiveWorkbench';

export function EnforcementPipelinePanel({ filters }: { filters: ExecFilters }) {
  const { stages, isLoading } = useEnforcementPipeline(filters);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitBranch className="h-4 w-4 text-primary" />
          Enforcement Pipeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-stretch gap-2">
          {stages.map((stage, i) => (
            <div key={stage.key} className="flex items-center gap-2">
              <Link
                to={stage.href}
                className="min-w-[120px] rounded-md border bg-card p-3 transition-colors hover:border-primary hover:bg-accent/40"
              >
                <p className="text-xs text-muted-foreground">{stage.label}</p>
                <MetricValue
                  result={stage.result}
                  isLoading={isLoading}
                  className="text-lg font-semibold"
                />
              </Link>
              {i < stages.length - 1 && (
                <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground lg:block" />
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
