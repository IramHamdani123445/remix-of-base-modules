/**
 * Epic 3 Story 2 — Template Catalogue application services & renderer.
 * Pure unit tests: renderer, token parser, channel-content validator, adapter
 * argument marshalling, and TS/SQL parity of canonical token fixtures.
 * No database round-trip — DB behaviour is covered by verify-epic3-story2-db.sql.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CANONICAL_TOKEN_FIXTURES,
  CANONICAL_FIXTURE_IDS,
} from '@/platform/omni-comms/rendering/__fixtures__/tokens';
import {
  parseTemplateSource,
  extractTokenPaths,
} from '@/platform/omni-comms/rendering/tokenParser';
import { renderField, renderTemplate } from '@/platform/omni-comms/rendering/renderer';
import { validateChannelContent } from '@/platform/omni-comms/rendering/channelContent';
import {
  OmniCommsRenderError,
  OMNI_COMMS_RENDER_ERROR_CODES,
} from '@/platform/omni-comms/rendering/rendererErrors';
import {
  OMNI_COMMS_ERROR_CODES,
  OmniCommsRpcError,
} from '@/platform/omni-comms/application/omniCommsRpcErrors';
import {
  createTemplateFamily,
  createTemplateVersion,
  publishTemplateVersion,
  resolvePublishedTemplate,
} from '@/platform/omni-comms/application/templateCatalogueService';
import { OMNI_COMMS_READINESS_MANIFEST } from '@/platform/omni-comms/registry/readinessManifest';

function mockClient(handler: (fn: string, args: unknown) => { data: unknown; error: unknown }) {
  return { rpc: vi.fn((fn, args) => Promise.resolve(handler(fn, args))) as unknown as (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; details?: string; code?: string } | null }> };
}

describe('Epic 3 Story 2 — token grammar & parser', () => {
  for (const fx of CANONICAL_TOKEN_FIXTURES) {
    it(`${fx.id} — ${fx.outcome}`, () => {
      if (fx.outcome === 'accept') {
        expect(extractTokenPaths(fx.source)).toEqual(fx.tokens ?? []);
      } else {
        expect(() => parseTemplateSource(fx.source)).toThrowError(OmniCommsRenderError);
        try { parseTemplateSource(fx.source); } catch (e) {
          expect((e as Error).message).toContain(fx.rejectDetail!);
        }
      }
    });
  }
});

describe('Epic 3 Story 2 — deterministic renderer', () => {
  it('interpolates scalar values and escapes html fields only', () => {
    const out = renderTemplate('email', {
      subject: 'Hello {{name}}',
      html: '<p>Hi {{name}}</p>',
      text: 'Hi {{name}}',
    }, { name: '<b>Alice</b>' });
    expect(out.fields.subject).toBe('Hello <b>Alice</b>');
    expect(out.fields.html).toBe('<p>Hi &lt;b&gt;Alice&lt;/b&gt;</p>');
    expect(out.fields.text).toBe('Hi <b>Alice</b>');
  });

  it('payload values containing {{...}} are inserted literally, never re-rendered', () => {
    const out = renderField('X: {{v}}', { v: '{{other}}' }, false, 1024);
    expect(out).toBe('X: {{other}}');
  });

  it('missing values raise missing_template_value', () => {
    expect(() => renderField('{{a}}', {}, false, 1024))
      .toThrowError(/missing_value:a/);
  });

  it('rejects non-scalar, null/undefined, non-finite numbers', () => {
    expect(() => renderField('{{o}}', { o: { nested: 1 } }, false, 1024)).toThrow();
    expect(() => renderField('{{o}}', { o: null }, false, 1024)).toThrow();
    expect(() => renderField('{{o}}', { o: NaN }, false, 1024)).toThrow();
    expect(() => renderField('{{o}}', { o: Infinity }, false, 1024)).toThrow();
  });

  it('coerces number and boolean deterministically', () => {
    expect(renderField('{{n}} {{b}}', { n: 42.5, b: false }, false, 64)).toBe('42.5 false');
  });

  it('does not mutate its inputs (deep equality preserved)', () => {
    const content = { subject: 'Hi {{n}}', text: '{{n}}' };
    const payload = { n: 'X', nested: { y: 1 } };
    const snapContent = JSON.parse(JSON.stringify(content));
    const snapPayload = JSON.parse(JSON.stringify(payload));
    renderTemplate('email', content, payload);
    expect(content).toEqual(snapContent);
    expect(payload).toEqual(snapPayload);
  });

  it('enforces UTF-8 byte bound with TextEncoder (no Buffer)', () => {
    const rendererSource = readFileSync(
      join(process.cwd(), 'src/platform/omni-comms/rendering/renderer.ts'), 'utf8');
    expect(rendererSource).not.toMatch(/Buffer\./);
    expect(rendererSource).toMatch(/TextEncoder/);
    expect(() => renderField('{{v}}', { v: 'x'.repeat(10) }, false, 4)).toThrow(/output_too_large/);
  });

  it('renderer error codes are disjoint from RPC error codes', () => {
    for (const c of OMNI_COMMS_RENDER_ERROR_CODES) {
      expect(OMNI_COMMS_ERROR_CODES as readonly string[]).not.toContain(c);
    }
  });
});

describe('Epic 3 Story 2 — channel content validator', () => {
  it('rejects unknown key', () => {
    expect(validateChannelContent('sms', { body: 'hi', extra: 'x' })?.detail).toBe('content_unknown_key');
  });
  it('rejects null value', () => {
    expect(validateChannelContent('sms', { body: null } as unknown)?.detail).toBe('content_null_value');
  });
  it('rejects non-string value', () => {
    expect(validateChannelContent('sms', { body: 5 } as unknown)?.detail).toBe('content_non_string_value');
  });
  it('rejects empty trimmed value', () => {
    expect(validateChannelContent('sms', { body: '   ' })?.detail).toBe('content_empty_value');
  });
  it('email requires html or text', () => {
    expect(validateChannelContent('email', { subject: 'hi' })?.detail).toBe('content_email_body_required');
  });
  it('accepts valid email', () => {
    expect(validateChannelContent('email', { subject: 'Hi {{n}}', text: 'Hi {{n}}' })).toBeNull();
  });
  it('rejects content over 256 KiB', () => {
    const big = 'x'.repeat(300 * 1024);
    expect(validateChannelContent('sms', { body: big })?.detail).toBe('content_too_large');
  });
});

describe('Epic 3 Story 2 — service adapter argument marshalling', () => {
  it('createTemplateFamily forwards typed args and does not add extras', async () => {
    let captured: Record<string, unknown> = {};
    const client = mockClient((_fn, args) => { captured = args as Record<string, unknown>; return { data: { id: 'x' }, error: null }; });
    await createTemplateFamily(client, {
      code: 'welcome', name: 'Welcome', scopeType: 'organization',
      organizationId: 'org-1',
    });
    expect(captured).toEqual({
      p_code: 'welcome', p_name: 'Welcome', p_description: null,
      p_scope_type: 'organization', p_organization_id: 'org-1',
      p_department_id: null, p_event_definition_id: null,
      p_correlation_id: null,
    });
  });

  it('createTemplateVersion passes content jsonb-compatible dict', async () => {
    let captured: Record<string, unknown> = {};
    const client = mockClient((_fn, args) => { captured = args as Record<string, unknown>; return { data: {}, error: null }; });
    await createTemplateVersion(client, {
      templateFamilyId: 'fam-1', channel: 'email', locale: 'en-US',
      versionNumber: 1, content: { subject: 'Hi', text: 'Body' },
    });
    expect(captured.p_content).toEqual({ subject: 'Hi', text: 'Body' });
  });

  it('publishTemplateVersion parses OC### errors into typed OmniCommsRpcError', async () => {
    const client = mockClient(() => ({ data: null, error: { message: 'OC409 duplicate_publication', details: 'publication_conflict' } }));
    await expect(publishTemplateVersion(client, { id: 'v1' })).rejects.toBeInstanceOf(OmniCommsRpcError);
    try { await publishTemplateVersion(client, { id: 'v1' }); } catch (e) {
      expect((e as OmniCommsRpcError).code).toBe('OC409');
      expect((e as OmniCommsRpcError).detail).toBe('publication_conflict');
    }
  });

  it('resolvePublishedTemplate encodes optional department/event as nulls', async () => {
    let captured: Record<string, unknown> = {};
    const client = mockClient((_fn, args) => { captured = args as Record<string, unknown>; return { data: {}, error: null }; });
    await resolvePublishedTemplate(client, {
      organizationId: 'org-1', channel: 'sms', locale: 'en',
    });
    expect(captured).toEqual({
      p_event_definition_id: null, p_organization_id: 'org-1',
      p_department_id: null, p_channel: 'sms', p_locale: 'en',
    });
  });
});

describe('Epic 3 Story 2 — SQL/TS parity of canonical fixtures', () => {
  it('every canonical fixture ID appears in the DB verification script', () => {
    const sqlPath = join(process.cwd(), 'scripts/omni-comms/verify-epic3-story2-db.sql');
    const sql = readFileSync(sqlPath, 'utf8');
    for (const id of CANONICAL_FIXTURE_IDS) {
      expect(sql).toContain(id);
    }
  });
});

describe('Epic 3 Story 2 — Readiness manifest', () => {
  it('current story advanced to Story 2', () => {
    expect(OMNI_COMMS_READINESS_MANIFEST.systemIdentity.currentStory).toBe('Story 2');
  });
  it('next step points to Epic 3 Story 3 admin UI', () => {
    expect(OMNI_COMMS_READINESS_MANIFEST.nextStep).toMatchObject({
      epic: 'Epic 3', story: 'Story 3', informationalOnly: true,
    });
  });
  it('template application services / validation / rendering / approval are Verified', () => {
    const items = OMNI_COMMS_READINESS_MANIFEST.foundationStatus;
    const find = (n: string) => items.find((i) => i.item === n);
    expect(find('Template application services')?.state).toBe('Verified');
    expect(find('Template content validation')?.state).toBe('Verified');
    expect(find('Template rendering')?.state).toBe('Verified');
    expect(find('Template approval workflow')?.state).toBe('Verified');
    expect(find('Template administration UI')?.state).toBe('Planned');
  });
});

describe('Epic 3 Story 2 — architecture invariants', () => {
  it('templateCatalogueErrors does not import from eventCatalogueTypes', () => {
    const src = readFileSync(join(process.cwd(),
      'src/platform/omni-comms/application/templateCatalogueErrors.ts'), 'utf8');
    expect(src).not.toMatch(/from\s+['"][^'"]*eventCatalogue/);
    expect(src).not.toMatch(/import[^;]*eventCatalogue/);
  });

  it('renderer does not import Node-only modules', () => {
    const src = readFileSync(join(process.cwd(),
      'src/platform/omni-comms/rendering/renderer.ts'), 'utf8');
    expect(src).not.toMatch(/from ['"]node:/);
    expect(src).not.toMatch(/require\(/);
  });
});
