/**
 * AW360-WAVE-1-C1 Slice B.1a §1 — Loader Manifest.
 *
 * Every symbol exported from the three Award 360 service files is
 * classified below. New exports MUST be added to this manifest; the
 * drift test (`loaderManifest.test.ts`) fails when:
 *
 *   • A new async/query export is present but unclassified.
 *   • A manifest entry references a symbol that no longer exists.
 *   • A `QUERY_LOADER` has no execution scenario.
 *
 * This checkpoint executes six loaders against the schema contract:
 *   getAward360Header, getAward360Summary, getAwardClaim,
 *   getAwardProduct, listAwardCommunications, listAwardAudit.
 *
 * All other query loaders are enumerated below but marked as
 * `pendingExecution` — Slice B.1b will run them.
 */
import { certificationScenariosFor } from './award360CertificationRegistry';

export type Award360ExportClassification =
  | 'QUERY_LOADER'
  | 'PURE_MAPPER'
  | 'TYPE_ONLY'
  | 'CONSTANT'
  | 'INTERNAL_HELPER';

export type Award360LoaderCategory =
  | 'HEADER'
  | 'OVERVIEW'
  | 'SUMMARY'
  | 'PENSIONER'
  | 'CLAIM'
  | 'PRODUCT'
  | 'BENEFICIARY'
  | 'SCHEDULE'
  | 'PAYMENT'
  | 'LIFE_CERTIFICATE'
  | 'MEDICAL'
  | 'SUSPENSION'
  | 'OVERPAYMENT'
  | 'COMMUNICATION'
  | 'AUDIT';

export interface Award360ExportEntry {
  name: string;
  sourceFile: string;
  classification: Award360ExportClassification;
  /** Loader category — required when `classification === 'QUERY_LOADER'`. */
  category?: Award360LoaderCategory;
  /** Tables the loader reads. Required for QUERY_LOADER. */
  expectedTables?: readonly string[];
  /** Scenario ids this checkpoint executes for the loader (may be empty). */
  scenarioIds?: readonly string[];
  /** True when Slice B.1a defers execution to a subsequent batch. */
  pendingExecution?: boolean;
}

const F_SVC = 'src/services/bn/awards/award360Service.ts';
const F_DEEP = 'src/services/bn/awards/award360DeepService.ts';
const F_SUM = 'src/services/bn/awards/award360SummaryService.ts';

export const AWARD360_LOADER_MANIFEST: readonly Award360ExportEntry[] = [
  // ─── award360Service.ts — query loaders ────────────────────────────────
  {
    name: 'getAward360Header',
    sourceFile: F_SVC,
    classification: 'QUERY_LOADER',
    category: 'HEADER',
    expectedTables: ['bn_award', 'ip_master', 'bn_product', 'bn_claim', 'bn_product_version'],
    scenarioIds: certificationScenariosFor('getAward360Header'),
  },
  {
    name: 'getAwardPensioner',
    sourceFile: F_SVC,
    classification: 'QUERY_LOADER',
    category: 'PENSIONER',
    expectedTables: ['bn_award', 'ip_master'],
    scenarioIds: certificationScenariosFor('getAwardPensioner'),
  },
  {
    name: 'getAwardClaim',
    sourceFile: F_SVC,
    classification: 'QUERY_LOADER',
    category: 'CLAIM',
    expectedTables: ['bn_award', 'bn_claim'],
    scenarioIds: certificationScenariosFor('getAwardClaim'),
  },
  {
    name: 'getAwardProduct',
    sourceFile: F_SVC,
    classification: 'QUERY_LOADER',
    category: 'PRODUCT',
    // BUG-011 — bn_scheme/bn_branch resolve scheme_id/branch_id to names.
    expectedTables: ['bn_award', 'bn_product', 'bn_scheme', 'bn_branch', 'bn_claim', 'bn_product_version'],
    scenarioIds: certificationScenariosFor('getAwardProduct'),
  },
  {
    name: 'listAwardBeneficiaries',
    sourceFile: F_SVC,
    classification: 'QUERY_LOADER',
    category: 'BENEFICIARY',
    expectedTables: ['bn_award_beneficiary'],
    scenarioIds: certificationScenariosFor('listAwardBeneficiaries'),
  },
  {
    name: 'listAwardSchedules',
    sourceFile: F_SVC,
    classification: 'QUERY_LOADER',
    category: 'SCHEDULE',
    expectedTables: ['bn_payment_schedule'],
    scenarioIds: certificationScenariosFor('listAwardSchedules'),
  },
  {
    name: 'listAwardPayments',
    sourceFile: F_SVC,
    classification: 'QUERY_LOADER',
    category: 'PAYMENT',
    expectedTables: ['bn_payment_instruction'],
    scenarioIds: certificationScenariosFor('listAwardPayments'),
  },
  {
    name: 'listAwardLifeCertificates',
    sourceFile: F_SVC,
    classification: 'QUERY_LOADER',
    category: 'LIFE_CERTIFICATE',
    expectedTables: ['bn_life_certificate'],
    scenarioIds: certificationScenariosFor('listAwardLifeCertificates'),
  },
  {
    name: 'listAwardMedicalReviews',
    sourceFile: F_SVC,
    classification: 'QUERY_LOADER',
    category: 'MEDICAL',
    expectedTables: ['bn_medical_review_schedule'],
    scenarioIds: certificationScenariosFor('listAwardMedicalReviews'),
  },
  {
    name: 'listAwardMedicalReviewsPaged',
    sourceFile: F_SVC,
    classification: 'QUERY_LOADER',
    category: 'MEDICAL',
    expectedTables: ['bn_medical_review_schedule'],
    scenarioIds: certificationScenariosFor('listAwardMedicalReviewsPaged'),
  },
  {
    name: 'getAwardMedicalReviewDetail',
    sourceFile: F_SVC,
    classification: 'QUERY_LOADER',
    category: 'MEDICAL',
    expectedTables: ['bn_medical_review_schedule'],
    scenarioIds: certificationScenariosFor('getAwardMedicalReviewDetail'),
  },
  {
    name: 'listAwardSuspensions',
    sourceFile: F_SVC,
    classification: 'QUERY_LOADER',
    category: 'SUSPENSION',
    expectedTables: ['bn_award_suspension_event', 'core_workflow_task'],
    scenarioIds: certificationScenariosFor('listAwardSuspensions'),
  },
  {
    name: 'listAwardOverpayments',
    sourceFile: F_SVC,
    classification: 'QUERY_LOADER',
    category: 'OVERPAYMENT',
    expectedTables: ['bn_overpayment'],
    scenarioIds: certificationScenariosFor('listAwardOverpayments'),
  },
  {
    name: 'listAwardCommunications',
    sourceFile: F_SVC,
    classification: 'QUERY_LOADER',
    category: 'COMMUNICATION',
    expectedTables: ['bn_award', 'bn_communication_log'],
    scenarioIds: certificationScenariosFor('listAwardCommunications'),
  },
  {
    name: 'loadAwardAuditSources',
    sourceFile: F_SVC,
    classification: 'QUERY_LOADER',
    category: 'AUDIT',
    expectedTables: [
      'bn_award_status_event',
      'bn_award_rate_history',
      'bn_award_suspension_event',
      'core_audit_log',
    ],
    scenarioIds: certificationScenariosFor('loadAwardAuditSources'),
  },
  {
    name: 'listAwardAudit',
    sourceFile: F_SVC,
    classification: 'QUERY_LOADER',
    category: 'AUDIT',
    // B2-b.1b — the compat wrapper never reaches `core_audit_log`.
    // (Central audit is reserved for `loadAwardAuditSources`.)
    expectedTables: [
      'bn_award_status_event',
      'bn_award_rate_history',
      'bn_award_suspension_event',
    ],
    scenarioIds: certificationScenariosFor('listAwardAudit'),
  },
  {
    name: 'listAwardAuditPaged',
    sourceFile: F_SVC,
    classification: 'QUERY_LOADER',
    category: 'AUDIT',
    expectedTables: [
      'bn_award_status_event',
      'bn_award_rate_history',
      'bn_award_suspension_event',
      'core_audit_log',
    ],
    scenarioIds: certificationScenariosFor('listAwardAuditPaged'),
  },
  {
    name: 'getAward360OverviewCounts',
    sourceFile: F_SVC,
    classification: 'QUERY_LOADER',
    category: 'OVERVIEW',
    // AW360-WAVE-1-C1 Stage D2 — union of tables reached through the
    // eight underlying operational list loaders. `bn_award` is queried
    // via listAwardCommunications; `core_workflow_task` via
    // listAwardSuspensions when a workflow_instance_id is present.
    expectedTables: [
      'bn_award',
      'bn_award_beneficiary',
      'bn_award_suspension_event',
      'bn_communication_log',
      'bn_life_certificate',
      'bn_medical_review_schedule',
      'bn_overpayment',
      'bn_payment_instruction',
      'bn_payment_schedule',
      'core_workflow_task',
    ],
    scenarioIds: certificationScenariosFor('getAward360OverviewCounts'),
  },
  { name: 'listAwardSchedulesPaged', sourceFile: F_SVC, classification: 'QUERY_LOADER', category: 'SCHEDULE', expectedTables: ['bn_payment_schedule'], scenarioIds: certificationScenariosFor('listAwardSchedulesPaged') },
  { name: 'getAwardScheduleDetail', sourceFile: F_SVC, classification: 'QUERY_LOADER', category: 'SCHEDULE', expectedTables: ['bn_payment_schedule', 'bn_payment_instruction'], scenarioIds: certificationScenariosFor('getAwardScheduleDetail') },
  { name: 'listAwardPaymentsPaged', sourceFile: F_SVC, classification: 'QUERY_LOADER', category: 'PAYMENT', expectedTables: ['bn_payment_instruction'], scenarioIds: certificationScenariosFor('listAwardPaymentsPaged') },
  { name: 'listAwardLifeCertificatesPaged', sourceFile: F_SVC, classification: 'QUERY_LOADER', category: 'LIFE_CERTIFICATE', expectedTables: ['bn_life_certificate', 'bn_award', 'bn_communication_log'], scenarioIds: certificationScenariosFor('listAwardLifeCertificatesPaged') },
  { name: 'getAwardLifeCertificateReminders', sourceFile: F_SVC, classification: 'QUERY_LOADER', category: 'LIFE_CERTIFICATE', expectedTables: ['bn_award', 'bn_communication_log'], scenarioIds: certificationScenariosFor('getAwardLifeCertificateReminders') },
  { name: 'listAwardBeneficiariesPaged', sourceFile: F_SVC, classification: 'QUERY_LOADER', category: 'BENEFICIARY', expectedTables: ['bn_award_beneficiary'], scenarioIds: certificationScenariosFor('listAwardBeneficiariesPaged') },
  { name: 'getAwardBeneficiaryDetail', sourceFile: F_SVC, classification: 'QUERY_LOADER', category: 'BENEFICIARY', expectedTables: ['bn_award_beneficiary'], scenarioIds: certificationScenariosFor('getAwardBeneficiaryDetail') },
  { name: 'listAwardOverpaymentsPaged', sourceFile: F_SVC, classification: 'QUERY_LOADER', category: 'OVERPAYMENT', expectedTables: ['bn_overpayment'], scenarioIds: certificationScenariosFor('listAwardOverpaymentsPaged') },
  { name: 'getAwardOverpaymentDetail', sourceFile: F_SVC, classification: 'QUERY_LOADER', category: 'OVERPAYMENT', expectedTables: ['bn_overpayment', 'bn_payment_schedule'], scenarioIds: certificationScenariosFor('getAwardOverpaymentDetail') },
  { name: 'listAwardCommunicationsPaged', sourceFile: F_SVC, classification: 'QUERY_LOADER', category: 'COMMUNICATION', expectedTables: ['bn_award', 'bn_communication_log', 'bn_letter'], scenarioIds: certificationScenariosFor('listAwardCommunicationsPaged') },
  { name: 'getAwardCommunicationDetail', sourceFile: F_SVC, classification: 'QUERY_LOADER', category: 'COMMUNICATION', expectedTables: ['bn_communication_log', 'bn_letter'], scenarioIds: certificationScenariosFor('getAwardCommunicationDetail') },

  // ─── award360Service.ts — non-loader exports ──────────────────────────
  { name: 'AWARD_AUDIT_STATUS_COLUMNS', sourceFile: F_SVC, classification: 'CONSTANT' },
  { name: 'AWARD_AUDIT_RATE_COLUMNS', sourceFile: F_SVC, classification: 'CONSTANT' },
  { name: 'AWARD_AUDIT_SUSPENSION_COLUMNS', sourceFile: F_SVC, classification: 'CONSTANT' },
  { name: 'AWARD_AUDIT_CENTRAL_COLUMNS', sourceFile: F_SVC, classification: 'CONSTANT' },
  { name: 'isWithinAuditRange', sourceFile: F_SVC, classification: 'PURE_MAPPER' },
  { name: 'resolveLifeCertificateCompliance', sourceFile: F_SVC, classification: 'PURE_MAPPER' },
  { name: 'validateAwardBeneficiaries', sourceFile: F_SVC, classification: 'PURE_MAPPER' },

  // ─── award360DeepService.ts ───────────────────────────────────────────
  {
    name: 'getAwardPensionerDeep',
    sourceFile: F_DEEP,
    classification: 'QUERY_LOADER',
    category: 'PENSIONER',
    expectedTables: [
      'bn_award', 'ip_master', 'ip_depend',
      'bn_payment_profile', 'bn_payment_profile_change_request',
      'bn_claim',
    ],
    scenarioIds: certificationScenariosFor('getAwardPensionerDeep'),
  },
  {
    name: 'getAwardClaimDeep',
    sourceFile: F_DEEP,
    classification: 'QUERY_LOADER',
    category: 'CLAIM',
    expectedTables: [
      'bn_claim',
      'bn_award',
      'bn_claim_queue_assignment',
      'bn_product_version',
      'bn_claim_eligibility',
      'bn_claim_calculation',
      'bn_claim_decision',
      'bn_claim_evidence',
      'bn_doc_requirement',
      'bn_claim_event',
      'bn_claim_note',
    ],
    scenarioIds: certificationScenariosFor('getAwardClaimDeep'),
  },
  {
    name: 'getAwardProductDeep',
    sourceFile: F_DEEP,
    classification: 'QUERY_LOADER',
    category: 'PRODUCT',
    // AW360-WAVE-1-C1 Sub-batch B2-c.2 — Product Deep promoted to
    // CODE_COMPLETE. Certified in `productDeepCore.test.ts` under the
    // `product-deep-certification` suite, covering primary-source
    // semantics, version resolution, exact readiness-column selection,
    // configuration permission suppression, consistency warnings and
    // the full optional-source failure matrix.
    expectedTables: [
      'bn_award',
      'bn_product',
      'bn_scheme',
      'bn_branch',
      'bn_claim',
      'bn_product_version',
      'bn_product_formula_binding',
      'bn_eligibility_rule',
      'bn_approval_policy',
      'bn_comm_mapping',
    ],
    scenarioIds: certificationScenariosFor('getAwardProductDeep'),
  },


  // ─── award360SummaryService.ts ────────────────────────────────────────
  {
    name: 'getAward360Summary',
    sourceFile: F_SUM,
    classification: 'QUERY_LOADER',
    category: 'SUMMARY',
    expectedTables: [
      'bn_award_beneficiary',
      'bn_payment_schedule',
      'bn_payment_instruction',
      'bn_life_certificate',
      'bn_medical_review_schedule',
      'bn_award_suspension_event',
      'bn_overpayment',
      'bn_communication_log',
      'bn_award',
      'ip_master',
      'bn_payment_profile',
    ],
    scenarioIds: certificationScenariosFor('getAward360Summary'),
  },
];

/** Loaders executed in this checkpoint (Slice B.1a). */
export const AWARD360_CHECKPOINT_LOADERS = [
  'getAward360Header',
  'getAward360Summary',
  'getAwardClaim',
  'getAwardProduct',
  'listAwardCommunications',
  'listAwardAudit',
  'loadAwardAuditSources',
] as const;

export type Award360CheckpointLoader = (typeof AWARD360_CHECKPOINT_LOADERS)[number];

/**
 * AW360-WAVE-1-C1 Stage D4 — Manifest-level certification status.
 *
 * Legal transitions: `NOT_STARTED` → `CODE_COMPLETE` → `RUNTIME_CERTIFIED`.
 * Bumped to `RUNTIME_CERTIFIED` in Stage D4 after:
 *   - every registered action gained a canonical runtime guard,
 *   - a matrix-driven UI/runtime parity test proved consistency,
 *   - negative-security tests proved blocked mutations cannot execute,
 *   - the action-consumer inventory reconciled with zero unexplained gaps.
 */
export type Award360ManifestStatus =
  | 'NOT_STARTED'
  | 'CODE_COMPLETE'
  | 'RUNTIME_CERTIFIED'
  | 'PILOT_MUTATION_CERTIFIED'
  | 'PILOT_OPERATIONALLY_VALIDATED'
  | 'LIMITED_PRODUCTION_PILOT_VALIDATED'
  | 'WAVE_1_PRODUCTION_READY';

/**
 * Stage D8 promotion: Wave 1 production readiness certified after
 * database-native persistent idempotency (unique-constrained atomic
 * claim), multi-instance concurrency proof, controlled volume ramps,
 * production rate limiting & backpressure, independent reminder-command
 * vs. delivery lifecycles, restart/deployment safety, SLO evaluation,
 * disaster-recovery drill, formal security certification, and per-action
 * promotion decisions. Exactly four handlers remain executable; every
 * other mutation stays dark-launched.
 */
export const AWARD360_MANIFEST_STATUS: Award360ManifestStatus = 'WAVE_1_PRODUCTION_READY';

/**
 * Human-readable version tag stamped into diagnostics. Update when a new
 * Stage promotes the manifest.
 */
export const AWARD360_MANIFEST_VERSION = 'AW360-WAVE-1-C1-D8';


