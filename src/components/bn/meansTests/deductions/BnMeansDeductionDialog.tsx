/**
 * MEANS-TEST EPIC 5 — record a deduction claim or a potential disregard.
 *
 * The form captures WHAT is claimed, AGAINST WHICH SUBJECT, FOR WHAT REASON
 * and FOR WHAT PERIOD. It never states how much will be allowed: the
 * allowance is decided by policy at calculation.
 */
import React from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  MeansDateField,
  MeansGovernedSelect,
  MeansMoneyInput,
  MeansPercentageInput,
  MeansStateNotice,
} from '@/components/bn/meansTests/controls/MeansControls';
import type { BnMeansLoadState, BnMeansOptionSet } from '@/types/bn/meansTests/meansFieldContract';
import { formatWithCurrency } from '@/utils/formatCurrency';
import {
  categoriesForKind,
  deductionPayload,
  deductionReasonLabel,
  emptyDeductionDraft,
  findDeductionCategory,
  previewClaimedAnnualAmount,
  validateDeductionDraft,
  type BnMeansClaimKind,
  type BnMeansDeductionAssetTarget,
  type BnMeansDeductionDraft,
  type BnMeansDeductionIncomeTarget,
  type BnMeansDeductionMemberRef,
  type BnMeansDeductionReference,
  type BnMeansDeductionRules,
  type BnMeansDeductionTargetKind,
} from '@/types/bn/meansTests/meansDeductions';

export interface BnMeansDeductionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDraft: BnMeansDeductionDraft | null;
  currency: string;
  assessmentFrom: string;
  assessmentTo: string | null;
  members: readonly BnMeansDeductionMemberRef[];
  incomeTargets: readonly BnMeansDeductionIncomeTarget[];
  assetTargets: readonly BnMeansDeductionAssetTarget[];
  rules: BnMeansDeductionRules;
  reference: BnMeansDeductionReference | null;
  referenceState: Exclude<BnMeansLoadState, 'EMPTY'>;
  referenceReason?: string | null;
  busy: boolean;
  commandError: { code: string; message: string } | null;
  onSubmit: (payload: Record<string, unknown>, draft: BnMeansDeductionDraft) => void;
}

function set(
  options: readonly { value: string; label: string; description?: string }[] | undefined,
  state: BnMeansLoadState,
  reason?: string | null,
): BnMeansOptionSet {
  return {
    state: state === 'SUCCESS' && (options ?? []).length === 0 ? 'EMPTY' : state,
    options: options ?? [],
    reason: reason ?? undefined,
  };
}

export const BnMeansDeductionDialog: React.FC<BnMeansDeductionDialogProps> = ({
  open, onOpenChange, initialDraft, currency, assessmentFrom, assessmentTo, members,
  incomeTargets, assetTargets, rules, reference, referenceState, referenceReason,
  busy, commandError, onSubmit,
}) => {
  const [draft, setDraft] = React.useState<BnMeansDeductionDraft>(
    () => initialDraft ?? emptyDeductionDraft(assessmentFrom),
  );
  const [submitted, setSubmitted] = React.useState(false);

  // The form is seeded when it opens; a failed command must never clear it.
  React.useEffect(() => {
    if (open) {
      setDraft(initialDraft ?? emptyDeductionDraft(assessmentFrom));
      setSubmitted(false);
    }
  }, [open, initialDraft, assessmentFrom]);

  const category = findDeductionCategory(reference, draft.categoryCode);
  const member = members.find((m) => m.member_id === draft.memberId) ?? null;
  const errors = validateDeductionDraft(draft, {
    category,
    rules,
    assessmentFrom,
    assessmentTo,
    member,
  });
  const showError = (key: string) => (submitted ? errors[key] ?? null : null);
  const editing = Boolean(draft.deductionFactId);
  const annual = previewClaimedAnnualAmount(draft);

  const categoryOptions = categoriesForKind(reference, draft.claimKind).map((c) => ({
    value: c.value,
    label: c.label,
    description: c.description,
  }));

  const allowedTargets = (category?.allowed_target_types ?? []).filter(
    (t) => t !== 'ASSESSMENT' || rules.allow_assessment_level_claims !== false,
  );
  const targetKindOptions = (reference?.DEDUCTION_TARGET_KIND ?? []).filter((o) =>
    allowedTargets.includes(o.value as BnMeansDeductionTargetKind),
  );

  const memberOptions = members.map((m) => ({
    value: m.member_id,
    label: m.display_name,
    description: `${m.relationship_label} · ${m.is_current ? 'Current member' : 'Membership ended'}`,
  }));
  const incomeOptions = incomeTargets.map((t) => ({
    value: t.income_fact_id,
    label: `${t.category_label}${t.source_name ? ` · ${t.source_name}` : ''}`,
    description: `${t.member_name ?? 'Household'} · ${formatWithCurrency(
      t.declared_amount,
      t.currency_code,
    )} ${t.declared_frequency_label} · ${t.effective_from} → ${t.effective_to ?? 'present'}`,
  }));
  const assetOptions = assetTargets.map((t) => ({
    value: t.asset_fact_id,
    label: `${t.category_label}${t.description ? ` · ${t.description}` : ''}`,
    description: `${t.member_name ?? 'Household'} · ${formatWithCurrency(
      t.valuation_amount,
      t.currency_code,
    )} · valued ${t.valuation_date}`,
  }));

  function update(patch: Partial<BnMeansDeductionDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  /** Ownership context follows the subject: claims always resolve to a member. */
  function selectTargetRef(value: string) {
    let memberId = draft.memberId;
    if (draft.targetKind === 'HOUSEHOLD_MEMBER') memberId = value;
    if (draft.targetKind === 'INCOME_FACT') {
      memberId = incomeTargets.find((t) => t.income_fact_id === value)?.member_id ?? '';
    }
    if (draft.targetKind === 'ASSET_FACT') {
      memberId = assetTargets.find((t) => t.asset_fact_id === value)?.member_id ?? '';
    }
    update({ targetRefId: value, memberId });
  }

  function submit() {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    onSubmit(deductionPayload(draft, { currency }), draft);
  }

  const targetSelector = () => {
    if (!draft.targetKind || draft.targetKind === 'ASSESSMENT') return null;
    const config = {
      HOUSEHOLD_MEMBER: {
        label: 'Household member',
        placeholder: 'Select the member…',
        options: memberOptions,
        empty: 'Add household members before recording claims.',
      },
      INCOME_FACT: {
        label: 'Recorded income',
        placeholder: 'Select the income record…',
        options: incomeOptions,
        empty: 'No income records exist on this assessment.',
      },
      ASSET_FACT: {
        label: 'Recorded asset',
        placeholder: 'Select the asset record…',
        options: assetOptions,
        empty: 'No asset records exist on this assessment.',
      },
    }[draft.targetKind];
    return (
      <MeansGovernedSelect
        id="means-deduction-target-ref"
        label={config.label}
        description="Only records already held on this assessment can be selected."
        required
        optionSet={set(
          config.options,
          config.options.length === 0 ? 'EMPTY' : 'SUCCESS',
          config.options.length === 0 ? config.empty : null,
        )}
        value={draft.targetRefId}
        placeholder={config.placeholder}
        error={showError('targetRefId')}
        onChange={selectTargetRef}
      />
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="means-deduction-dialog">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? 'Correct claim'
              : draft.claimKind === 'DISREGARD_CANDIDATE'
                ? 'Record a potential disregard'
                : 'Claim a deduction'}
          </DialogTitle>
          <DialogDescription>
            Record what is being claimed, against which subject, for what reason and for what
            period. How much is allowed is decided by policy at calculation.
          </DialogDescription>
        </DialogHeader>

        {commandError && (
          <Alert variant="destructive" data-testid="means-deduction-dialog-error">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>This claim was not saved</AlertTitle>
            <AlertDescription>
              {deductionReasonLabel(commandError.code)}
              {commandError.message && commandError.message !== commandError.code
                ? ` — ${commandError.message}`
                : ''}
            </AlertDescription>
          </Alert>
        )}

        {referenceState !== 'SUCCESS' && (
          <MeansStateNotice
            state={referenceState}
            reason={referenceReason ?? 'Deduction reference data could not be loaded.'}
            testId="means-deduction-reference-state"
          />
        )}

        <div className="space-y-4">
          <MeansGovernedSelect
            id="means-deduction-claim-kind"
            label="What is being recorded"
            description="A deduction is claimed against the household. A disregard is a policy basis for excluding a record."
            required
            optionSet={set(
              [
                {
                  value: 'DEDUCTION_CLAIM',
                  label: 'Deduction claimed',
                  description: 'An expense or obligation claimed against the household.',
                },
                {
                  value: 'DISREGARD_CANDIDATE',
                  label: 'Potential disregard',
                  description: 'A policy basis that may exclude a recorded income or asset.',
                },
              ],
              'SUCCESS',
            )}
            value={draft.claimKind}
            onChange={(value) =>
              update({
                claimKind: value as BnMeansClaimKind,
                categoryCode: '',
                targetKind: '',
                targetRefId: '',
                memberId: '',
                claimedAmount: '',
                claimedPercentage: '',
                declaredFrequency: '',
                claimReasonCode: '',
              })
            }
          />

          <MeansGovernedSelect
            id="means-deduction-category"
            label="Policy category"
            description="Categories come from the governed policy reference list."
            required
            optionSet={set(categoryOptions, referenceState, referenceReason)}
            value={draft.categoryCode}
            placeholder="Select a category…"
            error={showError('categoryCode')}
            onChange={(value) => {
              const next = findDeductionCategory(reference, value);
              const only =
                next && next.allowed_target_types.length === 1 ? next.allowed_target_types[0] : '';
              update({
                categoryCode: value,
                targetKind: only,
                targetRefId: '',
                memberId: '',
                claimedPercentage: '',
              });
            }}
          />

          {category?.maximum_rule_reference && (
            <p className="text-xs text-muted-foreground" data-testid="means-deduction-cap-note">
              A policy limit applies to this category. The limit is applied at calculation, not
              here — record the full amount claimed.
            </p>
          )}

          <MeansGovernedSelect
            id="means-deduction-target-kind"
            label="Claimed against"
            description="Every claim must name the subject it applies to."
            required
            optionSet={set(
              targetKindOptions,
              category ? 'SUCCESS' : 'EMPTY',
              category ? undefined : 'Select a policy category first.',
            )}
            value={draft.targetKind}
            placeholder="What does this apply to?"
            error={showError('targetKind')}
            onChange={(value) =>
              update({
                targetKind: value as BnMeansDeductionTargetKind,
                targetRefId: '',
                memberId: '',
              })
            }
          />

          {targetSelector()}

          {draft.targetKind === 'ASSESSMENT' && (
            <p className="text-xs text-muted-foreground" data-testid="means-deduction-assessment-target">
              This claim applies to the household assessment as a whole rather than to one
              member or record.
            </p>
          )}

          {member && !member.is_current && (
            <p className="text-xs text-muted-foreground" data-testid="means-deduction-member-ended">
              Membership ended {member.member_to}. The claim period should sit inside the
              membership period.
            </p>
          )}

          {(category?.requires_amount || draft.claimedAmount) && (
            <div className="grid gap-4 sm:grid-cols-2">
              <MeansMoneyInput
                id="means-deduction-amount"
                label="Amount claimed"
                description={`Recorded in the assessment currency (${currency}). This is the amount claimed, not the amount allowed.`}
                required={category?.requires_amount === true}
                currency={currency}
                value={draft.claimedAmount}
                onChange={(raw) => update({ claimedAmount: raw })}
                error={showError('claimedAmount')}
              />
              <MeansGovernedSelect
                id="means-deduction-frequency"
                label="Frequency"
                description="How often the claimed amount arises."
                required={category?.requires_frequency === true}
                optionSet={set(reference?.DEDUCTION_FREQUENCY, referenceState, referenceReason)}
                value={draft.declaredFrequency}
                placeholder="How often?"
                error={showError('declaredFrequency')}
                onChange={(value) => update({ declaredFrequency: value })}
              />
            </div>
          )}

          {annual !== null && (
            <p className="text-xs text-muted-foreground" data-testid="means-deduction-annual-preview">
              Claimed annual equivalent: {formatWithCurrency(annual, currency)}. The stored value
              is recalculated by the assessment engine, and the allowed amount is decided at
              calculation.
            </p>
          )}

          {category?.allows_partial_claim && (
            <MeansPercentageInput
              id="means-deduction-percentage"
              label="Proportion claimed"
              description="Optional. Use where only part of the record is claimed."
              value={draft.claimedPercentage}
              onChange={(raw) => update({ claimedPercentage: raw })}
              min={0}
              max={100}
              error={showError('claimedPercentage')}
            />
          )}

          <MeansGovernedSelect
            id="means-deduction-reason"
            label={draft.claimKind === 'DISREGARD_CANDIDATE' ? 'Policy basis' : 'Reason claimed'}
            description="Why the policy recognises this claim."
            required={category?.requires_reason === true}
            optionSet={set(reference?.DEDUCTION_REASON, referenceState, referenceReason)}
            value={draft.claimReasonCode}
            placeholder="Select the basis…"
            error={showError('claimReasonCode')}
            onChange={(value) => update({ claimReasonCode: value })}
          />

          <div className="space-y-1.5">
            <Label htmlFor="means-deduction-basis">Claim basis in the officer’s words</Label>
            <p className="text-xs text-muted-foreground">
              Optional. Explain the claim so it can be assessed and explained later.
            </p>
            <Textarea
              id="means-deduction-basis"
              data-testid="means-deduction-basis"
              rows={2}
              value={draft.claimBasis}
              onChange={(e) => update({ claimBasis: e.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <MeansDateField
              id="means-deduction-from"
              label="Claimed from"
              required={category?.requires_period === true}
              value={draft.effectiveFrom}
              onChange={(value) => update({ effectiveFrom: value })}
              error={showError('effectiveFrom')}
            />
            <MeansDateField
              id="means-deduction-to"
              label="Claimed to"
              description="Leave empty while the claim continues."
              value={draft.effectiveTo}
              onChange={(value) => update({ effectiveTo: value })}
              error={showError('effectiveTo')}
            />
          </div>

          <MeansGovernedSelect
            id="means-deduction-fact-source"
            label="Information source"
            description="Records where this information came from. It does not mean the claim is verified."
            required
            optionSet={set(reference?.DEDUCTION_FACT_SOURCE, referenceState, referenceReason)}
            value={draft.factSource}
            placeholder="Select the source…"
            error={showError('factSource')}
            onChange={(value) => update({ factSource: value })}
          />

          {category?.requires_evidence && (
            <div className="rounded-md border bg-muted/30 px-3 py-2" data-testid="means-deduction-evidence-note">
              <p className="text-xs uppercase text-muted-foreground">Evidence requirement</p>
              <p className="text-sm font-medium">
                Evidence is required for this category{' '}
                <Badge variant="outline" className="ml-1">Set by policy</Badge>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                The requirement is recorded now. Evidence itself is attached in the evidence
                stage.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="means-deduction-notes">Notes</Label>
            <Textarea
              id="means-deduction-notes"
              rows={2}
              value={draft.notes}
              onChange={(e) => update({ notes: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={busy} data-testid="means-deduction-save">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? 'Save correction' : 'Record claim'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BnMeansDeductionDialog;
