// DEF-13 — deployment identity truth for the Omni-Comms runtime and dispatcher.
//
// A deployed function must be able to state EXACTLY which build is running.
// Two independent sources are consulted, most authoritative first:
//
//   1. `OMNI_COMMS_DEPLOYED_REVISION` — the platform-wide git revision stamped
//      at deploy time. Trusted only when it is a well-formed 40-hex value.
//   2. The committed build artifact `buildRevision.generated.ts`, whose value
//      is a content hash of every runtime, dispatcher and shared adapter source
//      file. It can never be absent, stale relative to the code it ships with,
//      or silently inherited from an older deployment.
//
// A health report therefore never claims `revisionVerified: true` without a
// concrete, checkable value behind it.

import { OMNI_COMMS_BUILD_REVISION } from "./buildRevision.generated.ts";

export const OMNI_COMMS_REVISION_PATTERN = /^[0-9a-f]{40}$/;

export type DeployedRevisionSource = "environment" | "build_artifact" | "none";

export interface DeployedRevisionReport {
  /** The revision this deployment reports, or null when nothing is verifiable. */
  revision: string | null;
  /** Where the reported revision came from. */
  revisionSource: DeployedRevisionSource;
  /** True only when `revision` is a well-formed 40-hex value. */
  revisionVerified: boolean;
  /** The content-hash identity of the shipped sources, always present. */
  buildRevision: string | null;
  /** The raw environment stamp, when it is well-formed. */
  environmentRevision: string | null;
}

export function resolveDeployedRevision(
  envValue: string | undefined = Deno.env.get("OMNI_COMMS_DEPLOYED_REVISION") ?? undefined,
): DeployedRevisionReport {
  const env = (envValue ?? "").trim().toLowerCase();
  const build = (OMNI_COMMS_BUILD_REVISION ?? "").trim().toLowerCase();

  const environmentRevision = OMNI_COMMS_REVISION_PATTERN.test(env) ? env : null;
  const buildRevision = OMNI_COMMS_REVISION_PATTERN.test(build) ? build : null;

  const revision = environmentRevision ?? buildRevision;
  const revisionSource: DeployedRevisionSource = environmentRevision
    ? "environment"
    : buildRevision
      ? "build_artifact"
      : "none";

  return {
    revision,
    revisionSource,
    revisionVerified: revision !== null,
    buildRevision,
    environmentRevision,
  };
}
