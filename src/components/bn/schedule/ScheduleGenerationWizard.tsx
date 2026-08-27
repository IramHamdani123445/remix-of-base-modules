/**
 * Schedule Generation Wizard
 * Two-step wizard: select entitlement → preview generated rows → confirm.
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Loader2, CalendarDays, CheckCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  generateScheduleRows,
  type ScheduleFrequency,
  type GenerateScheduleParams,
  type BnPaymentScheduleRow,
} from '@/services/bn/scheduleService';
import { useActorUserCode } from '@/hooks/bn/useActorUserCode';

const db = supabase as any;

interface Props {
  open: boolean;
  onClose: () => void;
  onGenerated: () => void;
  preselectedEntitlementId?: string;
}

interface EntitlementOption {
  id: string;
  ssn: string;
  claim_number: string | null;
  benefit_name: string | null;
  weekly_rate: number;
  monthly_rate: number | null;
  total_entitlement: number;
  remaining_amount: number;
  payment_frequency: string;
  effective_from: string;
  effective_to: string | null;
  status: string;
}

export const ScheduleGenerationWizard: React.FC<Props> = ({ open, onClose, onGenerated, preselectedEntitlementId }) => {
  // Writes must name a person, never the 'CURRENT_USER' placeholder.
  const { actor, userCode } = useActorUserCode();

  const [step, setStep] = useState<'select' | 'preview'>('select');
  const [entitlements, setEntitlements] = useState<EntitlementOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedEnt, setSelectedEnt] = useState<EntitlementOption | null>(null);
  const [generating, setGenerating] = useState(false);

  // Generation params
  const [frequency, setFrequency] = useState<ScheduleFrequency>('WEEKLY');
  const [startDate, setStartDate] = useState<Date | undefined>(new Date());
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [maxPeriods, setMaxPeriods] = useState(52);
  const [narrative, setNarrative] = useState('');

  // Preview rows
  const previewRows = useMemo(() => {
    if (!selectedEnt || !startDate) return [];
    return generateScheduleRows({
      entitlementId: selectedEnt.id,
      claimId: '',
      ssn: selectedEnt.ssn,
      claimNumber: selectedEnt.claim_number,
      frequency,
      startDate: startDate.toISOString().slice(0, 10),
      endDate: endDate?.toISOString().slice(0, 10) ?? selectedEnt.effective_to ?? null,
      weeklyRate: selectedEnt.weekly_rate,
      monthlyRate: selectedEnt.monthly_rate,
      totalEntitlement: selectedEnt.remaining_amount,
      maxPeriods,
      mode: 'INITIAL',
      // Preview only — nothing is written here, so this must not demand a real
      // actor. `actor()` throws when the user code is unavailable, and this runs
      // during render, so calling it here would crash the wizard rather than
      // refuse a write. The saved rows carry the real actor (see handleGenerate).
      performedBy: userCode ?? '',
    });
  }, [selectedEnt, frequency, startDate, endDate, maxPeriods, userCode]);

  const totalAmount = previewRows.reduce((s, r) => s + r.amount, 0);

  useEffect(() => {
    if (!open) return;
    setStep('select');
    loadEntitlements();
  }, [open]);

  const loadEntitlements = async () => {
    setLoading(true);
    try {
      const { data } = await db
        .from('bn_entitlement')
        .select(`
          id, ssn, claim_number, weekly_rate, monthly_rate, total_entitlement,
          remaining_amount, payment_frequency, effective_from, effective_to, status,
          bn_claim(bn_product(benefit_name))
        `)
        .in('status', ['ACTIVE', 'REOPENED'])
        .order('entered_at', { ascending: false })
        .limit(100);

      setEntitlements((data ?? []).map((e: any) => ({
        ...e,
        benefit_name: e.bn_claim?.bn_product?.benefit_name || null,
      })));

      if (preselectedEntitlementId) {
        const found = (data ?? []).find((e: any) => e.id === preselectedEntitlementId);
        if (found) selectEntitlement({ ...found, benefit_name: found.bn_claim?.bn_product?.benefit_name || null });
      }
    } catch {
      toast.error('Failed to load entitlements');
    }
    setLoading(false);
  };

  const selectEntitlement = (ent: EntitlementOption) => {
    setSelectedEnt(ent);
    setFrequency(ent.payment_frequency as ScheduleFrequency);
    setStartDate(new Date(ent.effective_from));
    setEndDate(ent.effective_to ? new Date(ent.effective_to) : undefined);
    setStep('preview');
  };

  const handleGenerate = async () => {
    if (!selectedEnt || !previewRows.length) return;
    setGenerating(true);
    try {
      // Get claim_id from entitlement
      const { data: entData } = await db
        .from('bn_entitlement')
        .select('claim_id')
        .eq('id', selectedEnt.id)
        .single();

      const claimId = entData?.claim_id;

      // Get max existing sequence
      const { data: maxSeq } = await db
        .from('bn_payment_schedule')
        .select('sequence_number')
        .eq('entitlement_id', selectedEnt.id)
        .order('sequence_number', { ascending: false })
        .limit(1);

      const startSeq = (maxSeq?.[0]?.sequence_number ?? 0) + 1;
      const insertRows = previewRows.map((r, i) => ({
        ...r,
        claim_id: claimId,
        sequence_number: startSeq + i,
      }));

      const { error } = await db.from('bn_payment_schedule').insert(insertRows);
      if (error) throw error;

      // Audit
      await db.from('bn_claim_event').insert({
        claim_id: claimId,
        event_type: 'SCHEDULE_GENERATED',
        notes: narrative || 'Payment schedule generated',
        performed_by: actor('generate schedule'),
        performed_at: new Date().toISOString(),
        metadata: {
          entity_type: 'PAYMENT_SCHEDULE',
          entitlement_id: selectedEnt.id,
          rows_created: insertRows.length,
          total_amount: totalAmount,
          frequency,
        },
      });

      toast.success(`${insertRows.length} schedule rows generated`);
      onGenerated();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Generation failed');
    }
    setGenerating(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            {step === 'select' ? 'Select Entitlement' : 'Preview Schedule'}
          </DialogTitle>
          <DialogDescription>
            {step === 'select'
              ? 'Choose an active entitlement to generate a payment schedule.'
              : `${previewRows.length} rows for ${selectedEnt?.claim_number || selectedEnt?.ssn}`}
          </DialogDescription>
        </DialogHeader>

        {step === 'select' && (
          <div className="space-y-3">
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : entitlements.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-amber-500" />
                No active entitlements found.
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {entitlements.map(e => (
                  <div
                    key={e.id}
                    className="rounded-lg border p-3 cursor-pointer hover:bg-muted/50"
                    onClick={() => selectEntitlement(e)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-medium">{e.claim_number || e.ssn}</span>
                      <Badge variant="outline">{e.status}</Badge>
                    </div>
                    <div className="mt-1 flex gap-4 text-xs text-muted-foreground">
                      <span>{e.benefit_name}</span>
                      <span>${e.weekly_rate.toFixed(2)}/wk</span>
                      <span>Remaining: ${e.remaining_amount.toFixed(2)}</span>
                      <span>{e.payment_frequency}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 'preview' && selectedEnt && (
          <div className="space-y-4">
            {/* Config controls */}
            <div className="grid grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Frequency</Label>
                <Select value={frequency} onValueChange={(v) => setFrequency(v as ScheduleFrequency)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WEEKLY">Weekly</SelectItem>
                    <SelectItem value="FORTNIGHTLY">Fortnightly</SelectItem>
                    <SelectItem value="MONTHLY">Monthly</SelectItem>
                    <SelectItem value="ONE_TIME">One-Time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Start Date</Label>
                <DatePicker date={startDate} onDateChange={setStartDate} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">End Date</Label>
                <DatePicker date={endDate} onDateChange={setEndDate} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max Periods</Label>
                <Input type="number" value={maxPeriods} onChange={(e) => setMaxPeriods(parseInt(e.target.value) || 52)} />
              </div>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded border p-2 text-center">
                <p className="text-[10px] text-muted-foreground">Rows</p>
                <p className="font-bold text-lg">{previewRows.length}</p>
              </div>
              <div className="rounded border p-2 text-center">
                <p className="text-[10px] text-muted-foreground">Total Amount</p>
                <p className="font-mono font-bold">${totalAmount.toFixed(2)}</p>
              </div>
              <div className="rounded border p-2 text-center">
                <p className="text-[10px] text-muted-foreground">Remaining After</p>
                <p className="font-mono font-bold">${Math.max(0, selectedEnt.remaining_amount - totalAmount).toFixed(2)}</p>
              </div>
            </div>

            {totalAmount > selectedEnt.remaining_amount && (
              <div className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Schedule total exceeds remaining entitlement balance.
              </div>
            )}

            <Separator />

            {/* Preview table */}
            <div className="border rounded-md max-h-[250px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-xs">#</TableHead>
                    <TableHead className="text-xs">Period Start</TableHead>
                    <TableHead className="text-xs">Period End</TableHead>
                    <TableHead className="text-xs">Due Date</TableHead>
                    <TableHead className="text-xs text-right">Amount</TableHead>
                    <TableHead className="text-xs text-right">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.slice(0, 100).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono">{r.sequence_number}</TableCell>
                      <TableCell className="text-xs">{r.period_start}</TableCell>
                      <TableCell className="text-xs">{r.period_end}</TableCell>
                      <TableCell className="text-xs">{r.due_date}</TableCell>
                      <TableCell className="text-xs text-right font-mono">${r.amount.toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-right font-mono">${r.rate_applied.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
                placeholder="Schedule generation notes..."
                rows={2}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 'preview' && (
            <Button variant="outline" onClick={() => setStep('select')} disabled={generating}>
              Back
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={generating}>Cancel</Button>
          {step === 'preview' && (
            <Button onClick={handleGenerate} disabled={generating || previewRows.length === 0}>
              {generating && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              <CheckCircle className="h-4 w-4 mr-1" />
              Generate {previewRows.length} Rows
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
