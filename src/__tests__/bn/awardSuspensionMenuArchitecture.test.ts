/**
 * Award Suspension — canonical menu architecture guard.
 *
 * Ensures the static Benefits menu (used as a fallback / reference tree)
 * exposes exactly ONE entry for /bn/award-suspension, placed under
 * "Benefit Servicing", labelled "Award Suspension", and gated by the
 * granular `bn_award_suspension` module rather than broad
 * `benefits_management`.
 */
import { describe, it, expect } from 'vitest';
import { bnMenuItems } from '@/components/sidebar/menuItems/bnMenuItems';

const CANONICAL_ROUTE = '/bn/award-suspension';

interface Node {
  title?: string;
  url?: string;
  icon?: unknown;
  requiresPermission?: string;
  subItems?: Node[];
}

function flatten(nodes: Node[], parent: string | null = null): Array<{ node: Node; parent: string | null }> {
  const out: Array<{ node: Node; parent: string | null }> = [];
  for (const node of nodes) {
    out.push({ node, parent });
    if (node.subItems) out.push(...flatten(node.subItems, node.title ?? parent));
  }
  return out;
}

const all = flatten(bnMenuItems as Node[]);
const matches = all.filter((e) => e.node.url === CANONICAL_ROUTE);

describe('Award Suspension canonical menu architecture', () => {
  it('exposes exactly one menu entry for the canonical route', () => {
    expect(matches).toHaveLength(1);
  });

  it('places the entry under Benefit Servicing', () => {
    expect(matches[0]?.parent).toBe('Benefit Servicing');
  });

  it('uses the canonical singular label', () => {
    expect(matches[0]?.node.title).toBe('Award Suspension');
  });

  it('has no duplicate under Long-Term Benefits', () => {
    const longTerm = all.filter(
      (e) => e.parent === 'Long-Term Benefits' && e.node.url === CANONICAL_ROUTE,
    );
    expect(longTerm).toHaveLength(0);
  });

  it('does not register a plural "Award Suspensions" label anywhere', () => {
    expect(all.some((e) => e.node.title === 'Award Suspensions')).toBe(false);
  });

  it('gates menu visibility on the granular module, not benefits_management', () => {
    expect(matches[0]?.node.requiresPermission).toBe('bn_award_suspension');
  });

  it('never registers the same canonical route twice anywhere in the BN tree', () => {
    const urlCounts = new Map<string, number>();
    for (const { node } of all) {
      if (!node.url) continue;
      urlCounts.set(node.url, (urlCounts.get(node.url) ?? 0) + 1);
    }
    expect(urlCounts.get(CANONICAL_ROUTE)).toBe(1);
  });
});
