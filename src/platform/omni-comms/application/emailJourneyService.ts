/**
 * Omni-Comms — Email journey adapter (read-only).
 *
 * Every call goes through the bound Omni-Comms RPC client. This module never
 * touches runtime tables with `.from()`, never imports the browser Supabase
 * singleton, and never receives secrets, provider payloads or Email bodies.
 * The same filter object drives the list and the summary so the pipeline
 * metrics always describe exactly the rows on screen.
 */
import type { OmniCommsRpcClient } from './eventCatalogueService';
import { callOmniCommsRpc } from './omniCommsRpcCall';
import {
  EMAIL_JOURNEY_PAGE_SIZE_DEFAULT,
  EMAIL_JOURNEY_PAGE_SIZE_MAX,
  type EmailJourneyDetail,
  type EmailJourneyFilters,
  type EmailJourneyPage,
  type EmailJourneySummary,
} from './emailJourneyTypes';

export * from './emailJourneyTypes';

function clampLimit(limit: number | undefined): number {
  const n = Number.isFinite(limit) ? Number(limit) : EMAIL_JOURNEY_PAGE_SIZE_DEFAULT;
  return Math.min(Math.max(Math.trunc(n), 1), EMAIL_JOURNEY_PAGE_SIZE_MAX);
}

function filterArgs(filters: EmailJourneyFilters): Record<string, unknown> {
  return {
    p_organization_id: filters.organizationId,
    p_module_code: filters.moduleCode ?? null,
    p_event_code: filters.eventCode ?? null,
    p_stage: filters.stage ?? null,
    p_product_id: filters.productId ?? null,
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_search: filters.search ?? null,
  };
}

export async function listEmailJourneys(
  client: OmniCommsRpcClient,
  filters: EmailJourneyFilters,
): Promise<EmailJourneyPage> {
  return callOmniCommsRpc<EmailJourneyPage>(client, 'omni_comms_email_journey_list', {
    ...filterArgs(filters),
    p_limit: clampLimit(filters.limit),
    p_offset: Math.max(0, Math.trunc(filters.offset ?? 0)),
  });
}

export async function getEmailJourneySummary(
  client: OmniCommsRpcClient,
  filters: EmailJourneyFilters,
): Promise<EmailJourneySummary> {
  return callOmniCommsRpc<EmailJourneySummary>(
    client,
    'omni_comms_email_journey_summary',
    filterArgs(filters),
  );
}

export async function getEmailJourneyDetail(
  client: OmniCommsRpcClient,
  params: { organizationId: string; messageId: string },
): Promise<EmailJourneyDetail> {
  return callOmniCommsRpc<EmailJourneyDetail>(
    client,
    'omni_comms_email_journey_detail',
    {
      p_organization_id: params.organizationId,
      p_message_id: params.messageId,
    },
  );
}
