/**
 * BN Risk / Fraud — EPIC 6 certification: rule feedback, operational
 * management and reporting.
 *
 * These tests prove the governance contract rather than re-testing React:
 *   1. the canonical command is implemented and is the only feedback command;
 *   2. feedback never changes scoring configuration;
 *   3. feedback is immutable — corrections supersede, never edit;
 *   4. rule effectiveness is version aware;
 *   5. reporting is aggregate, backend-owned and fails closed;
 *   6. no Risk surface aggregates counts or derives ageing in the browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BN_RISK_CANONICAL_COMMANDS } from '@/types/bn/risk/riskCanonicalCommands';
import {
  BN_RISK_FEEDBACK_COMMANDS,
  BN_RISK_FEEDBACK_SUPPORTING_OPERATIONS,
  feedbackClassificationLabel,
  feedbackTargetLabel,
} from '@/types/bn/risk/riskFeedback';
import { BN_RISK_REPORT_PERIODS } from '@/types/bn/risk/riskReporting';

const ROOT = process.cwd();

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function migrationText(): string {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
}

const SQL = migrationText();

describe('Epic 6 — canonical command', () => {
  it('implements BN_RISK_UPDATE_RULE_FEEDBACK as the only feedback command', () => {
    const spec = BN_RISK_CANONICAL_COMMANDS
      .find((c) => c.command === 'BN_RISK_UPDATE_RULE_FEEDBACK');
    expect(spec).toBeDefined();
    expect(spec?.implemented).toBe(true);
    expect(spec?.capability).toBe('bn_risk_management:rule_admin');
    expect(BN_RISK_FEEDBACK_COMMANDS).toEqual(['BN_RISK_UPDATE_RULE_FEEDBACK']);
  });

  it('invents no second canonical command for reporting', () => {
    const canonical = BN_RISK_CANONICAL_COMMANDS.map((c) => c.command);
    expect(canonical).toHaveLength(18);
    for (const name of canonical) {
      expect(name).not.toMatch(/REPORT|METRIC|DASHBOARD/);
    }
  });

  it('records a correction as a supporting operation, not a canonical command', () => {
    expect(BN_RISK_FEEDBACK_SUPPORTING_OPERATIONS)
      .toEqual(['BN_RISK_OP_CORRECT_RULE_FEEDBACK']);
    expect(BN_RISK_CANONICAL_COMMANDS.map((c) => c.command))
      .not.toContain('BN_RISK_OP_CORRECT_RULE_FEEDBACK');
  });
});

describe('Epic 6 — backend boundary', () => {
  it('creates the governed feedback catalogue and record', () => {
    expect(SQL).toContain('CREATE TABLE IF NOT EXISTS public.bn_risk_rule_feedback_type');
    expect(SQL).toContain('CREATE TABLE IF NOT EXISTS public.bn_risk_rule_feedback');
    expect(SQL).toContain('bn_risk_rule_feedback_readiness_v1');
    expect(SQL).toContain('bn_risk_rule_feedback_command_v1');
  });

  it('registers the rule_admin permission rather than reusing write', () => {
    expect(SQL).toContain("'rule_admin'");
    expect(SQL).toContain("public._bn_risk_require(p_actor_user_id,'rule_admin',true)");
  });

  it('protects the command with replay and duplicate protection', () => {
    expect(SQL).toContain('E_IDEMPOTENCY_PAYLOAD_MISMATCH');
    expect(SQL).toContain('E_DUPLICATE_FEEDBACK');
    expect(SQL).toContain('bn_risk_rule_feedback_dedupe_uq');
  });

  it('binds feedback to the rule version that produced the score', () => {
    expect(SQL).toContain('E_INVALID_RULE_REFERENCE');
    expect(SQL).toContain('rule_set_version_no');
    expect(SQL).toContain('score_version_no');
  });

  it('supersedes rather than edits when feedback is corrected', () => {
    expect(SQL).toContain("SET status = 'SUPERSEDED', superseded_at = now()");
    expect(SQL).toContain('supersedes_feedback_id');
    expect(SQL).toContain('superseded_by_feedback_id');
  });

  it('declares that feedback has no scoring effect', () => {
    expect(SQL).toContain("'scoring_effect','NONE'");
    expect(SQL).toContain('RULE_FEEDBACK_RECORDED');
    expect(SQL).toContain('RULE_FEEDBACK_CORRECTED');
  });

  it('never activates, versions or rescores from the feedback command', () => {
    const start = SQL.indexOf('FUNCTION public.bn_risk_rule_feedback_command_v1');
    const body = SQL.slice(start, SQL.indexOf('GRANT EXECUTE ON FUNCTION public.bn_risk_rule_feedback_command_v1'));
    expect(body).not.toContain('UPDATE public.bn_risk_scoring_rule');
    expect(body).not.toContain('UPDATE public.bn_risk_scoring_rule_set');
    expect(body).not.toContain('INSERT INTO public.bn_risk_score');
    expect(body).not.toContain('bn_risk_scoring_command_v1');
  });

  it('publishes governed reporting reads', () => {
    for (const rpc of [
      'bn_risk_operational_metrics_v1',
      'bn_risk_outcome_metrics_v1',
      'bn_risk_rule_feedback_metrics_v1',
    ]) {
      expect(SQL).toContain(`FUNCTION public.${rpc}`);
    }
  });

  it('states the ageing definition and does not invent a service level', () => {
    expect(SQL).toContain("'sla_configured', false");
    expect(SQL).toContain('No governed Risk service-level policy is configured');
  });

  it('restricts rule effectiveness to rule administrators', () => {
    const start = SQL.indexOf('FUNCTION public.bn_risk_rule_feedback_metrics_v1');
    const body = SQL.slice(start);
    expect(body).toContain("'PERMISSION_DENIED'");
  });
});

describe('Epic 6 — surfaces', () => {
  const SECTION = readSrc('src/components/bn/risk/BnRiskRuleFeedbackSection.tsx');
  const DIALOG = readSrc('src/components/bn/risk/BnRiskRuleFeedbackDialog.tsx');
  const OPS = readSrc('src/components/bn/risk/BnRiskOperationsDashboard.tsx');
  const REPORT = readSrc('src/components/bn/risk/BnRiskReportingPanel.tsx');
  const SERVICE = readSrc('src/services/bn/risk/riskFeedbackService.ts');
  const REPORT_SERVICE = readSrc('src/services/bn/risk/riskReportingService.ts');

  it('drives the feedback surface entirely from readiness', () => {
    expect(SECTION).toContain('bn_risk_rule_feedback_readiness_v1'.length ? 'feedbackReadiness' : '');
    expect(SECTION).toContain('data.can_record_feedback');
    expect(SECTION).toContain('data.can_correct_feedback');
  });

  it('fails closed when feedback eligibility cannot be read', () => {
    expect(SECTION).toContain('FAILED_TO_LOAD');
    expect(SECTION).toContain('this does not mean feedback is allowed');
  });

  it('tells the user plainly that feedback changes no scoring', () => {
    expect(SECTION).toContain('Feedback does not change scoring');
    expect(DIALOG).toContain('changes no scoring rule');
  });

  it('offers no rule-editing action from the feedback surface', () => {
    for (const src of [SECTION, DIALOG]) {
      expect(src).not.toContain('activateRuleSet');
      expect(src).not.toContain('riskScoringService');
      expect(src).not.toContain('recalculate');
    }
  });

  it('never aggregates operational figures in the browser', () => {
    for (const src of [OPS, REPORT]) {
      expect(src).not.toMatch(/\.reduce\(/);
      expect(src).not.toMatch(/\.filter\([^)]*\)\.length/);
    }
    expect(OPS).toContain('riskReportingService.operationalMetrics');
    expect(REPORT).toContain('riskReportingService.outcomeMetrics');
    expect(REPORT).toContain('riskReportingService.feedbackMetrics');
  });

  it('never renders a failed read as an empty queue', () => {
    expect(OPS).toContain('would not mean there is no work outstanding');
    expect(REPORT).toContain('This does not mean no feedback');
  });

  it('deep links every operational card to the queue that owns the work', () => {
    expect(OPS).toContain('onOpenQueue(card.queue_key)');
  });

  it('keeps reporting free of claimant identity', () => {
    for (const src of [OPS, REPORT]) {
      expect(src).not.toContain('person_ssn');
      expect(src).not.toContain('person_name');
    }
  });

  it('routes every mutation through the governed command RPC', () => {
    expect(SERVICE).toContain('bn_risk_rule_feedback_command_v1');
    expect(SERVICE).toContain('computePayloadHash');
    expect(SERVICE.match(/supabase\.rpc\(/g) ?? []).toHaveLength(2);
    expect(REPORT_SERVICE).not.toContain('from(');
  });
});

describe('Epic 6 — presentation contracts', () => {
  it('labels every governed classification in plain language', () => {
    expect(feedbackClassificationLabel('FALSE_POSITIVE')).toBe('False positive');
    expect(feedbackClassificationLabel('SENSITIVITY')).toBe('Sensitivity concern');
    expect(feedbackClassificationLabel(null)).toBe('Not classified');
  });

  it('labels every feedback target', () => {
    expect(feedbackTargetLabel('RULE')).toBe('Scoring rule');
    expect(feedbackTargetLabel('SIGNAL')).toBe('Signal');
    expect(feedbackTargetLabel('FACTOR')).toBe('Factor');
    expect(feedbackTargetLabel('ASSESSMENT')).toBe('Assessment');
  });

  it('offers only governed reporting periods', () => {
    expect(BN_RISK_REPORT_PERIODS.map((p) => p.code))
      .toEqual(['TODAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'QUARTER']);
  });
});
