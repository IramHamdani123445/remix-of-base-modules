/**
 * Omni-Comms Print / Correspondence — governed production batches (Phase 3B).
 *
 * Boundaries (permanent):
 *   - A batch is an operational grouping only. It never creates a
 *     communication, a print message or a second PDF artefact, and it never
 *     implies dispatch or delivery.
 *   - The database remains authoritative. Everything here is a client mirror
 *     used to decide which controls are offered and to explain evidence.
 */

export const OMNI_COMMS_PRINT_BATCH_STATUSES = [
  'draft',
  'ready',
  'locked',
  'in_production',
  'reconciling',
  'completed',
  'cancelled',
] as const;

export type OmniCommsPrintBatchStatus =
  (typeof OMNI_COMMS_PRINT_BATCH_STATUSES)[number];

export const OMNI_COMMS_PRINT_BATCH_STATUS_LABELS: Record<
  OmniCommsPrintBatchStatus,
  string
> = {
  draft: 'Draft',
  ready: 'Ready',
  locked: 'Locked',
  in_production: 'In production',
  reconciling: 'Reconciling',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const OMNI_COMMS_PRINT_BATCH_ACTIONS = [
  'mark_ready',
  'revert_to_draft',
  'lock',
  'unlock',
  'start_production',
  'begin_reconciliation',
  'resume_production',
  'complete',
  'cancel',
] as const;

export type OmniCommsPrintBatchAction =
  (typeof OMNI_COMMS_PRINT_BATCH_ACTIONS)[number];

export const OMNI_COMMS_PRINT_BATCH_ACTION_LABELS: Record<
  OmniCommsPrintBatchAction,
  string
> = {
  mark_ready: 'Mark ready',
  revert_to_draft: 'Reopen as draft',
  lock: 'Lock membership',
  unlock: 'Unlock membership',
  start_production: 'Start production',
  begin_reconciliation: 'Begin reconciliation',
  resume_production: 'Resume production',
  complete: 'Complete batch',
  cancel: 'Cancel batch',
};

/** Actions that always require an operator reason. */
export const OMNI_COMMS_PRINT_BATCH_REASON_REQUIRED: readonly OmniCommsPrintBatchAction[] =
  ['unlock', 'cancel'];

const BATCH_TRANSITIONS: Record<
  OmniCommsPrintBatchStatus,
  OmniCommsPrintBatchStatus[]
> = {
  draft: ['ready', 'cancelled'],
  ready: ['draft', 'locked', 'cancelled'],
  locked: ['ready', 'in_production'],
  in_production: ['reconciling'],
  reconciling: ['in_production', 'completed'],
  completed: [],
  cancelled: [],
};

const BATCH_ACTION_TARGET: Record<
  OmniCommsPrintBatchAction,
  OmniCommsPrintBatchStatus
> = {
  mark_ready: 'ready',
  revert_to_draft: 'draft',
  lock: 'locked',
  unlock: 'ready',
  start_production: 'in_production',
  begin_reconciliation: 'reconciling',
  resume_production: 'in_production',
  complete: 'completed',
  cancel: 'cancelled',
};

export function printBatchTransitionAllowed(
  from: OmniCommsPrintBatchStatus,
  to: OmniCommsPrintBatchStatus,
): boolean {
  return (BATCH_TRANSITIONS[from] ?? []).includes(to);
}

/** Membership may only change while the batch is editable. */
export function printBatchMembershipEditable(
  status: OmniCommsPrintBatchStatus,
): boolean {
  return status === 'draft' || status === 'ready';
}

export function printBatchImmutable(status: OmniCommsPrintBatchStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

export function availablePrintBatchActions(
  status: OmniCommsPrintBatchStatus,
): OmniCommsPrintBatchAction[] {
  return OMNI_COMMS_PRINT_BATCH_ACTIONS.filter((action) => {
    if (action === 'cancel' && !printBatchMembershipEditable(status)) return false;
    if (action === 'unlock' && status !== 'locked') return false;
    if (action === 'revert_to_draft' && status !== 'ready') return false;
    if (action === 'resume_production' && status !== 'reconciling') return false;
    return printBatchTransitionAllowed(status, BATCH_ACTION_TARGET[action]);
  });
}

// ── Production-profile compatibility ──────────────────────────────────────

export interface PrintBatchProfileInput {
  paper_size?: string | null;
  sides?: string | null;
  colour_mode?: string | null;
  letterhead_profile?: string | null;
  envelope_profile?: string | null;
  inserts?: unknown[] | null;
  special_handling?: string | null;
}

/**
 * Client mirror of `public.omni_comms_priv_print_profile_signature`.
 * Deterministic, normalised, and account-scoped: two items may only be
 * produced in the same batch when their signatures are identical.
 */
export function printProfileSignature(
  profile: PrintBatchProfileInput | null | undefined,
  productionAccountId: string | null | undefined,
): string {
  const p = profile ?? {};
  const text = (value: unknown, fallback: string) => {
    const v = typeof value === 'string' ? value.trim() : '';
    return v.length > 0 ? v : fallback;
  };
  const inserts = Array.isArray(p.inserts)
    ? Array.from(new Set(p.inserts.map((x) => String(x)))).sort().join(',')
    : '';
  return [
    productionAccountId ?? 'no-account',
    text(p.paper_size, 'A4'),
    text(p.sides, 'simplex'),
    text(p.colour_mode, 'black_white'),
    text(p.letterhead_profile, 'default'),
    text(p.envelope_profile, 'default'),
    inserts.length > 0 ? inserts : 'none',
    text(p.special_handling, 'none'),
  ]
    .join('|')
    .toLowerCase();
}

// ── Accounting and reconciliation ─────────────────────────────────────────

export const OMNI_COMMS_BATCH_ACCOUNTING_STATES = [
  'pending',
  'in_progress',
  'printed',
  'reprinted_successfully',
  'failed',
  'spoiled',
  'held',
  'reprint_required',
  'deferred',
  'removed_before_lock',
] as const;

export type OmniCommsBatchAccountingState =
  (typeof OMNI_COMMS_BATCH_ACCOUNTING_STATES)[number];

export const OMNI_COMMS_BATCH_ACCOUNTING_LABELS: Record<
  OmniCommsBatchAccountingState,
  string
> = {
  pending: 'Not started',
  in_progress: 'Attempt in progress',
  printed: 'Printed',
  reprinted_successfully: 'Reprinted successfully',
  failed: 'Print failed',
  spoiled: 'Spoiled',
  held: 'Held',
  reprint_required: 'Reprint required',
  deferred: 'Deferred to a later batch',
  removed_before_lock: 'Removed before lock',
};

/** States that leave the batch unaccounted for. */
export const OMNI_COMMS_BATCH_UNACCOUNTED_STATES: readonly OmniCommsBatchAccountingState[] =
  ['pending', 'in_progress', 'reprint_required', 'failed', 'spoiled', 'held'];

export interface PrintBatchAccountingItem {
  batch_item_id: string;
  print_item_id: string;
  letter_reference: string;
  membership_status: 'active' | 'removed_before_lock' | 'deferred' | 'closed';
  physical_status: string;
  accounting_state: OmniCommsBatchAccountingState;
  expected_pages: number | null;
  expected_copies: number;
  batch_attempts: number;
  spoiled_or_failed_in_batch: number;
  printed_in_batch: number;
  recipient_display: string | null;
  request_id: string;
  message_id: string;
  item_version: number;
  hold_reason: string | null;
  last_failure_reason: string | null;
}

export interface PrintBatchReconciliation {
  expected_items: number;
  expected_pages: number;
  expected_copies: number;
  printed: number;
  reprinted_successfully: number;
  printed_satisfied: number;
  failed: number;
  spoiled: number;
  held: number;
  deferred: number;
  removed_before_lock: number;
  pending: number;
  in_progress: number;
  reprint_required: number;
  unaccounted: number;
  reconciled: boolean;
  computed_at: string;
}

/**
 * Client mirror of `omni_comms_priv_print_batch_reconciliation`. Counts are
 * always derived from membership plus current item state plus immutable
 * attempts — never from an operator-editable counter.
 */
export function computeBatchReconciliation(
  items: readonly Pick<
    PrintBatchAccountingItem,
    'accounting_state' | 'expected_pages' | 'expected_copies'
  >[],
): Omit<PrintBatchReconciliation, 'computed_at'> {
  const count = (state: OmniCommsBatchAccountingState) =>
    items.filter((i) => i.accounting_state === state).length;

  const counted = items.filter(
    (i) => i.accounting_state !== 'removed_before_lock',
  );
  const expected_items = counted.length;
  const expected_pages = counted.reduce(
    (sum, i) => sum + (i.expected_pages ?? 0) * Math.max(i.expected_copies, 1),
    0,
  );
  const expected_copies = counted.reduce(
    (sum, i) => sum + Math.max(i.expected_copies, 1),
    0,
  );
  const printed = count('printed');
  const reprinted_successfully = count('reprinted_successfully');
  const deferred = count('deferred');
  const unaccounted = items.filter((i) =>
    OMNI_COMMS_BATCH_UNACCOUNTED_STATES.includes(i.accounting_state),
  ).length;

  return {
    expected_items,
    expected_pages,
    expected_copies,
    printed,
    reprinted_successfully,
    printed_satisfied: printed + reprinted_successfully,
    failed: count('failed'),
    spoiled: count('spoiled'),
    held: count('held'),
    deferred,
    removed_before_lock: count('removed_before_lock'),
    pending: count('pending'),
    in_progress: count('in_progress'),
    reprint_required: count('reprint_required'),
    unaccounted,
    reconciled:
      unaccounted === 0 &&
      printed + reprinted_successfully + deferred === expected_items,
  };
}

export function batchCanCompleteNormally(
  reconciliation: Pick<PrintBatchReconciliation, 'reconciled'>,
): boolean {
  return reconciliation.reconciled === true;
}

// ── Wire shapes ───────────────────────────────────────────────────────────

export interface PrintBatchRow {
  id: string;
  batch_reference: string;
  status: OmniCommsPrintBatchStatus;
  version: number;
  created_at: string;
  locked_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  production_account_id: string | null;
  production_account_name: string | null;
  profile_signature: string;
  profile_snapshot: Record<string, unknown>;
  notes: string | null;
  cancellation_reason: string | null;
  reconciliation_override_reason: string | null;
  age_hours: number | null;
  reconciliation: PrintBatchReconciliation;
}

export interface PrintBatchListResult {
  batches: PrintBatchRow[];
  total: number;
  generated_at: string;
}

export interface PrintBatchDetail {
  batch: {
    id: string;
    batch_reference: string;
    status: OmniCommsPrintBatchStatus;
    version: number;
    production_account_id: string | null;
    profile_signature: string;
    profile_snapshot: Record<string, unknown>;
    notes: string | null;
    cancellation_reason: string | null;
    reconciliation_override_reason: string | null;
    created_at: string;
    locked_at: string | null;
    started_at: string | null;
    reconciled_at: string | null;
    completed_at: string | null;
    cancelled_at: string | null;
  };
  items: PrintBatchAccountingItem[];
  reconciliation: PrintBatchReconciliation;
  full_detail_permitted: boolean;
  generated_at: string;
}

export interface PrintBatchPreviewItem {
  print_item_id: string;
  letter_reference: string;
  physical_status: string;
  page_count: number | null;
  copies: number;
  production_account_id: string | null;
  production_account_name: string | null;
  production_profile: Record<string, unknown>;
  profile_signature: string;
  eligible: boolean;
  blocker:
    | 'not_queued_for_print'
    | 'already_in_active_batch'
    | null;
}

export interface PrintBatchPreview {
  items: PrintBatchPreviewItem[];
  selected_count: number;
  total_pages: number;
  total_copies: number;
  distinct_profiles: number;
  profile_signatures: string[];
  compatible: boolean;
  generated_at: string;
}
