/**
 * Shell for a single trend chart: title, business explanation, availability
 * state and an expand-to-full-size dialog. Charts are passed as children so
 * every series on the Trend Analysis page renders identically.
 */
import { ReactNode, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Maximize2, Info, Loader2 } from 'lucide-react';
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { SectionAvailability } from '@/hooks/compliance/useTrendAnalytics';

interface Props {
  title: string;
  description?: string;
  status: SectionAvailability;
  isLoading?: boolean;
  historyFrom?: string | null;
  reason?: string | null;
  footnote?: string;
  className?: string;
  height?: number;
  children: ReactNode;
}

function historyNote(historyFrom?: string | null) {
  if (!historyFrom) return null;
  const d = new Date(`${historyFrom}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return `History available from ${d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`;
}

export function TrendChartCard({
  title, description, status, isLoading, historyFrom, reason, footnote,
  className, height = 280, children,
}: Props) {
  const [open, setOpen] = useState(false);
  const note = historyNote(historyFrom);

  const body = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center" style={{ height }}>
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      );
    }
    if (status === 'unavailable') {
      return (
        <div className="flex flex-col items-center justify-center text-center text-sm text-muted-foreground" style={{ height }}>
          <p className="font-medium">Not available</p>
          <p className="mt-1 max-w-sm">{reason || 'This trend cannot be produced from the data currently held.'}</p>
        </div>
      );
    }
    if (status === 'no_data') {
      return (
        <div className="flex flex-col items-center justify-center text-center text-sm text-muted-foreground" style={{ height }}>
          <p className="font-medium">No records in this period</p>
          <p className="mt-1">Nothing has been recorded for the selected period and filters.</p>
        </div>
      );
    }
    return <>{children}</>;
  };

  return (
    <>
      <Card className={className}>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div className="space-y-1">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              {title}
              {description && (
                <TooltipProvider>
                  <UiTooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">{description}</TooltipContent>
                  </UiTooltip>
                </TooltipProvider>
              )}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {status === 'insufficient_history' && (
                <Badge variant="outline" className="text-[10px]">Limited history</Badge>
              )}
              {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
            </div>
          </div>
          {status !== 'unavailable' && status !== 'no_data' && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(true)} aria-label="Expand chart">
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {body()}
          {footnote && status === 'ok' && (
            <p className="mt-2 text-[11px] text-muted-foreground">{footnote}</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
          <div className="pt-2">{children}</div>
          {footnote && <p className="text-xs text-muted-foreground">{footnote}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
