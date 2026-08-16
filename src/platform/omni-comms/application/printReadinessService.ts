/**
 * Omni-Comms Print — readiness, provisioning and the production gate.
 *
 * Boundaries (permanent):
 *   - Only bounded SECURITY DEFINER RPCs; never direct table access.
 *   - The browser never decides readiness: the server projects it.
 */
import {
  callOmniCommsRpc,
  type OmniCommsRpcClient,
} from './omniCommsRpcErrors';
import type { PrintReadinessResult } from './printReadinessTypes';

export function getPrintReadiness(
  client: OmniCommsRpcClient,
  organizationId: string,
  departmentId?: string | null,
): Promise<PrintReadinessResult> {
  return callOmniCommsRpc<PrintReadinessResult>(
    client,
    'omni_comms_print_readiness',
    { p_organization_id: organizationId, p_department_id: departmentId ?? null },
  );
}

export interface PrintProvisionResult {
  provider_id: string;
  provider_account_id: string;
  sender_identity_id: string;
  endpoint_id: string;
  binding_id: string;
  release_control_id: string;
}

/** Idempotently creates the internal Print account, identity, endpoint and binding. */
export function provisionPrintDefaults(
  client: OmniCommsRpcClient,
  organizationId: string,
  departmentId?: string | null,
): Promise<PrintProvisionResult> {
  return callOmniCommsRpc<PrintProvisionResult>(
    client,
    'omni_comms_print_provision_defaults',
    { p_organization_id: organizationId, p_department_id: departmentId ?? null },
  );
}

export interface PrintReleaseResult {
  id: string;
  release_state: string;
  release_version: number;
}

/** The real Print production gate: turning it off genuinely stops printing. */
export function setPrintRelease(
  client: OmniCommsRpcClient,
  organizationId: string,
  enabled: boolean,
  reason?: string | null,
): Promise<PrintReleaseResult> {
  return callOmniCommsRpc<PrintReleaseResult>(
    client,
    'omni_comms_print_release_set',
    {
      p_organization_id: organizationId,
      p_enabled: enabled,
      p_reason: reason ?? null,
    },
  );
}
