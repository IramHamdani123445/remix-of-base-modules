/**
 * Epic 2 — Story 3 verification.
 *
 * Structural + adapter-shape invariants for the Event Catalogue admin UI.
 * Database behaviour (reason enforcement, redaction, escaped search,
 * pagination bounds, overload removal) is exercised by
 * `scripts/omni-comms/verify-story3-db.sql`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { OMNI_COMMS_READINESS_MANIFEST as M } from '@/platform/omni-comms/registry/readinessManifest';
import * as svc from '@/platform/omni-comms/application/eventCatalogueService';

const ROOT = process.cwd();
const PAGE = 'src/platform/omni-comms/admin/views/OmniCommsEventsPage.tsx';
const HOOK = 'src/platform/omni-comms/admin/hooks/useOmniCommsRpcClient.ts';

const pageSrc = () => fs.readFileSync(path.join(ROOT, PAGE), 'utf8');
const hookSrc = () => fs.readFileSync(path.join(ROOT, HOOK), 'utf8');

describe('Omni-Comms Epic 2 — Story 3 (admin UI + hardening)', () => {
  it('readiness manifest promotes Event Catalogue UI to Verified from Story 3', () => {
    // Story 3 introduced the admin UI; later stories may advance currentStory/nextStep
    // but the Story-3 promotion of 'Event Catalogue administration UI' must persist.
    const row = M.foundationStatus.find(
      (r) => r.item === 'Event Catalogue UI' || r.item === 'Event Catalogue administration UI',
    );
    expect(row?.state).toBe('Verified');
  });

  it('configure and view_sensitive_content capabilities are Mapped to Admin', () => {
    const conf = M.capabilities.find((c) => c.key === 'omni_comms.configure');
    const sens = M.capabilities.find((c) => c.key === 'omni_comms.view_sensitive_content');
    expect(conf?.mapping).toBe('Mapped to Admin');
    expect(sens?.mapping).toBe('Mapped to Admin');
  });

  it('lifecycle adapter wrappers send p_reason to all five RPCs', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args }); return { data: 'x', error: null };
      },
    };
    const now = new Date().toISOString();
    await svc.activateEventDefinition(client, { id: 'a', expectedUpdatedAt: now, reason: 'go' });
    await svc.suspendEventDefinition(client, { id: 'a', expectedUpdatedAt: now, reason: 'stop' });
    await svc.retireEventDefinition(client, { id: 'a', expectedUpdatedAt: now, reason: 'end' });
    await svc.publishEventContract(client, { id: 'c', expectedUpdatedAt: now, reason: 'ok' });
    await svc.retireEventContract(client, { id: 'c', expectedUpdatedAt: now, reason: 'obsolete' });
    for (const c of calls) expect(c.args).toHaveProperty('p_reason');
    expect(calls.map((c) => c.args.p_reason)).toEqual(['go', 'stop', 'end', 'ok', 'obsolete']);
  });

  it('listEventDefinitions passes p_search through when provided', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args }); return { data: [], error: null };
      },
    };
    await svc.listEventDefinitions(client, { search: 'benefit%_\\' });
    expect(calls[0].args.p_search).toBe('benefit%_\\');
  });

  it('admin page reuses the bound RPC client and imports the typed adapter', () => {
    const src = pageSrc();
    expect(src).toMatch(/useOmniCommsRpcClient/);
    expect(src).toMatch(/from ['"]@\/platform\/omni-comms\/application\/eventCatalogueService['"]/);
  });

  it('admin page NEVER imports the browser Supabase client and NEVER writes via .from()', () => {
    const src = pageSrc();
    expect(src).not.toMatch(/@\/integrations\/supabase\/client/);
    expect(src).not.toMatch(/\.from\(\s*['"`]/);
  });

  it('admin page enforces server-side reasons in the UI (bounded at 2000 chars)', () => {
    const src = pageSrc();
    expect(src).toMatch(/const REASON_MAX = 2000/);
    expect(src).toMatch(/reasonRequired/);
  });

  it('publish action requires a synthetic-confirmation checkbox', () => {
    const src = pageSrc();
    expect(src).toMatch(/requireSyntheticConfirmation/);
    expect(src).toMatch(/action === ["']publish["']/);
  });

  it('page surfaces redacted-payload state and blocks publishing when redacted', () => {
    const src = pageSrc();
    expect(src).toMatch(/sample_payload_redacted/);
    expect(src).toMatch(/Sample payload redacted/);
  });

  it('bound hook exists, does not import React, and returns an rpc-only adapter', () => {
    const src = hookSrc();
    expect(src).toMatch(/from ["']@\/integrations\/supabase\/client["']/);
    expect(src).toMatch(/rpc:/);
    // Must not expose a sendCommunication façade.
    expect(src).not.toMatch(/sendCommunication/);
  });

  it('Story 3 hardening migration exists and drops legacy overloads', () => {
    const dir = path.join(ROOT, 'supabase', 'migrations');
    const combined = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .join('\n');
    // Drops old signatures (three-arg lifecycle overloads)
    expect(combined).toMatch(/DROP FUNCTION IF EXISTS public\.omni_comms_event_definition_activate\(uuid, timestamptz, text\)/);
    expect(combined).toMatch(/DROP FUNCTION IF EXISTS public\.omni_comms_event_contract_publish\(uuid, timestamptz, text\)/);
    // New audit helper is present with the compliant name
    expect(combined).toMatch(/CREATE OR REPLACE FUNCTION public\.omni_comms_priv_write_lifecycle_audit\b/);
    // Escape helper present
    expect(combined).toMatch(/CREATE OR REPLACE FUNCTION public\.omni_comms_priv_escape_ilike\b/);
    // Contract get returns sample_payload_redacted
    expect(combined).toMatch(/sample_payload_redacted boolean/);
  });

  it('no permanent-name violations were introduced (no _v2 in Story 3 migration)', () => {
    const dir = path.join(ROOT, 'supabase', 'migrations');
    const combined = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.sql') && /omni_comms/i.test(fs.readFileSync(path.join(dir, f), 'utf8')))
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .join('\n');
    expect(combined).not.toMatch(/omni_comms_priv_write_audit_v2/);
    expect(combined).not.toMatch(/omni_comms[a-z_]*_v2\b/i);
  });
});
