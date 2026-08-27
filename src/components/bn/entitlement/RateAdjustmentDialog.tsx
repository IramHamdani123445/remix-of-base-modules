/**
 * Rate Adjustment Dialog
 * Allows supervisors to adjust entitlement rates with full audit trail.
 */
import React, { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Loader2, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { useUserCode } from '@/hooks/useUserCode';
import { requireUserCode } from '@/lib/bn/requireUserCode';
import { useUpdateEntitlementFields } from '@/hooks/bn/useBnEntitlement';
import type { EntitlementWithContext } from '@/services/bn/entitlementService';

interface Props {
  open: boolean;
  onClose: () => void;
  entitlement: EntitlementWithContext | null;
}

export const RateAdjustmentDialog: React.FC<Props> = ({ open, onClose, entitlement }) => {
  const updateMutation = useUpdateEntitlementFields();
    const { userCode, isLoading: userCodeLoading, error: userCodeError } = useUserCode();

const [newWeeklyRate, setNewWeeklyRate] = useState(0);
  const [newTotalEntitlement, setNewTotalEntitlement] = useState(0);
  const [narrative, setNarrative] = useState('');

  React.useEffect(() => {
    if (entitlement) {
      setNewWeeklyRate(entitlement.weekly_rate);
      setNewTotalEntitlement(entitlement.total_entitlement);
      setNarrative('');
    }
  }, [entitlement]);

  if (!entitlement) return null;

  const rateChanged = newWeeklyRate !== entitlement.weekly_rate;
  const totalChanged = newTotalEntitlement !== entitlement.total_entitlement;
  const hasChanges = rateChanged || totalChanged;
  const rateDiff = newWeeklyRate - entitlement.weekly_rate;
  const newRemaining = entitlement.remaining_amount + (newTotalEntitlement - entitlement.total_entitlement);

  const handleSubmit = () => {
    if (!narrative.trim()) {
      toast.error('Justification is required for rate adjustments.');
      return;
    }
    const updates: Record<string, any> = {};
    if (rateChanged) updates.weekly_rate = newWeeklyRate;
    if (totalChanged) {
      updates.total_entitlement = newTotalEntitlement;
      updates.remaining_amount = Math.max(0, newRemaining);
    }

    // A rate change moves money. It must be attributable, so a placeholder actor
    // is refused rather than written (requireUserCode forbids 'CURRENT_USER').
    let actor: string;
    try {
      actor = requireUserCode(userCode, 'adjust entitlement rate');
    } catch (e: any) {
      toast.error('Cannot record this adjustment', { description: e?.message });
      return;
    }

    updateMutation.mutate(
      { entitlementId: entitlement.id, updates, narrative, performedBy: actor },
      {
        onSuccess: () => {
          toast.success('Rate adjustment applied successfully');
          onClose();
        },
        onError: (err: any) => toast.error(err.message),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rate Adjustment</DialogTitle>
          <DialogDescription>
            Adjust rates for entitlement {entitlement.claim_number}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Current vs New Rate */}
          <div className="space-y-2">
            <Label className="text-xs">Weekly Rate (XCD)</Label>
            <div className="flex items-center gap-3">
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Current</p>
                <p className="font-mono font-bold">${entitlement.weekly_rate.toFixed(2)}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <Input
                type="number"
                step="0.01"
                value={newWeeklyRate}
                onChange={(e) => setNewWeeklyRate(parseFloat(e.target.value) || 0)}
                className="w-32"
              />
              {rateChanged && (
                <div className={`flex items-center gap-1 text-xs ${rateDiff > 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                  {rateDiff > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {rateDiff > 0 ? '+' : ''}{rateDiff.toFixed(2)}
                </div>
              )}
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label className="text-xs">Total Entitlement (XCD)</Label>
            <div className="flex items-center gap-3">
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Current</p>
                <p className="font-mono font-bold">${entitlement.total_entitlement.toFixed(2)}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <Input
                type="number"
                step="0.01"
                value={newTotalEntitlement}
                onChange={(e) => setNewTotalEntitlement(parseFloat(e.target.value) || 0)}
                className="w-32"
              />
            </div>
            {totalChanged && (
              <p className="text-xs text-muted-foreground">
                New remaining: <span className="font-mono font-medium">${Math.max(0, newRemaining).toFixed(2)}</span>
              </p>
            )}
          </div>

          <Separator />

          <div className="space-y-1.5">
            <Label className="text-xs">Justification (required)</Label>
            <Textarea
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              placeholder="Reason for rate adjustment..."
              rows={3}
            />
          </div>

          <div className="text-xs text-muted-foreground space-y-0.5">
            <p>⚠ Rate adjustments are fully audited and will trigger schedule recalculation.</p>
            <p>⚠ This does not affect already-issued payments.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={updateMutation.isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!hasChanges || !narrative.trim() || updateMutation.isPending}>
            {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Apply Adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
