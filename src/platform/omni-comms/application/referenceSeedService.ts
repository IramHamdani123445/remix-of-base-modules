/**
 * Omni-Comms — Reference Seed Pack application service.
 *
 * A typed adapter over the three bounded seed RPCs plus PURE derivation
 * helpers for the administration panel.
 *
 * Boundaries (enforced by OMNI_REFERENCE_SEED_BOUNDARY):
 *   - never imports the browser Supabase singleton;
 *   - never queries or writes a table with `.from(...)`;
 *   - never imports a provider SDK;
 *   - never calls the send façade or a runtime mutation;
 *   - never enables live delivery — the server refuses it and the client
 *     never offers it.
 */
import type { OmniCommsRpcClient } from './eventCatalogueService';
import { callOmniCommsRpc } from './omniCommsRpcCall';
import { OmniCommsRpcError } from './eventCatalogueTypes';
import {
  REFERENCE_SEED_OBJECT_LABELS,
  type ReferenceSeedAction,
  type ReferenceSeedGroup,
  type ReferenceSeedObjectType,
  type ReferenceSeedRunResult,
  type ReferenceSeedStatus,
} from './referenceSeedTypes';

export * from './referenceSeedTypes';

// ─── Adapter ─────────────────────────────────────────────────────────────

export function getReferenceSeedStatus(
  client: OmniCommsRpcClient,
  organizationId: string,
): Promise<ReferenceSeedStatus> {
  return callOmniCommsRpc<ReferenceSeedStatus>(
    client,
    'omni_comms_reference_seed_status',
    { p_organization_id: organizationId },
  );
}

export function previewReferenceSeed(
  client: OmniCommsRpcClient,
  organizationId: string,
): Promise<ReferenceSeedRunResult> {
  return callOmniCommsRpc<ReferenceSeedRunResult>(
    client,
    'omni_comms_reference_seed_preview',
    { p_organization_id: organizationId },
  );
}

export interface ApplyReferenceSeedInput {
  organizationId: string;
  /** Must be explicitly true — the operator confirms a non-production tenant. */
  confirmNonProduction: boolean;
  correlationId?: string | null;
}

export function applyReferenceSeed(
  client: OmniCommsRpcClient,
  input: ApplyReferenceSeedInput,
): Promise<ReferenceSeedRunResult> {
  return callOmniCommsRpc<ReferenceSeedRunResult>(
    client,
    'omni_comms_reference_seed_apply',
    {
      p_organization_id: input.organizationId,
      p_confirm_non_production: input.confirmNonProduction === true,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

// ─── Pure derivation ─────────────────────────────────────────────────────

const GROUP_ORDER: ReferenceSeedObjectType[] = [
  'provider',
  'provider_account',
  'sender_identity',
  'sender_binding',
  'channel_setting',
  'event_definition',
  'event_contract',
  'template_family',
  'template_version',
  'event_route',
];

/** Groups a run result's actions by object type, in a stable display order. */
export function groupReferenceSeedActions(
  actions: readonly ReferenceSeedAction[],
): ReferenceSeedGroup[] {
  const groups = new Map<ReferenceSeedObjectType, ReferenceSeedGroup>();
  for (const type of GROUP_ORDER) {
    groups.set(type, {
      objectType: type,
      label: REFERENCE_SEED_OBJECT_LABELS[type],
      planned: 0,
      created: 0,
      existing: 0,
      keys: [],
    });
  }
  for (const action of actions) {
    const group = groups.get(action.object_type);
    if (!group) continue;
    if (action.action === 'planned') group.planned += 1;
    if (action.action === 'created') group.created += 1;
    if (action.action === 'existing') group.existing += 1;
    group.keys.push(action.key);
  }
  return GROUP_ORDER.map((t) => groups.get(t) as ReferenceSeedGroup).filter(
    (g) => g.planned + g.created + g.existing > 0,
  );
}

/** True when the server reports no live traffic and no live-enabled channel. */
export function isSeedSafe(status: ReferenceSeedStatus | null): boolean {
  if (!status) return false;
  return (
    status.safe_to_seed === true &&
    status.live_delivery_enabled_channels === 0 &&
    status.live_requests === 0
  );
}

/** True when the catalogue is fully present for the selected organisation. */
export function isSeedComplete(status: ReferenceSeedStatus | null): boolean {
  if (!status) return false;
  return (
    status.present_events >= status.expected_events &&
    status.present_routes >= status.expected_channel_bindings &&
    status.present_published_versions >= status.expected_channel_bindings &&
    status.present_senders >= status.expected_senders &&
    status.present_accounts >= status.expected_accounts
  );
}

/** Total number of records the seed would create for a preview result. */
export function plannedTotal(result: ReferenceSeedRunResult | null): number {
  return result?.planned ?? 0;
}

export interface ReferenceSeedFailure {
  code: string;
  title: string;
  message: string;
}

/** Maps a seed RPC failure onto operator-safe guidance. */
export function mapReferenceSeedFailure(error: unknown): ReferenceSeedFailure {
  if (error instanceof OmniCommsRpcError) {
    const detail = error.detail ?? '';
    if (detail === 'reference_seed_live_traffic_detected') {
      return {
        code: detail,
        title: 'Live traffic detected',
        message:
          'This organisation already has non dry-run communication requests. The reference seed only runs against non-production tenants and has been refused.',
      };
    }
    if (detail === 'reference_seed_live_delivery_enabled') {
      return {
        code: detail,
        title: 'Live delivery is enabled',
        message:
          'At least one channel has live delivery enabled for this organisation. Disable live delivery before seeding reference data.',
      };
    }
    if (detail === 'non_production_confirmation_required') {
      return {
        code: detail,
        title: 'Confirmation required',
        message:
          'You must confirm that the selected organisation is a non-production tenant before the reference seed can be applied.',
      };
    }
    if (error.code === 'OC403') {
      return {
        code: 'permission_denied',
        title: 'Permission denied',
        message:
          'Applying reference data requires the Omni-Comms configure capability.',
      };
    }
    if (error.code === 'OC404') {
      return {
        code: 'organization_not_found',
        title: 'Organisation not found',
        message: 'Select a valid organisation and try again.',
      };
    }
    return {
      code: detail || error.code,
      title: 'Reference seed failed',
      message: detail
        ? `The reference seed could not complete (${detail}).`
        : 'The reference seed could not complete.',
    };
  }
  return {
    code: 'unknown_error',
    title: 'Reference seed failed',
    message: 'An unexpected error occurred while running the reference seed.',
  };
}
