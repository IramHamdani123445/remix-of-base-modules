/**
 * Omni-Comms Runtime — Communication Action resolution.
 *
 * The obligation layer that sits BETWEEN the business event and the channel:
 *
 *   business event
 *     → communication actions (obligations) for the recipient role
 *       → allowed fulfilment channels per action (ranked)
 *         → delivery policy (digital-first / paper-first / both)
 *           → recipient preference
 *             → channel readiness
 *               → channel-specific template variant
 *
 * Rules:
 *  - Print never means "print the Email". A channel is only selectable when a
 *    published template variant EXISTS FOR THAT CHANNEL. There is no
 *    cross-channel derivation, ever.
 *  - Dual mode: when an event has no active actions, callers fall back to the
 *    legacy per-channel route model unchanged.
 *  - Statutory override beats recipient preference; recipient preference beats
 *    organisation policy; readiness can only REMOVE a channel, never add one.
 *  - Every decision carries a machine-readable reason for evidence.
 *
 * This module is PURE: no IO, no Supabase client, no provider access.
 */

export type ActionObligation = "required" | "optional";
export type ActionSatisfactionRule = "one_of" | "all_of";

export interface CommunicationActionRow {
  id: string;
  organization_id: string;
  department_id: string | null;
  event_definition_id: string;
  code: string;
  name?: string | null;
  recipient_role: string | null;
  obligation: ActionObligation;
  satisfaction_rule: ActionSatisfactionRule;
  legal_basis?: string | null;
  priority: number;
  status: string;
}

export interface ActionChannelOptionRow {
  id: string;
  action_id: string;
  channel: string;
  rank: number;
  template_family_id: string | null;
  is_fallback: boolean;
  condition: Record<string, unknown> | null;
  status: string;
}

export interface DeliveryPolicyRow {
  id: string;
  organization_id: string;
  department_id: string | null;
  action_id: string | null;
  mode: "digital_first" | "paper_first" | "both";
  print_when: {
    legally_required?: boolean;
    recipient_requested?: boolean;
    digital_unavailable?: boolean;
    policy_exception?: boolean;
  } | null;
  version_number: number;
}

export interface RecipientChannelPreferenceRow {
  recipient_reference: string;
  recipient_role: string | null;
  channel: string;
  preference: "preferred" | "opt_out" | "paper_required";
  source: string;
}

export interface ActionSnapshot {
  communication_actions: CommunicationActionRow[];
  action_channel_options: ActionChannelOptionRow[];
  delivery_policies: DeliveryPolicyRow[];
  recipient_channel_preferences: RecipientChannelPreferenceRow[];
}

export const EMPTY_ACTION_SNAPSHOT: ActionSnapshot = {
  communication_actions: [],
  action_channel_options: [],
  delivery_policies: [],
  recipient_channel_preferences: [],
};

/** Channels considered digital for policy purposes. */
const DIGITAL_CHANNELS = new Set([
  "email",
  "sms",
  "whatsapp",
  "push",
  "in_app",
  "webhook",
  "voice",
]);

export type ChannelRejectionReason =
  | "policy_digital_first"
  | "policy_paper_first"
  | "recipient_opt_out"
  | "channel_not_ready"
  | "variant_missing"
  | "not_requested_by_caller"
  | "satisfied_by_higher_rank"
  | "fallback_not_needed";

export interface ResolvedActionChannel {
  channel: string;
  optionId: string;
  templateFamilyId: string | null;
  rank: number;
  isFallback: boolean;
  reason:
    | "statutory_print_required"
    | "recipient_paper_required"
    | "recipient_preferred"
    | "policy_selected"
    | "fallback_digital_unavailable";
}

export interface RejectedActionChannel {
  channel: string;
  reason: ChannelRejectionReason;
}

export interface ResolvedAction {
  actionId: string;
  actionCode: string;
  recipientRole: string | null;
  obligation: ActionObligation;
  satisfactionRule: ActionSatisfactionRule;
  policyId: string | null;
  policyVersion: number | null;
  policyMode: string | null;
  selected: ResolvedActionChannel[];
  rejected: RejectedActionChannel[];
  /** Set when a REQUIRED action could not be satisfied at all. */
  blockers: string[];
}

/**
 * Per-option fulfilment evidence. Availability is decided PER ACTION CHANNEL
 * OPTION (not per channel name) because two actions may use the same channel
 * with different template families — one may be publishable while the other
 * is not.
 */
export interface ActionOptionFulfilment {
  /** A published template version exists for THIS option's family + channel. */
  variantAvailable: boolean;
  /** Transport (route/sender/binding/provider/release) is ready. */
  channelReady: boolean;
  /** The recipient has a usable destination for this channel. */
  destinationAvailable: boolean;
}

export interface ActionResolutionInput {
  snapshot: ActionSnapshot;
  recipientRole: string | null;
  recipientReference: string | null;
  /** Caller narrowing filter. Never widens, never overrides a required action. */
  requestedChannels: string[];
  /** Channels with a live/ready adapter for this organisation. */
  readyChannels: string[];
  /** Channels for which a published template variant exists for this recipient. */
  channelsWithVariant: string[];
  /** True when the recipient has no usable digital destination. */
  digitalDestinationAvailable: boolean;
  /**
   * Authoritative per-option fulfilment evidence keyed by option id. When
   * supplied it OVERRIDES the coarse channel-level inputs above, and digital
   * availability is derived from actually-fulfillable digital options rather
   * than from the mere presence of an email address or phone number.
   */
  optionFulfilment?: Record<string, ActionOptionFulfilment>;
}

/**
 * One semantic delivery obligation for one recipient on one channel with one
 * exact channel-specific template family. Two actions using the same channel
 * produce TWO legs; they are never collapsed into a channel name.
 */
export interface ResolvedDeliveryLegSelection {
  communicationActionId: string;
  communicationActionCode: string;
  recipientRole: string | null;
  obligation: ActionObligation;
  satisfactionRule: ActionSatisfactionRule;
  channel: string;
  optionId: string;
  templateFamilyId: string | null;
  policyId: string | null;
  policyVersion: number | null;
  policyMode: string | null;
  selectionReason: ResolvedActionChannel["reason"];
  isFallback: boolean;
}

export interface ActionResolutionResult {
  /** False when the event has no active actions — caller uses legacy routes. */
  actionModelApplies: boolean;
  actions: ResolvedAction[];
  /** Union of channels selected across all actions. Transport hint ONLY. */
  selectedChannels: string[];
  /** Canonical plan: one entry per action × selected channel. */
  deliveryLegs: ResolvedDeliveryLegSelection[];
  blockers: string[];
}


function pickPolicy(
  policies: DeliveryPolicyRow[],
  actionId: string,
  departmentId: string | null,
): DeliveryPolicyRow | null {
  const applicable = policies.filter(
    (p) =>
      (p.action_id === actionId || p.action_id === null) &&
      (p.department_id === null || p.department_id === departmentId),
  );
  if (applicable.length === 0) return null;
  applicable.sort((a, b) => {
    // action-specific beats default, department beats organisation,
    // then highest version wins.
    const aSpecific = a.action_id === actionId ? 0 : 1;
    const bSpecific = b.action_id === actionId ? 0 : 1;
    if (aSpecific !== bSpecific) return aSpecific - bSpecific;
    const aDept = a.department_id !== null ? 0 : 1;
    const bDept = b.department_id !== null ? 0 : 1;
    if (aDept !== bDept) return aDept - bDept;
    return b.version_number - a.version_number;
  });
  return applicable[0];
}

export function resolveCommunicationActions(
  input: ActionResolutionInput,
  departmentId: string | null = null,
): ActionResolutionResult {
  const { snapshot } = input;
  const actions = snapshot.communication_actions
    .filter((a) => a.status === "active")
    .filter(
      (a) =>
        a.recipient_role === null ||
        input.recipientRole === null ||
        a.recipient_role === input.recipientRole,
    )
    .sort((a, b) => a.priority - b.priority || (a.code < b.code ? -1 : 1));

  if (snapshot.communication_actions.length === 0) {
    return {
      actionModelApplies: false,
      actions: [],
      selectedChannels: [],
      deliveryLegs: [],
      blockers: [],
    };
  }

  const prefs = snapshot.recipient_channel_preferences.filter(
    (p) =>
      input.recipientReference !== null &&
      p.recipient_reference === input.recipientReference &&
      (p.recipient_role === null ||
        input.recipientRole === null ||
        p.recipient_role === input.recipientRole),
  );
  const prefFor = (channel: string) =>
    prefs.find((p) => p.channel === channel)?.preference ?? null;
  const paperRequiredByRecipient = prefs.some(
    (p) => p.preference === "paper_required",
  );

  // ── Fulfilment evidence, per ACTION CHANNEL OPTION ─────────────────────
  const fulfilment = input.optionFulfilment ?? null;
  const optionFulfilment = (
    option: ActionChannelOptionRow,
  ): ActionOptionFulfilment => {
    const explicit = fulfilment?.[option.id];
    if (explicit) return explicit;
    return {
      variantAvailable: input.channelsWithVariant.includes(option.channel),
      channelReady: input.readyChannels.includes(option.channel),
      destinationAvailable: DIGITAL_CHANNELS.has(option.channel)
        ? input.digitalDestinationAvailable
        : true,
    };
  };

  // Corrected semantics: "digital is available" means at least one DIGITAL
  // action option can genuinely be fulfilled — destination AND published
  // channel variant AND transport readiness. Holding an email address while
  // the Email channel is disabled, unpublished or unbound is NOT availability.
  const digitalFulfilmentAvailable = fulfilment
    ? snapshot.action_channel_options.some((o) => {
      if (o.status !== "active") return false;
      if (!DIGITAL_CHANNELS.has(o.channel)) return false;
      const f = optionFulfilment(o);
      return f.destinationAvailable && f.variantAvailable && f.channelReady;
    })
    : input.digitalDestinationAvailable;

  const resolved: ResolvedAction[] = [];
  const blockers: string[] = [];


  for (const action of actions) {
    const options = snapshot.action_channel_options
      .filter((o) => o.action_id === action.id && o.status === "active")
      .sort((a, b) => a.rank - b.rank || (a.channel < b.channel ? -1 : 1));

    const policy = pickPolicy(snapshot.delivery_policies, action.id, departmentId);
    const mode = policy?.mode ?? "digital_first";
    const printWhen = policy?.print_when ?? {};
    const statutoryPrint =
      printWhen.legally_required === true && Boolean(action.legal_basis);

    const selected: ResolvedActionChannel[] = [];
    const rejected: RejectedActionChannel[] = [];

    const eligible: Array<{
      option: ActionChannelOptionRow;
      reason: ResolvedActionChannel["reason"];
    }> = [];

    for (const option of options) {
      const channel = option.channel;
      const isPrint = channel === "print";
      const isDigital = DIGITAL_CHANNELS.has(channel);

      if (
        input.requestedChannels.length > 0 &&
        !input.requestedChannels.includes(channel) &&
        action.obligation !== "required"
      ) {
        rejected.push({ channel, reason: "not_requested_by_caller" });
        continue;
      }
      if (!input.channelsWithVariant.includes(channel)) {
        // Print is NEVER derived from the Email variant. Fail closed.
        rejected.push({ channel, reason: "variant_missing" });
        continue;
      }
      if (!input.readyChannels.includes(channel)) {
        rejected.push({ channel, reason: "channel_not_ready" });
        continue;
      }
      const pref = prefFor(channel);
      if (pref === "opt_out" && !(isPrint && statutoryPrint)) {
        rejected.push({ channel, reason: "recipient_opt_out" });
        continue;
      }

      if (isPrint) {
        const printAllowed =
          mode === "paper_first" ||
          mode === "both" ||
          statutoryPrint ||
          (printWhen.recipient_requested === true && paperRequiredByRecipient) ||
          (printWhen.digital_unavailable === true &&
            !input.digitalDestinationAvailable) ||
          printWhen.policy_exception === true;
        if (!printAllowed) {
          rejected.push({ channel, reason: "policy_digital_first" });
          continue;
        }
        eligible.push({
          option,
          reason: statutoryPrint
            ? "statutory_print_required"
            : paperRequiredByRecipient
              ? "recipient_paper_required"
              : !input.digitalDestinationAvailable
                ? "fallback_digital_unavailable"
                : "policy_selected",
        });
        continue;
      }

      if (isDigital && !input.digitalDestinationAvailable) {
        // No usable digital destination for this recipient: paper carries it.
        rejected.push({ channel, reason: "channel_not_ready" });
        continue;
      }

      if (isDigital && mode === "paper_first" && action.obligation === "required") {
        // Paper-first still allows digital as a courtesy copy only when the
        // rule is all_of; otherwise print carries the obligation.
        if (action.satisfaction_rule === "one_of") {
          rejected.push({ channel, reason: "policy_paper_first" });
          continue;
        }
      }

      eligible.push({
        option,
        reason: pref === "preferred" ? "recipient_preferred" : "policy_selected",
      });
    }

    // Preference-first ordering inside the eligible set.
    eligible.sort((a, b) => {
      // A statutory or recipient-required paper obligation outranks everything.
      const aPaper =
        a.reason === "statutory_print_required" ||
        a.reason === "recipient_paper_required"
          ? 0
          : 1;
      const bPaper =
        b.reason === "statutory_print_required" ||
        b.reason === "recipient_paper_required"
          ? 0
          : 1;
      if (aPaper !== bPaper) return aPaper - bPaper;
      const aPref = prefFor(a.option.channel) === "preferred" ? 0 : 1;
      const bPref = prefFor(b.option.channel) === "preferred" ? 0 : 1;
      if (aPref !== bPref) return aPref - bPref;
      const aFallback = a.option.is_fallback ? 1 : 0;
      const bFallback = b.option.is_fallback ? 1 : 0;
      if (aFallback !== bFallback) return aFallback - bFallback;
      return a.option.rank - b.option.rank;
    });

    if (action.satisfaction_rule === "all_of") {
      for (const e of eligible) {
        selected.push(toSelected(e.option, e.reason));
      }
    } else {
      const primary = eligible.filter((e) => !e.option.is_fallback);
      // Statutory paper and a recipient paper requirement are additive: they
      // are obligations in their own right, not alternatives to the digital
      // channel.
      const statutory = eligible.filter(
        (e) =>
          e.reason === "statutory_print_required" ||
          e.reason === "recipient_paper_required",
      );
      const chosen = primary.length > 0 ? primary[0] : eligible[0];
      if (chosen) selected.push(toSelected(chosen.option, chosen.reason));
      // A statutory print obligation is additive to the digital selection.
      for (const s of statutory) {
        if (!selected.some((c) => c.channel === s.option.channel)) {
          selected.push(toSelected(s.option, s.reason));
        }
      }
      for (const e of eligible) {
        if (selected.some((c) => c.channel === e.option.channel)) continue;
        rejected.push({
          channel: e.option.channel,
          reason: e.option.is_fallback
            ? "fallback_not_needed"
            : "satisfied_by_higher_rank",
        });
      }
    }

    const actionBlockers: string[] = [];
    if (action.obligation === "required" && selected.length === 0) {
      actionBlockers.push(`action_unsatisfied:${action.code}`);
      blockers.push(`action_unsatisfied:${action.code}`);
    }

    resolved.push({
      actionId: action.id,
      actionCode: action.code,
      recipientRole: action.recipient_role,
      obligation: action.obligation,
      satisfactionRule: action.satisfaction_rule,
      policyId: policy?.id ?? null,
      policyVersion: policy?.version_number ?? null,
      policyMode: policy?.mode ?? null,
      selected,
      rejected,
      blockers: actionBlockers,
    });
  }

  const selectedChannels = Array.from(
    new Set(resolved.flatMap((a) => a.selected.map((s) => s.channel))),
  ).sort();

  return {
    actionModelApplies: true,
    actions: resolved,
    selectedChannels,
    blockers,
  };
}

function toSelected(
  option: ActionChannelOptionRow,
  reason: ResolvedActionChannel["reason"],
): ResolvedActionChannel {
  return {
    channel: option.channel,
    optionId: option.id,
    templateFamilyId: option.template_family_id,
    rank: option.rank,
    isFallback: option.is_fallback,
    reason,
  };
}

/** Bounded, PII-free evidence block persisted on the request/message. */
export function buildActionResolutionEvidence(
  result: ActionResolutionResult,
): Record<string, unknown> {
  return {
    model: "communication_action_v1",
    applies: result.actionModelApplies,
    actions: result.actions.map((a) => ({
      code: a.actionCode,
      obligation: a.obligation,
      rule: a.satisfactionRule,
      policy_version: a.policyVersion,
      policy_mode: a.policyMode,
      selected: a.selected.map((s) => ({ channel: s.channel, reason: s.reason })),
      rejected: a.rejected.map((r) => ({ channel: r.channel, reason: r.reason })),
      blockers: a.blockers,
    })),
    selected_channels: result.selectedChannels,
    blockers: result.blockers,
  };
}
