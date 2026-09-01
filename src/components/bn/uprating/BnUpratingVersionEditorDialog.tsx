/**
 * BN Uprating — Version editor dialog (Epic 0).
 *
 * Captures the configuration of a DRAFT policy version. The form only renders
 * the fields that belong to the policy type; it never validates policy
 * substance locally — validation is performed by the governed backend and its
 * findings are shown against the fields.
 */
import React from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Trash2, Plus } from 'lucide-react';
import type {
  BnUpratingPolicyTier,
  BnUpratingPolicyVersion,
  BnUpratingReferenceData,
} from '@/types/bn/uprating/upratingPolicy';
import type { BnUpratingPolicyType } from '@/types/bn/uprating/upratingPolicyTypes';
import { BnBusyButton } from '@/components/bn/shared';

export interface BnUpratingVersionEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyType: BnUpratingPolicyType;
  reference: BnUpratingReferenceData | null;
  version: BnUpratingPolicyVersion | null;
  submitting: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
}

interface TierDraft {
  sequence_no: number;
  lower_bound_minor: string;
  upper_bound_minor: string;
  percentage_bp: string;
  fixed_amount_minor: string;
}

const num = (v: string) => (v.trim() === '' ? null : Number(v));

export const BnUpratingVersionEditorDialog: React.FC<BnUpratingVersionEditorDialogProps> = ({
  open,
  onOpenChange,
  policyType,
  reference,
  version,
  submitting,
  onSubmit,
}) => {
  const [form, setForm] = React.useState<Record<string, string>>({});
  const [tiers, setTiers] = React.useState<TierDraft[]>([]);

  React.useEffect(() => {
    if (!open) return;
    setForm({
      version_reference: version?.version_reference ?? '',
      effective_from: version?.effective_from ?? '',
      effective_to: version?.effective_to ?? '',
      rounding_mode: version?.rounding_mode ?? 'NONE',
      percentage_bp: version?.percentage_bp != null ? String(version.percentage_bp) : '',
      fixed_amount_minor: version?.fixed_amount_minor != null ? String(version.fixed_amount_minor) : '',
      currency_code: version?.currency_code ?? 'XCD',
      index_series_id: version?.index_series_id ?? '',
      index_reference_period: version?.index_reference_period ?? '',
      index_base_period: version?.index_base_period ?? '',
      formula_version_id: version?.formula_version_id ?? '',
      manual_source_code: version?.manual_source_code ?? '',
      manual_source_description: version?.manual_source_description ?? '',
      country_code: version?.country_code ?? 'KN',
      product_id: version?.product_id ?? '',
      award_component_code: version?.award_component_code ?? '',
      payment_frequency: version?.payment_frequency ?? '',
      source_reference: version?.source_reference ?? '',
    });
    setTiers(
      (version?.tiers ?? []).map((t: BnUpratingPolicyTier) => ({
        sequence_no: t.sequence_no,
        lower_bound_minor: String(t.lower_bound_minor ?? 0),
        upper_bound_minor: t.upper_bound_minor != null ? String(t.upper_bound_minor) : '',
        percentage_bp: t.percentage_bp != null ? String(t.percentage_bp) : '',
        fixed_amount_minor: t.fixed_amount_minor != null ? String(t.fixed_amount_minor) : '',
      })),
    );
  }, [open, version]);

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const options = (domain: string) => reference?.reference?.[domain] ?? [];

  const handleSubmit = () => {
    const payload: Record<string, unknown> = {
      version_reference: form.version_reference || null,
      effective_from: form.effective_from || null,
      effective_to: form.effective_to || null,
      rounding_mode: form.rounding_mode || 'NONE',
      country_code: form.country_code || null,
      product_id: form.product_id || null,
      award_component_code: form.award_component_code || null,
      payment_frequency: form.payment_frequency || null,
      source_reference: form.source_reference || null,
    };
    if (policyType === 'PERCENTAGE' || policyType === 'PERCENTAGE_PLUS_FIXED') {
      payload.percentage_bp = num(form.percentage_bp);
    }
    if (policyType === 'FIXED_AMOUNT' || policyType === 'PERCENTAGE_PLUS_FIXED') {
      payload.fixed_amount_minor = num(form.fixed_amount_minor);
      payload.currency_code = form.currency_code || null;
    }
    if (policyType === 'INDEX_FACTOR') {
      payload.index_series_id = form.index_series_id || null;
      payload.index_reference_period = form.index_reference_period || null;
      payload.index_base_period = form.index_base_period || null;
    }
    if (policyType === 'FORMULA_DRIVEN') {
      payload.formula_version_id = form.formula_version_id || null;
    }
    if (policyType === 'MANUAL_IMPORT') {
      payload.manual_source_code = form.manual_source_code || null;
      payload.manual_source_description = form.manual_source_description || null;
    }
    if (policyType === 'TIERED') {
      payload.tiers = tiers.map((t, i) => ({
        sequence_no: i + 1,
        lower_bound_minor: num(t.lower_bound_minor) ?? 0,
        upper_bound_minor: num(t.upper_bound_minor),
        percentage_bp: num(t.percentage_bp),
        fixed_amount_minor: num(t.fixed_amount_minor),
      }));
    }
    onSubmit(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{version ? 'Edit draft version' : 'New policy version'}</DialogTitle>
          <DialogDescription>
            Configure the uprating rule for this version. It can only be submitted for approval
            after backend validation passes.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="version_reference">Version reference</Label>
            <Input
              id="version_reference"
              value={form.version_reference ?? ''}
              onChange={(e) => set('version_reference', e.target.value)}
              placeholder="Auto-generated if left blank"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source_reference">Legal or source reference</Label>
            <Input
              id="source_reference"
              value={form.source_reference ?? ''}
              onChange={(e) => set('source_reference', e.target.value)}
              placeholder="e.g. SI No. 12 of 2026"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="effective_from">Effective from</Label>
            <Input
              id="effective_from"
              type="date"
              value={form.effective_from ?? ''}
              onChange={(e) => set('effective_from', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="effective_to">Effective to</Label>
            <Input
              id="effective_to"
              type="date"
              value={form.effective_to ?? ''}
              onChange={(e) => set('effective_to', e.target.value)}
            />
          </div>
        </div>

        <Separator />
        <p className="text-sm font-medium">Applicability</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="country_code">Country</Label>
            <Input
              id="country_code"
              value={form.country_code ?? ''}
              onChange={(e) => set('country_code', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Benefit product</Label>
            <Select value={form.product_id || 'ALL'} onValueChange={(v) => set('product_id', v === 'ALL' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="All products" /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="ALL">All products</SelectItem>
                {(reference?.products ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Award component</Label>
            <Select
              value={form.award_component_code || ''}
              onValueChange={(v) => set('award_component_code', v)}
            >
              <SelectTrigger><SelectValue placeholder="Select component" /></SelectTrigger>
              <SelectContent>
                {options('AWARD_COMPONENT').map((o) => (
                  <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Payment frequency</Label>
            <Select
              value={form.payment_frequency || 'ALL'}
              onValueChange={(v) => set('payment_frequency', v === 'ALL' ? '' : v)}
            >
              <SelectTrigger><SelectValue placeholder="All frequencies" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All frequencies</SelectItem>
                {options('PAYMENT_FREQUENCY').map((o) => (
                  <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator />
        <p className="text-sm font-medium">Calculation</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {(policyType === 'PERCENTAGE' || policyType === 'PERCENTAGE_PLUS_FIXED') && (
            <div className="space-y-2">
              <Label htmlFor="percentage_bp">Percentage (basis points)</Label>
              <Input
                id="percentage_bp"
                inputMode="numeric"
                value={form.percentage_bp ?? ''}
                onChange={(e) => set('percentage_bp', e.target.value)}
                placeholder="250 = 2.50%"
              />
            </div>
          )}
          {(policyType === 'FIXED_AMOUNT' || policyType === 'PERCENTAGE_PLUS_FIXED') && (
            <>
              <div className="space-y-2">
                <Label htmlFor="fixed_amount_minor">Fixed amount (minor units)</Label>
                <Input
                  id="fixed_amount_minor"
                  inputMode="numeric"
                  value={form.fixed_amount_minor ?? ''}
                  onChange={(e) => set('fixed_amount_minor', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="currency_code">Currency</Label>
                <Input
                  id="currency_code"
                  value={form.currency_code ?? ''}
                  onChange={(e) => set('currency_code', e.target.value)}
                />
              </div>
            </>
          )}
          {policyType === 'INDEX_FACTOR' && (
            <>
              <div className="space-y-2">
                <Label>Index series</Label>
                <Select value={form.index_series_id || ''} onValueChange={(v) => set('index_series_id', v)}>
                  <SelectTrigger><SelectValue placeholder="Select governed series" /></SelectTrigger>
                  <SelectContent>
                    {(reference?.index_series ?? []).map((s) => (
                      <SelectItem key={s.index_series_id} value={s.index_series_id}>
                        {s.series_code} — {s.series_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="index_reference_period">Reference period</Label>
                <Input
                  id="index_reference_period"
                  value={form.index_reference_period ?? ''}
                  onChange={(e) => set('index_reference_period', e.target.value)}
                  placeholder="e.g. 2025-Q4"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="index_base_period">Base period</Label>
                <Input
                  id="index_base_period"
                  value={form.index_base_period ?? ''}
                  onChange={(e) => set('index_base_period', e.target.value)}
                />
              </div>
            </>
          )}
          {policyType === 'FORMULA_DRIVEN' && (
            <div className="space-y-2 sm:col-span-2">
              <Label>Governed formula version</Label>
              <Select value={form.formula_version_id || ''} onValueChange={(v) => set('formula_version_id', v)}>
                <SelectTrigger><SelectValue placeholder="Select formula version" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {(reference?.formula_versions ?? []).map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {policyType === 'MANUAL_IMPORT' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="manual_source_code">Source contract code</Label>
                <Input
                  id="manual_source_code"
                  value={form.manual_source_code ?? ''}
                  onChange={(e) => set('manual_source_code', e.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="manual_source_description">Source description</Label>
                <Textarea
                  id="manual_source_description"
                  value={form.manual_source_description ?? ''}
                  onChange={(e) => set('manual_source_description', e.target.value)}
                />
              </div>
            </>
          )}
          <div className="space-y-2">
            <Label>Rounding</Label>
            <Select value={form.rounding_mode || 'NONE'} onValueChange={(v) => set('rounding_mode', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {options('ROUNDING_MODE').map((o) => (
                  <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {policyType === 'TIERED' && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Tiers</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setTiers((t) => [
                    ...t,
                    {
                      sequence_no: t.length + 1,
                      lower_bound_minor: '',
                      upper_bound_minor: '',
                      percentage_bp: '',
                      fixed_amount_minor: '',
                    },
                  ])
                }
              >
                <Plus className="mr-1 h-4 w-4" /> Add tier
              </Button>
            </div>
            <div className="space-y-3">
              {tiers.map((t, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Lower bound</Label>
                    <Input
                      value={t.lower_bound_minor}
                      onChange={(e) =>
                        setTiers((arr) => arr.map((x, j) => (j === i ? { ...x, lower_bound_minor: e.target.value } : x)))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Upper bound</Label>
                    <Input
                      value={t.upper_bound_minor}
                      placeholder="Open ended"
                      onChange={(e) =>
                        setTiers((arr) => arr.map((x, j) => (j === i ? { ...x, upper_bound_minor: e.target.value } : x)))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Percentage (bp)</Label>
                    <Input
                      value={t.percentage_bp}
                      onChange={(e) =>
                        setTiers((arr) => arr.map((x, j) => (j === i ? { ...x, percentage_bp: e.target.value } : x)))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Fixed amount</Label>
                    <Input
                      value={t.fixed_amount_minor}
                      onChange={(e) =>
                        setTiers((arr) => arr.map((x, j) => (j === i ? { ...x, fixed_amount_minor: e.target.value } : x)))
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove tier ${i + 1}`}
                    onClick={() => setTiers((arr) => arr.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {tiers.length === 0 && (
                <p className="text-sm text-muted-foreground">No tiers defined yet.</p>
              )}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <BnBusyButton loading={submitting} onClick={handleSubmit} disabled={submitting}>
            {version ? 'Save draft' : 'Create draft version'}
          </BnBusyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
