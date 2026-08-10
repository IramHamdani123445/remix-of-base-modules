/**
 * Omni-Comms — Email readiness STAGE grouping.
 *
 * One combined "X of 21 checks passed" counter mixes three different operator
 * jobs. This module groups the SAME checks (none are added, removed or
 * weakened) into the three stages an operator actually works through:
 *
 *   Delivery Setup (11) → Test & Verify (3) → Go Live (7)
 *
 * Boundaries (permanent):
 *   - Pure presentation grouping. No I/O, no provider contact, no send.
 *   - Never changes a check's status; it only partitions the existing items.
 *   - Never asserts live delivery. `live_delivery_enabled` stays a separate,
 *     informational safety state and is NOT a Delivery Setup requirement.
 */
import type {
  GoLiveReadinessItem,
  GoLiveReadinessProjection,
} from './goLiveReadiness';

export type ReadinessStage = 'delivery-setup' | 'test-verify' | 'go-live';

/** Delivery Setup — everything required before anything can be proven. */
export const DELIVERY_SETUP_CHECK_KEYS = [
  'adapter',
  'account',
  'credentials',
  'identity',
  'binding',
  'binding_verification',
  'policy',
  'policy_state',
  'sending_domain',
  'sending_domain_verification',
  'event_callback',
] as const;

/** Test & Verify — proof that the setup works, without reaching a real person. */
export const TEST_VERIFY_CHECK_KEYS = [
  'callback_receiver',
  'configuration_preflight',
  'provider_delivery_test',
] as const;

/** Go Live — controlled business delivery governance and evidence. */
export const GO_LIVE_CHECK_KEYS = [
  'release_control_configured',
  'release_prerequisites',
  'release_control',
  'business_dispatch',
  'business_delivery_attempt',
  'business_delivery_confirmed',
  'pilot_safety',
] as const;

export const READINESS_STAGE_LABEL: Record<ReadinessStage, string> = {
  'delivery-setup': 'Delivery Setup',
  'test-verify': 'Test & Verify',
  'go-live': 'Go Live',
};

/** Word used for a completed check in each stage. */
export const READINESS_STAGE_NOUN: Record<ReadinessStage, string> = {
  'delivery-setup': 'ready',
  'test-verify': 'proven',
  'go-live': 'ready',
};

export const READINESS_STAGE_TOTALS: Record<ReadinessStage, number> = {
  'delivery-setup': DELIVERY_SETUP_CHECK_KEYS.length,
  'test-verify': TEST_VERIFY_CHECK_KEYS.length,
  'go-live': GO_LIVE_CHECK_KEYS.length,
};

const STAGE_FOR_KEY = new Map<string, ReadinessStage>();
for (const k of DELIVERY_SETUP_CHECK_KEYS) STAGE_FOR_KEY.set(k, 'delivery-setup');
for (const k of TEST_VERIFY_CHECK_KEYS) STAGE_FOR_KEY.set(k, 'test-verify');
for (const k of GO_LIVE_CHECK_KEYS) STAGE_FOR_KEY.set(k, 'go-live');

/**
 * Which stage a check belongs to. Unknown/extra server-supplied blockers (for
 * example `pilot_business_producer`) are business-delivery concerns and are
 * therefore reported under Go Live — never under Delivery Setup.
 */
export function stageForReadinessCheck(key: string | null | undefined): ReadinessStage {
  return STAGE_FOR_KEY.get((key ?? '').trim()) ?? 'go-live';
}

export interface ReadinessStageGroup {
  readonly stage: ReadinessStage;
  readonly label: string;
  /** "ready" or "proven". */
  readonly noun: string;
  readonly items: readonly GoLiveReadinessItem[];
  readonly readyCount: number;
  /** Declared stage size (11 / 3 / 7), independent of item availability. */
  readonly totalCount: number;
  readonly complete: boolean;
  /** First non-READY item in this stage, or null. */
  readonly blocker: GoLiveReadinessItem | null;
}

export interface GroupedReadinessProjection {
  readonly deliverySetup: ReadinessStageGroup;
  readonly testVerify: ReadinessStageGroup;
  readonly goLive: ReadinessStageGroup;
  readonly groups: readonly ReadinessStageGroup[];
  /**
   * The blocker the operator should act on next: Delivery Setup first, then
   * Test & Verify, then Go Live. An operator is never sent to Release Control
   * or a provider delivery test while Delivery Setup is incomplete.
   */
  readonly currentBlocker: GoLiveReadinessItem | null;
  readonly currentStage: ReadinessStage | null;
  readonly allReady: boolean;
}

function buildGroup(
  stage: ReadinessStage,
  items: readonly GoLiveReadinessItem[],
): ReadinessStageGroup {
  const mine = items.filter((i) => stageForReadinessCheck(i.key) === stage);
  const readyCount = mine.filter((i) => i.status === 'READY').length;
  const totalCount = READINESS_STAGE_TOTALS[stage];
  return {
    stage,
    label: READINESS_STAGE_LABEL[stage],
    noun: READINESS_STAGE_NOUN[stage],
    items: mine,
    readyCount,
    totalCount,
    complete: readyCount >= totalCount,
    blocker: mine.find((i) => i.status !== 'READY') ?? null,
  };
}

export function groupEmailReadinessByStage(
  projection: GoLiveReadinessProjection,
): GroupedReadinessProjection {
  const deliverySetup = buildGroup('delivery-setup', projection.items);
  const testVerify = buildGroup('test-verify', projection.items);
  const goLive = buildGroup('go-live', projection.items);
  const groups = [deliverySetup, testVerify, goLive] as const;

  const currentGroup = groups.find((g) => g.blocker !== null) ?? null;

  return {
    deliverySetup,
    testVerify,
    goLive,
    groups,
    currentBlocker: currentGroup?.blocker ?? null,
    currentStage: currentGroup?.stage ?? null,
    allReady: groups.every((g) => g.complete),
  };
}
