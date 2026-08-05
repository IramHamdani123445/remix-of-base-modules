/**
 * BN Medical Reviews — permission catalogue (frontend mirror).
 *
 * These action codes mirror `core_permission_registry` rows whose
 * `module_code = 'bn_medical_review'`. The frontend uses them ONLY to decide
 * what to render; every action is independently re-authorised server-side by
 * the command RPCs. Hiding a control is never the security boundary.
 */

export const MEDICAL_REVIEW_MODULE_CODE = 'bn_medical_review' as const;

export const MEDICAL_REVIEW_ACTIONS = {
  view: 'view',
  viewAllRecords: 'view_all_records',
  viewMedicalSummary: 'view_medical_summary',
  viewConfidentialMedicalEvidence: 'view_confidential_medical_evidence',
  viewSensitiveIdentity: 'view_sensitive_identity',
  viewAudit: 'view_audit',

  configurePolicy: 'configure_policy',
  publishPolicy: 'publish_policy',
  administerModule: 'administer_module',

  manageProviders: 'manage_providers',
  verifyCredentials: 'verify_credentials',
  declareConflict: 'declare_conflict',

  generateObligations: 'generate_obligations',
  issueReferral: 'issue_referral',
  assignProvider: 'assign_provider',
  manageAppointment: 'manage_appointment',
  submitAssessment: 'submit_assessment',
  validateReport: 'validate_report',
  requestSecondOpinion: 'request_second_opinion',
  deferReview: 'defer_review',

  referToBoard: 'refer_to_board',
  manageBoardCase: 'manage_board_case',
  manageBoardSession: 'manage_board_session',
  recordBoardParticipation: 'record_board_participation',
  recordBoardDetermination: 'record_board_determination',

  prepareDecision: 'prepare_decision',
  approveDecision: 'approve_decision',
  proposeSuspension: 'propose_suspension',
  proposeReinstatement: 'propose_reinstatement',
  closeReview: 'close_review',
} as const;

export type MedicalReviewAction =
  (typeof MEDICAL_REVIEW_ACTIONS)[keyof typeof MEDICAL_REVIEW_ACTIONS];

/** Canonical `bn.medical_review.<action>` permission key. */
export function medicalReviewPermissionKey(action: MedicalReviewAction): string {
  return `bn.medical_review.${action}`;
}

/**
 * Actions that mutate state. Every one of these is additionally gated by the
 * authoritative `app_modules.actions_enabled` dark-launch flag.
 */
export const MEDICAL_REVIEW_MUTATING_ACTIONS: readonly MedicalReviewAction[] = [
  MEDICAL_REVIEW_ACTIONS.configurePolicy,
  MEDICAL_REVIEW_ACTIONS.publishPolicy,
  MEDICAL_REVIEW_ACTIONS.administerModule,
  MEDICAL_REVIEW_ACTIONS.manageProviders,
  MEDICAL_REVIEW_ACTIONS.verifyCredentials,
  MEDICAL_REVIEW_ACTIONS.declareConflict,
  MEDICAL_REVIEW_ACTIONS.generateObligations,
  MEDICAL_REVIEW_ACTIONS.issueReferral,
  MEDICAL_REVIEW_ACTIONS.assignProvider,
  MEDICAL_REVIEW_ACTIONS.manageAppointment,
  MEDICAL_REVIEW_ACTIONS.submitAssessment,
  MEDICAL_REVIEW_ACTIONS.validateReport,
  MEDICAL_REVIEW_ACTIONS.requestSecondOpinion,
  MEDICAL_REVIEW_ACTIONS.deferReview,
  MEDICAL_REVIEW_ACTIONS.referToBoard,
  MEDICAL_REVIEW_ACTIONS.manageBoardCase,
  MEDICAL_REVIEW_ACTIONS.manageBoardSession,
  MEDICAL_REVIEW_ACTIONS.recordBoardParticipation,
  MEDICAL_REVIEW_ACTIONS.recordBoardDetermination,
  MEDICAL_REVIEW_ACTIONS.prepareDecision,
  MEDICAL_REVIEW_ACTIONS.approveDecision,
  MEDICAL_REVIEW_ACTIONS.proposeSuspension,
  MEDICAL_REVIEW_ACTIONS.proposeReinstatement,
  MEDICAL_REVIEW_ACTIONS.closeReview,
];

/** Read-only actions remain available while the module is dark-launched. */
export const MEDICAL_REVIEW_READ_ACTIONS: readonly MedicalReviewAction[] = [
  MEDICAL_REVIEW_ACTIONS.view,
  MEDICAL_REVIEW_ACTIONS.viewAllRecords,
  MEDICAL_REVIEW_ACTIONS.viewMedicalSummary,
  MEDICAL_REVIEW_ACTIONS.viewConfidentialMedicalEvidence,
  MEDICAL_REVIEW_ACTIONS.viewSensitiveIdentity,
  MEDICAL_REVIEW_ACTIONS.viewAudit,
];

export function isMutatingMedicalReviewAction(action: MedicalReviewAction): boolean {
  return MEDICAL_REVIEW_MUTATING_ACTIONS.includes(action);
}
