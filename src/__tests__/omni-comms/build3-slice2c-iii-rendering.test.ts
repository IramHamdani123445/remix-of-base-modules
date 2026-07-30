/**
 * Accelerated Build 3 — Slice 2c-iii
 * Deterministic rendering, message persistence, held jobs and timeline.
 *
 * Slice 2c-iii is implementation-only: these tests assert structure,
 * determinism guards, boundary enforcement and the absence of any live
 * send capability. Runtime semantics remain certification-gated.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  RepositoryScan,
  ScannedFile,
} from '@/platform/omni-comms/architecture/architectureCheck.types';
import { checkResolverBoundary } from '@/platform/omni-comms/architecture';
import { OMNI_COMMS_READINESS_MANIFEST } from '@/platform/omni-comms/registry/readinessManifest';

const ROOT = process.cwd();
const RENDER_DIR = 'supabase/functions/omni-comms-runtime/rendering';

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

function scan(files: ScannedFile[]): RepositoryScan {
  return {
    files,
    routeSource: null,
    migrations: [],
    edgeFunctionDirs: [],
  } as unknown as RepositoryScan;
}

const RENDER_FILES = [
  'renderingTypes.ts',
  'renderingErrors.ts',
  'checksum.ts',
  'tokenResolver.ts',
  'slotRenderer.ts',
  'layoutRenderer.ts',
  'snapshotRevalidator.ts',
  'renderMessage.ts',
  'renderOrchestrator.ts',
];

describe('Slice 2c-iii — rendering package structure', () => {
  it('contains exactly the nine expected modules', () => {
    const actual = readdirSync(resolve(ROOT, RENDER_DIR)).sort();
    expect(actual).toEqual([...RENDER_FILES].sort());
  });

  it.each(RENDER_FILES)('%s exists and is non-empty', (file) => {
    const content = read(`${RENDER_DIR}/${file}`);
    expect(content.length).toBeGreaterThan(50);
  });

  it('declares the bounded rendering blocker vocabulary', () => {
    const src = read(`${RENDER_DIR}/renderingErrors.ts`);
    for (const code of [
      'template_snapshot_invalid',
      'layout_snapshot_invalid',
      'asset_snapshot_invalid',
      'unresolved_required_token',
      'unresolved_required_slot',
      'rendered_subject_too_large',
      'rendered_html_too_large',
      'rendered_text_too_large',
      'rendering_failed',
    ]) {
      expect(src).toContain(code);
    }
  });

  it('declares the snapshot revalidation vocabulary', () => {
    const src = read(`${RENDER_DIR}/renderingErrors.ts`);
    for (const code of [
      'resolution_snapshot_missing',
      'snapshot_row_missing',
      'snapshot_checksum_mismatch',
      'snapshot_version_mutated',
      'snapshot_ownership_mismatch',
    ]) {
      expect(src).toContain(code);
    }
  });

  it('mirrors the message size limits', () => {
    const src = read(`${RENDER_DIR}/renderingTypes.ts`);
    expect(src).toContain('subjectMaxChars: 998');
    expect(src).toContain('htmlMaxBytes: 1048576');
    expect(src).toContain('textMaxBytes: 262144');
  });
});

describe('Slice 2c-iii — determinism of the rendering package', () => {
  it.each(RENDER_FILES)('%s performs no clock read, randomness or I/O', (file) => {
    const src = read(`${RENDER_DIR}/${file}`);
    expect(src).not.toMatch(/\bDate\s*\.\s*now\s*\(/);
    expect(src).not.toMatch(/\bnew\s+Date\s*\(/);
    expect(src).not.toMatch(/\bMath\s*\.\s*random\s*\(/);
    expect(src).not.toMatch(/\bcrypto\s*\.\s*randomUUID\s*\(/);
    expect(src).not.toMatch(/(?<![.\w])fetch\s*\(/);
    expect(src).not.toMatch(/\bcreateClient\s*\(/);
    expect(src).not.toMatch(/\.rpc\s*\(/);
  });

  it.each(RENDER_FILES)('%s imports no provider SDK', (file) => {
    const src = read(`${RENDER_DIR}/${file}`);
    for (const sdk of ['resend', 'twilio', 'nodemailer', '@sendgrid', 'firebase-admin']) {
      expect(src).not.toContain(`from "${sdk}`);
      expect(src).not.toContain(`from '${sdk}`);
    }
  });

  it('sorts unresolved tokens and slots for stable output', () => {
    expect(read(`${RENDER_DIR}/tokenResolver.ts`)).toContain('.sort()');
    expect(read(`${RENDER_DIR}/slotRenderer.ts`)).toContain('.sort()');
  });
});

describe('Slice 2c-iii — Rule 11 rendering boundary', () => {
  it('flags a src/** import of the rendering package', () => {
    const violations = checkResolverBoundary(
      scan([
        {
          filePath: 'src/platform/omni-comms/bad.ts',
          content:
            'import { renderMessage } from "../../../supabase/functions/omni-comms-runtime/rendering/renderMessage.ts";',
        } as ScannedFile,
      ]),
    );
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.every((v) => v.ruleId === 'OMNI_RESOLVER_RUNTIME_BOUNDARY')).toBe(true);
  });

  it('flags browser use of the trusted rendering RPCs', () => {
    for (const rpc of [
      'omni_comms_priv_load_render_context',
      'omni_comms_priv_persist_rendered_messages',
    ]) {
      const violations = checkResolverBoundary(
        scan([
          {
            filePath: 'src/platform/omni-comms/bad.ts',
            content: `await supabase.rpc('${rpc}', {});`,
          } as ScannedFile,
        ]),
      );
      expect(violations.length).toBeGreaterThan(0);
    }
  });

  it('flags a clock read inside the rendering package', () => {
    const violations = checkResolverBoundary(
      scan([
        {
          filePath: `${RENDER_DIR}/evil.ts`,
          content: 'export const t = Date.now();',
        } as ScannedFile,
      ]),
    );
    expect(violations.some((v) => v.message.includes('determinism violation'))).toBe(true);
  });

  it('flags database access inside the rendering package', () => {
    const violations = checkResolverBoundary(
      scan([
        {
          filePath: `${RENDER_DIR}/evil.ts`,
          content: 'const r = await client.from("omni_comms_message").select("*");',
        } as ScannedFile,
      ]),
    );
    expect(violations.some((v) => v.message.includes('determinism violation'))).toBe(true);
  });

  it('accepts the real rendering package with zero violations', () => {
    const files: ScannedFile[] = RENDER_FILES.map((f) => ({
      filePath: `${RENDER_DIR}/${f}`,
      content: read(`${RENDER_DIR}/${f}`),
    })) as ScannedFile[];
    expect(checkResolverBoundary(scan(files))).toHaveLength(0);
  });
});

describe('Slice 2c-iii — Edge Function wiring', () => {
  it('exposes a dedicated render stage', () => {
    expect(existsSync(resolve(ROOT, 'supabase/functions/omni-comms-runtime/renderStage.ts'))).toBe(
      true,
    );
  });

  it('advertises the 2c-iii build tag', () => {
    expect(read('supabase/functions/omni-comms-runtime/index.ts')).toContain(
      'omni-comms-runtime@2c-iii',
    );
  });

  it('contacts no provider anywhere in the runtime function', () => {
    const dir = 'supabase/functions/omni-comms-runtime';
    const stack = [resolve(ROOT, dir)];
    const sources: string[] = [];
    while (stack.length) {
      const current = stack.pop()!;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = resolve(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name.endsWith('.ts')) sources.push(readFileSync(full, 'utf8'));
      }
    }
    for (const src of sources) {
      expect(src).not.toMatch(/from\s+["']resend/);
      expect(src).not.toMatch(/api\.resend\.com/);
      expect(src).not.toMatch(/api\.twilio\.com/);
    }
  });
});

describe('Slice 2c-iii — verifier and readiness', () => {
  it('ships the database verifier with its success marker', () => {
    const sql = read('scripts/omni-comms/verify-build3-slice2c-iii-rendering.sql');
    expect(sql).toContain('BUILD 3 SLICE 2C-III RENDERING VERIFY OK');
    expect(sql).toContain('omni_comms_priv_load_render_context');
    expect(sql).toContain('omni_comms_priv_persist_rendered_messages');
    expect(sql).toContain('runnable_job_forbidden');
  });

  it('records the Slice 2c-iii foundation rows', () => {
    const items = OMNI_COMMS_READINESS_MANIFEST.foundationStatus.map((f) => f.item);
    for (const item of [
      'Deterministic rendering package (Slice 2c-iii)',
      'Snapshot revalidation (Slice 2c-iii)',
      'Render context RPC (Slice 2c-iii)',
      'Atomic message persistence (Slice 2c-iii)',
      'Mode-aware dispatch behaviour (Slice 2c-iii)',
      'Rendering boundary enforcement (Slice 2c-iii)',
      'Slice 2c-iii runtime certification',
    ]) {
      expect(items).toContain(item);
    }
  });

  it('keeps runtime certification outstanding and claims no live send', () => {
    const cert = OMNI_COMMS_READINESS_MANIFEST.foundationStatus.find(
      (f) => f.item === 'Slice 2c-iii runtime certification',
    );
    expect(cert?.state).not.toBe('Verified');
    expect(OMNI_COMMS_READINESS_MANIFEST.nextStep.title).toContain('certif');
    expect(OMNI_COMMS_READINESS_MANIFEST.systemIdentity.overallStatus).toBe('In progress');
  });
});
