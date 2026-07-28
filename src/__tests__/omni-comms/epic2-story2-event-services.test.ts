/**
 * Epic 2 — Story 2 verification.
 *
 * Structural + registry invariants for the Event Catalogue application
 * services. Database behaviour is exercised by the psql harness
 * `scripts/omni-comms/verify-story2-db.sql`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { OMNI_COMMS_READINESS_MANIFEST as M } from '@/platform/omni-comms/registry/readinessManifest';
import {
  OMNI_COMMS_ERROR_CODES,
  OMNI_COMMS_VALIDATION_DETAILS,
  OmniCommsRpcError,
} from '@/platform/omni-comms/application/eventCatalogueTypes';
import * as svc from '@/platform/omni-comms/application/eventCatalogueService';

const REPO_ROOT = process.cwd();

describe('Omni-Comms Epic 2 — Story 2 (application services)', () => {
  it('manifest identity remains within Epic 2', () => {
    expect(M.systemIdentity.currentEpic).toBe('Epic 2');
    expect(M.nextStep.epic).toBe('Epic 2');
  });

  it('records the five Story-2 foundation-status rows', () => {
    const items = [
      'Event Catalogue application services',
      'Contract schema validation',
      'Contract sample validation',
      'Contract checksum generation',
      'Event Catalogue UI',
    ] as const;
    for (const item of items) {
      const row = M.foundationStatus.find((r) => r.item === item);
      expect(row, `missing foundation row: ${item}`).toBeDefined();
      // Story 3 promotes 'Event Catalogue UI' to Verified; the four Story-2
      // service rows must remain Verified.
      expect(row!.state).toBe('Verified');
    }
  });

  it('exposes stable error-code and validation-detail catalogues', () => {
    for (const code of ['OC401','OC403','OC404','OC409','OC410','OC412','OC413','OC422','OC450','OC500']) {
      expect(OMNI_COMMS_ERROR_CODES).toContain(code as (typeof OMNI_COMMS_ERROR_CODES)[number]);
    }
    for (const d of [
      'invalid_schema','root_schema_not_object','sample_payload_not_object',
      'sample_payload_invalid','non_local_ref','schema_too_large','sample_payload_too_large',
    ]) {
      expect(OMNI_COMMS_VALIDATION_DETAILS).toContain(d as (typeof OMNI_COMMS_VALIDATION_DETAILS)[number]);
    }
  });

  it('exports all 13 typed RPC wrappers', () => {
    const required = [
      'createEventDefinition','updateEventDefinitionDraft',
      'activateEventDefinition','suspendEventDefinition','retireEventDefinition',
      'createEventContract','updateEventContractDraft',
      'publishEventContract','retireEventContract',
      'getEventDefinition','listEventDefinitions',
      'getEventContract','listEventContracts',
    ];
    for (const fn of required) {
      expect(typeof (svc as Record<string, unknown>)[fn]).toBe('function');
    }
  });

  it('service module imports no browser Supabase client, no React, and no Legacy code', () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'src/platform/omni-comms/application/eventCatalogueService.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/@\/integrations\/supabase\/client/);
    expect(src).not.toMatch(/from ['"]react['"]/);
    expect(src).not.toMatch(/notification_queue|notification_logs|core_template/);
    // Explicit prohibition: no call/export of a sendCommunication façade.
    expect(src).not.toMatch(/\bsendCommunication\s*\(/);
    expect(src).not.toMatch(/export[^;]+sendCommunication/);
  });

  it('parses OC-coded errors into typed OmniCommsRpcError instances', async () => {
    const fakeClient = {
      rpc: async () => ({
        data: null,
        error: { message: 'OC409 duplicate_event_code', details: 'X.Y.Z' },
      }),
    };
    try {
      await svc.createEventDefinition(fakeClient, {
        code: 'X.Y.Z', moduleCode: 'X', entityType: 'Y', name: 'n',
        communicationClass: 'transactional',
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(OmniCommsRpcError);
      expect((e as OmniCommsRpcError).code).toBe('OC409');
      expect((e as OmniCommsRpcError).detail).toBe('X.Y.Z');
    }
  });

  it('list RPCs pass through bounded limits and non-negative offsets', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return { data: [], error: null };
      },
    };
    await svc.listEventDefinitions(client, { limit: 25, offset: 10, status: 'active' });
    expect(calls[0].fn).toBe('omni_comms_event_definition_list');
    expect(calls[0].args).toEqual({ p_limit: 25, p_offset: 10, p_status: 'active', p_module_code: null, p_search: null });

    await svc.listEventContracts(client, {
      eventDefinitionId: '00000000-0000-0000-0000-000000000000',
    });
    expect(calls[1].fn).toBe('omni_comms_event_contract_list');
    expect(calls[1].args.p_limit).toBe(50);
    expect(calls[1].args.p_offset).toBe(0);
  });

  it('a Story-2 migration file exists that creates the 13 required RPCs', () => {
    const dir = path.join(REPO_ROOT, 'supabase', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    const required = [
      'omni_comms_event_definition_create',
      'omni_comms_event_definition_update_draft',
      'omni_comms_event_definition_activate',
      'omni_comms_event_definition_suspend',
      'omni_comms_event_definition_retire',
      'omni_comms_event_contract_create',
      'omni_comms_event_contract_update_draft',
      'omni_comms_event_contract_publish',
      'omni_comms_event_contract_retire',
      'omni_comms_event_definition_get',
      'omni_comms_event_definition_list',
      'omni_comms_event_contract_get',
      'omni_comms_event_contract_list',
    ];
    const combined = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    for (const fn of required) {
      expect(combined).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b`));
    }
    // All public RPCs must be granted only to authenticated.
    for (const fn of required) {
      expect(combined).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\b[^;]*TO authenticated`));
    }
  });

  it('no permission migration was introduced by Story 2', () => {
    const dir = path.join(REPO_ROOT, 'supabase', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    for (const f of files) {
      const c = fs.readFileSync(path.join(dir, f), 'utf8');
      // Story 2 must not create/alter permission-registry rows
      if (/omni_comms_event_(definition|contract)_(create|update|activate|publish|retire)/i.test(c)) {
        expect(c).not.toMatch(/INSERT\s+INTO\s+public\.(role_permissions|module_actions|app_modules)/i);
      }
    }
  });
});
