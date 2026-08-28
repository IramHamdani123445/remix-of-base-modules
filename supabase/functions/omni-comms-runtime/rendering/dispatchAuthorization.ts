// Omni-Comms Runtime — fail-closed dispatch authorisation decision.
//
// Wave 4 / DEF-4 Part 3. Until now `resolveHoldReason()` ended with an
// unconditional `runtime_privileged_certification_pending`, so this build
// could never emit a runnable dispatch job under any configuration.
//
// That unconditional hold is replaced here by an EXPLICIT, ORDERED,
// FAIL-CLOSED decision. Every unknown, absent or unparseable input denies.
// There is no global enable flag, no environment override and no "return
// null" escape: a job becomes runnable only when EVERY condition below holds
// simultaneously.
//
// This module decides nothing about provider behaviour and contacts nothing.
// It is mirrored server-side by the persistence RPC, which re-evaluates the
// same contract inside the write transaction; this TypeScript copy exists so
// the runtime can record a precise hold reason on the job it proposes.

/** Adapters that carry no external credential and cannot leave the platform. */
export const CERTIFICATION_SAFE_ADAPTERS: readonly string[] = [
  "simulation_email",
  "simulation_in_app",
  "simulation_sms",
  "internal_in_app",
];

/**
 * Credential-bearing adapters that reach a real external recipient. These can
 * NEVER be authorised by this decision, regardless of configuration.
 */
export const EXTERNAL_CREDENTIAL_ADAPTERS: readonly string[] = [
  "resend",
  "twilio",
  "twilio_whatsapp",
  "twilio_voice",
  "firebase_push",
  "outbound_webhook",
  "print_spool",
  "smtp",
  "ses",
  "sendgrid",
];

/** Precise, non-collapsible hold reasons. */
export type DispatchHoldReason =
  | "runtime_privileged_certification_pending"
  | "environment_not_certified"
  | "project_ref_mismatch"
  | "release_control_missing"
  | "release_not_controlled_pilot"
  | "pilot_expired"
  | "runtime_revision_not_approved"
  | "module_not_in_pilot_scope"
  | "mode_not_queued"
  | "recipient_not_allowlisted"
  | "provider_not_certification_safe"
  | "provider_credentials_unavailable"
  | "historical_job_not_authorized"
  | "job_quarantined";

export interface DispatchAuthorizationRelease {
  release_state: string | null;
  release_expires_at: string | null;
  approved_commit: string | null;
  permitted_caller_modules: string[] | null;
  permitted_modes: string[] | null;
}

export interface DispatchAuthorizationContext {
  /** `omni_comms_runtime_environment.environment`. */
  runtimeEnvironment: string | null;
  /** `platform_environment_marker.environment_kind`. */
  markerEnvironmentKind: string | null;
  markerAllowsControlledTestActivation: boolean | null;
  markerProjectRef: string | null;
  /** Project ref of the backend the runtime is actually executing against. */
  currentProjectRef: string | null;
  /** Effective release-control row for this organisation/department/channel. */
  release: DispatchAuthorizationRelease | null;
  /** Revision stamped on the deployed runtime. */
  deployedRevision: string | null;
  /** Business module that raised the obligation. */
  callerModuleCode: string | null;
  /** Request mode. */
  mode: string | null;
  /** Resolved provider adapter key for this delivery leg. */
  providerAdapterKey: string | null;
  /** Whether the resolved destination hash matched the pilot allowlist. */
  recipientAllowlisted: boolean | null;
  /** Governed activation timestamp; jobs created before it stay held. */
  dispatchCertifiedFrom: string | null;
  /** Creation instant of the request this job belongs to. */
  requestCreatedAt: string | null;
  /** True when the request/job sits in the quarantined historical backlog. */
  quarantined: boolean | null;
  /** Evaluation instant. Injected so expiry can be tested deterministically. */
  asOf: string;
}

export type DispatchAuthorizationDecision =
  | { authorized: true }
  | { authorized: false; reason: DispatchHoldReason };

const FULL_SHA = /^[0-9a-f]{40}$/;

function deny(reason: DispatchHoldReason): DispatchAuthorizationDecision {
  return { authorized: false, reason };
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function parseInstant(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Ordered, fail-closed evaluation. The FIRST failing condition determines the
 * hold reason, so reasons stay diagnostic rather than collapsing into one
 * generic code.
 */
export function evaluateDispatchAuthorization(
  ctx: DispatchAuthorizationContext,
): DispatchAuthorizationDecision {
  // 1. Environment must be a certified non-production TEST backend that has
  //    explicitly opted into controlled test activation.
  if (norm(ctx.runtimeEnvironment) !== "non_production") return deny("environment_not_certified");
  if (norm(ctx.markerEnvironmentKind) !== "test") return deny("environment_not_certified");
  if (ctx.markerAllowsControlledTestActivation !== true) return deny("environment_not_certified");

  // 2. The marker must describe the backend actually being written to.
  const marker = norm(ctx.markerProjectRef);
  const current = norm(ctx.currentProjectRef);
  if (!marker || !current || marker !== current) return deny("project_ref_mismatch");

  // 3. Release posture.
  const release = ctx.release;
  if (!release) return deny("release_control_missing");
  if (norm(release.release_state) !== "controlled_pilot") return deny("release_not_controlled_pilot");

  const now = parseInstant(ctx.asOf);
  if (now === null) return deny("pilot_expired");
  const expires = parseInstant(release.release_expires_at);
  if (expires === null || expires <= now) return deny("pilot_expired");

  // 4. Revision guard — the approved revision must equal the revision the
  //    runtime is actually running. Exact, full 40-character SHA equality.
  const approved = norm(release.approved_commit);
  const deployed = norm(ctx.deployedRevision);
  if (!FULL_SHA.test(approved) || !FULL_SHA.test(deployed) || approved !== deployed) {
    return deny("runtime_revision_not_approved");
  }

  // 5. Module scope.
  const callerModule = (ctx.callerModuleCode ?? "").trim().toUpperCase();
  const permittedModules = (release.permitted_caller_modules ?? []).map((m) =>
    (m ?? "").trim().toUpperCase()
  );
  if (!callerModule || permittedModules.length === 0 || !permittedModules.includes(callerModule)) {
    return deny("module_not_in_pilot_scope");
  }

  // 6. Queued-only.
  const mode = norm(ctx.mode);
  const permittedModes = (release.permitted_modes ?? []).map((m) => norm(m));
  if (mode !== "queued" || !permittedModes.includes("queued")) return deny("mode_not_queued");

  // 7. Recipient allowlist.
  if (ctx.recipientAllowlisted !== true) return deny("recipient_not_allowlisted");

  // 8. Provider posture. External credential-bearing adapters are denied
  //    outright; anything not on the certification-safe list is denied too.
  const adapter = norm(ctx.providerAdapterKey);
  if (!adapter) return deny("provider_credentials_unavailable");
  if (EXTERNAL_CREDENTIAL_ADAPTERS.includes(adapter)) return deny("provider_not_certification_safe");
  if (!CERTIFICATION_SAFE_ADAPTERS.includes(adapter)) return deny("provider_not_certification_safe");

  // 9. No retroactive release. Only work created after the governed activation
  //    instant may become runnable; quarantined work never may.
  if (ctx.quarantined === true) return deny("job_quarantined");
  const certifiedFrom = parseInstant(ctx.dispatchCertifiedFrom);
  const createdAt = parseInstant(ctx.requestCreatedAt);
  if (certifiedFrom === null) return deny("runtime_privileged_certification_pending");
  if (createdAt === null || createdAt < certifiedFrom) return deny("historical_job_not_authorized");

  return { authorized: true };
}
