/**
 * Benefits claim communications — Phase 2 & 3 of the Omni-Comms cutover.
 *
 * The claim screen raises communications ONLY through the single Omni-Comms
 * façade (via the Benefits producer) and reads its timeline ONLY from the
 * Omni-Comms business-event Activity read model.
 *
 * This module:
 *  - never picks a template, channel, branding or sender,
 *  - never writes to notification_queue / notification_logs /
 *    in_app_notifications / bn_communication_log / bn_letter,
 *  - never contacts a provider.
 *
 * It only supplies business facts (recipient, reference, values) and reads
 * back governed state.
 */
import { emitBenefitsCommunication } from '@/platform/omni-comms/integrations/business/benefits/benefitsCommunicationProducer';
import { resolveBusinessCommunicationScope } from '@/platform/omni-comms/integrations/business/businessScopeResolver';
import {
  listBusinessEventActivity,
  type BusinessEventActivityRow,
} from '@/platform/omni-comms/application/businessEventActivityService';
import type { OmniCommsRpcClient } from '@/platform/omni-comms/application/eventCatalogueService';
import { buildBnMergeContext, resolveRecipient, type BnCommContext } from './bnCommunicationAdapter';
import { resolveBnOmniEvent } from './bnOmniCommsEventMap';

export const BN_CLAIM_ENTITY_TYPE = 'bn_claim';
export const BN_CLAIM_OMNI_MODULE_CODE = 'BENEFITS';

export interface BnOmniTriggerResult {
  legacyEventCode: string;
  omniEventCode: string | null;
  outcome: 'accepted' | 'replayed' | 'blocked' | 'unavailable';
  blockers: string[];
  requestId: string | null;
  message: string;
}

function blocked(
  legacyEventCode: string,
  omniEventCode: string | null,
  code: string,
  message: string,
): BnOmniTriggerResult {
  return { legacyEventCode, omniEventCode, outcome: 'blocked', blockers: [code], requestId: null, message };
}

/**
 * Map the Benefits merge context onto the canonical template token
 * vocabulary. Unused names are ignored by the template registry, and any
 * token the business cannot supply is filled with the canonical placeholder.
 */
function buildValues(ctx: Record<string, unknown>): Record<string, unknown> {
  const g = (k: string) => (ctx[k] as string | undefined) || '';
  return {
    claimType: g('BenefitType') || g('BenefitName'),
    benefitType: g('BenefitType'),
    submittedOn: g('SubmissionDate'),
    claimStatus: g('ClaimStatus') || 'Awaiting assessment',
    decisionDate: g('DecisionDate'),
    decidedOn: g('DecisionDate'),
    reason: g('ReasonDescription'),
    reasonRecorded: g('ReasonDescription'),
    withdrawalReason: g('ReasonDescription'),
    withdrawnOn: g('Today'),
    appealDeadline: g('AppealDeadline'),
    appealInstructions: g('AppealInstructions'),
    documentsRequested: g('MissingDocuments'),
    documentsRequired: g('MissingDocuments'),
    documentsReceived: g('MissingDocuments'),
    dueDate: g('DueDate'),
    respondBy: g('DueDate'),
    weeklyRate: g('WeeklyRate'),
    monthlyRate: g('MonthlyRate'),
    amount: g('LumpSum') || g('MonthlyRate') || g('WeeklyRate'),
    effectiveDate: g('EffectiveDate'),
    paymentDate: g('EffectiveDate'),
    paymentMethod: g('PaymentMethod'),
    nextSteps: g('NextSteps'),
    officeContact: g('OfficeContact') || g('OfficePhone'),
    officePhone: g('OfficePhone'),
    officeEmail: g('OfficeEmail'),
    issuedOn: g('Today'),
    recordedOn: g('Today'),
  };
}

/**
 * Raise a claim communication through Omni-Comms.
 *
 * Accepts either a legacy `bn.*` code (from the existing screen/workflows) or
 * a canonical `BENEFITS.*` code.
 */
export async function triggerClaimCommunicationViaOmniComms(
  eventCode: string,
  claimId: string,
  ctx?: BnCommContext,
): Promise<BnOmniTriggerResult> {
  const resolution = resolveBnOmniEvent(eventCode);

  if (!resolution.supported) {
    return blocked(
      resolution.legacyEventCode,
      resolution.omniEventCode,
      resolution.gapReason ?? 'not_mapped',
      resolution.gapReason === 'no_published_template'
        ? `No published Omni-Comms template exists yet for ${resolution.omniEventCode}.`
        : `${resolution.legacyEventCode} is not mapped to an Omni-Comms event yet.`,
    );
  }

  const scope = await resolveBusinessCommunicationScope({
    moduleCode: BN_CLAIM_OMNI_MODULE_CODE,
  });
  if (!scope.organizationId) {
    return blocked(
      resolution.legacyEventCode,
      resolution.omniEventCode,
      'organization_unresolved',
      'No organisation context could be resolved for the Benefits module.',
    );
  }

  const merge = await buildBnMergeContext(claimId, ctx?.extra);
  const claimant = await resolveRecipient(claimId, 'CLAIMANT', 'EMAIL', ctx);

  const reference = String(merge.ClaimNumber || claimId);
  const subjectName = String(claimant?.name || merge.ClaimantName || '').trim();

  const result = await emitBenefitsCommunication({
    eventCode: resolution.omniEventCode!,
    organizationId: scope.organizationId,
    departmentId: scope.departmentId,
    entityType: BN_CLAIM_ENTITY_TYPE,
    entityId: claimId,
    entityVersion: `${resolution.omniEventCode!.toLowerCase()}-v1`,
    subjectName: subjectName || 'Claimant',
    reference,
    recipientEmail: claimant?.email ?? null,
    values: buildValues(merge),
    correlationId: `bn-claim:${claimId}:${resolution.omniEventCode!.toLowerCase()}`,
  });

  const message =
    result.outcome === 'accepted'
      ? 'Communication raised — Omni-Comms will render, govern and deliver it.'
      : result.outcome === 'replayed'
        ? 'Already raised for this claim — the existing communication was returned.'
        : result.outcome === 'unavailable'
          ? 'Omni-Comms runtime is unavailable. Nothing was sent.'
          : `Blocked: ${result.blockers.join(', ') || 'unknown'}`;

  return {
    legacyEventCode: resolution.legacyEventCode,
    omniEventCode: resolution.omniEventCode,
    outcome: result.outcome,
    blockers: result.blockers ?? [],
    requestId: result.requestId,
    message,
  };
}

export interface BnClaimOmniActivity {
  rows: BusinessEventActivityRow[];
  organizationId: string | null;
}

/**
 * Read the claim's communications from the Omni-Comms Activity read model.
 * Read-only; recipient destinations arrive masked from the server.
 */
export async function listClaimOmniCommsActivity(
  client: OmniCommsRpcClient,
  claimId: string,
): Promise<BnClaimOmniActivity> {
  const scope = await resolveBusinessCommunicationScope({
    moduleCode: BN_CLAIM_OMNI_MODULE_CODE,
  });
  if (!scope.organizationId) return { rows: [], organizationId: null };

  const page = await listBusinessEventActivity(client, {
    organizationId: scope.organizationId,
    moduleCode: BN_CLAIM_OMNI_MODULE_CODE,
    search: claimId,
    limit: 100,
    offset: 0,
  });

  const rows = (page.items ?? []).filter(
    (r) => r.entity_type === BN_CLAIM_ENTITY_TYPE && r.entity_id === claimId,
  );
  return { rows: [...rows], organizationId: scope.organizationId };
}
