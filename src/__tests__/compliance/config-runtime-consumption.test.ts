/**
 * Step 4 — Configuration → runtime consumption regressions.
 *
 * Guards the gaps closed in this step:
 *  - the Legal referral wizard must evaluate `ce_legal_handoff_rules`
 *  - `ce-breach-monitor` must take its grace period from
 *    `ce_arrangement_policies`, never a hard-coded literal
 *  - the compliance feature-flag bridge must actually gate features
 *  - communication trigger rules must respect `is_active`
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

import { evaluateTriggerRules } from '@/lib/compliance/commTriggerEngine';
import { setComplianceDbFlags } from '@/lib/compliance/featureFlagCache';
import { isComplianceFeatureEnabled } from '@/lib/compliance/featureToggles';
import type { CommTriggerRule } from '@/types/commTriggerRule';

const WIZARD = readFileSync(
  'src/pages/compliance/legal/ComplianceLegalReferralWizard.tsx',
  'utf8',
);
const BREACH = readFileSync('supabase/functions/ce-breach-monitor/index.ts', 'utf8');

describe('legal handoff rules are evaluated by the referral wizard', () => {
  it('imports and calls evaluateEligibility', () => {
    expect(WIZARD).toContain('evaluateEligibility');
    expect(WIZARD).toContain('@/services/legalHandoffService');
  });

  it('blocks submission when criteria are unmet without a documented override', () => {
    expect(WIZARD).toContain('!eligibility.eligible && !handoffOverride.trim()');
    expect(WIZARD).toContain('integrationMode === "DISABLED"');
  });
});

describe('breach monitor grace period is configuration-owned', () => {
  it('reads ce_arrangement_policies', () => {
    expect(BREACH).toContain('ce_arrangement_policies');
    expect(BREACH).toContain('breach_grace_days');
  });

  it('has no hard-coded grace fallback and fails closed', () => {
    expect(BREACH).not.toContain('body.grace_days ?? 5');
    expect(BREACH).toContain('configuration_error');
  });
});

describe('compliance feature toggles gate at runtime', () => {
  beforeEach(() => setComplianceDbFlags({}));

  it('honours a disabled DB flag', () => {
    setComplianceDbFlags({ 'compliance.payment.arrangement': false });
    expect(isComplianceFeatureEnabled('arrangements.new')).toBe(false);
    setComplianceDbFlags({ 'compliance.payment.arrangement': true });
    expect(isComplianceFeatureEnabled('arrangements.new')).toBe(true);
  });
});

describe('communication trigger rules respect configuration', () => {
  const rule = (over: Partial<CommTriggerRule> = {}): CommTriggerRule =>
    ({
      id: 'r1',
      rule_code: 'R1',
      rule_name: 'Test',
      field_stage: 'visit_created',
      comm_type: 'audit_intimation',
      is_active: true,
      priority: 10,
      cooldown_hours: 0,
      max_per_visit: 0,
      condition_json: undefined,
      ...over,
    }) as unknown as CommTriggerRule;

  it('skips inactive rules and matches active ones', () => {
    expect(evaluateTriggerRules([rule()], {} as never)).toHaveLength(1);
    expect(evaluateTriggerRules([rule({ is_active: false })], {} as never)).toHaveLength(0);
  });
});
