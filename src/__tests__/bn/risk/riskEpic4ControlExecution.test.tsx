/**
 * BN Risk / Fraud — EPIC 4 certification suite.
 *
 * Approved control execution and governed handoffs. Every test proves a
 * governed property of the delivered Epic 4 boundary:
 *
 *  - execution is only possible for a current, independently approved control
 *  - Risk never writes a Payment, Claim, Award, Person, Overpayment, Legal or
 *    Investigation record; every target effect goes through the governed
 *    cross-module handoff spine
 *  - every attempt is an immutable record; attempts are never overwritten
 *  - idempotency prevents duplicate payment holds and duplicate referrals
 *  - retry is backend-permitted only; refresh reconciles, it never resubmits
 *  - a requested execution is never presented as a completed one
 *  - ordinary surfaces never reveal the control, score, band or referral
 *  - Epic 4 executes no outcome, closure or reopen command
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'node:fs';
import path from 'node:path';
import {
  BN_RISK_EXECUTION_COMMANDS,
  executionStatusLabel,
  paymentHoldStatusLabel,
  type BnRiskControlExecutionAttempt,
  type BnRiskControlExecutionQueue,
  type BnRiskControlExecutionReadiness,
} from '@/types/bn/risk/riskControlExecution';

/* ------------------------------------------------------------------ */
/* Supabase boundary mock — the only route Epic 4 may take            */
/* ------------------------------------------------------------------ */

const rpc = vi.fn();
const from = vi.fn((..._args: unknown[]) => {
  throw new Error('Epic 4 must never touch a table directly from the browser');
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
const ROOT = path.resolve(SRC, '..');
const readSrc = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
/** The live Epic 4 backend, as delivered. */
const BACKEND_SQL = fs
  .readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
  .filter((sql) => sql.includes('bn_risk_control_execution'))
  .join('\n');

const EPIC4_SOURCES = [
  'types/bn/risk/riskControlExecution.ts',
  'services/bn/risk/riskControlExecutionService.ts',
  'components/bn/risk/BnRiskControlExecutionSection.tsx',
  'components/bn/risk/BnRiskControlExecutionDialog.tsx',
  'components/bn/risk/BnRiskControlExecutionQueue.tsx',
];

/* ------------------------------------------------------------------ */
/* Fixtures — shaped exactly like the governed readiness contract     */
/* ------------------------------------------------------------------ */

const APPROVAL = {
  recommendation_id: 'rec-1',
  recommendation_reference: 'RSK-REC-0001',
  control_code: 'TEMPORARY_PAYMENT_HOLD',
  control_label: 'Temporary payment hold',
  is_benefit_affecting: true,
  approved_reason_code: 'UNVERIFIED_INCOME',
  approved_reason_label: 'Income could not be verified',
  approved_justification: 'Approved by the control board.',
  approved_by_name: 'Checker Two',
  approved_at: '2026-08-01T09:00:00Z',
  recommended_by_name: 'Officer One',
  decision_id: 'dec-1',
  target_type: 'AWARD',
  target_reference: 'AWD-1001',
  requested_effective_from: '2026-08-05',
  requested_effective_to: '2026-09-05',
  scope_note: 'Next payment only.',
  score_id: 'score-1',
  score_version_no: 3,
  rule_set_code: 'RISK_CORE',
  rule_set_version_no: 2,
} as const;

const PAYMENT_TARGET = {
  control_code: 'TEMPORARY_PAYMENT_HOLD',
  control_label: 'Temporary payment hold',
  execution_class: 'PAYMENT_CONTROL',
  boundary_kind: 'CROSS_MODULE_HANDOFF',
  execution_owner: 'Payments',
  target_module: 'bn_payments',
  handoff_type: 'PAYMENT_HOLD_REQUEST',
  is_asynchronous: true,
  requires_confirmation: true,
  missing_capability: null,
} as const;

function attempt(
  over: Partial<BnRiskControlExecutionAttempt> = {},
): BnRiskControlExecutionAttempt {
  return {
    execution_id: 'exec-1',
    execution_reference: 'RSK-EXE-0001',
    assessment_id: 'as-1',
    recommendation_id: 'rec-1',
    decision_id: 'dec-1',
    control_code: 'TEMPORARY_PAYMENT_HOLD',
    control_label: 'Temporary payment hold',
    command_name: 'BN_RISK_PLACE_PAYMENT_HOLD',
    execution_class: 'PAYMENT_CONTROL',
    target_module: 'bn_payments',
    target_type: 'AWARD',
    target_business_reference: null,
    target_internal_reference: null,
    target_operation_reference: null,
    target_correlation_reference: null,
    target_status: 'RAISED',
    status: 'PENDING',
    attempt_no: 1,
    requested_by_name: 'Officer One',
    requested_at: '2026-08-02T09:00:00Z',
    accepted_at: null,
    completed_at: null,
    failed_at: null,
    failure_code: null,
    failure_summary: null,
    is_retryable: false,
    retries_execution_id: null,
    row_version: 1,
    ...over,
  };
}

function readiness(
  over: Partial<BnRiskControlExecutionReadiness> = {},
): BnRiskControlExecutionReadiness {
  return {
    assessment_id: 'as-1',
    assessment_status: 'CONTROL_ACTION',
    assessment_row_version: 7,
    state: 'READY',
    can_execute: true,
    available_action: 'EXECUTE',
    blockers: [],
    warnings: [],
    approval: APPROVAL,
    target: PAYMENT_TARGET,
    command_name: 'BN_RISK_PLACE_PAYMENT_HOLD',
    required_parameters: ['target_type', 'target_id'],
    permitted_runtime_fields: ['operational_note'],
    current_execution: null,
    attempts: [],
    history: [],
    is_retryable: false,
    execution_status: 'NOT_STARTED',
    status_label: 'Not started',
    restricted_detail_visible: true,
    ...over,
  };
}

function ok(data: unknown) {
  return { data: { status: 'OK', data }, error: null };
}

function renderWith(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  rpc.mockReset();
  from.mockClear();
});

/* ================================================================== */
/* 1. Backend exists behind the frontend contracts                    */
/* ================================================================== */

describe('Epic 4 — governed backend', () => {
  it('delivers the readiness, queue, command and outcome-readiness boundary', () => {
    for (const fn of [
      'bn_risk_control_execution_readiness_v1',
      'bn_risk_control_execution_queue_v1',
      'bn_risk_control_execution_command_v1',
      'bn_risk_outcome_readiness_v1',
    ]) {
      expect(BACKEND_SQL).toContain(fn);
    }
  });

  it('keeps every execution mutation SECURITY DEFINER and permission checked', () => {
    expect(BACKEND_SQL).toMatch(/bn_risk_control_execution_command_v1[\s\S]*?SECURITY DEFINER/);
    expect(BACKEND_SQL).toContain("_bn_risk_require(p_actor_user_id,'decide',true)");
  });

  it('stores attempts and their events in immutable Risk-owned tables', () => {
    expect(BACKEND_SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.bn_risk_control_execution\s*\(/);
    expect(BACKEND_SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.bn_risk_control_execution_event\s*\(/);
  });
});

/* ================================================================== */
/* 2. Approved-control prerequisite                                   */
/* ================================================================== */

describe('Epic 4 — approved control prerequisite', () => {
  it('only ever loads an APPROVED recommendation for execution', () => {
    expect(BACKEND_SQL).toContain("FROM public.bn_risk_recommendation\n   WHERE assessment_id = p_assessment_id AND status='APPROVED'");
    expect(BACKEND_SQL).toContain('there is no independently approved control to execute');
  });

  it('requires the independent approval decision itself', () => {
    expect(BACKEND_SQL).toContain('The independent approval decision for this control could not be found.');
    expect(BACKEND_SQL).toContain("AND decision = 'APPROVE'");
  });

  it('fails closed on a stale approval superseded by a newer cycle', () => {
    expect(BACKEND_SQL).toContain('A newer recommendation cycle exists. This approval is no longer current.');
  });

  it('requires the authorised execution state on the recommendation', () => {
    expect(BACKEND_SQL).toContain("v_r.execution_state <> 'AUTHORISED_PENDING_EXECUTION'");
    expect(BACKEND_SQL).toContain('This control is not authorised for execution.');
  });

  it('re-validates readiness inside the command, never trusting the browser', () => {
    expect(BACKEND_SQL).toContain('v_ready := public.bn_risk_control_execution_readiness_v1');
    expect(BACKEND_SQL).toContain("(v_ready->'data'->>'can_execute')::boolean");
  });

  it('shows nothing executable when no approved control exists', async () => {
    rpc.mockResolvedValue(ok(readiness({
      state: 'NO_APPROVED_CONTROL', can_execute: false, available_action: 'NONE',
      approval: null, target: null, command_name: null,
      blockers: ['There is no independently approved control to execute.'],
    })));
    const { BnRiskControlExecutionSection } =
      await import('@/components/bn/risk/BnRiskControlExecutionSection');
    renderWith(<BnRiskControlExecutionSection assessmentId="as-1" onChanged={() => {}} />);
    await screen.findByTestId('bn-risk-execution-section');
    expect(screen.queryByRole('button', { name: /execute approved control/i })).toBeNull();
  });
});

/* ================================================================== */
/* 3 & 4. Canonical commands and the governed control catalogue       */
/* ================================================================== */

describe('Epic 4 — canonical commands and control catalogue', () => {
  it('implements exactly the four canonical execution commands', () => {
    expect([...BN_RISK_EXECUTION_COMMANDS]).toEqual([
      'BN_RISK_PLACE_PAYMENT_HOLD',
      'BN_RISK_REQUEST_ENH_VERIFICATION',
      'BN_RISK_REFER_TO_LEGAL',
      'BN_RISK_REFER_TO_INVESTIGATION',
    ]);
    for (const c of BN_RISK_EXECUTION_COMMANDS) expect(BACKEND_SQL).toContain(c);
  });

  it('binds each canonical command to its approved control server-side', () => {
    expect(BACKEND_SQL).toContain("WHEN 'TEMPORARY_PAYMENT_HOLD'   THEN 'BN_RISK_PLACE_PAYMENT_HOLD'");
    expect(BACKEND_SQL).toContain("WHEN 'ENHANCED_VERIFICATION'    THEN 'BN_RISK_REQUEST_ENH_VERIFICATION'");
    expect(BACKEND_SQL).toContain("WHEN 'REFER_TO_LEGAL'           THEN 'BN_RISK_REFER_TO_LEGAL'");
    expect(BACKEND_SQL).toContain("WHEN 'REFER_TO_INVESTIGATION'   THEN 'BN_RISK_REFER_TO_INVESTIGATION'");
    expect(BACKEND_SQL).toContain('cannot execute an approved % control');
  });

  it('rejects any command outside the governed execution catalogue', () => {
    expect(BACKEND_SQL).toContain('E_COMMAND_NOT_IMPLEMENTED');
  });

  /** Item 4 — every remaining governed control is classified, never fabricated. */
  const CLASSIFICATION: ReadonlyArray<readonly [string, string, string]> = [
    ['NO_ACTION', 'INTERNAL_RISK_OPERATION', 'RISK_INTERNAL'],
    ['REQUEST_DOCUMENTS', 'INTERNAL_RISK_OPERATION', 'RISK_INTERNAL'],
    ['SUPERVISOR_REVIEW', 'GOVERNED_HANDOFF_AVAILABLE', 'CROSS_MODULE_HANDOFF'],
    ['PREVENT_PROFILE_CHANGE', 'TARGET_BOUNDARY_NOT_AVAILABLE', 'UNAVAILABLE'],
    ['RECALCULATE_CLAIM', 'GOVERNED_HANDOFF_AVAILABLE', 'CROSS_MODULE_HANDOFF'],
    ['CREATE_OVERPAYMENT_REVIEW', 'GOVERNED_HANDOFF_AVAILABLE', 'CROSS_MODULE_HANDOFF'],
    ['CORRECT_SYSTEM_ERROR', 'GOVERNED_HANDOFF_AVAILABLE', 'CROSS_MODULE_HANDOFF'],
    ['CORRECT_STAFF_ERROR', 'GOVERNED_HANDOFF_AVAILABLE', 'CROSS_MODULE_HANDOFF'],
  ];

  it.each(CLASSIFICATION)('classifies %s as %s', (control, _classification, boundary) => {
    const row = BACKEND_SQL.split('\n').find(
      (l) => l.includes(`'${control}'`) && l.includes(`'${boundary}'`),
    );
    expect(row, `${control} must be registered as ${boundary}`).toBeTruthy();
  });
});

/* ================================================================== */
/* 5–12. Individual target boundaries                                 */
/* ================================================================== */

describe('Epic 4 — target boundaries', () => {
  it('routes the payment hold to the Payments domain and never writes payments', () => {
    expect(BACKEND_SQL).toMatch(/'bn_payments',\s*\n?\s*'PAYMENT_HOLD_REQUEST'/);
    expect(BACKEND_SQL).not.toMatch(/INSERT INTO public\.bn_payment/i);
    expect(BACKEND_SQL).not.toMatch(/UPDATE public\.bn_payment/i);
  });

  it('routes enhanced verification to the verification boundary', () => {
    expect(BACKEND_SQL).toMatch(/'bn_verification',\s*\n?\s*'ENHANCED_VERIFICATION_REQUEST'/);
  });

  it('routes legal and investigation referrals through the handoff spine only', () => {
    expect(BACKEND_SQL).toMatch(/'bn_legal',\s*\n?\s*'LEGAL_REFERRAL'/);
    expect(BACKEND_SQL).toMatch(/'bn_investigation',\s*\n?\s*'INVESTIGATION_REFERRAL'/);
    expect(BACKEND_SQL).not.toMatch(/INSERT INTO public\.bn_legal_/i);
    expect(BACKEND_SQL).not.toMatch(/INSERT INTO public\.bn_investigation/i);
  });

  it('sends only the minimum authorised referral package', () => {
    expect(BACKEND_SQL).toContain("IF v_r.control_class = 'REFERRAL' THEN");
    expect(BACKEND_SQL).toContain("'referral_summary', v_r.justification");
    expect(BACKEND_SQL).not.toContain("'all_signals'");
    expect(BACKEND_SQL).not.toContain("'score_contributions'");
  });

  it('routes claim recalculation and overpayment review without computing them', () => {
    expect(BACKEND_SQL).toMatch(/'bn_claim',\s*\n?\s*'CLAIM_RECALCULATION_REQUEST'/);
    expect(BACKEND_SQL).toMatch(/'bn_overpayment',\s*\n?\s*'OVERPAYMENT_REVIEW_REQUEST'/);
    expect(BACKEND_SQL).not.toMatch(/INSERT INTO public\.bn_overpayment_/i);
    expect(BACKEND_SQL).not.toMatch(/INSERT INTO public\.bn_claim_/i);
  });

  it('blocks profile change control because no governed boundary exists', () => {
    expect(BACKEND_SQL).toContain('A governed Person/profile change-control boundary');
    expect(BACKEND_SQL).toContain('E_CONTROL_EXECUTION_BLOCKED');
    expect(BACKEND_SQL).not.toMatch(/INSERT INTO public\.bn_person/i);
    expect(BACKEND_SQL).not.toMatch(/UPDATE public\.bn_person/i);
  });

  it('surfaces an unavailable boundary as a precise, fail-closed blocker', async () => {
    rpc.mockResolvedValue(ok(readiness({
      state: 'CONTROL_EXECUTION_BLOCKED',
      can_execute: false,
      available_action: 'NONE',
      approval: { ...APPROVAL, control_code: 'PREVENT_PROFILE_CHANGE', control_label: 'Prevent profile change' },
      target: {
        ...PAYMENT_TARGET,
        control_code: 'PREVENT_PROFILE_CHANGE',
        boundary_kind: 'UNAVAILABLE',
        execution_class: 'PROFILE_CONTROL',
        execution_owner: 'Registration',
        target_module: 'bn_registration',
        handoff_type: null,
        missing_capability:
          'A governed Person/profile change-control boundary does not exist yet.',
      },
      command_name: null,
      blockers: ['A governed Person/profile change-control boundary does not exist yet.'],
    })));
    const { BnRiskControlExecutionSection } =
      await import('@/components/bn/risk/BnRiskControlExecutionSection');
    renderWith(<BnRiskControlExecutionSection assessmentId="as-1" onChanged={() => {}} />);
    expect(await screen.findByTestId('bn-risk-execution-blocked')).toHaveTextContent(
      /governed Person\/profile change-control boundary does not exist yet/i,
    );
    expect(screen.queryByRole('button', { name: /execute approved control/i })).toBeNull();
  });

  it('completes NO_ACTION internally without any target operation or closure', () => {
    expect(BACKEND_SQL).toContain("IF v_r.control_code = 'NO_ACTION' THEN");
    expect(BACKEND_SQL).toContain("v_status := 'COMPLETED'");
    expect(BACKEND_SQL).not.toContain('BN_RISK_CLOSE_ASSESSMENT');
  });

  it('reuses the Epic 1 Risk evidence engine for REQUEST_DOCUMENTS', () => {
    expect(BACKEND_SQL).toContain('a governed Risk evidence request must be provided');
    expect(BACKEND_SQL).toContain('public.bn_risk_information_request');
  });
});

/* ================================================================== */
/* 13–17. Attempts, idempotency, retry, refresh, rejection            */
/* ================================================================== */

describe('Epic 4 — attempts, idempotency, retry and refresh', () => {
  it('creates a new attempt row per retry and never overwrites attempt 1', () => {
    expect(BACKEND_SQL).toContain('v_attempt := v_prev.attempt_no + 1');
    expect(BACKEND_SQL).toContain('retries_execution_id');
    expect(BACKEND_SQL).not.toMatch(/DELETE FROM public\.bn_risk_control_execution\b/);
  });

  it('renders every retained attempt in order', async () => {
    rpc.mockResolvedValue(ok(readiness({
      state: 'PROCESSING',
      can_execute: false,
      available_action: 'REFRESH',
      execution_status: 'ACCEPTED',
      current_execution: attempt({ execution_id: 'exec-2', attempt_no: 2, status: 'ACCEPTED' }),
      attempts: [
        attempt({
          execution_id: 'exec-1', attempt_no: 1, status: 'FAILED', is_retryable: true,
          failure_code: 'TARGET_TIMEOUT', failure_summary: 'The owning domain did not respond.',
        }),
        attempt({ execution_id: 'exec-2', attempt_no: 2, status: 'ACCEPTED' }),
      ],
    })));
    const { BnRiskControlExecutionSection } =
      await import('@/components/bn/risk/BnRiskControlExecutionSection');
    renderWith(<BnRiskControlExecutionSection assessmentId="as-1" onChanged={() => {}} />);
    const table = await screen.findByTestId('bn-risk-execution-attempts');
    expect(table).toHaveTextContent('Attempt 1');
    expect(table).toHaveTextContent('Attempt 2');
    expect(table).toHaveTextContent('Execution failed');
  });

  it('replays an identical request instead of raising a second target operation', () => {
    expect(BACKEND_SQL).toContain("RETURN jsonb_set(v_existing.result_json,'{status}','\"REPLAYED\"'::jsonb)");
    expect(BACKEND_SQL).toContain('E_IDEMPOTENCY_PAYLOAD_MISMATCH');
  });

  it('rejects a reused idempotency key with a changed payload', () => {
    expect(BACKEND_SQL).toContain('v_existing.payload_hash IS DISTINCT FROM COALESCE(p_payload_hash');
  });

  it('never raises a second live handoff for the same approved control', () => {
    expect(BACKEND_SQL).toContain("AND source_record_id = v_r.recommendation_id");
    expect(BACKEND_SQL).toContain("status IN ('RAISED','PENDING','ACCEPTED','LINKED','COMPLETED')");
    expect(BACKEND_SQL).toContain("'status','REPLAYED'");
  });

  it('blocks a second first-time execution attempt', () => {
    expect(BACKEND_SQL).toContain('this control already has an execution attempt');
  });

  it('permits retry only when the backend published RETRY', () => {
    expect(BACKEND_SQL).toContain("COALESCE((v_ready->'data'->>'available_action'),'NONE') <> 'RETRY'");
    expect(BACKEND_SQL).toContain('This execution failed and the owning domain has not marked it retryable.');
    expect(BACKEND_SQL).toContain('This control has already been executed successfully.');
  });

  it('offers Retry for a retryable failure only', async () => {
    rpc.mockResolvedValue(ok(readiness({
      state: 'RETRYABLE', can_execute: true, available_action: 'RETRY', is_retryable: true,
      execution_status: 'FAILED',
      current_execution: attempt({ status: 'FAILED', is_retryable: true, failure_code: 'TARGET_TIMEOUT' }),
      attempts: [attempt({ status: 'FAILED', is_retryable: true })],
    })));
    const { BnRiskControlExecutionSection } =
      await import('@/components/bn/risk/BnRiskControlExecutionSection');
    renderWith(<BnRiskControlExecutionSection assessmentId="as-1" onChanged={() => {}} />);
    expect(await screen.findByRole('button', { name: /retry execution/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /execute approved control/i })).toBeNull();
  });

  it('offers no Retry for a non-retryable failure or a completed execution', async () => {
    const { BnRiskControlExecutionSection } =
      await import('@/components/bn/risk/BnRiskControlExecutionSection');

    rpc.mockResolvedValue(ok(readiness({
      state: 'NON_RETRYABLE', can_execute: false, available_action: 'NONE',
      execution_status: 'FAILED', is_retryable: false,
      current_execution: attempt({ status: 'FAILED', is_retryable: false }),
      blockers: ['This execution failed and the owning domain has not marked it retryable.'],
    })));
    const nonRetryable = renderWith(
      <BnRiskControlExecutionSection assessmentId="as-1" onChanged={() => {}} />,
    );
    await screen.findByTestId('bn-risk-execution-section');
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    nonRetryable.unmount();

    rpc.mockResolvedValue(ok(readiness({
      state: 'COMPLETED', can_execute: false, available_action: 'NONE',
      execution_status: 'COMPLETED',
      current_execution: attempt({ status: 'COMPLETED', target_business_reference: 'PAY-HOLD-77' }),
      blockers: ['This control has already been executed successfully.'],
    })));
    renderWith(<BnRiskControlExecutionSection assessmentId="as-1" onChanged={() => {}} />);
    await screen.findByTestId('bn-risk-execution-section');
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /execute approved control/i })).toBeNull();
  });

  it('reconciles on refresh and never re-raises a handoff', () => {
    const refreshBlock = BACKEND_SQL.slice(
      BACKEND_SQL.indexOf("IF p_command_name = 'BN_RISK_OP_REFRESH_CONTROL_EXECUTION' THEN"),
      BACKEND_SQL.indexOf('-- --------------------------------------------------------- EXECUTE / RETRY'),
    );
    expect(refreshBlock.length).toBeGreaterThan(100);
    expect(refreshBlock).not.toContain('INSERT INTO public.bn_cross_module_handoff(');
    expect(refreshBlock).toContain('_bn_risk_exec_status_from_handoff');
  });

  it('maps the asynchronous target journey PENDING → ACCEPTED → PROCESSING → COMPLETED', () => {
    expect(BACKEND_SQL).toContain('_bn_risk_exec_status_from_handoff');
    for (const s of ['ACCEPTED', 'PROCESSING', 'COMPLETED']) {
      expect(BACKEND_SQL).toContain(`CONTROL_EXECUTION_${s}`);
    }
    expect(executionStatusLabel('PENDING')).toBe('Requested — awaiting the owning domain');
    expect(executionStatusLabel('PROCESSING')).toBe('Being processed by the owning domain');
    expect(executionStatusLabel('COMPLETED')).toBe('Completed by the owning domain');
  });

  it('sends only a refresh command when Refresh status is used', async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'bn_risk_control_execution_readiness_v1') {
        return ok(readiness({
          state: 'PENDING', can_execute: false, available_action: 'REFRESH',
          execution_status: 'PENDING', current_execution: attempt(), attempts: [attempt()],
        }));
      }
      return { data: { status: 'EXECUTED', execution_status: 'ACCEPTED' }, error: null };
    });
    const { BnRiskControlExecutionSection } =
      await import('@/components/bn/risk/BnRiskControlExecutionSection');
    renderWith(<BnRiskControlExecutionSection assessmentId="as-1" onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /refresh status/i }));
    await waitFor(() => {
      const call = rpc.mock.calls.find(
        (c) => c[0] === 'bn_risk_control_execution_command_v1',
      );
      expect(call?.[1].p_command_name).toBe('BN_RISK_OP_REFRESH_CONTROL_EXECUTION');
    });
  });

  it('keeps the approval a historical fact when the target rejects execution', async () => {
    expect(BACKEND_SQL).toContain('CONTROL_EXECUTION_REJECTED_BY_TARGET');
    expect(BACKEND_SQL).not.toMatch(/UPDATE public\.bn_risk_recommendation[\s\S]{0,200}status\s*=\s*'REJECTED'/);

    rpc.mockResolvedValue(ok(readiness({
      state: 'REJECTED_BY_TARGET', can_execute: false, available_action: 'NONE',
      execution_status: 'REJECTED_BY_TARGET',
      current_execution: attempt({ status: 'REJECTED_BY_TARGET' }),
      blockers: ['The owning domain rejected this control. Record the outcome instead of re-executing.'],
    })));
    const { BnRiskControlExecutionSection } =
      await import('@/components/bn/risk/BnRiskControlExecutionSection');
    renderWith(<BnRiskControlExecutionSection assessmentId="as-1" onChanged={() => {}} />);
    expect(await screen.findByTestId('bn-risk-execution-status')).toHaveTextContent(
      /Hold request rejected/i,
    );
  });
});

/* ================================================================== */
/* 18–19. Parameter drift and backend-published actions               */
/* ================================================================== */

describe('Epic 4 — approved parameters and available actions', () => {
  it('rejects any attempt to change an approved material parameter', () => {
    expect(BACKEND_SQL).toContain('E_PARAMETER_DRIFT');
    expect(BACKEND_SQL).toContain('the approved control cannot be changed at execution');
    expect(BACKEND_SQL).toContain('approved_parameters');
  });

  it('sends only backend-permitted runtime fields from the browser', () => {
    const service = readSrc('services/bn/risk/riskControlExecutionService.ts');
    expect(service).toContain('operational_note');
    expect(service).toContain('information_request_id');
    expect(service).not.toMatch(/control_code:/);
    expect(service).not.toMatch(/effective_from/);
  });

  it('confirms the approved parameters read-only in the execution dialog', async () => {
    rpc.mockResolvedValue(ok(readiness()));
    const { BnRiskControlExecutionSection } =
      await import('@/components/bn/risk/BnRiskControlExecutionSection');
    renderWith(<BnRiskControlExecutionSection assessmentId="as-1" onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /execute approved control/i }));
    const dialog = await screen.findByTestId('bn-risk-execution-dialog');
    expect(dialog).toHaveTextContent('Temporary payment hold');
    expect(dialog).toHaveTextContent('Payments');
    expect(dialog).toHaveTextContent(/cannot be changed here/i);
    expect(dialog.querySelectorAll('select').length).toBe(0);
  });

  it('never infers Execute, Retry or Refresh from a status string', () => {
    const section = readSrc('components/bn/risk/BnRiskControlExecutionSection.tsx');
    expect(section).toContain("data.available_action === 'EXECUTE'");
    expect(section).toContain("data.available_action === 'RETRY'");
    expect(section).toContain("data.available_action === 'REFRESH'");
    expect(section).not.toMatch(/execution_status === 'FAILED'[\s\S]{0,80}Retry/);
  });

  it('fails closed when readiness cannot be read', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { BnRiskControlExecutionSection } =
      await import('@/components/bn/risk/BnRiskControlExecutionSection');
    renderWith(<BnRiskControlExecutionSection assessmentId="as-1" onChanged={() => {}} />);
    const card = await screen.findByTestId('bn-risk-execution-section');
    expect(card).toHaveAttribute('data-state', 'FAILED_TO_LOAD');
    expect(card).toHaveTextContent(/Nothing has changed|No control can be executed/i);
  });
});

/* ================================================================== */
/* 20. Execution queue                                                */
/* ================================================================== */

describe('Epic 4 — execution queue', () => {
  const queue = (over: Partial<BnRiskControlExecutionQueue> = {}): BnRiskControlExecutionQueue => ({
    rows: [{
      assessment_id: 'as-1',
      assessment_reference: 'RSK-2026-0001',
      person_name: 'A. Person',
      person_masked_identifier: '***-**-1234',
      current_stage: 'Control execution',
      execution_status: 'NOT_STARTED',
      execution_status_label: 'Not started',
      target_module: 'bn_payments',
      approved_at: '2026-08-01T09:00:00Z',
      age_days: 3,
      assigned_owner_name: 'Officer One',
      assigned_team_code: 'RISK',
      action_required: 'Control execution required',
      control_code: null,
      control_label: null,
    }],
    total: 41,
    page: 1,
    page_size: 20,
    bucket_counts: {
      AWAITING_EXECUTION: 12, IN_PROGRESS: 9, FAILED: 4, RETRY_AVAILABLE: 3,
      REFERRAL_PENDING: 7, REJECTED_BY_TARGET: 2, AWAITING_OUTCOME: 4,
    },
    restricted_detail_visible: false,
    ...over,
  });

  it('publishes every governed bucket in the backend', () => {
    for (const b of ['AWAITING_EXECUTION', 'RETRY_AVAILABLE', 'FAILED', 'REJECTED_BY_TARGET',
      'AWAITING_OUTCOME', 'REFERRAL_PENDING', 'IN_PROGRESS']) {
      expect(BACKEND_SQL).toContain(b);
    }
  });

  it('respects backend totals and counts rather than counting rendered rows', async () => {
    rpc.mockResolvedValue(ok(queue()));
    const { BnRiskControlExecutionQueue: Q } =
      await import('@/components/bn/risk/BnRiskControlExecutionQueue');
    renderWith(<Q onOpenExecution={() => {}} />);
    const card = await screen.findByTestId('bn-risk-control-execution-queue');
    expect(card).toHaveTextContent('41 item(s)');
    expect(card).toHaveTextContent('(12)');
    expect(card).toHaveTextContent('(7)');
  });

  it('never reports zero work when the queue query fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { BnRiskControlExecutionQueue: Q } =
      await import('@/components/bn/risk/BnRiskControlExecutionQueue');
    renderWith(<Q onOpenExecution={() => {}} />);
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/No approved control is awaiting execution/i)).toBeNull();
  });

  it('keeps completed executions in an actionable outcome-pending bucket', () => {
    expect(BACKEND_SQL).toContain("WHEN b.exec_status = 'COMPLETED' THEN 'AWAITING_OUTCOME'");
    expect(BACKEND_SQL).toContain("WHEN 'AWAITING_OUTCOME'   THEN 'Execution complete — awaiting outcome'");
  });

  it('deep links into the execution section of the workspace', async () => {
    rpc.mockResolvedValue(ok(queue()));
    const opened: string[] = [];
    const { BnRiskControlExecutionQueue: Q } =
      await import('@/components/bn/risk/BnRiskControlExecutionQueue');
    renderWith(<Q onOpenExecution={(id) => opened.push(id)} />);
    fireEvent.click(await screen.findByRole('button', { name: /open execution/i }));
    expect(opened).toEqual(['as-1']);

    const page = readSrc('pages/bn/risk/BnRiskManagementPage.tsx');
    expect(page).toContain('onOpenExecution={openControlExecution}');
    expect(page).toContain("setFocusExecution(true)");
    const workspace = readSrc('components/bn/risk/BnRiskAssessmentWorkspace.tsx');
    expect(workspace).toContain("focusSection === 'execution'");
    expect(workspace).toContain('BnRiskControlExecutionSection');
  });
});

/* ================================================================== */
/* 21–24. Privacy, restricted handoff data, audit chain, timeline     */
/* ================================================================== */

describe('Epic 4 — privacy, provenance and timeline', () => {
  it('keeps adverse control detail out of ordinary surfaces', () => {
    const surfaces = [
      readSrc('components/bn/risk/Benefit360RiskCard.tsx'),
    ];
    for (const s of surfaces) {
      expect(s).not.toMatch(/TEMPORARY_PAYMENT_HOLD|payment hold/i);
      expect(s).not.toMatch(/REFER_TO_LEGAL|legal referral/i);
      expect(s).not.toMatch(/REFER_TO_INVESTIGATION|investigation referral/i);
      expect(s).not.toMatch(/risk_score|score_band|\bband\b/i);
    }
  });

  it('publishes restricted control detail from the backend only', () => {
    expect(BACKEND_SQL).toContain("'control_code',  CASE WHEN v_restricted THEN f.control_code ELSE NULL END");
    const queueSrc = readSrc('components/bn/risk/BnRiskControlExecutionQueue.tsx');
    expect(queueSrc).toContain('restricted_detail_visible');
  });

  it('hides restricted execution detail from a non-restricted caller', async () => {
    rpc.mockResolvedValue(ok(readiness({
      restricted_detail_visible: false,
      state: 'PENDING', can_execute: false, available_action: 'NONE',
      execution_status: 'PENDING', current_execution: attempt(),
    })));
    const { BnRiskControlExecutionSection } =
      await import('@/components/bn/risk/BnRiskControlExecutionSection');
    renderWith(<BnRiskControlExecutionSection assessmentId="as-1" onChanged={() => {}} />);
    await screen.findByTestId('bn-risk-execution-section');
    expect(screen.queryByText(/Technical details/i)).toBeNull();
  });

  it('keeps the full provenance chain navigable', async () => {
    rpc.mockResolvedValue(ok(readiness({
      state: 'PENDING', available_action: 'REFRESH', can_execute: false,
      execution_status: 'PENDING', current_execution: attempt(), attempts: [attempt()],
    })));
    const { BnRiskControlExecutionSection } =
      await import('@/components/bn/risk/BnRiskControlExecutionSection');
    renderWith(<BnRiskControlExecutionSection assessmentId="as-1" onChanged={() => {}} />);
    const card = await screen.findByTestId('bn-risk-execution-section');
    expect(card).toHaveTextContent('RSK-REC-0001');
    expect(card).toHaveTextContent('Checker Two');
    expect(BACKEND_SQL).toContain("'score_version_no', v_r.score_version_no");
    expect(BACKEND_SQL).toContain("'decision_id', v_d.decision_id");
  });

  it('records officer-readable execution events without raw payload JSON', async () => {
    for (const ev of ['CONTROL_EXECUTION_REQUESTED', 'CONTROL_EXECUTION_ACCEPTED',
      'CONTROL_EXECUTION_COMPLETED', 'CONTROL_EXECUTION_FAILED',
      'CONTROL_EXECUTION_RETRY_REQUESTED', 'LEGAL_REFERRAL_REQUESTED',
      'LEGAL_REFERRAL_ACCEPTED', 'INVESTIGATION_REFERRAL_REQUESTED',
      'PAYMENT_HOLD_REQUESTED']) {
      expect(BACKEND_SQL).toContain(ev);
    }

    rpc.mockResolvedValue(ok(readiness({
      state: 'PROCESSING', can_execute: false, available_action: 'REFRESH',
      execution_status: 'ACCEPTED', current_execution: attempt({ status: 'ACCEPTED' }),
      history: [
        { event_code: 'CONTROL_EXECUTION_REQUESTED', label: 'Approved control submitted for execution', occurred_at: '2026-08-02T09:00:00Z', actor_name: 'Officer One', attempt_no: 1 },
        { event_code: 'CONTROL_EXECUTION_ACCEPTED', label: 'Owning domain accepted the request', occurred_at: '2026-08-02T10:00:00Z', actor_name: null, attempt_no: 1 },
      ],
    })));
    const { BnRiskControlExecutionSection } =
      await import('@/components/bn/risk/BnRiskControlExecutionSection');
    renderWith(<BnRiskControlExecutionSection assessmentId="as-1" onChanged={() => {}} />);
    const history = await screen.findByTestId('bn-risk-execution-history');
    expect(history).toHaveTextContent('Approved control submitted for execution');
    expect(history).toHaveTextContent('Owning domain accepted the request');
    expect(history.textContent).not.toMatch(/[{}]/);
  });

  it('never converts a requested control into a completed one in wording', () => {
    expect(paymentHoldStatusLabel('PENDING')).toBe('Hold requested');
    expect(paymentHoldStatusLabel('COMPLETED')).toBe('Hold active');
    const section = readSrc('components/bn/risk/BnRiskControlExecutionSection.tsx');
    expect(section).not.toMatch(/Payment stopped|Benefit suspended/i);
  });
});

/* ================================================================== */
/* 25–29. Architecture guards, non-duplication, failures, epic bound  */
/* ================================================================== */

describe('Epic 4 — architecture guards', () => {
  const FORBIDDEN_TABLES = [
    'bn_payment', 'bn_claim', 'bn_award', 'bn_person', 'bn_overpayment',
    'bn_legal', 'bn_investigation', 'core_person', 'bn_entitlement',
  ];

  it.each(EPIC4_SOURCES)('%s performs no direct table access', (rel) => {
    const src = readSrc(rel);
    expect(src).not.toMatch(/supabase\s*\.\s*from\s*\(/);
    for (const t of FORBIDDEN_TABLES) expect(src).not.toContain(`'${t}`);
  });

  it('routes every Epic 4 mutation through the governed command RPC', () => {
    const service = readSrc('services/bn/risk/riskControlExecutionService.ts');
    const rpcs = [...service.matchAll(/supabase\.rpc\('([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(rpcs).toEqual(['bn_risk_control_execution_command_v1']);
    expect(service).toContain('bn_risk_control_execution_readiness_v1');
    expect(service).toContain('bn_risk_control_execution_queue_v1');
  });

  it('reaches target domains only through the governed handoff spine', () => {
    const inserts = [...BACKEND_SQL.matchAll(/INSERT INTO public\.([a-z0-9_]+)/g)]
      .map((m) => m[1])
      .filter((t) => !t.startsWith('bn_risk_'));
    expect([...new Set(inserts)].sort()).toEqual(
      ['bn_cross_module_handoff', 'bn_cross_module_handoff_event'],
    );
  });

  it('never creates a duplicate payment hold across retries', () => {
    expect(BACKEND_SQL).toContain('-- Idempotency at the target: one live handoff per approved control.');
    expect(BACKEND_SQL).toContain("handoff_type = v_tb.handoff_type");
  });

  it('never creates a duplicate legal or investigation referral', () => {
    const guard = BACKEND_SQL.slice(BACKEND_SQL.indexOf('-- Idempotency at the target'));
    expect(guard).toContain("source_module = 'bn_risk'");
    expect(guard).toContain('source_record_id = v_r.recommendation_id');
  });

  it('covers the governed failure states', () => {
    for (const msg of [
      'E_CONTROL_EXECUTION_BLOCKED',
      'E_VERSION_CONFLICT',
      'E_UNAUTHENTICATED',
      'E_INVALID_STATE',
      'E_PARAMETER_DRIFT',
      'E_IDEMPOTENCY_PAYLOAD_MISMATCH',
    ]) expect(BACKEND_SQL).toContain(msg);
    expect(BACKEND_SQL).toContain('The owning domain could not complete this control request.');
    expect(BACKEND_SQL).toContain('The owning domain rejected this control request.');
  });

  it('surfaces a target failure without claiming completion', async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'bn_risk_control_execution_readiness_v1') return ok(readiness());
      return { data: null, error: { message: 'E_CONTROL_EXECUTION_BLOCKED: target unavailable' } };
    });
    const { BnRiskControlExecutionSection } =
      await import('@/components/bn/risk/BnRiskControlExecutionSection');
    renderWith(<BnRiskControlExecutionSection assessmentId="as-1" onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /execute approved control/i }));
    const dialog = await screen.findByTestId('bn-risk-execution-dialog');
    fireEvent.click(
      await within(dialog).findByRole('button', { name: /submit to owning domain/i }),
    );
    expect(await screen.findByText(/The control was not executed/i)).toBeInTheDocument();
  });

  it('executes no Epic 5 command', () => {
    for (const rel of EPIC4_SOURCES) {
      const src = readSrc(rel);
      for (const c of ['BN_RISK_RECORD_OUTCOME', 'BN_RISK_CLOSE_ASSESSMENT',
        'BN_RISK_REOPEN_ASSESSMENT', 'BN_RISK_UPDATE_RULE_FEEDBACK']) {
        expect(src).not.toContain(c);
      }
    }
    expect(BACKEND_SQL).not.toContain('BN_RISK_RECORD_OUTCOME');
    expect(BACKEND_SQL).not.toContain('BN_RISK_REOPEN_ASSESSMENT');
  });
});
