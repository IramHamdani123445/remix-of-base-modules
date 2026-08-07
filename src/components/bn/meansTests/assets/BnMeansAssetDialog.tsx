/**
 * MEANS-TEST EPIC 4 — add / correct an asset record.
 *
 * The form shape is decided by the governed asset category metadata, not by
 * hard-coded statutory assumptions. Whether an asset is actually disregarded
 * is decided at calculation: the officer only flags a potential disregard.
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
  MeansBooleanField,
  MeansDateField,
  MeansGovernedSelect,
  MeansMoneyInput,
  MeansPercentageInput,
  MeansStateNotice,
} from '@/components/bn/meansTests/controls/MeansControls';
import type { BnMeansLoadState, BnMeansOptionSet } from '@/types/bn/meansTests/meansFieldContract';
import { formatWithCurrency } from '@/utils/formatCurrency';
import {
  assetPayload,
  assetReasonLabel,
  emptyAssetDraft,
  findAssetCategory,
  previewAttributableAmount,
  resolveValuationBasis,
  validateAssetDraft,
  type BnMeansAssetDraft,
  type BnMeansAssetMemberRef,
  type BnMeansAssetReference,
  type BnMeansAssetRules,
} from '@/types/bn/meansTests/meansAssets';

export interface BnMeansAssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDraft: BnMeansAssetDraft | null;
  currency: string;
  assessmentFrom: string;
  assessmentTo: string | null;
  members: readonly BnMeansAssetMemberRef[];
  rules: BnMeansAssetRules;
  reference: BnMeansAssetReference | null;
  referenceState: Exclude<BnMeansLoadState, 'EMPTY'>;
  referenceReason?: string | null;
  busy: boolean;
  commandError: { code: string; message: string } | null;
  onSubmit: (payload: Record<string, unknown>, draft: BnMeansAssetDraft) => void;
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

const TextField: React.FC<{
  id: string;
  label: string;
  description?: string;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}> = ({ id, label, description, required, value, onChange, error }) => (
  <div className="space-y-1.5">
    <Label htmlFor={id}>
      {label}
      {required && <span className="text-destructive" aria-hidden="true"> *</span>}
    </Label>
    {description && <p className="text-xs text-muted-foreground">{description}</p>}
    <Input
      id={id}
      data-testid={id}
      value={value}
      aria-required={required || undefined}
      aria-invalid={error ? true : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
    {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
  </div>
);

export const BnMeansAssetDialog: React.FC<BnMeansAssetDialogProps> = ({
  open, onOpenChange, initialDraft, currency, assessmentFrom, assessmentTo, members,
  rules, reference, referenceState, referenceReason, busy, commandError, onSubmit,
}) => {
  const [draft, setDraft] = React.useState<BnMeansAssetDraft>(
    () => initialDraft ?? emptyAssetDraft(assessmentFrom),
  );
  const [submitted, setSubmitted] = React.useState(false);

  // The form is seeded when it opens; a failed command must never clear it.
  React.useEffect(() => {
    if (open) {
      setDraft(initialDraft ?? emptyAssetDraft(assessmentFrom));
      setSubmitted(false);
    }
  }, [open, initialDraft, assessmentFrom]);

  const category = findAssetCategory(reference, draft.categoryCode);
  const member = members.find((m) => m.member_id === draft.memberId) ?? null;
  const errors = validateAssetDraft(draft, {
    category,
    rules,
    assessmentFrom,
    assessmentTo,
    member,
  });
  const showError = (key: string) => (submitted ? errors[key] ?? null : null);
  const basis = resolveValuationBasis(category, draft.valuationBasis);
  const attributable = previewAttributableAmount(draft);
  const editing = Boolean(draft.assetFactId);

  const memberOptions = members.map((m) => ({
    value: m.member_id,
    label: m.display_name,
    description: `${m.relationship_label} · ${m.is_current ? 'Current member' : 'Membership ended'} · ${
      m.dependency_decision_label
    }`,
  }));

  function update(patch: Partial<BnMeansAssetDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function submit() {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    onSubmit(assetPayload(draft, { category, currency }), draft);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="means-asset-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? 'Correct asset record' : 'Add asset'}</DialogTitle>
          <DialogDescription>
            Record who owns the asset, what it is, what it is worth and when it was valued.
            Whether an asset is disregarded is decided by policy at calculation.
          </DialogDescription>
        </DialogHeader>

        {commandError && (
          <Alert variant="destructive" data-testid="means-asset-dialog-error">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>This record was not saved</AlertTitle>
            <AlertDescription>
              {assetReasonLabel(commandError.code)}
              {commandError.message && commandError.message !== commandError.code
                ? ` — ${commandError.message}`
                : ''}
            </AlertDescription>
          </Alert>
        )}

        {referenceState !== 'SUCCESS' && (
          <MeansStateNotice
            state={referenceState}
            reason={referenceReason ?? 'Asset reference data could not be loaded.'}
            testId="means-asset-reference-state"
          />
        )}

        <div className="space-y-4">
          <MeansGovernedSelect
            id="means-asset-member"
            label="Asset owner"
            description="Only members recorded on this assessment household can be selected."
            required={rules.allow_household_level_asset !== true}
            optionSet={set(memberOptions, members.length === 0 ? 'EMPTY' : 'SUCCESS',
              members.length === 0 ? 'Add household members before recording assets.' : null)}
            value={draft.memberId}
            placeholder="Select the owner…"
            error={showError('memberId')}
            onChange={(value) => update({ memberId: value })}
          />

          {member && !member.is_current && (
            <p className="text-xs text-muted-foreground" data-testid="means-asset-member-ended">
              Membership ended {member.member_to}. The holding period must sit inside the
              membership period.
            </p>
          )}

          <MeansGovernedSelect
            id="means-asset-category"
            label="Asset category"
            description="Categories come from the governed policy reference list."
            required
            optionSet={set(reference?.ASSET_CATEGORY, referenceState, referenceReason)}
            value={draft.categoryCode}
            placeholder="Select a category…"
            error={showError('categoryCode')}
            onChange={(value) => {
              const next = findAssetCategory(reference, value);
              update({
                categoryCode: value,
                valuationBasis: '',
                institutionName: '',
                accountReference: '',
                propertyAddress: '',
                registrationNumber: '',
                businessName: '',
                disregardCandidate: next?.disregard_candidate_default === true,
                disregardReasonCode: '',
              });
            }}
          />

          {category?.evidence_normally_required && (
            <p className="text-xs text-muted-foreground">
              Evidence is normally required for this category. Attach it in the Evidence section.
            </p>
          )}

          {category?.requires_institution && (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="means-asset-institution"
                label="Institution"
                description="Bank, credit union or other institution holding the asset."
                required
                value={draft.institutionName}
                onChange={(v) => update({ institutionName: v })}
                error={showError('institutionName')}
              />
              <TextField
                id="means-asset-account-reference"
                label="Account reference"
                description="Optional. Record only what the officer needs to identify the account."
                value={draft.accountReference}
                onChange={(v) => update({ accountReference: v })}
              />
            </div>
          )}

          {category?.requires_property_address && (
            <TextField
              id="means-asset-property-address"
              label="Property address or location"
              required
              value={draft.propertyAddress}
              onChange={(v) => update({ propertyAddress: v })}
              error={showError('propertyAddress')}
            />
          )}

          {category?.requires_registration && (
            <TextField
              id="means-asset-registration"
              label="Registration number"
              required
              value={draft.registrationNumber}
              onChange={(v) => update({ registrationNumber: v })}
              error={showError('registrationNumber')}
            />
          )}

          {category?.requires_business_name && (
            <TextField
              id="means-asset-business-name"
              label="Business name"
              required
              value={draft.businessName}
              onChange={(v) => update({ businessName: v })}
              error={showError('businessName')}
            />
          )}

          <div className="space-y-1.5">
            <Label htmlFor="means-asset-description">
              Description
              {category?.requires_description && (
                <span className="text-destructive" aria-hidden="true"> *</span>
              )}
            </Label>
            <Textarea
              id="means-asset-description"
              data-testid="means-asset-description"
              rows={2}
              value={draft.description}
              aria-invalid={showError('description') ? true : undefined}
              onChange={(e) => update({ description: e.target.value })}
            />
            {showError('description') && (
              <p role="alert" className="text-xs font-medium text-destructive">
                {showError('description')}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <MeansGovernedSelect
              id="means-asset-ownership-type"
              label="Ownership"
              description="How the asset is held by this member."
              required
              optionSet={set(reference?.ASSET_OWNERSHIP_TYPE, referenceState, referenceReason)}
              value={draft.ownershipType}
              placeholder="How is it owned?"
              error={showError('ownershipType')}
              onChange={(value) => update({ ownershipType: value })}
            />
            <MeansPercentageInput
              id="means-asset-ownership-share"
              label="Ownership share"
              description="The share attributable to this member."
              required
              value={draft.ownershipSharePercent}
              onChange={(raw) => update({ ownershipSharePercent: raw })}
              min={0}
              max={100}
              error={showError('ownershipShare')}
            />
          </div>

          {draft.ownershipType !== 'SOLE' && (
            <TextField
              id="means-asset-co-owner"
              label="Other owners"
              description="Who else holds an interest in this asset."
              value={draft.coOwnerNote}
              onChange={(v) => update({ coOwnerNote: v })}
            />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <MeansMoneyInput
              id="means-asset-valuation"
              label="Valuation"
              description={`Recorded in the assessment currency (${currency}).`}
              required
              currency={currency}
              value={draft.valuationAmount}
              allowNegative={rules.allow_negative_valuation === true}
              onChange={(raw) => update({ valuationAmount: raw })}
              error={showError('valuationAmount')}
            />
            {category && category.valuation_basis_choice === true ? (
              <MeansGovernedSelect
                id="means-asset-valuation-basis"
                label="Valuation basis"
                required
                optionSet={set(reference?.ASSET_VALUATION_BASIS, referenceState, referenceReason)}
                value={draft.valuationBasis}
                placeholder="How was the value arrived at?"
                error={showError('valuationBasis')}
                onChange={(value) => update({ valuationBasis: value })}
              />
            ) : category ? (
              <div className="rounded-md border bg-muted/30 px-3 py-2" data-testid="means-asset-basis-fixed">
                <p className="text-xs uppercase text-muted-foreground">Valuation basis</p>
                <p className="text-sm font-medium">
                  {reference?.ASSET_VALUATION_BASIS.find((b) => b.value === basis.value)?.label ??
                    basis.value}{' '}
                  <Badge variant="outline" className="ml-1">Set by policy</Badge>
                </p>
              </div>
            ) : null}
          </div>

          {attributable !== null && (
            <p className="text-xs text-muted-foreground" data-testid="means-asset-attributable-preview">
              Attributable to this member: {formatWithCurrency(attributable, currency)}. The stored
              value is recalculated by the assessment engine.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <MeansDateField
              id="means-asset-valuation-date"
              label="Valuation date"
              required
              value={draft.valuationDate}
              onChange={(value) => update({ valuationDate: value })}
              error={showError('valuationDate')}
            />
            <TextField
              id="means-asset-valuation-source"
              label="Who valued it"
              description="Optional. For example the valuer, institution or statement used."
              value={draft.valuationSource}
              onChange={(v) => update({ valuationSource: v })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <MeansDateField
              id="means-asset-from"
              label="Held from"
              required
              value={draft.effectiveFrom}
              onChange={(value) => update({ effectiveFrom: value })}
              error={showError('effectiveFrom')}
            />
            <MeansDateField
              id="means-asset-to"
              label="Held to"
              description="Leave empty while the asset is still held."
              value={draft.effectiveTo}
              onChange={(value) => update({ effectiveTo: value })}
              error={showError('effectiveTo')}
            />
          </div>

          <MeansGovernedSelect
            id="means-asset-fact-source"
            label="Information source"
            description="Records where this information came from. It does not mean the fact is verified."
            required
            optionSet={set(reference?.ASSET_FACT_SOURCE, referenceState, referenceReason)}
            value={draft.factSource}
            placeholder="Select the source…"
            error={showError('factSource')}
            onChange={(value) => update({ factSource: value })}
          />

          <MeansBooleanField
            id="means-asset-disregard"
            label="Flag as a possible disregard"
            description="Flags the asset for review. The disregard itself is decided at calculation."
            checked={draft.disregardCandidate}
            onChange={(checked) =>
              update({ disregardCandidate: checked, disregardReasonCode: checked ? draft.disregardReasonCode : '' })
            }
          />

          {draft.disregardCandidate && (
            <MeansGovernedSelect
              id="means-asset-disregard-reason"
              label="Possible disregard reason"
              required
              optionSet={set(reference?.ASSET_DISREGARD_REASON, referenceState, referenceReason)}
              value={draft.disregardReasonCode}
              placeholder="Why might this be disregarded?"
              error={showError('disregardReasonCode')}
              onChange={(value) => update({ disregardReasonCode: value })}
            />
          )}

          <div className="space-y-1.5">
            <Label htmlFor="means-asset-notes">Notes</Label>
            <Textarea
              id="means-asset-notes"
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
          <Button type="button" onClick={submit} disabled={busy} data-testid="means-asset-save">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? 'Save correction' : 'Add asset'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BnMeansAssetDialog;
