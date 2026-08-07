/**
 * BN Means-Test — assessment workspace (MT4).
 *
 * Structured intake sections driven entirely by the governed command and
 * query services. Lifecycle rules are NEVER recomputed in React: the
 * canonical `bn_means_available_actions_v1` query decides what is allowed
 * and why.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, ArrowLeft, Loader2, ShieldAlert } from 'lucide-react';
import {
  meansQueryService,
  type BnMeansAvailableAction,
  type BnMeansCalculationReadiness,
} from '@/services/bn/meansTests/meansQueryService';
import { meansCommandService, type BnMeansCommandResult } from '@/services/bn/meansTests/meansCommandService';
import type { BnMeansCommandName } from '@/types/bn/meansTests/meansCommands';
import { formatWithCurrency } from '@/utils/formatCurrency';
import {
  BnMeansVerificationPanel,
  buildFactGroups,
  type BnMeansVerificationRecord,
} from '@/components/bn/meansTests/BnMeansVerificationPanel';
import { BnMeansCalculationPanel } from '@/components/bn/meansTests/BnMeansCalculationPanel';
import { BnMeansAdjustmentsPanel } from '@/components/bn/meansTests/BnMeansAdjustmentsPanel';
import { BnMeansApprovalPanel } from '@/components/bn/meansTests/BnMeansApprovalPanel';
import BnMeansHouseholdSection from '@/components/bn/meansTests/household/BnMeansHouseholdSection';
import BnMeansIncomeSection from '@/components/bn/meansTests/income/BnMeansIncomeSection';
import BnMeansAssetSection from '@/components/bn/meansTests/assets/BnMeansAssetSection';
import BnMeansDeductionsSection from '@/components/bn/meansTests/deductions/BnMeansDeductionsSection';
import BnMeansContextPanel from '@/components/bn/meansTests/context/BnMeansContextPanel';
import BnMeansStageJourney, { type BnMeansStage } from '@/components/bn/meansTests/BnMeansStageJourney';
import { humaniseMeansCode } from '@/types/bn/meansTests/meansFieldContract';
import {
  BN_MEANS_REASON_LABEL,
  meansStatusLabel,
  type BnMeansAdjustmentRow,
  type BnMeansApprovalContext,
} from '@/types/bn/meansTests/meansAdjustments';

/** Canonical denial wording. Reasons always originate from the backend. */
const REASON_LABEL: Record<string, string> = BN_MEANS_REASON_LABEL;

export interface BnMeansAssessmentWorkspaceProps {
  assessmentId: string;
  onBack: () => void;
}

type Row = Record<string, unknown>;

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

export const BnMeansAssessmentWorkspace: React.FC<BnMeansAssessmentWorkspaceProps> = ({
  assessmentId,
  onBack,
}) => {
  const queryClient = useQueryClient();
  const [commandError, setCommandError] = React.useState<BnMeansCommandResult | null>(null);
  // Only a genuinely successful command clears operator-entered information.
  const [successToken, setSuccessToken] = React.useState(0);

  const detail = useQuery({
    queryKey: ['bn-means-detail', assessmentId],
    queryFn: () => meansQueryService.detail(assessmentId),
  });
  const actions = useQuery({
    queryKey: ['bn-means-actions', assessmentId],
    queryFn: () => meansQueryService.availableActions(assessmentId),
  });
  const readiness = useQuery({
    queryKey: ['bn-means-readiness', assessmentId],
    queryFn: () => meansQueryService.calculationReadiness(assessmentId),
  });
  const adjustments = useQuery({
    queryKey: ['bn-means-adjustments', assessmentId],
    queryFn: () => meansQueryService.adjustments(assessmentId),
  });
  const approval = useQuery({
    queryKey: ['bn-means-approval-context', assessmentId],
    queryFn: () => meansQueryService.approvalContext(assessmentId),
  });
  // EPIC 2 — household readiness drives the journey strip; never recomputed here.
  const householdReadiness = useQuery({
    queryKey: ['bn-means-household-readiness', assessmentId],
    queryFn: () => meansQueryService.householdReadiness(assessmentId),
  });
  // EPIC 3 — income readiness drives the journey strip; never recomputed here.
  const incomeReadiness = useQuery({
    queryKey: ['bn-means-income-readiness', assessmentId],
    queryFn: () => meansQueryService.incomeReadiness(assessmentId),
  });
  // EPIC 4 — asset readiness drives the journey strip; never recomputed here.
  const assetReadiness = useQuery({
    queryKey: ['bn-means-asset-readiness', assessmentId],
    queryFn: () => meansQueryService.assetReadiness(assessmentId),
  });
  // EPIC 5 — deduction readiness drives the journey strip; never recomputed here.
  const deductionReadiness = useQuery({
    queryKey: ['bn-means-deduction-readiness', assessmentId],
    queryFn: () => meansQueryService.deductionReadiness(assessmentId),
  });
  const [activeTab, setActiveTab] = React.useState('context');

  const run = useMutation({
    mutationFn: (input: { command: BnMeansCommandName; payload?: Record<string, unknown> }) =>
      meansCommandService.execute({
        command: input.command,
        assessmentId,
        expectedRowVersion: rowVersion,
        payload: input.payload,
      }),
    onSuccess: (result) => {
      if (result.status === 'FAILED') {
        setCommandError(result);
        return;
      }
      setCommandError(null);
      setSuccessToken((t) => t + 1);
      queryClient.invalidateQueries({ queryKey: ['bn-means-detail', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['bn-means-actions', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['bn-means-readiness', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['bn-means-adjustments', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['bn-means-approval-context', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['bn-means-queue'] });
      queryClient.invalidateQueries({ queryKey: ['bn-means-household', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['bn-means-household-readiness', assessmentId] });
    },
  });



  if (detail.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (detail.data && detail.data.status !== 'OK') {
    return (
      <Alert variant="destructive">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Assessment unavailable</AlertTitle>
        <AlertDescription>
          {detail.data.status === 'DENIED'
            ? 'You do not have permission to view this assessment.'
            : detail.data.status === 'NOT_FOUND'
              ? 'This assessment no longer exists.'
              : `The assessment could not be loaded (${detail.data.detail ?? detail.data.code ?? 'unknown error'}).`}
        </AlertDescription>
      </Alert>
    );
  }

  const data = (detail.data?.data ?? {}) as Row;
  const assessment = (data.assessment ?? {}) as Row;
  const rowVersion = Number(assessment.row_version ?? 0);
  const currency = String(assessment.currency_code ?? 'XCD');
  const availableActions = (actions.data?.data ?? []) as readonly BnMeansAvailableAction[];
  const actionFor = (command: string) => availableActions.find((a) => a.command === command);

  // MT6 — verification and calculation state, all backend-owned.
  const verifyAction = actionFor('BN_MEANS_VERIFY_INFORMATION');
  const calculateAction = actionFor('BN_MEANS_CALCULATE');
  const factGroups = buildFactGroups(data as Record<string, unknown>, currency);
  const verifications = asRows(data.verifications) as unknown as readonly BnMeansVerificationRecord[];
  const calculations = asRows(data.calculations);
  const latestCalculation = (calculations[0] ?? null) as Record<string, unknown> | null;
  const readinessData =
    readiness.data?.status === 'OK'
      ? ((readiness.data.data ?? null) as BnMeansCalculationReadiness | null)
      : null;
  const readinessUnavailable =
    readiness.isError
      ? 'Readiness could not be loaded. Treat it as unknown, not as ready.'
      : readiness.data && readiness.data.status !== 'OK'
        ? readiness.data.status === 'DENIED'
          ? 'You do not have permission to evaluate calculation readiness.'
          : `Readiness could not be evaluated (${readiness.data.detail ?? readiness.data.code ?? 'unknown error'}).`
        : null;

  // MT7 — adjustments and independent approval, all backend-owned.
  const adjustmentRows =
    adjustments.data?.status === 'OK'
      ? ((adjustments.data.data ?? []) as readonly BnMeansAdjustmentRow[])
      : [];
  const adjustmentsUnavailable = adjustments.isError
    ? 'Adjustments could not be loaded.'
    : adjustments.data && adjustments.data.status !== 'OK'
      ? adjustments.data.status === 'DENIED'
        ? 'You do not have permission to view adjustments for this assessment.'
        : `Adjustments could not be loaded (${adjustments.data.detail ?? adjustments.data.code ?? 'unknown error'}).`
      : null;
  const approvalContext =
    approval.data?.status === 'OK'
      ? ((approval.data.data ?? null) as BnMeansApprovalContext | null)
      : null;
  const approvalUnavailable = approval.isError
    ? 'Approval context could not be loaded.'
    : approval.data && approval.data.status !== 'OK'
      ? approval.data.status === 'DENIED'
        ? 'You do not have permission to view the approval context.'
        : `Approval context could not be loaded (${approval.data.detail ?? approval.data.code ?? 'unknown error'}).`
      : null;
  const openAdjustmentCount = adjustmentRows.filter(
    (a) => a.status === 'REQUESTED' || a.status === 'APPROVED_PENDING_APPLICATION',
  ).length;


  // EPIC 2 — officer-readable context. Raw identifiers are never the headline.
  const personLabel =
    String(assessment.person_name ?? '') ||
    (assessment.person_id ? `Person ${assessment.person_id}` : 'Person not identified');
  const claimLabel = assessment.claim_reference
    ? `Claim ${assessment.claim_reference}`
    : assessment.claim_id
      ? `Claim ${assessment.claim_id}`
      : null;
  const awardLabel = assessment.award_reference
    ? `Award ${assessment.award_reference}`
    : assessment.award_id
      ? `Award ${assessment.award_id}`
      : null;
  const policyLabel =
    String(assessment.policy_version_label ?? '') ||
    (assessment.policy_version_id ? 'Attached policy version' : 'No policy version attached');

  const householdReady =
    householdReadiness.data?.status === 'OK' ? householdReadiness.data.data : null;
  const incomeReady =
    incomeReadiness.data?.status === 'OK' ? incomeReadiness.data.data : null;
  const assetReady =
    assetReadiness.data?.status === 'OK' ? assetReadiness.data.data : null;
  const deductionReady =
    deductionReadiness.data?.status === 'OK' ? deductionReadiness.data.data : null;
  const householdComplete = Boolean(householdReady?.section_complete);
  const stages: readonly BnMeansStage[] = [
    { key: 'context', label: 'Confirm context', state: 'COMPLETE', hint: 'Person, claim and period' },
    {
      key: 'household',
      label: 'Household composition',
      state: householdComplete
        ? 'COMPLETE'
        : (householdReady?.blockers.length ?? 0) > 0
          ? 'BLOCKED'
          : 'CURRENT',
      hint: householdReady ? `${householdReady.household_size} in household` : 'Who lived in the household',
    },
    {
      key: 'income',
      label: 'Income',
      state: incomeReady?.section_marked_complete
        ? 'COMPLETE'
        : !householdComplete
          ? 'PENDING'
          : (incomeReady?.blockers.length ?? 0) > 0
            ? 'BLOCKED'
            : 'CURRENT',
      hint: incomeReady
        ? `${incomeReady.current_income_count} income record${
            incomeReady.current_income_count === 1 ? '' : 's'
          }`
        : 'Declared income',
    },
    {
      key: 'assets',
      label: 'Assets',
      state: assetReady?.section_marked_complete
        ? 'COMPLETE'
        : !incomeReady?.section_marked_complete
          ? 'PENDING'
          : (assetReady?.blockers.length ?? 0) > 0
            ? 'BLOCKED'
            : 'CURRENT',
      hint: assetReady
        ? `${assetReady.current_asset_count} asset record${
            assetReady.current_asset_count === 1 ? '' : 's'
          }`
        : 'Declared assets',
    },
    {
      key: 'deductions',
      label: 'Deductions',
      state: deductionReady?.section_marked_complete
        ? 'COMPLETE'
        : !assetReady?.section_marked_complete
          ? 'PENDING'
          : (deductionReady?.blockers.length ?? 0) > 0
            ? 'BLOCKED'
            : 'CURRENT',
      hint: deductionReady
        ? `${deductionReady.claim_count} claim${deductionReady.claim_count === 1 ? '' : 's'}`
        : 'Deductions and disregards claimed',
    },
    { key: 'evidence', label: 'Evidence', state: 'PENDING', hint: 'Not implemented yet' },
    { key: 'review', label: 'Review & submit', state: 'PENDING', hint: 'Not implemented yet' },
  ];


  const ActionButton: React.FC<{ command: BnMeansCommandName; label: string; payload?: Record<string, unknown> }> = ({
    command,
    label,
    payload,
  }) => {
    const state = actionFor(command);
    const disabled = !state?.allowed || run.isPending;
    return (
      <div className="flex flex-col gap-1">
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => run.mutate({ command, payload })}
        >
          {run.isPending && run.variables?.command === command && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          {label}
        </Button>
        {state && !state.allowed && state.reason && (
          <span className="text-xs text-muted-foreground">
            {REASON_LABEL[state.reason] ?? state.reason}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Work queue
          </Button>
          <div>
            <h2 className="text-xl font-semibold">{personLabel}</h2>
            <p className="text-sm text-muted-foreground">
              {String(assessment.assessment_reference ?? '')} ·{' '}
              {humaniseMeansCode(String(assessment.benefit_programme ?? ''))} ·{' '}
              {humaniseMeansCode(String(assessment.assessment_reason ?? ''))}
            </p>
            <p className="text-xs text-muted-foreground">
              {String(assessment.effective_from ?? '—')} → {String(assessment.effective_to ?? 'open-ended')}
              {claimLabel ? ` · ${claimLabel}` : ''}
              {awardLabel ? ` · ${awardLabel}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" data-testid="means-status-badge">
            {meansStatusLabel(String(assessment.status ?? ''), Boolean(latestCalculation))}
          </Badge>
          <Badge variant="outline">Version {rowVersion}</Badge>
          {openAdjustmentCount > 0 && (
            <Badge variant="outline" data-testid="means-open-adjustments-badge">
              {openAdjustmentCount} open adjustment{openAdjustmentCount === 1 ? '' : 's'}
            </Badge>
          )}
        </div>
      </div>

      {commandError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{REASON_LABEL[commandError.errorCode ?? ''] ?? 'Command failed'}</AlertTitle>
          <AlertDescription>
            {commandError.errorCode}
            {commandError.errorDetail ? ` — ${commandError.errorDetail}` : ''}
          </AlertDescription>
        </Alert>
      )}

      <BnMeansStageJourney stages={stages} onSelect={setActiveTab} />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="context">Context</TabsTrigger>
          <TabsTrigger value="household">Household</TabsTrigger>
          <TabsTrigger value="income">Income</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="deductions">Deductions</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="review">Review &amp; submit</TabsTrigger>
          <TabsTrigger value="verification">Verification</TabsTrigger>
          <TabsTrigger value="calculation">Calculation</TabsTrigger>
          <TabsTrigger value="adjustments">Adjustments</TabsTrigger>
          <TabsTrigger value="approval">Approval</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>


        </TabsList>

        <TabsContent value="context">
          <BnMeansContextPanel
            assessment={assessment}
            personLabel={personLabel}
            claimLabel={claimLabel}
            awardLabel={awardLabel}
            policyLabel={policyLabel}
            canCorrect={Boolean(actionFor('BN_MEANS_CORRECT_CONTEXT')?.allowed)}
            correctionReason={
              actionFor('BN_MEANS_CORRECT_CONTEXT')?.reason
                ? REASON_LABEL[actionFor('BN_MEANS_CORRECT_CONTEXT')!.reason as string] ??
                  actionFor('BN_MEANS_CORRECT_CONTEXT')!.reason
                : null
            }
            busy={run.isPending}
            onCorrect={(payload) => run.mutate({ command: 'BN_MEANS_CORRECT_CONTEXT', payload })}
          />
        </TabsContent>

        <TabsContent value="household">
          <BnMeansHouseholdSection
            assessmentId={assessmentId}
            assessmentFrom={String(assessment.effective_from ?? '')}
            assessmentTo={assessment.effective_to ? String(assessment.effective_to) : null}
            assessedPersonId={
              assessment.person_id === null || assessment.person_id === undefined
                ? null
                : Number(assessment.person_id)
            }
            editable={Boolean(actionFor('BN_MEANS_ADD_HOUSEHOLD_MEMBER')?.allowed)}
            availableActions={availableActions.filter((a) => a.allowed).map((a) => a.command)}
            onSectionComplete={() => setActiveTab('income')}
          />
        </TabsContent>

        <TabsContent value="income">
          <BnMeansIncomeSection
            assessmentId={assessmentId}
            assessmentFrom={String(assessment.effective_from ?? '')}
            assessmentTo={assessment.effective_to ? String(assessment.effective_to) : null}
            editable={Boolean(actionFor('BN_MEANS_ADD_INCOME')?.allowed)}
            availableActions={availableActions.filter((a) => a.allowed).map((a) => a.command)}
            onSectionComplete={() => setActiveTab('assets')}
          />
        </TabsContent>


        <TabsContent value="assets">
          <BnMeansAssetSection
            assessmentId={assessmentId}
            assessmentFrom={String(assessment.effective_from ?? '')}
            assessmentTo={assessment.effective_to ? String(assessment.effective_to) : null}
            editable={Boolean(actionFor('BN_MEANS_ADD_ASSET')?.allowed)}
            availableActions={availableActions.filter((a) => a.allowed).map((a) => a.command)}
            onSectionComplete={() => setActiveTab('deductions')}
          />
        </TabsContent>


        <TabsContent value="deductions">
          <BnMeansDeductionsSection
            assessmentId={assessmentId}
            assessmentFrom={String(assessment.effective_from ?? '')}
            assessmentTo={assessment.effective_to ? String(assessment.effective_to) : null}
            editable={Boolean(actionFor('BN_MEANS_ADD_DEDUCTION')?.allowed)}
            availableActions={availableActions.filter((a) => a.allowed).map((a) => a.command)}
            onSectionComplete={() => setActiveTab('evidence')}
          />
        </TabsContent>

        <TabsContent value="evidence">
          <FactSection
            title="Evidence"
            description="Governed document references only — no document content is stored here."
            rows={asRows(data.evidence)}
            columns={[
              ['evidence_type', 'Type'],
              ['dms_document_id', 'Document'],
              ['dms_reference', 'Reference'],
              ['status', 'Status'],
              ['fact_kind', 'Linked fact'],
            ]}
            form={
              <InlineFactForm
                fields={[
                  { name: 'evidence_type', label: 'Evidence type', required: true },
                  { name: 'dms_document_id', label: 'Document ID' },
                  { name: 'dms_reference', label: 'Document reference' },
                ]}
                submitLabel="Attach evidence"
                disabled={!actionFor('BN_MEANS_ATTACH_EVIDENCE')?.allowed || run.isPending}
                reason={actionFor('BN_MEANS_ATTACH_EVIDENCE')?.reason ?? null}
                onSubmit={(payload) => run.mutate({ command: 'BN_MEANS_ATTACH_EVIDENCE', payload })}
              />
            }
          />
        </TabsContent>

        <TabsContent value="review">
          <Card>
            <CardHeader>
              <CardTitle>Completeness review and submission</CardTitle>
              <CardDescription>
                Submission freezes the assessment version. Later corrections require a successor
                version, a return-to-information flow or the adjustment process.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Summary label="Household members" value={asRows(data.household).length} />
                <Summary label="Income facts" value={asRows(data.income).length} />
                <Summary label="Evidence items" value={asRows(data.evidence).length} />
              </div>
              <div className="flex flex-wrap gap-4">
                <ActionButton command="BN_MEANS_SUBMIT" label="Submit assessment" />
              </div>
              <div>
                <p className="mb-2 text-xs uppercase text-muted-foreground">Frozen versions</p>
                {asRows(data.versions).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No frozen version yet.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {asRows(data.versions).map((v) => (
                      <li key={String(v.assessment_version_id)}>
                        v{String(v.version_no)} · {String(v.frozen_reason)} ·{' '}
                        <span className="font-mono text-xs">{String(v.snapshot_hash).slice(0, 12)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="verification">
          <BnMeansVerificationPanel
            groups={factGroups}
            verifications={verifications}
            canVerify={Boolean(verifyAction?.allowed) && !run.isPending}
            disabledReason={
              verifyAction?.allowed
                ? null
                : REASON_LABEL[verifyAction?.reason ?? ''] ?? verifyAction?.reason ?? 'not currently available'
            }
            busy={run.isPending}
            onVerify={(input) =>
              run.mutate({
                command: 'BN_MEANS_VERIFY_INFORMATION',
                payload: {
                  fact_kind: input.factKind,
                  fact_id: input.factId,
                  outcome: input.outcome,
                  reason_code: input.reasonCode ?? null,
                  notes: input.note ?? null,
                },
              })
            }
          />
        </TabsContent>

        <TabsContent value="calculation">
          <BnMeansCalculationPanel
            readiness={readinessData}
            readinessUnavailable={readinessUnavailable}
            calculation={latestCalculation}
            currency={currency}
            canCalculate={Boolean(calculateAction?.allowed) && !run.isPending}
            calculateReason={
              calculateAction?.allowed
                ? null
                : REASON_LABEL[calculateAction?.reason ?? ''] ??
                  calculateAction?.reason ??
                  'Calculation is not currently available'
            }
            busy={run.isPending}
            onCalculate={() => run.mutate({ command: 'BN_MEANS_CALCULATE' })}
          />
        </TabsContent>

        <TabsContent value="adjustments">
          <BnMeansAdjustmentsPanel
            adjustments={adjustmentRows}
            loadFailure={adjustmentsUnavailable}
            currency={currency}
            calculationId={
              approvalContext?.calculation_id ??
              (latestCalculation?.calculation_id ? String(latestCalculation.calculation_id) : null)
            }
            calculationHash={
              approvalContext?.calculation_hash ??
              (latestCalculation?.calculation_hash ? String(latestCalculation.calculation_hash) : null)
            }
            assessmentVersionId={approvalContext?.assessment_version_id ?? null}
            rowVersion={rowVersion}
            requestAction={actionFor('BN_MEANS_REQUEST_ADJUSTMENT')}
            decideAction={actionFor('BN_MEANS_APPROVE_ADJUSTMENT')}
            busy={run.isPending}
            successToken={successToken}
            onRequest={(payload) => run.mutate({ command: 'BN_MEANS_REQUEST_ADJUSTMENT', payload })}
            onDecide={(payload) => run.mutate({ command: 'BN_MEANS_APPROVE_ADJUSTMENT', payload })}
          />
        </TabsContent>

        <TabsContent value="approval">
          <BnMeansApprovalPanel
            context={approvalContext}
            loadFailure={approvalUnavailable}
            approveAction={actionFor('BN_MEANS_APPROVE')}
            rejectAction={actionFor('BN_MEANS_REJECT')}
            busy={run.isPending}
            successToken={successToken}
            onApprove={(payload) => run.mutate({ command: 'BN_MEANS_APPROVE', payload })}
            onReject={(payload) => run.mutate({ command: 'BN_MEANS_REJECT', payload })}
          />
        </TabsContent>



        <TabsContent value="timeline">

          <Card>
            <CardHeader>
              <CardTitle>Audit timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {asRows(data.timeline).length === 0 ? (
                <p className="text-sm text-muted-foreground">No events recorded.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {asRows(data.timeline).map((e) => (
                    <li key={String(e.event_id)} className="border-l-2 border-border pl-3">
                      <p className="font-medium">{String(e.event_code)}</p>
                      <p className="text-xs text-muted-foreground">
                        {String(e.command_name ?? '')} · {String(e.from_status ?? '—')} →{' '}
                        {String(e.to_status ?? '—')} · {String(e.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

const Summary: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-md border border-border p-3">
    <p className="text-xs uppercase text-muted-foreground">{label}</p>
    <p className="text-2xl font-semibold">{value}</p>
  </div>
);

interface FactSectionProps {
  title: string;
  description: string;
  rows: Row[];
  columns: readonly (readonly [string, string])[];
  form: React.ReactNode;
  currency?: string;
}

const MONEY_FIELDS = new Set([
  'declared_amount',
  'normalised_annual_amount',
  'valuation_amount',
  'claimed_amount',
]);

const FactSection: React.FC<FactSectionProps> = ({ title, description, rows, columns, form, currency }) => (
  <Card>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-6">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map(([key, label]) => (
                <TableHead key={key}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={String(row.member_id ?? row.income_fact_id ?? row.asset_fact_id ?? row.deduction_fact_id ?? row.evidence_id ?? index)}>
                {columns.map(([key]) => {
                  const value = row[key];
                  const display =
                    value === null || value === undefined
                      ? '—'
                      : MONEY_FIELDS.has(key) && currency
                        ? formatWithCurrency(Number(value), currency)
                        : typeof value === 'boolean'
                          ? value ? 'Yes' : 'No'
                          : String(value);
                  return <TableCell key={key}>{display}</TableCell>;
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {form}
    </CardContent>
  </Card>
);

interface InlineField {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'date';
  required?: boolean;
}

interface InlineFactFormProps {
  fields: readonly InlineField[];
  submitLabel: string;
  disabled: boolean;
  reason: string | null;
  onSubmit: (payload: Record<string, unknown>) => void;
}

/** Entered data is preserved after a recoverable command failure. */
const InlineFactForm: React.FC<InlineFactFormProps> = ({ fields, submitLabel, disabled, reason, onSubmit }) => {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const missing = fields.filter((f) => f.required && !values[f.name]?.trim()).map((f) => f.label);

  return (
    <form
      className="space-y-3 rounded-md border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (missing.length > 0) return;
        const payload: Record<string, unknown> = {};
        for (const field of fields) {
          const raw = values[field.name]?.trim();
          if (!raw) continue;
          payload[field.name] = field.type === 'number' ? Number(raw) : raw;
        }
        onSubmit(payload);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map((field) => (
          <div key={field.name} className="space-y-1">
            <Label htmlFor={field.name}>{field.label}</Label>
            <Input
              id={field.name}
              type={field.type ?? 'text'}
              value={values[field.name] ?? ''}
              disabled={disabled}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
              }
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="secondary" disabled={disabled || missing.length > 0}>
          {submitLabel}
        </Button>
        {missing.length > 0 && (
          <span className="text-xs text-muted-foreground">Required: {missing.join(', ')}</span>
        )}
        {disabled && reason && (
          <span className="text-xs text-muted-foreground">{REASON_LABEL[reason] ?? reason}</span>
        )}
      </div>
    </form>
  );
};

export default BnMeansAssessmentWorkspace;
