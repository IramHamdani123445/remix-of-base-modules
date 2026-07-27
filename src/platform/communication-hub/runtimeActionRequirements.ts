/**
 * Canonical runtime-contract capability map for provider-contacting actions.
 *
 * One source of truth. Panels MUST NOT hard-code capability arrays; they must
 * consume `getRuntimeRequirements(actionCode)` and/or `runtimeActionPasses`.
 *
 * Capability names below MUST match those emitted by
 * `public.audit_comm_hub_runtime_contract()` — see migration
 * `20260727102627_c781070f-d877-4936-a164-7f3eda283eb5.sql`.
 */
import {
  capabilityPasses,
  type RuntimeContractReport,
} from "@/platform/communication-hub/runtimeContractService";

export type RuntimeActionCode =
  | "ONE_REAL_EMAIL"
  | "MANUAL_PRODUCTION_SEND"
  | "CONTROLLED_REVALIDATION_AUTHORISATION"
  | "CONTROLLED_REVALIDATION_SEND"
  | "AUTOMATED_PRODUCTION_ARM"
  | "AUTOMATED_CANARY";

// Capability codes emitted by audit_comm_hub_runtime_contract.
const CAP = {
  preview: "preview",
  policy: "policy",
  provider: "provider",
  event_certification: "event_certification",
  ore: "ore",
  manual_production: "manual_production",
  baseline: "baseline",
  control_settings: "control_settings",
  revalidation: "revalidation",
  revalidation_runtime: "revalidation_runtime",
  runtime_dispatch: "runtime_dispatch",
  snapshot: "snapshot",
  assessment: "assessment",
  mode_transitions: "mode_transitions",
  automation: "automation",
  automated_readiness: "automated_readiness",
} as const;

const RUNTIME_REQUIREMENTS: Record<RuntimeActionCode, readonly string[]> = {
  ONE_REAL_EMAIL: [
    CAP.runtime_dispatch,
    CAP.provider,
    CAP.policy,
    CAP.snapshot,
    CAP.event_certification,
    CAP.ore,
    CAP.preview,
    CAP.mode_transitions,
  ],
  MANUAL_PRODUCTION_SEND: [
    CAP.runtime_dispatch,
    CAP.provider,
    CAP.policy,
    CAP.snapshot,
    CAP.event_certification,
    CAP.manual_production,
    CAP.baseline,
    CAP.mode_transitions,
  ],
  CONTROLLED_REVALIDATION_AUTHORISATION: [
    CAP.revalidation,
    CAP.revalidation_runtime,
    CAP.assessment,
    CAP.snapshot,
    CAP.event_certification,
    CAP.baseline,
    CAP.control_settings,
  ],
  CONTROLLED_REVALIDATION_SEND: [
    CAP.revalidation,
    CAP.revalidation_runtime,
    CAP.runtime_dispatch,
    CAP.provider,
    CAP.policy,
    CAP.snapshot,
    CAP.event_certification,
    CAP.baseline,
    CAP.control_settings,
  ],
  AUTOMATED_PRODUCTION_ARM: [
    CAP.automation,
    CAP.automated_readiness,
    CAP.baseline,
    CAP.event_certification,
    CAP.control_settings,
    CAP.mode_transitions,
  ],
  AUTOMATED_CANARY: [
    CAP.automation,
    CAP.automated_readiness,
    CAP.runtime_dispatch,
    CAP.provider,
    CAP.policy,
    CAP.snapshot,
    CAP.event_certification,
    CAP.control_settings,
    CAP.mode_transitions,
  ],
};

/** Return the required capability list for an action. Never returns []. */
export function getRuntimeRequirements(action: RuntimeActionCode): readonly string[] {
  const reqs = RUNTIME_REQUIREMENTS[action];
  if (!reqs || reqs.length === 0) {
    // Should be unreachable; guard against silent fail-open.
    throw new Error(`getRuntimeRequirements: no capabilities registered for action ${action}`);
  }
  return reqs;
}

/**
 * True iff EVERY required capability for the action passes in the given
 * report. Fails closed when the report is null, when the action has no
 * requirements, or when any capability has zero matched checks.
 */
export function runtimeActionPasses(
  report: RuntimeContractReport | null | undefined,
  action: RuntimeActionCode,
): boolean {
  if (!report) return false;
  const reqs = RUNTIME_REQUIREMENTS[action];
  if (!reqs || reqs.length === 0) return false;
  return reqs.every((cap) => capabilityPasses(report, cap));
}

export const __RUNTIME_REQUIREMENTS_INTERNAL_FOR_TESTS__ = RUNTIME_REQUIREMENTS;
