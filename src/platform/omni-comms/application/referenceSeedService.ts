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
  type ReferenceSeedCoverageRow,
  type ReferenceSeedGroup,
  type ReferenceSeedObjectType,
  type ReferenceSeedReadinessRow,
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

/**
 * Repairs seed-owned records that exist but are incomplete (unpublished
 * contracts or templates, draft families/routes, missing layout selection).
 * Administrator-owned records are never modified — they are reported as
 * conflicts instead.
 */
export function reconcileReferenceSeed(
  client: OmniCommsRpcClient,
  input: ApplyReferenceSeedInput,
): Promise<ReferenceSeedRunResult> {
  return callOmniCommsRpc<ReferenceSeedRunResult>(
    client,
    'omni_comms_reference_seed_reconcile',
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
      conflicts: 0,
      blocked: 0,
      keys: [],
    });
  }
  for (const action of actions) {
    const group = groups.get(action.object_type);
    if (!group) continue;
    if (action.action === 'planned') group.planned += 1;
    if (action.action === 'created') group.created += 1;
    if (action.action === 'existing' || action.action === 'existing_compatible')
      group.existing += 1;
    if (action.action === 'conflict') group.conflicts += 1;
    if (action.action === 'blocked') group.blocked += 1;
    group.keys.push(action.key);
  }
  return GROUP_ORDER.map((t) => groups.get(t) as ReferenceSeedGroup).filter(
    (g) => g.planned + g.created + g.existing + g.conflicts + g.blocked > 0,
  );
}

/** Every action that needs an operator decision, in display order. */
export function reconcilableActions(
  result: ReferenceSeedRunResult | null,
): ReferenceSeedAction[] {
  if (!result) return [];
  return result.actions.filter(
    (a) => a.action === 'conflict' || a.action === 'blocked',
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
  return status?.catalogue_complete === true;
}

/** Per-object coverage matrix: expected vs present. */
export function referenceSeedCoverage(
  status: ReferenceSeedStatus | null,
): ReferenceSeedCoverageRow[] {
  if (!status) return [];
  const row = (
    key: string,
    label: string,
    expected: number,
    present: number,
  ): ReferenceSeedCoverageRow => ({
    key,
    label,
    expected,
    present,
    complete: present >= expected,
  });
  return [
    row('providers', 'Simulation providers', status.expected_providers, status.present_providers),
    row('accounts', 'Simulation provider accounts', status.expected_accounts, status.present_accounts),
    row('senders', 'Sender identities', status.expected_senders, status.present_senders),
    row('bindings', 'Sender / provider bindings', status.expected_bindings, status.present_bindings),
    row('channel_settings', 'Channel settings', status.expected_channel_settings, status.present_channel_settings),
    row('events', 'Active event definitions', status.expected_events, status.present_events),
    row('contracts', 'Published event contracts', status.expected_contracts, status.present_published_contracts),
    row('families', 'Template families', status.expected_families, status.present_families),
    row('versions', 'Published template versions', status.expected_channel_bindings, status.present_published_versions),
    row('layouts', 'Valid layout selections', status.expected_channel_bindings, status.valid_layout_selections),
    row('routes', 'Active event routes', status.expected_channel_bindings, status.present_routes),
  ];
}

/** Readiness gates, deliberately keeping live sending permanently unready. */
export function referenceSeedReadiness(
  status: ReferenceSeedStatus | null,
): ReferenceSeedReadinessRow[] {
  if (!status) return [];
  return [
    {
      key: 'configuration',
      label: 'Reference configuration complete',
      ready: status.reference_configuration_ready,
      detail: `${status.present_routes}/${status.expected_channel_bindings} routes, ${status.conflicts} conflicts, ${status.unresolved_required_assets} unresolved assets`,
    },
    {
      key: 'dry_run_ready',
      label: 'Controlled dry-run ready',
      ready: status.controlled_dry_run_ready,
      detail:
        status.live_delivery_enabled_channels === 0
          ? 'At least one published template and route with live delivery disabled'
          : 'Live delivery must be disabled',
    },
    {
      key: 'dry_run_verified',
      label: 'Controlled dry-run verified',
      ready: status.controlled_dry_run_verified,
      detail: `${status.completed_reference_dry_runs}/${status.reference_dry_run_requests} reference dry-runs completed`,
    },
    {
      key: 'live',
      label: 'Live sending readiness',
      ready: false,
      detail:
        'Permanently not ready — simulation providers can never satisfy live sending.',
    },
  ];
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
