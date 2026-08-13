/**
 * Omni-Comms — the simplified operator experience is a CONTRACT.
 *
 * These tests protect the promises the simplification makes: three areas,
 * every legacy tab still resolving, business wording instead of codes, and no
 * readiness counters or pilot vocabulary leaking into operator labels.
 */
import { describe, expect, it } from 'vitest';
import { OMNI_COMMS_GENERIC_TABS } from '@/platform/omni-comms/domain/channelCatalogue';
import {
  CHANNEL_SETTINGS_CARD_HINTS,
  CHANNEL_SETTINGS_CARD_LABELS,
  CHANNEL_SETTINGS_TABS,
  CHANNEL_SIMPLE_SECTIONS,
  CHANNEL_TECHNICAL_TABS,
  landingTabForSimpleSection,
  simpleSectionForTab,
  tabForHealthIndicator,
  validateChannelSimpleSectionModel,
} from '@/platform/omni-comms/admin/navigation/channelSimpleSections';
import {
  businessEventLabel,
  recipientSourceLabel,
} from '@/platform/omni-comms/domain/businessEventLabels';
import {
  HEALTH_ROW_LABEL,
  HEALTH_ROW_ORDER,
  HEALTH_ROW_PROBLEM,
} from '@/platform/omni-comms/admin/views/channels/simple/SimpleOverviewSurface';

describe('simple section model', () => {
  it('offers exactly three operator areas', () => {
    expect([...CHANNEL_SIMPLE_SECTIONS]).toEqual(['overview', 'settings', 'activity']);
  });

  it('maps every canonical tab into an area, so no deep link breaks', () => {
    expect(validateChannelSimpleSectionModel()).toEqual([]);
    for (const tab of OMNI_COMMS_GENERIC_TABS) {
      expect(CHANNEL_SIMPLE_SECTIONS).toContain(simpleSectionForTab(tab));
    }
  });

  it('folds the delivery switch and the test action into Overview', () => {
    expect(simpleSectionForTab('release-control')).toBe('overview');
    expect(simpleSectionForTab('test-centre')).toBe('overview');
  });

  it('sends configuration tabs to Settings and evidence to Activity', () => {
    for (const tab of CHANNEL_SETTINGS_TABS) {
      expect(simpleSectionForTab(tab)).toBe('settings');
    }
    expect(simpleSectionForTab('diagnostics')).toBe('activity');
  });

  it('resolves unknown or empty tabs to Overview rather than failing', () => {
    expect(simpleSectionForTab(null)).toBe('overview');
    expect(simpleSectionForTab('advanced')).toBe('overview');
  });

  it('lands each area on a canonical tab', () => {
    for (const section of CHANNEL_SIMPLE_SECTIONS) {
      expect(OMNI_COMMS_GENERIC_TABS).toContain(landingTabForSimpleSection(section));
    }
  });

  it('keeps technical tabs out of the Settings cards', () => {
    for (const tab of CHANNEL_TECHNICAL_TABS) {
      expect(CHANNEL_SETTINGS_TABS).not.toContain(tab);
    }
  });

  it('routes every health row to a remediation tab', () => {
    for (const key of HEALTH_ROW_ORDER) {
      expect(OMNI_COMMS_GENERIC_TABS).toContain(tabForHealthIndicator(key));
    }
    expect(tabForHealthIndicator('unknown')).toBe('accounts');
  });
});

describe('operator vocabulary', () => {
  const operatorText = [
    ...Object.values(CHANNEL_SETTINGS_CARD_LABELS),
    ...Object.values(CHANNEL_SETTINGS_CARD_HINTS),
    ...Object.values(HEALTH_ROW_LABEL),
    ...Object.values(HEALTH_ROW_PROBLEM),
  ];

  it('never shows pilot, fingerprint or revision wording', () => {
    for (const text of operatorText) {
      expect(text.toLowerCase()).not.toContain('pilot');
      expect(text.toLowerCase()).not.toContain('fingerprint');
      expect(text.toLowerCase()).not.toContain('revision');
      expect(text.toLowerCase()).not.toContain('idempotency');
    }
  });

  it('never shows readiness counters such as 7/7', () => {
    for (const text of operatorText) {
      expect(text).not.toMatch(/\d+\s*\/\s*\d+/);
    }
  });

  it('labels the six health rows in operator language', () => {
    expect(HEALTH_ROW_ORDER.map((k) => HEALTH_ROW_LABEL[k])).toEqual([
      'Provider',
      'Sender & domain',
      'Events & templates',
      'Automatic dispatcher',
      'Callbacks',
      'Safety',
    ]);
  });

  it('gives every health row exactly one plain problem sentence', () => {
    for (const key of HEALTH_ROW_ORDER) {
      const sentence = HEALTH_ROW_PROBLEM[key];
      expect(sentence).toBeTruthy();
      expect(sentence.split('.').filter((s) => s.trim()).length).toBe(1);
    }
  });
});

describe('business event vocabulary', () => {
  it('translates known event codes', () => {
    expect(businessEventLabel('BENEFITS.CLAIM.SUBMITTED')).toBe('Claim submitted');
    expect(businessEventLabel('BENEFITS.CLAIM.APPROVED')).toBe('Claim approved');
  });

  it('never returns a raw dotted code for an unknown event', () => {
    const label = businessEventLabel('FINANCE.INVOICE.ISSUED');
    expect(label).not.toContain('.');
    expect(label.toLowerCase()).toContain('invoice');
  });

  it('degrades safely for empty input', () => {
    expect(businessEventLabel(null)).toBe('Business event');
    expect(recipientSourceLabel(null)).toBe('Business transaction contact');
    expect(recipientSourceLabel('claimant')).toBe('Claimant');
  });
});
