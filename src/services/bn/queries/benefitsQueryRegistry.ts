/**
 * BN Benefits — Query capability registry.
 *
 * Server-authoritative map from {@link BnBenefitsQueryCode} to the
 * capability required to execute the query and the list of fields that
 * MUST be masked unless the caller additionally holds
 * `<module>:admin`.
 *
 * This registry is imported by BOTH the browser client (for optimistic
 * denial UX) and the edge function (for the actual server-side gate).
 * The edge function ALSO re-checks capabilities against
 * `role_permissions` — this map alone is never sufficient.
 */
import type { BnBenefitsQueryCode } from '@/types/bn/queries/queryCodes';

export interface BnBenefitsQueryDescriptor {
  readonly queryCode: BnBenefitsQueryCode;
  readonly moduleCode: string;
  /** Any of these capabilities is sufficient. */
  readonly anyOfCapabilities: readonly string[];
  /** Fields masked unless caller also holds the module `:admin` capability. */
  readonly sensitiveFields: readonly string[];
  /** Maximum page size the server will honour. */
  readonly maxPageSize: number;
}

export const BN_BENEFITS_QUERY_REGISTRY: Readonly<
  Record<BnBenefitsQueryCode, BnBenefitsQueryDescriptor>
> = {
  BN_MORTALITY_GET_SUMMARY: {
    queryCode: 'BN_MORTALITY_GET_SUMMARY',
    moduleCode: 'bn_mortality',
    anyOfCapabilities: ['bn_mortality:view', 'bn_mortality:read'],
    sensitiveFields: [],
    maxPageSize: 1,
  },
  BN_MORTALITY_LIST_EVENTS: {
    queryCode: 'BN_MORTALITY_LIST_EVENTS',
    moduleCode: 'bn_mortality',
    anyOfCapabilities: ['bn_mortality:view', 'bn_mortality:read'],
    sensitiveFields: ['nationalIdMasked', 'sourcePayload'],
    maxPageSize: 100,
  },
  BN_MORTALITY_GET_EVENT: {
    queryCode: 'BN_MORTALITY_GET_EVENT',
    moduleCode: 'bn_mortality',
    anyOfCapabilities: ['bn_mortality:view', 'bn_mortality:read'],
    sensitiveFields: ['sourcePayload', 'externalReferenceRaw', 'diagnostics'],
    maxPageSize: 1,
  },
  BN_MORTALITY_SEARCH_PERSON_MATCHES: {
    queryCode: 'BN_MORTALITY_SEARCH_PERSON_MATCHES',
    moduleCode: 'bn_mortality',
    anyOfCapabilities: ['bn_mortality:read'],
    sensitiveFields: ['nationalIdMasked', 'dateOfBirth', 'contact', 'confidenceInternals'],
    maxPageSize: 50,
  },
  BN_MORTALITY_GET_AFFECTED_AWARDS: {
    queryCode: 'BN_MORTALITY_GET_AFFECTED_AWARDS',
    moduleCode: 'bn_mortality',
    anyOfCapabilities: ['bn_mortality:read'],
    sensitiveFields: ['overpaymentAmountMinor', 'holdReasonInternal'],
    maxPageSize: 100,
  },
  BN_MORTALITY_GET_EVENT_HISTORY: {
    queryCode: 'BN_MORTALITY_GET_EVENT_HISTORY',
    moduleCode: 'bn_mortality',
    anyOfCapabilities: ['bn_mortality:read'],
    sensitiveFields: ['diagnostics', 'internalReason'],
    maxPageSize: 200,
  },
  BN_MORTALITY_GET_REFERRALS: {
    queryCode: 'BN_MORTALITY_GET_REFERRALS',
    moduleCode: 'bn_mortality',
    anyOfCapabilities: ['bn_mortality:read'],
    sensitiveFields: ['contact'],
    maxPageSize: 100,
  },
  BN_MORTALITY_GET_AWARD_IMPACTS: {
    queryCode: 'BN_MORTALITY_GET_AWARD_IMPACTS',
    moduleCode: 'bn_mortality',
    anyOfCapabilities: ['bn_mortality:read'],
    sensitiveFields: ['overpaymentAmountMinor', 'ledgerDetail'],
    maxPageSize: 100,
  },
  BN_MORTALITY_GET_EVIDENCE_LINKS: {
    queryCode: 'BN_MORTALITY_GET_EVIDENCE_LINKS',
    moduleCode: 'bn_mortality',
    anyOfCapabilities: ['bn_mortality:read'],
    sensitiveFields: ['sourcePayload'],
    maxPageSize: 100,
  },
  BN_MORTALITY_GET_COMMUNICATIONS: {
    queryCode: 'BN_MORTALITY_GET_COMMUNICATIONS',
    moduleCode: 'bn_mortality',
    anyOfCapabilities: ['bn_mortality:read'],
    sensitiveFields: ['recipientContact'],
    maxPageSize: 100,
  },
  BN_MORTALITY_PREVIEW_REGISTRATION_IMPACT: {
    queryCode: 'BN_MORTALITY_PREVIEW_REGISTRATION_IMPACT',
    moduleCode: 'bn_mortality',
    anyOfCapabilities: ['bn_mortality:read', 'bn_mortality:write'],
    sensitiveFields: [],
    maxPageSize: 100,
  },
  BN_MORTALITY_GET_ACTION_AVAILABILITY: {
    queryCode: 'BN_MORTALITY_GET_ACTION_AVAILABILITY',
    moduleCode: 'bn_mortality',
    anyOfCapabilities: ['bn_mortality:view', 'bn_mortality:read'],
    sensitiveFields: [],
    maxPageSize: 1,
  },
  BN_MORTALITY_GET_ASSIGNABLE_USERS: {
    queryCode: 'BN_MORTALITY_GET_ASSIGNABLE_USERS',
    moduleCode: 'bn_mortality',
    anyOfCapabilities: ['bn_mortality:view', 'bn_mortality:read'],
    sensitiveFields: [],
    maxPageSize: 500,
  },
  BN_MORTALITY_GET_EVIDENCE: {
    queryCode: 'BN_MORTALITY_GET_EVIDENCE',
    moduleCode: 'bn_mortality',
    anyOfCapabilities: ['bn_mortality:read'],
    sensitiveFields: ['dmsReference', 'notes'],
    maxPageSize: 100,
  },
  BN_MORTALITY_GET_REQUIRED_ACTIONS: {
    queryCode: 'BN_MORTALITY_GET_REQUIRED_ACTIONS',
    moduleCode: 'bn_mortality',
    anyOfCapabilities: ['bn_mortality:view', 'bn_mortality:read'],
    sensitiveFields: [],
    maxPageSize: 100,
  },
  BN_MORTALITY_GET_HANDOFFS: {
    queryCode: 'BN_MORTALITY_GET_HANDOFFS',
    moduleCode: 'bn_mortality',
    anyOfCapabilities: ['bn_mortality:view', 'bn_mortality:read'],
    sensitiveFields: [],
    maxPageSize: 100,
  },
  BN_MORTALITY_GET_WORKLIST_INDICATORS: {
    queryCode: 'BN_MORTALITY_GET_WORKLIST_INDICATORS',
    moduleCode: 'bn_mortality',
    anyOfCapabilities: ['bn_mortality:view', 'bn_mortality:read'],
    sensitiveFields: [],
    maxPageSize: 100,
  },
  BN_MORTALITY_GET_AWARD_SNAPSHOT: {
    queryCode: 'BN_MORTALITY_GET_AWARD_SNAPSHOT',
    moduleCode: 'bn_mortality',
    anyOfCapabilities: ['bn_mortality:view', 'bn_mortality:read'],
    sensitiveFields: [],
    maxPageSize: 1,
  },



  // ==== BN-AP-00 — Appeals & Disputes secure surfaces ==================
  // Claimant self-service (ownership derived server-side from the caller's
  // JWT via `external_user_person_link` — the client never picks the rows).
  BN_APPEAL_GET_MY_APPEALS: {
    queryCode: 'BN_APPEAL_GET_MY_APPEALS',
    moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:claimant_submit', 'bn_appeals:view'],
    sensitiveFields: [],
    maxPageSize: 100,
  },
  BN_APPEAL_GET_MY_APPEAL_DETAIL: {
    queryCode: 'BN_APPEAL_GET_MY_APPEAL_DETAIL',
    moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:claimant_submit', 'bn_appeals:view'],
    sensitiveFields: ['assignedToUserId', 'assignedWorkbasket', 'internalNotes'],
    maxPageSize: 1,
  },
  // Staff read surfaces (handlers finalised in AP-01)
  BN_APPEAL_GET_SUMMARY: {
    queryCode: 'BN_APPEAL_GET_SUMMARY',
    moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:view', 'bn_appeals:read'],
    sensitiveFields: [],
    maxPageSize: 1,
  },
  BN_APPEAL_LIST: {
    queryCode: 'BN_APPEAL_LIST',
    moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:view', 'bn_appeals:read'],
    sensitiveFields: ['claimantSsnMasked', 'reasonSummary'],
    maxPageSize: 100,
  },
  BN_APPEAL_GET: {
    queryCode: 'BN_APPEAL_GET',
    moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read'],
    sensitiveFields: ['claimantSsnMasked', 'internalNotes'],
    maxPageSize: 1,
  },
  BN_APPEAL_GET_GROUNDS: {
    queryCode: 'BN_APPEAL_GET_GROUNDS',
    moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read'],
    sensitiveFields: [],
    maxPageSize: 100,
  },
  BN_APPEAL_GET_EVIDENCE: {
    queryCode: 'BN_APPEAL_GET_EVIDENCE',
    moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read'],
    sensitiveFields: ['fileReference'],
    maxPageSize: 100,
  },
  BN_APPEAL_GET_EVENTS: {
    queryCode: 'BN_APPEAL_GET_EVENTS',
    moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read'],
    sensitiveFields: ['diagnostics'],
    maxPageSize: 200,
  },
  BN_APPEAL_GET_HEARINGS: {
    queryCode: 'BN_APPEAL_GET_HEARINGS',
    moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read'],
    sensitiveFields: [],
    maxPageSize: 100,
  },
  BN_APPEAL_GET_DECISION_SNAPSHOT: {
    queryCode: 'BN_APPEAL_GET_DECISION_SNAPSHOT',
    moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read'],
    sensitiveFields: [],
    maxPageSize: 1,
  },
  BN_APPEAL_GET_SOURCE_DECISION: {
    queryCode: 'BN_APPEAL_GET_SOURCE_DECISION',
    moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read', 'bn_appeals:view'],
    sensitiveFields: ['sourceDecisionInternalNotes'],
    maxPageSize: 1,
  },
  BN_APPEAL_GET_ACTION_AVAILABILITY: {
    queryCode: 'BN_APPEAL_GET_ACTION_AVAILABILITY',
    moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:view', 'bn_appeals:read'],
    sensitiveFields: [],
    maxPageSize: 1,
  },

  // ==== BN-AP-01 Slice 2A — 14-tab enterprise child surfaces ============
  BN_APPEAL_GET_PARTIES: {
    queryCode: 'BN_APPEAL_GET_PARTIES', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read'],
    sensitiveFields: ['maskedIdentifier', 'contactReference'], maxPageSize: 50,
  },
  BN_APPEAL_GET_ISSUES: {
    queryCode: 'BN_APPEAL_GET_ISSUES', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 100,
  },
  BN_APPEAL_GET_DEADLINES: {
    queryCode: 'BN_APPEAL_GET_DEADLINES', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 100,
  },
  BN_APPEAL_GET_EVIDENCE_REQUESTS: {
    queryCode: 'BN_APPEAL_GET_EVIDENCE_REQUESTS', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 100,
  },
  BN_APPEAL_GET_STAYS: {
    queryCode: 'BN_APPEAL_GET_STAYS', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 50,
  },
  BN_APPEAL_GET_NOTES: {
    queryCode: 'BN_APPEAL_GET_NOTES', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: ['body'], maxPageSize: 200,
  },
  BN_APPEAL_GET_HEARING: {
    queryCode: 'BN_APPEAL_GET_HEARING', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 50,
  },
  BN_APPEAL_GET_RECOMMENDATIONS: {
    queryCode: 'BN_APPEAL_GET_RECOMMENDATIONS', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 50,
  },
  BN_APPEAL_GET_DECISIONS: {
    queryCode: 'BN_APPEAL_GET_DECISIONS', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 50,
  },
  BN_APPEAL_GET_IMPLEMENTATION: {
    queryCode: 'BN_APPEAL_GET_IMPLEMENTATION', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 100,
  },
  BN_APPEAL_GET_LINKS: {
    queryCode: 'BN_APPEAL_GET_LINKS', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 100,
  },
  BN_APPEAL_GET_WORKFLOW: {
    queryCode: 'BN_APPEAL_GET_WORKFLOW', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: [], maxPageSize: 100,
  },
  BN_APPEAL_GET_COMMUNICATIONS: {
    queryCode: 'BN_APPEAL_GET_COMMUNICATIONS', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:read'], sensitiveFields: ['recipientContact'], maxPageSize: 100,
  },
  // AP-01 Slice 2B — source-lookup / registration-config surfaces
  BN_APPEAL_SEARCH_SOURCE_DECISIONS: {
    queryCode: 'BN_APPEAL_SEARCH_SOURCE_DECISIONS', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:view', 'bn_appeals:read', 'bn_appeals:write'],
    sensitiveFields: ['claimantSsnMasked'], maxPageSize: 50,
  },
  BN_APPEAL_GET_SOURCE_CANDIDATE: {
    queryCode: 'BN_APPEAL_GET_SOURCE_CANDIDATE', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:view', 'bn_appeals:read', 'bn_appeals:write'],
    sensitiveFields: ['claimantSsnMasked'], maxPageSize: 1,
  },
  BN_APPEAL_GET_SOURCE_CONTEXT: {
    queryCode: 'BN_APPEAL_GET_SOURCE_CONTEXT', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:view', 'bn_appeals:read', 'bn_appeals:write'],
    sensitiveFields: ['claimantSsnMasked', 'internalNotes'], maxPageSize: 1,
  },
  BN_APPEAL_GET_REPRESENTATIVE_OPTIONS: {
    queryCode: 'BN_APPEAL_GET_REPRESENTATIVE_OPTIONS', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:view', 'bn_appeals:read', 'bn_appeals:write'],
    sensitiveFields: ['contactReference'], maxPageSize: 20,
  },
  BN_APPEAL_CALCULATE_FILING_DEADLINE: {
    queryCode: 'BN_APPEAL_CALCULATE_FILING_DEADLINE', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:view', 'bn_appeals:read', 'bn_appeals:write'],
    sensitiveFields: [], maxPageSize: 1,
  },
  BN_APPEAL_CHECK_DUPLICATE: {
    queryCode: 'BN_APPEAL_CHECK_DUPLICATE', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:view', 'bn_appeals:read', 'bn_appeals:write'],
    sensitiveFields: [], maxPageSize: 1,
  },
  BN_APPEAL_GET_REGISTRATION_CONFIG: {
    queryCode: 'BN_APPEAL_GET_REGISTRATION_CONFIG', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:view', 'bn_appeals:read', 'bn_appeals:write'],
    sensitiveFields: [], maxPageSize: 1,
  },
  // AP-01 Turn 2 — Operational read screens
  BN_APPEAL_GET_MY_WORK_SUMMARY: {
    queryCode: 'BN_APPEAL_GET_MY_WORK_SUMMARY', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:view', 'bn_appeals:read'],
    sensitiveFields: [], maxPageSize: 1,
  },
  BN_APPEAL_LIST_MY_WORK: {
    queryCode: 'BN_APPEAL_LIST_MY_WORK', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:view', 'bn_appeals:read'],
    sensitiveFields: ['claimantSsnMasked'], maxPageSize: 100,
  },
  BN_APPEAL_LIST_HEARINGS: {
    queryCode: 'BN_APPEAL_LIST_HEARINGS', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:view', 'bn_appeals:read'],
    sensitiveFields: [], maxPageSize: 100,
  },
  BN_APPEAL_LIST_IMPLEMENTATION: {
    queryCode: 'BN_APPEAL_LIST_IMPLEMENTATION', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:view', 'bn_appeals:read'],
    sensitiveFields: [], maxPageSize: 100,
  },
  BN_APPEAL_GET_CONFIGURATION: {
    queryCode: 'BN_APPEAL_GET_CONFIGURATION', moduleCode: 'bn_appeals',
    anyOfCapabilities: ['bn_appeals:view', 'bn_appeals:read'],
    sensitiveFields: [], maxPageSize: 1,
  },
};


export function getBenefitsQueryDescriptor(
  code: string,
): BnBenefitsQueryDescriptor | null {
  return (BN_BENEFITS_QUERY_REGISTRY as Record<string, BnBenefitsQueryDescriptor>)[code] ?? null;
}
