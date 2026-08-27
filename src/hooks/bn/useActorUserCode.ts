/**
 * The authenticated user's code, ready to stamp on a BN write.
 *
 * `requireUserCode` already states the rule: every privileged BN write must
 * carry the authenticated user's `user_code`, and the placeholders 'SYSTEM',
 * 'CURRENT_USER', 'ANONYMOUS' and 'UNKNOWN' are forbidden — an untraceable row
 * is worse than a failed write. Fifty-two call sites passed 'CURRENT_USER'
 * anyway, so every one of those rows names a placeholder instead of a person.
 *
 * This hook exists so the correct thing is the easy thing. `useUserCode` alone
 * returns `userCode | null` and leaves each caller to decide what null means;
 * callers reached for a literal instead. Here the three states are separated
 * once, and `actor()` throws rather than letting a placeholder through.
 *
 *   const { actor, blocked, blockedReason } = useActorUserCode();
 *
 *   <Button disabled={blocked} title={blockedReason ?? undefined} …>
 *
 *   const onSubmit = () => {
 *     const by = actor('suspend entitlement');   // throws if unusable
 *     mutate({ …, userCode: by });
 *   };
 */
import { useCallback } from 'react';
import { useUserCode } from '@/hooks/useUserCode';
import { requireUserCode } from '@/lib/bn/requireUserCode';

export interface ActorUserCode {
  /** The code itself, or null while unavailable. Prefer `actor()` for writes. */
  userCode: string | null;
  /** True while no write may be attributed — use it to disable the control. */
  blocked: boolean;
  /** Why writes are blocked, phrased for an officer. Null when they are not. */
  blockedReason: string | null;
  /** The profile fetch is still in flight. */
  isLoading: boolean;
  /**
   * The code to stamp on a write. Throws `MissingUserCodeError` when the user
   * code is loading, unreadable, absent, or a forbidden placeholder — so a
   * write can never be attributed to nobody.
   */
  actor: (action?: string) => string;
}

export function useActorUserCode(): ActorUserCode {
  const { userCode, isLoading, error } = useUserCode();

  const blockedReason = isLoading
    ? 'Loading your profile — your user code has not arrived yet.'
    : error
      ? `Your profile could not be read: ${error}`
      : !userCode
        ? 'Your account has no user code recorded. Ask an administrator to set one.'
        : null;

  const actor = useCallback(
    (action?: string) => requireUserCode(userCode, action),
    [userCode],
  );

  return {
    userCode: userCode ?? null,
    blocked: blockedReason !== null,
    blockedReason,
    isLoading,
    actor,
  };
}
