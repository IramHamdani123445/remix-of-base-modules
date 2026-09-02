import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Trash2, Save, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useBnWorkflowTemplates } from '@/hooks/bn/useBnConfig';
import { BnBusyButton } from '@/components/bn/shared';

interface Row {
  id?: string;
  channel_code: string;
  workflow_template_id: string;
  is_default: boolean;
  is_active: boolean;
  effective_from: string | null;
  effective_to: string | null;
}

function useChannels() {
  return useQuery({
    queryKey: ['bn', 'ref', 'BN_APPLICATION_CHANNEL'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('core_reference_value')
        .select('value_code, value_label, sort_order, group:core_reference_group!inner(group_code)')
        .eq('group.group_code', 'BN_APPLICATION_CHANNEL')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as Array<{ value_code: string; value_label: string }>;
    },
  });
}

function useMappings(productVersionId: string | undefined) {
  return useQuery({
    enabled: !!productVersionId,
    queryKey: ['bn', 'pvw', productVersionId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('bn_product_version_workflow')
        .select('id, channel_code, workflow_template_id, is_default, is_active, effective_from, effective_to')
        .eq('product_version_id', productVersionId);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
}

interface Props {
  productVersionId: string | undefined;
  isReadOnly?: boolean;
}

export function ProductWorkflowChannelGrid({ productVersionId, isReadOnly }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: channels = [] } = useChannels();
  const { data: templates = [] } = useBnWorkflowTemplates();
  const { data: existing = [], isLoading } = useMappings(productVersionId);
  const [draft, setDraft] = useState<Row[] | null>(null);

  const rows = draft ?? existing;
  const dirty = draft !== null;

  const update = (i: number, patch: Partial<Row>) => {
    setDraft((rows ?? []).map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const remove = (i: number) => setDraft((rows ?? []).filter((_, idx) => idx !== i));
  const add = () => {
    const used = new Set((rows ?? []).map(r => r.channel_code));
    const firstChannel = channels.find(c => !used.has(c.value_code))?.value_code
      ?? channels[0]?.value_code ?? '';
    setDraft([
      ...(rows ?? []),
      {
        channel_code: firstChannel,
        workflow_template_id: '',
        is_default: (rows ?? []).length === 0,
        is_active: true,
        effective_from: null,
        effective_to: null,
      },
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!productVersionId) throw new Error('No product version');
      const incoming = (rows ?? []).filter(r => r.channel_code && r.workflow_template_id);

      // Replace strategy: delete rows missing from incoming, upsert the rest.
      const existingIds = new Set(existing.map(r => r.id).filter(Boolean));
      const incomingIds = new Set(incoming.map(r => r.id).filter(Boolean));
      const toDelete = [...existingIds].filter(id => !incomingIds.has(id));
      if (toDelete.length) {
        const { error } = await (supabase as any)
          .from('bn_product_version_workflow')
          .delete()
          .in('id', toDelete);
        if (error) throw error;
      }

      for (const row of incoming) {
        const payload = { ...row, product_version_id: productVersionId };
        const { error } = row.id
          ? await (supabase as any).from('bn_product_version_workflow').update(payload).eq('id', row.id)
          : await (supabase as any).from('bn_product_version_workflow').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: 'Saved', description: 'Channel workflow mapping updated.' });
      setDraft(null);
      qc.invalidateQueries({ queryKey: ['bn', 'pvw', productVersionId] });
    },
    onError: (err: any) => {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    },
  });

  const validation = useMemo(() => {
    const issues: string[] = [];
    const active = (rows ?? []).filter(r => r.is_active && r.workflow_template_id);
    if (active.length && !active.some(r => r.is_default)) {
      issues.push('No default workflow selected for this product version.');
    }
    if (active.filter(r => r.is_default).length > 1) {
      issues.push('Only one active mapping can be marked as default.');
    }
    const seen = new Map<string, number>();
    active.forEach(r => seen.set(r.channel_code, (seen.get(r.channel_code) ?? 0) + 1));
    [...seen.entries()].filter(([, n]) => n > 1).forEach(([ch]) =>
      issues.push(`Channel ${ch} has more than one active mapping.`),
    );
    return issues;
  }, [rows]);

  if (!productVersionId) return null;

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-base">Channel Workflow Mapping</CardTitle>
          <CardDescription>
            Map each application channel to a Benefits workflow template. At intake the runtime picks the
            channel-specific mapping first, then the default, then the legacy product-level workflow.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={add} disabled={isReadOnly}>
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
          <BnBusyButton loading={saveMutation.isPending} size="sm" onClick={() => saveMutation.mutate()} disabled={!dirty || isReadOnly || saveMutation.isPending || validation.length > 0}>
            <Save className="h-4 w-4 mr-1" /> Save
          </BnBusyButton>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {validation.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <ul className="list-disc list-inside space-y-0.5">
              {validation.map(v => <li key={v}>{v}</li>)}
            </ul>
          </div>
        )}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[160px]">Channel</TableHead>
                <TableHead className="min-w-[240px]">Workflow Template</TableHead>
                <TableHead>Default</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Effective From</TableHead>
                <TableHead>Effective To</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={7} className="text-xs text-muted-foreground">Loading…</TableCell></TableRow>}
              {!isLoading && (rows ?? []).length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-xs text-muted-foreground">No mappings yet. Add one per channel.</TableCell></TableRow>
              )}
              {(rows ?? []).map((r, i) => {
                const tpl = templates.find((t: any) => t.id === r.workflow_template_id) as any;
                const executable = !!tpl?.workflow_definition_id;
                return (
                  <TableRow key={r.id ?? `new-${i}`}>
                    <TableCell>
                      <Select disabled={isReadOnly} value={r.channel_code} onValueChange={v => update(i, { channel_code: v })}>
                        <SelectTrigger><SelectValue placeholder="Channel" /></SelectTrigger>
                        <SelectContent>
                          {channels.map(c => <SelectItem key={c.value_code} value={c.value_code}>{c.value_label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Select disabled={isReadOnly} value={r.workflow_template_id || '__none__'} onValueChange={v => update(i, { workflow_template_id: v === '__none__' ? '' : v })}>
                          <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— Select —</SelectItem>
                            {templates.map((t: any) => (
                              <SelectItem key={t.id} value={t.id}>{t.template_name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {r.workflow_template_id && (
                          <Badge variant={executable ? 'default' : 'secondary'} className="shrink-0 text-[10px]">
                            {executable ? 'Executable' : 'Config-only'}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell><Switch disabled={isReadOnly} checked={r.is_default} onCheckedChange={v => update(i, { is_default: v })} /></TableCell>
                    <TableCell><Switch disabled={isReadOnly} checked={r.is_active} onCheckedChange={v => update(i, { is_active: v })} /></TableCell>
                    <TableCell><Input type="date" disabled={isReadOnly} value={r.effective_from ?? ''} onChange={e => update(i, { effective_from: e.target.value || null })} /></TableCell>
                    <TableCell><Input type="date" disabled={isReadOnly} value={r.effective_to ?? ''} onChange={e => update(i, { effective_to: e.target.value || null })} /></TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" disabled={isReadOnly} onClick={() => remove(i)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Resolution order at intake: <code>channel match → default mapping → product-level fallback</code>.
        </p>
      </CardContent>
    </Card>
  );
}
