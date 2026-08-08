/**
 * BN Uprating — Create run dialog (Epic 1).
 *
 * Creates a governed uprating run against an active, approved policy version.
 * No award or payment is affected: a run only defines what would be uprated.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2 } from 'lucide-react';

export interface UpratingPolicyVersionOption {
  readonly policy_version_id: string;
  readonly label: string;
  readonly policy_type: string;
  readonly effective_from: string | null;
  readonly effective_to: string | null;
}

export interface CreateRunFormValues {
  policy_version_id: string;
  run_name: string;
  target_effective_date: string;
  country_code: string;
  scope_award_type_code: string;
  scope_payment_frequency: string;
  scope_description: string;
}

const EMPTY: CreateRunFormValues = {
  policy_version_id: '',
  run_name: '',
  target_effective_date: '',
  country_code: 'KN',
  scope_award_type_code: '',
  scope_payment_frequency: '',
  scope_description: '',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionOptions: readonly UpratingPolicyVersionOption[];
  isSaving?: boolean;
  onSubmit: (values: CreateRunFormValues) => void | Promise<void>;
}

export const BnUpratingCreateRunDialog: React.FC<Props> = ({
  open,
  onOpenChange,
  versionOptions,
  isSaving,
  onSubmit,
}) => {
  const [form, setForm] = React.useState<CreateRunFormValues>(EMPTY);

  React.useEffect(() => {
    if (open) setForm(EMPTY);
  }, [open]);

  const set = <K extends keyof CreateRunFormValues>(key: K, value: CreateRunFormValues[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const canSubmit = !!form.policy_version_id && !!form.target_effective_date && !isSaving;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create uprating run</DialogTitle>
          <DialogDescription>
            A run describes what would be uprated. Creating a run does not change any award or payment.
          </DialogDescription>
        </DialogHeader>

        {versionOptions.length === 0 ? (
          <Alert>
            <AlertDescription>
              There is no active, approved policy version available. Approve and activate a policy version
              before creating a run.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="upr-run-version">Policy version</Label>
              <Select
                value={form.policy_version_id}
                onValueChange={(v) => set('policy_version_id', v)}
              >
                <SelectTrigger id="upr-run-version">
                  <SelectValue placeholder="Select an active policy version" />
                </SelectTrigger>
                <SelectContent>
                  {versionOptions.map((o) => (
                    <SelectItem key={o.policy_version_id} value={o.policy_version_id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
              <div className="grid gap-2">
                <Label htmlFor="upr-run-name">Run name</Label>
                <Input
                  id="upr-run-name"
                  value={form.run_name}
                  onChange={(e) => set('run_name', e.target.value)}
                  placeholder="Annual uprating"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="upr-run-date">Target effective date</Label>
                <Input
                  id="upr-run-date"
                  type="date"
                  value={form.target_effective_date}
                  onChange={(e) => set('target_effective_date', e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3 sm:gap-4">
              <div className="grid gap-2">
                <Label htmlFor="upr-run-country">Country</Label>
                <Input
                  id="upr-run-country"
                  value={form.country_code}
                  onChange={(e) => set('country_code', e.target.value.toUpperCase())}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="upr-run-award-type">Award type (optional)</Label>
                <Input
                  id="upr-run-award-type"
                  value={form.scope_award_type_code}
                  onChange={(e) => set('scope_award_type_code', e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="upr-run-frequency">Payment frequency (optional)</Label>
                <Input
                  id="upr-run-frequency"
                  value={form.scope_payment_frequency}
                  onChange={(e) => set('scope_payment_frequency', e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="upr-run-scope">Scope note</Label>
              <Textarea
                id="upr-run-scope"
                value={form.scope_description}
                onChange={(e) => set('scope_description', e.target.value)}
                placeholder="Describe the population this run is intended to cover."
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={() => void onSubmit(form)}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
