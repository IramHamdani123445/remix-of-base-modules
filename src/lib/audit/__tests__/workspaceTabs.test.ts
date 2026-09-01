/**
 * IA Phase-C — F-01/F-02 workspace tab vocabulary certification.
 * Locks the canonical tab counts frozen in Phase A (Plan 10 / Engagement 14)
 * and the normalization contract behind ?tab= deep links.
 */
import { describe, it, expect } from 'vitest';
import {
  PLAN_WORKSPACE_TABS,
  ENGAGEMENT_WORKSPACE_TABS,
  ENGAGEMENT_MANAGEMENT_TABS,
  DEFAULT_TAB,
  isValidTab,
  normalizeTab,
} from '../workspaceTabs';

describe('IA workspace tab vocabularies', () => {
  it('freezes the certified Plan workspace tab count and order', () => {
    expect(PLAN_WORKSPACE_TABS).toEqual([
      'overview',
      'portfolio',
      'engagements',
      'coverage',
      'capacity',
      'autoplan',
      'approval',
      'boardpack',
      'distribution',
      'closure',
    ]);
    expect(PLAN_WORKSPACE_TABS).toHaveLength(10);
  });

  it('freezes the certified Engagement workspace tab count and order', () => {
    expect(ENGAGEMENT_WORKSPACE_TABS).toEqual([
      'overview',
      'preparation',
      'programme',
      'activities',
      'control-tests',
      'evidence',
      'working-papers',
      'findings',
      'responses',
      'actions',
      'follow-ups',
      'quality-review',
      'timeline',
      'closure',
    ]);
    expect(ENGAGEMENT_WORKSPACE_TABS).toHaveLength(14);
  });

  it('has no duplicate tab keys in either vocabulary', () => {
    expect(new Set(PLAN_WORKSPACE_TABS).size).toBe(PLAN_WORKSPACE_TABS.length);
    expect(new Set(ENGAGEMENT_WORKSPACE_TABS).size).toBe(ENGAGEMENT_WORKSPACE_TABS.length);
  });

  it('restricts the management respondent surface to non-privileged tabs', () => {
    for (const tab of ENGAGEMENT_MANAGEMENT_TABS) {
      expect(ENGAGEMENT_WORKSPACE_TABS).toContain(tab);
    }
    // Audit-only surfaces must never be exposed to the audited department.
    for (const privileged of ['evidence', 'working-papers', 'quality-review', 'closure', 'programme']) {
      expect(ENGAGEMENT_MANAGEMENT_TABS).not.toContain(privileged as never);
    }
  });
});

describe('tab normalization contract', () => {
  it('accepts every canonical tab', () => {
    for (const tab of [...PLAN_WORKSPACE_TABS, ...ENGAGEMENT_WORKSPACE_TABS]) {
      expect(isValidTab([...PLAN_WORKSPACE_TABS, ...ENGAGEMENT_WORKSPACE_TABS], tab)).toBe(true);
    }
  });

  it('falls back to overview for unknown, empty and null tab values', () => {
    for (const bad of ['zzz-invalid', '', null, undefined, 'Overview', 'OVERVIEW']) {
      expect(normalizeTab(PLAN_WORKSPACE_TABS, bad as string | null)).toBe(DEFAULT_TAB);
    }
  });

  it('honours an explicit fallback when supplied', () => {
    expect(normalizeTab(ENGAGEMENT_WORKSPACE_TABS, 'nope', 'findings')).toBe('findings');
  });

  it('does not leak values across vocabularies', () => {
    // "portfolio" is a Plan-only tab and must not resolve inside the engagement workspace.
    expect(normalizeTab(ENGAGEMENT_WORKSPACE_TABS, 'portfolio')).toBe(DEFAULT_TAB);
    // "evidence" is an Engagement-only tab and must not resolve inside the plan workspace.
    expect(normalizeTab(PLAN_WORKSPACE_TABS, 'evidence')).toBe(DEFAULT_TAB);
  });
});
