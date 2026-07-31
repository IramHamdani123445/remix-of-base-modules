/**
 * Real contract-mirror drift test.
 *
 * The Edge Function cannot import from `src/`, so the canonical result
 * contract exists twice:
 *   - browser: src/platform/omni-comms/runtime/responseContract.ts
 *   - edge:    supabase/functions/omni-comms-runtime/responseContract.ts
 *
 * Divergence between them is a silent correctness failure: the Edge could
 * emit a status or channel the browser refuses to parse, turning a valid
 * send into `runtime_persistence_failed`. This test compares the ACTUAL
 * declared vocabularies of both files rather than asserting either one in
 * isolation.
 *
 * The Edge mirror is parsed from source (never executed) because it targets
 * the Deno runtime.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  OMNI_COMMS_RESULT_CONTRACT_VERSION,
  OMNI_COMMS_SEND_MODES,
  OMNI_COMMS_CHANNELS,
  OMNI_COMMS_MESSAGE_STATUSES,
  OMNI_COMMS_TERMINAL_MESSAGE_STATUS,
  OMNI_COMMS_REQUEST_STATUSES,
  OMNI_COMMS_ELIGIBILITY_STATUSES,
} from '../../platform/omni-comms/runtime/responseContract';

const EDGE_PATH = path.resolve(
  __dirname,
  '../../../supabase/functions/omni-comms-runtime/responseContract.ts',
);
const BROWSER_PATH = path.resolve(
  __dirname,
  '../../platform/omni-comms/runtime/responseContract.ts',
);
const edgeSrc = readFileSync(EDGE_PATH, 'utf8');
const browserSrc = readFileSync(BROWSER_PATH, 'utf8');

/**
 * Extract the declared field names of `export interface NAME { ... }`.
 * Comments are stripped so documentation drift never masquerades as a field.
 */
function interfaceFields(src: string, name: string, label: string): string[] {
  const m = src.match(new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`${label} is missing interface ${name}`);
  const body = m[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  return [...body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\??\s*:/gm)].map((x) => x[1]);
}


/** Extract a `export const NAME = [ ... ] as const;` string array. */
function edgeArray(name: string): string[] {
  const m = edgeSrc.match(
    new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`),
  );
  if (!m) throw new Error(`edge mirror is missing ${name}`);
  return [...m[1].matchAll(/["']([a-z0-9_]+)["']/gi)].map((x) => x[1]);
}

/** Extract a `export const NAME = "value";` string literal. */
function edgeString(name: string): string {
  const m = edgeSrc.match(new RegExp(`export const ${name}\\s*=\\s*["']([^"']+)["']`));
  if (!m) throw new Error(`edge mirror is missing ${name}`);
  return m[1];
}

/** Extract a `Record<...> = { key: "value", ... }` mapping. */
function edgeRecord(name: string): Record<string, string> {
  const m = edgeSrc.match(new RegExp(`export const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\};`));
  if (!m) throw new Error(`edge mirror is missing ${name}`);
  const out: Record<string, string> = {};
  for (const e of m[1].matchAll(/([a-z0-9_]+)\s*:\s*["']([a-z0-9_]+)["']/gi)) {
    out[e[1]] = e[2];
  }
  return out;
}

describe('Omni-Comms result contract — browser/Edge mirror drift', () => {
  it('declares the same contract version on both sides', () => {
    expect(edgeString('OMNI_COMMS_RESULT_CONTRACT_VERSION')).toBe(
      OMNI_COMMS_RESULT_CONTRACT_VERSION,
    );
  });

  it('declares identical send modes, in the same order', () => {
    expect(edgeArray('OMNI_COMMS_SEND_MODES')).toEqual([...OMNI_COMMS_SEND_MODES]);
  });

  it('declares identical channels', () => {
    expect(edgeArray('OMNI_COMMS_CHANNELS')).toEqual([...OMNI_COMMS_CHANNELS]);
  });

  it('declares identical message statuses', () => {
    expect(edgeArray('OMNI_COMMS_MESSAGE_STATUSES')).toEqual([
      ...OMNI_COMMS_MESSAGE_STATUSES,
    ]);
  });

  it('declares identical request statuses, including the persisted accepted state', () => {
    const edge = edgeArray('OMNI_COMMS_REQUEST_STATUSES');
    expect(edge).toEqual([...OMNI_COMMS_REQUEST_STATUSES]);
    expect(edge).toContain('accepted');
  });

  it('declares identical eligibility statuses', () => {
    expect(edgeArray('OMNI_COMMS_ELIGIBILITY_STATUSES')).toEqual([
      ...OMNI_COMMS_ELIGIBILITY_STATUSES,
    ]);
  });

  it('maps every mode to the same terminal message status', () => {
    expect(edgeRecord('OMNI_COMMS_TERMINAL_MESSAGE_STATUS')).toEqual(
      OMNI_COMMS_TERMINAL_MESSAGE_STATUS,
    );
  });

  it('keeps every terminal status inside the message-status vocabulary', () => {
    for (const status of Object.values(OMNI_COMMS_TERMINAL_MESSAGE_STATUS)) {
      expect(OMNI_COMMS_MESSAGE_STATUSES as readonly string[]).toContain(status);
    }
  });

  it('never lets the Edge mirror import from the browser tree', () => {
    expect(edgeSrc).not.toMatch(/from ['"](@\/|\.\.\/\.\.\/\.\.\/src)/);
  });
  });


  const MIRRORED_INTERFACES = [
    'SendCommunicationRecipientResult',
    'SendCommunicationMessageResult',
    'SendCommunicationResult',
  ] as const;

  for (const name of MIRRORED_INTERFACES) {
    it(`declares identical field names for ${name}`, () => {
      const browser = interfaceFields(browserSrc, name, 'browser contract');
      const edge = interfaceFields(edgeSrc, name, 'edge mirror');
      // Non-empty guard: an unparsed interface must not pass vacuously.
      expect(browser.length).toBeGreaterThan(0);
      // Sorted comparison catches add / remove / rename in either mirror.
      expect([...edge].sort()).toEqual([...browser].sort());
      // Declaration order is part of the reviewed contract shape.
      expect(edge).toEqual(browser);
    });
  }

  it('keeps the result interface anchored to the mirrored element types', () => {
    const fields = interfaceFields(browserSrc, 'SendCommunicationResult', 'browser contract');
    expect(fields).toContain('recipients');
    expect(fields).toContain('messages');
    expect(fields).toContain('contractVersion');
  });
});
