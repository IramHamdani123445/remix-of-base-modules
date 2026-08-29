import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, Save, Play } from 'lucide-react';
import {
  commitPolicyVersion,
  getActiveRiskPolicy,
  getPolicyBands,
  getPolicyFactors,
  previewEmployerScore,
  runRiskRecalculation,
  updatePolicyFactorWeights,
  validateRiskPolicyRpc,
  type EmployerRiskScore,
} from '@/services/compliance/riskScoringService';
import { CANONICAL_FACTORS, roundTo2 } from '@/lib/compliance/risk/riskModel';

const STATUS_STYLE: Record<string, string> = {
  operational: 'bg-emerald-500/15 text-emerald-700',
  configured: 'bg-amber-500/15 text-amber-700',
  configuration_error: 'bg-destructive/15 text-destructive',
};

/**
 * Checkpoint E — canonical five-factor model administration.
 * Weights edited here are policy weights consumed by ce_score_employer_risk_v1.
 */
export default function RiskModelTab() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, { weight: number; is_active: boolean }>>({});
  const [dirty, setDirty] = useState(false);
  const [simEmployer, setSimEmployer] = useState('');
  const [simResult, setSimResult] = useState<EmployerRiskScore | null>(null);

  const { data: policy, isLoading: policyLoading } = useQuery({
    queryKey: ['ce_active_risk_policy'],
    queryFn: getActiveRiskPolicy,
  });

  const { data: factors = [] } = useQuery({
    queryKey: ['ce_policy_factors', policy?.id],
    queryFn: () => getPolicyFactors(policy!.id),
    enabled: !!policy?.id,
  });

  const { data: bands = [] } = useQuery({
    queryKey: ['ce_policy_bands', policy?.id],
    queryFn: () => getPolicyBands(policy!.id),
    enabled: !!policy?.id,
  });

  const { data: validation, refetch: revalidate } = useQuery({
    queryKey: ['ce_policy_validation', policy?.id],
    queryFn: () => validateRiskPolicyRpc(policy!.id),
    enabled: !!policy?.id,
  });

  useEffect(() => {
    if (factors.length > 0 && !dirty) {
      const next: Record<string, { weight: number; is_active: boolean }> = {};
      factors.forEach((f) => {
        next[f.policy_factor_id] = { weight: Number(f.weight), is_active: f.is_active !== false };
      });
      setDraft(next);
    }
  }, [factors, dirty]);

  const draftTotal = useMemo(
    () =>
      roundTo2(
        Object.values(draft)
          .filter((d) => d.is_active)
          .reduce((sum, d) => sum + Number(d.weight || 0), 0),
      ),
    [draft],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!policy) throw new Error('No active policy');
      if (draftTotal !== 100) {
        throw new Error(`Active factor weights total ${draftTotal}% — they must equal exactly 100%`);
      }
      await updatePolicyFactorWeights(
        Object.entries(draft).map(([policy_factor_id, d]) => ({
          policy_factor_id,
          weight: d.weight,
          is_active: d.is_active,
        })),
      );
      await commitPolicyVersion(policy.id, policy.version_no);
    },
    onSuccess: async () => {
      setDirty(false);
      toast.success('Risk model saved — a new policy version is now effective. Historical scores are unchanged.');
      await qc.invalidateQueries({ queryKey: ['ce_active_risk_policy'] });
      await qc.invalidateQueries({ queryKey: ['ce_policy_factors'] });
      await revalidate();
    },
    onError: (e: Error) => toast.error(e.message || 'Could not save the risk model'),
  });

  const simulate = useMutation({
    mutationFn: async () => {
      if (!simEmployer.trim()) throw new Error('Enter an employer registration number');
      return previewEmployerScore(simEmployer.trim(), policy?.id);
    },
    onSuccess: (result) => {
      setSimResult(result);
      if (result.ok === false) toast.error(result.error || 'Simulation failed');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recalc = useMutation({
    mutationFn: () => runRiskRecalculation({ triggeredBy: 'UI_MANUAL_BULK' }),
    onSuccess: (r) => {
      if (r.ok === false) toast.error(r.error || 'Recalculation blocked by policy validation');
      else toast.success(`Recalculated ${r.scored} employers on policy ${r.policy_code} v${r.policy_version}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (policyLoading) {
    return (
      <div className="py-10 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading active risk policy…
      </div>
    );
  }

  if (!policy) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>No active risk policy</AlertTitle>
        <AlertDescription>Activate a risk policy before employer risk can be scored.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">
                {policy.policy_name} <span className="text-muted-foreground">({policy.policy_code})</span>
              </CardTitle>
              <CardDescription>
                Version {policy.version_no} · effective {policy.effective_from}
                {policy.effective_to ? ` → ${policy.effective_to}` : ' (open)'} · edits create a new effective-dated
                version and never alter historical scores.
              </CardDescription>
            </div>
            <Badge variant={validation?.valid ? 'secondary' : 'destructive'}>
              {validation?.valid ? 'Valid' : 'Invalid'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {policy.weights_confirmation !== 'CONFIRMED' && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Weights provisional</AlertTitle>
              <AlertDescription>
                Open business decision <strong>E-RISK-FACTOR-WEIGHTS</strong> — the five-factor weights below are
                provisional and awaiting client confirmation.
              </AlertDescription>
            </Alert>
          )}
          {validation && !validation.valid && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Policy validation failed</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 text-xs space-y-0.5">
                  {validation.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <div
            className={`flex items-center gap-2 text-sm font-medium ${
              draftTotal === 100 ? 'text-emerald-600' : 'text-destructive'
            }`}
          >
            {draftTotal === 100 ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            Active weight total: {draftTotal}% {draftTotal === 100 ? '' : '(must be exactly 100%)'}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Five-Factor Model</CardTitle>
          <CardDescription>
            Each factor must have a runtime measurement and scoring thresholds. A weighted factor without scoring
            logic is reported as a configuration error and blocks activation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Factor</TableHead>
                <TableHead>Measurement</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-32 text-right">Weight %</TableHead>
                <TableHead className="w-24 text-right">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {factors.map((f) => {
                const status =
                  validation?.factors?.find((v) => v.factor_code === f.factor_code)?.status ?? 'configured';
                const canonical = CANONICAL_FACTORS.find((c) => c.code === f.canonical_factor);
                const d = draft[f.policy_factor_id] ?? { weight: Number(f.weight), is_active: true };
                return (
                  <TableRow key={f.policy_factor_id}>
                    <TableCell>
                      <div className="font-medium text-sm">{canonical?.label ?? f.factor_name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {canonical?.description ?? f.description}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs font-mono">{f.measurement_code ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_STYLE[status]}>
                        {status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={d.weight}
                        className="h-8 text-right"
                        onChange={(e) => {
                          setDirty(true);
                          setDraft((prev) => ({
                            ...prev,
                            [f.policy_factor_id]: { ...d, weight: Number(e.target.value) },
                          }));
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Switch
                        checked={d.is_active}
                        onCheckedChange={(v) => {
                          setDirty(true);
                          setDraft((prev) => ({ ...prev, [f.policy_factor_id]: { ...d, is_active: v } }));
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div className="flex items-center gap-2 mt-4">
            <Button onClick={() => saveMutation.mutate()} disabled={!dirty || saveMutation.isPending}>
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Save new version
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDirty(false);
                toast.info('Changes discarded');
              }}
              disabled={!dirty}
            >
              <RotateCcw className="h-4 w-4 mr-1" /> Reset
            </Button>
            <Button variant="outline" onClick={() => recalc.mutate()} disabled={recalc.isPending}>
              {recalc.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-1" />
              )}
              Recalculate all employers
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Risk Bands</CardTitle>
          <CardDescription>Bands must be continuous and cover 0–100 with no gaps or overlaps.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {bands.map((b) => (
            <Badge key={b.band_name} variant="outline">
              {b.band_name}: {b.score_range_min}–{b.score_range_max}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Simulation (no data is written)</CardTitle>
          <CardDescription>
            Score a real employer against the active policy to see each factor's measurement and contribution.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 max-w-xs">
              <Label className="text-xs">Employer registration no.</Label>
              <Input value={simEmployer} onChange={(e) => setSimEmployer(e.target.value)} placeholder="e.g. 655651" />
            </div>
            <Button variant="outline" onClick={() => simulate.mutate()} disabled={simulate.isPending}>
              {simulate.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Simulate
            </Button>
          </div>
          {simResult && simResult.ok !== false && (
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Policy {simResult.policy_code} v{simResult.policy_version} · {simResult.calculation_status}
                </span>
                <span className="text-lg font-bold">
                  {Number(simResult.total_score).toFixed(2)} <Badge>{simResult.risk_band}</Badge>
                </span>
              </div>
              {simResult.factors.map((f) => (
                <div key={f.factor_code} className="text-xs flex justify-between gap-4 border-t pt-1">
                  <span className="flex-1">{f.factor_name}</span>
                  <span className="text-muted-foreground flex-1">{f.explanation}</span>
                  <span className="tabular-nums w-16 text-right">{Number(f.weighted_contribution).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
