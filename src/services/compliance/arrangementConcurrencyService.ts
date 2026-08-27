/**
 * Concurrent-arrangement protection (client-side surface of the server rule).
 *
 * Business rule: an employer must not hold more than one non-completed payment
 * arrangement. The authoritative enforcement lives in the database
 * (trg_ce_single_open_arrangement / trg_core_single_open_arrangement, advisory-locked).
 * This module only mirrors the rule for pre-flight UX and translates the
 * database rejection into a meaningful, navigable error.
 */
import { supabase } from '@/integrations/supabase/client';

export interface BlockingArrangement {
  id: string;
  arrangement_number: string;
  status: string;
  case_id: string | null;
}

export const CONCURRENT_ARRANGEMENT_CODE = 'CE409';

export class ConcurrentArrangementError extends Error {
  blocking?: BlockingArrangement | null;
  constructor(message: string, blocking?: BlockingArrangement | null) {
    super(message);
    this.name = 'ConcurrentArrangementError';
    this.blocking = blocking ?? null;
  }
}

/** Returns the arrangement that would block a new one, or null. */
export async function fetchBlockingArrangement(employerId: string): Promise<BlockingArrangement | null> {
  if (!employerId) return null;
  const { data, error } = await (supabase as any).rpc('ce_arrangement_blocking_lookup', {
    p_employer_id: employerId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? (row as BlockingArrangement) : null;
}

/** Pre-flight check mirroring the server rule; throws when blocked. */
export async function assertNoOpenArrangement(employerId: string): Promise<void> {
  const blocking = await fetchBlockingArrangement(employerId);
  if (blocking) {
    throw new ConcurrentArrangementError(
      `This employer already has a non-completed payment arrangement (${blocking.arrangement_number} — ${blocking.status}). Complete, cancel or supersede it before creating a new one.`,
      blocking,
    );
  }
}

/** True when a caught error is the database concurrent-arrangement rejection. */
export function isConcurrentArrangementError(err: any): boolean {
  if (err instanceof ConcurrentArrangementError) return true;
  const msg = `${err?.message ?? ''} ${err?.details ?? ''}`;
  return msg.includes('concurrent_arrangement_blocked');
}

/** Normalises any creation failure into a user-facing error. */
export async function translateArrangementCreationError(
  err: any,
  employerId: string,
): Promise<Error> {
  if (!isConcurrentArrangementError(err)) return err instanceof Error ? err : new Error(String(err));
  if (err instanceof ConcurrentArrangementError) return err;
  let blocking: BlockingArrangement | null = null;
  try {
    blocking = await fetchBlockingArrangement(employerId);
  } catch {
    /* lookup is best-effort */
  }
  return new ConcurrentArrangementError(
    blocking
      ? `This employer already has a non-completed payment arrangement (${blocking.arrangement_number} — ${blocking.status}). Complete, cancel or supersede it before creating a new one.`
      : 'This employer already has a non-completed payment arrangement. Complete, cancel or supersede it before creating a new one.',
    blocking,
  );
}
