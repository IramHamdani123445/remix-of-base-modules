/**
 * Omni-Comms — business-event-first Activity adapter.
 *
 * Read-only. Every call goes through the bound Omni-Comms RPC client; this
 * module never touches runtime tables with `.from()` and never imports the
 * browser Supabase singleton. Recipient destinations arrive masked.
 */
import type { OmniCommsRpcClient } from './eventCatalogueService';
import { callOmniCommsRpc } from './omniCommsRpcCall';
import {
  BUSINESS_EVENT_PAGE_SIZE_DEFAULT,
  BUSINESS_EVENT_PAGE_SIZE_MAX,
  type BusinessEventActivityDetail,
  type BusinessEventActivityFilters,
  type BusinessEventActivityPage,
} from './businessEventActivityTypes';

export * from './businessEventActivityTypes';

function clampLimit(limit: number | undefined): number {
  const n = Number.isFinite(limit) ? Number(limit) : BUSINESS_EVENT_PAGE_SIZE_DEFAULT;
  return Math.min(Math.max(Math.trunc(n), 1), BUSINESS_EVENT_PAGE_SIZE_MAX);
}

export async function listBusinessEventActivity(
  client: OmniCommsRpcClient,
  filters: BusinessEventActivityFilters,
): Promise<BusinessEventActivityPage> {
  return callOmniCommsRpc<BusinessEventActivityPage>(
    client,
    'omni_comms_business_event_activity_list',
    {
      p_organization_id: filters.organizationId,
      p_status: filters.status ?? null,
      p_module_code: filters.moduleCode ?? null,
      p_event_code: filters.eventCode ?? null,
      p_search: filters.search ?? null,
      p_limit: clampLimit(filters.limit),
      p_offset: Math.max(0, Math.trunc(filters.offset ?? 0)),
    },
  );
}

export async function getBusinessEventActivityDetail(
  client: OmniCommsRpcClient,
  params: { organizationId: string; eventId: string },
): Promise<BusinessEventActivityDetail> {
  return callOmniCommsRpc<BusinessEventActivityDetail>(
    client,
    'omni_comms_business_event_activity_detail',
    {
      p_organization_id: params.organizationId,
      p_event_id: params.eventId,
    },
  );
}
