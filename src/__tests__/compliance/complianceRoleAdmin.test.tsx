import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const authState: { roles: string[] } = { roles: [] };

vi.mock('@/contexts/SupabaseAuthContext', () => ({
  useSupabaseAuth: () => authState,
}));

import { useComplianceRole } from '@/hooks/useComplianceRole';

function roleFor(roles: string[]) {
  authState.roles = roles;
  return renderHook(() => useComplianceRole()).result.current;
}

describe('useComplianceRole', () => {
  beforeEach(() => {
    authState.roles = [];
  });

  it('treats platform administrators as compliance head so Assign Officer is available', () => {
    expect(roleFor(['Admin'])).toBe('head');
    expect(roleFor(['SuperAdmin'])).toBe('head');
    expect(roleFor(['System Administrator'])).toBe('head');
  });

  it('still resolves the compliance hierarchy', () => {
    expect(roleFor(['ComplianceHead'])).toBe('head');
    expect(roleFor(['SeniorInspector'])).toBe('senior');
    expect(roleFor(['ComplianceInspector'])).toBe('inspector');
  });

  it('does not grant supervisory rights to unrelated roles', () => {
    expect(roleFor(['Clerk'])).toBe('other');
    expect(roleFor([])).toBe('other');
  });
});
