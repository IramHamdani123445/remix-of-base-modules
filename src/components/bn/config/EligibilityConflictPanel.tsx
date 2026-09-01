/**
 * Eligibility Conflict Panel — shown inside Product → Eligibility tab.
 * Runs the pre-save conflict detector over the current set of rules and
 * lists every conflict with rule A / rule B / reason / suggestion.
 */
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { detectEligibilityConflicts, summarizeConflicts, type CandidateRule } from '@/services/bn/eligibility/productEligibilityConflictService';
import { useEligibilityFacts } from '@/hooks/bn/useEligibilityFacts';
import { useRuleCatalogue } from '@/hooks/bn/useRuleCatalogue';
import type { RuleCatalogueItem } from '@/services/bn/ruleCatalogueService';
import { resolveEffectiveRuleShape, type CatalogueShapeSource } from '@/lib/bn/effectiveRuleShape';

interface Props {
  rules: any[];
}

export function EligibilityConflictPanel({ rules }: Props) {
  const { data: facts = [] } = useEligibilityFacts();
  // GAP-039 — a catalogue-linked rule's shape is checked live against the
  // catalogue, not the product's own possibly-stale copy, so a fact-key fix
  // made once in the Rule Catalogue clears this panel's warning immediately
  // for every product using it, with no per-product resave needed.
  const { data: catalogueRules = [] } = useRuleCatalogue();
  const catalogueById = useMemo(
    () => new Map<string, CatalogueShapeSource>(catalogueRules.map((c: RuleCatalogueItem) => [c.id, c])),
    [catalogueRules],
  );

  const candidates: CandidateRule[] = useMemo(() => rules.map(r => {
    const def = (r.rule_definition ?? {}) as any;
    const shape = resolveEffectiveRuleShape(r, catalogueById);
    return {
      id: r.id,
      rule_code: r.rule_code,
      rule_name: r.rule_name,
      fact_key: shape.fact_key ?? def.field_key ?? null,
      rule_kind: shape.rule_kind ?? null,
      start_fact_key: shape.start_fact_key ?? null,
      end_fact_key: shape.end_fact_key ?? null,
      operator: def.operator ?? r.operator ?? 'EQUALS',
      value_from: def.value_from ?? def.value ?? null,
      value_to: def.value_to ?? def.range_to ?? null,
      values: def.values ?? null,
      is_active: r.is_active !== false,
      rule_category: r.rule_category ?? null,
    };
  }), [rules, catalogueById]);

  const conflicts = useMemo(() => detectEligibilityConflicts(candidates, facts as any), [candidates, facts]);
  const sum = summarizeConflicts(conflicts);

  return (
    <Card className={'border-l-4 ' + (sum.errors ? 'border-l-destructive' : sum.warnings ? 'border-l-amber-500' : 'border-l-emerald-500')}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" /> Eligibility Conflict Check
          <Badge variant="destructive" className="text-[10px]">{sum.errors} error</Badge>
          <Badge variant="secondary" className="text-[10px]">{sum.warnings} warning</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sum.total === 0 ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription className="text-xs">No conflicts detected in current rule set.</AlertDescription>
          </Alert>
        ) : (
          <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {conflicts.map(c => (
              <li key={c.id} className="rounded-md border bg-card/50 p-2 text-xs">
                <div className="flex items-start gap-2">
                  <AlertTriangle className={`h-4 w-4 mt-0.5 ${c.severity === 'ERROR' ? 'text-destructive' : 'text-amber-500'}`} />
                  <div className="flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant={c.severity === 'ERROR' ? 'destructive' : 'secondary'} className="text-[9px]">{c.severity}</Badge>
                      <Badge variant="outline" className="text-[9px]">{c.conflict_type}</Badge>
                      <span className="font-mono">{c.rule_a.rule_code}</span>
                      {c.rule_b && <><span>↔</span><span className="font-mono">{c.rule_b.rule_code}</span></>}
                    </div>
                    <p className="leading-snug">{c.reason}</p>
                    <p className="text-muted-foreground"><span className="font-medium">Fix:</span> {c.suggestion}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
