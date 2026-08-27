/**
 * INTERNAL AUDIT → OMNI-COMMS template registry (Wave 4).
 *
 * Composes the published Email and In-App template content for every event in
 * the Internal Audit communication catalogue, together with the exact token
 * vocabulary the published event contract enforces and a total payload builder
 * that can never under-supply a token (the runtime renderer throws on a missing
 * token, so the producer must always supply every declared token).
 *
 * Pure data + pure functions. No Supabase client, no React, no provider SDK.
 */
import {
  INTERNAL_AUDIT_COMMUNICATION_CATALOGUE,
  internalAuditEntry,
  internalAuditFamilyCode,
  internalAuditTokens,
  type IaCommunicationEntry,
} from '../internalAuditCommunicationCatalogue';

/** Value used when the business layer has no value for a declared token. */
export const IA_TOKEN_PLACEHOLDER = 'Not stated';

export interface ComposedIaEmail {
  subject: string;
  text: string;
  html: string;
}

export interface ComposedIaInApp {
  title: string;
  body: string;
}

export interface InternalAuditTemplateEntry {
  eventCode: string;
  entityType: string;
  familyCode: string;
  name: string;
  description: string;
  recipientRole: string;
  tokens: string[];
  variants: {
    email: ComposedIaEmail;
    in_app: ComposedIaInApp;
  };
  samplePayload: Record<string, string>;
  entry: IaCommunicationEntry;
}

/** `targetDate` → `Target date`. Deterministic, human-readable fact labels. */
export function factLabel(token: string): string {
  const spaced = token
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function token(name: string): string {
  return `{{payload.${name}}}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function composeIaEmail(entry: IaCommunicationEntry): ComposedIaEmail {
  const factLines = entry.facts.map((fact) => `${factLabel(fact)}: ${token(fact)}`);
  const text = [
    `Dear ${token('subjectName')},`,
    '',
    entry.lead,
    '',
    ...factLines,
    '',
    `Reference: ${token('reference')}`,
    '',
    'This message was issued by the Internal Audit unit of the',
    'St. Kitts & Nevis Social Security Board.',
  ].join('\n');

  const html = [
    `<p>Dear ${token('subjectName')},</p>`,
    `<p>${escapeHtml(entry.lead)}</p>`,
    '<table role="presentation" cellpadding="6" cellspacing="0">',
    ...entry.facts.map(
      (fact) =>
        `<tr><td><strong>${escapeHtml(factLabel(fact))}</strong></td><td>${token(fact)}</td></tr>`,
    ),
    `<tr><td><strong>Reference</strong></td><td>${token('reference')}</td></tr>`,
    '</table>',
    '<p>This message was issued by the Internal Audit unit of the St. Kitts &amp; Nevis Social Security Board.</p>',
  ].join('\n');

  return { subject: entry.headline, text, html };
}

export function composeIaInApp(entry: IaCommunicationEntry): ComposedIaInApp {
  const primaryFact = entry.facts[0];
  const detail = primaryFact
    ? ` ${factLabel(primaryFact)}: ${token(primaryFact)}.`
    : '';
  return {
    title: entry.headline,
    body: `${entry.lead}${detail} Reference ${token('reference')}.`,
  };
}

/** Plausible sample values so the published contract is reviewable. */
const SAMPLE_VALUES: Record<string, string> = {
  subjectName: 'Marcia Liburd',
  reference: 'IA-2026-000117',
  planYear: '2026',
  submittedOn: '14 August 2026',
  approvedOn: '18 August 2026',
  approvedBy: 'Head of Internal Audit',
  planTitle: 'Annual Internal Audit Plan 2026',
  distributionPurpose: 'Official final distribution',
  artifactName: 'Internal-Audit-Plan-2026-v2.pdf',
  artifactVersion: '2',
  distributedOn: '19 August 2026',

  decidedOn: '19 August 2026',
  decisionReason: 'Coverage of the payments cycle was insufficient',
  requestedOn: '20 August 2026',
  revisionReason: 'A new high-risk auditable unit was added to the universe',
  closedOn: '15 December 2026',
  carriedForwardCount: '3',
  engagementCount: '18',
  conflictSummary: 'Assigned auditor worked in the auditee unit within the last 12 months',
  detectedOn: '21 August 2026',
  engagementTitle: 'Contributions collection and posting',
  auditeeUnit: 'Contributions Department',
  launchedOn: '24 August 2026',
  plannedStartDate: '1 September 2026',
  plannedEndDate: '30 September 2026',
  scopeSummary: 'Contribution receipting, posting and reconciliation controls',
  meetingDateTime: '2 September 2026 at 10:00',
  meetingLocation: 'Head Office, Conference Room 2',
  completedOn: '26 September 2026',
  findingCount: '6',
  openActionCount: '2',
  requestSummary: 'Contribution reconciliation working papers for July 2026',
  dueDate: '8 September 2026',
  daysRemaining: '3',
  daysOverdue: '5',
  findingTitle: 'Contribution reconciliations were not independently reviewed',
  severity: 'High',
  previousSeverity: 'Medium',
  changeReason: 'Additional exceptions were identified during testing',
  raisedOn: '15 September 2026',
  responseSummary: 'A monthly independent review will be introduced from October 2026',
  reviewerComment: 'The proposed control addresses the root cause',
  versionNumber: '2',
  commentDueDate: '10 October 2026',
  qaOutcome: 'Cleared with no matters outstanding',
  issuedOn: '20 October 2026',
  overallOpinion: 'Partially satisfactory',
  actionTitle: 'Introduce independent monthly reconciliation review',
  targetDate: '30 November 2026',
  requestedDate: '31 January 2027',
  extensionReason: 'System change required to produce the reconciliation report',
  extensionOutcome: 'Approved',
  progressPercent: '60',
  progressNote: 'Reviewer appointed and procedure drafted',
  completionSummary: 'Procedure issued and first review completed',
  verifiedOn: '5 December 2026',
  verificationComment: 'Evidence inspected for October and November 2026',
  rejectionReason: 'Evidence supplied covered one month only',
  closureBasis: 'Verified effective by Internal Audit',
  ownerName: 'Director of Contributions',
  followupSubject: 'Contributions reconciliation review',
  scheduledFor: '15 March 2027',
  recordedOn: '18 March 2027',
  followupOutcome: 'Implemented and operating effectively',
  fromPlanYear: '2026',
  toPlanYear: '2027',
};

function sampleFor(tokenName: string): string {
  return SAMPLE_VALUES[tokenName] ?? IA_TOKEN_PLACEHOLDER;
}

export const INTERNAL_AUDIT_TEMPLATE_ENTRIES: InternalAuditTemplateEntry[] =
  INTERNAL_AUDIT_COMMUNICATION_CATALOGUE.map((entry) => {
    const tokens = internalAuditTokens(entry);
    const samplePayload: Record<string, string> = {};
    for (const name of tokens) samplePayload[name] = sampleFor(name);
    return {
      eventCode: entry.eventCode,
      entityType: entry.entityType,
      familyCode: internalAuditFamilyCode(entry),
      name: entry.name,
      description: entry.description,
      recipientRole: entry.recipientRole,
      tokens,
      variants: { email: composeIaEmail(entry), in_app: composeIaInApp(entry) },
      samplePayload,
      entry,
    };
  });

const BY_CODE = new Map<string, InternalAuditTemplateEntry>(
  INTERNAL_AUDIT_TEMPLATE_ENTRIES.map((row) => [row.eventCode, row]),
);

export function internalAuditTemplateEntry(
  eventCode: string,
): InternalAuditTemplateEntry | null {
  return BY_CODE.get(String(eventCode ?? '').trim().toUpperCase()) ?? null;
}

/**
 * Total payload builder: every declared token is present, with an honest
 * placeholder where the business layer supplied nothing.
 */
export function buildInternalAuditPayload(
  eventCode: string,
  values: Record<string, unknown>,
): Record<string, string> {
  const entry = internalAuditEntry(eventCode);
  if (!entry) return {};
  const payload: Record<string, string> = {};
  for (const name of internalAuditTokens(entry)) {
    const raw = values?.[name];
    const text =
      raw === null || raw === undefined || String(raw).trim() === ''
        ? IA_TOKEN_PLACEHOLDER
        : String(raw).trim();
    payload[name] = text;
  }
  return payload;
}
