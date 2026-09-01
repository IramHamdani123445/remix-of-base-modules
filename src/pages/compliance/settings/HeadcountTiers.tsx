import { useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Plus, Edit, Info, ShieldAlert } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useHasCapability } from '@/hooks/useHasCapability';
import { COMPLIANCE_CAPABILITIES } from '@/lib/compliance/capabilities';

interface Tier {
  id: string;
  tier_code: string;
  tier_label: string;
  min_employer_size: number;
  max_employer_size: number | null;
  allowed_absolute_change: number;
  percentage_threshold: number | null;
  is_enabled: boolean;
  requires_client_confirmation: boolean;
  sort_order: number;
  notes: string | null;
}

const empty = {
  tier_code: '', tier_label: '', min_employer_size: '0', max_employer_size: '',
  allowed_absolute_change: '1', percentage_threshold: '', is_enabled: true,
  requires_client_confirmation: true, sort_order: '0', notes: '',
};

export default function HeadcountTiers() {
  const canManage = useHasCapability(COMPLIANCE_CAPABILITIES.CONFIG_MANAGE);
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Tier | null>(null);
  const [form, setForm] = useState(empty);

  const { data: tiers = [], isLoading } = useQuery({
    queryKey: ['ce_headcount_tiers'],
    queryFn: async (): Promise<Tier[]> => {
      const { data, error } = await supabase.from('ce_headcount_tiers').select('*').order('sort_order', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as Tier[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        tier_code: form.tier_code,
        tier_label: form.tier_label,
        min_employer_size: Number(form.min_employer_size) || 0,
        max_employer_size: form.max_employer_size === '' ? null : Number(form.max_employer_size),
        allowed_absolute_change: Number(form.allowed_absolute_change) || 0,
        percentage_threshold: form.percentage_threshold === '' ? null : Number(form.percentage_threshold),
        is_enabled: form.is_enabled,
        requires_client_confirmation: form.requires_client_confirmation,
        sort_order: Number(form.sort_order) || 0,
        notes: form.notes || null,
      };
      if (editing) {
        const { error } = await supabase.from('ce_headcount_tiers').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('ce_headcount_tiers').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ce_headcount_tiers'] });
      toast.success(editing ? 'Tier updated' : 'Tier created');
      setDialogOpen(false);
    },
    onError: (e: any) => toast.error('Failed to save tier', { description: e.message }),
  });

  const toggleEnabled = useMutation({
    mutationFn: async ({ id, is_enabled }: { id: string; is_enabled: boolean }) => {
      const { error } = await supabase.from('ce_headcount_tiers').update({ is_enabled }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ce_headcount_tiers'] }); toast.success('Tier updated'); },
    onError: () => toast.error('Failed to update'),
  });

  const openAdd = () => { setEditing(null); setForm(empty); setDialogOpen(true); };
  const openEdit = (t: Tier) => {
    setEditing(t);
    setForm({
      tier_code: t.tier_code, tier_label: t.tier_label,
      min_employer_size: String(t.min_employer_size), max_employer_size: t.max_employer_size == null ? '' : String(t.max_employer_size),
      allowed_absolute_change: String(t.allowed_absolute_change), percentage_threshold: t.percentage_threshold == null ? '' : String(t.percentage_threshold),
      is_enabled: t.is_enabled, requires_client_confirmation: t.requires_client_confirmation,
      sort_order: String(t.sort_order), notes: t.notes || '',
    });
    setDialogOpen(true);
  };

  if (isLoading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Headcount Change Tiers (DR-009)"
        subtitle="Slab model for allowed employee headcount change by employer size band"
        breadcrumbs={[{ label: 'Compliance', href: '/compliance/dashboard' }, { label: 'Settings', href: '/compliance/admin/settings' }, { label: 'Headcount Tiers' }]}
        actions={canManage ? <Button className="gap-2" onClick={openAdd}><Plus className="h-4 w-4" />Add Tier</Button> : undefined}
      />

      <Card className="border-warning/40 bg-warning/5">
        <CardContent className="py-4 flex gap-3 items-start">
          <Info className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">The flat one-employee headcount trigger is retired.</p>
            <p>Headcount-change detection now uses this employer-size slab model instead. The values below are <span className="font-medium text-foreground">provisional</span> until formally fixed by the client — review before relying on them for production enforcement.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Tiers</CardTitle><CardDescription>Ordered by employer size band; edits apply immediately.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead><TableHead>Label</TableHead><TableHead>Size Band</TableHead>
                <TableHead>Allowed Change</TableHead><TableHead>% Threshold</TableHead><TableHead>Confirmation</TableHead>
                <TableHead>Enabled</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tiers.map(t => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{t.tier_code}</TableCell>
                  <TableCell>{t.tier_label}</TableCell>
                  <TableCell>{t.min_employer_size}–{t.max_employer_size ?? '∞'}</TableCell>
                  <TableCell>±{t.allowed_absolute_change}</TableCell>
                  <TableCell>{t.percentage_threshold != null ? `${t.percentage_threshold}%` : '—'}</TableCell>
                  <TableCell>
                    {t.requires_client_confirmation ? (
                      <Badge variant="destructive" className="gap-1"><ShieldAlert className="h-3 w-3" />Requires client confirmation</Badge>
                    ) : <Badge variant="outline">Not required</Badge>}
                  </TableCell>
                  <TableCell>
                    <Switch checked={t.is_enabled} disabled={!canManage} onCheckedChange={(v) => toggleEnabled.mutate({ id: t.id, is_enabled: v })} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" disabled={!canManage} onClick={() => openEdit(t)}><Edit className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
              {tiers.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No tiers configured yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Tier' : 'Add Tier'}</DialogTitle>
            <DialogDescription>Define the size band and permitted headcount change for this tier.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Tier Code</Label><Input value={form.tier_code} onChange={e => setForm({ ...form, tier_code: e.target.value })} /></div>
            <div><Label>Label</Label><Input value={form.tier_label} onChange={e => setForm({ ...form, tier_label: e.target.value })} /></div>
            <div><Label>Min Employer Size</Label><Input type="number" value={form.min_employer_size} onChange={e => setForm({ ...form, min_employer_size: e.target.value })} /></div>
            <div><Label>Max Employer Size</Label><Input type="number" placeholder="Open ended" value={form.max_employer_size} onChange={e => setForm({ ...form, max_employer_size: e.target.value })} /></div>
            <div><Label>Allowed Absolute Change</Label><Input type="number" value={form.allowed_absolute_change} onChange={e => setForm({ ...form, allowed_absolute_change: e.target.value })} /></div>
            <div><Label>Percentage Threshold (optional)</Label><Input type="number" value={form.percentage_threshold} onChange={e => setForm({ ...form, percentage_threshold: e.target.value })} /></div>
            <div><Label>Sort Order</Label><Input type="number" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: e.target.value })} /></div>
            <div className="flex items-center gap-2 pt-6"><Switch checked={form.requires_client_confirmation} onCheckedChange={v => setForm({ ...form, requires_client_confirmation: v })} /><Label>Requires client confirmation</Label></div>
            <div className="flex items-center gap-2"><Switch checked={form.is_enabled} onCheckedChange={v => setForm({ ...form, is_enabled: v })} /><Label>Enabled</Label></div>
            <div className="col-span-2"><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
