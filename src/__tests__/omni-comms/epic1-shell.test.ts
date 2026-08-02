import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  OMNI_COMMS_PERMISSIONS,
  OMNI_COMMS_PERMISSION_DEFINITIONS,
} from '@/platform/rbac/omniComms.permissions';
import { ALL_PERMISSION_DEFINITIONS } from '@/platform/rbac/permissionRegistry';

const OMNI_ROOT = path.resolve(__dirname, '..', '..', 'platform', 'omni-comms');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('Omni-Comms Epic 1 shell', () => {
  it('registers six capability keys', () => {
    const keys = Object.values(OMNI_COMMS_PERMISSIONS);
    expect(keys).toHaveLength(6);
    expect(new Set(keys).size).toBe(6);
    for (const k of keys) expect(k.startsWith('omni_comms.')).toBe(true);
  });

  it('every capability has a definition; view, configure and operate are ACTIVE (C6)', () => {
    const defsByKey = new Map(OMNI_COMMS_PERMISSION_DEFINITIONS.map((d) => [d.permission_key, d]));
    for (const key of Object.values(OMNI_COMMS_PERMISSIONS)) {
      expect(defsByKey.has(key)).toBe(true);
    }
    const active = OMNI_COMMS_PERMISSION_DEFINITIONS.filter((d) => d.lifecycle_status === 'ACTIVE');
    expect(active.map((d) => d.permission_key).sort()).toEqual([
      OMNI_COMMS_PERMISSIONS.configure,
      OMNI_COMMS_PERMISSIONS.operate,
      OMNI_COMMS_PERMISSIONS.view,
    ].sort());
  });

  it('capabilities are merged into the central permission registry', () => {
    const all = new Set(ALL_PERMISSION_DEFINITIONS.map((d) => d.permission_key));
    for (const k of Object.values(OMNI_COMMS_PERMISSIONS)) expect(all.has(k)).toBe(true);
  });

  it('no Omni-Comms source file imports from Legacy Communication Hub or provider SDKs', () => {
    const legacyPatterns = [
      /from ['"]@\/platform\/communication-hub/,
      /from ['"]@\/pages\/admin\/communicationHub/,
      /from ['"]resend['"]/,
      /from ['"]twilio['"]/,
      /from ['"]@twilio\//,
      /from ['"]nodemailer['"]/,
      /from ['"]@sendgrid\//,
    ];
    const offenders: string[] = [];
    for (const file of walk(OMNI_ROOT)) {
      const src = readFileSync(file, 'utf8');
      if (legacyPatterns.some((re) => re.test(src))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('the canonical façade path exists exactly once (post-Slice-2a)', () => {
    const files = walk(OMNI_ROOT);
    const facades = files.filter((f) => path.basename(f) === 'sendCommunication.ts');
    expect(facades).toHaveLength(1);
    expect(facades[0].replace(/\\/g, '/')).toMatch(
      /src\/platform\/omni-comms\/sendCommunication\.ts$/,
    );
  });
});
