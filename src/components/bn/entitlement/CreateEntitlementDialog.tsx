/**
 * Create Entitlement from Approved Claim
 *
 * Bridges an approved claim → entitlement record with rate snapshot,
 * duration calculation, and optional schedule generation trigger.
 */
import React, { useState, useEffect } from 'react';
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
import { Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { BnEntitlementType, BnPaymentFrequency } from '@/services/bn/entitlementService';

const db = supabase as any;

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

interface ClaimCandidate {
  id: string;
  claim_number: string;
  ssn: string;
  status: string;
  benefit_name: string | null;
  weekly_rate: number;
  monthly_rate: number | null;
  total_entitlement: number;
  duration_weeks: number | null;
  effective_from: string;
  effective_to: string | null;
  payment_frequency: string;
}

export const CreateEntitlementDialog: React.FC<Props> = ({ open, onClose, onCreated }) => {
  const [step, setStep] = useState<'select' | 'configure'>('select');
  const [candidates, setCandidates] = useState<ClaimCandidate[]>([]);
  /** Set when the lookup itself failed, so the empty state can say so. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<ClaimCandidate | null>(null);
  const [creating, setCreating] = useState(false);

  // Config overrides
  const [entitlementType, setEntitlementType] = useState<BnEntitlementType>('PERIODIC');
  const [paymentFrequency, setPaymentFrequency] = useState<BnPaymentFrequency>('WEEKLY');
  const [weeklyRate, setWeeklyRate] = useState(0);
  const [totalEntitlement, setTotalEntitlement] = useState(0);
  const [durationWeeks, setDurationWeeks] = useState<number | undefined>();
  const [effectiveFrom, setEffectiveFrom] = useState<Date | undefined>();
  const [effectiveTo, setEffectiveTo] = useState<Date | undefined>();
  const [narrative, setNarrative] = useState('');
  const [generateSchedule, setGenerateSchedule] = useState(true);

  // Load approved claims without entitlements
  useEffect(() => {
    if (!open) return;
    setStep('select');
    setSelectedClaim(null);
    loadCandidates();
  }, [open]);

  /**
   * Claims that may have an entitlement created from them.
   *
   * An entitlement is the right to be paid, so it may only follow a decision
   * that granted it. Eligibility for selection is therefore APPROVAL, not the
   * claim's current status: a claim moves APPROVED → AWARD_SETUP →
   * PAYMENT_QUEUE → IN_PAYMENT, so filtering on 'APPROVED' alone loses every
   * claim that has moved on. SUSPENDED, CLOSED, DENIED and WITHDRAWN claims are
   * excluded — a suspended claim must be reinstated and its existing
   * entitlement resumed, never given a second one.
   *
   * The previous query also asked bn_claim_calculation for total_entitlement,
   * duration_weeks, effective_from, effective_to and payment_frequency. None of
   * those exist on that table — they are bn_entitlement columns. PostgREST
   * rejects a select naming an unknown column, so the whole query failed; and
   * because the error was discarded, the dialog reported "No approved claims
   * without entitlements found" whether or not any existed.
   */
  const loadCandidates = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Statuses a claim can hold at or after approval.
      const POST_APPROVAL = ['APPROVED', 'AWARD_SETUP', 'PAYMENT_QUEUE', 'IN_PAYMENT'];

      const { data: claims, error: claimErr } = await db
        .from('bn_claim')
        .select(`
          id, claim_number, ssn, status, claim_date, product_version_id,
          bn_product(benefit_name),
          bn_claim_calculation(weekly_rate, monthly_rate, lump_sum, calc_date)
        `)
        .in('status', POST_APPROVAL)
        .order('modified_at', { ascending: false })
        .limit(100);
      if (claimErr) throw claimErr;

      // Claims already holding an entitlement, in any live state.
      const { data: existingEnts, error: entErr } = await db
        .from('bn_entitlement')
        .select('claim_id')
        .in('status', ['DRAFT', 'ACTIVE', 'SUSPENDED', 'REOPENED']);
      if (entErr) throw entErr;

      const existingClaimIds = new Set((existingEnts ?? []).map((e: any) => e.claim_id));

      // Duration and payment frequency are properties of the product version,
      // not of the calculation — the calculation only produces rates.
      const versionIds = Array.from(
        new Set((claims ?? []).map((c: any) => c.product_version_id).filter(Boolean)),
      );
      const versionConfig = new Map<string, any>();
      if (versionIds.length > 0) {
        const { data: versions } = await db
          .from('bn_product_version')
          .select('id, payment_frequency, benefit_duration_type')
          .in('id', versionIds);
        (versions ?? []).forEach((v: any) => versionConfig.set(v.id, v));
      }

      const mapped: ClaimCandidate[] = (claims ?? [])
        .filter((c: any) => !existingClaimIds.has(c.id))
        .map((c: any) => {
          // Newest calculation, not whichever row came back first.
          const calcs = [...(c.bn_claim_calculation ?? [])].sort(
            (a: any, b: any) => String(b.calc_date ?? '').localeCompare(String(a.calc_date ?? '')),
          );
          const calc = calcs[0] ?? {};
          const cfg = versionConfig.get(c.product_version_id) ?? {};
          const weekly = Number(calc.weekly_rate ?? 0);
          const monthly = Number(calc.monthly_rate ?? 0);
          const lump = Number(calc.lump_sum ?? 0);
          return {
            id: c.id,
            claim_number: c.claim_number,
            ssn: c.ssn,
            status: c.status,
            benefit_name: c.bn_product?.benefit_name || null,
            weekly_rate: weekly,
            monthly_rate: monthly || null,
            // A lump sum IS the total. For a periodic benefit the total depends on
            // duration, and no product-version column carries one
            // (bn_product_version has benefit_duration_type but no week count),
            // so it is left for the officer to set on the configure step rather
            // than guessed here.
            total_entitlement: lump > 0 ? lump : 0,
            duration_weeks: null,
            effective_from: c.claim_date ?? new Date().toISOString().slice(0, 10),
            effective_to: null,
            payment_frequency: cfg.payment_frequency ?? (lump > 0 ? 'ONE_TIME' : 'WEEKLY'),
          };
        });
      setCandidates(mapped);
    } catch (e: any) {
      // "Nothing found" and "could not look" must not read the same.
      setCandidates([]);
      setLoadError(e?.message ?? 'Unknown error');
      toast.error('Could not load eligible claims', { description: e?.message });
    }
    setLoading(false);
  };

  const selectClaim = (claim: ClaimCandidate) => {
    setSelectedClaim(claim);
    setWeeklyRate(claim.weekly_rate);
    setTotalEntitlement(claim.total_entitlement);
    setDurationWeeks(claim.duration_weeks ?? undefined);
    setPaymentFrequency(claim.payment_frequency as BnPaymentFrequency);
    setEffectiveFrom(new Date(claim.effective_from));
    setEffectiveTo(claim.effective_to ? new Date(claim.effective_to) : undefined);
    setStep('configure');
  };

  const handleCreate = async () => {
    if (!selectedClaim || !effectiveFrom) return;
    setCreating(true);
    try {
      const now = new Date().toISOString();
      const entitlementData = {
        claim_id: selectedClaim.id,
        ssn: selectedClaim.ssn,
        claim_number: selectedClaim.claim_number,
        entitlement_type: entitlementType,
        payment_frequency: paymentFrequency,
        weekly_rate: weeklyRate,
        monthly_rate: paymentFrequency === 'MONTHLY' ? weeklyRate * 4.33 : null,
        total_entitlement: totalEntitlement,
        remaining_amount: totalEntitlement,
        duration_weeks: durationWeeks ?? null,
        weeks_paid: 0,
        effective_from: effectiveFrom.toISOString().slice(0, 10),
        effective_to: effectiveTo?.toISOString().slice(0, 10) ?? null,
        status: 'DRAFT',
        override_applied: false,
        entered_by: 'CURRENT_USER',
        entered_at: now,
      };

      const { data: ent, error } = await db
        .from('bn_entitlement')
        .insert(entitlementData)
        .select('id')
        .single();
      if (error) throw error;

      // Update claim status
      await db.from('bn_claim')
        .update({ status: 'AWARD_SETUP', modified_by: 'CURRENT_USER', modified_at: now })
        .eq('id', selectedClaim.id);

      // Audit event
      await db.from('bn_claim_event').insert({
        claim_id: selectedClaim.id,
        event_type: 'ENTITLEMENT_CREATED',
        description: narrative || 'Entitlement created from approved claim',
        performed_by: 'CURRENT_USER',
        performed_at: now,
        metadata: {
          entitlement_id: ent.id,
          entity_type: 'ENTITLEMENT',
          weekly_rate: weeklyRate,
          total_entitlement: totalEntitlement,
          generate_schedule: generateSchedule,
        },
      });

      toast.success('Entitlement created successfully');
      onCreated();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create entitlement');
    }
    setCreating(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 'select' ? 'Select Approved Claim' : 'Configure Entitlement'}
          </DialogTitle>
          <DialogDescription>
            {step === 'select'
              ? 'Choose an approved claim to create an entitlement from.'
              : `Creating entitlement for claim ${selectedClaim?.claim_number}`}
          </DialogDescription>
        </DialogHeader>

        {step === 'select' && (
          <div className="space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : candidates.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-amber-500" />
                {loadError
                  ? `The list of eligible claims could not be loaded: ${loadError}`
                  : 'No approved claims without entitlements found. A claim must be approved, ' +
                    'and not already hold an entitlement, to appear here.'}
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {candidates.map(c => (
                  <div
                    key={c.id}
                    className="rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => selectClaim(c)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-mono font-medium text-sm">{c.claim_number}</span>
                        <span className="text-xs text-muted-foreground ml-2">SSN: {c.ssn}</span>
                      </div>
                      <Badge variant="outline" className="text-xs">{c.status}</Badge>
                    </div>
                    <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{c.benefit_name || 'Unknown Benefit'}</span>
                      <span>Rate: ${c.weekly_rate.toFixed(2)}/wk</span>
                      <span>Total: ${c.total_entitlement.toFixed(2)}</span>
                      {c.duration_weeks && <span>{c.duration_weeks} weeks</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 'configure' && selectedClaim && (
          <div className="space-y-4">
            {/* Claim summary */}
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="h-4 w-4 text-emerald-600" />
                <span className="font-medium">{selectedClaim.claim_number}</span>
                <span className="text-muted-foreground">— {selectedClaim.benefit_name}</span>
              </div>
              <span className="text-xs text-muted-foreground">SSN: {selectedClaim.ssn}</span>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Entitlement Type</Label>
                <Select value={entitlementType} onValueChange={(v) => setEntitlementType(v as BnEntitlementType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERIODIC">Periodic</SelectItem>
                    <SelectItem value="LUMP_SUM">Lump Sum</SelectItem>
                    <SelectItem value="BOTH">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Payment Frequency</Label>
                <Select value={paymentFrequency} onValueChange={(v) => setPaymentFrequency(v as BnPaymentFrequency)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WEEKLY">Weekly</SelectItem>
                    <SelectItem value="FORTNIGHTLY">Fortnightly</SelectItem>
                    <SelectItem value="MONTHLY">Monthly</SelectItem>
                    <SelectItem value="ONE_TIME">One-Time</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Weekly Rate (XCD)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={weeklyRate}
                  onChange={(e) => setWeeklyRate(parseFloat(e.target.value) || 0)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Total Entitlement (XCD)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={totalEntitlement}
                  onChange={(e) => setTotalEntitlement(parseFloat(e.target.value) || 0)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Duration (Weeks)</Label>
                <Input
                  type="number"
                  value={durationWeeks ?? ''}
                  onChange={(e) => setDurationWeeks(e.target.value ? parseInt(e.target.value) : undefined)}
                  placeholder="Open-ended if blank"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Effective From</Label>
                <DatePicker date={effectiveFrom} onDateChange={setEffectiveFrom} />
              </div>

              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">Effective To (optional)</Label>
                <DatePicker date={effectiveTo} onDateChange={setEffectiveTo} />
              </div>
            </div>

            <Separator />

            <div className="space-y-1.5">
              <Label className="text-xs">Narrative / Notes</Label>
              <Textarea
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
                placeholder="Reason for entitlement creation..."
                rows={2}
              />
            </div>

            <div className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                id="gen-schedule"
                checked={generateSchedule}
                onChange={(e) => setGenerateSchedule(e.target.checked)}
                className="rounded border-muted-foreground"
              />
              <label htmlFor="gen-schedule" className="text-muted-foreground">
                Auto-generate payment schedule after activation
              </label>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 'configure' && (
            <Button variant="outline" onClick={() => setStep('select')} disabled={creating}>
              Back
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={creating}>
            Cancel
          </Button>
          {step === 'configure' && (
            <Button onClick={handleCreate} disabled={creating || !effectiveFrom || weeklyRate <= 0}>
              {creating && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Create Entitlement
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
