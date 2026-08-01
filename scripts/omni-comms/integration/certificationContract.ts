/**
 * Build 4A certification contract — the single source of truth shared by the
 * privileged harness, the independent result asserter and the mechanism tests.
 *
 * This file contains NO product logic. It only describes what the certification
 * mechanism must measure and what an acceptable certification result looks like.
 */

export const RESULT_SCHEMA = 'omni_comms.build4a.certification.result';
export const RESULT_VERSION = 2;

/**
 * Scope-correct verdict. This workflow proves bootstrap authorization and
 * atomicity ONLY. The broader "BUILD 4A VERIFIED" verdict additionally requires
 * a separate controlled Employer Registration shadow test.
 */
export const SUCCESS_VERDICT = 'BUILD 4A BOOTSTRAP AUTHORIZATION AND ATOMICITY VERIFIED';
export const INCOMPLETE_VERDICT = 'BUILD 4A IMPLEMENTED — PRIVILEGED CERTIFICATION INCOMPLETE';

export const AUTHORIZATION_MARKER = 'OMNI COMMS BUILD 4A AUTHORIZATION INTEGRATION OK';
export const ATOMICITY_MARKER = 'OMNI COMMS BUILD 4A ATOMICITY INTEGRATION OK';

/** Every scenario that must appear exactly once in the structured result. */
export const REQUIRED_SCENARIOS = [
  'authorized_caller_success',
  'missing_capability_denied',
  'foreign_tenant_denied',
  'unknown_organization_denied',
  'unauthenticated_denied',
  'private_bootstrap_denied',
  'prerequisite_failure_no_mutation',
  'late_stage_rollback_restores_baseline',
  'retry_after_rollback_single_result',
  'replay_after_success_is_deterministic',
  'concurrent_equivalent_requests',
] as const;

export type RequiredScenario = (typeof REQUIRED_SCENARIOS)[number];

export interface DenialExpectation {
  /** Exact HTTP status the boundary must return. */
  status: number;
  /** Exact bounded error slug that must appear in the response body. */
  code: string;
}

/**
 * Exact denial matrix. A generic "any status >= 400 is a denial" rule is
 * forbidden: an unrelated 500, connection error, missing RPC, invalid overload,
 * expired token or unrelated denial must fail certification.
 *
 * NOTE FOR OPERATORS: these are the contractual expectations. The certification
 * fails — rather than silently passing — when the deployed boundary returns a
 * different status or slug.
 */
export const DENIAL_MATRIX: Record<string, DenialExpectation> = {
  missing_capability_denied: { status: 403, code: 'permission_denied' },
  foreign_tenant_denied: { status: 403, code: 'organization_access_denied' },
  unknown_organization_denied: { status: 404, code: 'organization_not_found' },
  unauthenticated_denied: { status: 401, code: 'authentication_required' },
  private_bootstrap_denied: { status: 403, code: 'permission_denied' },
  prerequisite_failure_no_mutation: {
    status: 412,
    code: 'pilot_bootstrap_sender_identity_missing',
  },
  late_stage_rollback_restores_baseline: {
    status: 500,
    code: 'certification_late_stage_fault',
  },
};

/** Scenario names that must carry a measured status + bounded code. */
export const NEGATIVE_SCENARIOS = Object.keys(DENIAL_MATRIX);

/** Side-effect counters that must be exactly zero. */
export const ZERO_SIDE_EFFECTS = [
  'runnable_dispatch_jobs',
  'dispatch_jobs',
  'delivery_attempts',
  'provider_sdk_imports',
  'emails',
  'webhook_events',
  'messages',
  'message_events',
  'unintended_requests',
] as const;

/**
 * No independent outbound network/provider audit source exists for Build 4A, so
 * an outbound provider-call count must never be fabricated from delivery
 * attempts. This sentinel is the only permitted value.
 */
export const OUTBOUND_PROVIDER_CALLS_SENTINEL = 'not_applicable_provider_surface_absent';

/** Preflight-cleanup fields that must all be numeric in the result. */
export const PREFLIGHT_FIELDS = [
  'stale_fault_triggers',
  'stale_fault_functions',
  'stale_staff_assignments',
  'stale_role_grants',
  'stale_department_fixtures',
  'incomplete_bootstrap_fixtures',
  'namespaced_test_records',
] as const;

/** Bounded deployed-runtime posture required before any scenario runs. */
export const REQUIRED_HEALTH_POSTURE = {
  available: true,
  revisionVerified: true,
  environment: 'non_production',
  certificationState: 'pending',
  certifiedCommit: null,
  revisionMatch: 'unknown',
  safeTestPermitted: false,
  liveDeliveryEnabled: false,
} as const;

/**
 * Canonical column contract. Every column the certification SQL touches is
 * declared here and checked against the repository's generated Supabase types
 * by the schema-contract test. `core_staff_assignments` has NO organization_id:
 * tenancy is reached through department_id → core_department.organization_id.
 */
export const CERTIFICATION_COLUMN_CONTRACT: Record<string, string[]> = {
  core_organization: ['id', 'org_code', 'status'],
  core_department: ['id', 'organization_id', 'code', 'name', 'is_active'],
  core_staff_profiles: ['id', 'user_id', 'is_active'],
  core_staff_assignments: [
    'id',
    'staff_profile_id',
    'user_id',
    'department_id',
    'assignment_type',
    'assignment_status',
    'effective_from',
    'effective_to',
    'is_primary',
    'is_active',
  ],
  user_roles: ['id', 'user_id', 'role'],
  roles: ['id', 'role_name'],
  role_permissions: ['id', 'role_id', 'module_id', 'action_id', 'is_granted'],
  app_modules: ['id', 'name', 'is_enabled'],
  module_actions: ['id', 'module_id', 'action_name', 'is_enabled'],
  omni_comms_event_definition: ['id', 'code', 'module_code', 'status'],
  omni_comms_event_route: ['id', 'organization_id', 'template_family_id'],
  omni_comms_template_family: ['id', 'code', 'organization_id'],
  omni_comms_template_version: ['id', 'template_family_id'],
  omni_comms_sender_identity: [
    'id',
    'organization_id',
    'code',
    'display_name',
    'channel',
    'from_address',
    'status',
  ],
  omni_comms_producer_event_binding: [
    'id',
    'organization_id',
    'department_id',
    'caller_module_code',
    'event_definition_id',
    'status',
  ],
  omni_comms_request: ['id', 'organization_id', 'mode'],
  omni_comms_message: ['id', 'organization_id'],
  omni_comms_message_event: ['id', 'organization_id'],
  omni_comms_dispatch_job: ['id', 'organization_id', 'is_runnable'],
  omni_comms_delivery_attempt: ['id', 'organization_id', 'dispatch_job_id', 'status'],
  omni_comms_caller_module_registry: ['module_code', 'is_active'],
};

/** Column references that must never appear anywhere in certification SQL. */
export const FORBIDDEN_COLUMN_REFERENCES = [
  'core_staff_assignments.organization_id',
  'tv.family_id',
  'omni_comms_event_definition.event_code',
] as const;
