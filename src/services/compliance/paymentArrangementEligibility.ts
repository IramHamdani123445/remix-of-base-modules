/**
 * Payment Arrangement eligibility — single place that decides whether a
 * compliance case may raise a new payment arrangement, and (critically) WHY
 * not when it may not.
 *
 * Every blocking reason is derived from configured business state rather than
 * being hidden in the UI: feature toggle, case workflow stage, outstanding
 * liability, an existing open arrangement, case ownership and permission.
 */

export interface ArrangementEligibilityInput {
  caseStatus: string;
  outstanding: number;
  featureEnabled: boolean;
  hasPermission: boolean;
  assignedOfficerId: string | null | undefined;
  /** Existing arrangements already on this case (any status). */
  arrangements: Array<{ status?: string | null }>;
  /** Latest legal referral stage, when the case has been escalated. */
  legalStatus?: string | null;
}

export interface ArrangementEligibility {
  allowed: boolean;
  /** Short reason shown on the disabled control / tooltip. */
  reason: string | null;
  /** All blocking reasons, for the explanatory panel. */
  reasons: string[];
}

const CLOSED_CASE_STATUSES = ['RESOLVED', 'CLOSED', 'COMPLETED'];
const OPEN_ARRANGEMENT_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'PENDING', 'ACTIVE', 'IN_ARREARS'];
/** Once the matter sits with Legal, recovery terms are agreed by Legal. */
const LEGAL_BLOCKING_STATUSES = ['SUBMITTED_TO_LEGAL', 'ACCEPTED_BY_LEGAL', 'IN_LEGAL_PROCEEDINGS'];

export function evaluateArrangementEligibility(
  input: ArrangementEligibilityInput,
): ArrangementEligibility {
  const reasons: string[] = [];

  if (!input.featureEnabled) {
    reasons.push('Payment arrangements are switched off for Compliance (feature toggle "arrangements.new").');
  }
  if (!input.hasPermission) {
    reasons.push('You do not have the Compliance permission required to create an arrangement.');
  }
  if (CLOSED_CASE_STATUSES.includes(input.caseStatus)) {
    reasons.push(`The case is ${input.caseStatus.replace(/_/g, ' ').toLowerCase()} — reopen it before agreeing terms.`);
  }
  if (input.caseStatus === 'CSTG_PAYMENT_ARRANGEMENT_ACTIVE') {
    reasons.push('The case is already at the "payment arrangement active" stage.');
  }
  if (!(input.outstanding > 0)) {
    reasons.push('There is no outstanding liability on this case to schedule.');
  }
  const openArrangement = input.arrangements.find((a) =>
    OPEN_ARRANGEMENT_STATUSES.includes(String(a.status ?? '').toUpperCase()),
  );
  if (openArrangement) {
    reasons.push(
      `An arrangement is already open on this case (${String(openArrangement.status).replace(/_/g, ' ')}). Close or default it first.`,
    );
  }
  if (!input.assignedOfficerId) {
    reasons.push('The case has no assigned officer — assign one so the arrangement has an owner.');
  }
  if (input.legalStatus && LEGAL_BLOCKING_STATUSES.includes(input.legalStatus)) {
    reasons.push('The case is with Legal — payment terms must be agreed through the Legal recovery process.');
  }

  return { allowed: reasons.length === 0, reason: reasons[0] ?? null, reasons };
}
