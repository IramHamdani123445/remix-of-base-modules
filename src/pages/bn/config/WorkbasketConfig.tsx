import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Edit, X } from 'lucide-react';
import { BNDataGrid, type BNColumnDef } from '@/components/bn/grid';
import { useBnWorkbaskets, useCreateBnWorkbasket, useUpdateBnWorkbasket } from '@/hooks/bn/useBnWorkbasket';
import { useUserCode } from '@/hooks/useUserCode';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { toast } from 'sonner';
import type { BnWorkbasket } from '@/types/bn';
import { BnScreenRoleBanner } from '@/components/bn/shared';
import { SmartSelect, CodeFieldWithAutoGenerate } from '@/components/bn/smart';
import { BN_PRODUCT_CATEGORIES } from '@/services/bn/registries';
import { useWorkflowRoles } from '@/hooks/bn/useWorkflowRoles';
import { useBnConfigAudit } from '@/hooks/bn/useBnConfigAudit';
import {
  fetchRolesForWorkbasket,
  setWorkbasketRoles,
  fetchRolesForWorkbaskets,
} from '@/services/bn/workbasketRoleService';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { QueueAccessHealthPanel } from '@/components/bn/config/QueueAccessHealthPanel';


function useEscalationPolicyOptions() {
  return useQuery({
    queryKey: ['bn', 'escalation-policies', 'options'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('bn_escalation_policy')
        .select('id, policy_code, policy_name, is_active')
        .eq('is_active', true)
        .order('policy_name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function WorkbasketConfig() {
  const { userCode } = useUserCode();
  const { data: workbaskets = [] } = useBnWorkbaskets();
  const { roles: workflowRoles } = useWorkflowRoles();
  const { data: escalationPolicies = [] } = useEscalationPolicyOptions();
  const createMut = useCreateBnWorkbasket();
  const updateMut = useUpdateBnWorkbasket();
  const { log } = useBnConfigAudit();
  const qc = useQueryClient();

  const [editItem, setEditItem] = useState<BnWorkbasket | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState({
    basket_code: '',
    basket_name: '',
    description: '',
    primary_role: '',
    additional_roles: [] as string[],
    product_category: '',
    country_code: '',
    max_capacity: '',
    is_active: true,
    default_escalation_policy_id: '',
    supervisor_role: '',
    manager_role: '',
    allow_auto_reassign: true,
    escalation_target_basket_id: '',
  });

  // All role mappings for the table view
  const wbIds = workbaskets.map((w) => w.id);
  const { data: rolesByBasket = {} } = useQuery({
    queryKey: ['bn-workbasket-roles', wbIds.join(',')],
    enabled: wbIds.length > 0,
    queryFn: () => fetchRolesForWorkbaskets(wbIds),
  });

  // When editing an existing basket, pull its full role set
  useEffect(() => {
    if (!editItem || isNew || !editItem.id) return;
    let cancelled = false;
    fetchRolesForWorkbasket(editItem.id).then((rows) => {
      if (cancelled) return;
      const primary = rows.find((r) => r.is_primary)?.role_name || editItem.assigned_role;
      const additional = rows
        .filter((r) => !r.is_primary)
        .map((r) => r.role_name);
      setForm((p) => ({ ...p, primary_role: primary, additional_roles: additional }));
    });
    return () => {
      cancelled = true;
    };
  }, [editItem, isNew]);

  const openNew = () => {
    setIsNew(true);
    setForm({
      basket_code: '',
      basket_name: '',
      description: '',
      primary_role: '',
      additional_roles: [],
      product_category: '',
      country_code: '',
      max_capacity: '',
      is_active: true,
      default_escalation_policy_id: '',
      supervisor_role: '',
      manager_role: '',
      allow_auto_reassign: true,
      escalation_target_basket_id: '',
    });
    setEditItem({} as any);
  };

  const openEdit = (item: BnWorkbasket) => {
    setIsNew(false);
    setForm({
      basket_code: item.basket_code,
      basket_name: item.basket_name,
      description: item.description || '',
      primary_role: item.assigned_role,
      additional_roles: [],
      product_category: item.product_category || '',
      country_code: item.country_code || '',
      max_capacity: item.max_capacity?.toString() || '',
      is_active: item.is_active,
      default_escalation_policy_id: item.default_escalation_policy_id || '',
      supervisor_role: item.supervisor_role || '',
      manager_role: item.manager_role || '',
      allow_auto_reassign: item.allow_auto_reassign ?? true,
      escalation_target_basket_id: item.escalation_target_basket_id || '',
    });
    setEditItem(item);
  };

  const handleSave = async () => {
    if (!form.basket_code.trim() || !form.basket_name.trim()) {
      toast.error('Code and Name are required');
      return;
    }
    if (!form.primary_role) {
      toast.error('Primary Role is required');
      return;
    }
    const allRoles = [form.primary_role, ...form.additional_roles.filter((r) => r !== form.primary_role)];
    const payload: any = {
      basket_code: form.basket_code,
      basket_name: form.basket_name,
      description: form.description || null,
      assigned_role: form.primary_role,
      product_category: form.product_category || null,
      country_code: form.country_code || null,
      max_capacity: form.max_capacity ? parseInt(form.max_capacity) : null,
      is_active: form.is_active,
      default_escalation_policy_id: form.default_escalation_policy_id || null,
      supervisor_role: form.supervisor_role || null,
      manager_role: form.manager_role || null,
      allow_auto_reassign: form.allow_auto_reassign,
      escalation_target_basket_id: form.escalation_target_basket_id || null,
    };


    try {
      let id: string;
      if (isNew) {
        payload.entered_by = userCode;
        const res: any = await createMut.mutateAsync(payload);
        id = res?.id;
        log({ entityType: 'bn_workbasket', entityId: id ?? form.basket_code, action: 'CREATE', after: payload });
        toast.success('Workbasket created');
      } else {
        payload.modified_by = userCode;
        await updateMut.mutateAsync({ id: editItem!.id, updates: payload });
        id = editItem!.id;
        log({ entityType: 'bn_workbasket', entityId: id, action: 'UPDATE', before: editItem as any, after: payload });
        toast.success('Workbasket updated');
      }
      if (id) {
        await setWorkbasketRoles(id, allRoles, userCode || undefined);
        qc.invalidateQueries({ queryKey: ['bn-workbasket-roles'] });
      }
      setEditItem(null);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const toggleAdditional = (role: string) => {
    setForm((p) => {
      const has = p.additional_roles.includes(role);
      return {
        ...p,
        additional_roles: has
          ? p.additional_roles.filter((r) => r !== role)
          : [...p.additional_roles, role],
      };
    });
  };

  return (
    <PermissionWrapper moduleName="benefits_management">
      <div className="space-y-6 p-6">
        <div>
          <h1 className="t-page-title">Workbaskets</h1>
        </div>

        <BnScreenRoleBanner
          role="library"
          productAssemblyHint
          description="Reusable operational queues. A workbasket can be served by one primary role plus any number of additional roles, so small offices can let one user cover several stages."
        />

        <QueueAccessHealthPanel />



        <BNDataGrid
          id="bn.workbaskets"
          columns={[
            { accessorKey: 'basket_code', header: 'Code', meta: { label: 'Code', pinLeft: true, width: 140 }, cell: ({ getValue }) => <span className="font-mono text-sm">{String(getValue() ?? '')}</span> },
            { accessorKey: 'basket_name', header: 'Name', meta: { label: 'Name', width: 240 } },
            {
              id: 'roles', header: 'Roles', meta: { label: 'Roles', width: 280, exportValue: (b: any) => (rolesByBasket[b.id] || [b.assigned_role]).join(', ') },
              cell: ({ row }) => {
                const b = row.original as BnWorkbasket;
                const roles = rolesByBasket[b.id] || [b.assigned_role];
                return (
                  <div className="flex flex-wrap gap-1">
                    {roles.map((r) => (
                      <Badge key={r} variant={r === b.assigned_role ? 'default' : 'secondary'}>
                        {r}{r === b.assigned_role && roles.length > 1 ? ' ★' : ''}
                      </Badge>
                    ))}
                  </div>
                );
              },
            },
            { accessorKey: 'product_category', header: 'Category', meta: { label: 'Category', width: 140 }, cell: ({ getValue }) => String(getValue() || '—') },
            { accessorKey: 'max_capacity', header: 'Capacity', meta: { label: 'Capacity', width: 100 }, cell: ({ getValue }) => String(getValue() ?? '—') },
            { accessorKey: 'is_active', header: 'Active', meta: { label: 'Active', width: 100 }, cell: ({ getValue }) => <Badge variant={getValue() ? 'default' : 'outline'}>{getValue() ? 'Active' : 'Inactive'}</Badge> },
          ] as BNColumnDef<BnWorkbasket>[]}
          data={workbaskets as BnWorkbasket[]}
          searchPlaceholder="Search workbaskets..."
          defaultSort={[{ id: 'basket_code', desc: false }]}
          onCreate={openNew}
          onRowClick={(b) => openEdit(b)}
          rowActions={[
            { key: 'edit', label: 'Edit', icon: <Edit className="h-3.5 w-3.5" />, onClick: (b) => openEdit(b) },
          ]}
          exportFilename="bn_workbaskets"
          emptyMessage="No workbaskets configured"
        />


        <Dialog open={!!editItem} onOpenChange={(open) => !open && setEditItem(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{isNew ? 'Add Workbasket' : 'Edit Workbasket'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              {isNew ? (
                <CodeFieldWithAutoGenerate
                  label="Code"
                  value={form.basket_code}
                  onChange={(v) => setForm((p) => ({ ...p, basket_code: v }))}
                  existingCodes={workbaskets.map((w) => w.basket_code)}
                  prefix="WB"
                  required
                />
              ) : (
                <div className="space-y-1"><label className="text-sm font-medium">Code</label><Input value={form.basket_code} disabled /></div>
              )}
              <div className="space-y-1"><label className="text-sm font-medium">Name</label><Input value={form.basket_name} onChange={(e) => setForm((p) => ({ ...p, basket_name: e.target.value }))} /></div>
              <div className="space-y-1"><label className="text-sm font-medium">Description</label><Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} rows={2} /></div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Primary Role <span className="text-destructive">*</span></label>
                <SmartSelect
                  value={form.primary_role}
                  onValueChange={(v) => setForm((p) => ({
                    ...p,
                    primary_role: v,
                    additional_roles: p.additional_roles.filter((r) => r !== v),
                  }))}
                  options={workflowRoles.map((r) => ({ value: r, label: r.replace(/_/g, ' ') }))}
                  placeholder="Select primary role"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Additional Roles</label>
                <p className="text-xs text-muted-foreground">
                  Users holding any of these roles will see this workbasket. Useful for small offices.
                </p>
                <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto border rounded p-2">
                  {workflowRoles
                    .filter((r) => r !== form.primary_role)
                    .map((r) => (
                      <label key={r} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-accent/40 px-1 py-0.5 rounded">
                        <Checkbox
                          checked={form.additional_roles.includes(r)}
                          onCheckedChange={() => toggleAdditional(r)}
                        />
                        <span>{r}</span>
                      </label>
                    ))}
                </div>
                {form.additional_roles.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {form.additional_roles.map((r) => (
                      <Badge key={r} variant="secondary" className="gap-1">
                        {r}
                        <button onClick={() => toggleAdditional(r)} className="hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Product Category</label>
                  <SmartSelect
                    value={form.product_category}
                    onValueChange={(v) => setForm((p) => ({ ...p, product_category: v }))}
                    options={[{ value: '', label: '— Any —' }, ...BN_PRODUCT_CATEGORIES]}
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-1"><label className="text-sm font-medium">Max Capacity</label><Input type="number" value={form.max_capacity} onChange={(e) => setForm((p) => ({ ...p, max_capacity: e.target.value }))} placeholder="Optional" /></div>
              </div>

              <div className="rounded-md border p-3 space-y-3">
                <div className="text-sm font-semibold">SLA / Escalation</div>
                <p className="text-xs text-muted-foreground">
                  Default escalation policy applied to all tasks in this basket. Workflow-step level policy (if any) overrides this default.
                </p>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Default Escalation Policy</label>
                  <SmartSelect
                    value={form.default_escalation_policy_id}
                    onValueChange={(v) => setForm((p) => ({ ...p, default_escalation_policy_id: v }))}
                    options={[
                      { value: '', label: '— None (fall through to product/global) —' },
                      ...escalationPolicies.map((e: any) => ({ value: e.id, label: `${e.policy_name} (${e.policy_code})` })),
                    ]}
                    placeholder="Select policy"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Supervisor Role</label>
                    <SmartSelect
                      value={form.supervisor_role}
                      onValueChange={(v) => setForm((p) => ({ ...p, supervisor_role: v }))}
                      options={[{ value: '', label: '— None —' }, ...workflowRoles.map((r) => ({ value: r, label: r.replace(/_/g, ' ') }))]}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Manager Role</label>
                    <SmartSelect
                      value={form.manager_role}
                      onValueChange={(v) => setForm((p) => ({ ...p, manager_role: v }))}
                      options={[{ value: '', label: '— None —' }, ...workflowRoles.map((r) => ({ value: r, label: r.replace(/_/g, ' ') }))]}
                      placeholder="Optional"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Escalation Target Workbasket</label>
                  <SmartSelect
                    value={form.escalation_target_basket_id}
                    onValueChange={(v) => setForm((p) => ({ ...p, escalation_target_basket_id: v }))}
                    options={[
                      { value: '', label: '— None —' },
                      ...workbaskets
                        .filter((b) => b.id !== editItem?.id)
                        .map((b) => ({ value: b.id, label: `${b.basket_name} (${b.basket_code})` })),
                    ]}
                    placeholder="Where to auto-reassign on escalation"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.allow_auto_reassign}
                    onCheckedChange={(v) => setForm((p) => ({ ...p, allow_auto_reassign: v }))}
                  />
                  <label className="text-sm">Allow Auto-Reassign on Escalation</label>
                </div>
              </div>

              <div className="flex items-center gap-2"><Switch checked={form.is_active} onCheckedChange={(v) => setForm((p) => ({ ...p, is_active: v }))} /><label className="text-sm">Active</label></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
              <Button onClick={handleSave}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PermissionWrapper>
  );
}

