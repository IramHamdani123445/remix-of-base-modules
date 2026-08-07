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
import type { BnGapModuleCode } from '@/types/bn/commands/commandEnvelope';

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
  BN_MEANS_ATTACH_EVIDENCE:                'bn_means_tests:write',
  BN_MEANS_SUBMIT:                         'bn_means_tests:write',
  BN_MEANS_VERIFY_INFORMATION:             'bn_means_tests:verify',
  BN_MEANS_CALCULATE:                      'bn_means_tests:decide',
  BN_MEANS_REQUEST_ADJUSTMENT:             'bn_means_tests:adjust_request',
  BN_MEANS_APPROVE_ADJUSTMENT:             'bn_means_tests:adjust_approve',
  BN_MEANS_APPROVE:                        'bn_means_tests:approve',
  BN_MEANS_REJECT:                         'bn_means_tests:approve',
  BN_MEANS_ACTIVATE:                       'bn_means_tests:approve',
  BN_MEANS_SCHEDULE_REASSESSMENT:          'bn_means_tests:reassess',
  BN_MEANS_RECORD_CHANGE_OF_CIRCUMSTANCE:  'bn_means_tests:write',
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
