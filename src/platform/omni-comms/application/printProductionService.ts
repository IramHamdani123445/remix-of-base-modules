/**
 * Omni-Comms Print / Correspondence — physical production adapter (Phase 3A).
 *
 * Boundaries (permanent):
 *   - Never imports the browser Supabase singleton; the caller passes a bound
 *     Omni-Comms RPC client.
 *   - Never queries tables directly; only bounded SECURITY DEFINER RPCs.
 *   - Never sends anything: physical production is operator-confirmed.
 */
import {
  callOmniCommsRpc,
  type OmniCommsRpcClient,
} from './omniCommsRpcErrors';
import type {
  OmniCommsPrintStatus,
  PrintItemActionInput,
  PrintItemActionResult,
  PrintItemDetail,
  PrintQueueResult,
} from './printProductionTypes';

export interface ListPrintQueueInput {
  organizationId: string;
  departmentId?: string | null;
  statuses?: readonly OmniCommsPrintStatus[] | null;
  search?: string | null;
  productionAccountId?: string | null;
  limit?: number;
  offset?: number;
}

export function listPrintQueue(
  client: OmniCommsRpcClient,
  input: ListPrintQueueInput,
): Promise<PrintQueueResult> {
  return callOmniCommsRpc<PrintQueueResult>(client, 'omni_comms_print_queue_list', {
    p_organization_id: input.organizationId,
    p_statuses: input.statuses && input.statuses.length ? [...input.statuses] : null,
    p_search: input.search ?? null,
    p_production_account_id: input.productionAccountId ?? null,
    p_department_id: input.departmentId ?? null,
    p_limit: input.limit ?? 50,
    p_offset: input.offset ?? 0,
  });
}

export function getPrintItemDetail(
  client: OmniCommsRpcClient,
  id: string,
): Promise<PrintItemDetail> {
  return callOmniCommsRpc<PrintItemDetail>(client, 'omni_comms_print_item_detail', {
    p_id: id,
  });
}

/** Creates (or resolves) the single Print Item for a produced print message. */
export function ensurePrintItem(
  client: OmniCommsRpcClient,
  messageId: string,
  productionProfile?: Record<string, unknown> | null,
  productionAccountId?: string | null,
): Promise<string> {
  return callOmniCommsRpc<string>(client, 'omni_comms_print_item_ensure', {
    p_message_id: messageId,
    p_production_profile: productionProfile ?? null,
    p_production_account_id: productionAccountId ?? null,
  });
}

export function performPrintItemAction(
  client: OmniCommsRpcClient,
  input: PrintItemActionInput,
): Promise<PrintItemActionResult> {
  return callOmniCommsRpc<PrintItemActionResult>(client, 'omni_comms_print_item_action', {
    p_id: input.id,
    p_action: input.action,
    p_expected_version: input.expectedVersion,
    p_reason: input.reason ?? null,
    p_production_account_id: input.productionAccountId ?? null,
    p_equipment_reference: input.equipmentReference ?? null,
    p_page_count: input.pageCount ?? null,
    p_correlation_id: input.correlationId ?? null,
  });
}
