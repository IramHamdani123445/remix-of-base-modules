/**
 * INTERNAL AUDIT → OMNI-COMMS professional message content (Gate E2).
 *
 * Pure, deterministic editorial content for every catalogued Internal Audit
 * communication: why the recipient received it, what (if anything) they must
 * do, by when, and what happens next.
 *
 * This module holds NO recipient identities, NO addresses and NO environment
 * values. It is data only — the template registry renders it, the producer
 * supplies the facts.
 */
import type { IaCommunicationEntry } from '../internalAuditCommunicationCatalogue';

export interface IaEmailContent {
  /** Short classification chip rendered in the header band. */
  category: string;
  /** Why this message was issued, addressed to the recipient. */
  purpose: string;
  /** What the recipient must do. `null` = informational, no action. */
  actionRequired: string | null;
  /** What happens next in the audit process. */
  nextSteps: string[];
  /** Label of the call-to-action button. */
  ctaLabel: string;
}

const ORG_NAME = 'St. Kitts & Nevis Social Security Board';
const UNIT_NAME = 'Internal Audit Unit';

export const IA_ORGANISATION_NAME = ORG_NAME;
export const IA_UNIT_NAME = UNIT_NAME;

/** Domain-level defaults, used when an event has no bespoke entry below. */
const DOMAIN_DEFAULTS: Record<string, IaEmailContent> = {
  PLAN: {
    category: 'Annual audit plan',
    purpose:
      'You are receiving this notice because you hold a governance responsibility for the annual internal audit plan.',
    actionRequired: null,
    nextSteps: ['Review the plan record in the Internal Audit workspace.'],
    ctaLabel: 'Open annual plan',
  },
  ENGAGEMENT: {
    category: 'Audit engagement',
    purpose:
      'You are receiving this notice because you are involved in the audit engagement referenced below.',
    actionRequired: null,
    nextSteps: ['Review the engagement record in the Internal Audit workspace.'],
    ctaLabel: 'Open engagement',
  },
  REQUEST: {
    category: 'Information request',
    purpose:
      'You are receiving this notice because Internal Audit requires information or records from your area.',
    actionRequired: 'Provide the requested records through the Internal Audit workspace by the due date shown above.',
    nextSteps: [
      'Upload or submit the requested records against the request reference.',
      'Internal Audit will acknowledge receipt and confirm sufficiency.',
    ],
    ctaLabel: 'Open request',
  },
  QUERY: {
    category: 'Audit query',
    purpose:
      'You are receiving this notice because an audit query has been raised that requires a management explanation.',
    actionRequired: 'Submit a written response to the query through the Internal Audit workspace.',
    nextSteps: [
      'Respond to the query with supporting evidence.',
      'Internal Audit will assess the response and confirm closure or seek clarification.',
    ],
    ctaLabel: 'Open query',
  },
  FINDING: {
    category: 'Audit finding',
    purpose:
      'You are receiving this notice because an audit finding affecting your area of responsibility has changed status.',
    actionRequired: null,
    nextSteps: ['Review the finding and the agreed management response.'],
    ctaLabel: 'Open finding',
  },
  REPORT: {
    category: 'Audit report',
    purpose:
      'You are receiving this notice because you are a designated recipient of this internal audit report.',
    actionRequired: null,
    nextSteps: ['Review the report in the Internal Audit workspace.'],
    ctaLabel: 'Open report',
  },
  ACTION: {
    category: 'Corrective action',
    purpose:
      'You are receiving this notice because you are accountable for, or oversee, the corrective action referenced below.',
    actionRequired: 'Record progress against the corrective action in the Internal Audit workspace.',
    nextSteps: [
      'Update the action with progress and supporting evidence.',
      'Internal Audit will verify completion before the action is closed.',
    ],
    ctaLabel: 'Open corrective action',
  },
  FOLLOWUP: {
    category: 'Follow-up review',
    purpose:
      'You are receiving this notice because it concerns the continuity of open audit matters.',
    actionRequired: null,
    nextSteps: ['Review the follow-up record in the Internal Audit workspace.'],
    ctaLabel: 'Open follow-up',
  },
};

/** Bespoke content per event code. Overrides the domain default entirely. */
const BY_EVENT: Record<string, Partial<IaEmailContent>> = {
  'INTERNAL_AUDIT.PLAN.SUBMITTED': {
    purpose:
      'The annual internal audit plan shown below has been submitted for governance approval and is awaiting your decision.',
    actionRequired: 'Review the submitted plan and record an approval decision.',
    nextSteps: [
      'Review coverage, resourcing and risk alignment of the submitted plan.',
      'Record approval, rejection or a revision request against the plan.',
    ],
  },
  'INTERNAL_AUDIT.PLAN.APPROVED': {
    purpose: 'The annual internal audit plan shown below has been approved and is now the authorised plan of work.',
    nextSteps: [
      'Engagements under the approved plan may now be launched.',
      'The approved plan will be distributed to its designated recipients.',
    ],
  },
  'INTERNAL_AUDIT.PLAN.DISTRIBUTED': {
    purpose: 'The approved annual internal audit plan has been formally distributed to you as a designated recipient.',
    nextSteps: ['Retain this distribution notice as evidence of receipt.'],
  },
  'INTERNAL_AUDIT.PLAN.REJECTED': {
    purpose: 'The annual internal audit plan submitted for approval has been rejected by the approving authority.',
    actionRequired: 'Address the stated reason and resubmit a revised plan for approval.',
    nextSteps: ['Revise the plan to address the rejection reason.', 'Resubmit the plan for governance approval.'],
  },
  'INTERNAL_AUDIT.PLAN.REVISION_REQUESTED': {
    purpose: 'The approving authority has requested revisions to the annual internal audit plan before it can be approved.',
    actionRequired: 'Apply the requested revisions and resubmit the plan.',
    nextSteps: ['Amend the plan as requested.', 'Resubmit the plan for approval.'],
  },
  'INTERNAL_AUDIT.PLAN.CLOSED': {
    purpose: 'The annual internal audit plan year shown below has been formally closed.',
    nextSteps: ['Open matters recorded against the plan are carried forward to the next plan year.'],
  },
  'INTERNAL_AUDIT.PLAN.TEAM_CONFLICT': {
    category: 'Independence',
    purpose:
      'A potential independence or conflict-of-interest condition has been detected on an audit team assignment.',
    actionRequired: 'Assess the conflict and either reassign the auditor or record a documented mitigation.',
    nextSteps: ['Record the independence decision before fieldwork commences.'],
  },
  'INTERNAL_AUDIT.ENGAGEMENT.LAUNCHED': {
    purpose: 'An audit engagement has been launched under the approved annual plan.',
    nextSteps: ['The engagement team will issue the audit intimation and schedule the entrance meeting.'],
  },
  'INTERNAL_AUDIT.ENGAGEMENT.INTIMATION_ISSUED': {
    purpose:
      'This is formal notice that your area has been selected for internal audit under the approved annual audit plan.',
    actionRequired: 'Nominate your audit liaison contact and confirm availability for the entrance meeting.',
    nextSteps: [
      'An entrance meeting will be convened to agree scope, timing and logistics.',
      'Information requests will follow through the Internal Audit workspace.',
    ],
  },
  'INTERNAL_AUDIT.ENGAGEMENT.SCHEDULED': {
    purpose: 'Fieldwork dates for the audit engagement referenced below have been scheduled.',
    actionRequired: 'Confirm the availability of key personnel and records for the scheduled window.',
    nextSteps: ['Fieldwork will commence on the planned start date shown above.'],
  },
  'INTERNAL_AUDIT.ENGAGEMENT.RESCHEDULED': {
    purpose: 'The fieldwork window for the audit engagement referenced below has been rescheduled.',
    actionRequired: 'Note the revised dates and confirm continued availability.',
    nextSteps: ['Fieldwork will proceed on the revised dates shown above.'],
  },
  'INTERNAL_AUDIT.ENGAGEMENT.POSTPONED': {
    purpose: 'The audit engagement referenced below has been postponed.',
    nextSteps: ['Revised dates will be communicated once agreed with your area.'],
  },
  'INTERNAL_AUDIT.ENGAGEMENT.CANCELLED': {
    purpose: 'The audit engagement referenced below has been cancelled and will not proceed.',
    nextSteps: ['No further action is required in respect of this engagement.'],
  },
  'INTERNAL_AUDIT.ENGAGEMENT.ENTRANCE_MEETING': {
    purpose: 'You are invited to the entrance meeting for the audit engagement referenced below.',
    actionRequired: 'Attend the entrance meeting at the date, time and location shown above.',
    nextSteps: ['Scope, timing, key contacts and information requirements will be agreed at the meeting.'],
  },
  'INTERNAL_AUDIT.ENGAGEMENT.EXIT_MEETING': {
    purpose: 'You are invited to the exit meeting for the audit engagement referenced below.',
    actionRequired: 'Attend the exit meeting to discuss the provisional findings.',
    nextSteps: ['Provisional findings will be discussed and management responses agreed.'],
  },
  'INTERNAL_AUDIT.ENGAGEMENT.FIELDWORK_COMPLETED': {
    purpose: 'Fieldwork for the audit engagement referenced below has been completed.',
    nextSteps: ['Findings will be finalised and a draft report prepared for circulation.'],
  },
  'INTERNAL_AUDIT.ENGAGEMENT.CLOSED': {
    purpose: 'The audit engagement referenced below has been formally closed.',
    nextSteps: ['Any open corrective actions remain tracked to completion by Internal Audit.'],
  },
  'INTERNAL_AUDIT.REQUEST.ISSUED': {
    purpose:
      'Internal Audit requires the records described below in order to complete the audit engagement referenced.',
    actionRequired: 'Submit the requested records by the due date shown above.',
  },
  'INTERNAL_AUDIT.REQUEST.REMINDER': {
    category: 'Information request — reminder',
    purpose: 'This is a reminder that an outstanding Internal Audit information request remains unfulfilled.',
    actionRequired: 'Submit the outstanding records before the due date to avoid the request becoming overdue.',
  },
  'INTERNAL_AUDIT.REQUEST.OVERDUE': {
    category: 'Information request — overdue',
    purpose: 'An Internal Audit information request issued to your area is now overdue.',
    actionRequired:
      'Submit the outstanding records immediately, or record the reason for non-provision against the request.',
    nextSteps: [
      'Continued non-provision will be recorded as a scope limitation and escalated to the Head of Internal Audit.',
    ],
  },
  'INTERNAL_AUDIT.REQUEST.FULFILLED': {
    purpose: 'An Internal Audit information request has been recorded as fulfilled.',
    actionRequired: null,
    nextSteps: ['The records supplied will be evaluated as part of audit testing.'],
  },
  'INTERNAL_AUDIT.REQUEST.RESPONSE_RECEIVED': {
    purpose: 'A response to an Internal Audit information request has been received.',
    actionRequired: null,
    nextSteps: ['The response will be assessed for sufficiency and completeness.'],
  },
  'INTERNAL_AUDIT.QUERY.ISSUED': {
    purpose: 'An audit query has been raised in respect of the matter described below and requires your explanation.',
    actionRequired: 'Provide a written response with supporting evidence by the due date shown above.',
  },
  'INTERNAL_AUDIT.QUERY.RESPONSE_RECEIVED': {
    purpose: 'A management response to an audit query has been received.',
    actionRequired: null,
    nextSteps: ['The response will be evaluated and the query closed or escalated to a finding.'],
  },
  'INTERNAL_AUDIT.QUERY.CLARIFICATION_REQUESTED': {
    purpose: 'Internal Audit requires clarification of the response previously submitted to an audit query.',
    actionRequired: 'Provide the clarification described above through the Internal Audit workspace.',
  },
  'INTERNAL_AUDIT.FINDING.RAISED': {
    purpose: 'An audit finding has been raised in respect of your area of responsibility.',
    actionRequired: 'Review the finding and prepare a management response with a corrective action plan.',
    nextSteps: [
      'A formal management response will be requested.',
      'Agreed corrective actions will be tracked to completion by Internal Audit.',
    ],
  },
  'INTERNAL_AUDIT.FINDING.SEVERITY_CHANGED': {
    purpose: 'The assessed severity of an existing audit finding has been changed.',
    actionRequired: null,
    nextSteps: ['Corrective action timelines may be revised to reflect the new severity.'],
  },
  'INTERNAL_AUDIT.FINDING.RESPONSE_REQUESTED': {
    purpose: 'A formal management response is required in respect of the audit finding referenced below.',
    actionRequired: 'Submit a management response, including corrective actions and target dates, by the due date shown above.',
    nextSteps: ['Internal Audit will assess the response and either accept it or request revision.'],
  },
  'INTERNAL_AUDIT.FINDING.RESPONSE_SUBMITTED': {
    purpose: 'A management response has been submitted against an audit finding.',
    actionRequired: 'Assess the submitted response and record acceptance or rejection.',
    nextSteps: ['Accepted responses become tracked corrective actions.'],
  },
  'INTERNAL_AUDIT.FINDING.RESPONSE_ACCEPTED': {
    purpose: 'The management response submitted against the audit finding below has been accepted by Internal Audit.',
    actionRequired: null,
    nextSteps: ['The agreed corrective actions will be tracked to completion and independently verified.'],
  },
  'INTERNAL_AUDIT.FINDING.RESPONSE_REJECTED': {
    purpose: 'The management response submitted against the audit finding below has not been accepted.',
    actionRequired: 'Submit a revised management response addressing the reason stated above.',
    nextSteps: ['Internal Audit will reassess the revised response.'],
  },
  'INTERNAL_AUDIT.REPORT.DRAFT_CIRCULATED': {
    purpose: 'A draft internal audit report has been circulated to you for factual accuracy review and comment.',
    actionRequired: 'Provide comments on factual accuracy by the comment due date shown above.',
    nextSteps: [
      'Comments received will be considered before the report is finalised.',
      'The report will then be submitted for quality review and issue.',
    ],
  },
  'INTERNAL_AUDIT.REPORT.QA_REQUESTED': {
    purpose: 'A quality review has been requested on the internal audit report referenced below.',
    actionRequired: 'Complete the quality review and record the outcome.',
    nextSteps: ['The report may only be issued once quality review is cleared.'],
  },
  'INTERNAL_AUDIT.REPORT.QA_CLEARED': {
    purpose: 'Quality review has been cleared for the internal audit report referenced below.',
    actionRequired: null,
    nextSteps: ['The report may now be issued to its designated recipients.'],
  },
  'INTERNAL_AUDIT.REPORT.ISSUED': {
    purpose: 'The final internal audit report referenced below has been formally issued to you.',
    actionRequired: null,
    nextSteps: [
      'Agreed corrective actions arising from the report are tracked to completion by Internal Audit.',
      'Implementation will be verified through follow-up review.',
    ],
  },
  'INTERNAL_AUDIT.ACTION.ASSIGNED': {
    purpose: 'You have been assigned ownership of the corrective action described below.',
    actionRequired: 'Confirm the action plan and record progress before the target date shown above.',
  },
  'INTERNAL_AUDIT.ACTION.DUE_SOON': {
    category: 'Corrective action — due soon',
    purpose: 'A corrective action you own is approaching its agreed target date.',
    actionRequired: 'Complete the action, or request an extension with justification, before the target date.',
  },
  'INTERNAL_AUDIT.ACTION.OVERDUE': {
    category: 'Corrective action — overdue',
    purpose: 'A corrective action you own has passed its agreed target date and is now overdue.',
    actionRequired: 'Complete the action immediately or submit an extension request with justification.',
    nextSteps: ['Continued non-completion will be escalated to senior management and reported to the audit committee.'],
  },
  'INTERNAL_AUDIT.ACTION.ESCALATED': {
    category: 'Corrective action — escalated',
    purpose: 'An overdue corrective action has been escalated for management attention.',
    actionRequired: 'Intervene to secure completion of the escalated action.',
    nextSteps: ['The escalation and its outcome will be reported in audit follow-up reporting.'],
  },
  'INTERNAL_AUDIT.ACTION.PROGRESS_RECORDED': {
    purpose: 'Progress has been recorded against a corrective action arising from an audit finding.',
    actionRequired: null,
    nextSteps: ['Internal Audit will continue to monitor the action until completion is verified.'],
  },
  'INTERNAL_AUDIT.ACTION.COMPLETION_SUBMITTED': {
    purpose: 'Completion has been submitted for a corrective action and requires independent verification.',
    actionRequired: 'Verify the evidence supplied and record a verification outcome.',
    nextSteps: ['Verified actions will be closed; unsupported claims will be returned for further evidence.'],
  },
  'INTERNAL_AUDIT.ACTION.VERIFIED': {
    purpose: 'Internal Audit has independently verified completion of the corrective action below.',
    actionRequired: null,
    nextSteps: ['The action will be formally closed.'],
  },
  'INTERNAL_AUDIT.ACTION.VERIFICATION_REJECTED': {
    purpose: 'The evidence submitted for completion of the corrective action below was not sufficient for verification.',
    actionRequired: 'Supply further evidence addressing the reason stated above.',
    nextSteps: ['Internal Audit will re-verify once adequate evidence is provided.'],
  },
  'INTERNAL_AUDIT.ACTION.EXTENSION_REQUESTED': {
    purpose: 'An extension to the agreed target date of a corrective action has been requested.',
    actionRequired: 'Assess the extension request and record an approval decision.',
    nextSteps: ['The action owner will be notified of the decision.'],
  },
  'INTERNAL_AUDIT.ACTION.EXTENSION_DECIDED': {
    purpose: 'A decision has been recorded on your request to extend the target date of a corrective action.',
    actionRequired: 'Proceed on the basis of the decision and the target date shown above.',
  },
  'INTERNAL_AUDIT.ACTION.CLOSED': {
    purpose: 'The corrective action below has been formally closed by Internal Audit.',
    actionRequired: null,
    nextSteps: ['Sustained implementation may be re-tested during follow-up review.'],
  },
  'INTERNAL_AUDIT.FOLLOWUP.SCHEDULED': {
    purpose: 'A follow-up review has been scheduled to confirm that agreed audit actions remain implemented.',
    nextSteps: ['Evidence of sustained implementation will be requested at the scheduled date.'],
  },
  'INTERNAL_AUDIT.FOLLOWUP.OUTCOME_RECORDED': {
    purpose: 'The outcome of a follow-up review has been recorded.',
    nextSteps: ['Matters not confirmed as implemented remain open and continue to be tracked.'],
  },
  'INTERNAL_AUDIT.FOLLOWUP.CARRIED_FORWARD': {
    purpose: 'An open audit matter has been carried forward into the next annual plan year.',
    nextSteps: ['The matter remains open and will be reported in the next plan year.'],
  },
};

export function internalAuditEmailContent(entry: IaCommunicationEntry): IaEmailContent {
  const base =
    DOMAIN_DEFAULTS[entry.domain] ??
    ({
      category: 'Internal audit',
      purpose: entry.description,
      actionRequired: null,
      nextSteps: ['Review the record in the Internal Audit workspace.'],
      ctaLabel: 'Open Internal Audit workspace',
    } satisfies IaEmailContent);
  const override = BY_EVENT[entry.eventCode] ?? {};
  return { ...base, ...override };
}

/** Priority chip label rendered in the header band. */
export function internalAuditPriorityLabel(entry: IaCommunicationEntry): string {
  switch (entry.priority) {
    case 'urgent':
      return 'Urgent';
    case 'high':
      return 'High priority';
    case 'low':
      return 'For information';
    default:
      return 'Standard';
  }
}

/**
 * Section-level workspace path for the event (the entity-scoped `:id` segment
 * is removed because a published template carries no per-entity value).
 */
export function internalAuditSectionPath(entry: IaCommunicationEntry): string {
  const path = String(entry.deepLink ?? '/audit');
  const cut = path.indexOf('/:');
  return (cut === -1 ? path : path.slice(0, cut)) || '/audit';
}
