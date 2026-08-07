/**
 * MEANS-TEST EPIC 1 — guided assessment initiation.
 *
 * Replaces raw-identifier data entry with an operational wizard:
 *   Context → Person → Claim or award → Assessment details →
 *   Policy resolution → Review and create.
 *
 * Two rules govern this screen:
 *  1. It never decides whether an assessment may be created. That single
 *     decision comes from `bn_means_initiation_check_v1`, and the create
 *     command re-runs the very same check server-side.
 *  2. It never asks an officer for an internal identifier. People, claims
 *     and awards are chosen from governed reads; currency and policy
 *     version are derived by the backend.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import {
  MeansDateField,
  MeansGovernedSelect,
  MeansSearchLookup,
  MeansStateNotice,
  type MeansLookupRecord,
} from '@/components/bn/meansTests/controls/MeansControls';
import { meansInitiationService } from '@/services/bn/meansTests/meansInitiationService';
import { meansReferenceDataService } from '@/services/bn/meansTests/meansReferenceDataService';
import { meansCommandService, type BnMeansCommandResult } from '@/services/bn/meansTests/meansCommandService';
import { humaniseMeansCode } from '@/types/bn/meansTests/meansFieldContract';
import type { BnMeansOptionSet } from '@/types/bn/meansTests/meansFieldContract';
import {
  MEANS_ENTRY_CONTEXTS,
  blockersForStep,
  buildInitiationContext,
  emptyInitiationDraft,
  firstIncompleteStep,
  meansEntryContext,
  stepComplete,
  visibleInitiationSteps,
  type BnMeansEntryContextCode,
  type BnMeansInitiationCheck,
  type BnMeansInitiationDraft,
  type BnMeansInitiationPrefill,
  type BnMeansInitiationStep,
  type BnMeansPersonContext,
} from '@/types/bn/meansTests/meansInitiation';

const LOADING_SET: BnMeansOptionSet = { state: 'LOADING', options: [] };

export interface BnMeansInitiationWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: BnMeansInitiationPrefill;
  onCreated: (assessmentId: string) => void;
  /**
   * Offered when no policy is in force: takes a configuration-permitted
   * officer straight to Means-Test policy configuration instead of leaving
   * them at a dead end.
   */
  onOpenConfiguration?: () => void;
}

export const BnMeansInitiationWizard: React.FC<BnMeansInitiationWizardProps> = ({
  open, onOpenChange, prefill, onCreated, onOpenConfiguration,
}) => {
  const [draft, setDraft] = React.useState<BnMeansInitiationDraft>(() => emptyInitiationDraft(prefill));
  const [step, setStep] = React.useState<BnMeansInitiationStep>('CONTEXT');
  const [pending, setPending] = React.useState(false);
  const [commandError, setCommandError] = React.useState<BnMeansCommandResult | null>(null);

  // A fresh open always starts from the supplied entry context.
  React.useEffect(() => {
    if (!open) return;
    const next = emptyInitiationDraft(prefill);
    setDraft(next);
    setStep(next.personId ? firstIncompleteStep(next) : 'CONTEXT');
    setCommandError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const update = (patch: Partial<BnMeansInitiationDraft>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  const contextDef = meansEntryContext(draft.entryContext);
  const steps = visibleInitiationSteps(draft);

  /* ---------------- governed reads ---------------- */

  const personContext = useQuery({
    queryKey: ['bn-means-person-context', draft.personId],
    queryFn: () => meansInitiationService.personContext(draft.personId as number),
    enabled: open && draft.personId != null,
  });

  const programmes = useQuery({
    queryKey: ['bn-means-programmes', draft.effectiveFrom || null],
    queryFn: () => meansReferenceDataService.options('BENEFIT_PROGRAMME', {
      effectiveDate: draft.effectiveFrom || undefined,
    }),
    enabled: open,
  });

  const reasons = useQuery({
    queryKey: ['bn-means-reasons', draft.entryContext],
    queryFn: () => meansReferenceDataService.options('ASSESSMENT_REASON', {
      entryContext: draft.entryContext,
    }),
    enabled: open,
  });

  const contextPayload = buildInitiationContext(draft);
  const check = useQuery({
    queryKey: ['bn-means-initiation-check', contextPayload],
    queryFn: () => meansInitiationService.initiationCheck(contextPayload),
    enabled: open,
  });

  const checkData: BnMeansInitiationCheck | null =
    check.data?.status === 'OK' ? (check.data.data ?? null) : null;
  const checkUnavailable =
    check.isError
      ? 'The initiation check could not be run. An assessment cannot be created until it succeeds.'
      : check.data && check.data.status !== 'OK'
        ? check.data.status === 'DENIED'
          ? 'You do not hold permission to create Means-Test assessments.'
          : `The initiation check could not be run (${check.data.detail ?? check.data.code ?? 'unknown error'}).`
        : null;

  const person = (personContext.data?.status === 'OK'
    ? personContext.data.data
    : null) as BnMeansPersonContext | null;

  /* ---------------- navigation ---------------- */

  const index = Math.max(0, steps.findIndex((s) => s.step === step));
  const isLast = index === steps.length - 1;
  const canAdvance = stepComplete(step, draft, checkData);

  function goNext() {
    if (!isLast) setStep(steps[index + 1].step);
  }
  function goBack() {
    if (index > 0) setStep(steps[index - 1].step);
  }

  async function submit() {
    setPending(true);
    setCommandError(null);
    const result = await meansCommandService.execute({
      command: 'BN_MEANS_CREATE_ASSESSMENT',
      payload: {
        ...contextPayload,
        source_entry_point: prefill?.originSurface ?? 'MEANS_LANDING',
      },
    });
    setPending(false);
    if (result.status === 'FAILED') {
      setCommandError(result);
      return;
    }
    onOpenChange(false);
    if (result.assessmentId) onCreated(result.assessmentId);
  }

  /* ---------------- steps ---------------- */

  const stepBlockers = blockersForStep(checkData, step);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="means-initiation-wizard">
        <DialogHeader>
          <DialogTitle>Start a means-test assessment</DialogTitle>
          <DialogDescription>
            Work through each step. Nothing is created until every check passes.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex flex-wrap gap-2" data-testid="means-initiation-steps">
          {steps.map((s, i) => {
            const done = stepComplete(s.step, draft, checkData);
            return (
              <li key={s.step}>
                <button
                  type="button"
                  data-testid={`means-step-${s.step}`}
                  data-active={s.step === step ? 'true' : 'false'}
                  data-complete={done ? 'true' : 'false'}
                  aria-current={s.step === step ? 'step' : undefined}
                  onClick={() => setStep(s.step)}
                  className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs ${
                    s.step === step ? 'border-primary bg-primary/10 font-medium' : 'text-muted-foreground'
                  }`}
                >
                  <span>{i + 1}</span>
                  {done && <Check className="h-3 w-3" aria-hidden="true" />}
                  <span>{s.label}</span>
                </button>
              </li>
            );
          })}
        </ol>

        {checkUnavailable && (
          <Alert variant="destructive" data-testid="means-initiation-check-unavailable">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Initiation check unavailable</AlertTitle>
            <AlertDescription>{checkUnavailable}</AlertDescription>
          </Alert>
        )}

        {stepBlockers.length > 0 && (
          <Alert variant="destructive" data-testid={`means-step-blockers-${step}`}>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>This step needs attention</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                {stepBlockers.map((b) => <li key={b.code}>{b.message}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4 py-2">
          {step === 'CONTEXT' && (
            <fieldset data-testid="means-step-context-panel">
              <legend className="mb-2 text-sm font-medium">Why is this assessment being started?</legend>
              <RadioGroup
                value={draft.entryContext}
                onValueChange={(value) => {
                  const def = meansEntryContext(value as BnMeansEntryContextCode);
                  update({
                    entryContext: value as BnMeansEntryContextCode,
                    assessmentReason: def?.defaultReason ?? '',
                    claimId: def?.requiresClaim ? draft.claimId : null,
                    awardId: def?.requiresAward ? draft.awardId : null,
                  });
                }}
                className="space-y-2"
              >
                {MEANS_ENTRY_CONTEXTS.map((c) => (
                  <div key={c.code} className="flex items-start gap-3 rounded-md border p-3">
                    <RadioGroupItem value={c.code} id={`means-context-${c.code}`} className="mt-1" />
                    <Label htmlFor={`means-context-${c.code}`} className="cursor-pointer space-y-0.5">
                      <span className="block text-sm font-medium">{c.label}</span>
                      <span className="block text-xs font-normal text-muted-foreground">{c.description}</span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>
          )}

          {step === 'PERSON' && (
            <div className="space-y-3" data-testid="means-step-person-panel">
              <MeansSearchLookup
                id="means-person"
                label="Person to be assessed"
                description="Search by social security number, name, date of birth or claim number."
                required
                placeholder="e.g. Joseph, 1969-04-02 or a claim number"
                value={
                  draft.personId != null
                    ? {
                        id: String(draft.personId),
                        primary: draft.personLabel ?? 'Selected person',
                        secondary: draft.personSecondary ?? undefined,
                      }
                    : null
                }
                onChange={(record: MeansLookupRecord | null) =>
                  update({
                    personId: record ? Number(record.id) : null,
                    personLabel: record?.primary ?? null,
                    personSecondary: record?.secondary ?? null,
                    claimId: null,
                    awardId: null,
                  })
                }
                onSearch={async (term) => {
                  const result = await meansInitiationService.personSearch(term);
                  if (result.status !== 'OK') {
                    return {
                      state: result.status === 'DENIED' ? 'DENIED' : result.status === 'INVALID' ? 'EMPTY' : 'FAILED',
                      records: [],
                      reason:
                        result.code === 'SEARCH_TERM_TOO_SHORT'
                          ? 'Enter at least two characters.'
                          : result.detail ?? result.code,
                    } as const;
                  }
                  return {
                    state: 'SUCCESS',
                    records: (result.data ?? [])
                      .filter((r) => r.person_id != null)
                      .map((r) => ({
                        id: String(r.person_id),
                        primary: r.full_name || 'Unnamed person',
                        secondary: [
                          r.masked_identifier ?? undefined,
                          r.date_of_birth ? `born ${r.date_of_birth}` : undefined,
                          r.is_deceased ? 'deceased' : undefined,
                          `${r.open_claim_count} open claim(s)`,
                          `${r.active_award_count} active award(s)`,
                        ].filter(Boolean).join(' · '),
                      })),
                  } as const;
                }}
              />

              {personContext.isLoading && <Skeleton className="h-20" />}
              {personContext.data && personContext.data.status !== 'OK' && (
                <MeansStateNotice
                  state={personContext.data.status === 'DENIED' ? 'DENIED' : 'FAILED'}
                  reason="The person's claims and awards could not be loaded."
                  testId="means-person-context-state"
                />
              )}
              {person && (
                <Card data-testid="means-person-summary">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{person.person.full_name}</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2 text-xs sm:grid-cols-2">
                    <div><span className="text-muted-foreground">Identifier: </span>{person.person.masked_identifier ?? '—'}</div>
                    <div><span className="text-muted-foreground">Date of birth: </span>{person.person.date_of_birth ?? '—'}</div>
                    <div className="sm:col-span-2"><span className="text-muted-foreground">Address: </span>{person.person.address_summary ?? '—'}</div>
                    {person.person.is_deceased && (
                      <Badge variant="secondary" data-testid="means-person-deceased">Recorded as deceased</Badge>
                    )}
                    <div className="sm:col-span-2 text-muted-foreground">
                      {person.claims.length} claim(s), {person.awards.length} award(s),{' '}
                      {person.assessments.length} previous assessment(s).
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {step === 'LINK' && (
            <div className="space-y-3" data-testid="means-step-link-panel">
              {!person ? (
                <MeansStateNotice state="EMPTY" reason="Select a person first." testId="means-link-no-person" />
              ) : contextDef?.requiresClaim ? (
                <LinkList
                  testId="means-claim-list"
                  emptyReason="This person has no claims on record. Choose a different context or create the claim first."
                  items={person.claims.map((c) => ({
                    id: c.claim_id,
                    primary: `${c.claim_reference ?? 'Claim'} — ${c.programme_label ?? c.benefit_programme ?? 'Unknown programme'}`,
                    secondary: [
                      c.claim_status ? humaniseMeansCode(c.claim_status) : null,
                      c.claim_date ? `claimed ${c.claim_date}` : null,
                      c.existing_assessment_reference ? `already assessed (${c.existing_assessment_reference})` : null,
                    ].filter(Boolean).join(' · '),
                    programme: c.benefit_programme ?? '',
                    effectiveDate: c.effective_date ?? '',
                  }))}
                  selectedId={draft.claimId}
                  onSelect={(item) =>
                    update({
                      claimId: item.id,
                      benefitProgramme: draft.benefitProgramme || item.programme,
                      effectiveFrom: draft.effectiveFrom || item.effectiveDate,
                    })
                  }
                />
              ) : contextDef?.requiresAward ? (
                <LinkList
                  testId="means-award-list"
                  emptyReason="This person has no awards on record."
                  items={person.awards.map((a) => ({
                    id: a.award_id,
                    primary: `${a.award_reference ?? 'Award'} — ${a.programme_label ?? a.benefit_programme ?? 'Unknown programme'}`,
                    secondary: [
                      a.award_status ? humaniseMeansCode(a.award_status) : null,
                      a.start_date ? `from ${a.start_date}` : null,
                      a.next_review_date ? `review due ${a.next_review_date}` : null,
                    ].filter(Boolean).join(' · '),
                    programme: a.benefit_programme ?? '',
                    effectiveDate: a.next_review_date ?? '',
                  }))}
                  selectedId={draft.awardId}
                  onSelect={(item) =>
                    update({
                      awardId: item.id,
                      benefitProgramme: draft.benefitProgramme || item.programme,
                    })
                  }
                />
              ) : null}
            </div>
          )}

          {step === 'DETAILS' && (
            <div className="grid gap-4 sm:grid-cols-2" data-testid="means-step-details-panel">
              <MeansGovernedSelect
                id="means-benefit-programme"
                label="Benefit programme"
                description="Only programmes with a governed Means-Test policy are listed."
                required
                value={draft.benefitProgramme}
                onChange={(value) => update({ benefitProgramme: value })}
                optionSet={programmes.data ?? LOADING_SET}
              />
              <MeansGovernedSelect
                id="means-assessment-reason"
                label="Reason for the assessment"
                required
                value={draft.assessmentReason}
                onChange={(value) => update({ assessmentReason: value })}
                optionSet={reasons.data ?? LOADING_SET}
              />
              <MeansDateField
                id="means-effective-from"
                label="Effective from"
                description="The date the assessed means take effect. The policy in force on this date is used."
                required
                value={draft.effectiveFrom}
                onChange={(value) => update({ effectiveFrom: value })}
              />
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                Currency and policy version are derived by the system from the programme and
                effective date. They are never entered by hand.
              </div>
            </div>
          )}

          {step === 'POLICY' && (
            <div className="space-y-3" data-testid="means-step-policy-panel">
              {check.isLoading ? (
                <Skeleton className="h-24" />
              ) : checkData?.policy_resolution?.state === 'RESOLVED' ? (
                <Card data-testid="means-policy-resolved">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">
                      {checkData.policy_resolution.policy_name ?? checkData.policy_resolution.policy_code}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2 text-xs sm:grid-cols-2">
                    <div><span className="text-muted-foreground">Version: </span>{checkData.policy_resolution.version_label ?? '—'}</div>
                    <div><span className="text-muted-foreground">Currency: </span>{checkData.policy_resolution.currency_code ?? '—'}</div>
                    <div><span className="text-muted-foreground">In force from: </span>{checkData.policy_resolution.effective_from ?? '—'}</div>
                    <div><span className="text-muted-foreground">In force to: </span>{checkData.policy_resolution.effective_to ?? 'open'}</div>
                    <div><span className="text-muted-foreground">Authority: </span>{checkData.policy_resolution.authority_reference ?? '—'}</div>
                    <div><span className="text-muted-foreground">Validity: </span>
                      {checkData.policy_resolution.validity_months
                        ? `${checkData.policy_resolution.validity_months} months`
                        : '—'}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  <MeansStateNotice
                    state="EMPTY"
                    reason={
                      checkData?.policy_resolution?.state === 'OVERLAPPING'
                        ? 'More than one policy version is in force for this programme and date. This is a configuration error — resolve it in Means-Test configuration before starting the assessment.'
                        : 'No Means-Test policy is in force for the selected programme and effective date. A policy version must be configured and activated first.'
                    }
                    testId="means-policy-unresolved"
                  />
                  {onOpenConfiguration && (
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="means-policy-open-configuration"
                      onClick={() => { onOpenChange(false); onOpenConfiguration(); }}
                    >
                      Open Means-Test configuration
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 'REVIEW' && (
            <div className="space-y-3" data-testid="means-step-review-panel">
              <dl className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-2">
                <Row label="Context" value={contextDef?.label ?? '—'} />
                <Row label="Person" value={draft.personLabel ?? '—'} />
                <Row label="Identifier" value={draft.personSecondary ?? '—'} />
                <Row label="Programme" value={draft.benefitProgramme || '—'} />
                <Row label="Reason" value={humaniseMeansCode(draft.assessmentReason) || '—'} />
                <Row label="Effective from" value={draft.effectiveFrom || '—'} />
                <Row label="Policy version" value={checkData?.policy_resolution?.version_label ?? '—'} />
                <Row label="Currency" value={checkData?.policy_resolution?.currency_code ?? '—'} />
              </dl>

              {(checkData?.warnings ?? []).length > 0 && (
                <Alert data-testid="means-initiation-warnings">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Please note</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-4">
                      {checkData!.warnings.map((w) => <li key={w.code}>{w.message}</li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {(checkData?.existing_open_assessments ?? []).length > 0 && (
                <Card data-testid="means-existing-assessments">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Assessments already open for this person</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-xs">
                    {checkData!.existing_open_assessments.map((a) => (
                      <div key={a.assessment_id}>
                        {a.assessment_reference} — {humaniseMeansCode(a.status)}, effective {a.effective_from}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {commandError && (
                <Alert variant="destructive" data-testid="means-initiation-command-error">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{humaniseMeansCode(commandError.errorCode)}</AlertTitle>
                  <AlertDescription>{commandError.errorDetail}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={goBack} disabled={index === 0}>Back</Button>
            {!isLast ? (
              <Button onClick={goNext} disabled={!canAdvance} data-testid="means-initiation-next">
                Continue
              </Button>
            ) : (
              <Button
                onClick={() => void submit()}
                disabled={pending || !checkData?.can_create}
                data-testid="means-initiation-create"
              >
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create assessment
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
    <dd>{value}</dd>
  </div>
);

interface LinkItem {
  id: string;
  primary: string;
  secondary: string;
  programme: string;
  effectiveDate: string;
}

const LinkList: React.FC<{
  items: readonly LinkItem[];
  selectedId: string | null;
  onSelect: (item: LinkItem) => void;
  emptyReason: string;
  testId: string;
}> = ({ items, selectedId, onSelect, emptyReason, testId }) => {
  if (items.length === 0) {
    return <MeansStateNotice state="EMPTY" reason={emptyReason} testId={`${testId}-state`} />;
  }
  return (
    <ul className="divide-y rounded-md border" data-testid={testId}>
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            data-selected={item.id === selectedId ? 'true' : 'false'}
            aria-pressed={item.id === selectedId}
            onClick={() => onSelect(item)}
            className={`w-full px-3 py-2 text-left text-sm hover:bg-muted ${
              item.id === selectedId ? 'bg-primary/10 font-medium' : ''
            }`}
          >
            <span className="block">{item.primary}</span>
            {item.secondary && <span className="block text-xs text-muted-foreground">{item.secondary}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
};

export default BnMeansInitiationWizard;
