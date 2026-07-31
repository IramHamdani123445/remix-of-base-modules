/**
 * Omni-Comms — Reference Seed Pack: types and constants.
 *
 * Pure declarations. No Supabase client, no React, no Legacy Communication
 * Hub references.
 *
 * The Reference Seed Pack populates the Omni-Comms administration screens
 * with realistic, NON-PRODUCTION reference data so that every implemented
 * screen can be demonstrated end to end. It is simulation-only:
 *   - every provider account it creates is sandbox / simulation;
 *   - every recipient address it uses is on `example.com`;
 *   - it never enables live delivery on any channel;
 *   - it refuses to run when live traffic or live delivery is detected.
 */

/** The only recipient domain the seed catalogue may reference. */
export const REFERENCE_SEED_RECIPIENT_DOMAIN = 'example.com';

/** The locale authored by the seed catalogue. */
export const REFERENCE_SEED_LOCALE = 'en-US';

/** Simulation-only provider codes owned by the seed. */
export const REFERENCE_SEED_PROVIDER_CODES = [
  'simulation_email',
  'simulation_sms',
  'simulation_inapp',
] as const;

/** Code prefix reserved for every organisation-scoped object the seed owns. */
export const REFERENCE_SEED_CODE_PREFIX = 'ref_';

// ─── RPC payloads ────────────────────────────────────────────────────────

export type ReferenceSeedObjectType =
  | 'provider'
  | 'provider_account'
  | 'sender_identity'
  | 'sender_binding'
  | 'channel_setting'
  | 'event_definition'
  | 'event_contract'
  | 'template_family'
  | 'template_version'
  | 'event_route';

export type ReferenceSeedActionKind = 'planned' | 'created' | 'existing';

export interface ReferenceSeedAction {
  object_type: ReferenceSeedObjectType;
  key: string;
  action: ReferenceSeedActionKind;
}

export interface ReferenceSeedRunResult {
  organization_id: string;
  catalogue_version: number;
  mode: 'preview' | 'apply';
  created: number;
  planned: number;
  existing: number;
  skipped: number;
  actions: ReferenceSeedAction[];
  generated_at: string;
}

export interface ReferenceSeedStatus {
  organization_id: string;
  catalogue_version: number;
  expected_events: number;
  present_events: number;
  expected_channel_bindings: number;
  present_routes: number;
  present_published_versions: number;
  expected_senders: number;
  present_senders: number;
  expected_accounts: number;
  present_accounts: number;
  seeded: boolean;
  live_delivery_enabled_channels: number;
  live_requests: number;
  safe_to_seed: boolean;
  checked_at: string;
}

// ─── Derived view model ──────────────────────────────────────────────────

export interface ReferenceSeedGroup {
  objectType: ReferenceSeedObjectType;
  label: string;
  planned: number;
  created: number;
  existing: number;
  keys: string[];
}

export type ReferenceSeedPanelState =
  | 'loading'
  | 'ready'
  | 'blocked'
  | 'previewed'
  | 'applying'
  | 'applied'
  | 'error';

export const REFERENCE_SEED_OBJECT_LABELS: Record<
  ReferenceSeedObjectType,
  string
> = {
  provider: 'Simulation providers',
  provider_account: 'Simulation provider accounts',
  sender_identity: 'Sender identities',
  sender_binding: 'Sender / provider bindings',
  channel_setting: 'Channel settings',
  event_definition: 'Event definitions',
  event_contract: 'Event contracts',
  template_family: 'Template families',
  template_version: 'Published template versions',
  event_route: 'Event routes',
};
