/**
 * Add Rule Group from Catalogue — pick an existing Rule Group, preview all
 * active linked catalogue rules with coverage status, then insert one
 * bn_eligibility_rule per linked rule onto the product version.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useBnRuleGroups } from '@/hooks/bn/useBnConfig';
import { useEligibilityFacts } from '@/hooks/bn/useEligibilityFacts';
import { getCurrentUserCode } from '@/services/bn/audit/getCurrentUserCode';
import { catalogueLegalSnapshot } from '@/lib/bn/catalogueLegalSnapshot';
import { recommendedGroupsForProduct } from '@/services/bn/eligibility/recommendedGroups';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  versionId: string;
  productCode?: string | null;
  onAdded?: () => void;
}

export function AddRuleGroupFromCatalogueDialog({ open, onOpenChange, versionId, productCode, onAdded }: Props) {
  const { data: groups = [] } = useBnRuleGroups();
  const { data: facts = [] } = useEligibilityFacts();
  const [groupId, setGroupId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const recommended = recommendedGroupsForProduct(productCode);

  const factByKey = useMemo(() => {
    const m = new Map<string, any>();
    for (const f of facts) m.set(f.fact_key, f);
    return m;
  }, [facts]);

  const { data: linked = [] } = useQuery({
    queryKey: ['bn', 'group-linked-active-mm', groupId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('bn_rule_group_item')
        .select(`
          sort_order, default_active,
          bn_rule_catalogue:catalogue_rule_id (
            id, rule_code, rule_name, fact_key, operator, value_from, value_to, values,
            default_fail_action, failure_message_text, version, is_active, category, group_type,
            governance_status, legal_reference
          )
        `)
        .eq('rule_group_id', groupId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      const ALLOWED_GOV = new Set(['LEGAL_CONFIRMED','READY_FOR_PRODUCT_USE','ACTIVE']);
      return (data || [])
        .map((row: any) => ({ ...row.bn_rule_catalogue, sort_order: row.sort_order, default_active: row.default_active }))
        .filter((r: any) => r && r.is_active && (!r.governance_status || ALLOWED_GOV.has(r.governance_status)));
    },
    enabled: !!groupId,
  });

  const coverage = (factKey: string | null): { label: string; band: 'READY' | 'PARTIAL' | 'BLOCKED' } => {
    if (!factKey) return { label: 'NO FACT', band: 'BLOCKED' };
    const f = factByKey.get(factKey);
    if (!f) return { label: 'UNLINKED', band: 'BLOCKED' };
    if (!f.is_active) return { label: 'INACTIVE FACT', band: 'BLOCKED' };
    if (f.implementation_status === 'NOT_IMPLEMENTED') return { label: 'NOT_IMPLEMENTED', band: 'BLOCKED' };
    if (f.implementation_status === 'PARTIAL') return { label: 'PARTIAL', band: 'PARTIAL' };
    return { label: 'READY', band: 'READY' };
  };

  const handleAdd = async () => {
    if (!groupId || linked.length === 0) { onOpenChange(false); return; }
    const blocked = linked.filter((r: any) => coverage(r.fact_key).band === 'BLOCKED');
    if (blocked.length) {
      toast.error('Cannot add — some rules are BLOCKED', {
        description: `${blocked.length} rule(s) have missing/unimplemented facts. Only READY (and PARTIAL with warning) rules can be added.`,
      });
      return;
    }
    const userCode = await getCurrentUserCode();
    if (!userCode) { toast.error('Authenticated user_code required'); return; }
    const group = (groups as any[]).find(g => g.id === groupId);
    setBusy(true);
    try {
      const rows = linked.map((r: any, i: number) => ({
        product_version_id: versionId,
        rule_group_id: groupId,
        group_code: group?.group_code ?? null,
        source_rule_group_id: groupId,
        source_rule_group_code: group?.group_code ?? null,
        catalogue_rule_id: r.id,
        catalogue_rule_code: r.rule_code,
        catalogue_rule_version: r.version,
        rule_category: r.category ?? r.group_type,
        rule_code: r.rule_code,
        rule_name: r.rule_name,
        rule_type: 'CATALOGUE',
        rule_group: group?.group_code ?? 'GENERAL',
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
      const partial = linked.filter((r: any) => coverage(r.fact_key).band === 'PARTIAL').length;
      toast.success(`${rows.length} rule(s) added from group ${group?.group_code}`, {
        description: partial > 0 ? `${partial} use PARTIAL facts — review before publish.` : undefined,
      });
      setGroupId('');
      onAdded?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error('Add failed', { description: e?.message });
    } finally {
      setBusy(false);
    }
  };

  const blockedCount = linked.filter((r: any) => coverage(r.fact_key).band === 'BLOCKED').length;
  const partialCount = linked.filter((r: any) => coverage(r.fact_key).band === 'PARTIAL').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Rule Group from Catalogue</DialogTitle>
          <DialogDescription>Select a Rule Group; all its active linked catalogue rules will be added to this product version.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {recommended.length > 0 && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
              <div className="text-xs font-semibold">Recommended for {productCode}</div>
              <div className="flex flex-wrap gap-2">
                {recommended.map(code => {
                  const g = (groups as any[]).find(x => x.group_code === code && x.is_active);
                  return (
                    <Button key={code} type="button" size="sm" variant={g ? 'outline' : 'ghost'}
                      disabled={!g} onClick={() => g && setGroupId(g.id)}
                      title={g ? 'Click to load this template' : 'Group not seeded yet'}>
                      {code}{!g && ' (missing)'}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger><SelectValue placeholder="Select an existing Rule Group" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {(groups as any[]).filter(g => g.is_active).map(g => (
                <SelectItem key={g.id} value={g.id}>{g.group_code} — {g.group_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {groupId && (
            <>
              {linked.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No active catalogue rules linked to this group.</p>
              ) : (
                <>
                  {blockedCount > 0 && (
                    <p className="text-xs text-destructive">
                      {blockedCount} rule(s) are BLOCKED (missing/unimplemented fact) — add disabled.
                    </p>
                  )}
                  {partialCount > 0 && blockedCount === 0 && (
                    <p className="text-xs text-amber-600">
                      {partialCount} rule(s) use PARTIAL facts — allowed with warning, cannot publish until READY.
                    </p>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Fact</TableHead>
                        <TableHead>Op</TableHead>
                        <TableHead>Default</TableHead>
                        <TableHead>Coverage</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linked.map((r: any) => {
                        const c = coverage(r.fact_key);
                        const v = c.band === 'READY' ? 'default' : c.band === 'PARTIAL' ? 'secondary' : 'destructive';
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="font-mono text-xs">{r.rule_code}</TableCell>
                            <TableCell className="text-xs">{r.rule_name}</TableCell>
                            <TableCell className="font-mono text-xs">{r.fact_key ?? '—'}</TableCell>
                            <TableCell className="text-xs">{r.operator}</TableCell>
                            <TableCell className="text-xs">{r.value_from ?? '(per product)'}</TableCell>
                            <TableCell><Badge variant={v}>{c.label}</Badge></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleAdd} disabled={busy || !groupId || linked.length === 0 || blockedCount > 0}>
            {busy ? 'Adding…' : `Add ${linked.length} rule(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
