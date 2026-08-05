/**
 * BN Medical Reviews — frontend service architecture assertions.
 *
 * These are static, source-level guarantees. They fail the build if a future
 * change reintroduces a direct browser mutation, drops an idempotency key,
 * skips optimistic concurrency, or leaks raw database text into the UI.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const COMMAND_SERVICE = 'src/services/bn/medicalReviewCommandService.ts';
const QUERY_SERVICE = 'src/services/bn/medicalReviewQueryService.ts';
const ERRORS = 'src/features/bn/medical-reviews/model/errors.ts';
const PERMISSIONS = 'src/features/bn/medical-reviews/model/permissions.ts';
const HOOK = 'src/hooks/bn/useMedicalReviewActionsState.ts';

const SURFACES = [
  'src/pages/bn/servicing/MedicalReviewCentre.tsx',
  'src/pages/bn/servicing/medical-reviews/MedicalBoardWorkspace.tsx',
  'src/portals/doctor/medical-reviews/MedicalProviderReferralWorkspace.tsx',
  'src/components/bn/medical-reviews/MedicalReviewDetailPanel.tsx',
  'src/components/bn/medical-reviews/MedicalReviewActionControls.tsx',
];

function walk(dir: string): string[] {
  const abs = join(root, dir);
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.tsx?$/.test(entry)) out.push(rel);
  }
  return out;
}

const MR_SOURCES = [
  ...walk('src/features/bn/medical-reviews'),
  ...walk('src/components/bn/medical-reviews'),
  ...walk('src/portals/doctor/medical-reviews'),
  ...walk('src/pages/bn/servicing/medical-reviews'),
  'src/pages/bn/servicing/MedicalReviewCentre.tsx',
  COMMAND_SERVICE,
  QUERY_SERVICE,
  HOOK,
];

describe('Medical Review services — no direct browser table access', () => {
  it('never selects, inserts, updates or deletes a bn_medical_review table', () => {
    for (const file of MR_SOURCES) {
      const src = read(file);
      expect(src, file).not.toMatch(/\.from\(\s*['"]bn_medical/);
      expect(src, file).not.toMatch(/\.insert\(/);
      expect(src, file).not.toMatch(/\.update\(/);
      expect(src, file).not.toMatch(/\.delete\(/);
      expect(src, file).not.toMatch(/\.upsert\(/);
    }
  });

  it('reads app_modules only for the authoritative dark-launch flag', () => {
    const hook = read(HOOK);
    expect(hook).toContain("from('app_modules')");
    expect(hook).toContain('actions_enabled');
    expect(hook).toContain("eq('name', MEDICAL_REVIEW_MODULE_NAME)");
    // Fails closed.
    expect(hook).toContain("actionsEnabled: settled && data!.actions_enabled === true");
  });

  it('routes every read through a versioned query RPC', () => {
    const src = read(QUERY_SERVICE);
    const calls = src.match(/callQuery\('([a-z0-9_]+)'/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(18);
    for (const call of calls) {
      expect(call).toMatch(/bn_medical_review_[a-z0-9_]+_v1/);
    }
  });
});

describe('Medical Review command service — envelope discipline', () => {
  const src = read(COMMAND_SERVICE);

  it('routes every command through a versioned command RPC', () => {
    const calls = src.match(/callCommand\('([a-z0-9_]+)'/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(45);
    for (const call of calls) {
      expect(call).toMatch(/bn_medical_review_[a-z0-9_]+_v1/);
    }
  });

  it('supplies an idempotency key on every mutating command', () => {
    // Every command body that is not the read-only preview must pass a key.
    const bodies = src.split(/\n  [a-zA-Z]+\(/).slice(1);
    for (const body of bodies) {
      if (!body.includes('callCommand(')) continue;
      if (body.includes('bn_medical_review_preview_obligation_v1')) continue;
      expect(body).toContain('p_idempotency_key');
    }
  });

  it('generates a UUID idempotency key rather than a constant', () => {
    expect(src).toContain('newIdempotencyKey');
    expect(src).toContain('randomUUID');
  });

  it('passes expected_row_version wherever the RPC declares it', () => {
    expect(src).toContain('p_expected_row_version: opts.expectedRowVersion');
    const versioned = src.match(/p_expected_row_version/g) ?? [];
    expect(versioned.length).toBeGreaterThanOrEqual(25);
  });

  it('surfaces replay and terminal no-op outcomes distinctly', () => {
    expect(src).toContain("replayed: status === 'REPLAYED'");
    expect(src).toContain("noOp: status === 'NO_OP'");
  });

  it('keeps the Award Suspension boundary as a proposal only', () => {
    expect(src).toContain('bn_medical_review_propose_suspension_v1');
    expect(src).toContain('bn_medical_review_propose_reinstatement_v1');
    expect(src).not.toMatch(/bn_award_suspension_execute/);
    expect(src).not.toMatch(/from\(['"]bn_award/);
  });
});

describe('Medical Review error model', () => {
  const src = read(ERRORS);

  it('maps backend codes to controlled UI states', () => {
    for (const code of [
      'E_FORBIDDEN',
      'E_RECORD_FORBIDDEN',
      'E_VERSION_CONFLICT',
      'E_INVALID_STATE_TRANSITION',
      'E_SELF_APPROVAL_FORBIDDEN',
      'E_QUORUM_NOT_MET',
      'E_PROVIDER_CONFLICT_RESTRICTED',
      'E_POLICY_INVALID',
      'E_FEATURE_DISABLED',
    ]) {
      expect(src).toContain(code);
    }
  });

  it('never echoes raw database text back to the caller', () => {
    expect(src).toContain('MEDICAL_REVIEW_ERRORS[code].message');
    // The only `.message` returned is the curated one carried by
    // MedicalReviewError; an unknown throwable falls back to E_UNKNOWN.
    const describe_ = src.slice(src.indexOf('export function describeMedicalReviewFailure'));
    expect(describe_).toContain('err instanceof MedicalReviewError');
    expect(describe_).toContain('MEDICAL_REVIEW_ERRORS.E_UNKNOWN.message');
    expect(describe_).not.toMatch(/\(err as [^)]*\)\.message/);
    expect(describe_).not.toContain('String(err)');
  });

  it('matches longest code first so terminal codes are not shadowed', () => {
    expect(src).toContain('MATCH_ORDER');
    expect(src).toContain('b.length - a.length');
  });
});

describe('Medical Review permission catalogue', () => {
  const src = read(PERMISSIONS);

  it('mirrors the registered permission key namespace', () => {
    expect(src).toContain('`bn.medical_review.${action}`');
    expect(src).toContain("MEDICAL_REVIEW_MODULE_CODE = 'bn_medical_review'");
  });

  it('separates medical evidence from administrative decision authority', () => {
    expect(src).toContain('viewConfidentialMedicalEvidence');
    expect(src).toContain('recordBoardDetermination');
    expect(src).toContain('prepareDecision');
    expect(src).toContain('approveDecision');
  });
});

describe('Medical Review actor surfaces', () => {
  it('gates every mutating control behind the shared action button', () => {
    for (const file of SURFACES) {
      const src = read(file);
      if (file.endsWith('MedicalReviewActionControls.tsx')) continue;
      if (!src.includes('MedicalReviewActionButton')) continue;
      // The authoritative flag is either read from the hook on a route-level
      // surface, or passed down as a prop to a nested panel. Either way it must
      // reach the shared button — no surface may hard-code `true`.
      expect(
        src.includes('actionsEnabled={actionsState.actionsEnabled}') ||
          src.includes('actionsEnabled={actionsEnabled}'),
        file,
      ).toBe(true);
      expect(src, file).not.toContain('actionsEnabled={true}');
    }
  });

  it('keeps the provider portal free of Benefits and Board surfaces', () => {
    const src = read('src/portals/doctor/medical-reviews/MedicalProviderReferralWorkspace.tsx');
    expect(src).toContain('bn_medical_review_provider_worklist_v1'.replace(/.*/, 'providerWorklist'));
    expect(src).not.toContain('boardWorklist');
    expect(src).not.toContain('approveDecision');
    expect(src).not.toContain('proposeSuspension');
    expect(src).not.toContain('awardContext');
  });

  it('keeps the Board workspace free of administrative approval and award mutation', () => {
    const src = read('src/pages/bn/servicing/medical-reviews/MedicalBoardWorkspace.tsx');
    expect(src).toContain('boardWorklist');
    expect(src).not.toContain('MEDICAL_REVIEW_ACTIONS.approveDecision');
    expect(src).not.toContain('MEDICAL_REVIEW_ACTIONS.proposeSuspension');
    expect(src).not.toContain('MEDICAL_REVIEW_ACTIONS.proposeReinstatement');
  });

  it('never renders a hard-coded dark-launch constant', () => {
    for (const file of SURFACES) {
      const src = read(file);
      expect(src, file).not.toMatch(/actionsEnabled\s*=\s*(true|false)\b/);
    }
  });
});
