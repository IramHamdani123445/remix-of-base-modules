/**
 * Omni-Comms — administrator posture model.
 *
 * Replaces the previous binary "Available / Coming soon" badge with seven
 * INDEPENDENT states. A screen being reachable never implies that the runtime
 * is certified, that configuration is complete, or that delivery is possible.
 *
 * Presentation-only: this module derives labels from facts supplied by the
 * caller (route registry, setup readiness payload, Edge health probe). It
 * performs no I/O, mutates nothing and contacts no provider.
 */

/**
 * Canonical wording that MUST be used verbatim while privileged certification
 * is pending. Screens render these strings; they are never paraphrased.
 */
export const OMNI_COMMS_POSTURE_STATEMENTS = {
  runtimeImplemented: 'Runtime implemented',
  certificationPending: 'Privileged certification pending',
  liveDeliveryDisabled: 'Live delivery disabled',
  noProviderDispatch: 'No provider dispatch',
  legacyActive: 'Legacy remains active',
} as const;

export type OmniCommsPostureStatement =
  (typeof OMNI_COMMS_POSTURE_STATEMENTS)[keyof typeof OMNI_COMMS_POSTURE_STATEMENTS];

/** Ordered list used by the module header and the dashboard cards. */
export const OMNI_COMMS_PENDING_POSTURE_LINES: readonly OmniCommsPostureStatement[] = [
  OMNI_COMMS_POSTURE_STATEMENTS.runtimeImplemented,
  OMNI_COMMS_POSTURE_STATEMENTS.certificationPending,
  OMNI_COMMS_POSTURE_STATEMENTS.liveDeliveryDisabled,
  OMNI_COMMS_POSTURE_STATEMENTS.noProviderDispatch,
  OMNI_COMMS_POSTURE_STATEMENTS.legacyActive,
] as const;

// ── Environment ───────────────────────────────────────────────────────────

export type OmniCommsEnvironment = 'non_production' | 'production' | 'unknown';

/** Hosts treated as production for Omni-Comms non-production gating. */
export const OMNI_COMMS_PRODUCTION_HOSTS: readonly string[] = [
  'admin.secureserve.biz',
  'social-wellspring-app.lovable.app',
];

export function detectOmniCommsEnvironment(
  hostname?: string | null,
): OmniCommsEnvironment {
  const host = (hostname ?? '').trim().toLowerCase();
  if (!host) return 'unknown';
  if (OMNI_COMMS_PRODUCTION_HOSTS.includes(host)) return 'production';
  return 'non_production';
}

export function currentOmniCommsEnvironment(): OmniCommsEnvironment {
  if (typeof window === 'undefined') return 'unknown';
  return detectOmniCommsEnvironment(window.location?.hostname);
}

export const ENVIRONMENT_LABEL: Record<OmniCommsEnvironment, string> = {
  non_production: 'Non-production',
  production: 'Production',
  unknown: 'Environment unknown',
};

export function isNonProduction(env: OmniCommsEnvironment): boolean {
  return env === 'non_production';
}

// ── Certification ─────────────────────────────────────────────────────────

export type OmniCommsCertificationState = 'certified' | 'pending' | 'unknown';

export function normaliseCertificationState(
  raw: string | null | undefined,
): OmniCommsCertificationState {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'certified') return 'certified';
  if (v === 'pending' || v === 'not_certified' || v === 'uncertified') {
    return 'pending';
  }
  return 'unknown';
}

export const CERTIFICATION_LABEL: Record<OmniCommsCertificationState, string> = {
  certified: 'Privileged certification complete',
  pending: OMNI_COMMS_POSTURE_STATEMENTS.certificationPending,
  unknown: 'Certification state unknown',
};

// ── Facets ────────────────────────────────────────────────────────────────

export type PostureTone = 'positive' | 'neutral' | 'pending' | 'blocked';

export type PostureFacetId =
  | 'screen_availability'
  | 'configuration_readiness'
  | 'runtime_implementation'
  | 'privileged_certification'
  | 'delivery_availability'
  | 'environment'
  | 'legacy_coexistence';

export interface PostureFacet {
  id: PostureFacetId;
  label: string;
  value: string;
  tone: PostureTone;
  detail: string;
}

export interface PostureInput {
  /** Whether the currently-open screen is implemented and reachable. */
  screenAvailable: boolean;
  /** Whether the selected configuration path is dry-run ready (null = unknown). */
  configurationReady: boolean | null;
  /** Whether the deployed runtime Edge function answered its health probe. */
  runtimeAvailable: boolean | null;
  certification: OmniCommsCertificationState;
  /** Live delivery is never enabled in this build. */
  liveDeliveryEnabled: boolean;
  environment: OmniCommsEnvironment;
}

export function buildPostureFacets(input: PostureInput): PostureFacet[] {
  const configValue =
    input.configurationReady === null
      ? 'Not evaluated for this scope'
      : input.configurationReady
        ? 'Configuration complete for the selected path'
        : 'Configuration incomplete';

  const runtimeValue =
    input.runtimeAvailable === null
      ? OMNI_COMMS_POSTURE_STATEMENTS.runtimeImplemented
      : input.runtimeAvailable
        ? `${OMNI_COMMS_POSTURE_STATEMENTS.runtimeImplemented} · deployed`
        : `${OMNI_COMMS_POSTURE_STATEMENTS.runtimeImplemented} · not reachable`;

  return [
    {
      id: 'screen_availability',
      label: 'Screen',
      value: input.screenAvailable ? 'Screen available' : 'Screen not implemented',
      tone: input.screenAvailable ? 'positive' : 'neutral',
      detail:
        'Whether this administration screen exists. It says nothing about configuration or delivery.',
    },
    {
      id: 'configuration_readiness',
      label: 'Configuration',
      value: configValue,
      tone:
        input.configurationReady === null
          ? 'neutral'
          : input.configurationReady
            ? 'positive'
            : 'pending',
      detail:
        'Whether the selected organisation, event, channel and locale resolve a complete path.',
    },
    {
      id: 'runtime_implementation',
      label: 'Runtime',
      value: runtimeValue,
      tone: input.runtimeAvailable === false ? 'blocked' : 'positive',
      detail:
        'The send façade and runtime resolution are implemented and deployed.',
    },
    {
      id: 'privileged_certification',
      label: 'Certification',
      value: CERTIFICATION_LABEL[input.certification],
      tone: input.certification === 'certified' ? 'positive' : 'pending',
      detail:
        'Privileged certification is executed separately and is not run from this interface.',
    },
    {
      id: 'delivery_availability',
      label: 'Delivery',
      value: input.liveDeliveryEnabled
        ? 'Live delivery enabled'
        : `${OMNI_COMMS_POSTURE_STATEMENTS.liveDeliveryDisabled} · ${OMNI_COMMS_POSTURE_STATEMENTS.noProviderDispatch}`,
      tone: input.liveDeliveryEnabled ? 'positive' : 'blocked',
      detail:
        'No provider dispatch, retry, resend or webhook processing exists in this build.',
    },
    {
      id: 'environment',
      label: 'Environment',
      value: ENVIRONMENT_LABEL[input.environment],
      tone: input.environment === 'production' ? 'blocked' : 'neutral',
      detail:
        'Non-production tooling and the safe dry test are only offered outside production.',
    },
    {
      id: 'legacy_coexistence',
      label: 'Legacy',
      value: OMNI_COMMS_POSTURE_STATEMENTS.legacyActive,
      tone: 'neutral',
      detail:
        'Communication Hub — Legacy continues to run unchanged. No cutover has taken place.',
    },
  ];
}

/** Compact posture used by the module header (no tenant-scoped facts). */
export function buildHeaderPosture(input: {
  certification: OmniCommsCertificationState;
  environment: OmniCommsEnvironment;
}): PostureFacet[] {
  return buildPostureFacets({
    screenAvailable: true,
    configurationReady: null,
    runtimeAvailable: null,
    certification: input.certification,
    liveDeliveryEnabled: false,
    environment: input.environment,
  }).filter((f) =>
    (
      [
        'runtime_implementation',
        'privileged_certification',
        'delivery_availability',
        'legacy_coexistence',
      ] as PostureFacetId[]
    ).includes(f.id),
  );
}
