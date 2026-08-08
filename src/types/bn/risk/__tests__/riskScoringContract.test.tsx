/**
 * BN Risk EPIC 2 — contract and interaction guards for scoring.
 *
 * These tests protect the rules the score depends on:
 *  - determinism and versioning are backend properties the UI must not fake
 *  - the frontend ships no rule, weight, band or threshold
 *  - scoring is never an adverse action
 *  - readiness failures fail closed
 *  - Benefit 360 never leaks a score
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  BN_RISK_SCORING_COMMANDS,
  BN_RISK_SCORING_CONFIG_COMMANDS,
  type BnRiskReviewReadiness,
  type BnRiskScoringReadiness,
} from '@/types/bn/risk/riskScoring';

const root = process.cwd();
const readSrc = (rel: string) => readFileSync(path.join(root, 'src', rel), 'utf8');

const scoringReadiness = vi.fn();
const scoreDetail = vi.fn();
const reviewReadiness = vi.fn();
const execute = vi.fn();

vi.mock('@/services/bn/risk/riskScoringService', () => ({
  riskScoringService: {
    scoringReadiness: (...a: unknown[]) => scoringReadiness(...a),
    scoreDetail: (...a: unknown[]) => scoreDetail(...a),
    reviewReadiness: (...a: unknown[]) => reviewReadiness(...a),
    scoringConfiguration: vi.fn(),
    execute: (...a: unknown[]) => execute(...a),
    executeConfig: vi.fn(),
  },
}));

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('BN Risk Epic 2 scoring command contract', () => {
  it('exposes calculation, recalculation and review completion only', () => {
    expect([...BN_RISK_SCORING_COMMANDS]).toEqual([
      'CALCULATE_SCORE',
      'RECALCULATE_SCORE',
      'COMPLETE_SCORING_REVIEW',
    ]);
  });

  it('ships no recommendation, control, hold or referral command', () => {
    const forbidden = [
      'RECOMMEND_ACTION', 'APPLY_CONTROL', 'HOLD_PAYMENT', 'SUSPEND_AWARD',
      'REFER_CASE', 'REFER_INVESTIGATION',
    ];
    const all = [...BN_RISK_SCORING_COMMANDS, ...BN_RISK_SCORING_CONFIG_COMMANDS];
    for (const command of forbidden) expect(all as string[]).not.toContain(command);
  });

  it('models the configuration lifecycle as draft, validated, active, retired', () => {
    for (const command of ['CREATE_RULE_SET_DRAFT', 'VALIDATE_RULE_SET',
      'ACTIVATE_RULE_SET', 'RETIRE_RULE_SET']) {
      expect(BN_RISK_SCORING_CONFIG_COMMANDS as readonly string[]).toContain(command);
    }
  });
});

describe('BN Risk Epic 2 frontend owns no scoring logic', () => {
  const files = [
    'types/bn/risk/riskScoring.ts',
    'services/bn/risk/riskScoringService.ts',
    'components/bn/risk/BnRiskScoringSection.tsx',
    'components/bn/risk/BnRiskAssessmentReviewSection.tsx',
    'components/bn/risk/BnRiskScoringConfigurationPanel.tsx',
  ];

  it('never sends a score, band or weight to the backend', () => {
    for (const file of files) {
      const source = readSrc(file);
      expect(source).not.toMatch(/p_score\b/);
      expect(source).not.toMatch(/p_band\b/);
      expect(source).not.toMatch(/p_contribution\b/);
    }
  });

  it('writes only through the two governed scoring RPCs', () => {
    const service = readSrc('services/bn/risk/riskScoringService.ts');
    const rpcs = [...service.matchAll(/supabase\.rpc\('([a-z0-9_]+)'/g)].map((m) => m[1]);
    for (const rpc of rpcs) {
      expect([
        'bn_risk_scoring_command_v1',
        'bn_risk_scoring_config_command_v1',
      ]).toContain(rpc);
    }
  });

  it('never touches a scoring table directly from the browser', () => {
    for (const file of files) {
      expect(readSrc(file)).not.toMatch(/\.from\(['"]bn_risk_score/);
    }
  });
});

const READY: BnRiskScoringReadiness = {
  assessment_id: 'a1',
  assessment_status: 'REVIEW',
  assessment_row_version: 3,
  can_score: true,
  score_state: 'READY_TO_SCORE',
  has_score: false,
  is_stale: false,
  blockers: [],
  warnings: [],
  input_fingerprint: 'abc123',
  active_factor_count: 4,
  outstanding_evidence_count: 0,
  open_blocking_request_count: 0,
  configuration: {
    rule_set_id: 'rs1',
    rule_set_code: 'BN_RISK_STANDARD',
    name: 'Benefits standard risk scoring',
    version_no: 1,
    status: 'ACTIVE',
    score_scale_min: 0,
    score_scale_max: 100,
    score_scale_label: null,
    effective_from: '2026-01-01T00:00:00Z',
    effective_to: null,
    rule_count: 10,
    band_count: 4,
  },
};

describe('BnRiskScoringSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scoreDetail.mockResolvedValue({ status: 'OK', data: { current_score: null, contributions: [], history: [] } });
  });

  it('fails closed when readiness cannot be read', async () => {
    scoringReadiness.mockResolvedValue({ status: 'ERROR', code: 'E_UNAVAILABLE', data: null });
    const { BnRiskScoringSection } = await import('@/components/bn/risk/BnRiskScoringSection');
    wrap(<BnRiskScoringSection assessmentId="a1" isActionEnabled={() => true} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText(/unavailable/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /calculate/i })).not.toBeInTheDocument();
  }, 20000);

  it('shows the in-force configuration version with the readiness', async () => {
    scoringReadiness.mockResolvedValue({ status: 'OK', data: READY });
    const { BnRiskScoringSection } = await import('@/components/bn/risk/BnRiskScoringSection');
    wrap(<BnRiskScoringSection assessmentId="a1" isActionEnabled={() => true} onChanged={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/Benefits standard risk scoring/)).toBeInTheDocument());
  }, 20000);

  it('offers no scoring action when the governed action is disabled', async () => {
    scoringReadiness.mockResolvedValue({ status: 'OK', data: READY });
    const { BnRiskScoringSection } = await import('@/components/bn/risk/BnRiskScoringSection');
    wrap(<BnRiskScoringSection assessmentId="a1" isActionEnabled={() => false} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Benefits standard risk scoring/)).toBeInTheDocument());
    const button = screen.queryByRole('button', { name: /calculate risk score/i });
    if (button) expect(button).toBeDisabled();
  }, 20000);
});

const REVIEW: BnRiskReviewReadiness = {
  assessment_id: 'a1',
  assessment_status: 'REVIEW',
  assessment_row_version: 3,
  can_complete_review: false,
  review_completed: false,
  blockers: ['The assessment has not been scored.'],
  warnings: [],
  summary: {
    linked_signal_count: 2,
    active_factor_count: 4,
    increasing_factor_count: 3,
    reducing_factor_count: 1,
    usable_evidence_count: 2,
    open_request_count: 0,
    score: null,
    band_label: null,
    is_stale: false,
  },
};

describe('BnRiskAssessmentReviewSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks review completion and explains why', async () => {
    reviewReadiness.mockResolvedValue({ status: 'OK', data: REVIEW });
    const { BnRiskAssessmentReviewSection } =
      await import('@/components/bn/risk/BnRiskAssessmentReviewSection');
    wrap(<BnRiskAssessmentReviewSection assessmentId="a1" isActionEnabled={() => true} onChanged={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText('The assessment has not been scored.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /complete scoring review/i })).toBeDisabled();
  });

  it('states that nothing is recommended or applied automatically', async () => {
    reviewReadiness.mockResolvedValue({ status: 'OK', data: REVIEW });
    const { BnRiskAssessmentReviewSection } =
      await import('@/components/bn/risk/BnRiskAssessmentReviewSection');
    wrap(<BnRiskAssessmentReviewSection assessmentId="a1" isActionEnabled={() => true} onChanged={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/nothing is recommended automatically/i)).toBeInTheDocument());
  });
});

describe('Benefit 360 privacy', () => {
  it('never renders a score, band or contribution', () => {
    const source = readSrc('components/bn/risk/Benefit360RiskCard.tsx');
    expect(source).not.toMatch(/score/i);
    expect(source).not.toMatch(/band/i);
  });
});
