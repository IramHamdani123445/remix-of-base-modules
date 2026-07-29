/**
 * Templates Pagination Hotfix — proves the picker helper never breaches
 * the deployed RPC bound (`1 <= p_limit <= 100`), paginates safely,
 * deduplicates, and cannot loop forever. Also confirms:
 *   - Templates admin view no longer requests p_limit=200 for events.
 *   - Events admin view is unchanged.
 *   - Template-version listing is untouched (still limit=200 allowed).
 *   - No direct table access added.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as svc from '@/platform/omni-comms/application/eventCatalogueService';

type Call = { fn: string; args: Record<string, unknown> };
const REPO_ROOT = process.cwd();

function mockClient(pages: Array<Array<{ id: string; code: string }>>) {
  const calls: Call[] = [];
  let i = 0;
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const page = pages[i] ?? [];
      i++;
      return { data: page, error: null };
    },
  };
  return { client, calls };
}

const rows = (n: number, prefix = 'r'): Array<{ id: string; code: string }> =>
  Array.from({ length: n }, (_, k) => ({
    id: `${prefix}-${String(k).padStart(4, '0')}`,
    code: `E.${prefix}.${k}`,
  }));

describe('Omni-Comms Templates picker pagination hotfix', () => {
  it('one page with fewer than 100 rows results in exactly one RPC call', async () => {
    const { client, calls } = mockClient([rows(42)]);
    const out = await svc.listAllEventDefinitionsForPicker(client);
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe('omni_comms_event_definition_list');
    expect(calls[0].args.p_limit).toBe(100);
    expect(calls[0].args.p_offset).toBe(0);
    expect(out).toHaveLength(42);
  });

  it('exactly 100 rows triggers a second page; offset increments by 100', async () => {
    const { client, calls } = mockClient([rows(100, 'a'), rows(37, 'b')]);
    const out = await svc.listAllEventDefinitionsForPicker(client);
    expect(calls).toHaveLength(2);
    expect(calls[0].args.p_offset).toBe(0);
    expect(calls[1].args.p_offset).toBe(100);
    expect(out).toHaveLength(137);
  });

  it('never requests a limit above 100 (deployed RPC bound)', async () => {
    const { client, calls } = mockClient([rows(100), rows(100), rows(50)]);
    await svc.listAllEventDefinitionsForPicker(client, { maxItems: 1000 });
    for (const c of calls) {
      expect(c.args.p_limit).toBe(100);
      expect(Number(c.args.p_limit)).toBeLessThanOrEqual(100);
    }
  });

  it('deduplicates by id across pages', async () => {
    const first = rows(100, 'x');
    const second = [...rows(50, 'x'), ...rows(10, 'y')]; // 50 dupes + 10 new
    const { client, calls } = mockClient([first, second]);
    const out = await svc.listAllEventDefinitionsForPicker(client);
    const ids = new Set(out.map((r) => r.id));
    expect(ids.size).toBe(out.length);
    expect(out).toHaveLength(110);
    expect(calls).toHaveLength(2);
  });

  it('stops at the bounded maximum', async () => {
    const pages = [rows(100, 'a'), rows(100, 'b'), rows(100, 'c'), rows(100, 'd')];
    const { client, calls } = mockClient(pages);
    const out = await svc.listAllEventDefinitionsForPicker(client, { maxItems: 250 });
    expect(out).toHaveLength(250);
    // At most ceil(250/100)+1 = 4 iterations; hitting max should short-circuit.
    expect(calls.length).toBeLessThanOrEqual(4);
  });

  it('cannot infinite-loop when server keeps returning duplicates', async () => {
    // Server pathologically returns the same 100 ids forever.
    const dup = rows(100, 'dup');
    const client = {
       
      rpc: async (_fn: string, _args: Record<string, unknown>) => ({ data: dup, error: null }),
    };
    const out = await svc.listAllEventDefinitionsForPicker(client, { maxItems: 500 });
    expect(out).toHaveLength(100);
  });

  it('preserves stable server ordering across pages', async () => {
    const p1 = rows(100, 'a');
    const p2 = rows(20, 'b');
    const { client } = mockClient([p1, p2]);
    const out = await svc.listAllEventDefinitionsForPicker(client);
    expect(out.map((r) => r.id)).toEqual([...p1, ...p2].map((r) => r.id));
  });

  it('passes status / moduleCode / search through to the RPC', async () => {
    const { client, calls } = mockClient([rows(1)]);
    await svc.listAllEventDefinitionsForPicker(client, {
      status: 'active',
      moduleCode: 'BN',
      search: 'foo',
    });
    expect(calls[0].args.p_status).toBe('active');
    expect(calls[0].args.p_module_code).toBe('BN');
    expect(calls[0].args.p_search).toBe('foo');
  });

  it('Templates page never calls listEventDefinitions with p_limit above 100', () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'src/platform/omni-comms/admin/views/OmniCommsTemplatesPage.tsx'),
      'utf8',
    );
    // Must not use the single-page loader with limit>100 for events.
    expect(src).not.toMatch(/listEventDefinitions\s*\([^)]*limit:\s*(?:1[0-9]{2}|[2-9][0-9]{2,}|[1-9][0-9]{3,})/);
    // Must use the picker helper.
    expect(src).toMatch(/listAllEventDefinitionsForPicker\s*\(/);
  });

  it('Events page is untouched — still uses listEventDefinitions with allowed limits', () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'src/platform/omni-comms/admin/views/OmniCommsEventsPage.tsx'),
      'utf8',
    );
    expect(src).toMatch(/listEventDefinitions\s*\(/);
    expect(src).not.toMatch(/listAllEventDefinitionsForPicker/);
    // Any inline limit literal must remain <= 100.
    const matches = [...src.matchAll(/listEventDefinitions\s*\(\s*client\s*,\s*\{([^}]*)\}/g)];
    for (const m of matches) {
      const lim = m[1].match(/limit:\s*(\d+)/);
      if (lim) expect(Number(lim[1])).toBeLessThanOrEqual(100);
    }
  });

  it('template-version listing may still use limit 200 (RPC contract)', () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'src/platform/omni-comms/admin/views/OmniCommsTemplatesPage.tsx'),
      'utf8',
    );
    expect(src).toMatch(/listTemplateVersions\s*\([^)]*limit:\s*200/);
  });

  it('no direct table access introduced in the modified files', () => {
    const files = [
      'src/platform/omni-comms/application/eventCatalogueService.ts',
      'src/platform/omni-comms/admin/views/OmniCommsTemplatesPage.tsx',
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
      expect(src).not.toMatch(/\.from\(\s*['"]omni_comms_event_definition['"]/);
      expect(src).not.toMatch(/\.from\(\s*['"]omni_comms_event_contract['"]/);
    }
  });

  it('existing listEventDefinitions single-page behavior is unchanged', async () => {
    const { client, calls } = mockClient([rows(3)]);
    await svc.listEventDefinitions(client, { limit: 25, offset: 10, status: 'active' });
    expect(calls[0].args).toEqual({
      p_limit: 25, p_offset: 10, p_status: 'active', p_module_code: null, p_search: null,
    });
  });
});
