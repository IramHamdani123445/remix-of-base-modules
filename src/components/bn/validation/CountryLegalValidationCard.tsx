/**
 * Country & Legal Reference Validation Card
 * -----------------------------------------
 * Phase 2 — checks every active Benefits config row uses the new structured
 * Country Pack source of truth:
 *
 *   1. Active product → `country_code` exists in `bn_country` and is active
 *   2. Active product → has at least one ACTIVE legal reference for its country
 *      (warning, not error — products may inherit a country-default ref)
 *   3. Communication templates → all tokens resolve against the registry
 *   4. No active product/rule/formula references a SUPERSEDED / REPEALED
 *      legal reference (errors)
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, Scale, Globe } from 'lucide-react';
import { TOKEN_REGISTRY, extractTokens } from '@/lib/bn/templateTokens';

const db = supabase as any;

type Severity = 'error' | 'warning' | 'info';
interface Finding {
  severity: Severity;
  category: 'country' | 'legal' | 'template';
  message: string;
  entity?: string;
}

async function runChecks(): Promise<Finding[]> {
  const findings: Finding[] = [];

  // 1. Load reference data once
  const [{ data: countries }, { data: legalRefs }] = await Promise.all([
    db.from('bn_country').select('country_code, country_name, is_active'),
    db.from('core_legal_reference').select('id, ref_code, short_title, country_code, status, is_active'),
  ]);
  const countryMap = new Map<string, any>((countries || []).map((c: any) => [c.country_code, c]));
  const legalMap = new Map<string, any>((legalRefs || []).map((r: any) => [r.id, r]));

  // 2. Active products
  //
  // BUG-54: this named `product_code`, `product_name` and `is_active`. None of
  // the three exists on bn_product, which carries `benefit_code`,
  // `benefit_name` and `status`. PostgREST rejected the whole query with 42703,
  // `products` came back null, and the loop below ran over nothing, so this
  // check reported a clean bill of health for 30 active products it never read.
  const { data: products, error: productError } = await db
    .from('bn_product')
    .select('id, benefit_code, benefit_name, country_code, status')
    .eq('status', 'ACTIVE');
  if (productError) {
    findings.push({
      severity: 'error',
      category: 'country',
      message: `Active products could not be read (${productError.message}), so their country bindings were not checked`,
      entity: 'bn_product',
    });
  }
  for (const p of products || []) {
    if (!p.country_code) {
      findings.push({ severity: 'error', category: 'country', message: 'Active product has no country', entity: `${p.benefit_code} — ${p.benefit_name}` });
      continue;
    }
    const c = countryMap.get(p.country_code);
    if (!c) {
      findings.push({ severity: 'error', category: 'country', message: `Active product references unknown country "${p.country_code}"`, entity: p.benefit_code });
    } else if (!c.is_active) {
      findings.push({ severity: 'warning', category: 'country', message: `Active product uses inactive country "${c.country_name}"`, entity: p.benefit_code });
    }
  }

  // 3. Inactive/superseded legal refs used by active config
  /**
   * BUG-54: this filtered every table on `is_active`, but only two of the four
   * have it. bn_product and bn_rate_table carry `status`, so their queries
   * failed with 42703 -- and the `catch {}` at the call site swallowed the
   * failure, so those two tables were never checked and nothing said so.
   *
   * Each table now names its own active filter.
   */
  const checkLegalCol = async (
    table: string,
    codeCol: string,
    activeFilter: { column: string; value: unknown },
  ) => {
    const { data, error } = await db
      .from(table)
      .select(`id, ${codeCol}, legal_reference_id`)
      .eq(activeFilter.column, activeFilter.value)
      .not('legal_reference_id', 'is', null);
    if (error) {
      findings.push({
        severity: 'error',
        category: 'legal',
        message: `${table} could not be read (${error.message}), so its legal references were not checked`,
        entity: table,
      });
      return;
    }
    for (const row of (data || []) as any[]) {
      const ref = legalMap.get(row.legal_reference_id);
      if (!ref) {
        findings.push({ severity: 'error', category: 'legal', message: `${table} → unknown legal reference id`, entity: row[codeCol] });
        continue;
      }
      if (ref.status === 'SUPERSEDED' || ref.status === 'REPEALED') {
        findings.push({
          severity: 'error',
          category: 'legal',
          message: `${table} uses ${ref.status} legal reference "${ref.ref_code}"`,
          entity: row[codeCol],
        });
      } else if (ref.status === 'DRAFT') {
        findings.push({
          severity: 'warning',
          category: 'legal',
          message: `${table} uses DRAFT legal reference "${ref.ref_code}"`,
          entity: row[codeCol],
        });
      }
    }
  };
  // Only call for tables that exist + have those columns; wrap each in try
  // Each entry names the table, its code column, and how that table says
  // "active" -- two of the four use `status`, not `is_active` (BUG-54).
  const legalTables = [
    { table: 'bn_product', code: 'benefit_code', active: { column: 'status', value: 'ACTIVE' } },
    { table: 'bn_eligibility_rule', code: 'rule_code', active: { column: 'is_active', value: true } },
    { table: 'bn_formula_template', code: 'template_code', active: { column: 'is_active', value: true } },
    { table: 'bn_rate_table', code: 'table_code', active: { column: 'status', value: 'ACTIVE' } },
  ] as const;
  for (const t of legalTables) {
    // A thrown error is reported rather than ignored: a check that could not
    // run must not read as a check that found nothing.
    try {
      await checkLegalCol(t.table, t.code, t.active);
    } catch (e: any) {
      findings.push({
        severity: 'error',
        category: 'legal',
        message: `${t.table} could not be checked (${e?.message ?? 'unknown error'})`,
        entity: t.table,
      });
    }
  }

  // 4. Communication templates — token registry resolution
  const known = new Set(TOKEN_REGISTRY.map(t => t.key.toLowerCase()));
  const { data: templates } = await db
    .from('notification_templates')
    .select('template_code, subject, body, html_body, is_enabled')
    .or('template_code.ilike.BN_%,trigger_event.ilike.bn.%')
    .eq('is_enabled', true);
  for (const t of (templates || []) as any[]) {
    const allTokens = [
      ...extractTokens(t.subject),
      ...extractTokens(t.body),
      ...extractTokens(t.html_body),
    ];
    // Phase-2-style tokens contain a dot; legacy flat tokens skip this check
    const phase2 = allTokens.filter(tok => tok.includes('.'));
    const unknown = phase2.filter(tok => !known.has(tok.toLowerCase()));
    if (unknown.length) {
      findings.push({
        severity: 'error',
        category: 'template',
        message: `Active template uses unknown tokens: ${unknown.map(u => `{{${u}}}`).join(', ')}`,
        entity: t.template_code,
      });
    }
  }

  return findings;
}

const SEVERITY_STYLE: Record<Severity, string> = {
  error: 'bg-destructive/10 text-destructive border-destructive/30',
  warning: 'bg-amber-500/10 text-amber-700 border-amber-300',
  info: 'bg-blue-500/10 text-blue-700 border-blue-300',
};
const CATEGORY_ICON: Record<Finding['category'], React.ReactNode> = {
  country: <Globe className="h-3.5 w-3.5" />,
  legal: <Scale className="h-3.5 w-3.5" />,
  template: <ShieldCheck className="h-3.5 w-3.5" />,
};

export const CountryLegalValidationCard: React.FC = () => {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['bn-country-legal-validation'],
    queryFn: runChecks,
    staleTime: 30_000,
  });

  const errors = (data ?? []).filter(f => f.severity === 'error');
  const warnings = (data ?? []).filter(f => f.severity === 'warning');

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" /> Country &amp; Legal References
            </CardTitle>
            <CardDescription>
              Validates Country Pack source-of-truth across active products, rules, formulas, rate tables and templates.
            </CardDescription>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-xs text-muted-foreground hover:text-foreground underline"
            disabled={isFetching}
          >
            {isFetching ? 'Re-checking…' : 'Re-check'}
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Running checks…
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Check failed</AlertTitle>
            <AlertDescription>{(error as Error).message}</AlertDescription>
          </Alert>
        )}
        {!isLoading && !error && (
          <>
            <div className="flex items-center gap-3 text-sm">
              <Badge variant={errors.length ? 'destructive' : 'secondary'}>{errors.length} errors</Badge>
              <Badge variant={warnings.length ? 'secondary' : 'outline'}>{warnings.length} warnings</Badge>
              {errors.length === 0 && warnings.length === 0 && (
                <span className="flex items-center gap-1.5 text-emerald-700 text-xs">
                  <CheckCircle2 className="h-3.5 w-3.5" /> All active config is using the Country Pack source of truth.
                </span>
              )}
            </div>
            {(data ?? []).length > 0 && (
              <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
                {(data ?? []).map((f, i) => (
                  <div key={i} className={`text-xs border rounded px-2 py-1.5 flex items-start gap-2 ${SEVERITY_STYLE[f.severity]}`}>
                    <span className="mt-0.5">{CATEGORY_ICON[f.category]}</span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{f.message}</div>
                      {f.entity && <div className="text-[10px] opacity-75 truncate">{f.entity}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default CountryLegalValidationCard;
