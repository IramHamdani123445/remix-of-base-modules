/**
 * Unified Payment Details section.
 *
 * The single component used across:
 *   • Claimant Portal — EFT update
 *   • Public online benefit application
 *   • Staff / Assisted intake
 *   • Claim Workbench
 *   • Entitlement setup
 *   • Payment Preparation (amend blocked payable)
 *   • EFT Update service
 *
 * Screens MUST NOT build their own bank form. Pass `channel` + `productId` and
 * this component pulls the right policy, uses master-data selectors for
 * bank/branch/method, and persists via paymentProfileService.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, ShieldAlert, Clock } from 'lucide-react';
import {
  getActiveProfile,
  getPaymentPolicy,
  getPendingChangeRequest,
  submitChangeRequest,
} from '@/services/bn/payment/paymentProfileService';
import { writeBnAudit } from '@/services/bn/audit/bnAuditService';
import BankSelector from '@/components/bn/selectors/BankSelector';
import BranchSelector from '@/components/bn/selectors/BranchSelector';
import PaymentMethodSelector from '@/components/bn/selectors/PaymentMethodSelector';
import type {
  BnPaymentChannel,
  BnPaymentMethod,
  BnPaymentPolicy,
  BnPaymentProfile,
  BnPaymentProfileChangeRequest,
  BnPaymentProfileDraft,
} from '@/types/bnPaymentProfile';
import { DEFAULT_PAYMENT_POLICY, maskAccount } from '@/types/bnPaymentProfile';

export interface PaymentDetailsSectionProps {
  mode?: 'view' | 'edit' | 'amend';
  channel: BnPaymentChannel;
  productId?: string | null;
  personSsn: string;
  payeeId?: string | null;
  claimId?: string | null;
  entitlementId?: string | null;
  userCode?: string;
  countryCode?: string | null;
  onSaved?: (profileOrRequest: BnPaymentProfile | BnPaymentProfileChangeRequest) => void;
  /** Callback fired once the product policy resolves — lets parent screens read flags
   *  like payment_required_at_application without re-querying. */
  onPolicyResolved?: (policy: BnPaymentPolicy, activeProfile: BnPaymentProfile | null) => void;
}

const ACCOUNT_TYPES = [
  { value: 'SAVINGS', label: 'Savings' },
  { value: 'CHEQUING', label: 'Chequing / Current' },
  { value: 'FIXED_DEPOSIT', label: 'Fixed Deposit' },
];
const HOLDER_RELATIONSHIPS = [
  { value: 'SELF', label: 'Self' },
  { value: 'GUARDIAN', label: 'Guardian' },
  { value: 'THIRD_PARTY_PAYEE', label: 'Third-party Payee' },
  { value: 'JOINT', label: 'Joint Holder' },
];

export default function PaymentDetailsSection(props: PaymentDetailsSectionProps) {
  const {
    mode = 'edit', channel, productId, personSsn, payeeId = null, claimId = null,
    entitlementId = null, userCode = 'SYSTEM', countryCode = null, onSaved, onPolicyResolved,
  } = props;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [policy, setPolicy] = useState<BnPaymentPolicy>(DEFAULT_PAYMENT_POLICY);
  const [active, setActive] = useState<BnPaymentProfile | null>(null);
  const [pending, setPending] = useState<BnPaymentProfileChangeRequest | null>(null);
  const [draft, setDraft] = useState<BnPaymentProfileDraft>({
    person_ssn: personSsn,
    payment_method: 'EFT',
    payment_currency: 'XCD',
  });
  const [reason, setReason] = useState('');
  const [rawAccount, setRawAccount] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});


  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [pol, prof, pend] = await Promise.all([
        getPaymentPolicy(productId ?? null),
        getActiveProfile(personSsn, { payeeId, currency: 'XCD' }),
        getPendingChangeRequest(personSsn, { claimId }),
      ]);
      if (!alive) return;
      setPolicy(pol);
      setActive(prof);
      setPending(pend);
      setDraft({
        person_ssn: personSsn,
        payee_id: payeeId,
        payment_method: prof?.payment_method ?? pol.default_payment_method ?? pol.allowed_payment_methods[0] ?? 'EFT',
        payment_currency: prof?.payment_currency ?? 'XCD',
        bank_name: prof?.bank_name ?? null,
        bank_code: prof?.bank_code ?? null,
        branch_name: prof?.branch_name ?? null,
        branch_code: prof?.branch_code ?? null,
        account_number_masked: prof?.account_number_masked ?? null,
        account_holder_name: prof?.account_holder_name ?? null,
        account_holder_relationship: prof?.account_holder_relationship ?? null,
        account_type: prof?.account_type ?? null,
        postal_address_snapshot: prof?.postal_address_snapshot ?? null,
      });
      setLoading(false);
      onPolicyResolved?.(pol, prof);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, personSsn, payeeId, claimId]);

  const allowedMethods = useMemo(
    () => policy.allowed_payment_methods.filter(Boolean),
    [policy.allowed_payment_methods],
  );

  function clearError(key: string) {
    setErrors((p) => {
      if (!p[key]) return p;
      const next = { ...p };
      delete next[key];
      return next;
    });
  }

  function update<K extends keyof BnPaymentProfileDraft>(k: K, v: BnPaymentProfileDraft[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

  function updateAddr(k: keyof NonNullable<BnPaymentProfileDraft['postal_address_snapshot']>, v: string) {
    setDraft((d) => ({ ...d, postal_address_snapshot: { ...(d.postal_address_snapshot ?? {}), [k]: v } }));
  }

  // Guards against a stale response overwriting a newer method switch.
  const methodSwitchToken = useRef(0);

  /**
   * Bank/account fields on screen belong to whichever profile is currently
   * loaded — never to the method the officer just picked. Re-fetch (or
   * clear) them on every method change so a switch to a different method
   * can't silently keep a prior method's account number attached.
   */
  async function handleMethodChange(newMethod: BnPaymentMethod) {
    const token = ++methodSwitchToken.current;
    setDraft((d) => ({
      ...d,
      payment_method: newMethod,
      bank_name: null,
      bank_code: null,
      branch_name: null,
      branch_code: null,
      account_number_masked: null,
      account_holder_name: null,
      account_holder_relationship: null,
      account_type: null,
    }));
    setRawAccount('');

    const prof = await getActiveProfile(personSsn, {
      payeeId, method: newMethod, currency: draft.payment_currency ?? 'XCD',
    });
    if (token !== methodSwitchToken.current) return; // a newer switch already landed
    setActive(prof);
    if (prof) {
      setDraft((d) => ({
        ...d,
        bank_name: prof.bank_name ?? null,
        bank_code: prof.bank_code ?? null,
        branch_name: prof.branch_name ?? null,
        branch_code: prof.branch_code ?? null,
        account_number_masked: prof.account_number_masked ?? null,
        account_holder_name: prof.account_holder_name ?? null,
        account_holder_relationship: prof.account_holder_relationship ?? null,
        account_type: prof.account_type ?? null,
      }));
    }
  }

  async function handleSubmit() {
    const fieldErrors: Record<string, string> = {};
    if (draft.payment_method === 'EFT') {
      if (!draft.bank_code) fieldErrors.bank = 'Bank is required';
      if (!draft.branch_code) fieldErrors.branch = 'Branch is required';
      if (!rawAccount.trim() && !draft.account_number_masked) {
        fieldErrors.account_number = 'Account number is required';
      } else if (rawAccount.trim() && !/^[0-9]{4,20}$/.test(rawAccount.trim())) {
        fieldErrors.account_number = 'Account number must be 4–20 digits';
      }
      if (!draft.account_holder_name?.trim()) fieldErrors.account_holder_name = 'Account holder name is required';
    }
    if (draft.payment_method === 'CHEQUE' && policy.cheque_address_required) {
      const a = draft.postal_address_snapshot;
      if (!a?.line1) fieldErrors.line1 = 'Postal address line 1 is required for cheque payments';
      if (!a?.city) fieldErrors.city = 'City is required for cheque payments';
    }
    if (policy.require_proof_for_change && !reason.trim()) {
      fieldErrors.reason = 'Please provide a reason for this change';
    }
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      toast.error('Please check the payment details for valid information!', {
        description: Object.values(fieldErrors).join(' • '),
      });
      return;
    }


    const masked = rawAccount ? maskAccount(rawAccount) : draft.account_number_masked ?? null;

    setSaving(true);
    try {
      const result = await submitChangeRequest({
        personSsn, payeeId, channel, claimId, entitlementId,
        reason: reason || undefined,
        policy, userCode,
        draft: { ...draft, account_number_masked: masked } as BnPaymentProfileDraft,
      });
      toast.success(
        result.status === 'APPROVED'
          ? 'Payment details updated'
          : 'Change submitted for approval',
      );

      // Audit: payment profile changed (non-critical trail, fire-and-forget shielded).
      void writeBnAudit({
        module: 'BN_PAYMENT',
        entityType: 'bn_payment_profile',
        entityId: (result as any).id ?? null,
        action: 'PAYMENT_PROFILE_CHANGED',
        afterValue: {
          person_ssn: personSsn,
          payment_method: draft.payment_method,
          bank_code: draft.bank_code,
          branch_code: draft.branch_code,
          account_number_masked: masked,
          status: (result as any).status ?? 'APPROVED',
          channel,
          claim_id: claimId,
        },
        performedBy: userCode,
        severity: 'info',
        notes: reason || null,
      }).catch((e) => console.warn('[PaymentDetails] audit failed', e));

      setRawAccount('');
      onSaved?.(result);
      const [prof, pend] = await Promise.all([
        getActiveProfile(personSsn, { payeeId, currency: 'XCD' }),
        getPendingChangeRequest(personSsn, { claimId }),
      ]);
      setActive(prof);
      setPending(pend);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not save payment details');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading payment details…
        </CardContent>
      </Card>
    );
  }

  // Respect product-level visibility.
  if (policy.payment_details_visibility === 'HIDE') return null;
  const effectiveMode: 'view' | 'edit' | 'amend' =
    policy.payment_details_visibility === 'READONLY' ? 'view' : mode;
  const readOnly = effectiveMode === 'view';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Payment Details</CardTitle>
          <div className="flex items-center gap-2">
            {active?.verification_status === 'VERIFIED' && (
              <Badge variant="secondary" className="gap-1"><ShieldCheck className="h-3 w-3" /> Verified</Badge>
            )}
            {active && active.verification_status !== 'VERIFIED' && (
              <Badge variant="outline" className="gap-1"><ShieldAlert className="h-3 w-3" /> {active.verification_status}</Badge>
            )}
            {pending && (
              <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" /> Pending change</Badge>
            )}
            {policy.payment_details_visibility === 'READONLY' && (
              <Badge variant="outline">Read-only (product policy)</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {active && (
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <div className="font-medium mb-1">Current active profile</div>
            <div className="grid grid-cols-2 gap-1 text-muted-foreground">
              <div>Method: {active.payment_method}</div>
              <div>Currency: {active.payment_currency}</div>
              {active.bank_name && <div>Bank: {active.bank_name}</div>}
              {active.account_number_masked && <div>Account: {active.account_number_masked}</div>}
              {active.account_holder_name && <div>Holder: {active.account_holder_name}</div>}
              <div>Effective from: {active.effective_from}</div>
            </div>
          </div>
        )}

        {!readOnly && (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Payment method</Label>
                <PaymentMethodSelector
                  value={draft.payment_method}
                  onChange={handleMethodChange}
                  allowedMethods={allowedMethods}
                />
              </div>
              <div>
                <Label>Currency</Label>
                <Input
                  value={draft.payment_currency ?? 'XCD'}
                  onChange={(e) => update('payment_currency', e.target.value.toUpperCase())}
                />
              </div>
            </div>

            {draft.payment_method === 'EFT' && (
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label>Bank <span className="text-destructive">*</span></Label>
                  <BankSelector
                    value={draft.bank_code ?? ''}
                    countryCode={countryCode}
                    onChange={(b) => {
                      setDraft((d) => ({
                        ...d,
                        bank_code: b?.bank_code ?? null,
                        bank_name: b?.bank_name ?? null,
                        // clear branch when bank changes
                        branch_code: null,
                        branch_name: null,
                      }));
                      clearError('bank');
                    }}
                    className={errors.bank ? 'border-destructive' : undefined}
                  />
                  {errors.bank && <p className="text-xs text-destructive mt-1">{errors.bank}</p>}
                </div>
                <div>
                  <Label>Branch <span className="text-destructive">*</span></Label>
                  <BranchSelector
                    bankCode={draft.bank_code ?? null}
                    value={draft.branch_code ?? ''}
                    onChange={(br) => {
                      setDraft((d) => ({
                        ...d,
                        branch_code: br?.branch_code ?? null,
                        branch_name: br?.branch_name ?? null,
                      }));
                      clearError('branch');
                    }}
                    className={errors.branch ? 'border-destructive' : undefined}
                  />
                  {errors.branch && <p className="text-xs text-destructive mt-1">{errors.branch}</p>}
                </div>
                <div>
                  <Label>Account number <span className="text-destructive">*</span></Label>
                  <Input
                    inputMode="numeric"
                    maxLength={20}
                    aria-invalid={!!errors.account_number}
                    placeholder={draft.account_number_masked ?? '••••1234'}
                    value={rawAccount}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 20);
                      setRawAccount(digits);
                      clearError('account_number');
                    }}
                    onBlur={() => {
                      if (!rawAccount.trim() && !draft.account_number_masked) {
                        setErrors((p) => ({ ...p, account_number: 'Account number is required' }));
                      } else if (rawAccount.trim() && rawAccount.trim().length < 4) {
                        setErrors((p) => ({ ...p, account_number: 'Account number must be 4–20 digits' }));
                      }
                    }}
                    className={errors.account_number ? 'border-destructive focus-visible:ring-destructive' : undefined}
                  />
                  {errors.account_number
                    ? <p className="text-xs text-destructive mt-1">{errors.account_number}</p>
                    : <p className="text-xs text-muted-foreground mt-1">Stored masked; raw digits never displayed back.</p>}
                </div>
                <div>
                  <Label>Account type</Label>
                  <Select
                    value={draft.account_type ?? ''}
                    onValueChange={(v) => update('account_type', v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Account holder name <span className="text-destructive">*</span></Label>
                  <Input
                    value={draft.account_holder_name ?? ''}
                    aria-invalid={!!errors.account_holder_name}
                    onChange={(e) => { update('account_holder_name', e.target.value); clearError('account_holder_name'); }}
                    className={errors.account_holder_name ? 'border-destructive focus-visible:ring-destructive' : undefined}
                  />
                  {errors.account_holder_name && <p className="text-xs text-destructive mt-1">{errors.account_holder_name}</p>}
                </div>

                {(policy.allow_third_party_payee || policy.allow_guardian_payee) && (
                  <div>
                    <Label>Holder relationship</Label>
                    <Select
                      value={draft.account_holder_relationship ?? ''}
                      onValueChange={(v) => update('account_holder_relationship', v)}
                    >
                      <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        {HOLDER_RELATIONSHIPS
                          .filter((r) => {
                            if (r.value === 'GUARDIAN') return policy.allow_guardian_payee;
                            if (r.value === 'THIRD_PARTY_PAYEE') return policy.allow_third_party_payee;
                            return true;
                          })
                          .map((r) => (
                            <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}

            {draft.payment_method === 'CHEQUE' && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <Label>Postal address — Line 1</Label>
                  <Input value={draft.postal_address_snapshot?.line1 ?? ''} onChange={(e) => updateAddr('line1', e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <Label>Line 2</Label>
                  <Input value={draft.postal_address_snapshot?.line2 ?? ''} onChange={(e) => updateAddr('line2', e.target.value)} />
                </div>
                <div>
                  <Label>City / Town</Label>
                  <Input value={draft.postal_address_snapshot?.city ?? ''} onChange={(e) => updateAddr('city', e.target.value)} />
                </div>
                <div>
                  <Label>Parish / State</Label>
                  <Input value={draft.postal_address_snapshot?.parish ?? ''} onChange={(e) => updateAddr('parish', e.target.value)} />
                </div>
                <div>
                  <Label>Postal code</Label>
                  <Input value={draft.postal_address_snapshot?.postal_code ?? ''} onChange={(e) => updateAddr('postal_code', e.target.value)} />
                </div>
                <div>
                  <Label>Country</Label>
                  <Input value={draft.postal_address_snapshot?.country ?? ''} onChange={(e) => updateAddr('country', e.target.value)} />
                </div>
              </div>
            )}

            {(policy.require_proof_for_change || effectiveMode === 'amend') && (
              <div>
                <Label>Reason for change</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button onClick={handleSubmit} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {effectiveMode === 'amend' ? 'Submit amendment' : 'Save payment details'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Channel: <span className="font-mono">{channel}</span>
              {policy.require_supervisor_approval_for_change && ' • Supervisor approval required for this product'}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
