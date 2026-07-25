/**
 * Communication Hub — shared authenticated-session helper.
 *
 * Every operator-invoked test orchestrator (dry-run, controlled-live) must
 * ensure a fresh JWT is attached to the edge-function call. `supabase.auth`
 * normally does this transparently, but in long-lived Go Live sessions the
 * access token can silently expire between prerequisite polling and the
 * final "send" click, causing the Functions client to POST without a
 * valid Authorization header. That produces the misleading
 * `Failed to send a request to the Edge Function` toast.
 *
 * `getFreshAuthenticatedSession()` returns a guaranteed-valid session or
 * throws a stable, typed error (`authentication_required` /
 * `session_lookup_failed`) that callers can surface as a blocker.
 *
 * This helper must be the ONLY authentication entry point for the
 * dry-run and controlled-live test services.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { getPersistedSessionSnapshot } from "@/contexts/authStorage";
import { runRefreshOnce } from "@/contexts/refreshCoordinator";

export class CommHubAuthError extends Error {
  constructor(
    public readonly code:
      | "session_lookup_failed"
      | "authentication_required"
      | "OPERATOR_ACCESS_TOKEN_EXPIRED"
      | "OPERATOR_TOKEN_TOO_CLOSE_TO_EXPIRY"
      | "OPERATOR_REFRESH_REQUIRED"
      | "OPERATOR_REFRESH_FAILED"
      | "OPERATOR_IDENTITY_MISMATCH",
    message?: string,
    public readonly evidence?: ActionReadySessionEvidence,
  ) {
    super(message ?? code);
    this.name = "CommHubAuthError";
  }
}

/**
 * Read the persisted auth session without invoking auth-js refresh logic.
 * auth.getSession() may proactively refresh inside its expiry margin; on an
 * invalid refresh token that path can remove a still-valid access token and
 * emit SIGNED_OUT. The persisted token is untrusted until getUser(token)
 * validates it below.
 */
export interface ActionReadySessionEvidence {
  tokenExpiresAt: string | null;
  tokenRemainingSeconds: number;
  authServerUserConfirmed: boolean;
  userId: string | null;
  refreshed: boolean;
}

export interface ActionReadySessionResult {
  session: Session;
  evidence: ActionReadySessionEvidence;
}

function remainingSeconds(session: Session | null): number {
  if (!session?.expires_at) return 0;
  return Math.max(0, Math.floor(session.expires_at - Date.now() / 1000));
}

export async function getActionReadySession(options: {
  minValiditySeconds?: number;
  forceRefresh?: boolean;
} = {}): Promise<ActionReadySessionResult> {
  const minValiditySeconds = options.minValiditySeconds ?? 300;
  let current = getPersistedSessionSnapshot();
  if (!current) {
    // No persisted token exists to preserve, so the regular lookup cannot
    // destroy the valid-token case this helper protects.
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      throw new CommHubAuthError("session_lookup_failed", error.message);
    }
    current = data?.session ?? null;
  }

  const originalUserId = current?.user?.id ?? null;
  const currentRemaining = remainingSeconds(current);
  if (current?.access_token) {
    const { data: userData, error: userErr } = await supabase.auth.getUser(current.access_token);
    if (!userErr && userData?.user?.id && !options.forceRefresh && currentRemaining >= minValiditySeconds) {
      if (originalUserId && userData.user.id !== originalUserId) {
        throw new CommHubAuthError("OPERATOR_IDENTITY_MISMATCH");
      }
      return {
        session: current,
        evidence: {
          tokenExpiresAt: current.expires_at ? new Date(current.expires_at * 1000).toISOString() : null,
          tokenRemainingSeconds: currentRemaining,
          authServerUserConfirmed: true,
          userId: userData.user.id,
          refreshed: false,
        },
      };
    }
  }

  const refresh = await runRefreshOnce({ forceRefresh: true });
  if (!refresh.session?.access_token) {
    throw new CommHubAuthError(
      "OPERATOR_REFRESH_FAILED",
      refresh.error ?? "refresh token could not restore the session",
      {
        tokenExpiresAt: current?.expires_at ? new Date(current.expires_at * 1000).toISOString() : null,
        tokenRemainingSeconds: currentRemaining,
        authServerUserConfirmed: false,
        userId: originalUserId,
        refreshed: false,
      },
    );
  }
  const refreshed = refresh.session;
  const refreshedRemaining = remainingSeconds(refreshed);
  const { data: verified, error: verifyError } = await supabase.auth.getUser(refreshed.access_token);
  if (verifyError || !verified.user?.id) {
    throw new CommHubAuthError("OPERATOR_REFRESH_FAILED", verifyError?.message ?? "refreshed token was rejected");
  }
  if (originalUserId && verified.user.id !== originalUserId) {
    throw new CommHubAuthError("OPERATOR_IDENTITY_MISMATCH", "refreshed session belongs to a different user");
  }
  if (refreshedRemaining < minValiditySeconds) {
    throw new CommHubAuthError("OPERATOR_TOKEN_TOO_CLOSE_TO_EXPIRY", "refreshed token does not meet the action validity window");
  }
  return {
    session: refreshed,
    evidence: {
      tokenExpiresAt: refreshed.expires_at ? new Date(refreshed.expires_at * 1000).toISOString() : null,
      tokenRemainingSeconds: refreshedRemaining,
      authServerUserConfirmed: true,
      userId: verified.user.id,
      refreshed: true,
    },
  };
}

/** Backward-compatible alias; all action paths now enforce a five-minute window. */
export async function getFreshAuthenticatedSession(): Promise<Session> {
  return (await getActionReadySession({ minValiditySeconds: 300 })).session;
}
