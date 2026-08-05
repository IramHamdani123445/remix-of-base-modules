/**
 * Restricted Medical Provider Portal — Medical Review referrals.
 *
 * Mounted inside the existing external Doctor portal shell at `/doctor/reviews`.
 *
 * There is NO hard-coded provider permission here. Every control is decided by
 * `useMedicalReviewProviderCapabilities`, which reasons only from facts the
 * server returned: the linked provider identity, the referral assignment, the
 * referral status, appointment responsibility, the assessment status, the
 * authoritative module action flag and any explicit `capabilities` block.
 * A provider id supplied by the browser is never trusted.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Lock, RefreshCw, ShieldCheck } from 'lucide-react';
import { useMedicalReviewActionsState } from '@/hooks/bn/useMedicalReviewActionsState';
import { useMedicalReviewProviderCapabilities } from '@/hooks/bn/useMedicalReviewProviderCapabilities';
import {
  medicalReviewQueryService,
  type ProviderReferralRow,
} from '@/services/bn/medicalReviewQueryService';
import { medicalReviewCommandService } from '@/services/bn/medicalReviewCommandService';
import { MedicalReviewDarkLaunchBanner, MedicalReviewStatusBadge } from '@/components/bn/medical-reviews/MedicalReviewActionControls';
import MedicalReviewCommandDialog from '@/components/bn/medical-reviews/MedicalReviewCommandDialog';
import SectionStateView from '@/components/bn/medical-reviews/SectionState';
import { useSectionQuery } from '@/hooks/bn/useMedicalReviewSection';
import type { ActionAvailability } from '@/features/bn/medical-reviews/model/actionAvailability';
import { MEDICAL_REVIEW_ACTIONS } from '@/features/bn/medical-reviews/model/permissions';
import {
  ATTENDANCE_OUTCOMES,
  EXPECTED_DURATIONS,
  IDENTITY_VERIFICATION_METHODS,
  INCAPACITY_NATURES,
  MEDICAL_OUTCOMES,
  PROGNOSIS_CATEGORIES,
  WORK_CAPACITY_OPINIONS,
  YES_NO,
} from '@/features/bn/medical-reviews/model/controlledValues';

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

type DialogId =
  | null
  | 'accept'
  | 'decline'
  | 'schedule'
  | 'cancel'
  | 'start'
  | 'draft'
  | 'submit'
  | 'addendum';

/** Wraps a capability decision in the shared availability shape. */
const asAvailability = (
  action: (typeof MEDICAL_REVIEW_ACTIONS)[keyof typeof MEDICAL_REVIEW_ACTIONS],
  capability: { enabled: boolean; reason: string | null },
  rowVersion: number | null,
): ActionAvailability => ({
  action,
  visible: true,
  enabled: capability.enabled,
  permissionRequired: `bn.medical_review.${action}`,
  requiredSourceState: null,
  requiredRowVersion: rowVersion,
  reasonRequired: false,
  blockedReason: capability.enabled ? null : capability.reason,
  actorSurface: 'PROVIDER',
});

const CapabilityButton: React.FC<{
  testId: string;
  capability: { enabled: boolean; reason: string | null };
  onClick: () => void;
  variant?: 'default' | 'outline';
  children: React.ReactNode;
}> = ({ testId, capability, onClick, variant = 'outline', children }) => {
  const button = (
    <Button
      size="sm"
      variant={variant}
      disabled={!capability.enabled}
      onClick={onClick}
      data-testid={testId}
    >
      {!capability.enabled && <Lock className="mr-2 h-3.5 w-3.5" />}
      {children}
    </Button>
  );
  if (capability.enabled) return button;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{button}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{capability.reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/** Structured clinical fields. Deliberately excludes benefit-entitlement outcomes. */
const ASSESSMENT_FIELDS = [
  { name: 'examinationDate', label: 'Examination date', type: 'date' as const, required: true },
  { name: 'identityVerification', label: 'Identity verification', type: 'select' as const, required: true, options: IDENTITY_VERIFICATION_METHODS },
  { name: 'attendance', label: 'Attendance', type: 'select' as const, required: true, options: ATTENDANCE_OUTCOMES },
  { name: 'functionalLimitations', label: 'Functional limitations', type: 'textarea' as const, required: true },
  { name: 'workCapacityOpinion', label: 'Work-capacity opinion', type: 'select' as const, required: true, options: WORK_CAPACITY_OPINIONS },
  { name: 'expectedDuration', label: 'Expected duration', type: 'select' as const, required: true, options: EXPECTED_DURATIONS },
  { name: 'incapacityNature', label: 'Nature of incapacity', type: 'select' as const, options: INCAPACITY_NATURES },
  { name: 'prognosisCategory', label: 'Prognosis', type: 'select' as const, required: true, options: PROGNOSIS_CATEGORIES },
  { name: 'impairmentPercentage', label: 'Impairment percentage (where applicable)', type: 'number' as const },
  { name: 'furtherEvidenceRequired', label: 'Further evidence required', type: 'select' as const, options: YES_NO },
  { name: 'specialistRequired', label: 'Specialist required', type: 'select' as const, options: YES_NO },
  { name: 'recommendedNextReviewDate', label: 'Recommended next review date', type: 'date' as const },
  { name: 'medicalOutcome', label: 'Medical outcome', type: 'select' as const, required: true, options: MEDICAL_OUTCOMES },
  { name: 'clinicalNarrative', label: 'Clinical narrative', type: 'textarea' as const, required: true },
  { name: 'conflictDeclaration', label: 'I have no undeclared conflict of interest', type: 'checkbox' as const, required: true },
  { name: 'providerDeclaration', label: 'I certify this report is accurate and complete', type: 'checkbox' as const, required: true },
];

const MedicalProviderReferralWorkspace: React.FC = () => {
  const actionsState = useMedicalReviewActionsState();
  const [selected, setSelected] = useState<ProviderReferralRow | null>(null);
  const [dialog, setDialog] = useState<DialogId>(null);
  const [providerId, setProviderId] = useState<string | null>(null);

  const worklistSection = useSectionQuery<ProviderReferralRow[]>(
    'provider-worklist',
    async () => {
      const result = await medicalReviewQueryService.providerWorklist();
      setProviderId(result.providerId);
      return result.rows;
    },
    (rows) => rows.length === 0,
  );

  const detailSection = useSectionQuery<Row>(
    selected?.referralId ?? null,
    selected
      ? () => medicalReviewQueryService.providerReferralDetail(selected.referralId)
      : null,
    () => false,
  );

  const detail = detailSection.data ?? null;

  const capabilities = useMedicalReviewProviderCapabilities({
    linkedProviderId: providerId,
    referralStatus: selected?.status ?? null,
    referralProviderId: s(selected?.raw?.provider_id ?? null),
    referralDetail: detail,
    actionsEnabled: actionsState.actionsEnabled,
  });

  const assessmentId = s(detail?.assessment_id);
  const assessmentRowVersion =
    typeof detail?.assessment_row_version === 'number' ? detail.assessment_row_version : null;
  const appointmentId = s(detail?.appointment_id);
  const appointmentRowVersion =
    typeof detail?.appointment_row_version === 'number' ? detail.appointment_row_version : null;

  const reloadReferral = useCallback(async (): Promise<number | null> => {
    if (!selected) return null;
    const fresh = await medicalReviewQueryService.providerReferralDetail(selected.referralId);
    detailSection.reload();
    return typeof fresh.row_version === 'number' ? fresh.row_version : null;
  }, [selected, detailSection]);

  const refresh = useCallback(() => {
    detailSection.reload();
    worklistSection.reload();
  }, [detailSection, worklistSection]);

  const assessmentAvailability = useMemo(
    () =>
      asAvailability(
        MEDICAL_REVIEW_ACTIONS.submitAssessment,
        capabilities.submitAssessment,
        assessmentRowVersion,
      ),
    [capabilities.submitAssessment, assessmentRowVersion],
  );

  return (
    <div className="space-y-4" data-testid="mr-provider-portal">
      <header>
        <h1 className="text-xl font-semibold">Medical Review Requests</h1>
        <p className="text-sm text-muted-foreground">
          Referrals issued to your practice for a Social Security medical review. You can see only
          the cases referred to you.
        </p>
      </header>

      <MedicalReviewDarkLaunchBanner
        actionsEnabled={actionsState.actionsEnabled}
        isLoading={actionsState.isLoading}
      />

      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Restricted view</AlertTitle>
        <AlertDescription>
          Clinical information shown here is limited to the evidence released with each referral.
          Nothing about other claimants, awards, payments or Board deliberations is available in
          this portal, and no benefit-entitlement outcome is recorded by you.
        </AlertDescription>
      </Alert>

      {!capabilities.linked && worklistSection.status !== 'loading' && (
        <Alert data-testid="mr-provider-unlinked">
          <Lock className="h-4 w-4" />
          <AlertTitle>Provider verification incomplete</AlertTitle>
          <AlertDescription>
            Your account is not linked to a registered medical provider. Contact Social Security to
            complete provider verification.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={worklistSection.reload}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <SectionStateView
            name="provider-worklist"
            section={worklistSection}
            emptyMessage="You have no open medical review referrals."
          >
            {(rows) => (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Referral</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Accept by</TableHead>
                    <TableHead>Report by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.referralId}
                      className="cursor-pointer"
                      data-state={selected?.referralId === r.referralId ? 'selected' : undefined}
                      onClick={() => setSelected(r)}
                    >
                      <TableCell className="font-medium">{r.referralReference ?? '—'}</TableCell>
                      <TableCell>{r.purpose ?? '—'}</TableCell>
                      <TableCell><MedicalReviewStatusBadge status={r.status} /></TableCell>
                      <TableCell>{r.acceptanceDeadline ?? '—'}</TableCell>
                      <TableCell>{r.reportDeadline ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionStateView>
        </CardContent>
      </Card>

      {selected && (
        <Card data-testid="mr-provider-referral-detail">
          <CardHeader>
            <CardTitle className="text-base">{selected.referralReference ?? 'Referral'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <SectionStateView
              name="provider-referral"
              section={detailSection}
              emptyMessage="No referral detail available."
            >
              {(d) => (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Questions to answer</div>
                    <div className="text-sm">{String(d.review_questions ?? '—')}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Evidence release scope</div>
                    <div className="text-sm">
                      <Badge variant="outline">{String(d.evidence_release_scope ?? '—')}</Badge>
                    </div>
                  </div>
                </div>
              )}
            </SectionStateView>

            {capabilities.assessmentLocked && (
              <Alert data-testid="mr-provider-report-locked">
                <Lock className="h-4 w-4" />
                <AlertTitle>Report locked</AlertTitle>
                <AlertDescription>
                  Your submitted report is locked and can no longer be edited. Corrections must be
                  made through the addendum process.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              <CapabilityButton
                testId="mr-provider-accept"
                capability={capabilities.acceptReferral}
                variant="default"
                onClick={() => setDialog('accept')}
              >
                Accept referral
              </CapabilityButton>
              <CapabilityButton
                testId="mr-provider-decline"
                capability={capabilities.declineReferral}
                onClick={() => setDialog('decline')}
              >
                Decline referral
              </CapabilityButton>
              <CapabilityButton
                testId="mr-provider-schedule"
                capability={capabilities.manageAppointment}
                onClick={() => setDialog('schedule')}
              >
                Schedule / reschedule appointment
              </CapabilityButton>
              <CapabilityButton
                testId="mr-provider-cancel"
                capability={capabilities.recordCancellation}
                onClick={() => setDialog('cancel')}
              >
                Record provider cancellation
              </CapabilityButton>
              <CapabilityButton
                testId="mr-provider-start"
                capability={capabilities.startAssessment}
                onClick={() => setDialog('start')}
              >
                Start assessment
              </CapabilityButton>
              <CapabilityButton
                testId="mr-provider-draft"
                capability={capabilities.saveDraft}
                onClick={() => setDialog('draft')}
              >
                Save structured draft
              </CapabilityButton>
              <CapabilityButton
                testId="mr-provider-submit"
                capability={capabilities.submitAssessment}
                variant="default"
                onClick={() => setDialog('submit')}
              >
                Submit assessment
              </CapabilityButton>
              <CapabilityButton
                testId="mr-provider-addendum"
                capability={capabilities.submitAddendum}
                onClick={() => setDialog('addendum')}
              >
                Submit clarification / addendum
              </CapabilityButton>
              {/* Deliberately absent: decisions, award proposals, Board actions,
                  benefit-entitlement outcomes and any financial field. */}
            </div>
          </CardContent>
        </Card>
      )}

      {selected && (
        <>
          <MedicalReviewCommandDialog
            open={dialog === 'accept'}
            onOpenChange={(o) => setDialog(o ? 'accept' : null)}
            title="Accept referral"
            testId="mr-provider-dialog-accept"
            submitLabel="Accept referral"
            availability={asAvailability(
              MEDICAL_REVIEW_ACTIONS.submitAssessment,
              capabilities.acceptReferral,
              selected.rowVersion,
            )}
            rowVersion={selected.rowVersion}
            reloadRecord={reloadReferral}
            fields={[{ name: 'reason', label: 'Note', type: 'textarea' }]}
            execute={(v, ctx) =>
              medicalReviewCommandService.acceptReferral(selected.referralId, {
                expectedRowVersion: ctx.expectedRowVersion ?? 0,
                idempotencyKey: ctx.idempotencyKey,
                reason: (v.reason as string) ?? null,
              })
            }
            onCompleted={refresh}
          />

          <MedicalReviewCommandDialog
            open={dialog === 'decline'}
            onOpenChange={(o) => setDialog(o ? 'decline' : null)}
            title="Decline referral"
            testId="mr-provider-dialog-decline"
            submitLabel="Decline referral"
            availability={asAvailability(
              MEDICAL_REVIEW_ACTIONS.declareConflict,
              capabilities.declineReferral,
              selected.rowVersion,
            )}
            rowVersion={selected.rowVersion}
            reloadRecord={reloadReferral}
            fields={[{ name: 'declineReason', label: 'Decline reason', type: 'textarea', required: true }]}
            execute={(v, ctx) =>
              medicalReviewCommandService.declineReferral(
                selected.referralId,
                String(v.declineReason),
                { expectedRowVersion: ctx.expectedRowVersion ?? 0, idempotencyKey: ctx.idempotencyKey },
              )
            }
            onCompleted={refresh}
          />

          <MedicalReviewCommandDialog
            open={dialog === 'schedule'}
            onOpenChange={(o) => setDialog(o ? 'schedule' : null)}
            title={appointmentId ? 'Reschedule appointment' : 'Schedule appointment'}
            testId="mr-provider-dialog-schedule"
            submitLabel={appointmentId ? 'Reschedule' : 'Schedule'}
            availability={asAvailability(
              MEDICAL_REVIEW_ACTIONS.manageAppointment,
              capabilities.manageAppointment,
              appointmentRowVersion,
            )}
            rowVersion={appointmentRowVersion}
            reloadRecord={reloadReferral}
            fields={[
              { name: 'scheduledAt', label: 'Date and time', type: 'datetime', required: true },
              { name: 'locationReference', label: 'Location', type: 'text' },
              ...(appointmentId
                ? [{ name: 'reason', label: 'Reason', type: 'textarea' as const, required: true }]
                : []),
            ]}
            execute={(v, ctx) =>
              appointmentId
                ? medicalReviewCommandService.rescheduleAppointment(
                    appointmentId,
                    String(v.scheduledAt),
                    String(v.reason),
                    { expectedRowVersion: ctx.expectedRowVersion ?? 0, idempotencyKey: ctx.idempotencyKey },
                  )
                : medicalReviewCommandService.scheduleAppointment({
                    referralId: selected.referralId,
                    scheduledAt: String(v.scheduledAt),
                    locationReference: (v.locationReference as string) ?? null,
                    idempotencyKey: ctx.idempotencyKey,
                  })
            }
            onCompleted={refresh}
          />

          <MedicalReviewCommandDialog
            open={dialog === 'cancel'}
            onOpenChange={(o) => setDialog(o ? 'cancel' : null)}
            title="Record provider cancellation"
            testId="mr-provider-dialog-cancel"
            submitLabel="Record cancellation"
            availability={asAvailability(
              MEDICAL_REVIEW_ACTIONS.manageAppointment,
              capabilities.recordCancellation,
              appointmentRowVersion,
            )}
            rowVersion={appointmentRowVersion}
            reloadRecord={reloadReferral}
            fields={[
              { name: 'notes', label: 'Notes', type: 'textarea', required: true },
              { name: 'reason', label: 'Reason', type: 'textarea', required: true },
            ]}
            execute={(v, ctx) =>
              medicalReviewCommandService.recordProviderCancellation(
                appointmentId!,
                String(v.notes),
                String(v.reason),
                { expectedRowVersion: ctx.expectedRowVersion ?? 0, idempotencyKey: ctx.idempotencyKey },
              )
            }
            onCompleted={refresh}
          />

          <MedicalReviewCommandDialog
            open={dialog === 'start'}
            onOpenChange={(o) => setDialog(o ? 'start' : null)}
            title="Start assessment"
            testId="mr-provider-dialog-start"
            submitLabel="Start assessment"
            availability={asAvailability(
              MEDICAL_REVIEW_ACTIONS.submitAssessment,
              capabilities.startAssessment,
              selected.rowVersion,
            )}
            rowVersion={selected.rowVersion}
            reloadRecord={reloadReferral}
            fields={[]}
            execute={(_v, ctx) =>
              medicalReviewCommandService.startAssessment(selected.referralId, {
                expectedRowVersion: ctx.expectedRowVersion ?? 0,
                idempotencyKey: ctx.idempotencyKey,
              })
            }
            onCompleted={refresh}
          />

          <MedicalReviewCommandDialog
            open={dialog === 'draft'}
            onOpenChange={(o) => setDialog(o ? 'draft' : null)}
            title="Save structured draft"
            testId="mr-provider-dialog-draft"
            submitLabel="Save draft"
            availability={asAvailability(
              MEDICAL_REVIEW_ACTIONS.submitAssessment,
              capabilities.saveDraft,
              assessmentRowVersion,
            )}
            rowVersion={assessmentRowVersion}
            reloadRecord={reloadReferral}
            fields={ASSESSMENT_FIELDS}
            execute={(v, ctx) =>
              medicalReviewCommandService.saveAssessmentDraft(assessmentId!, v, {
                expectedRowVersion: ctx.expectedRowVersion ?? 0,
                idempotencyKey: ctx.idempotencyKey,
              })
            }
            onCompleted={refresh}
          />

          <MedicalReviewCommandDialog
            open={dialog === 'submit'}
            onOpenChange={(o) => setDialog(o ? 'submit' : null)}
            title="Submit assessment"
            boundaryNotice="Once submitted the report is locked. Corrections require the addendum process."
            testId="mr-provider-dialog-submit"
            submitLabel="Submit assessment"
            availability={assessmentAvailability}
            rowVersion={assessmentRowVersion}
            reloadRecord={reloadReferral}
            fields={[]}
            execute={(_v, ctx) =>
              medicalReviewCommandService.submitAssessment(assessmentId!, {
                expectedRowVersion: ctx.expectedRowVersion ?? 0,
                idempotencyKey: ctx.idempotencyKey,
              })
            }
            onCompleted={refresh}
          />

          <MedicalReviewCommandDialog
            open={dialog === 'addendum'}
            onOpenChange={(o) => setDialog(o ? 'addendum' : null)}
            title="Submit clarification or addendum"
            testId="mr-provider-dialog-addendum"
            submitLabel="Submit addendum"
            availability={asAvailability(
              MEDICAL_REVIEW_ACTIONS.submitAssessment,
              capabilities.submitAddendum,
              assessmentRowVersion,
            )}
            rowVersion={assessmentRowVersion}
            reloadRecord={reloadReferral}
            fields={[
              { name: 'addendumNarrative', label: 'Addendum', type: 'textarea', required: true },
              { name: 'medicalOutcome', label: 'Revised medical outcome', type: 'select', options: MEDICAL_OUTCOMES },
            ]}
            execute={(v, ctx) =>
              medicalReviewCommandService.submitClarification(assessmentId!, v, {
                expectedRowVersion: ctx.expectedRowVersion ?? 0,
                idempotencyKey: ctx.idempotencyKey,
              })
            }
            onCompleted={refresh}
          />
        </>
      )}
    </div>
  );
};

export default MedicalProviderReferralWorkspace;
