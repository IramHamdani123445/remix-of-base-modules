/**
 * Phase 5 — Controlled Dry-Run: server guard wiring, SQL verifier and smoke
 * artefact assertions. Static, read-only checks.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const EDGE = 'supabase/functions/omni-comms-runtime/index.ts';
const VERIFIER = 'scripts/omni-comms/verify-controlled-dry-run.sql';
const SMOKE = 'e2e/omni-comms/controlled-dry-run-smoke.py';

describe('controlled dry-run server guard wiring', () => {
  const edge = read(EDGE);

  it('invokes the administration guard before runtime persistence', () => {
    const guardIdx = edge.indexOf('omni_comms_priv_admin_dry_run_guard');
    const sendIdx = edge.indexOf('omni_comms_priv_send_communication', guardIdx);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(sendIdx).toBeGreaterThan(guardIdx);
  });

  it('applies the guard only to the bounded administration caller module', () => {
    expect(edge).toContain('callerModule === "OMNI_COMMS_ADMIN_DRY_RUN"');
  });

  it('passes the canonical mode, channels and recipients to the guard', () => {
    expect(edge).toMatch(/p_mode: canonical\.mode/);
    expect(edge).toMatch(/p_channels: canonical\.requestedChannels/);
    expect(edge).toMatch(/p_recipients: canonical\.recipients/);
  });

  it('blocks the request when the guard does not allow it', () => {
    expect(edge).toContain('guard.allowed !== true');
  });
});

describe('controlled dry-run SQL verifier', () => {
  const sql = read(VERIFIER);

  it('exists and prints the non-certification marker', () => {
    expect(sql).toContain('OMNI COMMS CONTROLLED DRY RUN VERIFY OK');
  });

  it('does not emit protected certification markers', () => {
    expect(sql).not.toContain('SLICE 2C-II EDGE RESOLUTION INTEGRATION OK');
    expect(sql).not.toContain('SLICE 2C-III EDGE RUNTIME VERTICAL INTEGRATION OK');
  });

  it('checks security posture, guards, invariants, routes and objects', () => {
    for (const needle of [
      'prosecdef',
      'omni_comms_validate_dry_run_payload',
      'omni_comms_priv_admin_dry_run_guard',
      'omni_comms_controlled_dry_run_gate',
      'dry_run_dispatch_jobs',
      'dry_run_delivery_attempts',
      'omni_comms_menu_routes',
      'references_legacy',
    ]) {
      expect(sql).toContain(needle);
    }
  });

  it('performs no mutation', () => {
    expect(sql).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|truncate)\b/i);
  });
});

describe('controlled dry-run browser smoke', () => {
  const smoke = read(SMOKE);

  it('skips cleanly when the preview session is signed out', () => {
    expect(smoke).toContain('Not executed — authenticated preview unavailable');
  });

  it('skips cleanly when the server feature gate is disabled', () => {
    expect(smoke).toContain('Not executed — controlled dry-run disabled');
  });

  it('asserts the zero dispatch-job and zero delivery-attempt invariants', () => {
    expect(smoke).toContain('Dispatch jobs: 0');
    expect(smoke).toContain('Delivery attempts: 0');
  });

  it('asserts no provider network call occurs', () => {
    expect(smoke).toContain('PROVIDER_HOSTS');
    expect(smoke).toContain('Provider network calls observed');
  });

  it('proves no eighth permanent route resolves', () => {
    expect(smoke).toContain('/simulator');
    expect(smoke).toContain('Unexpected route resolved');
  });
});
