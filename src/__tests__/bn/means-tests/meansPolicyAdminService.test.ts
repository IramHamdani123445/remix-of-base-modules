/**
 * MEANS-TEST — policy configuration boundary guards.
 *
 * Proves that browser code never mutates `bn_means_policy*` directly and
 * that every configuration change is routed through the governed RPC with
 * optimistic concurrency and structured error mapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const rpc = vi.fn();
const getUser = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: { getUser: () => getUser() },
    from: () => {
      throw new Error('direct table access is prohibited');
    },
  },
}));

import {
  meansPolicyAdminService,
  parsePolicyError,
} from '@/services/bn/meansTests/meansPolicyAdminService';

const ACTOR = { data: { user: { id: 'a0000000-0000-4000-8000-000000000001' } } };

beforeEach(() => {
  rpc.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue(ACTOR);
});

describe('policy error mapping', () => {
  it.each([
    ['E_PERMISSION_DENIED:CREATE_POLICY', 'PERMISSION_DENIED'],
    ['E_ACTIVATION_BLOCKED:OVERLAPPING_ACTIVE_VERSION', 'ACTIVATION_BLOCKED'],
    ['E_VERSION_NOT_EDITABLE:active', 'VERSION_NOT_EDITABLE'],
    ['E_STALE_ROW_VERSION:expected=1 actual=2', 'STALE_ROW_VERSION'],
    ['boom', 'UNKNOWN'],
  ])('maps %s', (message, code) => {
    expect(parsePolicyError(message).code).toBe(code);
  });
});

describe('meansPolicyAdminService', () => {
  it('routes every configuration change through the governed RPC', async () => {
    rpc.mockResolvedValue({ data: { status: 'EXECUTED', policy_version_id: 'v1' }, error: null });
    const result = await meansPolicyAdminService.execute({
      command: 'ACTIVATE_VERSION',
      policyId: 'p1',
      policyVersionId: 'v1',
      expectedRowVersion: 3,
    });
    expect(rpc).toHaveBeenCalledWith('bn_means_policy_command_v1', expect.objectContaining({
      p_command_name: 'ACTIVATE_VERSION',
      p_policy_version_id: 'v1',
      p_expected_row_version: 3,
    }));
    expect(result.status).toBe('EXECUTED');
  });

  it('returns a structured failure instead of throwing', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'E_ACTIVATION_BLOCKED:THRESHOLD_PARAMETER_MISSING' } });
    const result = await meansPolicyAdminService.execute({ command: 'ACTIVATE_VERSION', policyVersionId: 'v1' });
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('ACTIVATION_BLOCKED');
  });

  it('refuses to call the RPC without an authenticated actor', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const result = await meansPolicyAdminService.execute({ command: 'CREATE_POLICY' });
    expect(rpc).not.toHaveBeenCalled();
    expect(result.errorCode).toBe('UNAUTHENTICATED');
  });

  it('never represents a denied read as an empty success', async () => {
    rpc.mockResolvedValue({ data: { status: 'DENIED', code: 'PERMISSION_DENIED', data: null }, error: null });
    const result = await meansPolicyAdminService.list();
    expect(result.status).toBe('DENIED');
    expect(result.data).toBeNull();
  });
});

describe('no direct browser mutation of bn_means_policy* tables', () => {
  const roots = [
    'src/services/bn/meansTests',
    'src/components/bn/meansTests',
    'src/pages/bn/meansTests',
  ];

  function walk(dir: string): string[] {
    let out: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out = out.concat(walk(full));
      else if (/\.tsx?$/.test(full)) out.push(full);
    }
    return out;
  }

  it('contains no supabase.from("bn_means_policy*") chains', () => {
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        if (/from\(\s*['"]bn_means_policy/.test(readFileSync(file, 'utf8'))) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
