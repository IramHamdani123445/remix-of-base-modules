/**
 * Regression — canonical `content_body` layout slot.
 *
 * `content_body` is the template BODY slot, not an asset slot. The
 * layout-version guard exempts it from `allowed_asset_types` and the shared
 * manifest composer fills it with the rendered template body. The runtime
 * renderer must agree: it may never demand an asset for `content_body`, and
 * it must substitute the body into a `{{content_body}}` wrapper token.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const DIR = 'supabase/functions/omni-comms-runtime/rendering';
const read = (f: string) => readFileSync(resolve(ROOT, DIR, f), 'utf8');

describe('runtime renderer — content_body body slot', () => {
  it('excludes content_body from asset slot resolution', () => {
    const src = read('slotRenderer.ts');
    expect(src).toContain('BODY_SLOT_CODE');
    expect(src).toContain('d.code !== BODY_SLOT_CODE');
  });

  it('injects the body into {{content}} or {{content_body}}', () => {
    const src = read('layoutRenderer.ts');
    expect(src).toContain('content(?:_body)?');
  });
});
