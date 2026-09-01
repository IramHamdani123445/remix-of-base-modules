/**
 * CalculationBuilder — business-friendly editor for per-product-version calculation.
 *
 * Backed by structured columns on bn_product_version:
 *   formula_template_id, formula_parameter_values, cap_rules, rounding_rule,
 *   effective_date_rule.
 *
 * The Formula Library is the only source of executable expressions. This
 * editor selects a formula, supplies parameter values, and configures caps
 * and rounding. A "Formula Usage Analysis" panel surfaces every required
 * variable / parameter and blocks activation when anything is missing.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Calculator, Save, Sparkles, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useBnFormulaTemplates } from '@/hooks/bn/useBnConfig';
import { useBnFormulaVariableRegistry, buildSampleMap, buildLabelMap } from '@/hooks/bn/useBnFormulaVariableRegistry';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { validateProductActivation, type ActivationResult } from '@/services/bn/productActivationValidator';
import { BnBusyButton } from '@/components/bn/shared';

interface Props {
  versionId: string | undefined;
  isReadOnly?: boolean;
}

type FormulaTemplate = {
  id: string;
  template_code: string;
  template_name: string;
  description: string | null;
  formula_expression: string;
  input_variables: string[];
  output_type: string;
};

type VersionCalcRow = {
  id: string;
  formula_template_id: string | null;
  formula_parameter_values: Record<string, number> | null;
  cap_rules: Record<string, number> | null;
  rounding_rule: { mode?: string; decimals?: number } | null;
  effective_date_rule: { basis?: string } | null;
};

// --- Fallback samples / labels used when the DB registry hasn't loaded yet ---
const FALLBACK_SAMPLE_INPUTS: Record<string, number> = {
  avg_weekly_wage: 850,
  base_pension: 450,
  flat_amount: 0,
  flat_weekly_rate: 300,
  grant_amount: 7500,
  degree: 100,
};

const FALLBACK_PARAM_LABELS: Record<string, string> = {
  rate: 'Replacement rate (%)',
  base_rate: 'Base rate (%)',
  increment_rate: 'Increment rate per 50 weeks (%)',
  extra_years: 'Extra contribution years beyond minimum',
  degree: 'Disablement degree (%)',
  share_pct: 'Beneficiary share (%)',
  flat_amount: 'Flat amount',
  flat_weekly_rate: 'Flat weekly rate',
  grant_amount: 'Grant amount',
};

const CAP_LABELS: Record<string, string> = {
  min_weekly: 'Minimum weekly amount',
  max_weekly: 'Maximum weekly amount',
  max_rate_pct: 'Maximum rate (%)',
  max_total: 'Maximum total amount',
  max_family_pct: 'Maximum family share (%)',
};

/** Tiny safe evaluator for whitelisted arithmetic expressions. */
function evalExpression(expr: string, vars: Record<string, number>): number | null {
  // Replace identifiers with their numeric values
  const tokens = expr.match(/[a-zA-Z_][a-zA-Z0-9_]*|\d+(\.\d+)?|[+\-*/().%]| +/g);
  if (!tokens) return null;
  const safe = tokens
    .map((t) => {
      if (/^[a-zA-Z_]/.test(t)) {
        const v = vars[t];
        return typeof v === 'number' && Number.isFinite(v) ? String(v) : 'NaN';
      }
      return t;
    })
    .join('');
  if (!/^[\d+\-*/().% ]+$/.test(safe)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const out = Function(`"use strict"; return (${safe});`)();
    return Number.isFinite(out) ? out : null;
  } catch {
    return null;
  }
}

function applyCaps(value: number, caps: Record<string, number>): { value: number; note?: string } {
  let v = value;
  let note: string | undefined;
  if (typeof caps.min_weekly === 'number' && v < caps.min_weekly) { v = caps.min_weekly; note = `Floored to minimum (${caps.min_weekly})`; }
  if (typeof caps.max_weekly === 'number' && v > caps.max_weekly) { v = caps.max_weekly; note = `Capped at maximum (${caps.max_weekly})`; }
  if (typeof caps.max_total === 'number' && v > caps.max_total) { v = caps.max_total; note = `Capped at max total (${caps.max_total})`; }
  return { value: v, note };
}

function applyRounding(value: number, rule: { mode?: string; decimals?: number } | null): number {
  const decimals = rule?.decimals ?? 2;
  const factor = Math.pow(10, decimals);
  switch (rule?.mode) {
    case 'FLOOR': return Math.floor(value * factor) / factor;
    case 'CEIL':  return Math.ceil(value * factor) / factor;
    case 'NONE':  return value;
    case 'HALF_UP':
    default:      return Math.round(value * factor) / factor;
  }
}

export function CalculationBuilder({ versionId, isReadOnly }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: templates = [] } = useBnFormulaTemplates();
  const { data: registryRows = [] } = useBnFormulaVariableRegistry();
  const SAMPLE_INPUTS = useMemo(
    () => ({ ...FALLBACK_SAMPLE_INPUTS, ...buildSampleMap(registryRows) }),
    [registryRows]
  );
  const PARAM_LABELS = useMemo(
    () => ({ ...FALLBACK_PARAM_LABELS, ...buildLabelMap(registryRows) }),
    [registryRows]
  );

  const { data: version, isLoading } = useQuery({
    queryKey: ['bn', 'product-version-calc', versionId],
    enabled: !!versionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bn_product_version')
        .select('id, formula_template_id, formula_parameter_values, cap_rules, rounding_rule, effective_date_rule')
        .eq('id', versionId!)
        .single();
      if (error) throw error;
      return data as unknown as VersionCalcRow;
    },
  });

  // Formula Usage Analysis — re-evaluates whenever the version row changes.
  const { data: analysis } = useQuery({
    queryKey: ['bn', 'product-version-activation', versionId, version?.formula_template_id],
    enabled: !!versionId && !!version?.formula_template_id,
    queryFn: () => validateProductActivation(versionId!) as Promise<ActivationResult>,
  });

  const [templateId, setTemplateId] = useState<string>('');
  const [params, setParams] = useState<Record<string, number>>({});
  const [caps, setCaps] = useState<Record<string, number>>({});
  const [rounding, setRounding] = useState<{ mode: string; decimals: number }>({ mode: 'HALF_UP', decimals: 2 });
  const [effective, setEffective] = useState<{ basis: string }>({ basis: 'claim_date' });

  useEffect(() => {
    if (!version) return;
    setTemplateId(version.formula_template_id || '');
    setParams((version.formula_parameter_values as Record<string, number>) || {});
    setCaps((version.cap_rules as Record<string, number>) || {});
    setRounding({
      mode: version.rounding_rule?.mode || 'HALF_UP',
      decimals: version.rounding_rule?.decimals ?? 2,
    });
    setEffective({ basis: version.effective_date_rule?.basis || 'claim_date' });
  }, [version]);

  const selectedTemplate = useMemo<FormulaTemplate | undefined>(
    () => (templates as FormulaTemplate[]).find((t) => t.id === templateId),
    [templates, templateId]
  );

  // When user picks a new template, seed any missing params with 0
  useEffect(() => {
    if (!selectedTemplate) return;
    setParams((prev) => {
      const next = { ...prev };
      for (const v of selectedTemplate.input_variables || []) {
        if (!(v in SAMPLE_INPUTS) && !(v in next)) next[v] = 0;
      }
      return next;
    });
  }, [selectedTemplate]);

  // Live preview using sample inputs + configured params
  const preview = useMemo(() => {
    if (!selectedTemplate) return null;
    const ctx: Record<string, number> = { ...SAMPLE_INPUTS, ...params };
    const raw = evalExpression(selectedTemplate.formula_expression, ctx);
    if (raw === null) return { error: 'Could not evaluate formula' as const };
    const capped = applyCaps(raw, caps);
    const final = applyRounding(capped.value, rounding);
    return { raw, capped: capped.value, capNote: capped.note, final };
  }, [selectedTemplate, params, caps, rounding]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!versionId) throw new Error('No version');
      const { error } = await supabase
        .from('bn_product_version')
        .update({
          formula_template_id: templateId || null,
          formula_parameter_values: params,
          cap_rules: caps,
          rounding_rule: rounding,
          effective_date_rule: effective,
        })
        .eq('id', versionId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Calculation saved', description: 'Formula and parameters updated.' });
      qc.invalidateQueries({ queryKey: ['bn', 'product-version-calc', versionId] });
    },
    onError: (err: any) => toast({ title: 'Save failed', description: err?.message || 'Please try again', variant: 'destructive' }),
  });

  if (!versionId) {
    return <Card><CardContent className="py-8 text-center text-muted-foreground">Select or create a product version first.</CardContent></Card>;
  }
  if (isLoading) return <Card><CardContent className="py-8 text-muted-foreground">Loading…</CardContent></Card>;

  // Variables the active template needs that aren't auto-resolved samples → editable as params
  const editableVars = (selectedTemplate?.input_variables || []).filter((v) => !(v in SAMPLE_INPUTS) || v === 'flat_amount' || v === 'grant_amount' || v === 'flat_weekly_rate');
  const capKeys = ['min_weekly', 'max_weekly', 'max_rate_pct', 'max_total', 'max_family_pct'];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Calculator className="h-5 w-5" /> Benefit Formula</CardTitle>
            <CardDescription>Pick a formula from the library and enter business values — no JSON required.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>Formula template</Label>
              <Select value={templateId || '__none__'} onValueChange={(v) => setTemplateId(v === '__none__' ? '' : v)} disabled={isReadOnly}>
                <SelectTrigger><SelectValue placeholder="Select a formula…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None (no calculation)</SelectItem>
                  {(templates as FormulaTemplate[]).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.template_name} <span className="text-muted-foreground">— {t.template_code}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTemplate && (
                <p className="text-xs text-muted-foreground mt-1">
                  <span className="font-mono">{selectedTemplate.formula_expression}</span>
                </p>
              )}
            </div>

            {selectedTemplate && editableVars.length > 0 && (
              <>
                <Separator />
                <div>
                  <Label className="text-sm font-semibold">Parameters</Label>
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    {editableVars.map((v) => (
                      <div key={v} className="space-y-1">
                        <Label className="text-xs">{PARAM_LABELS[v] || v}</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={params[v] ?? ''}
                          disabled={isReadOnly}
                          onChange={(e) => setParams((p) => ({ ...p, [v]: parseFloat(e.target.value) || 0 }))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            <Separator />
            <div>
              <Label className="text-sm font-semibold">Caps &amp; limits</Label>
              <div className="grid grid-cols-2 gap-4 mt-3">
                {capKeys.map((k) => (
                  <div key={k} className="space-y-1">
                    <Label className="text-xs">{CAP_LABELS[k]}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="—"
                      value={caps[k] ?? ''}
                      disabled={isReadOnly}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setCaps((c) => {
                          const next = { ...c };
                          if (raw === '') delete next[k];
                          else next[k] = parseFloat(raw);
                          return next;
                        });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Rounding mode</Label>
                <Select value={rounding.mode} onValueChange={(m) => setRounding((r) => ({ ...r, mode: m }))} disabled={isReadOnly}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HALF_UP">Half up (standard)</SelectItem>
                    <SelectItem value="FLOOR">Floor (round down)</SelectItem>
                    <SelectItem value="CEIL">Ceiling (round up)</SelectItem>
                    <SelectItem value="NONE">No rounding</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Decimal places</Label>
                <Input type="number" min={0} max={6} value={rounding.decimals}
                  disabled={isReadOnly}
                  onChange={(e) => setRounding((r) => ({ ...r, decimals: parseInt(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Effective rate basis</Label>
                <Select value={effective.basis} onValueChange={(b) => setEffective({ basis: b })} disabled={isReadOnly}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claim_date">Claim date</SelectItem>
                    <SelectItem value="injury_date">Injury / incident date</SelectItem>
                    <SelectItem value="award_start_date">Award start date</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <BnBusyButton loading={saveMutation.isPending} onClick={() => saveMutation.mutate()} disabled={isReadOnly || saveMutation.isPending} className="gap-2">>
                <Save className="h-4 w-4" /> {saveMutation.isPending ? 'Saving…' : 'Save calculation'}
              </BnBusyButton>
            </div>
          </CardContent>
        </Card>

        {/* Formula Usage Analysis ------------------------------------- */}
        {analysis && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Formula Usage Analysis
              </CardTitle>
              <CardDescription>
                Verifies every variable and parameter referenced by the selected formula resolves to a registered source.
                Activation is blocked until all checks pass.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">Current Formula</div>
                  <div className="font-medium">{analysis.formulaTemplate?.template_name ?? '—'}</div>
                  <div className="text-xs font-mono text-muted-foreground">{analysis.formulaTemplate?.template_code}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Formula Status</div>
                  <Badge variant={analysis.formulaTemplate && ['READY_FOR_PRODUCT_USE','ACTIVE'].includes(analysis.formulaTemplate.governance_status) ? 'default' : 'destructive'}>
                    {analysis.formulaTemplate?.governance_status ?? 'UNKNOWN'}
                  </Badge>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Variables Required</div>
                  <div className="text-xs font-mono">{analysis.variablesRequired.join(', ') || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Variables Mapped</div>
                  <div className="text-xs font-mono">{analysis.variablesMapped.join(', ') || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Product Parameters Required</div>
                  <div className="text-xs font-mono">{analysis.parametersRequired.join(', ') || '—'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Product Parameters Mapped</div>
                  <div className="text-xs font-mono">{analysis.parametersMapped.join(', ') || '—'}</div>
                </div>
              </div>

              {analysis.canActivate ? (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>Ready for activation</AlertTitle>
                  <AlertDescription>All required variables and parameters resolve. Sample simulation succeeded.</AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{analysis.blockers.length} issue{analysis.blockers.length === 1 ? '' : 's'} blocking activation</AlertTitle>
                  <AlertDescription>
                    <ul className="mt-2 list-disc pl-4 space-y-1">
                      {analysis.blockers.map((b, i) => (
                        <li key={i}>{b.message}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}
      </div>


      <Card className="lg:sticky lg:top-4 h-fit">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Live preview</CardTitle>
          <CardDescription>Uses sample wage of $850/wk to show the resulting benefit.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!selectedTemplate ? (
            <p className="text-muted-foreground">Select a formula to see a preview.</p>
          ) : !preview ? null : 'error' in preview ? (
            <Alert variant="destructive">
              <AlertTitle>Cannot evaluate</AlertTitle>
              <AlertDescription>{preview.error}</AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="flex justify-between"><span className="text-muted-foreground">Raw result</span><span className="font-mono">{preview.raw.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">After caps</span><span className="font-mono">{preview.capped.toFixed(2)}</span></div>
              {preview.capNote && <Badge variant="secondary" className="text-xs">{preview.capNote}</Badge>}
              <Separator />
              <div className="flex justify-between text-base"><span className="font-semibold">Final benefit</span><span className="font-mono font-semibold text-primary">{preview.final.toFixed(rounding.decimals)}</span></div>
              <p className="text-xs text-muted-foreground pt-2">
                Formula: <span className="font-mono">{selectedTemplate.formula_expression}</span>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
