/**
 * Omni-Comms CG1 — generic, truthful channel readiness projection.
 *
 * Readiness is modelled as TWO independent concepts that must never be
 * collapsed into a single verdict:
 *
 *   - configurationReadiness — is the shared configuration complete for the
 *     approved operator workflow of this channel?
 *   - deliveryReadiness      — is a genuine delivery adapter installed and
 *     permitted to deliver?
 *
 * A perfectly valid non-Email result is therefore:
 *     Configuration ready · Delivery adapter not installed
 *
 * Email is NOT re-implemented here. The existing projection
 * `projectEmailReadiness(...)` remains the single Email authority and this
 * layer delegates to it verbatim.
 */
import {
  channelCapability,
  getChannelDescriptor,
  OMNI_COMMS_CHANNEL_RESOURCES,
  type OmniCommsChannel,
} from '@/platform/omni-comms/domain/channelCatalogue';
import type {
  ChannelConfigurationSummary,
} from '@/platform/omni-comms/application/channelConfigurationTypes';
import {
  EMAIL_BUSINESS_DISPATCH_IMPLEMENTED,
  type EmailReadinessProjection,
} from './emailReadiness';

export type ConfigurationReadinessState =
  | 'loading'
  | 'unknown'
  | 'unavailable'
  | 'incomplete'
  | 'ready';

export type DeliveryReadinessState =
  | 'adapter_not_installed'
  | 'adapter_installed_delivery_disabled';

export interface ReadinessFacet<TState extends string> {
  readonly state: TState;
  readonly label: string;
  readonly detail: string;
}

export interface ChannelReadinessProjection {
  readonly channel: OmniCommsChannel;
  readonly configuration: ReadinessFacet<ConfigurationReadinessState>;
  readonly delivery: ReadinessFacet<DeliveryReadinessState>;
  /** Present for Email only — the verbatim existing projection. */
  readonly email: EmailReadinessProjection | null;
}

export const CONFIGURATION_READINESS_LABEL: Record<
  ConfigurationReadinessState,
  string
> = {
  loading: 'Configuration loading',
  unknown: 'Configuration readiness unknown',
  unavailable: 'Configuration readiness unavailable',
  incomplete: 'Configuration incomplete',
  ready: 'Configuration ready',
};

export const DELIVERY_READINESS_LABEL: Record<DeliveryReadinessState, string> = {
  adapter_not_installed: 'Delivery adapter not installed',
  adapter_installed_delivery_disabled: 'Delivery adapter installed · live delivery disabled',
};

const DELIVERY_NOT_INSTALLED_DETAIL =
  'No delivery adapter is installed for this channel. Configuration can be '
  + 'completed and preflighted, but nothing can be sent.';

const DELIVERY_INSTALLED_DETAIL =
  'A controlled delivery adapter is installed. Live delivery remains disabled '
  + 'and is governed by Release Control.';

/** Resources that genuinely constitute "configuration" for a channel. */
const CONFIGURATION_RESOURCES = OMNI_COMMS_CHANNEL_RESOURCES.filter(
  (r) => r !== 'release-control' && r !== 'test-centre' && r !== 'diagnostics',
);

function deliveryFacet(
  channel: OmniCommsChannel,
): ReadinessFacet<DeliveryReadinessState> {
  const installed =
    channel === 'email'
      ? EMAIL_BUSINESS_DISPATCH_IMPLEMENTED
      : getChannelDescriptor(channel).implemented;
  const state: DeliveryReadinessState = installed
    ? 'adapter_installed_delivery_disabled'
    : 'adapter_not_installed';
  return {
    state,
    label: DELIVERY_READINESS_LABEL[state],
    detail: installed ? DELIVERY_INSTALLED_DETAIL : DELIVERY_NOT_INSTALLED_DETAIL,
  };
}

/**
 * Project readiness for a NON-Email channel from the generic configuration
 * summary. Unloaded and unavailable resources are never treated as zero.
 */
export function projectChannelConfigurationReadiness(
  channel: OmniCommsChannel,
  summary: ChannelConfigurationSummary | null | undefined,
  loading = false,
): ReadinessFacet<ConfigurationReadinessState> {
  if (loading) {
    return {
      state: 'loading',
      label: CONFIGURATION_READINESS_LABEL.loading,
      detail: 'Reading the configuration for this channel.',
    };
  }
  if (!summary) {
    return {
      state: 'unknown',
      label: CONFIGURATION_READINESS_LABEL.unknown,
      detail: 'No configuration summary has been loaded for this scope yet.',
    };
  }

  const applicable = CONFIGURATION_RESOURCES.filter(
    (r) => channelCapability(channel, r).uiApplicable,
  );

  const unavailable = applicable.filter(
    (r) => summary.resources[r]?.state === 'unavailable',
  );
  if (unavailable.length > 0) {
    return {
      state: 'unavailable',
      label: CONFIGURATION_READINESS_LABEL.unavailable,
      detail:
        `These resources could not be read: ${unavailable.join(', ')}. `
        + 'Readiness is deliberately not inferred from partial data.',
    };
  }

  const pending = applicable.filter((r) => summary.resources[r]?.state === 'loading');
  if (pending.length > 0) {
    return {
      state: 'loading',
      label: CONFIGURATION_READINESS_LABEL.loading,
      detail: 'Reading the configuration for this channel.',
    };
  }

  if (applicable.length === 0) {
    return {
      state: 'unknown',
      label: CONFIGURATION_READINESS_LABEL.unknown,
      detail: 'No configurable resource is part of this channel workflow yet.',
    };
  }

  const empty = applicable.filter((r) => (summary.resources[r]?.active ?? 0) === 0);
  if (empty.length > 0) {
    return {
      state: 'incomplete',
      label: CONFIGURATION_READINESS_LABEL.incomplete,
      detail: `No active record exists for: ${empty.join(', ')}.`,
    };
  }

  return {
    state: 'ready',
    label: CONFIGURATION_READINESS_LABEL.ready,
    detail:
      'Every resource in this channel workflow has at least one active '
      + 'genuine record.',
  };
}

/**
 * The ONE readiness entry point used by the Channels workspace.
 *
 * For Email it delegates to `projectEmailReadiness(...)` verbatim; the Email
 * verdict is copied, never recomputed.
 */
export function projectChannelReadiness(input: {
  channel: OmniCommsChannel;
  emailProjection?: EmailReadinessProjection | null;
  configurationSummary?: ChannelConfigurationSummary | null;
  loading?: boolean;
}): ChannelReadinessProjection {
  const { channel, emailProjection, configurationSummary, loading = false } = input;

  if (channel === 'email') {
    const email = emailProjection ?? null;
    const state: ConfigurationReadinessState = !email
      ? loading
        ? 'loading'
        : 'unknown'
      : email.state === 'prerequisites_met'
        ? 'ready'
        : email.state === 'incomplete'
          ? 'incomplete'
          : 'unknown';
    return {
      channel,
      configuration: {
        state,
        // Preserve the existing Email wording verbatim.
        label: email ? email.label : CONFIGURATION_READINESS_LABEL[state],
        detail: email ? email.explanation : 'Email configuration has not been read yet.',
      },
      delivery: deliveryFacet(channel),
      email,
    };
  }

  return {
    channel,
    configuration: projectChannelConfigurationReadiness(
      channel,
      configurationSummary,
      loading,
    ),
    delivery: deliveryFacet(channel),
    email: null,
  };
}
