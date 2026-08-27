import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, Circle, Loader2, TrendingUp } from 'lucide-react';
import { useEngagementProgress } from '@/hooks/useAuditPhase3';

interface Props {
  auditId: string;
}

export function AuditProgressPanel({ auditId }: Props) {
  const { data, isLoading } = useEngagementProgress(auditId);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Calculating audit progress...
        </CardContent>
      </Card>
    );
  }

  if (!data?.found) return null;

  const counts = data.counts;

  return (
    <Card className="border-primary/20 bg-primary/[0.02]">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Audit Progress
          </h3>
          <span className="text-xs font-bold text-primary">
            {data.percent}% · {data.completed_stages}/{data.total_stages} stages
          </span>
        </div>
        <Progress value={data.percent} className="h-2 mb-4" />

        <div className="space-y-1.5">
          {data.stages.map((stage) => (
            <div key={stage.code} className="flex items-start gap-2">
              {stage.done ? (
                <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              )}
              <div className="min-w-0">
                <p className={`text-sm ${stage.done ? 'font-medium' : 'text-muted-foreground'}`}>
                  {stage.label}
                </p>
                <p className="text-xs text-muted-foreground">{stage.detail}</p>
              </div>
            </div>
          ))}
        </div>

        {counts.recommendations_without_action > 0 && (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
            {counts.recommendations_without_action} recommendation(s) still have no tracked action.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
