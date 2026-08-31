/**
 * Renders a metric value, an explicit "Unavailable" state, or a skeleton.
 * A failed/unauthorised query must never look like a genuine zero.
 */
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/utils/formatCurrency';
import type { MetricResult } from '@/hooks/compliance/useExecutiveWorkbench';

interface Props {
  result: MetricResult<number>;
  isLoading?: boolean;
  format?: 'number' | 'currency';
  className?: string;
}

export function MetricValue({ result, isLoading, format = 'number', className }: Props) {
  if (isLoading) return <Skeleton className="h-7 w-20" />;

  if (result.status === 'unavailable') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground">
            Unavailable <HelpCircle className="h-3.5 w-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          This metric could not be loaded. It is not a zero — check your access or try refreshing.
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <span className={cn('tabular-nums', className)}>
      {format === 'currency'
        ? formatCurrency(result.value)
        : result.value.toLocaleString()}
    </span>
  );
}
