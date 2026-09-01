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
import {
  IA_ORGANISATION_NAME,
  IA_UNIT_NAME,
  internalAuditEmailContent,
  internalAuditPriorityLabel,
  internalAuditSectionPath,
} from './internalAuditEmailContent';

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

/** Internal Audit workspace base, used for the section-level call to action. */
const IA_WORKSPACE_BASE = 'https://internalaudit.secureserve.biz';

const CONFIDENTIALITY =
  'This communication is issued by the Internal Audit Unit and is intended solely for the named recipient. ' +
  'Its contents are confidential and must not be forwarded or reproduced without the authorisation of the Head of Internal Audit.';

const NO_REPLY =
  'This message was generated automatically by the Internal Audit system. Please do not reply to this address — ' +
  'respond through the Internal Audit workspace so that your response is recorded on the audit file.';

export function composeIaEmail(entry: IaCommunicationEntry): ComposedIaEmail {
  const content = internalAuditEmailContent(entry);
  const priority = internalAuditPriorityLabel(entry);
  const link = `${IA_WORKSPACE_BASE}${internalAuditSectionPath(entry)}`;
  const actionLine = content.actionRequired;

  // ── Plain-text variant ────────────────────────────────────────────────
  const text = [
    `${IA_ORGANISATION_NAME}`,
    `${IA_UNIT_NAME} — ${content.category} (${priority})`,
    '',
    `Dear ${token('subjectName')},`,
    '',
    content.purpose,
    '',
    'DETAILS',
    ...entry.facts.map((fact) => `- ${factLabel(fact)}: ${token(fact)}`),
    `- Audit reference: ${token('reference')}`,
    '',
    ...(actionLine ? ['ACTION REQUIRED', actionLine, ''] : []),
    'WHAT HAPPENS NEXT',
    ...content.nextSteps.map((step, i) => `${i + 1}. ${step}`),
    '',
    `${content.ctaLabel}: ${link}`,
    '',
    NO_REPLY,
    '',
    CONFIDENTIALITY,
    '',
    `${IA_UNIT_NAME}, ${IA_ORGANISATION_NAME}`,
  ].join('\n');

  // ── HTML variant (table-based, inline styles, email-client safe) ───────
  const detailRows = [
    ...entry.facts.map(
      (fact) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #e6e8ec;font-size:13px;color:#5b6472;width:38%;">${escapeHtml(
          factLabel(fact),
        )}</td><td style="padding:8px 12px;border-bottom:1px solid #e6e8ec;font-size:13px;color:#101828;font-weight:600;">${token(
          fact,
        )}</td></tr>`,
    ),
    `<tr><td style="padding:8px 12px;font-size:13px;color:#5b6472;">Audit reference</td><td style="padding:8px 12px;font-size:13px;color:#101828;font-weight:600;">${token(
      'reference',
    )}</td></tr>`,
  ];

  const html = [
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 0;font-family:Georgia,\'Times New Roman\',serif;">',
    '<tr><td align="center">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #dfe3e8;">',
    // Header band
    '<tr><td style="background:#0b3d2c;padding:20px 24px;">',
    `<div style="color:#ffffff;font-size:16px;font-weight:700;letter-spacing:0.3px;">${escapeHtml(IA_ORGANISATION_NAME)}</div>`,
    `<div style="color:#bcd8cc;font-size:12px;margin-top:4px;text-transform:uppercase;letter-spacing:1px;">${escapeHtml(IA_UNIT_NAME)} &middot; ${escapeHtml(content.category)} &middot; ${escapeHtml(priority)}</div>`,
    '</td></tr>',
    // Body
    '<tr><td style="padding:24px;font-family:Arial,Helvetica,sans-serif;">',
    `<p style="margin:0 0 14px;font-size:14px;color:#101828;">Dear ${token('subjectName')},</p>`,
    `<p style="margin:0 0 18px;font-size:14px;line-height:22px;color:#344054;">${escapeHtml(content.purpose)}</p>`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e8ec;border-collapse:collapse;margin:0 0 18px;">',
    ...detailRows,
    '</table>',
    ...(actionLine
      ? [
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;"><tr><td style="border-left:4px solid #b54708;background:#fffaeb;padding:12px 14px;">',
          '<div style="font-size:12px;font-weight:700;color:#b54708;text-transform:uppercase;letter-spacing:0.6px;">Action required</div>',
          `<div style="font-size:14px;line-height:21px;color:#41300a;margin-top:6px;">${escapeHtml(actionLine)}</div>`,
          '</td></tr></table>',
        ]
      : []),
    '<div style="font-size:12px;font-weight:700;color:#0b3d2c;text-transform:uppercase;letter-spacing:0.6px;margin:0 0 8px;">What happens next</div>',
    '<ol style="margin:0 0 20px;padding-left:20px;font-size:14px;line-height:22px;color:#344054;">',
    ...content.nextSteps.map((step) => `<li>${escapeHtml(step)}</li>`),
    '</ol>',
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#0b3d2c;padding:11px 22px;"><a href="${link}" style="color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">${escapeHtml(content.ctaLabel)}</a></td></tr></table>`,
    `<p style="margin:18px 0 0;font-size:12px;line-height:19px;color:#667085;">${escapeHtml(NO_REPLY)}</p>`,
    '</td></tr>',
    // Footer
    '<tr><td style="background:#f8f9fa;border-top:1px solid #e6e8ec;padding:16px 24px;font-family:Arial,Helvetica,sans-serif;">',
    `<p style="margin:0 0 8px;font-size:11px;line-height:17px;color:#667085;">${escapeHtml(CONFIDENTIALITY)}</p>`,
    `<p style="margin:0;font-size:11px;color:#98a2b3;">${escapeHtml(IA_UNIT_NAME)}, ${escapeHtml(IA_ORGANISATION_NAME)}</p>`,
    '</td></tr>',
    '</table></td></tr></table>',
  ].join('\n');

  const subjectPrefix = content.actionRequired ? 'Action required' : 'Internal Audit';
  return { subject: `[${subjectPrefix}] ${entry.headline}`, text, html };
}

export function composeIaInApp(entry: IaCommunicationEntry): ComposedIaInApp {
  const content = internalAuditEmailContent(entry);
  const primaryFact = entry.facts[0];
  const detail = primaryFact ? ` ${factLabel(primaryFact)}: ${token(primaryFact)}.` : '';
  const action = content.actionRequired ? ` Action required: ${content.actionRequired}` : '';
  return {
    title: entry.headline,
    body: `${entry.lead}${detail} Reference ${token('reference')}.${action}`,
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
  previousStartDate: '1 September 2026',
  previousEndDate: '30 September 2026',
  rescheduleReason: 'Auditee system upgrade during the original window',
  postponementReason: 'Key auditee staff unavailable',
  postponedOn: '22 August 2026',
  cancelledOn: '23 August 2026',
  cancellationReason: 'Auditable area transferred to an external review',
  receivedOn: '9 September 2026',
  querySummary: 'Explanation of unreconciled contribution receipts for July 2026',
  clarificationSummary: 'Supporting bank statement for the reconciling items',
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

/**
 * Declared tokens for which the business layer supplied no value.
 *
 * A professional audit communication must never render "Not stated" in place
 * of a business fact, so the producer blocks emission when this is non-empty.
 */
export function missingInternalAuditFacts(
  eventCode: string,
  values: Record<string, unknown>,
): string[] {
  const entry = internalAuditEntry(eventCode);
  if (!entry) return [];
  return internalAuditTokens(entry).filter((name) => {
    const raw = values?.[name];
    return raw === null || raw === undefined || String(raw).trim() === '';
  });
}
