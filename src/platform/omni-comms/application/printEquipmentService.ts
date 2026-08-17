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

export type OmniCommsPrintDiscoverySource = 'manual' | 'ipp_sync';

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
  is_default: boolean;
  discovery_source: OmniCommsPrintDiscoverySource;
  queue_name: string | null;
  device_uri: string | null;
  last_seen_at: string | null;
  updated_at: string;
}

export interface PrintEquipmentListResult {
  items: PrintEquipmentRow[];
  /** Device code pre-selected for this organisation / department, if any. */
  default_code: string | null;
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
  isDefault?: boolean;
  queueName?: string | null;
  deviceUri?: string | null;
}

export function upsertPrintEquipment(
  client: OmniCommsRpcClient,
  input: UpsertPrintEquipmentInput,
): Promise<{
  id: string;
  code: string;
  display_name: string;
  status: string;
  is_default: boolean;
}> {
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
    p_is_default: input.isDefault ?? null,
    p_queue_name: input.queueName ?? null,
    p_device_uri: input.deviceUri ?? null,
  });
}

/** Marks one active device as the pre-selected default for its department. */
export function setDefaultPrintEquipment(
  client: OmniCommsRpcClient,
  id: string,
): Promise<{ id: string; code: string; is_default: boolean }> {
  return callOmniCommsRpc(client, 'omni_comms_print_equipment_set_default', {
    p_id: id,
  });
}

/* ------------------------------------------------------------------ */
/* Network discovery sources (print agents / CUPS-IPP front ends)      */
/* ------------------------------------------------------------------ */

export type OmniCommsPrintDiscoveryMode = 'print_agent' | 'cups_http' | 'ipps';

export const OMNI_COMMS_PRINT_DISCOVERY_MODE_LABELS: Record<
  OmniCommsPrintDiscoveryMode,
  string
> = {
  print_agent: 'Print agent (HTTPS)',
  cups_http: 'CUPS server (HTTPS)',
  ipps: 'IPP Everywhere (IPPS)',
};

export interface PrintDiscoverySourceRow {
  id: string;
  code: string;
  display_name: string;
  mode: OmniCommsPrintDiscoveryMode;
  endpoint_url: string;
  status: 'active' | 'paused' | 'retired';
  department_id: string | null;
  production_account_id: string | null;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_detail: string | null;
  last_discovered_count: number;
  updated_at: string;
}

export interface PrintDiscoverySourceListResult {
  items: PrintDiscoverySourceRow[];
  manage_permitted: boolean;
  generated_at: string;
}

export function listPrintDiscoverySources(
  client: OmniCommsRpcClient,
  input: { organizationId: string; departmentId?: string | null },
): Promise<PrintDiscoverySourceListResult> {
  return callOmniCommsRpc<PrintDiscoverySourceListResult>(
    client,
    'omni_comms_print_discovery_source_list',
    {
      p_organization_id: input.organizationId,
      p_department_id: input.departmentId ?? null,
    },
  );
}

export interface UpsertPrintDiscoverySourceInput {
  organizationId: string;
  id?: string | null;
  code: string;
  displayName: string;
  endpointUrl: string;
  departmentId?: string | null;
  mode?: OmniCommsPrintDiscoveryMode;
  productionAccountId?: string | null;
  authSecretRef?: string | null;
  status?: 'active' | 'paused' | 'retired';
}

export function upsertPrintDiscoverySource(
  client: OmniCommsRpcClient,
  input: UpsertPrintDiscoverySourceInput,
): Promise<{ id: string; code: string; status: string }> {
  return callOmniCommsRpc(client, 'omni_comms_print_discovery_source_upsert', {
    p_organization_id: input.organizationId,
    p_id: input.id ?? null,
    p_code: input.code,
    p_display_name: input.displayName,
    p_endpoint_url: input.endpointUrl,
    p_department_id: input.departmentId ?? null,
    p_mode: input.mode ?? 'print_agent',
    p_production_account_id: input.productionAccountId ?? null,
    p_auth_secret_ref: input.authSecretRef ?? null,
    p_status: input.status ?? 'active',
  });
}

/** Human label used consistently in dropdowns and evidence lines. */
export function describePrintEquipment(row: PrintEquipmentRow): string {
  const bits = [row.display_name];
  if (row.location) bits.push(row.location);
  const label = `${row.code} — ${bits.join(' · ')}`;
  return row.is_default ? `${label} (default)` : label;
}

/* Last device used by this operator — a convenience pre-selection only; the
 * database remains the authority for whether the device may be recorded. */
const LAST_DEVICE_KEY = 'omni-comms.print.last-device';

export function readLastUsedPrintEquipment(): string | null {
  try {
    return globalThis.localStorage?.getItem(LAST_DEVICE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function rememberLastUsedPrintEquipment(code: string): void {
  try {
    if (code) globalThis.localStorage?.setItem(LAST_DEVICE_KEY, code);
  } catch {
    /* storage unavailable — pre-selection is optional */
  }
}

