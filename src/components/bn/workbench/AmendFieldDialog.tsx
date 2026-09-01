/**
 * AmendFieldDialog
 * ----------------
 * Single dialog used everywhere Workbench needs to amend a catalog-driven
 * field. Captures the new value + mandatory reason, then routes through
 * `amendClaimField` (which enforces channel/status/policy and records audit).
 */
import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { amendClaimField } from '@/services/bn/amendClaimField';
import type { FieldArea } from '@/types/bn/amendment';
import type { FieldMeta } from './DynamicSectionRenderer';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { BnBusyButton } from '@/components/bn/shared';

interface Props {
  claimId: string;
  field: FieldMeta | null;
  currentValue: any;
  fieldArea?: FieldArea;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function inferArea(sectionCode: string): FieldArea {
  const s = sectionCode.toUpperCase();
  if (s.includes('PARTICIPANT') || s.includes('CLAIMANT') || s.includes('DEPENDANT')) return 'PARTICIPANTS';
  if (s.includes('DOCUMENT') || s.includes('UPLOAD')) return 'DOCUMENTS';
  if (s.includes('PAYMENT') || s.includes('BANK')) return 'PAYMENT';
  if (s.includes('CALC') || s.includes('CONTRIBUTION') || s.includes('WAGE')) return 'CALC_INPUTS';
  if (s.includes('DECISION')) return 'DECISION';
  return 'BENEFIT_FACTS';
}

export const AmendFieldDialog: React.FC<Props> = ({ claimId, field, currentValue, fieldArea, open, onOpenChange }) => {
  const { profile } = useSupabaseAuth() as any;
  const qc = useQueryClient();
  const [value, setValue] = useState<any>('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(currentValue ?? '');
      setReason('');
    }
  }, [open, currentValue]);

  if (!field) return null;
  const area = fieldArea ?? inferArea(field.section_code);
  const userCode = profile?.user_code || profile?.userCode || profile?.username || 'system';

  const handleSubmit = async () => {
    if (reason.trim().length < 3) {
      toast.error('Please provide a reason (min 3 chars).');
      return;
    }
    setSubmitting(true);
    try {
      const res = await amendClaimField({
        claimId,
        fieldKey: field.field_code,
        fieldLabel: field.field_label,
        fieldArea: area,
        before: currentValue,
        after: value,
        reason: reason.trim(),
        userCode,
        persistToDetailJson: area === 'BENEFIT_FACTS' || area === 'CALC_INPUTS',
      });
      toast.success('Field amended', {
        description: [
          res.eligibilityStale && 'Eligibility marked stale.',
          res.calculationStale && 'Calculation marked stale.',
        ].filter(Boolean).join(' ') || undefined,
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['bn-claim-amendment-log', claimId] }),
        qc.invalidateQueries({ queryKey: ['bn-claim-application', claimId] }),
        qc.invalidateQueries({ queryKey: ['bn-claim-detail', claimId] }),
        qc.invalidateQueries({ queryKey: ['bn-claim', claimId] }),
      ]);
      onOpenChange(false);
    } catch (e: any) {
      toast.error('Could not amend field', { description: e?.message || String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const renderInput = () => {
    switch (field.field_type) {
      case 'DATE':
        return <Input type="date" value={value ?? ''} onChange={(e) => setValue(e.target.value)} />;
      case 'NUMBER':
      case 'DECIMAL':
        return <Input type="number" value={value ?? ''} onChange={(e) => setValue(e.target.value === '' ? '' : Number(e.target.value))} />;
      case 'BOOLEAN':
      case 'DECLARATION_CHECKBOX':
        return (
          <div className="flex items-center gap-2">
            <Checkbox checked={!!value} onCheckedChange={(v) => setValue(!!v)} id="amend-bool" />
            <Label htmlFor="amend-bool">{value ? 'Yes' : 'No'}</Label>
          </div>
        );
      case 'TEXTAREA':
        return <Textarea value={value ?? ''} onChange={(e) => setValue(e.target.value)} rows={3} />;
      default:
        return <Input value={value ?? ''} onChange={(e) => setValue(e.target.value)} />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Amend: {field.field_label}</DialogTitle>
          <DialogDescription>
            Area: {area} · Field: <code className="text-xs">{field.field_code}</code>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Current</Label>
            <p className="text-sm border rounded px-2 py-1.5 bg-muted/30 break-all">
              {currentValue === null || currentValue === undefined || currentValue === ''
                ? '—'
                : String(typeof currentValue === 'object' ? JSON.stringify(currentValue) : currentValue)}
            </p>
          </div>
          <div>
            <Label className="text-xs">New value</Label>
            {renderInput()}
          </div>
          <div>
            <Label className="text-xs">Reason <span className="text-destructive">*</span></Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Why is this field being changed?"
            />
          </div>
        </div>
        <DialogFooter>
          <BnBusyButton loading={submitting} variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</BnBusyButton>
          <BnBusyButton loading={submitting} onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving…' : 'Save amendment'}
          </BnBusyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AmendFieldDialog;
