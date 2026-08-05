/**
 * Medical Board Workspace — canonical route `/bn/medical-reviews/board`.
 *
 * Distinct actor surface for Medical Board members and Board secretaries.
 * Board membership scoping happens inside the secured RPCs.
 *
 * Authority separation is structural: this workspace has no control that can
 * approve an administrative decision, create or execute an award suspension,
 * change award state, or change payment state. A recused member is offered no
 * evidence access, no participation and no vote.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, ArrowLeft, Gavel, RefreshCw } from 'lucide-react';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useActionPermissions } from '@/hooks/useActionPermission';
import { useMedicalReviewActionsState } from '@/hooks/bn/useMedicalReviewActionsState';
import {
  medicalReviewQueryService,
  type BoardCaseRow,
} from '@/services/bn/medicalReviewQueryService';
import { medicalReviewCommandService } from '@/services/bn/medicalReviewCommandService';
import {
  MEDICAL_REVIEW_ACTIONS,
  type MedicalReviewAction,
} from '@/features/bn/medical-reviews/model/permissions';
import {
  boardCaseActionAvailability,
  boardSessionActionAvailability,
} from '@/features/bn/medical-reviews/model/actionAvailability';
import {
  BOARD_ATTENDANCE_STATUSES,
  BOARD_OUTCOME_CODES,
  BOARD_VOTES,
  EVIDENCE_TYPES,
  MEETING_MODES,
} from '@/features/bn/medical-reviews/model/controlledValues';
import {
  MedicalReviewActionButton,
  MedicalReviewDarkLaunchBanner,
  MedicalReviewStatusBadge,
} from '@/components/bn/medical-reviews/MedicalReviewActionControls';
import MedicalReviewCommandDialog from '@/components/bn/medical-reviews/MedicalReviewCommandDialog';
import SectionStateView from '@/components/bn/medical-reviews/SectionState';
import { useSectionQuery } from '@/hooks/bn/useMedicalReviewSection';

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

type DialogId =
  | null
  | 'assign_members'
  | 'schedule_session'
  | 'declare_conflict'
  | 'record_recusal'
  | 'record_attendance'
  | 'request_evidence'
  | 'record_vote'
  | 'finalise_determination'
  | 'defer_case'
  | 'reconvene_case';

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <div className="text-xs uppercase text-muted-foreground">{label}</div>
    <div className="text-sm">{value ?? '—'}</div>
  </div>
);

const MedicalBoardWorkspace: React.FC = () => {
  const { isAuthReady, isAuthenticated } = useSupabaseAuth();
  const { can, isAdmin, isLoading: permsLoading } = useActionPermissions('bn_medical_review');
  const actionsState = useMedicalReviewActionsState();

  const allow = useCallback((a: string) => isAdmin || can(a), [isAdmin, can]);
  const hasPermission = useCallback((a: MedicalReviewAction) => allow(a), [allow]);
  const canView = allow(MEDICAL_REVIEW_ACTIONS.view);

  const [selected, setSelected] = useState<BoardCaseRow | null>(null);
  const [dialog, setDialog] = useState<DialogId>(null);

  const enabled = isAuthReady && isAuthenticated && canView;

  const worklistSection = useSectionQuery<BoardCaseRow[]>(
    enabled ? 'board-worklist' : null,
    async () => (await medicalReviewQueryService.boardWorklist()).rows,
    (rows) => rows.length === 0,
    { enabled, notApplicableMessage: 'Sign in with Board access to view cases.' },
  );

  const caseSection = useSectionQuery<Row>(
    selected?.boardCaseId ?? null,
    selected ? () => medicalReviewQueryService.boardCaseDetail(selected.boardCaseId) : null,
    () => false,
  );

  const determinationSection = useSectionQuery<Row[]>(
    selected?.boardCaseId ?? null,
    selected
      ? async () =>
          (await medicalReviewQueryService.boardDetermination(selected.boardCaseId)) as Row[]
      : null,
    (rows) => rows.length === 0,
  );

  const detail = caseSection.data ?? null;
  const sessionId = s(detail?.session_id) ?? s(detail?.current_session_id);
  const sessionStatus = s(detail?.session_status);
  const currentMemberId = s(detail?.current_member_id);
  const currentMemberRecused =
    detail?.current_member_recused === true || detail?.recused === true;

  const participants: Row[] = Array.isArray(detail?.participants)
    ? (detail!.participants as Row[])
    : [];
  const conflicts: Row[] = Array.isArray(detail?.conflicts) ? (detail!.conflicts as Row[]) : [];
  const votes: Row[] = Array.isArray(detail?.votes) ? (detail!.votes as Row[]) : [];
  const sessions: Row[] = Array.isArray(detail?.sessions) ? (detail!.sessions as Row[]) : [];
  const memberOptions = (Array.isArray(detail?.members) ? (detail!.members as Row[]) : []).map(
    (m) => ({
      value: String(m.member_id ?? ''),
      label: String(m.member_name ?? m.member_id ?? 'Member'),
    }),
  );

  const reloadCase = useCallback(async (): Promise<number | null> => {
    if (!selected) return null;
    const fresh = await medicalReviewQueryService.boardCaseDetail(selected.boardCaseId);
    caseSection.reload();
    return typeof fresh.row_version === 'number' ? fresh.row_version : null;
  }, [selected, caseSection]);

  const caseActions = useMemo(
    () =>
      boardCaseActionAvailability({
        hasPermission,
        actionsEnabled: actionsState.actionsEnabled,
        state: selected?.status ?? null,
        rowVersion: selected?.rowVersion ?? null,
        extraBlockedReason: currentMemberRecused
          ? 'You have been recused from this case.'
          : null,
      }),
    [hasPermission, actionsState.actionsEnabled, selected, currentMemberRecused],
  );

  const sessionActions = useMemo(
    () =>
      boardSessionActionAvailability({
        hasPermission,
        actionsEnabled: actionsState.actionsEnabled,
        state: sessionStatus,
        rowVersion: null,
        extraBlockedReason: currentMemberRecused
          ? 'You have been recused from this case.'
          : !sessionId
            ? 'Schedule a session first.'
            : null,
      }),
    [hasPermission, actionsState.actionsEnabled, sessionStatus, sessionId, currentMemberRecused],
  );

  const voteAvailability = useMemo(() => {
    const base = sessionActions[MEDICAL_REVIEW_ACTIONS.recordBoardParticipation];
    if (currentMemberRecused) {
      return { ...base, enabled: false, blockedReason: 'A recused member cannot vote.' };
    }
    return base;
  }, [sessionActions, currentMemberRecused]);

  const quorumMet = detail?.quorum_met === true;
  const finaliseAvailability = useMemo(() => {
    const base = caseActions[MEDICAL_REVIEW_ACTIONS.recordBoardDetermination];
    if (base.enabled && detail && detail.quorum_met === false) {
      return {
        ...base,
        enabled: false,
        blockedReason: 'The Medical Board quorum has not been met for this session.',
      };
    }
    return base;
  }, [caseActions, detail]);

  if (!isAuthReady || permsLoading) {
    return <div className="p-6"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!canView) {
    return (
      <div className="p-6">
        <Alert variant="destructive" data-testid="mr-board-permission-denied">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Permission denied</AlertTitle>
          <AlertDescription>
            Your account does not hold <code>bn.medical_review.view</code>.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6" data-testid="mr-board-workspace">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Gavel className="h-6 w-6" /> Medical Board Workspace
          </h1>
          <p className="text-sm text-muted-foreground">
            Board cases assigned to the boards you sit on or service. Determinations recorded here
            are medical findings only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={worklistSection.reload}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Link to="/bn/medical-reviews">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" /> Medical Review Centre
            </Button>
          </Link>
        </div>
      </header>

      <MedicalReviewDarkLaunchBanner
        actionsEnabled={actionsState.actionsEnabled}
        isLoading={actionsState.isLoading}
      />

      <Alert>
        <AlertTitle>Authority separation</AlertTitle>
        <AlertDescription>
          The Medical Board issues the medical determination. Accepting or departing from it, and
          any consequential award action, is an administrative decision taken separately in the
          Medical Review Centre and executed only through the Award Suspension boundary.
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent className="p-4">
          <SectionStateView
            name="board-worklist"
            section={worklistSection}
            emptyMessage="No Board cases are assigned to you."
          >
            {(rows) => (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Case</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Quorum</TableHead>
                    <TableHead>Binding</TableHead>
                    <TableHead>Complete by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.boardCaseId}
                      className="cursor-pointer"
                      data-state={selected?.boardCaseId === r.boardCaseId ? 'selected' : undefined}
                      onClick={() => setSelected(r)}
                    >
                      <TableCell className="font-medium">{r.caseReference ?? '—'}</TableCell>
                      <TableCell><MedicalReviewStatusBadge status={r.status} /></TableCell>
                      <TableCell>{r.requiredQuorum ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {r.determinationBinding ? 'Binding' : 'Advisory'}
                        </Badge>
                      </TableCell>
                      <TableCell>{r.requiredCompletionDate ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionStateView>
        </CardContent>
      </Card>

      {selected && (
        <Card data-testid="mr-board-case-detail">
          <CardHeader>
            <CardTitle className="text-base">
              {selected.caseReference ?? 'Board case'} — session and determination
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {currentMemberRecused && (
              <Alert variant="destructive" data-testid="mr-board-recused">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>You are recused from this case</AlertTitle>
                <AlertDescription>
                  Evidence access, participation and voting are withheld while a recusal is in
                  force.
                </AlertDescription>
              </Alert>
            )}

            <SectionStateView
              name="board-case"
              section={caseSection}
              emptyMessage="No case detail available."
            >
              {(d) => (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Trigger snapshot" value={String(d.trigger_snapshot ?? d.trigger_reason ?? '—')} />
                  <Field
                    label="Required specialties"
                    value={
                      Array.isArray(d.required_specialties)
                        ? (d.required_specialties as unknown[]).join(', ')
                        : '—'
                    }
                  />
                  <Field label="Required quorum" value={selected.requiredQuorum ?? '—'} />
                  <Field label="Voting rule" value={String(d.voting_rule ?? '—')} />
                  <Field
                    label="Authority"
                    value={selected.determinationBinding ? 'Binding on the decision maker' : 'Advisory'}
                  />
                  <Field label="Quorum met" value={quorumMet ? 'Yes' : 'Not yet'} />
                </div>
              )}
            </SectionStateView>

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-medium">Member assignments &amp; attendance</h3>
                {participants.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No members recorded.</p>
                ) : (
                  <div className="space-y-1">
                    {participants.map((p, i) => (
                      <div key={i} className="flex items-center justify-between rounded-md border p-2 text-sm">
                        <span>{String(p.member_name ?? p.member_id ?? 'Member')}</span>
                        <span className="flex gap-1">
                          {p.recused === true && <Badge variant="destructive">Recused</Badge>}
                          <Badge variant="outline">
                            {String(p.attendance_status ?? p.participation_status ?? '—')}
                          </Badge>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">Conflicts &amp; recusals</h3>
                {conflicts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No conflicts declared.</p>
                ) : (
                  <div className="space-y-1">
                    {conflicts.map((c, i) => (
                      <div key={i} className="rounded-md border p-2 text-sm">
                        {String(c.member_name ?? c.member_id ?? 'Member')} —{' '}
                        {String(c.conflict_details ?? c.status ?? '—')}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">Session history</h3>
                {sessions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No sessions scheduled.</p>
                ) : (
                  <div className="space-y-1">
                    {sessions.map((x, i) => (
                      <div key={i} className="rounded-md border p-2 text-sm">
                        {String(x.scheduled_at ?? '—')} · {String(x.session_status ?? '—')} ·{' '}
                        {String(x.meeting_mode ?? '—')}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">Votes</h3>
                {votes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No votes recorded.</p>
                ) : (
                  <div className="space-y-1">
                    {votes.map((v, i) => (
                      <div key={i} className="rounded-md border p-2 text-sm">
                        {String(v.member_name ?? v.member_id ?? 'Member')} — {String(v.vote ?? '—')}{' '}
                        ({String(v.vote_outcome_code ?? '—')})
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium">Determination history</h3>
              <SectionStateView
                name="board-determination"
                section={determinationSection}
                emptyMessage="No determination has been finalised."
              >
                {(rows) => (
                  <div className="space-y-1">
                    {rows.map((d, i) => (
                      <div key={i} className="rounded-md border p-2 text-sm">
                        {String(d.outcome_code ?? '—')} — {String(d.determination_summary ?? '—')}
                      </div>
                    ))}
                  </div>
                )}
              </SectionStateView>
            </div>

            <div className="flex flex-wrap gap-2">
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.manageBoardCase}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.manageBoardCase)}
                actionsEnabled={actionsState.actionsEnabled}
                blockedReason={caseActions[MEDICAL_REVIEW_ACTIONS.manageBoardCase].blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('assign_members')}
              >
                Assign members
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.manageBoardSession}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.manageBoardSession)}
                actionsEnabled={actionsState.actionsEnabled}
                blockedReason={caseActions[MEDICAL_REVIEW_ACTIONS.manageBoardSession].blockedReason}
                size="sm"
                onClick={() => setDialog('schedule_session')}
              >
                Schedule session
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.declareConflict}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.declareConflict)}
                actionsEnabled={actionsState.actionsEnabled}
                blockedReason={sessionActions[MEDICAL_REVIEW_ACTIONS.declareConflict].blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('declare_conflict')}
              >
                Declare conflict
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.declareConflict}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.declareConflict)}
                actionsEnabled={actionsState.actionsEnabled}
                blockedReason={sessionActions[MEDICAL_REVIEW_ACTIONS.declareConflict].blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('record_recusal')}
              >
                Record recusal
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.recordBoardParticipation}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.recordBoardParticipation)}
                actionsEnabled={actionsState.actionsEnabled}
                blockedReason={
                  sessionActions[MEDICAL_REVIEW_ACTIONS.recordBoardParticipation].blockedReason
                }
                size="sm"
                variant="outline"
                onClick={() => setDialog('record_attendance')}
              >
                Record attendance / participation
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.manageBoardCase}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.manageBoardCase)}
                actionsEnabled={actionsState.actionsEnabled}
                blockedReason={caseActions[MEDICAL_REVIEW_ACTIONS.manageBoardCase].blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('request_evidence')}
              >
                Request additional evidence
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.recordBoardParticipation}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.recordBoardParticipation)}
                actionsEnabled={actionsState.actionsEnabled}
                blockedReason={voteAvailability.blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('record_vote')}
              >
                Record vote
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.recordBoardDetermination}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.recordBoardDetermination)}
                actionsEnabled={actionsState.actionsEnabled}
                blockedReason={finaliseAvailability.blockedReason}
                size="sm"
                onClick={() => setDialog('finalise_determination')}
              >
                Finalise determination
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.manageBoardCase}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.manageBoardCase)}
                actionsEnabled={actionsState.actionsEnabled}
                blockedReason={caseActions[MEDICAL_REVIEW_ACTIONS.manageBoardCase].blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('defer_case')}
              >
                Defer case
              </MedicalReviewActionButton>
              <MedicalReviewActionButton
                action={MEDICAL_REVIEW_ACTIONS.manageBoardCase}
                hasPermission={hasPermission(MEDICAL_REVIEW_ACTIONS.manageBoardCase)}
                actionsEnabled={actionsState.actionsEnabled}
                blockedReason={caseActions[MEDICAL_REVIEW_ACTIONS.manageBoardCase].blockedReason}
                size="sm"
                variant="outline"
                onClick={() => setDialog('reconvene_case')}
              >
                Reconvene case
              </MedicalReviewActionButton>
              {/* Deliberately absent: approve administrative decision, suspend or
                  reinstate an award, change award state, change payment state. */}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================= Board command dialogs ================= */}
      {selected && (
        <>
          <MedicalReviewCommandDialog
            open={dialog === 'assign_members'}
            onOpenChange={(o) => setDialog(o ? 'assign_members' : null)}
            title="Assign Board members"
            testId="mr-board-dialog-assign-members"
            submitLabel="Assign members"
            availability={caseActions[MEDICAL_REVIEW_ACTIONS.manageBoardCase]}
            rowVersion={selected.rowVersion}
            reloadRecord={reloadCase}
            fields={[
              { name: 'memberIds', label: 'Members', type: 'multiselect', required: true, options: memberOptions },
              { name: 'reason', label: 'Note', type: 'textarea' },
            ]}
            execute={(v, ctx) =>
              medicalReviewCommandService.assignBoardMembers(
                selected.boardCaseId,
                (v.memberIds as string[]) ?? [],
                {
                  expectedRowVersion: ctx.expectedRowVersion ?? 0,
                  idempotencyKey: ctx.idempotencyKey,
                  reason: (v.reason as string) ?? null,
                },
              )
            }
            onCompleted={() => caseSection.reload()}
          />

          <MedicalReviewCommandDialog
            open={dialog === 'schedule_session'}
            onOpenChange={(o) => setDialog(o ? 'schedule_session' : null)}
            title="Schedule Board session"
            testId="mr-board-dialog-schedule-session"
            submitLabel="Schedule session"
            availability={caseActions[MEDICAL_REVIEW_ACTIONS.manageBoardSession]}
            rowVersion={selected.rowVersion}
            reloadRecord={reloadCase}
            fields={[
              { name: 'scheduledAt', label: 'Date and time', type: 'datetime', required: true },
              { name: 'meetingMode', label: 'Meeting mode', type: 'select', required: true, options: MEETING_MODES },
              { name: 'locationReference', label: 'Location', type: 'text' },
              { name: 'reason', label: 'Note', type: 'textarea' },
            ]}
            execute={(v, ctx) =>
              medicalReviewCommandService.scheduleBoardSession({
                boardCaseId: selected.boardCaseId,
                scheduledAt: String(v.scheduledAt),
                meetingMode: String(v.meetingMode),
                locationReference: (v.locationReference as string) ?? null,
                expectedRowVersion: ctx.expectedRowVersion ?? 0,
                idempotencyKey: ctx.idempotencyKey,
                reason: (v.reason as string) ?? null,
              })
            }
            onCompleted={() => caseSection.reload()}
          />

          <MedicalReviewCommandDialog
            open={dialog === 'declare_conflict'}
            onOpenChange={(o) => setDialog(o ? 'declare_conflict' : null)}
            title="Declare conflict of interest"
            testId="mr-board-dialog-declare-conflict"
            submitLabel="Declare conflict"
            availability={sessionActions[MEDICAL_REVIEW_ACTIONS.declareConflict]}
            rowVersion={null}
            fields={[
              { name: 'memberId', label: 'Member', type: 'select', required: true, options: memberOptions },
              { name: 'conflictDetails', label: 'Conflict details', type: 'textarea', required: true },
            ]}
            execute={(v, ctx) =>
              medicalReviewCommandService.declareBoardConflict(
                sessionId!,
                String(v.memberId ?? currentMemberId),
                String(v.conflictDetails),
                { idempotencyKey: ctx.idempotencyKey },
              )
            }
            onCompleted={() => caseSection.reload()}
          />

          <MedicalReviewCommandDialog
            open={dialog === 'record_recusal'}
            onOpenChange={(o) => setDialog(o ? 'record_recusal' : null)}
            title="Record recusal"
            boundaryNotice="A recused member is offered no evidence access, no participation and no vote."
            testId="mr-board-dialog-record-recusal"
            submitLabel="Record recusal"
            availability={sessionActions[MEDICAL_REVIEW_ACTIONS.declareConflict]}
            rowVersion={null}
            fields={[
              { name: 'memberId', label: 'Member', type: 'select', required: true, options: memberOptions },
              { name: 'reason', label: 'Recusal reason', type: 'textarea', required: true },
            ]}
            execute={(v, ctx) =>
              medicalReviewCommandService.recordRecusal(
                sessionId!,
                String(v.memberId),
                String(v.reason),
                ctx.idempotencyKey,
              )
            }
            onCompleted={() => caseSection.reload()}
          />

          <MedicalReviewCommandDialog
            open={dialog === 'record_attendance'}
            onOpenChange={(o) => setDialog(o ? 'record_attendance' : null)}
            title="Record session attendance and participation"
            testId="mr-board-dialog-record-attendance"
            submitLabel="Record participation"
            availability={sessionActions[MEDICAL_REVIEW_ACTIONS.recordBoardParticipation]}
            rowVersion={null}
            fields={[
              { name: 'memberId', label: 'Member', type: 'select', required: true, options: memberOptions },
              { name: 'attendanceStatus', label: 'Attendance', type: 'select', required: true, options: BOARD_ATTENDANCE_STATUSES },
              { name: 'reason', label: 'Note', type: 'textarea' },
            ]}
            execute={(v, ctx) =>
              medicalReviewCommandService.recordBoardParticipation(
                sessionId!,
                String(v.memberId),
                String(v.attendanceStatus),
                { idempotencyKey: ctx.idempotencyKey, reason: (v.reason as string) ?? null },
              )
            }
            onCompleted={() => caseSection.reload()}
          />

          <MedicalReviewCommandDialog
            open={dialog === 'request_evidence'}
            onOpenChange={(o) => setDialog(o ? 'request_evidence' : null)}
            title="Request additional evidence"
            testId="mr-board-dialog-request-evidence"
            submitLabel="Request evidence"
            availability={caseActions[MEDICAL_REVIEW_ACTIONS.manageBoardCase]}
            rowVersion={selected.rowVersion}
            reloadRecord={reloadCase}
            fields={[
              { name: 'evidenceTypes', label: 'Evidence required', type: 'multiselect', required: true, options: EVIDENCE_TYPES },
              { name: 'reason', label: 'Reason', type: 'textarea', required: true },
            ]}
            execute={(v, ctx) =>
              medicalReviewCommandService.requestBoardEvidence(
                selected.boardCaseId,
                (v.evidenceTypes as string[]) ?? [],
                String(v.reason),
                { expectedRowVersion: ctx.expectedRowVersion ?? 0, idempotencyKey: ctx.idempotencyKey },
              )
            }
            onCompleted={() => caseSection.reload()}
          />

          <MedicalReviewCommandDialog
            open={dialog === 'record_vote'}
            onOpenChange={(o) => setDialog(o ? 'record_vote' : null)}
            title="Record member determination / vote"
            testId="mr-board-dialog-record-vote"
            submitLabel="Record vote"
            availability={voteAvailability}
            rowVersion={null}
            fields={[
              { name: 'memberId', label: 'Member', type: 'select', required: true, options: memberOptions },
              { name: 'vote', label: 'Vote', type: 'select', required: true, options: BOARD_VOTES },
              { name: 'voteOutcomeCode', label: 'Medical outcome voted for', type: 'select', required: true, options: BOARD_OUTCOME_CODES },
              { name: 'voteReason', label: 'Reason', type: 'textarea', required: true },
            ]}
            execute={(v, ctx) =>
              medicalReviewCommandService.recordBoardVote({
                sessionId: sessionId!,
                memberId: String(v.memberId),
                vote: String(v.vote),
                voteOutcomeCode: String(v.voteOutcomeCode),
                voteReason: String(v.voteReason),
                idempotencyKey: ctx.idempotencyKey,
              })
            }
            onCompleted={() => caseSection.reload()}
          />

          <MedicalReviewCommandDialog
            open={dialog === 'finalise_determination'}
            onOpenChange={(o) => setDialog(o ? 'finalise_determination' : null)}
            title="Finalise Board determination"
            boundaryNotice="This records a medical determination only. It does not approve an administrative decision and cannot change an award or a payment."
            testId="mr-board-dialog-finalise-determination"
            submitLabel="Finalise determination"
            availability={finaliseAvailability}
            rowVersion={selected.rowVersion}
            reloadRecord={reloadCase}
            fields={[
              { name: 'outcomeCode', label: 'Determination outcome', type: 'select', required: true, options: BOARD_OUTCOME_CODES },
              { name: 'determinationSummary', label: 'Determination summary', type: 'textarea', required: true },
              { name: 'impairmentPercentage', label: 'Impairment percentage', type: 'number' },
              { name: 'reason', label: 'Note', type: 'textarea' },
            ]}
            execute={(v, ctx) =>
              medicalReviewCommandService.finaliseBoardDetermination({
                boardCaseId: selected.boardCaseId,
                sessionId: sessionId!,
                outcomeCode: String(v.outcomeCode),
                determinationSummary: String(v.determinationSummary),
                impairmentPercentage:
                  typeof v.impairmentPercentage === 'number' ? v.impairmentPercentage : null,
                expectedRowVersion: ctx.expectedRowVersion ?? 0,
                idempotencyKey: ctx.idempotencyKey,
                reason: (v.reason as string) ?? null,
              })
            }
            onCompleted={() => {
              caseSection.reload();
              determinationSection.reload();
            }}
          />

          <MedicalReviewCommandDialog
            open={dialog === 'defer_case'}
            onOpenChange={(o) => setDialog(o ? 'defer_case' : null)}
            title="Defer Board case"
            testId="mr-board-dialog-defer-case"
            submitLabel="Defer case"
            availability={caseActions[MEDICAL_REVIEW_ACTIONS.manageBoardCase]}
            rowVersion={selected.rowVersion}
            reloadRecord={reloadCase}
            fields={[
              { name: 'deferredUntil', label: 'Deferred until', type: 'date', required: true },
              { name: 'reason', label: 'Reason', type: 'textarea', required: true },
            ]}
            execute={(v, ctx) =>
              medicalReviewCommandService.deferBoardCase(
                selected.boardCaseId,
                String(v.deferredUntil),
                String(v.reason),
                { expectedRowVersion: ctx.expectedRowVersion ?? 0, idempotencyKey: ctx.idempotencyKey },
              )
            }
            onCompleted={() => caseSection.reload()}
          />

          <MedicalReviewCommandDialog
            open={dialog === 'reconvene_case'}
            onOpenChange={(o) => setDialog(o ? 'reconvene_case' : null)}
            title="Reconvene Board case"
            testId="mr-board-dialog-reconvene-case"
            submitLabel="Reconvene case"
            availability={caseActions[MEDICAL_REVIEW_ACTIONS.manageBoardCase]}
            rowVersion={selected.rowVersion}
            reloadRecord={reloadCase}
            fields={[
              { name: 'scheduledAt', label: 'New session date and time', type: 'datetime', required: true },
              { name: 'locationReference', label: 'Location', type: 'text' },
              { name: 'reason', label: 'Reason', type: 'textarea' },
            ]}
            execute={(v, ctx) =>
              medicalReviewCommandService.reconveneBoardCase({
                boardCaseId: selected.boardCaseId,
                scheduledAt: String(v.scheduledAt),
                locationReference: (v.locationReference as string) ?? null,
                expectedRowVersion: ctx.expectedRowVersion ?? 0,
                idempotencyKey: ctx.idempotencyKey,
                reason: (v.reason as string) ?? null,
              })
            }
            onCompleted={() => caseSection.reload()}
          />
        </>
      )}
    </div>
  );
};

export default MedicalBoardWorkspace;
