/**
 * BN Risk / Fraud — EPIC 3 certification suite.
 *
 * Control recommendation and independent approval. Every test here proves a
 * governed property of the delivered Epic 3 boundary:
 *
 *  - recommendation availability comes from `bn_risk_recommendation_readiness_v1`
 *  - the control catalogue is backend reference data, never a React duplicate
 *  - no score or band is ever converted into a control, a decision or an action
 *  - recommendations are immutable cycles bound to the exact score used
 *  - maker-checker and staleness are enforced by the backend, not by hiding buttons
 *  - approval authorises a control; Epic 3 executes nothing
 *  - ordinary surfaces never leak control, decision, score, band or referral intent
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'node:fs';
import path from 'node:path';
import {
  BN_RISK_CONTROL_COMMANDS,
  BN_RISK_CONTROL_DECISIONS,
  controlExecutionNotice,
  type BnRiskControlApprovalQueue,
  type BnRiskControlApprovalReadiness,
  type BnRiskControlType,
  type BnRiskRecommendation,
  type BnRiskRecommendationHistory,
  type BnRiskRecommendationReadiness,
} from '@/types/bn/risk/riskControl';

/* ------------------------------------------------------------------ */
/* Supabase boundary mock — the only route Epic 3 may take             */
/* ------------------------------------------------------------------ */

const rpc = vi.fn();
const from = vi.fn((..._args: unknown[]) => {
  throw new Error('Epic 3 must never touch a table directly from the browser');
});
const getUser = vi.fn(async () => ({ data: { user: { id: 'officer-1', email: 'o@ssb.kn' } } }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(args[0], args[1]),
    from: (...args: unknown[]) => from(args[0]),
    auth: { getUser: () => getUser() },
  },
}));

const SRC = path.resolve(__dirname, '../../../');
const readSrc = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const EPIC3_SOURCES = [
  'types/bn/risk/riskControl.ts',
  'services/bn/risk/riskControlService.ts',
  'components/bn/risk/BnRiskRecommendationSection.tsx',
  'components/bn/risk/BnRiskRecommendationDialog.tsx',
  'components/bn/risk/BnRiskControlApprovalSection.tsx',
  'components/bn/risk/BnRiskControlDecisionDialog.tsx',
  'components/bn/risk/BnRiskControlApprovalQueue.tsx',
];

/* ------------------------------------------------------------------ */
/* Fixtures — shaped exactly like the governed readiness contracts     */
/* ------------------------------------------------------------------ */

const PAYMENT_HOLD: BnRiskControlType = {
  control_code: 'TEMPORARY_PAYMENT_HOLD',
  label: 'Temporary payment hold',
  description: 'Hold the next payment while the concern is resolved.',
  control_class: 'PAYMENT',
  is_benefit_affecting: true,
  requires_independent_approval: true,
  requires_justification: true,
  requires_effective_period: true,
  requires_target: true,
  allowed_target_types: ['AWARD'],
  requires_supporting_evidence: true,
  execution_owner: 'Payments',
  execution_boundary: 'Executed by a later governed step',
  is_active: true,
  sort_order: 10,
};

const ENHANCED_VERIFICATION: BnRiskControlType = {
  control_code: 'ENHANCED_VERIFICATION',
  label: 'Enhanced verification',
  description: 'Require additional verification before the next payment.',
  control_class: 'VERIFICATION',
  is_benefit_affecting: false,
  requires_independent_approval: true,
  requires_justification: true,
  requires_effective_period: false,
  requires_target: false,
  allowed_target_types: [],
  requires_supporting_evidence: false,
  execution_owner: 'Benefits',
  execution_boundary: 'Executed by a later governed step',
  is_active: true,
  sort_order: 20,
};

function readiness(
  overrides: Partial<BnRiskRecommendationReadiness> = {},
): BnRiskRecommendationReadiness {
  return {
    assessment_id: 'a1',
    assessment_status: 'RECOMMENDATION',
    assessment_row_version: 7,
    can_recommend: true,
    blockers: [],
    warnings: [],
    has_pending_recommendation: false,
    pending_recommendation_id: null,
    score: {
      score_id: 's1',
      score: 72,
      version_no: 2,
      band_code: 'HIGH',
      band_label: 'High concern',
      rule_set_code: 'BN_RISK_STANDARD',
      rule_set_version_no: 3,
      is_stale: false,
    },
    control_options: [PAYMENT_HOLD, ENHANCED_VERIFICATION],
    reason_options: [{ code: 'EVIDENCE_SUPPORTS_CONTROL', label: 'Evidence supports the control' }],
    supporting_factors: [
      { factor_id: 'f1', factor_reference: 'F-1', label: 'Undeclared employment', direction_code: 'INCREASES_CONCERN', summary: null },
      { factor_id: 'f2', factor_reference: 'F-2', label: 'Consistent declarations', direction_code: 'REDUCES_CONCERN', summary: null },
    ],
    supporting_evidence: [{ evidence_link_id: 'e1', label: 'Employer record', usability_code: 'USABLE' }],
    ...overrides,
  };
}

function recommendation(overrides: Partial<BnRiskRecommendation> = {}): BnRiskRecommendation {
  return {
    recommendation_id: 'r1',
    recommendation_reference: 'REC-0001',
    assessment_id: 'a1',
    cycle_no: 1,
    assessment_row_version: 7,
    score_id: 's1',
    score_version_no: 2,
    score: 72,
    band_code: 'HIGH',
    band_label: 'High concern',
    rule_set_code: 'BN_RISK_STANDARD',
    rule_set_version_no: 3,
    input_fingerprint: 'fp-abc',
    control_code: 'TEMPORARY_PAYMENT_HOLD',
    control_label: 'Temporary payment hold',
    control_class: 'PAYMENT',
    is_benefit_affecting: true,
    target_type: 'AWARD',
    target_id: 'aw-1',
    target_reference: 'AW-1001',
    reason_code: 'EVIDENCE_SUPPORTS_CONTROL',
    reason_label: 'Evidence supports the control',
    justification: 'Employer records contradict the declared position.',
    requested_effective_from: '2026-09-01',
    requested_effective_to: null,
    scope_note: null,
    supporting_factor_ids: ['f1'],
    supporting_evidence_ids: ['e1'],
    recommended_by_user_id: 'officer-1',
    recommended_by_name: 'A. Officer',
    recommended_at: '2026-08-01T09:00:00Z',
    status: 'PENDING_APPROVAL',
    execution_state: 'NOT_AUTHORISED',
    decision: null,
    decided_at: null,
    decided_by_name: null,
    row_version: 1,
    ...overrides,
  };
}

function approvalReadiness(
  overrides: Partial<BnRiskControlApprovalReadiness> = {},
): BnRiskControlApprovalReadiness {
  return {
    assessment_id: 'a1',
    assessment_status: 'PENDING_CONTROL_APPROVAL',
    assessment_row_version: 7,
    state: 'READY_TO_DECIDE',
    can_decide: true,
    can_approve: true,
    can_reject: true,
    can_return: true,
    is_self_recommendation: false,
    is_stale: false,
    blockers: [],
    warnings: [],
    recommendation_id: 'r1',
    recommendation_row_version: 1,
    decision_options: [
      { decision: 'APPROVE', label: 'Approve' },
      { decision: 'REJECT', label: 'Reject' },
      { decision: 'RETURN_FOR_REVIEW', label: 'Return for review' },
    ],
    reason_options: [{ code: 'PROPORTIONATE', label: 'Proportionate to the evidence' }],
    ...overrides,
  };
}

function history(
  current: BnRiskRecommendation | null,
  cycles: BnRiskRecommendationHistory['cycles'] = [],
): BnRiskRecommendationHistory {
  return { assessment_id: 'a1', current, cycles };
}

/* ------------------------------------------------------------------ */
/* Service-level harness on the governed RPC boundary                  */
/* ------------------------------------------------------------------ */

type RpcHandler = (name: string, args: Record<string, unknown>) => unknown;

function withRpc(handler: RpcHandler) {
  rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    try {
      return { data: handler(name, args), error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  });
}

function ok(data: unknown) {
  return { status: 'OK', data };
}

async function service() {
  return (await import('@/services/bn/risk/riskControlService')).riskControlService;
}

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Renders the recommendation section against governed readiness + history. */
async function renderRecommendation(opts: {
  readiness?: BnRiskRecommendationReadiness | 'ERROR' | 'DENIED';
  history?: BnRiskRecommendationHistory;
  actionEnabled?: boolean;
}) {
  const r = opts.readiness ?? readiness();
  withRpc((name) => {
    if (name === 'bn_risk_recommendation_readiness_v1') {
      if (r === 'ERROR') return { status: 'ERROR', code: 'E_UNAVAILABLE', data: null };
      if (r === 'DENIED') return { status: 'DENIED', code: 'PERMISSION_DENIED', data: null };
      return ok(r);
    }
    if (name === 'bn_risk_recommendation_history_v1') {
      return ok(opts.history ?? history(null));
    }
    return ok(null);
  });
  const { BnRiskRecommendationSection } = await import(
    '@/components/bn/risk/BnRiskRecommendationSection'
  );
  return wrap(
    <BnRiskRecommendationSection
      assessmentId="a1"
      isActionEnabled={() => opts.actionEnabled ?? true}
      targetOptions={[{ type: 'AWARD', id: 'aw-1', reference: 'AW-1001', label: 'Award AW-1001' }]}
      onChanged={() => {}}
    />,
  );
}

async function renderApproval(opts: {
  readiness?: BnRiskControlApprovalReadiness | 'ERROR';
  history?: BnRiskRecommendationHistory;
  actionEnabled?: boolean;
}) {
  const r = opts.readiness ?? approvalReadiness();
  withRpc((name) => {
    if (name === 'bn_risk_control_approval_readiness_v1') {
      if (r === 'ERROR') return { status: 'ERROR', code: 'E_UNAVAILABLE', data: null };
      return ok(r);
    }
    if (name === 'bn_risk_recommendation_history_v1') {
      const rec = recommendation();
      return ok(opts.history ?? history(rec, [{ recommendation: rec, decisions: [] }]));
    }
    return ok(null);
  });
  const { BnRiskControlApprovalSection } = await import(
    '@/components/bn/risk/BnRiskControlApprovalSection'
  );
  return wrap(
    <BnRiskControlApprovalSection
      assessmentId="a1"
      assessmentReference="RA-0001"
      personName="J. Person"
      isActionEnabled={() => opts.actionEnabled ?? true}
      onChanged={() => {}}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: 'officer-1', email: 'o@ssb.kn' } } });
});

/* ================================================================== */
/* 1. Recommendation readiness                                        */
/* ================================================================== */

describe('Epic 3 — recommendation readiness is governed by the backend', () => {
  const blockedCases: Array<[string, BnRiskRecommendationReadiness]> = [
    [
      'assessment is not at the recommendation stage',
      readiness({
        assessment_status: 'REVIEW',
        can_recommend: false,
        blockers: ['The assessment is not at the recommendation stage.'],
      }),
    ],
    [
      'the scoring review has not been completed',
      readiness({
        can_recommend: false,
        blockers: ['The scoring review has not been completed.'],
      }),
    ],
    [
      'there is no current risk score',
      readiness({
        can_recommend: false,
        blockers: ['There is no current risk score.'],
        score: { ...readiness().score, score_id: null, score: null, band_code: null, band_label: null },
      }),
    ],
    [
      'the risk score is out of date',
      readiness({
        can_recommend: false,
        blockers: ['The risk score is out of date and must be recalculated.'],
        score: { ...readiness().score, is_stale: true },
      }),
    ],
    [
      'a blocking information request is open',
      readiness({
        can_recommend: false,
        blockers: ['An information request is still outstanding.'],
      }),
    ],
  ];

  it.each(blockedCases)('blocks the recommendation when %s', async (_label, fixture) => {
    await renderRecommendation({ readiness: fixture });
    const button = await screen.findByRole('button', { name: /recommend control/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(fixture.blockers[0])).toBeInTheDocument();
  }, 20000);

  it('permits a recommendation when the score is current and reviewed', async () => {
    await renderRecommendation({});
    const button = await screen.findByRole('button', { name: /recommend control/i });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByTestId('bn-risk-recommendation-section')).toHaveAttribute(
      'data-state',
      'READY',
    );
  });

  it('fails closed and offers no action when readiness cannot be read', async () => {
    await renderRecommendation({ readiness: 'ERROR' });
    expect(await screen.findByText(/readiness is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /recommend control/i })).not.toBeInTheDocument();
  });

  it('fails closed when the actor is denied the readiness read', async () => {
    await renderRecommendation({ readiness: 'DENIED' });
    expect(await screen.findByText(/readiness is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /recommend control/i })).not.toBeInTheDocument();
  });

  it('honours the governed action contract even when readiness allows it', async () => {
    await renderRecommendation({ actionEnabled: false });
    const button = await screen.findByRole('button', { name: /recommend control/i });
    expect(button).toBeDisabled();
  });
});

/* ================================================================== */
/* 2. Explicit human control selection — no score-to-control mapping  */
/* ================================================================== */

describe('Epic 3 — a score never chooses a control', () => {
  it('requires an explicit officer selection even with a HIGH band present', async () => {
    const { BnRiskRecommendationDialog } = await import(
      '@/components/bn/risk/BnRiskRecommendationDialog'
    );
    wrap(
      <BnRiskRecommendationDialog
        open
        onOpenChange={() => {}}
        assessmentId="a1"
        readiness={readiness()}
        targetOptions={[]}
        onCompleted={() => {}}
      />,
    );
    // The control select is empty: nothing was preselected from the band.
    const control = await screen.findByRole('combobox', { name: /^control$/i });
    expect(within(control).getByText(/choose a control/i)).toBeInTheDocument();
    // Submission is impossible until the officer chooses.
    expect(screen.getByRole('button', { name: /submit for independent approval/i })).toBeDisabled();
  });

  it('ships no band-to-control mapping anywhere in Epic 3 source', () => {
    const forbidden = [
      /HIGH['"\s]*[:=]?\s*['"]?TEMPORARY_PAYMENT_HOLD/,
      /MEDIUM['"\s]*[:=]?\s*['"]?ENHANCED_VERIFICATION/,
      /LOW['"\s]*[:=]?\s*['"]?NO_ACTION/,
      /band_code\s*===\s*['"]HIGH['"]\s*\?/,
      /suggestedControl|defaultControl|autoControl|controlForBand|recommendFromScore/i,
    ];
    for (const file of EPIC3_SOURCES) {
      const source = readSrc(file);
      for (const pattern of forbidden) expect(source).not.toMatch(pattern);
    }
  });

  it('never derives an approval decision or an execution action from a score or band', () => {
    for (const file of EPIC3_SOURCES) {
      const source = readSrc(file);
      expect(source).not.toMatch(/band[_A-Za-z]*\s*(===|==)[^\n]*\b(APPROVE|REJECT)\b/);
      expect(source).not.toMatch(/score\s*[><]=?\s*\d+\s*\?[^\n]*\b(APPROVE|control_code)\b/);
    }
  });
});

/* ================================================================== */
/* 3. Governed control catalogue                                      */
/* ================================================================== */

describe('Epic 3 — the control catalogue is backend reference data', () => {
  it('renders only the controls published by readiness', async () => {
    const { BnRiskRecommendationDialog } = await import(
      '@/components/bn/risk/BnRiskRecommendationDialog'
    );
    wrap(
      <BnRiskRecommendationDialog
        open
        onOpenChange={() => {}}
        assessmentId="a1"
        readiness={readiness({ control_options: [ENHANCED_VERIFICATION] })}
        targetOptions={[]}
        onCompleted={() => {}}
      />,
    );
    await screen.findByRole('combobox', { name: /^control$/i });
    expect(screen.queryByText('Temporary payment hold')).not.toBeInTheDocument();
  });

  it('carries the governed control metadata the workflow depends on', () => {
    const keys = Object.keys(PAYMENT_HOLD);
    for (const key of [
      'label', 'is_benefit_affecting', 'requires_independent_approval',
      'requires_target', 'requires_justification', 'allowed_target_types',
      'execution_owner', 'execution_boundary',
    ]) {
      expect(keys).toContain(key);
    }
  });

  it('hard-codes no control catalogue in React', () => {
    for (const file of EPIC3_SOURCES.filter((f) => f.includes('components/'))) {
      const source = readSrc(file);
      expect(source).not.toMatch(/const\s+CONTROLS?\s*[:=]/);
      expect(source).not.toMatch(/['"]TEMPORARY_PAYMENT_HOLD['"]/);
      expect(source).not.toMatch(/['"]CREATE_OVERPAYMENT_REVIEW['"]/);
    }
  });
});

/* ================================================================== */
/* 4. Recommendation submission                                       */
/* ================================================================== */

describe('Epic 3 — recommendation submission', () => {
  it('submits through the governed command and retains every governed field', async () => {
    let captured: Record<string, unknown> | null = null;
    withRpc((name, args) => {
      expect(name).toBe('bn_risk_control_command_v1');
      captured = args;
      return {
        status: 'EXECUTED',
        assessment_id: 'a1',
        assessment_status: 'PENDING_CONTROL_APPROVAL',
        recommendation_id: 'r1',
        execution_state: 'NOT_AUTHORISED',
        entity_version: 8,
      };
    });
    const result = await (await service()).recommendControl({
      assessmentId: 'a1',
      controlCode: 'TEMPORARY_PAYMENT_HOLD',
      reasonCode: 'EVIDENCE_SUPPORTS_CONTROL',
      justification: 'Employer records contradict the declared position.',
      targetType: 'AWARD',
      targetId: 'aw-1',
      targetReference: 'AW-1001',
      supportingFactorIds: ['f1'],
      supportingEvidenceIds: ['e1'],
      expectedRowVersion: 7,
    });

    expect(result.status).toBe('EXECUTED');
    expect(result.assessmentStatus).toBe('PENDING_CONTROL_APPROVAL');
    expect(result.executionState).toBe('NOT_AUTHORISED');

    const args = captured as unknown as Record<string, unknown>;
    expect(args.p_command_name).toBe('BN_RISK_RECOMMEND_CONTROL');
    expect(args.p_reason_code).toBe('EVIDENCE_SUPPORTS_CONTROL');
    expect(args.p_justification).toMatch(/Employer records/);
    expect(args.p_expected_row_version).toBe(7);
    const payload = args.p_payload as Record<string, unknown>;
    expect(payload.control_code).toBe('TEMPORARY_PAYMENT_HOLD');
    expect(payload.target_type).toBe('AWARD');
    expect(payload.target_id).toBe('aw-1');
    expect(payload.supporting_factor_ids).toEqual(['f1']);
    expect(payload.supporting_evidence_ids).toEqual(['e1']);
    expect(args.p_payload_hash).toBeTruthy();
  });

  const failures: Array<[string, string, RegExp]> = [
    ['missing justification', 'E_JUSTIFICATION_REQUIRED: justification', /justification is required/i],
    ['missing target', 'E_MISSING_REQUIRED_INFORMATION: target', /required information is missing/i],
    ['unsupported control or target', 'E_INVALID_VALUE: target type', /not valid/i],
    ['stale assessment', 'E_STALE_ROW_VERSION: assessment', /updated by someone else/i],
    ['permission denied', 'E_PERMISSION_DENIED: recommend', /do not have permission/i],
    ['wrong stage', 'E_INVALID_STATE: recommendation', /not at a stage/i],
  ];

  it.each(failures)('surfaces the backend failure for %s', async (_l, sqlError, message) => {
    withRpc(() => { throw new Error(sqlError); });
    const result = await (await service()).recommendControl({
      assessmentId: 'a1', controlCode: 'TEMPORARY_PAYMENT_HOLD', reasonCode: 'X',
    });
    expect(result.status).toBe('FAILED');
    expect(result.errorMessage).toMatch(message);
    expect(result.errorMessage).not.toMatch(/E_|rpc|sql/i);
  });

  it('records nothing when the caller is not authenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null } } as never);
    withRpc(() => ({ status: 'EXECUTED' }));
    const result = await (await service()).recommendControl({
      assessmentId: 'a1', controlCode: 'ENHANCED_VERIFICATION', reasonCode: 'X',
    });
    expect(result.status).toBe('FAILED');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('blocks submission in the dialog until the required fields are supplied', async () => {
    const { BnRiskRecommendationDialog } = await import(
      '@/components/bn/risk/BnRiskRecommendationDialog'
    );
    wrap(
      <BnRiskRecommendationDialog
        open
        onOpenChange={() => {}}
        assessmentId="a1"
        readiness={readiness()}
        targetOptions={[]}
        onCompleted={() => {}}
      />,
    );
    const submit = await screen.findByRole('button', { name: /submit for independent approval/i });
    expect(submit).toBeDisabled();
  });
});

/* ================================================================== */
/* 5. Idempotency                                                     */
/* ================================================================== */

describe('Epic 3 — idempotent recommendation replay', () => {
  it('replays the original result for the same key and payload', async () => {
    const seen = new Map<string, string>();
    let created = 0;
    withRpc((_n, args) => {
      const key = args.p_idempotency_key as string;
      const hash = args.p_payload_hash as string;
      if (seen.has(key)) {
        if (seen.get(key) !== hash) throw new Error('E_IDEMPOTENCY_PAYLOAD_MISMATCH: replay');
        return { status: 'REPLAYED', recommendation_id: 'r1', assessment_id: 'a1' };
      }
      seen.set(key, hash);
      created += 1;
      return { status: 'EXECUTED', recommendation_id: 'r1', assessment_id: 'a1' };
    });

    const svc = await service();
    const request = {
      assessmentId: 'a1',
      controlCode: 'ENHANCED_VERIFICATION',
      reasonCode: 'EVIDENCE_SUPPORTS_CONTROL',
      idempotencyKey: 'key-1',
    } as const;

    const first = await svc.recommendControl(request);
    const second = await svc.recommendControl(request);

    expect(first.status).toBe('EXECUTED');
    expect(second.status).toBe('REPLAYED');
    expect(second.recommendationId).toBe(first.recommendationId);
    expect(created).toBe(1);
  });

  it('rejects the same key with a changed payload', async () => {
    const seen = new Map<string, string>();
    withRpc((_n, args) => {
      const key = args.p_idempotency_key as string;
      const hash = args.p_payload_hash as string;
      if (seen.has(key) && seen.get(key) !== hash) {
        throw new Error('E_IDEMPOTENCY_PAYLOAD_MISMATCH: replay');
      }
      seen.set(key, hash);
      return { status: 'EXECUTED', recommendation_id: 'r1' };
    });
    const svc = await service();
    await svc.recommendControl({
      assessmentId: 'a1', controlCode: 'ENHANCED_VERIFICATION', reasonCode: 'R', idempotencyKey: 'k',
    });
    const changed = await svc.recommendControl({
      assessmentId: 'a1', controlCode: 'TEMPORARY_PAYMENT_HOLD', reasonCode: 'R', idempotencyKey: 'k',
    });
    expect(changed.status).toBe('FAILED');
    expect(changed.errorCode).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
  });

  it('creates no second decision when a decision is retried with the same key', async () => {
    const seen = new Set<string>();
    let decisions = 0;
    withRpc((_n, args) => {
      const key = args.p_idempotency_key as string;
      if (seen.has(key)) return { status: 'REPLAYED', decision: 'APPROVE', recommendation_id: 'r1' };
      seen.add(key);
      decisions += 1;
      return { status: 'EXECUTED', decision: 'APPROVE', recommendation_id: 'r1' };
    });
    const svc = await service();
    const request = {
      assessmentId: 'a1', decision: 'APPROVE', reasonCode: 'PROPORTIONATE', idempotencyKey: 'd-1',
    } as const;
    await svc.decideControl(request);
    const replay = await svc.decideControl(request);
    expect(replay.status).toBe('REPLAYED');
    expect(decisions).toBe(1);
  });
});

/* ================================================================== */
/* 6. Immutable recommendation cycles                                 */
/* ================================================================== */

describe('Epic 3 — recommendations are immutable cycles', () => {
  it('freezes a pending recommendation instead of offering an in-place edit', async () => {
    await renderRecommendation({
      history: history(recommendation(), [{ recommendation: recommendation(), decisions: [] }]),
    });
    await waitFor(() =>
      expect(screen.getByTestId('bn-risk-recommendation-section')).toHaveAttribute(
        'data-state', 'PENDING_APPROVAL',
      ));
    expect(screen.getByText(/frozen while it awaits/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit/i })).not.toBeInTheDocument();
  });

  it('retains the returned cycle and shows the new cycle beside it', async () => {
    const first = recommendation({
      recommendation_id: 'r1', cycle_no: 1, status: 'RETURNED',
      decision: 'RETURN_FOR_REVIEW', decided_by_name: 'B. Checker',
      decided_at: '2026-08-02T09:00:00Z',
    });
    const second = recommendation({
      recommendation_id: 'r2', cycle_no: 2, status: 'APPROVED',
      execution_state: 'AUTHORISED_PENDING_EXECUTION',
      decision: 'APPROVE', decided_by_name: 'B. Checker', decided_at: '2026-08-05T09:00:00Z',
    });
    await renderRecommendation({
      history: history(second, [
        {
          recommendation: first,
          decisions: [{
            decision_id: 'd1', recommendation_id: 'r1', assessment_id: 'a1',
            decision: 'RETURN_FOR_REVIEW', reason_code: 'MORE_EVIDENCE',
            reason_label: 'More evidence required', decision_notes: null,
            decided_by_name: 'B. Checker', decided_at: '2026-08-02T09:00:00Z',
            resulting_assessment_status: 'RECOMMENDATION',
          }],
        },
        {
          recommendation: second,
          decisions: [{
            decision_id: 'd2', recommendation_id: 'r2', assessment_id: 'a1',
            decision: 'APPROVE', reason_code: 'PROPORTIONATE',
            reason_label: 'Proportionate to the evidence', decision_notes: 'Authorised.',
            decided_by_name: 'B. Checker', decided_at: '2026-08-05T09:00:00Z',
            resulting_assessment_status: 'CONTROL_APPROVED',
          }],
        },
      ]),
    });
    expect(await screen.findByText(/Recommendation 1 ·/)).toBeInTheDocument();
    expect(screen.getByText(/Recommendation 2 ·/)).toBeInTheDocument();
    expect(screen.getByText(/Returned for review by B\. Checker/)).toBeInTheDocument();
    expect(screen.getByText(/Control approved by B\. Checker/)).toBeInTheDocument();
  });

  it('never sends an update or delete command for a recommendation', () => {
    const service = readSrc('services/bn/risk/riskControlService.ts');
    expect(service).not.toMatch(/EDIT_RECOMMENDATION|UPDATE_RECOMMENDATION|DELETE_RECOMMENDATION/);
  });
});

/* ================================================================== */
/* 7. Maker-checker                                                   */
/* ================================================================== */

describe('Epic 3 — maker-checker is enforced by the backend', () => {
  it('rejects the recommender approving their own recommendation', async () => {
    withRpc((_n, args) => {
      if (args.p_actor_user_id === 'officer-1') {
        throw new Error('E_PERMISSION_DENIED: self approval is not permitted');
      }
      return { status: 'EXECUTED', decision: 'APPROVE' };
    });
    const result = await (await service()).decideControl({
      assessmentId: 'a1', decision: 'APPROVE', reasonCode: 'PROPORTIONATE',
    });
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('PERMISSION_DENIED');
  });

  it('permits a different authorised approver', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'checker-9', email: 'c@ssb.kn' } } } as never);
    withRpc((_n, args) => {
      if (args.p_actor_user_id === 'officer-1') {
        throw new Error('E_PERMISSION_DENIED: self approval is not permitted');
      }
      return {
        status: 'EXECUTED', decision: 'APPROVE', recommendation_id: 'r1',
        assessment_status: 'CONTROL_APPROVED',
        execution_state: 'AUTHORISED_PENDING_EXECUTION',
      };
    });
    const result = await (await service()).decideControl({
      assessmentId: 'a1', decision: 'APPROVE', reasonCode: 'PROPORTIONATE',
    });
    expect(result.status).toBe('EXECUTED');
    expect(result.executionState).toBe('AUTHORISED_PENDING_EXECUTION');
  });

  it('reflects, but does not implement, self-approval denial in the UI', async () => {
    await renderApproval({
      readiness: approvalReadiness({
        state: 'SELF_APPROVAL_DENIED', is_self_recommendation: true,
        can_decide: false, can_approve: false, can_reject: false, can_return: false,
        blockers: ['You cannot approve your own recommendation.'],
      }),
    });
    expect(await screen.findByText(/cannot approve your own recommendation/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeDisabled();
  });
});

/* ================================================================== */
/* 8. Approval readiness                                              */
/* ================================================================== */

describe('Epic 3 — approval readiness', () => {
  const blocked: Array<[string, BnRiskControlApprovalReadiness]> = [
    ['no recommendation exists', approvalReadiness({
      state: 'NO_PENDING_DECISION', recommendation_id: null,
      can_decide: false, can_approve: false, can_reject: false, can_return: false,
    })],
    ['the recommendation was already decided', approvalReadiness({
      state: 'APPROVED', can_decide: false, can_approve: false, can_reject: false, can_return: false,
      blockers: ['This recommendation has already been decided.'],
    })],
    ['the recommendation is stale', approvalReadiness({
      state: 'STALE', is_stale: true,
      can_decide: false, can_approve: false, can_reject: false, can_return: false,
    })],
    ['the actor may not decide', approvalReadiness({
      state: 'DENIED', can_decide: false, can_approve: false, can_reject: false, can_return: false,
      blockers: ['You do not have permission to decide control recommendations.'],
    })],
  ];

  it.each(blocked)('offers no decision when %s', async (_l, fixture) => {
    await renderApproval({ readiness: fixture });
    await waitFor(() =>
      expect(screen.getByTestId('bn-risk-approval-section')).toHaveAttribute('data-state', fixture.state));
    const approve = screen.queryByRole('button', { name: /^approve$/i });
    if (approve) expect(approve).toBeDisabled();
  });

  it('permits an independent authorised approver on a current recommendation', async () => {
    await renderApproval({});
    const approve = await screen.findByRole('button', { name: /^approve$/i });
    expect(approve).toBeEnabled();
    expect(screen.getByRole('button', { name: /^reject$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /return for review/i })).toBeEnabled();
  });

  it('fails closed when approval readiness cannot be read', async () => {
    await renderApproval({ readiness: 'ERROR' });
    expect(await screen.findByText(/approval readiness is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
  });
});

/* ================================================================== */
/* 9 & 10. Decisions and already-decided protection                   */
/* ================================================================== */

describe('Epic 3 — governed decisions', () => {
  it('supports exactly approve, reject and return for review', () => {
    expect([...BN_RISK_CONTROL_DECISIONS]).toEqual(['APPROVE', 'REJECT', 'RETURN_FOR_REVIEW']);
    expect([...BN_RISK_CONTROL_COMMANDS]).toEqual([
      'BN_RISK_RECOMMEND_CONTROL', 'BN_RISK_APPROVE_CONTROL',
    ]);
  });

  it.each(BN_RISK_CONTROL_DECISIONS)('persists the %s decision through the command', async (decision) => {
    let captured: Record<string, unknown> | null = null;
    withRpc((name, args) => {
      expect(name).toBe('bn_risk_control_command_v1');
      captured = args;
      return {
        status: 'EXECUTED',
        decision,
        recommendation_id: 'r1',
        assessment_id: 'a1',
        assessment_status: decision === 'APPROVE' ? 'CONTROL_APPROVED'
          : decision === 'REJECT' ? 'CONTROL_REJECTED' : 'RECOMMENDATION',
        execution_state: decision === 'APPROVE' ? 'AUTHORISED_PENDING_EXECUTION' : 'NOT_AUTHORISED',
        decided_at: '2026-08-06T09:00:00Z',
        decided_by_user_id: 'checker-9',
        entity_version: 9,
      };
    });
    const result = await (await service()).decideControl({
      assessmentId: 'a1', decision, reasonCode: 'PROPORTIONATE', notes: 'Considered.',
      expectedRowVersion: 7,
    });
    const args = captured as unknown as Record<string, unknown>;
    expect(args.p_command_name).toBe('BN_RISK_APPROVE_CONTROL');
    expect((args.p_payload as Record<string, unknown>).decision).toBe(decision);
    expect(args.p_reason_code).toBe('PROPORTIONATE');
    expect(args.p_justification).toBe('Considered.');
    expect(args.p_actor_user_id).toBeTruthy();
    expect(result.decision).toBe(decision);
    // React follows the backend result rather than setting lifecycle status itself.
    expect(result.assessmentStatus).toBeTruthy();
    expect((result.data as Record<string, unknown>).decided_at).toBe('2026-08-06T09:00:00Z');
  });

  it('never sets an assessment or recommendation lifecycle status in React', () => {
    for (const file of EPIC3_SOURCES.filter((f) => f.includes('components/'))) {
      const source = readSrc(file);
      expect(source).not.toMatch(/set(Assessment)?Status\(/);
      expect(source).not.toMatch(/status\s*=\s*['"](APPROVED|REJECTED|RETURNED)['"]/);
    }
  });

  it.each([
    ['approved', 'E_INVALID_STATE: already approved'],
    ['rejected', 'E_INVALID_STATE: already rejected'],
    ['returned', 'E_INVALID_STATE: already returned'],
  ])('refuses to decide an already-%s recommendation', async (_l, sqlError) => {
    withRpc(() => { throw new Error(sqlError); });
    const result = await (await service()).decideControl({
      assessmentId: 'a1', decision: 'APPROVE', reasonCode: 'PROPORTIONATE',
    });
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('INVALID_STATE');
  });
});

/* ================================================================== */
/* 11. Stale recommendation protection                                */
/* ================================================================== */

describe('Epic 3 — a stale recommendation cannot be authorised', () => {
  it('blocks approval and directs the officer back to review', async () => {
    await renderApproval({
      readiness: approvalReadiness({
        state: 'STALE', is_stale: true, can_decide: false,
        can_approve: false, can_reject: false, can_return: true,
        warnings: ['Assessment information changed after this recommendation.'],
      }),
    });
    expect(await screen.findByText(/out of date/i)).toBeInTheDocument();
    expect(screen.getByText(/submit a new recommendation/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeDisabled();
  });

  it('rejects a stale decision at the command boundary', async () => {
    withRpc(() => { throw new Error('E_STALE_ROW_VERSION: assessment changed'); });
    const result = await (await service()).decideControl({
      assessmentId: 'a1', decision: 'APPROVE', reasonCode: 'PROPORTIONATE', expectedRowVersion: 7,
    });
    expect(result.errorCode).toBe('STALE_ROW_VERSION');
  });
});

/* ================================================================== */
/* 12, 13, 14. Non-execution and architecture boundary                */
/* ================================================================== */

describe('Epic 3 — approval authorises, it never executes', () => {
  const controls = [
    'TEMPORARY_PAYMENT_HOLD',
    'PREVENT_PROFILE_CHANGE',
    'RECALCULATE_CLAIM',
    'CREATE_OVERPAYMENT_REVIEW',
    'REFER_TO_LEGAL',
    'REFER_TO_INVESTIGATION',
  ];

  it.each(controls)('approving %s calls the risk command boundary only', async (control) => {
    const calls: string[] = [];
    rpc.mockImplementation(async (name: string) => {
      calls.push(name);
      return {
        data: {
          status: 'EXECUTED', decision: 'APPROVE', control_code: control,
          execution_state: 'AUTHORISED_PENDING_EXECUTION',
          assessment_status: 'CONTROL_APPROVED',
        },
        error: null,
      };
    });
    const result = await (await service()).decideControl({
      assessmentId: 'a1', decision: 'APPROVE', reasonCode: 'PROPORTIONATE',
    });
    expect(calls).toEqual(['bn_risk_control_command_v1']);
    expect(from).not.toHaveBeenCalled();
    expect(result.executionState).toBe('AUTHORISED_PENDING_EXECUTION');
  });

  it('describes an approved control as awaiting governed execution', () => {
    expect(controlExecutionNotice('APPROVED', 'AUTHORISED_PENDING_EXECUTION'))
      .toMatch(/awaiting governed execution/i);
    expect(controlExecutionNotice('PENDING_APPROVAL', 'NOT_AUTHORISED'))
      .toMatch(/not executed/i);
  });

  it('invokes no Epic 4 execution command from the Epic 3 frontend', () => {
    const forbidden = [
      'BN_RISK_PLACE_PAYMENT_HOLD',
      'BN_RISK_REQUEST_ENH_VERIFICATION',
      'BN_RISK_REFER_TO_LEGAL',
      'BN_RISK_REFER_TO_INVESTIGATION',
    ];
    for (const file of EPIC3_SOURCES) {
      const source = readSrc(file);
      for (const command of forbidden) expect(source).not.toContain(command);
    }
  });

  it('writes only through the single governed Epic 3 command RPC', () => {
    const source = readSrc('services/bn/risk/riskControlService.ts');
    const rpcs = [...source.matchAll(/supabase\.rpc\('([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(rpcs).toContain('bn_risk_control_command_v1');
    for (const name of rpcs) {
      expect([
        'bn_risk_control_command_v1',
        'bn_risk_recommendation_readiness_v1',
        'bn_risk_control_approval_readiness_v1',
        'bn_risk_recommendation_history_v1',
        'bn_risk_control_approval_queue_v1',
      ]).toContain(name);
    }
  });

  it('never mutates a claim, award, payment, overpayment, person, legal or investigation record', () => {
    const domains = [
      'bn_claim', 'bn_award', 'bn_payment', 'bn_overpayment', 'bn_person',
      'bn_profile', 'bn_legal', 'bn_investigation', 'notification_queue',
    ];
    for (const file of EPIC3_SOURCES) {
      const source = readSrc(file);
      expect(source).not.toMatch(/\.from\(/);
      for (const domain of domains) {
        expect(source).not.toMatch(new RegExp(`\\.from\\(['"]${domain}`));
      }
      expect(source).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    }
  });
});

/* ================================================================== */
/* 15 & 16. History and score-version traceability                    */
/* ================================================================== */

describe('Epic 3 — history and score traceability', () => {
  it('shows the business events of the recommendation lifecycle', async () => {
    const rec = recommendation({
      status: 'APPROVED', execution_state: 'AUTHORISED_PENDING_EXECUTION',
      decision: 'APPROVE', decided_by_name: 'B. Checker', decided_at: '2026-08-05T09:00:00Z',
    });
    await renderRecommendation({
      history: history(rec, [{
        recommendation: rec,
        decisions: [{
          decision_id: 'd1', recommendation_id: 'r1', assessment_id: 'a1',
          decision: 'APPROVE', reason_code: 'PROPORTIONATE',
          reason_label: 'Proportionate to the evidence', decision_notes: null,
          decided_by_name: 'B. Checker', decided_at: '2026-08-05T09:00:00Z',
          resulting_assessment_status: 'CONTROL_APPROVED',
        }],
      }]),
    });
    expect(await screen.findByText(/Recommendation 1 · Temporary payment hold/)).toBeInTheDocument();
    expect(screen.getByText(/Control approved by B\. Checker/)).toBeInTheDocument();
    expect(screen.getAllByText(/awaiting governed execution/i).length).toBeGreaterThan(0);
  });

  it('keeps every recommendation traceable to the exact score version used', async () => {
    const rec = recommendation();
    await renderRecommendation({ history: history(rec, [{ recommendation: rec, decisions: [] }]) });
    expect(await screen.findByText(/scoring BN_RISK_STANDARD v3/)).toBeInTheDocument();
    expect(rec.score_id).toBe('s1');
    expect(rec.score_version_no).toBe(2);
    expect(rec.input_fingerprint).toBe('fp-abc');
  });

  it('never relinks a recommendation to a newer score on the client', () => {
    for (const file of EPIC3_SOURCES.filter((f) => f.includes('components/'))) {
      expect(readSrc(file)).not.toMatch(/score_id\s*=\s*/);
    }
  });

  it('shows the approver the score that was current when the recommendation was made', async () => {
    await renderApproval({});
    expect(await screen.findByText(/Score at recommendation/)).toBeInTheDocument();
    expect(screen.getByText(/BN_RISK_STANDARD v3/)).toBeInTheDocument();
  });
});

/* ================================================================== */
/* 17. Privacy                                                        */
/* ================================================================== */

describe('Epic 3 — privacy on ordinary surfaces', () => {
  it('never publishes control, decision, score or referral detail from Benefit 360', () => {
    const source = readSrc('components/bn/risk/Benefit360RiskCard.tsx');
    for (const leak of [
      'control_code', 'control_label', 'band', 'score', 'decision',
      'contribution', 'REFER_TO_LEGAL', 'REFER_TO_INVESTIGATION', 'justification',
    ]) {
      expect(source).not.toContain(leak);
    }
  });

  it('renders only a generic review state on Benefit 360', async () => {
    withRpc((name) => {
      if (name === 'bn_risk_person_safe_summary_v1') {
        return ok({
          review_state: 'ACTIVE_REVIEW',
          review_state_label: 'Risk review in progress',
          stage_label: 'Under review',
          assessment_reference: 'RA-0001',
        });
      }
      return ok(null);
    });
    const { Benefit360RiskCard } = await import('@/components/bn/risk/Benefit360RiskCard');
    wrap(<Benefit360RiskCard personId={1} />);
    expect(await screen.findByText('Risk review in progress')).toBeInTheDocument();
    expect(screen.queryByText(/High concern|72|Temporary payment hold|approved/i)).toBeNull();
  });

  it('exposes no risk control detail on claim or award summary surfaces', () => {
    const surfaces = fs
      .readdirSync(path.join(SRC, 'components/bn'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && ['claims', 'awards', 'benefit360'].includes(e.name))
      .flatMap((e) =>
        fs.readdirSync(path.join(SRC, 'components/bn', e.name))
          .filter((f) => f.endsWith('.tsx'))
          .map((f) => path.join('components/bn', e.name, f)),
      );
    for (const file of surfaces) {
      const source = readSrc(file);
      expect(source).not.toMatch(/riskControlService/);
      expect(source).not.toMatch(/recommendation_readiness|control_approval_readiness/);
    }
  });
});

/* ================================================================== */
/* 18. Approval queue                                                 */
/* ================================================================== */

describe('Epic 3 — control decision queue', () => {
  function queue(rows: BnRiskControlApprovalQueue['rows']): BnRiskControlApprovalQueue {
    return { rows, total: rows.length, page: 1, page_size: 20, can_decide: true };
  }

  const pendingRow: BnRiskControlApprovalQueue['rows'][number] = {
    assessment_id: 'a1',
    assessment_reference: 'RA-0001',
    person_name: 'J. Person',
    person_ssn_masked: '***-**-1234',
    programme_context: 'Invalidity',
    recommended_at: '2026-08-01T09:00:00Z',
    recommended_by_name: 'A. Officer',
    is_own_recommendation: false,
    decision_age_days: 4,
    assigned_team_code: 'RISK',
    action_required: 'DECIDE',
    action_label: 'Decision required',
    control_code: null,
    control_label: null,
    is_benefit_affecting: null,
    recommendation_id: 'r1',
  };

  async function renderQueue(
    result: unknown,
    onOpenApproval: (id: string) => void = () => {},
  ) {
    withRpc(() => result);
    const { BnRiskControlApprovalQueue: Component } = await import(
      '@/components/bn/risk/BnRiskControlApprovalQueue'
    );
    return wrap(<Component onOpenApproval={onOpenApproval} />);
  }

  it('lists work awaiting an independent decision', async () => {
    await renderQueue(ok(queue([pendingRow])));
    expect(await screen.findByText('RA-0001')).toBeInTheDocument();
    expect(screen.getByText('Decision required')).toBeInTheDocument();
  });

  it('drops decided work from the pending queue', async () => {
    await renderQueue(ok(queue([])));
    expect(await screen.findByText(/no recommendation is awaiting a decision/i)).toBeInTheDocument();
  });

  it('marks the caller’s own recommendation as awaiting another approver', async () => {
    await renderQueue(ok(queue([{ ...pendingRow, is_own_recommendation: true }])));
    expect(await screen.findByText(/awaiting another approver/i)).toBeInTheDocument();
  });

  it('never fabricates a zero count when the queue fails', async () => {
    await renderQueue({ status: 'ERROR', code: 'E_UNAVAILABLE', data: null });
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/no recommendation is awaiting a decision/i)).toBeNull();
  });

  it('reports a permission failure instead of an empty queue', async () => {
    getUser.mockResolvedValue({ data: { user: null } } as never);
    await renderQueue(ok(queue([])));
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
  });

  it('deep links an item into the approval section', async () => {
    const opened: string[] = [];
    await renderQueue(ok(queue([pendingRow])), (id) => opened.push(id));
    const open = await screen.findByRole('button', { name: /open|review/i });
    open.click();
    await waitFor(() => expect(opened).toEqual(['a1']));
  });

  it('routes the workspace deep link to the approval section', () => {
    const page = readSrc('pages/bn/risk/BnRiskManagementPage.tsx');
    expect(page).toMatch(/focusSection=\{focusApproval \? 'approval' : null\}/);
    const workspace = readSrc('components/bn/risk/BnRiskAssessmentWorkspace.tsx');
    expect(workspace).toMatch(/focusSection === 'approval'/);
  });
});

/* ================================================================== */
/* 19 & 20. Governed action availability and accessibility            */
/* ================================================================== */

describe('Epic 3 — action availability and accessibility', () => {
  it('takes recommend availability from the governed action contract', async () => {
    await renderRecommendation({ readiness: readiness(), actionEnabled: false });
    expect(await screen.findByRole('button', { name: /recommend control/i })).toBeDisabled();
  });

  it('takes approve, reject and return availability from the governed action contract', async () => {
    await renderApproval({ actionEnabled: false });
    expect(await screen.findByRole('button', { name: /^approve$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^reject$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /return for review/i })).toBeDisabled();
  });

  it('labels every recommendation dialog control', async () => {
    const { BnRiskRecommendationDialog } = await import(
      '@/components/bn/risk/BnRiskRecommendationDialog'
    );
    wrap(
      <BnRiskRecommendationDialog
        open onOpenChange={() => {}} assessmentId="a1"
        readiness={readiness()} targetOptions={[]} onCompleted={() => {}}
      />,
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /^control$/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /recommendation reason/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/why is this control being recommended/i)).toBeInTheDocument();
  });

  it('labels the decision dialog and states the approval consequence in words', async () => {
    const { BnRiskControlDecisionDialog } = await import(
      '@/components/bn/risk/BnRiskControlDecisionDialog'
    );
    wrap(
      <BnRiskControlDecisionDialog
        open onOpenChange={() => {}} assessmentId="a1" decision="APPROVE"
        readiness={approvalReadiness()} recommendation={recommendation()} onCompleted={() => {}}
      />,
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /decision reason/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/decision notes/i)).toBeInTheDocument();
    // Status is carried by words, never by colour alone.
    expect(screen.getByText(/does not execute the benefit action/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record decision/i })).toBeDisabled();
  });

  it('states approval status in words on the approval surface', async () => {
    await renderApproval({});
    expect(await screen.findByText(/Approval authorises the control for later governed execution/i))
      .toBeInTheDocument();
  });
});

/* ================================================================== */
/* 21. Standing guard — score remains decision support                */
/* ================================================================== */

describe('Epic 3 — standing guard: the score is decision support only', () => {
  it('applies to every current and future bn/risk source file', () => {
    const dirs = ['components/bn/risk', 'services/bn/risk', 'types/bn/risk'];
    const files = dirs.flatMap((dir) =>
      fs.readdirSync(path.join(SRC, dir))
        .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
        .map((f) => path.join(dir, f)),
    );
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const source = readSrc(file);
      // No band → control, band → decision or band → execution mapping.
      expect(source).not.toMatch(/Record<\s*['"]?(HIGH|BAND)[^>]*>\s*=\s*\{[^}]*CONTROL/i);
      expect(source).not.toMatch(/BAND_TO_(CONTROL|DECISION|ACTION)/i);
      expect(source).not.toMatch(/SCORE_TO_(CONTROL|DECISION|ACTION)/i);
      expect(source).not.toMatch(/auto(Approve|Recommend|Execute)/i);
    }
  });
});
