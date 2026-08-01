/**
 * Omni-Comms — source-controlled privileged certification evidence record.
 *
 * Bounded, non-secret facts about the privileged certification run. The
 * certification workflow is executed OUTSIDE the administration interface;
 * this file records what has actually been certified so the Health screen can
 * state the truth instead of implying readiness.
 *
 * When a privileged certification run completes, update this record in the
 * same commit that records the evidence artefact.
 */

export type CertificationRecordState = 'certified' | 'pending' | 'failed';

export interface OmniCommsCertificationEvidence {
  /** Recorded certification state for the deployed runtime. */
  state: CertificationRecordState;
  /** Commit certified by the privileged run, or null when none has passed. */
  certifiedCommit: string | null;
  /** CI workflow run identifier, when one has been recorded. */
  workflowRunId: string | null;
  /** Enforced scenario inventory size. */
  scenarioCount: number;
  /** Result of the scenario inventory, or null when not yet executed. */
  scenarioResult: 'passed' | 'failed' | null;
  cleanupResult: 'verified' | 'not_verified' | null;
  safetyInvariants: 'held' | 'violated' | null;
  sqlVerifierResult: 'passed' | 'failed' | null;
  /** ISO timestamp of the recorded certification, or null. */
  certifiedAt: string | null;
  /** Operator-safe explanation shown next to the state. */
  summary: string;
}

export const OMNI_COMMS_CERTIFICATION_EVIDENCE: OmniCommsCertificationEvidence = {
  state: 'pending',
  certifiedCommit: null,
  workflowRunId: null,
  scenarioCount: 19,
  scenarioResult: null,
  cleanupResult: null,
  safetyInvariants: null,
  sqlVerifierResult: null,
  certifiedAt: null,
  summary:
    'Privileged certification has not been executed against the deployed runtime. The runtime is implemented, live delivery is disabled and no provider dispatch exists.',
};

/** Ordered evidence fields rendered by the Certification Evidence view. */
export const OMNI_COMMS_CERTIFICATION_FIELDS = [
  'certification_state',
  'certified_commit',
  'deployed_edge_revision',
  'revision_match',
  'workflow_run_id',
  'scenario_count_and_result',
  'cleanup_result',
  'safety_invariants',
  'sql_verifier_result',
  'certification_timestamp',
] as const;

export type OmniCommsCertificationField =
  (typeof OMNI_COMMS_CERTIFICATION_FIELDS)[number];

/**
 * Compare the certified commit with the revision reported by the deployed
 * Edge health probe.
 *
 * EXACT, case-insensitive, full 40-character SHA equality only. Prefix or
 * shortened-SHA comparison is forbidden anywhere in the Omni-Comms
 * certification surfaces. This helper is presentation-only: it never enables
 * or disables execution — the database health posture is the sole runtime
 * certification authority.
 */
export function revisionMatch(
  certifiedCommit: string | null,
  deployedRevision: string | null,
): 'match' | 'mismatch' | 'unknown' {
  const full = /^[0-9a-f]{40}$/;
  const a = (certifiedCommit ?? '').trim().toLowerCase();
  const b = (deployedRevision ?? '').trim().toLowerCase();
  if (!full.test(a) || !full.test(b)) return 'unknown';
  return a === b ? 'match' : 'mismatch';
}


