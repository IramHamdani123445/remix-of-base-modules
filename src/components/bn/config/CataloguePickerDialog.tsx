/**
 * Picker dialog: choose reusable catalogue rules and add them to a product version.
 */
import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { useRuleCatalogue } from '@/hooks/bn/useRuleCatalogue';
import { supabase } from '@/integrations/supabase/client';
import { getCurrentUserCode } from '@/services/bn/audit/getCurrentUserCode';
import { catalogueLegalSnapshot } from '@/lib/bn/catalogueLegalSnapshot';
import type { RuleCatalogueItem } from '@/services/bn/ruleCatalogueService';
import { BnBusyButton } from '@/components/bn/shared';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  versionId: string;
  onAdded?: () => void;
}

export function CataloguePickerDialog({ open, onOpenChange, versionId, onAdded }: Props) {
  const { data: rules = [] } = useRuleCatalogue();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const ALLOWED_GOV = new Set(['LEGAL_CONFIRMED','READY_FOR_PRODUCT_USE','ACTIVE']);
  const filtered = useMemo(() => rules.filter(r => {
    if (!r.is_active) return false;
    const gs = (r as any).governance_status;
    // Governance gate: only legally-confirmed (or beyond) rules can be attached to a product version
    if (gs && !ALLOWED_GOV.has(gs)) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return r.rule_code.toLowerCase().includes(s) || r.rule_name.toLowerCase().includes(s) || r.group_type.toLowerCase().includes(s);
  }), [rules, search]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const handleAdd = async () => {
    if (selected.size === 0) { onOpenChange(false); return; }
    const userCode = await getCurrentUserCode();
    if (!userCode) { toast.error('Authenticated user_code required'); return; }
    setBusy(true);
    try {
      const items = rules.filter(r => selected.has(r.id));
      const rows = items.map((r: RuleCatalogueItem, i: number) => ({
        product_version_id: versionId,
        rule_code: r.rule_code,
        rule_name: r.rule_name,
        rule_type: r.group_type,
        rule_group: r.group_type,
        rule_definition: {
          parameter: r.parameter,
          operator: r.operator,
          value_from: r.value_from,
          value_to: r.value_to,
          values: r.values,
        },
        fail_action: r.default_fail_action,
        fail_message: r.failure_message_text,
        fact_key: r.fact_key,
        catalogue_rule_id: r.id,
        catalogue_rule_code: r.rule_code,
        catalogue_rule_version: r.version,
        // Legal approval must travel with the copy — the publish gate reads
        // these fields on the product rule, not on the catalogue row.
        ...catalogueLegalSnapshot(r as any),
        is_active: true,
        sort_order: i,
        entered_by: userCode,
      }));
      const { error } = await (supabase as any)
        .from('bn_eligibility_rule')
        .upsert(rows, { onConflict: 'product_version_id,rule_code' });
      if (error) throw error;
      toast.success(`${rows.length} catalogue rule(s) added`);
      setSelected(new Set());
      onAdded?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error('Failed to add rules', { description: e?.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add from Rule Catalogue</DialogTitle>
          <DialogDescription>Pick reusable catalogue rules to attach to this product version. You can override values after adding.</DialogDescription>
        </DialogHeader>
        <Input placeholder="Search code, name or group" value={search} onChange={e => setSearch(e.target.value)} className="mb-3" />
        <div className="max-h-[55vh] overflow-y-auto border rounded">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Group</TableHead>
                <TableHead>Governance</TableHead>
                <TableHead>Parameter</TableHead>
                <TableHead>Operator</TableHead>
                <TableHead>Fail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(r => {
                const gs = (r as any).governance_status as string | undefined;
                const govTone = gs === 'ACTIVE' || gs === 'READY_FOR_PRODUCT_USE' ? 'default' : 'secondary';
                return (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => toggle(r.id)}>
                  <TableCell><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} /></TableCell>
                  <TableCell className="font-mono text-xs">{r.rule_code}</TableCell>
                  <TableCell className="text-sm">{r.rule_name}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{r.group_type}</Badge></TableCell>
                  <TableCell><Badge variant={govTone as any} className="text-xs">{gs ?? '—'}</Badge></TableCell>
                  <TableCell className="text-xs">{r.parameter}</TableCell>
                  <TableCell className="text-xs">{r.operator}</TableCell>
                  <TableCell><Badge variant={r.default_fail_action === 'REJECT' ? 'destructive' : 'secondary'} className="text-xs">{r.default_fail_action}</Badge></TableCell>
                </TableRow>
              );})}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Only rules that have passed legal review (Legal Confirmed, Ready for Product Use, Active) are listed.
          Use the Rule Library to advance rules through governance.
        </p>
        <DialogFooter>
          <span className="mr-auto text-sm text-muted-foreground">{selected.size} selected</span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <BnBusyButton loading={busy} onClick={handleAdd} disabled={busy || selected.size === 0}>{busy ? 'Adding…' : 'Add Selected'}</BnBusyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
