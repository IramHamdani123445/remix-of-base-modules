/**
 * Omni-Comms Print — registered production equipment (printers, inserters,
 * bureaux).
 *
 * Boundaries (permanent):
 *   - Never imports the browser Supabase singleton; callers pass a bound
 *     Omni-Comms RPC client.
 *   - Never queries tables directly; only bounded SECURITY DEFINER RPCs.
 *
 * "Equipment reference" is no longer free text: the database binds every
 * physical print attempt to a registered, tenant-scoped device, so a typed
 * or retired device is rejected server-side.
 */
import {
  callOmniCommsRpc,
  type OmniCommsRpcClient,
} from './omniCommsRpcErrors';

export const OMNI_COMMS_PRINT_DEVICE_TYPES = [
  'printer',
  'mfp',
  'high_volume_printer',
  'mail_inserter',
  'outsourced_bureau',
] as const;

export type OmniCommsPrintDeviceType =
  (typeof OMNI_COMMS_PRINT_DEVICE_TYPES)[number];

export const OMNI_COMMS_PRINT_DEVICE_TYPE_LABELS: Record<
  OmniCommsPrintDeviceType,
  string
> = {
  printer: 'Printer',
  mfp: 'Multi-function device',
  high_volume_printer: 'High-volume printer',
  mail_inserter: 'Mail inserter',
  outsourced_bureau: 'Outsourced print bureau',
};

export type OmniCommsPrintEquipmentStatus = 'active' | 'maintenance' | 'retired';

export interface PrintEquipmentRow {
  id: string;
  code: string;
  display_name: string;
  location: string | null;
  device_type: OmniCommsPrintDeviceType;
  status: OmniCommsPrintEquipmentStatus;
  department_id: string | null;
  production_account_id: string | null;
  production_account_name: string | null;
  paper_sizes: string[];
  duplex_capable: boolean;
  colour_capable: boolean;
  notes: string | null;
  updated_at: string;
}

export interface PrintEquipmentListResult {
  items: PrintEquipmentRow[];
  manage_permitted: boolean;
  generated_at: string;
}

export function listPrintEquipment(
  client: OmniCommsRpcClient,
  input: {
    organizationId: string;
    departmentId?: string | null;
    includeInactive?: boolean;
  },
): Promise<PrintEquipmentListResult> {
  return callOmniCommsRpc<PrintEquipmentListResult>(
    client,
    'omni_comms_print_equipment_list',
    {
      p_organization_id: input.organizationId,
      p_department_id: input.departmentId ?? null,
      p_include_inactive: input.includeInactive ?? false,
    },
  );
}

export interface UpsertPrintEquipmentInput {
  organizationId: string;
  id?: string | null;
  code: string;
  displayName: string;
  departmentId?: string | null;
  location?: string | null;
  deviceType?: OmniCommsPrintDeviceType;
  productionAccountId?: string | null;
  paperSizes?: string[] | null;
  duplexCapable?: boolean;
  colourCapable?: boolean;
  status?: OmniCommsPrintEquipmentStatus;
  notes?: string | null;
}

export function upsertPrintEquipment(
  client: OmniCommsRpcClient,
  input: UpsertPrintEquipmentInput,
): Promise<{ id: string; code: string; display_name: string; status: string }> {
  return callOmniCommsRpc(client, 'omni_comms_print_equipment_upsert', {
    p_organization_id: input.organizationId,
    p_id: input.id ?? null,
    p_code: input.code,
    p_display_name: input.displayName,
    p_department_id: input.departmentId ?? null,
    p_location: input.location ?? null,
    p_device_type: input.deviceType ?? 'printer',
    p_production_account_id: input.productionAccountId ?? null,
    p_paper_sizes: input.paperSizes ?? null,
    p_duplex_capable: input.duplexCapable ?? true,
    p_colour_capable: input.colourCapable ?? false,
    p_status: input.status ?? 'active',
    p_notes: input.notes ?? null,
  });
}

/** Human label used consistently in dropdowns and evidence lines. */
export function describePrintEquipment(row: PrintEquipmentRow): string {
  const bits = [row.display_name];
  if (row.location) bits.push(row.location);
  return `${row.code} — ${bits.join(' · ')}`;
}
