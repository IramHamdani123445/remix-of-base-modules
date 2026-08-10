/**
 * Omni-Comms — read-only controlled business dispatch diagnostics.
 *
 * Boundaries (permanent):
 *   - Read-only. Calling this contacts NO provider and sends nothing.
 *   - Uses the bound Omni-Comms RPC client only; never the browser Supabase
 *     singleton and never a direct table query.
 *   - Carries counts, states and bounded symbolic blocker codes only. No
 *     credential value, secret reference value, recipient or rendered content
 *     is ever returned by the server projection.
 */
import { callOmniCommsRpc, type OmniCommsRpcClient } from './omniCommsRpcErrors';

/** Raw server projection returned by `omni_comms_dispatch_diagnostics`. */
export interface DispatchDiagnosticsRow {
  dispatcher_implemented: boolean;
  live_delivery_enabled: boolean;
  release_live_state_available: boolean;
  dispatchable_channels: string[];
  organization_id: string | null;
  department_id: string | null;
  eligible_jobs: number;
  in_flight_attempts: number;
  reconciliation_required_count: number;
  business_attempts_total: number;
  business_accepted_total: number;
  business_delivered_total: number;
  ambiguous_callback_count: number;
  queued_producer_binding_count: number;
  release_state: string | null;
  release_control_id: string | null;
  /** Bounded symbolic code, e.g. `pilot_business_producer_not_selected`. */
  blocker: string | null;
}

export function getDispatchDiagnostics(
  client: OmniCommsRpcClient,
  input: { organizationId: string; departmentId?: string | null },
): Promise<DispatchDiagnosticsRow> {
  return callOmniCommsRpc<DispatchDiagnosticsRow>(
    client,
    'omni_comms_dispatch_diagnostics',
    {
      p_organization_id: input.organizationId,
      p_department_id: input.departmentId ?? null,
    },
  );
}
