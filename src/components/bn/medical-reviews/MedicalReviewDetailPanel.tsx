/**
 * BN Medical Reviews — obligation detail panel and Benefits operational
 * workflows (referral, appointment, report validation, Board referral,
 * administrative decision, award proposals).
 *
 * Two hard rules are visible in the structure below:
 *
 *  1. A failed secondary query is NEVER rendered as "no data". Every section
 *     carries its own state (loading / loaded / empty / permission denied /
 *     failed / not applicable) and a failure never destroys the main detail.
 *  2. Confidential clinical evidence is fetched only after an explicit,
 *     audited operator action — see `ConfidentialEvidenceSection`.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, Gavel, Stethoscope, ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  medicalReviewQueryService,
  type MedicalReviewDetail,
  type BoardRequirement,
} from '@/services/bn/medicalReviewQueryService';
import { medicalReviewCommandService } from '@/services/bn/medicalReviewCommandService';
import { describeMedicalReviewFailure } from '@/features/bn/medical-reviews/model/errors';
import {
  MEDICAL_REVIEW_ACTIONS,
  type MedicalReviewAction,
} from '@/features/bn/medical-reviews/model/permissions';
import {
  AWARD_PROPOSAL_BOUNDARY_TEXT,
  appointmentActionAvailability,
  assessmentActionAvailability,
  awardProposalActionAvailability,
  boardCaseActionAvailability,
  decisionActionAvailability,
  obligationActionAvailability,
  referralActionAvailability,
} from '@/features/bn/medical-reviews/model/actionAvailability';
import {
  MedicalReviewActionButton,
  MedicalReviewStatusBadge,
} from '@/components/bn/medical-reviews/MedicalReviewActionControls';
import ConfidentialEvidenceSection from '@/components/bn/medical-reviews/ConfidentialEvidenceSection';
import MedicalReviewCommandDialog, {
  type CommandField,
} from '@/components/bn/medical-reviews/MedicalReviewCommandDialog';
import SectionStateView from '@/components/bn/medical-reviews/SectionState';
import { useSectionQuery } from '@/hooks/bn/useMedicalReviewSection';
import {
  DECISION_OUTCOME_CODES,
  DECISION_REASON_CODES,
  NON_ATTENDANCE_CATEGORIES,
  REASONABLE_CAUSE_OUTCOMES,
} from '@/features/bn/medical-reviews/model/controlledValues';

interface Props {
  obligationId: string;
  reviewType?: string | null;
  hasPermission: (action: MedicalReviewAction) => boolean;
  actionsEnabled: boolean;
  canViewConfidential: boolean;
  canViewAudit: boolean;
}

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className="text-sm">{value ?? '—'}</div>
  </div>
);

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Dialog descriptors are declared inline; this keeps the open-state plumbing tiny. */
type DialogId =
  | null
  | 'assign_provider'
  | 'nominate_doctor'
  | 'verify_provider'
  | 'issue_referral'
  | 'reassign_provider'
  | 'expire_referral'
  | 'second_opinion'
  | 'schedule_appointment'
  | 'reschedule_appointment'
  | 'record_attendance'
  | 'record_non_attendance'
  | 'record_provider_cancellation'
  | 'reasonable_cause'
  | 'validate_report'
  | 'reject_report'
  | 'request_clarification'
  | 'lock_assessment'
  | 'refer_to_board'
  | 'select_board'
  | 'prepare_decision'
  | 'submit_decision'
  | 'return_decision'
  | 'approve_decision'
  | 'complete_decision'
  | 'propose_suspension'
  | 'propose_reinstatement';

export const MedicalReviewDetailPanel: React.FC<Props> = ({
  obligationId,
  reviewType,
  hasPermission,
  actionsEnabled,
  canViewConfidential,
  canViewAudit,
}) => {
  const [dialog, setDialog] = useState<DialogId>(null);

  /* ---------------- main detail (its own state) ---------------- */
  const detailSection = useSectionQuery<MedicalReviewDetail>(
    obligationId,
    () => medicalReviewQueryService.detail(obligationId),
    () => false,
  );
  const detail = detailSection.data;

  const reloadDetail = useCallback(async (): Promise<number | null> => {
    const fresh = await medicalReviewQueryService.detail(obligationId);
    detailSection.reload();
    return fresh.rowVersion;
  }, [obligationId, detailSection]);

  /* ---------------- independent secondary sections ---------------- */
  const boardSection = useSectionQuery<BoardRequirement>(
    obligationId,
    () => medicalReviewQueryService.boardRequirement(obligationId),
    () => false,
  );

  const assessmentSection = useSectionQuery<Row[]>(
    obligationId,
    async () => (await medicalReviewQueryService.assessmentSummary(obligationId)).rows as Row[],
    (rows) => rows.length === 0,
  );

  const appointmentSection = useSectionQuery<Row[]>(
    obligationId,
    async () => (await medicalReviewQueryService.appointmentHistory(obligationId)).rows as Row[],
    (rows) => rows.length === 0,
  );

  const decisionSection = useSectionQuery<Row[]>(
    obligationId,
    async () => (await medicalReviewQueryService.decisionDetail(obligationId)) as Row[],
    (rows) => rows.length === 0,
  );

  const proposalSection = useSectionQuery<Row[]>(
    obligationId,
    async () => (await medicalReviewQueryService.proposalLinks(obligationId)) as Row[],
    (rows) => rows.length === 0,
  );

  const auditSection = useSectionQuery<Row[]>(
    obligationId,
    async () => (await medicalReviewQueryService.auditTimeline(obligationId)).rows as unknown as Row[],
    (rows) => rows.length === 0,
    { enabled: canViewAudit, notApplicableMessage: 'Audit history requires bn.medical_review.view_audit.' },
  );

  /* ---------------- derived record state ---------------- */
  const referral = (assessmentSection.data?.[0] ?? {}) as Row;
  const referralId = s(referral.referral_id) ?? s(detail?.raw?.referral_id);
  const referralStatus = s(referral.referral_status) ?? s(detail?.raw?.referral_status);
  const referralRowVersion =
    typeof referral.referral_row_version === 'number' ? referral.referral_row_version : null;

  const assessment = (assessmentSection.data?.[0] ?? {}) as Row;
  const assessmentId = s(assessment.assessment_id);
  const assessmentStatus = s(assessment.assessment_status) ?? s(assessment.status);
  const assessmentRowVersion =
    typeof assessment.row_version === 'number' ? assessment.row_version : null;

  const appointment = (appointmentSection.data?.[0] ?? {}) as Row;
  const appointmentId = s(appointment.appointment_id);
  const appointmentStatus = s(appointment.appointment_status) ?? s(appointment.status);
  const appointmentRowVersion =
    typeof appointment.row_version === 'number' ? appointment.row_version : null;

  const decision = (decisionSection.data?.[0] ?? {}) as Row;
  const decisionId = s(decision.decision_id);
  const decisionStatus = s(decision.decision_status) ?? s(decision.status) ?? 'NONE';
  const decisionRowVersion =
    typeof decision.row_version === 'number' ? decision.row_version : null;
  const preparedByCurrentUser = decision.prepared_by_current_user === true;
  const returnedReason = s(decision.returned_reason);
  const bindingDetermination = boardSection.data?.raw?.determination_binding === true;

  const boardCaseId = s(detail?.raw?.board_case_id);
  const boardCaseStatus = s(detail?.raw?.board_case_status);
  const boardCaseRowVersion =
    typeof detail?.raw?.board_case_row_version === 'number'
      ? (detail!.raw.board_case_row_version as number)
      : null;

  /* ---------------- availability ---------------- */
  const obligationActions = useMemo(
    () =>
      obligationActionAvailability({
        hasPermission,
        actionsEnabled,
        state: detail?.obligationStatus ?? null,
        rowVersion: detail?.rowVersion ?? null,
      }),
    [hasPermission, actionsEnabled, detail],
  );

  const referralActions = useMemo(
    () =>
      referralActionAvailability({
        hasPermission,
        actionsEnabled,
        state: referralStatus,
        rowVersion: referralRowVersion,
      }),
    [hasPermission, actionsEnabled, referralStatus, referralRowVersion],
  );

  const appointmentActions = useMemo(
    () =>
      appointmentActionAvailability({
        hasPermission,
        actionsEnabled,
        state: appointmentStatus,
        rowVersion: appointmentRowVersion,
      }),
    [hasPermission, actionsEnabled, appointmentStatus, appointmentRowVersion],
  );

  const assessmentActions = useMemo(
    () =>
      assessmentActionAvailability({
        hasPermission,
        actionsEnabled,
        state: assessmentStatus,
        rowVersion: assessmentRowVersion,
      }),
    [hasPermission, actionsEnabled, assessmentStatus, assessmentRowVersion],
  );

  const boardActions = useMemo(
    () =>
      boardCaseActionAvailability({
        hasPermission,
        actionsEnabled,
        state: boardCaseStatus,
        rowVersion: boardCaseRowVersion,
      }),
    [hasPermission, actionsEnabled, boardCaseStatus, boardCaseRowVersion],
  );

  const decisionActions = useMemo(
    () =>
      decisionActionAvailability({
        hasPermission,
        actionsEnabled,
        state: decisionStatus,
        rowVersion: decisionRowVersion,
        preparedByCurrentUser,
        bindingDetermination,
      }),
    [
      hasPermission,
      actionsEnabled,
      decisionStatus,
      decisionRowVersion,
      preparedByCurrentUser,
      bindingDetermination,
    ],
  );

  const proposalActions = useMemo(
    () =>
      awardProposalActionAvailability({
        hasPermission,
        actionsEnabled,
        state: decisionStatus,
        rowVersion: null,
      }),
    [hasPermission, actionsEnabled, decisionStatus],
  );

  const referToBoardAvailability = useMemo(() => {
    const base = boardActions[MEDICAL_REVIEW_ACTIONS.manageBoardCase];
    return {
      ...base,
      action: MEDICAL_REVIEW_ACTIONS.referToBoard,
      permissionRequired: 'bn.medical_review.refer_to_board',
      enabled: hasPermission(MEDICAL_REVIEW_ACTIONS.referToBoard) && actionsEnabled && !!assessmentId,
      blockedReason: !hasPermission(MEDICAL_REVIEW_ACTIONS.referToBoard)
        ? 'You do not hold bn.medical_review.refer_to_board.'
        : !actionsEnabled
          ? 'Medical Reviews is in read-only dark launch. Operational actions are disabled for this environment.'
          : !assessmentId
            ? 'A validated assessment is required before referring to the Board.'
            : null,
    };
  }, [boardActions, hasPermission, actionsEnabled, assessmentId]);

  /* ---------------- rendering ---------------- */
  if (detailSection.status === 'loading') return <Skeleton className="h-64 w-full" />;

  if (detailSection.status === 'failed' || detailSection.status === 'permission_denied') {
    return (
      <Alert variant="destructive" data-testid="mr-detail-error">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Unable to open this review</AlertTitle>
        <AlertDescription>{detailSection.message}</AlertDescription>
      </Alert>
    );
  }

  if (!detail) return null;

  const reasonField: CommandField = {
    name: 'reason',
    label: 'Reason',
    type: 'textarea',
    required: true,
  };

  const refreshAfterReferral = () => {
    assessmentSection.reload();
    detailSection.reload();
  };
  const refreshAfterAppointment = () => {
    appointmentSection.reload();
    detailSection.reload();
  };
  const refreshAfterAssessment = () => {
    assessmentSection.reload();
  };
  const refreshAfterBoard = () => {
    boardSection.reload();
    detailSection.reload();
  };
  const refreshAfterDecision = () => {
    decisionSection.reload();
    detailSection.reload();
  };

  return (
    <Card data-testid="mr-detail-panel">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">
            {detail.obligationReference ?? 'Medical review'}
          </CardTitle>
          <div className="mt-1 flex items-center gap-2">
            <MedicalReviewStatusBadge status={detail.obligationStatus} />
            {boardSection.data?.boardRequired && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Gavel className="h-3.5 w-3.5" /> Board required ({boardSection.data.boardMode})
              </span>
            )}
            <Badge variant="outline">Version {detail.rowVersion}</Badge>
          </div>
        </div>
        {detail.awardId && (
          <Link
            to={`/bn/awards/${detail.awardId}`}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Open Award 360 <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="overview">
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="referral">Provider &amp; referral</TabsTrigger>
            <TabsTrigger value="appointment">Appointment</TabsTrigger>
            <TabsTrigger value="assessment">Report</TabsTrigger>
            <TabsTrigger value="board">Board</TabsTrigger>
            <TabsTrigger value="decision">Decision</TabsTrigger>
            <TabsTrigger value="proposals">Award proposals</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
          </TabsList>

          {/* ---------------- Overview ---------------- */}
          <TabsContent value="overview" className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Review type" value={detail.reviewType} />
              <Field label="Reason" value={detail.reviewReason} />
              <Field label="Due date" value={detail.dueDate} />
              <Field label="Notice due" value={detail.noticeDueDate} />
              <Field label="Grace end" value={detail.graceEndDate} />
              <Field label="Deferred until" value={detail.deferredUntil} />
              <Field label="Risk" value={detail.riskClassification} />
              <Field label="Board mode" value={boardSection.data?.boardMode ?? '—'} />
              <Field label="Assessment model" value={boardSection.data?.assessmentModel ?? '—'} />
            </div>
            <div className="flex flex-wrap gap-2">
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.deferReview}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.deferReview)}
                actionsEnabled={actionsEnabled}
                blockedReason={obligationActions[MEDICAL_REVIEW_ACTIONS.deferReview].blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('reasonable_cause')}
              >
                Defer review
              </MedicalReviewActionButton>
            </div>
          </TabsContent>

          {/* ---------------- Provider & referral ---------------- */}
          <TabsContent value="referral" className="mt-4 space-y-3">
            <SectionStateView
              name="referral"
              section={assessmentSection}
              emptyMessage="No referral has been raised for this review."
            >
              {(rows) => (
                <div className="space-y-2">
                  {rows.map((row, i) => (
                    <div key={i} className="rounded-md border p-3 text-sm">
                      <div className="font-medium">
                        {String(row.referral_reference ?? row.referral_id ?? `Referral ${i + 1}`)}
                      </div>
                      <div className="text-muted-foreground">
                        Status {String(row.referral_status ?? '—')} · Provider{' '}
                        {String(row.provider_name ?? '—')} · Fee responsibility{' '}
                        {String(row.fee_responsibility ?? '—')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionStateView>

            <div className="flex flex-wrap gap-2">
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.assignProvider}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.assignProvider)}
                actionsEnabled={actionsEnabled}
                blockedReason={obligationActions[MEDICAL_REVIEW_ACTIONS.assignProvider].blockedReason}
                size="sm"
                onClick={() => setDialog('assign_provider')}
              >
                Assign approved provider
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.assignProvider}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.assignProvider)}
                actionsEnabled={actionsEnabled}
                blockedReason={obligationActions[MEDICAL_REVIEW_ACTIONS.assignProvider].blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('nominate_doctor')}
              >
                Nominate treating doctor
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.verifyCredentials}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.verifyCredentials)}
                actionsEnabled={actionsEnabled}
                blockedReason={referralActions[MEDICAL_REVIEW_ACTIONS.verifyCredentials].blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('verify_provider')}
              >
                Verify nominated provider
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.issueReferral}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.issueReferral)}
                actionsEnabled={actionsEnabled}
                blockedReason={referralActions[MEDICAL_REVIEW_ACTIONS.issueReferral].blockedReason}
                size="sm"
                onClick={() => setDialog('issue_referral')}
              >
                Issue referral
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.assignProvider}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.assignProvider)}
                actionsEnabled={actionsEnabled}
                blockedReason={referralActions.reassign_provider?.blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('reassign_provider')}
              >
                Reassign provider
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.issueReferral}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.issueReferral)}
                actionsEnabled={actionsEnabled}
                blockedReason={referralActions.expire_referral?.blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('expire_referral')}
              >
                Expire referral
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.requestSecondOpinion}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.requestSecondOpinion)}
                actionsEnabled={actionsEnabled}
                blockedReason={
                  referralActions[MEDICAL_REVIEW_ACTIONS.requestSecondOpinion].blockedReason
                }
                size="sm"
                variant="outline"
                onClick={() => setDialog('second_opinion')}
              >
                Request second opinion
              </MedicalReviewActionButton>
            </div>
          </TabsContent>

          {/* ---------------- Appointment ---------------- */}
          <TabsContent value="appointment" className="mt-4 space-y-3">
            <SectionStateView
              name="appointment"
              section={appointmentSection}
              emptyMessage="No appointment has been scheduled."
            >
              {(rows) => (
                <div className="space-y-2">
                  {rows.map((row, i) => (
                    <div key={i} className="rounded-md border p-3 text-sm">
                      <div className="font-medium">{String(row.scheduled_at ?? '—')}</div>
                      <div className="text-muted-foreground">
                        {String(row.appointment_status ?? row.status ?? '—')} ·{' '}
                        {String(row.location_reference ?? '—')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionStateView>

            <Alert data-testid="mr-non-attendance-notice">
              <AlertTitle>Non-attendance does not suspend an award</AlertTitle>
              <AlertDescription>
                Recording non-attendance registers the missed appointment and the cause. It does not
                automatically suspend an award — any award consequence is a separate administrative
                decision executed through the Award Suspension boundary.
              </AlertDescription>
            </Alert>

            <div className="flex flex-wrap gap-2">
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.manageAppointment}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.manageAppointment)}
                actionsEnabled={actionsEnabled}
                blockedReason={referralId ? null : 'Issue a referral before scheduling.'}
                size="sm"
                onClick={() => setDialog('schedule_appointment')}
              >
                Schedule appointment
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.manageAppointment}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.manageAppointment)}
                actionsEnabled={actionsEnabled}
                blockedReason={
                  appointmentActions[MEDICAL_REVIEW_ACTIONS.manageAppointment].blockedReason
                }
                size="sm"
                variant="outline"
                onClick={() => setDialog('reschedule_appointment')}
              >
                Reschedule
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.manageAppointment}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.manageAppointment)}
                actionsEnabled={actionsEnabled}
                blockedReason={
                  appointmentActions[MEDICAL_REVIEW_ACTIONS.manageAppointment].blockedReason
                }
                size="sm"
                variant="outline"
                onClick={() => setDialog('record_attendance')}
              >
                Record attendance
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.manageAppointment}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.manageAppointment)}
                actionsEnabled={actionsEnabled}
                blockedReason={
                  appointmentActions[MEDICAL_REVIEW_ACTIONS.manageAppointment].blockedReason
                }
                size="sm"
                variant="outline"
                onClick={() => setDialog('record_non_attendance')}
              >
                Record non-attendance
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.manageAppointment}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.manageAppointment)}
                actionsEnabled={actionsEnabled}
                blockedReason={
                  appointmentActions[MEDICAL_REVIEW_ACTIONS.manageAppointment].blockedReason
                }
                size="sm"
                variant="outline"
                onClick={() => setDialog('record_provider_cancellation')}
              >
                Record provider cancellation
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.deferReview}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.deferReview)}
                actionsEnabled={actionsEnabled}
                blockedReason={appointmentActions.reasonable_cause?.blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('reasonable_cause')}
              >
                Record reasonable-cause outcome
              </MedicalReviewActionButton>
            </div>
          </TabsContent>

          {/* ---------------- Report validation ---------------- */}
          <TabsContent value="assessment" className="mt-4 space-y-3">
            <SectionStateView
              name="assessment"
              section={assessmentSection}
              emptyMessage="No assessment has been recorded yet."
            >
              {(rows) => (
                <div className="space-y-2">
                  {rows.map((row, i) => (
                    <div key={i} className="rounded-md border p-3 text-sm">
                      <div className="flex items-center gap-2 font-medium">
                        <Stethoscope className="h-4 w-4" />
                        {String(row.assessment_reference ?? row.assessment_id ?? `Assessment ${i + 1}`)}
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        Status: {String(row.assessment_status ?? row.status ?? '—')}
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        Medical conclusion: {String(row.medical_outcome ?? row.conclusion ?? '—')}
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Benefits users see safe medical conclusions only. Provider clinical findings are
                    not editable here.
                  </p>
                </div>
              )}
            </SectionStateView>

            <Separator />
            <ConfidentialEvidenceSection
              obligationId={obligationId}
              canViewConfidential={canViewConfidential}
            />

            <div className="flex flex-wrap gap-2">
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.validateReport}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.validateReport)}
                actionsEnabled={actionsEnabled}
                blockedReason={assessmentActions[MEDICAL_REVIEW_ACTIONS.validateReport].blockedReason}
                size="sm"
                onClick={() => setDialog('validate_report')}
              >
                Validate report
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.validateReport}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.validateReport)}
                actionsEnabled={actionsEnabled}
                blockedReason={assessmentActions[MEDICAL_REVIEW_ACTIONS.validateReport].blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('reject_report')}
              >
                Reject incomplete report
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.validateReport}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.validateReport)}
                actionsEnabled={actionsEnabled}
                blockedReason={assessmentActions[MEDICAL_REVIEW_ACTIONS.validateReport].blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('request_clarification')}
              >
                Request clarification / addendum
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.validateReport}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.validateReport)}
                actionsEnabled={actionsEnabled}
                blockedReason={assessmentActions.lock_assessment?.blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('lock_assessment')}
              >
                Lock accepted assessment
              </MedicalReviewActionButton>
            </div>
          </TabsContent>

          {/* ---------------- Board referral ---------------- */}
          <TabsContent value="board" className="mt-4 space-y-3">
            <SectionStateView
              name="board"
              section={boardSection}
              emptyMessage="Board requirement not evaluated."
            >
              {(requirement) => (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Board required"
                    value={requirement.boardRequired ? 'Yes — mandatory routing' : 'No'}
                  />
                  <Field label="Board mode" value={requirement.boardMode} />
                  <Field label="Board type" value={requirement.boardType} />
                  <Field label="Trigger snapshot" value={requirement.reason} />
                  <Field
                    label="Required quorum"
                    value={String(requirement.raw.required_quorum ?? '—')}
                  />
                  <Field
                    label="Required specialties"
                    value={
                      Array.isArray(requirement.raw.required_specialties)
                        ? (requirement.raw.required_specialties as unknown[]).join(', ')
                        : '—'
                    }
                  />
                  <Field
                    label="Authority"
                    value={
                      requirement.raw.determination_binding === true
                        ? 'Binding on the decision maker'
                        : 'Advisory'
                    }
                  />
                </div>
              )}
            </SectionStateView>

            {boardSection.data?.boardRequired && (
              <Alert data-testid="mr-board-mandatory">
                <AlertTitle>Mandatory Board routing</AlertTitle>
                <AlertDescription>
                  Policy requires a Medical Board determination for this review. This routing cannot
                  be bypassed from the user interface and is re-enforced by the command boundary.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.referToBoard}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.referToBoard)}
                actionsEnabled={actionsEnabled}
                blockedReason={referToBoardAvailability.blockedReason}
                size="sm"
                onClick={() => setDialog('refer_to_board')}
              >
                Refer to Board
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.manageBoardCase}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.manageBoardCase)}
                actionsEnabled={actionsEnabled}
                blockedReason={boardActions[MEDICAL_REVIEW_ACTIONS.manageBoardCase].blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('select_board')}
              >
                Select Board
              </MedicalReviewActionButton>
            </div>
          </TabsContent>

          {/* ---------------- Administrative decision ---------------- */}
          <TabsContent value="decision" className="mt-4 space-y-3">
            <SectionStateView
              name="decision"
              section={decisionSection}
              emptyMessage="No administrative decision has been prepared."
            >
              {(rows) => (
                <div className="space-y-2">
                  {rows.map((row, i) => (
                    <div key={i} className="space-y-1 rounded-md border p-3 text-sm">
                      <div className="font-medium">
                        Administrative outcome: {String(row.outcome_code ?? '—')} —{' '}
                        {String(row.decision_status ?? row.status ?? '—')}
                      </div>
                      <div className="text-muted-foreground">
                        Effective {String(row.effective_date ?? '—')} · Next review{' '}
                        {String(row.next_review_date ?? '—')}
                      </div>
                      <div className="text-muted-foreground">
                        Provider opinion: {String(row.provider_opinion ?? '—')}
                      </div>
                      <div className="text-muted-foreground">
                        Board determination: {String(row.board_determination ?? '—')} (
                        {row.board_binding === true ? 'binding' : 'advisory'})
                      </div>
                      <div className="text-muted-foreground">
                        Medical recommendation{' '}
                        {row.medical_recommendation_accepted === false ? 'departed from' : 'accepted'}
                        {row.departure_reason ? ` — ${String(row.departure_reason)}` : ''}
                      </div>
                      {String(row.decision_status ?? '') === 'RETURNED' && (
                        <div className="text-destructive" data-testid="mr-decision-returned-reason">
                          Returned: {String(row.returned_reason ?? '—')}
                        </div>
                      )}
                      {/COMPLETE/.test(String(row.decision_status ?? '')) && (
                        <div className="text-xs text-muted-foreground">
                          Completed decisions are read-only.
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </SectionStateView>

            {bindingDetermination && (
              <Alert data-testid="mr-binding-determination">
                <AlertTitle>Binding medical determination</AlertTitle>
                <AlertDescription>
                  The Medical Board determination for this review is binding and cannot be overridden
                  administratively.
                </AlertDescription>
              </Alert>
            )}

            {returnedReason && (
              <Alert data-testid="mr-decision-return-banner">
                <AlertTitle>Decision returned</AlertTitle>
                <AlertDescription>{returnedReason}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.prepareDecision}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.prepareDecision)}
                actionsEnabled={actionsEnabled}
                blockedReason={decisionActions[MEDICAL_REVIEW_ACTIONS.prepareDecision].blockedReason}
                size="sm"
                onClick={() => setDialog('prepare_decision')}
              >
                Prepare decision
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.prepareDecision}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.prepareDecision)}
                actionsEnabled={actionsEnabled}
                blockedReason={decisionId ? null : 'Prepare a decision first.'}
                size="sm"
                variant="outline"
                onClick={() => setDialog('submit_decision')}
              >
                Submit for approval
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.approveDecision}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.approveDecision)}
                actionsEnabled={actionsEnabled}
                blockedReason={decisionActions[MEDICAL_REVIEW_ACTIONS.approveDecision].blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('return_decision')}
              >
                Return decision
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.approveDecision}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.approveDecision)}
                actionsEnabled={actionsEnabled}
                blockedReason={decisionActions[MEDICAL_REVIEW_ACTIONS.approveDecision].blockedReason}
                size="sm"
                onClick={() => setDialog('approve_decision')}
              >
                Approve decision
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.closeReview}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.closeReview)}
                actionsEnabled={actionsEnabled}
                blockedReason={decisionActions.complete_decision?.blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('complete_decision')}
              >
                Complete decision
              </MedicalReviewActionButton>
            </div>
          </TabsContent>

          {/* ---------------- Award proposals ---------------- */}
          <TabsContent value="proposals" className="mt-4 space-y-3">
            <Alert>
              <AlertTitle>Proposal boundary</AlertTitle>
              <AlertDescription>{AWARD_PROPOSAL_BOUNDARY_TEXT}</AlertDescription>
            </Alert>

            <SectionStateView
              name="proposals"
              section={proposalSection}
              emptyMessage="No award proposals have been raised."
            >
              {(rows) => (
                <div className="space-y-2">
                  {rows.map((row, i) => (
                    <div key={i} className="rounded-md border p-3 text-sm">
                      <div className="font-medium">{String(row.proposal_type ?? 'Proposal')}</div>
                      <div className="text-muted-foreground">
                        Status {String(row.proposal_status ?? row.status ?? '—')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionStateView>

            <div className="flex flex-wrap gap-2">
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.proposeSuspension}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.proposeSuspension)}
                actionsEnabled={actionsEnabled}
                blockedReason={proposalActions[MEDICAL_REVIEW_ACTIONS.proposeSuspension].blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('propose_suspension')}
              >
                Create Suspension Proposal
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.proposeReinstatement}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.proposeReinstatement)}
                actionsEnabled={actionsEnabled}
                blockedReason={
                  proposalActions[MEDICAL_REVIEW_ACTIONS.proposeReinstatement].blockedReason
                }
                size="sm"
                variant="outline"
                onClick={() => setDialog('propose_reinstatement')}
              >
                Create Reinstatement Proposal
              </MedicalReviewActionButton>
            </div>
          </TabsContent>

          {/* ---------------- Audit ---------------- */}
          <TabsContent value="audit" className="mt-4 space-y-2">
            <SectionStateView
              name="audit"
              section={auditSection}
              emptyMessage="No audit entries recorded for this review."
            >
              {(rows) => (
                <div className="space-y-2">
                  {rows.map((row, i) => (
                    <div key={i} className="rounded-md border p-2 text-sm">
                      <span className="font-medium">{String(row.eventType ?? 'Event')}</span>
                      <span className="ml-2 text-muted-foreground">{String(row.occurredAt ?? '')}</span>
                    </div>
                  ))}
                </div>
              )}
            </SectionStateView>
          </TabsContent>
        </Tabs>
      </CardContent>

      {/* ================= Command dialogs ================= */}

      <MedicalReviewCommandDialog
        open={dialog === 'assign_provider'}
        onOpenChange={(o) => setDialog(o ? 'assign_provider' : null)}
        title="Assign approved provider"
        testId="mr-dialog-assign-provider"
        submitLabel="Assign provider"
        availability={obligationActions[MEDICAL_REVIEW_ACTIONS.assignProvider]}
        rowVersion={null}
        fields={[
          { name: 'providerId', label: 'Approved provider', type: 'provider', required: true, reviewType },
          { name: 'reason', label: 'Reason', type: 'textarea' },
        ]}
        execute={(v, ctx) =>
          medicalReviewCommandService.assignProvider(obligationId, String(v.providerId), {
            idempotencyKey: ctx.idempotencyKey,
            reason: (v.reason as string) ?? null,
          })
        }
        onCompleted={refreshAfterReferral}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'nominate_doctor'}
        onOpenChange={(o) => setDialog(o ? 'nominate_doctor' : null)}
        title="Nominate treating doctor"
        description="Nomination does not issue a referral. The nominated provider must be credential-verified first."
        testId="mr-dialog-nominate-doctor"
        submitLabel="Nominate doctor"
        availability={obligationActions[MEDICAL_REVIEW_ACTIONS.assignProvider]}
        rowVersion={null}
        fields={[
          { name: 'providerId', label: 'Treating doctor', type: 'provider', required: true, reviewType },
          { name: 'reason', label: 'Reason', type: 'textarea' },
        ]}
        execute={(v, ctx) =>
          medicalReviewCommandService.nominateTreatingDoctor(obligationId, String(v.providerId), {
            idempotencyKey: ctx.idempotencyKey,
            reason: (v.reason as string) ?? null,
          })
        }
        onCompleted={refreshAfterReferral}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'verify_provider'}
        onOpenChange={(o) => setDialog(o ? 'verify_provider' : null)}
        title="Verify nominated provider"
        testId="mr-dialog-verify-provider"
        submitLabel="Verify provider"
        availability={referralActions[MEDICAL_REVIEW_ACTIONS.verifyCredentials]}
        rowVersion={referralRowVersion}
        reloadRecord={reloadDetail}
        fields={[{ name: 'reason', label: 'Verification note', type: 'textarea' }]}
        execute={(v, ctx) =>
          medicalReviewCommandService.verifyNominatedProvider(referralId!, {
            expectedRowVersion: ctx.expectedRowVersion ?? 0,
            idempotencyKey: ctx.idempotencyKey,
            reason: (v.reason as string) ?? null,
          })
        }
        onCompleted={refreshAfterReferral}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'issue_referral'}
        onOpenChange={(o) => setDialog(o ? 'issue_referral' : null)}
        title="Issue referral"
        testId="mr-dialog-issue-referral"
        submitLabel="Issue referral"
        availability={referralActions[MEDICAL_REVIEW_ACTIONS.issueReferral]}
        rowVersion={referralRowVersion}
        reloadRecord={reloadDetail}
        fields={[{ name: 'reason', label: 'Reason', type: 'textarea' }]}
        execute={(v, ctx) =>
          medicalReviewCommandService.issueReferral(referralId!, {
            expectedRowVersion: ctx.expectedRowVersion ?? 0,
            idempotencyKey: ctx.idempotencyKey,
            reason: (v.reason as string) ?? null,
          })
        }
        onCompleted={refreshAfterReferral}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'reassign_provider'}
        onOpenChange={(o) => setDialog(o ? 'reassign_provider' : null)}
        title="Reassign provider"
        testId="mr-dialog-reassign-provider"
        submitLabel="Reassign provider"
        availability={referralActions.reassign_provider}
        rowVersion={referralRowVersion}
        reloadRecord={reloadDetail}
        fields={[
          { name: 'providerId', label: 'Replacement provider', type: 'provider', required: true, reviewType },
          reasonField,
        ]}
        execute={(v, ctx) =>
          medicalReviewCommandService.reassignProvider(
            referralId!,
            String(v.providerId),
            String(v.reason),
            { expectedRowVersion: ctx.expectedRowVersion ?? 0, idempotencyKey: ctx.idempotencyKey },
          )
        }
        onCompleted={refreshAfterReferral}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'expire_referral'}
        onOpenChange={(o) => setDialog(o ? 'expire_referral' : null)}
        title="Expire referral"
        testId="mr-dialog-expire-referral"
        submitLabel="Expire referral"
        availability={referralActions.expire_referral}
        rowVersion={referralRowVersion}
        reloadRecord={reloadDetail}
        fields={[{ name: 'reason', label: 'Reason', type: 'textarea' }]}
        execute={(v, ctx) =>
          medicalReviewCommandService.expireReferral(referralId!, {
            expectedRowVersion: ctx.expectedRowVersion ?? 0,
            idempotencyKey: ctx.idempotencyKey,
            reason: (v.reason as string) ?? null,
          })
        }
        onCompleted={refreshAfterReferral}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'second_opinion'}
        onOpenChange={(o) => setDialog(o ? 'second_opinion' : null)}
        title="Request second opinion"
        testId="mr-dialog-second-opinion"
        submitLabel="Request second opinion"
        availability={referralActions[MEDICAL_REVIEW_ACTIONS.requestSecondOpinion]}
        rowVersion={null}
        fields={[
          { name: 'providerId', label: 'Second-opinion provider', type: 'provider', required: true, reviewType },
          reasonField,
        ]}
        execute={(v, ctx) =>
          medicalReviewCommandService.requestSecondOpinion({
            obligationId,
            parentReferralId: referralId!,
            providerId: String(v.providerId),
            reason: String(v.reason),
            idempotencyKey: ctx.idempotencyKey,
          })
        }
        onCompleted={refreshAfterReferral}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'schedule_appointment'}
        onOpenChange={(o) => setDialog(o ? 'schedule_appointment' : null)}
        title="Schedule appointment"
        testId="mr-dialog-schedule-appointment"
        submitLabel="Schedule"
        availability={appointmentActions[MEDICAL_REVIEW_ACTIONS.manageAppointment]}
        rowVersion={null}
        fields={[
          { name: 'scheduledAt', label: 'Appointment date and time', type: 'datetime', required: true },
          { name: 'locationReference', label: 'Location', type: 'text' },
          { name: 'reason', label: 'Note', type: 'textarea' },
        ]}
        execute={(v, ctx) =>
          medicalReviewCommandService.scheduleAppointment({
            referralId: referralId!,
            scheduledAt: String(v.scheduledAt),
            locationReference: (v.locationReference as string) ?? null,
            idempotencyKey: ctx.idempotencyKey,
            reason: (v.reason as string) ?? null,
          })
        }
        onCompleted={refreshAfterAppointment}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'reschedule_appointment'}
        onOpenChange={(o) => setDialog(o ? 'reschedule_appointment' : null)}
        title="Reschedule appointment"
        testId="mr-dialog-reschedule-appointment"
        submitLabel="Reschedule"
        availability={appointmentActions[MEDICAL_REVIEW_ACTIONS.manageAppointment]}
        rowVersion={appointmentRowVersion}
        reloadRecord={reloadDetail}
        fields={[
          { name: 'scheduledAt', label: 'New date and time', type: 'datetime', required: true },
          reasonField,
        ]}
        execute={(v, ctx) =>
          medicalReviewCommandService.rescheduleAppointment(
            appointmentId!,
            String(v.scheduledAt),
            String(v.reason),
            { expectedRowVersion: ctx.expectedRowVersion ?? 0, idempotencyKey: ctx.idempotencyKey },
          )
        }
        onCompleted={refreshAfterAppointment}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'record_attendance'}
        onOpenChange={(o) => setDialog(o ? 'record_attendance' : null)}
        title="Record attendance"
        testId="mr-dialog-record-attendance"
        submitLabel="Record attendance"
        availability={appointmentActions[MEDICAL_REVIEW_ACTIONS.manageAppointment]}
        rowVersion={appointmentRowVersion}
        reloadRecord={reloadDetail}
        fields={[{ name: 'reason', label: 'Note', type: 'textarea' }]}
        execute={(v, ctx) =>
          medicalReviewCommandService.recordAttendance(appointmentId!, {
            expectedRowVersion: ctx.expectedRowVersion ?? 0,
            idempotencyKey: ctx.idempotencyKey,
            reason: (v.reason as string) ?? null,
          })
        }
        onCompleted={refreshAfterAppointment}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'record_non_attendance'}
        onOpenChange={(o) => setDialog(o ? 'record_non_attendance' : null)}
        title="Record non-attendance"
        boundaryNotice="Recording non-attendance does not automatically suspend an award."
        testId="mr-dialog-record-non-attendance"
        submitLabel="Record non-attendance"
        availability={appointmentActions[MEDICAL_REVIEW_ACTIONS.manageAppointment]}
        rowVersion={appointmentRowVersion}
        reloadRecord={reloadDetail}
        fields={[
          {
            name: 'category',
            label: 'Cause',
            type: 'select',
            required: true,
            options: NON_ATTENDANCE_CATEGORIES,
            help: 'Distinguishes claimant, provider and administrative causes.',
          },
          { name: 'notes', label: 'Notes', type: 'textarea', required: true },
          reasonField,
        ]}
        execute={(v, ctx) =>
          medicalReviewCommandService.recordNonAttendance(
            appointmentId!,
            String(v.category),
            String(v.notes),
            String(v.reason),
            { expectedRowVersion: ctx.expectedRowVersion ?? 0, idempotencyKey: ctx.idempotencyKey },
          )
        }
        onCompleted={refreshAfterAppointment}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'record_provider_cancellation'}
        onOpenChange={(o) => setDialog(o ? 'record_provider_cancellation' : null)}
        title="Record provider cancellation"
        testId="mr-dialog-provider-cancellation"
        submitLabel="Record cancellation"
        availability={appointmentActions[MEDICAL_REVIEW_ACTIONS.manageAppointment]}
        rowVersion={appointmentRowVersion}
        reloadRecord={reloadDetail}
        fields={[
          { name: 'notes', label: 'Notes', type: 'textarea', required: true },
          reasonField,
        ]}
        execute={(v, ctx) =>
          medicalReviewCommandService.recordProviderCancellation(
            appointmentId!,
            String(v.notes),
            String(v.reason),
            { expectedRowVersion: ctx.expectedRowVersion ?? 0, idempotencyKey: ctx.idempotencyKey },
          )
        }
        onCompleted={refreshAfterAppointment}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'reasonable_cause'}
        onOpenChange={(o) => setDialog(o ? 'reasonable_cause' : null)}
        title="Record reasonable-cause outcome"
        testId="mr-dialog-reasonable-cause"
        submitLabel="Record outcome"
        availability={appointmentActions.reasonable_cause}
        rowVersion={appointmentRowVersion}
        reloadRecord={reloadDetail}
        fields={[
          { name: 'outcome', label: 'Outcome', type: 'select', required: true, options: REASONABLE_CAUSE_OUTCOMES },
          reasonField,
        ]}
        execute={(v, ctx) =>
          medicalReviewCommandService.recordReasonableCause(
            appointmentId!,
            String(v.outcome),
            String(v.reason),
            { expectedRowVersion: ctx.expectedRowVersion ?? 0, idempotencyKey: ctx.idempotencyKey },
          )
        }
        onCompleted={refreshAfterAppointment}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'validate_report'}
        onOpenChange={(o) => setDialog(o ? 'validate_report' : null)}
        title="Validate report"
        testId="mr-dialog-validate-report"
        submitLabel="Validate report"
        availability={assessmentActions[MEDICAL_REVIEW_ACTIONS.validateReport]}
        rowVersion={assessmentRowVersion}
        reloadRecord={reloadDetail}
        fields={[{ name: 'reason', label: 'Validation note', type: 'textarea' }]}
        execute={(v, ctx) =>
          medicalReviewCommandService.validateReport(assessmentId!, {
            expectedRowVersion: ctx.expectedRowVersion ?? 0,
            idempotencyKey: ctx.idempotencyKey,
            reason: (v.reason as string) ?? null,
          })
        }
        onCompleted={refreshAfterAssessment}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'reject_report'}
        onOpenChange={(o) => setDialog(o ? 'reject_report' : null)}
        title="Reject incomplete report"
        testId="mr-dialog-reject-report"
        submitLabel="Reject report"
        availability={assessmentActions[MEDICAL_REVIEW_ACTIONS.validateReport]}
        rowVersion={assessmentRowVersion}
        reloadRecord={reloadDetail}
        fields={[{ name: 'rejectionReason', label: 'Rejection reason', type: 'textarea', required: true }]}
        execute={(v, ctx) =>
          medicalReviewCommandService.rejectReport(assessmentId!, String(v.rejectionReason), {
            expectedRowVersion: ctx.expectedRowVersion ?? 0,
            idempotencyKey: ctx.idempotencyKey,
          })
        }
        onCompleted={refreshAfterAssessment}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'request_clarification'}
        onOpenChange={(o) => setDialog(o ? 'request_clarification' : null)}
        title="Request clarification or addendum"
        testId="mr-dialog-request-clarification"
        submitLabel="Request clarification"
        availability={assessmentActions[MEDICAL_REVIEW_ACTIONS.validateReport]}
        rowVersion={assessmentRowVersion}
        reloadRecord={reloadDetail}
        fields={[{ name: 'requestReason', label: 'What must the provider clarify?', type: 'textarea', required: true }]}
        execute={(v, ctx) =>
          medicalReviewCommandService.requestClarification(assessmentId!, String(v.requestReason), {
            expectedRowVersion: ctx.expectedRowVersion ?? 0,
            idempotencyKey: ctx.idempotencyKey,
          })
        }
        onCompleted={refreshAfterAssessment}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'lock_assessment'}
        onOpenChange={(o) => setDialog(o ? 'lock_assessment' : null)}
        title="Lock accepted assessment"
        testId="mr-dialog-lock-assessment"
        submitLabel="Lock assessment"
        availability={assessmentActions.lock_assessment}
        rowVersion={assessmentRowVersion}
        reloadRecord={reloadDetail}
        fields={[{ name: 'reason', label: 'Note', type: 'textarea' }]}
        execute={(v, ctx) =>
          medicalReviewCommandService.lockAssessment(assessmentId!, {
            expectedRowVersion: ctx.expectedRowVersion ?? 0,
            idempotencyKey: ctx.idempotencyKey,
            reason: (v.reason as string) ?? null,
          })
        }
        onCompleted={refreshAfterAssessment}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'refer_to_board'}
        onOpenChange={(o) => setDialog(o ? 'refer_to_board' : null)}
        title="Refer to Medical Board"
        description="The trigger snapshot, required quorum, required specialties and determination authority are shown on the Board tab."
        testId="mr-dialog-refer-to-board"
        submitLabel="Refer to Board"
        availability={referToBoardAvailability}
        rowVersion={null}
        fields={[reasonField]}
        execute={(v, ctx) =>
          medicalReviewCommandService.referToBoard(
            obligationId,
            assessmentId!,
            String(v.reason),
            ctx.idempotencyKey,
          )
        }
        onCompleted={refreshAfterBoard}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'select_board'}
        onOpenChange={(o) => setDialog(o ? 'select_board' : null)}
        title="Select Board"
        testId="mr-dialog-select-board"
        submitLabel="Select Board"
        availability={boardActions[MEDICAL_REVIEW_ACTIONS.manageBoardCase]}
        rowVersion={boardCaseRowVersion}
        reloadRecord={reloadDetail}
        fields={[
          { name: 'boardId', label: 'Board', type: 'text', required: true, help: 'Board identifier from the Board register.' },
          { name: 'reason', label: 'Reason', type: 'textarea' },
        ]}
        execute={(v, ctx) =>
          medicalReviewCommandService.selectBoard(boardCaseId!, String(v.boardId), {
            expectedRowVersion: ctx.expectedRowVersion ?? 0,
            idempotencyKey: ctx.idempotencyKey,
            reason: (v.reason as string) ?? null,
          })
        }
        onCompleted={refreshAfterBoard}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'prepare_decision'}
        onOpenChange={(o) => setDialog(o ? 'prepare_decision' : null)}
        title="Prepare administrative decision"
        description="The provider opinion and any Board determination are shown separately on the Decision tab. Record the administrative outcome here."
        testId="mr-dialog-prepare-decision"
        submitLabel="Prepare decision"
        availability={decisionActions[MEDICAL_REVIEW_ACTIONS.prepareDecision]}
        rowVersion={null}
        fields={[
          { name: 'outcomeCode', label: 'Administrative outcome', type: 'select', required: true, options: DECISION_OUTCOME_CODES },
          { name: 'effectiveDate', label: 'Effective date', type: 'date', required: true },
          { name: 'nextReviewDate', label: 'Next review date', type: 'date' },
          {
            name: 'medicalRecommendationAccepted',
            label: 'Medical recommendation accepted',
            type: 'checkbox',
            help: 'Leave unticked to depart from the medical recommendation (a departure reason is then required).',
          },
          {
            name: 'departureReason',
            label: 'Departure reason',
            type: 'textarea',
            help: bindingDetermination
              ? 'A binding Board determination cannot be departed from.'
              : 'Required only where the medical recommendation is not accepted.',
          },
          { name: 'reasonCode', label: 'Reason code', type: 'select', required: true, options: DECISION_REASON_CODES },
          { name: 'reasonNarrative', label: 'Narrative', type: 'textarea', required: true },
        ]}
        execute={(v, ctx) =>
          medicalReviewCommandService.prepareDecision({
            obligationId,
            assessmentId: assessmentId,
            boardCaseId: boardCaseId,
            outcomeCode: String(v.outcomeCode),
            medicalRecommendationAccepted: v.medicalRecommendationAccepted === true,
            departureReason: (v.departureReason as string) ?? null,
            effectiveDate: String(v.effectiveDate),
            nextReviewDate: (v.nextReviewDate as string) ?? null,
            reasonCode: String(v.reasonCode),
            reasonNarrative: String(v.reasonNarrative),
            idempotencyKey: ctx.idempotencyKey,
          })
        }
        onCompleted={refreshAfterDecision}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'submit_decision'}
        onOpenChange={(o) => setDialog(o ? 'submit_decision' : null)}
        title="Submit decision for approval"
        testId="mr-dialog-submit-decision"
        submitLabel="Submit for approval"
        availability={decisionActions[MEDICAL_REVIEW_ACTIONS.prepareDecision]}
        rowVersion={decisionRowVersion}
        reloadRecord={reloadDetail}
        fields={[{ name: 'reason', label: 'Note', type: 'textarea' }]}
        execute={(v, ctx) =>
          medicalReviewCommandService.submitDecision(decisionId!, {
            expectedRowVersion: ctx.expectedRowVersion ?? 0,
            idempotencyKey: ctx.idempotencyKey,
            reason: (v.reason as string) ?? null,
          })
        }
        onCompleted={refreshAfterDecision}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'return_decision'}
        onOpenChange={(o) => setDialog(o ? 'return_decision' : null)}
        title="Return decision to the preparer"
        testId="mr-dialog-return-decision"
        submitLabel="Return decision"
        availability={decisionActions[MEDICAL_REVIEW_ACTIONS.approveDecision]}
        rowVersion={decisionRowVersion}
        reloadRecord={reloadDetail}
        fields={[{ name: 'returnedReason', label: 'Return reason', type: 'textarea', required: true }]}
        execute={(v, ctx) =>
          medicalReviewCommandService.returnDecision(decisionId!, String(v.returnedReason), {
            expectedRowVersion: ctx.expectedRowVersion ?? 0,
            idempotencyKey: ctx.idempotencyKey,
          })
        }
        onCompleted={refreshAfterDecision}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'approve_decision'}
        onOpenChange={(o) => setDialog(o ? 'approve_decision' : null)}
        title="Approve administrative decision"
        boundaryNotice="Maker-checker: the preparer of a decision cannot approve it. The command boundary re-enforces this."
        testId="mr-dialog-approve-decision"
        submitLabel="Approve decision"
        availability={decisionActions[MEDICAL_REVIEW_ACTIONS.approveDecision]}
        rowVersion={decisionRowVersion}
        reloadRecord={reloadDetail}
        fields={[{ name: 'reason', label: 'Approval note', type: 'textarea' }]}
        execute={(v, ctx) =>
          medicalReviewCommandService.approveDecision(decisionId!, {
            expectedRowVersion: ctx.expectedRowVersion ?? 0,
            idempotencyKey: ctx.idempotencyKey,
            reason: (v.reason as string) ?? null,
          })
        }
        onCompleted={refreshAfterDecision}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'complete_decision'}
        onOpenChange={(o) => setDialog(o ? 'complete_decision' : null)}
        title="Complete decision"
        testId="mr-dialog-complete-decision"
        submitLabel="Complete decision"
        availability={decisionActions.complete_decision}
        rowVersion={decisionRowVersion}
        reloadRecord={reloadDetail}
        fields={[{ name: 'reason', label: 'Note', type: 'textarea' }]}
        execute={(v, ctx) =>
          medicalReviewCommandService.completeDecision(decisionId!, {
            expectedRowVersion: ctx.expectedRowVersion ?? 0,
            idempotencyKey: ctx.idempotencyKey,
            reason: (v.reason as string) ?? null,
          })
        }
        onCompleted={refreshAfterDecision}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'propose_suspension'}
        onOpenChange={(o) => setDialog(o ? 'propose_suspension' : null)}
        title="Create Suspension Proposal"
        boundaryNotice={AWARD_PROPOSAL_BOUNDARY_TEXT}
        testId="mr-dialog-propose-suspension"
        submitLabel="Create Suspension Proposal"
        availability={proposalActions[MEDICAL_REVIEW_ACTIONS.proposeSuspension]}
        rowVersion={null}
        fields={[reasonField]}
        execute={(v, ctx) =>
          medicalReviewCommandService.proposeSuspension(
            decisionId!,
            String(v.reason),
            ctx.idempotencyKey,
          )
        }
        onCompleted={() => proposalSection.reload()}
      />

      <MedicalReviewCommandDialog
        open={dialog === 'propose_reinstatement'}
        onOpenChange={(o) => setDialog(o ? 'propose_reinstatement' : null)}
        title="Create Reinstatement Proposal"
        boundaryNotice={AWARD_PROPOSAL_BOUNDARY_TEXT}
        testId="mr-dialog-propose-reinstatement"
        submitLabel="Create Reinstatement Proposal"
        availability={proposalActions[MEDICAL_REVIEW_ACTIONS.proposeReinstatement]}
        rowVersion={null}
        fields={[reasonField]}
        execute={(v, ctx) =>
          medicalReviewCommandService.proposeReinstatement(
            decisionId!,
            String(v.reason),
            ctx.idempotencyKey,
          )
        }
        onCompleted={() => proposalSection.reload()}
      />
    </Card>
  );
};

export default MedicalReviewDetailPanel;
