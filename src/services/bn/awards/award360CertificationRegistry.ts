/**
 * AW360-WAVE-1-C1 Sub-batch B2-b.1b — Certification registry.
 *
 * Authoritative list of Award 360 loaders whose real production
 * implementations have been executed against `AWARD360_SCHEMA_CONTRACT`
 * via `AwardQueryRecorder` in `award360LoaderCertification.test.ts`.
 *
 * Cycle rule: this module has NO imports. It is the leaf of the
 * dependency chain
 *
 *   award360CertificationRegistry
 *         ↓
 *   award360LoaderManifest
 *         ↓
 *   award360LoaderEvidence   (derives loader-to-table mapping)
 *         ↓
 *   award360SchemaContract   (renders the query matrix)
 *
 * A loader listed here MUST NOT be marked `pendingExecution` in the
 * manifest, and every scenario listed here MUST be actually executed in
 * the certification test — both directions are enforced by
 * `certificationRegistryReconciliation.test.ts` and by the runtime
 * evidence reconciliation at the end of the certification suite.
 */

export interface Award360CertifiedScenario {
  readonly id: string;
  readonly description: string;
}

/**
 * AW360-WAVE-1-C1 Sub-batch B2-c.2 — Certification suite identifier.
 *
 * Each certified loader is owned by exactly one certification test suite.
 * The suite identifier is used by the shared evidence-reconciliation
 * helper (`assertLoaderCertificationEvidence`) to scope structural and
 * runtime checks to only the entries that a given suite is expected to
 * exercise, so Product Deep evidence in one file cannot be conflated
 * with main-suite evidence in another.
 */
export type Award360CertificationSuiteId =
  | 'main-loader-certification'
  | 'product-deep-certification'
  | 'operational-simple-certification'
  | 'operational-complex-certification';

export const AWARD360_CERTIFICATION_SUITE_IDS: readonly Award360CertificationSuiteId[] = [
  'main-loader-certification',
  'product-deep-certification',
  'operational-simple-certification',
  'operational-complex-certification',
];

export interface Award360LoaderCertification {
  readonly loaderName: string;
  readonly suiteId: Award360CertificationSuiteId;
  readonly scenarios: readonly Award360CertifiedScenario[];
}

export const AWARD360_CERTIFICATION_REGISTRY: Readonly<Record<string, Award360LoaderCertification>> = {
  getAward360Header: {
    loaderName: 'getAward360Header',
    suiteId: 'main-loader-certification',
    scenarios: [
      { id: 'header-with-ssn-claim-and-version', description: 'Award has SSN, linked claim and product-version — five-hop chain.' },
      { id: 'header-without-ssn', description: 'Award without SSN short-circuits before ip_master.' },
      { id: 'header-without-claim', description: 'Award without claim skips bn_claim and bn_product_version.' },
      { id: 'header-with-claim-no-version', description: 'Claim carries no product_version_id — bn_product_version skipped.' },
    ],
  },
  getAwardPensioner: {
    loaderName: 'getAwardPensioner',
    suiteId: 'main-loader-certification',
    scenarios: [
      { id: 'pensioner-with-person', description: 'Award linked to ip_master with canonical contact fallbacks.' },
      { id: 'pensioner-award-without-ssn', description: 'Award has no SSN — ip_master query skipped.' },
      { id: 'pensioner-person-missing', description: 'ip_master row absent — loader returns null.' },
      { id: 'pensioner-award-query-error', description: 'bn_award lookup fails — loader throws.' },
      { id: 'pensioner-person-query-error', description: 'ip_master lookup fails — loader throws.' },
      { id: 'pensioner-deceased', description: 'Canonical status = DECEASED flagged.' },
      { id: 'pensioner-active-status', description: 'Active person is not flagged deceased.' },
      { id: 'pensioner-contact-fallbacks', description: 'Primary contact fields preferred over legacy fallbacks.' },
    ],
  },
  getAwardClaim: {
    loaderName: 'getAwardClaim',
    suiteId: 'main-loader-certification',
    scenarios: [
      { id: 'claim-linked', description: 'Award linked to a claim — bn_claim scoped by id.' },
      { id: 'claim-not-linked', description: 'Award without linked claim — bn_claim skipped.' },
      { id: 'claim-missing', description: 'bn_claim row absent — loader returns null.' },
    ],
  },
  getAwardProduct: {
    loaderName: 'getAwardProduct',
    suiteId: 'main-loader-certification',
    scenarios: [
      { id: 'product-with-version', description: 'Full chain: award → product → claim → product_version.' },
      { id: 'product-without-claim', description: 'No linked claim — bn_claim / bn_product_version skipped.' },
      { id: 'product-with-claim-no-version', description: 'Claim carries no product_version_id.' },
      { id: 'product-missing', description: 'Award has no product id — loader returns null.' },
    ],
  },
  listAwardCommunications: {
    loaderName: 'listAwardCommunications',
    suiteId: 'main-loader-certification',
    scenarios: [
      { id: 'comm-claim-and-context', description: 'Both claim_id and contains(context) queries issued.' },
      { id: 'comm-context-only', description: 'Award without claim — only the contains(context) query issued.' },
      { id: 'comm-empty', description: 'No rows — empty list returned.' },
      { id: 'comm-query-error', description: 'Table error is isolated via Promise.allSettled.' },
    ],
  },
  loadAwardAuditSources: {
    loaderName: 'loadAwardAuditSources',
    suiteId: 'main-loader-certification',
    scenarios: [
      { id: 'audit-without-central', description: 'includeCentralAudit=false — core_audit_log skipped, marked restricted.' },
      { id: 'audit-with-central', description: 'includeCentralAudit=true — composite entity_type=bn_award scope enforced.' },
      { id: 'audit-source-failure', description: 'Single source failure is isolated to that source only.' },
    ],
  },
  listAwardAudit: {
    loaderName: 'listAwardAudit',
    suiteId: 'main-loader-certification',
    scenarios: [
      { id: 'audit-flat-without-central', description: 'Compat wrapper reads the three award-scoped audit sources.' },
    ],
  },
  getAward360Summary: {
    loaderName: 'getAward360Summary',
    suiteId: 'main-loader-certification',
    scenarios: [
      { id: 'summary-all-restricted', description: 'No include flags — zero queries; every section reports restricted.' },
      { id: 'summary-all-includes', description: 'All flags on — every operational table queried with contract columns.' },
      { id: 'summary-medical-error', description: 'Medical source failure isolated to that section.' },
      { id: 'summary-communications-error', description: 'Communications source failure isolated to that section.' },
      { id: 'summary-pensioner-alert-restricted', description: 'canViewPerson360=false + canViewPaymentProfile=false skip ip_master / bn_payment_profile.' },
    ],
  },
  getAwardPensionerDeep: {
    loaderName: 'getAwardPensionerDeep',
    suiteId: 'main-loader-certification',
    scenarios: [
      { id: 'deep-full-access', description: 'Full permissions — every canonical table queried with correct scope.' },
      { id: 'deep-payment-profile-restricted', description: 'canViewPaymentProfile=false — profile / change-request skipped.' },
      { id: 'deep-person360-restricted', description: 'canViewPerson360=false — canonicalPersonId and person-360 route null.' },
      { id: 'deep-award-not-found', description: 'bn_award without SSN — loader returns null before ip_master.' },
      { id: 'deep-person-missing', description: 'ip_master row absent — PENSIONER_MISSING warning surfaced.' },
      { id: 'deep-payment-profile-error', description: 'Payment-profile failure isolated to partialWarnings.' },
      { id: 'deep-related-claims-error', description: 'Related-claims failure isolated to partialWarnings.' },
      { id: 'deep-pending-change-only', description: 'Pending change request without a live payment profile.' },
      { id: 'deep-person-query-error', description: 'Primary ip_master failure rejects — no optional-source substitution.' },
      { id: 'deep-dependants-error', description: 'ip_depend failure isolated — dependants empty, identity preserved.' },
      { id: 'deep-change-request-error', description: 'Change-request failure isolated — valid payment profile preserved.' },
      { id: 'deep-related-awards-error', description: 'Occurrence-scoped bn_award related-awards failure — primary lookup unaffected.' },
      { id: 'deep-related-awards-empty-success', description: 'Related-awards query returns [] cleanly — no partial warning.' },
      { id: 'deep-dependants-empty-success', description: 'ip_depend returns [] cleanly — no partial warning.' },
      { id: 'deep-change-request-empty-success', description: 'Change-request maybeSingle returns null cleanly — no partial warning.' },
    ],
  },
  getAwardClaimDeep: {
    loaderName: 'getAwardClaimDeep',
    suiteId: 'main-loader-certification',
    scenarios: [
      { id: 'claim-deep-full-access', description: 'Full permissions — every canonical Claim Deep table queried with correct scope.' },
      { id: 'claim-deep-unlinked-award', description: 'Award without bn_claim_id — Claim child queries skipped, loader returns null.' },
      { id: 'claim-deep-award-query-error', description: 'bn_award lookup fails — loader rejects.' },
      { id: 'claim-deep-claim-not-found', description: 'bn_claim maybeSingle returns null — CLAIM_NOT_FOUND view contract preserved.' },
      { id: 'claim-deep-claim-query-error', description: 'bn_claim lookup fails — loader rejects.' },
      { id: 'claim-deep-workflow-restricted', description: 'canViewWorkflow=false — queue, event, note queries skipped; timeline=[].' },
      { id: 'claim-deep-evidence-restricted', description: 'canViewEvidence=false — bn_claim_evidence / bn_doc_requirement skipped.' },
      { id: 'claim-deep-product-version-missing', description: 'Claim carries no product_version_id — bn_product_version skipped.' },
      { id: 'claim-deep-queue-empty', description: 'Empty queue assignment — workbasket/slaDueAt null; no partial warning.' },
      { id: 'claim-deep-evidence-empty', description: 'Empty evidence and requirement config — baselineUnknown=true.' },
      { id: 'claim-deep-document-baseline-empty', description: 'bn_doc_requirement returns [] — required/missing null; baselineUnknown=true.' },
      { id: 'claim-deep-eligibility-with-override', description: 'Eligibility override_applied=true — overrideActor/overrideReason mapped from row.' },
      { id: 'claim-deep-queue-error', description: 'bn_claim_queue_assignment failure — workbasket/slaDueAt null; unrelated sections survive.' },
      { id: 'claim-deep-product-version-error', description: 'bn_product_version failure — productVersionLabel null; productVersionId preserved.' },
      { id: 'claim-deep-eligibility-error', description: 'bn_claim_eligibility failure — override null; Calculation/Decision/Evidence survive.' },
      { id: 'claim-deep-calculation-error', description: 'bn_claim_calculation failure — Eligibility/Decision/Evidence/timeline survive; no fabricated mismatch.' },
      { id: 'claim-deep-evidence-error', description: 'bn_claim_evidence failure — evidence not represented as an empty list; requirements may still succeed.' },
      { id: 'claim-deep-requirements-error', description: 'bn_doc_requirement failure — evidence rows preserved; required/missing null; baselineUnknown=true.' },
      { id: 'claim-deep-decision-error', description: 'bn_claim_decision failure — MISSING_DECISION warning; other sections survive.' },
      { id: 'claim-deep-events-error', description: 'bn_claim_event failure — Notes remain in timeline; workflow unrestricted.' },
      { id: 'claim-deep-notes-error', description: 'bn_claim_note failure — Events remain in timeline; workflow unrestricted.' },
    ],
  },
  getAwardProductDeep: {
    loaderName: 'getAwardProductDeep',
    suiteId: 'product-deep-certification',
    scenarios: [
      { id: 'product-deep-award-without-product', description: 'Award without bn_product_id — loader returns null; no downstream queries.' },
      { id: 'product-deep-award-query-error', description: 'bn_award primary lookup fails — loader rejects; no downstream queries.' },
      { id: 'product-deep-product-not-found', description: 'bn_product row absent — MISSING_PRODUCT warning; loader returns null.' },
      { id: 'product-deep-product-query-error', description: 'bn_product primary lookup fails — loader rejects after bn_award succeeds.' },
      { id: 'product-deep-identity-mapping', description: 'Identity maps benefit_code / benefit_name (never legacy product_code); scheme_id/branch_id resolved to bn_scheme.scheme_name / bn_branch.branch_name (BUG-011).' },
      { id: 'product-deep-no-linked-claim', description: 'Award without bn_claim_id — skips bn_claim / bn_product_version; readiness NOT_APPLICABLE.' },
      { id: 'product-deep-claim-without-version', description: 'bn_claim carries no product_version_id — bn_product_version skipped; MISSING_VERSION.' },
      { id: 'product-deep-version-select-contract', description: 'bn_product_version .select() exactly equals the 19 readiness fields.' },
      { id: 'product-deep-configuration-restricted', description: 'canViewConfiguration=false — all 12 readiness rows RESTRICTED; no configuration source queried.' },
      { id: 'product-deep-full-ready', description: 'All primary and configuration sources present — every readiness row READY; version flags clean.' },
      { id: 'product-deep-version-product-mismatch', description: 'Version.product_id ≠ Award.bn_product_id — PRODUCT_VERSION_MISMATCH; product identity preserved.' },
      { id: 'product-deep-version-not-published', description: 'Version.status = DRAFT — VERSION_NOT_PUBLISHED warning.' },
      { id: 'product-deep-award-outside-effective-period', description: 'Award start outside version effective dates — OUTSIDE_EFFECTIVE warning.' },
      { id: 'product-deep-missing-configuration', description: 'Every configuration source empty — MISSING readiness + MISSING_* warnings; INCOMPLETE_COMM not emitted at zero.' },
      { id: 'product-deep-formula-partial', description: 'formula_template_id present with zero bindings — Formula PARTIAL, not MISSING.' },
      { id: 'product-deep-comm-partial', description: '1–2 active comm mappings — Communication PARTIAL + INCOMPLETE_COMM warning.' },
      { id: 'product-deep-claim-query-error', description: 'bn_claim optional failure — no bn_product_version query; MISSING_VERSION; product identity preserved.' },
      { id: 'product-deep-version-query-error', description: 'bn_product_version optional failure — no configuration source queried; MISSING_VERSION; claim query survives.' },
      { id: 'product-deep-formula-binding-error', description: 'Formula binding failure — Formula PARTIAL; neighbouring readiness rows unaffected.' },
      { id: 'product-deep-eligibility-error', description: 'Eligibility rule failure — Eligibility MISSING; scope, is_active, count=exact, head=true still proven.' },
      { id: 'product-deep-approval-policy-error', description: 'Approval policy failure — Approval MISSING; scope, is_enabled, count=exact, head=true still proven.' },
      { id: 'product-deep-comm-mapping-error', description: 'Communication mapping failure — Communication MISSING; INCOMPLETE_COMM not emitted; scope, active, count=exact, head=true still proven.' },
    ],
  },

  // ─── Stage D1 · operational-simple-certification suite ────────────────
  // AW360-WAVE-1-C1 Stage D1 — Matrix-driven certification of 16 simple
  // one-table operational loaders (Beneficiaries, Schedules, Payments,
  // Life Certificates, Medical Reviews, Overpayments). Scenarios are
  // executed by `operationalSimpleCertification.test.ts` through
  // `AwardQueryRecorder`. All 16 loaders share the same scenario shape:
  //   list-non-paged  → -populated, -empty, -error
  //   list-paged      → -populated, -empty, -error, -pagination
  //   detail          → -populated, -not-found, -error
  //   reminders alias → -populated, -no-claim
  listAwardBeneficiaries: {
    loaderName: 'listAwardBeneficiaries',
    suiteId: 'operational-simple-certification',
    scenarios: [
      { id: 'list-beneficiaries-populated', description: 'Returns mapped rows scoped by bn_award_id, ordered by start_date desc.' },
      { id: 'list-beneficiaries-empty', description: 'Returns [] cleanly when no rows exist.' },
      { id: 'list-beneficiaries-error', description: 'Database failure surfaces cleanly.' },
    ],
  },
  listAwardBeneficiariesPaged: {
    loaderName: 'listAwardBeneficiariesPaged',
    suiteId: 'operational-simple-certification',
    scenarios: [
      { id: 'list-beneficiaries-paged-populated', description: 'Paged summary + rows scoped by bn_award_id.' },
      { id: 'list-beneficiaries-paged-empty', description: 'Empty set — total=0, rows=[].' },
      { id: 'list-beneficiaries-paged-error', description: 'Supabase error rejects the loader.' },
      { id: 'list-beneficiaries-paged-pagination', description: 'page/pageSize/total honoured; JS-side slicing preserves order.' },
    ],
  },
  getAwardBeneficiaryDetail: {
    loaderName: 'getAwardBeneficiaryDetail',
    suiteId: 'operational-simple-certification',
    scenarios: [
      { id: 'beneficiary-detail-populated', description: 'Exact primary-key scope; row returned.' },
      { id: 'beneficiary-detail-not-found', description: 'maybeSingle returns null — row=null, no error.' },
      { id: 'beneficiary-detail-error', description: 'Database failure surfaces cleanly.' },
    ],
  },

  listAwardSchedules: {
    loaderName: 'listAwardSchedules',
    suiteId: 'operational-simple-certification',
    scenarios: [
      { id: 'list-schedules-populated', description: 'Rows mapped from bn_payment_schedule, scoped by bn_award_id.' },
      { id: 'list-schedules-empty', description: 'Returns [] cleanly.' },
      { id: 'list-schedules-error', description: 'Database failure tolerated (destructured data is undefined).' },
    ],
  },
  listAwardSchedulesPaged: {
    loaderName: 'listAwardSchedulesPaged',
    suiteId: 'operational-simple-certification',
    scenarios: [
      { id: 'list-schedules-paged-populated', description: 'Paged summary totals + rows scoped by bn_award_id.' },
      { id: 'list-schedules-paged-empty', description: 'Empty set — totals zero.' },
      { id: 'list-schedules-paged-error', description: 'Supabase error rejects the loader.' },
      { id: 'list-schedules-paged-pagination', description: 'page/pageSize/total honoured across JS-side pagination.' },
    ],
  },
  getAwardScheduleDetail: {
    loaderName: 'getAwardScheduleDetail',
    suiteId: 'operational-simple-certification',
    scenarios: [
      { id: 'schedule-detail-populated', description: 'Schedule row + linked payment instruction returned.' },
      { id: 'schedule-detail-not-found', description: 'maybeSingle returns null — row=null.' },
      { id: 'schedule-detail-error', description: 'Primary bn_payment_schedule failure surfaces.' },
    ],
  },

  listAwardPayments: {
    loaderName: 'listAwardPayments',
    suiteId: 'operational-simple-certification',
    scenarios: [
      { id: 'list-payments-populated', description: 'Rows scoped by award_id, ordered by due_date desc with range(0, limit-1).' },
      { id: 'list-payments-empty', description: 'Empty set returns [].' },
      { id: 'list-payments-error', description: 'Database failure tolerated (data undefined → []).' },
    ],
  },
  listAwardPaymentsPaged: {
    loaderName: 'listAwardPaymentsPaged',
    suiteId: 'operational-simple-certification',
    scenarios: [
      { id: 'list-payments-paged-populated', description: 'Paged rows scoped by award_id; status classification counted.' },
      { id: 'list-payments-paged-empty', description: 'Empty set — totals zero.' },
      { id: 'list-payments-paged-error', description: 'Supabase error rejects the loader.' },
      { id: 'list-payments-paged-pagination', description: 'page/pageSize/total metadata honoured.' },
    ],
  },

  listAwardLifeCertificates: {
    loaderName: 'listAwardLifeCertificates',
    suiteId: 'operational-simple-certification',
    scenarios: [
      { id: 'list-life-cert-populated', description: 'Rows scoped by bn_award_id, days-overdue computed for non-VERIFIED.' },
      { id: 'list-life-cert-empty', description: 'Empty set returns [].' },
      { id: 'list-life-cert-error', description: 'Database failure tolerated (data undefined → []).' },
    ],
  },
  listAwardLifeCertificatesPaged: {
    loaderName: 'listAwardLifeCertificatesPaged',
    suiteId: 'operational-simple-certification',
    scenarios: [
      { id: 'list-life-cert-paged-populated', description: 'Paged rows + reminder-count enrichment via bn_award → bn_communication_log.' },
      { id: 'list-life-cert-paged-empty', description: 'Empty set — totals zero.' },
      { id: 'list-life-cert-paged-error', description: 'Primary bn_life_certificate failure surfaces.' },
      { id: 'list-life-cert-paged-pagination', description: 'page/pageSize/total metadata honoured.' },
    ],
  },
  getAwardLifeCertificateReminders: {
    loaderName: 'getAwardLifeCertificateReminders',
    suiteId: 'operational-simple-certification',
    scenarios: [
      { id: 'life-cert-reminders-populated', description: 'Award has claim — reads bn_award, then bn_communication_log twice via listAwardCommunications.' },
      { id: 'life-cert-reminders-no-claim', description: 'Award has no claim — bn_award queried, only context comm-log query issued.' },
    ],
  },

  listAwardMedicalReviews: {
    loaderName: 'listAwardMedicalReviews',
    suiteId: 'operational-simple-certification',
    scenarios: [
      { id: 'list-medical-populated', description: 'Rows scoped by bn_award_id, ordered by scheduled_date desc.' },
      { id: 'list-medical-empty', description: 'Empty set returns [].' },
      { id: 'list-medical-error', description: 'Database failure tolerated (data undefined → []).' },
    ],
  },
  listAwardMedicalReviewsPaged: {
    loaderName: 'listAwardMedicalReviewsPaged',
    suiteId: 'operational-simple-certification',
    scenarios: [
      { id: 'list-medical-paged-populated', description: 'Paged rows scoped by bn_award_id + sensitive column suppression under canViewSensitive=false.' },
      { id: 'list-medical-paged-empty', description: 'Empty set — totals zero.' },
      { id: 'list-medical-paged-error', description: 'Supabase error rejects the loader.' },
      { id: 'list-medical-paged-pagination', description: 'page/pageSize/total metadata honoured.' },
    ],
  },
  getAwardMedicalReviewDetail: {
    loaderName: 'getAwardMedicalReviewDetail',
    suiteId: 'operational-simple-certification',
    scenarios: [
      { id: 'medical-detail-populated', description: 'Exact primary-key scope; row returned with sensitive columns masked when canViewSensitive=false.' },
      { id: 'medical-detail-not-found', description: 'maybeSingle returns null — row=null.' },
      { id: 'medical-detail-error', description: 'Loader captures the error into warnings and returns null.' },
    ],
  },

  listAwardOverpayments: {
    loaderName: 'listAwardOverpayments',
    suiteId: 'operational-simple-certification',
    scenarios: [
      { id: 'list-overpayments-populated', description: 'Rows scoped by bn_award_id, ordered by detected_date desc.' },
      { id: 'list-overpayments-empty', description: 'Empty set returns [].' },
      { id: 'list-overpayments-error', description: 'Database failure tolerated (data undefined → []).' },
    ],
  },
  listAwardOverpaymentsPaged: {
    loaderName: 'listAwardOverpaymentsPaged',
    suiteId: 'operational-simple-certification',
    scenarios: [
      { id: 'list-overpayments-paged-populated', description: 'Paged rows + summary totals scoped by bn_award_id.' },
      { id: 'list-overpayments-paged-empty', description: 'Empty set — totals zero.' },
      { id: 'list-overpayments-paged-error', description: 'Supabase error rejects the loader.' },
      { id: 'list-overpayments-paged-pagination', description: 'page/pageSize/total metadata honoured.' },
    ],
  },

  // ─── Stage D2 · operational-complex-certification suite ───────────────
  // AW360-WAVE-1-C1 Stage D2 — Final multi-table and aggregate loader
  // certification executed by `operationalComplexCertification.test.ts`.
  // Each loader uses a minimum meaningful scenario set: happy path,
  // empty/not-found path, one representative failure, and one
  // permission/pagination/branch path where applicable.
  getAward360OverviewCounts: {
    loaderName: 'getAward360OverviewCounts',
    suiteId: 'operational-complex-certification',
    scenarios: [
      { id: 'overview-counts-full', description: 'All operational sources enabled — every count table queried with contract columns and scope.' },
      { id: 'overview-counts-all-disabled', description: 'Every include flag false — no queries issued; every section returns [].' },
      { id: 'overview-counts-one-source-error', description: 'One operational source fails — its section is empty; other counts survive.' },
      { id: 'overview-counts-communications-context-scope', description: 'Award without linked claim — communications count uses contains(context) only.' },
    ],
  },
  listAwardSuspensions: {
    loaderName: 'listAwardSuspensions',
    suiteId: 'operational-complex-certification',
    scenarios: [
      { id: 'suspensions-with-workflow-tasks', description: 'Suspension events with workflow_instance_id — core_workflow_task queried by workflow_instance_id.' },
      { id: 'suspensions-without-workflow-instance', description: 'No workflow_instance_id on any row — no core_workflow_task query issued.' },
      { id: 'suspensions-workflow-source-error', description: 'core_workflow_task failure — loader rejects (production contract).' },
      { id: 'suspensions-base-source-error', description: 'bn_award_suspension_event failure — loader rejects.' },
    ],
  },
  getAwardOverpaymentDetail: {
    loaderName: 'getAwardOverpaymentDetail',
    suiteId: 'operational-complex-certification',
    scenarios: [
      { id: 'overpayment-detail-with-schedules', description: 'Overpayment row + related schedule rows scoped by bn_award_id, deductions > 0.' },
      { id: 'overpayment-detail-without-schedules', description: 'Overpayment row + empty schedule list — no partial warning.' },
      { id: 'overpayment-detail-schedule-error', description: 'Schedule enrichment failure — warning surfaced; primary overpayment row preserved.' },
      { id: 'overpayment-detail-not-found', description: 'Overpayment maybeSingle returns null — row=null; no schedule query issued.' },
    ],
  },
  listAwardCommunicationsPaged: {
    loaderName: 'listAwardCommunicationsPaged',
    suiteId: 'operational-complex-certification',
    scenarios: [
      { id: 'communications-paged-claim-and-context', description: 'Both eq(claim_id) and contains(context) branches issued; results deduplicated by id.' },
      { id: 'communications-paged-context-only', description: 'Award without linked claim — only contains(context) branch issued.' },
      { id: 'communications-paged-pagination-and-deduplication', description: 'Overlapping rows across branches deduplicated; page/pageSize/total honoured.' },
      { id: 'communications-paged-one-branch-error', description: 'One communications branch fails — warning surfaced; other branch rows preserved.' },
    ],
  },
  getAwardCommunicationDetail: {
    loaderName: 'getAwardCommunicationDetail',
    suiteId: 'operational-complex-certification',
    scenarios: [
      { id: 'communication-detail-with-letter', description: 'Communication row with letter_id — bn_letter queried by eq(id).' },
      { id: 'communication-detail-without-letter', description: 'Communication row without letter_id — no bn_letter query issued.' },
      { id: 'communication-detail-letter-error', description: 'bn_letter failure — communication row preserved; warning surfaced.' },
      { id: 'communication-detail-not-found', description: 'Communication maybeSingle returns null — row=null; no letter query.' },
    ],
  },
  listAwardAuditPaged: {
    loaderName: 'listAwardAuditPaged',
    suiteId: 'operational-complex-certification',
    scenarios: [
      { id: 'audit-paged-all-sources', description: 'includeCentralAudit=true — status/rate/suspension/central all queried with canonical scope.' },
      { id: 'audit-paged-without-central', description: 'includeCentralAudit=false — no core_audit_log query issued.' },
      { id: 'audit-paged-one-source-error', description: 'One audit source failure — warning surfaced; other sources still contribute rows.' },
      { id: 'audit-paged-date-and-page-boundary', description: 'Date range + non-default page honoured against merged result.' },
    ],
  },
};

export function certificationScenariosFor(loaderName: string): readonly string[] {
  const entry = AWARD360_CERTIFICATION_REGISTRY[loaderName];
  return entry ? entry.scenarios.map((s) => s.id) : [];
}

export function isCertifiedLoader(loaderName: string): boolean {
  return Object.prototype.hasOwnProperty.call(AWARD360_CERTIFICATION_REGISTRY, loaderName);
}

export function certifiedLoaderNames(): readonly string[] {
  return Object.keys(AWARD360_CERTIFICATION_REGISTRY);
}

/** B2-c.2 — Certified loaders owned by a particular certification suite. */
export function certifiedLoadersForSuite(
  suiteId: Award360CertificationSuiteId,
): readonly string[] {
  return Object.entries(AWARD360_CERTIFICATION_REGISTRY)
    .filter(([, cert]) => cert.suiteId === suiteId)
    .map(([name]) => name)
    .sort();
}

