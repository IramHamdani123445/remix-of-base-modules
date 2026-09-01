import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Edit } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUserCode } from '@/hooks/useUserCode';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { toast } from 'sonner';
import type { BnReasonCode } from '@/types/bn';
import { BnScreenRoleBanner } from '@/components/bn/shared';
import { CodeFieldWithAutoGenerate } from '@/components/bn/smart';
import { useBnConfigAudit } from '@/hooks/bn/useBnConfigAudit';
import { BNDataGrid, type BNColumnDef } from '@/components/bn/grid';
import { BnBusyButton } from '@/components/bn/shared';

const db = supabase as any;

const CATEGORIES = ['DENIAL', 'SUSPENSION', 'SEND_BACK', 'ESCALATION', 'OVERRIDE', 'DISCONTINUATION'];
const ACTIONS = ['SUBMIT', 'VERIFY', 'APPROVE', 'DENY', 'SUSPEND', 'SEND_BACK', 'ESCALATE', 'HOLD', 'RELEASE', 'REOPEN', 'DISCONTINUE', 'DISALLOW', 'WITHDRAW', 'CLOSE'];

export default function ReasonCodes() {
  const { userCode } = useUserCode();
  const audit = useBnConfigAudit();
  const qc = useQueryClient();
  const [editItem, setEditItem] = useState<BnReasonCode | null>(null);
  const [isNew, setIsNew] = useState(false);

  const [form, setForm] = useState({
    reason_code: '',
    reason_label: '',
    reason_category: 'DENIAL',
    applicable_actions: [] as string[],
    requires_narrative: false,
    is_active: true,
  });

  const { data: reasons = [], isLoading, refetch } = useQuery({
    queryKey: ['bn', 'reason-codes-admin'],
    queryFn: async () => {
      const { data, error } = await db.from('bn_reason_code').select('*').order('reason_category').order('reason_code');
      if (error) throw error;
      return data as BnReasonCode[];
    },
  });

  const otherCodes = reasons.filter(r => r.id !== editItem?.id).map(r => r.reason_code);

  const saveMutation = useMutation({
    mutationFn: async (item: any) => {
      if (isNew) {
        if (otherCodes.map(c => c.toUpperCase()).includes(item.reason_code?.trim().toUpperCase())) {
          throw new Error('Another reason code already uses this code.');
        }
        const { data, error } = await db.from('bn_reason_code').insert({ ...item, entered_by: userCode }).select().single();
        if (error) throw error;
        audit.log({ entityType: 'bn_reason_code', entityId: data?.id ?? 'new', action: 'CREATE', after: item });
        return data;
      } else {
        const before = editItem;
        const { data, error } = await db.from('bn_reason_code').update({ ...item, modified_by: userCode, modified_at: new Date().toISOString() }).eq('id', editItem!.id).select().single();
        if (error) throw error;
        audit.log({ entityType: 'bn_reason_code', entityId: editItem!.id, action: 'UPDATE', before, after: item });
        return data;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bn', 'reason-codes-admin'] });
      toast.success(isNew ? 'Reason code created' : 'Reason code updated');
      setEditItem(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const openNew = () => {
    setIsNew(true);
    setForm({ reason_code: '', reason_label: '', reason_category: 'DENIAL', applicable_actions: [], requires_narrative: false, is_active: true });
    setEditItem({} as any);
  };

  const openEdit = (item: BnReasonCode) => {
    setIsNew(false);
    setForm({
      reason_code: item.reason_code,
      reason_label: item.reason_label,
      reason_category: item.reason_category,
      applicable_actions: item.applicable_actions || [],
      requires_narrative: item.requires_narrative,
      is_active: item.is_active,
    });
    setEditItem(item);
  };

  const toggleAction = (action: string) => {
    setForm(prev => ({
      ...prev,
      applicable_actions: prev.applicable_actions.includes(action)
        ? prev.applicable_actions.filter(a => a !== action)
        : [...prev.applicable_actions, action],
    }));
  };

  return (
    <PermissionWrapper moduleName="benefits_management">
      <div className="space-y-6 p-6">
        <h1 className="t-page-title">Reason Codes</h1>

        <BnScreenRoleBanner
          role="library"
          productAssemblyHint
          description="Reusable reason master used by denial, suspension, waiver, overpayment, reopen, document rejection and medical review outcome actions."
        />

        <BNDataGrid
          id="bn.reason-codes"
          data={reasons}
          isLoading={isLoading}
          searchPlaceholder="Search reason codes..."
          onCreate={openNew}
          onRefresh={() => refetch()}
          defaultSort={[{ id: 'reason_code', desc: false }]}
          exportFilename="bn_reason_codes"
          emptyMessage="No reason codes found"
          columns={[
            { accessorKey: 'reason_code', header: 'Code', meta: { label: 'Code', pinLeft: true, width: 140 }, cell: ({ getValue }) => <span className="font-mono text-sm">{String(getValue() ?? '')}</span> },
            { accessorKey: 'reason_label', header: 'Label', meta: { label: 'Label', width: 260 } },
            { accessorKey: 'reason_category', header: 'Category', meta: { label: 'Category', width: 140 }, cell: ({ getValue }) => <Badge variant="outline">{String(getValue() ?? '')}</Badge> },
            { accessorKey: 'applicable_actions', header: 'Actions', meta: { label: 'Actions', width: 280 }, cell: ({ getValue }) => (
              <div className="flex flex-wrap gap-1">
                {((getValue() as string[]) || []).map(a => <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>)}
              </div>
            ) },
            { accessorKey: 'requires_narrative', header: 'Narrative', meta: { label: 'Narrative', width: 100 }, cell: ({ getValue }) => getValue() ? 'Yes' : 'No' },
            { accessorKey: 'is_active', header: 'Active', meta: { label: 'Active', width: 100 }, cell: ({ getValue }) => <Badge variant={getValue() ? 'default' : 'outline'}>{getValue() ? 'Active' : 'Inactive'}</Badge> },
          ] as BNColumnDef<BnReasonCode>[]}
          rowActions={[
            { key: 'edit', label: 'Edit', icon: <Edit className="h-3.5 w-3.5" />, onClick: openEdit },
          ]}
        />

        <Dialog open={!!editItem} onOpenChange={open => !open && setEditItem(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{isNew ? 'Add Reason Code' : 'Edit Reason Code'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <CodeFieldWithAutoGenerate
                label="Code"
                required
                prefix="RC"
                value={form.reason_code}
                onChange={(v) => setForm(p => ({ ...p, reason_code: v }))}
                existingCodes={otherCodes}
                disabled={!isNew}
                helpText="Unique reason code. Cannot be changed after creation."
              />
              <div className="space-y-1">
                <label className="text-sm font-medium">Label</label>
                <Input value={form.reason_label} onChange={e => setForm(p => ({ ...p, reason_label: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Category</label>
                <Select value={form.reason_category} onValueChange={v => setForm(p => ({ ...p, reason_category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Applicable Actions</label>
                <div className="flex flex-wrap gap-1">
                  {ACTIONS.map(a => (
                    <Badge
                      key={a}
                      variant={form.applicable_actions.includes(a) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => toggleAction(a)}
                    >
                      {a}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.requires_narrative} onCheckedChange={v => setForm(p => ({ ...p, requires_narrative: v }))} />
                <label className="text-sm">Requires Narrative</label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.is_active} onCheckedChange={v => setForm(p => ({ ...p, is_active: v }))} />
                <label className="text-sm">Active</label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
              <BnBusyButton loading={saveMutation.isPending} onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}>Save</BnBusyButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PermissionWrapper>
  );
}
