/**
 * Derived Fact Registry — list & basic editor for bn_derived_fact.
 * Seeded entries (SEED-) are read-only here; new entries default to DRAFT
 * status and require approval before being usable in Formula Library.
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

interface DerivedFact {
  id: string;
  code: string;
  display_name: string;
  data_type: string;
  unit: string | null;
  expression: string;
  source_fact_codes: string[];
  source_parameter_codes: string[];
  sample_value: number | null;
  effective_from: string;
  effective_to: string | null;
  status: string;
  description: string | null;
  seed_tag: string | null;
}

const empty = {
  code: '', display_name: '', data_type: 'number', unit: '', expression: '',
  source_fact_codes: '', source_parameter_codes: '', sample_value: '',
  description: '', effective_from: new Date().toISOString().slice(0, 10),
};

/**
 * The registry body, with no page chrome. Rendered both as the standalone
 * route below and as the "Derived Facts" tab on the Rule Catalogue screen,
 * so the two stay in step instead of drifting apart.
 */
export function DerivedFactsTab() {
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

  const { data: rows = [], isLoading } = useQuery<DerivedFact[]>({
    queryKey: ['bn', 'derived-facts'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('bn_derived_fact')
        .select('*')
        .order('code');
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
        expression: form.expression.trim(),
        source_fact_codes: form.source_fact_codes.split(',').map(s => s.trim()).filter(Boolean),
        source_parameter_codes: form.source_parameter_codes.split(',').map(s => s.trim()).filter(Boolean),
        sample_value: form.sample_value === '' ? null : Number(form.sample_value),
        description: form.description.trim() || null,
        effective_from: form.effective_from,
        status: 'DRAFT',
        created_by: userCode ?? 'SYSTEM',
      };
      const { error, data } = await (supabase as any).from('bn_derived_fact').insert(payload).select().single();
      if (error) throw error;
      await (supabase as any).from('bn_derived_fact_event').insert({
        derived_fact_id: data.id, event_type: 'CREATED', actor_user_code: userCode ?? 'SYSTEM', payload,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('Derived Fact created (DRAFT — requires approval)');
      qc.invalidateQueries({ queryKey: ['bn', 'derived-facts'] });
      qc.invalidateQueries({ queryKey: ['bn', 'variable-resolver'] });
      setOpen(false);
    },
    onError: (e: any) => toast.error('Save failed', { description: e?.message }),
  });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('bn_derived_fact').update({
        status: 'APPROVED', approved_by: userCode ?? 'SYSTEM', approved_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
      await (supabase as any).from('bn_derived_fact_event').insert({
        derived_fact_id: id, event_type: 'APPROVED', actor_user_code: userCode ?? 'SYSTEM',
      });
    },
    onSuccess: () => {
      toast.success('Derived Fact approved');
      qc.invalidateQueries({ queryKey: ['bn', 'derived-facts'] });
      qc.invalidateQueries({ queryKey: ['bn', 'variable-resolver'] });
    },
  });

  const columns: BNColumnDef<DerivedFact>[] = useMemo(() => [
    { accessorKey: 'code', header: 'Code', cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue())}</span> },
    { accessorKey: 'display_name', header: 'Name' },
    { accessorKey: 'data_type', header: 'Type', cell: ({ getValue }) => <Badge variant="outline">{String(getValue())}</Badge> },
    { accessorKey: 'expression', header: 'Expression', cell: ({ getValue }) => <span className="font-mono text-[11px] text-muted-foreground">{String(getValue() ?? '—')}</span> },
    { accessorKey: 'sample_value', header: 'Sample' },
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
    <div className="space-y-4">
        <BNDataGrid
          id="bn.derived-fact"
          columns={columns}
          data={rows}
          isLoading={isLoading}
          searchPlaceholder="Search derived facts…"
          onCreate={() => { setForm({ ...empty }); setOpen(true); }}
          emptyMessage="No derived facts yet."
        />

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>New Derived Fact</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Code *</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} className="font-mono" /></div>
                <div><Label>Display name *</Label><Input value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Data type</Label><Input value={form.data_type} onChange={e => setForm({ ...form, data_type: e.target.value })} /></div>
                <div><Label>Unit</Label><Input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} /></div>
                <div><Label>Sample value</Label><Input type="number" value={form.sample_value} onChange={e => setForm({ ...form, sample_value: e.target.value })} /></div>
              </div>
              <div><Label>Expression</Label><Textarea rows={2} value={form.expression} onChange={e => setForm({ ...form, expression: e.target.value })} className="font-mono text-sm" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Source fact codes (comma-sep)</Label><Input value={form.source_fact_codes} onChange={e => setForm({ ...form, source_fact_codes: e.target.value })} className="font-mono" /></div>
                <div><Label>Source parameter codes</Label><Input value={form.source_parameter_codes} onChange={e => setForm({ ...form, source_parameter_codes: e.target.value })} className="font-mono" /></div>
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
  );
}

/** Standalone route — /bn/config/derived-facts. */
export default function DerivedFactRegistry() {
  return (
    <PermissionWrapper moduleName="bn_configuration">
      <div className="space-y-6 p-6">
        <PageHeader
          title="Derived Fact Registry"
          subtitle="Computed facts (expression-based) usable by Formula Library"
          breadcrumbs={[
            { label: 'Benefit Management', href: '/bn/claims' },
            { label: 'Configuration' },
            { label: 'Derived Facts' },
          ]}
        />
        <DerivedFactsTab />
      </div>
    </PermissionWrapper>
  );
}
