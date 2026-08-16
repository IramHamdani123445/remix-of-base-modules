/**
 * Omni-Comms Print / Correspondence — batch production adapter (Phase 3B).
 *
 * Boundaries (permanent):
 *   - Only bounded SECURITY DEFINER RPCs; the browser never writes to the
 *     batch tables directly.
 *   - Batch actions coordinate the existing Print Item state machine and the
 *     existing immutable Print Attempt model. Nothing here dispatches post.
 */
import {
  callOmniCommsRpc,
  type OmniCommsRpcClient,
} from './omniCommsRpcErrors';
import type {
  OmniCommsPrintBatchAction,
  OmniCommsPrintBatchStatus,
  PrintBatchDetail,
  PrintBatchListResult,
  PrintBatchPreview,
} from './printBatchTypes';

export interface ListPrintBatchesInput {
  organizationId: string;
  statuses?: readonly OmniCommsPrintBatchStatus[] | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export function listPrintBatches(
  client: OmniCommsRpcClient,
  input: ListPrintBatchesInput,
): Promise<PrintBatchListResult> {
  return callOmniCommsRpc<PrintBatchListResult>(client, 'omni_comms_print_batch_list', {
    p_organization_id: input.organizationId,
    p_statuses: input.statuses && input.statuses.length ? [...input.statuses] : null,
    p_search: input.search ?? null,
    p_limit: input.limit ?? 50,
    p_offset: input.offset ?? 0,
  });
}

export function getPrintBatchDetail(
  client: OmniCommsRpcClient,
  id: string,
): Promise<PrintBatchDetail> {
  return callOmniCommsRpc<PrintBatchDetail>(client, 'omni_comms_print_batch_detail', {
    p_id: id,
  });
}

/** Pre-creation compatibility and volume preview for a selection. */
export function previewPrintBatch(
  client: OmniCommsRpcClient,
  organizationId: string,
  printItemIds: readonly string[],
): Promise<PrintBatchPreview> {
  return callOmniCommsRpc<PrintBatchPreview>(client, 'omni_comms_print_batch_preview', {
    p_organization_id: organizationId,
    p_print_item_ids: [...printItemIds],
  });
}

export interface CreatePrintBatchResult {
  id: string;
  batch_reference: string;
  status: OmniCommsPrintBatchStatus;
  version: number;
  item_count: number;
  profile_signature: string;
  production_account_id: string | null;
}

export function createPrintBatch(
  client: OmniCommsRpcClient,
  input: {
    organizationId: string;
    printItemIds: readonly string[];
    notes?: string | null;
    departmentId?: string | null;
  },
): Promise<CreatePrintBatchResult> {
  return callOmniCommsRpc<CreatePrintBatchResult>(client, 'omni_comms_print_batch_create', {
    p_organization_id: input.organizationId,
    p_print_item_ids: [...input.printItemIds],
    p_notes: input.notes ?? null,
    p_department_id: input.departmentId ?? null,
  });
}

export function changePrintBatchMembership(
  client: OmniCommsRpcClient,
  input: {
    batchId: string;
    operation: 'add' | 'remove';
    printItemIds: readonly string[];
    expectedVersion: number;
    reason?: string | null;
  },
): Promise<{ id: string; status: OmniCommsPrintBatchStatus; version: number; changed: number }> {
  return callOmniCommsRpc(client, 'omni_comms_print_batch_membership', {
    p_batch_id: input.batchId,
    p_operation: input.operation,
    p_print_item_ids: [...input.printItemIds],
    p_expected_version: input.expectedVersion,
    p_reason: input.reason ?? null,
  });
}

/** Governed removal from the current run; the letter stays alive for a later batch. */
export function deferPrintBatchItem(
  client: OmniCommsRpcClient,
  input: {
    batchId: string;
    printItemId: string;
    reason: string;
    expectedItemVersion?: number | null;
  },
): Promise<{ batch_id: string; print_item_id: string; membership_status: string }> {
  return callOmniCommsRpc(client, 'omni_comms_print_batch_defer_item', {
    p_batch_id: input.batchId,
    p_print_item_id: input.printItemId,
    p_reason: input.reason,
    p_expected_item_version: input.expectedItemVersion ?? null,
  });
}

export interface PrintBatchActionResult {
  id: string;
  batch_reference: string;
  status: OmniCommsPrintBatchStatus;
  version: number;
  attempts_started: number;
  reconciliation: PrintBatchDetail['reconciliation'];
}

export function performPrintBatchAction(
  client: OmniCommsRpcClient,
  input: {
    id: string;
    action: OmniCommsPrintBatchAction;
    expectedVersion: number;
    reason?: string | null;
    equipmentReference?: string | null;
    override?: boolean;
  },
): Promise<PrintBatchActionResult> {
  return callOmniCommsRpc<PrintBatchActionResult>(client, 'omni_comms_print_batch_action', {
    p_id: input.id,
    p_action: input.action,
    p_expected_version: input.expectedVersion,
    p_reason: input.reason ?? null,
    p_equipment_reference: input.equipmentReference ?? null,
    p_override: input.override ?? false,
  });
}
