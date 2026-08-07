/**
 * BN Risk / Fraud — EPIC 0 foundation tests.
 *
 * Covers the command contract, the producer hand-off shape, the privacy-safe
 * 360 projection and the architecture rule that no browser code writes to a
 * `bn_risk_*` table directly.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  BN_RISK_IMPLEMENTED_COMMANDS,
  canonicalisePayload,
  parseCommandError,
  riskErrorMessage,
} from '@/services/bn/risk/riskCommandService';
import { BN_RISK_EPIC0_COMMANDS } from '@/types/bn/risk/riskSignals';
import { BN_RISK_CANONICAL_COMMANDS } from '@/types/bn/risk/riskCanonicalCommands';
import {
  canRiskSignalTransition,
} from '@/types/bn/risk/riskSignalStateMachine';

const SRC = path.resolve(__dirname, '../../../');

function readFile(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

describe('BN Risk Epic 0 — command catalogue', () => {
  it('implements exactly the five Epic 0 commands', () => {
    expect([...BN_RISK_IMPLEMENTED_COMMANDS].sort()).toEqual([...BN_RISK_EPIC0_COMMANDS].sort());
  });

  it('keeps every Epic 0 command inside the canonical 18-command catalogue', () => {
    const canonical = new Set(BN_RISK_CANONICAL_COMMANDS.map((c) => c.command));
    BN_RISK_EPIC0_COMMANDS.forEach((c) => expect(canonical.has(c)).toBe(true));
    expect(BN_RISK_CANONICAL_COMMANDS).toHaveLength(18);
  });

  it('never claims a benefit-affecting command is implemented', () => {
    ['BN_RISK_APPROVE_CONTROL', 'BN_RISK_PLACE_PAYMENT_HOLD', 'BN_RISK_REFER_TO_LEGAL']
      .forEach((c) => expect(BN_RISK_IMPLEMENTED_COMMANDS.has(c)).toBe(false));
  });
});

describe('BN Risk Epic 0 — command boundary behaviour', () => {
  it('produces a stable payload hash input regardless of key order', () => {
    expect(canonicalisePayload({ b: 1, a: 2 })).toBe(canonicalisePayload({ a: 2, b: 1 }));
  });

  it('parses governed SQL error codes', () => {
    expect(parseCommandError('E_STALE_ROW_VERSION: refresh').code).toBe('STALE_ROW_VERSION');
    expect(parseCommandError('E_PERMISSION_DENIED: decide').code).toBe('PERMISSION_DENIED');
    expect(parseCommandError('boom').code).toBe('UNKNOWN');
  });

  it('surfaces business-readable messages without SQL wording', () => {
    const message = riskErrorMessage('INVALID_STATE');
    expect(message).not.toMatch(/E_|row_version|rpc/i);
    expect(message.length).toBeGreaterThan(10);
  });
});

describe('BN Risk Epic 0 — signal lifecycle', () => {
  it('allows the triage and dismissal paths only from open states', () => {
    expect(canRiskSignalTransition('NEW', 'TRIAGED')).toBe(true);
    expect(canRiskSignalTransition('TRIAGED', 'LINKED')).toBe(true);
    expect(canRiskSignalTransition('LINKED', 'UNDER_REVIEW')).toBe(true);
    expect(canRiskSignalTransition('DISMISSED', 'TRIAGED')).toBe(false);
    expect(canRiskSignalTransition('CLOSED', 'TRIAGED')).toBe(false);
  });
});

describe('BN Risk Epic 0 — architecture boundary', () => {
  const uiFiles = [
    'pages/bn/risk/BnRiskManagementPage.tsx',
    'components/bn/risk/BnRiskSignalQueue.tsx',
    'components/bn/risk/BnRiskSignalDetailPanel.tsx',
    'components/bn/risk/BnRiskTriageDialog.tsx',
    'components/bn/risk/BnRiskLinkSignalsDialog.tsx',
    'components/bn/risk/BnRiskDismissDialog.tsx',
    'components/bn/risk/BnRiskManualSignalDialog.tsx',
    'components/bn/risk/Benefit360RiskCard.tsx',
  ];

  it('never touches bn_risk_* tables directly from the browser', () => {
    uiFiles.forEach((file) => {
      const content = readFile(file);
      expect(content).not.toMatch(/\.from\(['"]bn_risk_/);
    });
  });

  it('routes every mutation through the governed command service', () => {
    const dialogs = uiFiles.filter((f) => f.includes('Dialog'));
    dialogs.forEach((file) => {
      expect(readFile(file)).toContain('riskCommandService');
    });
  });

  it('keeps the risk page free of placeholder pilot copy', () => {
    const page = readFile('pages/bn/risk/BnRiskManagementPage.tsx');
    expect(page).not.toContain('BnModuleReadOnlyPilotNotice');
    expect(page).toContain('BnRiskSignalQueue');
  });
});

describe('BN Risk Epic 0 — producer hand-off and 360 privacy', () => {
  it('exposes module-specific hand-off helpers that use the generate command', () => {
    const intake = readFile('services/bn/risk/riskSignalIntake.ts');
    expect(intake).toContain('BN_RISK_GENERATE_SIGNAL');
    ['raiseMeansTestRiskSignal', 'raiseMortalityRiskSignal', 'raisePaymentRiskSignal']
      .forEach((fn) => expect(intake).toContain(fn));
    expect(intake).not.toMatch(/\.from\(['"]bn_risk_/);
  });

  it('keeps the Benefit 360 card limited to review status', () => {
    const card = readFile('components/bn/risk/Benefit360RiskCard.tsx');
    expect(card).toContain('personSafeSummary');
    expect(card).not.toMatch(/category|rule_code|justification|evidence/i);
  });
});
