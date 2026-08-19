/**
 * Omni-Comms Runtime — canonical channel-kind classifier.
 *
 * This mirrors the server function `omni_comms_priv_channel_kind()`. There is
 * exactly ONE channel vocabulary in the runtime (`Channel` in
 * resolutionTypes.ts) and exactly ONE kind classifier — this file.
 *
 * The kind decides HOW a channel resolves. "Recipient destination + sender
 * identity" is the rule for ADDRESSED channels only; applying it universally
 * is what previously forced fake sender identities and fake device tokens
 * onto channels that have neither.
 *
 *   addressed  email, sms, whatsapp, voice
 *              → recipient destination + sender identity + provider account
 *   device     push
 *              → recipient identity → governed Push registrations
 *   internal   in_app
 *              → recipient identity → application/portal user
 *   endpoint   webhook
 *              → Communication Action → subscription → exact endpoint
 *   physical   print
 *              → postal address + production account
 */
import type { Channel } from "./resolutionTypes.ts";

export type ChannelKind =
  | "addressed"
  | "device"
  | "internal"
  | "endpoint"
  | "physical";

export const OMNI_COMMS_RUNTIME_CHANNELS: readonly Channel[] = [
  "email",
  "sms",
  "whatsapp",
  "push",
  "in_app",
  "webhook",
  "print",
  "voice",
] as const;

const KIND_BY_CHANNEL: Record<Channel, ChannelKind> = {
  email: "addressed",
  sms: "addressed",
  whatsapp: "addressed",
  voice: "addressed",
  push: "device",
  in_app: "internal",
  webhook: "endpoint",
  print: "physical",
};

/** Null for a channel outside the canonical vocabulary. */
export function channelKind(channel: string): ChannelKind | null {
  return (KIND_BY_CHANNEL as Record<string, ChannelKind | undefined>)[channel] ??
    null;
}

/**
 * Recipient destination key required by the channel, or null when the channel
 * has no human destination at all (device / internal / endpoint).
 */
export function destinationKeyFor(channel: string): "email" | "phone" | "print" | null {
  switch (channel) {
    case "email":
      return "email";
    case "sms":
    case "whatsapp":
    case "voice":
      return "phone";
    case "print":
      return "print";
    default:
      return null;
  }
}

/**
 * Only addressed and physical channels have a sender identity. Push, In-App
 * and Webhook must never be given one just to satisfy an older structure.
 */
export function requiresSenderIdentity(channel: string): boolean {
  const kind = channelKind(channel);
  return kind === "addressed" || kind === "physical";
}

/** True when a recipient-supplied destination is part of readiness. */
export function requiresRecipientDestination(channel: string): boolean {
  return destinationKeyFor(channel) !== null;
}
