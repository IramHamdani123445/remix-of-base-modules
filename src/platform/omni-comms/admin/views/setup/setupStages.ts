/**
 * Omni-Comms Setup readiness — presentation-only stage grouping.
 *
 * Groups the fourteen guided configuration steps into four administrator
 * stages so the screen reads as a checklist rather than a wizard. Pure data:
 * no I/O, no mutation, no resolution logic.
 */
import type { SetupStepId } from '@/platform/omni-comms/application/setupReadinessTypes';

export type SetupStageId = 'scope' | 'content' | 'channel' | 'runtime';

export interface SetupStage {
  id: SetupStageId;
  title: string;
  purpose: string;
  steps: readonly SetupStepId[];
}

export const OMNI_COMMS_SETUP_STAGES: readonly SetupStage[] = [
  {
    id: 'scope',
    title: 'Scope and event',
    purpose:
      'Choose the tenant scope and the business event, and confirm its published contract and routing.',
    steps: ['tenant', 'event', 'contract', 'route'],
  },
  {
    id: 'content',
    title: 'Content',
    purpose:
      'Publish the template family, version, layout and the shared assets the layout requires.',
    steps: ['template_family', 'template_version', 'layout', 'assets'],
  },
  {
    id: 'channel',
    title: 'Channel and sender',
    purpose:
      'Register the provider, account, sender identity, verified binding and channel settings.',
    steps: ['provider', 'provider_account', 'sender', 'binding', 'channel_setting'],
  },
  {
    id: 'runtime',
    title: 'Runtime',
    purpose:
      'Confirm the deployed runtime objects. Live delivery stays disabled regardless of this result.',
    steps: ['runtime'],
  },
] as const;

export function stageOfStep(stepId: SetupStepId): SetupStageId {
  const stage = OMNI_COMMS_SETUP_STAGES.find((s) => s.steps.includes(stepId));
  return stage ? stage.id : 'runtime';
}
