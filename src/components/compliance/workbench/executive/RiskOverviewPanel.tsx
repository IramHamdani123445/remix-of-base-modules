/**
 * Management risk panel — employer distribution across the configured
 * risk bands (ce_risk_bands / ce_risk_profiles). No hardcoded thresholds.
 */
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRiskOverview } from '@/hooks/compliance/useExecutiveWorkbench';

const BAND_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];

const bandClass = (band: string) => {
  switch (band.toUpperCase()) {
    case 'CRITICAL':
      return 'border-destructive/50 bg-destructive/5';
    case 'HIGH':
      return 'border-amber-500/50 bg-amber-500/5';
    case 'MEDIUM':
      return 'border-primary/30';
    default:
      return 'border-border';
  }
};

export function RiskOverviewPanel({ onSelectBand }: { onSelectBand?: (band: string) => void }) {
  const { data, isLoading, isError } = useRiskOverview();
  const navigate = useNavigate();

  const rows = (data || [])
    .slice()
    .sort((a, b) => BAND_ORDER.indexOf(a.risk_band.toUpperCase()) - BAND_ORDER.indexOf(b.risk_band.toUpperCase()));

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-primary" />
          Risk Overview
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Employers by configured risk band. Select a band to focus the dashboard.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="py-6 text-sm text-muted-foreground">
            Risk data could not be loaded — this is not an empty result.
          </p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">No employer risk profiles scored yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {rows.map((r) => (
              <button
                key={r.risk_band}
                type="button"
                onClick={() => onSelectBand?.(r.risk_band)}
                className={cn(
                  'rounded-md border p-3 text-left transition-colors hover:border-primary',
                  bandClass(r.risk_band),
                )}
              >
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {r.risk_band}
                  </Badge>
                  <span className="text-lg font-semibold tabular-nums">
                    {Number(r.employer_count).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Avg score {r.avg_score ?? '—'}
                </p>
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="text-xs text-primary underline-offset-2 hover:underline"
          onClick={() => navigate('/compliance/admin/settings/risk-policy')}
        >
          View configured risk policy
        </button>
      </CardContent>
    </Card>
  );
}
