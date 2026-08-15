/**
 * Active Calculation Panel
 *
 * Shows the latest calculation with the formula trace and exposes
 * Run / Re-run buttons. Empty state offers a single "Run Calculation"
 * CTA. Re-run requires that eligibility has passed (engine enforces it).
 */
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Play, RefreshCw, Calculator } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { runClaimCalculation } from '@/services/bn/claimActionRunner';
import { formatDateForDisplay } from '@/lib/format-config';
import { BnEmptyState } from '@/components/bn/shared/BnEmptyState';
import { MedicalExpensesPanel } from './MedicalExpensesPanel';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  claimId: string;
  userCode: string;
  calculations: any[];
}

export const ActiveCalculationPanel: React.FC<Props> = ({ claimId, userCode, calculations }) => {
  const [running, setRunning] = useState(false);
  const qc = useQueryClient();
  const latest = calculations?.[0];

  // Reimbursement claims need captured expense lines before a payable amount exists.
  const { data: isReimbursement = false } = useQuery({
    queryKey: ['bn', 'claim-calc-type', claimId],
    queryFn: async () => {
      const db = supabase as any;
      const { data: claim } = await db
        .from('bn_claim')
        .select('product_version_id')
        .eq('id', claimId)
        .maybeSingle();
      if (!claim?.product_version_id) return false;
      const { data: rules } = await db
        .from('bn_calculation_rule')
        .select('calc_type, is_active')
        .eq('product_version_id', claim.product_version_id);
      return (rules ?? []).some((r: any) =>
        ['REIMBURSEMENT', 'MEDICAL_REIMBURSEMENT', 'ACTUAL_COST'].includes(String(r.calc_type).toUpperCase()));
    },
  });

  const handleRun = async () => {
    if (!userCode) {
      toast.error('No user context — please sign in again.');
      return;
    }
    setRunning(true);
    try {
      const res = await runClaimCalculation(claimId, userCode);
      toast.success(
        res.weeklyRate
          ? `Calculation complete — weekly $${res.weeklyRate.toFixed(2)}`
          : res.lumpSum
            ? `Calculation complete — lump sum $${res.lumpSum.toFixed(2)}`
            : 'Calculation completed',
      );
      qc.invalidateQueries({ queryKey: ['bn', 'claim-calculations', claimId] });
      qc.invalidateQueries({ queryKey: ['bn', 'claim-events', claimId] });
    } catch (err: any) {
      toast.error('Calculation failed', { description: err?.message });
    } finally {
      setRunning(false);
    }
  };

  if (!latest) {
    return (
      <div className="space-y-4">
      {isReimbursement && <MedicalExpensesPanel claimId={claimId} userCode={userCode} />}
      <Card>
        <CardContent className="py-10 flex flex-col items-center gap-4">
          <BnEmptyState
            type="empty"
            title="No calculations yet"
            description="Run the calculation engine to compute weekly/monthly/lump-sum amounts using the product version's formula rules. Eligibility must pass first."
          />
          <Button onClick={handleRun} disabled={running} className="gap-2">
            <Play className="h-4 w-4" />
            {running ? 'Running…' : 'Run Calculation'}
          </Button>
        </CardContent>
      </Card>
      </div>
    );
  }

  const inputs = (latest.inputs as any) ?? {};
  const outputs = (latest.outputs as any) ?? {};
  const formula = outputs.formulaResult ?? null;
  const trace: any[] = Array.isArray(formula?.steps) ? formula.steps : [];

  return (
    <div className="space-y-4">
      {isReimbursement && <MedicalExpensesPanel claimId={claimId} userCode={userCode} />}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Calculation Result
              <Badge variant="outline" className="ml-2 text-xs font-mono">
                {formatDateForDisplay(latest.calc_date)}
              </Badge>
              {latest.override_applied && (
                <Badge className="bg-amber-500/15 text-amber-700 border-amber-300" variant="outline">
                  Override applied
                </Badge>
              )}
            </CardTitle>
            <Button size="sm" variant="outline" onClick={handleRun} disabled={running} className="gap-1">
              <RefreshCw className={`h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`} />
              Re-run
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Metric label="Weekly Rate" value={latest.weekly_rate} prefix="$" />
            <Metric label="Monthly Rate" value={latest.monthly_rate} prefix="$" />
            <Metric label="Lump Sum" value={latest.lump_sum} prefix="$" />
            <Metric label="Annual" value={latest.annual_rate} prefix="$" />
            <Metric label="Average Weekly Wage" value={latest.average_weekly_wage} prefix="$" />
            <Metric label="Qualifying Weeks" value={latest.qualifying_weeks} />
            <Metric label="Total Contributions" value={latest.total_contributions} />
            <Metric label="Formula" value={latest.formula_code} suffix={latest.formula_version ? ` v${latest.formula_version}` : ''} />
          </div>

          {trace.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Formula Steps</h4>
              <div className="rounded border divide-y bg-card">
                {trace.map((s: any, i: number) => (
                  <div key={i} className="px-3 py-2 text-xs grid grid-cols-12 gap-2">
                    <span className="col-span-3 font-mono text-muted-foreground">{s.stepCode ?? s.code ?? `step_${i + 1}`}</span>
                    <span className="col-span-5">{s.label ?? s.description ?? ''}</span>
                    <span className="col-span-4 text-right font-mono">{s.value !== undefined ? String(s.value) : (s.expression ?? '')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {inputs?.wageAggregation && (
            <details className="mt-4">
              <summary className="text-xs text-muted-foreground cursor-pointer">Inputs (wage aggregation, contribution window)</summary>
              <pre className="text-[10px] bg-muted/40 rounded p-2 overflow-auto max-h-48 mt-2">
                {JSON.stringify({ wageAggregation: inputs.wageAggregation, contributionWindow: inputs.contributionWindow }, null, 2)}
              </pre>
            </details>
          )}
        </CardContent>
      </Card>

      {calculations.length > 1 && (
        <p className="text-xs text-muted-foreground">
          {calculations.length} historical calculations — only latest shown.
        </p>
      )}
    </div>
  );
};

const Metric: React.FC<{ label: string; value: any; prefix?: string; suffix?: string }> = ({ label, value, prefix, suffix }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-base font-semibold">
      {value == null || value === ''
        ? '—'
        : `${prefix ?? ''}${typeof value === 'number' ? value.toFixed(2) : value}${suffix ?? ''}`}
    </p>
  </div>
);
