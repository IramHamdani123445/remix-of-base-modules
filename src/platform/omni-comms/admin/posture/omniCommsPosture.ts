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

// ── Derived certification posture (single source of truth) ────────────────

/**
 * Every surface that speaks about certification — the module header, the
 * Dashboard, the Certification Evidence view, Operations and Safe test — MUST
 * derive its wording from {@link deriveCertificationPosture}. No screen may
 * invent its own certification sentence, and no screen may decide on its own
 * whether the safe dry test may run.
 */
export type OmniCommsRevisionMatch = 'match' | 'mismatch' | 'unknown';

export type OmniCommsCertificationOutcome =
  | 'certified'
  | 'pending'
  | 'failed'
  | 'unknown';

/** Broader normaliser that preserves an explicit `failed` outcome. */
export function normaliseCertificationOutcome(
  raw: string | null | undefined,
): OmniCommsCertificationOutcome {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'certified') return 'certified';
  if (v === 'failed' || v === 'revoked') return 'failed';
  if (v === 'pending' || v === 'not_certified' || v === 'uncertified') {
    return 'pending';
  }
  return 'unknown';
}

/** Full 40-character revision identifier. Nothing shorter is accepted. */
export const OMNI_COMMS_REVISION_PATTERN = /^[0-9a-fA-F]{40}$/;

export function isFullRevision(value: string | null | undefined): boolean {
  return OMNI_COMMS_REVISION_PATTERN.test((value ?? '').trim());
}

/**
 * Compare a recorded certified commit with the deployed runtime revision.
 *
 * EXACT, case-insensitive, full-SHA equality only. Prefix matching is not
 * permitted: a shortened, malformed or absent revision is never a match.
 */
export function compareRevision(
  certifiedCommit: string | null,
  deployedRevision: string | null,
): OmniCommsRevisionMatch {
  const a = (certifiedCommit ?? '').trim().toLowerCase();
  const b = (deployedRevision ?? '').trim().toLowerCase();
  if (!isFullRevision(a) || !isFullRevision(b)) return 'unknown';
  return a === b ? 'match' : 'mismatch';
}

/**
 * Inputs for {@link deriveCertificationPosture}.
 *
 * EVERY field originates from the deployed runtime `/health` response, which
 * itself reads the protected database certification record through a
 * service-role RPC. The source-controlled evidence record
 * (`certificationEvidence.ts`) is HISTORICAL DOCUMENTATION ONLY and must never
 * appear here: database health posture is the sole runtime certification
 * authority, and requiring a source-code edit after certification would change
 * the deployed commit SHA and invalidate the certified-revision match.
 */
export interface CertificationPostureInput {
  /** Certified commit reported by the server posture. */
  certifiedCommit: string | null;
  /** Revision reported by the deployed runtime health probe. */
  deployedRevision: string | null;
  /** Certification state reported by the deployed runtime health probe. */
  edgeCertificationState: string | null | undefined;
  /** Whether the deployed runtime answered its health probe. */
  edgeAvailable: boolean | null;
  /** Server statement that the deployed revision is a full 40-char SHA. */
  edgeRevisionVerified?: boolean | null;
  /** Server-performed exact full-SHA comparison. */
  edgeRevisionMatch?: OmniCommsRevisionMatch | null;
  /** Explicit server decision. Anything other than `true` blocks. */
  edgeSafeTestPermitted?: boolean | null;
  /** Bounded server reason code when the safe dry test is withheld. */
  edgeSafeTestBlockedReason?: string | null;
  environment: OmniCommsEnvironment;
}

export interface DerivedCertificationPosture {
  state: OmniCommsCertificationOutcome;
  revision: OmniCommsRevisionMatch;
  /** Whether the presentation layer may offer the safe dry test at all. */
  safeTestPermitted: boolean;
  /** Operator-safe sentence explaining the derived state. */
  reason: string;
}

export const CERTIFICATION_OUTCOME_LABEL: Record<
  OmniCommsCertificationOutcome,
  string
> = {
  certified: 'Privileged certification complete',
  pending: OMNI_COMMS_POSTURE_STATEMENTS.certificationPending,
  failed: 'Privileged certification failed',
  unknown: 'Certification state unknown',
};

export function deriveCertificationPosture(
  input: CertificationPostureInput,
): DerivedCertificationPosture {
  const reported = normaliseCertificationOutcome(input.edgeCertificationState);
  const localRevision = compareRevision(
    input.certifiedCommit,
    input.deployedRevision,
  );
  const commitValid = isFullRevision(input.certifiedCommit);
  const revisionValid = isFullRevision(input.deployedRevision);
  // The server comparison is authoritative when present; the local comparison
  // is only a presentation fallback and can never upgrade the outcome.
  const serverRevision: OmniCommsRevisionMatch | null =
    input.edgeRevisionMatch === 'match' ||
    input.edgeRevisionMatch === 'mismatch' ||
    input.edgeRevisionMatch === 'unknown'
      ? input.edgeRevisionMatch
      : null;
  const revision: OmniCommsRevisionMatch =
    serverRevision === null
      ? localRevision
      : serverRevision === 'match' && localRevision !== 'match'
        ? localRevision
        : serverRevision;
  // Missing health facts fail closed.
  const revisionVerified =
    input.edgeRevisionVerified === undefined
      ? revisionValid
      : input.edgeRevisionVerified === true && revisionValid;

  let state: OmniCommsCertificationOutcome;
  if (reported === 'failed') {
    state = 'failed';
  } else if (input.edgeAvailable !== true) {
    state = 'unknown';
  } else if (reported === 'unknown') {
    state = 'unknown';
  } else if (
    reported === 'certified' &&
    commitValid &&
    revisionVerified &&
    revision === 'match'
  ) {
    state = 'certified';
  } else {
    state = 'pending';
  }

  // FAIL CLOSED. Everything below must be true before the presentation layer
  // may even offer the safe dry test. The trusted server guard remains the
  // final authority and cannot be bypassed from here.
  const serverPermits =
    input.edgeSafeTestPermitted === undefined
      ? true
      : input.edgeSafeTestPermitted === true;

  const safeTestPermitted =
    input.environment === 'non_production' &&
    input.edgeAvailable === true &&
    serverPermits &&
    reported === 'certified' &&
    commitValid &&
    revisionValid &&
    revisionVerified &&
    revision === 'match' &&
    state === 'certified';

  let reason: string;
  if (input.environment === 'production') {
    reason =
      'The safe dry test is not offered in production. Non-production tooling is withheld here.';
  } else if (input.environment !== 'non_production') {
    reason =
      'The environment could not be classified as non-production, so the safe dry test is withheld.';
  } else if (state === 'failed') {
    reason =
      'Privileged certification failed for the deployed runtime. The safe dry test is withheld until certification is repaired.';
  } else if (input.edgeAvailable !== true) {
    reason =
      'The deployed runtime did not report a usable certification state, so the safe dry test is withheld.';
  } else if (state === 'unknown') {
    reason =
      'The deployed runtime did not report a usable certification state, so the safe dry test is withheld.';
  } else if (state === 'certified' && !serverPermits) {
    reason =
      'The deployed runtime is certified but the server withheld the safe dry test. Treat the safe dry test as unavailable.';
  } else if (state === 'certified') {
    reason =
      'The deployed runtime is certified. Live delivery remains disabled and no provider dispatch exists.';
  } else if (revision === 'mismatch') {
    reason =
      'The certified commit does not match the deployed runtime revision. Treat the deployed runtime as uncertified.';
  } else if (!commitValid || !revisionVerified) {
    reason =
      'The certified commit or the deployed runtime revision is missing or malformed. Treat the deployed runtime as uncertified.';
  } else {
    reason =
      'Privileged certification is pending. The safe dry test validates configuration only — nothing is sent.';
  }

  return { state, revision, safeTestPermitted, reason };
}

