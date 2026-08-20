/**
 * TestRulePanel — runs a single eligibility rule against a real claim from the
 * preview database and renders the resulting diagnostic. Lets the user pick
 * (or paste) a claim and optionally override `injury_date` for DATE_DIFFERENCE
 * rules whose start fact comes from `ctx.extras.injury_date`.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Play, FlaskConical } from 'lucide-react';
import type { BnEligibilityRule } from '@/types/bn';
import { supabase } from '@/integrations/supabase/client';
import { evaluateRule, type RuleDiagnostic } from '@/services/bn/eligibility/ruleEvaluator';

interface ClaimOpt {
  id: string;
  claim_number: string | null;
  ssn: string | null;
  claim_date: string | null;
  submission_date: string | null;
}

interface Props {
  /** The in-progress rule from the wizard (may be unsaved / partial). */
  rule: Partial<BnEligibilityRule>;
  productCode?: string | null;
}

const db = supabase as any;

export function TestRulePanel({ rule, productCode }: Props) {
  const [claims, setClaims] = useState<ClaimOpt[]>([]);
  const [claimId, setClaimId] = useState<string>('');
  const [injuryOverride, setInjuryOverride] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [diag, setDiag] = useState<RuleDiagnostic | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load recent claims (optionally scoped to product)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let q = db
        .from('bn_claim')
        .select('id, claim_number, ssn, claim_date, submission_date, product_id, bn_product:product_id(benefit_code)')
        .order('submission_date', { ascending: false })
        .limit(25);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) { setError(error.message); return; }
      const filtered = productCode
        ? (data ?? []).filter((r: any) => r.bn_product?.benefit_code === productCode)
        : (data ?? []);
      setClaims(filtered as ClaimOpt[]);
    })();
    return () => { cancelled = true; };
  }, [productCode]);

  const selected = useMemo(() => claims.find((c) => c.id === claimId), [claims, claimId]);

  const needsInjuryOverride =
    rule.rule_kind === 'DATE_DIFFERENCE' &&
    (rule.start_fact_key === 'claim.injury_date' || rule.end_fact_key === 'claim.injury_date');

  const run = async () => {
    setError(null);
    setDiag(null);
    if (!claimId) { setError('Pick a claim first.'); return; }
    if (!rule.rule_code || !rule.rule_kind) { setError('Rule code and kind are required.'); return; }
    setBusy(true);
    try {
      const ctx = {
        claimId,
        ssn: selected?.ssn ?? null,
        productCode: productCode ?? null,
        claimDate: selected?.claim_date ?? null,
        extras: injuryOverride ? { injury_date: injuryOverride } : undefined,
      };
      // Cast the partial rule to a full BnEligibilityRule for the evaluator.
      // Fields the evaluator actually reads are guaranteed by the wizard's
      // save-time validation; we fill the rest with safe defaults.
      const fullRule = {
        id: rule.id ?? 'preview',
        rule_code: rule.rule_code,
        rule_name: rule.rule_name ?? rule.rule_code,
        rule_kind: rule.rule_kind,
        rule_definition: rule.rule_definition ?? {},
        fact_key: rule.fact_key ?? null,
        compare_fact_key: rule.compare_fact_key ?? null,
        start_fact_key: rule.start_fact_key ?? null,
        end_fact_key: rule.end_fact_key ?? null,
        fallback_end_fact_key: rule.fallback_end_fact_key ?? null,
        document_type_code: rule.document_type_code ?? null,
        required_status: rule.required_status ?? null,
        existence_check_code: rule.existence_check_code ?? null,
        unit: rule.unit ?? null,
        severity: rule.severity ?? 'BLOCK',
        overrideable: rule.overrideable ?? false,
        conditional_when: rule.conditional_when ?? null,
        message_template: rule.message_template ?? null,
        fail_message: rule.fail_message ?? null,
      } as unknown as BnEligibilityRule;
      const result = await evaluateRule(fullRule, ctx);
      setDiag(result);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const resultColor =
    diag?.result === 'PASS' ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
    : diag?.result === 'FAIL' ? 'bg-destructive/15 text-destructive border-destructive/30'
    : 'bg-muted text-muted-foreground border-border';

  return (
    <div className="rounded-lg border border-dashed bg-background p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <FlaskConical className="h-4 w-4 text-primary" /> Test this rule
        <Badge variant="outline" className="text-[10px]">live evaluator</Badge>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Pick a claim {productCode ? `(${productCode})` : ''}</Label>
          <Select value={claimId} onValueChange={setClaimId}>
            <SelectTrigger><SelectValue placeholder={claims.length ? 'Choose a claim…' : 'No claims found'} /></SelectTrigger>
            <SelectContent className="max-h-80">
              {claims.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <div className="flex flex-col">
                    <span className="font-mono text-xs">{c.claim_number ?? c.id.slice(0, 8)}</span>
                    <span className="text-[10px] text-muted-foreground">SSN {c.ssn ?? '—'} · claim {c.claim_date ?? '—'} · sub {c.submission_date ?? '—'}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {needsInjuryOverride && (
          <div className="space-y-1">
            <Label className="text-xs">Injury date override (optional)</Label>
            <Input type="date" value={injuryOverride} onChange={(e) => setInjuryOverride(e.target.value)} />
            <p className="text-[10px] text-muted-foreground">bn_claim has no injury_date column; the resolver falls back to claim_date unless overridden here.</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="default" onClick={run} disabled={busy || !claimId}>
          {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
          Run
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {diag && (
        <div className={`rounded border p-3 text-xs space-y-2 ${resultColor}`}>
          <div className="flex items-center justify-between">
            <span className="font-semibold">{diag.result}</span>
            <Badge variant="outline" className="text-[10px]">{diag.rule_kind}</Badge>
          </div>
          <p>{diag.message}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono">
            <div><span className="opacity-60">source:</span> {diag.source_fact ?? '—'}</div>
            <div><span className="opacity-60">table:</span> {diag.source_table ?? '—'}</div>
            <div><span className="opacity-60">actual:</span> {String(diag.actual_value ?? '—')}</div>
            <div><span className="opacity-60">expected:</span> {diag.operator ?? ''} {String(diag.expected_value ?? '—')}</div>
            {diag.unit && <div><span className="opacity-60">unit:</span> {diag.unit}</div>}
            <div><span className="opacity-60">severity:</span> {diag.severity}</div>
          </div>
        </div>
      )}
    </div>
  );
}
