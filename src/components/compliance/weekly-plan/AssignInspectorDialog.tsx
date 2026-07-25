import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { WeeklyPlan } from '@/types/weeklyPlan';

interface Props {
  plan: WeeklyPlan | null;
  onClose: () => void;
}

interface InspectorOption {
  id: string;
  code: string;
  name: string;
}

export function AssignInspectorDialog({ plan, onClose }: Props) {
  const qc = useQueryClient();
  const open = !!plan;
  const [selected, setSelected] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const { data: inspectors = [], isLoading } = useQuery({
    queryKey: ['ce-active-inspectors-for-assign'],
    enabled: open,
    queryFn: async (): Promise<InspectorOption[]> => {
      const { data: inspData, error } = await supabase
        .from('ce_inspectors')
        .select('id, inspector_code, legacy_inspector_code, profile_id, is_active, status')
        .eq('is_active', true);
      if (error) throw error;
      const profileIds = (inspData ?? [])
        .map((i: any) => i.profile_id)
        .filter(Boolean) as string[];
      const nameMap: Record<string, string> = {};
      if (profileIds.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', profileIds);
        for (const p of profs ?? []) nameMap[(p as any).id] = (p as any).full_name;
      }
      return (inspData ?? []).map((i: any) => {
        const code = i.inspector_code ?? i.legacy_inspector_code ?? i.id;
        const name = i.profile_id ? nameMap[i.profile_id] : null;
        return {
          id: i.id,
          code,
          name: name || code,
        };
      });
    },
  });

  useEffect(() => {
    if (open) setSelected('');
  }, [open, plan?.id]);

  const currentLabel = useMemo(() => {
    if (!plan) return '';
    return plan.inspector_name || plan.inspector_id || 'Unassigned';
  }, [plan]);

  const handleSave = async () => {
    if (!plan || !selected) return;
    const picked = inspectors.find(i => i.id === selected);
    if (!picked) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('ce_weekly_plans')
        .update({
          inspector_id: picked.code,
          inspector_name: picked.name,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', plan.id);
      if (error) throw error;

      // Cascade to items so the plan's items follow the new officer.
      await supabase
        .from('ce_weekly_plan_items')
        .update({
          inspector_id: picked.code,
          inspector_name: picked.name,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('plan_id', plan.id);

      toast.success(`Plan ${plan.plan_number} assigned to ${picked.name}`);
      qc.invalidateQueries({ queryKey: ['my-weekly-plans'] });
      qc.invalidateQueries({ queryKey: ['weekly-plans'] });
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to assign inspector');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign / Reassign Inspection</DialogTitle>
          <DialogDescription>
            Reassign {plan?.plan_number} to a different inspector. The plan and all its items
            will move to the selected officer's work queue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
            <div className="text-muted-foreground text-xs">Currently assigned to</div>
            <div className="font-medium">{currentLabel}</div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Assign to Officer</Label>
            <Select value={selected} onValueChange={setSelected} disabled={isLoading}>
              <SelectTrigger>
                <SelectValue placeholder={isLoading ? 'Loading inspectors…' : 'Select an inspector'} />
              </SelectTrigger>
              <SelectContent>
                {inspectors.map(i => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name} <span className="text-muted-foreground">({i.code})</span>
                  </SelectItem>
                ))}
                {!isLoading && inspectors.length === 0 && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No active inspectors found
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={!selected || saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <UserPlus className="h-4 w-4 mr-1" />}
            Assign Inspector
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
