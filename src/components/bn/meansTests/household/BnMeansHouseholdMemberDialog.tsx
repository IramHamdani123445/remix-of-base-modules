/**
 * MEANS-TEST EPIC 2 — add / edit household member journey.
 *
 * A focused dialog rather than an inline code-typing form. The officer
 * first chooses between a known person and a declared member; nothing is
 * fabricated for a declared member (no invented person identifier), and
 * every controlled list comes from the governed reference boundary.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  MeansDateField,
  MeansFieldShell,
  MeansGovernedSelect,
  MeansSearchLookup,
  MeansStateNotice,
  type MeansLookupRecord,
} from '@/components/bn/meansTests/controls/MeansControls';
import { meansReferenceDataService } from '@/services/bn/meansTests/meansReferenceDataService';
import { meansInitiationService } from '@/services/bn/meansTests/meansInitiationService';
import type { BnMeansOptionSet } from '@/types/bn/meansTests/meansFieldContract';
import {
  emptyHouseholdDraft,
  householdPayload,
  validateHouseholdDraft,
  type BnMeansHouseholdCandidate,
  type BnMeansHouseholdMemberDraft,
  type BnMeansDependencyDecision,
} from '@/types/bn/meansTests/meansHousehold';

const PENDING: BnMeansOptionSet = { state: 'LOADING', options: [] };

export interface BnMeansHouseholdMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing draft when editing; otherwise a new member is captured. */
  initialDraft?: BnMeansHouseholdMemberDraft | null;
  assessmentFrom: string;
  assessmentTo: string | null;
  assessedPersonId: number | null;
  allowDeclaredMembers: boolean;
  candidates: readonly BnMeansHouseholdCandidate[];
  candidatesState: 'SUCCESS' | 'EMPTY' | 'DENIED' | 'FAILED' | 'LOADING';
  candidatesReason?: string | null;
  busy: boolean;
  /** Structured business error from the last failed command, if any. */
  commandError?: { code: string; message: string } | null;
  onSubmit: (payload: Record<string, unknown>, draft: BnMeansHouseholdMemberDraft) => void;
}

export const BnMeansHouseholdMemberDialog: React.FC<BnMeansHouseholdMemberDialogProps> = ({
  open, onOpenChange, initialDraft, assessmentFrom, assessmentTo, assessedPersonId,
  allowDeclaredMembers, candidates, candidatesState, candidatesReason, busy,
  commandError, onSubmit,
}) => {
  const editing = Boolean(initialDraft?.memberId);
  const [draft, setDraft] = React.useState<BnMeansHouseholdMemberDraft>(
    initialDraft ?? emptyHouseholdDraft(assessmentFrom),
  );
  const [selectedPerson, setSelectedPerson] = React.useState<MeansLookupRecord | null>(
    initialDraft?.personId
      ? { id: String(initialDraft.personId), primary: 'Selected person', secondary: undefined }
      : null,
  );
  const [touched, setTouched] = React.useState(false);
  const firstErrorRef = React.useRef<HTMLDivElement | null>(null);

  // A reopened dialog always starts from the supplied draft.
  React.useEffect(() => {
    if (!open) return;
    setDraft(initialDraft ?? emptyHouseholdDraft(assessmentFrom));
    setSelectedPerson(
      initialDraft?.personId
        ? { id: String(initialDraft.personId), primary: initialDraft.declaredFullName || 'Selected person' }
        : null,
    );
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const sets = useQuery({
    queryKey: ['bn-means-household-reference'],
    queryFn: async () => ({
      relationship: await meansReferenceDataService.options('RELATIONSHIP_TYPE'),
      decision: await meansReferenceDataService.options('DEPENDENCY_DECISION'),
      basis: await meansReferenceDataService.options('DEPENDENCY_BASIS'),
      source: await meansReferenceDataService.options('HOUSEHOLD_FACT_SOURCE'),
      residence: await meansReferenceDataService.options('RESIDENCE_INCLUSION_REASON'),
    }),
    enabled: open,
  });

  const errors = validateHouseholdDraft(draft, {
    assessedPersonId,
    assessmentFrom,
    assessmentTo,
  });
  const shown = touched ? errors : {};
  const set = (patch: Partial<BnMeansHouseholdMemberDraft>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  function submit() {
    setTouched(true);
    if (Object.keys(errors).length > 0) {
      window.setTimeout(() => firstErrorRef.current?.focus(), 0);
      return;
    }
    onSubmit(householdPayload(draft), draft);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="means-household-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit household member' : 'Add household member'}</DialogTitle>
          <DialogDescription>
            Record who belonged to the assessed household during the assessment period.
            Dependency is never inferred from the relationship.
          </DialogDescription>
        </DialogHeader>

        {commandError && (
          <Alert variant="destructive" data-testid="means-household-dialog-error">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>This member could not be saved</AlertTitle>
            <AlertDescription>{commandError.message}</AlertDescription>
          </Alert>
        )}

        <div
          ref={firstErrorRef}
          tabIndex={-1}
          aria-live="polite"
          className="outline-none"
          data-testid="means-household-error-summary"
        >
          {touched && Object.keys(errors).length > 0 && (
            <p className="text-xs font-medium text-destructive">
              {Object.values(errors)[0]}
            </p>
          )}
        </div>

        <div className="space-y-5">
          {!editing && (
            <MeansFieldShell id="means-household-source" label="How is this member identified?" required>
              <RadioGroup
                value={draft.sourceKind}
                onValueChange={(v) =>
                  set({ sourceKind: v as BnMeansHouseholdMemberDraft['sourceKind'], personId: null })
                }
                className="grid gap-2 sm:grid-cols-2"
              >
                <div className="flex items-start gap-2 rounded-md border p-3">
                  <RadioGroupItem value="KNOWN_PERSON" id="means-household-source-known" />
                  <Label htmlFor="means-household-source-known" className="cursor-pointer text-sm font-normal">
                    Select a known person
                    <span className="block text-xs text-muted-foreground">
                      Uses the authoritative person and dependant records.
                    </span>
                  </Label>
                </div>
                <div className="flex items-start gap-2 rounded-md border p-3">
                  <RadioGroupItem
                    value="DECLARED"
                    id="means-household-source-declared"
                    disabled={!allowDeclaredMembers}
                  />
                  <Label htmlFor="means-household-source-declared" className="cursor-pointer text-sm font-normal">
                    Record a declared household member
                    <span className="block text-xs text-muted-foreground">
                      Only where no authoritative person record exists.
                    </span>
                  </Label>
                </div>
              </RadioGroup>
            </MeansFieldShell>
          )}

          {draft.sourceKind === 'KNOWN_PERSON' ? (
            <div className="space-y-3">
              <div>
                <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                  Known household candidates
                </p>
                {candidatesState !== 'SUCCESS' ? (
                  <MeansStateNotice
                    state={candidatesState}
                    reason={candidatesReason ?? undefined}
                    testId="means-household-candidates-state"
                  />
                ) : (
                  <ul className="space-y-2" data-testid="means-household-candidates">
                    {candidates.map((candidate) => (
                      <li key={`${candidate.candidate_kind}-${candidate.person_id}`}>
                        <button
                          type="button"
                          disabled={candidate.already_present || !candidate.person_id}
                          className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-60"
                          onClick={() => {
                            set({
                              personId: candidate.person_id,
                              relationshipCode: candidate.suggested_relationship,
                              factSource: candidate.suggested_fact_source,
                            });
                            setSelectedPerson({
                              id: String(candidate.person_id),
                              primary: candidate.full_name,
                              secondary: candidate.masked_identifier ?? undefined,
                            });
                          }}
                        >
                          <span className="font-medium">{candidate.full_name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {candidate.candidate_kind === 'CLAIMANT' ? 'Claimant' : 'Known dependant'}
                            {candidate.masked_identifier ? ` · ${candidate.masked_identifier}` : ''}
                            {candidate.already_present ? ' · already in the household' : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <MeansSearchLookup
                id="means-household-person"
                label="Household member"
                description="Search the person register. Identifiers are always masked."
                required
                value={selectedPerson}
                error={shown.person ?? null}
                onChange={(record) => {
                  setSelectedPerson(record);
                  set({ personId: record ? Number(record.id) : null });
                }}
                onSearch={async (term) => {
                  const result = await meansInitiationService.personSearch(term);
                  if (result.status === 'DENIED') {
                    return { state: 'DENIED', reason: 'You cannot search the person register.' };
                  }
                  if (result.status !== 'OK') {
                    return { state: 'FAILED', reason: result.detail ?? 'Person search failed.' };
                  }
                  return {
                    state: 'SUCCESS',
                    records: (result.data ?? []).map((p) => ({
                      id: String(p.person_id),
                      primary: p.full_name,
                      secondary: [p.masked_identifier, p.date_of_birth].filter(Boolean).join(' · '),
                    })),
                  };
                }}
              />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <MeansFieldShell
                id="means-household-declared-name"
                label="Full name"
                required
                error={shown.declaredFullName ?? null}
              >
                <Input
                  id="means-household-declared-name"
                  value={draft.declaredFullName}
                  aria-required
                  aria-invalid={shown.declaredFullName ? true : undefined}
                  onChange={(e) => set({ declaredFullName: e.target.value })}
                />
              </MeansFieldShell>
              <MeansDateField
                id="means-household-declared-dob"
                label="Date of birth"
                description="Leave blank when it is not known."
                value={draft.declaredDateOfBirth}
                onChange={(v) => set({ declaredDateOfBirth: v })}
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <MeansGovernedSelect
              id="means-household-relationship"
              label="Relationship"
              required
              optionSet={sets.data?.relationship ?? PENDING}
              value={draft.relationshipCode}
              error={shown.relationshipCode ?? null}
              onChange={(v) => set({ relationshipCode: v })}
            />
            <MeansGovernedSelect
              id="means-household-fact-source"
              label="Information source"
              required
              optionSet={sets.data?.source ?? PENDING}
              value={draft.factSource}
              error={shown.factSource ?? null}
              onChange={(v) => set({ factSource: v })}
            />
            <MeansDateField
              id="means-household-from"
              label="Member from"
              required
              value={draft.memberFrom}
              error={shown.memberFrom ?? null}
              onChange={(v) => set({ memberFrom: v })}
            />
            <MeansDateField
              id="means-household-to"
              label="Member to"
              description="Leave blank while the member is still in the household."
              value={draft.memberTo}
              error={shown.memberTo ?? null}
              onChange={(v) => set({ memberTo: v })}
            />
          </div>

          <MeansFieldShell id="means-household-residence" label="Residence" required>
            <RadioGroup
              value={draft.sharesResidence ? 'SHARES' : 'DOES_NOT_SHARE'}
              onValueChange={(v) =>
                set({
                  sharesResidence: v === 'SHARES',
                  residenceInclusionReason: v === 'SHARES' ? '' : draft.residenceInclusionReason,
                })
              }
              className="grid gap-2 sm:grid-cols-2"
            >
              <div className="flex items-center gap-2 rounded-md border p-3">
                <RadioGroupItem value="SHARES" id="means-household-residence-shares" />
                <Label htmlFor="means-household-residence-shares" className="cursor-pointer text-sm font-normal">
                  Shares the assessed residence
                </Label>
              </div>
              <div className="flex items-center gap-2 rounded-md border p-3">
                <RadioGroupItem value="DOES_NOT_SHARE" id="means-household-residence-no" />
                <Label htmlFor="means-household-residence-no" className="cursor-pointer text-sm font-normal">
                  Does not share the assessed residence
                </Label>
              </div>
            </RadioGroup>
          </MeansFieldShell>

          {!draft.sharesResidence && (
            <MeansGovernedSelect
              id="means-household-residence-reason"
              label="Inclusion reason"
              description="Required for a member who does not share the assessed residence."
              required
              optionSet={sets.data?.residence ?? PENDING}
              value={draft.residenceInclusionReason}
              error={shown.residenceInclusionReason ?? null}
              onChange={(v) => set({ residenceInclusionReason: v })}
            />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <MeansGovernedSelect
              id="means-household-dependency"
              label="Dependency decision"
              description="Undetermined is an explicit decision, not a blank."
              required
              optionSet={sets.data?.decision ?? PENDING}
              value={draft.dependencyDecision}
              error={shown.dependencyDecision ?? null}
              onChange={(v) =>
                set({
                  dependencyDecision: v as BnMeansDependencyDecision,
                  dependencyBasis: v === 'DEPENDANT' ? draft.dependencyBasis : '',
                })
              }
            />
            {draft.dependencyDecision === 'DEPENDANT' && (
              <MeansGovernedSelect
                id="means-household-dependency-basis"
                label="Dependency basis"
                required
                optionSet={sets.data?.basis ?? PENDING}
                value={draft.dependencyBasis}
                error={shown.dependencyBasis ?? null}
                onChange={(v) => set({ dependencyBasis: v })}
              />
            )}
          </div>

          <MeansFieldShell id="means-household-notes" label="Notes">
            <Textarea
              id="means-household-notes"
              value={draft.notes}
              rows={2}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </MeansFieldShell>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={submit} data-testid="means-household-submit">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? 'Save member' : 'Add member'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BnMeansHouseholdMemberDialog;
