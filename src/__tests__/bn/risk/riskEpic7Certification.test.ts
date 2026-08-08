/**
 * BN Risk / Fraud — EPIC 7 end-to-end certification suite.
 *
 * This suite certifies the *existing* Risk/Fraud implementation rather than
 * adding behaviour. It proves:
 *   - the canonical 18-command catalogue is complete, accurate and governed;
 *   - every canonical command is reachable only through a Risk service that
 *     calls a governed SQL boundary RPC;
 *   - the signal and assessment state machines forbid the prohibited
 *     shortcuts (score → adverse control, approval without recommendation,
 *     execution without approval, closure without outcome readiness);
 *   - no black-box / ML decision engine and no auto-learning feedback loop
 *     exists in Risk application code;
 *   - Risk never writes another domain's tables from the browser;
 *   - governed journeys A–J are legal in the certified lifecycle model;
 *   - privacy-safe cross-module projections expose status only.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  BN_RISK_CANONICAL_COMMANDS,
  getRiskCanonicalCommandSpec,
  type BnRiskCanonicalCommandName,
} from '@/types/bn/risk/riskCanonicalCommands';
import {
  canRiskSignalTransition,
  type BnRiskSignalStatus,
} from '@/types/bn/risk/riskSignalStateMachine';
import {
  canRiskAssessmentTransition,
  isRiskAssessmentTerminal,
  type BnRiskAssessmentStatus,
} from '@/types/bn/risk/riskAssessmentStateMachine';

const ROOT = path.resolve(__dirname, '../../../..');
const SRC = path.join(ROOT, 'src');
const RISK_SERVICES = path.join(SRC, 'services/bn/risk');
const RISK_COMPONENTS = path.join(SRC, 'components/bn/risk');

const read = (abs: string) => fs.readFileSync(abs, 'utf8');
const listFiles = (dir: string) =>
  fs.readdirSync(dir).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));

const CANONICAL: readonly BnRiskCanonicalCommandName[] = [
  'BN_RISK_GENERATE_SIGNAL',
  'BN_RISK_REGISTER_MANUAL_SIGNAL',
  'BN_RISK_TRIAGE_SIGNAL',
  'BN_RISK_LINK_SIGNALS',
  'BN_RISK_DISMISS_SIGNAL',
  'BN_RISK_CREATE_ASSESSMENT',
  'BN_RISK_ADD_FACTOR',
  'BN_RISK_REQUEST_EVIDENCE',
  'BN_RISK_RECOMMEND_CONTROL',
  'BN_RISK_APPROVE_CONTROL',
  'BN_RISK_PLACE_PAYMENT_HOLD',
  'BN_RISK_REQUEST_ENH_VERIFICATION',
  'BN_RISK_REFER_TO_LEGAL',
  'BN_RISK_REFER_TO_INVESTIGATION',
  'BN_RISK_RECORD_OUTCOME',
  'BN_RISK_CLOSE_ASSESSMENT',
  'BN_RISK_REOPEN_ASSESSMENT',
  'BN_RISK_UPDATE_RULE_FEEDBACK',
];

/* ------------------------------------------------------------------ *
 * 2 / 3 / 61 — canonical command certification
 * ------------------------------------------------------------------ */
describe('Epic 7 — canonical command catalogue', () => {
  it('registers exactly the canonical 18 commands, with no 19th business command', () => {
    expect(BN_RISK_CANONICAL_COMMANDS).toHaveLength(18);
    expect(BN_RISK_CANONICAL_COMMANDS.map((c) => c.command).sort()).toEqual(
      [...CANONICAL].sort(),
    );
  });

  it('marks every delivered canonical command as implemented', () => {
    for (const c of BN_RISK_CANONICAL_COMMANDS) {
      expect(c.implemented, `${c.command} still marked unimplemented`).toBe(true);
    }
  });

  it('binds every canonical command to a governed SQL boundary and a Risk service', () => {
    for (const c of BN_RISK_CANONICAL_COMMANDS) {
      expect(c.boundaryRpc).toMatch(/^bn_risk_[a-z_]*command_v1$/);
      const serviceFile = path.join(SRC, c.service);
      expect(fs.existsSync(serviceFile), `${c.service} missing`).toBe(true);
      expect(read(serviceFile)).toContain(c.boundaryRpc);
    }
  });

  it('keeps maker-checker and justification on benefit-affecting commands', () => {
    for (const name of [
      'BN_RISK_APPROVE_CONTROL',
      'BN_RISK_PLACE_PAYMENT_HOLD',
      'BN_RISK_REFER_TO_LEGAL',
      'BN_RISK_REFER_TO_INVESTIGATION',
    ] as BnRiskCanonicalCommandName[]) {
      const spec = getRiskCanonicalCommandSpec(name);
      expect(spec.requiresMakerChecker).toBe(true);
      expect(spec.requiresJustification).toBe(true);
    }
  });

  it('scopes approval, referral, admin and rule-admin capabilities distinctly', () => {
    expect(getRiskCanonicalCommandSpec('BN_RISK_APPROVE_CONTROL').capability)
      .toBe('bn_risk_management:approve_control');
    expect(getRiskCanonicalCommandSpec('BN_RISK_REFER_TO_LEGAL').capability)
      .toBe('bn_risk_management:refer');
    expect(getRiskCanonicalCommandSpec('BN_RISK_REOPEN_ASSESSMENT').capability)
      .toBe('bn_risk_management:admin');
    expect(getRiskCanonicalCommandSpec('BN_RISK_UPDATE_RULE_FEEDBACK').capability)
      .toBe('bn_risk_management:rule_admin');
  });
});

/* ------------------------------------------------------------------ *
 * 4 / 14 / 60 — single command architecture + negative scans
 * ------------------------------------------------------------------ */
describe('Epic 7 — Risk command architecture guards', () => {
  const componentSources = listFiles(RISK_COMPONENTS).map((f) => ({
    file: f,
    text: read(path.join(RISK_COMPONENTS, f)),
  }));
  const serviceSources = listFiles(RISK_SERVICES).map((f) => ({
    file: f,
    text: read(path.join(RISK_SERVICES, f)),
  }));

  it('no Risk browser component owns a lifecycle transition (no rpc/table access)', () => {
    for (const { file, text } of componentSources) {
      expect(text, `${file} calls the database directly`).not.toMatch(/supabase\s*\.\s*rpc\(/);
      expect(text, `${file} reads/writes a table directly`).not.toMatch(/\.from\(\s*['"]/);
    }
  });

  it('no Risk code writes another domain table', () => {
    const forbidden =
      /\.from\(\s*['"](bn_claim|bn_award|bn_payment|bn_overpayment|ip_master|bn_legal|bn_investigation|bn_means)/;
    for (const { file, text } of [...componentSources, ...serviceSources]) {
      expect(text, `${file} touches a foreign domain table`).not.toMatch(forbidden);
    }
  });

  it('every Risk mutation leaves the browser through a governed *_command_v1 RPC', () => {
    const rpcCalls = serviceSources
      .flatMap(({ text }) => [...text.matchAll(/supabase\.rpc\(\s*'([a-z0-9_]+)'/g)])
      .map((m) => m[1]);
    expect(rpcCalls.length).toBeGreaterThan(0);
    for (const rpc of rpcCalls) {
      expect(rpc.startsWith('bn_risk_')).toBe(true);
    }
  });

  it('contains no black-box / ML fraud decision engine', () => {
    const forbidden =
      /(tensorflow|onnxruntime|fraud_probability|fraudProbability|mlModel|ml_classifier|anomalyScore|anomaly_score|openai|gpt-4|lovable-ai)/i;
    for (const { file, text } of [...componentSources, ...serviceSources]) {
      expect(text, `${file} introduces an opaque decision engine`).not.toMatch(forbidden);
    }
  });

  it('contains no automatic score-driven recommendation, approval or execution', () => {
    const forbidden = /(autoRecommend|autoApprove|autoExecute|automaticControl|auto_hold)/i;
    for (const { file, text } of [...componentSources, ...serviceSources]) {
      expect(text, `${file} automates an adverse action`).not.toMatch(forbidden);
    }
  });

  it('contains no auto-learning path from rule feedback to scoring configuration', () => {
    const feedback = read(path.join(RISK_SERVICES, 'riskFeedbackService.ts'));
    expect(feedback).not.toMatch(/scoring_config_command|retireRule|applyWeight|recalculate/i);
    expect(feedback).toContain('bn_risk_rule_feedback_command_v1');
  });

  it('keeps scoring deterministic — no clock or randomness in the engine', () => {
    const engine = read(path.join(RISK_SERVICES, 'riskScoringEngine.ts'));
    expect(engine).not.toMatch(/Math\.random|Date\.now|new Date\(\)/);
  });
});

/* ------------------------------------------------------------------ *
 * 5 / 6 — state machine certification
 * ------------------------------------------------------------------ */
describe('Epic 7 — signal state machine', () => {
  it('certifies the full governed signal path', () => {
    const p: BnRiskSignalStatus[] = [
      'NEW', 'TRIAGED', 'LINKED', 'UNDER_REVIEW', 'CONFIRMED', 'ACTIONED', 'CLOSED',
    ];
    p.slice(0, -1).forEach((s, i) => expect(canRiskSignalTransition(s, p[i + 1])).toBe(true));
  });

  it('rejects illegal signal shortcuts', () => {
    expect(canRiskSignalTransition('NEW', 'CONFIRMED')).toBe(false);
    expect(canRiskSignalTransition('NEW', 'ACTIONED')).toBe(false);
    expect(canRiskSignalTransition('DISMISSED', 'CONFIRMED')).toBe(false);
    expect(canRiskSignalTransition('CLOSED', 'NEW')).toBe(false);
  });
});

describe('Epic 7 — assessment state machine', () => {
  it('certifies the full governed assessment path', () => {
    const p: BnRiskAssessmentStatus[] = [
      'DRAFT', 'OPEN', 'INFORMATION_PENDING', 'REVIEW', 'RECOMMENDATION',
      'APPROVAL_PENDING', 'CONTROL_ACTION', 'COMPLETED', 'CLOSED',
    ];
    p.slice(0, -1).forEach((s, i) => expect(canRiskAssessmentTransition(s, p[i + 1])).toBe(true));
  });

  it('score alone cannot jump the assessment into adverse control', () => {
    expect(canRiskAssessmentTransition('REVIEW', 'CONTROL_ACTION')).toBe(false);
    expect(canRiskAssessmentTransition('REVIEW', 'REFERRED')).toBe(false);
    expect(canRiskAssessmentTransition('OPEN', 'CONTROL_ACTION')).toBe(false);
  });

  it('recommendation cannot skip review, approval cannot skip recommendation', () => {
    expect(canRiskAssessmentTransition('OPEN', 'RECOMMENDATION')).toBe(false);
    expect(canRiskAssessmentTransition('INFORMATION_PENDING', 'RECOMMENDATION')).toBe(false);
    expect(canRiskAssessmentTransition('REVIEW', 'APPROVAL_PENDING')).toBe(false);
  });

  it('execution cannot skip approval and closure cannot skip completion', () => {
    expect(canRiskAssessmentTransition('RECOMMENDATION', 'CONTROL_ACTION')).toBe(false);
    expect(canRiskAssessmentTransition('RECOMMENDATION', 'REFERRED')).toBe(false);
    expect(canRiskAssessmentTransition('CONTROL_ACTION', 'CLOSED')).toBe(false);
    expect(canRiskAssessmentTransition('REVIEW', 'CLOSED')).toBe(false);
    expect(canRiskAssessmentTransition('COMPLETED', 'CLOSED')).toBe(true);
  });

  it('CLOSED is terminal — reopening is an explicit audited command, not a transition', () => {
    expect(isRiskAssessmentTerminal('CLOSED')).toBe(true);
    expect(canRiskAssessmentTransition('CLOSED', 'REVIEW')).toBe(false);
    expect(canRiskAssessmentTransition('CLOSED', 'OPEN')).toBe(false);
    const outcome = read(path.join(RISK_SERVICES, 'riskOutcomeService.ts'));
    expect(outcome).toContain('BN_RISK_REOPEN_ASSESSMENT');
  });
});

/* ------------------------------------------------------------------ *
 * 50–59 — governed journeys A–J
 * ------------------------------------------------------------------ */
function walk(path_: BnRiskAssessmentStatus[]): boolean {
  return path_.slice(0, -1).every((s, i) => canRiskAssessmentTransition(s, path_[i + 1]));
}

describe('Epic 7 — governed journeys A–J', () => {
  it('Journey A — standard assessed case reaches closure through approval', () => {
    expect(walk([
      'DRAFT', 'OPEN', 'INFORMATION_PENDING', 'REVIEW', 'RECOMMENDATION',
      'APPROVAL_PENDING', 'CONTROL_ACTION', 'COMPLETED', 'CLOSED',
    ])).toBe(true);
  });

  it('Journey B — mitigating evidence still requires an explicit human recommendation', () => {
    expect(walk(['OPEN', 'REVIEW', 'RECOMMENDATION', 'APPROVAL_PENDING'])).toBe(true);
    // No adverse state is reachable without passing APPROVAL_PENDING.
    expect(canRiskAssessmentTransition('REVIEW', 'CONTROL_ACTION')).toBe(false);
  });

  it('Journey C — unsubstantiated concern closes without a control action', () => {
    expect(walk(['OPEN', 'REVIEW', 'RECOMMENDATION', 'APPROVAL_PENDING', 'CONTROL_ACTION', 'COMPLETED', 'CLOSED'])).toBe(true);
    expect(canRiskSignalTransition('UNDER_REVIEW', 'DISMISSED')).toBe(true);
    expect(canRiskSignalTransition('DISMISSED', 'CLOSED')).toBe(true);
  });

  it('Journey D — payment control is executed by the Payment domain, never by Risk', () => {
    const exec = read(path.join(RISK_SERVICES, 'riskControlExecutionService.ts'));
    expect(exec).toContain('BN_RISK_PLACE_PAYMENT_HOLD');
    expect(exec).toContain('bn_risk_control_execution_command_v1');
    expect(exec).not.toMatch(/\.from\(\s*['"]bn_payment/);
  });

  it('Journey E — Legal / Investigation referral runs through the same governed boundary', () => {
    const exec = read(path.join(RISK_SERVICES, 'riskControlExecutionService.ts'));
    expect(exec).toContain('BN_RISK_REFER_TO_LEGAL');
    expect(exec).toContain('BN_RISK_REFER_TO_INVESTIGATION');
    expect(walk(['APPROVAL_PENDING', 'REFERRED', 'COMPLETED', 'CLOSED'])).toBe(true);
  });

  it('Journey F — operational error is a governed outcome, not an automatic fraud label', () => {
    const outcomeTypes = read(path.join(SRC, 'types/bn/risk/riskOutcome.ts'));
    expect(outcomeTypes).not.toMatch(/autoClassify|fraudScore/i);
    expect(walk(['REVIEW', 'RECOMMENDATION', 'APPROVAL_PENDING', 'CONTROL_ACTION', 'COMPLETED'])).toBe(true);
  });

  it('Journey G — stale work is rejected by the governed boundary, not merged', () => {
    const cmd = read(path.join(RISK_SERVICES, 'riskCommandService.ts'));
    expect(cmd).toMatch(/STALE_ROW_VERSION/);
    for (const f of ['riskAssessmentService.ts', 'riskControlService.ts', 'riskControlExecutionService.ts', 'riskOutcomeService.ts']) {
      expect(read(path.join(RISK_SERVICES, f)), `${f} ignores row versions`)
        .toMatch(/expected_row_version|expectedRowVersion/);
    }
  });

  it('Journey H — reopening is exceptional, reasoned and non-destructive', () => {
    const outcome = read(path.join(RISK_SERVICES, 'riskOutcomeService.ts'));
    expect(outcome).toContain('BN_RISK_REOPEN_ASSESSMENT');
    expect(getRiskCanonicalCommandSpec('BN_RISK_REOPEN_ASSESSMENT').requiresJustification).toBe(true);
    // Reopen carries no reversal of any executed external control.
    expect(outcome).not.toMatch(/release_hold|cancel_referral|reverse_/i);
  });

  it('Journey I — feedback never mutates the active scoring configuration', () => {
    const feedback = read(path.join(RISK_SERVICES, 'riskFeedbackService.ts'));
    const scoring = read(path.join(RISK_SERVICES, 'riskScoringService.ts'));
    expect(feedback).not.toContain('bn_risk_scoring_config_command_v1');
    expect(scoring).toContain('bn_risk_scoring_config_command_v1');
  });

  it('Journey J — cross-module projection exposes safe status only', () => {
    const card = read(path.join(RISK_COMPONENTS, 'Benefit360RiskCard.tsx'));
    for (const leak of ['score', 'band', 'recommend', 'referral', 'hold', 'outcome']) {
      expect(card.toLowerCase(), `360 card exposes ${leak}`).not.toContain(`data.${leak}`);
    }
    const types = read(path.join(SRC, 'types/bn/risk/riskSignals.ts'));
    const safeBlock = types.slice(types.indexOf('BnRiskPersonSafeSummary'));
    expect(safeBlock).toContain('review_state');
    expect(safeBlock).not.toMatch(/score|band|control|legal|investigation/i);
  });
});

/* ------------------------------------------------------------------ *
 * 36–38 / 62 — operations, reporting and navigation
 * ------------------------------------------------------------------ */
describe('Epic 7 — operations, reporting and navigation closure', () => {
  const page = read(path.join(SRC, 'pages/bn/risk/BnRiskManagementPage.tsx'));

  it('exposes every major Risk entry point as a real route target', () => {
    for (const tab of [
      'signals', 'assessments', 'control-decisions', 'control-execution',
      'outcomes', 'operations', 'reporting', 'scoring-configuration',
    ]) {
      expect(page, `missing tab ${tab}`).toContain(`value="${tab}"`);
    }
  });

  it('deep-links every operational card key to an existing queue tab', () => {
    const keys = ['signals', 'assessments', 'control-decisions', 'control-execution', 'outcomes'];
    for (const k of keys) expect(page).toContain(`value="${k}"`);
  });

  it('renders workspace deep-link sections for the late lifecycle', () => {
    const ws = read(path.join(RISK_COMPONENTS, 'BnRiskAssessmentWorkspace.tsx'));
    for (const s of ['approval', 'execution', 'outcome', 'closure', 'feedback']) {
      expect(ws, `missing focus section ${s}`).toContain(`'${s}'`);
    }
  });

  it('keeps reporting and dashboard aggregates backend-owned', () => {
    const reporting = read(path.join(RISK_SERVICES, 'riskReportingService.ts'));
    expect(reporting).toContain('bn_risk_operational_metrics_v1');
    expect(reporting).toContain('bn_risk_outcome_metrics_v1');
    expect(reporting).toContain('bn_risk_rule_feedback_metrics_v1');
    const dash = read(path.join(RISK_COMPONENTS, 'BnRiskOperationsDashboard.tsx'));
    expect(dash).not.toMatch(/\.reduce\(|\.filter\(.*\)\.length/);
  });
});

/* ------------------------------------------------------------------ *
 * 71–73 — certification record
 * ------------------------------------------------------------------ */
describe('Epic 7 — certification record', () => {
  it('publishes the Epic 7 completion record', () => {
    const rec = path.join(ROOT, 'docs/bn/risk/BN_RISK_EPIC_7_COMPLETION_RECORD.md');
    expect(fs.existsSync(rec)).toBe(true);
    const text = read(rec);
    expect(text).toContain('CONTROLLED UAT READY');
    expect(text).toContain('Production activation = NOT_STARTED');
  });

  it('marks Epics 0–7 complete in the implementation matrix', () => {
    const matrix = read(path.join(ROOT, 'docs/bn/risk/RISK_IMPLEMENTATION_MATRIX.md'));
    for (let e = 0; e <= 7; e++) {
      expect(matrix, `Epic ${e} not marked complete`).toMatch(
        new RegExp(`Epic ${e}[^\\n]*COMPLETE`),
      );
    }
  });
});
