/**
 * Omni-Comms — controlled pilot limit presets.
 *
 * Presentation/configuration values only. Nothing here sends, enqueues,
 * approves or contacts a provider.
 */

export interface ReleasePilotLimits {
  perRequest: string;
  perHour: string;
  perDay: string;
  total: string;
}

/**
 * The FIRST controlled Benefits pilot must be able to authorise exactly one
 * business Email and nothing more. 1 / 1 / 2 / 2 is deliberately NOT offered.
 */
export const SINGLE_MESSAGE_PILOT_PRESET: ReleasePilotLimits = {
  perRequest: '1',
  perHour: '1',
  perDay: '1',
  total: '1',
};

export const SINGLE_MESSAGE_PILOT_LABEL = 'Single-message pilot';

export function isSingleMessagePilot(limits: {
  maxRecipientsPerRequest: number;
  maxMessagesPerHour: number;
  maxMessagesPerDay: number;
  maxMessagesTotal: number;
}): boolean {
  return (
    limits.maxRecipientsPerRequest === 1
    && limits.maxMessagesPerHour === 1
    && limits.maxMessagesPerDay === 1
    && limits.maxMessagesTotal === 1
  );
}

export function applySingleMessagePilotPreset<T extends ReleasePilotLimits>(form: T): T {
  return { ...form, ...SINGLE_MESSAGE_PILOT_PRESET };
}
