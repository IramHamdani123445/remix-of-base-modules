/**
 * RuleWizardDialog — executable-rule builder.
 *
 * Drives the rule definition off the typed `rule_kind` column instead of the
 * legacy free-form `field_name/operator/value` grid. The user picks a kind
 * (DATE_DIFFERENCE, DOCUMENT_STATUS, …) and the dialog renders only the
 * inputs that kind needs, with the fact picker scoped to the registry.
 */
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Wand2 } from 'lucide-react';
import { TestRulePanel } from './TestRulePanel';
import type { BnEligibilityRule } from '@/types/bn';
import { useToast } from '@/hooks/use-toast';
import { useUpsertBnEligibilityRule } from '@/hooks/bn/useBnProduct';
import {
  ELIGIBILITY_FACTS,
  CATEGORY_LABELS,
  RULE_GROUPS,
  defaultGroupForFact,
} from '@/services/bn/eligibility/eligibilityFactRegistry';
import { OPERATORS } from '@/services/bn/eligibility/operators';
import { useEligibilityFacts } from '@/hooks/bn/useEligibilityFacts';

type Kind = NonNullable<BnEligibilityRule['rule_kind']>;
const KINDS: { value: Kind; label: string; description: string }[] = [
  { value: 'LITERAL',         label: 'Literal comparison',     description: 'Compare a fact (number / enum / bool) to a fixed value.' },
  { value: 'FACT_TO_FACT',    label: 'Fact ↔ Fact',           description: 'Compare two facts directly (e.g. last worked date ≤ injury date).' },
  { value: 'DATE_DIFFERENCE', label: 'Date difference',        description: 'Compute days/weeks between two dates and compare (e.g. report within 3 days).' },
  { value: 'DOCUMENT_STATUS', label: 'Document status',        description: 'Verify a document on the claim has a required status.' },
  { value: 'EXISTS',          label: 'Existence check',        description: 'Check whether a fact exists (e.g. active award).' },
  { value: 'CROSS_PRODUCT',   label: 'Cross-product check',    description: 'Block when an overlapping claim/award exists on another product.' },
  { value: 'DERIVED_FACT',    label: 'Derived fact',           description: 'Same as Literal but flags that the source value is computed.' },
  { value: 'CONDITIONAL',     label: 'Conditional rule',       description: 'Only evaluate the inner check when a precondition fact matches.' },
];

const UNITS: BnEligibilityRule['unit'][] = ['DAYS', 'WEEKS', 'MONTHS', 'YEARS'];
const DOC_STATUSES = ['PENDING', 'RECEIVED', 'VERIFIED', 'REJECTED'];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  productVersionId: string;
  productCode?: string | null;
  initial?: Partial<BnEligibilityRule> | null;
  onSaved?: () => void;
}

const EMPTY: Partial<BnEligibilityRule> = {
  rule_code: '', rule_name: '', rule_kind: 'LITERAL',
  rule_definition: { operator: '>=', value: 0 },
  severity: 'BLOCK', fail_action: 'REJECT', is_active: true, overrideable: false, sort_order: 0,
  group_code: 'CORE_IDENTITY', rule_type: 'CONTRIBUTION', rule_group: 'GENERAL',
};

/**
 * The two data-type vocabularies, reconciled (BUG-52).
 *
 * `bn_eligibility_fact.data_type` stores "boolean" on 17 facts; the operator
 * table declares `appliesTo: [... 'bool' ...]`. Compared raw, every boolean
 * fact matched no operator, so the operator dropdown was filtered wrongly for
 * exactly the facts a rule most often asserts.
 */
function normaliseDataType(raw: unknown): string {
  const t = String(raw ?? '').trim().toLowerCase();
  if (t === 'boolean') return 'bool';
  if (t === 'integer' || t === 'numeric' || t === 'decimal') return 'number';
  if (t === 'text' || t === 'varchar') return 'string';
  if (t === 'timestamp' || t === 'datetime') return 'date';
  return t || 'string';
}

/** One fact option group: a category and the facts in it. */
type FactGroup = [string, Array<{ fact_key: string; label: string; data_type: string; source_table: string | null }>];

/**
 * The fact picker, declared at module scope.
 *
 * BUG-52 — this used to be declared inside RuleWizardDialog's body. A
 * component defined during render has a new function identity on every render,
 * so React does not update it: it unmounts the old subtree and mounts a fresh
 * one. Choosing a fact called onValueChange, which set state, which re-rendered
 * the dialog, which gave the picker a new identity — and Radix remounted the
 * Select with empty internal state. The fact was visible in the list and could
 * not be selected.
 *
 * `grouped` is passed as a prop so the component can live out here.
 */
function FactSelectField({
  value,
  onValueChange,
  placeholder = 'Pick a fact…',
  dateOnly = false,
  grouped,
}: {
  value?: string | null;
  onValueChange: (v: string) => void;
  placeholder?: string;
  dateOnly?: boolean;
  grouped: FactGroup[];
}) {
  return (
    <Select value={value ?? ''} onValueChange={onValueChange}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent className="max-h-80">
        {grouped.map(([cat, facts]) => {
          const filtered = dateOnly ? facts.filter((f) => f.data_type === 'date') : facts;
          if (!filtered.length) return null;
          return (
            <div key={cat}>
              <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                {(CATEGORY_LABELS as Record<string, string>)[cat] ?? cat}
              </div>
              {filtered.map((f) => (
                <SelectItem key={f.fact_key} value={f.fact_key}>
                  <div className="flex flex-col">
                    <span>{f.label}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {f.fact_key}{f.source_table ? ` · ${f.source_table}` : ''}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </div>
          );
        })}
      </SelectContent>
    </Select>
  );
}

export function RuleWizardDialog({ open, onOpenChange, productVersionId, productCode, initial, onSaved }: Props) {
  const { toast } = useToast();
  const upsert = useUpsertBnEligibilityRule();
  const [rule, setRule] = useState<Partial<BnEligibilityRule>>(EMPTY);

  useEffect(() => {
    if (open) setRule({ ...EMPTY, ...(initial ?? {}), product_version_id: productVersionId });
  }, [open, initial, productVersionId]);

  const kind = (rule.rule_kind ?? 'LITERAL') as Kind;
  const def = (rule.rule_definition ?? {}) as Record<string, any>;
  const set = (patch: Partial<BnEligibilityRule>) => setRule((p) => ({ ...p, ...patch }));
  const setDef = (patch: Record<string, any>) => setRule((p) => ({ ...p, rule_definition: { ...(p.rule_definition as any), ...patch } }));

  /**
   * BUG-52 — the picker used to list ELIGIBILITY_FACTS, the hardcoded code
   * registry, so a fact created through the Facts screen could never appear
   * here: creating one writes to bn_eligibility_fact, and nothing read it.
   * The registry holds 66 facts; the table holds 77.
   *
   * The table is now the source, unioned with the registry so nothing that was
   * previously selectable disappears — the registry carries resolver bindings
   * for facts the table may not list. The table wins on a shared key, because
   * that is what an administrator most recently configured.
   *
   * `useUpsertEligibilityFact` already invalidates this query, so a newly
   * created fact appears without a reload.
   */
  const { data: dbFacts = [] } = useEligibilityFacts();

  const allFacts = useMemo(() => {
    const byKey = new Map<string, { fact_key: string; label: string; category: string; data_type: string; source_table: string | null; applicable_products: string[] }>();
    for (const f of ELIGIBILITY_FACTS) {
      byKey.set(f.fact_key, {
        fact_key: f.fact_key,
        label: f.label,
        category: String(f.category),
        data_type: normaliseDataType(f.data_type),
        source_table: f.source_table ?? null,
        applicable_products: f.applicable_products ?? ['*'],
      });
    }
    for (const f of dbFacts as any[]) {
      const key = String(f?.fact_key ?? '').trim();
      if (!key) continue;
      byKey.set(key, {
        fact_key: key,
        label: String(f.label ?? key),
        // The table stores category free-form and in mixed case — CONTRIBUTION
        // (16 facts) alongside contribution (5), CLAIM alongside claim. Upper-
        // casing folds those together; an unmapped category falls back to its
        // own name rather than rendering an empty heading.
        category: String(f.category ?? 'GENERAL').toUpperCase(),
        data_type: normaliseDataType(f.data_type),
        source_table: f.source_table ?? null,
        applicable_products: Array.isArray(f.applicable_products) && f.applicable_products.length > 0
          ? f.applicable_products
          : ['*'],
      });
    }
    return Array.from(byKey.values());
  }, [dbFacts]);

  const factsForProduct = useMemo(() => {
    if (!productCode) return allFacts;
    // A fact listing no products applies to all of them — an empty list is not
    // a statement that it applies to none.
    return allFacts.filter(
      (f) => f.applicable_products.includes('*') || f.applicable_products.includes(productCode),
    );
  }, [allFacts, productCode]);

  const grouped = useMemo(() => {
    const m = new Map<string, typeof factsForProduct>();
    for (const f of factsForProduct) {
      const arr = m.get(f.category) ?? [];
      arr.push(f);
      m.set(f.category, arr);
    }
    return Array.from(m.entries());
  }, [factsForProduct]);

  const FactSelect = (props: {
    value?: string | null;
    onValueChange: (v: string) => void;
    placeholder?: string;
    dateOnly?: boolean;
  }) => <FactSelectField {...props} grouped={grouped} />;

  const onKindChange = (k: Kind) => {
    // Reset kind-specific fields cleanly
    set({
      rule_kind: k,
      start_fact_key: null, end_fact_key: null, fallback_end_fact_key: null,
      compare_fact_key: null, document_type_code: null, required_status: null,
      existence_check_code: null, unit: k === 'DATE_DIFFERENCE' ? 'DAYS' : null,
      conditional_when: k === 'CONDITIONAL' ? {} : null,
      rule_definition: k === 'DATE_DIFFERENCE' ? { operator: '<=', value: 3 } : k === 'EXISTS' || k === 'CROSS_PRODUCT' ? { value: true } : { operator: '=', value: '' },
    });
  };

  const handleSave = async () => {
    if (!rule.rule_code || !rule.rule_name) { toast({ title: 'Code & Name required', variant: 'destructive' }); return; }
    if (kind === 'DATE_DIFFERENCE' && (!rule.start_fact_key || (!rule.end_fact_key && !rule.fallback_end_fact_key))) {
      toast({ title: 'Need start and end facts', variant: 'destructive' }); return;
    }
    if ((kind === 'LITERAL' || kind === 'DERIVED_FACT' || kind === 'EXISTS' || kind === 'CROSS_PRODUCT') && !rule.fact_key) {
      toast({ title: 'Pick a fact', variant: 'destructive' }); return;
    }
    if (kind === 'DOCUMENT_STATUS' && !rule.fact_key && !rule.document_type_code) {
      toast({ title: 'Pick a document fact or set document_type_code', variant: 'destructive' }); return;
    }
    if (kind === 'FACT_TO_FACT' && (!rule.fact_key || !rule.compare_fact_key)) {
      toast({ title: 'Pick both facts', variant: 'destructive' }); return;
    }
    try {
      // BUG-52 — read `getFact` (the code registry), so a rule saved against a
      // fact that exists only in bn_eligibility_fact carried data_source null
      // and could not be traced back to where its value comes from. Resolved
      // from the merged list.
      const saveFact = rule.fact_key
        ? allFacts.find((f) => f.fact_key === rule.fact_key) ?? null
        : null;
      const payload: Partial<BnEligibilityRule> = {
        ...rule,
        product_version_id: productVersionId,
        group_code: rule.group_code ?? (rule.fact_key ? defaultGroupForFact(rule.fact_key) : 'CORE_IDENTITY'),
        data_source: saveFact?.source_table ?? rule.data_source ?? null,
      };
      await upsert.mutateAsync(payload);
      toast({ title: 'Rule saved' });
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message, variant: 'destructive' });
    }
  };

  /**
   * BUG-52 — this read `getFact`, the code registry, so for any fact that
   * exists only in bn_eligibility_fact (11 of them today, plus every fact
   * created since) factDef was null and the operator list fell back to ALL
   * operators, unfiltered by the fact's type. Resolved from the merged list
   * instead, so a fact created through the Facts screen gates its operators
   * exactly as a registry fact does.
   */
  const factDef = useMemo(() => {
    if (!rule.fact_key) return null;
    return allFacts.find((f) => f.fact_key === rule.fact_key) ?? null;
  }, [allFacts, rule.fact_key]);

  const operators = factDef
    ? Object.values(OPERATORS).filter((o) => (o.appliesTo as string[]).includes(factDef.data_type))
    : Object.values(OPERATORS);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wand2 className="h-4 w-4 text-primary" /> Eligibility Rule Wizard</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Identification */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Rule Code *</Label><Input value={rule.rule_code ?? ''} onChange={(e) => set({ rule_code: e.target.value.toUpperCase() })} maxLength={30} /></div>
            <div className="space-y-1"><Label>Rule Name *</Label><Input value={rule.rule_name ?? ''} onChange={(e) => set({ rule_name: e.target.value })} /></div>
          </div>

          {/* Kind */}
          <div className="space-y-1">
            <Label>Rule Kind *</Label>
            <Select value={kind} onValueChange={(v) => onKindChange(v as Kind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    <div className="flex flex-col">
                      <span className="font-medium">{k.label}</span>
                      <span className="text-[10px] text-muted-foreground">{k.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Kind-specific configuration */}
          <div className="rounded-lg border p-3 space-y-3 bg-muted/30">
            {kind === 'DATE_DIFFERENCE' && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1"><Label className="text-xs">Start date *</Label><FactSelect value={rule.start_fact_key} onValueChange={(v) => set({ start_fact_key: v })} dateOnly /></div>
                  <div className="space-y-1"><Label className="text-xs">End date *</Label><FactSelect value={rule.end_fact_key} onValueChange={(v) => set({ end_fact_key: v })} dateOnly /></div>
                  <div className="space-y-1"><Label className="text-xs">Fallback end</Label><FactSelect value={rule.fallback_end_fact_key} onValueChange={(v) => set({ fallback_end_fact_key: v })} dateOnly placeholder="(optional)" /></div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Operator</Label>
                    <Select value={(def.operator as string) ?? '<='} onValueChange={(v) => setDef({ operator: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(['<=', '<', '>=', '>', '=', '!='] as const).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Threshold</Label><Input type="number" value={def.value ?? 0} onChange={(e) => setDef({ value: Number(e.target.value) })} /></div>
                  <div className="space-y-1">
                    <Label className="text-xs">Unit</Label>
                    <Select value={(rule.unit ?? 'DAYS') as string} onValueChange={(v) => set({ unit: v as any })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{UNITS.map((u) => <SelectItem key={u!} value={u!}>{u}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}

            {kind === 'DOCUMENT_STATUS' && (
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1 col-span-2"><Label className="text-xs">Document fact (preferred)</Label><FactSelect value={rule.fact_key} onValueChange={(v) => set({ fact_key: v })} /></div>
                <div className="space-y-1">
                  <Label className="text-xs">Required status</Label>
                  <Select value={rule.required_status ?? 'VERIFIED'} onValueChange={(v) => set({ required_status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{DOC_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-3 space-y-1">
                  <Label className="text-xs">…or document type code (fallback)</Label>
                  <Input value={rule.document_type_code ?? ''} onChange={(e) => set({ document_type_code: e.target.value })} placeholder="e.g. MEDICAL_CERT" />
                </div>
              </div>
            )}

            {kind === 'FACT_TO_FACT' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label className="text-xs">Left fact *</Label><FactSelect value={rule.fact_key} onValueChange={(v) => set({ fact_key: v })} /></div>
                  <div className="space-y-1"><Label className="text-xs">Right fact *</Label><FactSelect value={rule.compare_fact_key} onValueChange={(v) => set({ compare_fact_key: v })} /></div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Operator</Label>
                  <Select value={(def.operator as string) ?? '='} onValueChange={(v) => setDef({ operator: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{operators.map((o) => <SelectItem key={o.key} value={o.key}>{o.label} ({o.key})</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {(kind === 'EXISTS' || kind === 'CROSS_PRODUCT') && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2"><Label className="text-xs">Existence fact *</Label><FactSelect value={rule.fact_key} onValueChange={(v) => set({ fact_key: v })} /></div>
                <div className="space-y-1">
                  <Label className="text-xs">Expected</Label>
                  <Select value={String(def.value ?? true)} onValueChange={(v) => setDef({ value: v === 'true' })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="true">Must exist (true)</SelectItem><SelectItem value="false">Must NOT exist (false)</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {(kind === 'LITERAL' || kind === 'DERIVED_FACT' || kind === 'CONDITIONAL') && (
              <div className="space-y-3">
                <div className="space-y-1"><Label className="text-xs">Fact *</Label><FactSelect value={rule.fact_key} onValueChange={(v) => set({ fact_key: v, group_code: defaultGroupForFact(v) })} /></div>
                {factDef && (
                  <p className="text-[11px] text-muted-foreground">{factDef.description} · <span className="font-mono">{factDef.source_table}.{factDef.source_column}</span> · type: <Badge variant="outline" className="text-[10px]">{factDef.data_type}</Badge></p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Operator</Label>
                    <Select value={(def.operator as string) ?? '='} onValueChange={(v) => setDef({ operator: v })} disabled={!factDef}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{operators.map((o) => <SelectItem key={o.key} value={o.key}>{o.label} ({o.key})</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Expected value</Label>
                    {factDef?.data_type === 'bool' ? (
                      <Select value={String(def.value ?? 'true')} onValueChange={(v) => setDef({ value: v === 'true' })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="true">true</SelectItem><SelectItem value="false">false</SelectItem></SelectContent>
                      </Select>
                    ) : factDef?.data_type === 'enum' && factDef.allowed_values ? (
                      <Select value={String(def.value ?? '')} onValueChange={(v) => setDef({ value: v })}>
                        <SelectTrigger><SelectValue placeholder="Pick…" /></SelectTrigger>
                        <SelectContent>{factDef.allowed_values.map((v) => <SelectItem key={String(v)} value={String(v)}>{String(v)}</SelectItem>)}</SelectContent>
                      </Select>
                    ) : (
                      <Input type={factDef?.data_type === 'number' ? 'number' : factDef?.data_type === 'date' ? 'date' : 'text'} value={def.value ?? ''} onChange={(e) => setDef({ value: factDef?.data_type === 'number' ? Number(e.target.value) : e.target.value })} />
                    )}
                  </div>
                </div>
                {kind === 'CONDITIONAL' && (
                  <div className="rounded border-l-2 border-primary/40 bg-background p-2 space-y-2">
                    <Label className="text-xs">Precondition (only evaluate inner rule when this matches)</Label>
                    <div className="grid grid-cols-3 gap-2">
                      <FactSelect value={(rule.conditional_when as any)?.fact_key} onValueChange={(v) => set({ conditional_when: { ...(rule.conditional_when as any), fact_key: v } })} />
                      <Select value={((rule.conditional_when as any)?.operator as string) ?? '='} onValueChange={(v) => set({ conditional_when: { ...(rule.conditional_when as any), operator: v } })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{(['=', '!=', '>=', '<=', 'exists', 'not_exists'] as const).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input value={(rule.conditional_when as any)?.value ?? ''} onChange={(e) => set({ conditional_when: { ...(rule.conditional_when as any), value: e.target.value } })} placeholder="value" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Severity / Action / Override */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Severity</Label>
              <Select value={(rule.severity as string) ?? 'BLOCK'} onValueChange={(v) => set({ severity: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BLOCK">Block (hard fail)</SelectItem>
                  <SelectItem value="REFER">Refer (manual review)</SelectItem>
                  <SelectItem value="WARN">Warn (soft)</SelectItem>
                  <SelectItem value="INFO">Info</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fail action</Label>
              <Select value={(rule.fail_action as string) ?? 'REJECT'} onValueChange={(v) => set({ fail_action: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="REJECT">REJECT</SelectItem>
                  <SelectItem value="REFER">REFER</SelectItem>
                  <SelectItem value="WARN">WARN</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Group</Label>
              <Select value={(rule.group_code as string) ?? 'CORE_IDENTITY'} onValueChange={(v) => set({ group_code: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{RULE_GROUPS.map((g) => <SelectItem key={g.code} value={g.code}>{g.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-md border bg-muted/30 p-2">
            <div className="flex items-center gap-2"><Switch checked={rule.overrideable ?? false} onCheckedChange={(v) => set({ overrideable: v })} /><Label className="text-sm">Allow override</Label></div>
            {rule.overrideable && <Input className="flex-1" placeholder="Override policy code (e.g. SUPERVISOR_L2)" value={rule.override_policy_code ?? ''} onChange={(e) => set({ override_policy_code: e.target.value || null })} />}
            <div className="flex items-center gap-2"><Switch checked={rule.is_active ?? true} onCheckedChange={(v) => set({ is_active: v })} /><Label className="text-sm">Active</Label></div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Message template</Label>
            <Textarea rows={2} value={rule.message_template ?? ''} onChange={(e) => set({ message_template: e.target.value })} placeholder="e.g. Reported {{actual}} days after the injury (limit {{expected}})." />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fail message (legacy fallback)</Label>
            <Textarea rows={2} value={rule.fail_message ?? ''} onChange={(e) => set({ fail_message: e.target.value })} />


          <TestRulePanel rule={rule} productCode={productCode} />
        </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={upsert.isPending}>{upsert.isPending ? 'Saving…' : 'Save rule'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
