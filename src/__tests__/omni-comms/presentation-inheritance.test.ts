/**
 * Omni-Comms — enterprise presentation inheritance contract.
 *
 * These assertions mirror, one-for-one, the database resolver
 * `omni_comms_resolve_presentation` (candidate matching + scope precedence).
 * The Benefits reference proof at the bottom uses the same configuration that
 * is seeded in the live database.
 */
import { describe, expect, it } from 'vitest';
import {
  candidateApplies,
  isValidScopeCombination,
  resolvePresentation,
  resolveProperty,
  scopeLabel,
  scopeLevel,
  scopeRank,
  type PresentationCandidate,
} from '@/platform/omni-comms/domain/presentationScope';

const CLAIMS = 'dept-claims';
const REGISTRY = 'dept-registry';

const cand = (
  property: string,
  value: string,
  keys: Partial<PresentationCandidate> = {},
): PresentationCandidate => ({
  property,
  value,
  moduleCode: keys.moduleCode ?? null,
  departmentId: keys.departmentId ?? null,
  eventCode: keys.eventCode ?? null,
  updatedAt: keys.updatedAt ?? '2026-01-01T00:00:00Z',
});

describe('scope precedence', () => {
  it('orders specificity: dept×module×event > module×event > dept×module > dept > module > org', () => {
    const ordered = [
      { moduleCode: 'BENEFITS', departmentId: CLAIMS, eventCode: 'E' },
      { moduleCode: 'BENEFITS', eventCode: 'E' },
      { moduleCode: 'BENEFITS', departmentId: CLAIMS },
      { departmentId: CLAIMS },
      { moduleCode: 'BENEFITS' },
      {},
    ];
    const ranks = ordered.map(scopeRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    expect(scopeLevel(ordered[0])).toBe('department_module_event');
    expect(scopeLevel(ordered[5])).toBe('organization');
    expect(scopeLabel('department_module')).toBe('Department × Module');
  });

  it('rejects an event scope that does not name a module', () => {
    expect(isValidScopeCombination({ eventCode: 'E' })).toBe(false);
    expect(isValidScopeCombination({ eventCode: 'E', moduleCode: 'BENEFITS' })).toBe(true);
  });

  it('treats scope keys as additive filters, never OR', () => {
    const c = { moduleCode: 'BENEFITS', departmentId: CLAIMS };
    expect(candidateApplies(c, { moduleCode: 'BENEFITS', departmentId: CLAIMS })).toBe(true);
    expect(candidateApplies(c, { moduleCode: 'LEGAL', departmentId: CLAIMS })).toBe(false);
    expect(candidateApplies(c, { moduleCode: 'BENEFITS', departmentId: REGISTRY })).toBe(false);
  });
});

describe('layout inheritance', () => {
  const candidates = [
    cand('layout', 'A'),
    cand('layout', 'B', { moduleCode: 'BENEFITS' }),
    cand('layout', 'C', { moduleCode: 'BENEFITS', departmentId: CLAIMS }),
    cand('layout', 'D', {
      moduleCode: 'BENEFITS',
      departmentId: CLAIMS,
      eventCode: 'BENEFITS.CLAIM.APPROVED',
    }),
  ];

  it('organisation default applies when no override exists', () => {
    const r = resolveProperty('layout', candidates, { moduleCode: 'LEGAL', departmentId: REGISTRY });
    expect(r.value).toBe('A');
    expect(r.source).toBe('organization');
  });

  it('module override beats organisation', () => {
    const r = resolveProperty('layout', candidates, {
      moduleCode: 'BENEFITS',
      departmentId: REGISTRY,
    });
    expect(r.value).toBe('B');
    expect(r.source).toBe('module');
  });

  it('department × module beats module', () => {
    const r = resolveProperty('layout', candidates, {
      moduleCode: 'BENEFITS',
      departmentId: CLAIMS,
      eventCode: 'BENEFITS.CLAIM.SUBMITTED',
    });
    expect(r.value).toBe('C');
    expect(r.source).toBe('department_module');
  });

  it('department × module does not leak into another module', () => {
    const r = resolveProperty('layout', candidates, { moduleCode: 'LEGAL', departmentId: CLAIMS });
    expect(r.value).toBe('A');
  });

  it('event override beats department × module', () => {
    const r = resolveProperty('layout', candidates, {
      moduleCode: 'BENEFITS',
      departmentId: CLAIMS,
      eventCode: 'BENEFITS.CLAIM.APPROVED',
    });
    expect(r.value).toBe('D');
    expect(r.source).toBe('department_module_event');
  });

  it('event override does not affect another event', () => {
    const r = resolveProperty('layout', candidates, {
      moduleCode: 'BENEFITS',
      departmentId: CLAIMS,
      eventCode: 'BENEFITS.CLAIM.REJECTED',
    });
    expect(r.value).toBe('C');
  });

  it('resetting an override returns the inherited value', () => {
    const afterReset = candidates.filter((c) => c.value !== 'D');
    const r = resolveProperty('layout', afterReset, {
      moduleCode: 'BENEFITS',
      departmentId: CLAIMS,
      eventCode: 'BENEFITS.CLAIM.APPROVED',
    });
    expect(r.value).toBe('C');
    expect(r.source).toBe('department_module');
  });

  it('honours a governed pin above every inherited value', () => {
    const r = resolveProperty('layout', candidates, {
      moduleCode: 'BENEFITS',
      departmentId: CLAIMS,
      eventCode: 'BENEFITS.CLAIM.APPROVED',
    }, { pinnedValue: 'PINNED' });
    expect(r.value).toBe('PINNED');
    expect(r.source).toBe('pinned');
  });
});

describe('per-property inheritance', () => {
  it('resolves each property independently from a different level', () => {
    const candidates = [
      cand('layout', 'layout-event', {
        moduleCode: 'BENEFITS',
        departmentId: CLAIMS,
        eventCode: 'BENEFITS.CLAIM.APPROVED',
      }),
      cand('logo', 'org-logo'),
      cand('signature', 'benefits-signature', { moduleCode: 'BENEFITS' }),
      cand('footer', 'claims-benefits-footer', { moduleCode: 'BENEFITS', departmentId: CLAIMS }),
      cand('disclaimer', 'event-disclaimer', {
        moduleCode: 'BENEFITS',
        departmentId: CLAIMS,
        eventCode: 'BENEFITS.CLAIM.APPROVED',
      }),
    ];
    const resolved = resolvePresentation(
      ['layout', 'logo', 'signature', 'footer', 'disclaimer', 'watermark'],
      candidates,
      {
        moduleCode: 'BENEFITS',
        departmentId: CLAIMS,
        eventCode: 'BENEFITS.CLAIM.APPROVED',
      },
    );
    expect(resolved.map((r) => [r.property, r.source])).toEqual([
      ['layout', 'department_module_event'],
      ['logo', 'organization'],
      ['signature', 'module'],
      ['footer', 'department_module'],
      ['disclaimer', 'department_module_event'],
      ['watermark', 'unresolved'],
    ]);
  });
});

describe('Benefits reference proof (matches seeded database configuration)', () => {
  const A = 'OMNI_SYNTHETIC_EMAIL_PILOT';
  const B = 'BASE_EMAIL_GOVERNMENT';
  const C = 'BASE_EMAIL_MINIMAL';
  const D = 'BASE_EMAIL_LEGAL';
  const BENEFITS_DEPT = 'c28f40f8-00db-4766-b211-5bda5dd641a9';
  const OTHER_DEPT = '7fe102d5-31ed-4319-a75e-3e3e257605b5';

  const candidates = [
    cand('layout', A),
    cand('layout', B, { moduleCode: 'BENEFITS' }),
    cand('layout', C, { moduleCode: 'BENEFITS', departmentId: BENEFITS_DEPT }),
    cand('layout', D, {
      moduleCode: 'BENEFITS',
      departmentId: BENEFITS_DEPT,
      eventCode: 'BENEFITS.CLAIM.APPROVED',
    }),
  ];
  const layoutFor = (ctx: Parameters<typeof resolveProperty>[2]) =>
    resolveProperty('layout', candidates, ctx).value;

  it('normal Benefits claims-department event resolves to C', () => {
    expect(
      layoutFor({
        moduleCode: 'BENEFITS',
        departmentId: BENEFITS_DEPT,
        eventCode: 'BENEFITS.CLAIM.SUBMITTED',
      }),
    ).toBe(C);
  });

  it('CLAIM.APPROVED resolves to D', () => {
    expect(
      layoutFor({
        moduleCode: 'BENEFITS',
        departmentId: BENEFITS_DEPT,
        eventCode: 'BENEFITS.CLAIM.APPROVED',
      }),
    ).toBe(D);
  });

  it('another Benefits department resolves to B', () => {
    expect(
      layoutFor({
        moduleCode: 'BENEFITS',
        departmentId: OTHER_DEPT,
        eventCode: 'BENEFITS.CLAIM.APPROVED',
      }),
    ).toBe(B);
  });

  it('another module using the same department resolves to A', () => {
    expect(
      layoutFor({
        moduleCode: 'LEGAL',
        departmentId: BENEFITS_DEPT,
        eventCode: 'LEGAL.NOTICE.ISSUED',
      }),
    ).toBe(A);
  });
});
