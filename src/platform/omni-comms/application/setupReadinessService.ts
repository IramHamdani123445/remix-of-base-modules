/**
 * Omni-Comms — Phase 4 Guided Configuration Setup Wizard application service.
 *
 * Responsibilities:
 *   - a typed adapter over the ONE bounded read-only aggregate RPC
 *     `omni_comms_setup_readiness`;
 *   - operator-safe error mapping;
 *   - PURE derivation of the fourteen guided steps, their evidence, the next
 *     required action and the overall dry-run posture.
 *
 * Boundaries (enforced by OMNI_SETUP_WIZARD_BOUNDARY):
 *   - never imports the browser Supabase singleton;
 *   - never queries a table with `.from(...)`;
 *   - never invokes a runtime mutation or the send façade;
 *   - never imports a provider SDK;
 *   - never re-implements resolution precedence — precedence is decided by
 *     the RPC and only rendered here;
 *   - never returns or displays credential material.
 */
import type { OmniCommsRpcClient } from './eventCatalogueService';
import { callOmniCommsRpc } from './omniCommsRpcCall';
import { OmniCommsRpcError } from './eventCatalogueTypes';
import {
  OMNI_COMMS_SETUP_STEP_IDS,
  type SetupBlocker,
  type SetupPlan,
  type SetupError,
  type SetupReadinessPayload,
  type SetupStep,
  type SetupStepId,
  type SetupStepState,
  type SetupStepTarget,
} from './setupReadinessTypes';

export * from './setupReadinessTypes';

// ─── Adapter ─────────────────────────────────────────────────────────────

export interface SetupReadinessInput {
  organizationId: string;
  departmentId?: string | null;
  eventDefinitionId?: string | null;
  /** Email is the only pilot channel in this phase. */
  channel?: 'email';
  locale?: string;
}

export function getSetupReadiness(
  client: OmniCommsRpcClient,
  input: SetupReadinessInput,
): Promise<SetupReadinessPayload> {
  return callOmniCommsRpc<SetupReadinessPayload>(client, 'omni_comms_setup_readiness', {
    p_organization_id: input.organizationId,
    p_department_id: input.departmentId ?? null,
    p_event_definition_id: input.eventDefinitionId ?? null,
    p_channel: input.channel ?? 'email',
    p_locale: input.locale ?? 'en',
  });
}

// ─── Error mapping ───────────────────────────────────────────────────────

export function mapSetupError(err: unknown): SetupError {
  if (err instanceof OmniCommsRpcError) {
    switch (err.code) {
      case 'OC401':
        return {
          kind: 'permission_denied',
          message: 'Your session is not authenticated.',
          retryable: false,
        };
      case 'OC403':
        return {
          kind: 'permission_denied',
          message:
            'You do not hold the capability required to read Omni-Comms setup readiness.',
          retryable: false,
        };
      case 'OC404':
        return {
          kind: 'not_found',
          message: 'The selected pilot event no longer exists.',
          retryable: false,
        };
      case 'OC422':
        return {
          kind: 'tenant_unavailable',
          message:
            'The selected organisation, department, channel or locale is not valid for setup readiness.',
          retryable: false,
        };
      default:
        return {
          kind: 'rpc_unavailable',
          message: 'The setup readiness service could not be reached.',
          retryable: true,
        };
    }
  }
  const text = err instanceof Error ? err.message : String(err ?? '');
  if (/abort|timeout|timed out/i.test(text)) {
    return { kind: 'timed_out', message: 'The setup readiness request timed out.', retryable: true };
  }
  if (/could not find the function|schema cache|404/i.test(text)) {
    return {
      kind: 'rpc_unavailable',
      message: 'The setup readiness service is not available in this environment.',
      retryable: true,
    };
  }
  return { kind: 'unknown', message: 'Setup readiness could not be completed.', retryable: true };
}

// ─── Step metadata ───────────────────────────────────────────────────────

const OVERVIEW = '/admin/omnichannel-communications';
const EVENTS = '/admin/omnichannel-communications/events';
const TEMPLATES = '/admin/omnichannel-communications/templates';
const CHANNELS = '/admin/omnichannel-communications/channels';
const HEALTH = '/admin/omnichannel-communications/health';

interface StepMeta {
  title: string;
  purpose: string;
  target: SetupStepTarget | null;
}

const STEP_META: Record<SetupStepId, StepMeta> = {
  tenant: {
    title: 'Tenant scope',
    purpose:
      'Choose the organisation and optional department this pilot email path belongs to.',
    target: null,
  },
  event: {
    title: 'Pilot event definition',
    purpose:
      'Select the active business event that will trigger this communication.',
    target: { route: EVENTS, query: '?tab=definitions', label: 'Open Events' },
  },
  contract: {
    title: 'Published event contract',
    purpose:
      'A published contract fixes the payload shape templates may rely on.',
    target: { route: EVENTS, query: '?tab=contracts', label: 'Open Contracts' },
  },
  route: {
    title: 'Email event route',
    purpose:
      'The route links the event to the email channel, a template family and a sender policy.',
    target: { route: EVENTS, query: '?tab=routes', label: 'Open Event Routes' },
  },
  template_family: {
    title: 'Template family',
    purpose: 'The active family the route resolves its content from.',
    target: { route: TEMPLATES, query: '?tab=families', label: 'Open Templates' },
  },
  template_version: {
    title: 'Published template version',
    purpose:
      'A published email version for the selected locale is required before anything can render.',
    target: { route: TEMPLATES, query: '?tab=versions', label: 'Open Template Versions' },
  },
  layout: {
    title: 'Layout resolution',
    purpose:
      'A published layout version must resolve, either pinned on the version or inherited from scope.',
    target: { route: TEMPLATES, query: '?tab=assembly', label: 'Open Assembly' },
  },
  assets: {
    title: 'Required layout assets',
    purpose:
      'Every required layout slot must resolve to an active shared asset version.',
    target: { route: TEMPLATES, query: '?tab=assembly', label: 'Open Assembly' },
  },
  provider: {
    title: 'Email provider',
    purpose: 'An active email provider must be registered for the platform.',
    target: { route: CHANNELS, query: '?tab=providers', label: 'Open Channels' },
  },
  provider_account: {
    title: 'Provider account',
    purpose:
      'An active provider account holds the credential reference and health state for this organisation.',
    target: { route: CHANNELS, query: '?tab=accounts', label: 'Open Provider Accounts' },
  },
  sender: {
    title: 'Sender identity',
    purpose: 'The active from-identity the resolved route will send as.',
    target: { route: CHANNELS, query: '?tab=senders', label: 'Open Sender Identities' },
  },
  binding: {
    title: 'Sender-to-provider binding',
    purpose:
      'The binding attaches the sender identity to a provider account and records verification.',
    target: { route: CHANNELS, query: '?tab=bindings', label: 'Open Bindings' },
  },
  channel_setting: {
    title: 'Email channel setting',
    purpose:
      'Channel settings enable email for this scope and hold quiet hours and rate limits.',
    target: { route: CHANNELS, query: '?tab=settings', label: 'Open Channel Settings' },
  },
  runtime: {
    title: 'Runtime and certification',
    purpose:
      'Runtime objects must be present. Live provider dispatch is not implemented in this build.',
    target: { route: HEALTH, label: 'Open Health' },
  },
};

// ─── Pure derivation ─────────────────────────────────────────────────────

function fmtBool(value: boolean | undefined, yes: string, no: string): string {
  return value ? yes : no;
}

function evidenceFor(id: SetupStepId, p: SetupReadinessPayload): string[] {
  switch (id) {
    case 'tenant':
      return [
        `organisation: ${p.tenant.organization_id}`,
        `scope: ${p.tenant.scope}`,
        `channel: ${p.channel}`,
        `locale: ${p.locale}`,
      ];
    case 'event':
      return p.event.present
        ? [
            `event: ${p.event.code}`,
            `module: ${p.event.module_code}`,
            `class: ${p.event.communication_class}`,
            `status: ${p.event.status}`,
          ]
        : ['no pilot event selected'];
    case 'contract':
      return p.contract.present
        ? [
            `version: v${p.contract.version_number}`,
            `status: ${p.contract.status}`,
            `checksum: ${p.contract.checksum ?? 'none'}`,
            `required fields: ${(p.contract.required_fields ?? []).length}`,
            fmtBool(p.contract.sample_payload_present, 'sample payload: present', 'sample payload: none'),
          ]
        : ['no published contract'];
    case 'route':
      return p.route.present
        ? [
            `resolved from: ${p.route.source}`,
            `lifecycle: ${p.route.lifecycle_state}`,
            fmtBool(p.route.is_enabled, 'enabled: yes', 'enabled: no'),
            `sender policy: ${p.route.sender_resolution_policy}`,
            `preference policy: ${p.route.preference_policy}`,
          ]
        : ['no email route for this event'];
    case 'template_family':
      return p.template_family.present
        ? [
            `family: ${p.template_family.code}`,
            `scope: ${p.template_family.scope_type}`,
            `status: ${p.template_family.status}`,
          ]
        : ['no template family bound to the route'];
    case 'template_version':
      return p.template_version.present
        ? [
            `version: v${p.template_version.version_number}`,
            `locale: ${p.template_version.locale}`,
            `status: ${p.template_version.status}`,
            `checksum: ${p.template_version.checksum ?? 'none'}`,
          ]
        : ['no published email version for this locale'];
    case 'layout':
      return p.layout.present
        ? [
            `layout: ${p.layout.layout_code ?? p.layout.layout_id}`,
            `version: v${p.layout.layout_version_number ?? '?'}`,
            `inherited from: ${p.layout.inheritance_source ?? 'unknown'}`,
            `slots: ${p.layout.slot_count ?? 0}`,
          ]
        : ['no published layout version resolves'];
    case 'assets': {
      const slots = p.assets?.slots ?? [];
      if (slots.length === 0) return ['no layout slots to resolve'];
      return slots.map(
        (s) =>
          `${s.slot_code}: ${s.state}${
            s.inheritance_source && s.state === 'resolved' ? ` (${s.inheritance_source})` : ''
          }`,
      );
    }
    case 'provider':
      return p.provider.present
        ? [`provider: ${p.provider.code}`, `status: ${p.provider.status}`]
        : ['no email provider registered'];
    case 'provider_account':
      return p.provider_account.present
        ? [
            `account: ${p.provider_account.code}`,
            `status: ${p.provider_account.status}`,
            fmtBool(p.provider_account.sandbox_mode, 'mode: sandbox', 'mode: production'),
            `health: ${p.provider_account.health_state ?? 'unknown'}`,
            `last checked: ${p.provider_account.health_checked_at ?? 'never'}`,
          ]
        : ['no provider account for this organisation'];
    case 'sender':
      return p.sender.present
        ? [
            `sender: ${p.sender.code}`,
            `scope: ${p.sender.scope}`,
            `status: ${p.sender.status}`,
            `from: ${p.sender.from_address_display ?? 'not set'}${
              p.sender.from_address_masked ? ' (masked)' : ''
            }`,
          ]
        : ['no sender identity resolves in this scope'];
    case 'binding':
      return p.binding.present
        ? [
            `status: ${p.binding.status}`,
            `verification: ${p.binding.verification_status}`,
            `verified at: ${p.binding.verified_at ?? 'never'}`,
          ]
        : ['sender is not bound to a provider account'];
    case 'channel_setting':
      return p.channel_setting.present
        ? [
            `scope: ${p.channel_setting.scope}`,
            fmtBool(p.channel_setting.enabled, 'channel: enabled', 'channel: disabled'),
            fmtBool(
              p.channel_setting.live_delivery_enabled,
              'live delivery: enabled',
              'live delivery: disabled',
            ),
            `per-minute limit: ${p.channel_setting.per_minute_limit ?? 'none'}`,
          ]
        : ['no email channel setting for this scope'];
    case 'runtime': {
      const tables = Object.entries(p.runtime?.tables ?? {});
      const fns = Object.entries(p.runtime?.functions ?? {});
      return [
        `runtime tables present: ${tables.filter(([, v]) => v).length}/${tables.length}`,
        `runtime functions present: ${fns.filter(([, v]) => v).length}/${fns.length}`,
        `certification: ${p.runtime?.certification?.overall ?? 'not_certified'}`,
        'live provider dispatch: not implemented',
      ];
    }
    default:
      return [];
  }
}

function sectionPresent(id: SetupStepId, p: SetupReadinessPayload): boolean {
  switch (id) {
    case 'tenant':
      return Boolean(p.tenant?.organization_id);
    case 'event':
      return Boolean(p.event?.present);
    case 'contract':
      return Boolean(p.contract?.present);
    case 'route':
      return Boolean(p.route?.present);
    case 'template_family':
      return Boolean(p.template_family?.present);
    case 'template_version':
      return Boolean(p.template_version?.present);
    case 'layout':
      return Boolean(p.layout?.present);
    case 'assets':
      return (p.assets?.unresolved_required ?? 0) === 0;
    case 'provider':
      return Boolean(p.provider?.present);
    case 'provider_account':
      return Boolean(p.provider_account?.present);
    case 'sender':
      return Boolean(p.sender?.present);
    case 'binding':
      return Boolean(p.binding?.present);
    case 'channel_setting':
      return Boolean(p.channel_setting?.present);
    case 'runtime':
      return Boolean(p.runtime?.implementation_complete);
    default:
      return false;
  }
}

function stateFor(
  present: boolean,
  blockers: SetupBlocker[],
  warnings: SetupBlocker[],
): SetupStepState {
  if (blockers.length > 0) return present ? 'incomplete' : 'not_started';
  if (warnings.length > 0) return 'attention';
  return present ? 'complete' : 'not_started';
}

/**
 * Derives the fourteen guided steps from the server payload.
 *
 * This function performs NO resolution of its own — every blocker, warning
 * and precedence decision originates in `omni_comms_setup_readiness`.
 */
export function buildSetupPlan(p: SetupReadinessPayload): SetupPlan {
  const all = Array.isArray(p.blockers) ? p.blockers : [];
  const steps: SetupStep[] = OMNI_COMMS_SETUP_STEP_IDS.map((id, i) => {
    const forStep = all.filter((b) => b.step === id);
    const blockers = forStep.filter((b) => b.severity === 'blocker');
    const warnings = forStep.filter((b) => b.severity === 'warning');
    const present = sectionPresent(id, p);
    return {
      id,
      index: i + 1,
      title: STEP_META[id].title,
      purpose: STEP_META[id].purpose,
      state: stateFor(present, blockers, warnings),
      evidence: evidenceFor(id, p),
      blockers,
      warnings,
      target: STEP_META[id].target,
    };
  });

  const nextRequiredStep =
    steps.find((s) => s.state === 'not_started' || s.state === 'incomplete') ?? null;

  return {
    steps,
    totalSteps: steps.length,
    completedSteps: steps.filter((s) => s.state === 'complete' || s.state === 'attention').length,
    nextRequiredStep,
    blockers: all.filter((b) => b.severity === 'blocker'),
    warnings: all.filter((b) => b.severity === 'warning'),
    dryRunReady: Boolean(p.dry_run_ready),
    liveSendReady: false,
    generatedAt: p.generated_at,
  };
}

/** Absolute link for a step target, or null when the step has no target. */
export function stepTargetHref(step: SetupStep): string | null {
  if (!step.target) return null;
  return `${step.target.route}${step.target.query ?? ''}`;
}
