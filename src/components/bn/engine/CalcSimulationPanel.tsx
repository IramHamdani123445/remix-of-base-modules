import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Play, Save, FlaskConical } from 'lucide-react';
import { useRunCalculation, useBnSimulationPresets, useSaveSimulationPreset } from '@/hooks/bn/useBnCalcEngine';
import { useBnProducts, useBnProductVersions } from '@/hooks/bn/useBnProduct';
import { useUserCode } from '@/hooks/useUserCode';
import CalcResultSummary from './CalcResultSummary';
import CalcTraceViewer from './CalcTraceViewer';
import type { BnCalcEngineInput, BnCalcEngineOutput, BnCalcRunMode } from '@/types/bnCalcEngine';
import { toast } from 'sonner';

import { formatNumber } from '@/lib/culture/culture';
export default function CalcSimulationPanel() {
  const [ssn, setSSN] = useState('');
  const [productId, setProductId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [claimDate, setClaimDate] = useState(new Date().toISOString().substring(0, 10));
  const [mode, setMode] = useState<BnCalcRunMode>('SIMULATION');
  const [result, setResult] = useState<BnCalcEngineOutput | null>(null);

  const { data: products } = useBnProducts();
  const { data: versions } = useBnProductVersions(productId || undefined);
  const runCalc = useRunCalculation();
  const { data: presets } = useBnSimulationPresets(productId || undefined);
  const savePreset = useSaveSimulationPreset();
  const { userCode, isLoading: userCodeLoading } = useUserCode();

  const handleRun = async () => {
    if (!ssn || !productId || !versionId) {
      toast.error('Please fill SSN, Product, and Version');
      return;
    }
    // Still loading: the Run button is disabled for this case (see below) — stay silent
    // rather than showing an error for a value that just hasn't arrived yet.
    if (userCodeLoading) return;
    // The engine stamps every run with the actor for audit and refuses to
    // run without one (requireUserCode in runCalculationEngine).
    if (!userCode) {
      toast.error('Your account has no user code recorded. Please contact an administrator.');
      return;
    }
    try {
      const product = (products ?? []).find((p: any) => p.id === productId);

      const input: BnCalcEngineInput = {
        claimId: crypto.randomUUID(), // Simulation uses a temporary claim ID
        ssn,
        productId,
        productVersionId: versionId,
        claimDate,
        // The product's own country pack. 'KN' was hard-coded here and does not
        // exist — the country codes in use are SKN, AG and BB — so the run used
        // the wrong pack for its rates, currency and legal references.
        countryCode: product?.country_code ?? 'SKN',
        mode,
        triggeredBy: userCode,
      };
      const res = await runCalc.mutateAsync(input);
      setResult(res);
      toast.success('Calculation complete');
    } catch (err: any) {
      toast.error(err?.message || 'Calculation failed');
    }
  };

  const handleSavePreset = async () => {
    if (!result) return;
    await savePreset.mutateAsync({
      preset_name: `Sim-${ssn}-${new Date().toISOString().substring(0, 16)}`,
      product_id: productId || null,
      product_version_id: versionId || null,
      input_parameters: { ssn, claimDate, mode },
      expected_output: {
        weekly_rate: result.formulaResult.finalWeeklyRate,
        monthly_rate: result.formulaResult.finalMonthlyRate,
        lump_sum: result.formulaResult.finalLumpSum,
      },
      country_code: 'KN',
    });
    toast.success('Simulation preset saved');
  };

  const loadPreset = (preset: any) => {
    const params = preset.input_parameters as Record<string, any>;
    if (params.ssn) setSSN(params.ssn);
    if (params.claimDate) setClaimDate(params.claimDate);
    if (preset.product_id) setProductId(preset.product_id);
    if (preset.product_version_id) setVersionId(preset.product_version_id);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            Calculation Simulation / Test Harness
          </CardTitle>
          <CardDescription>
            Run the 10-layer calculation engine in simulation mode. Results are traced and persisted for audit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
            <div>
              <Label>SSN</Label>
              <Input value={ssn} onChange={e => setSSN(e.target.value)} placeholder="e.g. 123456" />
            </div>
            <div>
              <Label>Product</Label>
              <Select value={productId} onValueChange={v => { setProductId(v); setVersionId(''); }}>
                <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent>
                  {(products || []).map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.benefit_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Version</Label>
              <Select value={versionId} onValueChange={setVersionId}>
                <SelectTrigger><SelectValue placeholder="Select version" /></SelectTrigger>
                <SelectContent>
                  {(versions || []).map((v: any) => (
                    <SelectItem key={v.id} value={v.id}>v{v.version_number} ({v.status})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Claim Date</Label>
              <Input type="date" value={claimDate} onChange={e => setClaimDate(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleRun}
                disabled={runCalc.isPending || userCodeLoading}
                title={userCodeLoading ? 'Loading your user profile…' : undefined}
                className="flex-1"
              >
                {(runCalc.isPending || userCodeLoading) ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
                Run
              </Button>
              {result && (
                <Button variant="outline" size="icon" onClick={handleSavePreset} title="Save as preset">
                  <Save className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Saved presets */}
          {presets && presets.length > 0 && (
            <div className="mt-4">
              <Label className="text-xs text-muted-foreground">Saved Presets</Label>
              <div className="flex gap-2 flex-wrap mt-1">
                {presets.map((p: any) => (
                  <Button key={p.id} variant="outline" size="sm" onClick={() => loadPreset(p)}>
                    {p.preset_name}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <Tabs defaultValue="summary">
          <TabsList>
            <TabsTrigger value="summary">Result Summary</TabsTrigger>
            <TabsTrigger value="trace">Calculation Trace ({result.trace.length} steps)</TabsTrigger>
            <TabsTrigger value="formula">Formula Steps</TabsTrigger>
          </TabsList>

          <TabsContent value="summary">
            <CalcResultSummary result={result} />
          </TabsContent>

          <TabsContent value="trace">
            <Card>
              <CardContent className="pt-4">
                <CalcTraceViewer trace={result.trace} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="formula">
            <Card>
              <CardContent className="pt-4">
                <div className="space-y-3">
                  {result.formulaResult.steps.map((step, i) => (
                    <div key={i} className="border rounded-lg p-3 bg-muted/30">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">Step {step.stepNumber}: {step.description}</span>
                        <span className="font-mono text-sm font-bold text-emerald-700">${formatNumber(step.result, 0)}</span>
                      </div>
                      <p className="text-xs font-mono text-muted-foreground">{step.formula}</p>
                      <div className="flex gap-3 mt-1">
                        {Object.entries(step.inputs).map(([k, v]) => (
                          <span key={k} className="text-xs text-muted-foreground">{k}={v}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {result.formulaResult.steps.length === 0 && (
                    <p className="text-sm text-muted-foreground">No formula steps recorded.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
