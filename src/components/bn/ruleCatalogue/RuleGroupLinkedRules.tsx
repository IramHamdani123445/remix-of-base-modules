/**
 * Linked Rules — shown inside the existing Rule Group edit dialog.
 * Lists Rule Catalogue rules linked via `bn_rule_group_item`, allows
 * reorder/unlink and adding new rules, and surfaces per-rule and aggregate
 * group readiness.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowUp, ArrowDown, Unlink2, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEligibilityFacts } from '@/hooks/bn/useEligibilityFacts';
import {
  listGroupItems, addRulesToGroup, removeFromGroup, reorderGroupItems,
  type LinkedCatalogueRule,
} from '@/services/bn/ruleGroupItemService';
import { useRuleCatalogue } from '@/hooks/bn/useRuleCatalogue';
import { getCurrentUserCode } from '@/services/bn/audit/getCurrentUserCode';
import { BnBusyButton } from '@/components/bn/shared';

interface Props { groupId: string; groupCode: string; }

export function RuleGroupLinkedRules({ groupId, groupCode }: Props) {
  const qc = useQueryClient();
  const { data: facts = [] } = useEligibilityFacts();
  const factByKey = useMemo(() => {
    const m = new Map<string, any>();
    for (const f of facts) m.set(f.fact_key, f);
    return m;
  }, [facts]);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['bn', 'rule-group-linked', groupId],
    queryFn: () => listGroupItems(groupId),
    enabled: !!groupId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bn', 'rule-group-linked', groupId] });
    qc.invalidateQueries({ queryKey: ['bn', 'rule-catalogue-group-usage'] });
  };

  const reorderMut = useMutation({
    mutationFn: (rows: { id: string; sort_order: number }[]) => reorderGroupItems(groupId, rows),
    onSuccess: () => { invalidate(); toast.success('Order updated'); },
    onError: (e: any) => toast.error('Reorder failed', { description: e?.message }),
  });

  const unlinkMut = useMutation({
    mutationFn: (itemId: string) => removeFromGroup(itemId),
    onSuccess: () => { invalidate(); toast.success('Rule removed from group'); },
    onError: (e: any) => toast.error('Remove failed', { description: e?.message }),
  });

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= rules.length) return;
    const a = rules[idx]; const b = rules[j];
    reorderMut.mutate([
      { id: a.id, sort_order: j },
      { id: b.id, sort_order: idx },
    ]);
  };

  const readiness = (r: LinkedCatalogueRule): { label: string; variant: 'default' | 'secondary' | 'destructive' } => {
    if (!r.fact_key) return { label: 'BLOCKED', variant: 'destructive' };
    const f = factByKey.get(r.fact_key);
    if (!f) return { label: 'BLOCKED', variant: 'destructive' };
    if (f.implementation_status === 'NOT_IMPLEMENTED') return { label: 'BLOCKED', variant: 'destructive' };
    if (f.implementation_status === 'PARTIAL') return { label: 'WARNING', variant: 'secondary' };
    return { label: 'READY', variant: 'default' };
  };

  const groupStatus = useMemo(() => {
    const active = rules.filter(r => r.is_active !== false);
    if (!active.length) return { label: 'EMPTY', variant: 'secondary' as const };
    let warn = false;
    for (const r of active) {
      const s = readiness(r).label;
      if (s === 'BLOCKED') return { label: 'BLOCKED', variant: 'destructive' as const };
      if (s === 'WARNING') warn = true;
    }
    return warn ? { label: 'WARNING', variant: 'secondary' as const } : { label: 'READY', variant: 'default' as const };
  }, [rules, factByKey]);

  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Linked Catalogue Rules</div>
          <p className="text-xs text-muted-foreground">Rules linked to group <span className="font-mono">{groupCode}</span> via many-to-many membership.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={groupStatus.variant}>Group: {groupStatus.label}</Badge>
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} className="gap-1"><Plus className="h-3 w-3" /> Add Rules</Button>
        </div>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground py-2">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No catalogue rules linked yet. Click "Add Rules" to pick from the catalogue.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Order</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Fact</TableHead>
              <TableHead>Op</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Readiness</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((r, i) => {
              const rd = readiness(r);
              return (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="h-3 w-3" /></Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => move(i, 1)} disabled={i === rules.length - 1}><ArrowDown className="h-3 w-3" /></Button>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.rule_code}</TableCell>
                  <TableCell className="text-xs">{r.rule_name}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[9px]">{r.category ?? r.group_type}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{r.fact_key ?? '—'}</TableCell>
                  <TableCell className="text-xs">{r.operator}</TableCell>
                  <TableCell>{r.is_active ? <Badge>Yes</Badge> : <Badge variant="secondary">No</Badge>}</TableCell>
                  <TableCell><Badge variant={rd.variant}>{rd.label}</Badge></TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" className="h-6 w-6" title="Remove from group" onClick={() => unlinkMut.mutate(r.id)}>
                      <Unlink2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <AddRulesToGroupDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        groupId={groupId}
        existingRuleIds={new Set(rules.map(r => r.catalogue_rule_id))}
        onDone={invalidate}
      />
    </div>
  );
}

function AddRulesToGroupDialog({
  open, onOpenChange, groupId, existingRuleIds, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groupId: string;
  existingRuleIds: Set<string>;
  onDone: () => void;
}) {
  const { data: catalogue = [] } = useRuleCatalogue();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return catalogue.filter(r => !existingRuleIds.has(r.id) && r.is_active && (
      !s || r.rule_code.toLowerCase().includes(s) || r.rule_name.toLowerCase().includes(s)
        || (r.fact_key ?? '').toLowerCase().includes(s)
        || (r.category ?? r.group_type ?? '').toLowerCase().includes(s)
    ));
  }, [catalogue, search, existingRuleIds]);

  const toggle = (id: string) => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const save = async () => {
    if (!picked.size) { onOpenChange(false); return; }
    const userCode = await getCurrentUserCode();
    if (!userCode) { toast.error('Authenticated user_code required'); return; }
    setBusy(true);
    try {
      const rules = catalogue.filter(r => picked.has(r.id)).map(r => ({ id: r.id, rule_code: r.rule_code }));
      await addRulesToGroup(groupId, rules, userCode);
      toast.success(`Added ${rules.length} rule(s) to group`);
      setPicked(new Set());
      onDone();
      onOpenChange(false);
    } catch (e: any) {
      toast.error('Add failed', { description: e?.message });
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Catalogue Rules to Group</DialogTitle>
          <DialogDescription>A rule can belong to many groups. Already-linked rules are hidden.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search code, name, category, fact" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="max-h-96 overflow-y-auto space-y-1 mt-2">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No rules available.</p>
          ) : filtered.map(r => (
            <label key={r.id} className="flex items-center gap-3 rounded border px-2 py-1.5 text-xs cursor-pointer hover:bg-muted/40">
              <Checkbox checked={picked.has(r.id)} onCheckedChange={() => toggle(r.id)} />
              <Badge variant="outline" className="text-[9px]">{r.category ?? r.group_type}</Badge>
              <span className="font-mono">{r.rule_code}</span>
              <span className="flex-1 text-muted-foreground">{r.rule_name}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{r.fact_key ?? '—'}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <BnBusyButton loading={busy} onClick={save} disabled={busy || !picked.size}>{busy ? 'Adding…' : `Add ${picked.size}`}</BnBusyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
