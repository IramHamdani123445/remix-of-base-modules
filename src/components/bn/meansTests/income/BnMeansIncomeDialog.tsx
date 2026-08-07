/**
 * MEANS-TEST EPIC 3 — add / correct an income record.
 *
 * The form shape is decided by the governed income category metadata, not
 * by hard-coded statutory assumptions. Annualisation is never computed
 * here: the backend returns the normalised annual amount after saving.
 */
import React from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  MeansDateField,
  MeansDecisionRadioGroup,
  MeansGovernedSelect,
  MeansMoneyInput,
  MeansSearchLookup,
  MeansStateNotice,
  type MeansLookupRecord,
} from '@/components/bn/meansTests/controls/MeansControls';
import type { BnMeansLoadState, BnMeansOptionSet } from '@/types/bn/meansTests/meansFieldContract';
import {
  emptyIncomeDraft,
  findIncomeCategory,
  incomePayload,
  incomeReasonLabel,
  resolveIncomeBasis,
  validateIncomeDraft,
  type BnMeansIncomeContext,
  type BnMeansIncomeDraft,
  type BnMeansIncomeMemberRef,
  type BnMeansIncomeReference,
  type BnMeansIncomeRules,
} from '@/types/bn/meansTests/meansIncome';

export interface BnMeansIncomeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDraft: BnMeansIncomeDraft | null;
  currency: string;
  assessmentFrom: string;
  assessmentTo: string | null;
  members: readonly BnMeansIncomeMemberRef[];
  rules: BnMeansIncomeRules;
  reference: BnMeansIncomeReference | null;
  referenceState: Exclude<BnMeansLoadState, 'EMPTY'>;
  referenceReason?: string | null;
  /** Governed employer lookup owned by the section. */
  onEmployerSearch: (term: string) => Promise<{
    state: BnMeansLoadState;
    records?: readonly MeansLookupRecord[];
    reason?: string;
  }>;
  /** Existing contribution information for the selected member. */
  contextRecord: BnMeansIncomeContext | null;
  contextState: Exclude<BnMeansLoadState, 'EMPTY'>;
  onMemberSelected: (memberId: string) => void;
  busy: boolean;
  commandError: { code: string; message: string } | null;
  onSubmit: (payload: Record<string, unknown>, draft: BnMeansIncomeDraft) => void;
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

export const BnMeansIncomeDialog: React.FC<BnMeansIncomeDialogProps> = ({
  open, onOpenChange, initialDraft, currency, assessmentFrom, assessmentTo, members,
  rules, reference, referenceState, referenceReason, onEmployerSearch, contextRecord,
  contextState, onMemberSelected, busy, commandError, onSubmit,
}) => {
  const [draft, setDraft] = React.useState<BnMeansIncomeDraft>(
    () => initialDraft ?? emptyIncomeDraft(assessmentFrom),
  );
  const [submitted, setSubmitted] = React.useState(false);

  // The form is seeded when it opens; a failed command must never clear it.
  React.useEffect(() => {
    if (open) {
      setDraft(initialDraft ?? emptyIncomeDraft(assessmentFrom));
      setSubmitted(false);
    }
  }, [open, initialDraft, assessmentFrom]);

  const category = findIncomeCategory(reference, draft.categoryCode);
  const member = members.find((m) => m.member_id === draft.memberId) ?? null;
  const errors = validateIncomeDraft(draft, {
    category,
    rules,
    assessmentFrom,
    assessmentTo,
    member,
  });
  const showError = (key: string) => (submitted ? errors[key] ?? null : null);
  const basis = resolveIncomeBasis(category, draft.basis);
  const oneOff = draft.frequency === 'ONE_OFF';
  const editing = Boolean(draft.incomeFactId);

  const memberOptions = members.map((m) => ({
    value: m.member_id,
    label: m.display_name,
    description: `${m.relationship_label} · ${m.is_current ? 'Current member' : 'Membership ended'} · ${
      m.dependency_decision_label
    }`,
  }));

  const frequencyOptions = (reference?.INCOME_FREQUENCY ?? []).filter(
    (f) => f.value !== 'ONE_OFF' || category?.allow_one_off === true,
  );

  function update(patch: Partial<BnMeansIncomeDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function submit() {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    onSubmit(incomePayload(draft, { category, currency }), draft);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="means-income-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? 'Correct income record' : 'Add income'}</DialogTitle>
          <DialogDescription>
            Record what is received, from what source, at what amount and how often, and for
            what period. The annualised value is calculated by the assessment engine.
          </DialogDescription>
        </DialogHeader>

        {commandError && (
          <Alert variant="destructive" data-testid="means-income-dialog-error">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>This record was not saved</AlertTitle>
            <AlertDescription>
              {incomeReasonLabel(commandError.code)}
              {commandError.message && commandError.message !== commandError.code
                ? ` — ${commandError.message}`
                : ''}
            </AlertDescription>
          </Alert>
        )}

        {referenceState !== 'SUCCESS' && (
          <MeansStateNotice
            state={referenceState}
            reason={referenceReason ?? 'Income reference data could not be loaded.'}
            testId="means-income-reference-state"
          />
        )}

        <div className="space-y-4">
          <MeansGovernedSelect
            id="means-income-member"
            label="Household member"
            description="Only members recorded on this assessment household can be selected."
            required={rules.allow_household_level_income !== true}
            optionSet={set(memberOptions, members.length === 0 ? 'EMPTY' : 'SUCCESS',
              members.length === 0 ? 'Add household members before recording income.' : null)}
            value={draft.memberId}
            placeholder="Select the member…"
            error={showError('memberId')}
            onChange={(value) => {
              update({ memberId: value });
              if (value) onMemberSelected(value);
            }}
          />

          {member && !member.is_current && (
            <p className="text-xs text-muted-foreground" data-testid="means-income-member-ended">
              Membership ended {member.member_to}. The income period must sit inside the
              membership period.
            </p>
          )}

          <MeansGovernedSelect
            id="means-income-category"
            label="Income category"
            description="Categories come from the governed policy reference list."
            required
            optionSet={set(reference?.INCOME_CATEGORY, referenceState, referenceReason)}
            value={draft.categoryCode}
            placeholder="Select a category…"
            error={showError('categoryCode')}
            onChange={(value) =>
              update({
                categoryCode: value,
                basis: '',
                employerRegno: '',
                employerName: '',
                employerStatus: '',
              })
            }
          />

          {category?.evidence_normally_required && (
            <p className="text-xs text-muted-foreground">
              Evidence is normally required for this category. Attach it in the Evidence section.
            </p>
          )}

          {category?.requires_employer && (
            <>
              <MeansSearchLookup
                id="means-income-employer"
                label="Employer"
                description="Search the employer register by name or registration number."
                required
                placeholder="Employer name or registration number"
                value={
                  draft.employerRegno
                    ? {
                        id: draft.employerRegno,
                        primary: draft.employerName || 'Selected employer',
                        secondary: `Registration ${draft.employerRegno}${
                          draft.employerStatus ? ` · ${draft.employerStatus}` : ''
                        }`,
                      }
                    : null
                }
                onChange={(record) =>
                  update({
                    employerRegno: record?.id ?? '',
                    employerName: record?.primary ?? '',
                    employerStatus: record?.secondary?.split('·').pop()?.trim() ?? '',
                  })
                }
                onSearch={onEmployerSearch}
                error={showError('employer')}
              />

              {contextState !== 'SUCCESS' ? (
                <MeansStateNotice
                  state={contextState}
                  reason="Existing contribution information could not be loaded."
                  testId="means-income-context-state"
                />
              ) : contextRecord && contextRecord.contribution_records.length > 0 ? (
                <div className="rounded-md border p-3" data-testid="means-income-contribution-panel">
                  <p className="text-sm font-medium">Existing contribution information</p>
                  <p className="text-xs text-muted-foreground">
                    Reference only — contribution wages are not automatically means-test income.
                  </p>
                  <ul className="mt-2 space-y-2">
                    {contextRecord.contribution_records.slice(0, 5).map((rec, index) => (
                      <li
                        key={`${rec.employer_regno}-${rec.period}-${index}`}
                        className="flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <span>
                          <span className="font-medium">{rec.employer_name}</span> · {rec.period} ·{' '}
                          {currency} {rec.total_wages}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            update({
                              employerRegno: rec.employer_regno ?? '',
                              employerName: rec.employer_name,
                              employerStatus: rec.employer_status,
                              factSource: 'CONTRIBUTION_RECORD',
                            })
                          }
                        >
                          Use as starting point
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}

          {category?.requires_source_name && (
            <div className="space-y-1.5">
              <Label htmlFor="means-income-source-name">
                Source name <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <Textarea
                id="means-income-source-name"
                rows={2}
                value={draft.sourceName}
                aria-invalid={showError('sourceName') ? true : undefined}
                onChange={(e) => update({ sourceName: e.target.value })}
              />
              {showError('sourceName') && (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {showError('sourceName')}
                </p>
              )}
            </div>
          )}

          {category && category.basis_choice === true ? (
            <MeansDecisionRadioGroup
              id="means-income-basis"
              label="Amount basis"
              description="Record whether the declared amount is before or after statutory deductions."
              required
              optionSet={set(reference?.INCOME_BASIS, referenceState, referenceReason)}
              value={draft.basis}
              onChange={(value) => update({ basis: value })}
              error={showError('basis')}
            />
          ) : category ? (
            <div className="rounded-md border bg-muted/30 px-3 py-2" data-testid="means-income-basis-fixed">
              <p className="text-xs uppercase text-muted-foreground">Amount basis</p>
              <p className="text-sm font-medium">
                {basis.value === 'NET' ? 'Net' : 'Gross'}{' '}
                <Badge variant="outline" className="ml-1">Set by policy</Badge>
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <MeansMoneyInput
              id="means-income-amount"
              label="Declared amount"
              description={`Recorded in the assessment currency (${currency}).`}
              required
              currency={currency}
              value={draft.amount}
              allowNegative={rules.allow_negative_income === true}
              onChange={(raw) => update({ amount: raw })}
              error={showError('amount')}
            />
            <MeansGovernedSelect
              id="means-income-frequency"
              label="Frequency"
              required
              optionSet={set(frequencyOptions, referenceState, referenceReason)}
              value={draft.frequency}
              placeholder="How often is it received?"
              error={showError('frequency')}
              onChange={(value) => update({ frequency: value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <MeansDateField
              id="means-income-from"
              label={oneOff ? 'Date received' : 'Effective from'}
              required
              value={draft.effectiveFrom}
              onChange={(value) =>
                update({ effectiveFrom: value, occurrenceDate: oneOff ? value : draft.occurrenceDate })
              }
              error={showError('effectiveFrom')}
            />
            {!oneOff && (
              <MeansDateField
                id="means-income-to"
                label="Effective to"
                description="Leave empty while the income continues."
                value={draft.effectiveTo}
                onChange={(value) => update({ effectiveTo: value })}
                error={showError('effectiveTo')}
              />
            )}
          </div>

          {oneOff && (
            <p className="text-xs text-muted-foreground" data-testid="means-income-one-off-note">
              One-off income keeps its original declared amount. How it is treated in the
              calculation is decided by policy at calculation time.
            </p>
          )}

          <MeansGovernedSelect
            id="means-income-fact-source"
            label="Information source"
            description="Records where this information came from. It does not mean the fact is verified."
            required
            optionSet={set(reference?.INCOME_FACT_SOURCE, referenceState, referenceReason)}
            value={draft.factSource}
            placeholder="Select the source…"
            error={showError('factSource')}
            onChange={(value) => update({ factSource: value })}
          />

          <div className="space-y-1.5">
            <Label htmlFor="means-income-notes">Notes</Label>
            <Textarea
              id="means-income-notes"
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
          <Button type="button" onClick={submit} disabled={busy} data-testid="means-income-save">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? 'Save correction' : 'Add income'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BnMeansIncomeDialog;
