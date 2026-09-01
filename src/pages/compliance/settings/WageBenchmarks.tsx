import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Edit, Info, AlertTriangle, ExternalLink, History } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useHasCapability } from '@/hooks/useHasCapability';
import { COMPLIANCE_CAPABILITIES } from '@/lib/compliance/capabilities';

interface Benchmark {
  id: string;
  sector_code: string;
  sector_label: string | null;
  calculated_minimum: number | null;
  calculated_average: number | null;
  sample_count: number;
  effective_from: string;
  effective_to: string | null;
  recalculated_at: string | null;
  is_enabled: boolean;
  override_minimum: number | null;
  override_average: number | null;
  override_reason: string | null;
  overridden_by: string | null;
  overridden_at: string | null;
}

// Recalculation cadence is owned by the Rule Engine — read-only display constant.
const MONTHLY_CADENCE_DAYS = 30;

function isStale(recalculatedAt: string | null): boolean {
  if (!recalculatedAt) return true;
  const diffDays = (Date.now() - new Date(recalculatedAt).getTime()) / (1000 * 60 * 60 * 24);
  return diffDays > MONTHLY_CADENCE_DAYS;
}

export default function WageBenchmarks() {
  const canOverride = useHasCapability(COMPLIANCE_CAPABILITIES.BENCHMARK_OVERRIDE);
  const qc = useQueryClient();
  const [overrideTarget, setOverrideTarget] = useState<Benchmark | null>(null);
  const [overrideMin, setOverrideMin] = useState('');
  const [overrideAvg, setOverrideAvg] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  const { data: benchmarks = [], isLoading } = useQuery({
    queryKey: ['ce_sector_wage_benchmarks'],
    queryFn: async (): Promise<Benchmark[]> => {
      const { data, error } = await supabase
        .from('ce_sector_wage_benchmarks')
        .select('*')
        .order('sector_code', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as Benchmark[];
    },
  });

  const overrideMutation = useMutation({
    mutationFn: async () => {
      if (!overrideTarget) return;
      if (!overrideReason.trim()) throw new Error('A reason is required to override a sector benchmark.');
      const { error } = await supabase.rpc('ce_override_sector_benchmark_v1', {
        p_benchmark_id: overrideTarget.id,
        p_override_minimum: Number(overrideMin),
        p_override_average: Number(overrideAvg),
        p_reason: overrideReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ce_sector_wage_benchmarks'] });
      toast.success('Benchmark override recorded');
      setOverrideTarget(null);
      setOverrideMin(''); setOverrideAvg(''); setOverrideReason('');
    },
    onError: (e: any) => toast.error('Failed to override benchmark', { description: e.message }),
  });

  const openOverride = (b: Benchmark) => {
    setOverrideTarget(b);
    setOverrideMin(b.override_minimum != null ? String(b.override_minimum) : String(b.calculated_minimum ?? ''));
    setOverrideAvg(b.override_average != null ? String(b.override_average) : String(b.calculated_average ?? ''));
    setOverrideReason('');
  };

  const money = (n: number | null) => n == null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'XCD', maximumFractionDigits: 0 }).format(n);

  if (isLoading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Sector Wage Benchmarks (DR-010)"
        subtitle="Calculated minimum and average wage benchmarks used for wage-anomaly detection, by sector"
        breadcrumbs={[{ label: 'Compliance', href: '/compliance/dashboard' }, { label: 'Settings', href: '/compliance/admin/settings' }, { label: 'Wage Benchmarks' }]}
      />

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-4 flex gap-3 items-start">
          <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Benchmarks are recalculated automatically on a monthly cadence.</p>
            <p>
              The recalculation cadence itself is owned by the Rule Engine and cannot be edited here — see{' '}
              <Link to="/compliance/admin/settings/rule-engine" className="text-primary underline inline-flex items-center gap-1">
                Rule Engine <ExternalLink className="h-3 w-3" />
              </Link>.
            </p>
            <p>Administrators with the benchmark override capability may set a manual minimum/average with a mandatory reason. Overrides are fully audited.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Benchmarks by Sector</CardTitle><CardDescription>Calculated values feed detection unless an active override is present.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sector</TableHead>
                <TableHead>Calc. Minimum</TableHead>
                <TableHead>Calc. Average</TableHead>
                <TableHead>Sample</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Last Recalculated</TableHead>
                <TableHead>Override</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {benchmarks.map(b => {
                const stale = isStale(b.recalculated_at);
                const overrideActive = b.override_minimum != null || b.override_average != null;
                return (
                  <TableRow key={b.id}>
                    <TableCell>
                      <div className="font-mono text-xs">{b.sector_code}</div>
                      <div className="text-sm text-muted-foreground">{b.sector_label}</div>
                    </TableCell>
                    <TableCell>{money(b.calculated_minimum)}</TableCell>
                    <TableCell>{money(b.calculated_average)}</TableCell>
                    <TableCell>{b.sample_count}</TableCell>
                    <TableCell className="text-xs">
                      {b.effective_from} → {b.effective_to ?? 'open'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-xs">{b.recalculated_at ? new Date(b.recalculated_at).toLocaleDateString() : 'Never'}</span>
                        {stale && (
                          <Badge variant="destructive" className="gap-1 text-[10px]"><AlertTriangle className="h-3 w-3" />Stale</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {overrideActive ? (
                        <div className="space-y-1">
                          <Badge className="gap-1 text-[10px]"><History className="h-3 w-3" />Override active</Badge>
                          <div className="text-xs text-muted-foreground">
                            Min {money(b.override_minimum)} / Avg {money(b.override_average)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            by {b.overridden_by ?? '—'} {b.overridden_at ? `on ${new Date(b.overridden_at).toLocaleDateString()}` : ''}
                          </div>
                        </div>
                      ) : (
                        <Badge variant="outline">None</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" disabled={!canOverride} onClick={() => openOverride(b)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {benchmarks.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No sector benchmarks configured yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!overrideTarget} onOpenChange={(open) => !open && setOverrideTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Override Benchmark — {overrideTarget?.sector_code}</DialogTitle>
            <DialogDescription>
              This overrides the calculated minimum/average used for detection. A reason is mandatory and will be recorded against your user for audit.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div><Label>Override Minimum</Label><Input type="number" value={overrideMin} onChange={e => setOverrideMin(e.target.value)} /></div>
            <div><Label>Override Average</Label><Input type="number" value={overrideAvg} onChange={e => setOverrideAvg(e.target.value)} /></div>
            <div className="col-span-2">
              <Label>Reason (required)</Label>
              <Textarea value={overrideReason} onChange={e => setOverrideReason(e.target.value)} placeholder="Explain why the calculated benchmark is being overridden" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideTarget(null)}>Cancel</Button>
            <Button onClick={() => overrideMutation.mutate()} disabled={overrideMutation.isPending || !overrideReason.trim()}>
              {overrideMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Override'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
