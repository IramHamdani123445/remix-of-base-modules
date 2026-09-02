/**
 * Add Rules by Category — primary product eligibility add flow.
 * Shows all rule categories as accordion sections. User multi-selects active
 * READY rules from one or more categories and bulk-inserts them onto the
 * product version with `rule_category` and (no) source group provenance.
 */
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useRuleCatalogue } from '@/hooks/bn/useRuleCatalogue';
import { useBnProductVersion } from '@/hooks/bn/useBnProduct';
import { useEligibilityFacts } from '@/hooks/bn/useEligibilityFacts';
import { getCurrentUserCode } from '@/services/bn/audit/getCurrentUserCode';
import { catalogueLegalSnapshot } from '@/lib/bn/catalogueLegalSnapshot';
import {
  RULE_CATEGORIES,
  isRuleCurrentlyEffective,
  type RuleCatalogueItem,
} from '@/services/bn/ruleCatalogueService';
import { BnBusyButton } from '@/components/bn/shared';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  versionId: string;
  onAdded?: () => void;
}

type Band = 'READY' | 'PARTIAL' | 'BLOCKED';

export function AddRulesByCategoryDialog({ open, onOpenChange, versionId, onAdded }: Props) {
  const { data: rules = [] } = useRuleCatalogue();
  const { data: facts = [] } = useEligibilityFacts();
  const { data: version } = useBnProductVersion(versionId);
  const asOfDate = useMemo(
    () => ((version as any)?.effective_from ? new Date((version as any).effective_from) : new Date()),
    [version],
  );
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const factByKey = useMemo(() => {
    const m = new Map<string, any>();
    facts.forEach(f => m.set(f.fact_key, f));
    return m;
  }, [facts]);

  const coverage = (r: RuleCatalogueItem): { label: string; band: Band } => {
    if (!r.fact_key) return { label: 'NO FACT', band: 'BLOCKED' };
    const f = factByKey.get(r.fact_key);
    if (!f) return { label: 'UNLINKED', band: 'BLOCKED' };
    if (f.implementation_status === 'NOT_IMPLEMENTED') return { label: 'NOT_IMPLEMENTED', band: 'BLOCKED' };
    if (f.implementation_status === 'PARTIAL') return { label: 'PARTIAL', band: 'PARTIAL' };
    return { label: 'READY', band: 'READY' };
  };

  const byCategory = useMemo(() => {
    const s = search.trim().toLowerCase();
    const m = new Map<string, RuleCatalogueItem[]>();
    for (const r of rules) {
      if (!r.is_active) continue;
      // Governance gate — only legally approved rules attach to products
      const gs = (r as any).governance_status;
      if (gs && !['LEGAL_CONFIRMED','READY_FOR_PRODUCT_USE','ACTIVE'].includes(gs)) continue;
      // Anchored to the product version's own effective_from, not "today" —
      // same reasoning as CataloguePickerDialog.
      if (!isRuleCurrentlyEffective(r, asOfDate)) continue;
      if (s && !r.rule_code.toLowerCase().includes(s) && !r.rule_name.toLowerCase().includes(s)
          && !(r.fact_key ?? '').toLowerCase().includes(s)) continue;
      const cat = (r.category ?? r.group_type ?? 'COMMON') as string;
      const arr = m.get(cat) ?? [];
      arr.push(r);
      m.set(cat, arr);
    }
    return m;
  }, [rules, search, asOfDate]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const handleSave = async () => {
    if (selected.size === 0) { onOpenChange(false); return; }
    const picked = rules.filter(r => selected.has(r.id));
    const blocked = picked.filter(r => coverage(r).band === 'BLOCKED');
    if (blocked.length) {
      toast.error('Cannot add — some rules are BLOCKED', {
        description: `${blocked.length} rule(s) have missing/unimplemented facts.`,
      });
      return;
    }
    const userCode = await getCurrentUserCode();
    if (!userCode) { toast.error('Authenticated user_code required'); return; }
    setBusy(true);
    try {
      const rows = picked.map((r, i) => ({
        product_version_id: versionId,
        catalogue_rule_id: r.id,
        catalogue_rule_code: r.rule_code,
        catalogue_rule_version: r.version,
        rule_category: r.category ?? r.group_type,
        rule_code: r.rule_code,
        rule_name: r.rule_name,
        rule_type: 'CATALOGUE',
        rule_group: 'GENERAL',
        fact_key: r.fact_key,
        rule_definition: {
          parameter: r.rule_code,
          operator: r.operator,
          value_from: r.value_from,
          value_to: r.value_to,
          values: r.values,
        },
        fail_action: r.default_fail_action,
        fail_message: r.failure_message_text,
        // Legal approval must travel with the copy — the publish gate reads
        // these fields on the product rule, not on the catalogue row.
        ...catalogueLegalSnapshot(r as any),
        sort_order: i,
        is_active: true,
        entered_by: userCode,
      }));
      const { error } = await (supabase as any)
        .from('bn_eligibility_rule')
        .upsert(rows, { onConflict: 'product_version_id,rule_code' });
      if (error) throw error;
      toast.success(`${rows.length} rule(s) added to product`);
      setSelected(new Set());
      onAdded?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error('Add failed', { description: e?.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Eligibility Rules by Category</DialogTitle>
          <DialogDescription>Browse rules grouped by category. Select rules across categories and add in one step.</DialogDescription>
        </DialogHeader>

        <div className="relative mb-2">
          <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search by code, name, or fact"
                 value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="text-xs text-muted-foreground mb-2">
          Selected: <span className="font-semibold text-foreground">{selected.size}</span>
        </div>

        <Accordion type="multiple" className="w-full">
          {RULE_CATEGORIES.map(cat => {
            const items = byCategory.get(cat) ?? [];
            if (!items.length) return null;
            return (
              <AccordionItem key={cat} value={cat}>
                <AccordionTrigger className="text-sm">
                  <span className="flex items-center gap-2">
                    <Badge variant="outline">{cat}</Badge>
                    <span className="text-muted-foreground text-xs">{items.length} rule(s)</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-1">
                    {items.map(r => {
                      const c = coverage(r);
                      const v = c.band === 'READY' ? 'default' : c.band === 'PARTIAL' ? 'secondary' : 'destructive';
                      return (
                        <label key={r.id}
                          className={`flex items-center gap-3 rounded border px-2 py-1.5 text-xs cursor-pointer hover:bg-muted/40 ${c.band === 'BLOCKED' ? 'opacity-60' : ''}`}>
                          <Checkbox
                            checked={selected.has(r.id)}
                            disabled={c.band === 'BLOCKED'}
                            onCheckedChange={() => toggle(r.id)}
                          />
                          <div className="flex-1">
                            <div className="font-mono">{r.rule_code}</div>
                            <div className="text-muted-foreground">{r.rule_name}</div>
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground">{r.fact_key ?? '—'}</div>
                          <div className="text-[10px] text-muted-foreground">{r.operator}</div>
                          <Badge variant={v} className="text-[9px]">{c.label}</Badge>
                        </label>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <BnBusyButton loading={busy} onClick={handleSave} disabled={busy || selected.size === 0}>
            {busy ? 'Adding…' : `Add ${selected.size} rule(s)`}
          </BnBusyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
