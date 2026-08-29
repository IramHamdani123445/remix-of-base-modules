import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { previewEmployerScore } from '@/services/compliance/riskScoringService';

const STATUS_STYLE: Record<string, string> = {
  operational: 'bg-emerald-500/15 text-emerald-700',
  configured: 'bg-amber-500/15 text-amber-700',
  configuration_error: 'bg-destructive/15 text-destructive',
};

interface Props {
  employerId: string;
  compact?: boolean;
}

/**
 * Checkpoint E — "Why is this employer HIGH?" panel. Every number shown comes
 * from the canonical engine, including the policy version used.
 */
export default function RiskExplainabilityPanel({ employerId, compact }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ce_risk_explainability', employerId],
    queryFn: () => previewEmployerScore(employerId),
    enabled: !!employerId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Evaluating risk factors…
        </CardContent>
      </Card>
    );
  }

  if (error || !data || data.ok === false) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Risk score unavailable</AlertTitle>
        <AlertDescription>
          {(data as { error?: string } | undefined)?.error ||
            'The risk engine could not evaluate this employer. Check the active risk policy configuration.'}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-sm">Risk Score Explainability</CardTitle>
            <CardDescription className="text-xs">
              Policy {data.policy_code} v{data.policy_version} · as of {data.as_of} · engine {data.engine_version}
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold">{Number(data.total_score).toFixed(2)}</div>
            <Badge variant={data.risk_band === 'CRITICAL' || data.risk_band === 'HIGH' ? 'destructive' : 'secondary'}>
              {data.risk_band ?? 'UNBANDED'}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.calculation_status === 'CONFIGURATION_ERROR' && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Configuration error</AlertTitle>
            <AlertDescription className="text-xs">
              {data.errors?.join(' · ') || 'One or more weighted factors cannot score.'}
            </AlertDescription>
          </Alert>
        )}
        {data.weights_confirmation !== 'CONFIRMED' && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle className="text-xs">Provisional weights</AlertTitle>
            <AlertDescription className="text-xs">
              Factor weights are recorded as {data.weights_confirmation.replaceAll('_', ' ').toLowerCase()} pending
              client sign-off (open decision E-RISK-FACTOR-WEIGHTS).
            </AlertDescription>
          </Alert>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Factor</TableHead>
              <TableHead className="text-right">Measurement</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead className="text-right">Weight</TableHead>
              <TableHead className="text-right">Contribution</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data.factors || []).map((f) => (
              <TableRow key={f.factor_code}>
                <TableCell>
                  <div className="font-medium text-sm">{f.factor_name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge className={STATUS_STYLE[f.status] || ''} variant="outline">
                      {f.status.replaceAll('_', ' ')}
                    </Badge>
                    {!compact && <span className="text-[11px] text-muted-foreground">{f.explanation}</span>}
                  </div>
                  {!compact && f.raw_detail && (
                    <div className="text-[11px] text-muted-foreground mt-1">{f.raw_detail}</div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{Number(f.raw_measurement).toFixed(2)}</TableCell>
                <TableCell className="text-right tabular-nums">{Number(f.factor_score).toFixed(2)}</TableCell>
                <TableCell className="text-right tabular-nums">{Number(f.weight_pct).toFixed(0)}%</TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {Number(f.weighted_contribution).toFixed(2)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={4} className="text-right font-semibold">
                Total
              </TableCell>
              <TableCell className="text-right font-bold tabular-nums">
                {Number(data.total_score).toFixed(2)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="text-[11px] text-muted-foreground">
          A high risk score is advisory only. It never authorises enforcement — Warning → Demand → Legal remains
          governed by the Checkpoint D approval workflow.
        </p>
      </CardContent>
    </Card>
  );
}
