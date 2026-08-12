/**
 * Omni-Comms — Go-Live workflow projection (pure).
 *
 * Turns the server-derived Release Control summary, deployment identity and
 * held-job candidate into ONE ordered, guided sequence of stages with an exact
 * operator next action.
 *
 * HARD BOUNDARY: this module is pure presentation logic. It performs no I/O,
 * decides no authorisation, sends nothing, and never relaxes a database gate —
 * the database and the trusted Edge boundary remain the only authorities.
 */
import type { ChannelReleaseControlSummary } from '@/platform/omni-comms/application/channelReleaseControlTypes';
import type { DeploymentStatus, HeldPilotCandidate } from '@/platform/omni-comms/application/channelReleaseControlService';

export type GoLiveStageState = 'complete' | 'action_required' | 'blocked' | 'waiting';

export interface GoLiveStage {
  /** Stable identifier used by tests and telemetry. */
  id: string;
  /** 1-based position in the guided sequence. */
  step: number;
  title: string;
  state: GoLiveStageState;
  /** Plain-English statement of what is true right now. */
  summary: string;
  /** Exact next action for the operator, or null when nothing is needed. */
  nextAction: string | null;
}

export interface GoLiveWorkflowInput {
  summary: ChannelReleaseControlSummary | null;
  deployment: DeploymentStatus | null;
  candidate: HeldPilotCandidate | null;
  /** Blocking prerequisite codes derived server-side. */
  blockers: readonly string[];
  proposalActive: boolean;
  sameActorAsProposer: boolean;
  canConfigure: boolean;
  canApprove: boolean;
}

export interface GoLiveWorkflow {
  stages: GoLiveStage[];
  completedSteps: number;
  totalSteps: number;
  /** `5/7` style progress label. */
  progressLabel: string;
  /** The first stage that is not complete, or null when everything is done. */
  currentStage: GoLiveStage | null;
  /** True when only the final supervised provider send remains. */
  readyForControlledSend: boolean;
}

const fullSha = /^[0-9a-f]{40}$/;

function certificationEffective(deployment: DeploymentStatus | null): boolean {
  const commit = (deployment?.certification?.certified_commit ?? '').trim().toLowerCase();
  const identity = (deployment?.release_identity ?? '').trim().toLowerCase();
  return (
    deployment?.certification?.certification_state === 'certified'
    && fullSha.test(commit)
    && fullSha.test(identity)
    && commit === identity
  );
}

export function buildGoLiveWorkflow(input: GoLiveWorkflowInput): GoLiveWorkflow {
  const { summary, deployment, candidate, blockers } = input;
  const release = summary?.release ?? null;
  const environmentKnown =
    deployment?.environment === 'production' || deployment?.environment === 'non_production';
  const certified = certificationEffective(deployment);
  const pilotConfigured = Boolean(
    release
    && release.permitted_event_codes.length > 0
    && release.permitted_caller_modules.length > 0
    && release.pilot_recipient_rules.length > 0
    && release.release_expires_at,
  );
  const activated = release?.release_state === 'controlled_pilot';
  const heldJob = candidate?.candidate ?? null;

  const stages: GoLiveStage[] = [];

  stages.push({
    id: 'deployment_environment',
    step: 1,
    title: 'Confirm the deployment environment',
    state: environmentKnown ? 'complete' : 'action_required',
    summary: environmentKnown
      ? `The protected runtime is recorded as ${deployment?.environment === 'production' ? 'production' : 'non-production'}.`
      : 'The protected runtime environment is unknown, so every downstream gate fails closed.',
    nextAction: environmentKnown
      ? null
      : 'Open Deployment & certification and choose "Confirm production environment".',
  });

  const revisionsReadable = Boolean(deployment?.release_identity);
  stages.push({
    id: 'deployment_certification',
    step: 2,
    title: 'Certify the deployed release',
    state: certified
      ? 'complete'
      : !environmentKnown || deployment?.deployment_revision_mismatch || !revisionsReadable
        ? 'blocked'
        : 'action_required',
    summary: certified
      ? 'The certified commit exactly matches the revision deployed to the runtime and the dispatcher.'
      : deployment?.deployment_revision_mismatch
        ? 'The runtime and the dispatcher report different revisions, so no single release identity exists.'
        : !revisionsReadable
          ? 'A full 40-character deployed revision could not be read from both functions.'
          : !environmentKnown
            ? 'Certification cannot be recorded until the environment is resolved.'
            : 'The deployed release has not been certified yet.',
    nextAction: certified
      ? null
      : deployment?.deployment_revision_mismatch || !revisionsReadable
        ? 'Redeploy the Omni-Comms functions so both report the same 40-character revision, then refresh.'
        : !environmentKnown
          ? 'Complete step 1 first.'
          : 'Choose "Certify this deployment" on the Deployment & certification card.',
  });

  stages.push({
    id: 'pilot_configuration',
    step: 3,
    title: 'Configure the controlled pilot',
    state: pilotConfigured ? 'complete' : input.canConfigure ? 'action_required' : 'blocked',
    summary: pilotConfigured
      ? `Permitted: ${release?.permitted_event_codes.join(', ')} from ${release?.permitted_caller_modules.join(', ')} to ${release?.pilot_recipient_rules.length} approved recipient(s).`
      : heldJob
        ? 'A held business message is waiting. Its event, module and recipient can be prefilled for you.'
        : 'The pilot needs a permitted event code, caller module, approved recipient and a bounded window.',
    nextAction: pilotConfigured
      ? null
      : !input.canConfigure
        ? 'Sign in as an administrator with Omni-Comms configure rights.'
        : heldJob
          ? 'Choose "Configure from held business message", apply the single-message preset and a bounded window, then save.'
          : 'Fill in Pilot restrictions, apply the single-message preset and a bounded window, then save.',
  });

  stages.push({
    id: 'prerequisites',
    step: 4,
    title: 'Clear the release prerequisites',
    state: blockers.length === 0 ? 'complete' : 'action_required',
    summary: blockers.length === 0
      ? 'Every blocking prerequisite evaluated server-side is satisfied.'
      : `${blockers.length} blocking prerequisite(s) outstanding: ${blockers.slice(0, 4).join(', ')}${blockers.length > 4 ? '…' : ''}.`,
    nextAction: blockers.length === 0
      ? null
      : 'Resolve the failing entries listed on the Prerequisites card, then refresh.',
  });

  stages.push({
    id: 'proposal',
    step: 5,
    title: 'Propose the controlled pilot',
    state: activated || input.proposalActive
      ? 'complete'
      : blockers.length > 0 || !input.canConfigure
        ? 'blocked'
        : 'action_required',
    summary: activated
      ? 'The pilot has already been approved and activated.'
      : input.proposalActive
        ? 'A proposal is recorded and awaiting a second person.'
        : 'No proposal exists yet. The proposer can never be the approver.',
    nextAction: activated || input.proposalActive
      ? null
      : blockers.length > 0
        ? 'Complete step 4 first.'
        : !input.canConfigure
          ? 'Sign in with Omni-Comms configure rights.'
          : 'Enter a proposal reason and choose "Propose controlled pilot".',
  });

  stages.push({
    id: 'approval',
    step: 6,
    title: 'Approve and activate',
    state: activated
      ? 'complete'
      : !input.proposalActive
        ? 'blocked'
        : input.sameActorAsProposer || !input.canApprove
          ? 'waiting'
          : 'action_required',
    summary: activated
      ? 'The controlled pilot is active and bounded by its own limits and window.'
      : !input.proposalActive
        ? 'Approval requires an active proposal.'
        : input.sameActorAsProposer
          ? 'You proposed this transition, so a different person must approve it.'
          : !input.canApprove
            ? 'Approval requires Omni-Comms operate rights.'
            : 'The proposal is ready for second-person approval.',
    nextAction: activated
      ? null
      : !input.proposalActive
        ? 'Complete step 5 first.'
        : input.sameActorAsProposer || !input.canApprove
          ? 'Ask a second administrator with operate rights to approve this proposal.'
          : 'Choose "Approve and activate". The deployed revision is re-checked server-side.',
  });

  const dispatchReady = activated && Boolean(heldJob);
  stages.push({
    id: 'controlled_send',
    step: 7,
    title: 'Release the one controlled business Email',
    state: dispatchReady ? 'action_required' : 'blocked',
    summary: !heldJob
      ? 'No single held business message is available to release.'
      : dispatchReady
        ? `Held message ${String(heldJob.job_id).slice(0, 8)} will be released to the provider — exactly one message.`
        : 'The held business message stays non-runnable until the pilot is active.',
    nextAction: dispatchReady
      ? 'Choose "Release one controlled message". This is the only action that contacts the provider.'
      : !heldJob
        ? 'Produce the business message from the normal module flow first.'
        : 'Complete step 6 first.',
  });

  const completedSteps = stages.filter((s) => s.state === 'complete').length;
  const currentStage = stages.find((s) => s.state !== 'complete') ?? null;

  return {
    stages,
    completedSteps,
    totalSteps: stages.length,
    progressLabel: `${completedSteps}/${stages.length}`,
    currentStage,
    readyForControlledSend: dispatchReady && completedSteps === stages.length - 1,
  };
}
