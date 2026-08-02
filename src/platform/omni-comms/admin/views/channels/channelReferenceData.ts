/**
 * Omni-Comms C1 — reference/simulation data isolation (pure helpers).
 *
 * The reference seed pack creates demonstration records inside the same
 * organisation configuration tables as genuine records. C1 does NOT delete,
 * retire, mutate or migrate them; it only HIDES them from the normal
 * configuration lists and excludes them from readiness.
 *
 * No new database column is introduced here — classification is derived from
 * naming conventions used by the existing seed pack.
 */
import type {
  BindingRow,
  ProviderAccountRow,
  SenderIdentityRow,
} from '@/platform/omni-comms/application/channelManagementTypes';

/** Known reference/simulation code prefixes created by the seed pack. */
export const REFERENCE_CODE_PREFIXES: readonly string[] = [
  'simulation_',
  'ref_sim_',
  'ref_sender_',
  'omni_pilot_',
];

/** Secret references reserved for simulation accounts. */
export const REFERENCE_SECRET_PREFIX = 'OMNI_COMMS_SIMULATION_';

/** Address domains reserved for demonstration data. */
export const REFERENCE_ADDRESS_DOMAINS: readonly string[] = ['example.com'];

export const REFERENCE_DATA_BANNER =
  'Reference simulation data is hidden from the normal configuration view.';

export const REFERENCE_DATA_BADGE = 'Reference data';

function norm(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isReferenceCode(code: string | null | undefined): boolean {
  const v = norm(code);
  if (!v) return false;
  return REFERENCE_CODE_PREFIXES.some((p) => v.startsWith(p));
}

export function isReferenceAddress(address: string | null | undefined): boolean {
  const v = norm(address);
  if (!v) return false;
  return REFERENCE_ADDRESS_DOMAINS.some(
    (d) => v.endsWith(`@${d}`) || v.endsWith(`.${d}`),
  );
}

export function isReferenceSecretRef(ref: string | null | undefined): boolean {
  return (
    typeof ref === 'string'
    && ref.trim().toUpperCase().startsWith(REFERENCE_SECRET_PREFIX)
  );
}

/**
 * C2 — explicit `data_origin` is authoritative. The naming-convention rules
 * below remain ONLY as a defensive fallback for an unexpectedly old row that
 * predates the C2 classification backfill.
 */
export function isReferenceDataOrigin(
  origin: string | null | undefined,
): boolean {
  return origin === 'reference_seed';
}

export function isReferenceProviderAccount(row: ProviderAccountRow): boolean {
  if (row.data_origin) return isReferenceDataOrigin(row.data_origin);
  return isReferenceCode(row.code) || isReferenceSecretRef(row.secret_ref);
}


export function isReferenceSenderIdentity(row: SenderIdentityRow): boolean {
  if (row.data_origin) return isReferenceDataOrigin(row.data_origin);
  return isReferenceCode(row.code) || isReferenceAddress(row.from_address);
}

/** A binding is reference data when either side of it is reference data. */
export function isReferenceBinding(
  row: BindingRow,
  referenceSenderIds: ReadonlySet<string>,
  referenceAccountIds: ReadonlySet<string>,
): boolean {
  return (
    referenceSenderIds.has(row.sender_identity_id)
    || referenceAccountIds.has(row.provider_account_id)
  );
}

export interface PartitionedEmailConfig {
  accounts: ProviderAccountRow[];
  senders: SenderIdentityRow[];
  bindings: BindingRow[];
  referenceAccounts: ProviderAccountRow[];
  referenceSenders: SenderIdentityRow[];
  referenceBindings: BindingRow[];
  /** Total hidden reference records across all three collections. */
  hiddenCount: number;
  hasReferenceData: boolean;
}

/**
 * Split genuine organisation configuration from reference/simulation records.
 * Readiness MUST be computed from the genuine collections only.
 */
export function partitionEmailConfig(input: {
  accounts?: readonly ProviderAccountRow[] | null;
  senders?: readonly SenderIdentityRow[] | null;
  bindings?: readonly BindingRow[] | null;
}): PartitionedEmailConfig {
  const allAccounts = input.accounts ?? [];
  const allSenders = input.senders ?? [];
  const allBindings = input.bindings ?? [];

  const referenceAccounts = allAccounts.filter(isReferenceProviderAccount);
  const referenceSenders = allSenders.filter(isReferenceSenderIdentity);
  const referenceAccountIds = new Set(referenceAccounts.map((a) => a.id));
  const referenceSenderIds = new Set(referenceSenders.map((s) => s.id));
  const referenceBindings = allBindings.filter((b) =>
    isReferenceBinding(b, referenceSenderIds, referenceAccountIds),
  );
  const referenceBindingIds = new Set(referenceBindings.map((b) => b.id));

  const accounts = allAccounts.filter((a) => !referenceAccountIds.has(a.id));
  const senders = allSenders.filter((s) => !referenceSenderIds.has(s.id));
  const bindings = allBindings.filter((b) => !referenceBindingIds.has(b.id));

  const hiddenCount =
    referenceAccounts.length + referenceSenders.length + referenceBindings.length;

  return {
    accounts,
    senders,
    bindings,
    referenceAccounts,
    referenceSenders,
    referenceBindings,
    hiddenCount,
    hasReferenceData: hiddenCount > 0,
  };
}

/**
 * Records visible in a list, given the operator's "Show reference data" choice.
 * The switch itself is only rendered in non-production environments.
 */
export function visibleRecords<T>(
  genuine: readonly T[],
  reference: readonly T[],
  showReference: boolean,
): T[] {
  return showReference ? [...genuine, ...reference] : [...genuine];
}

/** Reference data never contributes to genuine readiness. */
export function readinessCounts(part: PartitionedEmailConfig): {
  accounts: number;
  activeSenders: number;
  activeVerifiedBindings: number;
} {
  return {
    accounts: part.accounts.length,
    activeSenders: part.senders.filter((s) => s.status === 'active').length,
    activeVerifiedBindings: part.bindings.filter(
      (b) => b.status === 'active' && b.verification_status === 'verified',
    ).length,
  };
}
