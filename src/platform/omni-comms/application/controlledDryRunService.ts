/**
 * Omni-Comms — Phase 5 Controlled Dry-Run Test Surface: application service.
 *
 * Responsibilities:
 *   - read the server feature gate and the authoritative payload validation;
 *   - construct the single safe synthetic recipient;
 *   - construct the canonical `sendCommunication()` input;
 *   - own idempotency-key state semantics;
 *   - map controlled failures to operator-safe guidance;
 *   - normalize the bounded result;
 *   - load post-run invariants through the read-only Operations service.
 *
 * Boundaries (enforced by OMNI_CONTROLLED_DRY_RUN_BOUNDARY):
 *   - the ONLY execution path is the canonical façade
 *     `src/platform/omni-comms/sendCommunication.ts`;
 *   - never invokes the Edge Function directly;
 *   - never calls a private (`omni_comms_priv_*`) RPC;
 *   - never imports runtime internals, a provider SDK, a service-role client
 *     or the Legacy Communication Hub;
 *   - never reads a runtime table with `.from(...)`.
 */
import {
  sendCommunication,
  type SendCommunicationInput,
  type SendCommunicationResult,
  buildBlockedResult,
} from '../sendCommunication';
import type { OmniCommsRpcClient } from './eventCatalogueService';
import { callOmniCommsRpc } from './omniCommsRpcCall';
import { OmniCommsRpcError } from './eventCatalogueTypes';
import { getOpsRequestDetail } from './operationsService';
import type { OpsRequestDetail } from './operationsTypes';
import {
  ADMIN_DRY_RUN_CHANNEL,
  ADMIN_DRY_RUN_CORRELATION_PREFIX,
  ADMIN_DRY_RUN_DEFAULT_LOCALE,
  ADMIN_DRY_RUN_EMAIL_DOMAIN,
  ADMIN_DRY_RUN_ENTITY_TYPE,
  ADMIN_DRY_RUN_IDEMPOTENCY_PREFIX,
  ADMIN_DRY_RUN_MODULE_CODE,
  ADMIN_DRY_RUN_PAYLOAD_MAX_BYTES,
  ADMIN_DRY_RUN_RECIPIENT_LIMIT,
  ADMIN_DRY_RUN_RECIPIENT_TYPE,
  DRY_RUN_BLOCK_REASON_MESSAGE,
  type DryRunGate,
  type DryRunGuidance,
  type DryRunInvariants,
  type DryRunRecipientErrorCode,
  type DryRunResultKind,
  type DryRunSubmissionState,
  type DryRunSyntheticRecipient,
  type DryRunValidationResult,
  type DryRunValidationScope,
} from './controlledDryRunTypes';

export * from './controlledDryRunTypes';

// ─── Server feature gate ────────────────────────────────────────────────

export function getControlledDryRunGate(
  client: OmniCommsRpcClient,
): Promise<DryRunGate> {
  return callOmniCommsRpc<DryRunGate>(
    client,
    'omni_comms_controlled_dry_run_gate',
    {},
  );
}

/**
 * Execution may only be offered when the SERVER says so.
 *
 * `execution_permitted` is the authoritative decision — it already accounts
 * for the feature flag, the operate capability, the server-classified
 * environment and the recorded certification state. The browser adds nothing
 * of its own beyond configuration readiness for the selected path.
 */
export function isExecutionPermitted(
  gate: DryRunGate | null,
  dryRunReady: boolean,
): boolean {
  if (!gate) return false;
  if (gate.state !== 'enabled') return false;
  if (!gate.can_operate) return false;
  // FAIL CLOSED: only an explicit `true` permits execution. A missing field,
  // null or false must all block.
  if (gate.execution_permitted !== true) return false;
  return dryRunReady === true;
}

/** The server's reason for withholding execution, in operator language. */
export function executionBlockedMessage(gate: DryRunGate | null): string | null {
  if (!gate) return null;
  if (gate.execution_permitted === true) return null;
  const code = gate.execution_blocked_reason ?? '';
  return (
    DRY_RUN_BLOCK_REASON_MESSAGE[code] ??
    'The server did not permit the safe dry test for this environment.'
  );
}

// ─── Authoritative payload validation ───────────────────────────────────

export interface ValidateDryRunPayloadInput {
  organizationId: string;
  departmentId?: string | null;
  eventDefinitionId: string;
  payload: Record<string, unknown>;
}

export function validateDryRunPayload(
  client: OmniCommsRpcClient,
  input: ValidateDryRunPayloadInput,
): Promise<DryRunValidationResult> {
  return callOmniCommsRpc<DryRunValidationResult>(
    client,
    'omni_comms_validate_dry_run_payload',
    {
      p_organization_id: input.organizationId,
      p_department_id: input.departmentId ?? null,
      p_event_definition_id: input.eventDefinitionId,
      p_payload: input.payload,
    },
  );
}

/** A validation result is only usable for the exact scope it was taken on. */
export function isValidationStale(
  validated: DryRunValidationScope | null,
  current: DryRunValidationScope,
): boolean {
  if (!validated) return true;
  return (
    validated.organizationId !== current.organizationId ||
    (validated.departmentId ?? null) !== (current.departmentId ?? null) ||
    validated.eventDefinitionId !== current.eventDefinitionId ||
    validated.payloadText !== current.payloadText
  );
}

// ─── Payload helpers ────────────────────────────────────────────────────

export function payloadByteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  return unescape(encodeURIComponent(text)).length;
}

export interface ParsedPayload {
  ok: boolean;
  value: Record<string, unknown> | null;
  error: string | null;
  bytes: number;
}

export function parsePayloadText(text: string): ParsedPayload {
  const bytes = payloadByteLength(text);
  if (bytes > ADMIN_DRY_RUN_PAYLOAD_MAX_BYTES) {
    return {
      ok: false,
      value: null,
      error: 'The payload exceeds the 256 KiB limit.',
      bytes,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, value: null, error: 'The payload is not valid JSON.', bytes };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      value: null,
      error: 'The payload must be a JSON object.',
      bytes,
    };
  }
  return { ok: true, value: parsed as Record<string, unknown>, error: null, bytes };
}

/**
 * Build a SAFE skeleton payload from a published JSON Schema. Used when the
 * contract's sample payload is redacted by the server. Never invents
 * realistic personal data: only neutral synthetic placeholders.
 */
export function buildSafeSkeletonPayload(
  schema: Record<string, unknown> | null | undefined,
  depth = 0,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!schema || depth > 4) return out;
  const props = schema.properties;
  if (!props || typeof props !== 'object') return out;
  for (const [key, raw] of Object.entries(props as Record<string, unknown>)) {
    out[key] = skeletonValue(key, raw as Record<string, unknown>, depth);
  }
  return out;
}

function skeletonValue(
  key: string,
  spec: Record<string, unknown> | null | undefined,
  depth: number,
): unknown {
  const type = Array.isArray(spec?.type) ? (spec?.type as string[])[0] : spec?.type;
  const format = typeof spec?.format === 'string' ? (spec?.format as string) : '';
  if (Array.isArray(spec?.enum) && (spec?.enum as unknown[]).length > 0) {
    return (spec?.enum as unknown[])[0];
  }
  switch (type) {
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return buildSafeSkeletonPayload(spec as Record<string, unknown>, depth + 1);
    default:
      break;
  }
  if (format === 'date') return '2026-01-01';
  if (format === 'date-time') return '2026-01-01T00:00:00Z';
  if (format === 'email' || /email/i.test(key)) {
    return `synthetic@${ADMIN_DRY_RUN_EMAIL_DOMAIN}`;
  }
  if (/name/i.test(key)) return 'Synthetic User';
  return 'TEST-REFERENCE';
}

// ─── Synthetic recipient + identifiers ──────────────────────────────────

function shortId(): string {
  const g = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const uuid = g?.randomUUID
    ? g.randomUUID()
    : `${Date.now().toString(16)}-${Math.floor(Math.random() * 1e9).toString(16)}`;
  return uuid.replace(/-/g, '').slice(0, 12);
}

export function newDryRunId(): string {
  const g = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return g?.randomUUID ? g.randomUUID() : `dryrun-${shortId()}-${shortId()}`;
}

export function buildSyntheticRecipient(
  runId: string,
  locale: string = ADMIN_DRY_RUN_DEFAULT_LOCALE,
): DryRunSyntheticRecipient {
  const suffix = runId.replace(/-/g, '').slice(0, 8) || shortId();
  return {
    recipientType: ADMIN_DRY_RUN_RECIPIENT_TYPE,
    recipientReference: `SYNTHETIC-${suffix.toUpperCase()}`,
    displayName: 'Synthetic User',
    locale,
    email: `omni-dry-run+${suffix}@${ADMIN_DRY_RUN_EMAIL_DOMAIN}`,
  };
}

/** Client-side mirror of the trusted server guard. Bounded codes only. */
export function assertSyntheticRecipients(
  recipients: readonly Partial<DryRunSyntheticRecipient & {
    phone?: string | null;
    pushDestination?: string | null;
  }>[],
): DryRunRecipientErrorCode[] {
  const errors: DryRunRecipientErrorCode[] = [];
  if (!Array.isArray(recipients) || recipients.length !== ADMIN_DRY_RUN_RECIPIENT_LIMIT) {
    errors.push('admin_dry_run_recipient_limit');
    return errors;
  }
  const r = recipients[0] ?? {};
  if (r.recipientType !== ADMIN_DRY_RUN_RECIPIENT_TYPE) {
    errors.push('admin_dry_run_recipient_invalid');
  }
  if (r.phone || r.pushDestination) {
    errors.push('admin_dry_run_recipient_invalid');
  }
  const email = (r.email ?? '').trim().toLowerCase();
  if (email === '') {
    errors.push('admin_dry_run_recipient_invalid');
  } else if (!new RegExp(`^[^@\\s]+@${ADMIN_DRY_RUN_EMAIL_DOMAIN.replace('.', '\\.')}$`).test(email)) {
    errors.push('admin_dry_run_domain_required');
  }
  return errors;
}

export function buildIdempotencyKey(eventCode: string, runId: string): string {
  const code = (eventCode || 'unknown').slice(0, 80);
  return `${ADMIN_DRY_RUN_IDEMPOTENCY_PREFIX}:${code}:${runId}`.slice(0, 200);
}

export function buildCorrelationId(runId: string): string {
  return `${ADMIN_DRY_RUN_CORRELATION_PREFIX}:${runId}`.slice(0, 120);
}

// ─── Canonical input construction ───────────────────────────────────────

export interface BuildDryRunInputArgs {
  eventCode: string;
  organizationId: string;
  departmentId?: string | null;
  payload: Record<string, unknown>;
  recipient: DryRunSyntheticRecipient;
  runId: string;
  idempotencyKey: string;
}

export function buildControlledDryRunInput(
  args: BuildDryRunInputArgs,
): SendCommunicationInput {
  return {
    eventCode: args.eventCode,
    organizationId: args.organizationId,
    departmentId: args.departmentId ?? null,
    recipients: [
      {
        recipientType: args.recipient.recipientType,
        recipientReference: args.recipient.recipientReference,
        displayName: args.recipient.displayName,
        locale: args.recipient.locale,
        email: args.recipient.email,
        phone: null,
        pushDestination: null,
      },
    ],
    payload: args.payload,
    mode: 'dry_run',
    idempotencyKey: args.idempotencyKey,
    correlationId: buildCorrelationId(args.runId),
    requestedChannels: [ADMIN_DRY_RUN_CHANNEL],
    callerContext: {
      moduleCode: ADMIN_DRY_RUN_MODULE_CODE,
      entityType: ADMIN_DRY_RUN_ENTITY_TYPE,
      entityId: args.runId,
    },
  };
}

// ─── Execution ──────────────────────────────────────────────────────────

export interface ControlledDryRunOutcome {
  result: SendCommunicationResult;
  kind: DryRunResultKind;
  state: DryRunSubmissionState;
}

export function classifyDryRunResult(
  result: SendCommunicationResult,
): { kind: DryRunResultKind; state: DryRunSubmissionState } {
  const blockers = result.blockers ?? [];
  if (blockers.includes('idempotency_payload_mismatch')) {
    return { kind: 'payload_mismatch', state: 'blocked' };
  }
  if (blockers.includes('runtime_transport_failed')) {
    return { kind: 'transport_failure', state: 'transport_uncertain' };
  }
  if (result.replayed === true) {
    return { kind: 'idempotent_replay', state: 'replayed' };
  }
  if (result.status === 'blocked' || result.status === 'failed') {
    return { kind: 'new_request', state: 'blocked' };
  }
  if (blockers.length > 0 || result.status === 'completed_with_blockers') {
    return { kind: 'new_request', state: 'completed_with_blockers' };
  }
  return { kind: 'new_request', state: 'completed' };
}

/**
 * Execute exactly one controlled administration dry run through the
 * canonical façade. Client-side guards mirror (never replace) the trusted
 * server-side administration guard.
 */
export async function executeControlledDryRun(
  args: BuildDryRunInputArgs,
): Promise<ControlledDryRunOutcome> {
  const recipientErrors = assertSyntheticRecipients([args.recipient]);
  if (recipientErrors.length > 0) {
    const blocked: SendCommunicationResult = buildBlockedResult(
      [...recipientErrors],
      { idempotencyKey: args.idempotencyKey, mode: 'dry_run' },
    );
    return { result: blocked, kind: 'new_request', state: 'blocked' };
  }

  const input = buildControlledDryRunInput(args);
  const result = await sendCommunication(input);
  const { kind, state } = classifyDryRunResult(result);
  return { result, kind, state };
}

// ─── Post-run invariants ────────────────────────────────────────────────

export function deriveInvariants(
  detail: OpsRequestDetail | null,
  result: SendCommunicationResult | null,
): DryRunInvariants {
  const recipients = detail?.recipients ?? [];
  const messages = detail?.messages ?? [];
  const jobs = detail?.dispatch_jobs ?? [];
  const attempts = detail?.delivery_attempts ?? [];
  const timeline = detail?.timeline ?? [];
  const invariants: DryRunInvariants = {
    requestPersisted: Boolean(detail?.request?.id),
    modeIsDryRun: detail?.request?.mode === 'dry_run',
    recipientCount: recipients.length,
    recipientCountMatches:
      !result || recipients.length === (result.recipients?.length ?? 0),
    messageCount: messages.length,
    messageCountMatches: !result || messages.length === (result.messages?.length ?? 0),
    dispatchJobCount: jobs.length,
    deliveryAttemptCount: attempts.length,
    timelinePresent: timeline.length > 0,
    providerContacted: false,
    emailSent: false,
    safetyViolated: jobs.length > 0 || attempts.length > 0,
  };
  return invariants;
}

export async function loadDryRunInvariants(
  client: OmniCommsRpcClient,
  input: {
    requestId: string;
    organizationId: string;
    result: SendCommunicationResult | null;
    revealSensitive?: boolean;
  },
): Promise<{ detail: OpsRequestDetail; invariants: DryRunInvariants }> {
  const detail = await getOpsRequestDetail(client, {
    requestId: input.requestId,
    organizationId: input.organizationId,
    revealSensitive: input.revealSensitive ?? false,
  });
  return { detail, invariants: deriveInvariants(detail, input.result) };
}

// ─── Controlled failure mapping ─────────────────────────────────────────

const OVERVIEW = '/admin/omnichannel-communications';
const EVENTS = '/admin/omnichannel-communications/events';
const TEMPLATES = '/admin/omnichannel-communications/templates';
const CHANNELS = '/admin/omnichannel-communications/channels';

const GUIDANCE: Record<string, DryRunGuidance> = {
  authentication_required: {
    code: 'authentication_required',
    title: 'Session not authenticated',
    message: 'Sign in again and reopen the controlled dry-run surface.',
    target: null,
  },
  permission_denied: {
    code: 'permission_denied',
    title: 'Permission denied',
    message: 'Executing a controlled dry run requires the Omni-Comms operate capability.',
    target: null,
  },
  admin_dry_run_disabled: {
    code: 'admin_dry_run_disabled',
    title: 'Controlled dry run disabled',
    message: 'Controlled dry-run execution is disabled in this environment.',
    target: null,
  },
  organization_required: {
    code: 'organization_required',
    title: 'Organisation required',
    message: 'Select an organisation before running the controlled test.',
    target: null,
  },
  department_organization_mismatch: {
    code: 'department_organization_mismatch',
    title: 'Department does not belong to the organisation',
    message: 'Reselect the department for the chosen organisation.',
    target: null,
  },
  event_code_not_found: {
    code: 'event_code_not_found',
    title: 'Event not found',
    message: 'The selected event no longer exists or is not active.',
    target: { route: EVENTS, query: '?tab=definitions', label: 'Open Events' },
  },
  no_published_contract: {
    code: 'no_published_contract',
    title: 'No published contract',
    message: 'Publish a contract version for this event before testing.',
    target: { route: EVENTS, query: '?tab=contracts', label: 'Open Contracts' },
  },
  no_active_route: {
    code: 'no_active_route',
    title: 'No active event route',
    message: 'Create and enable an email route for this event.',
    target: { route: EVENTS, query: '?tab=routes', label: 'Open Event Routes' },
  },
  template_not_resolved: {
    code: 'template_not_resolved',
    title: 'Template not resolved',
    message: 'Publish a template version for the resolved template family and locale.',
    target: { route: TEMPLATES, label: 'Open Templates' },
  },
  required_asset_unresolved: {
    code: 'required_asset_unresolved',
    title: 'Required asset unresolved',
    message: 'Resolve the required layout slots and shared assets.',
    target: { route: TEMPLATES, query: '?tab=assembly', label: 'Open Assembly' },
  },
  sender_not_ready: {
    code: 'sender_not_ready',
    title: 'Sender not ready',
    message: 'Complete the sender identity and provider binding for email.',
    target: { route: CHANNELS, label: 'Open Channels' },
  },
  payload_invalid: {
    code: 'payload_invalid',
    title: 'Payload invalid',
    message: 'The synthetic payload does not satisfy the published contract.',
    target: null,
  },
  payload_too_large: {
    code: 'payload_too_large',
    title: 'Payload too large',
    message: 'Reduce the synthetic payload below 256 KiB.',
    target: null,
  },
  idempotency_payload_mismatch: {
    code: 'idempotency_payload_mismatch',
    title: 'Idempotency payload mismatch',
    message:
      'This idempotency key was already used with different content. Start a new dry run.',
    target: null,
  },
  runtime_transport_failed: {
    code: 'runtime_transport_failed',
    title: 'Transport result uncertain',
    message:
      'The runtime boundary could not be reached. Retry with the same idempotency key — do not start a new test.',
    target: null,
  },
  runtime_persistence_failed: {
    code: 'runtime_persistence_failed',
    title: 'Runtime persistence failed',
    message: 'The runtime could not persist this request. No communication was sent.',
    target: null,
  },
  render_stage_failed: {
    code: 'render_stage_failed',
    title: 'Rendering failed',
    message: 'The message could not be rendered from the resolved template snapshot.',
    target: { route: TEMPLATES, label: 'Open Templates' },
  },
  admin_dry_run_recipient_invalid: {
    code: 'admin_dry_run_recipient_invalid',
    title: 'Synthetic recipient invalid',
    message: 'The administration test recipient must be a single synthetic email recipient.',
    target: null,
  },
  admin_dry_run_domain_required: {
    code: 'admin_dry_run_domain_required',
    title: 'example.com address required',
    message: 'Administration test recipients must use an example.com address.',
    target: null,
  },
  admin_dry_run_mode_required: {
    code: 'admin_dry_run_mode_required',
    title: 'Dry-run mode required',
    message: 'The administration test surface may only submit dry-run requests.',
    target: null,
  },
  admin_dry_run_recipient_limit: {
    code: 'admin_dry_run_recipient_limit',
    title: 'Exactly one recipient',
    message: 'The administration test surface allows exactly one synthetic recipient.',
    target: null,
  },
  admin_dry_run_channel_invalid: {
    code: 'admin_dry_run_channel_invalid',
    title: 'Email only',
    message: 'The administration test surface supports the email channel only.',
    target: null,
  },
};

export function mapDryRunFailure(code: string): DryRunGuidance {
  return (
    GUIDANCE[code] ?? {
      code: code || 'unknown',
      title: 'Controlled dry run could not complete',
      message:
        'The controlled dry run did not complete. No communication was sent and no provider was contacted.',
      target: { route: OVERVIEW, query: '?view=setup', label: 'Open Setup Wizard' },
    }
  );
}

/** Operator-safe mapping for RPC-layer failures (gate + payload validation). */
export function mapDryRunRpcError(err: unknown): DryRunGuidance {
  if (err instanceof OmniCommsRpcError) {
    const detail = err.detail ?? '';
    if (GUIDANCE[detail]) return GUIDANCE[detail];
    switch (err.code) {
      case 'OC401':
        return GUIDANCE.authentication_required;
      case 'OC403':
        return GUIDANCE.permission_denied;
      case 'OC404':
        return GUIDANCE.event_code_not_found;
      case 'OC412':
        return GUIDANCE.no_published_contract;
      case 'OC422':
        return GUIDANCE.payload_invalid;
      default:
        break;
    }
  }
  return mapDryRunFailure('unknown');
}
