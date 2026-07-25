import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, getUser, refreshSession } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser: vi.fn(),
  refreshSession: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession, getUser, refreshSession } },
}));
vi.mock('@/contexts/authStorage', () => ({ getPersistedSessionSnapshot: () => null }));

import { __resetRefreshCoordinatorForTests } from '@/contexts/refreshCoordinator';
import { getActionReadySession } from '@/platform/communication-hub/authSession';

const session = (token: string, remaining: number, userId = 'operator-1') => ({
  access_token: token,
  refresh_token: 'refresh',
  expires_at: Math.floor(Date.now() / 1000) + remaining,
  user: { id: userId },
});

describe('getActionReadySession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRefreshCoordinatorForTests();
  });

  it('reuses a verified token with more than 300 seconds remaining', async () => {
    const current = session('current', 600);
    getSession.mockResolvedValue({ data: { session: current }, error: null });
    getUser.mockResolvedValue({ data: { user: current.user }, error: null });
    const result = await getActionReadySession({ minValiditySeconds: 300 });
    expect(result.session).toBe(current);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('refreshes a token with fewer than 300 seconds remaining', async () => {
    const current = session('current', 120);
    const refreshed = session('refreshed', 3600);
    getSession.mockResolvedValue({ data: { session: current }, error: null });
    getUser.mockResolvedValue({ data: { user: current.user }, error: null });
    refreshSession.mockResolvedValue({ data: { session: refreshed }, error: null });
    const result = await getActionReadySession({ minValiditySeconds: 300 });
    expect(result.session.access_token).toBe('refreshed');
  });

  it('forceRefresh does not return the old token', async () => {
    const current = session('current', 1200);
    const refreshed = session('refreshed', 3600);
    getSession.mockResolvedValue({ data: { session: current }, error: null });
    refreshSession.mockResolvedValue({ data: { session: refreshed }, error: null });
    getUser.mockResolvedValue({ data: { user: current.user }, error: null });
    const result = await getActionReadySession({ forceRefresh: true });
    expect(result.session.access_token).toBe('refreshed');
  });

  it('rejects a refreshed identity mismatch', async () => {
    const current = session('current', 120, 'operator-1');
    const refreshed = session('refreshed', 3600, 'operator-2');
    getSession.mockResolvedValue({ data: { session: current }, error: null });
    refreshSession.mockResolvedValue({ data: { session: refreshed }, error: null });
    getUser
      .mockResolvedValueOnce({ data: { user: current.user }, error: null })
      .mockResolvedValueOnce({ data: { user: refreshed.user }, error: null });
    await expect(getActionReadySession()).rejects.toMatchObject({ code: 'OPERATOR_IDENTITY_MISMATCH' });
  });
});