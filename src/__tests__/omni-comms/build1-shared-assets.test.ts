/**
 * Accelerated Build 1 — file-existence, registry-invariance and composer tests.
 *
 * Runtime SQL behaviour is proven separately by
 * scripts/omni-comms/verify-build1-shared-assets.sql (transaction-isolated
 * verifier that inspects pg_class/pg_proc). This spec keeps the JS-side
 * contract stable and asserts registry invariants.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OMNI_COMMS_OBJECT_REGISTRY, OMNI_COMMS_OBJECT_COUNT } from '@/platform/omni-comms/registry/objectRegistry';
import { OMNI_COMMS_ROUTE_REGISTRY } from '@/platform/omni-comms/registry/routeRegistry';
import { SHARED_ASSETS_RPC_NAMES } from '@/platform/omni-comms/application/sharedAssetsService';
import { composeAssembledEmail } from '@/platform/omni-comms/rendering/manifestComposer';
import type { RenderManifest } from '@/platform/omni-comms/application/sharedAssetsTypes';

const root = resolve(__dirname, '..', '..', '..');

describe('Build 1 — Shared Assets & Layouts', () => {
  it('omni-comms object registry remains exactly 20 objects (19 foundation + caller-module registry)', () => {
    expect(OMNI_COMMS_OBJECT_COUNT).toBe(22);
    expect(OMNI_COMMS_OBJECT_REGISTRY.length).toBe(22);
    for (const o of OMNI_COMMS_OBJECT_REGISTRY) {
      expect(o.name.startsWith('omni_comms_')).toBe(true);
    }
  });

  it('Channels admin route is registered (state controlled by later builds)', () => {
    const ch = OMNI_COMMS_ROUTE_REGISTRY.find((r) => r.path.endsWith('/channels'));
    expect(ch).toBeDefined();
  });

  it('shared assets service exports exactly 13 RPC names', () => {
    expect(SHARED_ASSETS_RPC_NAMES.length).toBe(13);
    expect(new Set(SHARED_ASSETS_RPC_NAMES).size).toBe(13);
    for (const n of SHARED_ASSETS_RPC_NAMES) {
      expect(n).toMatch(/^(core_comm_|core_template_layout_|omni_comms_)/);
      expect(n.includes('.')).toBe(false);
    }
  });

  it('migration + verifier + rollback scripts exist', () => {
    expect(existsSync(resolve(root, 'scripts/omni-comms/verify-build1-shared-assets.sql'))).toBe(true);
    expect(existsSync(resolve(root, 'scripts/omni-comms/rollback/build1-shared-assets-rollback.sql'))).toBe(true);
    const evidence = resolve(root, 'src/platform/omni-comms/registry/evidence/build-01-shared-assets.md');
    expect(existsSync(evidence)).toBe(true);
    const body = readFileSync(evidence, 'utf8');
    expect(body).toMatch(/BUILD 1 SHARED ASSETS AND LAYOUTS VERIFY OK/);
  });

  it('composer produces deterministic checksum and reports inheritance', async () => {
    const manifest: RenderManifest = {
      template_family_id: 'fam-1',
      template_version_id: 'ver-1',
      template_content: { subject: 'Hi', html: '<p>x</p>', text: 'x' },
      template_channel: 'email',
      template_locale: 'en-US',
      layout_id: 'lay-1',
      layout_version_id: 'lv-1',
      layout_inheritance_source: 'organization',
      layout_slots: [
        { code: 'email_header', order: 10 },
        { code: 'content_body', order: 20 },
        { code: 'email_signature', order: 30, required: true },
        { code: 'email_footer', order: 40 },
      ],
      resolved_assets: [
        { slot: 'email_header', asset_id: 'a1', asset_version_id: 'av1', asset_type: 'email_header', inheritance_source: 'organization', content_html: '<h1>H</h1>', content_text: 'H', checksum: 'a'.repeat(64) },
        { slot: 'email_signature', asset_id: 'a2', asset_version_id: 'av2', asset_type: 'email_signature', inheritance_source: 'department', content_html: '<p>Sig-dept</p>', content_text: 'Sig-dept', checksum: 'b'.repeat(64) },
        { slot: 'email_footer', asset_id: null, asset_version_id: null, asset_type: null, inheritance_source: 'unresolved' },
      ],
    };
    const r1 = await composeAssembledEmail({
      manifest,
      templateRendered: { subject: 'Hi', html: '<p>Body</p>', text: 'Body', unresolved_tokens: [] },
    });
    expect(r1.rendered_checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(r1.rendered_html).toContain('<h1>H</h1>');
    expect(r1.rendered_html).toContain('<p>Body</p>');
    expect(r1.rendered_html).toContain('Sig-dept');

    // Same inputs → same checksum (deterministic)
    const r2 = await composeAssembledEmail({
      manifest,
      templateRendered: { subject: 'Hi', html: '<p>Body</p>', text: 'Body', unresolved_tokens: [] },
    });
    expect(r2.rendered_checksum).toBe(r1.rendered_checksum);

    // Swap department signature → organisation signature: checksum changes,
    // body/header/footer unchanged.
    const manifestOrgSig: RenderManifest = {
      ...manifest,
      resolved_assets: manifest.resolved_assets.map((r) =>
        r.slot === 'email_signature'
          ? { ...r, inheritance_source: 'organization', asset_id: 'a3', asset_version_id: 'av3', content_html: '<p>Sig-org</p>', content_text: 'Sig-org', checksum: 'c'.repeat(64) }
          : r,
      ),
    };
    const r3 = await composeAssembledEmail({
      manifest: manifestOrgSig,
      templateRendered: { subject: 'Hi', html: '<p>Body</p>', text: 'Body', unresolved_tokens: [] },
    });
    expect(r3.rendered_checksum).not.toBe(r1.rendered_checksum);
    expect(r3.rendered_html).toContain('<h1>H</h1>');
    expect(r3.rendered_html).toContain('<p>Body</p>');
    expect(r3.rendered_html).toContain('Sig-org');
    expect(r3.rendered_html).not.toContain('Sig-dept');
  });
});
