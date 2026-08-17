/**
 * Omni-Comms Print — device status board.
 *
 * Boundaries (permanent):
 *   - Never imports the browser Supabase singleton; the caller passes a bound
 *     Omni-Comms RPC client.
 *   - Never queries tables directly; only the bounded SECURITY DEFINER RPC.
 *
 * Health is derived server-side from the register (status, discovery
 * freshness) and the real physical attempts recorded against each device, so
 * the board never guesses.
 */
import {
  callOmniCommsRpc,
  type OmniCommsRpcClient,
} from './omniCommsRpcErrors';

export type PrintDeviceHealth =
  | 'online'
  | 'offline'
  | 'error'
  | 'maintenance'
  | 'retired';

export const PRINT_DEVICE_HEALTH_LABELS: Record<PrintDeviceHealth, string> = {
  online: 'Online',
  offline: 'Offline',
  error: 'Error',
  maintenance: 'Maintenance',
  retired: 'Retired',
};

export interface PrintDeviceLastJob {
  print_item_id: string;
  letter_reference: string | null;
  outcome: string;
  completed_at: string | null;
  page_count: number | null;
  failure_reason: string | null;
}

export interface PrintDeviceStatusRow {
  id: string;
  code: string;
  display_name: string;
  location: string | null;
  device_type: string;
  register_status: string;
  is_default: boolean;
  discovery_source: string;
  last_seen_at: string | null;
  health: PrintDeviceHealth;
  printed_7d: number;
  failed_7d: number;
  last_job: PrintDeviceLastJob | null;
}

export interface PrintDeviceStatusResult {
  items: PrintDeviceStatusRow[];
  generated_at: string;
}

export function listPrintEquipmentStatus(
  client: OmniCommsRpcClient,
  input: { organizationId: string; departmentId?: string | null },
): Promise<PrintDeviceStatusResult> {
  return callOmniCommsRpc<PrintDeviceStatusResult>(
    client,
    'omni_comms_print_equipment_status',
    {
      p_organization_id: input.organizationId,
      p_department_id: input.departmentId ?? null,
    },
  );
}
