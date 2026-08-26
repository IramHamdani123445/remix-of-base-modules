/**
 * VENDORED — do not edit by hand.
 *
 * Deno-deployable copy of the portable BN gap command pipeline. Supabase Edge
 * Functions cannot import from `src/`, so the transport-neutral modules below
 * are inlined here verbatim (imports between them stripped):
 *
 *   src/types/bn/commands/commandEnvelope.ts
 *   src/types/bn/commands/commandResult.ts
 *   src/types/bn/commands/moduleCodes.ts
 *   src/services/bn/commands/benefitsCapabilityRegistry.ts
 *   src/services/bn/commands/benefitsCommandPipeline.ts
 *   src/services/bn/commands/pingCommand.ts
 *
 * Regenerate with scripts/bn/vendor-gap-command-shared.py after changing any
 * of those files.
 */

// ─── vendored from src/types/bn/commands/commandEnvelope.ts ───
/**
 * BN Gap Modules — Portable Command Envelope
 *
 * Every state-changing gap-module command MUST arrive at the server-side
 * command boundary wearing this envelope. It is designed to map cleanly onto
 * either a Supabase Edge Function invocation *today* or an ASP.NET Core
 * Web API `POST /commands/{commandName}` *tomorrow* — without React screens
 * or hooks changing.
 *
 * See docs/bn/contracts/command-envelope.md for the field contract.
 */

/** Canonical gap-module codes registered in app_modules. */
export type BnGapModuleCode =
  | 'bn_mortality'
  | 'bn_overpayments'
  | 'bn_appeals'
  | 'bn_means_tests'
  | 'bn_risk_management'
  | 'bn_uprating';

/**
 * Envelope carried by every command request. All properties are transport-
 * neutral and safe to serialise as JSON over HTTP.
 */
export interface BnGapCommandEnvelope<TPayload = unknown> {
  /** Stable command name, e.g. "BN_GAP_PING". SCREAMING_SNAKE_CASE. */
  readonly commandName: string;
  /** Semver-major command contract version. */
  readonly commandVersion: number;
  /** Client-generated UUID; replaying with the same key returns the prior result. */
  readonly idempotencyKey: string;
  /** UUID for cross-service tracing; propagates into logs and audit rows. */
  readonly correlationId: string;
  /** Optional UUID of the command/event that caused this command. */
  readonly causationId?: string;
  /** Owning module registration name (must match app_modules.name). */
  readonly moduleCode: BnGapModuleCode;
  /** Domain entity type ("bn_overpayment", "bn_appeal", ...). Free-form but stable. */
  readonly entityType: string;
  /** Entity UUID when acting on an existing row; null for creation commands. */
  readonly entityId: string | null;
  /** Authenticated principal — server MUST re-validate; never trust the wire. */
  readonly actorUserId: string;
  /** BN audit user_code (`requireUserCode`). Never "SYSTEM". */
  readonly actorUserCode: string;
  /** Roles asserted by the caller; server treats as a HINT only. */
  readonly actorRoles: readonly string[];
  /** Stable business reason code (e.g. "APPEAL_UPHELD"). */
  readonly reasonCode?: string;
  /** Free-text justification (audited). */
  readonly justification?: string;
  /**
   * Optimistic-concurrency token from the row the caller believes it is
   * mutating. Compared against the current row_version at execution time.
   * PostgreSQL: bigint; SQL Server: rowversion (base64 string). Kept as
   * string for portability.
   */
  readonly expectedRowVersion?: string;
  /** UTC ISO-8601 timestamp of client-side request creation. */
  readonly requestedAtUtc: string;
  /** Command-specific payload; typed per command handler. */
  readonly payload: TPayload;
}

// ─── vendored from src/types/bn/commands/commandResult.ts ───
/**
 * BN Gap Modules — Portable Command Result
 *
 * Uniform envelope for every server-authorised command outcome. Never leaks
 * server internals: `businessErrors` and `validationErrors` are safe to
 * surface to end users; raw SQL / stack traces are never included.
 *
 * See docs/bn/contracts/error-codes.md for the code catalogue.
 */

export type BnGapCommandStatus =
  /** Handler ran, state persisted, audit written. */
  | 'EXECUTED'
  /** Idempotency replay — this is the previously-stored result. */
  | 'REPLAYED'
  /** Blocked by capability/permission/rollout/module-registration. */
  | 'DENIED'
  /** Handler ran, business rules refused the transition. */
  | 'REJECTED'
  /** Optimistic concurrency conflict — client must reload the entity. */
  | 'CONFLICT'
  /** Envelope or payload failed structural validation. */
  | 'INVALID'
  /** Handler crashed; transaction rolled back. */
  | 'FAILED';

/** Stable error-code shape carried by every non-EXECUTED outcome. */
export interface BnGapCommandError {
  /** Machine-stable code (see error-codes.md). */
  readonly code: string;
  /** Human-readable, end-user-safe message. */
  readonly message: string;
  /** Optional dotted path locating the offending field within payload. */
  readonly field?: string;
}

export interface BnGapCommandWarning {
  readonly code: string;
  readonly message: string;
}

export interface BnGapCommandResult<TData = Record<string, unknown>> {
  readonly success: boolean;
  /** Server-assigned UUID for this execution. */
  readonly commandId: string;
  /** Echoed back from the envelope. */
  readonly correlationId: string;
  /** UUID of the affected entity (post-execute). */
  readonly entityId: string | null;
  /**
   * Row-version *after* the command. Present on EXECUTED / REPLAYED /
   * REJECTED-with-persisted-side-effects. Portable string.
   */
  readonly entityVersion: string | null;
  readonly status: BnGapCommandStatus;
  readonly warnings: readonly BnGapCommandWarning[];
  readonly validationErrors: readonly BnGapCommandError[];
  readonly businessErrors: readonly BnGapCommandError[];
  /** UUID of the row written to system_audit_trail (or equivalent). */
  readonly auditEventId: string | null;
  /**
   * Handler-shaped data. Omitted for DENIED/INVALID/FAILED. Always JSON-safe.
   */
  readonly data: TData | null;
}

// ─── vendored from src/types/bn/commands/moduleCodes.ts ───
/**
 * BN Gap Modules — Canonical module code catalogue.
 *
 * These are the six enterprise capability modules being prepared by the
 * Programme Foundation. Each is registered in `app_modules` under exactly
 * this `name`. The list is closed — adding a module requires an additive
 * migration AND an update here.
 */

export const BN_GAP_MODULES: readonly {
  readonly code: BnGapModuleCode;
  readonly displayName: string;
  readonly description: string;
  readonly baseRoute: string;
}[] = [
  {
    code: 'bn_mortality',
    displayName: 'Death & Mortality Processing',
    description: 'Death notifications, verification, award closure, survivor referral.',
    baseRoute: '/bn/mortality',
  },
  {
    code: 'bn_overpayments',
    displayName: 'Overpayment Recovery',
    description: 'Detection, calculation, notification, arrangement, ledger recovery.',
    baseRoute: '/bn/overpayments',
  },
  {
    code: 'bn_appeals',
    displayName: 'Appeals & Disputes',
    description: 'Appeal intake, panel scheduling, hearing outcome, remedy execution.',
    baseRoute: '/bn/appeals',
  },
  {
    code: 'bn_means_tests',
    displayName: 'Means-Test Assessment',
    description: 'Household composition, income evidence, eligibility scoring, review.',
    baseRoute: '/bn/means-tests',
  },
  {
    code: 'bn_risk_management',
    displayName: 'Fraud, Error & Risk',
    description: 'Risk indicators, investigation, referral to Legal, remedial actions.',
    baseRoute: '/bn/risk',
  },
  {
    code: 'bn_uprating',
    displayName: 'Uprating & Indexation',
    description: 'Rate table uplifts, effective-date scheduling, batch re-award.',
    baseRoute: '/bn/uprating',
  },
] as const;

export const BN_GAP_MODULE_CODES: readonly BnGapModuleCode[] =
  BN_GAP_MODULES.map((m) => m.code);

export function isBnGapModuleCode(x: unknown): x is BnGapModuleCode {
  return typeof x === 'string' && (BN_GAP_MODULE_CODES as readonly string[]).includes(x);
}

// ─── vendored from src/services/bn/commands/benefitsCapabilityRegistry.ts ───
/**
 * BN Gap Modules — Granular capability registry.
 *
 * `benefits_management` is TOO COARSE for the gap modules. Each module owns
 * its own verbs. Server-side command authorisation walks this map to derive
 * the required capability from `commandName`; the caller's roles are checked
 * against `role_permissions` (existing platform tables).
 *
 * The capability type is intentionally open (`${module}:${string}`) so that
 * modules can define granular verbs beyond the base four (read/write/decide/
 * admin) — e.g. `bn_appeals:claimant_submit`, `bn_uprating:admin`.
 */

/** Fully-qualified capability id: `{module}:{verb}`. */
export type BnGapCapability = `${BnGapModuleCode}:${string}`;

/** Base four verbs available for every module. Modules may add more. */
export type BnGapCapabilityBaseVerb = 'read' | 'write' | 'decide' | 'admin';

export const BN_GAP_BASE_CAPABILITIES: readonly BnGapCapability[] = [
  'bn_mortality:read', 'bn_mortality:write', 'bn_mortality:decide', 'bn_mortality:admin',
  'bn_overpayments:read', 'bn_overpayments:write', 'bn_overpayments:decide', 'bn_overpayments:admin',
  'bn_appeals:read', 'bn_appeals:write', 'bn_appeals:decide', 'bn_appeals:admin',
  'bn_means_tests:read', 'bn_means_tests:write', 'bn_means_tests:decide', 'bn_means_tests:admin',
  'bn_risk_management:read', 'bn_risk_management:write', 'bn_risk_management:decide', 'bn_risk_management:admin',
  'bn_uprating:read', 'bn_uprating:write', 'bn_uprating:decide', 'bn_uprating:admin',
] as const;

/** Module-specific extended verbs (appended to the base four). */
export const BN_GAP_EXTENDED_CAPABILITIES: readonly BnGapCapability[] = [
  // Appeals
  'bn_appeals:claimant_submit',
  'bn_appeals:admissibility_review',
  'bn_appeals:assign',
  'bn_appeals:recommend',
  'bn_appeals:implement',
  'bn_appeals:refer_legal',
  // Means-Test
  'bn_means_tests:verify',
  'bn_means_tests:adjust_request',
  'bn_means_tests:adjust_approve',
  'bn_means_tests:approve',
  'bn_means_tests:reassess',
  'bn_means_tests:config',
  // Mortality
  'bn_mortality:verify',
  'bn_mortality:approve_impact',
  'bn_mortality:reverse',
  // Risk Management (Fraud/Error/Risk)
  'bn_risk_management:approve_control',
  'bn_risk_management:refer',
  'bn_risk_management:rule_admin',
] as const;

export const BN_GAP_CAPABILITIES: readonly BnGapCapability[] = [
  ...BN_GAP_BASE_CAPABILITIES,
  ...BN_GAP_EXTENDED_CAPABILITIES,
] as const;

// ── Command → Capability map ───────────────────────────────────────────
// Every registered command MUST appear here or the pipeline denies with
// `CAPABILITY_UNMAPPED` (fail-closed). This map is the single source of
// truth used by both the pipeline and by contract tests to prove that the
// six modules stay in lock-step with their capability grants.

export const BN_GAP_COMMAND_CAPABILITY: Readonly<Record<string, BnGapCapability>> = {
  // Programme foundation
  BN_GAP_PING: 'bn_mortality:read',

  // Appeals (v1)
  BN_APPEAL_SUBMIT_CLAIMANT:       'bn_appeals:claimant_submit',
  BN_APPEAL_REGISTER_RECEIVED_APPEAL: 'bn_appeals:write',
  // Deprecated alias — historical rows in module_actions / command logs
  // still resolve; UI must never surface this name.
  BN_APPEAL_REGISTER_STAFF:        'bn_appeals:write',
  BN_APPEAL_ACKNOWLEDGE:           'bn_appeals:write',
  BN_APPEAL_REVIEW_ADMISSIBILITY:  'bn_appeals:admissibility_review',
  BN_APPEAL_ASSIGN:                'bn_appeals:assign',
  BN_APPEAL_ATTACH_EVIDENCE:       'bn_appeals:write',
  BN_APPEAL_SCHEDULE_HEARING:      'bn_appeals:write',
  BN_APPEAL_RECORD_HEARING_OUTCOME:'bn_appeals:write',
  BN_APPEAL_RECOMMEND_OUTCOME:     'bn_appeals:recommend',
  BN_APPEAL_DECIDE:                'bn_appeals:decide',
  BN_APPEAL_IMPLEMENT:             'bn_appeals:implement',
  BN_APPEAL_WITHDRAW:              'bn_appeals:claimant_submit',
  BN_APPEAL_REFER_LEGAL:           'bn_appeals:refer_legal',
  BN_APPEAL_CLOSE:                 'bn_appeals:decide',
  BN_APPEAL_REOPEN:                'bn_appeals:admin',

  // Mortality — legacy names (kept for compatibility with earlier prototype)
  BN_MORTALITY_REPORT:                   'bn_mortality:write',
  BN_MORTALITY_REQUEST_VERIFICATION:     'bn_mortality:write',
  BN_MORTALITY_VERIFY:                   'bn_mortality:decide',
  BN_MORTALITY_DISPUTE:                  'bn_mortality:write',
  BN_MORTALITY_REJECT:                   'bn_mortality:decide',
  BN_MORTALITY_HOLD_AWARDS:              'bn_mortality:decide',
  BN_MORTALITY_TERMINATE_AWARDS:         'bn_mortality:decide',
  BN_MORTALITY_RAISE_PAD_OVERPAYMENT:    'bn_mortality:decide',
  BN_MORTALITY_OPEN_SURVIVOR_ASSESSMENT: 'bn_mortality:write',
  BN_MORTALITY_OPEN_FUNERAL_OPPORTUNITY: 'bn_mortality:write',
  BN_MORTALITY_RAISE_ESTATE_REFERRAL:    'bn_mortality:decide',
  BN_MORTALITY_CLOSE:                    'bn_mortality:decide',

  // Mortality — canonical 15-command lifecycle (Slice 1)
  BN_MORTALITY_REGISTER_REPORT:              'bn_mortality:write',
  BN_MORTALITY_ATTACH_EVIDENCE:              'bn_mortality:write',
  BN_MORTALITY_SUBMIT_FOR_VERIFICATION:      'bn_mortality:write',
  BN_MORTALITY_PLACE_PROVISIONAL_HOLD:       'bn_mortality:decide',
  BN_MORTALITY_CONFIRM_VERIFICATION:         'bn_mortality:verify',
  BN_MORTALITY_REJECT_REPORT:                'bn_mortality:decide',
  BN_MORTALITY_RECORD_CONFLICT:              'bn_mortality:write',
  BN_MORTALITY_APPROVE_IMPACT:               'bn_mortality:approve_impact',
  BN_MORTALITY_TERMINATE_AWARD:              'bn_mortality:decide',
  BN_MORTALITY_CREATE_PAD_OVERPAYMENT:       'bn_mortality:decide',
  BN_MORTALITY_INITIATE_SURVIVOR_ASSESSMENT: 'bn_mortality:write',
  BN_MORTALITY_INITIATE_FUNERAL_GRANT:       'bn_mortality:write',
  BN_MORTALITY_REFER_LEGAL:                  'bn_mortality:decide',
  BN_MORTALITY_REVERSE_CONFIRMATION:         'bn_mortality:reverse',
  BN_MORTALITY_CLOSE_EVENT:                  'bn_mortality:decide',

  // Mortality — additive canonical commands (Slice 2A)
  BN_MORTALITY_DRAFT_SAVE:                   'bn_mortality:write',
  BN_MORTALITY_CANCEL:                       'bn_mortality:write',
  BN_MORTALITY_MATCH_PERSON:                 'bn_mortality:write',
  BN_MORTALITY_MARK_DUPLICATE:               'bn_mortality:write',
  BN_MORTALITY_ASSIGN:                       'bn_mortality:write',
  BN_MORTALITY_RELEASE_HOLD:                 'bn_mortality:decide',
  BN_MORTALITY_RESOLVE_CONFLICT:             'bn_mortality:decide',
  BN_MORTALITY_PREPARE_IMPACT:               'bn_mortality:write',
  BN_MORTALITY_SUBMIT_IMPACT:                'bn_mortality:write',
  BN_MORTALITY_RETURN_IMPACT:                'bn_mortality:decide',
  BN_MORTALITY_COMPLETE_FOLLOWON:            'bn_mortality:decide',

  // Overpayments — legacy names (kept for compatibility)
  BN_OVP_ASSESS:                'bn_overpayments:write',
  BN_OVP_NOTIFY:                'bn_overpayments:decide',
  BN_OVP_DISPUTE_OPEN:          'bn_overpayments:write',
  BN_OVP_RECALCULATE:           'bn_overpayments:decide',
  BN_OVP_PROPOSE_ARRANGEMENT:   'bn_overpayments:write',
  BN_OVP_ACTIVATE_ARRANGEMENT:  'bn_overpayments:decide',
  BN_OVP_RECORD_INSTALMENT:     'bn_overpayments:write',
  BN_OVP_MARK_BREACHED:         'bn_overpayments:write',
  BN_OVP_WRITE_OFF:             'bn_overpayments:admin',
  BN_OVP_REFER_LEGAL:           'bn_overpayments:decide',
  BN_OVP_CLOSE:                 'bn_overpayments:decide',

  // Overpayments — canonical 25-command lifecycle (Slice 1)
  BN_OVP_CREATE_CANDIDATE:           'bn_overpayments:write',
  BN_OVP_CALCULATE_LIABILITY:        'bn_overpayments:write',
  BN_OVP_VERIFY:                     'bn_overpayments:decide',
  BN_OVP_ISSUE_NOTICE:               'bn_overpayments:decide',
  BN_OVP_RECORD_REPRESENTATION:      'bn_overpayments:write',
  BN_OVP_CONFIRM_LIABILITY:          'bn_overpayments:decide',
  BN_OVP_PROPOSE_RECOVERY_PLAN:      'bn_overpayments:write',
  BN_OVP_APPROVE_RECOVERY_PLAN:      'bn_overpayments:decide',
  BN_OVP_REJECT_RECOVERY_PLAN:       'bn_overpayments:decide',
  BN_OVP_REVISE_RECOVERY_PLAN:       'bn_overpayments:write',
  BN_OVP_ACTIVATE_BENEFIT_DEDUCTION: 'bn_overpayments:decide',
  BN_OVP_RECORD_RECEIPT:             'bn_overpayments:write',
  BN_OVP_ALLOCATE_RECEIPT:           'bn_overpayments:write',
  BN_OVP_REQUEST_WAIVER:             'bn_overpayments:write',
  BN_OVP_APPROVE_WAIVER:             'bn_overpayments:admin',
  BN_OVP_REJECT_WAIVER:              'bn_overpayments:admin',
  BN_OVP_REQUEST_WRITEOFF:           'bn_overpayments:write',
  BN_OVP_APPROVE_WRITEOFF:           'bn_overpayments:admin',
  BN_OVP_REJECT_WRITEOFF:            'bn_overpayments:admin',
  BN_OVP_REFER_ESTATE:               'bn_overpayments:decide',
  BN_OVP_REVERSE_TRANSACTION:        'bn_overpayments:admin',
  BN_OVP_RECONCILE:                  'bn_overpayments:decide',
  BN_OVP_REOPEN:                     'bn_overpayments:admin',
  BN_OVP_PLACE_APPEAL_HOLD:          'bn_overpayments:decide',
  BN_OVP_RELEASE_APPEAL_HOLD:        'bn_overpayments:decide',
  BN_OVP_SUSPEND_RECOVERY:           'bn_overpayments:decide',
  BN_OVP_RESUME_RECOVERY:            'bn_overpayments:decide',

  // Means Tests — legacy 11 (kept)
  BN_MT_START:                     'bn_means_tests:write',
  BN_MT_ATTACH_EVIDENCE:           'bn_means_tests:write',
  BN_MT_ASSESS:                    'bn_means_tests:decide',
  BN_MT_PASS:                      'bn_means_tests:decide',
  BN_MT_FAIL:                      'bn_means_tests:decide',
  BN_MT_LINK_APPEAL:               'bn_means_tests:write',
  BN_MT_APPLY_APPEAL_OVERTURN:     'bn_means_tests:decide',
  BN_MT_ADD_LATE_EVIDENCE:         'bn_means_tests:write',
  BN_MT_RERUN_ELIGIBILITY:         'bn_means_tests:decide',
  BN_MT_CREATE_AWARD_FROM_RERUN:   'bn_means_tests:decide',
  BN_MT_CLOSE:                     'bn_means_tests:decide',

  // Means-Test Assessment — canonical 18-command lifecycle (Slice 1)
  BN_MEANS_CREATE_ASSESSMENT:              'bn_means_tests:write',
  BN_MEANS_ADD_HOUSEHOLD_MEMBER:           'bn_means_tests:write',
  BN_MEANS_UPDATE_HOUSEHOLD_MEMBER:        'bn_means_tests:write',
  BN_MEANS_REMOVE_HOUSEHOLD_MEMBER:        'bn_means_tests:write',
  BN_MEANS_CORRECT_CONTEXT:                'bn_means_tests:write',
  BN_MEANS_ADD_INCOME:                     'bn_means_tests:write',
  BN_MEANS_CORRECT_INCOME:                 'bn_means_tests:write',
  BN_MEANS_VOID_INCOME:                    'bn_means_tests:write',
  BN_MEANS_DECLARE_NO_INCOME:              'bn_means_tests:write',
  BN_MEANS_WITHDRAW_NO_INCOME:             'bn_means_tests:write',
  BN_MEANS_MARK_HOUSEHOLD_COMPLETE:        'bn_means_tests:write',
  BN_MEANS_MARK_INCOME_COMPLETE:           'bn_means_tests:write',
  BN_MEANS_ADD_ASSET:                      'bn_means_tests:write',
  BN_MEANS_CORRECT_ASSET:                  'bn_means_tests:write',
  BN_MEANS_VOID_ASSET:                     'bn_means_tests:write',
  BN_MEANS_DECLARE_NO_ASSETS:              'bn_means_tests:write',
  BN_MEANS_WITHDRAW_NO_ASSETS:             'bn_means_tests:write',
  BN_MEANS_MARK_ASSETS_COMPLETE:           'bn_means_tests:write',
  BN_MEANS_ADD_DEDUCTION:                  'bn_means_tests:write',
  BN_MEANS_CORRECT_DEDUCTION:              'bn_means_tests:write',
  BN_MEANS_VOID_DEDUCTION:                 'bn_means_tests:write',
  BN_MEANS_DECLARE_NO_DEDUCTIONS:          'bn_means_tests:write',
  BN_MEANS_WITHDRAW_NO_DEDUCTIONS:         'bn_means_tests:write',
  BN_MEANS_MARK_DEDUCTIONS_COMPLETE:       'bn_means_tests:write',
  BN_MEANS_ATTACH_EVIDENCE:                'bn_means_tests:write',
  // EPIC 6 — evidence link register and information requests.
  BN_MEANS_UNLINK_EVIDENCE:                'bn_means_tests:write',
  BN_MEANS_RECORD_EVIDENCE_USABILITY:      'bn_means_tests:write',
  BN_MEANS_REQUEST_INFORMATION:            'bn_means_tests:write',
  BN_MEANS_RECORD_INFORMATION_RESPONSE:    'bn_means_tests:write',
  BN_MEANS_CLOSE_INFORMATION_REQUEST:      'bn_means_tests:write',
  BN_MEANS_MARK_EVIDENCE_COMPLETE:         'bn_means_tests:write',
  BN_MEANS_REOPEN_EVIDENCE:                'bn_means_tests:write',
  BN_MEANS_SUBMIT:                         'bn_means_tests:write',
  BN_MEANS_VERIFY_INFORMATION:             'bn_means_tests:verify',
  // EPIC 8 — verification and clarification supporting operations.
  BN_MEANS_CLAIM_VERIFICATION_WORK:        'bn_means_tests:verify',
  BN_MEANS_RELEASE_VERIFICATION_WORK:      'bn_means_tests:verify',
  BN_MEANS_RECORD_VERIFICATION_DECISION:   'bn_means_tests:verify',
  BN_MEANS_RECORD_CLARIFICATION_RESPONSE:  'bn_means_tests:verify',
  BN_MEANS_CANCEL_CLARIFICATION:           'bn_means_tests:verify',
  BN_MEANS_REOPEN_VERIFICATION_FACT:       'bn_means_tests:verify',
  BN_MEANS_COMPLETE_VERIFICATION:          'bn_means_tests:verify',
  BN_MEANS_CALCULATE:                      'bn_means_tests:decide',
  BN_MEANS_REQUEST_ADJUSTMENT:             'bn_means_tests:adjust_request',
  BN_MEANS_APPROVE_ADJUSTMENT:             'bn_means_tests:adjust_approve',
  BN_MEANS_APPROVE:                        'bn_means_tests:approve',
  BN_MEANS_REJECT:                         'bn_means_tests:approve',
  BN_MEANS_ACTIVATE:                       'bn_means_tests:approve',
  BN_MEANS_RETRY_FACT_PUBLICATION:         'bn_means_tests:approve',
  BN_MEANS_RETRY_ELIGIBILITY_REQUEST:      'bn_means_tests:approve',
  BN_MEANS_REFRESH_ELIGIBILITY_RESULT:     'bn_means_tests:write',
  BN_MEANS_SCHEDULE_REASSESSMENT:          'bn_means_tests:reassess',
  BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE:  'bn_means_tests:reassess',
  BN_MEANS_CANCEL_REASSESSMENT:            'bn_means_tests:reassess',
  BN_MEANS_CREATE_SUCCESSOR:               'bn_means_tests:reassess',
  BN_MEANS_CONFIRM_CARRIED_FORWARD:        'bn_means_tests:write',
  BN_MEANS_SUPERSEDE:                      'bn_means_tests:approve',
  BN_MEANS_CLOSE:                          'bn_means_tests:approve',

  // Risk Management
  BN_RISK_DETECT:                        'bn_risk_management:write',
  BN_RISK_TRIAGE:                        'bn_risk_management:write',
  BN_RISK_REQUEST_ENHANCED_VERIFICATION: 'bn_risk_management:write',
  BN_RISK_OPEN_INVESTIGATION:            'bn_risk_management:decide',
  BN_RISK_HOLD_PAYMENT:                  'bn_risk_management:decide',
  BN_RISK_CONFIRM_SYSTEM_ERROR:          'bn_risk_management:decide',
  BN_RISK_CORRECT_CLAIM:                 'bn_risk_management:decide',
  BN_RISK_MARK_OVERPAYMENT_AVOIDED:      'bn_risk_management:decide',
  BN_RISK_REFER_LEGAL:                   'bn_risk_management:decide',
  BN_RISK_CLEAR:                         'bn_risk_management:decide',
  BN_RISK_RELEASE_HOLD:                  'bn_risk_management:decide',
  BN_RISK_CLOSE:                         'bn_risk_management:decide',

  // Risk Management — canonical 18-command lifecycle (Slice 1)
  BN_RISK_GENERATE_SIGNAL:           'bn_risk_management:write',
  BN_RISK_REGISTER_MANUAL_SIGNAL:    'bn_risk_management:write',
  BN_RISK_TRIAGE_SIGNAL:             'bn_risk_management:write',
  BN_RISK_LINK_SIGNALS:              'bn_risk_management:write',
  BN_RISK_DISMISS_SIGNAL:            'bn_risk_management:decide',
  BN_RISK_CREATE_ASSESSMENT:         'bn_risk_management:write',
  BN_RISK_ADD_FACTOR:                'bn_risk_management:write',
  BN_RISK_REQUEST_EVIDENCE:          'bn_risk_management:write',
  BN_RISK_RECOMMEND_CONTROL:         'bn_risk_management:write',
  BN_RISK_APPROVE_CONTROL:           'bn_risk_management:approve_control',
  BN_RISK_PLACE_PAYMENT_HOLD:        'bn_risk_management:approve_control',
  BN_RISK_REQUEST_ENH_VERIFICATION:  'bn_risk_management:write',
  BN_RISK_REFER_TO_LEGAL:            'bn_risk_management:refer',
  BN_RISK_REFER_TO_INVESTIGATION:    'bn_risk_management:refer',
  BN_RISK_RECORD_OUTCOME:            'bn_risk_management:decide',
  BN_RISK_CLOSE_ASSESSMENT:          'bn_risk_management:decide',
  BN_RISK_REOPEN_ASSESSMENT:         'bn_risk_management:admin',
  BN_RISK_UPDATE_RULE_FEEDBACK:      'bn_risk_management:rule_admin',


  // Uprating
  BN_UPR_CREATE_RUN:           'bn_uprating:write',
  BN_UPR_PARAMETERISE:         'bn_uprating:write',
  BN_UPR_TAKE_SNAPSHOT:        'bn_uprating:write',
  BN_UPR_APPLY_EXCLUSIONS:     'bn_uprating:decide',
  BN_UPR_DRY_RUN:              'bn_uprating:decide',
  BN_UPR_REQUEST_APPROVAL:     'bn_uprating:decide',
  BN_UPR_APPROVE:              'bn_uprating:admin',
  BN_UPR_EXECUTE:              'bn_uprating:admin',
  BN_UPR_REBUILD_SCHEDULES:    'bn_uprating:decide',
  BN_UPR_ISSUE_COMMUNICATIONS: 'bn_uprating:decide',
  BN_UPR_RECONCILE:            'bn_uprating:decide',
  BN_UPR_ROLLBACK:             'bn_uprating:admin',
  BN_UPR_CLOSE:                'bn_uprating:decide',

  // Uprating & Indexation — canonical 17-command lifecycle (Slice 1)
  BN_UPRATING_CREATE_POLICY:              'bn_uprating:write',
  BN_UPRATING_CREATE_POLICY_VERSION:      'bn_uprating:write',
  BN_UPRATING_VALIDATE_POLICY:            'bn_uprating:write',
  BN_UPRATING_SUBMIT_POLICY_FOR_APPROVAL: 'bn_uprating:write',
  BN_UPRATING_APPROVE_POLICY:             'bn_uprating:admin',
  BN_UPRATING_CREATE_RUN:                 'bn_uprating:write',
  BN_UPRATING_BUILD_POPULATION:           'bn_uprating:decide',
  BN_UPRATING_SIMULATE:                   'bn_uprating:decide',
  BN_UPRATING_RESOLVE_EXCEPTION:          'bn_uprating:decide',
  BN_UPRATING_SUBMIT_RUN_FOR_APPROVAL:    'bn_uprating:decide',
  BN_UPRATING_APPROVE_RUN:                'bn_uprating:admin',
  BN_UPRATING_SCHEDULE_EXECUTION:         'bn_uprating:admin',
  BN_UPRATING_EXECUTE_BATCH:              'bn_uprating:admin',
  BN_UPRATING_RETRY_FAILED:               'bn_uprating:admin',
  BN_UPRATING_RECONCILE_RUN:              'bn_uprating:decide',
  BN_UPRATING_ROLLBACK_ELIGIBLE:          'bn_uprating:admin',
  BN_UPRATING_CLOSE_RUN:                  'bn_uprating:decide',
} as const;

export function requiredCapabilityFor(commandName: string): BnGapCapability | null {
  return BN_GAP_COMMAND_CAPABILITY[commandName] ?? null;
}

/** Utility: every capability referenced anywhere in the command map. */
export function referencedCapabilities(): readonly BnGapCapability[] {
  const set = new Set<BnGapCapability>(Object.values(BN_GAP_COMMAND_CAPABILITY));
  return Array.from(set);
}

// ─── vendored from src/services/bn/commands/benefitsCommandPipeline.ts ───
/**
 * BN Gap Modules — Server-authorised Command Pipeline (portable).
 *
 * This module contains the ORDERED, FAIL-CLOSED logic every gap-module
 * mutation flows through. It is deliberately transport-agnostic:
 *
 *   - Today it runs inside `supabase/functions/bn-gap-command`.
 *   - Tomorrow the same file (or its exact port) runs inside an ASP.NET Core
 *     controller — hence dependency injection for every side-effecting store.
 *
 * Ordering (any earlier failure short-circuits later steps):
 *
 *   1. Envelope structural validation
 *   2. Module registration (app_modules.exists)
 *   3. moduleEnabled / routesEnabled / actionsEnabled
 *   4. Capability mapping present (command → capability)
 *   5. Actor role → capability check (RoleCapabilityChecker)
 *   6. Handler registered
 *   7. Idempotency replay
 *   8. Payload validation (handler.validate)
 *   9. Optimistic concurrency (expectedRowVersion vs current)
 *  10. Maker-checker + self-approval prevention (handler.approval)
 *  11. Handler.execute inside a transaction boundary
 *  12. Before/after audit write
 *  13. Idempotency store
 *  14. Structured result
 *
 * The pipeline NEVER writes directly — all writes are delegated to injected
 * stores. This is what lets the same file power both backends.
 */

// ─── Injected contracts ──────────────────────────────────────────────

export interface ModuleRegistrationStore {
  load(moduleCode: BnGapModuleCode): Promise<{
    exists: boolean;
    isEnabled: boolean;
    routesEnabled: boolean;
    actionsEnabled: boolean;
  }>;
}

export interface RoleCapabilityChecker {
  actorHas(actorUserId: string, capability: BnGapCapability): Promise<boolean>;
}

export interface IdempotencyStore {
  find(idempotencyKey: string): Promise<BnGapCommandResult<any> | null>;
  save(idempotencyKey: string, result: BnGapCommandResult<any>): Promise<void>;
}

export interface VersionStore {
  currentVersion(entityType: string, entityId: string): Promise<string | null>;
}

export interface AuditWriter {
  write(input: {
    commandId: string;
    envelope: BnGapCommandEnvelope;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    outcome: BnGapCommandResult['status'];
    reasonCode: string | null;
  }): Promise<string>; // returns auditEventId
}

export interface TransactionRunner {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export interface TelemetrySink {
  event(name: string, fields: Record<string, unknown>): void;
}

// ─── Handler contract ────────────────────────────────────────────────

export interface CommandHandler<TPayload = unknown, TData = unknown> {
  readonly commandName: string;
  readonly commandVersion: number;
  readonly moduleCode: BnGapModuleCode;
  readonly entityType: string;
  /** Return structured validation errors — never throw for user input. */
  validate(payload: TPayload): Promise<readonly BnGapCommandError[]>;
  /** Maker-checker: return REJECTED result if actor cannot approve. */
  approvalCheck?(
    envelope: BnGapCommandEnvelope<TPayload>,
  ): Promise<readonly BnGapCommandError[]>;
  /** Load current row for before-image + version check. Null for creates. */
  loadBefore(
    envelope: BnGapCommandEnvelope<TPayload>,
  ): Promise<{ before: Record<string, unknown> | null; version: string | null }>;
  /** The actual mutation. MUST be idempotent inside the transaction. */
  execute(
    envelope: BnGapCommandEnvelope<TPayload>,
  ): Promise<{
    entityId: string;
    entityVersion: string;
    after: Record<string, unknown>;
    data: TData;
    warnings?: readonly BnGapCommandWarning[];
  }>;
}

export interface HandlerRegistry {
  get(commandName: string, commandVersion: number): CommandHandler | null;
}

export interface BenefitsCommandPipelineDeps {
  readonly modules: ModuleRegistrationStore;
  readonly roles: RoleCapabilityChecker;
  readonly idempotency: IdempotencyStore;
  readonly versions: VersionStore;
  readonly audit: AuditWriter;
  readonly transaction: TransactionRunner;
  readonly telemetry: TelemetrySink;
  readonly handlers: HandlerRegistry;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deny(
  envelope: BnGapCommandEnvelope,
  code: string,
  message: string,
  commandId: string,
): BnGapCommandResult {
  return {
    success: false,
    commandId,
    correlationId: envelope.correlationId,
    entityId: envelope.entityId,
    entityVersion: null,
    status: 'DENIED',
    warnings: [],
    validationErrors: [],
    businessErrors: [{ code, message }],
    auditEventId: null,
    data: null,
  };
}

function invalid(
  envelope: BnGapCommandEnvelope,
  errors: readonly BnGapCommandError[],
  commandId: string,
): BnGapCommandResult {
  return {
    success: false,
    commandId,
    correlationId: envelope.correlationId,
    entityId: envelope.entityId,
    entityVersion: null,
    status: 'INVALID',
    warnings: [],
    validationErrors: errors,
    businessErrors: [],
    auditEventId: null,
    data: null,
  };
}

function validateEnvelope(env: BnGapCommandEnvelope): readonly BnGapCommandError[] {
  const e: BnGapCommandError[] = [];
  if (!env || typeof env !== 'object') {
    return [{ code: 'ENVELOPE_MISSING', message: 'Command envelope is required.' }];
  }
  if (!env.commandName || typeof env.commandName !== 'string') {
    e.push({ code: 'ENVELOPE_COMMAND_NAME', message: 'commandName is required.', field: 'commandName' });
  }
  if (!Number.isInteger(env.commandVersion) || env.commandVersion < 1) {
    e.push({ code: 'ENVELOPE_COMMAND_VERSION', message: 'commandVersion must be a positive integer.', field: 'commandVersion' });
  }
  if (!env.idempotencyKey || !UUID_RE.test(env.idempotencyKey)) {
    e.push({ code: 'ENVELOPE_IDEMPOTENCY_KEY', message: 'idempotencyKey must be a UUID.', field: 'idempotencyKey' });
  }
  if (!env.correlationId || !UUID_RE.test(env.correlationId)) {
    e.push({ code: 'ENVELOPE_CORRELATION_ID', message: 'correlationId must be a UUID.', field: 'correlationId' });
  }
  if (!isBnGapModuleCode(env.moduleCode)) {
    e.push({ code: 'ENVELOPE_MODULE_CODE', message: 'moduleCode must be a registered gap module.', field: 'moduleCode' });
  }
  if (!env.entityType || typeof env.entityType !== 'string') {
    e.push({ code: 'ENVELOPE_ENTITY_TYPE', message: 'entityType is required.', field: 'entityType' });
  }
  if (env.entityId !== null && (typeof env.entityId !== 'string' || !UUID_RE.test(env.entityId))) {
    e.push({ code: 'ENVELOPE_ENTITY_ID', message: 'entityId must be a UUID or null.', field: 'entityId' });
  }
  if (!env.actorUserId || typeof env.actorUserId !== 'string') {
    e.push({ code: 'ENVELOPE_ACTOR_USER_ID', message: 'actorUserId is required.', field: 'actorUserId' });
  }
  const code = (env.actorUserCode ?? '').trim();
  if (!code || ['SYSTEM', 'CURRENT_USER', 'ANONYMOUS', 'UNKNOWN'].includes(code.toUpperCase())) {
    e.push({ code: 'ENVELOPE_ACTOR_USER_CODE', message: 'actorUserCode must be a real user_code.', field: 'actorUserCode' });
  }
  if (!Array.isArray(env.actorRoles)) {
    e.push({ code: 'ENVELOPE_ACTOR_ROLES', message: 'actorRoles must be an array.', field: 'actorRoles' });
  }
  if (!env.requestedAtUtc || Number.isNaN(Date.parse(env.requestedAtUtc))) {
    e.push({ code: 'ENVELOPE_REQUESTED_AT', message: 'requestedAtUtc must be ISO-8601 UTC.', field: 'requestedAtUtc' });
  }
  return e;
}

// ─── Pipeline ────────────────────────────────────────────────────────

export function createBenefitsCommandPipeline(deps: BenefitsCommandPipelineDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => (globalThis.crypto?.randomUUID?.() ?? fallbackUuid()));

  return {
    async execute<TPayload, TData>(
      envelope: BnGapCommandEnvelope<TPayload>,
    ): Promise<BnGapCommandResult<TData>> {
      const commandId = newId();
      const start = now().getTime();
      deps.telemetry.event('bn.gap.command.received', {
        commandId,
        commandName: envelope?.commandName,
        correlationId: envelope?.correlationId,
      });

      // 1. Envelope validation
      const envErr = validateEnvelope(envelope);
      if (envErr.length) return invalid(envelope, envErr, commandId) as BnGapCommandResult<TData>;

      // 2. Module registered
      const reg = await deps.modules.load(envelope.moduleCode);
      if (!reg.exists) {
        return deny(envelope, 'MODULE_NOT_REGISTERED', `Module ${envelope.moduleCode} is not registered.`, commandId) as BnGapCommandResult<TData>;
      }
      // 3. Rollout flags
      if (!reg.isEnabled) return deny(envelope, 'MODULE_DISABLED', 'Module is disabled.', commandId) as BnGapCommandResult<TData>;
      if (!reg.routesEnabled) return deny(envelope, 'ROUTES_DISABLED', 'Module routes are disabled.', commandId) as BnGapCommandResult<TData>;
      if (!reg.actionsEnabled) return deny(envelope, 'ACTIONS_DISABLED', 'Module actions are disabled (dark launch).', commandId) as BnGapCommandResult<TData>;

      // 4. Capability mapping
      const capability = requiredCapabilityFor(envelope.commandName);
      if (!capability) {
        return deny(envelope, 'CAPABILITY_UNMAPPED', 'Command has no capability mapping.', commandId) as BnGapCommandResult<TData>;
      }

      // 5. Role check (fail closed)
      const authorised = await deps.roles.actorHas(envelope.actorUserId, capability).catch(() => false);
      if (!authorised) {
        return deny(envelope, 'CAPABILITY_DENIED', 'Actor lacks the required capability.', commandId) as BnGapCommandResult<TData>;
      }

      // 6. Handler
      const handler = deps.handlers.get(envelope.commandName, envelope.commandVersion) as
        | CommandHandler<TPayload, TData>
        | null;
      if (!handler) {
        return deny(envelope, 'HANDLER_NOT_REGISTERED', 'No handler registered for this command/version.', commandId) as BnGapCommandResult<TData>;
      }
      if (handler.moduleCode !== envelope.moduleCode) {
        return deny(envelope, 'HANDLER_MODULE_MISMATCH', 'Handler module does not match envelope moduleCode.', commandId) as BnGapCommandResult<TData>;
      }

      // 7. Idempotency replay
      const prior = await deps.idempotency.find(envelope.idempotencyKey);
      if (prior) {
        deps.telemetry.event('bn.gap.command.replayed', { commandId, correlationId: envelope.correlationId });
        return { ...prior, status: 'REPLAYED' } as BnGapCommandResult<TData>;
      }

      // 8. Payload validation
      const payloadErr = await handler.validate(envelope.payload);
      if (payloadErr.length) return invalid(envelope, payloadErr, commandId) as BnGapCommandResult<TData>;

      // 9. Optimistic concurrency + before-image
      const { before, version } = await handler.loadBefore(envelope);
      if (envelope.expectedRowVersion !== undefined && version !== null && envelope.expectedRowVersion !== version) {
        return {
          success: false,
          commandId,
          correlationId: envelope.correlationId,
          entityId: envelope.entityId,
          entityVersion: version,
          status: 'CONFLICT',
          warnings: [],
          validationErrors: [],
          businessErrors: [{ code: 'VERSION_CONFLICT', message: 'The entity was modified by another user. Reload and try again.' }],
          auditEventId: null,
          data: null,
        } as BnGapCommandResult<TData>;
      }

      // 10. Approval / self-approval
      if (handler.approvalCheck) {
        const appErr = await handler.approvalCheck(envelope);
        if (appErr.length) {
          return {
            success: false,
            commandId,
            correlationId: envelope.correlationId,
            entityId: envelope.entityId,
            entityVersion: version,
            status: 'REJECTED',
            warnings: [],
            validationErrors: [],
            businessErrors: appErr,
            auditEventId: null,
            data: null,
          } as BnGapCommandResult<TData>;
        }
      }

      // 11+12+13. Transaction: execute → audit → idempotency
      try {
        const result = await deps.transaction.run(async () => {
          const outcome = await handler.execute(envelope);
          const auditEventId = await deps.audit.write({
            commandId,
            envelope,
            before,
            after: outcome.after,
            outcome: 'EXECUTED',
            reasonCode: envelope.reasonCode ?? null,
          });
          const finalResult: BnGapCommandResult<TData> = {
            success: true,
            commandId,
            correlationId: envelope.correlationId,
            entityId: outcome.entityId,
            entityVersion: outcome.entityVersion,
            status: 'EXECUTED',
            warnings: outcome.warnings ?? [],
            validationErrors: [],
            businessErrors: [],
            auditEventId,
            data: outcome.data,
          };
          await deps.idempotency.save(envelope.idempotencyKey, finalResult);
          return finalResult;
        });
        deps.telemetry.event('bn.gap.command.executed', {
          commandId,
          correlationId: envelope.correlationId,
          durationMs: now().getTime() - start,
        });
        return result;
      } catch (err) {
        deps.telemetry.event('bn.gap.command.failed', {
          commandId,
          correlationId: envelope.correlationId,
          error: (err as Error)?.message,
        });
        return {
          success: false,
          commandId,
          correlationId: envelope.correlationId,
          entityId: envelope.entityId,
          entityVersion: null,
          status: 'FAILED',
          warnings: [],
          validationErrors: [],
          businessErrors: [{ code: 'HANDLER_FAILED', message: 'The command could not be completed. It has been safely rolled back.' }],
          auditEventId: null,
          data: null,
        } as BnGapCommandResult<TData>;
      }
    },
  };
}

function fallbackUuid(): string {
  // RFC4122 v4-ish fallback for non-crypto environments (tests).
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}

export const BN_GAP_MODULE_CODES_EXPORT = BN_GAP_MODULE_CODES;

// ─── vendored from src/services/bn/commands/pingCommand.ts ───
/**
 * BN Gap Modules — Harmless "PING" proof command.
 *
 * Proves the entire command pipeline end-to-end without touching any
 * business data:
 *
 *   Envelope → capability check → handler → transaction → audit →
 *   idempotency → result.
 *
 * Registered against `bn_mortality:read` capability so it fails closed for
 * unauthenticated / unpermitted callers. It writes no rows; the "after"
 * image is a synthetic echo of the envelope's payload.
 */

export interface BnGapPingPayload {
  readonly note?: string;
}

export interface BnGapPingData {
  readonly echoedAtUtc: string;
  readonly note: string;
}

export const BN_GAP_PING_HANDLER: CommandHandler<BnGapPingPayload, BnGapPingData> = {
  commandName: 'BN_GAP_PING',
  commandVersion: 1,
  moduleCode: 'bn_mortality',
  entityType: 'bn_gap_diagnostic',

  async validate(payload): Promise<readonly BnGapCommandError[]> {
    const errs: BnGapCommandError[] = [];
    if (payload && payload.note !== undefined && typeof payload.note !== 'string') {
      errs.push({ code: 'PING_NOTE_TYPE', message: 'note must be a string.', field: 'note' });
    }
    if (payload?.note && payload.note.length > 500) {
      errs.push({ code: 'PING_NOTE_TOO_LONG', message: 'note must be 500 characters or fewer.', field: 'note' });
    }
    return errs;
  },

  async loadBefore() {
    return { before: null, version: null };
  },

  async execute(envelope) {
    const echoedAtUtc = new Date().toISOString();
    const note = envelope.payload?.note ?? 'ping';
    return {
      entityId: envelope.correlationId, // synthetic — never touches storage
      entityVersion: '1',
      after: { echoedAtUtc, note },
      data: { echoedAtUtc, note },
      warnings: [],
    };
  },
};
