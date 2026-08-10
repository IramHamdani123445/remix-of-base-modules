/**
 * Omni-Comms — pure projection of the server's read-only dispatch diagnostics.
 *
 * Kept out of emailReadiness.ts so the readiness projection itself never
 * references a channel-setting `live_delivery_enabled` flag. Nothing here
 * performs I/O, contacts a provider or sends anything.
 */
import type { DispatchDiagnosticsRow } from '@/platform/omni-comms/application/dispatchDiagnosticsService';
import type { EmailDispatchDiagnostics } from './emailReadiness';

/**
 * Projects the server's read-only dispatch diagnostics row onto the shape the
 * readiness checks consume. Pure: it invents nothing the server did not state,
 * and every unknown numeric collapses to zero rather than to an optimistic
 * value.
 */
export function projectDispatchDiagnostics(
  row: DispatchDiagnosticsRow | null | undefined,
): EmailDispatchDiagnostics | null {
  if (!row) return null;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    dispatcher_installed: row.dispatcher_implemented === true,
    eligible_jobs: n(row.eligible_jobs),
    business_attempts: n(row.business_attempts_total),
    accepted_attempts: n(row.business_accepted_total),
    delivered_attempts: n(row.business_delivered_total),
    outcome_unknown_attempts: n(
      (row as unknown as { business_outcome_unknown_total?: number })
        .business_outcome_unknown_total,
    ),
    harmful_callbacks: n(
      (row as unknown as { harmful_callback_count?: number }).harmful_callback_count,
    ),
    pilot_suspended:
      (row as unknown as { pilot_suspended?: boolean }).pilot_suspended === true
      || row.release_state === 'suspended',
    blocker: row.blocker ?? null,
    live_delivery_available: row.live_delivery_enabled === true,
    queued_producer_bindings: n(row.queued_producer_binding_count),
    release_state: row.release_state ?? null,
  };
}
