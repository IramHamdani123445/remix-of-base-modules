import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowDown, Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  getActivePartialPaymentPolicy,
  listPaymentCategories,
  updatePartialPaymentPolicy,
  type PartialPaymentPolicy,
} from '@/services/partialPaymentService';

export function PartialPaymentPolicyCard() {
  const qc = useQueryClient();
  const { data: policy, isLoading } = useQuery({
    queryKey: ['ce-pp-policy'],
    queryFn: () => getActivePartialPaymentPolicy(),
  });
  const { data: categories } = useQuery({ queryKey: ['ce-payment-categories'], queryFn: listPaymentCategories });
  const [draft, setDraft] = useState<PartialPaymentPolicy | null>(null);

  useEffect(() => { if (policy) setDraft(policy); }, [policy]);

  const save = useMutation({
    mutationFn: () => updatePartialPaymentPolicy(draft!.id, {
      allocation_order: draft!.allocation_order,
      allow_allocation_override: draft!.allow_allocation_override,
      minimum_acceptable_percent: Number(draft!.minimum_acceptable_percent),
      minimum_acceptable_amount: Number(draft!.minimum_acceptable_amount),
      extends_payment_grace: draft!.extends_payment_grace,
      max_grace_extension_days: Number(draft!.max_grace_extension_days),
      authority_validity_days: Number(draft!.authority_validity_days),
      required_approval_role: draft!.required_approval_role,
      escalated_approval_role: draft!.escalated_approval_role,
      escalation_threshold_amount: draft!.escalation_threshold_amount,
      require_separate_approver: draft!.require_separate_approver,
      block_when_arrangement_active: draft!.block_when_arrangement_active,
    }),
    onSuccess: () => {
      toast.success('Partial payment policy updated');
      qc.invalidateQueries({ queryKey: ['ce-pp-policy'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not save the policy'),
  });

  if (isLoading || !draft) {
    return (
      <Card>
        <CardHeader><CardTitle>Partial payment policy</CardTitle></CardHeader>
        <CardContent className="text-muted-foreground text-sm">Loading…</CardContent>
      </Card>
    );
  }

  const move = (index: number, delta: number) => {
    const order = [...draft.allocation_order];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    setDraft({ ...draft, allocation_order: order });
  };

  const availableCodes = (categories ?? [])
    .map((c) => c.payment_code)
    .filter((code) => !draft.allocation_order.includes(code));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Partial payment policy (DR-004)</CardTitle>
            <CardDescription>
              Governs who may approve a partial payment, how the money is allocated, and how long the
              resulting payment authority stays valid. There are no hard-coded thresholds — these values
              are the only ones the runtime uses.
            </CardDescription>
          </div>
          <Badge variant="outline">{draft.policy_code}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Label>Allocation order</Label>
          <p className="text-xs text-muted-foreground mb-2">
            Money is applied top-down. Categories not listed here are never funded automatically.
          </p>
          <div className="space-y-1">
            {draft.allocation_order.map((code, idx) => {
              const meta = (categories ?? []).find((c) => c.payment_code === code);
              return (
                <div key={code} className="flex items-center gap-2 rounded-md border p-2">
                  <span className="w-6 text-xs text-muted-foreground">{idx + 1}</span>
                  <span className="font-medium">{code}</span>
                  <span className="text-sm text-muted-foreground flex-1">
                    {meta?.payment_type_description ?? 'Unknown category'}
                  </span>
                  <Button size="icon" variant="ghost" onClick={() => move(idx, -1)} aria-label={`Move ${code} up`}>
                    <ArrowDown className="h-4 w-4 rotate-180" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => move(idx, 1)} aria-label={`Move ${code} down`}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDraft({ ...draft, allocation_order: draft.allocation_order.filter((c) => c !== code) })
                    }
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>
          {availableCodes.length > 0 && (
            <div className="mt-2 w-72">
              <Select onValueChange={(v) => setDraft({ ...draft, allocation_order: [...draft.allocation_order, v] })}>
                <SelectTrigger><SelectValue placeholder="Add a payment category…" /></SelectTrigger>
                <SelectContent>
                  {availableCodes.map((code) => (
                    <SelectItem key={code} value={code}>{code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Minimum acceptable %" hint="Of the outstanding liability. 0 disables the check.">
            <Input type="number" min="0" max="100" step="0.01" value={draft.minimum_acceptable_percent}
              onChange={(e) => setDraft({ ...draft, minimum_acceptable_percent: Number(e.target.value) })} />
          </Field>
          <Field label="Minimum acceptable amount (XCD)" hint="0 disables the check.">
            <Input type="number" min="0" step="0.01" value={draft.minimum_acceptable_amount}
              onChange={(e) => setDraft({ ...draft, minimum_acceptable_amount: Number(e.target.value) })} />
          </Field>
          <Field label="Authority validity (days)" hint="How long an approved payment authority can be paid against.">
            <Input type="number" min="1" value={draft.authority_validity_days}
              onChange={(e) => setDraft({ ...draft, authority_validity_days: Number(e.target.value) })} />
          </Field>
          <Field label="Approval role" hint="Minimum role able to approve.">
            <Select value={draft.required_approval_role}
              onValueChange={(v) => setDraft({ ...draft, required_approval_role: v as PartialPaymentPolicy['required_approval_role'] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="inspector">Inspector</SelectItem>
                <SelectItem value="senior">Senior inspector</SelectItem>
                <SelectItem value="head">Head of compliance</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Escalated approval role" hint="Applies at or above the threshold below.">
            <Select value={draft.escalated_approval_role}
              onValueChange={(v) => setDraft({ ...draft, escalated_approval_role: v as PartialPaymentPolicy['escalated_approval_role'] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="inspector">Inspector</SelectItem>
                <SelectItem value="senior">Senior inspector</SelectItem>
                <SelectItem value="head">Head of compliance</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Escalation threshold (XCD)" hint="Leave empty for no escalation.">
            <Input type="number" min="0" step="0.01" value={draft.escalation_threshold_amount ?? ''}
              onChange={(e) => setDraft({ ...draft, escalation_threshold_amount: e.target.value === '' ? null : Number(e.target.value) })} />
          </Field>
          <Field label="Maximum grace extension (days)" hint="Only used when grace extension is enabled.">
            <Input type="number" min="0" value={draft.max_grace_extension_days}
              disabled={!draft.extends_payment_grace}
              onChange={(e) => setDraft({ ...draft, max_grace_extension_days: Number(e.target.value) })} />
          </Field>
        </div>

        <div className="space-y-3">
          <Toggle label="Approval may extend the payment grace period"
            description="When off, an approved partial payment never moves the payment deadline."
            checked={draft.extends_payment_grace}
            onChange={(v) => setDraft({ ...draft, extends_payment_grace: v })} />
          <Toggle label="Compliance may change the requested allocation"
            description="Allows the approver to redistribute the offered amount across categories."
            checked={draft.allow_allocation_override}
            onChange={(v) => setDraft({ ...draft, allow_allocation_override: v })} />
          <Toggle label="Approver must be a different person from the requester"
            description="Separation of duties. Enforced in the database, not only in this screen."
            checked={draft.require_separate_approver}
            onChange={(v) => setDraft({ ...draft, require_separate_approver: v })} />
          <Toggle label="Block requests while a payment arrangement is active"
            description="Prevents a partial payment competing with an existing instalment plan."
            checked={draft.block_when_arrangement_active}
            onChange={(v) => setDraft({ ...draft, block_when_arrangement_active: v })} />
        </div>

        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending || draft.allocation_order.length === 0}>
            <Save className="h-4 w-4 mr-2" /> Save policy
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Toggle({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
