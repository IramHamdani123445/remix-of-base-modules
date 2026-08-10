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
 *   - "Future" profiles are reported, never silently created.
 */

export type SenderAudience = 'external' | 'internal' | 'mixed';
export type SenderCatalogueTier = 'production_now' | 'future';

export type SenderCatalogueEntryStatus =
  | 'created'
  | 'will_create'
  | 'existing'
  | 'conflict'
  | 'future_not_required';

export interface SenderCatalogueEntry {
  sender_code: string;
  tier: SenderCatalogueTier;
  purpose: string;
  audience: SenderAudience;
  status: SenderCatalogueEntryStatus;
  detail: string | null;
  sender_identity_id: string | null;
  organization_id: string;
  department_id: string | null;
  display_name: string;
  from_address: string;
  reply_to_address: string | null;
  sender_status: string | null;
  channel_endpoint_id: string | null;
  provider_account_id: string | null;
}

export interface SenderCatalogueBootstrapResult {
  organization_id: string;
  organization_short_name: string;
  channel: string;
  domain: string;
  domain_ready: boolean;
  applied: boolean;
  total_definitions: number;
  created: number;
  existing: number;
  conflicts: number;
  future: number;
  plan: SenderCatalogueEntry[];
  generated_at: string;
}

export const SENDER_CATALOGUE_STATUS_LABEL: Record<SenderCatalogueEntryStatus, string> = {
  created: 'CREATED',
  will_create: 'WILL CREATE',
  existing: 'EXISTING',
  conflict: 'CONFLICT — OPERATOR DECISION',
  future_not_required: 'FUTURE — NOT REQUIRED YET',
};

/** Entries that need an operator decision before the catalogue is complete. */
export function catalogueConflicts(
  result: SenderCatalogueBootstrapResult,
): SenderCatalogueEntry[] {
  return result.plan.filter((e) => e.status === 'conflict');
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
