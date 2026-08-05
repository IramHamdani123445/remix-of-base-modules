/**
 * Restricted Medical Provider Portal — capability resolution.
 *
 * The portal NEVER assumes provider-side permission. Capability is derived
 * from facts the server returned:
 *
 *  - the signed-in account is linked to a registered provider
 *    (`provider_id` comes from `bn_medical_review_provider_worklist_v1`)
 *  - the referral is assigned to that provider
 *  - the referral lifecycle status
 *  - who owns the appointment
 *  - the existing assessment status
 *  - the authoritative `app_modules.actions_enabled` flag
 *  - any explicit `capabilities` block returned by the referral-detail RPC
 *
 * A provider id supplied by the browser is never trusted: it is only used to
 * confirm that the row the server returned belongs to the linked provider.
 */
import { useMemo } from 'react';

export interface ProviderCapabilityInputs {
  /** Provider identity resolved server-side for the signed-in account. */
  linkedProviderId: string | null;
  /** Referral row returned by the secured provider worklist. */
  referralStatus: string | null;
  /** Provider id attached to the referral row the server returned. */
  referralProviderId: string | null;
  /** Provider-detail envelope (may carry an explicit `capabilities` object). */
  referralDetail: Record<string, unknown> | null;
  actionsEnabled: boolean;
}

export interface ProviderCapability {
  enabled: boolean;
  reason: string | null;
}

export interface ProviderCapabilities {
  linked: boolean;
  assigned: boolean;
  acceptReferral: ProviderCapability;
  declineReferral: ProviderCapability;
  manageAppointment: ProviderCapability;
  recordCancellation: ProviderCapability;
  startAssessment: ProviderCapability;
  saveDraft: ProviderCapability;
  submitAssessment: ProviderCapability;
  submitAddendum: ProviderCapability;
  assessmentLocked: boolean;
}

const NO = (reason: string): ProviderCapability => ({ enabled: false, reason });
const YES: ProviderCapability = { enabled: true, reason: null };

function serverSays(detail: Record<string, unknown> | null, key: string): boolean | null {
  const caps = detail?.capabilities;
  if (caps && typeof caps === 'object' && key in (caps as Record<string, unknown>)) {
    return (caps as Record<string, unknown>)[key] === true;
  }
  return null;
}

export function useMedicalReviewProviderCapabilities(
  inputs: ProviderCapabilityInputs,
): ProviderCapabilities {
  const {
    linkedProviderId,
    referralStatus,
    referralProviderId,
    referralDetail,
    actionsEnabled,
  } = inputs;

  return useMemo(() => {
    const linked = !!linkedProviderId;
    // Fail closed: an unknown assigned provider is NOT treated as "mine".
    const assigned = linked && referralProviderId === linkedProviderId;

    const status = (referralStatus ?? '').toUpperCase();
    const assessmentStatus = String(
      (referralDetail?.assessment_status as string) ??
        (referralDetail?.report_status as string) ??
        '',
    ).toUpperCase();
    const appointmentOwner = String(
      (referralDetail?.appointment_responsibility as string) ??
        (referralDetail?.appointment_owner as string) ??
        '',
    ).toUpperCase();

    // Canonical assessment states that end provider editing.
    const assessmentLocked = /^(SUBMITTED|VALIDATED|LOCKED)$/.test(assessmentStatus);


    const gate = (
      key: string,
      allowed: boolean,
      reason: string,
    ): ProviderCapability => {
      const override = serverSays(referralDetail, key);
      if (override === false) return NO('The service has not granted this action for this referral.');
      if (!actionsEnabled) return NO('Medical Reviews is in read-only dark launch.');
      if (!linked)
        return NO(
          'Your account is not linked to a registered medical provider. Contact Social Security to complete provider verification.',
        );
      if (!assigned) return NO('This referral is not assigned to your practice.');
      if (override === true) return YES;
      return allowed ? YES : NO(reason);
    };

    return {
      linked,
      assigned,
      acceptReferral: gate('accept_referral', status === 'ISSUED', 'Only an issued referral can be accepted.'),
      declineReferral: gate('decline_referral', status === 'ISSUED', 'Only an issued referral can be declined.'),
      manageAppointment: gate(
        'manage_appointment',
        /ACCEPTED|IN_PROGRESS/.test(status) && appointmentOwner !== 'ADMINISTRATION',
        appointmentOwner === 'ADMINISTRATION'
          ? 'Social Security schedules the appointment for this referral.'
          : 'Accept the referral before managing the appointment.',
      ),
      recordCancellation: gate(
        'record_provider_cancellation',
        /ACCEPTED|IN_PROGRESS/.test(status),
        'There is no active appointment to cancel.',
      ),
      startAssessment: gate(
        'start_assessment',
        /ACCEPTED|IN_PROGRESS/.test(status) && !assessmentLocked,
        assessmentLocked ? 'The report is locked.' : 'Accept the referral before starting the assessment.',
      ),
      saveDraft: gate(
        'save_assessment_draft',
        !assessmentLocked && /DRAFT|IN_PROGRESS/.test(assessmentStatus || 'DRAFT'),
        'The report is locked. Corrections require the addendum process.',
      ),
      submitAssessment: gate(
        'submit_assessment',
        !assessmentLocked && /DRAFT|IN_PROGRESS/.test(assessmentStatus || 'DRAFT'),
        'The report is locked. Corrections require the addendum process.',
      ),
      submitAddendum: gate(
        'submit_clarification',
        assessmentLocked || /CLARIFICATION_REQUESTED/.test(assessmentStatus),
        'An addendum can only be submitted after the report has been submitted.',
      ),
      assessmentLocked,
    };
  }, [linkedProviderId, referralStatus, referralProviderId, referralDetail, actionsEnabled]);
}
