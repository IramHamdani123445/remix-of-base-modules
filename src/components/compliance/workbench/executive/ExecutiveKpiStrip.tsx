/**
 * Compact executive KPI strip. Every tile drills into an existing
 * operational page.
 */
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  Clock,
  FileCheck2,
  Gavel,
  HandCoins,
  Info,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import { MetricValue } from './MetricValue';
import type { ExecKpi } from '@/hooks/compliance/useExecutiveWorkbench';

const ICONS: Record<string, typeof AlertTriangle> = {
  'open-violations': AlertTriangle,
  'critical-violations': ShieldAlert,
  'overdue-violations': Clock,
  'open-cases': Briefcase,
  'pending-approvals': FileCheck2,
  'active-arrangements': HandCoins,
  'arrangement-breaches': ShieldAlert,
  'legal-recommendations': Gavel,
  exposure: Wallet,
};

const toneClass = (tone: ExecKpi['tone']) => {
  switch (tone) {
    case 'danger':
      return 'border-l-2 border-l-destructive';
    case 'warning':
      return 'border-l-2 border-l-amber-500';
    case 'success':
      return 'border-l-2 border-l-emerald-600';
    default:
      return 'border-l-2 border-l-primary/40';
  }
};

export function ExecutiveKpiStrip({ kpis }: { kpis: ExecKpi[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {kpis.map((kpi) => {
        const Icon = ICONS[kpi.key] ?? AlertTriangle;
        return (
          <Link key={kpi.key} to={kpi.href} className="group focus:outline-none">
            <Card className={cn('h-full transition-shadow hover:shadow-md', toneClass(kpi.tone))}>
              <CardContent className="space-y-1 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                    <span className="truncate">{kpi.label}</span>
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      {kpi.hint}
                      {kpi.moduleWide && ' Module-wide — not affected by the date/zone filters.'}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex items-end justify-between">
                  <MetricValue
                    result={kpi.result}
                    isLoading={kpi.isLoading}
                    format={kpi.format}
                    className="text-xl font-semibold"
                  />
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
