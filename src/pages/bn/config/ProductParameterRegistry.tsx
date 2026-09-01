/**
 * Product Parameter Registry — list & basic editor for bn_product_parameter.
 * New entries are DRAFT; need approval to be usable in Formula Library.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/PageHeader';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { BNDataGrid, type BNColumnDef } from '@/components/bn/grid';
import { useUserCode } from '@/hooks/useUserCode';
import { BnBusyButton } from '@/components/bn/shared';

interface ProductParam {
  id: string; code: string; display_name: string; data_type: string;
  unit: string | null; default_value: number | null; status: string;
  effective_from: string; effective_to: string | null; description: string | null;
  seed_tag: string | null;
}

const empty = {
  code: '', display_name: '', data_type: 'number', unit: '',
  default_value: '', description: '',
  effective_from: new Date().toISOString().slice(0, 10),
};

export default function ProductParameterRegistry() {
  const qc = useQueryClient();
  const { userCode } = useUserCode();
  const [search] = useSearchParams();
  const newCode = search.get('newCode') ?? '';
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...empty });

  useEffect(() => {
    if (newCode) {
      setForm({ ...empty, code: newCode, display_name: newCode.replace(/_/g, ' ') });
      setOpen(true);
    }
  }, [newCode]);

  const { data: rows = [], isLoading } = useQuery<ProductParam[]>({
    queryKey: ['bn', 'product-parameters'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('bn_product_parameter').select('*').order('code');
      if (error) throw error;
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const payload = {
        code: form.code.trim(),
        display_name: form.display_name.trim(),
        data_type: form.data_type,
        unit: form.unit.trim() || null,
        default_value: form.default_value === '' ? null : Number(form.default_value),
        description: form.description.trim() || null,
        effective_from: form.effective_from,
        status: 'DRAFT',
        created_by: userCode ?? 'SYSTEM',
      };
      const { error, data } = await (supabase as any).from('bn_product_parameter').insert(payload).select().single();
      if (error) throw error;
      await (supabase as any).from('bn_product_parameter_event').insert({
        parameter_id: data.id, event_type: 'CREATED', actor_user_code: userCode ?? 'SYSTEM', payload,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('Product Parameter created (DRAFT — requires approval)');
      qc.invalidateQueries({ queryKey: ['bn', 'product-parameters'] });
      qc.invalidateQueries({ queryKey: ['bn', 'variable-resolver'] });
      setOpen(false);
    },
    onError: (e: any) => toast.error('Save failed', { description: e?.message }),
  });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('bn_product_parameter').update({
        status: 'APPROVED', approved_by: userCode ?? 'SYSTEM', approved_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
      await (supabase as any).from('bn_product_parameter_event').insert({
        parameter_id: id, event_type: 'APPROVED', actor_user_code: userCode ?? 'SYSTEM',
      });
    },
    onSuccess: () => {
      toast.success('Parameter approved');
      qc.invalidateQueries({ queryKey: ['bn', 'product-parameters'] });
      qc.invalidateQueries({ queryKey: ['bn', 'variable-resolver'] });
    },
  });

  const columns: BNColumnDef<ProductParam>[] = useMemo(() => [
    { accessorKey: 'code', header: 'Code', cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue())}</span> },
    { accessorKey: 'display_name', header: 'Name' },
    { accessorKey: 'data_type', header: 'Type', cell: ({ getValue }) => <Badge variant="outline">{String(getValue())}</Badge> },
    { accessorKey: 'unit', header: 'Unit' },
    { accessorKey: 'default_value', header: 'Default' },
    { accessorKey: 'effective_from', header: 'Effective' },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => {
      const s = String(getValue());
      return <Badge variant={s === 'APPROVED' ? 'default' : 'secondary'}>{s}</Badge>;
    } },
    { accessorKey: 'seed_tag', header: 'Seed', cell: ({ getValue }) => getValue() ? <Badge variant="outline">SEED</Badge> : null },
    { id: 'actions', header: '', cell: ({ row }) => row.original.status !== 'APPROVED'
      ? <Button size="sm" variant="outline" onClick={() => approve.mutate(row.original.id)}>Approve</Button>
      : null },
  ], [approve]);

  return (
    <PermissionWrapper moduleName="bn_configuration">
      <div className="space-y-6 p-6">
        <PageHeader
          title="Product Parameter Registry"
          subtitle="Statutory rates, caps and amounts referenced by formulas"
          breadcrumbs={[
            { label: 'Benefit Management', href: '/bn/claims' },
            { label: 'Configuration' },
            { label: 'Product Parameters' },
          ]}
        />
        <BNDataGrid
          id="bn.product-parameter"
          columns={columns}
          data={rows}
          isLoading={isLoading}
          searchPlaceholder="Search parameters…"
          onCreate={() => { setForm({ ...empty }); setOpen(true); }}
          emptyMessage="No product parameters yet."
        />

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>New Product Parameter</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Code *</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} className="font-mono" /></div>
                <div><Label>Display name *</Label><Input value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Data type</Label><Input value={form.data_type} onChange={e => setForm({ ...form, data_type: e.target.value })} /></div>
                <div><Label>Unit</Label><Input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} /></div>
                <div><Label>Default value</Label><Input type="number" value={form.default_value} onChange={e => setForm({ ...form, default_value: e.target.value })} /></div>
              </div>
              <div><Label>Description</Label><Textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
              <div><Label>Effective from</Label><Input type="date" value={form.effective_from} onChange={e => setForm({ ...form, effective_from: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <BnBusyButton loading={create.isPending} onClick={() => create.mutate()} disabled={!form.code.trim() || !form.display_name.trim() || create.isPending}>>
                {create.isPending ? 'Saving…' : 'Save as DRAFT'}
              </BnBusyButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </PermissionWrapper>
  );
}
