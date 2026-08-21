/**
 * AddFormulaWizard — typed 8-step wizard that replaces the legacy "Add Formula"
 * dialog in the Formula Library.
 *
 * Flow:
 *   1. Type             — pick expression_type
 *   2. Identity         — code, name, category, country, legal ref, description
 *   3. Inputs (info)    — guidance + variable picker (read-only chips)
 *   4. Build            — type-specific editor via FormulaStepsBuilder
 *   5. Output           — output variable, type, rounding
 *   6. Test data        — sample values + optional expected result
 *   7. Validate         — runs validateFormulaDraft()
 *   8. Save             — creates template + v1 DRAFT version
 *
 * Result: opens FormulaVersionEditor for the new DRAFT so the user can
 * continue refining immediately.
 */
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { FormulaStepsBuilder, type ExpressionType, type StepsJson } from '@/components/bn/config/FormulaStepsBuilder';
import { FormulaTestPanel } from '@/components/bn/config/FormulaTestPanel';
import { useBnFormulaVariableRegistry } from '@/hooks/bn/useBnFormulaVariableRegistry';
import { useUserCode } from '@/hooks/useUserCode';
import { createFormulaWithDraftVersion } from '@/services/bn/createFormulaWithDraftVersion';
import { parseFormula } from '@/lib/bn/formulaParser';
import { useVariableResolver } from '@/hooks/bn/useVariableResolver';
import CountryFieldSelector from '@/components/bn/selectors/CountryFieldSelector';
import LegalReferenceSelector from '@/components/bn/selectors/LegalReferenceSelector';

interface Props {
  open: boolean;
  onClose: () => void;
  existingCodes: string[];
  onCreated: (templateId: string, versionId: string) => void;
}

const TYPE_OPTIONS: Array<{ value: ExpressionType; label: string; hint: string }> = [
  { value: 'SIMPLE_EXPRESSION',     label: 'Simple expression',       hint: 'A single math expression using variables — e.g. avg_weekly_wage * rate.' },
  { value: 'RATE_TABLE_LOOKUP',     label: 'Rate table lookup',       hint: 'Look up a value from a 1-D rate table, then apply an expression.' },
  { value: 'MATRIX_LOOKUP',         label: 'Matrix lookup',           hint: 'Look up a value from a multi-dimensional matrix table.' },
  { value: 'MEDICAL_TARIFF_LOOKUP', label: 'Medical tariff lookup',   hint: 'Resolve payable amount from the medical reimbursement source.' },
  { value: 'MULTI_STEP',            label: 'Multi-step formula',      hint: 'Sequence of lookups and expressions, each producing a named output.' },
  { value: 'CONDITIONAL',           label: 'Conditional (IF/ELSE)',   hint: 'Multiple branches; the first matching condition wins.' },
];

const OUTPUT_TYPES = [
  { value: 'NUMBER', label: 'Number' },
  { value: 'MONEY', label: 'Money' },
  { value: 'PERCENT', label: 'Percent' },
];

const ROUNDING_OPTIONS = [
  { value: 'NONE',     label: 'No rounding' },
  { value: 'NEAREST',  label: 'Nearest cent' },
  { value: 'UP',       label: 'Round up' },
  { value: 'DOWN',     label: 'Round down' },
  { value: 'BANKERS',  label: "Banker's (half-even)" },
];

const CATEGORIES = [
  'PENSION', 'GRANT', 'SHORT_TERM', 'MEDICAL', 'SURVIVOR', 'DISABLEMENT', 'OTHER',
];

const STEP_LABELS = ['Type', 'Identity', 'Inputs', 'Build', 'Output', 'Test', 'Validate', 'Save'];

export function AddFormulaWizard({ open, onClose, existingCodes, onCreated }: Props) {
  const { userCode } = useUserCode();
  const { data: registry = [] } = useBnFormulaVariableRegistry();

  const [step, setStep] = useState(0);
  const [type, setType] = useState<ExpressionType>('SIMPLE_EXPRESSION');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('PENSION');
  const [country, setCountry] = useState('');
  const [legalRef, setLegalRef] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<StepsJson>({});
  const [outputVariable, setOutputVariable] = useState('result');
  const [outputType, setOutputType] = useState('MONEY');
  const [rounding, setRounding] = useState('NEAREST');
  const [validation, setValidation] = useState<{ ok: boolean; errors: string[]; warnings: string[] } | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * BUG-19 — the wizard offered one list of variables and validated against
   * another.
   *
   * Step 3 listed the database variable registry (~40 entries). Step 7 called
   * parseFormula() with no resolver, so the parser fell back to its in-code
   * list (~23 entries) and rejected variables the wizard had just offered.
   * Neither derived facts nor product parameters were consulted at all, so no
   * amount of configuration could make a rejected variable acceptable — the
   * only fix was editing code, which contradicts the module's own rule that
   * this kind of list must be data.
   *
   * Both now come from the same place: the resolver map, which is built from
   * facts, approved derived facts, product parameters and prior formula
   * results — the same resolver every other formula screen already uses.
   */
  const { data: resolver, isLoading: resolverLoading, error: resolverError } = useVariableResolver();

  const variables = useMemo(() => {
    const codes = new Set<string>(registry.map((r: any) => r.variable_code).filter(Boolean));
    // Anything the resolver accepts is offerable, so the two lists cannot diverge.
    if (resolver) for (const code of resolver.keys()) codes.add(code);
    return [...codes].sort();
  }, [registry, resolver]);
  const codeUpper = code.trim().toUpperCase();
  const codeDuplicate = !!codeUpper && existingCodes.map((c) => c.toUpperCase()).includes(codeUpper);

  /** Next free numeric suffix, so a clash comes with a way forward. */
  const suggestedCode = useMemo(() => {
    if (!codeDuplicate) return null;
    const taken = new Set(existingCodes.map((x) => x.toUpperCase()));
    const base = codeUpper.replace(/_(\d+)$/, '');
    for (let n = 2; n <= 99; n++) {
      const candidate = `${base}_${String(n).padStart(2, '0')}`;
      if (!taken.has(candidate)) return candidate;
    }
    return null;
  }, [codeDuplicate, codeUpper, existingCodes]);

  const reset = () => {
    setStep(0); setType('SIMPLE_EXPRESSION');
    setCode(''); setName(''); setCategory('PENSION'); setCountry('');
    setLegalRef(''); setDescription(''); setSteps({});
    setOutputVariable('result'); setOutputType('MONEY'); setRounding('NEAREST');
    setValidation(null);
  };

  const close = () => { reset(); onClose(); };

  const canNext = (): { ok: boolean; reason?: string } => {
    switch (step) {
      case 0: return { ok: !!type, reason: 'Choose a formula type to continue.' };
      case 1:
        if (!codeUpper) return { ok: false, reason: 'Code is required.' };
        if (codeDuplicate) return { ok: false, reason: 'Code already exists — pick a unique code.' };
        if (!name.trim()) return { ok: false, reason: 'Name is required.' };
        return { ok: true };
      case 2: return { ok: true };
      case 3: {
        // Build step: type-aware shape check
        if (type === 'SIMPLE_EXPRESSION' && !(steps.expression ?? '').trim())
          return { ok: false, reason: 'Enter an expression.' };
        if ((type === 'RATE_TABLE_LOOKUP' || type === 'MATRIX_LOOKUP') && !steps.lookup?.table_code)
          return { ok: false, reason: 'Select a lookup table.' };
        if (type === 'MEDICAL_TARIFF_LOOKUP' && !steps.medical?.procedure_var)
          return { ok: false, reason: 'Map at least the procedure variable.' };
        if (type === 'MULTI_STEP' && !(steps.steps ?? []).length)
          return { ok: false, reason: 'Add at least one step.' };
        if (type === 'CONDITIONAL' && !(steps.conditional?.branches ?? []).length)
          return { ok: false, reason: 'Add at least one branch.' };
        return { ok: true };
      }
      case 4:
        if (!outputVariable.trim()) return { ok: false, reason: 'Output variable is required.' };
        return { ok: true };
      case 5: return { ok: true };
      case 6: return { ok: !!validation?.ok, reason: 'Fix validation issues before saving.' };
      default: return { ok: true };
    }
  };

  const runValidation = () => {
    const errs: string[] = [];
    const warns: string[] = [];

    // 1. Code/name sanity
    if (!codeUpper) errs.push('Missing code.');
    if (codeDuplicate) errs.push('Duplicate code.');
    if (!name.trim()) errs.push('Missing name.');

    // 2. Variables must resolve against the same list step 3 offered.
    if (type === 'SIMPLE_EXPRESSION') {
      if (resolverError) {
        errs.push(
          'Cannot check the expression: the variable list could not be loaded. ' +
          'Validation is refused rather than checked against an incomplete list.',
        );
      } else if (resolverLoading || !resolver) {
        errs.push('Still loading the variable list — run validation again in a moment.');
      } else {
        const parsed = parseFormula(steps.expression ?? '', resolver);
        if (!parsed.valid) errs.push(`Expression error: ${parsed.errors.join('; ')}`);
        // No separate "not in registry" warning: the resolver is the registry,
        // so a variable that parsed successfully is by definition registered.
        // The old warning compared against a different list and fired on
        // variables that were perfectly valid.
      }
    }

    // 3. Lookup wiring
    if (type === 'RATE_TABLE_LOOKUP' || type === 'MATRIX_LOOKUP') {
      const lk = steps.lookup;
      if (!lk?.table_code) errs.push('No lookup table selected.');
      if (lk && !lk.output_var) warns.push('Lookup has no output variable.');
    }

    // 4. Medical mapping
    if (type === 'MEDICAL_TARIFF_LOOKUP') {
      const m = steps.medical;
      if (!m?.procedure_var) errs.push('Medical lookup needs a procedure variable.');
      if (m && !m.amount_var) warns.push('No expense amount variable mapped.');
    }

    // 5. Output
    if (!outputVariable.trim()) errs.push('Missing output variable.');

    setValidation({ ok: errs.length === 0, errors: errs, warnings: warns });
  };

  const save = async () => {
    if (!userCode) { toast.error('Sign-in required'); return; }
    const check = canNext();
    if (!check.ok) { toast.error(check.reason ?? 'Cannot save'); return; }
    setSaving(true);
    try {
      const res = await createFormulaWithDraftVersion({
        template_code: codeUpper,
        template_name: name.trim(),
        description: description.trim() || null,
        country_code: country.trim() || null,
        category,
        legal_ref: legalRef.trim() || null,
        output_type: outputType,
        output_variable: outputVariable.trim(),
        rounding_rule: rounding,
        expression_type: type,
        steps_json: steps,
        user_code: userCode,
      });
      toast.success('Formula created as DRAFT v1 — opening editor');
      onCreated(res.template_id, res.version_id);
      close();
    } catch (e: any) {
      toast.error('Save failed', { description: e?.message ?? 'Unable to create formula.' });
    } finally { setSaving(false); }
  };

  const progress = ((step + 1) / STEP_LABELS.length) * 100;
  const next = canNext();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Add Formula — {STEP_LABELS[step]}
          </DialogTitle>
          <DialogDescription>
            Step {step + 1} of {STEP_LABELS.length}. Creates a new formula template with a DRAFT v1 version.
          </DialogDescription>
        </DialogHeader>

        <Progress value={progress} className="h-1.5" />

        <div className="space-y-4 py-2 min-h-[320px]">
          {/* Step 1: Type */}
          {step === 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {TYPE_OPTIONS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  className={`text-left rounded-md border p-3 transition hover:border-primary ${type === t.value ? 'border-primary bg-primary/5' : 'border-border'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{t.label}</span>
                    {type === t.value && <CheckCircle2 className="h-4 w-4 text-primary" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{t.hint}</p>
                </button>
              ))}
            </div>
          )}

          {/* Step 2: Identity */}
          {step === 1 && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Code *</Label>
                <Input value={code} maxLength={50}
                  placeholder="AGE_PENSION_RATE_LOOKUP"
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  aria-invalid={codeDuplicate}
                  className={codeDuplicate ? 'border-destructive' : undefined} />
                {/* Name the clash and offer a free code, rather than "Code
                    already used" which leaves the user to guess one. */}
                {codeDuplicate && (
                  <p className="text-xs text-destructive">
                    A formula with code <span className="font-mono">{codeUpper}</span> already exists.
                    {suggestedCode && <> Try <span className="font-mono">{suggestedCode}</span>.</>}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input value={name} maxLength={120}
                  onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Country</Label>
                <CountryFieldSelector
                  value={country || null}
                  onChange={(code) => setCountry(code ?? '')}
                  placeholder="Blank = global"
                />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Legal reference</Label>
                <LegalReferenceSelector
                  value={null}
                  countryCode={country || null}
                  onChange={(_id, row) => setLegalRef(row ? (row.full_reference_text || row.short_title) : '')}
                  placeholder={country ? 'Select legal reference…' : 'Pick a country first'}
                />
                {legalRef && <p className="text-[11px] text-muted-foreground truncate">Cited as: {legalRef}</p>}
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Description</Label>
                <Textarea rows={2} value={description} maxLength={500}
                  onChange={(e) => setDescription(e.target.value)} />
              </div>
            </div>
          )}

          {/* Step 3: Inputs (read-only registry summary) */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Variables available from the registry. You will use them in the next step.
                To add a missing variable, open <b>Calculation Setup → Variable Registry</b>.
              </p>
              <div className="rounded-md border max-h-72 overflow-y-auto p-3">
                {variables.length === 0 && (
                  <p className="text-sm text-muted-foreground">No variables in the registry.</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {variables.map((v) => (
                    <Badge key={v} variant="outline" className="font-mono">{v}</Badge>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Build */}
          {step === 3 && (
            <FormulaStepsBuilder
              expressionType={type}
              value={steps}
              onChange={setSteps}
              variables={variables}
            />
          )}

          {/* Step 5: Output */}
          {step === 4 && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Output variable *</Label>
                <Input value={outputVariable}
                  onChange={(e) => setOutputVariable(e.target.value)}
                  placeholder="result" />
              </div>
              <div className="space-y-1.5">
                <Label>Output type</Label>
                <Select value={outputType} onValueChange={setOutputType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OUTPUT_TYPES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Rounding</Label>
                <Select value={rounding} onValueChange={setRounding}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROUNDING_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Step 6: Test */}
          {step === 5 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Try the formula with sample variable values from the registry.
                {type !== 'SIMPLE_EXPRESSION' && ' (Detailed test for lookup-style formulas runs after save in the version editor.)'}
              </p>
              {type === 'SIMPLE_EXPRESSION' ? (
                <FormulaTestPanel expression={steps.expression ?? ''} outputType={outputType} />
              ) : (
                <div className="rounded-md border bg-muted/30 p-4 text-sm">
                  Lookup, matrix, medical and multi-step formulas are tested using the
                  full registry & rate-table data once the DRAFT version is saved.
                  Continue to <b>Validate</b>.
                </div>
              )}
            </div>
          )}

          {/* Step 7: Validate */}
          {step === 6 && (
            <div className="space-y-3">
              <Button variant="outline" onClick={runValidation}>
                Run validation
              </Button>
              {validation && (
                <div className="space-y-2">
                  <div className={`flex items-center gap-2 rounded-md border p-3 ${validation.ok ? 'border-green-500/40 bg-green-50 dark:bg-green-950/20' : 'border-destructive/50 bg-destructive/10'}`}>
                    {validation.ok
                      ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                      : <AlertTriangle className="h-4 w-4 text-destructive" />}
                    <span className="text-sm font-medium">
                      {validation.ok ? 'All checks passed — ready to save.' : 'Validation failed.'}
                    </span>
                  </div>
                  {validation.errors.length > 0 && (
                    <ul className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-1">
                      {validation.errors.map((e, i) => (
                        <li key={i} className="text-destructive">• {e}</li>
                      ))}
                    </ul>
                  )}
                  {validation.warnings.length > 0 && (
                    <ul className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm space-y-1">
                      {validation.warnings.map((w, i) => (
                        <li key={i} className="text-amber-700 dark:text-amber-300">⚠ {w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {!validation && (
                <p className="text-sm text-muted-foreground">Click <b>Run validation</b> to check variables, tables and expression syntax.</p>
              )}
            </div>
          )}

          {/* Step 8: Save */}
          {step === 7 && (
            <div className="space-y-3">
              <div className="rounded-md border p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="font-mono">{type}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Code</span><span className="font-mono">{codeUpper}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Name</span><span>{name}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Category</span><Badge variant="outline">{category}</Badge></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Country</span><Badge variant="outline">{country || 'Global'}</Badge></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Output</span><span className="font-mono">{outputVariable} : {outputType}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Rounding</span><span>{rounding}</span></div>
              </div>
              <p className="text-xs text-muted-foreground">
                The formula will be created as <Badge variant="outline">DRAFT v1</Badge>. You can
                refine it in the version editor, then submit for review and activate.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex sm:justify-between gap-2">
          <div className="flex gap-2">
            <Button variant="ghost" onClick={close} disabled={saving}>Cancel</Button>
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" onClick={() => setStep(step - 1)} disabled={saving}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>
            )}
            {step < STEP_LABELS.length - 1 ? (
              <Button
                onClick={() => {
                  if (!next.ok) { toast.error(next.reason ?? 'Cannot continue'); return; }
                  setStep(step + 1);
                }}
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={save} disabled={saving || !validation?.ok}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                Create DRAFT v1
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
