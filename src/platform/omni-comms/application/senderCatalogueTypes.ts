/**
 * Omni-Comms — production Email Sender Catalogue model.
 *
 * The catalogue is the canonical list of sender profiles the organisation is
 * expected to operate. It is configuration-only: nothing here sends, enqueues,
 * dispatches, or rewrites an event route.
 *
 * Boundaries (permanent):
 *   - Never invents caller modules, departments or event routes.
 *   - Never overwrites an existing operator-configured sender.
 *   - Never activates a sender unless the sending domain is genuinely ready.
 *   - "Future" profiles are reported, never silently created.
 */

export type SenderAudience = 'external' | 'internal' | 'mixed';
export type SenderCatalogueTier = 'production_now' | 'future';

export type SenderCatalogueEntryStatus =
  | 'created'
  | 'will_create'
  | 'existing'
  | 'existing_equivalent'
  | 'conflict'
  | 'blocked'
  | 'future_not_required';

export interface SenderCatalogueUsage {
  routes: number;
  bindings: number;
  messages: number;
  module_assignments: number;
  tests: number;
}

export interface SenderCatalogueEntry {
  sender_code: string;
  tier: SenderCatalogueTier;
  purpose: string;
  audience: SenderAudience;
  status: SenderCatalogueEntryStatus;
  detail: string | null;
  sender_identity_id: string | null;
  organization_id: string;
  department_code: string | null;
  department_required: boolean;
  department_resolved: boolean;
  scope_note: string | null;
  department_id: string | null;
  display_name: string;
  from_address: string;
  existing_sender_code: string | null;
  reply_to_address: string | null;
  sender_status: string | null;
  usage: SenderCatalogueUsage | null;
  channel_endpoint_id: string | null;
  provider_account_id: string | null;
}

export interface SenderCatalogueBootstrapResult {
  organization_id: string;
  organization_short_name: string;
  channel: string;
  domain: string;
  domain_ready: boolean;
  domain_readiness_blocker: string | null;
  applied: boolean;
  total_definitions: number;
  created: number;
  existing: number;
  conflicts: number;
  blocked: number;
  future: number;
  plan: SenderCatalogueEntry[];
  generated_at: string;
}

export const SENDER_CATALOGUE_STATUS_LABEL: Record<SenderCatalogueEntryStatus, string> = {
  created: 'CREATED',
  will_create: 'WILL CREATE',
  existing: 'EXISTING',
  existing_equivalent: 'EXISTING — APPROVED EQUIVALENT',
  conflict: 'CONFLICT — OPERATOR DECISION',
  blocked: 'BLOCKED — CONFIGURATION MISSING',
  future_not_required: 'FUTURE — NOT REQUIRED YET',
};

/** Entries that need an operator decision before the catalogue is complete. */
export function catalogueConflicts(
  result: SenderCatalogueBootstrapResult,
): SenderCatalogueEntry[] {
  return result.plan.filter((e) => e.status === 'conflict');
}

/** Entries that cannot be created because required master data is missing. */
export function catalogueBlocked(
  result: SenderCatalogueBootstrapResult,
): SenderCatalogueEntry[] {
  return result.plan.filter((e) => e.status === 'blocked');
}

/** Production-now entries that exist and are active. */
export function catalogueReadyCount(result: SenderCatalogueBootstrapResult): number {
  return result.plan.filter(
    (e) => e.tier === 'production_now' && e.sender_status === 'active',
  ).length;
}

export function catalogueProductionTotal(result: SenderCatalogueBootstrapResult): number {
  return result.plan.filter((e) => e.tier === 'production_now').length;
}

/**
 * Applying is only safe when nothing needs an operator decision and no
 * required department is missing. Domain readiness does not block creation —
 * it only decides whether a created profile can be activated.
 */
export function catalogueApplyBlocker(
  result: SenderCatalogueBootstrapResult,
): string | null {
  if (result.conflicts > 0) {
    return 'Resolve the reported sender conflicts before creating catalogue profiles.';
  }
  if (result.blocked > 0) {
    return 'Some profiles have no owning department in master data. Resolve them before applying.';
  }
  return null;
}

/** Plain-English outcome for a single planned entry. */
export function catalogueEntryExplanation(entry: SenderCatalogueEntry): string {
  switch (entry.detail) {
    case 'activated':
      return 'Created and activated — the sending domain is ready.';
    case 'created_draft_domain_not_ready':
      return 'Created as a draft. It cannot be activated until the sending domain is ready.';
    case 'created_draft_activation_blocked':
      return 'Created as a draft. Activation was refused by the sender lifecycle rules.';
    case 'will_create_and_activate':
      return 'Will be created and activated.';
    case 'will_create_as_draft_domain_not_ready':
      return 'Will be created as a draft — the sending domain is not ready yet.';
    case 'operator_approved_equivalent_sender':
      return `An operator approved ${entry.existing_sender_code ?? 'an existing sender'} as this catalogue profile.`;
    case 'existing_sender_uses_different_address':
      return 'A sender with this code already exists on a different address.';
    case 'no_registered_module_requires_this_profile':
      return 'No registered caller module needs this profile yet.';
    default:
      if (entry.detail?.startsWith('address_already_used_by_sender_code_')) {
        return `The address is already used by sender "${entry.detail.replace('address_already_used_by_sender_code_', '')}".`;
      }
      if (entry.detail?.startsWith('department_not_resolved_')) {
        return `No active department "${entry.detail.replace('department_not_resolved_', '')}" exists in master data.`;
      }
      return entry.detail ?? '';
  }
}

/** Whether an existing sender can safely be renamed to the catalogue code. */
export function canRenameToCatalogueCode(entry: SenderCatalogueEntry): boolean {
  const u = entry.usage;
  if (!u) return false;
  return u.routes === 0 && u.messages === 0;
}

/**
 * Audience rule surfaced in the UI. Internal senders must never be used for
 * events addressed to external recipients; the database enforces the same rule
 * on the event-route write path.
 */
export function audienceHint(audience: SenderAudience): string {
  switch (audience) {
    case 'internal':
      return 'Internal recipients only — blocked on external-recipient event routes.';
    case 'mixed':
      return 'Internal and external recipients.';
    default:
      return 'External recipients (citizens, employers, providers).';
  }
}
