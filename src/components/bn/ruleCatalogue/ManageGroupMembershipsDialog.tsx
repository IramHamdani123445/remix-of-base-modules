/**
 * Manage Group Memberships — multi-select dialog for adding a Rule Catalogue
 * rule into many Rule Groups (or removing it).
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useBnRuleGroups } from '@/hooks/bn/useBnConfig';
import {
  listGroupsForRule, addRulesToGroup, removeRuleFromGroup,
} from '@/services/bn/ruleGroupItemService';
import { getCurrentUserCode } from '@/services/bn/audit/getCurrentUserCode';
import { BnBusyButton } from '@/components/bn/shared';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ruleId: string;
  ruleCode: string;
}

export function ManageGroupMembershipsDialog({ open, onOpenChange, ruleId, ruleCode }: Props) {
  const qc = useQueryClient();
  const { data: groups = [] } = useBnRuleGroups();
  const { data: current = [], isLoading } = useQuery({
    queryKey: ['bn', 'rule-group-memberships', ruleId],
    queryFn: () => listGroupsForRule(ruleId),
    enabled: open && !!ruleId,
  });

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPicked(new Set(current.map(c => c.rule_group_id)));
  }, [current]);

  const toggle = (id: string) => {
    setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const save = async () => {
    const userCode = await getCurrentUserCode();
    if (!userCode) { toast.error('Authenticated user_code required'); return; }
    const currentSet = new Set(current.map(c => c.rule_group_id));
    const toAdd = [...picked].filter(g => !currentSet.has(g));
    const toRemove = [...currentSet].filter(g => !picked.has(g));
    setBusy(true);
    try {
      if (toAdd.length) {
        await addRulesToGroup(
          // single rule, multiple group additions — call per group
          '', [], userCode,
        ).catch(() => undefined);
        for (const groupId of toAdd) {
          await addRulesToGroup(groupId, [{ id: ruleId, rule_code: ruleCode }], userCode);
        }
      }
      for (const groupId of toRemove) {
        await removeRuleFromGroup(groupId, ruleId);
      }
      toast.success('Group memberships updated');
      qc.invalidateQueries({ queryKey: ['bn', 'rule-catalogue-group-usage'] });
      qc.invalidateQueries({ queryKey: ['bn', 'rule-group-memberships', ruleId] });
      qc.invalidateQueries({ queryKey: ['bn', 'rule-group-linked'] });
      onOpenChange(false);
    } catch (e: any) {
      toast.error('Update failed', { description: e?.message });
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Group Memberships — {ruleCode}</DialogTitle>
          <DialogDescription>A rule may belong to any number of Rule Groups.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className="text-xs text-muted-foreground py-4">Loading…</p>
        ) : (
          <div className="max-h-96 space-y-1 overflow-y-auto py-2">
            {(groups as any[]).filter(g => g.is_active).map(g => (
              <label key={g.id} className="flex items-center gap-3 rounded border px-2 py-1.5 text-sm cursor-pointer hover:bg-muted/40">
                <Checkbox checked={picked.has(g.id)} onCheckedChange={() => toggle(g.id)} />
                <span className="font-mono text-xs">{g.group_code}</span>
                <span className="flex-1 text-muted-foreground">{g.group_name}</span>
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <BnBusyButton loading={busy} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</BnBusyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
