/**
 * MEANS-TEST — policy version form dialog.
 *
 * Business fields only: officers never see or edit raw JSON. The dialog
 * assembles the governed payload (threshold parameters, household rules,
 * evidence requirements) and submits it through the policy command
 * boundary. Editing is offered only for draft versions — the backend
 * refuses anything else.
 */
import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  BN_MEANS_ROUNDING_METHODS,
  BN_MEANS_THRESHOLD_BASES,
  BN_MEANS_POLICY_ERROR_TEXT,
  type BnMeansPolicyVersionDetail,
  type BnMeansPolicyVersionForm,
} from '@/types/bn/meansTests/meansPolicyAdmin';
import { meansPolicyAdminService } from '@/services/bn/meansTests/meansPolicyAdminService';

function numText(value: unknown): string {
  return value === null || value === undefined || value === '' ? '' : String(value);
}

export function formFromVersion(version: BnMeansPolicyVersionDetail | null): BnMeansPolicyVersionForm {
  const t = (version?.threshold_parameters ?? {}) as Record<string, unknown>;
  const h = (version?.household_rules ?? {}) as Record<string, unknown>;
  return {
    version_label: version?.version_label ?? '',
    effective_from: version?.effective_from ?? '',
    effective_to: version?.effective_to ?? '',
    currency_code: version?.currency_code ?? 'XCD',
    rounding_method: version?.rounding_method ?? 'HALF_UP',
    rounding_scale: version?.rounding_scale ?? 2,
    validity_months: numText(version?.validity_months),
    reassessment_months: numText(version?.reassessment_months),
    authority_reference: version?.authority_reference ?? '',
    threshold_basis: String(t.threshold_basis ?? 'ANNUAL').toUpperCase(),
    income_threshold: numText(t.income_threshold ?? t.base_threshold_annual),
    per_member_increment: numText(t.per_member_increment ?? t.per_additional_member_annual),
    disregard: numText(t.disregard ?? t.income_disregard_annual),
    asset_threshold: numText(t.asset_threshold ?? t.asset_threshold_amount),
    count_spouse: h.count_spouse !== false,
    count_dependants: h.count_dependants !== false,
    required_evidence: (version?.required_evidence ?? []) as readonly string[],
  };
}

function payloadFromForm(form: BnMeansPolicyVersionForm): Record<string, unknown> {
  const threshold: Record<string, unknown> = { threshold_basis: form.threshold_basis };
  if (form.income_threshold !== '') threshold.income_threshold = Number(form.income_threshold);
  if (form.per_member_increment !== '') threshold.per_member_increment = Number(form.per_member_increment);
  if (form.disregard !== '') threshold.disregard = Number(form.disregard);
  if (form.asset_threshold !== '') threshold.asset_threshold = Number(form.asset_threshold);
  return {
    version_label: form.version_label.trim(),
    effective_from: form.effective_from || null,
    effective_to: form.effective_to || null,
    currency_code: form.currency_code.trim().toUpperCase(),
    rounding_method: form.rounding_method,
    rounding_scale: form.rounding_scale,
    validity_months: form.validity_months === '' ? null : Number(form.validity_months),
    reassessment_months: form.reassessment_months === '' ? null : Number(form.reassessment_months),
    authority_reference: form.authority_reference.trim(),
    threshold_parameters: threshold,
    household_rules: { count_spouse: form.count_spouse, count_dependants: form.count_dependants },
    required_evidence: form.required_evidence,
  };
}

export interface BnMeansPolicyVersionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: string;
  version: BnMeansPolicyVersionDetail | null;
  /** When set, categories and rules are copied from this version. */
  copyFromVersionId?: string | null;
  onSaved: () => void;
}

export const BnMeansPolicyVersionDialog: React.FC<BnMeansPolicyVersionDialogProps> = ({
  open, onOpenChange, policyId, version, copyFromVersionId, onSaved,
}) => {
  const [form, setForm] = React.useState<BnMeansPolicyVersionForm>(() => formFromVersion(version));
  const [evidenceText, setEvidenceText] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<{ code: string; detail: string } | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const next = formFromVersion(version);
    setForm(next);
    setEvidenceText(next.required_evidence.join('\n'));
    setError(null);
  }, [open, version]);

  const set = <K extends keyof BnMeansPolicyVersionForm>(key: K, value: BnMeansPolicyVersionForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    setPending(true);
    setError(null);
    const evidence = evidenceText.split('\n').map((l) => l.trim()).filter(Boolean);
    const payload = { ...payloadFromForm({ ...form, required_evidence: evidence }) };
    if (!version && copyFromVersionId) payload.copy_from_version_id = copyFromVersionId;
    const result = await meansPolicyAdminService.execute({
      command: version ? 'UPDATE_DRAFT_VERSION' : 'CREATE_POLICY_VERSION',
      policyId,
      policyVersionId: version?.policy_version_id ?? null,
      expectedRowVersion: version?.row_version ?? null,
      payload,
    });
    setPending(false);
    if (result.status === 'FAILED') {
      setError({ code: result.errorCode ?? 'UNKNOWN', detail: result.errorDetail ?? '' });
      return;
    }
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="means-policy-version-dialog">
        <DialogHeader>
          <DialogTitle>{version ? 'Edit draft version' : 'New policy version'}</DialogTitle>
          <DialogDescription>
            Set the rules that apply to assessments effective in this period. A version stays a draft
            until it passes validation and is activated.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive" data-testid="means-policy-version-error">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{BN_MEANS_POLICY_ERROR_TEXT[error.code] ?? BN_MEANS_POLICY_ERROR_TEXT.UNKNOWN}</AlertTitle>
            <AlertDescription>{error.detail}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="mpv-label">Version label</Label>
            <Input id="mpv-label" value={form.version_label}
              onChange={(e) => set('version_label', e.target.value)} placeholder="2026.1" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mpv-authority">Authority reference</Label>
            <Input id="mpv-authority" value={form.authority_reference}
              onChange={(e) => set('authority_reference', e.target.value)} placeholder="Regulation reference" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mpv-from">In force from</Label>
            <Input id="mpv-from" type="date" value={form.effective_from}
              onChange={(e) => set('effective_from', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mpv-to">In force to (optional)</Label>
            <Input id="mpv-to" type="date" value={form.effective_to}
              onChange={(e) => set('effective_to', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mpv-currency">Currency</Label>
            <Input id="mpv-currency" maxLength={3} value={form.currency_code}
              onChange={(e) => set('currency_code', e.target.value.toUpperCase())} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mpv-rounding">Rounding</Label>
            <select id="mpv-rounding" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.rounding_method} onChange={(e) => set('rounding_method', e.target.value)}>
              {BN_MEANS_ROUNDING_METHODS.map((m) => (
                <option key={m} value={m}>{m.replace('_', ' ').toLowerCase()}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="mpv-scale">Decimal places</Label>
            <Input id="mpv-scale" type="number" min={0} max={6} value={form.rounding_scale}
              onChange={(e) => set('rounding_scale', Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mpv-basis">Threshold basis</Label>
            <select id="mpv-basis" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.threshold_basis} onChange={(e) => set('threshold_basis', e.target.value)}>
              {BN_MEANS_THRESHOLD_BASES.map((b) => (
                <option key={b} value={b}>{b.toLowerCase()}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="mpv-threshold">Income threshold</Label>
            <Input id="mpv-threshold" type="number" step="0.01" value={form.income_threshold}
              onChange={(e) => set('income_threshold', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mpv-increment">Additional household member allowance</Label>
            <Input id="mpv-increment" type="number" step="0.01" value={form.per_member_increment}
              onChange={(e) => set('per_member_increment', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mpv-disregard">Income disregard</Label>
            <Input id="mpv-disregard" type="number" step="0.01" value={form.disregard}
              onChange={(e) => set('disregard', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mpv-asset">Asset threshold</Label>
            <Input id="mpv-asset" type="number" step="0.01" value={form.asset_threshold}
              onChange={(e) => set('asset_threshold', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mpv-validity">Validity (months)</Label>
            <Input id="mpv-validity" type="number" min={1} value={form.validity_months}
              onChange={(e) => set('validity_months', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mpv-reassess">Reassessment interval (months)</Label>
            <Input id="mpv-reassess" type="number" min={1} value={form.reassessment_months}
              onChange={(e) => set('reassessment_months', e.target.value)} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between rounded-md border p-3">
            <span className="text-sm">Count the spouse in the household</span>
            <Switch checked={form.count_spouse} onCheckedChange={(v) => set('count_spouse', v)} />
          </label>
          <label className="flex items-center justify-between rounded-md border p-3">
            <span className="text-sm">Count dependants in the household</span>
            <Switch checked={form.count_dependants} onCheckedChange={(v) => set('count_dependants', v)} />
          </label>
        </div>

        <div className="space-y-1">
          <Label htmlFor="mpv-evidence">Required evidence (one per line)</Label>
          <Textarea id="mpv-evidence" rows={4} value={evidenceText}
            onChange={(e) => setEvidenceText(e.target.value)}
            placeholder={'Bank statement\nPayslip or declaration of income'} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending} data-testid="means-policy-version-save">
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {version ? 'Save draft' : 'Create version'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BnMeansPolicyVersionDialog;
