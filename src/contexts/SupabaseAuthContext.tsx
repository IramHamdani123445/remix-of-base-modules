import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useReducer } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { User, Session } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { logSecurity, logBusinessEvent, startNewCorrelation } from '@/services/systemLoggerService';
import { getDeviceInfo } from '@/services/correlationIdService';
import {
  authReducer,
  initialAuthState,
  canRunAuthenticatedQueriesFor,
  isAuthReadyFor,
  type AuthRuntimeStatus,
  type AuthErrorCode,
  type SupabaseAuthEvent as SbAuthEvent,
} from '@/contexts/authStateMachine';
import { runRefreshOnce } from '@/contexts/refreshCoordinator';

interface UserProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  is_active: boolean;
  force_password_change: boolean;
  mfa_enabled: boolean;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login: string | null;
  user_code: string | null;
}

interface UserRole {
  role: string;
}

interface SessionPolicy {
  sessionTimeoutMinutes: number;
  idleTimeoutMinutes: number;
  autoRefreshEnabled: boolean;
}

// Industry-standard defaults — overridden at runtime by password_policies row.
const DEFAULT_SESSION_TIMEOUT_MINUTES = 480; // absolute ceiling (8h)
const DEFAULT_IDLE_TIMEOUT_MINUTES = 120;    // sliding idle window (2h)
const TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000;
const SESSION_CHECK_INTERVAL_MS = 30_000;
const IDLE_WARNING_BEFORE_MINUTES = 2;
const ACTIVITY_THROTTLE_MS = 10_000;
const ACTIVITY_BROADCAST_CHANNEL = 'auth-activity';
const ACTIVITY_STORAGE_KEY = '__auth_last_activity__';

type AuthBootstrapStatus = 'loading' | 'ready' | 'degraded';
type DataLoadStatus = 'pending' | 'loaded' | 'failed';

interface SupabaseAuthContextType {
  user: User | null;
  profile: UserProfile | null;
  roles: string[];
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isAuthReady: boolean;
  rolesStatus: DataLoadStatus;
  profileStatus: DataLoadStatus;
  authBootstrapStatus: AuthBootstrapStatus;
  /** @deprecated No longer incremented. Use user?.id in queryKeys instead. */
  authBootstrapVersion: number;
  /** BN-MORT-UI-RECOVERY-2D — canonical auth runtime status. */
  authRuntimeStatus: AuthRuntimeStatus;
  /** BN-MORT-UI-RECOVERY-2D — true only during AUTHENTICATED with valid session/user. */
  canRunAuthenticatedQueries: boolean;
  /** BN-MORT-UI-RECOVERY-2D — non-null while auth is in a failure/timeout state. */
  authErrorCode: AuthErrorCode;
  /** BN-MORT-UI-RECOVERY-2D — auth generation, increments on identity change. */
  authGeneration: number;
  /** BN-MORT-UI-RECOVERY-2D — retry the bootstrap after SESSION_TIMEOUT/REFRESH_FAILED. */
  retrySessionBootstrap: () => Promise<void>;
  /** BN-MORT-UI-RECOVERY-2D — force one coordinated refresh via the single-flight coordinator. */
  refreshSessionOnce: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string; requiresPasswordChange?: boolean }>;
  logout: () => Promise<void>;
  hasRole: (role: string) => boolean;
  hasAnyRole: (roles: string[]) => boolean;
  hasPermission: (moduleName: string, actionName: string) => Promise<boolean>;
  refreshProfile: () => Promise<void>;
  getSessionDiagnostics: () => {
    sessionExpiresAt: number | null;
    lastActivityAt: number;
    idleMinutes: number;
    idleLimitMinutes: number;
    idleRemainingMinutes: number;
    sessionAgeMinutes: number;
    sessionLimitMinutes: number;
    autoRefreshEnabled: boolean;
    nextRefreshScheduled: boolean;
  };
}

const SupabaseAuthContext = createContext<SupabaseAuthContextType | null>(null);

export const useSupabaseAuth = () => {
  const context = useContext(SupabaseAuthContext);
  if (!context) {
    throw new Error('useSupabaseAuth must be used within a SupabaseAuthProvider');
  }
  return context;
};

export const SupabaseAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // BN-MORT-UI-RECOVERY-2D — Canonical auth runtime state machine.
  const [authState, dispatchAuth] = useReducer(authReducer, initialAuthState);
  const user = authState.user;
  const session = authState.session;
  const authRuntimeStatus = authState.status;
  const authErrorCode = authState.errorCode;
  const authGeneration = authState.generation;
  const isAuthReady = isAuthReadyFor(authState);
  const canRunAuthenticatedQueries = canRunAuthenticatedQueriesFor(authState);
  const isLoading = authRuntimeStatus === 'INITIALISING' || authRuntimeStatus === 'REFRESHING';

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [rolesStatus, setRolesStatus] = useState<DataLoadStatus>('pending');
  const [profileStatus, setProfileStatus] = useState<DataLoadStatus>('pending');

  // The provider owns refresh scheduling through runRefreshOnce. Disable the
  // auth client's second, implicit scheduler: its proactive refresh can remove
  // a still-valid access token when only the refresh token is unavailable.
  useEffect(() => {
    supabase.auth.stopAutoRefresh();
  }, []);

  // BN-MORT-UI-RECOVERY-2F §1 — Canonical stale-identity ref set.
  // These refs are the single source of truth used by ALL late-arriving
  // async work (profile/role loaders, timeout callbacks, refresh handlers).
  // Effects MUST NOT rely on the captured `authState` closure — they must
  // consult these refs at result-application time.
  const generationRef = useRef<number>(authGeneration);
  const currentUserIdRef = useRef<string | null>(authState.user?.id ?? null);
  const authRuntimeStatusRef = useRef<AuthRuntimeStatus>(authRuntimeStatus);
  const mountedRef = useRef<boolean>(true);
  useEffect(() => { generationRef.current = authGeneration; }, [authGeneration]);
  useEffect(() => { currentUserIdRef.current = authState.user?.id ?? null; }, [authState.user?.id]);
  useEffect(() => { authRuntimeStatusRef.current = authRuntimeStatus; }, [authRuntimeStatus]);
  useEffect(() => () => { mountedRef.current = false; }, []);

  /**
   * BN-MORT-UI-RECOVERY-2F §1 — Canonical stale-identity gate.
   * A late-arriving async result may only mutate provider state when ALL of:
   *   - the provider is still mounted
   *   - the captured generation matches the current generation
   *   - the requested user id matches the current user id
   *   - the auth runtime status is AUTHENTICATED
   * Any component that awaits an identity-scoped result MUST call this
   * before applying the result. Do NOT read `authState` from a captured
   * effect closure.
   */
  const identityGuardPasses = useCallback(
    (capturedGeneration: number, capturedUserId: string): boolean => {
      return (
        mountedRef.current &&
        generationRef.current === capturedGeneration &&
        currentUserIdRef.current === capturedUserId &&
        authRuntimeStatusRef.current === 'AUTHENTICATED'
      );
    },
    [],
  );

  /**
   * BUG-41 — identity gate for data loaded immediately after a session change.
   *
   * `loadUserDataInBackground` runs synchronously right after
   * dispatchAuth({ BOOTSTRAP_SESSION | AUTH_EVENT }), before React has
   * re-rendered. `generationRef` therefore still holds the value from *before*
   * the session was registered. By the time the profile/roles requests resolve
   * the ref has advanced, so `identityGuardPasses` compared a stale captured
   * generation against a newer one and failed — every time, for every user.
   * The loaded profile and roles were then discarded, leaving `profile` null
   * and `roles` empty for the whole session. Every audited BN write failed for
   * want of a user_code, and every role-gated control treated the signed-in
   * user as having no permissions at all.
   *
   * The generation comparison cannot be used here, because it is read before
   * the change it is meant to detect is visible. Identity is the right test
   * instead: the request is keyed by one user id and the reply is that user's
   * own row, so if the same user is still signed in, the data cannot belong to
   * anyone else. That is a more direct guarantee than a counter, not a weaker
   * one. Sign-out and user-switch are still caught, by the user id and status
   * checks below.
   *
   * `identityGuardPasses` above is left alone: its other callers capture the
   * generation after the state has settled, where the comparison is valid.
   */
  const loadedUserDataIsStillCurrent = useCallback(
    (requestedUserId: string): boolean => {
      return (
        mountedRef.current &&
        currentUserIdRef.current === requestedUserId &&
        authRuntimeStatusRef.current === 'AUTHENTICATED'
      );
    },
    [],
  );


  // Session policy from DB
  const policyRef = useRef<SessionPolicy>({
    sessionTimeoutMinutes: DEFAULT_SESSION_TIMEOUT_MINUTES,
    idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
    autoRefreshEnabled: true,
  });

  const policyLoadedRef = useRef(false);

  const lastActivityRef = useRef<number>(Date.now());
  const sessionStartRef = useRef<number>(Date.now());
  const isLoggingOutRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutRef = useRef<() => Promise<void>>(async () => {});
  const idleWarningShownRef = useRef(false);
  const lastActivityUpdateRef = useRef<number>(0);
  const activityChannelRef = useRef<BroadcastChannel | null>(null);

  // Last known good refresh token + a one-shot guard, used to recover from a
  // spurious SIGNED_OUT caused by a transient auth-server failure rather than
  // by the user actually signing out.
  const lastRefreshTokenRef = useRef<string | null>(null);
  const signOutRecoveryInFlightRef = useRef(false);


  // Fetch user profile
  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, is_active, force_password_change, mfa_enabled, failed_login_attempts, locked_until, last_login, user_code')
        .eq('id', userId)
        .single();
      
      if (error) throw error;
      return data as UserProfile;
    } catch (error) {
      console.error('Error fetching profile:', error);
      return null;
    }
  }, []);

  // Fetch user roles
  const fetchRoles = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);
      
      if (error) throw error;
      return (data as UserRole[]).map(r => r.role);
    } catch (error) {
      console.error('Error fetching roles:', error);
      return [];
    }
  }, []);

  // Refresh profile data — guarded against identity changes racing the request.
  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const requestedUserId = user.id;
    const startGen = generationRef.current;
    const [profileData, rolesData] = await Promise.all([
      fetchProfile(requestedUserId),
      fetchRoles(requestedUserId),
    ]);
    // BN-MORT-UI-RECOVERY-2F §1 — canonical identity gate (not the stale closure).
    if (!identityGuardPasses(startGen, requestedUserId)) {
      return;
    }
    setProfile(profileData);
    setRoles(rolesData);
  }, [user, fetchProfile, fetchRoles, identityGuardPasses]);



  // Apply an activity timestamp without re-broadcasting (used by inbound cross-tab pings)
  const applyActivityTs = useCallback((ts: number) => {
    if (ts > lastActivityRef.current) {
      lastActivityRef.current = ts;
      lastActivityUpdateRef.current = ts;
      idleWarningShownRef.current = false;
    }
  }, []);

  // Throttled activity update — local DOM/network activity. Broadcasts to other tabs.
  const updateActivity = useCallback(() => {
    const now = Date.now();
    if (now - lastActivityUpdateRef.current >= ACTIVITY_THROTTLE_MS) {
      lastActivityRef.current = now;
      lastActivityUpdateRef.current = now;
      idleWarningShownRef.current = false;
      // Cross-tab sync
      try {
        activityChannelRef.current?.postMessage({ type: 'activity', ts: now });
      } catch {
        // ignore
      }
      try {
        localStorage.setItem(ACTIVITY_STORAGE_KEY, String(now));
      } catch {
        // ignore (private mode etc.)
      }
    }
  }, []);

  // Graceful logout
  const logout = useCallback(async () => {
    if (isLoggingOutRef.current) return;
    isLoggingOutRef.current = true;

    try {
      startNewCorrelation();
      
      if (user) {
        await logSecurity({
          event_type: 'logout',
          user_name: user.email || profile?.full_name || 'Unknown',
          success: true,
          module: 'Authentication',
          api_name: 'logout',
          severity: 'info',
          payload_json: {
            device: getDeviceInfo(),
            timestamp: new Date().toISOString(),
          },
        }, user.id);

        await supabase.from('audit_logs').insert({
          action_type: 'LOGOUT',
          module_name: 'Authentication',
          entity_type: 'user',
          user_id: user.id,
          user_email: user.email,
        });
      }
      
      await supabase.auth.signOut();
      dispatchAuth({ type: 'LOGOUT' });
      setProfile(null);
      setRoles([]);
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      isLoggingOutRef.current = false;
    }
  }, [user, profile]);

  useEffect(() => {
    logoutRef.current = logout;
  }, [logout]);

  // Schedule proactive token refresh before expiry
  const scheduleTokenRefresh = useCallback((currentSession: Session | null) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    if (!currentSession || !policyRef.current.autoRefreshEnabled) return;

    const expiresAt = currentSession.expires_at;
    if (!expiresAt) return;

    const expiresAtMs = expiresAt * 1000;
    const now = Date.now();
    const msUntilExpiry = expiresAtMs - now;
    const refreshIn = Math.max(msUntilExpiry - TOKEN_REFRESH_BUFFER_MS, 5000);

    if (refreshIn > 0 && refreshIn < 60 * 60 * 1000) {
      refreshTimerRef.current = setTimeout(async () => {
        const startGen = generationRef.current;
        dispatchAuth({ type: 'REFRESH_START' });
        const result = await runRefreshOnce();
        if (generationRef.current !== startGen) return; // stale — identity changed
        if (result.expired) {
          dispatchAuth({ type: 'REFRESH_EXPIRED' });
        } else if (result.error) {
          dispatchAuth({ type: 'REFRESH_ERROR', message: result.error });
        } else if (result.session) {
          dispatchAuth({ type: 'REFRESH_SUCCESS', session: result.session });
          scheduleTokenRefresh(result.session);
        }
      }, refreshIn);
    }
  }, []);


  // Load timeout settings — single source of truth: password_policies (active row)
  const loadSessionPolicy = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('password_policies')
        .select('session_timeout_minutes, idle_timeout_minutes, auto_refresh_enabled')
        .eq('is_active', true)
        .single();

      if (error) return; // keep defaults

      policyRef.current = {
        sessionTimeoutMinutes: typeof data?.session_timeout_minutes === 'number'
          ? data.session_timeout_minutes
          : DEFAULT_SESSION_TIMEOUT_MINUTES,
        idleTimeoutMinutes: typeof data?.idle_timeout_minutes === 'number'
          ? data.idle_timeout_minutes
          : DEFAULT_IDLE_TIMEOUT_MINUTES,
        autoRefreshEnabled: data?.auto_refresh_enabled !== false,
      };

      policyLoadedRef.current = true;
    } catch {
      // Fall back to defaults
    }
  }, []);

  // Idle & session timeout checker
  useEffect(() => {
    if (!session) return;

    if (!policyLoadedRef.current) {
      loadSessionPolicy();
    }

    const checkTimeouts = () => {
      if (isLoggingOutRef.current) return;
      if (!policyLoadedRef.current) return;

      const now = Date.now();
      const idleMinutes = (now - lastActivityRef.current) / 60_000;
      const sessionMinutes = (now - sessionStartRef.current) / 60_000;

      const idleLimit = policyRef.current.idleTimeoutMinutes;
      const warningThreshold = idleLimit - IDLE_WARNING_BEFORE_MINUTES;

      if (idleMinutes >= warningThreshold && idleMinutes < idleLimit && !idleWarningShownRef.current) {
        idleWarningShownRef.current = true;
        const remainingSeconds = Math.ceil((idleLimit - idleMinutes) * 60);
        toast.warning(
          `Your session will expire in ${remainingSeconds > 60 ? Math.ceil(remainingSeconds / 60) + ' minute(s)' : remainingSeconds + ' seconds'} due to inactivity. Move your mouse or press any key to stay logged in.`,
          { duration: 10000 }
        );
      }

      if (idleMinutes >= idleLimit) {
        toast.warning('Session expired due to inactivity');
        if (user) {
          void logSecurity({
            event_type: 'logout',
            user_name: user.email || profile?.full_name || 'Unknown',
            success: true,
            module: 'Authentication',
            api_name: 'idle_timeout_logout',
            severity: 'info',
            payload_json: { idle_minutes: Math.round(idleMinutes), idle_limit: idleLimit },
          }, user.id).catch(() => {});
        }
        void logoutRef.current();
        return;
      }

      if (sessionMinutes >= policyRef.current.sessionTimeoutMinutes) {
        toast.warning('Session expired (maximum duration reached)');
        if (user) {
          void logSecurity({
            event_type: 'logout',
            user_name: user.email || profile?.full_name || 'Unknown',
            success: true,
            module: 'Authentication',
            api_name: 'absolute_timeout_logout',
            severity: 'info',
            payload_json: { session_minutes: Math.round(sessionMinutes), session_limit: policyRef.current.sessionTimeoutMinutes },
          }, user.id).catch(() => {});
        }
        void logoutRef.current();
        return;
      }
    };

    const interval = setInterval(checkTimeouts, SESSION_CHECK_INTERVAL_MS);

    // Broad activity surface: typing, editing, scrolling, touching, focusing — all count.
    const events = [
      'click', 'mousedown', 'mousemove',
      'keydown', 'keyup', 'input', 'change',
      'focus', 'focusin',
      'scroll', 'wheel',
      'touchstart', 'pointerdown',
    ];
    events.forEach(event => window.addEventListener(event, updateActivity, { passive: true, capture: true }));

    return () => {
      clearInterval(interval);
      events.forEach(event => window.removeEventListener(event, updateActivity, { capture: true } as any));
    };
  }, [session, updateActivity, loadSessionPolicy]);

  // Handle tab visibility change — resilient to transient failures
  useEffect(() => {
    if (!session) return;

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && !isLoggingOutRef.current) {
        lastActivityRef.current = Date.now();
        lastActivityUpdateRef.current = Date.now();
        idleWarningShownRef.current = false;

        try {
          const { data, error } = await supabase.auth.getSession();
          if (error || !data.session) {
            // Try one coordinated refresh before giving up.
            console.warn('Session missing after tab switch, attempting refresh…');
            const startGen = generationRef.current;
            dispatchAuth({ type: 'REFRESH_START' });
            const result = await runRefreshOnce();
            if (generationRef.current !== startGen) return;
            if (result.expired) {
              dispatchAuth({ type: 'REFRESH_EXPIRED' });
              toast.warning('Session expired. Please log in again.');
            } else if (result.error) {
              dispatchAuth({ type: 'REFRESH_ERROR', message: result.error });
            } else if (result.session) {
              dispatchAuth({ type: 'REFRESH_SUCCESS', session: result.session });
              scheduleTokenRefresh(result.session);
            }
          } else {
            void loadSessionPolicy().catch(() => {});
            scheduleTokenRefresh(data.session);
          }
        } catch (err) {
          console.warn('Error checking session on visibility change:', err);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [session, loadSessionPolicy, scheduleTokenRefresh]);


  // Cross-tab activity sync (BroadcastChannel + localStorage fallback)
  useEffect(() => {
    if (!session) return;

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(ACTIVITY_BROADCAST_CHANNEL);
        channel.onmessage = (ev) => {
          if (ev.data?.type === 'activity' && typeof ev.data.ts === 'number') {
            applyActivityTs(ev.data.ts);
          }
        };
        activityChannelRef.current = channel;
      } catch {
        channel = null;
      }
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key === ACTIVITY_STORAGE_KEY && e.newValue) {
        const ts = parseInt(e.newValue, 10);
        if (!Number.isNaN(ts)) applyActivityTs(ts);
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('storage', onStorage);
      if (channel) {
        try { channel.close(); } catch { /* noop */ }
      }
      activityChannelRef.current = null;
    };
  }, [session, applyActivityTs]);

  // Global fetch wrapper — count successful network activity (React-Query, supabase-js,
  // axios-via-fetch) as user activity so background data refresh extends the idle window.
  useEffect(() => {
    if (!session) return;
    if (typeof window === 'undefined' || !window.fetch) return;

    const originalFetch = window.fetch.bind(window);
    const wrappedFetch: typeof window.fetch = async (...args) => {
      const res = await originalFetch(...args);
      if (res && res.ok) updateActivity();
      return res;
    };
    window.fetch = wrappedFetch;

    return () => {
      if (window.fetch === wrappedFetch) {
        window.fetch = originalFetch;
      }
    };
  }, [session, updateActivity]);

  // Initialize auth state — two-phase: session-ready first, then user data in background
  useEffect(() => {
    let initDone = false;

    // Background-load profile/roles with a hard timeout to prevent hanging
    const BOOTSTRAP_TIMEOUT_MS = 5_000;

    const loadUserDataInBackground = (userId: string) => {
      // BUG-41 — this runs in the same tick as the dispatch that registers the
      // session, so the generation cannot be captured meaningfully here (see
      // loadedUserDataIsStillCurrent). The gate matches on the user the request
      // was made for instead, which is what actually distinguishes a stale
      // reply from a current one.
      const requestedUserId = userId;
      const passesGate = () => loadedUserDataIsStillCurrent(requestedUserId);

      const dataPromise = Promise.all([fetchProfile(requestedUserId), fetchRoles(requestedUserId)])
        .then(([profileData, rolesData]) => {
          if (!passesGate()) return; // stale — identity/status changed while loading
          setProfile(profileData);
          setProfileStatus(profileData ? 'loaded' : 'failed');
          setRoles(rolesData);
          setRolesStatus('loaded');
        })
        .catch((err) => {
          if (!passesGate()) return;
          console.error('Failed to load user data:', err);
          setProfileStatus('failed');
          setRolesStatus('failed');
        });

      // Hard timeout: if profile/roles don't load in time, mark as failed but don't block.
      // The timeout callback MUST also consult the canonical gate — a timeout for
      // User A cannot mark User B's profile/roles failed.
      const timeoutPromise = new Promise<void>((resolve) =>
        setTimeout(() => {
          if (!passesGate()) { resolve(); return; }
          setProfileStatus((prev) => (prev === 'pending' ? 'failed' : prev));
          setRolesStatus((prev) => (prev === 'pending' ? 'failed' : prev));
          resolve();
        }, BOOTSTRAP_TIMEOUT_MS)
      );

      // Fire-and-forget: whichever finishes first wins
      void Promise.race([dataPromise, timeoutPromise]);
    };



    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, currentSession) => {
        if (currentSession?.refresh_token) {
          lastRefreshTokenRef.current = currentSession.refresh_token;
          signOutRecoveryInFlightRef.current = false;
        }

        if (isLoggingOutRef.current && event === 'SIGNED_OUT') {
          return;
        }

        // A SIGNED_OUT the user did not ask for is usually the auth client
        // discarding the session after a transient failure (slow backend, a
        // momentarily expired access token). Try to restore it once from the
        // last known refresh token before throwing the user out mid-task; a
        // successful refresh re-emits SIGNED_IN/TOKEN_REFRESHED and this
        // sign-out is never surfaced to the UI.
        if (
          event === 'SIGNED_OUT' &&
          lastRefreshTokenRef.current &&
          !signOutRecoveryInFlightRef.current
        ) {
          const refreshToken = lastRefreshTokenRef.current;
          signOutRecoveryInFlightRef.current = true;
          void (async () => {
            try {
              const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
              if (!error && data?.session) {
                console.warn('[Auth] Recovered a spurious sign-out by refreshing the session');
                return;
              }
            } catch {
              // fall through to a real sign-out
            }
            lastRefreshTokenRef.current = null;
            if (!mountedRef.current) return;
            dispatchAuth({ type: 'AUTH_EVENT', event: 'SIGNED_OUT' as SbAuthEvent, session: null });
            setProfile(null);
            setRoles([]);
            setProfileStatus('pending');
            setRolesStatus('pending');
          })();
          return;
        }

        if (event === 'SIGNED_OUT') {
          lastRefreshTokenRef.current = null;
        }


        // Dispatch through the state machine — this is the single source of truth
        // for user/session (see BN-MORT-UI-RECOVERY-2D).
        if (
          event === 'INITIAL_SESSION' ||
          event === 'SIGNED_IN' ||
          event === 'SIGNED_OUT' ||
          event === 'TOKEN_REFRESHED' ||
          event === 'USER_UPDATED' ||
          event === 'PASSWORD_RECOVERY'
        ) {
          dispatchAuth({
            type: 'AUTH_EVENT',
            event: event as SbAuthEvent,
            session: currentSession,
          });
        }

        if (event === 'SIGNED_IN' && currentSession) {
          sessionStartRef.current = Date.now();
          lastActivityRef.current = Date.now();
          lastActivityUpdateRef.current = Date.now();
          idleWarningShownRef.current = false;
          scheduleTokenRefresh(currentSession);
        }

        if (event === 'TOKEN_REFRESHED' && currentSession) {
          // NOTE: do NOT reset sessionStartRef — the absolute ceiling must be honored
          // regardless of token refreshes (industry standard).
          lastActivityRef.current = Date.now();
          lastActivityUpdateRef.current = Date.now();
          scheduleTokenRefresh(currentSession);
          console.info('Auth token refreshed successfully');
          if (currentSession.user) {
            void logSecurity({
              event_type: 'login',
              user_name: currentSession.user.email || 'Unknown',
              success: true,
              module: 'Authentication',
              api_name: 'token_refreshed',
              severity: 'info',
              payload_json: { ts: new Date().toISOString() },
            }, currentSession.user.id).catch(() => {});
          }
        }

        // After initializeAuth completes, handle profile/roles for auth changes
        if (initDone && currentSession?.user) {
          loadUserDataInBackground(currentSession.user.id);
        } else if (event === 'SIGNED_OUT') {
          setProfile(null);
          setRoles([]);
          setProfileStatus('pending');
          setRolesStatus('pending');
        }
      }
    );

    // BN-MORT-UI-RECOVERY-2D — Bootstrap dispatches into the state machine.
    // Timeout no longer fabricates an "unauthenticated" verdict — it enters
    // SESSION_TIMEOUT, which the UI treats as recoverable (not signed-out).
    const initializeAuth = async () => {
      const SESSION_RESTORE_TIMEOUT_MS = 4_000;
      dispatchAuth({ type: 'BOOTSTRAP_START' });

      let timedOut = false;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        console.warn('[Auth] getSession() timed out — status=SESSION_TIMEOUT');
        dispatchAuth({ type: 'BOOTSTRAP_TIMEOUT' });
      }, SESSION_RESTORE_TIMEOUT_MS);

      try {
        const sessionResult = await supabase.auth.getSession();
        clearTimeout(timeoutHandle);
        if (timedOut) return; // late arrival — reducer will recover on AUTH_EVENT

        const currentSession = sessionResult?.data?.session ?? null;
        dispatchAuth({ type: 'BOOTSTRAP_SESSION', session: currentSession });

        if (currentSession) {
          sessionStartRef.current = Date.now();
          lastActivityRef.current = Date.now();
          lastActivityUpdateRef.current = Date.now();
          scheduleTokenRefresh(currentSession);
        }

        initDone = true;

        if (currentSession?.user) {
          loadUserDataInBackground(currentSession.user.id);
          void loadSessionPolicy().catch(() => {});
        } else {
          setProfileStatus('loaded');
          setRolesStatus('loaded');
        }
      } catch (err) {
        clearTimeout(timeoutHandle);
        if (timedOut) return;
        console.error('Auth initialization error:', err);
        dispatchAuth({ type: 'BOOTSTRAP_ERROR', message: err instanceof Error ? err.message : String(err) });
        setProfileStatus('failed');
        setRolesStatus('failed');
        initDone = true;
      }
    };

    initializeAuth();

    return () => {
      subscription.unsubscribe();
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, [fetchProfile, fetchRoles, scheduleTokenRefresh, loadSessionPolicy]);

  // Login function with lockout check
  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string; requiresPasswordChange?: boolean }> => {
    try {
      const RESOLVE_EMAIL_TIMEOUT_MS = 500;

      const fetchProfileByEmail = async (lookupEmail: string) => {
        const { data } = await supabase
          .from('profiles')
          .select('id, locked_until, failed_login_attempts, is_active, force_password_change, email, lockout_exempt')
          .eq('email', lookupEmail)
          .limit(1)
          .maybeSingle();

        return data;
      };

      const validateProfileAccess = (existingProfile: Awaited<ReturnType<typeof fetchProfileByEmail>>) => {
        if (!existingProfile) return null;

        if (!existingProfile.is_active) {
          return 'Account is deactivated. Please contact administrator.';
        }

        if (existingProfile.locked_until && !(existingProfile as any).lockout_exempt) {
          const lockUntil = new Date(existingProfile.locked_until);
          if (lockUntil > new Date()) {
            const minutesRemaining = Math.ceil((lockUntil.getTime() - Date.now()) / 60000);
            return `Account is locked. Try again in ${minutesRemaining} minutes.`;
          }
        }

        return null;
      };

      const hasInvalidCredentialsMessage = (message?: string) => {
        const normalized = message?.toLowerCase() ?? '';
        return normalized.includes('invalid') || normalized.includes('credential');
      };

      const resolveAuthEmailPromise = Promise.race<string | null>([
        supabase.functions.invoke('resolve-auth-email', { body: { email } })
          .then(({ data }) => data?.auth_email ?? null)
          .catch(err => {
            console.warn('Email resolution failed, using provided email:', err);
            return null;
          }),
        new Promise<string | null>((resolve) =>
          setTimeout(() => {
            console.warn('[Login] resolve-auth-email timed out after 500ms — using provided email unless retry is needed');
            resolve(null);
          }, RESOLVE_EMAIL_TIMEOUT_MS)
        ),
      ]);

      let existingProfile = await fetchProfileByEmail(email);
      let loginEmail = email;

      if (!existingProfile) {
        const resolvedEmail = await resolveAuthEmailPromise;
        if (resolvedEmail && resolvedEmail !== email) {
          loginEmail = resolvedEmail;
          existingProfile = await fetchProfileByEmail(resolvedEmail);
        }
      }

      const profileAccessError = validateProfileAccess(existingProfile);
      if (profileAccessError) {
        return { success: false, error: profileAccessError };
      }

      const SIGN_IN_TIMEOUT_MS = 8_000;

      const signInWithTimeout = (signInEmail: string, signInPassword: string) =>
        Promise.race([
          supabase.auth.signInWithPassword({ email: signInEmail, password: signInPassword }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('Authentication service is not responding. Please use the Share Preview link or published URL.')),
              SIGN_IN_TIMEOUT_MS
            )
          ),
        ]);

      let { data, error } = await signInWithTimeout(loginEmail, password);

      if (error && loginEmail === email && hasInvalidCredentialsMessage(error.message)) {
        const resolvedEmail = await resolveAuthEmailPromise;

        if (resolvedEmail && resolvedEmail !== email) {
          const resolvedProfile = existingProfile ?? await fetchProfileByEmail(resolvedEmail);
          const resolvedProfileAccessError = validateProfileAccess(resolvedProfile);

          if (resolvedProfileAccessError) {
            return { success: false, error: resolvedProfileAccessError };
          }

          existingProfile = resolvedProfile;
          loginEmail = resolvedEmail;

          const retryResult = await signInWithTimeout(resolvedEmail, password);
          data = retryResult.data;
          error = retryResult.error;
        }
      }

      if (error) {
        if (existingProfile) {
          const newAttempts = (existingProfile.failed_login_attempts || 0) + 1;
          const lockoutThreshold = 5;
          const isExempt = !!(existingProfile as any).lockout_exempt;

          const updateData: Record<string, unknown> = {
            failed_login_attempts: newAttempts
          };

          if (!isExempt && newAttempts >= lockoutThreshold) {
            const lockDuration = 30;
            updateData.locked_until = new Date(Date.now() + lockDuration * 60000).toISOString();
          }

          await supabase
            .from('profiles')
            .update(updateData)
            .eq('id', existingProfile.id);
        }

        return { success: false, error: error.message };
      }

      if (data.user) {
        sessionStartRef.current = Date.now();
        lastActivityRef.current = Date.now();
        lastActivityUpdateRef.current = Date.now();
        isLoggingOutRef.current = false;
        idleWarningShownRef.current = false;

        // Fire-and-forget: reset failed attempts and update last_login
        void supabase
          .from('profiles')
          .update({ 
            failed_login_attempts: 0, 
            locked_until: null,
            last_login: new Date().toISOString()
          })
          .eq('id', data.user.id);

        // Fire-and-forget: load session policy in background
        void loadSessionPolicy().catch(() => {});

        // Check force_password_change with a quick lightweight query
        // Profile/roles will be loaded by onAuthStateChange -> loadUserDataInBackground
        if (existingProfile?.force_password_change) {
          return { success: true, requiresPasswordChange: true };
        } else if (!existingProfile) {
          // No pre-fetched profile — do a quick single-field check
          const { data: fpData } = await supabase
            .from('profiles')
            .select('force_password_change')
            .eq('id', data.user.id)
            .single();
          if (fpData?.force_password_change) {
            return { success: true, requiresPasswordChange: true };
          }
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      const message = error instanceof Error ? error.message : 'An unexpected error occurred';
      return { success: false, error: message };
    }
  };

  const hasRole = (role: string): boolean => roles.includes(role);
  const hasAnyRole = (checkRoles: string[]): boolean => checkRoles.some(role => roles.includes(role));
  const isAdmin = roles.includes('Admin');

  const hasPermission = async (moduleName: string, actionName: string): Promise<boolean> => {
    if (!user) return false;
    if (isAdmin) return true;
    
    try {
      const { data, error } = await supabase
        .rpc('has_permission', {
          _user_id: user.id,
          _module_name: moduleName,
          _action_name: actionName
        });
      
      if (error) throw error;
      return data ?? false;
    } catch (error) {
      console.error('Permission check error:', error);
      return false;
    }
  };

  const authBootstrapStatus: AuthBootstrapStatus = !isAuthReady
    ? 'loading'
    : (profileStatus === 'failed' || rolesStatus === 'failed')
      ? 'degraded'
      : 'ready';

  const getSessionDiagnostics = useCallback(() => {
    const now = Date.now();
    const idleMs = now - lastActivityRef.current;
    const sessionMs = now - sessionStartRef.current;
    const idleLimit = policyRef.current.idleTimeoutMinutes;
    const sessionLimit = policyRef.current.sessionTimeoutMinutes;
    return {
      sessionExpiresAt: session?.expires_at ? session.expires_at * 1000 : null,
      lastActivityAt: lastActivityRef.current,
      idleMinutes: idleMs / 60_000,
      idleLimitMinutes: idleLimit,
      idleRemainingMinutes: Math.max(0, idleLimit - idleMs / 60_000),
      sessionAgeMinutes: sessionMs / 60_000,
      sessionLimitMinutes: sessionLimit,
      autoRefreshEnabled: policyRef.current.autoRefreshEnabled,
      nextRefreshScheduled: !!refreshTimerRef.current,
    };
  }, [session]);

  const retrySessionBootstrap = useCallback(async () => {
    const RETRY_TIMEOUT_MS = 4_000;
    dispatchAuth({ type: 'BOOTSTRAP_START' });
    const startGen = generationRef.current;
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      dispatchAuth({ type: 'BOOTSTRAP_TIMEOUT' });
    }, RETRY_TIMEOUT_MS);
    try {
      const { data } = await supabase.auth.getSession();
      clearTimeout(timeoutHandle);
      if (timedOut) return;
      // Stale-guard: identity may have moved on while we awaited.
      if (generationRef.current !== startGen && data.session?.user?.id !== authState.user?.id) {
        return;
      }
      dispatchAuth({ type: 'BOOTSTRAP_SESSION', session: data.session ?? null });
    } catch (err) {
      clearTimeout(timeoutHandle);
      if (timedOut) return;
      dispatchAuth({ type: 'BOOTSTRAP_ERROR', message: err instanceof Error ? err.message : String(err) });
    }
  }, [authState.user?.id]);

  const refreshSessionOnce = useCallback(async () => {
    const startGen = generationRef.current;
    dispatchAuth({ type: 'REFRESH_START' });
    const result = await runRefreshOnce();
    if (generationRef.current !== startGen) return; // stale — identity changed
    if (result.expired) {
      dispatchAuth({ type: 'REFRESH_EXPIRED' });
    } else if (result.error) {
      dispatchAuth({ type: 'REFRESH_ERROR', message: result.error });
    } else if (result.session) {
      dispatchAuth({ type: 'REFRESH_SUCCESS', session: result.session });
    }
  }, []);


  const value: SupabaseAuthContextType = {
    user,
    profile,
    roles,
    session,
    isLoading,
    isAuthenticated: authRuntimeStatus === 'AUTHENTICATED' && !!session && !!user,
    isAdmin,
    isAuthReady,
    rolesStatus,
    profileStatus,
    authBootstrapStatus,
    authBootstrapVersion: 0,
    authRuntimeStatus,
    canRunAuthenticatedQueries,
    authErrorCode,
    authGeneration,
    retrySessionBootstrap,
    refreshSessionOnce,
    login,
    logout,
    hasRole,
    hasAnyRole,
    hasPermission,
    refreshProfile,
    getSessionDiagnostics,
  };

  return (
    <SupabaseAuthContext.Provider value={value}>
      {children}
    </SupabaseAuthContext.Provider>
  );
};
