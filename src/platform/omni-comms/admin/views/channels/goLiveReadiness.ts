/**
 * Omni-Comms — Email Go-Live Readiness projection.
 *
 * ONE pure function that turns the existing, server-derived Email readiness
 * checks and the server's read-only dispatch diagnostics into an operator
 * answer to a single question: what is the next blocker?
 *
 * Boundaries (permanent):
 *   - Pure. Performs no I/O, contacts no provider and sends nothing.
 *   - Derives from backend/runtime state only. A component or Edge Function
 *     merely EXISTING never makes an item READY.
 *   - Never renders or returns a credential, secret value, secret reference
 *     value, recipient or rendered content — only states, counts and bounded
 *     symbolic codes.
 *   - Never asserts unrestricted live delivery. `live_delivery_available` is
 *     reported exactly as the server states it.
 */
import type {
  EmailDispatchDiagnostics,
  EmailReadinessCheck,
  EmailReadinessProjection,
} from './emailReadiness';

export type GoLiveStatus =
  | 'READY'
  | 'BLOCKED'
  | 'NOT_CONFIGURED'
  | 'NOT_VERIFIED'
  | 'SUSPENDED';

export interface GoLiveReadinessItem {
  readonly key: string;
  readonly label: string;
  readonly status: GoLiveStatus;
  /** Human-readable next action. Empty string only when status is READY. */
  readonly nextAction: string;
  /** Short factual supporting detail taken from the underlying check. */
  readonly detail: string;
  /** Where the operator must go to clear this blocker (defaults to `key`). */
  readonly navigationKey?: string;
}


export interface GoLiveReadinessProjection {
  readonly items: readonly GoLiveReadinessItem[];
  /** The first item that is not READY, or null when every item is READY. */
  readonly nextBlocker: GoLiveReadinessItem | null;
  readonly readyCount: number;
  readonly totalCount: number;
  /** True only when every item is READY. Never implies unrestricted sending. */
  readonly allReady: boolean;
  /** Reported exactly as the server states it; never inferred from the UI. */
  readonly liveDeliveryAvailable: boolean;
  /** True while an automatic controlled-pilot suspension is in force. */
  readonly pilotSuspended: boolean;
}

/** Checks whose failure means "configured but not proven by a verifier". */
const VERIFICATION_KEYS = new Set([
  'credentials',
  'binding_verification',
  'sending_domain_verification',
  'technical_test',
  'provider_delivery_test',
  'callback_evidence',
  'business_delivery_confirmed',
]);

/** Checks that describe governance rather than configuration. */
const GOVERNANCE_KEYS = new Set([
  'release_control_configured',
  'release_prerequisites',
  'release_control',
  'business_dispatch',
  'business_delivery_attempt',
  'pilot_safety',
]);

const NEXT_ACTIONS: Record<string, string> = {
  adapter: 'Install and activate the Resend email adapter for this environment.',
  account: 'Create an organisation provider account for the email adapter.',
  credentials:
    'Open the provider account to review or verify its sending credential.',

  identity: 'Create and activate an email sender identity.',
  binding: 'Bind an active sender identity to an active provider account.',
  binding_verification:
    'Record provider or trusted-service verification for the binding. Manual '
    + 'evidence does not count.',
  policy: 'Create an email channel policy for this organisation or department.',
  policy_state: 'Move the effective email policy into a state that allows configuration.',
  sending_domain: 'Add an active sending-domain endpoint for the email channel.',
  sending_domain_verification:
    'Complete provider verification of the sending domain. This screen performs '
    + 'no DNS lookup.',
  event_callback:
    'Register an active event-callback endpoint with a signing secret reference.',
  technical_test:
    'Run the zero-send configuration preflight for the selected binding.',
  provider_delivery_test:
    'Run an approved technical test delivery to an approved test address.',
  callback_evidence:
    'Wait for or re-run an approved test delivery so a signature-verified '
    + 'callback is recorded.',
  release_control_configured:
    'Create a Release Control record governing this organisation or department.',
  release_prerequisites:
    'Clear the outstanding Release Control prerequisites shown on the Release '
    + 'Control screen.',
  release_control:
    'Propose a controlled pilot and have a second approver activate it through '
    + 'the trusted approval boundary.',
  business_dispatch:
    'Deploy the controlled business email dispatcher for this environment.',
  business_delivery_attempt:
    'Select an approved queued business producer/event binding permitted by the '
    + 'active Release Control, then let the controlled dispatcher claim the job.',
  business_delivery_confirmed:
    'Wait for a signature-verified delivery callback for a business attempt.',
  pilot_safety:
    'Review the dispatch diagnostics and resolve the recorded complaint, hard '
    + 'bounce or suspension before proposing a new release.',
};

function statusFor(check: EmailReadinessCheck): GoLiveStatus {
  if (check.state === 'met') return 'READY';
  if (check.state === 'not_implemented') return 'BLOCKED';
  if (VERIFICATION_KEYS.has(check.key)) return 'NOT_VERIFIED';
  if (GOVERNANCE_KEYS.has(check.key)) return 'BLOCKED';
  return 'NOT_CONFIGURED';
}

function nextActionFor(check: EmailReadinessCheck, status: GoLiveStatus): string {
  if (status === 'READY') return '';
  return (
    NEXT_ACTIONS[check.key]
    ?? 'Resolve this prerequisite on the relevant Omni-Comms email screen.'
  );
}

export function projectEmailGoLiveReadiness(
  readiness: EmailReadinessProjection,
  dispatch?: EmailDispatchDiagnostics | null,
): GoLiveReadinessProjection {
  const pilotSuspended = dispatch?.pilot_suspended === true;

  const items: GoLiveReadinessItem[] = readiness.checks.map((check) => {
    let status = statusFor(check);
    // A live suspension is the operator's most urgent truth and outranks the
    // generic mapping for the safety item.
    if (pilotSuspended && (check.key === 'pilot_safety' || check.key === 'release_control')) {
      status = 'SUSPENDED';
    }
    return {
      key: check.key,
      label: check.label,
      status,
      nextAction:
        status === 'SUSPENDED'
          ? 'The controlled pilot is suspended. Review the dispatch diagnostics, '
            + 'resolve the cause, then propose a new controlled pilot.'
          : nextActionFor(check, status),
      detail: check.detail,
    };
  });

  // The pilot business producer is a first-class, server-determined blocker.
  if (dispatch && dispatch.blocker === 'pilot_business_producer_not_selected') {
    items.push({
      key: 'pilot_business_producer',
      label: 'Pilot business producer',
      status: 'BLOCKED',
      nextAction: NEXT_ACTIONS.business_delivery_attempt,
      detail:
        'No approved queued business producer/event binding permitted by the '
        + 'active Release Control has been selected.',
    });
  }

  const readyCount = items.filter((i) => i.status === 'READY').length;
  const nextBlocker = items.find((i) => i.status !== 'READY') ?? null;

  return {
    items,
    nextBlocker,
    readyCount,
    totalCount: items.length,
    allReady: items.length > 0 && readyCount === items.length,
    liveDeliveryAvailable: dispatch?.live_delivery_available === true,
    pilotSuspended,
  };
}

export const GO_LIVE_STATUS_LABEL: Record<GoLiveStatus, string> = {
  READY: 'READY',
  BLOCKED: 'BLOCKED',
  NOT_CONFIGURED: 'NOT CONFIGURED',
  NOT_VERIFIED: 'NOT VERIFIED',
  SUSPENDED: 'SUSPENDED',
};
