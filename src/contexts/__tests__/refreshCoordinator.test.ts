/**
 * BN-MORT-UI-RECOVERY-2F §2 — Refresh coordinator tests.
 *
 * Verifies single-flight semantics, in-flight cleanup, and the mapping
 * from underlying supabase errors to {expired, error} verdicts consumed
 * by SupabaseAuthContext.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the supabase client used by the coordinator.
const refreshSessionMock = vi.fn();
const getSessionMock = vi.fn();
const getUserMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: {
    refreshSession: (...args: unknown[]) => refreshSessionMock(...args),
    getSession: (...args: unknown[]) => getSessionMock(...args),
    getUser: (...args: unknown[]) => getUserMock(...args),
  } },
}));

import { runRefreshOnce, __resetRefreshCoordinatorForTests } from '@/contexts/refreshCoordinator';

const okSession = () => ({ access_token: 'a', refresh_token: 'r', expires_at: 1, user: { id: 'u1' } });

describe('refreshCoordinator', () => {
  beforeEach(() => {
    __resetRefreshCoordinatorForTests();
    refreshSessionMock.mockReset();
    getSessionMock.mockReset();
    getUserMock.mockReset();
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
  });

  it('preserves a server-valid current token without destructive refresh', async () => {
    const session = okSession();
    getSessionMock.mockResolvedValueOnce({ data: { session }, error: null });
    getUserMock.mockResolvedValueOnce({ data: { user: session.user }, error: null });

    const result = await runRefreshOnce();

    expect(result.session).toBe(session);
    expect(refreshSessionMock).not.toHaveBeenCalled();
  });

  it('force refresh never returns the accepted old token', async () => {
    const oldSession = okSession();
    const newSession = { ...okSession(), access_token: 'new-token' };
    getSessionMock.mockResolvedValueOnce({ data: { session: oldSession }, error: null });
    getUserMock.mockResolvedValueOnce({ data: { user: oldSession.user }, error: null });
    refreshSessionMock.mockResolvedValueOnce({ data: { session: newSession }, error: null });
    const result = await runRefreshOnce({ forceRefresh: true });
    expect(result.session?.access_token).toBe('new-token');
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
  });

  it('single caller — one refresh request produces one supabase call', async () => {
    refreshSessionMock.mockResolvedValueOnce({ data: { session: okSession() }, error: null });
    const result = await runRefreshOnce();
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(result.session).not.toBeNull();
    expect(result.expired).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it('concurrent callers share the same Promise (single-flight)', async () => {
    let resolveInner!: (v: unknown) => void;
    refreshSessionMock.mockImplementationOnce(() => new Promise((r) => { resolveInner = r; }));

    const p1 = runRefreshOnce();
    const p2 = runRefreshOnce();
    const p3 = runRefreshOnce();

    // performRefresh first awaits the non-destructive current-token check.
    await Promise.resolve();
    await Promise.resolve();
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    resolveInner({ data: { session: okSession() }, error: null });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  it('in-flight state clears after success — a follow-up call triggers a new refresh', async () => {
    refreshSessionMock.mockResolvedValueOnce({ data: { session: okSession() }, error: null });
    await runRefreshOnce();
    refreshSessionMock.mockResolvedValueOnce({ data: { session: okSession() }, error: null });
    await runRefreshOnce();
    expect(refreshSessionMock).toHaveBeenCalledTimes(2);
  });

  it('in-flight state clears after failure — a follow-up call triggers a new refresh', async () => {
    refreshSessionMock.mockResolvedValueOnce({ data: { session: null }, error: { message: 'boom' } });
    await runRefreshOnce();
    refreshSessionMock.mockResolvedValueOnce({ data: { session: okSession() }, error: null });
    const second = await runRefreshOnce();
    expect(second.session).not.toBeNull();
    expect(refreshSessionMock).toHaveBeenCalledTimes(2);
  });

  it('missing session resolves as expired', async () => {
    refreshSessionMock.mockResolvedValueOnce({ data: { session: null }, error: null });
    const result = await runRefreshOnce();
    expect(result.expired).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.session).toBeNull();
  });

  it('expired token error resolves as expired (not generic error)', async () => {
    refreshSessionMock.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'JWT expired' },
    });
    const result = await runRefreshOnce();
    expect(result.expired).toBe(true);
  });

  it('invalid token error resolves as expired', async () => {
    refreshSessionMock.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'Invalid refresh token' },
    });
    const result = await runRefreshOnce();
    expect(result.expired).toBe(true);
  });

  it('generic transport error resolves as error, not expired', async () => {
    refreshSessionMock.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'network unreachable' },
    });
    const result = await runRefreshOnce();
    expect(result.expired).toBeUndefined();
    expect(result.error).toContain('network');
  });

  it('thrown exception resolves as error, session null', async () => {
    refreshSessionMock.mockRejectedValueOnce(new Error('fetch failed'));
    const result = await runRefreshOnce();
    expect(result.session).toBeNull();
    expect(result.error).toContain('fetch failed');
  });

  it('test reset hook clears in-flight state', async () => {
    let hangResolve!: (v: unknown) => void;
    refreshSessionMock.mockImplementationOnce(() => new Promise((r) => { hangResolve = r; }));
    const inflight = runRefreshOnce();
    __resetRefreshCoordinatorForTests();
    // A new call after reset must start a fresh refresh (coordinator forgot the first).
    refreshSessionMock.mockResolvedValueOnce({ data: { session: okSession() }, error: null });
    const second = await runRefreshOnce();
    expect(refreshSessionMock).toHaveBeenCalledTimes(2);
    // Drain the first to avoid unhandled rejections.
    hangResolve({ data: { session: null }, error: null });
    await inflight;
    expect(second.session).not.toBeNull();
  });
});
