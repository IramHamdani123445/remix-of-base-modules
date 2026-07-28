/**
 * Epic 3 — Story 4 final verification (source-controlled invariants).
 *
 * Runtime database behaviour is exercised by
 * scripts/omni-comms/verify-epic3-story4-db.sql. This suite pins the
 * source-controlled artefacts that must be shipped for Epic 3 to be
 * considered complete.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { OMNI_COMMS_READINESS_MANIFEST as M } from '@/platform/omni-comms/registry/readinessManifest';
import { OMNI_COMMS_ROUTE_REGISTRY } from '@/platform/omni-comms/registry/routeRegistry';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

const VERIFIER = 'scripts/omni-comms/verify-epic3-story4-db.sql';
const ROLLBACK = 'scripts/omni-comms/rollback/epic3-template-catalogue-rollback.sql';
const EVIDENCE = 'src/platform/omni-comms/registry/evidence/epic-03-template-catalogue.md';
const STORY3_ROLLBACK = 'scripts/omni-comms/rollback/story2-publish-hotfix-rollback.sql';

describe('Omni-Comms Epic 3 — Story 4 (Final verification)', () => {
  it('final-verifier SQL is present and read-only', () => {
    expect(exists(VERIFIER)).toBe(true);
    const sql = read(VERIFIER);
    expect(sql).toContain('EPIC 3 STORY 4 VERIFY OK');
    const code = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').toUpperCase();
    for (const w of ['INSERT ', 'UPDATE ', 'DELETE ', 'ALTER ', 'CREATE TABLE', 'GRANT ', 'REVOKE ', 'DROP ']) {
      expect(code).not.toContain(w);
    }
  });

  it('full Epic 3 rollback file is documentation-only and preserves Epic 1/2 artefacts', () => {
    expect(exists(ROLLBACK)).toBe(true);
    const sql = read(ROLLBACK);
    // Every SQL destructive line must be commented out
    for (const line of sql.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      if (/^(DROP|ALTER|TRUNCATE|DELETE|UPDATE|INSERT|GRANT|REVOKE)\b/i.test(t)) {
        throw new Error(`uncommented destructive line: ${t}`);
      }
    }
    // Documents each canonical operation
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.omni_comms_template_version_publish/);
    expect(sql).toMatch(/DROP TABLE IF EXISTS public\.omni_comms_template_family/);
    expect(sql).toMatch(/PRESERVED/);
    expect(sql).toMatch(/Epic 2 event catalogue/);
    expect(sql).toMatch(/Legacy Communication Hub/);
    expect(sql).not.toMatch(/CASCADE/);
  });

  it('Story 2 hotfix rollback still exists for hotfix-only reversal', () => {
    expect(exists(STORY3_ROLLBACK)).toBe(true);
  });

  it('evidence document is present with the required structure', () => {
    expect(exists(EVIDENCE)).toBe(true);
    const md = read(EVIDENCE);
    for (const header of [
      '# Epic 3',
      'Executive summary',
      'Table inventory',
      'Public RPC inventory',
      'Private helper inventory',
      'Permission model',
      'Left-menu registration',
      'Family lifecycle',
      'Version lifecycle',
      'Publication concurrency and replacement',
      'Checksum',
      'Scope resolution',
      'Preview isolation',
      'Audit atomicity',
      'Rollback plan',
      'Known limitations',
      'Next approved epic',
      'Epic 3 completion status',
    ]) {
      expect(md).toContain(header);
    }
    // Uses the shared audit table, not an Omni-Comms-specific one
    expect(md).toContain('public.core_audit_log');
    expect(md).not.toContain('omni_comms_admin_audit_log');
    // Accurate lint reporting
    expect(md).toMatch(/Repository-wide lint: failed due to pre-existing unrelated violations/);
    expect(md).toMatch(/Story 3\/Epic 3 scoped lint: passed with zero violations/);
    // Correct arithmetic
    expect(md).toMatch(/14 public/);
    expect(md).toMatch(/6 private/);
    // Uses actual helper name, not a fabricated one
    expect(md).toContain('omni_comms_priv_compute_template_checksum');
    expect(md).not.toContain('omni_comms_priv_hash_channel_content');
  });

  it('readiness manifest is on Epic 3 Story 4 with completion rows verified', () => {
    expect(M.systemIdentity.currentEpic).toBe('Epic 3');
    expect(M.systemIdentity.currentStory).toBe('Story 4');
    expect(M.systemIdentity.overallStatus).toBe('In progress');
    for (const item of [
      'Template catalogue security evidence',
      'Template catalogue rollback proof',
      'Epic 3 completion evidence',
    ]) {
      const row = M.foundationStatus.find((r) => r.item === item);
      expect(row?.state).toBe('Verified');
    }
    // Uniqueness — no duplicated foundation items
    const seen = new Set<string>();
    for (const r of M.foundationStatus) {
      expect(seen.has(r.item)).toBe(false);
      seen.add(r.item);
    }
  });

  it('nextStep advances to Epic 4 Story 1 (Providers/Senders/Channels)', () => {
    expect(M.nextStep.epic).toBe('Epic 4');
    expect(M.nextStep.story).toBe('Story 1');
    expect(M.nextStep.title.toLowerCase()).toMatch(/provider/);
    expect(M.nextStep.informationalOnly).toBe(true);
  });

  it('all seven permanent Omni-Comms routes remain registered', () => {
    expect(OMNI_COMMS_ROUTE_REGISTRY).toHaveLength(7);
  });
});
