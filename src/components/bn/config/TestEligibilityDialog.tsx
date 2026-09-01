/**
 * Test Eligibility Dialog
 *
 * Responsive layout:
 *   - Sticky header (title + mode tabs + close X)
 *   - Scrollable body (input form + result panel side-by-side on desktop,
 *     stacked on smaller screens)
 *   - Sticky footer (Fill Passing / Fill Failing / Reset / Evaluate / Close)
 *   - Below 1024px the dialog becomes near-full-screen and the result area
 *     collapses to a tabbed panel below the inputs.
 *
 * Modes:
 *   1. Sample Scenario (default) — no claim needed. Lists every fact used by
 *      the product's active rules; the user enters values; the operator
 *      engine evaluates each rule.
 *   2. Real Claim — runs the production fact resolver against an existing
 *      claim (UUID or claim_number).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Loader2, CheckCircle2, XCircle, AlertTriangle, FlaskConical,
  PlayCircle, Sparkles, X, RotateCcw, ThumbsUp, ThumbsDown,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { runProductEligibilityTest, type ProductTestResult } from '@/services/bn/eligibility/productEligibilityTest';
import { useBnEligibilityRules } from '@/hooks/bn/useBnProduct';
import { getFact } from '@/services/bn/eligibility/eligibilityFactRegistry';
import { useEligibilityFacts } from '@/hooks/bn/useEligibilityFacts';
import { OPERATORS, type EligibilityOperator } from '@/services/bn/eligibility/operators';
import type { BnEligibilityRule } from '@/types/bn';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionId: string;
  productCode?: string | null;
}

const db = supabase as any;

const OPERATOR_ALIASES: Record<string, string> = {
  EQUALS: '=', NOT_EQUALS: '!=', GREATER_THAN: '>', GREATER_OR_EQUAL: '>=',
  LESS_THAN: '<', LESS_OR_EQUAL: '<=', BETWEEN: 'between', IN: 'in', NOT_IN: 'in',
  BOOLEAN: '=', EXISTS: 'exists', CONTAINS: 'in',
};

interface SimRow {
  rule: BnEligibilityRule;
  factKey: string | null;
  factLabel: string;
  operator: string;
  expected: unknown;
  actual: unknown;
  result: 'PASS' | 'FAIL' | 'SKIPPED';
  message?: string;
}

type Mode = 'sample' | 'real';

/**
 * `getFact()` only searches the hardcoded ELIGIBILITY_FACTS registry, not the
 * real `bn_eligibility_fact` table — so a fresh, database-only fact (any fact
 * created via the Facts screen) was invisible here. Its data type silently
 * fell back to 'string', which meant a boolean fact's sample value was never
 * coerced to true/false — typing literally anything non-empty (even "f")
 * satisfied `Boolean(a) === Boolean(b)` and always PASSed, regardless of what
 * the rule actually required. Same root cause as the Group-default gap in
 * RuleWizardDialog.tsx: this dialog needs the database facts unioned in too.
 */
function normaliseDataType(raw: unknown): string {
  const t = String(raw ?? '').trim().toLowerCase();
  if (t === 'boolean') return 'bool';
  if (t === 'integer' || t === 'numeric' || t === 'decimal') return 'number';
  if (t === 'text' || t === 'varchar') return 'string';
  if (t === 'timestamp' || t === 'datetime') return 'date';
  return t || 'string';
}

export function TestEligibilityDialog({ open, onOpenChange, versionId }: Props) {
  const { toast } = useToast();
  const { data: rules = [] } = useBnEligibilityRules(versionId);
  const { data: dbFacts = [] } = useEligibilityFacts();
  const [mode, setMode] = useState<Mode>('sample');

  const factLookup = useMemo(() => {
    const m = new Map<string, { label: string; data_type: string }>();
    for (const f of dbFacts as any[]) {
      const key = String(f?.fact_key ?? '').trim();
      if (!key) continue;
      m.set(key, { label: String(f.label ?? key), data_type: normaliseDataType(f.data_type) });
    }
    return m;
  }, [dbFacts]);

  const lookupFact = useCallback((key: string): { label: string; data_type: string } | undefined => {
    const dbHit = factLookup.get(key);
    if (dbHit) return dbHit;
    const reg = getFact(key);
    return reg ? { label: reg.label, data_type: normaliseDataType(reg.data_type) } : undefined;
  }, [factLookup]);

  // ── Sample mode state ──────────────────────────────────────────────────
  const factsUsed = useMemo(() => {
    const set = new Map<string, { fact: { label: string; data_type: string } | undefined; label: string; dataType: string }>();
    const addKey = (key: unknown) => {
      if (!key || typeof key !== 'string' || set.has(key)) return;
      const f = lookupFact(key);
      set.set(key, { fact: f, label: f?.label ?? key, dataType: f?.data_type ?? 'string' });
    };
    for (const r of rules) {
      if (!r.is_active) continue;
      const rd = (r.rule_definition || {}) as Record<string, any>;
      // Primary fact key (literal / comparison rules)
      addKey(rd.field_key ?? (r as any).fact_key);
      // Range / date-difference / comparison rules also need these facts
      addKey((r as any).start_fact_key);
      addKey((r as any).end_fact_key);
      addKey((r as any).fallback_end_fact_key);
      addKey((r as any).compare_fact_key);
      addKey(rd.compare_field_key);
      addKey(rd.start_field_key);
      addKey(rd.end_field_key);
    }
    return Array.from(set.entries()).map(([k, v]) => ({ factKey: k, ...v }));
  }, [rules, lookupFact]);

  const [sampleValues, setSampleValues] = useState<Record<string, string>>({});
  const [simRows, setSimRows] = useState<SimRow[] | null>(null);

  // Real-claim mode state
  const [claimRef, setClaimRef] = useState('');
  const [runningReal, setRunningReal] = useState(false);
  const [realResult, setRealResult] = useState<ProductTestResult | null>(null);

  // Reset state on open/version change
  useEffect(() => {
    if (open) {
      setSampleValues({}); setSimRows(null); setRealResult(null);
      setMode('sample'); setClaimRef('');
    }
  }, [open, versionId]);

  const evaluateSample = () => {
    const rows: SimRow[] = [];
    for (const r of rules) {
      if (!r.is_active) continue;
      const rd = (r.rule_definition || {}) as Record<string, any>;
      const factKey = (rd.field_key ?? (r as any).fact_key) as string | null;
      const factDef = factKey ? lookupFact(factKey) : undefined;
      const opKey = (OPERATOR_ALIASES[rd.operator] ?? rd.operator) as EligibilityOperator;
      const opDef = OPERATORS[opKey];

      let expected: unknown = rd.value;
      if (rd.operator === 'BETWEEN' || opKey === 'between') expected = [rd.range_from ?? rd.value_from, rd.range_to ?? rd.value_to];
      if (rd.operator === 'IN' || rd.operator === 'NOT_IN') expected = rd.values;

      const raw = factKey ? sampleValues[factKey] : undefined;
      const actual = coerceSample(raw, factDef?.data_type);

      let result: SimRow['result'] = 'SKIPPED';
      let message: string | undefined;
      if (!factKey) message = 'No fact linked';
      else if (!opDef) message = `Unknown operator "${rd.operator}"`;
      else if (raw === undefined || raw === '') message = 'No sample value provided';
      else {
        const pass = opDef.evaluate(actual, expected);
        result = pass ? 'PASS' : 'FAIL';
      }

      rows.push({
        rule: r, factKey,
        factLabel: factDef?.label ?? factKey ?? '—',
        operator: String(rd.operator ?? ''),
        expected, actual: actual ?? raw ?? null, result, message,
      });
    }
    setSimRows(rows);
  };

  const fillScenario = (kind: 'pass' | 'fail') => {
    const next: Record<string, string> = {};
    for (const f of factsUsed) {
      const ruleForFact = rules.find((r) => {
        const rd = (r.rule_definition || {}) as any;
        return (rd.field_key ?? (r as any).fact_key) === f.factKey;
      });
      const rd: any = (ruleForFact?.rule_definition || {});
      next[f.factKey] = suggestValue(rd, f.dataType, kind);
    }
    setSampleValues(next);
    setSimRows(null);
  };

  const resetAll = () => {
    setSampleValues({}); setSimRows(null);
    setClaimRef(''); setRealResult(null);
  };

  const resolveClaimId = async (input: string): Promise<string | null> => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return trimmed;
    const { data } = await db.from('bn_claim').select('id').eq('claim_number', trimmed).maybeSingle();
    return (data as any)?.id ?? null;
  };

  const runReal = async () => {
    if (!claimRef.trim()) { toast({ title: 'Enter a claim ID or number', variant: 'destructive' }); return; }
    setRunningReal(true); setRealResult(null);
    try {
      const id = await resolveClaimId(claimRef);
      if (!id) { toast({ title: 'Claim not found', description: `No claim matches "${claimRef}"`, variant: 'destructive' }); return; }
      const res = await runProductEligibilityTest(versionId, id);
      setRealResult(res);
    } catch (e: any) {
      toast({ title: 'Test failed', description: e?.message ?? 'Unknown error', variant: 'destructive' });
    } finally { setRunningReal(false); }
  };

  const sampleOverall = useMemo(() => {
    if (!simRows) return null;
    if (simRows.some((r) => r.result === 'FAIL')) return 'FAIL';
    if (simRows.some((r) => r.result === 'SKIPPED')) return 'INCOMPLETE';
    return 'PASS';
  }, [simRows]);

  // Normalised result rows (drives the tabbed result panel)
  const resultRows: ResultRow[] | null = useMemo(() => {
    if (mode === 'sample') {
      if (!simRows) return null;
      return simRows.map((r) => ({
        key: r.rule.id, name: r.rule.rule_name, code: r.rule.rule_code,
        expected: `${r.operator} ${fmt(r.expected)}`,
        actual: fmt(r.actual), source: r.factKey ?? '—',
        result: r.result, message: r.message,
      }));
    }
    if (!realResult) return null;
    return realResult.rows.map((r, i) => ({
      key: `${r.rule_code}-${i}`, name: r.rule_name, code: r.rule_code,
      expected: `${r.operator} ${fmt(r.expected)}`,
      actual: fmt(r.actual), source: r.source ?? '—',
      result: r.result, message: r.message,
    }));
  }, [mode, simRows, realResult]);

  const hasResults = !!resultRows;
  const overallNode =
    mode === 'sample'
      ? sampleOverall === 'PASS' ? <Badge className="bg-emerald-600 text-white">All rules pass</Badge>
        : sampleOverall === 'FAIL' ? <Badge variant="destructive">Failed</Badge>
        : sampleOverall === 'INCOMPLETE' ? <Badge variant="outline" className="border-amber-400 text-amber-700">Incomplete</Badge>
        : null
      : realResult?.overall === 'PASS' ? <Badge className="bg-emerald-600 text-white">All rules passed</Badge>
        : realResult?.overall === 'FAIL' ? <Badge variant="destructive">Failed</Badge>
        : realResult ? <Badge variant="outline" className="border-amber-400 text-amber-700">Blocked</Badge>
        : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 p-0 lg:h-[85vh] lg:max-h-[85vh] lg:w-[min(1100px,95vw)] lg:max-w-[1100px] lg:rounded-lg"
        onInteractOutside={(e) => e.preventDefault()}
      >
        {/* ─── STICKY HEADER ─────────────────────────────────────── */}
        <div className="sticky top-0 z-10 flex flex-col gap-3 border-b bg-background px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
                <FlaskConical className="h-5 w-5" /> Test Eligibility
              </DialogTitle>
              <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
                Validate this product's eligibility rules without leaving the catalogue.
              </p>
            </div>
            <Button
              variant="ghost" size="icon"
              className="-mr-2 h-8 w-8 shrink-0"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList>
              <TabsTrigger value="sample" className="gap-2">
                <Sparkles className="h-4 w-4" /> Sample Scenario
              </TabsTrigger>
              <TabsTrigger value="real" className="gap-2">
                <PlayCircle className="h-4 w-4" /> Real Claim
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* ─── SCROLLABLE BODY ───────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className={hasResults ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]' : 'grid gap-4'}>
            {/* INPUT COLUMN */}
            <div className="min-w-0 space-y-4">
              {mode === 'sample' ? (
                factsUsed.length === 0 ? (
                  <p className="rounded border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                    No active rules to test. Add rules first.
                  </p>
                ) : (
                  <div className="space-y-2 rounded border bg-muted/30 p-3">
                    <div className="text-sm font-medium">Provide a sample value for each fact</div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                      {factsUsed.map((f) => (
                        <div key={f.factKey} className="space-y-1">
                          <Label className="text-xs">
                            {f.label}
                            <span className="ml-1 text-muted-foreground">({f.dataType})</span>
                          </Label>
                          <Input
                            placeholder={placeholderFor(f.dataType)}
                            value={sampleValues[f.factKey] ?? ''}
                            onChange={(e) => setSampleValues((p) => ({ ...p, [f.factKey]: e.target.value }))}
                          />
                          <div className="text-[10px] font-mono text-muted-foreground">{f.factKey}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              ) : (
                <div className="space-y-3 rounded border bg-muted/30 p-3">
                  <div>
                    <Label htmlFor="claim-ref" className="text-xs">Claim ID (UUID) or claim number</Label>
                    <Input
                      id="claim-ref"
                      placeholder="e.g. 1a2b3c4d-… or CLAIM-2026-000123"
                      value={claimRef}
                      onChange={(e) => setClaimRef(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') runReal(); }}
                    />
                  </div>
                  {realResult && (
                    <p className="text-xs text-muted-foreground">
                      Claim <span className="font-mono">{realResult.claim_id.slice(0, 8)}…</span>
                      {realResult.product_code && <> · Product {realResult.product_code}</>}
                      {realResult.snapshot_refreshed && <> · contribution snapshot refreshed</>}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* RESULT COLUMN */}
            {hasResults && resultRows && (
              <ResultTabs overall={overallNode} rows={resultRows} factsUsed={factsUsed} sampleValues={sampleValues} mode={mode} />
            )}
          </div>
        </div>

        {/* ─── STICKY FOOTER ─────────────────────────────────────── */}
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 border-t bg-background px-4 py-3 sm:px-6">
          {mode === 'sample' && factsUsed.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={() => fillScenario('pass')} className="gap-2">
                <ThumbsUp className="h-4 w-4" /> Fill Passing
              </Button>
              <Button variant="outline" size="sm" onClick={() => fillScenario('fail')} className="gap-2">
                <ThumbsDown className="h-4 w-4" /> Fill Failing
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={resetAll} className="gap-2">
            <RotateCcw className="h-4 w-4" /> Reset
          </Button>
          <div className="flex-1" />
          {mode === 'sample' ? (
            <Button onClick={evaluateSample} disabled={factsUsed.length === 0} className="gap-2">
              <PlayCircle className="h-4 w-4" /> Evaluate
            </Button>
          ) : (
            <Button onClick={runReal} disabled={runningReal} className="gap-2">
              {runningReal ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              Run Test
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────

interface ResultRow {
  key: string; name: string; code: string; expected: string; actual: string;
  source: string; result: 'PASS' | 'FAIL' | 'SKIPPED'; message?: string;
}

function ResultTabs({
  overall, rows, factsUsed, sampleValues, mode,
}: {
  overall: React.ReactNode;
  rows: ResultRow[];
  factsUsed: { factKey: string; label: string; dataType: string }[];
  sampleValues: Record<string, string>;
  mode: Mode;
}) {
  const failed = rows.filter((r) => r.result === 'FAIL');
  const skipped = rows.filter((r) => r.result === 'SKIPPED');
  const passed = rows.filter((r) => r.result === 'PASS');

  return (
    <div className="min-w-0 rounded border bg-card">
      <div className="flex items-center gap-3 border-b px-3 py-2 text-sm">
        {overall}
        <span className="text-xs text-muted-foreground">
          {passed.length} pass · {failed.length} fail · {skipped.length} skipped
        </span>
      </div>
      <Tabs defaultValue={failed.length > 0 ? 'failed' : 'all'} className="w-full">
        <TabsList className="m-2">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="failed">Failed ({failed.length})</TabsTrigger>
          <TabsTrigger value="all">All ({rows.length})</TabsTrigger>
          {mode === 'sample' && <TabsTrigger value="facts">Fact Values</TabsTrigger>}
        </TabsList>

        <TabsContent value="summary" className="px-3 pb-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <SummaryTile label="Passed" count={passed.length} tone="emerald" />
            <SummaryTile label="Failed" count={failed.length} tone="red" />
            <SummaryTile label="Skipped" count={skipped.length} tone="amber" />
          </div>
          {failed.length > 0 && (
            <div className="mt-3 space-y-1 text-xs">
              <div className="font-medium">Top failing rules</div>
              {failed.slice(0, 5).map((r) => (
                <div key={r.key} className="truncate text-muted-foreground">
                  • {r.name} — expected <span className="font-mono">{r.expected}</span>, got <span className="font-mono">{r.actual}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="failed" className="m-0">
          <RuleResultTable rows={failed} emptyMessage="No failing rules." />
        </TabsContent>
        <TabsContent value="all" className="m-0">
          <RuleResultTable rows={rows} emptyMessage="No rules evaluated." />
        </TabsContent>
        {mode === 'sample' && (
          <TabsContent value="facts" className="m-0">
            <div className="max-h-[55vh] overflow-y-auto p-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fact</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Value provided</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {factsUsed.map((f) => (
                    <TableRow key={f.factKey}>
                      <TableCell className="text-xs">{f.label}</TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground">{f.factKey}</TableCell>
                      <TableCell className="font-mono text-xs">{sampleValues[f.factKey] || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function RuleResultTable({ rows, emptyMessage }: { rows: ResultRow[]; emptyMessage: string }) {
  if (rows.length === 0) return <p className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  return (
    <div className="max-h-[55vh] overflow-y-auto">
      <Table>
        <TableHeader className="sticky top-0 bg-background">
          <TableRow>
            <TableHead className="w-8"></TableHead>
            <TableHead>Rule</TableHead>
            <TableHead>Expected</TableHead>
            <TableHead>Actual</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key} className={r.result === 'FAIL' ? 'bg-destructive/5' : r.result === 'SKIPPED' ? 'bg-amber-50/40' : ''}>
              <TableCell>
                {r.result === 'PASS' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  : r.result === 'FAIL' ? <XCircle className="h-4 w-4 text-destructive" />
                  : <AlertTriangle className="h-4 w-4 text-amber-500" />}
              </TableCell>
              <TableCell>
                <div className="text-sm font-medium">{r.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{r.code}</div>
                {r.message && <div className="mt-0.5 text-xs italic text-muted-foreground">{r.message}</div>}
              </TableCell>
              <TableCell className="font-mono text-xs">{r.expected}</TableCell>
              <TableCell className="font-mono text-xs">{r.actual}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{r.source}</TableCell>
              <TableCell>
                <Badge variant={r.result === 'PASS' ? 'default' : r.result === 'FAIL' ? 'destructive' : 'outline'} className="text-[10px]">
                  {r.result}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SummaryTile({ label, count, tone }: { label: string; count: number; tone: 'emerald' | 'red' | 'amber' }) {
  const cls = tone === 'emerald'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : tone === 'red'
      ? 'border-destructive/30 bg-destructive/5 text-destructive'
      : 'border-amber-200 bg-amber-50 text-amber-700';
  return (
    <div className={`rounded border p-3 ${cls}`}>
      <div className="text-2xl font-semibold">{count}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

function placeholderFor(dataType?: string): string {
  switch (dataType) {
    case 'number': return 'e.g. 42';
    case 'date': return 'YYYY-MM-DD';
    case 'bool': return 'true / false';
    case 'enum': return 'enum value';
    default: return 'sample value';
  }
}

function coerceSample(raw: string | undefined, dataType?: string): unknown {
  if (raw === undefined || raw === '') return null;
  switch (dataType) {
    case 'number': {
      const n = Number(raw); return Number.isFinite(n) ? n : raw;
    }
    case 'bool': {
      const v = raw.trim().toLowerCase();
      if (['true', 'yes', 'y', '1'].includes(v)) return true;
      if (['false', 'no', 'n', '0'].includes(v)) return false;
      // Unrecognized text for a boolean fact must not fall through as a raw
      // string — every non-empty string is JS-truthy, so eq() would compare
      // it against `true` and silently pass regardless of what was typed.
      return null;
    }
    case 'date': return raw;
    default: return raw;
  }
}

/**
 * Heuristic — derive a sample value that will satisfy (or violate) the given
 * rule definition. Used by Fill Passing / Fill Failing buttons.
 */
function suggestValue(rd: any, dataType: string, kind: 'pass' | 'fail'): string {
  const op = String(rd?.operator ?? '').toUpperCase();
  const v = rd?.value;
  const from = rd?.range_from ?? rd?.value_from;
  const to = rd?.range_to ?? rd?.value_to;
  const list: any[] = Array.isArray(rd?.values) ? rd.values : [];

  const num = (x: any) => {
    const n = Number(x); return Number.isFinite(n) ? n : 0;
  };

  switch (op) {
    case 'EQUALS': case '=':
      return kind === 'pass' ? String(v ?? '') : String(dataType === 'number' ? num(v) + 1 : `${v ?? ''}-x`);
    case 'NOT_EQUALS': case '!=':
      return kind === 'pass' ? String(dataType === 'number' ? num(v) + 1 : `${v ?? ''}-x`) : String(v ?? '');
    case 'GREATER_THAN': case '>':
      return String(kind === 'pass' ? num(v) + 1 : num(v) - 1);
    case 'GREATER_OR_EQUAL': case '>=':
      return String(kind === 'pass' ? num(v) : num(v) - 1);
    case 'LESS_THAN': case '<':
      return String(kind === 'pass' ? num(v) - 1 : num(v) + 1);
    case 'LESS_OR_EQUAL': case '<=':
      return String(kind === 'pass' ? num(v) : num(v) + 1);
    case 'BETWEEN':
      return String(kind === 'pass' ? num(from) : num(to) + 1);
    case 'IN':
      return kind === 'pass' ? String(list[0] ?? '') : '__none__';
    case 'NOT_IN':
      return kind === 'pass' ? '__none__' : String(list[0] ?? '');
    case 'BOOLEAN':
      return kind === 'pass' ? String(!!v) : String(!v);
    case 'EXISTS':
      return kind === 'pass' ? 'yes' : '';
    default:
      return kind === 'pass' ? String(v ?? '') : '';
  }
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.map(fmt).join(' … ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export default TestEligibilityDialog;
