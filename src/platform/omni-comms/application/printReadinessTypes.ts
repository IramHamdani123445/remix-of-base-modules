/**
 * Omni-Comms Print — authoritative readiness contract.
 *
 * ONE place answers "is Print usable right now?". Every gate is truthful:
 *   - `ready`          — the control is genuinely satisfied.
 *   - `blocked`        — a real condition prevents printing.
 *   - `not_applicable` — the control cannot apply to the internal print spool
 *                        (API credentials, sending domain, DNS, webhook
 *                        callbacks, external authentication). It is NEVER red
 *                        and it is NEVER silently hidden.
 *
 * Email (Resend) and SMS (Twilio) controls are untouched by this module.
 */

export type PrintGateStatus = 'ready' | 'blocked' | 'not_applicable';

/** Stable, actionable Print error/control codes. */
export const OMNI_COMMS_PRINT_ERROR_CODES = [
  'print_provider_missing',
  'print_account_missing',
  'print_account_inactive',
  'print_identity_missing',
  'print_endpoint_missing',
  'print_binding_missing',
  'print_release_missing',
  'print_release_disabled',
  'variant_missing',
  'print_variant_required',
  'postal_destination_missing',
  'print_artefact_missing',
  'print_artefact_corrupt',
  'print_storage_unavailable',
  'print_item_missing',
  'print_item_held',
  'invalid_print_transition',
  'permission_denied',
  'concurrent_update',
  'print_access_failed',
] as const;

export type OmniCommsPrintErrorCode =
  (typeof OMNI_COMMS_PRINT_ERROR_CODES)[number];

/** Corrective action an operator can take from the readiness panel. */
export type PrintGateFixAction =
  | 'provision'
  | 'enable_release'
  | 'templates'
  | null;

export interface PrintReadinessGate {
  key: string;
  label: string;
  status: PrintGateStatus;
  error_code: OmniCommsPrintErrorCode | null;
  reason: string;
  resource: string;
  fix_action: PrintGateFixAction;
}

export interface PrintReadinessResult {
  organization_id: string;
  generated_at: string;
  gates: PrintReadinessGate[];
  blocked_count: number;
  ready_to_print: boolean;
  can_operate: boolean;
  can_configure: boolean;
  queue_count: number;
}

export const PRINT_GATE_STATUS_LABEL: Record<PrintGateStatus, string> = {
  ready: 'READY',
  blocked: 'BLOCKED',
  not_applicable: 'NOT APPLICABLE',
};

/**
 * Operator-facing catalogue: plain language + the corrective action.
 * The backend condition lives with each RPC; this is the UI contract.
 */
export const OMNI_COMMS_PRINT_ERROR_CATALOGUE: Record<
  OmniCommsPrintErrorCode,
  { title: string; action: string }
> = {
  print_provider_missing: {
    title: 'The internal print spool provider is not registered.',
    action: 'Run “Provision print configuration” to register it.',
  },
  print_account_missing: {
    title: 'No internal print production account exists for this organisation.',
    action: 'Run “Provision print configuration”.',
  },
  print_account_inactive: {
    title: 'The internal print production account is not active.',
    action: 'Re-activate the account, or run “Provision print configuration”.',
  },
  print_identity_missing: {
    title: 'No issuing authority is configured for correspondence.',
    action: 'Run “Provision print configuration”, then edit the issuing authority.',
  },
  print_endpoint_missing: {
    title: 'No active internal render service endpoint is configured.',
    action: 'Run “Provision print configuration”.',
  },
  print_binding_missing: {
    title: 'No active Print binding links the issuing authority to production.',
    action: 'Run “Provision print configuration”, or activate the binding.',
  },
  print_release_missing: {
    title: 'Print release control has never been provisioned.',
    action: 'Run “Provision print configuration”.',
  },
  print_release_disabled: {
    title: 'Print production is switched off.',
    action: 'Turn on “Print production” in the readiness panel.',
  },
  variant_missing: {
    title: 'The template has no variant for this channel.',
    action: 'Publish the missing template variant.',
  },
  print_variant_required: {
    title: 'No published print template variant exists.',
    action:
      'Publish a print variant. Print content is never derived from an email or SMS variant.',
  },
  postal_destination_missing: {
    title: 'The recipient has no postal destination.',
    action: 'Record a postal address on the recipient before producing a letter.',
  },
  print_artefact_missing: {
    title: 'The archived PDF for this letter cannot be found.',
    action: 'Re-produce the correspondence artefact; do not print a substitute.',
  },
  print_artefact_corrupt: {
    title: 'The letter has no recorded artefact checksum, so it cannot be trusted.',
    action: 'Re-produce the correspondence artefact.',
  },
  print_storage_unavailable: {
    title: 'The private document store is unavailable.',
    action: 'Retry shortly; if it persists, raise a platform incident.',
  },
  print_item_missing: {
    title: 'This print item no longer exists.',
    action: 'Refresh the print queue.',
  },
  print_item_held: {
    title: 'This letter is held and must not be printed.',
    action: 'Release the hold from the item’s advanced controls first.',
  },
  invalid_print_transition: {
    title: 'The letter is not in a state that can be printed.',
    action: 'Refresh the queue and use the advanced controls to correct the state.',
  },
  permission_denied: {
    title: 'You do not hold the Omni-Comms operate permission.',
    action: 'Ask an administrator to grant Omni-Comms operate access.',
  },
  concurrent_update: {
    title: 'Someone else changed this letter while you were working on it.',
    action: 'Refresh the queue and try again.',
  },
  print_access_failed: {
    title: 'Secure access to the archived PDF failed.',
    action: 'Retry; if it persists, raise a platform incident.',
  },
};

export function describePrintError(code: string | null | undefined): {
  title: string;
  action: string;
} {
  if (code && code in OMNI_COMMS_PRINT_ERROR_CATALOGUE) {
    return OMNI_COMMS_PRINT_ERROR_CATALOGUE[code as OmniCommsPrintErrorCode];
  }
  return {
    title: 'Print could not continue.',
    action: 'Refresh and retry; if it persists, raise a platform incident.',
  };
}

/** Controls that can never be red for the built-in print spool. */
export const PRINT_NOT_APPLICABLE_CONTROLS = [
  'API credential',
  'Credential verification',
  'Sending domain',
  'DNS records',
  'Webhook callback',
  'Provider callback',
  'External authentication',
] as const;
