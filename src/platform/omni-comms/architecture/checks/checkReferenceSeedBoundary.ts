/**
 * Rule 16 — OMNI_REFERENCE_SEED_BOUNDARY.
 *
 * The Reference Seed Pack populates the Omni-Comms administration screens
 * with NON-PRODUCTION reference data. It is a configuration surface, not a
 * sending surface.
 *
 * Reference-seed files must not:
 *   - import a provider SDK;
 *   - import the browser Supabase singleton or read/write a table directly
 *     (`.from(...)`);
 *   - invoke an Edge Function directly (`functions.invoke`);
 *   - call a private (`omni_comms_priv_*`) RPC or any RPC outside the
 *     approved bounded set;
 *   - import the send façade or runtime internals;
 *   - enable live delivery or reference queue / dispatch / shadow / cutover
 *     vocabulary;
 *   - reference secret material;
 *   - hardcode a recipient address outside the `example.com` domain;
 *   - reference the Legacy Communication Hub.
 */
import type {
  ArchitectureViolation,
  RepositoryScan,
} from '../architectureCheck.types';
import {
  LEGACY_IMPORT_PATTERNS,
  PROVIDER_SDK_PACKAGES,
  isRuleMetadataFile,
} from '../architecturePolicy';

/** Files that make up the Reference Seed Pack surface. */
export function isReferenceSeedFile(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/');
  if (/^src\/platform\/omni-comms\/admin\/views\/seed\//.test(p)) return true;
  if (
    /^src\/platform\/omni-comms\/application\/referenceSeed(Service|Types)\.ts$/.test(
      p,
    )
  ) {
    return true;
  }
  return false;
}

/** The ONLY RPC names the reference-seed surface may reference. */
export const REFERENCE_SEED_ALLOWED_RPCS = new Set([
  'omni_comms_reference_seed_status',
  'omni_comms_reference_seed_preview',
  'omni_comms_reference_seed_apply',
]);

const RPC_LITERAL_RE = /['"`](omni_comms_[a-z0-9_]+)['"`]/g;
const PRIVATE_RPC_RE = /omni_comms_priv_[a-z0-9_]+/g;
const TABLE_ACCESS_RE = /\.from\(\s*['"`][a-z0-9_]+['"`]\s*\)/g;
const EDGE_INVOKE_RE = /functions\s*\.\s*invoke\s*\(/g;
const SUPABASE_SINGLETON_RE =
  /from\s*['"`](?:@\/integrations\/supabase\/client|src\/integrations\/supabase\/client)['"`]/g;
const RUNTIME_IMPORT_RE =
  /from\s*['"`](?:@\/platform\/omni-comms\/(?:runtime|sendCommunication)|\.\.\/runtime|\.\/runtime|\.\.\/\.\.\/sendCommunication)[^'"`]*['"`]/g;
const EMAIL_LITERAL_RE =
  /['"`][A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})['"`]/g;

/** Escalation vocabulary that must never appear on this surface. */
const FORBIDDEN_TOKENS = [
  'enqueueDispatch',
  'createDispatchJob',
  'createDeliveryAttempt',
  'shadow_mode',
  'shadowMode',
  'queued_mode',
  'queuedMode',
  'production_cutover',
  'productionCutover',
  'sendCommunication(',
];

const SECRET_TOKENS = [
  'service_role_key',
  'SUPABASE_SERVICE_ROLE_KEY',
  'x-provider-api-key',
];

/**
 * `live_delivery_enabled` is permitted ONLY as a read-only status field
 * reporting that delivery is switched off. Any other live-delivery mutation
 * vocabulary is forbidden.
 */
const LIVE_ENABLE_RE =
  /live_delivery_enabled\s*[:=]\s*true|liveDeliveryEnabled\s*[:=]\s*true/g;

function push(
  out: ArchitectureViolation[],
  filePath: string,
  evidence: string,
  message: string,
  remediation: string,
): void {
  out.push({
    ruleId: 'OMNI_REFERENCE_SEED_BOUNDARY',
    severity: 'error',
    filePath,
    evidence,
    message,
    remediation,
    baselineStatus: 'not_baselined',
  });
}

export function checkReferenceSeedBoundary(
  scan: RepositoryScan,
): ArchitectureViolation[] {
  const out: ArchitectureViolation[] = [];

  for (const f of scan.files) {
    if (isRuleMetadataFile(f.filePath)) continue;
    if (!/\.(ts|tsx|js|jsx)$/.test(f.filePath)) continue;
    if (!isReferenceSeedFile(f.filePath)) continue;

    let m: RegExpExecArray | null;

    PRIVATE_RPC_RE.lastIndex = 0;
    while ((m = PRIVATE_RPC_RE.exec(f.content)) !== null) {
      push(
        out,
        f.filePath,
        m[0],
        'Reference-seed surface references a private RPC.',
        'The reference-seed surface may only use the three approved seed RPCs.',
      );
    }

    RPC_LITERAL_RE.lastIndex = 0;
    while ((m = RPC_LITERAL_RE.exec(f.content)) !== null) {
      const name = m[1];
      if (REFERENCE_SEED_ALLOWED_RPCS.has(name)) continue;
      if (name.startsWith('omni_comms_priv_')) continue; // already reported
      push(
        out,
        f.filePath,
        m[0],
        `Reference-seed surface references the non-approved RPC "${name}".`,
        'Extend the approved bounded RPC set only with a governed amendment.',
      );
    }

    TABLE_ACCESS_RE.lastIndex = 0;
    while ((m = TABLE_ACCESS_RE.exec(f.content)) !== null) {
      push(
        out,
        f.filePath,
        m[0],
        'Reference-seed surface accesses a table directly.',
        'All reads and writes must go through the approved bounded seed RPCs.',
      );
    }

    SUPABASE_SINGLETON_RE.lastIndex = 0;
    while ((m = SUPABASE_SINGLETON_RE.exec(f.content)) !== null) {
      push(
        out,
        f.filePath,
        m[0].trim(),
        'Reference-seed surface imports the browser Supabase singleton.',
        'Consume the bound RPC client hook instead.',
      );
    }

    EDGE_INVOKE_RE.lastIndex = 0;
    while ((m = EDGE_INVOKE_RE.exec(f.content)) !== null) {
      push(
        out,
        f.filePath,
        m[0],
        'Reference-seed surface invokes an Edge Function directly.',
        'Seeding is configuration only; it must never reach the runtime.',
      );
    }

    RUNTIME_IMPORT_RE.lastIndex = 0;
    while ((m = RUNTIME_IMPORT_RE.exec(f.content)) !== null) {
      push(
        out,
        f.filePath,
        m[0].trim(),
        'Reference-seed surface imports the send façade or runtime internals.',
        'Seeding creates configuration only; it must never send or enqueue.',
      );
    }

    LIVE_ENABLE_RE.lastIndex = 0;
    while ((m = LIVE_ENABLE_RE.exec(f.content)) !== null) {
      push(
        out,
        f.filePath,
        m[0].trim(),
        'Reference-seed surface enables live delivery.',
        'The reference seed must always leave live delivery disabled.',
      );
    }

    EMAIL_LITERAL_RE.lastIndex = 0;
    while ((m = EMAIL_LITERAL_RE.exec(f.content)) !== null) {
      if (m[1].toLowerCase() === 'example.com') continue;
      push(
        out,
        f.filePath,
        m[0],
        `Reference-seed surface hardcodes a non-example.com address ("${m[1]}").`,
        'Reference recipients and senders must always use the example.com domain.',
      );
    }

    for (const token of FORBIDDEN_TOKENS) {
      if (f.content.includes(token)) {
        push(
          out,
          f.filePath,
          token,
          `Reference-seed surface references escalation vocabulary "${token}".`,
          'Seeding must never queue, dispatch, shadow-send or go live.',
        );
      }
    }

    for (const token of SECRET_TOKENS) {
      if (f.content.includes(token)) {
        push(
          out,
          f.filePath,
          token,
          'Reference-seed surface references secret material.',
          'Show statuses, counts and timestamps only.',
        );
      }
    }

    for (const pkg of PROVIDER_SDK_PACKAGES) {
      const clean = pkg.replace(/\/$/, '');
      const re = new RegExp(`from\\s*['"\`]${clean}(?:/[^'"\`]*)?['"\`]`, 'g');
      let pm: RegExpExecArray | null;
      while ((pm = re.exec(f.content)) !== null) {
        push(
          out,
          f.filePath,
          pm[0].trim(),
          `Reference-seed surface imports provider SDK "${clean}".`,
          'Seeding must never contact a provider.',
        );
      }
    }

    for (const root of LEGACY_IMPORT_PATTERNS) {
      if (f.content.includes(root)) {
        push(
          out,
          f.filePath,
          root,
          'Reference-seed surface references the Legacy Communication Hub.',
          'Omni-Comms code must not read, import or modify Legacy Hub code.',
        );
      }
    }
  }

  return out;
}
